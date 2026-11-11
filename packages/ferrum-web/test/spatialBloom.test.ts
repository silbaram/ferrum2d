import type { Engine } from "../pkg/ferrum_core.js";
import { createSpatialApi } from "../src/dataSceneSpatial.js";
import { createScenePlacementViewer, mergeScenePlacementPatch } from "../src/authoring.js";
import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import type { SpatialEnvironmentSpec } from "../src/core.js";
import { compileSpatialEnvironment, decodeSpatialEnvironment, resolveSpatialEnvironmentSpec, validSpatialEnvironmentValues } from "../src/spatialEnvironment.js";
import { hasSpatialSelectionSource, supportsSpatialWideBloom } from "../src/spatialBloom.js";
import { spatialBloomPlan, spatialBloomFetchBudget } from "../src/spatialBloomKernel.js";
import { applySceneSpatialPatch, sceneSpatialPatchVersion } from "../src/sceneSpatialPatch.js";
import { attachDataSceneProgressAdapter, preflightDataSceneProgressRestore } from "../src/dataSceneProgress.js";
import { attachDataSceneRuntimeEngineAdapter } from "../src/dataSceneRuntimeTarget.js";
import type { FerrumEngine } from "../src/engineTypes.js";

test("wide Bloom v9 preserves explicit policy absence, disabled settings, and legacy reserved words", () => {
  for (const quality of ["low", "balanced", "high"] as const) for (const selection of [undefined, {}, { enabled: false, hysteresis: 0, fadeSeconds: 0, resetDistance: 0 }]) {
    const spec: SpatialEnvironmentSpec = { composition: "separated", bloom: { mode: "wide", quality, radius: 64, strength: 0 }, lighting: { enabled: false, lights: [], ...(selection ? { selection } : {}) } };
    const v = compileSpatialEnvironment(spec); equal(v.length, 584); ok(validSpatialEnvironmentValues(v));
    equal(v[583], selection ? 1 : 0); equal(hasSpatialSelectionSource(v), !!selection);
    equal(decodeSpatialEnvironment(v)!.bloom!.quality, quality);
    deepEqual(compileSpatialEnvironment(decodeSpatialEnvironment(v)), v);
    deepEqual([...v.subarray(565, 576)], new Array(11).fill(0));
    for (const [index, value] of [[580, 0], [581, 3], [582, 2], [583, 2], [528, 0], [130, 97], [583, NaN]]) {
      const bad = v.slice(); bad[index] = value; equal(validSpatialEnvironmentValues(bad), false);
    }
  }
  equal(compileSpatialEnvironment({ bloom: { radius: 24 } }).length, 512);
  for (const bloom of [{ radius: 25 }, { mode: "wide", radius: 97 }, { mode: "wide", quality: "other" }, { quality: "low" }, { mode: null }])
    throws(() => resolveSpatialEnvironmentSpec({ composition: "separated", bloom }), /bloom/i);
  throws(() => resolveSpatialEnvironmentSpec({ bloom: { mode: "wide" } }), /separated/);
  equal(supportsSpatialWideBloom({ spatial_wide_bloom_abi_version: () => 1 }), true);
  equal(supportsSpatialWideBloom({}), false);
});

test("wide Bloom patch10 preserves the opt-in and rejects downgrade before applying", () => {
  const scene = { camera: { projection: "orthographic" as const, position: { x: 0, y: -200, elevation: 100 }, target: { x: 0, y: 0, elevation: 0 }, height: 200 }, terrain: [], billboards: {} };
  const operation = { kind: "setEnvironment" as const, changes: { environment: { composition: "separated" as const, bloom: { mode: "wide" as const } } } };
  equal(sceneSpatialPatchVersion([operation]), 10);
  for (const version of [6, 8, 9] as const) throws(() => applySceneSpatialPatch(scene, { format: "ferrum2d.scene-spatial.patch", version, operations: [operation] }), /version 10/);
  equal(applySceneSpatialPatch(scene, { format: "ferrum2d.scene-spatial.patch", version: 10, operations: [operation] }).environment!.bloom!.mode, "wide");
  const document = { format: "ferrum2d.consumer.scene-authoring" as const, version: 1 as const,
    sceneComposition: { prefabs: {}, fragments: { main: { instances: [] } } }, behaviorRecipes: { entities: {} }, spatial: scene };
  const viewer = createScenePlacementViewer({ document, viewport: { cssWidth: 400, cssHeight: 300 } });
  viewer.updateSpatial([operation]);
  const patch = JSON.parse(JSON.stringify(viewer.exportPatch())); equal(patch.spatial.version, 10);
  equal(mergeScenePlacementPatch(document, patch).document.spatial!.environment!.bloom!.mode, "wide");
  viewer.undo(); equal(viewer.state().spatial!.environment, undefined);
  viewer.redo(); equal(viewer.state().spatial!.environment!.bloom!.radius, 48);
});

