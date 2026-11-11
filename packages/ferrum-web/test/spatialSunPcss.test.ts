import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import type { Engine } from "../pkg/ferrum_core.js";
import { createSpatialApi } from "../src/dataSceneSpatial.js";
import { compileSpatialEnvironment, decodeSpatialEnvironment, resolveSpatialEnvironmentSpec, validSpatialEnvironmentValues, type SpatialEnvironmentSpec } from "../src/spatialEnvironment.js";
import { spatialSunPcssScale, supportsSpatialSunPcss } from "../src/spatialSunPcss.js";
import { secondSpatialShadowSlot } from "../src/spatialPointShadows.js";
import { spatialSeparated } from "../src/spatialComposition.js";
import { hasSpatialSelectionSource } from "../src/spatialBloom.js";
import { createScenePlacementViewer, mergeScenePlacementPatch } from "../src/authoring.js";
import { applySceneSpatialPatch, sceneSpatialPatchVersion } from "../src/sceneSpatialPatch.js";
import { validateDataSceneStateSnapshot } from "../src/gameStateSnapshot.js";
import { attachDataSceneProgressAdapter, preflightDataSceneProgressRestore } from "../src/dataSceneProgress.js";
import { attachDataSceneRuntimeEngineAdapter } from "../src/dataSceneRuntimeTarget.js";
import type { FerrumEngine } from "../src/engineTypes.js";

const directional = { direction: { x: 0, y: 0, elevation: 1 }, shadows: { resolution: 512 as const, distance: 300, extent: 100, pcss: {} } };
const camera = { projection: "orthographic" as const, position: { x: 0, y: -200, elevation: 100 }, target: { x: 0, y: 0, elevation: 0 }, height: 200 };
const environment: SpatialEnvironmentSpec = { lighting: { lights: [], directional } };
const document = { format: "ferrum2d.consumer.scene-authoring" as const, version: 1 as const,
  sceneComposition: { prefabs: {}, fragments: { main: { instances: [] } } }, behaviorRecipes: { entities: {} },
  spatial: { camera, terrain: [], billboards: {} } };

test("sun PCSS v11 roundtrips OFF, zero angle, legacy/dual point owners, selection and wide bloom independently", () => {
  for (const enabled of [false, true]) for (const point of [0, 1, 2]) for (const wide of [false, true])
    for (const selection of [undefined, {}, { enabled: false, hysteresis: 0, fadeSeconds: 0, resetDistance: 0 }]) {
      const spec: SpatialEnvironmentSpec = { composition: "separated", ...(wide ? { bloom: { mode: "wide", radius: 64 } } : {}),
        lighting: { enabled, directional, shadowFilter: "pcf3", ...(selection ? { selection } : {}),
          lights: [0, 1].map(i => ({ position: { x: i * 30, y: 0, elevation: 80 }, radius: 200 })),
          ...(point === 1 ? { shadows: { lightIndex: 1 } } : point === 2 ? { pointShadows: [{ lightIndex: 1 }, { lightIndex: 0 }] } : {}) } };
      const v = compileSpatialEnvironment(spec);
      equal(v.length, 600); ok(validSpatialEnvironmentValues(v)); ok(spatialSeparated(v));
      equal(secondSpatialShadowSlot(v), enabled && point === 2 ? 1 : -1);
      equal(hasSpatialSelectionSource(v), selection !== undefined);
      deepEqual([...v.subarray(592)], [1, .5, 16, 0, 0, 0, 0, 0]);
      deepEqual(compileSpatialEnvironment(decodeSpatialEnvironment(v)), v);
      equal(decodeSpatialEnvironment(v)!.lighting!.pointShadows !== undefined, point === 2);
    }
  const zero = compileSpatialEnvironment({ lighting: { lights: [], directional: { ...directional, shadows: { ...directional.shadows, pcss: { angularRadius: 0, maxRadiusTexels: 32 } } } } });
  equal(spatialSunPcssScale(zero), 0); ok(validSpatialEnvironmentValues(zero));
  ok(Math.abs(spatialSunPcssScale(compileSpatialEnvironment(environment)) - Math.tan(.5 * Math.PI / 180) * 300 * 512 / 100) < 1e-6);
  ok(supportsSpatialSunPcss({ spatial_sun_pcss_abi_version: () => 1 })); equal(supportsSpatialSunPcss({}), false);
});

