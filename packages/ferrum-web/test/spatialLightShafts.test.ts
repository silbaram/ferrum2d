import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import type { Engine } from "../pkg/ferrum_core.js";
import { createSpatialApi } from "../src/dataSceneSpatial.js";
import { compileSpatialEnvironment, decodeSpatialEnvironment, resolveSpatialEnvironmentSpec, validSpatialEnvironmentValues, type SpatialEnvironmentSpec } from "../src/spatialEnvironment.js";
import { spatialLightShaftPlan, writeLightShaftUniforms } from "../src/spatialLightShaftKernel.js";
import type { SpatialRenderBufferView } from "../src/dataSceneSpatial.js";
import { spatialLightShaftsActive } from "../src/spatialLightShafts.js";
import { createScenePlacementViewer, mergeScenePlacementPatch } from "../src/authoring.js";
import { applySceneSpatialPatch, sceneSpatialPatchVersion } from "../src/sceneSpatialPatch.js";
import { validateDataSceneStateSnapshot } from "../src/gameStateSnapshot.js";
import { attachDataSceneProgressAdapter, preflightDataSceneProgressRestore } from "../src/dataSceneProgress.js";
import { attachDataSceneRuntimeEngineAdapter } from "../src/dataSceneRuntimeTarget.js";
import type { FerrumEngine } from "../src/engineTypes.js";

const base: SpatialEnvironmentSpec = { composition: "separated", lighting: { lights: [], directional: { direction: { x: 1, y: 1, elevation: 2 }, shadows: {} } } };
const camera = { projection: "orthographic" as const, position: { x: 0, y: -200, elevation: 100 }, target: { x: 0, y: 0, elevation: 0 }, height: 200 };
const document = { format: "ferrum2d.consumer.scene-authoring" as const, version: 1 as const,
  sceneComposition: { prefabs: {}, fragments: { main: { instances: [] } } }, behaviorRecipes: { entities: {} }, spatial: { camera, terrain: [], billboards: {} } };

test("shaft phase normalizes all valid native sun direction magnitudes", () => {
  const values = compileSpatialEnvironment({ ...base, lightShafts: { anisotropy: .8 } });
  values.set([0, 0, -.25], 84); ok(validSpatialEnvironmentValues(values));
  const c = new Float32Array(28); c.set([1, 0, 0, 0, 0, 0, -1, 1, .1, 800, 160, 90], 16);
  const uniforms = new Float32Array(52);
  writeLightShaftUniforms(uniforms, { camera: c, environment: { values, shadowMatrices: new Float32Array(16) } } as SpatialRenderBufferView,
    spatialLightShaftPlan(values, 160, 90)!, 160, 90);
  deepEqual([...uniforms.subarray(32, 35)], [0, 0, -1]);
});

test("light shafts v14 preserves source across quality, lighting OFF, height fog and wide Bloom", () => {
  for (const quality of ["low", "balanced", "high"] as const) for (const enabled of [false, true]) for (const density of [0, 1]) {
    const spec = { ...base, lighting: { ...base.lighting!, enabled }, lightShafts: { quality, density, anisotropy: .9 },
      fog: { color: [.1, .2, .3] as const, start: 0, end: 400, height: {} }, bloom: { mode: "wide" as const } };
    const v = compileSpatialEnvironment(spec); equal(v.length, 632); ok(validSpatialEnvironmentValues(v));
    deepEqual(compileSpatialEnvironment(decodeSpatialEnvironment(v)), v);
    equal(spatialLightShaftsActive(v), enabled && density > 0); equal(v[608], 1); equal(v[580], 1);
    equal(v[625], quality === "low" ? 16 : quality === "high" ? 48 : 32);
  }
  equal(compileSpatialEnvironment(base).length, 544);
});

test("light shafts authoring dependencies and native bounds are strict", () => {
  for (const lightShafts of [null, [], true, { color: [1, , 1] }, { color: [1, 2, 1] }, { intensity: -1 }, { intensity: 5 },
    { density: NaN }, { density: 1.01 }, { maxDistance: .09 }, { maxDistance: Infinity }, { anisotropy: .91 }, { quality: "ultra" }, { samples: 64 }])
    throws(() => resolveSpatialEnvironmentSpec({ ...base, lightShafts }), /lightShafts/);
  for (const spec of [{ lightShafts: {} }, { ...base, composition: "legacy", lightShafts: {} }, { ...base, lighting: { lights: [] }, lightShafts: {} }])
    throws(() => resolveSpatialEnvironmentSpec(spec), /requires separated/);
  const v = compileSpatialEnvironment({ ...base, lightShafts: {} });
  for (const [at, value] of [[616, 0], [616, 2], [617, 5], [618, -1], [619, 0], [620, 2], [623, 1], [624, 3], [625, 64], [626, 1], [631, 1], [528, 0]]) {
    const bad = v.slice(); bad[at] = value; equal(validSpatialEnvironmentValues(bad), false, `${at}`);
  }
});

