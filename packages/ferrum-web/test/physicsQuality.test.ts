import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { initSync } from "../pkg/ferrum_core.js";
import { WasmBridge } from "../src/wasmBridge.js";
import { createPhysicsBodyApi } from "../src/physicsBodyApi.js";
import { createPhysicsJointApi } from "../src/physicsJointApi.js";
import { createPhysicsQueryApi } from "../src/physicsQueryApi.js";
import { stepRigidBodiesWithStats } from "../src/physicsRuntimeControls.js";
import { createPhysicsWorldFromSpec } from "../src/physicsAuthoring.js";
import { capturePhysicsWorldSnapshot, restorePhysicsWorldSnapshot } from "../src/physicsWorldSnapshot.js";
import { hashPhysicsWorldSnapshot } from "../src/physicsSnapshotHash.js";
import { resolvePhysicsSpec, type PhysicsSpec } from "../src/physicsSpec.js";
import { configureImpactFeedback } from "../src/physicsImpactFeedback.js";
import type { FerrumEngine } from "../src/engineTypes.js";
import type { PhysicsWorldSnapshot } from "../src/physicsSnapshotTypes.js";
import { createPhysicsBodyStateBufferSnapshot } from "../src/physicsBodyStateBuffer.js";

initSync({ module: await readFile(new URL("../pkg/ferrum_core_bg.wasm", import.meta.url)) });

async function runtime() {
  const bridge = await WasmBridge.init();
  const rustEngine = bridge.engine();
  rustEngine.use_data_scene();
  const context = { rustEngine, bridge, requireAlive() {} };
  const api = {
    ...createPhysicsBodyApi(context), ...createPhysicsJointApi(context), ...createPhysicsQueryApi(context),
    configurePhysicsRuntime: (spec: unknown) => spec,
    stepRigidBodies: (dt: number, options: Parameters<typeof stepRigidBodiesWithStats>[2]) => stepRigidBodiesWithStats(rustEngine, dt, options),
  } as unknown as FerrumEngine;
  return { api, rustEngine };
}

const spec: PhysicsSpec = {
  mode: "rigid", gravity: [0, 0],
  bodies: { ball: { type: "dynamic", mass: 2, position: [0, 0], collider: { shape: "circle", radius: 1 } } },
};

test("real Wasm rejects mismatched bulk collider shapes without partially restoring bodies", async () => {
  const { api, rustEngine } = await runtime();
  try {
    const handles = [0, 20].map(x => api.spawnRigidBody({
      bodyType: "dynamic", x, y: 0, collider: { type: "circle", radius: 1 },
    }));
    const before = api.capturePhysicsBodyStateBuffer(handles);
    const invalid = createPhysicsBodyStateBufferSnapshot(before.states.map((state, index) => ({
      ...state, x: state.x + 100, velocityX: 40,
      colliderType: index === 1 ? "aabb" : state.colliderType,
    })));
    equal(api.restorePhysicsBodyStateBuffer(invalid), false);
    deepEqual(api.capturePhysicsBodyStateBuffer(handles).states, before.states);
  } finally { rustEngine.free(); }
});

test("real Wasm impact profiles emit audio and particles without contact reports", async () => {
  for (const continuous of [false, true]) {
    const { api, rustEngine } = await runtime();
    try {
      rustEngine.set_particle_preset(
        23, 1, 0, 0, 1, 1, 3, 1, 1, 0, 0, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0,
      );
      configureImpactFeedback(rustEngine, [{ categoryBits: 0xffffffff, soundId: 7, particlePresetId: 23 }]);
      // Failed replacement must leave the previous profile active.
      throws(() => configureImpactFeedback(rustEngine, [{ categoryBits: 1, particlePresetId: 22 }]), /rejected/);
      rustEngine.configure_physics_contact_impacts(false, 0);
      api.spawnRigidBody({ x: 0, y: 0, bodyType: "dynamic", mass: 2, velocityX: continuous ? 1000 : 10,
        collider: { type: "aabb", halfWidth: 1, halfHeight: 1 }, layer: "player" });
      api.spawnRigidBody({ x: continuous ? 50 : 2.5, y: 0, bodyType: "static",
        collider: { type: "aabb", halfWidth: 1, halfHeight: 1 }, layer: "wall" });
      api.stepRigidBodies(0.1, { gravityX: 0, gravityY: 0, continuous });
      equal(rustEngine.query_physics_contact_impacts(), 0);
      equal(rustEngine.physics_impact_feedback_stats()[0], 1);
      equal(rustEngine.audio_event_len(), 1);
      equal(rustEngine.particle_count(), 3);
      configureImpactFeedback(rustEngine, []);
      equal(rustEngine.physics_impact_feedback_stats()[2], 0);
    } finally { rustEngine.free(); }
  }
});

