import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import { createScenePlacementViewer, createScenePlacementPatchStore, mergeScenePlacementPatch, resolveSceneAuthoringDocument, type SceneAuthoringDocumentSpec } from "../src/authoring.js";
import { resolveSceneLighting } from "../src/sceneLighting.js";

const lighting = { ambient: [0.1, 0.15, 0.2, 0.65] as const,
  pointLights: [{ x: 20, y: 30, radius: 128, intensity: 2 }],
  directionalLight: { directionX: 1, directionY: 1, shadowOpacity: 0.3 },
  shadows: { enabled: false, projectionLength: 250, maxDistance: 400 },
  tileOccluders: [{ x: 50, y: 60, width: 16, height: 32 }] };
function document(): SceneAuthoringDocumentSpec {
  return { format: "ferrum2d.consumer.scene-authoring", version: 1, behaviorRecipes: { entities: {} }, lighting,
    sceneComposition: { initialFragment: "main", prefabs: { item: { props: { components: {
      visual: { kind: "primitive", shape: "rect", width: 16, height: 16 }, collider: "none", layer: "wall" } } } },
    fragments: { main: { instances: [{ id: "item", prefab: "item", x: 10, y: 20 }] } } } };
}

test("authored flat lighting validates disabled settings and retains inactive shadow parameters", () => {
  const off = resolveSceneLighting({ ...lighting, enabled: false });
  equal(off.enabled, false); equal(off.pointLights.length, 1);
  equal(off.shadows.enabled, false); equal(off.shadows.projectionLength, 250); equal(off.shadows.maxDistance, 400);
  deepEqual(resolveSceneLighting({ ...off, enabled: true }), resolveSceneLighting(lighting));
  for (const bad of [false, [], null, { enabled: "true" }, { enabled: false, pointLights: [{ radius: -1 }] },
    { pointLights: Array(33).fill(lighting.pointLights[0]) }, { pointLights: [{ ...lighting.pointLights[0], unexpected: true }] },
    { pointLights: [{ ...lighting.pointLights[0], x: 1e9 }] }, { shadows: { enabled: false, maxDistance: -1 } },
    { debug: { tileOccluders: "true" } }, { directionalLight: { directionX: 0, directionY: 0 } },
    { ambient: [0, 0, 0, NaN] }]) throws(() => resolveSceneLighting(bad), /sceneAuthoring.lighting/);
});

test("flat lighting patch v4 round-trips, counts scene edits and preserves object state and undo", () => {
  const source = document(), baseline = resolveSceneLighting(source.lighting);
  const viewer = createScenePlacementViewer({ document: source, viewport: { cssWidth: 640, cssHeight: 480 }, selectedInstanceId: "item" });
  viewer.setInstancesLocked(["item"], true);
  viewer.updateLighting({ ...baseline, enabled: false });
  const patch = viewer.exportPatch()!;
  equal(patch.version, 4); deepEqual(patch.operations, []); equal(patch.lighting!.enabled, false);
  equal(viewer.historyState().undoCount, 1);
  const merged = mergeScenePlacementPatch(source, JSON.parse(JSON.stringify(patch)));
  equal(merged.operationCount, 1); deepEqual(merged.changedInstanceIds, []);
  deepEqual(merged.document.sceneComposition, source.sceneComposition);
  deepEqual(merged.document.lighting, { ...baseline, enabled: false });
  const store = createScenePlacementPatchStore({ patch }); equal(store.state().operationCount, 1);
  deepEqual(store.exportPatch(), patch);
  const exposed = viewer.state().lighting!;
  exposed.pointLights![0].radius = 1;
  equal(viewer.state().lighting!.pointLights![0].radius, 128, "state must isolate nested light records");
  const exported = store.exportPatch()!;
  exported.lighting!.pointLights![0].radius = 2;
  equal(store.exportPatch()!.lighting!.pointLights![0].radius, 128, "patch store must isolate nested light records");
  throws(() => mergeScenePlacementPatch(source, patch, { allowedFragments: ["main"] }), /document-wide/);
  viewer.undo(); equal(viewer.exportPatch(), undefined); equal(viewer.state().selectedInstanceId, "item");
  viewer.redo(); equal(viewer.state().lighting!.enabled, false);
  viewer.updateLighting({ ...baseline, enabled: true }); equal(viewer.exportPatch(), undefined);
  viewer.updateLighting(null); equal(viewer.exportPatch()!.lighting, null);
  equal(mergeScenePlacementPatch(source, viewer.exportPatch()!).document.lighting, undefined);
  viewer.clearDraftPatch(); equal(viewer.exportPatch(), undefined);
  const reopened = createScenePlacementViewer({ document: merged.document, viewport: { cssWidth: 640, cssHeight: 480 } });
  equal(reopened.exportPatch(), undefined); equal(reopened.state().lighting!.enabled, false);
});

test("invalid light edits and rejected native validation restore draft and history; envelope versions reject partial saves", () => {
  const source = document();
  const viewer = createScenePlacementViewer({ document: source, viewport: { cssWidth: 640, cssHeight: 480 },
    validateDraft(state) { if (state.lighting?.pointLights?.[0].intensity === 3) throw new Error("native rejected"); } });
  const before = viewer.state(), history = viewer.historyState();
  throws(() => viewer.updateLighting({ ...lighting, pointLights: [{ ...lighting.pointLights[0], radius: 0 }] }), /radius/);
  throws(() => viewer.updateLighting({ ...lighting, pointLights: [{ ...lighting.pointLights[0], intensity: 3 }] }), /native rejected/);
  deepEqual(viewer.state(), before); deepEqual(viewer.historyState(), history);
  viewer.updateLighting({ ...lighting, enabled: false }); const patch = viewer.exportPatch()!;
  for (const version of [1, 2, 3] as const)
    throws(() => mergeScenePlacementPatch(source, { ...patch, version }), /version 4/);
  throws(() => mergeScenePlacementPatch(source, { ...patch, lighting: undefined }), /lighting envelope/);
  const spatial = { camera: { projection: "orthographic" as const, position: { x: 0, y: -100, elevation: 100 }, target: { x: 0, y: 0, elevation: 0 }, height: 200 }, terrain: [], billboards: {} };
  throws(() => resolveSceneAuthoringDocument({ ...source, spatial }), /cannot be combined/);
  throws(() => mergeScenePlacementPatch({ ...source, lighting: undefined, spatial }, patch), /cannot be combined/);
  ok(viewer.state().lockedInstanceIds.length === 0);
});
