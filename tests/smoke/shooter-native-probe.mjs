import assert from "node:assert/strict";

export async function probeShooterNative(page) {
  const r = await page.evaluate(async () => {
    const { createEngine, UNIFIED_PHYSICS_STATE_LAYOUT: L } = await import("@ferrum2d/ferrum-web/core");
    const originalRaf = window.requestAnimationFrame, originalCancel = window.cancelAnimationFrame;
    const pending = new Map(); let next = 0, timestamp = 0, samples = [], maxRustMs = 0;
    window.requestAnimationFrame = callback => { const id = ++next; pending.set(id, callback); return id; };
    window.cancelAnimationFrame = id => { pending.delete(id); };
    const pump = delta => {
      timestamp += delta; const callbacks = [...pending.values()]; pending.clear();
      if (callbacks.length !== 1) throw new Error(`Expected one Shooter RAF, got ${callbacks.length}`);
      callbacks[0](timestamp);
    };
    let input = { w: false, a: false, s: false, d: true, space: false, enter: false, mouseLeft: false, mouseX: 1000, mouseY: 300 };
    const e = await createEngine(frame => {
      maxRustMs = Math.max(maxRustMs, frame.rustUpdateTimeMs);
      samples.push({ state: frame.gameState, steps: frame.physics.fixedSteps,
        nativeSteps: frame.unifiedPhysics?.frame.backendSteps ?? 0,
        events: frame.gameplayEvents.map(event => ({ kind: event.kind, actor: event.actorId, source: event.sourceId,
          removed: event.targetRemoved, flags: event.flags })), renderCount: frame.renderCommandBuffer.commandCount,
        collisions: frame.collisionEvents.map(event => ({ ...event })),
        score: frame.score, entities: frame.entityCount });
    }, () => input, undefined, () => ({ width: 320, height: 180 }), { physicsBackend: "legacy", includeCollisionEvents: true });
    let checkpoint;
    const ids = h => new Uint32Array([h.entityId, h.entityGeneration]);
    const state = h => [...e.queryUnifiedPhysicsBodyStates(ids(h)).floats];
    const run = frames => {
      samples = []; e.resume(); pump(100);
      for (let i = 0; i < frames; i++) pump(10);
      e.pause(); return samples;
    };
    try {
      const initialBackend = e.physicsBackend();
      e.setGameSpec({ world: { width: 1000, height: 600 }, player: { speed: 100 },
        enemies: { speed: 1, spawnInterval: 1000 }, weapons: { bulletSpeed: 500, cooldown: 1, lifetime: 3 },
        prefabs: { player: { width: 10, height: 10, collider: { type: "aabb", halfWidth: 5, halfHeight: 5 } } },
        atlas: { frames: { wall: { texture: 14, uv: { u0: 0, v0: 0, u1: 1, v1: 1 }, size: { width: 20, height: 20 } } } },
        tilemap: { tileWidth: 20, tileHeight: 20, tiles: { 1: { frame: "wall", blocksMovement: true, blocksProjectile: true } },
          layers: [{ columns: 50, rows: 30, collision: true, collisionOnly: true, data: Array(1500).fill(0) }] } });
      const legacySnapshot = e.captureShooterStateSnapshot();
      if (!legacySnapshot) throw new Error("Legacy Shooter snapshot fixture must be captured before native setup");
      e.configureUnifiedPhysics({ space: "planar-xy", gravity: [0, 0, 0], lengthUnit: 100, stepSeconds: 0.01 });
      const player = e.builtInShooterPlayerHandle();
      if (!player) throw new Error("Built-in Shooter player must exist");
      const before = state(player);
      // These authoring hooks used to activate Shooter by discarding native state.
      e.setTextureIds({ player: 11, enemy: 12, bullet: 13 });
      e.setSoundIds({ shoot: 0, hit: 0, gameOver: 0 });
      const editedTile = e.setShooterTilemapTile(0, 30, 15, 1), backendAfterEdits = e.physicsBackend();
      const captureRejected = e.captureShooterStateSnapshot() === undefined;
      const restoreRejected = e.restoreShooterStateSnapshot(legacySnapshot) === false;
      const afterSnapshotRejections = state(player);
      input = { ...input, space: true };
      e.start(); pump(100); pump(10);
      const start = state(player), startFrame = samples.at(-1);
      input = { ...input, space: false }; pump(10);
      const moved = state(player), moveFrame = samples.at(-1); e.pause();

      checkpoint = e.captureRuntimeCheckpoint();
      const trace = run(12), expected = state(player);
      e.restoreRuntimeCheckpoint(checkpoint); const restored = state(player);
      const replay = run(12), replayed = state(player); checkpoint.dispose(); checkpoint = undefined;

      e.setBuiltInSceneEntityPosition(player, 594, 310);
      const wallTrace = run(3), wallActor = state(player);

      // A cold bullet crosses the complete enemy fixture in one native tick.
      // Damage and pickup must read post-step positions and retain old game policy.
      e.setBuiltInSceneEntityPosition(player, 500, 300);
      const enemy = e.spawnRigidBody({ x: 100, y: 100, bodyType: "kinematic", layer: "enemy",
        collider: { type: "aabb", halfWidth: 2, halfHeight: 2 } });
      const bullet = e.spawnRigidBody({ x: 70, y: 100, bodyType: "kinematic", layer: "bullet", velocityX: 5000,
        collider: { type: "aabb", halfWidth: 0.5, halfHeight: 0.5 } });
      const pickup = e.spawnRigidBody({ x: 501, y: 300, bodyType: "static", layer: "pickup", isTrigger: true,
        collider: { type: "circle", radius: 2 } });
      const configured = e.applyGameplayBehaviorCommands([
        { type: "configureHealth", entity: "enemy", recipe: "health", tags: [], max: 1, current: 1, onZero: "despawn" },
        { type: "configureScoreReward", entity: "enemy", recipe: "reward", tags: [], reward: 7 },
        { type: "configurePickup", entity: "pickup", recipe: "coin", tags: [], item: "coin", itemId: 1, count: 3, despawn: true },
      ], { enemy, pickup });
      const collisionTrace = run(1), score = e.score();
      const removed = [enemy, bullet, pickup].map(h => !e.gameplayEntityExists(h));
      const freeBullet = e.spawnRigidBody({ x: 200, y: 100, bodyType: "kinematic", layer: "bullet", velocityX: 200,
        collider: { type: "aabb", halfWidth: 0.5, halfHeight: 0.5 } });
      const wallBullet = e.spawnRigidBody({ x: 580, y: 310, bodyType: "kinematic", layer: "bullet", velocityX: 5000,
        collider: { type: "aabb", halfWidth: 0.5, halfHeight: 0.5 } });
      const impactTrace = run(1), free = state(freeBullet), wallRemoved = !e.gameplayEntityExists(wallBullet);

      // reset retains the opted-in backend, and recreates the player's native binding.
      e.resetGame(); const resetBackend = e.physicsBackend(), resetPlayer = e.builtInShooterPlayerHandle();
      if (!resetPlayer) throw new Error("Reset must recreate a Shooter player");
      const resetTrace = run(1), resetState = state(resetPlayer);
      return { initialBackend, backendAfterEdits, editedTile, captureRejected, restoreRejected, before, afterSnapshotRejections,
        start, startFrame, moved, moveFrame, expected, restored, replayed, trace, replay, collisionTrace, configured,
        removed, enemy, bullet, score, wallTrace, wallActor, impactTrace, free, wallRemoved, resetBackend, resetTrace, resetState, position: L.position,
        velocity: L.linearVelocity, state: e.gameState(), maxRustMs, memory: e.memoryStats() };
    } finally {
      checkpoint?.dispose(); e.destroy(); pending.clear();
      window.requestAnimationFrame = originalRaf; window.cancelAnimationFrame = originalCancel;
    }
  });
  const p = r.position;
  assert.equal(r.initialBackend, "legacy"); assert.equal(r.backendAfterEdits, "unified-3d"); assert(r.editedTile);
  assert(r.captureRejected && r.restoreRejected); assert.deepEqual(r.afterSnapshotRejections, r.before);
  assert.deepEqual(r.start, r.before); assert.equal(r.startFrame.nativeSteps, 0); assert.equal(r.startFrame.state, 1);
  assert.equal(r.moveFrame.nativeSteps, 1); assert(Math.abs(r.moved[p] - r.before[p] - 1) < 0.002);
  assert.deepEqual(r.restored, r.moved); assert.deepEqual(r.replayed, r.expected); assert.deepEqual(r.replay, r.trace);
  assert(r.trace.length === 12 && r.trace.every(frame => frame.nativeSteps === 1 && frame.state === 1 && frame.entities >= 1 && frame.renderCount >= 1));
  assert(Number.isFinite(r.maxRustMs) && r.maxRustMs >= 0);
  assert(r.wallActor[p] >= 594.9 && r.wallActor[p] <= 595.001, JSON.stringify(r.wallActor));
  assert(r.removed.every(Boolean)); assert.equal(r.score, 10);
  const kinds = r.collisionTrace.flatMap(frame => frame.events.map(event => event.kind));
  assert(kinds.includes("pickupCollected"));
  assert(r.collisionTrace.some(frame => frame.collisions.some(event => event.kind === "hit"
    && event.aId === r.bullet.entityId && event.aGeneration === r.bullet.entityGeneration
    && event.bId === r.enemy.entityId && event.bGeneration === r.enemy.entityGeneration && event.damage === 1)),
  JSON.stringify({ collisionTrace: r.collisionTrace, bullet: r.bullet, enemy: r.enemy }));
  assert(Math.abs(r.free[p] - 202) < 0.002); assert.equal(r.free[r.velocity], 200); assert(r.wallRemoved);
  assert(r.impactTrace.some(frame => frame.events.some(event => event.kind === "tileImpact")));
  assert.equal(r.resetBackend, "unified-3d"); assert.equal(r.state, 1); assert.equal(r.resetTrace[0].nativeSteps, 1);
  assert(Math.abs(r.resetState[p] - 501) < 0.002); assert(r.memory.wasmLinearMemoryBytes > 0);
  r.exactReplay = true; delete r.trace; delete r.replay;
  return r;
}
