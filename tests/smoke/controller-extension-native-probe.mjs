import assert from "node:assert/strict";

export async function probeControllerExtensionNative(page) {
  const r = await page.evaluate(async () => {
    const { createEngine, UNIFIED_PHYSICS_STATE_LAYOUT: L } = await import("@ferrum2d/ferrum-web/core");
    const { applyPhysicsSceneProfile } = await import("@ferrum2d/ferrum-web/authoring");
    const e = await createEngine(() => {});
    let authored;
    try {
      e.useDataScene();
      const profile = applyPhysicsSceneProfile(e, { physics: { mode: "rigid", gravity: [0, 0], solver: { stepSeconds: 0.01 },
        hd2d: { enabled: true, defaultHeight: 1 },
        bodies: { actor: { type: "kinematic", position: [5, 5], velocity: [1000, 0], collider: { shape: "circle", radius: 0.25 } } },
      } });
      const a = profile.world.bodies.actor;
      const ids = h => new Uint32Array([h.entityId, h.entityGeneration]);
      const state = h => ({ native: [...e.queryUnifiedPhysicsBodyStates(ids(h)).floats], span: e.getPhysicsBodyHeightSpan(h) });
      const step = () => e.stepRigidBodies(profile.stepSeconds);
      const grid = e.configureDataSceneCollisionTilemap({ columns: 2, rows: 1, tileWidth: 10, tileHeight: 10, tiles: [1, 2],
        definitions: [{ id: 1, blocksMovement: false }, { id: 2, elevation: 3, blocksMovement: false }] });
      step(); const defaults = state(a);
      const configured = e.configureDataSceneKinematicController(a, { maxStepHeight: 4, maxDropHeight: 4 });
      let invalidRejected = false;
      try { e.configureDataSceneKinematicController(a, { maxStepHeight: NaN }); } catch { invalidRejected = true; }
      const checkpoint = e.captureRuntimeCheckpoint();
      step(); const climbed = state(a);
      e.restoreRuntimeCheckpoint(checkpoint);
      const reset = e.configureDataSceneKinematicController(a, false);
      step(); const resetState = state(a);
      e.restoreRuntimeCheckpoint(checkpoint); step(); const replayed = state(a); checkpoint.dispose();
      e.setPhysicsBodyVelocity(a, 0, 0); e.setPhysicsBodyPosition(a, 100, 100);
      const compound = e.spawnRigidBody({ x: 5, y: 5, bodyType: "kinematic", layer: "player", velocityX: 1000,
        collider: { type: "circle", radius: 0.25 }, heightSpan: { floorId: 0, elevation: 0, height: 1 } });
      const added = e.addPhysicsBodyCollider(compound, { collider: { type: "aabb", halfWidth: 0.25, halfHeight: 0.25, offsetY: 2 }, layer: "player" });
      const blocker = e.spawnRigidBody({ x: 15, y: 7, bodyType: "static", layer: "wall",
        collider: { type: "aabb", halfWidth: 0.4, halfHeight: 0.4 }, heightSpan: { floorId: 0, elevation: 3, height: 1 } });
      const compoundConfigured = e.configureDataSceneKinematicController(compound, { maxStepHeight: 4, maxDropHeight: 4 });
      step(); const occupied = state(compound);
      e.despawnPhysicsEntity(blocker); step(); const clear = state(compound);
      const foreign = e.spawnUnifiedPhysicsBody({ kind: "kinematic-velocity", pose: { position: [100, 100, 0] },
        collider: { shape: { type: "sphere", radius: 0.1 }, sensor: true } });
      const foreignRejected = !e.configureDataSceneKinematicController(foreign, {}); e.removeUnifiedPhysicsBody(foreign);
      authored = { grid, defaults, configured, invalidRejected, climbed, reset, resetState, replayed,
        added, compoundConfigured, occupied, clear, foreignRejected, backend: e.physicsBackend(), entities: e.entityCount() };
    } finally { e.destroy(); }

    let consumed = 0, steps = 0, frames = 0, maxRustMs = 0, finish, timeout;
    const auto = await createEngine(frame => {
      consumed += frame.physics.fixedConsumedSeconds; steps += frame.unifiedPhysics?.frame.backendSteps ?? 0;
      frames++; maxRustMs = Math.max(maxRustMs, frame.rustUpdateTimeMs);
      if (consumed >= 0.15) { auto.pause(); finish?.(); }
    });
    try {
      auto.useDataScene();
      const profile = applyPhysicsSceneProfile(auto, { physics: { mode: "rigid", gravity: [0, 0], solver: { stepSeconds: 0.01 },
        bodies: { circle: { type: "kinematic", position: [0, 0], collider: { shape: "circle", radius: 0.25 } } } } });
      const handles = [profile.world.bodies.circle];
      let compoundAdded = false;
      const shapes = [
        { type: "orientedBox", halfWidth: 0.25, halfHeight: 0.4, rotationRadians: 0.37 },
        { type: "capsule", startX: 0, startY: -0.3, endX: 0, endY: 0.3, radius: 0.2 },
        { type: "convexPolygon", vertices: [-0.3, -0.3, 0.4, -0.3, 0, 0.4] },
        { type: "circle", radius: 0.2 },
      ];
      for (let index = 0; index < shapes.length; index++) {
        const h = auto.spawnRigidBody({ x: 0, y: (index + 1) * 20, bodyType: "kinematic", layer: "player", collider: shapes[index] });
        if (index === shapes.length - 1) compoundAdded = auto.addPhysicsBodyCollider(h, { collider: { type: "aabb", halfWidth: 0.2, halfHeight: 0.2, offsetY: 2 }, layer: "player" });
        handles.push(h);
      }
      const configured = handles.map(h => auto.configureDataSceneKinematicController(h, { maxIterations: 8, maxStepHeight: 4, maxDropHeight: 4 }));
      handles.forEach(h => auto.setPhysicsBodyVelocity(h, 2, 0));
      const done = new Promise((resolve, reject) => { finish = resolve; timeout = setTimeout(() => reject(new Error("Controller extension RAF timed out")), 15000); });
      auto.start(); await done; clearTimeout(timeout);
      const ids = new Uint32Array(handles.flatMap(h => [h.entityId, h.entityGeneration]));
      const states = auto.queryUnifiedPhysicsBodyStates(ids);
      const positions = handles.map((_, index) => [...states.floats.slice(index * L.stride + L.position, index * L.stride + L.position + 3)]);
      return { authored, configured, compoundAdded, positions, consumed, frames, steps, maxRustMs, entities: auto.entityCount(), playing: auto.dataSceneState(), position: L.position };
    } finally { clearTimeout(timeout); auto.destroy(); }
  });
  const a = r.authored, p = r.position;
  for (const flag of ["grid", "configured", "invalidRejected", "reset", "added", "compoundConfigured", "foreignRejected"]) assert.equal(a[flag], true, flag);
  assert.equal(a.backend, "unified-3d"); assert.equal(a.entities, 2);
  assert.equal(a.defaults.native[p], 5); assert.equal(a.defaults.span.elevation, 0);
  assert.equal(a.climbed.native[p], 15); assert.equal(a.climbed.span.elevation, 3);
  assert.equal(a.resetState.native[p], 5); assert.equal(a.resetState.span.elevation, 0); assert.deepEqual(a.replayed, a.climbed);
  assert.equal(a.occupied.native[p], 5); assert.equal(a.occupied.span.elevation, 0);
  assert.equal(a.clear.native[p], 15); assert.equal(a.clear.span.elevation, 3);
  assert.equal(r.playing, "playing"); assert.equal(r.entities, 5); assert.equal(r.configured.length, 5); assert(r.configured.every(Boolean));
  assert.equal(r.compoundAdded, true);
  assert(r.frames > 0 && r.steps >= 15 && Number.isFinite(r.maxRustMs));
  r.positions.forEach((at, index) => { assert(Math.abs(at[0] - 2 * r.consumed) < 0.004); assert(Math.abs(at[1] - index * 20) < 0.004); assert.equal(at[2], 0); });
  return r;
}
