import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Distance from the capsule axis to the oriented box. The relative point
// moves along a segment, so squared distance to the box is convex.
function capsuleBoxDepth({ actor, box, rotation: [x, y, z, w] }) {
  const distance = t => {
    const [dx, dy, dz] = [actor[0] - box[0], actor[1] - box[1] + t, actor[2] - box[2]];
    const local = [
      (1 - 2*y*y - 2*z*z)*dx + 2*(x*y + w*z)*dy + 2*(x*z - w*y)*dz,
      2*(x*y - w*z)*dx + (1 - 2*x*x - 2*z*z)*dy + 2*(y*z + w*x)*dz,
      2*(x*z + w*y)*dx + 2*(y*z - w*x)*dy + (1 - 2*x*x - 2*y*y)*dz,
    ];
    return Math.hypot(...local.map(v => Math.max(0, Math.abs(v) - 0.5)));
  };
  let start = -0.5, end = 0.5;
  for (let i = 0; i < 48; i++) {
    const left = (2 * start + end) / 3, right = (start + 2 * end) / 3;
    if (distance(left) < distance(right)) end = right;
    else start = left;
  }
  return Math.max(0, 0.25 - distance((start + end) * 0.5));
}

export async function probeCharacterDynamicForces(page, packageEvidence = {}) {
  const directory = resolve("artifacts/physics-3d/goal-closure/character-force-bridge/browser");
  await mkdir(directory, { recursive: true });
  const report = { format: "ferrum2d.character-dynamic-forces.browser", version: 1, status: "running", packageEvidence };
  try {
    const results = await page.evaluate(async () => {
      const { createEngine, UNIFIED_PHYSICS_STATE_LAYOUT: B, UNIFIED_PHYSICS_CHARACTER_LAYOUT: C,
        UNIFIED_PHYSICS_COLLISION_LAYOUT: E } = await import("@ferrum2d/ferrum-web/core");
      const raf = window.requestAnimationFrame, cancel = window.cancelAnimationFrame, pending = new Map();
      let serial = 0, time = 0;
      window.requestAnimationFrame = callback => { pending.set(++serial, callback); return serial; };
      window.cancelAnimationFrame = id => { pending.delete(id); };
      const pump = () => {
        time += 10; const callbacks = [...pending.values()]; pending.clear();
        if (callbacks.length !== 1) throw new Error("Expected one owned character RAF");
        callbacks[0](time);
      };
      const results = [];
      try {
        for (const space of ["planar-xy", "spatial"]) {
          const cost = { frames: 0, nativeFrames: 0, maxRustMs: 0 };
          const e = await createEngine(frame => {
            cost.frames++; cost.nativeFrames += Number(Boolean(frame.unifiedPhysics));
            cost.maxRustMs = Math.max(cost.maxRustMs, frame.rustUpdateTimeMs);
          });
          let checkpoint;
          try {
            e.useDataScene(); e.configureUnifiedPhysics({ space, gravity: [0, 0, 0], lengthUnit: 1, stepSeconds: 0.01 });
            const actor = e.spawnUnifiedPhysicsBody({ kind: "kinematic-position",
              collider: { shape: { type: "capsule", halfHeight: 0.5, radius: 0.25 } } });
            const box = e.spawnUnifiedPhysicsBody({ pose: { position: [100, 0, 0] }, canSleep: false, ccd: true,
              collider: { shape: { type: "box", halfExtents: [0.5, 0.5, 0.5] }, density: 2, friction: 0 } });
            const handles = new Uint32Array([actor.entityId, actor.entityGeneration]);
            const all = new Uint32Array([actor.entityId, actor.entityGeneration, box.entityId, box.entityGeneration]);
            const config = { pushMass: 2, stepHeight: 0, snapDistance: 0 };
            e.configureUnifiedPhysicsCharacter(actor, config); e.configureAutoRigidBodyStep(false);
            e.start(); e.resume(); pump(); pump(); e.pause();
            const state = () => {
              const bodies = e.queryUnifiedPhysicsBodyStates(all), words = [...bodies.words], floats = [...bodies.floats];
              const character = e.queryUnifiedPhysicsCharacterStates(handles);
              return { words, floats, characterWords: [...character.words], characterFloats: [...character.floats] };
            };
            const step = () => { e.stepRigidBodies(Math.fround(0.01)); return state(); };
            e.addUnifiedPhysicsCharacterForces(new Uint32Array([...handles, ...handles]), new Float32Array([4, 0, 0, 4, 0, 0]));
            e.applyUnifiedPhysicsCharacterImpulses(handles, new Float32Array([4, 0, 0]));
            const first = step(), second = step();
            e.clearUnifiedPhysicsCharacterForces(handles);
            const cleared = step();
            e.configureUnifiedPhysicsCharacter(actor, config);
            e.setUnifiedPhysicsPoses(all, new Float32Array([-2, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1]));
            // Isolate passive knockback: a persistent velocity command is an
            // active motor that can legitimately supply momentum on later ticks.
            e.setUnifiedPhysicsCharacterInputs(handles, new Float32Array([0, 0, 0, 0]));
            // Use actual borrowed Wasm state storage for both aliasing inputs.
            const alias = e.queryUnifiedPhysicsBodyStates(handles);
            const aliasHandles = alias.words.subarray(0, 2), aliasValues = alias.floats.subarray(B.position, B.position + 3);
            aliasValues.set([10, 0, 0]); e.applyUnifiedPhysicsCharacterImpulses(aliasHandles, aliasValues);
            checkpoint = e.captureRuntimeCheckpoint();
            const trace = () => Array.from({ length: 50 }, step);
            const expected = trace(); e.restoreRuntimeCheckpoint(checkpoint);
            const errors = [];
            for (const [h, values] of [
              [all, new Float32Array([8, 0, 0, 8, 0, 0])],
              [new Uint32Array([...handles, ...handles]), new Float32Array([1e6, 0, 0, 1e6, 0, 0])],
              [new Uint32Array([...handles, 0xffffffff, 0]), new Float32Array([8, 0, 0, 8, 0, 0])],
            ]) {
              try { e.addUnifiedPhysicsCharacterForces(h, values); errors.push(undefined); }
              catch (error) { errors.push(String(error)); }
            }
            const replayed = trace();
            const last = replayed.at(-1), av = last.characterFloats[C.velocity], bv = last.floats[B.stride + B.linearVelocity];
            // Compare fresh worlds with identical fixture order. A reused
            // Rapier arena can order otherwise equivalent manifold points differently.
            const traceImpact = async controlled => {
              const sim = await createEngine(() => {});
              try {
                sim.useDataScene();
                const dt = Math.fround(0.01);
                sim.configureUnifiedPhysics({ space, gravity: [0, 0, 0], lengthUnit: 1, stepSeconds: dt });
                sim.configureAutoRigidBodyStep(false);
                const capsule = sim.spawnUnifiedPhysicsBody({ kind: "kinematic-position",
                  collider: { shape: { type: "capsule", halfHeight: 0.5, radius: 0.25 } } });
                if (controlled) sim.configureUnifiedPhysicsCharacter(capsule, config);
                const target = sim.spawnUnifiedPhysicsBody({ ccd: true, canSleep: false,
                  pose: { position: [1.5, 0, 0] }, linearVelocity: [-200, 0, 0],
                  collider: { shape: { type: "box", halfExtents: [0.5, 0.5, 0.5] }, density: 2, friction: 0 } });
                const ids = new Uint32Array([capsule.entityId, capsule.entityGeneration, target.entityId, target.entityGeneration]);
                sim.setUnifiedPhysicsCollisionEventsEnabled(true);
                const rows = Array.from({ length: 32 }, () => {
                  sim.stepRigidBodies(dt);
                  const { floats } = sim.queryUnifiedPhysicsBodyStates(ids);
                  const row = {
                    actor: [...floats.slice(B.position, B.position + 3)],
                    box: [...floats.slice(B.stride + B.position, B.stride + B.position + 3)],
                    rotation: [...floats.slice(B.stride + B.rotation, B.stride + B.rotation + 4)],
                    boxVelocity: floats[B.stride + B.linearVelocity],
                    contact: false,
                  };
                  const events = sim.drainUnifiedPhysicsCollisionEvents();
                  for (let i = 0; i < events.count; i++) {
                    const offset = i * E.stride;
                    const first = events.words[offset + E.first + E.entity];
                    const second = events.words[offset + E.second + E.entity];
                    row.contact ||= events.words[offset + E.phase] === E.enter
                      && !(events.words[offset + E.flags] & E.sensorFlag)
                      && ((first === capsule.entityId && second === target.entityId)
                        || (first === target.entityId && second === capsule.entityId));
                  }
                  return row;
                });
                let knockbackX;
                if (controlled && rows.some(row => row.contact)) {
                  // Decision B delivers solid input events. Game code applies knockback.
                  sim.applyUnifiedPhysicsCharacterImpulses(ids.subarray(0, 2), new Float32Array([-10, 0, 0]));
                  sim.stepRigidBodies(dt);
                  knockbackX = sim.queryUnifiedPhysicsBodyStates(ids).floats[B.position];
                }
                return { rows, knockbackX };
              } finally { sim.destroy(); }
            };
            const { rows: impact, knockbackX } = await traceImpact(true);
            const { rows: baseline } = await traceImpact(false);
            results.push({ space, first, second, cleared,
              forceVelocities: [first, second, cleared].map(s => s.characterFloats[C.velocity]),
              expected, replayed, errors, actorVelocity: av, boxVelocity: bv,
              boxX: last.floats[B.stride + B.position], totalMomentum: 2 * av + 2 * bv,
              impact, baseline, knockbackX, cost });
          } finally { checkpoint?.dispose(); e.destroy(); }
        }
        return results;
      } finally { window.requestAnimationFrame = raf; window.cancelAnimationFrame = cancel; }
    });
    for (const r of results) {
      assert(r.forceVelocities[0] > 2 && r.forceVelocities[0] < 2.1);
      assert(r.forceVelocities[1] > r.forceVelocities[0]);
      assert.equal(r.forceVelocities[2], r.forceVelocities[1], "Force clear must retain velocity without replaying impulse");
      assert(r.errors.every(Boolean)); assert.deepEqual(r.replayed, r.expected, "Rejected force batches must not alter pending input or replay");
      // The KCC push and its reaction conserve passive momentum without enforcing
      // the old solver's shared post-contact velocity.
      assert(r.boxX > 0.3 && r.boxVelocity > 2 && r.boxVelocity < 4, "The real dynamic body must receive a finite reaction");
      assert(r.actorVelocity > 0 && r.actorVelocity < 5);
      assert(Math.abs(r.totalMomentum - 10) < 0.1, "No duplicate backend impulse or infinite-mass push");
      assert(r.impact.some(row => row.contact), "Game code must receive the incoming solid contact");
      assert(r.baseline.some(row => row.contact), "The ordinary capsule must receive the same contact");
      assert(r.impact.every(({ actor, box }) => Math.abs(actor[0]) < 1e-5 && box[0] > actor[0]),
        "Incoming CCD must not move the actor or pass through it");
      assert(r.impact.at(-1).boxVelocity > -0.1, "The kinematic contact must stop or deflect the box");
      r.overlap = r.impact.map(capsuleBoxDepth);
      r.baselineOverlap = r.baseline.map(capsuleBoxDepth);
      for (const [tick, depth] of r.overlap.entries()) {
        assert(depth <= r.baselineOverlap[tick] + 1e-6,
          `${r.space} tick ${tick + 1}: character ${depth} exceeds Rapier ${r.baselineOverlap[tick]}`);
      }
      const firstOverlap = r.baselineOverlap.findIndex(depth => depth > 0.005);
      assert(firstOverlap === -1 || r.baselineOverlap.slice(firstOverlap).some(depth => depth <= 0.005),
        `${r.space}: the ordinary capsule did not recover within the 32-tick sample`);
      assert(r.knockbackX < -0.049, "The game-authored impulse must move the actor");
      assert(r.cost.frames > 0 && r.cost.nativeFrames === r.cost.frames);
      assert(Number.isFinite(r.cost.maxRustMs) && r.cost.maxRustMs < 500);
    }
    Object.assign(report, { status: "passed", results, scope: "Packed SDK bulk character forces, actual Wasm aliases, native finite-mass reactions, atomic failure and checkpoint replay in both spaces; not density or physical-device acceptance" });
    return report;
  } catch (error) { report.status = "failed"; report.error = String(error); throw error; }
  finally { await writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2) + "\n"); }
}
