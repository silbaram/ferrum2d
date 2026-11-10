import './nativeRuntimeTestHelper.js';
import { test } from 'node:test';
import { equal, deepEqual, ok, throws } from 'node:assert/strict';
import { createEngine, captureGameStateSnapshot, restoreGameStateSnapshot, hashGameStateSnapshot } from '../src/core.js';
import { applyDataSceneAuthoringDocument, createSceneInstanceHandleRegistry, createScenePlacementViewer, mergeScenePlacementPatch } from '../src/authoring.js';
import { createSpatialModelAsset } from '../src/spatialModel.js';
import { attachDataSceneRuntimeEngineAdapter } from '../src/dataSceneRuntimeTarget.js';
import { applySceneSpatialPatch } from '../src/sceneSpatialPatch.js';
import type { FrameState } from '../src/engineTypes.js';

const camera = { projection: 'orthographic' as const, position: { x: 0, y: -200, elevation: 100 }, target: { x: 0, y: 0, elevation: 16 }, height: 200 };
function document() {
  return { format: 'ferrum2d.consumer.scene-authoring' as const, version: 1 as const,
    sceneComposition: { initialFragment: 'main', prefabs: { object: {} }, fragments: { main: { instances: ['hero', 'rock'].map((id, i) => ({ id, prefab: 'object', x: i * 20, y: 0,
      props: { components: { visual: { kind: 'sprite' as const, texture: 1, width: 16, height: 32 }, collider: 'none' as const, layer: 'wall' as const } } })) } } },
    behaviorRecipes: { entities: {} }, spatial: { camera,
      terrain: [{ id: 'ground', x: -64, y: -64, width: 128, depth: 128, elevation: 0, lightMask: 0, shadowMask: 3 }],
      billboards: { hero: { lightMask: 0, shadowMask: 3 } },
      models: { rock: { asset: 'model', contentId: 'a'.repeat(64), lightMask: 2, shadowMask: 0 } },
      environment: { composition: 'separated' as const, lighting: { enabled: false, ambient: [0, 0, 0] as const,
        directional: { direction: { x: 0, y: 0, elevation: 1 }, lightMask: 0, shadowMask: 1 },
        lights: [{ position: { x: 0, y: 0, elevation: 64 }, radius: 500, lightMask: 1, shadowMask: 0 }] } },
    } };
}
const preparer = { prepareSpatialModels: () => ({ uploadBytes: 0, commit() {}, dispose() {} }) };
async function engineAndOptions(callback?: (frame: FrameState) => void) {
  const engine = await createEngine(callback), registry = createSceneInstanceHandleRegistry();
  const asset = createSpatialModelAsset({ contentId: 'a'.repeat(64), bounds: [0, 0, 0, 1, 1, 1], diagnostics: [], images: [], primitives: [{
    vertices: new Float32Array(24), indices: new Uint32Array([0, 1, 2]), color: [1, 1, 1, 1], alphaCutoff: 0, doubleSided: false,
    emissiveFactor: [0, 0, 0], sampler: [9728, 9728, 10497, 10497],
  }] });
  ok(engine.registerDataSceneSpatialModel('model', asset)); engine.setViewportSize(400, 300);
  return { engine, registry, options: { instanceHandleRegistry: registry, spatialModelPreparer: preparer } };
}

test('Spatial receiver/light patches use v8, preserve zero and undo/redo, and older patch versions reject them', () => {
  const doc = document(), viewer = createScenePlacementViewer({ document: doc, viewport: { cssWidth: 400, cssHeight: 300 } });
  viewer.updateSpatial([
    { kind: 'updateTerrainSurface', id: 'ground', changes: { lightMask: 1, shadowMask: 0 } },
    { kind: 'updateBillboard', id: 'hero', changes: { shadowMask: 0 } },
    { kind: 'updateModel', id: 'rock', changes: { shadowMask: 3 } },
  ]);
  const patch = viewer.exportPatch()!; equal(patch.spatial!.version, 8);
  const merged = mergeScenePlacementPatch(doc, JSON.parse(JSON.stringify(patch))).document;
  equal(merged.spatial!.terrain[0].shadowMask, 0); equal(merged.spatial!.billboards.hero.shadowMask, 0); equal(merged.spatial!.models!.rock.shadowMask, 3);
  throws(() => applySceneSpatialPatch(doc.spatial, { ...patch.spatial!, version: 7 }), /version 8/);
  viewer.undo(); equal(viewer.exportPatch(), undefined); viewer.redo(); deepEqual(viewer.exportPatch(), patch);
  const before = JSON.stringify(viewer.exportPatch());
  throws(() => viewer.updateSpatial([{ kind: 'updateBillboard', id: 'hero', changes: { lightMask: 256 } }]), /lightMask/);
  equal(JSON.stringify(viewer.exportPatch()), before);
});

