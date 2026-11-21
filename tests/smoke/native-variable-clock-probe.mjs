import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Exercise the installed public package and actual Wasm through owned RAF input.
export async function probeNativeVariableClock(page, packageEvidence = {}) {
  const directory = resolve("artifacts/physics-3d/goal-closure/native-variable/browser");
  await mkdir(directory, { recursive: true });
  const report = { format: "ferrum2d.native-variable-clock.browser", version: 1, status: "running", packageEvidence };
  try {
    report.result = await page.evaluate(async () => {
      const { createEngine, resolvePhysicsSpec, UNIFIED_PHYSICS_STATE_LAYOUT: B, UNIFIED_PHYSICS_CHARACTER_LAYOUT: C } = await import("@ferrum2d/ferrum-web/core");
      const { applyDataSceneAuthoringDocument } = await import("@ferrum2d/ferrum-web/authoring");
      const raf = window.requestAnimationFrame, cancel = window.cancelAnimationFrame, callbacks = new Map();
      let serial = 0, time = 0;
      window.requestAnimationFrame = callback => { callbacks.set(++serial, callback); return serial; };
      window.cancelAnimationFrame = id => callbacks.delete(id);
      const pump = deltaMs => {
        time += deltaMs;
        const pending = [...callbacks.values()]; callbacks.clear();
        if (pending.length !== 1) throw new Error(`Expected one native-variable RAF, got ${pending.length}`);
        pending[0](time);
      };
      const rows = [], live = new Set(), authored = {};
      let phase = "create";
      const create = async () => {
        const frames = [];
        const input = { w: false, a: false, s: false, d: false, space: false, enter: false, mouseLeft: false, mouseX: 0, mouseY: 0 };
        const e = await createEngine(frame => frames.push({
          fixed: frame.physics.fixedTimestepEnabled, nominal: frame.physics.fixedStepSeconds,
          steps: frame.physics.fixedSteps, consumed: frame.physics.fixedConsumedSeconds,
          dropped: frame.physics.fixedDroppedSeconds, backendSteps: frame.unifiedPhysics?.frame.backendSteps,
          rustMs: frame.rustUpdateTimeMs,
        }), () => input, undefined, undefined, {
          physicsBackend: "unified",
          fixedTimestep: { enabled: false, stepSeconds: 0.01, maxFrameSeconds: 0.25, maxStepsPerUpdate: 8 },
        });
        live.add(e); return { e, frames, input };
      };
      const ids = handle => new Uint32Array([handle.entityId, handle.entityGeneration]);
      const body = (e, handle) => {
        const view = e.queryUnifiedPhysicsBodyStates(ids(handle));
        if (view.count !== 1) throw new Error("Expected one native body");
        return { position: [...view.floats.slice(B.position, B.position + 3)],
          velocity: [...view.floats.slice(B.linearVelocity, B.linearVelocity + 3)] };
      };
      const character = (e, handle) => {
        const view = e.queryUnifiedPhysicsCharacterStates(ids(handle));
        if (view.count !== 1) throw new Error("Expected one native character");
        return { velocity: [...view.floats.slice(C.velocity, C.velocity + 3)],
          translation: [...view.floats.slice(C.translation, C.translation + 3)] };
      };
      try {
        for (const space of ["planar-xy", "spatial"]) {
          phase = `${space}: manual and variable RAF`;
          const { e, frames } = await create(); let checkpoint;
          try {
            e.useDataScene();
            if (space === "spatial") {
              e.configureUnifiedPhysics({ space, gravity: [0, 0, 0], lengthUnit: 1, stepSeconds: 0.01 });
              // A boolean clock change must retain the native world's 0.01 nominal step.
              e.configureFixedTimestep(false);
            }
            const mover = e.spawnUnifiedPhysicsBody({ kind: "kinematic-velocity", linearVelocity: [10, 0, 0],
              collider: { shape: { type: "box", halfExtents: [0.25, 0.25, 0.25] } } });
            const actor = e.spawnUnifiedPhysicsBody({ kind: "kinematic-position", pose: { position: [100, 0, 0] },
              collider: { shape: { type: "capsule", halfHeight: 0.5, radius: 0.25 } } });
            e.configureUnifiedPhysicsCharacter(actor, { pushMass: 2, stepHeight: 0, snapDistance: 0 });
            e.configureAutoRigidBodyStep(false);
            e.applyUnifiedPhysicsCharacterImpulses(ids(actor), new Float32Array([6, 0, 0]));
            e.addUnifiedPhysicsCharacterForces(ids(actor), new Float32Array([4, 0, 0]));
            const before = { body: body(e, mover), character: character(e, actor) };
            checkpoint = e.captureRuntimeCheckpoint();
            const invalid = [];
            for (const dt of [-0.01, NaN, Infinity, 1e-8]) {
              let error;
              try { e.stepRigidBodies(dt); } catch (failure) { error = String(failure); }
              invalid.push({ dt: String(dt), error, body: body(e, mover), character: character(e, actor) });
            }
            const intervals = [0.007, 0.013, 0.021].map(Math.fround);
            const trace = () => intervals.map(dt => { e.stepRigidBodies(dt); return { dt, body: body(e, mover), character: character(e, actor) }; });
            const expected = trace(); e.restoreRuntimeCheckpoint(checkpoint); const replayed = trace();
            checkpoint.dispose(); checkpoint = undefined;
            const manual = { before, invalid, expected, replayed, total: intervals.reduce((a, b) => a + b, 0) };
            let mismatch;
            try { e.configureFixedTimestep({ enabled: false, stepSeconds: 0.02, interpolate: true }); }
            catch (failure) { mismatch = String(failure); }
            e.configureAutoRigidBodyStep(true);
            const autoBefore = body(e, mover);
            frames.length = 0; e.start(); pump(0);
            for (const deltaMs of [7, 13, 21]) pump(deltaMs);
            e.pause(); const autoAfter = body(e, mover), autoFrames = [...frames];
            frames.length = 0; e.resume(); pump(0); pump(0); e.pause();
            const zeroFrames = [...frames], zeroAfter = body(e, mover);
            e.configureFixedTimestep(true);
            frames.length = 0; e.resume(); pump(0); pump(25); e.pause();
            const fixedAfter = body(e, mover), fixedFrames = [...frames];
            e.configureFixedTimestep(false);
            e.useBreakoutGame(); e.usePlatformerGame(); e.useDataScene();
            const switchedBackend = e.physicsBackend();
            frames.length = 0; e.resume(); pump(0); pump(7); e.pause();
            rows.push({ space, backend: e.physicsBackend(), manual, mismatch, autoBefore, autoAfter, autoFrames,
              zeroFrames, zeroAfter, fixedAfter, fixedFrames, switchedBackend, switchedFrames: [...frames] });
          } finally { checkpoint?.dispose(); e.destroy(); live.delete(e); }
        }
        phase = "same fixed Physics Spec, residual time and runtime limits";
        {
          const { e, frames } = await create();
          try {
            e.useDataScene();
            const mover = e.spawnUnifiedPhysicsBody({ kind: "kinematic-velocity", linearVelocity: [10, 0, 0],
              collider: { shape: { type: "sphere", radius: 0.25 } } });
            const spec = resolvePhysicsSpec({ mode: "arcade", solver: { fixedTimestep: true, stepSeconds: 0.01 } });
            e.configureFixedTimestep({ enabled: true, stepSeconds: 0.01, maxFrameSeconds: 0.08, maxStepsPerUpdate: 3 });
            e.start(); pump(0); pump(5); e.pause();
            authored.beforeSameSpec = body(e, mover);
            e.configurePhysicsRuntime(spec);
            e.resume(); pump(0); pump(5); e.pause();
            authored.afterSameSpec = body(e, mover); authored.remainderFrames = [...frames];
            e.configureFixedTimestep({ enabled: true, stepSeconds: 0.01, maxFrameSeconds: 0.012, maxStepsPerUpdate: 3 });
            e.configurePhysicsRuntime(spec);
            frames.length = 0; e.resume(); pump(0); pump(50); e.pause(); authored.frameLimit = [...frames];
            e.configureFixedTimestep({ enabled: true, stepSeconds: 0.01, maxFrameSeconds: 0.08, maxStepsPerUpdate: 1 });
            e.configurePhysicsRuntime(spec);
            frames.length = 0; e.resume(); pump(0); pump(35); e.pause(); authored.stepLimit = [...frames];
          } finally { e.destroy(); live.delete(e); }
        }
        {
          const { e, frames, input } = await create();
          phase = "same variable Physics Spec and pending input";
          try {
            const object = (id, x, layer, recipe) => ({ id, prefab: "object", x, y: 1,
              props: { behaviorRecipes: [recipe], components: {
                visual: { kind: "primitive", shape: "circle", radius: 0.2 }, collider: "none", layer,
                body: { kind: "fixed", collider: { shape: { type: "sphere", radius: 0.2 }, sensor: true } },
              } } });
            const document = { format: "ferrum2d.consumer.scene-authoring", version: 1,
              physics: { space: "planar-xy", gravity: [0, 0, 0], lengthUnit: 1, stepSeconds: 0.01,
                velocityIterations: 1, positionIterations: 1, continuous: false, restitutionVelocityThreshold: 1 },
              gameplay: { primaryActor: "actor", combat: true }, ids: { actions: { melee: 77 } },
              sceneComposition: { initialFragment: "main", prefabs: { object: {} }, fragments: { main: {
                instances: [object("actor", 0, "player", "actor"), object("target", 1, "enemy", "health")],
              } } }, behaviorRecipes: { entities: {
                actor: { recipes: [{ kind: "health", max: 20 }, { kind: "meleeAction", action: "melee", range: 3, damage: 2, cooldownSeconds: 1 }] },
                health: { recipes: [{ kind: "health", max: 10 }] },
              } } };
            const handles = applyDataSceneAuthoringDocument(e, document, { textureId: () => 11 }).entityHandles;
            e.configureFixedTimestep(false);
            if (!e.setInputActionBinding(77, 0, { control: "mouseLeft", activation: "pressed" })) throw new Error("Variable melee binding rejected");
            e.start(); pump(0); input.mouseLeft = true; pump(0); input.mouseLeft = false; pump(0);
            authored.pendingBefore = e.gameplayEntityDiagnostics(handles.target);
            e.configurePhysicsRuntime(resolvePhysicsSpec({ mode: "arcade", solver: { fixedTimestep: false, stepSeconds: 0.01 } }));
            pump(7); e.pause(); authored.pendingAfter = e.gameplayEntityDiagnostics(handles.target);
            authored.pendingFrames = [...frames];
          } finally { e.destroy(); live.delete(e); }
        }
        return { rows, authored };
      } catch (error) {
        return { rows, authored, phase, error: String(error), stack: error.stack };
      } finally {
        for (const e of live) e.destroy();
        window.requestAnimationFrame = raf; window.cancelAnimationFrame = cancel;
      }
    });
    if (report.result.error) throw new Error(`${report.result.phase}: ${report.result.error}\n${report.result.stack}`);
    const near = (actual, expected, label) => assert(Math.abs(actual - expected) < 1e-4, `${label}: ${actual} != ${expected}`);
    for (const row of report.result.rows) {
      assert.equal(row.backend, "unified-3d"); assert.equal(row.switchedBackend, "unified-3d");
      for (const rejected of row.manual.invalid) {
        assert.deepEqual(rejected.body, row.manual.before.body, "Rejected manual dt must not move native bodies");
        assert.deepEqual(rejected.character, row.manual.before.character, "Rejected dt must retain the pending one-shot impulse");
      }
      assert.deepEqual(row.manual.replayed, row.manual.expected, "Variable-duration checkpoint replay must match");
      const last = row.manual.expected.at(-1);
      near(last.body.position[0], 10 * row.manual.total, "Manual motion consumes requested intervals");
      near(last.character.velocity[0], 3 + 2 * row.manual.total, "Impulse once plus persistent force integrates actual duration");
      assert(row.mismatch, "An explicit incompatible nominal step must fail");
      near(row.autoAfter.position[0] - row.autoBefore.position[0], 0.41, "RAF consumes 41ms rather than fixed 40ms");
      assert.deepEqual(row.zeroAfter, row.autoAfter, "Zero frame must not move bodies");
      assert.equal(row.zeroFrames.length, 1); assert.equal(row.zeroFrames[0].steps, 0);
      assert.equal(row.zeroFrames[0].consumed, 0); assert.equal(row.zeroFrames[0].backendSteps, 0, "Zero frame must clear the preceding native counters");
      assert.equal(row.autoFrames.length, 3);
      for (let i = 0; i < row.autoFrames.length; i++) {
        const frame = row.autoFrames[i]; assert.equal(frame.fixed, false);
        near(frame.nominal, 0.01, "Nominal step is retained");
        near(frame.consumed, [0.007, 0.013, 0.021][i], "Telemetry reports accepted variable time");
        assert.equal(frame.dropped, 0); assert(frame.backendSteps >= 1);
        assert(Number.isFinite(frame.rustMs) && frame.rustMs < 500);
      }
      near(row.fixedAfter.position[0] - row.autoAfter.position[0], 0.2, "Fixed mode retains two 10ms steps");
      assert.equal(row.fixedFrames.length, 1); assert.equal(row.fixedFrames[0].fixed, true);
      assert.equal(row.switchedFrames.length, 1); assert.equal(row.switchedFrames[0].fixed, false);
      near(row.switchedFrames[0].consumed, 0.007, "Variable selection survives actual scene changes");
    }
    const authored = report.result.authored;
    near(authored.beforeSameSpec.position[0], 0, "Half fixed step remains pending");
    near(authored.afterSameSpec.position[0], 0.1, "Same Physics Spec preserves the preceding half step");
    assert.deepEqual(authored.remainderFrames.map(frame => frame.steps), [0, 1]);
    assert.equal(authored.frameLimit.length, 1); assert.equal(authored.frameLimit[0].steps, 1);
    near(authored.frameLimit[0].dropped, 0.038, "Same Spec preserves maxFrameSeconds 0.012");
    assert.equal(authored.stepLimit.length, 1); assert.equal(authored.stepLimit[0].steps, 1);
    near(authored.stepLimit[0].dropped, 0.02, "Same Spec preserves maxStepsPerUpdate 1");
    assert.equal(authored.pendingBefore.health, 10); assert.equal(authored.pendingAfter.health, 8,
      "Same variable Physics Spec must retain a press sampled and released during zero frames");
    report.status = "passed";
    report.scope = "Actual public-package native variable manual/RAF time, force/impulse ownership, rejected dt, fixed transition, checkpoint replay and cross-scene selection in both spaces; no global-default/native-file/dense/device acceptance claim.";
    return report;
  } catch (error) { report.status = "failed"; report.error = String(error); throw error; }
  finally { await writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2) + "\n"); }
}
