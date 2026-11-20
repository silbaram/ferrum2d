import assert from "node:assert/strict";

// Pending edits are created after the backend has bootstrapped its islands.
// Core tests compare the complete stored bytes; this checks the public SDK's
// outer checkpoint and observable continuation with the actual packed Wasm.
export async function probePendingJointRuntimeCheckpoint(page) {
  const rows = await page.evaluate(async () => {
    const { createEngine, UNIFIED_PHYSICS_STATE_LAYOUT: B } = await import("@ferrum2d/ferrum-web/core");
    const rows = [];
    for (const space of ["planar-xy", "spatial"]) {
      const engine = await createEngine();
      let checkpoint;
      try {
        engine.useDataScene();
        engine.configureUnifiedPhysics({ space, gravity: [0, 0, 0], lengthUnit: 1, stepSeconds: 0.01 });
        const settings = { kind: "dynamic", canSleep: false, collider: { shape: { type: "sphere", radius: 0.1 } } };
        const a = engine.spawnUnifiedPhysicsBody(settings);
        const b = engine.spawnUnifiedPhysicsBody({ ...settings, pose: { position: [1, 0, 0] } });
        const handles = new Uint32Array([a.entityId, a.entityGeneration, b.entityId, b.entityGeneration]);
        engine.stepRigidBodies(Math.fround(0.01));
        const joint = engine.createUnifiedPhysicsJoint({
          bodyA: a, bodyB: b, kind: { type: "fixed" }, localFrameA: { position: [1, 0, 0] },
        });
        engine.addUnifiedPhysicsForces(new Uint32Array([b.entityId, b.entityGeneration]), new Float32Array([1, 0, 0, 0, 0, 0]));
        const observe = () => {
          const body = engine.queryUnifiedPhysicsBodyStates(handles);
          const bodies = { count: body.count, words: [...body.words], x: body.floats[B.position] };
          const joints = engine.queryUnifiedPhysicsJointStates(new Uint32Array([joint.slot, joint.generation]));
          const state = { count: joints.count, words: [...joints.words] };
          return { bodies, joints: state, diagnostics: engine.queryUnifiedPhysicsObservations().diagnostics };
        };
        const before = observe();
        checkpoint = engine.captureRuntimeCheckpoint();
        const trace = () => Array.from({ length: 6 }, () => {
          engine.stepRigidBodies(Math.fround(0.01));
          return observe();
        });
        const expected = trace();
        engine.removeUnifiedPhysicsJoint(joint);
        engine.restoreRuntimeCheckpoint(checkpoint);
        const restored = observe();
        const replayed = trace();
        rows.push({ space, before, restored, expected, replayed, revision: engine.runtimeCheckpointRevision() });
      } finally { checkpoint?.dispose(); engine.destroy(); }
    }
    return rows;
  });
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.before.bodies.count, 2);
    assert.equal(row.before.joints.count, 1);
    assert.equal(row.before.diagnostics.backend, "rapier3d");
    assert.equal(row.before.diagnostics.step.islands, 2);
    for (const sample of [...row.expected, ...row.replayed]) {
      assert.equal(sample.diagnostics.step.islands, 1, `${row.space}: the joint must connect both persistent islands`);
      assert.equal(sample.diagnostics.step.largestIslandBodies, 2);
      // Ferrum's joint path performs the configured four backend substeps.
      assert.equal(sample.diagnostics.step.backendSteps, 4);
    }
    assert.deepEqual(row.restored, row.before, `${row.space}: pending joint checkpoint must restore immediately`);
    assert.deepEqual(row.replayed, row.expected, `${row.space}: pending joint continuation must match`);
    assert.equal(row.revision, 1);
    assert.equal(row.expected.length, 6);
    assert(row.expected.at(-1).bodies.x > row.before.bodies.x, `${row.space}: coupled bodies must actually move`);
    row.exactReplay = true;
  }
  return rows;
}