test('real native Playing/frame and JSON fresh-handle restore preserve terrain/billboard/model masks and disabled light declarations', async () => {
  const previousRaf = globalThis.requestAnimationFrame, previousCancel = globalThis.cancelAnimationFrame;
  let tick: FrameRequestCallback = () => {}, frame: FrameState | undefined, time = 0;
  globalThis.requestAnimationFrame = fn => ((tick = fn), 1); globalThis.cancelAnimationFrame = () => {};
  const { engine, registry, options } = await engineAndOptions(value => { frame = value; });
  const step = () => { tick(time += 1000 / 60); return frame!.renderCommandBuffer.spatial!; };
  try {
    const doc = document(), first = applyDataSceneAuthoringDocument(engine, doc, options).entityHandles.hero;
    engine.pauseDataScene(); ok(engine.resumeDataScene()); engine.start(); tick(0);
    const spatial = step(); ok(spatial); equal(frame!.gameState, 1);
    deepEqual([...spatial.receiverMasks!.terrain], [0, 3]); deepEqual([...spatial.receiverMasks!.billboards], [0, 3]); deepEqual([...spatial.receiverMasks!.models], [2, 0]);
    equal(spatial.environment!.version, 7); equal(spatial.environment!.values[1], 0); equal(spatial.environment!.shadowMatrices.length, 0);
    const saved = JSON.parse(JSON.stringify(captureGameStateSnapshot(engine, { includeDataSceneState: true, includeDataSceneProgress: true, dataSceneAuthoringDocument: JSON.parse(JSON.stringify(doc)) })));
    const off = saved.dataScene.progress.spatial.environment.lighting;
    equal(off.enabled, false); equal(off.lights[0].shadowMask, 0); equal(off.directional.lightMask, 0);
    ok(restoreGameStateSnapshot(engine, saved, { dataSceneAuthoringApplyOptions: options }).dataSceneAuthoringDocumentApplied);
    const fresh = registry.entries().find(entry => entry.instanceId === 'hero')!.handle;
    equal(engine.gameplayEntityExists(first), false); ok(engine.gameplayEntityExists(fresh));
    const restored = step();
    deepEqual([...restored.receiverMasks!.terrain], [0, 3]); deepEqual([...restored.receiverMasks!.billboards], [0, 3]); deepEqual([...restored.receiverMasks!.models], [2, 0]);
    equal(restored.environment!.version, 7);
  } finally { engine.destroy(); globalThis.requestAnimationFrame = previousRaf; globalThis.cancelAnimationFrame = previousCancel; }
});

test('restore checks old-native receiver/channel capabilities before activating or replacing current handles', async () => {
  const { engine, options } = await engineAndOptions();
  try {
    const doc = document(), live = applyDataSceneAuthoringDocument(engine, doc, options).entityHandles.hero;
    const saved = JSON.parse(JSON.stringify(captureGameStateSnapshot(engine, { includeDataSceneState: true, includeDataSceneProgress: true, dataSceneAuthoringDocument: JSON.parse(JSON.stringify(doc)) })));
    for (const [receivers, channels, expected] of [[false, true, /receiver masks/], [true, false, /light channels/]] as const) {
      const old = attachDataSceneRuntimeEngineAdapter({ ...engine }, {
        supportsSpatialReceiverMasks: () => receivers, supportsSpatialLightChannels: () => channels,
        useDataScene: () => { throw Error('must not activate'); }, textureId: () => { throw Error('must not look up assets'); }, spawnDataSceneEntity: () => undefined,
      });
      throws(() => restoreGameStateSnapshot(old, saved, { dataSceneAuthoringApplyOptions: options }), expected);
      ok(engine.gameplayEntityExists(live));
    }
    saved.dataScene.authoringDocument.spatial.billboards.hero.lightMask = 256;
    saved.snapshotHash = hashGameStateSnapshot(saved);
    throws(() => restoreGameStateSnapshot(engine, saved, { dataSceneAuthoringApplyOptions: options }), /lightMask/);
    ok(engine.gameplayEntityExists(live));
  } finally { engine.destroy(); }
});
