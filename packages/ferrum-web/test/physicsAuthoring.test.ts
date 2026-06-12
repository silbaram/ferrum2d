import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import type {
  FerrumEngine,
  PhysicsBodyColliderOptions,
  PhysicsEntityHandle,
  PhysicsJointHandle,
  PhysicsJointSpawnOptions,
  PhysicsRigidBodyMaterial,
  PhysicsRigidBodySpawnOptions,
} from "../src/createEngine.js";
import {
  clearPhysicsWorld,
  createCollider,
  createJoint,
  createPhysicsLayerMap,
  createPhysicsWorldFromSpec,
  createRigidBody,
  createVehicleRig,
  physicsMaterial,
} from "../src/physicsAuthoring.js";
import { diagnosticReport } from "../src/diagnostics.js";
import { resolvePhysicsSpec } from "../src/physicsSpec.js";
import type { ResolvedPhysicsSpec } from "../src/physicsSpec.js";

class FakePhysicsEngine {
  bodies: PhysicsRigidBodySpawnOptions[] = [];
  compoundColliders: Array<{ handle: PhysicsEntityHandle; options: PhysicsBodyColliderOptions }> = [];
  compoundColliderMaterials: Array<{ handle: PhysicsEntityHandle; index: number; material: PhysicsRigidBodyMaterial }> = [];
  joints: PhysicsJointSpawnOptions[] = [];
  clearedJoints: PhysicsJointHandle[] = [];
  despawnedBodies: PhysicsEntityHandle[] = [];
  fixedTimestep: unknown;
  debugLines: unknown;
  massProperties: Array<{ handle: PhysicsEntityHandle; properties: { mass: number; inertia: number } }> = [];
  failNextJointSpawn = false;
  failJointSpawnCall: number | undefined;
  failBodySpawnCall: number | undefined;
  bodySpawnAttempts = 0;
  jointSpawnAttempts = 0;
  rejectCompoundCollider = false;
  rejectColliderMaterial = false;
  rejectMassProperties = false;

  configureFixedTimestep(options: unknown): void {
    this.fixedTimestep = options;
  }

  setPhysicsDebugLinesEnabled(options: unknown): void {
    this.debugLines = options;
  }

  spawnRigidBody(options: PhysicsRigidBodySpawnOptions): PhysicsEntityHandle {
    this.bodySpawnAttempts += 1;
    if (this.failBodySpawnCall === this.bodySpawnAttempts) {
      throw new Error("body spawn rejected");
    }
    this.bodies.push(options);
    return { entityId: this.bodies.length, entityGeneration: 1 };
  }

  addPhysicsBodyCollider(handle: PhysicsEntityHandle, options: PhysicsBodyColliderOptions): boolean {
    if (this.rejectCompoundCollider) {
      return false;
    }
    this.compoundColliders.push({ handle, options });
    return true;
  }

  setPhysicsBodyColliderMaterial(
    handle: PhysicsEntityHandle,
    index: number,
    material: PhysicsRigidBodyMaterial,
  ): boolean {
    if (this.rejectColliderMaterial) {
      return false;
    }
    this.compoundColliderMaterials.push({ handle, index, material });
    return true;
  }

  spawnPhysicsJoint(options: PhysicsJointSpawnOptions): PhysicsJointHandle {
    this.jointSpawnAttempts += 1;
    if (this.failNextJointSpawn || this.failJointSpawnCall === this.jointSpawnAttempts) {
      this.failNextJointSpawn = false;
      throw new Error("joint spawn rejected");
    }
    this.joints.push(options);
    return { jointType: options.type, jointIndex: this.joints.length - 1, jointGeneration: 1 };
  }

  setPhysicsBodyMassProperties(handle: PhysicsEntityHandle, properties: { mass: number; inertia: number }): boolean {
    if (this.rejectMassProperties) {
      return false;
    }
    this.massProperties.push({ handle, properties });
    return true;
  }

  clearPhysicsJoint(handle: PhysicsJointHandle): boolean {
    this.clearedJoints.push(handle);
    return true;
  }

  despawnPhysicsEntity(handle: PhysicsEntityHandle): boolean {
    this.despawnedBodies.push(handle);
    return true;
  }
}

function ignoreReadonlyMutation(action: () => void): void {
  try {
    action();
  } catch (error) {
    if (!(error instanceof TypeError)) {
      throw error;
    }
  }
}

