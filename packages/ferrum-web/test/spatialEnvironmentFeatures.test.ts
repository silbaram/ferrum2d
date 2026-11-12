import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import type { Engine } from "../pkg/ferrum_core.js";
import { createSpatialApi } from "../src/dataSceneSpatial.js";
import { resolveSpatialEnvironmentSpec, type SpatialEnvironmentSpec } from "../src/spatialEnvironment.js";
import { spatialEnvironmentCapabilities } from "../src/spatialEnvironmentFeatures.js";
import { attachDataSceneRuntimeEngineAdapter } from "../src/dataSceneRuntimeTarget.js";
import { attachDataSceneProgressAdapter, preflightDataSceneProgressRestore } from "../src/dataSceneProgress.js";
import { validateDataSceneStateSnapshot } from "../src/gameStateSnapshot.js";
import { applySceneSpatialPatch, sceneSpatialPatchVersion } from "../src/sceneSpatialPatch.js";
import type { FerrumEngine } from "../src/engineTypes.js";

const camera = { projection: "orthographic" as const, position: { x: 0, y: -100, elevation: 100 }, target: { x: 0, y: 0, elevation: 0 }, height: 200 };
test("authoring preflight and mutation agree on the channel ABI required by newer environment layouts", () => {
  let mutations = 0;
  const native = { spatial_light_probes_abi_version: () => 1,
    configure_spatial_environment: () => { mutations++; return true; } } as unknown as Engine;
  const api = createSpatialApi(native, () => {}, () => ({ width: 400, height: 300 }));
  const environment = { lighting: { lights: [], probes: [] } };
  // A partial/older adapter must fail before a host can prepare assets or replace the live scene.
  equal(api.setDataSceneSpatialEnvironment(environment), false);
  equal(api.preflightDataSceneSpatialModels({ camera, terrain: [], billboards: {}, environment }), false);
  equal(mutations, 0);
});

// Independent capability fixtures: do not generate expectations from production metadata.
const lights = [{ position: { x: 0, y: 0, elevation: 20 }, radius: 100 }];
const sun = { direction: { x: 0, y: 0, elevation: 1 }, shadows: {} };
const cases: [string, SpatialEnvironmentSpec, string][] = [
  ["channels", { lighting: { lights: [{ ...lights[0], lightMask: 1 }] } }, "spatial_light_channel_abi_version"],
  ["selection", { lighting: { lights, selection: {} } }, "spatial_light_selection_abi_version"],
  ["wide", { composition: "separated", bloom: { mode: "wide" } }, "spatial_wide_bloom_abi_version"],
  ["point shadows", { lighting: { lights, pointShadows: [{ lightIndex: 0 }] } }, "spatial_point_shadows_abi_version"],
  ["sun PCSS", { lighting: { lights, directional: { ...sun, shadows: { pcss: {} } } } }, "spatial_sun_pcss_abi_version"],
  ["point PCSS", { lighting: { lights, shadows: { lightIndex: 0, pcss: {} } } }, "spatial_point_pcss_abi_version"],
  ["height fog", { fog: { start: 0, end: 400, color: [0, 0, 0], height: { density: 0 } } }, "spatial_height_fog_abi_version"],
  ["shafts", { composition: "separated", lighting: { lights, directional: sun }, lightShafts: { intensity: 0 } }, "spatial_light_shafts_abi_version"],
  ["probes", { lighting: { lights, probes: [] } }, "spatial_light_probes_abi_version"],
];
// Selection advertises a complete history/diagnostics extension, not only one getter.
function supportedCapabilities(): Record<string, () => number> {
  return {
    ...Object.fromEntries(cases.map(([, , key]) => [key, () => 1])),
    spatial_light_selection_progress_abi_version: () => 1,
    spatial_light_selection_diagnostic_size_bytes: () => 24,
    ...Object.fromEntries(["spatial_light_selection_diagnostics_ptr", "spatial_light_selection_diagnostics_len",
      "capture_spatial_light_selection_state", "preflight_spatial_light_selection_state", "restore_spatial_light_selection_state",
      "restore_data_scene_progress_with_spatial_light_selection", "reset_spatial_light_selection"].map(key => [key, () => 0])),
  };
}
const document = { format: "ferrum2d.consumer.scene-authoring" as const, version: 1 as const,
  sceneComposition: { prefabs: {}, fragments: { main: { instances: [] } } }, behaviorRecipes: { entities: {} }, spatial: { camera, terrain: [], billboards: {} } };

