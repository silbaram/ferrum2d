import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function probeNativeCheckedErrors(page, packageEvidence = {}) {
  const directory = resolve("artifacts/physics-3d/goal-closure/native-checked-errors/browser");
  await mkdir(directory, { recursive: true });
  const report = {
    format: "ferrum2d.native-checked-errors.browser", version: 1,
    status: "running", packageEvidence,
  };
  try {
    report.results = await page.evaluate(async () => {
      const { createEngine, UNIFIED_PHYSICS_STATE_LAYOUT: L } = await import("@ferrum2d/ferrum-web/core");
      const originalRaf = window.requestAnimationFrame, originalCancel = window.cancelAnimationFrame;
      const pending = new Map();
      let serial = 0;
      window.requestAnimationFrame = callback => { pending.set(++serial, callback); return serial; };
      window.cancelAnimationFrame = id => { pending.delete(id); };
      const pump = time => {
        const callbacks = [...pending.values()]; pending.clear();
        if (callbacks.length !== 1) throw new Error("Expected exactly one owned checked-error RAF");
        callbacks[0](time);
      };
      const results = [];
      try {
        for (const mode of ["automatic", "manual-default", "manual-configured"]) {
          const result = { mode, phase: "create", cleanupErrors: [], frames: 0 };
          let engine, checkpoint;
          try {
            engine = await createEngine(() => { result.frames++; });
            engine.useDataScene();
            const dt = Math.fround(0.01);
            engine.configureUnifiedPhysics({
              space: "spatial", gravity: [0, 0, 0], lengthUnit: 1, stepSeconds: dt,
              velocityIterations: 1, positionIterations: 1, continuous: true,
            });
            engine.configureAutoRigidBodyStep(mode === "automatic");
            // All 4096 valid, nondegenerate triangles remain distinct mesh
            // leaves. The box is above the sloped face throughout the first
            // native kernel; its bounds still intersect every identical leaf.
            // Each cast therefore charges two original point-cloud distances:
            // 4096 * 2 * (8 + 3 + 128) * 32 > the 32 Mi-work proof allowance.
            const triangles = new Uint32Array(4096 * 3);
            for (let i = 0; i < triangles.length; i += 3) triangles.set([0, 2, 1], i);
            const mesh = engine.spawnUnifiedPhysicsBody({
              kind: "fixed", collider: { shape: {
                type: "triangleMesh", vertices: [-8, -1, -8, 8, 1, -8, 0, 0, 8], triangles,
              } },
            });
            const box = engine.spawnUnifiedPhysicsBody({
              kind: "dynamic", ccd: true, canSleep: false,
              pose: { position: [0, 0.5703125, 0] }, linearVelocity: [0, -1, 0],
              collider: { shape: { type: "box", halfExtents: [0.5, 0.5, 0.5] } },
            });
            const handles = new Uint32Array([box.entityId, box.entityGeneration]);
            const body = () => [...engine.queryUnifiedPhysicsBodyStates(handles).floats.slice(L.position, L.stride)];
            result.before = body();
            result.timeBefore = engine.time();
            result.phase = "actual-native-rejection";
            try {
              if (mode === "automatic") {
                engine.start(); pump(0); pump(10);
              } else if (mode === "manual-default") {
                engine.stepRigidBodies(dt);
              } else {
                engine.stepRigidBodies(dt, {
                  gravityX: 0, gravityY: 0, velocityIterations: 1, positionIterations: 1,
                  continuous: true,
                });
              }
            } catch (error) { result.rejection = String(error); }
            result.framesAtRejection = result.frames;
            result.pendingAtRejection = pending.size;
            // These are fresh public Rust calls after the real Result error,
            // so a skipped Wasm borrow destructor cannot pass this check.
            result.phase = "reborrow-and-checkpoint";
            result.after = body();
            result.timeAfter = engine.time();
            checkpoint = engine.captureRuntimeCheckpoint();
            engine.restoreRuntimeCheckpoint(checkpoint);
            checkpoint.dispose(); checkpoint = undefined;
            result.checkpointRestored = true;
            result.phase = "remove-and-restart";
            engine.removeUnifiedPhysicsBody(mesh);
            const recoveredStats = mode === "manual-configured"
              ? engine.stepRigidBodies(dt, {
                gravityX: 0, gravityY: 0, velocityIterations: 1, positionIterations: 1,
                continuous: true,
              })
              : engine.stepRigidBodies(dt);
            result.recoveredDynamicBodies = recoveredStats.dynamicBodies;
            result.manualRecoveredBody = body();
            engine.configureAutoRigidBodyStep(true);
            engine.start(); pump(1000); pump(1010);
            result.framesAfterRestart = result.frames;
            result.timeAfterRestart = engine.time();
            result.restartedBody = body();
            engine.stop();
            result.pendingAfterStop = pending.size;
            result.phase = "complete";
          } catch (error) { result.error = String(error); }
          finally {
            try { checkpoint?.dispose(); } catch (error) { result.cleanupErrors.push(String(error)); }
            try { engine?.destroy(); engine?.destroy(); } catch (error) { result.cleanupErrors.push(String(error)); }
            result.pendingAfterDestroy = pending.size;
            if (engine) {
              try { engine.time(); } catch { result.destroyedGuard = true; }
            }
          }
          results.push(result);
        }
      } finally {
        pending.clear();
        window.requestAnimationFrame = originalRaf;
        window.cancelAnimationFrame = originalCancel;
      }
      return results;
    });
    assert.equal(report.results.length, 3);
    for (const result of report.results) {
      assert.equal(result.error, undefined, JSON.stringify(result));
      assert.match(result.rejection ?? "", /actual native motion rejected after 0 committed seconds:.*physics capacity exceeded/, JSON.stringify(result));
      assert.equal(result.framesAtRejection, 0, JSON.stringify(result));
      assert.equal(result.pendingAtRejection, 0, JSON.stringify(result));
      assert.deepEqual(result.after, result.before, JSON.stringify(result));
      assert.equal(result.timeAfter, result.timeBefore, JSON.stringify(result));
      assert.equal(result.checkpointRestored, true);
      assert.equal(result.recoveredDynamicBodies, 1, JSON.stringify(result));
      assert(result.manualRecoveredBody[1] < result.after[1], JSON.stringify(result));
      assert.equal(result.framesAfterRestart, 1, JSON.stringify(result));
      assert(result.timeAfterRestart > result.timeAfter, JSON.stringify(result));
      assert(result.restartedBody.every(Number.isFinite), JSON.stringify(result));
      assert.equal(result.pendingAfterStop, 0);
      assert.equal(result.pendingAfterDestroy, 0);
      assert.equal(result.destroyedGuard, true);
      assert.deepEqual(result.cleanupErrors, []);
    }
    report.status = "passed";
    report.scope = "Actual packed public SDK/Wasm automatic and both manual Result rejections; no partial pose/time or public frame; fresh Rust queries, checkpoint restore, removal, RAF restart and idempotent destroy after rejection. Logical work exhaustion, not an allocator or RSS cap.";
    return report;
  } catch (error) {
    report.status = "failed"; report.error = String(error); throw error;
  } finally {
    await writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2) + "\n");
  }
}
