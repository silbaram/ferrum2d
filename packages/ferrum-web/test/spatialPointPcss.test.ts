import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import type { Engine } from "../pkg/ferrum_core.js";
import { createSpatialApi, resolveDataSceneSpatialSpec } from "../src/dataSceneSpatial.js";
import { compileSpatialEnvironment, decodeSpatialEnvironment, resolveSpatialEnvironmentSpec, validSpatialEnvironmentValues, type SpatialEnvironmentSpec } from "../src/spatialEnvironment.js";
import { supportsSpatialPointPcss } from "../src/spatialPointPcss.js";
import { secondSpatialShadowSlot } from "../src/spatialPointShadows.js";
import { createScenePlacementViewer, mergeScenePlacementPatch } from "../src/authoring.js";
import { applySceneSpatialPatch, sceneSpatialPatchVersion } from "../src/sceneSpatialPatch.js";
import { validateDataSceneStateSnapshot } from "../src/gameStateSnapshot.js";
import { attachDataSceneProgressAdapter, preflightDataSceneProgressRestore } from "../src/dataSceneProgress.js";
import { attachDataSceneRuntimeEngineAdapter, preflightDataSceneSpatialEnvironment } from "../src/dataSceneRuntimeTarget.js";
import type { FerrumEngine } from "../src/engineTypes.js";

const lights = [0, 1].map(x => ({ position: { x: x * 20, y: 0, elevation: 100 }, radius: 300 }));
const camera = { projection: "orthographic" as const, position: { x: 0, y: -200, elevation: 100 }, target: { x: 0, y: 0, elevation: 0 }, height: 200 };
const environment: SpatialEnvironmentSpec = { lighting: { lights, pointShadows: [{ lightIndex: 1, pcss: {} }, { lightIndex: 0, pcss: { sourceRadius: 8, maxRadiusTexels: 32 } }] } };
const document = { format: "ferrum2d.consumer.scene-authoring" as const, version: 1 as const,
  sceneComposition: { prefabs: {}, fragments: { main: { instances: [] } } }, behaviorRecipes: { entities: {} },
  spatial: { camera, terrain: [], billboards: {} } };

test("point PCSS v12 preserves independent owners, legacy spelling, OFF, sun PCSS and selection/Bloom", () => {
  for (const enabled of [false, true]) for (const shape of ["legacy", "single", "first", "second", "both"])
    for (const sun of [false, true]) for (const wide of [false, true]) for (const selection of [undefined, {}, { enabled: false }]) {
      const first = { lightIndex: 1, ...(shape !== "second" ? { pcss: { sourceRadius: 0, maxRadiusTexels: 1.5 } } : {}) };
      const spec: SpatialEnvironmentSpec = { composition: "separated", ...(wide ? { bloom: { mode: "wide", radius: 64 } } : {}),
        lighting: { enabled, lights, selection, shadowFilter: "pcf3",
          ...(shape === "legacy" ? { shadows: first } : { pointShadows: [first, ...(["first", "second", "both"].includes(shape) ? [{ lightIndex: 0, ...(shape !== "first" ? { pcss: {} } : {}) }] : [])] }),
          ...(sun ? { directional: { direction: { x: 0, y: 0, elevation: 1 }, shadows: { pcss: {} } } } : {}) } };
      const v = compileSpatialEnvironment(spec); equal(v.length, 608); ok(validSpatialEnvironmentValues(v));
      deepEqual(compileSpatialEnvironment(decodeSpatialEnvironment(v)), v);
      equal(v[600], shape === "second" ? 0 : 1); equal(v[604], ["second", "both"].includes(shape) ? 1 : 0);
      equal(v[592], Number(sun)); equal(v[583], Number(selection !== undefined));
      equal(secondSpatialShadowSlot(v), enabled && ["first", "second", "both"].includes(shape) ? 1 : -1);
    }
  ok(supportsSpatialPointPcss({ spatial_point_pcss_abi_version: () => 1 })); equal(supportsSpatialPointPcss({}), false);
});

test("point PCSS rejects invalid authoring and corrupt owner records", () => {
  for (const pcss of [null, [], true, { sourceRadius: NaN }, { sourceRadius: Infinity }, { sourceRadius: -Number.MIN_VALUE },
    { sourceRadius: 1001 }, { maxRadiusTexels: .9 }, { maxRadiusTexels: 32.01 }, { samples: 64 }]) {
    for (const key of ["shadows", "pointShadows"])
      throws(() => resolveSpatialEnvironmentSpec({ lighting: { lights, [key]: key === "shadows" ? { lightIndex: 0, pcss } : [{ lightIndex: 0, pcss }] } }), /pcss/);
  }
  const v = compileSpatialEnvironment(environment);
  for (const [at, value] of [[600, 2], [600, 0], [601, -1], [601, 1001], [602, 0], [602, 33], [603, 1], [604, 2], [605, NaN], [606, 0], [607, 1]]) {
    const bad = v.slice(); bad[at] = value; equal(validSpatialEnvironmentValues(bad), false, `accepted ${at}=${value}`);
  }
  const single = compileSpatialEnvironment({ lighting: { lights, shadows: { lightIndex: 1, pcss: {} } } });
  single.set([1, 1, 16, 0], 604); equal(validSpatialEnvironmentValues(single), false, "phantom second owner");
});