test("real Wasm v2 snapshot preserves pending force/impulse and supports v1 reads", async () => {
  const { api, rustEngine } = await runtime();
  try {
    const world = createPhysicsWorldFromSpec(api, spec);
    api.applyPhysicsBodyForce(world.bodies.ball!, 20, 3);
    api.applyPhysicsBodyImpulse(world.bodies.ball!, 2, 1);
    const snapshot = capturePhysicsWorldSnapshot(api, world);
    equal(snapshot.version, 2);
    equal(snapshot.solverState?.bodies["body:ball"]?.forceX, 20);
    api.stepRigidBodies(0.1, world.stepOptions);
    const expected = capturePhysicsWorldSnapshot(api, world, { frame: 1 });
    const restored = restorePhysicsWorldSnapshot(api, JSON.parse(JSON.stringify(snapshot)) as PhysicsWorldSnapshot, { replace: world });
    api.stepRigidBodies(0.1, restored.stepOptions);
    equal(capturePhysicsWorldSnapshot(api, restored, { frame: 1 }).replayHash, expected.replayHash);
    const legacy = { ...snapshot, version: 1 as const }; delete legacy.solverState;
    legacy.replayHash = hashPhysicsWorldSnapshot(legacy);
    const old = restorePhysicsWorldSnapshot(api, legacy, { replace: restored });
    equal(api.getPhysicsEntity(old.bodies.ball!)?.x, 0);
  } finally { rustEngine.free(); }
});

test("real Wasm failed v2 restore preserves previous bodies, pending force and fixed clock", async () => {
  const { api, rustEngine } = await runtime();
  try {
    const world = createPhysicsWorldFromSpec(api, spec);
    api.applyPhysicsBodyForce(world.bodies.ball!, 13, 0);
    rustEngine.configure_fixed_timestep(true, 0.1, 1, 8);
    rustEngine.update(0.05);
    const before = capturePhysicsWorldSnapshot(api, world);
    const restore = api.restorePhysicsSolverState;
    api.restorePhysicsSolverState = () => false;
    throws(() => restorePhysicsWorldSnapshot(api, before, { replace: world }), /rejected physics solver state/);
    api.restorePhysicsSolverState = restore;
    deepEqual(capturePhysicsWorldSnapshot(api, world), before);
    ok(Math.abs(rustEngine.fixed_timestep_alpha() - 0.5) < 0.001);
    rustEngine.update(0.05);
    equal(rustEngine.physics_fixed_steps(), 1);
    const malformed = structuredClone(before);
    malformed.worldAnchors = [world.bodies.ball!];
    malformed.solverState!.bodies["anchor:0"] = { ...malformed.solverState!.bodies["body:ball"]! };
    malformed.replayHash = hashPhysicsWorldSnapshot(malformed);
    throws(() => restorePhysicsWorldSnapshot(api, malformed, { replace: world }), /anchor count/);
    ok(api.getPhysicsEntity(world.bodies.ball!));
  } finally { rustEngine.free(); }
});

test("frequency spring validates authoring and reaches the native joint snapshot", async () => {
  const { api, rustEngine } = await runtime();
  try {
    const input = { ...spec, joints: { spring: { type: "spring" as const, bodyA: "world", bodyB: "ball", restLength: 4, frequencyHz: 2, dampingRatio: 0.7 } } };
    const world = createPhysicsWorldFromSpec(api, input);
    const joint = api.getPhysicsJoint(world.joints.spring!);
    equal(joint?.frequencyHz, 2);
    ok(Math.abs(joint!.dampingRatio! - 0.7) < 1e-6);
    throws(() => resolvePhysicsSpec({ ...input, joints: { spring: { ...input.joints.spring, type: "distance" } } }), /only for spring/);
    throws(() => resolvePhysicsSpec({ ...input, joints: { spring: { ...input.joints.spring, frequencyHz: undefined } } }), /requires frequencyHz/);
    const snapshot = capturePhysicsWorldSnapshot(api, world);
    equal(Object.keys(snapshot.solverState!.bodies).length, 2, "world anchor participates in solver state");
    const restored = restorePhysicsWorldSnapshot(api, JSON.parse(JSON.stringify(snapshot)) as PhysicsWorldSnapshot, { replace: world });
    equal(api.getPhysicsJoint(restored.joints.spring!)?.frequencyHz, 2);
  } finally { rustEngine.free(); }
});

