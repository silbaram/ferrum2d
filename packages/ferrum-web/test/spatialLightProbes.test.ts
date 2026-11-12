import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import type { Engine } from "../pkg/ferrum_core.js";
import { createSpatialApi } from "../src/dataSceneSpatial.js";
import { compileSpatialEnvironment, decodeSpatialEnvironment, resolveSpatialEnvironmentSpec, validSpatialEnvironmentValues, type SpatialEnvironmentSpec } from "../src/spatialEnvironment.js";
import { createScenePlacementViewer, mergeScenePlacementPatch } from "../src/authoring.js";
import { applySceneSpatialPatch, sceneSpatialPatchVersion } from "../src/sceneSpatialPatch.js";
import { validateDataSceneStateSnapshot } from "../src/gameStateSnapshot.js";
import { attachDataSceneProgressAdapter, preflightDataSceneProgressRestore } from "../src/dataSceneProgress.js";
import { attachDataSceneRuntimeEngineAdapter } from "../src/dataSceneRuntimeTarget.js";
import type { FerrumEngine } from "../src/engineTypes.js";

const probe = { position: { x: 12, y: -24, elevation: 30 }, radius: 80, color: [0.2, 0.4, 0.8] as const };
const base: SpatialEnvironmentSpec = { lighting: { lights: [], probes: [probe] } };
const camera = { projection: "orthographic" as const, position: { x: 0, y: -200, elevation: 100 }, target: { x: 0, y: 0, elevation: 0 }, height: 200 };
const document = { format: "ferrum2d.consumer.scene-authoring" as const, version: 1 as const,
  sceneComposition: { prefabs: {}, fragments: { main: { instances: [] } } }, behaviorRecipes: { entities: {} }, spatial: { camera, terrain: [], billboards: {} } };

test("probes v15 roundtrip empty/max/black/disabled sources and preserve older effects", () => {
  for (const probes of [[], [probe], Array.from({ length: 8 }, (_, i) => ({ ...probe, intensity: i / 2 }))]) {
    for (const enabled of [true, false]) for (const composition of ["legacy", "separated"] as const) {
      const environment = { composition, lighting: { ...base.lighting!, enabled, probes } };
      const v = compileSpatialEnvironment(environment);
      equal(v.length, 700); ok(validSpatialEnvironmentValues(v)); equal(v[632], 1); equal(v[633], probes.length);
      deepEqual(compileSpatialEnvironment(decodeSpatialEnvironment(v)), v);
      if (probes.length) deepEqual([...v.subarray(636, 640)], [12, 30, 24, 80]);
    }
  }
  const v = compileSpatialEnvironment({ ...base, composition: "separated", lighting: { ...base.lighting!,
    hemisphere: {}, directional: { direction: { x: 0, y: 0, elevation: 1 }, shadows: { pcss: {} } } },
    lightShafts: {}, fog: { start: 0, end: 400, color: [0, 0, 0], height: {} }, bloom: { mode: "wide" } });
  ok(validSpatialEnvironmentValues(v)); deepEqual(compileSpatialEnvironment(decodeSpatialEnvironment(v)), v);
  equal(v[592], 1); equal(v[608], 1); equal(v[616], 1); equal(v[580], 1);
  equal(compileSpatialEnvironment({ lighting: { lights: [] } }).length, 80);
});

test("probe authoring rejects sparse, malformed, unsupported and out-of-range data", () => {
  for (const probes of [null, {}, true, Array(1), Array(9).fill(probe), [null], [{ ...probe, radius: 0 }],
    [{ ...probe, radius: 10001 }], [{ ...probe, intensity: -1 }], [{ ...probe, intensity: 4.01 }],
    [{ ...probe, position: { x: Infinity, y: 0, elevation: 0 } }], [{ ...probe, position: { x: 0, y: 0 } }],
    [{ ...probe, color: [1, , 1] }], [{ ...probe, color: [1, 1, 2] }], [{ ...probe, shadowMask: 0 }]])
    throws(() => resolveSpatialEnvironmentSpec({ lighting: { lights: [], probes } }), /probes/);
  const v = compileSpatialEnvironment(base);
  for (const [at, value] of [[632, 0], [632, 2], [633, -1], [633, 1.5], [633, 9], [633, 0], [634, 1], [635, 1],
    [636, NaN], [637, 1e7], [639, .09], [639, 10001], [640, -1], [642, 2], [643, 5], [644, 1], [699, 1]]) {
    const bad = v.slice(); bad[at] = value; equal(validSpatialEnvironmentValues(bad), false, `accepted ${at}=${value}`);
  }
});