export async function probeRuntimeCheckpoint(page) {
  const rows = await page.evaluate(async () => {
    const { createEngine, UNIFIED_PHYSICS_STATE_LAYOUT: B } = await import("@ferrum2d/ferrum-web/core");
    const { applyDataSceneAuthoringDocument } = await import("@ferrum2d/ferrum-web/authoring");
    const originalRaf = window.requestAnimationFrame, originalCancel = window.cancelAnimationFrame;
    const pending = new Map(); let next = 0, timestamp = 0;
    window.requestAnimationFrame = callback => { const id = ++next; pending.set(id, callback); return id; };
    window.cancelAnimationFrame = id => { pending.delete(id); };
    const pump = delta => {
      timestamp += delta; const callbacks = [...pending.values()]; pending.clear();
      if (callbacks.length !== 1) throw new Error(`Expected one owned RAF callback, got ${callbacks.length}`);
      callbacks[0](timestamp);
    };
    const rows = [];
    try {
      for (const space of ["planar-xy", "spatial"]) {
        const spatial = space === "spatial";
        let samples = [], handles, checkpoint, checkReentry = false, reentrantRejected = false;
        const e = await createEngine(frame => {
          // Copy borrowed render data before the following native query can allocate.
          const render = [...frame.renderCommandBuffer.buffer];
          const vertices = frame.renderCommandBuffer.spatial ? [...frame.renderCommandBuffer.spatial.billboards] : [];
          const view = e.queryUnifiedPhysicsBodyStates(handles);
          samples.push({ body: [...view.floats], words: [...view.words], render, vertices,
            steps: frame.physics.fixedSteps, consumed: frame.physics.fixedConsumedSeconds,
            time: e.time(), combat: e.dataSceneCombatStats(), navigation: e.dataSceneCombatNavigationStats(),
            scheduler: e.dataSceneCombatNavigationSchedulerStats(), crowd: e.dataSceneCombatCrowdStats() });
          if (checkReentry) {
            checkReentry = false; e.pause();
            try { e.restoreRuntimeCheckpoint(checkpoint); }
            catch (error) { reentrantRejected = /Pause or stop/.test(String(error)); }
            e.resume();
          }
        }, undefined, undefined, () => ({ width: 320, height: 180 }));
        const foreign = await createEngine();
        const run = (frames, first = false) => {
          samples = []; if (first) e.start(); else e.resume();
          pump(100);
          for (let i = 0; i < frames; i++) pump([3, 17, 11, 9][i % 4]);
          e.pause(); return samples;
        };
        const object = (id, x, body, recipe) => ({ id, prefab: "object", x, y: spatial ? 0 : 1,
          props: { behaviorRecipes: recipe ? [recipe] : [], components: {
            visual: { kind: "primitive", shape: "circle", radius: 0.3 }, collider: "none", layer: id === "player" ? "player" : "enemy", body } } });
        const actor = spatial ? { kind: "kinematic-position", elevation: 1,
          collider: { shape: { type: "capsule", halfHeight: 0.5, radius: 0.25 } }, character: {} }
          : { kind: "kinematic-velocity", collider: { shape: { type: "sphere", radius: 0.3 } } };
        const document = { format: "ferrum2d.consumer.scene-authoring", version: 1,
          physics: { space, gravity: [0, spatial ? -10 : 0, 0], lengthUnit: 1, stepSeconds: 0.01 },
          gameplay: { primaryActor: "player", combat: true, ...(spatial ? { combatNavigation: {
            movementPatterns: "all", cellSize: 0.5, maxStepHeight: 0.3, maxDropHeight: 0.2,
            repathIntervalSeconds: 0.1, arrivalRadius: 1, maxAgents: 1, crowdAvoidance: { padding: 0.1 },
          } } : {}) },
          sceneComposition: { initialFragment: "main", prefabs: { object: {} }, fragments: { main: { instances: [
            object("player", 4, { kind: "fixed", elevation: spatial ? 1 : 0, collider: { shape: { type: "sphere", radius: 0.3 } } }),
            object("enemy", 0, actor, "following"),
          ] } } },
          behaviorRecipes: { entities: { following: { recipes: [{ kind: "chase", target: "primaryActor", speed: 2, stopDistance: spatial ? 1 : 0 }] } } },
          ...(spatial ? { spatial: {
            camera: { projection: "orthographic", position: { x: 0, y: -20, elevation: 20 }, target: { x: 0, y: 0, elevation: 0 }, height: 15 },
            terrain: [{ id: "floor", x: -10, y: -10, width: 30, depth: 20, elevation: 0, baseElevation: -1 }],
            billboards: { player: {}, enemy: {} },
          } } : {}),
        };
        try {
          const applied = applyDataSceneAuthoringDocument(e, document, { textureId: () => 11 });
          if (!spatial) e.setDataSceneCamera({ x: 2, y: 1 });
          const h = applied.entityHandles.enemy; handles = new Uint32Array([h.entityId, h.entityGeneration]);
          if (spatial) for (let i = 0; i < 120; i++) e.stepRigidBodies(Math.fround(0.01));
          e.start(); let runningRejected = false;
          try { e.captureRuntimeCheckpoint(); } catch (error) { runningRejected = /Pause or stop/.test(String(error)); }
          e.pause(); e.stop(); checkpoint = e.captureRuntimeCheckpoint(); checkReentry = true;
          run(5, true); checkpoint.dispose();
          checkpoint = e.captureRuntimeCheckpoint();
          const before = [...e.queryUnifiedPhysicsBodyStates(handles).floats];
          const trace = run(60); const final = trace.at(-1).body;
          e.removeUnifiedPhysicsBody(h);
          const future = e.spawnUnifiedPhysicsBody({ pose: { position: [20, 0, 0] }, collider: { shape: { type: "sphere", radius: 0.2 } } });
          let foreignRejected = false, jsonRejected = false;
          try { foreign.restoreRuntimeCheckpoint(checkpoint); } catch (error) { foreignRejected = /different Engine/.test(String(error)); }
          try { JSON.stringify(checkpoint); } catch (error) { jsonRejected = /cannot be serialized/.test(String(error)); }
          e.restoreRuntimeCheckpoint(checkpoint);
          const restored = [...e.queryUnifiedPhysicsBodyStates(handles).floats];
          let futureRejected = false;
          try { e.queryUnifiedPhysicsBodyStates(new Uint32Array([future.entityId, future.entityGeneration])); } catch { futureRejected = true; }
          const replay = run(60);
          e.restoreRuntimeCheckpoint(checkpoint); const revision = e.runtimeCheckpointRevision();
          checkpoint.dispose(); checkpoint.dispose(); let disposedRejected = false;
          try { e.restoreRuntimeCheckpoint(checkpoint); } catch (error) { disposedRejected = /disposed/.test(String(error)); }
          const row = { space, positionIndex: B.position, supported: e.supportsRuntimeCheckpoints(), runningRejected, reentrantRejected, foreignRejected, jsonRejected, futureRejected, disposedRejected,
            before, restored, final, revision, trace, replay, foreignRevision: foreign.runtimeCheckpointRevision(), capturedRevision: checkpoint.capturedRevision };
          const survivor = e.captureRuntimeCheckpoint();
          e.destroy(); survivor.dispose(); row.postDestroyDisposed = true;
          rows.push(row);
        } finally { checkpoint?.dispose(); e.destroy(); foreign.destroy(); }
      }
      return rows;
    } finally { pending.clear(); window.requestAnimationFrame = originalRaf; window.cancelAnimationFrame = originalCancel; }
  });
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert(r.supported && r.runningRejected && r.reentrantRejected && r.foreignRejected && r.jsonRejected && r.futureRejected && r.disposedRejected && r.postDestroyDisposed);
    assert.equal(r.capturedRevision, 0); assert.equal(r.revision, 2); assert.equal(r.foreignRevision, 0);
    assert.deepEqual(r.restored, r.before); assert.deepEqual(r.replay, r.trace);
    assert.equal(r.trace.length, 60); assert(r.trace.reduce((n, f) => n + f.steps, 0) >= 55);
    assert(r.final[r.positionIndex] > r.before[r.positionIndex] + 0.5);
    assert(r.trace.some(f => f.render.length > 0 || f.vertices.length > 0), `${r.space} must submit visible render geometry`);
    // Preserve detailed exact-match evidence without duplicating every vertex in the report.
    r.frames = r.trace.length; r.exactReplay = true; r.last = r.trace.at(-1); delete r.trace; delete r.replay;
  }
  return rows;
}