test("createPhysicsWorldFromSpec applies resolved bodies, layers, materials, world anchors, and joints", () => {
  const fake = new FakePhysicsEngine();
  const engine = fake as unknown as FerrumEngine;

  const world = createPhysicsWorldFromSpec(engine, {
    mode: "rigid",
    gravity: [0, 900],
    continuous: false,
    solver: {
      stepSeconds: 1 / 120,
      velocityIterations: 6,
      positionIterations: 4,
    },
    debug: { colliders: true, joints: true },
    materials: {
      wood: { friction: 0.6, restitution: 0.2, density: 0.8 },
      rubber: { friction: 0.8, restitution: 0.9, density: 1.1 },
    },
    layers: {
      world: { mask: ["crate"] },
      crate: { mask: ["world"] },
    },
    bodies: {
      ground: {
        type: "static",
        layer: "world",
        collider: { shape: "box", size: [640, 24], material: "wood" },
      },
      crate: {
        type: "dynamic",
        position: [320, 120],
        velocity: [10, 0],
        material: "rubber",
        layer: "crate",
        mass: 2,
        inertia: 3,
        collider: { shape: "box", size: [32, 32] },
      },
    },
    joints: {
      hinge: {
        type: "revolute",
        bodyA: "world",
        bodyB: "crate",
        anchor: [320, 80],
        localAnchorB: [0, -16],
        limit: { enabled: true, lower: -0.5, upper: 0.5 },
      },
      brace: {
        type: "weld",
        bodyA: "ground",
        bodyB: "crate",
        localAnchorA: [0, 0],
        localAnchorB: [-320, -120],
        referenceAngle: 0,
        breakDistance: 24,
        breakAngle: 0.75,
      },
      lift: {
        type: "pulley",
        bodyA: "ground",
        bodyB: "crate",
        groundAnchorA: [240, 40],
        groundAnchorB: [400, 40],
        localAnchorB: [0, -16],
        restLength: 220,
        ratio: 1.5,
        breakDistance: 64,
      },
    },
  });

  equal(world.bodyCount, 2);
  equal(world.jointCount, 3);
  equal(world.worldAnchors.length, 1);
  equal(fake.bodies.length, 3);
  equal(fake.joints.length, 3);
  equal(world.stepSeconds, 1 / 120);
  equal(world.stepOptions.continuous, false);
  ok(fake.fixedTimestep);
  ok(fake.debugLines);

  const ground = fake.bodies[0];
  equal(ground.bodyType, "static");
  equal(ground.collider.type, "aabb");
  equal(ground.categoryBits, 1);
  equal(ground.maskBits, 2);
  equal(ground.colliderMaterial?.density, 0.8);

  const crate = fake.bodies[1];
  equal(crate.x, 320);
  equal(crate.y, 120);
  equal(crate.collider.type, "aabb");
  equal(crate.mass, 2);
  equal(crate.categoryBits, 2);
  equal(crate.maskBits, 1);
  equal(crate.material?.restitution, 0.9);
  equal(fake.massProperties[0].properties.inertia, 3);

  const anchor = fake.bodies[2];
  equal(anchor.bodyType, "static");
  equal(anchor.colliderEnabled, false);
  equal(anchor.categoryBits, 0);
  equal(anchor.maskBits, 0);

  const joint = fake.joints[0];
  equal(joint.type, "revolute");
  equal(joint.entityA.entityId, 3);
  equal(joint.entityB.entityId, 2);
  if (joint.type === "revolute") {
    equal(joint.limitEnabled, true);
    equal(joint.lowerAngle, -0.5);
    equal(joint.upperAngle, 0.5);
  }
  const weld = fake.joints[1];
  equal(weld.type, "weld");
  if (weld.type === "weld") {
    equal(weld.localAnchorBX, -320);
    equal(weld.localAnchorBY, -120);
    equal(weld.breakDistance, 24);
    equal(weld.breakAngle, 0.75);
  }
  const pulley = fake.joints[2];
  equal(pulley.type, "pulley");
  if (pulley.type === "pulley") {
    equal(pulley.groundAnchorAX, 240);
    equal(pulley.groundAnchorBY, 40);
    equal(pulley.localAnchorBY, -16);
    equal(pulley.restLength, 220);
    equal(pulley.ratio, 1.5);
    equal(pulley.breakDistance, 64);
  }

  world.clear();
  equal(fake.clearedJoints.length, 3);
  equal(fake.despawnedBodies.length, 3);
});

