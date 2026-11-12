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

const fog = { color: [.1, .2, .3] as const, start: 10, end: 400, height: {} };
const lights = [0, 1].map(x => ({ position: { x, y: 0, elevation: 80 }, radius: 300 }));
const camera = { projection: "orthographic" as const, position: { x: 0, y: -200, elevation: 100 }, target: { x: 0, y: 0, elevation: 0 }, height: 200 };
const document = { format: "ferrum2d.consumer.scene-authoring" as const, version: 1 as const,
  sceneComposition: { prefabs: {}, fragments: { main: { instances: [] } } }, behaviorRecipes: { entities: {} },
  spatial: { camera, terrain: [], billboards: {} } };

test("height fog v13 roundtrips independently of lighting, owner PCSS, selection and wide Bloom", () => {
  for (const enabled of [false, true]) for (const composition of ["legacy", "separated"] as const)
    for (const selection of [undefined, {}, { enabled: false }]) for (const pcss of [false, true]) {
      const spec: SpatialEnvironmentSpec = { composition, fog, ...(composition === "separated" ? { bloom: { mode: "wide" } } : {}),
        lighting: { enabled, lights, selection, pointShadows: [{ lightIndex: 1, ...(pcss ? { pcss: {} } : {}) }, { lightIndex: 0, ...(pcss ? { pcss: { sourceRadius: 8 } } : {}) }],
          directional: { direction: { x: 0, y: 0, elevation: 1 }, shadows: { pcss: {} } } } };
      const v = compileSpatialEnvironment(spec); equal(v.length, 616); ok(validSpatialEnvironmentValues(v));
      deepEqual(compileSpatialEnvironment(decodeSpatialEnvironment(v)), v);
      deepEqual([...v.subarray(608)], [1, 0, Math.fround(.01), Math.fround(.02), 0, 0, 0, 0]);
      equal(v[600], Number(pcss)); equal(v[604], Number(pcss)); equal(v[592], 1);
    }
  const only = compileSpatialEnvironment({ fog }); ok(validSpatialEnvironmentValues(only));
  equal(only[0], 2); equal(only[589], 0); equal(only[600], 0); equal(only[592], 0);
  deepEqual(compileSpatialEnvironment(decodeSpatialEnvironment(only)), only);
  equal(compileSpatialEnvironment({ fog: { color: fog.color, start: 10, end: 400 } }).length, 80);
});

test("height fog validates authoring bounds and reserved native tail", () => {
  for (const height of [null, [], true, { baseHeight: Infinity }, { baseHeight: 1000001 }, { density: NaN },
    { density: -Number.MIN_VALUE }, { density: 10.01 }, { falloff: -1 }, { falloff: 11 }, { steps: 8 }])
    throws(() => resolveSpatialEnvironmentSpec({ fog: { ...fog, height } }), /height/);
  for (const baseHeight of [-1e6, 0, 1e6]) for (const density of [0, 1e-8, 10]) for (const falloff of [0, 1e-8, 10])
    ok(validSpatialEnvironmentValues(compileSpatialEnvironment({ fog: { ...fog, height: { baseHeight, density, falloff } } })));
  const v = compileSpatialEnvironment({ fog });
  for (const [at, value] of [[608, 2], [608, 0], [609, 1000001], [610, -1], [610, 11], [611, 11], [612, 1], [615, 1]]) {
    const bad = v.slice(); bad[at] = value; equal(validSpatialEnvironmentValues(bad), false);
  }
  const noFog = v.slice(); noFog[0] &= ~2; equal(validSpatialEnvironmentValues(noFog), false);
});

test("height fog patch14 Undo/Redo and authored/progress state16 prevent downgrade", () => {
  const environment = { fog }, op = { kind: "setEnvironment" as const, changes: { environment } };
  equal(sceneSpatialPatchVersion([op]), 14);
  throws(() => applySceneSpatialPatch(document.spatial, { format: "ferrum2d.scene-spatial.patch", version: 13, operations: [op] }), /version 14/);
  const viewer = createScenePlacementViewer({ document, viewport: { cssWidth: 400, cssHeight: 300 } });
  viewer.updateSpatial([op]); const patch = JSON.parse(JSON.stringify(viewer.exportPatch())); equal(patch.spatial.version, 14);
  equal(mergeScenePlacementPatch(document, patch).document.spatial!.environment!.fog!.height!.density, .01);
  viewer.undo(); equal(viewer.state().spatial!.environment, undefined); viewer.redo();
  equal(viewer.state().spatial!.environment!.fog!.height!.falloff, .02);
  const snapshot = { format: "ferrum2d.data-scene-state", version: 16,
    authoringDocument: { ...document, spatial: { ...document.spatial, environment } },
    scene: { score: 0, gameState: 1, entityCount: 0, spriteCount: 0, cameraX: 0, cameraY: 0 } };
  validateDataSceneStateSnapshot(snapshot);
  throws(() => validateDataSceneStateSnapshot({ ...snapshot, version: 15 }), /version 16/);
  const progressOnly = { ...snapshot, authoringDocument: document,
    progress: { navigation: null, instances: [], spatial: { camera, environment } } };
  validateDataSceneStateSnapshot(progressOnly);
  throws(() => validateDataSceneStateSnapshot({ ...progressOnly, version: 15 }), /version 16/);
});

test("old cores reject even density-zero height fog before asset lookup or native mutation", () => {
  let calls = 0;
  const native = { spatial_light_channel_abi_version: () => 1, configure_spatial_environment: () => { calls++; return true; } } as unknown as Engine;
  const api = createSpatialApi(native, () => {}, () => ({ width: 400, height: 300 }), () => { calls++; throw Error("unexpected asset lookup"); });
  for (const density of [0, .01]) {
    const environment = { fog: { ...fog, height: { density } } };
    equal(api.setDataSceneSpatialEnvironment(environment), false);
    const scene = { ...document.spatial, billboards: { hero: { normalTexture: "unloaded" } }, environment };
    equal(api.configureDataSceneSpatial(scene, {}), false); equal(api.preflightDataSceneSpatialModels(scene), false);
  }
  equal(calls, 0);
});

test("progress-only height fog rejects old cores before model preparation", () => {
  let calls = 0;
  const engine = attachDataSceneRuntimeEngineAdapter({ preflightDataSceneSpatialModels: () => { calls++; return false; } } as unknown as FerrumEngine, {
    supportsSpatialHeightFog: () => false, textureId: () => { calls++; return 0; },
    spawnDataSceneEntity: () => { calls++; return undefined; }, useDataScene: () => { calls++; },
  });
  attachDataSceneProgressAdapter(engine, {
    epoch: () => 1, capture: () => new Uint32Array(), navigation: () => new Float64Array(),
    obstacles: () => new Uint32Array(), animations: () => new Float64Array(), spatialRevision: () => 1,
    viewport: () => ({ width: 400, height: 300 }), spatial: () => new Float64Array(), preflightSpatial: () => true, restore: () => { calls++; return true; },
  });
  for (const density of [0, .01]) {
    const progress = { navigation: null, instances: [], spatial: { camera, environment: { fog: { ...fog, height: { density } } } } };
    throws(() => preflightDataSceneProgressRestore(engine, {}, progress, document), /Height fog requires native/);
  }
  equal(calls, 0);
});
