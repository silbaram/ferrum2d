import assert from "node:assert/strict";

export async function probeArcadeNative(page) {
  const r = await page.evaluate(async () => {
    const { createEngine, resolvePhysicsSpec, UNIFIED_PHYSICS_STATE_LAYOUT: L } = await import("@ferrum2d/ferrum-web/core");
    const { applyPhysicsSceneProfile, createPhysicsWorldFromSpec, applyDataSceneAuthoringDocument } = await import("@ferrum2d/ferrum-web/authoring");
    const { capturePhysicsWorldSnapshot, restorePhysicsWorldSnapshot, hashPhysicsWorldSnapshot } = await import("@ferrum2d/ferrum-web/quality");
    // mode is intentionally omitted: the authored default remains arcade.
    const physics = { gravity: [0, 0], solver: { stepSeconds: 0.01 }, bodies: {
      moving: { type: "dynamic", position: [0, 0], velocity: [1, 0], mass: 1, canSleep: false, collider: { shape: "circle", radius: 0.25 } },
    } };
    const ids = handles => new Uint32Array(handles.flatMap(h => [h.entityId, h.entityGeneration]));
    const states = (engine, handles) => [...engine.queryUnifiedPhysicsBodyStates(ids(handles)).floats];
    const manualEngine = await createEngine(() => {}); let manual;
    try {
      manualEngine.useDataScene();
      const profile = applyPhysicsSceneProfile(manualEngine, { profile: "manual", physics });
      const h = profile.world.bodies.moving, before = states(manualEngine, [h]);
      manualEngine.start(); await new Promise(resolve => setTimeout(resolve, 70)); manualEngine.stop();
      const idle = states(manualEngine, [h]);
      manualEngine.stepRigidBodies(profile.stepSeconds, profile.stepOptions); const moved = states(manualEngine, [h]);
      const checkpoint = manualEngine.captureRuntimeCheckpoint(); manualEngine.stepRigidBodies(profile.stepSeconds, profile.stepOptions);
      manualEngine.restoreRuntimeCheckpoint(checkpoint); const restored = states(manualEngine, [h]); checkpoint.dispose();
      let jsonRejected = false;
      try { capturePhysicsWorldSnapshot(manualEngine, profile.world); }
      catch (error) { jsonRejected = /runtime checkpoints/.test(String(error)); }
      const rejects = [];
      for (const spec of [{ mode: "none" }, { mode: "arcade", solver: { fixedTimestep: false, stepSeconds: 0.02 } },
        { mode: "arcade", solver: { stepSeconds: 0.01, velocityIterations: 0 } }]) {
        try { manualEngine.configurePhysicsRuntime(resolvePhysicsSpec(spec)); rejects.push(false); } catch { rejects.push(true); }
      }
      const afterRejections = states(manualEngine, [h]);
      const extra = createPhysicsWorldFromSpec(manualEngine, { mode: "arcade", gravity: [0, 0], solver: { stepSeconds: 0.01 },
        bodies: { wall: { type: "static", position: [20, 0], collider: { shape: "box", size: [1, 1] } } } });
      const afterAddition = states(manualEngine, [h]);
      const rigid = manualEngine.configurePhysicsRuntime(resolvePhysicsSpec({ mode: "rigid", gravity: [0, 0], continuous: false,
        solver: { stepSeconds: 0.01, velocityIterations: 1, positionIterations: 1, sleep: false } }));
      const arcade = manualEngine.configurePhysicsRuntime(resolvePhysicsSpec(physics));
      const variable = manualEngine.configurePhysicsRuntime(resolvePhysicsSpec({ ...physics,
        solver: { fixedTimestep: false, stepSeconds: 0.01 } }));
      const variableBefore = states(manualEngine, [h]);
      manualEngine.stepRigidBodies(0.017, profile.stepOptions);
      const variableAfter = states(manualEngine, [h]);
      manual = { backend: manualEngine.physicsBackend(), mode: profile.world.spec.mode, autoStep: profile.autoStep,
        before, idle, moved, restored, jsonRejected, rejects, afterRejections, afterAddition,
        rigidMode: rigid.mode, arcadeMode: arcade.mode, variableMode: variable.mode,
        variableBefore, variableAfter, entities: manualEngine.entityCount() };
      extra.clear(); profile.clear();
    } finally { manualEngine.destroy(); }

    let frames = 0, steps = 0, consumed = 0, mode, maxRustMs = 0, finish, timeout;
    const runtimeEngine = await createEngine(frame => {
      frames++; steps += frame.unifiedPhysics?.frame.backendSteps ?? 0; consumed += frame.physics.fixedConsumedSeconds;
      mode = frame.physics.mode; maxRustMs = Math.max(maxRustMs, frame.rustUpdateTimeMs);
      if (consumed >= 0.15) { runtimeEngine.pause(); finish?.(); }
    });
    let runtime;
    try {
      runtimeEngine.useDataScene();
      const profile = applyPhysicsSceneProfile(runtimeEngine, { physics });
      const doc = { format: "ferrum2d.consumer.scene-authoring", version: 1, behaviorRecipes: { entities: {} },
        sceneComposition: { initialFragment: "main", prefabs: { object: {} }, fragments: { main: { instances: [
          { id: "target", prefab: "object", x: 100, y: 20, props: { components: { visual: { kind: "primitive", shape: "circle", radius: 0.25 }, collider: { type: "circle", radius: 0.25 }, layer: "player" } } },
          { id: "runner", prefab: "object", x: 0, y: 20, props: { components: { visual: { kind: "primitive", shape: "circle", radius: 0.25 }, collider: { type: "circle", radius: 0.25 }, layer: "enemy" } } },
        ] } } } };
      // Append collider-only actors after native setup to exercise the cold import path.
      const applied = applyDataSceneAuthoringDocument(runtimeEngine, doc, { textureId: () => 11, activateDataScene: false });
      const actor = applied.entityHandles.runner, target = applied.entityHandles.target;
      const implicitSettingsRejected = !runtimeEngine.configureDataSceneKinematicController(actor, {});
      const combat = runtimeEngine.configureDataSceneGameplay({ primaryActor: target, combat: true });
      runtimeEngine.applyGameplayBehaviorCommands([{ type: "configureAccelerate", entity: "runner", accelerationX: 1, accelerationY: 0, maxSpeed: 4 }], { runner: actor });
      const done = new Promise((resolve, reject) => { finish = resolve; timeout = setTimeout(() => reject(new Error("Arcade native RAF timed out")), 15000); });
      runtimeEngine.start(); await done; clearTimeout(timeout);
      const handles = [profile.world.bodies.moving, actor, target], automatic = states(runtimeEngine, handles);
      const aiSteps = runtimeEngine.dataSceneCombatStats().aiSteps;
      const checkpoint = runtimeEngine.captureRuntimeCheckpoint(); runtimeEngine.stepRigidBodies(profile.stepSeconds, profile.stepOptions);
      const expected = states(runtimeEngine, handles); runtimeEngine.restoreRuntimeCheckpoint(checkpoint);
      runtimeEngine.stepRigidBodies(profile.stepSeconds, profile.stepOptions); const replayed = states(runtimeEngine, handles); checkpoint.dispose();
      runtime = { backend: runtimeEngine.physicsBackend(), mode, autoStep: profile.autoStep, implicitSettingsRejected, combat,
        automatic, expected, replayed, aiSteps, frames, steps, consumed, maxRustMs, entities: runtimeEngine.entityCount(), playing: runtimeEngine.dataSceneState() };
    } finally { clearTimeout(timeout); runtimeEngine.destroy(); }

    const legacyEngine = await createEngine(() => {}, undefined, undefined, undefined, { physicsBackend: "legacy" }); let legacy;
    try {
      legacyEngine.useDataScene(); const initialBackend = legacyEngine.physicsBackend();
      const none = applyPhysicsSceneProfile(legacyEngine, { physics: { mode: "none" } });
      const noneBackend = legacyEngine.physicsBackend(), noneAutoStep = none.autoStep;
      none.clear();
      legacyEngine.configureFixedTimestep(false);
      // This fixture deliberately stages the old JSON format under an already
      // selected legacy runtime. Normal variable Physics Spec authoring is native.
      const variable = createPhysicsWorldFromSpec(legacyEngine,
        { ...physics, mode: "arcade", solver: { fixedTimestep: false, stepSeconds: 0.01 } }, { configureRuntime: false });
      const idleBefore = legacyEngine.getPhysicsEntity(variable.bodies.moving);
      legacyEngine.start(); await new Promise(resolve => setTimeout(resolve, 70)); legacyEngine.stop();
      const idleAfter = legacyEngine.getPhysicsEntity(variable.bodies.moving);
      legacyEngine.stepRigidBodies(0.02, variable.stepOptions);
      const snapshot = capturePhysicsWorldSnapshot(legacyEngine, variable);
      const fixed = { ...snapshot, spec: { ...snapshot.spec, solver: { ...snapshot.spec.solver, fixedTimestep: true } }, replayHash: "" };
      fixed.replayHash = hashPhysicsWorldSnapshot(fixed);
      const before = legacyEngine.getPhysicsEntity(variable.bodies.moving);
      let fixedJsonRejected = false;
      try { restorePhysicsWorldSnapshot(legacyEngine, fixed, { replace: variable }); }
      catch (error) { fixedJsonRejected = /fixed-step arcade|runtime checkpoints/.test(String(error)); }
      const retained = legacyEngine.getPhysicsEntity(variable.bodies.moving);
      const restored = restorePhysicsWorldSnapshot(legacyEngine, snapshot, { replace: variable });
      legacy = { initialBackend, noneBackend, noneAutoStep, variableBackend: legacyEngine.physicsBackend(),
        idleBefore, idleAfter, fixedJsonRejected, before, retained,
        restored: legacyEngine.getPhysicsEntity(restored.bodies.moving), restoredBodyCount: restored.restoredBodyCount };
      restored.clear();
    } finally { legacyEngine.destroy(); }
    return { manual, runtime, legacy, position: L.position, velocity: L.linearVelocity, stride: L.stride };
  });
  const m = r.manual, a = r.runtime, l = r.legacy, p = r.position;
  assert.equal(m.backend, "unified-3d"); assert.equal(m.mode, "arcade"); assert.equal(m.autoStep, false);
  assert.deepEqual(m.idle, m.before); assert(m.moved[p] > m.before[p]); assert.deepEqual(m.restored, m.moved);
  assert(m.jsonRejected && m.rejects.every(Boolean)); assert.deepEqual(m.afterRejections, m.moved); assert.deepEqual(m.afterAddition, m.moved);
  assert.equal(m.rigidMode, "rigid"); assert.equal(m.arcadeMode, "arcade"); assert.equal(m.entities, 2);
  assert.equal(m.variableMode, "arcade");
  assert(Math.abs(m.variableAfter[p] - m.variableBefore[p] - 0.017) < 1e-5, "Variable Physics Spec must consume the actual native manual interval");
  assert.equal(a.backend, "unified-3d"); assert.equal(a.mode, "arcade"); assert.equal(a.autoStep, true); assert(a.implicitSettingsRejected && a.combat);
  assert.equal(a.entities, 3); assert.equal(a.playing, "playing"); assert(a.frames > 0 && a.steps >= 15 && Number.isFinite(a.maxRustMs));
  assert(Math.abs(a.automatic[p] - a.consumed) < 0.003); assert.equal(a.aiSteps, a.steps);
  assert(Math.abs(a.automatic[r.stride + p] - (0.04 * a.steps - 0.06)) < 0.004);
  assert.deepEqual(a.replayed, a.expected);
  assert.equal(l.initialBackend, "legacy"); assert.equal(l.noneBackend, "legacy"); assert.equal(l.noneAutoStep, true);
  assert.equal(l.variableBackend, "legacy"); assert.deepEqual(l.idleAfter, l.idleBefore); assert(l.fixedJsonRejected);
  assert.deepEqual(l.retained, l.before); assert.equal(l.restoredBodyCount, 1); assert(Math.abs(l.restored.x - 0.02) < 0.002);
  return r;
}
