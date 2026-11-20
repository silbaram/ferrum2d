import assert from "node:assert/strict";

export async function probeUnifiedSpatialActor(page, document) {
  const result = await page.evaluate(async document => {
    const { createEngine, UNIFIED_PHYSICS_STATE_LAYOUT: B, UNIFIED_PHYSICS_CHARACTER_LAYOUT: C } = await import("@ferrum2d/ferrum-web/core");
    const { applyDataSceneAuthoringDocument } = await import("@ferrum2d/ferrum-web/authoring");
    const input = { w: false, a: false, s: false, d: false, space: false, enter: false, mouseLeft: false, mouseX: 0, mouseY: 0 };
    let elapsed = 0, frames = 0, nativeSteps = 0, maxRustMs = 0, duration = 0, finish, timer;
    const e = await createEngine(frame => {
      elapsed += frame.physics.fixedConsumedSeconds;
      frames++; nativeSteps += frame.unifiedPhysics?.frame.backendSteps ?? 0;
      maxRustMs = Math.max(maxRustMs, frame.rustUpdateTimeMs);
      if (elapsed >= duration) { e.pause(); finish(); }
    }, () => input);
    const run = async (seconds, start = false) => {
      elapsed = 0; duration = seconds;
      const done = new Promise((resolve, reject) => {
        finish = resolve;
        timer = setTimeout(() => reject(new Error("Native spatial actor RAF timed out")), 45000);
      });
      try { if (start) e.start(); else e.resume(); await done; return elapsed; }
      finally { clearTimeout(timer); e.pause(); }
    };
    try {
      const applied = applyDataSceneAuthoringDocument(e, document, { textureId: () => 11 });
      const actor = applied.entityHandles.actor, handles = new Uint32Array([actor.entityId, actor.entityGeneration]);
      const position = () => [...e.queryUnifiedPhysicsBodyStates(handles).floats.slice(B.position, B.position + 3)];
      for (let i = 0; i < 200; i++) e.stepRigidBodies(Math.fround(0.01));
      const initial = position();
      input.w = input.d = true;
      const walkingSeconds = await run(0.2, true), walked = position();
      input.w = input.d = false;
      e.setUnifiedPhysicsCharacterInputs(handles, new Float32Array([0, 0, 0, 4]));
      await run(0.1);
      const jumped = position();
      await run(1.2);
      const grounded = Boolean(e.queryUnifiedPhysicsCharacterStates(handles).words[C.flags] & C.groundedFlag);
      const planned = e.moveDataSceneSpatialActorTo({ x: -1, y: 1, floorId: 0, speed: 3, cellSize: 0.5, arrivalRadius: 0.02 });
      const planning = e.dataSceneSpatialMoveStats();
      await run(2);
      const arrived = position(), status = e.dataSceneSpatialMoveStatus();
      return { initial, walked, walkingSeconds, jumped, grounded, planned, planning, arrived, status,
        playing: e.dataSceneState(), entities: e.entityCount(), frames, nativeSteps, maxRustMs };
    } finally { clearTimeout(timer); e.destroy(); }
  }, document);
  assert.equal(result.playing, "playing");
  assert.equal(result.entities, 3);
  assert(result.frames > 0 && result.nativeSteps >= 300 && Number.isFinite(result.maxRustMs));
  const expected = Math.SQRT2 * result.walkingSeconds;
  assert(Math.abs(result.walked[0] - result.initial[0] - expected) < 0.003, JSON.stringify(result));
  assert(Math.abs(result.walked[2] - result.initial[2] - expected) < 0.003, JSON.stringify(result));
  assert(result.jumped[1] > result.walked[1] + 0.2 && result.grounded);
  assert(result.planned && result.planning.edgeProbeCount > 0);
  assert.equal(result.planning.lastRequest.status, "accepted");
  assert.equal(result.status, "arrived");
  assert(Math.hypot(result.arrived[0] + 1, result.arrived[2] + 1) < 0.03, JSON.stringify(result));
  return result;
}
