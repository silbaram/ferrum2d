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
        for (const mode of ["automatic", "manual-default", "manual-configured"]) {
          const result = { mode, phase: "create", cleanupErrors: [], frames: 0 };
          let engine, checkpoint, fileSession;
          try {
            engine = await createEngine(() => { result.frames++; });
            engine.useDataScene();
            const dt = Math.fround(0.01);
            engine.configureUnifiedPhysics({
              space: "spatial", gravity: [0, 0, 0], lengthUnit: 1, stepSeconds: dt,
              velocityIterations: 1, positionIterations: 1, continuous: true,
            });
            engine.configureAutoRigidBodyStep(mode === "automatic");
            if (mode !== "automatic") {
              // Keep a nonempty last completed step so resetting its diagnostics is observable.
              const spinner = engine.spawnUnifiedPhysicsBody({
                kind: "dynamic", ccd: true, canSleep: false,
                pose: { position: [20, 0, 0], rotation: [0, 0, Math.sin(-Math.PI / 16), Math.cos(-Math.PI / 16)] },
                angularVelocity: [0, 0, Math.PI / (4 * dt)],
                collider: { shape: { type: "box", halfExtents: [2, .025, .1] } },
              });
              const stop = engine.spawnUnifiedPhysicsBody({ kind: "fixed", pose: { position: [21.99, 0, 0] },
                collider: { shape: { type: "sphere", radius: .015 } } });
              engine.stepRigidBodies(dt);
              engine.removeUnifiedPhysicsBody(spinner);
              engine.removeUnifiedPhysicsBody(stop);
            }
            // A registered controller keeps this world on the checked motion path.
            const actor = engine.spawnUnifiedPhysicsBody({
              kind: "kinematic-position", pose: { position: [40, 2, 0] },
              collider: { shape: { type: "capsule", halfHeight: 0.5, radius: 0.25 } },
            });
            engine.configureUnifiedPhysicsCharacter(actor, {});
            // Start above the sloped mesh and cross it within one tick. The
            // fast box activates CCD and its sweep visits the overlapping
            // triangle leaves until the current native proof budget is exhausted.
            const triangles = new Uint32Array(4096 * 3);
            for (let i = 0; i < triangles.length; i += 3) triangles.set([0, 2, 1], i);
            const mesh = engine.spawnUnifiedPhysicsBody({
              kind: "fixed", collider: { shape: {
                type: "triangleMesh", vertices: [-8, -1, -8, 8, 1, -8, 0, 0, 8], triangles,
              } },
            });
            const box = engine.spawnUnifiedPhysicsBody({
              kind: "dynamic", ccd: true, canSleep: false,
              pose: { position: [0, 1.25, 0] }, linearVelocity: [0, -100, 0],
              collider: { shape: { type: "box", halfExtents: [0.5, 0.5, 0.5] } },
            });
            const handles = new Uint32Array([box.entityId, box.entityGeneration, actor.entityId, actor.entityGeneration]);
            const body = () => {
              const { floats } = engine.queryUnifiedPhysicsBodyStates(handles);
              return [...floats.slice(L.position, L.stride), ...floats.slice(L.stride + L.position, L.stride * 2)];
            };
            result.before = body();
            result.timeBefore = engine.time();
            let saved;
            if (mode !== "automatic") {
              fileSession = await createNativeGameFileSession(engine);
              result.stepBefore = engine.queryUnifiedPhysicsDiagnostics().step;
              saved = await fileSession.capture();
            }
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
            if (fileSession) {
              result.stepAfter = engine.queryUnifiedPhysicsDiagnostics().step;
              const after = await fileSession.capture();
              result.fileBytes = [saved.length, after.length];
              result.sameFile = saved.length === after.length && saved.every((byte, i) => byte === after[i]);
            }
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
    assert.equal(report.results.length, 3);
    for (const result of report.results) {
      assert.match(result.rejection ?? "", /actual native motion rejected after 0 committed seconds:.*physics capacity exceeded/, JSON.stringify(result));
      assert.equal(result.error, undefined, JSON.stringify(result));
      assert.equal(result.framesAtRejection, 0, JSON.stringify(result));
      assert.equal(result.pendingAtRejection, 0, JSON.stringify(result));
      assert.deepEqual(result.after, result.before, JSON.stringify(result));
      assert.equal(result.timeAfter, result.timeBefore, JSON.stringify(result));
      if (result.mode !== "automatic") {
        assert.equal(result.stepBefore.backendSteps, 1);
        assert(result.stepBefore.ccdClamps > 0, "previous successful step must contain a measured clamp");
        assert.deepEqual(result.stepAfter, result.stepBefore, result.mode + " changed previous step diagnostics");
        assert(result.sameFile, result.mode + " changed saved game bytes " + result.fileBytes);
      }
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