test("createPhysicsWorldFromSpec applies HD-2D floor height spans to spawned bodies", () => {
  const fake = new FakePhysicsEngine();
  createPhysicsWorldFromSpec(fake as unknown as FerrumEngine, {
    mode: "rigid",
    hd2d: {
      enabled: true,
      defaultHeight: 24,
    },
    bodies: {
      bridge: {
        type: "kinematic",
        floor: "bridge",
        elevation: 16,
        height: 32,
        collider: { shape: "circle", radius: 6 },
      },
      ground: {
        type: "kinematic",
        floor: "ground",
        collider: { shape: "circle", radius: 6 },
      },
      defaultFloor: {
        type: "kinematic",
        collider: { shape: "circle", radius: 6 },
      },
    },
  });

  const bridge = fake.bodies[0].heightSpan;
  const ground = fake.bodies[1].heightSpan;
  const defaultFloor = fake.bodies[2].heightSpan;
  equal(bridge?.elevation, 16);
  equal(bridge?.height, 32);
  equal(ground?.height, 24);
  equal(defaultFloor?.floorId, 0);
  ok((bridge?.floorId ?? 0) > 0);
  ok((ground?.floorId ?? 0) > 0);
  ok(bridge?.floorId !== ground?.floorId);
});

test("clearPhysicsWorld delegates to idempotent world cleanup", () => {
  const fake = new FakePhysicsEngine();
  const engine = fake as unknown as FerrumEngine;

  const world = createPhysicsWorldFromSpec(engine, {
    mode: "rigid",
    bodies: {
      crate: {
        type: "dynamic",
        collider: { shape: "box", size: [24, 24] },
      },
    },
    joints: {
      hinge: {
        type: "distance",
        bodyA: "world",
        bodyB: "crate",
        anchor: [0, 0],
        restLength: 12,
      },
    },
  });

  const publicCrate = world.bodies.crate;
  const publicAnchor = world.worldAnchors[0];
  equal(Object.isFrozen(world.bodies), true);
  equal(Object.isFrozen(publicCrate), true);
  equal(Object.isFrozen(world.joints), true);
  equal(Object.isFrozen(world.joints.hinge), true);
  equal(Object.isFrozen(world.worldAnchors), true);
  equal(Object.isFrozen(publicAnchor), true);

  ignoreReadonlyMutation(() => {
    (world.bodies as Record<string, PhysicsEntityHandle>).crate = { entityId: 999, entityGeneration: 1 };
  });
  ignoreReadonlyMutation(() => {
    (publicCrate as { entityId: number }).entityId = 999;
  });
  ignoreReadonlyMutation(() => {
    (world.worldAnchors as unknown as PhysicsEntityHandle[]).pop();
  });

  clearPhysicsWorld(engine, world);
  clearPhysicsWorld(engine, world);
  world.clear();

  equal(fake.clearedJoints.length, 1);
  equal(fake.despawnedBodies.length, 2);
  deepEqual(fake.despawnedBodies[0], publicAnchor);
  deepEqual(fake.despawnedBodies[1], publicCrate);
});

test("helper APIs normalize collider aliases, material presets, and layer bit helpers", () => {
  const fake = new FakePhysicsEngine();
  const engine = fake as unknown as FerrumEngine;
  const layerMap = createPhysicsLayerMap({
    player: ["world"],
    world: ["player"],
  });

  const handle = createRigidBody(engine, {
    type: "dynamic",
    position: [10, 20],
    collider: { type: "box", size: [30, 40] },
    material: "rubber",
    layer: "custom",
    categoryBits: layerMap.player.categoryBits,
    maskBits: layerMap.player.maskBits,
  });

  equal(handle.entityId, 1);
  const body = fake.bodies[0];
  equal(body.collider.type, "aabb");
  if (body.collider.type === "aabb") {
    equal(body.collider.halfWidth, 15);
    equal(body.collider.halfHeight, 20);
  }
  equal(body.material?.restitution, 0.9);
  equal(body.categoryBits, 1);
  equal(body.maskBits, 2);

  const circle = createCollider({ type: "circle", radius: 5, offset: [1, 2] });
  equal(circle.type, "circle");
  if (circle.type === "circle") {
    equal(circle.offsetX, 1);
    equal(circle.offsetY, 2);
  }
  const chainCollider = createCollider({
    type: "chain",
    vertices: [[0, 0], [8, 0], [8, 8]],
    loop: false,
  });
  equal(chainCollider.type, "chain");
  if (chainCollider.type === "chain") {
    equal(chainCollider.vertices.length, 6);
  }
  equal(physicsMaterial("wood").density, 0.8);
});

