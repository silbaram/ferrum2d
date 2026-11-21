import assert from "node:assert/strict";

export async function probeBreakoutNative(page) {
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
      if (callbacks.length !== 1) throw new Error(`Expected one Breakout RAF, got ${callbacks.length}`);
      callbacks[0](timestamp);
    };
    let input = { w: false, a: false, s: false, d: true, space: false, enter: false, mouseLeft: false, mouseX: 0, mouseY: 0 };
    const e = await createEngine(frame => {
      maxRustMs = Math.max(maxRustMs, frame.rustUpdateTimeMs);
      samples.push({ state: frame.gameState, nativeSteps: frame.unifiedPhysics?.frame.backendSteps ?? 0,
        fixedSteps: frame.physics.fixedSteps, score: frame.score, entities: frame.entityCount,
        renderCount: frame.renderCommandBuffer.commandCount,
        collisions: frame.collisionEvents.map(event => ({ ...event })) });
    }, () => input, undefined, () => ({ width: 800, height: 480 }), { physicsBackend: "legacy", includeCollisionEvents: true });
    let checkpoint;
    const ids = h => new Uint32Array([h.entityId, h.entityGeneration]);
    const state = h => [...e.queryUnifiedPhysicsBodyStates(ids(h)).floats];
    const handles = () => {
      const paddle = e.builtInBreakoutPaddleHandle(), ball = e.builtInBreakoutBallHandle();
      if (!paddle || !ball) throw new Error("Breakout must expose its paddle and ball handles");
      return { paddle, ball };
    };
    const sync = () => e.queryAabbBodies({ x: 400, y: 240, halfWidth: 450, halfHeight: 300 });
    const place = (h, x, y, vx, vy) => {
      if (!e.setBuiltInSceneEntityPosition(h, x, y)) throw new Error("Breakout position edit was rejected");
      // The public query applies the authored position before velocity writeback.
      sync();
      e.setUnifiedPhysicsVelocities(ids(h), new Float32Array([vx, vy, 0, 0, 0, 0]));
    };
    const run = frames => {
      samples = []; e.resume(); pump(100);
      for (let i = 0; i < frames; i++) pump(10);
      e.pause(); return samples;
    };
    const bottomBrick = () => {
      const bricks = e.queryAabbBodies({ x: 400, y: 120, halfWidth: 400, halfHeight: 100, queryMaskBits: 2 });
      if (bricks.length === 0) throw new Error("Public native area query must find the scene's bricks");
      const view = e.queryUnifiedPhysicsBodyStates(new Uint32Array(bricks.flatMap(h => [h.entityId, h.entityGeneration])));
      const rows = bricks.map((h, i) => ({ handle: { ...h }, x: view.floats[i * L.stride + L.position], y: view.floats[i * L.stride + L.position + 1] }));
      rows.sort((a, b) => b.y - a.y || Math.abs(a.x - 400) - Math.abs(b.x - 400) || a.handle.entityId - b.handle.entityId);
      return { ...rows[0], total: bricks.length };
    };
    const config = { space: "planar-xy", gravity: [0, 0, 0], lengthUnit: 100, stepSeconds: 0.01 };
    try {
      e.useBreakoutGame();
      const legacyBackend = e.physicsBackend(), initialCount = e.entityCount();
      let spatialRejection;
      try { e.configureUnifiedPhysics({ ...config, space: "spatial" }); }
      catch (error) { spatialRejection = String(error); }
      e.configureUnifiedPhysics(config);
      const nativeBackend = e.physicsBackend(), initial = handles(), before = state(initial.ball);
      input = { ...input, space: true };
      e.start(); pump(100); pump(10);
      let current = handles();
      const launched = { ball: state(current.ball), paddle: state(current.paddle), frame: samples.at(-1), oldBallRemoved: !e.gameplayEntityExists(initial.ball) };
      input = { ...input, space: false }; pump(10);
      const moved = { ball: state(current.ball), paddle: state(current.paddle), frame: samples.at(-1) }; e.pause();

      input = { ...input, d: false };
      place(current.ball, 780, 250, 2000, 0);
      const wallTrace = run(1), wallContact = state(current.ball);
      const outgoingTrace = run(1), wallOutgoing = state(current.ball);
      const offsets = [];
      for (const offset of [-24, 0, 24]) {
        place(current.paddle, 400, 430, 0, 0);
        place(current.ball, 400 + offset, 400, 0, 2000);
        const trace = run(1);
        offsets.push({ offset, ball: state(current.ball), paddle: state(current.paddle), trace });
      }
      input = { ...input, d: true };
      place(current.paddle, 739, 430, 0, 0);
      place(current.ball, 400, 300, 0, 0);
      const clampTrace = run(2), clamped = state(current.paddle);
      input = { ...input, d: false };

      const brick = bottomBrick(), countBeforeHit = e.entityCount();
      place(current.ball, brick.x, brick.y + 30, 0, -5000);
      const brickTrace = run(1), afterBrick = state(current.ball);
      const brickHit = { brick, trace: brickTrace, ball: afterBrick, countBefore: countBeforeHit,
        countAfter: e.entityCount(), removed: !e.gameplayEntityExists(brick.handle), score: e.score(), particles: e.particleCount() };

      place(current.ball, 400, 300, 120, -80);
      place(current.paddle, 400, 430, 0, 0);
      checkpoint = e.captureRuntimeCheckpoint();
      const saved = state(current.ball), trace = run(12), expected = state(current.ball);
      e.restoreRuntimeCheckpoint(checkpoint);
      const restored = state(current.ball), replay = run(12), replayed = state(current.ball);
      checkpoint.dispose(); checkpoint = undefined;

      e.configureAutoRigidBodyStep(false);
      input = { ...input, d: true };
      place(current.ball, 300, 300, 200, 0);
      place(current.paddle, 400, 430, 0, 0);
      const manualBefore = { ball: state(current.ball), paddle: state(current.paddle) };
      const manualIntentTrace = run(1), manualIntent = { ball: state(current.ball), paddle: state(current.paddle) };
      e.stepRigidBodies(Math.fround(0.01));
      const manualMoved = { ball: state(current.ball), paddle: state(current.paddle) };
      const manualIdleTrace = run(1), manualIdle = { ball: state(current.ball), paddle: state(current.paddle) };
      const manualBrick = bottomBrick();
      place(current.ball, manualBrick.x, manualBrick.y + 30, 0, -5000);
      e.stepRigidBodies(Math.fround(0.01));
      const manualHit = { removed: !e.gameplayEntityExists(manualBrick.handle), score: e.score(), ball: state(current.ball), state: e.gameState() };

      e.configureAutoRigidBodyStep(true);
      input = { ...input, d: false };
      place(current.ball, 400, 491, 0, 200);
      const lossTrace = run(1), lost = { state: e.gameState(), ball: state(current.ball) };
      const oldBall = current.ball;
      input = { ...input, space: true, d: true };
      const restartTrace = run(1); current = handles();
      const restarted = { backend: e.physicsBackend(), state: e.gameState(), ball: state(current.ball), score: e.score(), oldBallRemoved: !e.gameplayEntityExists(oldBall) };
      input = { ...input, space: false };
      e.resetGame(); current = handles();
      const resetTrace = run(1), reset = { backend: e.physicsBackend(), ball: state(current.ball), paddle: state(current.paddle), entities: e.entityCount() };
      e.useBreakoutGame();
      const sameSceneTrace = run(1); current = handles();
      const sameScene = { backend: e.physicsBackend(), state: e.gameState(), ball: state(current.ball), entities: e.entityCount() };
      checkpoint = e.captureRuntimeCheckpoint();
      e.useDataScene();
      const dataSwitch = { backend: e.physicsBackend(), entities: e.entityCount() };
      e.restoreRuntimeCheckpoint(checkpoint); checkpoint.dispose(); checkpoint = undefined;
      e.usePlatformerGame();
      const platformerBackend = e.physicsBackend();
      let platformerRejection;
      try { e.configureUnifiedPhysics({ ...config, space: "spatial" }); } catch (error) { platformerRejection = String(error); }
      return { legacyBackend, nativeBackend, initialCount, spatialRejection, before, launched, moved,
        wallTrace, wallContact, outgoingTrace, wallOutgoing, offsets, clampTrace, clamped, brickHit,
        saved, trace, expected, restored, replay, replayed, manualBefore, manualIntentTrace, manualIntent,
        manualMoved, manualIdleTrace, manualIdle, manualHit, lossTrace, lost, restartTrace, restarted,
        resetTrace, reset, sameSceneTrace, sameScene, dataSwitch, platformerBackend, platformerRejection,
        maxRustMs, memory: e.memoryStats(), position: L.position, velocity: L.linearVelocity };
    } finally {
      checkpoint?.dispose(); e.destroy(); pending.clear();
      window.requestAnimationFrame = originalRaf; window.cancelAnimationFrame = originalCancel;
    }
  });
  const p = r.position, v = r.velocity;
  const near = (actual, expected, label) => assert(Math.abs(actual - expected) < 0.005, `${label}: ${actual} vs ${expected}`);
  const oneHit = trace => trace.flatMap(frame => frame.collisions).filter(event => event.kind === "hit");
  assert.equal(r.legacyBackend, "legacy"); assert.equal(r.nativeBackend, "unified-3d"); assert.equal(r.initialCount, 55);
  assert.match(r.spatialRejection ?? "", /WrongScene/);
  near(r.before[p], 400, "title ball x"); near(r.before[p + 1], 402, "title ball y"); assert.equal(r.before[v + 1], 0);
  assert(r.launched.oldBallRemoved); assert.equal(r.launched.frame.state, 1); assert.equal(r.launched.frame.nativeSteps, 0);
  near(r.launched.ball[p + 1], 402, "launch tick waits"); near(r.launched.ball[v + 1], -285, "launch velocity");
  assert.equal(r.moved.frame.nativeSteps, 1); near(r.moved.ball[p], 401.5675, "ball single x step");
  near(r.moved.ball[p + 1], 399.15, "ball single y step"); near(r.moved.paddle[p], 404.2, "paddle single step");
  near(r.wallContact[p], 782, "wall first contact"); near(r.wallContact[v], -2000, "wall full-speed reflection");
  assert.equal(oneHit(r.wallTrace).length, 1); near(r.wallOutgoing[p], 762, "wall outgoing motion");
  assert.equal(oneHit(r.outgoingTrace).length, 0);
  for (const row of r.offsets) {
    near(row.ball[p + 1], 416, "paddle contact stops remaining dt");
    near(row.ball[v], row.offset / 48 * 285, "paddle contact-offset x reflection");
    near(row.ball[v + 1], -285, "paddle y reflection"); assert.equal(oneHit(row.trace).length, 1);
  }
  near(r.clamped[p], 740, "paddle clamp"); near(r.clamped[v], 420, "clamp retains input command");
  assert.equal(r.brickHit.brick.total, 50); assert(r.brickHit.removed); assert.equal(r.brickHit.score, 10);
  assert.equal(r.brickHit.countBefore, 55); assert.equal(r.brickHit.countAfter, 54); assert(r.brickHit.particles >= 10);
  near(r.brickHit.ball[p + 1], r.brickHit.brick.y + 16, "brick first contact"); near(r.brickHit.ball[v + 1], 5000, "brick reflection");
  const brickEvents = oneHit(r.brickHit.trace); assert.equal(brickEvents.length, 1);
  assert.equal(brickEvents[0].bId, r.brickHit.brick.handle.entityId); assert.equal(brickEvents[0].bGeneration, r.brickHit.brick.handle.entityGeneration);
  assert.deepEqual(r.restored, r.saved); assert.deepEqual(r.replayed, r.expected); assert.deepEqual(r.replay, r.trace);
  assert.equal(r.trace.length, 12); assert(r.trace.every(frame => frame.state === 1 && frame.nativeSteps === 1 && frame.entities === 54 && frame.renderCount >= 54));
  assert.deepEqual(r.manualIntent.ball.slice(p, p + 3), r.manualBefore.ball.slice(p, p + 3));
  assert.deepEqual(r.manualIntent.paddle.slice(p, p + 3), r.manualBefore.paddle.slice(p, p + 3));
  assert(r.manualIntentTrace.every(frame => frame.nativeSteps === 0));
  near(r.manualMoved.ball[p], 302, "manual ball step"); near(r.manualMoved.paddle[p], 404.2, "manual paddle step");
  assert.deepEqual(r.manualIdle, r.manualMoved); assert(r.manualIdleTrace.every(frame => frame.nativeSteps === 0));
  assert(r.manualHit.removed); assert.equal(r.manualHit.score, 20); assert.equal(r.manualHit.state, 1); near(r.manualHit.ball[v + 1], 5000, "manual collision response");
  assert.equal(r.lost.state, 2); assert(r.lost.ball[p + 1] > 492);
  assert.equal(r.restartTrace[0].nativeSteps, 0); assert.equal(r.restarted.backend, "unified-3d");
  assert.equal(r.restarted.state, 1); assert.equal(r.restarted.score, 0); assert(r.restarted.oldBallRemoved);
  near(r.restarted.ball[p + 1], 402, "restart tick waits");
  assert.equal(r.reset.backend, "unified-3d"); assert.equal(r.reset.entities, 55); assert.equal(r.resetTrace[0].nativeSteps, 1);
  near(r.reset.ball[p], 401.5675, "reset ball step"); near(r.reset.paddle[p], 404.2, "reset paddle step");
  assert.equal(r.sameScene.backend, "unified-3d"); assert.equal(r.sameScene.state, 0); assert.equal(r.sameScene.entities, 55);
  assert.equal(r.sameSceneTrace[0].nativeSteps, 0); near(r.sameScene.ball[v + 1], 0, "same-scene title parks ball");
  assert.deepEqual(r.dataSwitch, { backend: "legacy", entities: 0 }); assert.equal(r.platformerBackend, "legacy");
  assert.match(r.platformerRejection ?? "", /WrongScene/); assert(Number.isFinite(r.maxRustMs) && r.maxRustMs >= 0);
  assert(r.memory.wasmLinearMemoryBytes > 0); r.exactReplay = true; delete r.trace; delete r.replay;
  return r;
}
