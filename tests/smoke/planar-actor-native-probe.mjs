import assert from "node:assert/strict";

export async function probePlanarActorNative(page) {
  const result = await page.evaluate(async () => {
    const { createEngine, UNIFIED_PHYSICS_STATE_LAYOUT: L } = await import("@ferrum2d/ferrum-web/core");
    const { applyPhysicsSceneProfile } = await import("@ferrum2d/ferrum-web/authoring");
    const originalRaf = window.requestAnimationFrame, originalCancel = window.cancelAnimationFrame;
    const pending = new Map();
    let next = 0, timestamp = 0, frames = 0, nativeSteps = 0, hits = 0, candidates = 0, maxRustMs = 0;
    window.requestAnimationFrame = callback => { const id = ++next; pending.set(id, callback); return id; };
    window.cancelAnimationFrame = id => { pending.delete(id); };
    const pump = delta => {
      timestamp += delta;
      const callbacks = [...pending.values()]; pending.clear();
      if (callbacks.length !== 1) throw new Error(`Expected one actor RAF callback, got ${callbacks.length}`);
      callbacks[0](timestamp);
    };
    let e, scene;
    try {
      e = await createEngine(frame => {
        frames++; nativeSteps += frame.unifiedPhysics?.frame.backendSteps ?? 0;
        hits += frame.physics.kinematicHits; candidates += frame.physics.solidCandidateChecks;
        maxRustMs = Math.max(maxRustMs, frame.rustUpdateTimeMs);
      });
      e.useDataScene();
      scene = applyPhysicsSceneProfile(e, { physics: {
        mode: "rigid", gravity: [0, 0], solver: { stepSeconds: 0.01 },
        layers: { actor: { mask: ["solid"] }, solid: { mask: ["actor"] } },
        bodies: { actor: { type: "kinematic", position: [0.5, 0.5], layer: "actor", collider: { shape: "box", size: [0.5, 0.5] } } },
      } });
      const actor = scene.world.bodies.actor;
      const handles = new Uint32Array([actor.entityId, actor.entityGeneration]);
      const body = () => [...e.queryUnifiedPhysicsBodyStates(handles).floats];
      const run = (count, first = false) => {
        if (first) e.start(); else e.resume();
        pump(100);
        for (let i = 0; i < count; i++) pump(10);
        e.pause();
      };
      const gameplay = e.configureDataSceneGameplay({ primaryActor: actor });
      const grid = e.configureDataSceneNavigation({ columns: 12, rows: 6, cellWidth: 1, cellHeight: 1, costs: Array(72).fill(1) });
      const obstacle = e.spawnUnifiedPhysicsBody({ kind: "fixed", pose: { position: [4.5, 1.05, 0] },
        collider: { shape: { type: "sphere", radius: 0.5 }, category: 2, mask: 1 } });
      const obstacleHasLegacyCollider = e.getPhysicsEntity(obstacle) !== undefined;
      const planned = e.moveDataSceneActorTo({ x: 9.5, y: 0.5, speed: 1000, arrivalRadius: 0, solidMaskBits: 2 });
      run(3, true);
      const blocked = body(), blockedStatus = e.dataSceneMoveStatus();
      const projection = e.capturePhysicsBodyStateBuffer([actor]).states[0];
      e.removeUnifiedPhysicsBody(obstacle);
      let removed = false;
      try { e.queryUnifiedPhysicsBodyStates(new Uint32Array([obstacle.entityId, obstacle.entityGeneration])); }
      catch { removed = true; }
      const resumed = e.moveDataSceneActorTo({ x: 9.5, y: 0.5, speed: 2, arrivalRadius: 0, solidMaskBits: 2 });
      run(5);
      const checkpoint = e.captureRuntimeCheckpoint();
      run(10);
      const expected = body(), expectedStatus = e.dataSceneMoveStatus();
      e.restoreRuntimeCheckpoint(checkpoint);
      run(10);
      const replayed = body(), replayedStatus = e.dataSceneMoveStatus();
      checkpoint.dispose();
      const finalPlanned = e.moveDataSceneActorTo({ x: 9.5, y: 0.5, speed: 1000, arrivalRadius: 0, solidMaskBits: 2 });
      run(3);
      return { backend: e.physicsBackend(), playing: e.dataSceneState(), gameplay, grid, planned, resumed, removed, finalPlanned,
        obstacleHasLegacyCollider, blocked, blockedStatus, projection, expected, expectedStatus, replayed, replayedStatus,
        arrived: body(), arrivedStatus: e.dataSceneMoveStatus(), frames, nativeSteps, hits, candidates, maxRustMs, position: L.position };
    } finally {
      e?.stop(); scene?.clear(); e?.destroy();
      window.requestAnimationFrame = originalRaf; window.cancelAnimationFrame = originalCancel;
    }
  });
  assert.equal(result.backend, "unified-3d"); assert.equal(result.playing, "playing");
  for (const key of ["gameplay", "grid", "planned", "resumed", "removed", "finalPlanned"]) assert.equal(result[key], true, key);
  assert.equal(result.obstacleHasLegacyCollider, false);
  assert.equal(result.blockedStatus, "blocked");
  assert(result.blocked[result.position] > 3.8 && result.blocked[result.position] < 4, JSON.stringify(result));
  assert.equal(result.projection.x, result.blocked[result.position]);
  assert.deepEqual(result.replayed, result.expected); assert.equal(result.replayedStatus, result.expectedStatus);
  assert.equal(result.arrivedStatus, "arrived"); assert.equal(result.arrived[result.position], 9.5);
  assert(result.frames > 0 && result.nativeSteps > 0 && result.hits > 0 && result.candidates > 0);
  assert(Number.isFinite(result.maxRustMs));
  return result;
}