test("sun PCSS rejects invalid options, corrupt tails, and global point-filter PCSS", () => {
  for (const pcss of [null, [], true, { angularRadius: NaN }, { angularRadius: Infinity }, { angularRadius: -Number.MIN_VALUE },
    { angularRadius: 5.01 }, { maxRadiusTexels: .9 }, { maxRadiusTexels: 32.01 }, { samples: 64 }])
    throws(() => resolveSpatialEnvironmentSpec({ lighting: { lights: [], directional: { ...directional, shadows: { pcss } } } }), /pcss/);
  throws(() => resolveSpatialEnvironmentSpec({ lighting: { lights: [], shadowFilter: "pcss" } }), /shadowFilter/);
  const v = compileSpatialEnvironment(environment);
  for (const [at, value] of [[592, 2], [592, 0], [593, -1], [593, 6], [594, 0], [594, 33], [595, 1], [599, NaN], [584, 1], [588, -1], [92, 0]]) {
    const bad = v.slice(); bad[at] = value; equal(validSpatialEnvironmentValues(bad), false, `accepted ${at}=${value}`);
  }
});

test("sun PCSS patch12 supports Undo/Redo and protects state14 from downgrade", () => {
  const op = { kind: "setEnvironment" as const, changes: { environment } };
  equal(sceneSpatialPatchVersion([op]), 12);
  throws(() => applySceneSpatialPatch(document.spatial, { format: "ferrum2d.scene-spatial.patch", version: 11, operations: [op] }), /version 12/);
  const viewer = createScenePlacementViewer({ document, viewport: { cssWidth: 400, cssHeight: 300 } });
  viewer.updateSpatial([op]); const patch = JSON.parse(JSON.stringify(viewer.exportPatch())); equal(patch.spatial.version, 12);
  equal(mergeScenePlacementPatch(document, patch).document.spatial!.environment!.lighting!.directional!.shadows!.pcss!.angularRadius, .5);
  viewer.undo(); equal(viewer.state().spatial!.environment, undefined);
  viewer.redo(); equal(viewer.state().spatial!.environment!.lighting!.directional!.shadows!.pcss!.maxRadiusTexels, 16);
  const snapshot = { format: "ferrum2d.data-scene-state", version: 14,
    authoringDocument: { ...document, spatial: { ...document.spatial, environment } },
    scene: { score: 0, gameState: 1, entityCount: 0, spriteCount: 0, cameraX: 0, cameraY: 0 } };
  validateDataSceneStateSnapshot(snapshot);
  throws(() => validateDataSceneStateSnapshot({ ...snapshot, version: 13 }), /version 14/);
});

test("old cores reject sun PCSS before native mutation and asset lookup, including OFF", () => {
  let calls = 0;
  const native = { spatial_light_channel_abi_version: () => 1, configure_spatial_environment: () => { calls++; return true; } } as unknown as Engine;
  const api = createSpatialApi(native, () => {}, () => ({ width: 400, height: 300 }), () => { calls++; throw Error("unexpected asset lookup"); });
  for (const enabled of [false, true]) {
    const env = { lighting: { ...environment.lighting!, enabled } };
    equal(api.setDataSceneSpatialEnvironment(env), false);
    const scene = { ...document.spatial, billboards: { hero: { normalTexture: "unloaded" } }, environment: env };
    equal(api.configureDataSceneSpatial(scene, {}), false); equal(api.preflightDataSceneSpatialModels(scene), false);
  }
  equal(calls, 0);
});

test("progress-only PCSS rejects old cores before models/assets, including OFF", () => {
  let modelLookups = 0, mutations = 0;
  const engine = attachDataSceneRuntimeEngineAdapter({ preflightDataSceneSpatialModels: () => { modelLookups++; return false; } } as unknown as FerrumEngine, {
    supportsSpatialSunPcss: () => false, textureId: () => { throw Error("unexpected texture lookup"); },
    spawnDataSceneEntity: () => { mutations++; return undefined; }, useDataScene: () => { mutations++; },
  });
  attachDataSceneProgressAdapter(engine, {
    epoch: () => 1, capture: () => new Uint32Array(), navigation: () => new Float64Array(),
    obstacles: () => new Uint32Array(), animations: () => new Float64Array(), spatialRevision: () => 1,
    viewport: () => ({ width: 400, height: 300 }), spatial: () => new Float64Array(), preflightSpatial: () => true,
    restore: () => { mutations++; return true; },
  });
  for (const enabled of [false, true]) {
    const progress = { navigation: null, instances: [], spatial: { camera, environment: { lighting: { ...environment.lighting!, enabled } } } };
    throws(() => preflightDataSceneProgressRestore(engine, {}, progress, document), /Sun PCSS requires native/);
  }
  equal(modelLookups, 0); equal(mutations, 0);
});
