import type { SpatialEnvironmentSpec } from "./spatialEnvironment.js";
import { requestsSpatialLightProbes, supportsSpatialLightProbes } from "./spatialLightProbes.js";
import { requestsSpatialLightShafts, supportsSpatialLightShafts } from "./spatialLightShafts.js";
import { requestsSpatialHeightFog, supportsSpatialHeightFog } from "./spatialHeightFog.js";
import { requestsSpatialPointPcss, supportsSpatialPointPcss } from "./spatialPointPcss.js";
import { requestsSpatialSunPcss, supportsSpatialSunPcss } from "./spatialSunPcss.js";
import { requestsSpatialPointShadows, supportsSpatialPointShadows } from "./spatialPointShadows.js";
import { hasSpatialSelectionSource, requestsSpatialWideBloom, supportsSpatialWideBloom } from "./spatialBloom.js";
import { requestsSpatialLightSelection, supportsSpatialLightSelection } from "./spatialLightSelection.js";
import { requestsSpatialLightChannels, supportsSpatialLightChannels } from "./spatialLightChannels.js";

/** Cold compatibility policy, newest first. Feature validators/compilers own values;
 * this module only owns the required wire/save version and capability dependencies.
 */
const features = [
  {
    label: "Light probes",
    patchMessage: "Light probes requires",
    capability: "supportsSpatialLightProbes",
    wireVersion: 15, patchVersion: 16, stateVersion: 18,
    requested: requestsSpatialLightProbes,
    native: supportsSpatialLightProbes,
    buffer: (v: Float32Array) => v.length >= 700,
  },
  {
    label: "Light shafts",
    patchMessage: "Light shafts requires",
    capability: "supportsSpatialLightShafts",
    wireVersion: 14, patchVersion: 15, stateVersion: 17,
    requested: requestsSpatialLightShafts,
    native: supportsSpatialLightShafts,
    buffer: (v: Float32Array) => v.length >= 632 && v[616] === 1,
  },
  {
    label: "Height fog",
    patchMessage: "Height fog requires",
    capability: "supportsSpatialHeightFog",
    wireVersion: 13, patchVersion: 14, stateVersion: 16,
    requested: requestsSpatialHeightFog,
    native: supportsSpatialHeightFog,
    buffer: (v: Float32Array) => v.length >= 616 && v[608] === 1,
  },
  {
    label: "Point PCSS",
    patchMessage: "Point PCSS requires",
    capability: "supportsSpatialPointPcss",
    wireVersion: 12, patchVersion: 13, stateVersion: 15,
    requested: requestsSpatialPointPcss,
    native: supportsSpatialPointPcss,
    buffer: (v: Float32Array) => v.length >= 608 && (v[600] === 1 || v[604] === 1),
  },
  {
    label: "Sun PCSS",
    patchMessage: "Sun PCSS requires",
    capability: "supportsSpatialSunPcss",
    wireVersion: 11, patchVersion: 12, stateVersion: 14,
    requested: requestsSpatialSunPcss,
    native: supportsSpatialSunPcss,
    buffer: (v: Float32Array) => v.length >= 600 && v[592] === 1,
  },
  {
    label: "pointShadows",
    patchMessage: "Point shadows require",
    capability: "supportsSpatialPointShadows",
    wireVersion: 10, patchVersion: 11, stateVersion: 13,
    requested: requestsSpatialPointShadows,
    native: supportsSpatialPointShadows,
    buffer: (v: Float32Array) => v.length >= 592 && v[589] === 1,
  },
  {
    label: "wide Bloom",
    patchMessage: "Wide Bloom requires",
    capability: "supportsSpatialWideBloom",
    wireVersion: 9, patchVersion: 10, stateVersion: 12,
    requested: requestsSpatialWideBloom,
    native: supportsSpatialWideBloom,
    buffer: (v: Float32Array) => v.length >= 584 && v[580] === 1,
  },
  {
    label: "light selection",
    patchMessage: "Light selection requires",
    capability: "supportsSpatialLightSelection",
    wireVersion: 8, patchVersion: 9, stateVersion: undefined,
    requested: requestsSpatialLightSelection,
    native: supportsSpatialLightSelection,
    buffer: hasSpatialSelectionSource,
  },
  {
    label: "light channels",
    patchMessage: "Receiver/light channels require",
    capability: "supportsSpatialLightChannels",
    wireVersion: 7, patchVersion: 8, stateVersion: undefined,
    requested: requestsSpatialLightChannels,
    native: supportsSpatialLightChannels,
    buffer: (v: Float32Array) => v.length >= 576,
  },
] as const;

export type SpatialEnvironmentCapabilities = {
  [Key in typeof features[number]["capability"]]?: () => boolean;
};

export function spatialEnvironmentFeature(spec?: SpatialEnvironmentSpec | null) {
  return features.find(feature => feature.requested(spec));
}

function requested(feature: typeof features[number], spec: SpatialEnvironmentSpec | null | undefined): boolean {
  // All v8+ records carry the v7 channel layout even if masks were omitted in JSON.
  return feature.wireVersion === 7 ? spatialEnvironmentFeature(spec) !== undefined : feature.requested(spec);
}

export function unsupportedSpatialEnvironmentFeature(spec: SpatialEnvironmentSpec | null | undefined, capabilities: SpatialEnvironmentCapabilities): string | undefined {
  for (const feature of features) {
    if (requested(feature, spec) && !capabilities[feature.capability]?.()) return feature.label;
  }
}

export function supportsSpatialEnvironment(engine: unknown, spec?: SpatialEnvironmentSpec | null): boolean {
  return features.every(feature => !requested(feature, spec) || feature.native(engine));
}

/** Compiled, validated source buffers also retain disabled/empty feature declarations. */
export function supportsSpatialEnvironmentBuffer(engine: unknown, values: Float32Array): boolean {
  return features.every(feature => !feature.buffer(values) || feature.native(engine));
}

export function spatialEnvironmentCapabilities(engine: unknown, requireAlive: () => void): SpatialEnvironmentCapabilities {
  // Every key and callback comes from the same closed feature table; no plugin registration.
  return Object.fromEntries(features.map(feature => [feature.capability, () => {
    requireAlive();
    return feature.native(engine);
  }]));
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function snapshotSpatialEnvironment(document: unknown): unknown {
  return record(document) && record(document.spatial) ? document.spatial.environment : undefined;
}

/** Presence-only readers tolerate unknown JSON. Numeric validation remains at restore.
 * Selection history has its separate v11 contract; a selection declaration alone
 * must not change historical snapshot versions/hashes.
 */
export function spatialEnvironmentSnapshotFeature(...environments: unknown[]) {
  for (const feature of features) {
    if (feature.stateVersion === undefined) continue;
    // These seven predicates only inspect optional fields (point PCSS guards arrays).
    // Do not pass this unvalidated view to a compiler or to the channel predicate.
    if (environments.some(value => record(value) && feature.requested(value as SpatialEnvironmentSpec))) return feature;
  }
}
