import assert from "node:assert/strict";

// Actual public no-options creation: this is separate from the explicit legacy
// compatibility/migration fixtures in the other native probes.
export async function probeNativeDefaultBackend(page) {
  const result = await page.evaluate(async () => {
    const { createEngine, UNIFIED_PHYSICS_STATE_LAYOUT: L } = await import("@ferrum2d/ferrum-web/core");
    const originalRaf = window.requestAnimationFrame, originalCancel = window.cancelAnimationFrame;
    const pending = new Map(); let serial = 0, timestamp = 0, samples = [], maxRustMs = 0;
    window.requestAnimationFrame = callback => { pending.set(++serial, callback); return serial; };
    window.cancelAnimationFrame = id => pending.delete(id);
    const pump = ms => {
      timestamp += ms; const callbacks = [...pending.values()]; pending.clear();
      if (callbacks.length !== 1) throw Error(`Expected one default native RAF, got ${callbacks.length}`);
      callbacks[0](timestamp);
    };
    let input = { w: false, a: false, s: false, d: false, space: false, enter: false, mouseLeft: false, mouseX: 0, mouseY: 0 };
    // No physics/backend/clock options are passed here.
    const engine = await createEngine(frame => {
      maxRustMs = Math.max(maxRustMs, frame.rustUpdateTimeMs);
      samples.push({ fixed: frame.physics.fixedTimestepEnabled, nominal: frame.physics.fixedStepSeconds,
        consumed: frame.physics.fixedConsumedSeconds, nativeSteps: frame.unifiedPhysics?.frame.backendSteps ?? 0,
        state: frame.gameState, entities: frame.entityCount, renders: frame.renderCommandBuffer.commandCount,
        gravity: [frame.physics.gravityX, frame.physics.gravityY] });
    }, () => input);
    let started = false, checkpoint;
    const run = deltas => {
      samples = []; if (started) engine.resume(); else { started = true; engine.start(); }
      pump(100); for (const ms of deltas) pump(ms); engine.pause(); return samples;
    };
    const state = handle => [...engine.queryUnifiedPhysicsBodyStates(new Uint32Array([handle.entityId, handle.entityGeneration])).floats];
    try {
      const initialBackend = engine.physicsBackend();
      engine.useDataScene();
      const actor = engine.spawnRigidBody({ x: 10, y: 20, bodyType: "kinematic", velocityX: 100, layer: "enemy", collider: { type: "circle", radius: .25 } });
      engine.queryAabbBodies({ x: 10, y: 20, halfWidth: 100, halfHeight: 100 });
      const before = state(actor), trace = run([12, 23]), after = state(actor);
      checkpoint = engine.captureRuntimeCheckpoint();
      const expectedTrace = run([9, 19, 11]), expected = state(actor);
      engine.restoreRuntimeCheckpoint(checkpoint);
      const replayTrace = run([9, 19, 11]), replay = state(actor);
      const transitions = [];
      for (const scene of ["breakout", "platformer", "data", "shooter"]) {
        if (scene === "breakout") engine.useBreakoutGame();
        else if (scene === "platformer") engine.usePlatformerGame();
        else if (scene === "data") engine.useDataScene();
        else { engine.setTextureIds({ player: 0, enemy: 0, bullet: 0 }); engine.resetGame(); }
        input = { ...input, space: true, enter: true };
        const entered = run([17]); input = { ...input, space: false, enter: false };
        const continued = run([23]);
        transitions.push({ scene, backend: engine.physicsBackend(), entered, continued });
      }
      const configured = engine.setGameSpec({ physics: { mode: "rigid", gravity: [1.25, 20], continuous: true,
        solver: { fixedTimestep: false, stepSeconds: .02, velocityIterations: 3, positionIterations: 2 } } });
      const settingsTrace = run([15]);
      return { initialBackend, before, after, trace, expectedTrace, replayTrace, expected, replay, transitions,
        configured: configured.physics, settingsTrace, position: L.position, maxRustMs, memory: engine.memoryStats() };
    } finally {
      checkpoint?.dispose(); engine.destroy(); pending.clear();
      window.requestAnimationFrame = originalRaf; window.cancelAnimationFrame = originalCancel;
    }
  });
  const near = (a, b) => assert(Math.abs(a - b) < .002, `${a} != ${b}`);
  assert.equal(result.initialBackend, "unified-3d");
  near(result.after[result.position] - result.before[result.position], 3.5);
  assert.equal(result.trace.length, 2);
  assert(result.trace.every(f => !f.fixed && f.nativeSteps > 0 && f.entities === 1 && Number.isFinite(f.consumed)));
  assert.deepEqual(result.replay, result.expected); assert.deepEqual(result.replayTrace, result.expectedTrace);
  assert.equal(result.transitions.length, 4);
  for (const row of result.transitions) {
    assert.equal(row.backend, "unified-3d");
    assert(row.entered.length > 0 && row.continued.length > 0);
    assert([...row.entered, ...row.continued].every(f => !f.fixed && Number.isInteger(f.entities) && f.entities >= 0));
    if (row.scene !== "data") assert(row.continued.some(f => f.nativeSteps > 0 && f.state === 1 && f.entities >= 1 && f.renders >= 1));
  }
  assert.equal(result.configured.solver.fixedTimestep, false);
  assert.equal(result.configured.solver.stepSeconds, Math.fround(.02));
  assert.equal(result.configured.solver.velocityIterations, 3); assert.equal(result.configured.solver.positionIterations, 2);
  assert(result.settingsTrace.length > 0 && result.settingsTrace.every(f => !f.fixed && f.nominal === Math.fround(.02)));
  assert(result.settingsTrace.every(f => f.gravity[0] === 1.25 && f.gravity[1] === 20));
  assert(Number.isFinite(result.maxRustMs) && result.maxRustMs >= 0); assert(result.memory.wasmLinearMemoryBytes > 0);
  result.exactReplay = true; return result;
}