test("physicsMaterial rejects inherited preset names", () => {
  expectThrow(
    () => physicsMaterial("toString" as never),
    /must be one of/,
  );
});

test("createVehicleRig composes chassis, wheels, guide joints, and suspension springs", () => {
  const fake = new FakePhysicsEngine();
  const engine = fake as unknown as FerrumEngine;

  const rig = createVehicleRig(engine, {
    position: [100, 50],
    chassisSize: [80, 20],
    chassisMass: 4,
    wheelRadius: 12,
    wheelMass: 1,
    wheelMaterial: "rubber",
    suspensionTravel: 8,
    suspensionStiffness: 0.7,
    suspensionDamping: 0.35,
    layer: "world",
    categoryBits: 4,
    maskBits: 2,
    wheels: [
      { offset: [-30, 18], angularVelocityRadiansPerSecond: 5 },
      { offset: [30, 18], radius: 10, stiffness: 0.6 },
    ],
  });

  equal(rig.bodyCount, 3);
  equal(rig.jointCount, 4);
  equal(Object.isFrozen(rig.chassis), true);
  equal(Object.isFrozen(rig.wheels), true);
  equal(Object.isFrozen(rig.wheels[0]), true);
  equal(Object.isFrozen(rig.guideJoints), true);
  equal(Object.isFrozen(rig.guideJoints[0]), true);
  equal(Object.isFrozen(rig.suspensionJoints), true);
  equal(Object.isFrozen(rig.suspensionJoints[0]), true);
  equal(fake.bodies.length, 3);
  equal(fake.joints.length, 4);

  const chassis = fake.bodies[0];
  equal(chassis.bodyType, "dynamic");
  equal(chassis.mass, 4);
  equal(chassis.collider.type, "aabb");
  if (chassis.collider.type === "aabb") {
    equal(chassis.collider.halfWidth, 40);
    equal(chassis.collider.halfHeight, 10);
  }

  const frontWheel = fake.bodies[1];
  equal(frontWheel.x, 70);
  equal(frontWheel.y, 68);
  equal(frontWheel.collider.type, "circle");
  if (frontWheel.collider.type === "circle") {
    equal(frontWheel.collider.radius, 12);
  }
  equal(frontWheel.material?.friction, 0.8);
  equal(frontWheel.angularVelocityRadiansPerSecond, 5);

  const guide = fake.joints[0];
  equal(guide.type, "prismatic");
  if (guide.type === "prismatic") {
    equal(guide.localAnchorAX, -30);
    equal(guide.localAnchorAY, 18);
    equal(guide.localAxisAX, 0);
    equal(guide.localAxisAY, 1);
    equal(guide.angularStiffness, 0);
    equal(guide.limitEnabled, true);
    equal(guide.lowerTranslation, -8);
    equal(guide.upperTranslation, 8);
  }

  const spring = fake.joints[1];
  equal(spring.type, "spring");
  if (spring.type === "spring") {
    equal(spring.restLength, Math.hypot(-30, 18));
    equal(spring.stiffness, 0.7);
    equal(spring.damping, 0.35);
  }
  ok(captureError(() => {
    rig.chassis.entityId = 999;
  }) instanceof TypeError);
  ok(captureError(() => {
    rig.wheels[0].entityId = 999;
  }) instanceof TypeError);
  ok(captureError(() => {
    rig.guideJoints[0].jointIndex = 999;
  }) instanceof TypeError);

  rig.clear();
  rig.clear();
  equal(fake.clearedJoints.length, 4);
  equal(fake.despawnedBodies.length, 3);
  equal(fake.despawnedBodies[0].entityId, 2);
  equal(fake.despawnedBodies[1].entityId, 3);
  equal(fake.despawnedBodies[2].entityId, 1);
});

