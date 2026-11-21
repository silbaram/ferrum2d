import assert from "node:assert/strict";

export async function probeHd2dNative(page) {
  const r = await page.evaluate(async () => {
    const { createEngine, UNIFIED_PHYSICS_STATE_LAYOUT: L } = await import("@ferrum2d/ferrum-web/core");
    const { applyPhysicsSceneProfile } = await import("@ferrum2d/ferrum-web/authoring");
    let frames = 0, nativeSteps = 0, maxRustMs = 0;
    const e = await createEngine(frame => { frames++; nativeSteps += frame.unifiedPhysics?.frame.backendSteps ?? 0; maxRustMs = Math.max(maxRustMs, frame.rustUpdateTimeMs); });
    let profile;
    try {
      e.useDataScene();
      profile = applyPhysicsSceneProfile(e, { physics: { mode: "rigid", gravity: [0, 0], solver: { stepSeconds: 0.01 },
        hd2d: { enabled: true, defaultHeight: 1 }, bodies: { actor: { type: "kinematic", position: [0.5, 0.5], collider: { shape: "box", size: [0.5, 0.5] } } } } });
      const a = profile.world.bodies.actor, handles = new Uint32Array([a.entityId, a.entityGeneration]);
      const move = (x, y, options = {}) => e.moveHd2dKinematicBodyWithTilemap(a, { displacementX: x, displacementY: y, ...options });
      const state = () => ({ native: [...e.queryUnifiedPhysicsBodyStates(handles).floats], span: e.getPhysicsBodyHeightSpan(a) });
      const place = (x, y, elevation = 0) => {
        e.setUnifiedPhysicsPoses(handles, new Float32Array([x, y, 0, 0, 0, 0, 1]));
        if (!e.setPhysicsBodyHeightSpan(a, { floorId: 0, elevation, height: 1 })) throw new Error("height span setup rejected");
      };
      const obstacle = e.spawnUnifiedPhysicsBody({ kind: "fixed", pose: { position: [2, 2, 0] },
        collider: { shape: { type: "box", halfExtents: [0.25, 4, 2] }, category: 8 } });
      const slide = move(3, 2), slid = state();
      e.removeUnifiedPhysicsBody(obstacle);
      const rampMap = e.configureDataSceneCollisionTilemap({ columns: 1, rows: 1, tileWidth: 10, tileHeight: 10, tiles: [1],
        definitions: [{ id: 1, kind: "ramp", blocksMovement: false, ramp: { axis: "x", startElevation: 0, endElevation: 8 } }] });
      place(0, 5);
      const ramp = move(5, 0, { maxStepHeight: 8, maxDropHeight: 8 }), climbed = state();
      const stepMap = e.configureDataSceneCollisionTilemap({ columns: 2, rows: 1, tileWidth: 10, tileHeight: 10, tiles: [1, 2],
        definitions: [{ id: 1, blocksMovement: false }, { id: 2, elevation: 3, blocksMovement: false }] });
      place(5, 5);
      const blockedStep = move(10, 0, { maxStepHeight: 2 }), afterBlockedStep = state();
      const blocker = e.spawnRigidBody({ x: 15, y: 5, bodyType: "static", layer: "wall", collider: { type: "aabb", halfWidth: 2, halfHeight: 2 },
        heightSpan: { floorId: 0, elevation: 3, height: 1 } });
      const occupied = move(10, 0, { maxStepHeight: 4 }), afterOccupied = state();
      e.despawnPhysicsEntity(blocker);
      const checkpoint = e.captureRuntimeCheckpoint();
      const step = move(10, 0, { maxStepHeight: 4 }), expected = state();
      e.restoreRuntimeCheckpoint(checkpoint);
      const replayStep = move(10, 0, { maxStepHeight: 4 }), replayed = state(); checkpoint.dispose();
      const bridgeMap = e.configureDataSceneCollisionTilemap({ columns: 3, rows: 1, tileWidth: 10, tileHeight: 10, tiles: [0, 1, 0],
        definitions: [{ id: 1, kind: "bridge", floorId: 1, elevation: 16, height: 4, blocksMovement: false }] });
      place(0, 5);
      const bridge = move(20, 0), belowBridge = state();
      const cleared = e.configureDataSceneCollisionTilemap(false);
      e.start(); await new Promise(resolve => setTimeout(resolve, 120)); e.stop();
      return { backend: e.physicsBackend(), playing: e.dataSceneState(), slide, slid, rampMap, ramp, climbed, stepMap, blockedStep, afterBlockedStep,
        occupied, afterOccupied, step, replayStep, expected, replayed, bridgeMap, bridge, belowBridge, cleared, frames, nativeSteps, maxRustMs, position: L.position };
    } finally { e.stop(); profile?.clear(); e.destroy(); }
  });
  assert.equal(r.backend, "unified-3d"); assert.equal(r.playing, "playing");
  for (const key of ["rampMap", "stepMap", "bridgeMap", "cleared"]) assert.equal(r[key], true, key);
  assert(r.slide?.blockedX && r.slide.hitCount > 0);
  assert(Math.abs(r.slid.native[r.position] - 1.5) < 0.002 && Math.abs(r.slid.native[r.position + 1] - 2.5) < 0.002);
  assert(r.ramp?.steppedUp && Math.abs(r.ramp.elevationDelta - 4) < 0.001); assert.equal(r.climbed.span.elevation, 4);
  assert(r.blockedStep?.blockedByStep); assert.equal(r.afterBlockedStep.native[r.position], 5); assert.equal(r.afterBlockedStep.span.elevation, 0);
  assert(r.occupied?.blockedByStep); assert.equal(r.afterOccupied.native[r.position], 5); assert.equal(r.afterOccupied.span.elevation, 0);
  assert(r.step?.steppedUp && r.replayStep?.steppedUp); assert.deepEqual(r.replayed, r.expected);
  assert(r.bridge?.passedUnderBridge); assert.equal(r.belowBridge.span.floorId, 0); assert.equal(r.belowBridge.native[r.position], 20);
  assert(r.frames > 0 && r.nativeSteps > 0 && Number.isFinite(r.maxRustMs));
  return r;
}