test("wide halo uses a bounded prefilter chain instead of undersampling a large blur stride", () => {
  for (const quality of ["low", "balanced", "high"] as const) {
    const v = compileSpatialEnvironment({ composition: "separated", bloom: { mode: "wide", radius: 64, quality } });
    const p = spatialBloomPlan(v, 128, 128, 128)!;
    ok(p.step <= 1); ok(p.drawCalls <= 16); equal(p.drawCalls, p.levels.length + 2);
    equal(p.textureBytes, 8 * (p.levels.reduce((sum, size) => sum + size.width * size.height, 0) + p.width * p.height));
    ok(spatialBloomFetchBudget(p, 128, 128) < 32 * 128 * 128);
    equal(spatialBloomFetchBudget(p, 256, 256) - spatialBloomFetchBudget(p, 128, 128), 4 * (256 * 256 - 128 * 128));
    v[129] = 0; equal(spatialBloomPlan(v, 128, 128, 128), undefined);
  }
});


test("odd targets keep the source pixel grid rather than stretching ceil-padded chain levels", () => {
  const v = compileSpatialEnvironment({ composition: "separated", bloom: { mode: "wide", radius: 64 } });
  const p = spatialBloomPlan(v, 127, 95, 95)!;
  equal(p.width, 8); equal(p.sampleWidth, 127 / 16); equal(p.sampleHeight, 95 / 16);
});


test("old cores reject wide source including OFF before native mutation or asset lookup", () => {
  let calls = 0;
  const native = { spatial_light_channel_abi_version: () => 1, configure_spatial_environment: () => { calls++; return true; } } as unknown as Engine;
  const api = createSpatialApi(native, () => {}, () => ({ width: 400, height: 300 }), () => { calls++; throw Error("unexpected asset lookup"); });
  for (const strength of [0, 1]) {
    const environment = { composition: "separated" as const, bloom: { mode: "wide" as const, strength } };
    equal(api.setDataSceneSpatialEnvironment(environment), false);
    const scene = { camera: { projection: "orthographic" as const, position: { x: 0, y: -200, elevation: 100 }, target: { x: 0, y: 0, elevation: 0 }, height: 200 },
      terrain: [], billboards: { hero: { normalTexture: "unloaded" } }, environment };
    equal(api.configureDataSceneSpatial(scene, {}), false); equal(api.preflightDataSceneSpatialModels(scene), false);
  }
  equal(calls, 0);
});

test("progress-only wide source rejects old cores before authored model resource lookup", () => {
  let modelLookups = 0, mutations = 0;
  const engine = attachDataSceneRuntimeEngineAdapter({
    preflightDataSceneSpatialModels: () => { modelLookups++; return false; },
  } as unknown as FerrumEngine, {
    supportsSpatialWideBloom: () => false,
    textureId: () => { throw Error("unexpected texture lookup"); },
    spawnDataSceneEntity: () => { mutations++; return undefined; },
    useDataScene: () => { mutations++; },
  });
  attachDataSceneProgressAdapter(engine, {
    epoch: () => 1, capture: () => new Uint32Array(), navigation: () => new Float64Array(),
    obstacles: () => new Uint32Array(), animations: () => new Float64Array(),
    spatialRevision: () => 1, viewport: () => ({ width: 400, height: 300 }),
    spatial: () => new Float64Array(), preflightSpatial: () => true,
    restore: () => { mutations++; return true; },
  });
  const camera = { projection: "orthographic" as const, position: { x: 0, y: -200, elevation: 100 }, target: { x: 0, y: 0, elevation: 0 }, height: 200 };
  const document = { format: "ferrum2d.consumer.scene-authoring", version: 1,
    sceneComposition: { prefabs: { tree: { props: { components: { visual: { kind: "sprite", texture: 0, width: 8, height: 8 }, collider: "none", layer: "wall" } } } },
      fragments: { main: { instances: [{ id: "tree", prefab: "tree", x: 0, y: 0 }] } } },
    behaviorRecipes: { entities: {} }, spatial: { camera, terrain: [], billboards: {},
      models: { tree: { asset: "unloaded", contentId: "a".repeat(64) } }, environment: { composition: "separated", bloom: { strength: 0 } } } };
  for (const strength of [0, 1]) {
    const progress = { navigation: null, instances: [{ id: "tree", removed: false, interactionConsumed: false, spatialPose: { x: 0, y: 0, heightSpan: null } }],
      spatial: { camera, environment: { composition: "separated" as const, bloom: { mode: "wide" as const, strength } } } };
    throws(() => preflightDataSceneProgressRestore(engine, {}, progress, document), /wide Bloom requires native/);
  }
  equal(modelLookups, 0); equal(mutations, 0);
});