test("createVehicleRig rolls back chassis when first wheel validation fails", () => {
  const fake = new FakePhysicsEngine();
  const engine = fake as unknown as FerrumEngine;

  expectThrow(() => createVehicleRig(engine, {
    position: [100, 50],
    chassisSize: [80, 20],
    wheels: [
      { offset: [0, 16], radius: -1 },
    ],
  }), /positive finite number/);

  equal(fake.bodies.length, 1);
  equal(fake.joints.length, 0);
  equal(fake.clearedJoints.length, 0);
  equal(fake.despawnedBodies.length, 1);
  equal(fake.despawnedBodies[0].entityId, 1);
});

test("createVehicleRig rolls back chassis and wheel when guide joint spawn fails", () => {
  const fake = new FakePhysicsEngine();
  fake.failJointSpawnCall = 1;
  const engine = fake as unknown as FerrumEngine;

  expectThrow(() => createVehicleRig(engine, {
    position: [100, 50],
    chassisSize: [80, 20],
    wheels: [
      { offset: [0, 16] },
    ],
  }), /runtime rejected joint/);

  equal(fake.bodies.length, 2);
  equal(fake.joints.length, 0);
  equal(fake.clearedJoints.length, 0);
  equal(fake.despawnedBodies.length, 2);
  equal(fake.despawnedBodies[0].entityId, 2);
  equal(fake.despawnedBodies[1].entityId, 1);
});

test("createVehicleRig rolls back partial guide joint when suspension joint spawn fails", () => {
  const fake = new FakePhysicsEngine();
  fake.failJointSpawnCall = 2;
  const engine = fake as unknown as FerrumEngine;

  expectThrow(() => createVehicleRig(engine, {
    position: [100, 50],
    chassisSize: [80, 20],
    wheels: [
      { offset: [0, 16] },
    ],
  }), /runtime rejected joint/);

  equal(fake.bodies.length, 2);
  equal(fake.joints.length, 1);
  equal(fake.clearedJoints.length, 1);
  equal(fake.despawnedBodies.length, 2);
  equal(fake.despawnedBodies[0].entityId, 2);
  equal(fake.despawnedBodies[1].entityId, 1);
});

test("createVehicleRig rolls back previous wheel when a later wheel body spawn fails", () => {
  const fake = new FakePhysicsEngine();
  fake.failBodySpawnCall = 3;
  const engine = fake as unknown as FerrumEngine;

  expectThrow(() => createVehicleRig(engine, {
    position: [100, 50],
    chassisSize: [80, 20],
    wheels: [
      { offset: [-20, 16] },
      { offset: [20, 16] },
    ],
  }), /runtime rejected body/);

  equal(fake.bodies.length, 2);
  equal(fake.joints.length, 2);
  equal(fake.clearedJoints.length, 2);
  equal(fake.despawnedBodies.length, 2);
  equal(fake.despawnedBodies[0].entityId, 2);
  equal(fake.despawnedBodies[1].entityId, 1);
});

test("createJoint exposes cleanup for generated world anchors", () => {
  const fake = new FakePhysicsEngine();
  const engine = fake as unknown as FerrumEngine;
  const body = { entityId: 42, entityGeneration: 1 };

  const joint = createJoint(engine, {
    type: "revolute",
    bodyA: "world",
    bodyB: body,
    anchor: [5, 6],
  });

  equal(fake.bodies.length, 1);
  equal(fake.bodies[0].bodyType, "static");
  equal(fake.bodies[0].x, 5);
  equal(fake.bodies[0].y, 6);
  equal(fake.bodies[0].colliderEnabled, false);
  equal(fake.joints.length, 1);
  equal(joint.worldAnchors.length, 1);
  equal(Object.isFrozen(joint), true);
  equal(Object.isFrozen(joint.worldAnchors), true);
  equal(Object.isFrozen(joint.worldAnchors[0]), true);

  const publicAnchor = joint.worldAnchors[0];
  ignoreReadonlyMutation(() => {
    (joint.worldAnchors as unknown as PhysicsEntityHandle[]).pop();
  });

  joint.clear();
  joint.clear();

  equal(fake.clearedJoints.length, 1);
  equal(fake.despawnedBodies.length, 1);
  deepEqual(fake.despawnedBodies[0], publicAnchor);
});