test("every environment capability and its base layout reject before assets or scene mutation, including OFF sources", () => {
  for (const [name, input, method] of cases) for (const enabled of [false, true]) {
    const environment = { ...input, ...(input.lighting ? { lighting: { ...input.lighting, enabled } } : {}) };
    for (const absent of [method, "spatial_light_channel_abi_version"]) {
      let calls = 0;
      const capabilities = supportedCapabilities();
      delete capabilities[absent];
      const native = { ...capabilities, configure_spatial_environment: () => { calls++; return true; } } as unknown as Engine;
      const api = createSpatialApi(native, () => {}, () => ({ width: 400, height: 300 }), () => { calls++; throw Error("unexpected texture lookup"); });
      const spec = { ...document.spatial, environment, billboards: { hero: { normalTexture: "unloaded" } } };
      equal(api.setDataSceneSpatialEnvironment(environment), false, name);
      equal(api.preflightDataSceneSpatialModels(spec), false, name);
      equal(api.configureDataSceneSpatial(spec, {}), false, name);
      const engine = attachDataSceneRuntimeEngineAdapter({ preflightDataSceneSpatialModels: () => { calls++; return false; } } as unknown as FerrumEngine, {
        ...spatialEnvironmentCapabilities(native, () => {}),
        textureId: () => { calls++; return 0; }, spawnDataSceneEntity: () => { calls++; return undefined; }, useDataScene: () => { calls++; },
      });
      attachDataSceneProgressAdapter(engine, { epoch: () => 1, capture: () => new Uint32Array(), navigation: () => new Float64Array(), obstacles: () => new Uint32Array(), animations: () => new Float64Array(), spatialRevision: () => 1,
        viewport: () => ({ width: 400, height: 300 }), spatial: () => new Float64Array(), preflightLightSelection: () => true, preflightSpatial: () => { calls++; return true; }, restore: () => { calls++; return true; } });
      // Shape-valid uninitialized history; its native preflight is read-only.
      const lightSelection = name === "selection" ? { version: 1 as const, sourceSignature: 0, initialized: false, step: 0,
        anchor: { x: 0, y: 0, elevation: 0 }, slots: Array.from({ length: 4 }, () => ({ sourceIndex: null, pendingSourceIndex: null, weight: 0, phase: "empty" as const })) } : undefined;
      throws(() => preflightDataSceneProgressRestore(engine, {}, { navigation: null, instances: [], spatial: { camera, environment, lightSelection } }, document), /requires native v1 support/);
      equal(calls, 0, name);
    }
    let applied = 0;
    const supported = { ...supportedCapabilities(), configure_spatial_environment: () => { applied++; return true; } } as unknown as Engine;
    const api = createSpatialApi(supported, () => {}, () => ({ width: 400, height: 300 }));
    equal(api.preflightDataSceneSpatialModels({ ...document.spatial, environment }), true, name);
    equal(applied, 0); equal(api.setDataSceneSpatialEnvironment(environment), true, name); equal(applied, 1);
  }
});

test("capability facade preserves native receiver and rejects use after destroy", () => {
  let alive = true;
  const native = { version: 1, spatial_light_probes_abi_version() { return this.version; } };
  const capabilities = spatialEnvironmentCapabilities(native, () => { if (!alive) throw Error("destroyed"); });
  equal(capabilities.supportsSpatialLightProbes!(), true);
  native.version = 2; equal(capabilities.supportsSpatialLightProbes!(), false);
  alive = false;
  for (const capability of Object.values(capabilities)) throws(capability, /destroyed/);
});

test("mixed environment patches and source/progress snapshots keep the highest required version", () => {
  const environments = cases.slice(2).map(([, spec]) => spec);
  const operations = environments.map(environment => ({ kind: "setEnvironment" as const, changes: { environment } }));
  equal(sceneSpatialPatchVersion(operations), 16);
  equal(sceneSpatialPatchVersion([...operations].reverse()), 16);
  const patch = { format: "ferrum2d.scene-spatial.patch" as const, version: 16 as const, operations };
  deepEqual(applySceneSpatialPatch(document.spatial, patch).environment, resolveSpatialEnvironmentSpec(environments[environments.length - 1]));
  throws(() => applySceneSpatialPatch(document.spatial, { ...patch, version: 15 }), /version 16/);
  const scene = { score: 0, gameState: 1, entityCount: 0, spriteCount: 0, cameraX: 0, cameraY: 0 };
  for (const [source, runtime] of [[environments[5], environments[6]], [environments[6], environments[5]]]) {
    const snapshot = { format: "ferrum2d.data-scene-state", version: 18, scene,
      authoringDocument: { ...document, spatial: { ...document.spatial, environment: source } },
      progress: { navigation: null, instances: [], spatial: { camera, environment: runtime } } };
    validateDataSceneStateSnapshot(snapshot);
    throws(() => validateDataSceneStateSnapshot({ ...snapshot, version: 17 }), /version 18/);
  }
});
