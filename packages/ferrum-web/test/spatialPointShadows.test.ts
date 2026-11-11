import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import type { Engine } from "../pkg/ferrum_core.js";
import { createSpatialApi } from "../src/dataSceneSpatial.js";
import { compileSpatialEnvironment, decodeSpatialEnvironment, resolveSpatialEnvironmentSpec, validSpatialEnvironmentValues, type SpatialEnvironmentSpec } from "../src/spatialEnvironment.js";
import { supportsSpatialPointShadows } from "../src/spatialPointShadows.js";
import { hasSpatialSelectionSource } from "../src/spatialBloom.js";
import { spatialBloomPlan } from "../src/spatialBloomKernel.js";
import { createScenePlacementViewer, mergeScenePlacementPatch } from "../src/authoring.js";
import { applySceneSpatialPatch, sceneSpatialPatchVersion } from "../src/sceneSpatialPatch.js";
import { validateDataSceneStateSnapshot } from "../src/gameStateSnapshot.js";
import { attachDataSceneProgressAdapter, preflightDataSceneProgressRestore } from "../src/dataSceneProgress.js";
import { attachDataSceneRuntimeEngineAdapter } from "../src/dataSceneRuntimeTarget.js";
import type { FerrumEngine } from "../src/engineTypes.js";

const lights = [0, 1, 2].map(i => ({ position: { x: i * 40 - 40, y: 0, elevation: 64 }, radius: 200,
  color: [Number(i === 2), Number(i === 1), Number(i === 0)] as [number, number, number], lightMask: 1 << i, shadowMask: 1 << i }));
const shadows = [{ lightIndex: 2, resolution: 128 as const, bias: 0.05 }, { lightIndex: 0, resolution: 256 as const, bias: 0.2, normalBias: 0.1 }];
const camera = { projection: "orthographic" as const, position: { x: 0, y: -200, elevation: 100 }, target: { x: 0, y: 0, elevation: 0 }, height: 200 };

test("pointShadows v10 keeps ordered owners, channels and OFF source with independent wide/policy presence", () => {
  for (const enabled of [false, true]) for (const count of [1, 2]) for (const wide of [false, true])
    for (const selection of [undefined, {}, { enabled: false, hysteresis: 0, fadeSeconds: 0, resetDistance: 0 }]) {
      const spec: SpatialEnvironmentSpec = { composition: "separated", ...(wide ? { bloom: { mode: "wide", radius: 64 } } : {}),
        lighting: { enabled, lights, pointShadows: shadows.slice(0, count), ...(selection ? { selection } : {}) } };
      const v = compileSpatialEnvironment(spec);
      equal(v.length, 592); ok(validSpatialEnvironmentValues(v));
      deepEqual([...v.subarray(565, 576)], new Array(11).fill(0));
      equal(v[138], 2); equal(v[584], count === 2 ? 0 : -1); equal(v[588], enabled && count === 2 ? 1 : -1);
      equal(hasSpatialSelectionSource(v), selection !== undefined);
      if (enabled) {
        equal(v[12], 40); equal(v[545], 4 | 4 << 8);
        equal(v[24], -40); equal(v[546], 1 | 1 << 8);
      }
      deepEqual(compileSpatialEnvironment(decodeSpatialEnvironment(v)), v);
      equal(decodeSpatialEnvironment(v)!.lighting!.pointShadows!.length, count);
      equal(decodeSpatialEnvironment(v)!.lighting!.shadows, undefined);
      if (wide) ok(spatialBloomPlan(v, 128, 128, 128));
    }
  equal(supportsSpatialPointShadows({ spatial_point_shadows_abi_version: () => 1 }), true);
  equal(supportsSpatialPointShadows({}), false);
});

test("pointShadows rejects ambiguous, duplicate, sparse, over-budget and corrupt numeric input", () => {
  for (const pointShadows of [[], [shadows[0], shadows[0]], [...shadows, { lightIndex: 1 }], Array(1), null,
    [{ lightIndex: 3 }], [{ lightIndex: 0.5 }], [{ lightIndex: 0, resolution: 64 }], [{ lightIndex: 0, bias: NaN }],
    [{ lightIndex: 0, normalBias: -Number.MIN_VALUE }], [{ lightIndex: 0, unexpected: true }]])
    throws(() => resolveSpatialEnvironmentSpec({ lighting: { lights, pointShadows } }), /pointShadows/);
  throws(() => resolveSpatialEnvironmentSpec({ lighting: { lights, pointShadows: shadows, shadows: shadows[0] } }), /combined/);
  throws(() => resolveSpatialEnvironmentSpec({ lighting: { lights, maxActiveLights: 1, pointShadows: shadows } }), /maxActiveLights/);
  const v = compileSpatialEnvironment({ lighting: { lights, pointShadows: shadows } });
  for (const [at, value] of [[584, 2], [584, 3], [584, 0.5], [585, 64], [586, -1], [587, 11], [588, 0], [589, 0], [590, 1], [591, NaN], [136, 1], [580, 2]]) {
    const bad = v.slice(); bad[at] = value; equal(validSpatialEnvironmentValues(bad), false, `accepted ${at}=${value}`);
  }
  const missingSlot = v.slice(); missingSlot[1] = 1; missingSlot.fill(0, 24, 60); missingSlot.fill(0, 546, 549);
  equal(validSpatialEnvironmentValues(missingSlot), false, "second shadow requires a second emitted light");
});

