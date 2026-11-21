import assert from "node:assert/strict";

export async function probeAutomaticMovementNative(page) {
  const r = await page.evaluate(async () => {
    const { createEngine, UNIFIED_PHYSICS_STATE_LAYOUT: L } = await import("@ferrum2d/ferrum-web/core");
    const { applyPhysicsSceneProfile } = await import("@ferrum2d/ferrum-web/authoring");
    let frames = 0, steps = 0, consumed = 0, maxRustMs = 0, finish, timeout;
    const e = await createEngine(frame => {
      frames++;
      steps += frame.unifiedPhysics?.frame.backendSteps ?? 0;
      consumed += frame.physics.fixedConsumedSeconds;
      maxRustMs = Math.max(maxRustMs, frame.rustUpdateTimeMs);
      if (consumed >= 0.15) { e.pause(); finish?.(); }
    });
    try {
      e.useDataScene();
      const profile = applyPhysicsSceneProfile(e, { physics: {
        mode: "rigid", gravity: [0, 0], solver: { stepSeconds: 0.01 },
        bodies: { player: { type: "kinematic", position: [0.5, 0.5], collider: { shape: "box", size: [0.5, 0.5] } } },
      } });
      const a = profile.world.bodies.player;
      const ids = h => new Uint32Array([h.entityId, h.entityGeneration]);
      const state = h => [...e.queryUnifiedPhysicsBodyStates(ids(h)).floats];
      const wall = e.spawnUnifiedPhysicsBody({ kind: "fixed", pose: { position: [2, 2, 0] },
        collider: { shape: { type: "box", halfExtents: [0.25, 4, 2] }, category: 8 } });
      assertLocal(e.setPhysicsBodyVelocity(a, 300, 200), "manual input velocity rejected");
      e.stepRigidBodies(profile.stepSeconds);
      const slide = state(a), component = e.getPhysicsEntity(a);
      e.removeUnifiedPhysicsBody(wall);
      const enemy = e.spawnRigidBody({ x: 10, y: 10, bodyType: "kinematic", layer: "enemy",
        collider: { type: "aabb", halfWidth: 0.25, halfHeight: 0.25 } });
      const target = e.spawnUnifiedPhysicsBody({ kind: "fixed", pose: { position: [20, 10, 0] }, renderOffset: [-100, 0, 0],
        collider: { shape: { type: "sphere", radius: 0.1 }, sensor: true } });
      assertLocal(e.configureDataSceneGameplay({ primaryActor: a, combat: true }), "combat rejected");
      e.applyGameplayBehaviorCommands([{ type: "configureChase", entity: "enemy", target: "target", speed: 2, stopDistance: 0 }], { enemy, target });
      e.setPhysicsBodyVelocity(a, 0, 0);
      const checkpoint = e.captureRuntimeCheckpoint();
      const done = new Promise((resolve, reject) => {
        finish = resolve;
        timeout = setTimeout(() => reject(new Error("Automatic movement RAF timed out")), 15000);
      });
      e.start(); await done; clearTimeout(timeout);
      const ai = state(enemy), current = e.getPhysicsEntity(enemy);
      const replayBefore = state(a);
      e.restoreRuntimeCheckpoint(checkpoint);
      e.stepRigidBodies(profile.stepSeconds);
      const restoredPlayer = state(a);
      checkpoint.dispose();
      return { slide, component, ai, current, consumed, frames, steps, maxRustMs,
        replayBefore, restoredPlayer, position: L.position, playing: e.dataSceneState(), entities: e.entityCount(), backend: e.physicsBackend() };
    } finally { clearTimeout(timeout); e.destroy(); }
    function assertLocal(value, message) { if (!value) throw new Error(message); }
  });
  assert.equal(r.backend, "unified-3d"); assert.equal(r.playing, "playing"); assert.equal(r.entities, 3);
  assert(Math.abs(r.slide[r.position] - 1.5) < 0.002 && Math.abs(r.slide[r.position + 1] - 2.5) < 0.002, JSON.stringify(r));
  assert(Math.abs(r.component.x - 1.5) < 0.002 && r.component.velocityX === 300 && r.component.velocityY === 200);
  assert(Math.abs(r.ai[r.position] - (10 + 2 * r.consumed)) < 0.004, JSON.stringify(r));
  assert.equal(r.current.velocityX, 2); assert.equal(r.current.velocityY, 0);
  assert.equal(r.restoredPlayer[r.position], r.replayBefore[r.position]);
  assert(r.frames > 0 && r.steps >= 15 && Number.isFinite(r.maxRustMs));
  return r;
}