// Exercise release Wasm with a genuinely suspended search, including a snapshot
// taken after a geometry edit but before the scheduler can observe its staleness.
export async function probePendingRuntimeCheckpoint(page) {
  const result = await page.evaluate(async () => {
    const { createEngine } = await import("@ferrum2d/ferrum-web/core");
    const { applyDataSceneAuthoringDocument } = await import("@ferrum2d/ferrum-web/authoring");
    const originalRaf = window.requestAnimationFrame, originalCancel = window.cancelAnimationFrame;
    const pending = new Map(); let next = 0, timestamp = 0, samples = [], handles;
    window.requestAnimationFrame = callback => { const id = ++next; pending.set(id, callback); return id; };
    window.cancelAnimationFrame = id => { pending.delete(id); };
    const pump = delta => {
      timestamp += delta; const callbacks = [...pending.values()]; pending.clear();
      if (callbacks.length !== 1) throw new Error(`Expected one pending-search RAF, got ${callbacks.length}`);
      callbacks[0](timestamp);
    };
    const e = await createEngine(frame => {
      const render = [...frame.renderCommandBuffer.buffer];
      const vertices = frame.renderCommandBuffer.spatial ? [...frame.renderCommandBuffer.spatial.billboards] : [];
      samples.push({ ...observe(), render, vertices, steps: frame.physics.fixedSteps });
    }, undefined, undefined, () => ({ width: 320, height: 180 }));
    function observe() {
      const state = e.queryUnifiedPhysicsBodyStates(handles);
      return { bodies: [...state.floats], words: [...state.words], time: e.time(),
        navigation: e.dataSceneCombatNavigationStats(), scheduler: e.dataSceneCombatNavigationSchedulerStats() };
    }
    const run = () => {
      samples = []; e.resume(); pump(100);
      for (let i = 0; i < 12; i++) pump([3, 17, 11, 9][i % 4]);
      e.pause(); return samples;
    };
    const capsule = { kind: "kinematic-position", elevation: 1,
      collider: { shape: { type: "capsule", halfHeight: 0.5, radius: 0.25 } }, character: {} };
    const object = (id, x, recipe) => ({ id, prefab: "object", x, y: 0, props: {
      behaviorRecipes: recipe ? ["following"] : [], components: {
        visual: { kind: "primitive", shape: "circle", radius: 0.3 }, collider: "none",
        layer: id === "player" ? "player" : "enemy", body: capsule,
      } } });
    const document = { format: "ferrum2d.consumer.scene-authoring", version: 1,
      physics: { space: "spatial", gravity: [0, -10, 0], lengthUnit: 1, stepSeconds: 0.01 },
      gameplay: { primaryActor: "player", combat: true, combatNavigation: {
        cellSize: 0.5, maxStepHeight: 0.3, maxDropHeight: 0.2, repathIntervalSeconds: 0.1,
        arrivalRadius: 1, maxAgents: 8,
      } },
      sceneComposition: { initialFragment: "main", prefabs: { object: {} }, fragments: { main: {
        instances: [object("player", 40, false), object("enemy", 0, true)],
      } } },
      behaviorRecipes: { entities: { following: { recipes: [{ kind: "chase", target: "primaryActor", speed: 2, stopDistance: 1 }] } } },
      spatial: { camera: { projection: "orthographic", position: { x: 20, y: -60, elevation: 60 },
        target: { x: 20, y: 0, elevation: 0 }, height: 60 },
        terrain: [{ id: "floor", x: -10, y: -10, width: 80, depth: 20, elevation: 0, baseElevation: -1 }],
        billboards: { player: {}, enemy: {} },
      },
    };
    let checkpoint, staleCheckpoint;
    try {
      const applied = applyDataSceneAuthoringDocument(e, document, { textureId: () => 11 });
      const sensor = { shape: { type: "sphere", radius: 0.1 }, sensor: true };
      const sensors = Array.from({ length: 1400 }, (_, i) => e.spawnUnifiedPhysicsBody({
        kind: "fixed", pose: { position: [500 + i, 1, 0] }, collider: sensor,
      }));
      const entities = [applied.entityHandles.player, applied.entityHandles.enemy, ...sensors];
      handles = new Uint32Array(entities.flatMap(h => [h.entityId, h.entityGeneration]));
      for (let i = 0; i < 120; i++) e.stepRigidBodies(Math.fround(0.01));
      e.start(); pump(100);
      for (let i = 0; i < 10 && !e.dataSceneCombatNavigationSchedulerStats().pendingSearches; i++) pump(10);
      e.pause();
      const before = observe();
      if (before.scheduler.pendingSearches !== 1) throw new Error("Large fixture must suspend a real native search");
      checkpoint = e.captureRuntimeCheckpoint();
      const trace = run();
      e.restoreRuntimeCheckpoint(checkpoint); const restored = observe();
      const replay = run();
      e.restoreRuntimeCheckpoint(checkpoint);
      const [collider] = e.queryUnifiedPhysicsColliders(sensors[0]);
      e.updateUnifiedPhysicsCollider(sensors[0], collider, sensor);
      const staleBefore = observe(); staleCheckpoint = e.captureRuntimeCheckpoint();
      const staleTrace = run();
      e.restoreRuntimeCheckpoint(staleCheckpoint); const staleRestored = observe();
      const staleReplay = run();
      return { sensors: sensors.length, bodies: entities.length, before, restored, trace, replay,
        staleBefore, staleRestored, staleTrace, staleReplay, revision: e.runtimeCheckpointRevision() };
    } finally {
      checkpoint?.dispose(); staleCheckpoint?.dispose(); e.destroy(); pending.clear();
      window.requestAnimationFrame = originalRaf; window.cancelAnimationFrame = originalCancel;
    }
  });
  assert.equal(result.sensors, 1400); assert.equal(result.bodies, 1402); assert.equal(result.revision, 3);
  assert.equal(result.before.scheduler.pendingSearches, 1);
  assert.deepEqual(result.before, result.restored); assert.deepEqual(result.trace, result.replay);
  assert.deepEqual(result.staleBefore, result.staleRestored); assert.deepEqual(result.staleTrace, result.staleReplay);
  assert.equal(result.trace.length, 12); assert.equal(result.staleTrace.length, 12);
  assert.equal(result.trace.at(-1).scheduler.cancelledSearches, result.before.scheduler.cancelledSearches);
  assert(result.trace.at(-1).scheduler.searchSlices > result.before.scheduler.searchSlices);
  assert(result.staleTrace.at(-1).scheduler.cancelledSearches > result.staleBefore.scheduler.cancelledSearches);
  for (const trace of [result.trace, result.staleTrace]) {
    assert(trace.some(f => f.vertices.length > 0)); assert(trace.reduce((n, f) => n + f.steps, 0) >= 10);
    assert(trace.every(f => f.navigation.frameWorkUnits <= 1_000_000));
  }
  return { sensors: result.sensors, queriedBodies: result.bodies, framesPerReplay: 12, exactReplay: true,
    pendingAtCapture: result.before.scheduler.pendingSearches,
    validCancelled: result.trace.at(-1).scheduler.cancelledSearches,
    staleCancelled: result.staleTrace.at(-1).scheduler.cancelledSearches,
    revision: result.revision, bodyWordsFloatsAndBillboardCommandsCompared: true };
}
