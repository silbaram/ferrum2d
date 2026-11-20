import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function probeNativeShapeEdits(page, packageEvidence = {}) {
  const directory = resolve("artifacts/physics-3d/goal-closure/native-state-semantics/browser-shape-edits");
  await mkdir(directory, { recursive: true });
  const report = { format: "ferrum2d.native-shape-edit.browser", version: 1, status: "running", packageEvidence };
  try {
    report.results = await page.evaluate(async () => {
      const { createEngine, UNIFIED_PHYSICS_STATE_LAYOUT: B } = await import("@ferrum2d/ferrum-web/core");
      const results = [];
      for (const space of ["planar-xy", "spatial"]) {
        for (const flipped of [false, true]) {
          const result = { space, flipped, phase: "create" };
          const engine = await createEngine();
          let checkpoint;
          try {
            const dt = Math.fround(1 / 60);
            engine.useDataScene();
            engine.configureUnifiedPhysics({ space, gravity: [0, 0, 0], lengthUnit: 1, stepSeconds: dt });
            engine.configureAutoRigidBodyStep(false);
            const floor = () => engine.spawnUnifiedPhysicsBody({ kind: "fixed", pose: { position: [0, -0.5, 0] },
              collider: { shape: { type: "box", halfExtents: [5, 0.5, 5] } } });
            const moving = () => engine.spawnUnifiedPhysicsBody({ kind: "dynamic", canSleep: false, pose: { position: [0, 0.5, 0] },
              collider: { shape: { type: "compound", parts: [-0.2, 0.2].map(x => ({
                pose: { position: [x, 0, 0] }, shape: { type: "sphere", radius: 0.5 },
              })) } } });
            let actor;
            if (flipped) { actor = moving(); floor(); }
            else { floor(); actor = moving(); }
            engine.setUnifiedPhysicsCollisionEventsEnabled(true);
            for (let i = 0; i < 4; i++) engine.stepRigidBodies(dt);
            result.initialPairs = engine.queryUnifiedPhysicsCollisionPairs().count;
            engine.drainUnifiedPhysicsCollisionEvents();
            const handles = new Uint32Array([actor.entityId, actor.entityGeneration]);
            result.colliderBefore = engine.queryUnifiedPhysicsColliders(actor);
            result.phase = "replace-same-collider";
            engine.updateUnifiedPhysicsCollider(actor, result.colliderBefore[0], { shape: { type: "sphere", radius: 0.1 } });
            engine.setUnifiedPhysicsVelocities(handles, new Float32Array([0, -1, 0, 0, 0, 0]));
            checkpoint = engine.captureRuntimeCheckpoint();
            const step = () => {
              engine.stepRigidBodies(dt);
              const body = engine.queryUnifiedPhysicsBodyStates(handles);
              const bodyWords = [...body.words], bodyFloats = [...body.floats];
              const event = engine.drainUnifiedPhysicsCollisionEvents();
              const events = [...event.words], dropped = [event.droppedTransitions, event.droppedEvents];
              const pairs = engine.queryUnifiedPhysicsCollisionPairs();
              const activePairs = [...pairs.words];
              const observations = engine.queryUnifiedPhysicsObservations();
              return { bodyWords, position: bodyFloats.slice(B.position, B.position + 3),
                velocity: bodyFloats.slice(B.linearVelocity, B.linearVelocity + 3),
                events, dropped, activePairs, impulses: [...observations.impulses.words],
                impulseCount: observations.impulses.count, solvedContacts: observations.diagnostics.solvedContacts,
                collider: engine.queryUnifiedPhysicsColliders(actor) };
            };
            result.phase = "first-trace";
            result.expected = Array.from({ length: 6 }, step);
            engine.restoreRuntimeCheckpoint(checkpoint);
            result.phase = "replay";
            result.replayed = Array.from({ length: 6 }, step);
            result.dt = dt;
            result.phase = "complete";
          } catch (error) { result.error = String(error); }
          finally { checkpoint?.dispose(); engine.destroy(); }
          results.push(result);
        }
      }
      return results;
    });
    for (const result of report.results) {
      assert.equal(result.error, undefined, JSON.stringify(result));
      assert.equal(result.initialPairs, 1, JSON.stringify(result));
      assert.equal(result.colliderBefore.length, 1);
      assert.deepEqual(result.replayed, result.expected, `${result.space}/${result.flipped}: exact pending shape edit replay`);
      for (const [tick, row] of result.expected.entries()) {
        assert.deepEqual(row.collider, result.colliderBefore, "Shape replacement must retain collider identity");
        assert.equal(row.impulseCount, 0, JSON.stringify(result));
        assert.equal(row.solvedContacts, 0, JSON.stringify(result));
        assert.deepEqual(row.impulses, []);
        assert.deepEqual(row.activePairs, []);
        assert.deepEqual(row.dropped, [0, 0]);
        assert(Math.abs(row.velocity[1] + 1) < 1e-6, JSON.stringify(result));
        assert(Math.abs(row.position[1] - (0.5 - (tick + 1) * result.dt)) < 2e-6, JSON.stringify(result));
        assert(row.position.every(Number.isFinite) && row.velocity.every(Number.isFinite));
      }
    }
    report.status = "passed";
    report.scope = "Actual packed SDK same-collider compound-to-sphere replacement, no ghost impulse, six native steps and exact checkpoint replay in both spaces/orderings. Full shape matrix/lifecycle admission is covered by separate Rust tests; dense costs and native file restore remain pending.";
    return report;
  } catch (error) { report.status = "failed"; report.error = String(error); throw error; }
  finally { await writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2) + "\n"); }
}
