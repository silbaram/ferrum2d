import assert from "node:assert/strict";

export async function probePlatformerNative(page) {
  const r = await page.evaluate(async () => {
    const { createEngine, UNIFIED_PHYSICS_STATE_LAYOUT: L } = await import("@ferrum2d/ferrum-web/core");
    const originalRaf = window.requestAnimationFrame, originalCancel = window.cancelAnimationFrame;
    const pending = new Map();
    let next = 0, timestamp = 0, samples = [], maxRustMs = 0;
    window.requestAnimationFrame = callback => { const id = ++next; pending.set(id, callback); return id; };
    window.cancelAnimationFrame = id => { pending.delete(id); };
    const pump = delta => {
      timestamp += delta;
      const callbacks = [...pending.values()]; pending.clear();
      if (callbacks.length !== 1) throw new Error(`Expected one Platformer RAF, got ${callbacks.length}`);
      callbacks[0](timestamp);
    };
    let input = { w: false, a: false, s: false, d: true, space: false, enter: false, mouseLeft: false, mouseX: 0, mouseY: 0 };
    const e = await createEngine(frame => {
      maxRustMs = Math.max(maxRustMs, frame.rustUpdateTimeMs);
      samples.push({ state: frame.gameState, nativeSteps: frame.unifiedPhysics?.frame.backendSteps ?? 0,
        fixedSteps: frame.physics.fixedSteps, score: frame.score, entities: frame.entityCount,
        renderCount: frame.renderCommandBuffer.commandCount,
        collisions: frame.collisionEvents.map(event => ({ ...event })) });
    }, () => input, undefined, () => ({ width: 1200, height: 640 }), { physicsBackend: "legacy", includeCollisionEvents: true });
    let checkpoint, stage = "setup";
    const ids = h => new Uint32Array([h.entityId, h.entityGeneration]);
    const state = h => {
      try { return [...e.queryUnifiedPhysicsBodyStates(ids(h)).floats]; }
      catch (error) {
        throw new Error(`Platformer native state read at '${stage}' for ${h.entityId}:${h.entityGeneration} (live=${e.gameplayEntityExists(h)}): ${String(error)}`);
      }
    };
    const player = () => {
      const h = e.builtInPlatformerPlayerHandle();
      if (!h) throw new Error("Platformer must expose its player handle");
      return h;
    };
    const movingPlatform = () => {
      // Public facade queries already return decoded handles. The floor and fixed
      // platforms lie outside this narrow Y range; this selects the real moving body.
      const hits = e.queryAabbBodies({ x: 760, y: 500, halfWidth: 190, halfHeight: 12, queryMaskBits: 8 });
      if (hits.length !== 1) throw new Error(`Expected one actual moving platform, found ${hits.length}`);
      return { ...hits[0] };
    };
    const sync = () => e.queryAabbBodies({ x: 600, y: 320, halfWidth: 650, halfHeight: 380 });
    const place = (h, x, y, vx, vy) => {
      if (!e.setBuiltInSceneEntityPosition(h, x, y)) throw new Error("Platformer player position edit was rejected");
      sync();
      e.setUnifiedPhysicsVelocities(ids(h), new Float32Array([vx, vy, 0, 0, 0, 0]));
    };
    const run = frames => {
      samples = []; e.resume(); pump(100);
      for (let i = 0; i < frames; i++) pump(10);
      e.pause(); return samples;
    };
    const config = { space: "planar-xy", gravity: [0, 0, 0], lengthUnit: 100, stepSeconds: 0.01 };
    try {
      e.usePlatformerGame();
      const legacyBackend = e.physicsBackend(), initialCount = e.entityCount();
      let spatialRejection;
      try { e.configureUnifiedPhysics({ ...config, space: "spatial" }); }
      catch (error) { spatialRejection = String(error); }
      e.configureUnifiedPhysics(config);
      stage = "configured title";
      const nativeBackend = e.physicsBackend(), initial = player(), before = state(initial);
      input = { ...input, space: true };
      e.start(); pump(100); pump(10);
      let current = player();
      stage = "start transition";
      const started = { body: state(current), frame: samples.at(-1), oldPlayerRemoved: !e.gameplayEntityExists(initial) };
      // Keep Space held from the title: starting the scene must not queue a jump.
      pump(10);
      const moved = { body: state(current), frame: samples.at(-1) }; e.pause();
      input = { ...input, d: false };
      stage = "floor landing and held jump";
      const groundTrace = run(45), grounded = { body: state(current), particles: e.particleCount() };
      const heldGroundTrace = run(10), heldGround = state(current);
      input = { ...input, space: false }; run(1);
      input = { ...input, space: true };
      const jumpTrace = run(1), jumped = state(current);
      const heldAirTrace = run(6), heldAir = state(current);
      const noRepeatTrace = run(105), noRepeat = state(current);

      input = { ...input, space: false }; run(1);
      stage = "one-way ascent and landing";
      place(current, 610, 360, 0, -420);
      const passTrace = run(20), passedUp = state(current);
      const oneWayTrace = run(180), oneWay = { body: state(current), particles: e.particleCount(), score: e.score() };

      stage = "moving platform carry";
      const platform = movingPlatform(), platformBefore = state(platform);
      place(current, platformBefore[L.position], 471, 0, 0);
      const carryBefore = state(current), carryTrace = run(1);
      const carried = { player: state(current), platform: state(platform) };
      stage = "automatic checkpoint replay";
      checkpoint = e.captureRuntimeCheckpoint();
      const saved = { player: state(current), platform: state(platform) };
      const trace = run(12), expected = { player: state(current), platform: state(platform) };
      e.restoreRuntimeCheckpoint(checkpoint);
      const restored = { player: state(current), platform: state(platform) };
      const replay = run(12), replayed = { player: state(current), platform: state(platform) };
      checkpoint.dispose(); checkpoint = undefined;

      stage = "queued manual jump checkpoint replay";
      e.configureAutoRigidBodyStep(false);
      input = { ...input, space: false, d: false }; run(1);
      place(current, 96, 574, 0, 0);
      const manualBefore = { player: state(current), platform: state(platform), score: e.score() };
      input = { ...input, space: true, d: true };
      const queuedTrace = run(1), queued = { player: state(current), platform: state(platform), score: e.score() };
      checkpoint = e.captureRuntimeCheckpoint();
      e.stepRigidBodies(Math.fround(0.01));
      const manualFirst = { player: state(current), platform: state(platform), score: e.score() };
      e.stepRigidBodies(Math.fround(0.01));
      const manualSecond = state(current);
      e.restoreRuntimeCheckpoint(checkpoint);
      e.stepRigidBodies(Math.fround(0.01));
      const manualReplayed = { player: state(current), platform: state(platform), score: e.score() };
      checkpoint.dispose(); checkpoint = undefined;
      const manualIdleTrace = run(1), manualIdle = { player: state(current), platform: state(platform), score: e.score() };

      input = { ...input, space: false, d: false }; run(1);
      stage = "loss and restart";
      e.configureAutoRigidBodyStep(true);
      place(current, 96, 713, 0, 0);
      const lossTrace = run(1), lost = { state: e.gameState(), body: state(current) };
      const oldPlayer = current;
      input = { ...input, space: true };
      const restartTrace = run(1); current = player();
      const restarted = { backend: e.physicsBackend(), state: e.gameState(), body: state(current), score: e.score(), oldPlayerRemoved: !e.gameplayEntityExists(oldPlayer) };
      const restartHeldTrace = run(1), restartHeld = state(current);
      e.resetGame(); current = player();
      stage = "reset public cold query then raw state";
      // Raw state buffers inspect admitted bindings. The spatial facade performs
      // cold admission of the recreated scene before any simulation tick.
      const resetQueryHits = sync().length;
      const resetBeforeTick = { backend: e.physicsBackend(), body: state(current), admissionHits: resetQueryHits, entities: e.entityCount(), score: e.score() };
      input = { ...input, space: false, d: true };
      const resetTrace = run(1), reset = state(current);
      e.usePlatformerGame(); current = player();
      stage = "same-scene selection public cold query then raw state";
      const sameSceneQueryHits = sync().length;
      const sameSceneBeforeTick = { backend: e.physicsBackend(), state: e.gameState(), body: state(current), platform: state(movingPlatform()), admissionHits: sameSceneQueryHits, entities: e.entityCount() };
      const sameSceneTrace = run(1), sameScene = state(current);
      stage = "scene switch and checkpoint restoration";
      checkpoint = e.captureRuntimeCheckpoint();
      e.useDataScene();
      const dataSwitch = { backend: e.physicsBackend(), entities: e.entityCount() };
      e.restoreRuntimeCheckpoint(checkpoint); checkpoint.dispose(); checkpoint = undefined;
      e.useBreakoutGame();
      const breakoutSwitch = { backend: e.physicsBackend(), entities: e.entityCount() };
      let breakoutSpatialRejection;
      try { e.configureUnifiedPhysics({ ...config, space: "spatial" }); }
      catch (error) { breakoutSpatialRejection = String(error); }
      return { legacyBackend, nativeBackend, initialCount, spatialRejection, before, started, moved,
        groundTrace, grounded, heldGroundTrace, heldGround, jumpTrace, jumped, heldAirTrace, heldAir, noRepeatTrace, noRepeat,
        passTrace, passedUp, oneWayTrace, oneWay, platform, platformBefore, carryBefore, carryTrace, carried,
        saved, trace, expected, restored, replay, replayed,
        manualBefore, queuedTrace, queued, manualFirst, manualSecond, manualReplayed, manualIdleTrace, manualIdle,
        lossTrace, lost, restartTrace, restarted, restartHeldTrace, restartHeld,
        resetBeforeTick, resetTrace, reset, sameSceneBeforeTick, sameSceneTrace, sameScene,
        dataSwitch, breakoutSwitch, breakoutSpatialRejection, maxRustMs, memory: e.memoryStats(), position: L.position, velocity: L.linearVelocity };
    } finally {
      checkpoint?.dispose(); e.destroy(); pending.clear();
      window.requestAnimationFrame = originalRaf; window.cancelAnimationFrame = originalCancel;
    }
  });
  const p = r.position, v = r.velocity;
  const near = (actual, expected, label, tolerance = 0.01) => assert(Math.abs(actual - expected) < tolerance, `${label}: ${actual} vs ${expected}`);
  const nativeFrames = frames => assert(frames.every(frame => frame.state === 1 && frame.nativeSteps === 1 && frame.entities === 8 && frame.renderCount >= 8));
  assert.equal(r.legacyBackend, "legacy"); assert.equal(r.nativeBackend, "unified-3d"); assert.equal(r.initialCount, 8);
  assert.match(r.spatialRejection ?? "", /WrongScene/);
  near(r.before[p], 96, "title player x"); near(r.before[p + 1], 500, "title player y");
  assert(r.started.oldPlayerRemoved); assert.equal(r.started.frame.state, 1); assert.equal(r.started.frame.nativeSteps, 0);
  near(r.started.body[p], 96, "start tick waits x"); near(r.started.body[p + 1], 500, "start tick waits y"); near(r.started.body[v + 1], 0, "start has no jump");
  assert.equal(r.moved.frame.nativeSteps, 1); near(r.moved.body[p], 98.1, "horizontal movement once");
  near(r.moved.body[p + 1], 500.09, "gravity displacement once"); near(r.moved.body[v + 1], 9, "gravity velocity once");
  nativeFrames(r.groundTrace); near(r.grounded.body[p + 1], 574, "floor ground position"); near(r.grounded.body[v + 1], 0, "floor stops vertical velocity"); assert(r.grounded.particles >= 12);
  near(r.heldGround[p + 1], 574, "title Space hold does not jump on landing");
  near(r.jumped[v + 1], -420, "jump speed"); near(r.jumped[p + 1], 569.8, "jump position");
  near(r.heldAir[v + 1], -366, "held jump does not restart upward velocity");
  near(r.noRepeat[p + 1], 574, "held jump does not repeat after landing"); near(r.noRepeat[v + 1], 0, "held jump rests on floor");
  assert(r.passedUp[p + 1] < 295, JSON.stringify(r.passedUp)); assert(r.passedUp[v + 1] < 0);
  near(r.oneWay.body[p + 1], 295, "one-way top landing"); near(r.oneWay.body[v + 1], 0, "one-way landing stops fall"); assert(r.oneWay.score >= 1);
  nativeFrames(r.oneWayTrace); const platformDx = r.carried.platform[p] - r.platformBefore[p];
  assert(Math.abs(platformDx) > 0.0001); near(r.carried.player[p] - r.carryBefore[p], platformDx, "carry matches native platform displacement"); near(r.carried.player[p + 1], 471, "carry remains on platform");
  assert.deepEqual(r.restored, r.saved); assert.deepEqual(r.replayed, r.expected); assert.deepEqual(r.replay, r.trace); assert.equal(r.trace.length, 12); nativeFrames(r.trace);
  assert.deepEqual(r.queued, r.manualBefore); assert(r.queuedTrace.every(frame => frame.nativeSteps === 0));
  near(r.manualFirst.player[p], 98.1, "manual axis movement"); near(r.manualFirst.player[p + 1], 569.8, "manual queued jump position"); near(r.manualFirst.player[v + 1], -420, "manual queued jump velocity");
  near(r.manualSecond[v + 1], -411, "manual jump edge consumed once"); assert.deepEqual(r.manualReplayed, r.manualFirst);
  assert.deepEqual(r.manualIdle, r.manualFirst); assert(r.manualIdleTrace.every(frame => frame.nativeSteps === 0));
  assert.equal(r.lost.state, 2); assert(r.lost.body[p + 1] > 712);
  assert.equal(r.restartTrace[0].nativeSteps, 0); assert.equal(r.restarted.backend, "unified-3d"); assert.equal(r.restarted.state, 1); assert.equal(r.restarted.score, 0); assert(r.restarted.oldPlayerRemoved);
  near(r.restarted.body[p + 1], 500, "restart tick waits"); near(r.restartHeld[v + 1], 9, "restart hold does not jump");
  assert.equal(r.resetBeforeTick.backend, "unified-3d"); assert.equal(r.resetBeforeTick.admissionHits, 8); assert.equal(r.resetBeforeTick.entities, 8); assert.equal(r.resetBeforeTick.score, 0);
  near(r.resetBeforeTick.body[p], 96, "reset cold-admitted native query x"); near(r.resetBeforeTick.body[p + 1], 500, "reset cold-admitted native query y");
  assert.equal(r.resetTrace[0].nativeSteps, 1); near(r.reset[p], 98.1, "reset movement once"); near(r.reset[v + 1], 9, "reset gravity once");
  assert.equal(r.sameSceneBeforeTick.backend, "unified-3d"); assert.equal(r.sameSceneBeforeTick.admissionHits, 8); assert.equal(r.sameSceneBeforeTick.state, 0); assert.equal(r.sameSceneBeforeTick.entities, 8);
  near(r.sameSceneBeforeTick.platform[p], 760, "reselected platform owner query"); assert.equal(r.sameSceneTrace[0].nativeSteps, 0); near(r.sameScene[p + 1], 500, "same-scene title remains parked");
  assert.deepEqual(r.dataSwitch, { backend: "legacy", entities: 0 }); assert.deepEqual(r.breakoutSwitch, { backend: "legacy", entities: 55 });
  assert.match(r.breakoutSpatialRejection ?? "", /WrongScene/); assert(Number.isFinite(r.maxRustMs) && r.maxRustMs >= 0); assert(r.memory.wasmLinearMemoryBytes > 0);
  r.exactReplay = true; r.queuedJumpReplay = true; delete r.trace; delete r.replay;
  return r;
}
