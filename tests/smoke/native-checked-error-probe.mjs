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
      const { createEngine, createNativeGameFileSession, UNIFIED_PHYSICS_STATE_LAYOUT: L } = await import("@ferrum2d/ferrum-web/core");
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
        for (const mode of ["manual-default", "manual-configured"]) {
          const result = { mode, phase: "create", cleanupErrors: [], frames: 0 };
          let engine, checkpoint, fileSession;
          try {
            engine = await createEngine(() => { result.frames++; });
            engine.useDataScene();
            const dt = Math.fround(0.01);
            engine.configureUnifiedPhysics({
              space: "spatial", gravity: [0, 0, 0], lengthUnit: 1, stepSeconds: dt,
            });
            engine.configureFixedTimestep({ enabled: true, stepSeconds: dt });
            engine.configureAutoRigidBodyStep(false);
            const wall = engine.spawnUnifiedPhysicsBody({
              kind: "fixed", collider: { shape: { type: "box", halfExtents: [0.05, 1, 2] } },
            });
            const sphere = engine.spawnUnifiedPhysicsBody({
              kind: "dynamic", ccd: true, canSleep: false,
              pose: { position: [-2, 0, 0] }, linearVelocity: [300, 0, 0],
              collider: { shape: { type: "sphere", radius: 0.5 } },
            });
            const handles = new Uint32Array([sphere.entityId, sphere.entityGeneration]);
            const body = () => [...engine.queryUnifiedPhysicsBodyStates(handles).floats.slice(L.position, L.stride)];
            const step = seconds => mode === "manual-configured"
              ? engine.stepRigidBodies(seconds, { gravityX: 0, gravityY: 0, continuous: true })
              : engine.stepRigidBodies(seconds);

            // Keep observable diagnostics from a completed tick. A mismatched
            // fixed interval reaches Rust and is rejected before opening a tick.
            step(dt);
            fileSession = await createNativeGameFileSession(engine);
            result.stepBefore = engine.queryUnifiedPhysicsDiagnostics().step;
            result.before = body();
            result.timeBefore = engine.time();
            const saved = await fileSession.capture();
            result.phase = "fixed-clock-admission";
            try { step(dt * 0.5); }
            catch (error) { result.rejection = String(error); }
            result.framesAtRejection = result.frames;
            result.pendingAtRejection = pending.size;

            result.phase = "reborrow-and-checkpoint";
            result.after = body();
            result.timeAfter = engine.time();
            result.stepAfter = engine.queryUnifiedPhysicsDiagnostics().step;
            const after = await fileSession.capture();
            result.fileBytes = [saved.length, after.length];
            result.sameFile = saved.length === after.length && saved.every((byte, i) => byte === after[i]);
            checkpoint = engine.captureRuntimeCheckpoint();
            engine.restoreRuntimeCheckpoint(checkpoint);
            checkpoint.dispose();
            checkpoint = undefined;
            result.checkpointRestored = true;

            result.phase = "remove-and-restart";
            engine.removeUnifiedPhysicsBody(wall);
            engine.setUnifiedPhysicsVelocities(handles, new Float32Array([300, 0, 0, 0, 0, 0]));
            result.recoveredDynamicBodies = step(dt).dynamicBodies;
            result.manualRecoveredBody = body();
            engine.configureAutoRigidBodyStep(true);
            engine.start();
            pump(1000);
            pump(1010);
            result.framesAfterRestart = result.frames;
            result.timeAfterRestart = engine.time();
            result.restartedBody = body();
            engine.stop();
            result.pendingAfterStop = pending.size;
            result.phase = "complete";
          } catch (error) { result.error = String(error); }
          finally {
            try { await fileSession?.dispose(); } catch (error) { result.cleanupErrors.push(String(error)); }
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
    assert.equal(report.results.length, 2);
    for (const result of report.results) {
      assert.match(result.rejection ?? "", /native physics step skipped:.*(?:clock|timestep)/i, JSON.stringify(result));
      assert.equal(result.error, undefined, JSON.stringify(result));
      assert.equal(result.framesAtRejection, 0, JSON.stringify(result));
      assert.equal(result.pendingAtRejection, 0, JSON.stringify(result));
      assert.deepEqual(result.after, result.before, JSON.stringify(result));
      assert.equal(result.timeAfter, result.timeBefore, JSON.stringify(result));
      assert.equal(result.stepBefore.backendSteps, 1);
      assert(result.stepBefore.ccdClamps > 0, "previous successful step must contain a measured clamp");
      assert.deepEqual(result.stepAfter, result.stepBefore, result.mode + " changed previous step diagnostics");
      assert(result.sameFile, result.mode + " changed saved game bytes " + result.fileBytes);
      assert.equal(result.checkpointRestored, true);
      assert.equal(result.recoveredDynamicBodies, 1, JSON.stringify(result));
      assert(result.manualRecoveredBody[0] > result.after[0], JSON.stringify(result));
      assert.equal(result.framesAfterRestart, 1, JSON.stringify(result));
      assert(result.timeAfterRestart > result.timeAfter, JSON.stringify(result));
      assert(result.restartedBody.every(Number.isFinite), JSON.stringify(result));
      assert.equal(result.pendingAfterStop, 0);
      assert.equal(result.pendingAfterDestroy, 0);
      assert.equal(result.destroyedGuard, true);
      assert.deepEqual(result.cleanupErrors, []);
    }
    report.status = "passed";
    report.scope = "Packed SDK/Wasm fixed-clock admission rejects both manual step entry points without mutating poses, time, diagnostics or Native file bytes. Fresh Rust queries, checkpoint restoration, removal, RAF restart and idempotent destroy are exercised.";
    return report;
  } catch (error) {
    report.status = "failed"; report.error = String(error); throw error;
  } finally {
    await writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2) + "\n");
  }
}