test("v2 warm-start contacts survive recycled handles and reversed pair orientation", async () => {
  const { api, rustEngine } = await runtime();
  try {
    const contactSpec: PhysicsSpec = {
      mode: "rigid", gravity: [0, 10],
      bodies: {
        ball: { type: "dynamic", mass: 1, position: [0, 0], collider: { shape: "circle", radius: 1 } },
        floor: { type: "static", position: [0, 1.99], collider: { shape: "circle", radius: 1 } },
      },
    };
    const world = createPhysicsWorldFromSpec(api, contactSpec);
    api.stepRigidBodies(0.01, world.stepOptions);
    const snapshot = capturePhysicsWorldSnapshot(api, world);
    ok(snapshot.solverState!.contacts.length > 0);
    api.stepRigidBodies(0.01, world.stepOptions);
    const expected = capturePhysicsWorldSnapshot(api, world);
    const filler = createPhysicsWorldFromSpec(api, contactSpec);
    filler.clear();
    const restored = restorePhysicsWorldSnapshot(api, JSON.parse(JSON.stringify(snapshot)) as PhysicsWorldSnapshot, { replace: world });
    ok(restored.bodies.ball!.entityId > restored.bodies.floor!.entityId, "free-list must reverse native pair order");
    api.stepRigidBodies(0.01, restored.stepOptions);
    const actual = capturePhysicsWorldSnapshot(api, restored);
    equal(actual.bodies.ball!.state.velocityY, expected.bodies.ball!.state.velocityY);
    equal(actual.bodies.ball!.state.y, expected.bodies.ball!.state.y);
    equal(actual.replayHash, expected.replayHash);
  } finally { rustEngine.free(); }
});

test("v2 restores parallel capsule warm-start contacts with opposite spine directions", async () => {
  const { api, rustEngine } = await runtime();
  try {
    const capsuleSpec: PhysicsSpec = {
      mode: "rigid", gravity: [0, 10],
      bodies: {
        moving: { type: "dynamic", mass: 1, position: [0, 0], collider: { shape: "capsule", start: [-5, 0], end: [5, 0], radius: 0.6 } },
        wall: { type: "static", position: [0, 1], collider: { shape: "capsule", start: [5, 0], end: [-5, 0], radius: 0.6 } },
      },
    };
    const world = createPhysicsWorldFromSpec(api, capsuleSpec);
    api.stepRigidBodies(0.01, world.stepOptions);
    const snapshot = capturePhysicsWorldSnapshot(api, world);
    equal(snapshot.solverState!.contacts.length, 2);
    api.stepRigidBodies(0.01, world.stepOptions);
    const expected = capturePhysicsWorldSnapshot(api, world);
    const filler = createPhysicsWorldFromSpec(api, capsuleSpec);
    filler.clear();
    const restored = restorePhysicsWorldSnapshot(api, JSON.parse(JSON.stringify(snapshot)) as PhysicsWorldSnapshot, { replace: world });
    ok(restored.bodies.moving!.entityId > restored.bodies.wall!.entityId);
    api.stepRigidBodies(0.01, restored.stepOptions);
    const actual = capturePhysicsWorldSnapshot(api, restored);
    equal(actual.bodies.moving!.state.y, expected.bodies.moving!.state.y);
    equal(actual.bodies.moving!.state.velocityY, expected.bodies.moving!.state.velocityY);
    equal(actual.replayHash, expected.replayHash);
  } finally { rustEngine.free(); }
});