test("probes patch16/state18 preserve Undo/Redo and reject hidden source/progress downgrades", () => {
  const environment = base, op = { kind: "setEnvironment" as const, changes: { environment } };
  equal(sceneSpatialPatchVersion([op]), 16);
  throws(() => applySceneSpatialPatch(document.spatial, { format: "ferrum2d.scene-spatial.patch", version: 15, operations: [op] }), /version 16/);
  const viewer = createScenePlacementViewer({ document, viewport: { cssWidth: 400, cssHeight: 300 } });
  viewer.updateSpatial([op]); const patch = viewer.exportPatch(); if (!patch) throw Error("Missing patch"); equal(patch.spatial!.version, 16);
  deepEqual(mergeScenePlacementPatch(document, patch).document.spatial!.environment!.lighting!.probes![0].position, probe.position);
  viewer.undo(); equal(viewer.state().spatial!.environment, undefined); viewer.redo(); equal(viewer.state().spatial!.environment!.lighting!.probes!.length, 1);
  const snapshot = { format: "ferrum2d.data-scene-state", version: 18, authoringDocument: { ...document, spatial: { ...document.spatial, environment } }, scene: { score: 0, gameState: 1, entityCount: 0, spriteCount: 0, cameraX: 0, cameraY: 0 } };
  validateDataSceneStateSnapshot(snapshot); throws(() => validateDataSceneStateSnapshot({ ...snapshot, version: 17 }), /version 18/);
  const progressOnly = { ...snapshot, authoringDocument: document, progress: { navigation: null, instances: [], spatial: { camera, environment } } };
  validateDataSceneStateSnapshot(progressOnly); throws(() => validateDataSceneStateSnapshot({ ...progressOnly, version: 17 }), /version 18/);
});

test("cores without probe support reject even empty/dark/OFF sources before assets or mutation", () => {
  let calls = 0;
  const native = { spatial_light_channel_abi_version: () => 1, configure_spatial_environment: () => { calls++; return true; } } as unknown as Engine;
  const api = createSpatialApi(native, () => {}, () => ({ width: 400, height: 300 }), () => { calls++; throw Error("unexpected asset lookup"); });
  const engine = attachDataSceneRuntimeEngineAdapter({ preflightDataSceneSpatialModels: () => { calls++; return false; } } as unknown as FerrumEngine, {
    supportsSpatialLightProbes: () => false, textureId: () => { calls++; return 0; }, spawnDataSceneEntity: () => { calls++; return undefined; }, useDataScene: () => { calls++; },
  });
  attachDataSceneProgressAdapter(engine, { epoch: () => 1, capture: () => new Uint32Array(), navigation: () => new Float64Array(), obstacles: () => new Uint32Array(), animations: () => new Float64Array(), spatialRevision: () => 1,
    viewport: () => ({ width: 400, height: 300 }), spatial: () => new Float64Array(), preflightSpatial: () => true, restore: () => { calls++; return true; } });
  for (const probes of [[], [{ ...probe, intensity: 0 }], [probe]]) for (const enabled of [false, true]) {
    const environment = { lighting: { lights: [], probes, enabled } }, scene = { ...document.spatial, environment, billboards: { hero: { normalTexture: "unloaded" } } };
    equal(api.setDataSceneSpatialEnvironment(environment), false); equal(api.configureDataSceneSpatial(scene, {}), false); equal(api.preflightDataSceneSpatialModels(scene), false);
    throws(() => preflightDataSceneProgressRestore(engine, {}, { navigation: null, instances: [], spatial: { camera, environment } }, document), /Light probes requires native/);
  }
  equal(calls, 0);
});