test("createJoint rolls back generated world anchors when joint spawn fails", () => {
  const fake = new FakePhysicsEngine();
  fake.failNextJointSpawn = true;
  const engine = fake as unknown as FerrumEngine;

  expectThrow(() => createJoint(engine, {
    type: "revolute",
    bodyA: "world",
    bodyB: { entityId: 42, entityGeneration: 1 },
    anchor: [5, 6],
  }), /runtime rejected joint/);

  equal(fake.bodies.length, 1);
  equal(fake.joints.length, 0);
  equal(fake.despawnedBodies.length, 1);
  equal(fake.despawnedBodies[0].entityId, 1);
});

test("createPhysicsWorldFromSpec rolls back bodies and world anchors when joint spawn fails", () => {
  const fake = new FakePhysicsEngine();
  fake.failNextJointSpawn = true;
  const engine = fake as unknown as FerrumEngine;

  expectThrow(() => createPhysicsWorldFromSpec(engine, {
    mode: "rigid",
    bodies: {
      crate: {
        type: "dynamic",
        collider: { shape: "box", size: [24, 24] },
      },
    },
    joints: {
      hinge: {
        type: "distance",
        bodyA: "world",
        bodyB: "crate",
        anchor: [5, 6],
        restLength: 12,
      },
    },
  }), /runtime rejected joint/);

  equal(fake.bodies.length, 2);
  equal(fake.joints.length, 0);
  equal(fake.despawnedBodies.length, 2);
  equal(fake.despawnedBodies[0].entityId, 2);
  equal(fake.despawnedBodies[1].entityId, 1);
});

test("createPhysicsWorldFromSpec rolls back world anchors when resolved joint references are stale", () => {
  const fake = new FakePhysicsEngine();
  const engine = fake as unknown as FerrumEngine;
  const spec = resolvePhysicsSpec({
    mode: "rigid",
    bodies: {
      crate: {
        type: "dynamic",
        collider: { shape: "box", size: [24, 24] },
      },
    },
    joints: {
      hinge: {
        type: "distance",
        bodyA: "world",
        bodyB: "crate",
        anchor: [5, 6],
        restLength: 12,
      },
    },
  });
  delete (spec.bodies as Record<string, ResolvedPhysicsSpec["bodies"][string]>).crate;

  expectThrow(() => createPhysicsWorldFromSpec(engine, spec), /unknown body/);

  equal(fake.bodies.length, 1);
  equal(fake.joints.length, 0);
  equal(fake.despawnedBodies.length, 1);
  equal(fake.despawnedBodies[0].entityId, 1);
});

test("createPhysicsWorldFromSpec despawns a partially applied body when collider apply fails", () => {
  const fake = new FakePhysicsEngine();
  fake.rejectCompoundCollider = true;
  const engine = fake as unknown as FerrumEngine;

  expectThrow(() => createPhysicsWorldFromSpec(engine, {
    mode: "rigid",
    bodies: {
      crate: {
        type: "dynamic",
        colliders: [
          { shape: "box", size: [24, 24] },
          { shape: "circle", radius: 4 },
        ],
      },
    },
  }), /runtime rejected compound collider/);

  equal(fake.bodies.length, 1);
  equal(fake.despawnedBodies.length, 1);
  equal(fake.despawnedBodies[0].entityId, 1);
});

test("createPhysicsWorldFromSpec despawns a partially applied body when mass properties fail", () => {
  const fake = new FakePhysicsEngine();
  fake.rejectMassProperties = true;
  const engine = fake as unknown as FerrumEngine;

  expectThrow(() => createPhysicsWorldFromSpec(engine, {
    mode: "rigid",
    bodies: {
      crate: {
        type: "dynamic",
        mass: 2,
        inertia: 3,
        collider: { shape: "box", size: [24, 24] },
      },
    },
  }), /runtime rejected body mass properties/);

  equal(fake.bodies.length, 1);
  equal(fake.massProperties.length, 0);
  equal(fake.despawnedBodies.length, 1);
  equal(fake.despawnedBodies[0].entityId, 1);
});

