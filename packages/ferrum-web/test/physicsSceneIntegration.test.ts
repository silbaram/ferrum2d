import { equal } from "node:assert/strict";
import { test } from "node:test";
import type {
  FerrumEngine,
  PhysicsEntityHandle,
  PhysicsRigidBodySpawnOptions,
  PhysicsRigidBodyStepOptions,
} from "../src/createEngine.js";
import { applyPhysicsSceneProfile } from "../src/physicsSceneIntegration.js";
import type { ResolvedPhysicsSpec } from "../src/physicsSpec.js";

class FakePhysicsSceneEngine {
  readonly bodies: PhysicsRigidBodySpawnOptions[] = [];
  readonly despawnedBodies: PhysicsEntityHandle[] = [];
  readonly autoStepOptions: Array<boolean | PhysicsRigidBodyStepOptions> = [];
  runtimeSpec: ResolvedPhysicsSpec | undefined;

  configurePhysicsRuntime(spec: ResolvedPhysicsSpec): ResolvedPhysicsSpec {
    this.runtimeSpec = spec;
    return spec;
  }

  configureAutoRigidBodyStep(options: boolean | PhysicsRigidBodyStepOptions): void {
    this.autoStepOptions.push(options);
  }

  spawnRigidBody(options: PhysicsRigidBodySpawnOptions): PhysicsEntityHandle {
    this.bodies.push(options);
    return { entityId: this.bodies.length, entityGeneration: 1 };
  }

  despawnPhysicsEntity(handle: PhysicsEntityHandle): boolean {
    this.despawnedBodies.push(handle);
    return true;
  }

  clearPhysicsJoint(): boolean {
    return true;
  }
}

test("applyPhysicsSceneProfile applies Physics Spec and enables runtime auto-step", () => {
  const fake = new FakePhysicsSceneEngine();
  const engine = fake as unknown as FerrumEngine;

  const scene = applyPhysicsSceneProfile(engine, {
    profile: "runtime",
    physics: {
      mode: "rigid",
      continuous: false,
      gravity: [0, 900],
      solver: { stepSeconds: 1 / 120, velocityIterations: 4, positionIterations: 2 },
      bodies: {
        ground: { type: "static", collider: { shape: "box", size: [320, 24] } },
        crate: { type: "dynamic", position: [32, 8], collider: { shape: "box", size: [16, 16] } },
      },
    },
  });

  equal(scene.profile, "runtime");
  equal(scene.autoStep, true);
  equal(scene.bodyCount, 2);
  equal(scene.stepSeconds, 1 / 120);
  equal(fake.runtimeSpec?.mode, "rigid");
  equal(fake.runtimeSpec?.continuous, false);
  equal(fake.bodies.length, 2);
  const autoStep = fake.autoStepOptions[fake.autoStepOptions.length - 1];
  if (typeof autoStep !== "object") {
    throw new Error("runtime profile should configure rigid body auto-step options.");
  }
  equal(autoStep.gravityY, 900);
  equal(autoStep.velocityIterations, 4);
  equal(autoStep.continuous, false);

  scene.clear();
  equal(fake.autoStepOptions[fake.autoStepOptions.length - 1], false);
  equal(fake.despawnedBodies.length, 2);
});

test("manual physics scene profile applies bodies without auto-step", () => {
  const fake = new FakePhysicsSceneEngine();

  const scene = applyPhysicsSceneProfile(fake as unknown as FerrumEngine, {
    profile: "manual",
    physics: {
      mode: "rigid",
      bodies: {
        sensor: { type: "kinematic", collider: { shape: "circle", radius: 12 } },
      },
    },
  });

  equal(scene.profile, "manual");
  equal(scene.autoStep, false);
  equal(fake.autoStepOptions[fake.autoStepOptions.length - 1], false);
});