test("point PCSS patch13 supports Undo/Redo and prevents state15 downgrade", () => {
  const op = { kind: "setEnvironment" as const, changes: { environment } };
  equal(sceneSpatialPatchVersion([op]), 13);
  throws(() => applySceneSpatialPatch(document.spatial, { format: "ferrum2d.scene-spatial.patch", version: 12, operations: [op] }), /version 13/);
  const viewer = createScenePlacementViewer({ document, viewport: { cssWidth: 400, cssHeight: 300 } });
  viewer.updateSpatial([op]); const patch = JSON.parse(JSON.stringify(viewer.exportPatch())); equal(patch.spatial.version, 13);
  equal(mergeScenePlacementPatch(document, patch).document.spatial!.environment!.lighting!.pointShadows![1].pcss!.sourceRadius, 8);
  viewer.undo(); equal(viewer.state().spatial!.environment, undefined); viewer.redo();
  equal(viewer.state().spatial!.environment!.lighting!.pointShadows![0].pcss!.sourceRadius, 1);
  const snapshot = { format: "ferrum2d.data-scene-state", version: 15,
    authoringDocument: { ...document, spatial: { ...document.spatial, environment } },
    scene: { score: 0, gameState: 1, entityCount: 0, spriteCount: 0, cameraX: 0, cameraY: 0 } };
  validateDataSceneStateSnapshot(snapshot);
  throws(() => validateDataSceneStateSnapshot({ ...snapshot, version: 14 }), /version 15/);
  const progressOnly = { ...snapshot, authoringDocument: document,
    progress: { navigation: null, instances: [], spatial: { camera, environment } } };
  validateDataSceneStateSnapshot(progressOnly);
  throws(() => validateDataSceneStateSnapshot({ ...progressOnly, version: 14 }), /version 15/);
});

test("old cores reject point PCSS before asset lookup or native mutation, including OFF and legacy owners", () => {
  let calls = 0;
  const native = { spatial_light_channel_abi_version: () => 1, spatial_point_shadows_abi_version: () => 1, spatial_sun_pcss_abi_version: () => 1,
    configure_spatial_environment: () => { calls++; return true; } } as unknown as Engine;
  const api = createSpatialApi(native, () => {}, () => ({ width: 400, height: 300 }), () => { calls++; throw Error("unexpected asset lookup"); });
  for (const enabled of [false, true]) for (const owner of [{ pointShadows: environment.lighting!.pointShadows }, { shadows: { lightIndex: 0, pcss: {} } }]) {
    const env = { lighting: { lights, enabled, ...owner } };
    equal(api.setDataSceneSpatialEnvironment(env), false);
    const scene = { ...document.spatial, billboards: { hero: { normalTexture: "unloaded" } }, environment: env };
    equal(api.configureDataSceneSpatial(scene, {}), false); equal(api.preflightDataSceneSpatialModels(scene), false);
  }
  equal(calls, 0);
});

test("progress-only point PCSS rejects old cores before model and texture preparation", () => {
  let modelLookups = 0, mutations = 0;
  const engine = attachDataSceneRuntimeEngineAdapter({ preflightDataSceneSpatialModels: () => { modelLookups++; return false; } } as unknown as FerrumEngine, {
    supportsSpatialPointPcss: () => false, textureId: () => { throw Error("unexpected texture lookup"); },
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
    throws(() => preflightDataSceneProgressRestore(engine, {}, progress, document), /Point PCSS requires native/);
  }
  equal(modelLookups, 0); equal(mutations, 0);
});

test("point shadow arrays enforce the authored billboard budget with and without PCSS", () => {
  const billboards = Object.fromEntries(Array.from({ length: 1025 }, (_, i) => [`b${i}`, {}]));
  for (const pcss of [undefined, {}]) for (const count of [1, 2]) {
    const environment = { lighting: { lights, pointShadows: lights.slice(0, count).map((_, lightIndex) => ({ lightIndex, pcss })) } };
    throws(() => resolveDataSceneSpatialSpec({ ...document.spatial, billboards, environment }), /at most 1024 authored billboards/);
  }
});

test("point shadow arrays preflight terrain batch budgets before texture lookup or mutation", () => {
  let calls = 0;
  const engine = attachDataSceneRuntimeEngineAdapter({} as FerrumEngine, {
    supportsSpatialLightChannels: () => true, supportsSpatialPointPcss: () => true, supportsSpatialPointShadows: () => true, preflightSpatialEnvironment: () => true,
    textureId: () => { calls++; return 0; }, spawnDataSceneEntity: () => { calls++; return undefined; }, useDataScene: () => { calls++; },
  });
  const terrain = Array.from({ length: 65 }, (_, i) => ({ id: `t${i}`, x: i * 2, y: 0, width: 1, depth: 1, elevation: 0, textureId: i % 2 }));
  for (const pcss of [undefined, {}]) {
    const env = { lighting: { lights, pointShadows: [{ lightIndex: 0, pcss }] } };
    const spec = resolveDataSceneSpatialSpec({ ...document.spatial, terrain, environment: env });
    throws(() => preflightDataSceneSpatialEnvironment(engine, spec, [], {}, env), /batch budget exceeds 64/);
  }
  equal(calls, 0);
});