test("fixed rotation and runtime joint load limits survive JSON and recycled handles", async () => {
  const { api, rustEngine } = await runtime();
  try {
    const input: PhysicsSpec = { ...spec, bodies: { ball: { ...spec.bodies!.ball!, fixedRotation: true } }, joints: { tether: { type: "distance", bodyA: "world", bodyB: "ball", restLength: 8, breakForce: 300 } } };
    const world = createPhysicsWorldFromSpec(api, input);
    equal(api.getPhysicsEntity(world.bodies.ball!)?.fixedRotation, true);
    ok(api.setPhysicsJointLoadLimits(world.joints.tether!, { breakTorque: 17 }));
    api.applyPhysicsBodyAngularImpulse(world.bodies.ball!, 100);
    api.stepRigidBodies(0.01, world.stepOptions);
    equal(api.getPhysicsEntity(world.bodies.ball!)?.angularVelocityRadiansPerSecond, 0);
    const saved = capturePhysicsWorldSnapshot(api, world);
    const restored = restorePhysicsWorldSnapshot(api, JSON.parse(JSON.stringify(saved)), { replace: world });
    equal(api.getPhysicsEntity(restored.bodies.ball!)?.fixedRotation, true);
    equal(api.getPhysicsJoint(restored.joints.tether!)?.breakTorque, 17);
    equal(api.getPhysicsJoint(restored.joints.tether!)?.breakForce, undefined);
    ok(api.setPhysicsBodyFixedRotation(restored.bodies.ball!, false));
    api.applyPhysicsBodyAngularImpulse(restored.bodies.ball!, 10);
    api.stepRigidBodies(0.01, restored.stepOptions);
    ok(Math.abs(api.getPhysicsEntity(restored.bodies.ball!)!.angularVelocityRadiansPerSecond) > 0);
    throws(() => resolvePhysicsSpec({ ...spec, bodies: { ball: { ...spec.bodies!.ball!, fixedRotation: "yes" } } }), /boolean/);
    throws(() => resolvePhysicsSpec({ ...input, joints: { tether: { ...input.joints!.tether!, breakForce: -1 } } }), /non-negative/);
  } finally { rustEngine.free(); }
});

test("all native batch cast kinds preserve single query hit order, height filtering and owned results", async () => {
  const { api, rustEngine } = await runtime();
  try {
    const world = createPhysicsWorldFromSpec(api, { ...spec, bodies: { target: { type: "static", position: [10, 0], collider: { shape: "box", halfSize: [1, 2] } } } });
    ok(api.setPhysicsBodyHeightSpan(world.bodies.target!, { floorId: 2, elevation: 3, height: 4 }));
    const motion = { directionX: 1, directionY: 0, maxDistance: 20, heightSpan: { floorId: 2, elevation: 3, height: 1 } };
    const requests = [
      { kind: "ray" as const, ...motion, originX: 0, originY: 0 },
      { kind: "segment" as const, ...motion, startX: 0, startY: 0, endX: 20, endY: 0 },
      { kind: "aabb" as const, ...motion, x: 0, y: 0, halfWidth: 1, halfHeight: 1 },
      { kind: "circle" as const, ...motion, x: 0, y: 0, radius: 1 },
      { kind: "orientedBox" as const, ...motion, x: 0, y: 0, halfWidth: 1, halfHeight: 1, rotationRadians: 0.2 },
      { kind: "capsule" as const, ...motion, startX: 0, startY: -1, endX: 0, endY: 1, radius: 1 },
      { kind: "convexPolygon" as const, ...motion, vertices: [0, -1, 1, 0, 0, 1, -1, 0] },
    ] as const;
    const single = [api.raycastBodies(requests[0]!), api.segmentCastBodies(requests[1]!), api.shapeCastAabbBodies(requests[2]!), api.shapeCastCircleBodies(requests[3]!), api.shapeCastOrientedBoxBodies(requests[4]!), api.shapeCastCapsuleBodies(requests[5]!), api.shapeCastConvexPolygonBodies(requests[6]!)];
    const batch = api.batchCastBodies(requests);
    single.forEach((hits, i) => { ok(hits.length > 0); deepEqual(batch[i]!.hits, hits); equal(batch[i]!.requestIndex, i); });
    equal(api.batchCastBodies([{ ...requests[0]!, heightSpan: { floorId: 1, elevation: 3, height: 1 } }])[0]!.hits.length, 0);
    const copy = structuredClone(batch);
    world.clear(); api.batchCastBodies(requests); deepEqual(batch, copy);
    throws(() => api.batchCastBodies(Array.from({ length: 129 }, () => requests[0]!)), /128/);
    throws(() => api.batchCastBodies([{ ...requests[2]!, halfWidth: -1 }]), /positive/);
    throws(() => api.batchCastBodies([{ ...requests[0]!, queryMaskBits: -1 }]), /integer/);
    throws(() => api.batchCastBodies([{ ...requests[0]!, directionX: Infinity }]), /finite/);
  } finally { rustEngine.free(); }
});
