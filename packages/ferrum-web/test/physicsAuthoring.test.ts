import { equal, ok } from "node:assert/strict";
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
  createCollider,
  createPhysicsLayerMap,
  createPhysicsWorldFromSpec,
  createRigidBody,
  physicsMaterial,
} from "../src/physicsAuthoring.js";
import { diagnosticReport } from "../src/diagnostics.js";
import { resolvePhysicsSpec } from "../src/physicsSpec.js";

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

  configureFixedTimestep(options: unknown): void {
    this.fixedTimestep = options;
  }

  setPhysicsDebugLinesEnabled(options: unknown): void {
    this.debugLines = options;
  }

  spawnRigidBody(options: PhysicsRigidBodySpawnOptions): PhysicsEntityHandle {
    this.bodies.push(options);
    return { entityId: this.bodies.length, entityGeneration: 1 };
  }

  addPhysicsBodyCollider(handle: PhysicsEntityHandle, options: PhysicsBodyColliderOptions): boolean {
    this.compoundColliders.push({ handle, options });
    return true;
  }

  setPhysicsBodyColliderMaterial(
    handle: PhysicsEntityHandle,
    index: number,
    material: PhysicsRigidBodyMaterial,
  ): boolean {
    this.compoundColliderMaterials.push({ handle, index, material });
    return true;
  }

  spawnPhysicsJoint(options: PhysicsJointSpawnOptions): PhysicsJointHandle {
    this.joints.push(options);
    return { jointType: options.type, jointIndex: this.joints.length - 1, jointGeneration: 1 };
  }

  setPhysicsBodyMassProperties(handle: PhysicsEntityHandle, properties: { mass: number; inertia: number }): boolean {
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

test("createPhysicsWorldFromSpec applies resolved bodies, layers, materials, world anchors, and joints", () => {
  const fake = new FakePhysicsEngine();
  const engine = fake as unknown as FerrumEngine;

  const world = createPhysicsWorldFromSpec(engine, {
    mode: "rigid",
    gravity: [0, 900],
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
    },
  });

  equal(world.bodyCount, 2);
  equal(world.jointCount, 2);
  equal(world.worldAnchors.length, 1);
  equal(fake.bodies.length, 3);
  equal(fake.joints.length, 2);
  equal(world.stepSeconds, 1 / 120);
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

  world.clear();
  equal(fake.clearedJoints.length, 2);
  equal(fake.despawnedBodies.length, 3);
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
  equal(physicsMaterial("wood").density, 0.8);
});

test("createPhysicsWorldFromSpec lowers chain colliders to edge compound colliders", () => {
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
  equal(fake.compoundColliders.length, 2);

  const primary = fake.bodies[0];
  equal(primary.collider.type, "edge");
  if (primary.collider.type === "edge") {
    equal(primary.collider.startX, 0);
    equal(primary.collider.startY, 0);
    equal(primary.collider.endX, 80);
    equal(primary.collider.endY, 0);
    equal(primary.collider.offsetX, 2);
    equal(primary.collider.offsetY, 3);
  }
  equal(primary.categoryBits, 1);
  equal(primary.maskBits, 2);
  equal(primary.colliderMaterial?.friction, 0.7);

  const second = fake.compoundColliders[0].options;
  equal(second.collider.type, "edge");
  if (second.collider.type === "edge") {
    equal(second.collider.startX, 80);
    equal(second.collider.startY, 0);
    equal(second.collider.endX, 80);
    equal(second.collider.endY, 40);
  }

  const closing = fake.compoundColliders[1].options;
  equal(closing.collider.type, "edge");
  if (closing.collider.type === "edge") {
    equal(closing.collider.startX, 80);
    equal(closing.collider.startY, 40);
    equal(closing.collider.endX, 0);
    equal(closing.collider.endY, 0);
  }
  equal(fake.compoundColliderMaterials.length, 2);
  equal(fake.compoundColliderMaterials[0].index, 1);
  equal(fake.compoundColliderMaterials[1].index, 2);
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
