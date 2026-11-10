import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createEngine, captureGameStateSnapshot, restoreGameStateSnapshot, hashGameStateSnapshot, parseGameStateSnapshot,
  stringifyGameStateSnapshot, type FerrumEngine, type GameStateSnapshot } from "../src/core.js";
import { applyDataSceneAuthoringDocument } from "../src/authoring.js";
import { snapshotRenderFrameBuffers } from "../src/frameBufferSnapshot.js";
import type { SpatialEnvironmentBufferView } from "../src/spatialEnvironment.js";

test("actual Wasm restores mid-fade semantic history atomically in exploration/combat and borrows diagnostic v1", async () => {
  const original = { fetch: globalThis.fetch, raf: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame };
  const pending = new Map<number, FrameRequestCallback>();
  let next = 1, time = 0;
  globalThis.fetch = (async (input, options) => String(input).startsWith("file:")
    ? new Response(Uint8Array.from(await readFile(new URL(String(input)))).buffer, { headers: { "Content-Type": "application/wasm" } })
    : original.fetch(input, options)) as typeof fetch;
  globalThis.requestAnimationFrame = callback => { const id = next++; pending.set(id, callback); return id; };
  globalThis.cancelAnimationFrame = id => { pending.delete(id); };
  const engines: FerrumEngine[] = [];
  const tick = (count: number) => {
    for (let i = 0; i < count; i++) { const callbacks = [...pending.values()]; pending.clear(); time += 17; for (const cb of callbacks) cb(time); }
  };
  try {
    for (const combat of [false, true]) {
      let frame: SpatialEnvironmentBufferView | undefined;
      const source = await createEngine(() => {}, undefined, undefined, () => ({ width: 400, height: 300 }));
      const destination = await createEngine(value => {
        frame = snapshotRenderFrameBuffers({ renderCommandBuffer: value.renderCommandBuffer, cameraX: 0, cameraY: 0 }).renderCommandBuffer.spatial?.environment;
      }, undefined, undefined, () => ({ width: 400, height: 300 }));
      engines.push(source, destination);
      const camera = { projection: "orthographic" as const, position: { x: -20, y: -200, elevation: 164 }, target: { x: -20, y: 0, elevation: 64 }, height: 200, near: .1, far: 1000 };
      const document = { format: "ferrum2d.consumer.scene-authoring", version: 1,
        gameplay: { primaryActor: "hero", ...(combat ? { combat: true } : {}) },
        sceneComposition: { initialFragment: "lab", prefabs: { body: {} }, fragments: { lab: { instances: [{ id: "hero", prefab: "body", x: 0, y: 0,
          props: { components: { visual: { kind: "sprite", texture: 0, width: 8, height: 16 }, collider: { type: "aabb", halfWidth: 2, halfHeight: 2, isTrigger: false },
            layer: "player", body: { type: "kinematic", heightSpan: { floorId: 0, elevation: 0, height: 16 } } } } }] } } },
        behaviorRecipes: { entities: {} }, spatial: { camera, terrain: [], billboards: { hero: {} },
          environment: { composition: "separated" as const, lighting: { maxActiveLights: 1 as const, selection: { hysteresis: .1, fadeSeconds: .2 }, lights: [
            { position: { x: -20, y: 0, elevation: 64 }, radius: 100, color: [1, 0, 0], lightMask: 1, shadowMask: 0 },
            { position: { x: 20, y: 0, elevation: 64 }, radius: 100, color: [0, 1, 0], lightMask: 2, shadowMask: 4 },
          ] } } } };
      applyDataSceneAuthoringDocument(source, document);
      source.start(); tick(2);
      ok(source.setDataSceneSpatialCamera({ ...camera, position: { ...camera.position, x: 20 }, target: { ...camera.target, x: 20 } }, { width: 400, height: 300 }));
      tick(1); ok(source.pauseDataScene());
      const options = { includeDataSceneState: true, includeDataSceneProgress: true, dataSceneAuthoringDocument: document } as const;
      const saved = captureGameStateSnapshot(source, options);
      equal(saved.dataScene!.version, 11);
      const history = saved.dataScene!.progress!.spatial!.lightSelection!;
      equal(history.slots[0].phase, "fading-out"); equal(history.slots[0].sourceIndex, 0); equal(history.slots[0].pendingSourceIndex, 1);
      ok(history.slots[0].weight > 0 && history.slots[0].weight < 1);
      const parsed = parseGameStateSnapshot(stringifyGameStateSnapshot(saved));
      ok(restoreGameStateSnapshot(destination, parsed).dataSceneStateApplied);
      const restored = captureGameStateSnapshot(destination, options);
      deepEqual(restored.dataScene!.progress, saved.dataScene!.progress);
      destination.start(); tick(3);
      equal(frame!.version, 8); equal(frame!.values.length, 580);
      equal(frame!.lightSelection!.words[0], 0); equal(frame!.lightSelection!.words[2], 3);
      equal(frame!.lightSelection!.values[5], history.slots[0].weight);
      equal(frame!.values[19], Math.fround(history.slots[0].weight));
      equal(frame!.values[545], 1); // source0 light1/shadow0, even while source1 is queued
      deepEqual(captureGameStateSnapshot(destination, options).dataScene!.progress, restored.dataScene!.progress);
      for (const kind of ["signature", "weight", "missing", "version", "source"] as const) {
        const bad = JSON.parse(JSON.stringify(saved));
        if (kind === "signature") bad.dataScene.progress.spatial.lightSelection.sourceSignature = (bad.dataScene.progress.spatial.lightSelection.sourceSignature ^ 1) >>> 0;
        if (kind === "weight") bad.dataScene.progress.spatial.lightSelection.slots[0].weight = -Number.MIN_VALUE;
        if (kind === "missing") delete bad.dataScene.progress.spatial.lightSelection;
        if (kind === "version") bad.dataScene.version = 10;
        if (kind === "source") { bad.dataScene.progress.spatial.environment.lighting.lights[0].position.x *= -1; bad.dataScene.progress.spatial.environment.lighting.lights[0].position.elevation *= -1; }
        bad.snapshotHash = hashGameStateSnapshot(bad);
        throws(() => restoreGameStateSnapshot(destination, bad as GameStateSnapshot), /selection|Selection|version 11/);
        deepEqual(captureGameStateSnapshot(destination, options).dataScene!.progress, restored.dataScene!.progress);
      }
      ok(destination.resumeDataScene()); tick(30); ok(destination.pauseDataScene());
      const settled = captureGameStateSnapshot(destination, options).dataScene!.progress!.spatial!.lightSelection!;
      equal(settled.slots[0].sourceIndex, 1); equal(settled.slots[0].phase, "steady"); equal(settled.slots[0].weight, 1);
      ok(destination.resetDataSceneSpatialLightSelection());
      equal(captureGameStateSnapshot(destination, options).dataScene!.progress!.spatial!.lightSelection!.initialized, false);
      source.clearDataSceneSpatial();
      const cleared = captureGameStateSnapshot(source, options);
      equal(cleared.dataScene!.progress!.spatial!.lightSelection, undefined);
      ok(restoreGameStateSnapshot(destination, cleared).dataSceneStateApplied);
      deepEqual(captureGameStateSnapshot(destination, options).dataScene!.progress, cleared.dataScene!.progress);
      source.stop(); destination.stop();
    }
  } finally {
    for (const engine of engines) engine.destroy();
    globalThis.fetch = original.fetch; globalThis.requestAnimationFrame = original.raf; globalThis.cancelAnimationFrame = original.cancel;
  }
});
