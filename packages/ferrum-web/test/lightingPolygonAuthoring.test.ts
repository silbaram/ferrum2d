import "./nativeRuntimeTestHelper.js";
import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import { createEngine, captureGameStateSnapshot, restoreGameStateSnapshot, hashGameStateSnapshot } from "../src/core.js";
import { applyDataSceneAuthoringDocument, createSceneInstanceHandleRegistry, createScenePlacementViewer, mergeScenePlacementPatch } from "../src/authoring.js";
import type { FrameState } from "../src/engineTypes.js";

const doc = () => ({ format: "ferrum2d.consumer.scene-authoring" as const, version: 1 as const, behaviorRecipes: { entities: {} },
  lighting: { profile: "lit" as const, enabled: false, polygonOccluders: [{ vertices: [{ x: 10, y: 5 }, { x: 20, y: 10 }, { x: 10, y: 15 }] }], shadows: { enabled: false, projectionLength: 512 } },
  sceneComposition: { initialFragment: "main", prefabs: { object: {} }, fragments: { main: { instances: [{ id: "hero", prefab: "object",
    props: { components: { visual: { kind: "sprite" as const, texture: "floor", width: 16, height: 16, lighting: { mode: "opaque" as const } }, collider: "none" as const, layer: "wall" as const } },
  }] } } },
});

test("polygon OFF source, patch/Undo/Redo and exported copies preserve ordered vertices and invalid edits preserve history", () => {
  const source = doc(), viewer = createScenePlacementViewer({ document: source, viewport: { cssWidth: 128, cssHeight: 96 } });
  viewer.updateLighting({ ...source.lighting, enabled: true });
  const patch = JSON.parse(JSON.stringify(viewer.exportPatch()));
  deepEqual(patch.lighting.polygonOccluders, source.lighting.polygonOccluders);
  const merged = mergeScenePlacementPatch(source, patch).document;
  deepEqual(merged.lighting!.polygonOccluders, source.lighting.polygonOccluders);
  const exposed = viewer.state().lighting!; exposed.polygonOccluders![0].vertices[0].x = 0;
  equal(viewer.state().lighting!.polygonOccluders![0].vertices[0].x, 10);
  const before = JSON.stringify(viewer.state()), history = viewer.historyState();
  throws(() => viewer.updateLighting({ ...source.lighting, polygonOccluders: [{ vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }] }] }), /convex/);
  equal(JSON.stringify(viewer.state()), before); deepEqual(viewer.historyState(), history);
  viewer.undo(); equal(viewer.exportPatch(), undefined); equal(viewer.state().lighting!.enabled, false);
  viewer.redo(); equal(viewer.exportPatch()!.lighting!.enabled, true);
  deepEqual(viewer.exportPatch()!.lighting!.polygonOccluders, source.lighting.polygonOccluders);
});

test("native Playing and JSON fresh-handle restore retain polygon OFF state; unsupported/invalid preflight cannot replace a scene", async () => {
  const previousRaf = globalThis.requestAnimationFrame, previousCancel = globalThis.cancelAnimationFrame;
  let tick: FrameRequestCallback = () => {}, frame: FrameState | undefined, lookups = 0, preparations = 0;
  globalThis.requestAnimationFrame = callback => ((tick = callback), 1); globalThis.cancelAnimationFrame = () => {};
  const engine = await createEngine(value => { frame = value; }), registry = createSceneInstanceHandleRegistry(), source = doc();
  engine.setViewportSize(128, 96);
  const options = { instanceHandleRegistry: registry, textureId: () => { lookups++; return 1; }, flatLightingPreparer: { flatLightingPolygonVersion: () => 1, prepareFlatLighting() { preparations++; } } };
  const capture = () => captureGameStateSnapshot(engine, { includeDataSceneState: true, includeDataSceneProgress: true, dataSceneAuthoringDocument: source });
  try {
    const first = applyDataSceneAuthoringDocument(engine, source, options).entityHandles.hero;
    ok(engine.setDataSceneCamera({ x: 0, y: 0 })); engine.start(); tick(0); tick(1000 / 60);
    equal(frame!.gameState, 1); equal(frame!.renderCommandBuffer.spriteLightingMaterials!.words[0], 1);
    const saved = JSON.parse(JSON.stringify(capture()));
    equal(saved.dataScene.authoringDocument.lighting.enabled, false); equal(saved.dataScene.authoringDocument.lighting.shadows.enabled, false);
    deepEqual(saved.dataScene.authoringDocument.lighting.polygonOccluders, source.lighting.polygonOccluders);
    ok(restoreGameStateSnapshot(engine, saved, { dataSceneAuthoringApplyOptions: options }).dataSceneAuthoringDocumentApplied);
    const fresh = registry.entries().find(row => row.instanceId === "hero")!.handle;
    equal(engine.gameplayEntityExists(first), false); ok(engine.gameplayEntityExists(fresh));
    const before = hashGameStateSnapshot(capture()), calls = preparations, assets = lookups;
    throws(() => applyDataSceneAuthoringDocument(engine, source, { ...options, flatLightingPreparer: { prepareFlatLighting() { throw Error("must not prepare"); } } }), /polygon v1/);
    equal(lookups, assets); equal(preparations, calls); equal(hashGameStateSnapshot(capture()), before);
    const invalid = structuredClone(source); invalid.lighting.polygonOccluders[0].vertices[1] = { x: 10, y: 10 };
    throws(() => applyDataSceneAuthoringDocument(engine, invalid, options), /convex/);
    equal(lookups, assets); equal(preparations, calls); equal(hashGameStateSnapshot(capture()), before); ok(engine.gameplayEntityExists(fresh));
  } finally { engine.destroy(); globalThis.requestAnimationFrame = previousRaf; globalThis.cancelAnimationFrame = previousCancel; }
});
