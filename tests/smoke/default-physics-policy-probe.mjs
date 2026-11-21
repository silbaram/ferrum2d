import assert from "node:assert/strict";

export async function probeDefaultPhysicsPolicy(page) {
  const r = await page.evaluate(async () => {
    const { createEngine, resolvePhysicsSpec, UNIFIED_PHYSICS_STATE_LAYOUT: L } = await import("@ferrum2d/ferrum-web/core");
    const { applyDataSceneAuthoringDocument } = await import("@ferrum2d/ferrum-web/authoring");
    const originalRaf = window.requestAnimationFrame, originalCancel = window.cancelAnimationFrame;
    const pending = new Map();
    let next = 0, timestamp = 0;
    window.requestAnimationFrame = callback => { const id = ++next; pending.set(id, callback); return id; };
    window.cancelAnimationFrame = id => { pending.delete(id); };
    const pump = delta => {
      timestamp += delta;
      const callbacks = [...pending.values()]; pending.clear();
      if (callbacks.length !== 1) throw new Error(`Expected one default-policy RAF, got ${callbacks.length}`);
      callbacks[0](timestamp);
    };
    const live = new Set();
    const create = async options => {
      let samples = [], started = false, maxRustMs = 0;
      let input = { w: false, a: false, s: false, d: false, space: false, enter: false, mouseLeft: false, mouseX: 0, mouseY: 0 };
      const e = await createEngine(frame => {
        maxRustMs = Math.max(maxRustMs, frame.rustUpdateTimeMs);
        samples.push({ state: frame.gameState, entities: frame.entityCount, renderCount: frame.renderCommandBuffer.commandCount,
          nativeSteps: frame.unifiedPhysics?.frame.backendSteps ?? 0, mode: frame.physics.mode,
          fixed: frame.physics.fixedTimestepEnabled, step: frame.physics.fixedStepSeconds,
          steps: frame.physics.fixedSteps, consumed: frame.physics.fixedConsumedSeconds,
          dropped: frame.physics.fixedDroppedSeconds, gravity: [frame.physics.gravityX, frame.physics.gravityY],
          continuous: frame.physics.continuous });
      }, () => input, undefined, () => ({ width: 1200, height: 640 }), options);
      live.add(e);
      return { e,
        input: update => { input = { ...input, ...update }; },
        run: (deltas = [10]) => {
          samples = [];
          if (started) e.resume(); else { e.start(); started = true; }
          pump(100);
          for (const delta of deltas) pump(delta);
          e.pause(); return samples;
        },
        maxRustMs: () => maxRustMs,
        destroy: () => { e.destroy(); live.delete(e); },
      };
    };
    const ids = h => new Uint32Array([h.entityId, h.entityGeneration]);
    const state = (e, h) => [...e.queryUnifiedPhysicsBodyStates(ids(h)).floats];
    const sync = e => e.queryAabbBodies({ x: 600, y: 320, halfWidth: 1000, halfHeight: 1000 });
    const requireHandle = h => { if (!h) throw new Error("Expected a built-in scene handle"); return h; };
    const spawn = (e, x = 10, velocityX = 100) => e.spawnRigidBody({ x, y: 20, velocityX, bodyType: "kinematic",
      layer: "enemy", collider: { type: "circle", radius: 0.25 } });
    const nativeOptions = { physicsBackend: "unified", fixedTimestep: { enabled: true, stepSeconds: 0.01, maxFrameSeconds: 0.05, maxStepsPerUpdate: 3 } };
    let checkpoint;
    try {
      const legacy = [];
      for (const [name, options] of [["explicit-legacy", { physicsBackend: "legacy" }], ["explicit-variable", { physicsBackend: "legacy", physicsMode: "arcade", fixedTimestep: false }]]) {
        const h = await create(options), e = h.e;
        e.useDataScene(); const body = spawn(e, 0), before = e.getPhysicsEntity(body);
        const trace = h.run([10, 20]), after = e.getPhysicsEntity(body);
        legacy.push({ name, backend: e.physicsBackend(), before, after, trace, maxRustMs: h.maxRustMs() }); h.destroy();
      }

      const callerOptions = structuredClone(nativeOptions);
      const h = await create(callerOptions), e = h.e;
      // Reusing caller-owned options must not rewrite an established policy.
      callerOptions.physicsBackend = "legacy";
      callerOptions.fixedTimestep.enabled = false;
      callerOptions.fixedTimestep.stepSeconds = 0.02;
      const initialBackend = e.physicsBackend(), initialHero = requireHandle(e.builtInShooterPlayerHandle());
      const titleBefore = state(e, initialHero), titleTrace = h.run([10, 10]), titleAfter = state(e, initialHero);
      const inherited = e.setGameSpec({ world: { width: 960, height: 540 } });
      const summarize = spec => ({ mode: spec.mode, step: spec.solver.stepSeconds, fixed: spec.solver.fixedTimestep,
        gravity: [spec.gravityX, spec.gravityY], velocityIterations: spec.solver.velocityIterations,
        positionIterations: spec.solver.positionIterations, continuous: spec.continuous });
      const inheritedSummary = summarize(inherited.physics);
      inherited.physics.solver.stepSeconds = 0.02;
      inherited.physics.gravityX = 2; inherited.physics.gravityY = 30;
      const mutatedReturnTrace = h.run([10]);
      const inheritedAgain = e.setGameSpec({ world: { width: 980, height: 560 } });
      const inheritedAgainSummary = summarize(inheritedAgain.physics);
      sync(e); const shooter = requireHandle(e.builtInShooterPlayerHandle());
      const inheritedTrace = h.run([10]);
      e.useBreakoutGame(); sync(e);
      const breakoutBall = requireHandle(e.builtInBreakoutBallHandle());
      const breakout = { backend: e.physicsBackend(), previousStale: !e.gameplayEntityExists(shooter), body: state(e, breakoutBall), trace: h.run([10]) };
      e.usePlatformerGame(); sync(e);
      const platformerPlayer = requireHandle(e.builtInPlatformerPlayerHandle());
      const platformer = { backend: e.physicsBackend(), previousStale: !e.gameplayEntityExists(breakoutBall), body: state(e, platformerPlayer), trace: h.run([10]) };
      e.useDataScene();
      const dataEntry = { backend: e.physicsBackend(), entities: e.entityCount(), previousStale: !e.gameplayEntityExists(platformerPlayer) };
      const document = { format: "ferrum2d.consumer.scene-authoring", version: 1, behaviorRecipes: { entities: {} },
        sceneComposition: { initialFragment: "main", prefabs: { object: {} }, fragments: { main: { instances: [
          { id: "target", prefab: "object", x: 500, y: 100, props: { components: { visual: { kind: "primitive", shape: "circle", radius: 0.25 }, collider: { type: "circle", radius: 0.25 }, layer: "player" } } },
          { id: "runner", prefab: "object", x: 0, y: 100, props: { components: { visual: { kind: "primitive", shape: "circle", radius: 0.25 }, collider: { type: "circle", radius: 0.25 }, layer: "enemy" } } },
        ] } } } };
      const applied = applyDataSceneAuthoringDocument(e, document, { textureId: () => 11 });
      const documentBackend = e.physicsBackend();
      const actor = applied.entityHandles.runner, target = applied.entityHandles.target;
      const combat = e.configureDataSceneGameplay({ primaryActor: target, combat: true });
      e.applyGameplayBehaviorCommands([{ type: "configureAccelerate", entity: "runner", accelerationX: 1, accelerationY: 0, maxSpeed: 4 }], { runner: actor });
      sync(e);
      const actorBefore = state(e, actor), noRigidComponent = e.getPhysicsEntity(actor) === undefined;
      const actorFirstTrace = h.run([10]), actorFirst = state(e, actor);
      const actorMoreTrace = h.run([10, 10, 10, 10]), actorFive = state(e, actor);
      const capTrace = h.run([100]), actorCapped = state(e, actor);
      const rejects = [];
      for (const physics of [{ mode: "none" }, { mode: "arcade", solver: { fixedTimestep: false } }, { mode: "arcade", solver: { stepSeconds: 0.02 } },
        { mode: "arcade", gravity: [2, 30], solver: { stepSeconds: 0.02 } }]) {
        const before = state(e, actor), entities = e.entityCount(); let error;
        try { e.setGameSpec({ physics }); } catch (failure) { error = String(failure); }
        sync(e);
        rejects.push({ error, before, after: state(e, actor), entitiesBefore: entities, entitiesAfter: e.entityCount(), actorLive: e.gameplayEntityExists(actor), scene: e.dataSceneState() });
      }
      checkpoint = e.captureRuntimeCheckpoint();
      const savedActor = state(e, actor);
      const future = () => {
        h.input({ space: true, enter: false, d: false });
        e.useBreakoutGame(); sync(e);
        const breakStart = h.run([10]), ball = requireHandle(e.builtInBreakoutBallHandle());
        h.input({ space: false });
        const breakStep = h.run([10]), ballState = state(e, ball);
        e.usePlatformerGame(); sync(e); h.input({ enter: true, d: true });
        const platformStart = h.run([10]), player = requireHandle(e.builtInPlatformerPlayerHandle());
        h.input({ enter: false });
        const platformStep = h.run([10]), playerState = state(e, player);
        e.useDataScene(); const body = spawn(e); sync(e);
        const dataStep = h.run([10]), dataState = state(e, body);
        return { backend: e.physicsBackend(), breakStart, breakStep, ballState, platformStart, platformStep, playerState, dataStep, dataState };
      };
      const expectedFuture = future();
      e.restoreRuntimeCheckpoint(checkpoint); sync(e);
      const restoredActor = state(e, actor), replayedFuture = future();
      checkpoint.dispose(); checkpoint = undefined;
      const automatic = { initialBackend, titleBefore, titleTrace, titleAfter,
        inherited: inheritedSummary, inheritedAgain: inheritedAgainSummary, mutatedReturnTrace,
        mutatedCallerOptions: { backend: callerOptions.physicsBackend, fixed: callerOptions.fixedTimestep.enabled, step: callerOptions.fixedTimestep.stepSeconds },
        inheritedTrace, breakout, platformer, dataEntry, documentBackend, noRigidComponent, combat,
        actorBefore, actorFirstTrace, actorFirst, actorMoreTrace, actorFive, capTrace, actorCapped, rejects,
        savedActor, restoredActor, expectedFuture, replayedFuture, maxRustMs: h.maxRustMs() };
      h.destroy();

      const m = await create(nativeOptions), me = m.e;
      me.configureAutoRigidBodyStep(false); me.useDataScene();
      const manualBody = spawn(me); sync(me);
      const manualBefore = state(me, manualBody), idleTrace = m.run([10, 20]), manualIdle = state(me, manualBody);
      me.stepRigidBodies(Math.fround(0.01)); const manualMoved = state(me, manualBody);
      me.useBreakoutGame(); me.resetGame(); sync(me); m.input({ d: true });
      const manualBall = requireHandle(me.builtInBreakoutBallHandle()), manualPaddle = requireHandle(me.builtInBreakoutPaddleHandle());
      const ballBefore = state(me, manualBall), paddleBefore = state(me, manualPaddle);
      const breakIdleTrace = m.run([10]), ballIdle = state(me, manualBall), paddleIdle = state(me, manualPaddle);
      me.stepRigidBodies(Math.fround(0.01)); const ballMoved = state(me, manualBall), paddleMoved = state(me, manualPaddle);
      me.usePlatformerGame(); me.resetGame(); sync(me);
      const manualPlayer = requireHandle(me.builtInPlatformerPlayerHandle()), playerBefore = state(me, manualPlayer);
      const platformIdleTrace = m.run([10]), playerIdle = state(me, manualPlayer);
      me.stepRigidBodies(Math.fround(0.01)); const playerMoved = state(me, manualPlayer);
      me.useDataScene(); const finalBody = spawn(me, 0, 10); sync(me);
      const dataIdleTrace = m.run([10]), dataIdle = state(me, finalBody);
      me.stepRigidBodies(Math.fround(0.01)); const dataMoved = state(me, finalBody);
      checkpoint = me.captureRuntimeCheckpoint();
      me.configureAutoRigidBodyStep(true); me.useBreakoutGame(); me.resetGame();
      const enabledTrace = m.run([10]);
      me.restoreRuntimeCheckpoint(checkpoint); sync(me);
      const restoredManualTrace = m.run([10]), restoredManual = state(me, finalBody);
      checkpoint.dispose(); checkpoint = undefined;
      const manual = { backend: me.physicsBackend(), manualBefore, idleTrace, manualIdle, manualMoved,
        ballBefore, paddleBefore, breakIdleTrace, ballIdle, paddleIdle, ballMoved, paddleMoved,
        playerBefore, platformIdleTrace, playerIdle, playerMoved, dataIdleTrace, dataIdle, dataMoved,
        enabledTrace, restoredManualTrace, restoredManual, maxRustMs: m.maxRustMs() }; m.destroy();

      const meta = await create(nativeOptions), se = meta.e;
      se.useDataScene();
      const customPhysics = step => resolvePhysicsSpec({ mode: "rigid", gravity: [2, 30], continuous: true,
        solver: { stepSeconds: step, velocityIterations: 4, positionIterations: 2 } });
      let customStepRejection;
      try { se.configurePhysicsRuntime(customPhysics(0.02)); } catch (error) { customStepRejection = String(error); }
      const configuredCustom = se.configurePhysicsRuntime(customPhysics(0.01));
      const dynamic = se.spawnRigidBody({ x: 0, y: 20, bodyType: "dynamic", mass: 1, canSleep: false,
        collider: { type: "circle", radius: 0.25 } });
      sync(se);
      const customTrace = meta.run([10]), customBody = state(se, dynamic);
      // Sound authoring implicitly selects Shooter. Capture before any RAF can
      // repair platform metadata, so checkpoint capture exercises its cold hook.
      se.setSoundIds({ shoot: 0, hit: 0, gameOver: 0 });
      const aliasBeforeFrame = { backend: se.physicsBackend(), state: se.gameState(), dynamicRemoved: !se.gameplayEntityExists(dynamic) };
      checkpoint = se.captureRuntimeCheckpoint();
      const aliasTrace = meta.run([10]);
      se.useDataScene(); se.configurePhysicsRuntime(customPhysics(0.01));
      const customAgainTrace = meta.run([10]);
      se.restoreRuntimeCheckpoint(checkpoint);
      const restoredAliasTrace = meta.run([10]); checkpoint.dispose(); checkpoint = undefined;

      // The implicit intermediate scene must be observed even when no frame
      // runs before an explicit return to the same Data scene enum.
      se.useDataScene(); se.configurePhysicsRuntime(customPhysics(0.01));
      se.setSoundIds({ shoot: 0, hit: 0, gameOver: 0 });
      se.useDataScene();
      const abaDynamic = se.spawnRigidBody({ x: 0, y: 20, bodyType: "dynamic", mass: 1, canSleep: false,
        collider: { type: "circle", radius: 0.25 } });
      sync(se);
      const aliasReturnTrace = meta.run([10]), aliasReturnBody = state(se, abaDynamic);

      // Configure before cold admission so the fresh Shooter native world is
      // empty. Resetting that same scene must retain its local native clock.
      se.useBreakoutGame(); se.useDataScene();
      se.setSoundIds({ shoot: 0, hit: 0, gameOver: 0 });
      se.configureUnifiedPhysics({ space: "planar-xy", gravity: [0, 4, 0], stepSeconds: 0.02,
        lengthUnit: 1, continuous: false });
      const sameSceneResolved = se.setGameSpec({});
      sync(se); const localHero = requireHandle(se.builtInShooterPlayerHandle());
      const sameSceneBody = state(se, localHero), sameSceneEntities = se.entityCount();
      let sameSceneRejection;
      try { se.setGameSpec({ physics: { mode: "rigid", gravity: [0, 4], continuous: false,
        solver: { stepSeconds: 0.01 } } }); } catch (error) { sameSceneRejection = String(error); }
      const sameSceneAfterReject = { heroLive: se.gameplayEntityExists(localHero), entities: se.entityCount(), body: state(se, localHero) };
      const sameSceneTrace = meta.run([20]);
      se.usePlatformerGame(); sync(se);
      const afterLocalSceneTrace = meta.run([10]);
      const metadata = { customStepRejection, customSpec: { mode: configuredCustom.mode,
        step: configuredCustom.solver.stepSeconds, gravity: [configuredCustom.gravityX, configuredCustom.gravityY],
        velocityIterations: configuredCustom.solver.velocityIterations, positionIterations: configuredCustom.solver.positionIterations,
        continuous: configuredCustom.continuous }, customTrace, customBody, aliasBeforeFrame, aliasTrace,
        customAgainTrace, restoredAliasTrace, aliasReturnTrace, aliasReturnBody,
        sameSceneSpec: summarize(sameSceneResolved.physics), sameSceneBody, sameSceneEntities,
        sameSceneRejection, sameSceneAfterReject, sameSceneTrace, afterLocalSceneTrace,
        maxRustMs: meta.maxRustMs() }; meta.destroy();

      const invalidCreation = [];
      for (const options of [{ physicsBackend: "unified", fixedTimestep: { maxStepsPerUpdate: 1025 } }, { physicsBackend: "unified", physicsMode: "none" },
        { physicsBackend: "unified", fixedTimestep: { enabled: true, stepSeconds: NaN } }]) {
        let created, error;
        try { created = await createEngine(undefined, undefined, undefined, undefined, options); }
        catch (failure) { error = String(failure); }
        created?.destroy(); invalidCreation.push({ error, unexpectedlyCreated: !!created, queuedRafs: pending.size });
      }
      return { legacy, automatic, manual, metadata, invalidCreation, position: L.position, velocity: L.linearVelocity };
    } finally {
      checkpoint?.dispose(); for (const e of live) e.destroy(); pending.clear();
      window.requestAnimationFrame = originalRaf; window.cancelAnimationFrame = originalCancel;
    }
  });
  const p = r.position, v = r.velocity, a = r.automatic, m = r.manual, md = r.metadata;
  const near = (actual, expected, label, tolerance = 0.002) => assert(Math.abs(actual - expected) < tolerance, `${label}: ${actual} vs ${expected}`);
  const nativeClock = trace => {
    assert(trace.length > 0);
    for (const frame of trace) {
      assert(frame.fixed); assert.equal(frame.mode, "arcade"); near(frame.step, 0.01, "creation step", 1e-7);
      assert.deepEqual(frame.gravity, [0, 0]); assert.equal(frame.continuous, false);
      assert(Number.isInteger(frame.renderCount) && frame.renderCount >= 0);
    }
  };
  for (const l of r.legacy) {
    assert.equal(l.backend, "legacy"); near(l.before.x, 0, "legacy start"); near(l.after.x, 3, "legacy 10ms + 20ms motion");
    assert.equal(l.trace.length, 2); assert(l.trace.every(frame => !frame.fixed && frame.steps === 0 && frame.nativeSteps === 0 && frame.state === 1 && frame.entities === 1 && frame.renderCount === 0));
    assert(Number.isFinite(l.maxRustMs));
  }
  assert.equal(a.initialBackend, "unified-3d"); assert.deepEqual(a.titleAfter, a.titleBefore); nativeClock(a.titleTrace);
  assert(a.titleTrace.every(frame => frame.state === 0 && frame.nativeSteps === 0 && frame.entities === 1 && frame.renderCount >= 1));
  assert.equal(a.inherited.mode, "arcade"); assert(a.inherited.fixed); near(a.inherited.step, 0.01, "omitted Game Spec inherits step", 1e-7);
  assert.equal(a.inherited.velocityIterations, 1); assert.equal(a.inherited.positionIterations, 1); assert.equal(a.inherited.continuous, false);
  assert.deepEqual(a.inherited.gravity, [0, 0]); assert.deepEqual(a.inheritedAgain, a.inherited);
  assert.deepEqual(a.mutatedCallerOptions, { backend: "legacy", fixed: false, step: 0.02 });
  nativeClock(a.mutatedReturnTrace); nativeClock(a.inheritedTrace);
  assert.equal(a.breakout.backend, "unified-3d"); assert(a.breakout.previousStale); nativeClock(a.breakout.trace);
  assert(a.breakout.trace.every(frame => frame.state === 0 && frame.nativeSteps === 0 && frame.entities === 55 && frame.renderCount >= 55));
  assert.equal(a.platformer.backend, "unified-3d"); assert(a.platformer.previousStale); nativeClock(a.platformer.trace);
  assert(a.platformer.trace.every(frame => frame.state === 0 && frame.nativeSteps === 0 && frame.entities === 8 && frame.renderCount >= 8));
  assert.deepEqual(a.dataEntry, { backend: "unified-3d", entities: 0, previousStale: true });
  assert.equal(a.documentBackend, "unified-3d"); assert(a.noRigidComponent && a.combat);
  near(a.actorBefore[p], 0, "collider-only start"); near(a.actorFirst[p], 0.01, "collider-only first step once"); near(a.actorFirst[v], 1, "first accelerate intent");
  near(a.actorFive[p], 0.14, "five accelerate steps once"); near(a.actorFive[v], 4, "speed cap");
  nativeClock(a.actorFirstTrace); nativeClock(a.actorMoreTrace); assert(a.actorMoreTrace.every(frame => frame.nativeSteps === 1 && frame.entities === 2 && frame.state === 1 && frame.renderCount >= 2));
  nativeClock(a.capTrace); assert.equal(a.capTrace.length, 1); assert.equal(a.capTrace[0].steps, 3); assert.equal(a.capTrace[0].nativeSteps, 3); assert(a.capTrace[0].dropped > 0);
  near(a.actorCapped[p] - a.actorFive[p], 0.12, "scene-retained max-three-step budget");
  for (const rejection of a.rejects) {
    assert.match(rejection.error ?? "", /game\.physics/); assert(rejection.actorLive); assert.equal(rejection.scene, "playing");
    assert.equal(rejection.entitiesBefore, 2); assert.equal(rejection.entitiesAfter, 2); assert.deepEqual(rejection.after, rejection.before);
  }
  assert.deepEqual(a.restoredActor, a.savedActor); assert.deepEqual(a.replayedFuture, a.expectedFuture);
  const f = a.expectedFuture; assert.equal(f.backend, "unified-3d"); assert.equal(f.breakStart[0].nativeSteps, 0); assert.equal(f.breakStep[0].nativeSteps, 1);
  near(f.ballState[p], 401.5675, "future Breakout motion"); assert.equal(f.platformStart[0].nativeSteps, 0); assert.equal(f.platformStep[0].nativeSteps, 1);
  near(f.playerState[p], 98.1, "future Platformer motion"); near(f.dataState[p], 11, "future Data motion");
  for (const trace of [f.breakStart, f.breakStep, f.platformStart, f.platformStep, f.dataStep]) nativeClock(trace);
  assert.equal(m.backend, "unified-3d"); assert.deepEqual(m.manualIdle, m.manualBefore); near(m.manualMoved[p] - m.manualBefore[p], 1, "manual Data step");
  assert.deepEqual(m.ballIdle, m.ballBefore); near(m.paddleIdle[p], m.paddleBefore[p], "manual Breakout intent stays still");
  near(m.ballMoved[p], 401.5675, "manual Breakout step"); near(m.paddleMoved[p], 404.2, "manual paddle step");
  assert.deepEqual(m.playerIdle, m.playerBefore); near(m.playerMoved[p], 98.1, "manual Platformer step"); near(m.playerMoved[v + 1], 9, "manual Platformer gravity");
  near(m.dataIdle[p], 0, "manual preference after returning to Data"); near(m.dataMoved[p], 0.1, "final manual Data step");
  for (const trace of [m.idleTrace, m.breakIdleTrace, m.platformIdleTrace, m.dataIdleTrace, m.restoredManualTrace]) {
    nativeClock(trace); assert(trace.every(frame => frame.nativeSteps === 0));
  }
  assert.equal(m.enabledTrace[0].nativeSteps, 1); assert.deepEqual(m.restoredManual, m.dataMoved);
  assert.match(md.customStepRejection ?? "", /physics\.solver\.stepSeconds.*clock mode and nominal step.*engine timestep override/);
  assert.equal(md.customSpec.mode, "rigid"); assert.deepEqual(md.customSpec.gravity, [2, 30]);
  near(md.customSpec.step, 0.01, "custom physics retains creation clock", 1e-7);
  assert.equal(md.customSpec.velocityIterations, 4); assert.equal(md.customSpec.positionIterations, 2); assert(md.customSpec.continuous);
  for (const frame of [...md.customTrace, ...md.customAgainTrace]) {
    assert.equal(frame.mode, "rigid"); assert.deepEqual(frame.gravity, [2, 30]); assert(frame.continuous && frame.fixed);
    near(frame.step, 0.01, "custom Data clock", 1e-7); assert.equal(frame.nativeSteps, 1);
  }
  near(md.customBody[v], 0.02, "actual custom native gravity X"); near(md.customBody[v + 1], 0.3, "actual custom native gravity Y");
  assert.deepEqual(md.aliasBeforeFrame, { backend: "unified-3d", state: 0, dynamicRemoved: true });
  nativeClock(md.aliasTrace); nativeClock(md.restoredAliasTrace); assert.deepEqual(md.restoredAliasTrace, md.aliasTrace);
  assert(md.aliasTrace.every(frame => frame.state === 0 && frame.nativeSteps === 0));
  nativeClock(md.aliasReturnTrace); assert(md.aliasReturnTrace.every(frame => frame.state === 1 && frame.nativeSteps === 1));
  near(md.aliasReturnBody[v], 0, "implicit intermediate scene clears custom gravity X");
  near(md.aliasReturnBody[v + 1], 0, "implicit intermediate scene clears custom gravity Y");
  assert.equal(md.sameSceneSpec.mode, "rigid"); assert.deepEqual(md.sameSceneSpec.gravity, [0, 4]);
  assert(md.sameSceneSpec.fixed); near(md.sameSceneSpec.step, 0.02, "same Shooter retains native clock", 1e-7);
  assert.equal(md.sameSceneSpec.velocityIterations, 1); assert.equal(md.sameSceneSpec.positionIterations, 1); assert.equal(md.sameSceneSpec.continuous, false);
  assert.match(md.sameSceneRejection ?? "", /game\.physics/);
  assert(md.sameSceneAfterReject.heroLive); assert.equal(md.sameSceneAfterReject.entities, md.sameSceneEntities);
  assert.deepEqual(md.sameSceneAfterReject.body, md.sameSceneBody);
  assert.equal(md.sameSceneTrace.length, 1);
  for (const frame of md.sameSceneTrace) {
    assert.equal(frame.mode, "rigid"); assert.deepEqual(frame.gravity, [0, 4]); assert(frame.fixed); assert.equal(frame.continuous, false);
    near(frame.step, 0.02, "same Shooter frame retains native clock", 1e-7); assert.equal(frame.steps, 1);
    assert.equal(frame.state, 0); assert.equal(frame.nativeSteps, 0); assert.equal(frame.entities, 1); assert(frame.renderCount >= 1);
  }
  nativeClock(md.afterLocalSceneTrace);
  assert(md.afterLocalSceneTrace.every(frame => frame.state === 0 && frame.entities === 8 && frame.renderCount >= 8 && frame.nativeSteps === 0));
  assert(Number.isFinite(md.maxRustMs));
  const creationDiagnostics = [
    /engine\.physics\.clock\.maxStepsPerUpdate.*integer in 1\.\.1024/,
    /engine\.physicsBackend.*arcade or rigid physics/,
    /engine\.physics\.solver\.stepSeconds.*finite f32/,
  ];
  assert.equal(r.invalidCreation.length, creationDiagnostics.length);
  for (let i = 0; i < r.invalidCreation.length; i++) {
    const c = r.invalidCreation[i]; assert(!c.unexpectedlyCreated); assert.equal(c.queuedRafs, 0);
    assert.match(c.error ?? "", creationDiagnostics[i]);
  }
  assert(Number.isFinite(a.maxRustMs) && Number.isFinite(m.maxRustMs));
  a.exactCrossSceneReplay = true; m.manualPreferenceRestored = true;
  return r;
}
