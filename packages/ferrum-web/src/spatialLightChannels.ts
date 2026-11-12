import type { SpatialEnvironmentSpec } from "./spatialEnvironment.js";
import { isLightingChannelMask } from "./lightingMasks.js";
import { sceneCompositionDiagnosticError } from "./diagnostics.js";

type Channels = { lightMask?: number; shadowMask?: number };
export function requestsSpatialMaskPair(value?: Channels): boolean {
  return value?.lightMask !== undefined || value?.shadowMask !== undefined;
}
export function resolveSpatialMaskFields(value: Record<string, unknown>, path: string): Channels {
  const result: Channels = {};
  for (const key of ["lightMask", "shadowMask"] as const) {
    if (value[key] === undefined) continue;
    if (!isLightingChannelMask(value[key])) throw sceneCompositionDiagnosticError(`${path}.${key}`, "must be an integer in 0..255");
    result[key] = value[key];
  }
  return result;
}
export function requestsSpatialLightChannels(spec?: SpatialEnvironmentSpec | null): boolean {
  return requestsSpatialMaskPair(spec?.lighting?.directional) || !!spec?.lighting?.lights.some(requestsSpatialMaskPair);
}
export function supportsSpatialLightChannels(engine: unknown): boolean {
  const e = engine as { spatial_light_channel_abi_version?: () => number };
  return !!e && typeof e.spatial_light_channel_abi_version === "function" && e.spatial_light_channel_abi_version() === 1;
}
function packed(value?: Channels): number {
  return (value?.lightMask ?? 255) | (value?.shadowMask ?? 255) << 8;
}
function pair(value: number): Channels { return { lightMask: value & 255, shadowMask: value >>> 8 }; }

export function validSpatialLightChannels(v: Float32Array): boolean {
  return v.subarray(544, 565).every(n => Number.isInteger(n) && n >= 0 && n <= 65535)
    && v.subarray(565).every(n => n === 0)
    && v.subarray(545 + v[1], 549).every(n => n === 0)
    && v.subarray(549 + v[137], 565).every(n => n === 0);
}
export function compileSpatialLightChannels(spec: SpatialEnvironmentSpec, v: Float32Array): void {
  v[544] = packed(spec.lighting?.directional);
  const count = v[137], source = spec.lighting?.lights ?? [];
  for (let i = 0; i < count; i++) v[549 + i] = packed(source[i]);
  const indices = Array.from({ length: count }, (_, i) => i);
  if (v[138] >= 0) indices.unshift(...indices.splice(v[138], 1));
  const second = spec.lighting?.pointShadows?.[1];
  if (second) indices.splice(1, 0, ...indices.splice(indices.indexOf(second.lightIndex), 1));
  for (let slot = 0; slot < v[1]; slot++) v[545 + slot] = v[549 + indices[slot]];
}
export function decodeSpatialLightChannels(v: Float32Array, spec: SpatialEnvironmentSpec): void {
  if (!spec.lighting) return;
  if (spec.lighting.directional) Object.assign(spec.lighting.directional, pair(v[544]));
  spec.lighting.lights = spec.lighting.lights.map((light, i) => ({ ...light, ...pair(v[549 + i]) }));
}