test("createPhysicsWorldFromSpec despawns a partially applied body when collider material fails", () => {
  const fake = new FakePhysicsEngine();
  fake.rejectColliderMaterial = true;
  const engine = fake as unknown as FerrumEngine;

  expectThrow(() => createPhysicsWorldFromSpec(engine, {
    mode: "rigid",
    materials: {
      sensor: { friction: 0.1, restitution: 0.2, density: 0.5 },
    },
    bodies: {
      crate: {
        type: "dynamic",
        colliders: [
          { shape: "box", size: [24, 24] },
          { shape: "circle", radius: 4, material: "sensor" },
        ],
      },
    },
  }), /runtime rejected compound collider material/);

  equal(fake.bodies.length, 1);
  equal(fake.compoundColliders.length, 1);
  equal(fake.compoundColliderMaterials.length, 0);
  equal(fake.despawnedBodies.length, 1);
  equal(fake.despawnedBodies[0].entityId, 1);
});

test("createPhysicsWorldFromSpec applies chain colliders as dedicated runtime colliders", () => {
  const fake = new FakePhysicsEngine();
  createPhysicsWorldFromSpec(fake as unknown as FerrumEngine, {
    mode: "rigid",
    materials: {
      platform: { friction: 0.7, restitution: 0, density: 1 },
    },
    layers: {
      world: { mask: ["dynamic"] },
      dynamic: { mask: ["world"] },
    },
    bodies: {
      chainWall: {
        type: "static",
        layer: "world",
        collider: {
          shape: "chain",
          vertices: [[0, 0], [80, 0], [80, 40]],
          loop: true,
          offset: [2, 3],
          material: "platform",
        },
      },
    },
  });

  equal(fake.bodies.length, 1);
  equal(fake.compoundColliders.length, 0);

  const primary = fake.bodies[0];
  equal(primary.collider.type, "chain");
  if (primary.collider.type === "chain") {
    equal(primary.collider.vertices.length, 6);
    equal(primary.collider.vertices[0], 0);
    equal(primary.collider.vertices[1], 0);
    equal(primary.collider.vertices[4], 80);
    equal(primary.collider.vertices[5], 40);
    equal(primary.collider.loop, true);
    equal(primary.collider.offsetX, 2);
    equal(primary.collider.offsetY, 3);
  }
  equal(primary.categoryBits, 1);
  equal(primary.maskBits, 2);
  equal(primary.colliderMaterial?.friction, 0.7);
  equal(fake.compoundColliderMaterials.length, 0);
});

test("createPhysicsWorldFromSpec applies compound colliders after primary body spawn", () => {
  const fake = new FakePhysicsEngine();
  const engine = fake as unknown as FerrumEngine;

  createPhysicsWorldFromSpec(engine, {
    mode: "rigid",
    materials: {
      sensor: { friction: 0.1, restitution: 0.2, density: 0.5 },
    },
    layers: {
      player: { mask: ["sensor"] },
      sensor: { mask: ["player"] },
    },
    bodies: {
      actor: {
        type: "dynamic",
        layer: "player",
        colliders: [
          { shape: "box", size: [20, 20] },
          {
            shape: "circle",
            radius: 6,
            offset: [0, 14],
            layer: "sensor",
            trigger: true,
            material: "sensor",
          },
        ],
      },
    },
  });

  equal(fake.bodies.length, 1);
  equal(fake.compoundColliders.length, 1);
  const secondary = fake.compoundColliders[0];
  equal(secondary.handle.entityId, 1);
  equal(secondary.options.collider.type, "circle");
  equal(secondary.options.isTrigger, true);
  equal(secondary.options.categoryBits, 2);
  equal(secondary.options.maskBits, 1);
  equal(fake.compoundColliderMaterials.length, 1);
  equal(fake.compoundColliderMaterials[0].index, 1);
  equal(fake.compoundColliderMaterials[0].material.density, 0.5);
});

test("physics spec diagnostics reject concave convexPolygon data with a physics code", () => {
  const error = captureError(() => resolvePhysicsSpec({
    bodies: {
      bad: {
        collider: {
          shape: "convexPolygon",
          vertices: [[0, 0], [20, 0], [10, 10], [20, 20], [0, 20]],
        },
      },
    },
  }));

  const report = diagnosticReport(error);
  equal(report.code, "FERRUM_PHYSICS_SPEC_INVALID");
  ok(/path='physics\.bodies\.bad\.collider\.vertices'/.test(report.message));
  ok(/convex polygon/.test(report.message));
});

function captureError(action: () => void): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error("expected action to throw");
}

function expectThrow(action: () => void, pattern: RegExp): unknown {
  const error = captureError(action);
  const report = diagnosticReport(error);
  ok(pattern.test(report.message));
  return error;
}
