import "./nativeRuntimeTestHelper.js";
import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import {
  createEngine,
  createNativeGameFileSession,
  UNIFIED_PHYSICS_STATE_LAYOUT as L,
} from "../src/core.js";

for (const mode of ["manual-default", "manual-configured", "automatic-raf"] as const) {
  test(`checked native ${mode} rejects before changing body state, diagnostics or file bytes`, async () => {
    let frames = 0;
    const engine = await createEngine(() => { frames++; });
    const request = globalThis.requestAnimationFrame;
    const cancel = globalThis.cancelAnimationFrame;
    const pending = new Map<number, FrameRequestCallback>();
    let nextId = 0;
    globalThis.requestAnimationFrame = callback => {
      pending.set(++nextId, callback);
      return nextId;
    };
    globalThis.cancelAnimationFrame = id => { pending.delete(id); };
    const pump = (time: number) => {
      equal(pending.size, 1);
      const [callback] = pending.values();
      pending.clear();
      callback(time);
    };
    let fileSession: Awaited<ReturnType<typeof createNativeGameFileSession>> | undefined;
    try {
      const dt = Math.fround(0.01);
      const automatic = mode === "automatic-raf";
      engine.useDataScene();
      engine.configureUnifiedPhysics({ space: "spatial", gravity: [0, 0, 0], lengthUnit: 1, stepSeconds: dt });
      engine.configureFixedTimestep({ enabled: !automatic, stepSeconds: dt });
      engine.configureAutoRigidBodyStep(false);
      const wall = engine.spawnUnifiedPhysicsBody({
        kind: "fixed", collider: { shape: { type: "box", halfExtents: [0.05, 1, 2] } },
      });
      const body = engine.spawnUnifiedPhysicsBody({
        kind: "dynamic", ccd: true, canSleep: false,
        pose: { position: [-2, 0, 0] }, linearVelocity: [300, 0, 0],
        collider: { shape: { type: "sphere", radius: 0.5 } },
      });
      const handles = new Uint32Array([body.entityId, body.entityGeneration]);
      const bodyState = () => engine.queryUnifiedPhysicsBodyStates(handles).words.slice();
      const step = (seconds: number) => mode === "manual-configured"
        ? engine.stepRigidBodies(seconds, { gravityX: 0, gravityY: 0, continuous: true })
        : engine.stepRigidBodies(seconds);

      step(dt);
      let actorHandles: Uint32Array | undefined;
      if (automatic) {
        const actor = engine.spawnUnifiedPhysicsBody({
          kind: "kinematic-position", pose: { position: [20, 0, 0] },
          collider: { shape: { type: "capsule", halfHeight: 0.25, radius: 0.25 } },
        });
        actorHandles = new Uint32Array([actor.entityId, actor.entityGeneration]);
        engine.configureUnifiedPhysicsCharacter(actor, { pushMass: 0.01 });
        // This force fits the nominal 10 ms step but exceeds the 30 ms velocity limit.
        engine.addUnifiedPhysicsCharacterForces(actorHandles, new Float32Array([500_000, 0, 0]));
        engine.configureAutoRigidBodyStep(true);
      }
      const wasm = await readFile(new URL("../pkg/ferrum_core_bg.wasm", import.meta.url));
      fileSession = await createNativeGameFileSession(engine, { wasm });
      const diagnostics = () => {
        const value = engine.queryUnifiedPhysicsDiagnostics();
        if (!value) throw new Error("Missing native step diagnostics");
        return value.step;
      };
      const beforeStep = diagnostics();
      equal(beforeStep.backendSteps, 1);
      ok(beforeStep.ccdClamps > 0);
      const before = bodyState();
      const time = engine.time();
      const saved = await fileSession.capture();

      if (automatic) {
        engine.start();
        pump(1000);
        throws(() => pump(1030), /native physics step skipped:.*invalid character/i);
      } else {
        throws(() => step(dt * 0.5), /native physics step skipped:.*(clock|timestep)/i);
      }

      equal(frames, 0);
      equal(pending.size, 0);
      deepEqual(bodyState(), before);
      equal(engine.time(), time);
      deepEqual(diagnostics(), beforeStep);
      deepEqual(await fileSession.capture(), saved);
      const checkpoint = engine.captureRuntimeCheckpoint();
      try {
        engine.restoreRuntimeCheckpoint(checkpoint);
      } finally {
        checkpoint.dispose();
      }
      if (actorHandles) {
        engine.clearUnifiedPhysicsCharacterForces(actorHandles);
        engine.configureAutoRigidBodyStep(false);
      }
      engine.removeUnifiedPhysicsBody(wall);
      engine.setUnifiedPhysicsVelocities(handles, new Float32Array([300, 0, 0, 0, 0, 0]));
      const x = engine.queryUnifiedPhysicsBodyStates(handles).floats[L.position];
      equal(step(dt).dynamicBodies, 1);
      ok(engine.queryUnifiedPhysicsBodyStates(handles).floats[L.position] > x);
      engine.configureAutoRigidBodyStep(true);
      engine.start();
      pump(1000);
      pump(1010);
      equal(frames, 1);
      ok(engine.time() > time);
      engine.stop();
      equal(pending.size, 0);
    } finally {
      try {
        await fileSession?.dispose();
      } finally {
        engine.destroy();
        globalThis.requestAnimationFrame = request;
        globalThis.cancelAnimationFrame = cancel;
      }
    }
  });
}