test("light shafts costs include the optional full-size resolve and disabled path is free", () => {
  for (const quality of ["low", "balanced", "high"] as const) {
    const v = compileSpatialEnvironment({ ...base, lightShafts: { quality } });
    const plan = spatialLightShaftPlan(v, 161, 91)!; equal(plan.width, Math.ceil(161 / v[624])); equal(plan.height, Math.ceil(91 / v[624]));
    equal(plan.drawCalls, 2); equal(plan.textureBytes, plan.width * plan.height * 8 + 161 * 91 * 8);
    equal(plan.fetchBudget, plan.width * plan.height * (v[625] + 1) + 161 * 91 * 6);
    const ao = compileSpatialEnvironment({ ...base, lightShafts: { quality }, ambientOcclusion: {} });
    equal(spatialLightShaftPlan(ao, 161, 91)!.drawCalls, 1);
    for (const at of [617, 618, 87]) { const off = v.slice(); off[at] = 0; equal(spatialLightShaftPlan(off, 161, 91), undefined); }
  }
});

test("light shafts patch15 and state17 preserve Undo/Redo and reject hidden downgrades", () => {
  const environment = { ...base, lightShafts: {} }, op = { kind: "setEnvironment" as const, changes: { environment } };
  equal(sceneSpatialPatchVersion([op]), 15);
  throws(() => applySceneSpatialPatch(document.spatial, { format: "ferrum2d.scene-spatial.patch", version: 14, operations: [op] }), /version 15/);
  const viewer = createScenePlacementViewer({ document, viewport: { cssWidth: 400, cssHeight: 300 } });
  viewer.updateSpatial([op]); const patch = viewer.exportPatch(); if (!patch) throw Error("Missing patch"); equal(patch.spatial!.version, 15);
  equal(mergeScenePlacementPatch(document, patch).document.spatial!.environment!.lightShafts!.density, .01);
  viewer.undo(); equal(viewer.state().spatial!.environment, undefined); viewer.redo(); equal(viewer.state().spatial!.environment!.lightShafts!.quality, "balanced");
  const snapshot = { format: "ferrum2d.data-scene-state", version: 17, authoringDocument: { ...document, spatial: { ...document.spatial, environment } }, scene: { score: 0, gameState: 1, entityCount: 0, spriteCount: 0, cameraX: 0, cameraY: 0 } };
  validateDataSceneStateSnapshot(snapshot); throws(() => validateDataSceneStateSnapshot({ ...snapshot, version: 16 }), /version 17/);
  const progressOnly = { ...snapshot, authoringDocument: document, progress: { navigation: null, instances: [], spatial: { camera, environment } } };
  validateDataSceneStateSnapshot(progressOnly); throws(() => validateDataSceneStateSnapshot({ ...progressOnly, version: 16 }), /version 17/);
});

test("old cores reject zero-intensity shafts before assets and progress preparation", () => {
  let calls = 0;
  const native = { spatial_light_channel_abi_version: () => 1, configure_spatial_environment: () => { calls++; return true; } } as unknown as Engine;
  const api = createSpatialApi(native, () => {}, () => ({ width: 400, height: 300 }), () => { calls++; throw Error("unexpected asset lookup"); });
  const engine = attachDataSceneRuntimeEngineAdapter({ preflightDataSceneSpatialModels: () => { calls++; return false; } } as unknown as FerrumEngine, {
    supportsSpatialLightShafts: () => false, textureId: () => { calls++; return 0; }, spawnDataSceneEntity: () => { calls++; return undefined; }, useDataScene: () => { calls++; },
  });
  attachDataSceneProgressAdapter(engine, { epoch: () => 1, capture: () => new Uint32Array(), navigation: () => new Float64Array(), obstacles: () => new Uint32Array(), animations: () => new Float64Array(), spatialRevision: () => 1,
    viewport: () => ({ width: 400, height: 300 }), spatial: () => new Float64Array(), preflightSpatial: () => true, restore: () => { calls++; return true; } });
  for (const intensity of [0, .5]) {
    const environment = { ...base, lightShafts: { intensity } }, scene = { ...document.spatial, environment, billboards: { hero: { normalTexture: "unloaded" } } };
    equal(api.setDataSceneSpatialEnvironment(environment), false); equal(api.configureDataSceneSpatial(scene, {}), false); equal(api.preflightDataSceneSpatialModels(scene), false);
    throws(() => preflightDataSceneProgressRestore(engine, {}, { navigation: null, instances: [], spatial: { camera, environment } }, document), /Light shafts requires native/);
  }
  equal(calls, 0);
});
