import { equal, throws } from "node:assert/strict";
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
  validatePhysicsRuntime(_spec: ResolvedPhysicsSpec): void {}
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

test("scene profile rejection preserves the previous scene and auto-step", () => {
  const fake = new FakePhysicsSceneEngine();
  const engine = fake as unknown as FerrumEngine;
  const previous = applyPhysicsSceneProfile(engine, {
    physics: { mode: "rigid", bodies: { crate: { type: "dynamic", collider: { shape: "circle", radius: 1 } } } },
  });
  const steps = fake.autoStepOptions.length;
  fake.validatePhysicsRuntime = () => { throw new Error("native mode transition rejected"); };
  throws(() => applyPhysicsSceneProfile(engine, { physics: { mode: "none" } }, { replace: previous }), /native mode transition rejected/);
  equal(fake.despawnedBodies.length, 0);
  equal(fake.autoStepOptions.length, steps);
  previous.clear();
  equal(fake.despawnedBodies.length, 1);
});

test("fixed arcade scene profiles preserve runtime, explicit autoStep and manual ownership", () => {
  for (const options of [{ profile: "runtime" as const }, { profile: "runtime" as const, autoStep: false }, { profile: "manual" as const }]) {
    const fake = new FakePhysicsSceneEngine();
    const scene = applyPhysicsSceneProfile(fake as unknown as FerrumEngine, {
      ...options,
      physics: { bodies: { actor: { collider: { shape: "circle", radius: 1 } } } },
    });
    equal(scene.world.spec.mode, "arcade");
    equal(fake.runtimeSpec?.mode, "arcade");
    equal(scene.autoStep, options.profile === "runtime" && options.autoStep !== false);
    equal(fake.bodies[0]?.bodyType, "dynamic"); equal(fake.bodies[0]?.canSleep, false);
    if (scene.autoStep) {
      const config = fake.autoStepOptions[fake.autoStepOptions.length - 1];
      if (typeof config !== "object") throw new Error("arcade runtime must configure automatic stepping");
      equal(config.gravityY, 0); equal(config.velocityIterations, 1); equal(config.positionIterations, 1); equal(config.continuous, false);
    } else equal(fake.autoStepOptions[fake.autoStepOptions.length - 1], false);
  }
});

test("empty none scene profile retains its existing runtime auto-step switch contract", () => {
  const fake = new FakePhysicsSceneEngine();
  const scene = applyPhysicsSceneProfile(fake as unknown as FerrumEngine, { physics: { mode: "none" } });
  equal(scene.autoStep, true); equal(scene.bodyCount, 0); equal(scene.jointCount, 0);
  equal(fake.runtimeSpec?.mode, "none"); equal(typeof fake.autoStepOptions[fake.autoStepOptions.length - 1], "object");
});
