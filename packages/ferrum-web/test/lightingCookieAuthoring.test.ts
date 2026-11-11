import "./nativeRuntimeTestHelper.js";
import { equal, deepEqual, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import { createEngine, captureGameStateSnapshot, restoreGameStateSnapshot, hashGameStateSnapshot } from "../src/core.js";
import { applyDataSceneAuthoringDocument, createSceneInstanceHandleRegistry } from "../src/authoring.js";
import type { FrameState } from "../src/engineTypes.js";
import type { LightingScene2D } from "../src/lightingTypes.js";

test("cookie cold mapping and fresh-handle restore retain named source, OFF and explicit UV/rotation; preflight rejects before mutation", async () => {
  const previousRaf = globalThis.requestAnimationFrame, previousCancel = globalThis.cancelAnimationFrame;
  let tick: FrameRequestCallback = () => {}, frame: FrameState | undefined, mappedId = 7, lookups = 0;
  const prepared: LightingScene2D[] = [];
  globalThis.requestAnimationFrame = callback => ((tick = callback), 1); globalThis.cancelAnimationFrame = () => {};
  const engine = await createEngine(value => { frame = value; }), registry = createSceneInstanceHandleRegistry();
  engine.setViewportSize(128, 96);
  const options = { instanceHandleRegistry: registry, textureId: (name: string) => { equal(name, "pattern"); lookups++; return mappedId; },
    flatLightingPreparer: { flatLightingCookieVersion: () => 1, prepareFlatLighting(scene: LightingScene2D) { prepared.push(scene); } } };
  const doc = { format: "ferrum2d.consumer.scene-authoring" as const, version: 1 as const, behaviorRecipes: { entities: {} },
    lighting: { profile: "lit" as const, enabled: false, pointLights: [{ x: 0, y: 0, radius: 100, cookie: { texture: "pattern", rotationRadians: 0, uv: [1, 0, 0, 1] } }] },
    sceneComposition: { initialFragment: "main", prefabs: { object: {} }, fragments: { main: { instances: [{ id: "hero", prefab: "object",
      props: { components: { visual: { kind: "sprite" as const, texture: 1, width: 16, height: 16, lighting: { mode: "opaque" as const } }, collider: "none" as const, layer: "wall" as const } },
    }] } } },
  };
  const capture = () => captureGameStateSnapshot(engine, { includeDataSceneState: true, includeDataSceneProgress: true, dataSceneAuthoringDocument: doc });
  try {
    const first = applyDataSceneAuthoringDocument(engine, doc, options).entityHandles.hero;
    equal(prepared[prepared.length - 1].pointLights![0].cookie!.texture, 7);
    ok(engine.setDataSceneCamera({ x: 0, y: 0 })); engine.start(); tick(0); tick(1000 / 60);
    equal(frame!.gameState, 1); equal(frame!.renderCommandBuffer.spriteLightingMaterials!.words[0], 1);
    const saved = JSON.parse(JSON.stringify(capture()));
    equal(saved.dataScene.authoringDocument.lighting.enabled, false);
    deepEqual(saved.dataScene.authoringDocument.lighting.pointLights[0].cookie, doc.lighting.pointLights[0].cookie);
    mappedId = 8;
    ok(restoreGameStateSnapshot(engine, saved, { dataSceneAuthoringApplyOptions: options }).dataSceneAuthoringDocumentApplied);
    equal(prepared[prepared.length - 1].pointLights![0].cookie!.texture, 8);
    const fresh = registry.entries().find(row => row.instanceId === "hero")!.handle;
    equal(engine.gameplayEntityExists(first), false); ok(engine.gameplayEntityExists(fresh));
    const before = hashGameStateSnapshot(capture()), calls = prepared.length, beforeLookup = lookups;
    const unsupported = { ...options, flatLightingPreparer: { prepareFlatLighting() { throw Error("must not prepare"); } } };
    throws(() => applyDataSceneAuthoringDocument(engine, doc, unsupported), /cookie v1/);
    equal(lookups, beforeLookup); equal(prepared.length, calls); equal(hashGameStateSnapshot(capture()), before);
    const invalid = structuredClone(doc); invalid.lighting.pointLights[0].cookie.uv = [0, 0, 0, 1];
    throws(() => applyDataSceneAuthoringDocument(engine, invalid, options), /cookie/);
    equal(lookups, beforeLookup); equal(hashGameStateSnapshot(capture()), before);
    mappedId = NaN;
    throws(() => applyDataSceneAuthoringDocument(engine, doc, options), /texture/);
    equal(prepared.length, calls); equal(hashGameStateSnapshot(capture()), before); ok(engine.gameplayEntityExists(fresh));
  } finally { engine.destroy(); globalThis.requestAnimationFrame = previousRaf; globalThis.cancelAnimationFrame = previousCancel; }
});