test("pointShadows patch11 supports Undo/Redo and rejects patch/state downgrade", () => {
  const scene = { camera, terrain: [], billboards: {} };
  const environment = { lighting: { lights, pointShadows: shadows } };
  const operation = { kind: "setEnvironment" as const, changes: { environment } };
  equal(sceneSpatialPatchVersion([operation]), 11);
  throws(() => applySceneSpatialPatch(scene, { format: "ferrum2d.scene-spatial.patch", version: 10, operations: [operation] }), /version 11/);
  equal(applySceneSpatialPatch(scene, { format: "ferrum2d.scene-spatial.patch", version: 11, operations: [operation] }).environment!.lighting!.pointShadows!.length, 2);
  const document = { format: "ferrum2d.consumer.scene-authoring" as const, version: 1 as const,
    sceneComposition: { prefabs: {}, fragments: { main: { instances: [] } } }, behaviorRecipes: { entities: {} }, spatial: scene };
  const viewer = createScenePlacementViewer({ document, viewport: { cssWidth: 400, cssHeight: 300 } });
  viewer.updateSpatial([operation]); const patch = JSON.parse(JSON.stringify(viewer.exportPatch()));
  equal(patch.spatial.version, 11);
  equal(mergeScenePlacementPatch(document, patch).document.spatial!.environment!.lighting!.pointShadows!.length, 2);
  viewer.undo(); equal(viewer.state().spatial!.environment, undefined);
  viewer.redo(); equal(viewer.state().spatial!.environment!.lighting!.pointShadows![1].lightIndex, 0);
  const snapshot = { format: "ferrum2d.data-scene-state", version: 13, authoringDocument: { ...document, spatial: { ...scene, environment } },
    scene: { score: 0, gameState: 1, entityCount: 0, spriteCount: 0, cameraX: 0, cameraY: 0 } };
  validateDataSceneStateSnapshot(snapshot);
  throws(() => validateDataSceneStateSnapshot({ ...snapshot, version: 12 }), /version 13/);
});

test("old cores reject pointShadows including OFF before native mutation and asset lookup", () => {
  let calls = 0;
  const native = { spatial_light_channel_abi_version: () => 1, configure_spatial_environment: () => { calls++; return true; } } as unknown as Engine;
  const api = createSpatialApi(native, () => {}, () => ({ width: 400, height: 300 }), () => { calls++; throw Error("unexpected asset lookup"); });
  for (const enabled of [false, true]) {
    const environment = { lighting: { enabled, lights, pointShadows: shadows } };
    equal(api.setDataSceneSpatialEnvironment(environment), false);
    const scene = { camera, terrain: [], billboards: { hero: { normalTexture: "unloaded" } }, environment };
    equal(api.configureDataSceneSpatial(scene, {}), false); equal(api.preflightDataSceneSpatialModels(scene), false);
  }
  equal(calls, 0);
});
test("progress-only pointShadows rejects old cores before authored model lookup even when OFF", () => {
  let modelLookups = 0, mutations = 0;
  const engine = attachDataSceneRuntimeEngineAdapter({
    preflightDataSceneSpatialModels: () => { modelLookups++; return false; },
  } as unknown as FerrumEngine, {
    supportsSpatialPointShadows: () => false,
    textureId: () => { throw Error("unexpected texture lookup"); },
    spawnDataSceneEntity: () => { mutations++; return undefined; }, useDataScene: () => { mutations++; },
  });
  attachDataSceneProgressAdapter(engine, {
    epoch: () => 1, capture: () => new Uint32Array(), navigation: () => new Float64Array(),
    obstacles: () => new Uint32Array(), animations: () => new Float64Array(), spatialRevision: () => 1,
    viewport: () => ({ width: 400, height: 300 }), spatial: () => new Float64Array(), preflightSpatial: () => true,
    restore: () => { mutations++; return true; },
  });
  const document = { format: "ferrum2d.consumer.scene-authoring", version: 1,
    sceneComposition: { prefabs: { tree: { props: { components: { visual: { kind: "sprite", texture: 0, width: 8, height: 8 }, collider: "none", layer: "wall" } } } },
      fragments: { main: { instances: [{ id: "tree", prefab: "tree", x: 0, y: 0 }] } } },
    behaviorRecipes: { entities: {} }, spatial: { camera, terrain: [], billboards: {}, models: { tree: { asset: "unloaded", contentId: "a".repeat(64) } } } };
  for (const enabled of [false, true]) {
    const progress = { navigation: null, instances: [{ id: "tree", removed: false, interactionConsumed: false, spatialPose: { x: 0, y: 0, heightSpan: null } }],
      spatial: { camera, environment: { lighting: { enabled, lights, pointShadows: shadows } } } };
    throws(() => preflightDataSceneProgressRestore(engine, {}, progress, document), /pointShadows requires native/);
  }
  equal(modelLookups, 0); equal(mutations, 0);
});
