import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function probeNativeLandingContinuity(page, packageEvidence = {}) {
  const directory = resolve("artifacts/physics-3d/goal-closure/native-admission-landing/browser");
  await mkdir(directory, { recursive: true });
  const report = { format: "ferrum2d.native-landing.browser", version: 2, status: "running", packageEvidence };
  try {
    report.results = await page.evaluate(async () => {
      const { createEngine, UNIFIED_PHYSICS_STATE_LAYOUT: B, UNIFIED_PHYSICS_CHARACTER_LAYOUT: C } = await import("@ferrum2d/ferrum-web/core");
      const originalRaf = window.requestAnimationFrame, originalCancel = window.cancelAnimationFrame;
      const pending = new Map();
      let serial = 0, clock = 0;
      window.requestAnimationFrame = callback => { pending.set(++serial, callback); return serial; };
      window.cancelAnimationFrame = id => { pending.delete(id); };
      const pump = () => {
        clock += 10;
        const callbacks = [...pending.values()]; pending.clear();
        if (callbacks.length !== 1) throw new Error("Expected one owned landing RAF callback");
        callbacks[0](clock);
      };
      const results = [];
      try {
        for (const scenario of [
          { name: "near-skin-open", start: [-10, 0.5101, 10] },
          { name: "near-skin-tight-ceiling", start: [-10, 0.5101, 10], ceiling: 1.0103 },
          { name: "near-skin-tight-wall", start: [-10, 0.5101, 10], ceiling: 1.0103, wallGap: 0.002 },
          { name: "within-skin-landing", start: [-10, 0.5497451, 1.041666] },
        ]) {
          const result = { ...scenario, phase: "create" };
          const engine = await createEngine(() => {});
          let checkpoint;
          try {
            const dt = Math.fround(1 / 60);
            engine.useDataScene();
            engine.configureUnifiedPhysics({ space: "spatial", gravity: [0, 0, 0], lengthUnit: 1, stepSeconds: dt });
            engine.spawnUnifiedPhysicsBody({ kind: "kinematic-position", pose: { position: [0, -0.1, 0] },
              collider: { shape: { type: "box", halfExtents: [20, 0.1, 20] } } });
            const actor = engine.spawnUnifiedPhysicsBody({ kind: "kinematic-position", pose: { position: scenario.start },
              collider: { shape: { type: "capsule", halfHeight: 0.25, radius: 0.25 } } });
            if (scenario.ceiling !== undefined) {
              engine.spawnUnifiedPhysicsBody({ kind: "fixed", pose: { position: [scenario.start[0], scenario.ceiling + 0.1, scenario.start[2]] },
                collider: { shape: { type: "box", halfExtents: [1, 0.1, 1] } } });
            }
            if (scenario.wallGap !== undefined) {
              result.wallFront = scenario.start[2] + 0.25 + scenario.wallGap;
              engine.spawnUnifiedPhysicsBody({ kind: "fixed", pose: { position: [scenario.start[0], 1, result.wallFront + 0.05] },
                collider: { shape: { type: "box", halfExtents: [1, 1, 0.05] } } });
            }
            engine.configureUnifiedPhysicsCharacter(actor, { pushMass: 10, stepHeight: 0, snapDistance: 0 });
            engine.configureAutoRigidBodyStep(false);
            engine.start(); engine.resume(); pump(); pump(); engine.pause();
            const handles = new Uint32Array([actor.entityId, actor.entityGeneration]);
            const state = () => {
              const body = engine.queryUnifiedPhysicsBodyStates(handles);
              const bodyWords = [...body.words], bodyFloats = [...body.floats];
              const character = engine.queryUnifiedPhysicsCharacterStates(handles);
              return { bodyWords, bodyFloats, characterWords: [...character.words], characterFloats: [...character.floats] };
            };
            result.initial = state().bodyFloats.slice(B.position, B.position + 3);
            result.phase = "queue-impulse";
            // Zero world gravity isolates an actual desired displacement of
            // [0,-.09892499,.5*dt] through the public J/m command path.
            engine.applyUnifiedPhysicsCharacterImpulses(handles, new Float32Array([0, 10 * (-0.09892499 / dt), 5]));
            checkpoint = engine.captureRuntimeCheckpoint();
            const step = () => { engine.stepRigidBodies(dt); return state(); };
            result.phase = "first-trace";
            result.expected = Array.from({ length: 3 }, step);
            engine.restoreRuntimeCheckpoint(checkpoint);
            result.phase = "replay";
            result.replayed = Array.from({ length: 3 }, step);
            const first = result.expected[0];
            result.position = first.bodyFloats.slice(B.position, B.position + 3);
            result.translation = first.characterFloats.slice(C.translation, C.translation + 3);
            result.numericTrace = result.expected.map(row => ({
              position: row.bodyFloats.slice(B.position, B.position + 3),
              velocity: row.bodyFloats.slice(B.linearVelocity, B.linearVelocity + 3),
              translation: row.characterFloats.slice(C.translation, C.translation + 3),
              characterVelocity: row.characterFloats.slice(C.velocity, C.velocity + 3),
            }));
            result.grounded = Boolean(first.characterWords[C.flags] & C.groundedFlag);
            result.expectedTangent = 0.5 * dt;
            result.phase = "complete";
          } catch (error) {
            result.error = String(error);
          } finally { checkpoint?.dispose(); engine.destroy(); }
          results.push(result);
        }
      } finally { window.requestAnimationFrame = originalRaf; window.cancelAnimationFrame = originalCancel; }
      return results;
    });
    for (const result of report.results) {
      assert.equal(result.error, undefined, JSON.stringify(result));
      assert.deepEqual(result.replayed, result.expected, `${result.name}: pending impulse and accepted trace must replay exactly`);
      assert(result.grounded, JSON.stringify(result));
      assert(result.position[1] > 0.5098 && result.position[1] < 0.5103, JSON.stringify(result));
      if (result.ceiling !== undefined) {
        assert(result.position[1] + 0.5 <= result.ceiling + 1e-5, JSON.stringify(result));
      }
      const tangent = result.position[2] - result.initial[2];
      if (result.wallGap === undefined) {
        assert(Math.abs(tangent - result.expectedTangent) < 4e-5, JSON.stringify(result));
      } else {
        // Native KCC retains its existing small skin-separation retreat when
        // starting within the wall's preferred margin. Bound that retreat;
        // require the actual capsule to remain behind the physical wall.
        assert(tangent >= -0.0002 && tangent <= result.wallGap + 1e-5, JSON.stringify(result));
        assert(tangent < result.expectedTangent / 2, JSON.stringify(result));
        assert(result.position[2] + 0.25 <= result.wallFront + 1e-5, JSON.stringify(result));
      }
      assert(result.numericTrace.every(row => Object.values(row).every(values => values.every(Number.isFinite))));
      for (const row of result.numericTrace) {
        assert(row.position[1] - 0.5 >= -1e-5, JSON.stringify(result));
        if (result.ceiling !== undefined) assert(row.position[1] + 0.5 <= result.ceiling + 1e-5, JSON.stringify(result));
        if (result.wallGap !== undefined) assert(row.position[2] + 0.25 <= result.wallFront + 1e-5, JSON.stringify(result));
      }
    }
    report.status = "passed";
    report.scope = "Actual packed SDK/Wasm positive-gap floor, within-skin landing and physically fitting tight-ceiling tangent movement, genuine forward-wall blocking and pending-impulse checkpoint replay; full trajectory/angular CCD and density acceptance remain separate";
    return report;
  } catch (error) { report.status = "failed"; report.error = String(error); throw error; }
  finally { await writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2) + "\n"); }
}
