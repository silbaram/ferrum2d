import './nativeRuntimeTestHelper.js';
import { equal, deepEqual, ok, throws } from 'node:assert/strict';
import { test } from 'node:test';
import { createEngine, captureGameStateSnapshot, restoreGameStateSnapshot, hashGameStateSnapshot } from '../src/core.js';
import { applyDataSceneAuthoringDocument, createSceneInstanceHandleRegistry } from '../src/authoring.js';
import type { FrameState } from '../src/engineTypes.js';

test('native Playing, source JSON and fresh-handle restore preserve disabled cones; invalid cones leave scene untouched', async () => {
  const previousRaf = globalThis.requestAnimationFrame, previousCancel = globalThis.cancelAnimationFrame;
  let tick: FrameRequestCallback = () => {}, frame: FrameState | undefined, preparations = 0;
  globalThis.requestAnimationFrame = callback => ((tick = callback), 1); globalThis.cancelAnimationFrame = () => {};
  const engine = await createEngine(value => { frame = value; }), registry = createSceneInstanceHandleRegistry();
  engine.setViewportSize(128, 96);
  const options = { instanceHandleRegistry: registry, flatLightingPreparer: { prepareFlatLighting() { preparations++; } } };
  const doc = { format: 'ferrum2d.consumer.scene-authoring' as const, version: 1 as const, behaviorRecipes: { entities: {} },
    lighting: { profile: 'lit' as const, enabled: false, pointLights: [{ x: 0, y: 0, radius: 100, spot: { directionX: 3, directionY: 4, angleDegrees: 90, penumbra: 0 } }] },
    sceneComposition: { initialFragment: 'main', prefabs: { object: {} }, fragments: { main: { instances: [{ id: 'hero', prefab: 'object',
      props: { components: { visual: { kind: 'sprite' as const, texture: 1, width: 16, height: 16, lighting: { mode: 'opaque' as const } }, collider: 'none' as const, layer: 'wall' as const } },
    }] } } },
  };
  const capture = () => captureGameStateSnapshot(engine, { includeDataSceneState: true, includeDataSceneProgress: true, dataSceneAuthoringDocument: doc });
  try {
    const first = applyDataSceneAuthoringDocument(engine, doc, options).entityHandles.hero;
    ok(engine.setDataSceneCamera({ x: 0, y: 0 }));
    engine.start(); tick(0); tick(1000 / 60); equal(frame!.gameState, 1);
    equal(frame!.renderCommandBuffer.spriteLightingMaterials!.words[0], 1);
    const saved = JSON.parse(JSON.stringify(capture()));
    equal(saved.dataScene.authoringDocument.lighting.enabled, false);
    deepEqual(saved.dataScene.authoringDocument.lighting.pointLights[0].spot, doc.lighting.pointLights[0].spot);
    ok(restoreGameStateSnapshot(engine, saved, { dataSceneAuthoringApplyOptions: options }).dataSceneAuthoringDocumentApplied);
    const fresh = registry.entries().find(row => row.instanceId === 'hero')!.handle;
    equal(engine.gameplayEntityExists(first), false); ok(engine.gameplayEntityExists(fresh));
    const before = hashGameStateSnapshot(capture()), calls = preparations;
    const invalid = structuredClone(doc); invalid.lighting.pointLights[0].spot.penumbra = 2;
    throws(() => applyDataSceneAuthoringDocument(engine, invalid, options), /spot/);
    equal(preparations, calls); equal(hashGameStateSnapshot(capture()), before); ok(engine.gameplayEntityExists(fresh));
  } finally { engine.destroy(); globalThis.requestAnimationFrame = previousRaf; globalThis.cancelAnimationFrame = previousCancel; }
});
