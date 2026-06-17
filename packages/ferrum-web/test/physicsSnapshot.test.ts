import { equal, ok } from "node:assert/strict";
import { test } from "node:test";
import type {
  FerrumEngine,
  PhysicsBodyColliderOptions,
  PhysicsBodyHeightSpan,
  PhysicsBodyColliderSnapshot,
  PhysicsBodyStateBufferSnapshot,
  PhysicsEntityHandle,
  PhysicsEntitySnapshot,
  PhysicsJointHandle,
  PhysicsJointSnapshot,
  PhysicsJointSpawnOptions,
  PhysicsMaterialSnapshot,
  PhysicsRigidBodyMaterial,
  PhysicsRigidBodySpawnOptions,
  PhysicsRigidBodyStepOptions,
  PhysicsRigidBodyStepStats,
} from "../src/createEngine.js";
import { createPhysicsBodyStateBufferSnapshot } from "../src/physicsBodyStateBuffer.js";
import { createPhysicsWorldFromSpec } from "../src/physicsAuthoring.js";
import {
  capturePhysicsWorldSnapshot,
  createPhysicsReplayInputStream,
  hashPhysicsWorldSnapshot,
  PHYSICS_REPLAY_INPUT_STREAM_FORMAT,
  PHYSICS_REPLAY_INPUT_STREAM_VERSION,
  PHYSICS_WORLD_SNAPSHOT_FORMAT,
  PHYSICS_WORLD_SNAPSHOT_VERSION,
  restorePhysicsWorldSnapshot,
  runPhysicsReplayInputStream,
  verifyPhysicsReplayInputStreamRollback,
  verifyPhysicsReplayRollback,
} from "../src/physicsSnapshot.js";
import type { PhysicsWorldSnapshot } from "../src/physicsSnapshot.js";

class FakeSnapshotEngine {
  bulkCaptureCount = 0;
  bulkRestoreCount = 0;

  private nextEntityId = 1;
  private bodies = new Map<number, PhysicsEntitySnapshot>();
  private heightSpans = new Map<number, PhysicsBodyHeightSpan>();
  private colliders = new Map<number, PhysicsBodyColliderSnapshot[]>();
  private nextJointIndex = 0;
  private joints = new Map<number, PhysicsJointSnapshot>();

  configureFixedTimestep(_options: unknown): void {}

  setPhysicsDebugLinesEnabled(_options: unknown): void {}

  spawnRigidBody(options: PhysicsRigidBodySpawnOptions): PhysicsEntityHandle {
    const handle = { entityId: this.nextEntityId, entityGeneration: 1 };
    this.nextEntityId += 1;
    const material = materialSnapshot(options.material);
    const colliderMaterial = options.colliderMaterial === undefined
      ? material
      : materialSnapshot(options.colliderMaterial);
    const mass = options.mass ?? options.density ?? material.density;
    const inertia = mass;
    this.bodies.set(handle.entityId, {
      ...handle,
      x: options.x,
      y: options.y,
      velocityX: options.velocityX ?? 0,
      velocityY: options.velocityY ?? 0,
      rotationRadians: options.rotationRadians ?? 0,
      angularVelocityRadiansPerSecond: options.angularVelocityRadiansPerSecond ?? 0,
      bodyType: options.bodyType ?? "dynamic",
      bodyEnabled: options.bodyEnabled ?? true,
      isSleeping: false,
      colliderType: options.collider.type,
      colliderEnabled: options.colliderEnabled ?? true,
      colliderIsTrigger: options.isTrigger === true,
      colliderOffsetX: options.collider.offsetX ?? 0,
      colliderOffsetY: options.collider.offsetY ?? 0,
      colliderMaterialOverride: options.colliderMaterial !== undefined,
      colliderMaterial,
      mass,
      inverseMass: mass > 0 ? 1 / mass : 0,
      inertia,
      inverseInertia: inertia > 0 ? 1 / inertia : 0,
      gravityScale: options.gravityScale ?? 1,
      linearDamping: options.linearDamping ?? 0,
      angularDamping: options.angularDamping ?? 0,
      ...material,
    });
    this.colliders.set(handle.entityId, [{
      colliderIndex: 0,
      colliderType: options.collider.type,
      colliderEnabled: options.colliderEnabled ?? true,
      colliderIsTrigger: options.isTrigger === true,
      colliderOffsetX: options.collider.offsetX ?? 0,
      colliderOffsetY: options.collider.offsetY ?? 0,
      colliderMaterialOverride: options.colliderMaterial !== undefined,
      colliderMaterial,
      categoryBits: options.categoryBits ?? 1,
      maskBits: options.maskBits ?? 0xffffffff,
    }]);
    if (options.heightSpan !== undefined) {
      this.heightSpans.set(handle.entityId, { ...options.heightSpan });
    }
    return handle;
  }

  addPhysicsBodyCollider(handle: PhysicsEntityHandle, options: PhysicsBodyColliderOptions): boolean {
    const body = this.bodies.get(handle.entityId);
    const colliders = this.colliders.get(handle.entityId);
    if (!body || !colliders) return false;
    colliders.push({
      colliderIndex: colliders.length,
      colliderType: options.collider.type,
      colliderEnabled: options.colliderEnabled ?? true,
      colliderIsTrigger: options.isTrigger === true,
      colliderOffsetX: options.collider.offsetX ?? 0,
      colliderOffsetY: options.collider.offsetY ?? 0,
      colliderMaterialOverride: false,
      colliderMaterial: materialSnapshot(body),
      categoryBits: options.categoryBits ?? 1,
      maskBits: options.maskBits ?? 0xffffffff,
    });
    return true;
  }

  getPhysicsBodyColliderCount(handle: PhysicsEntityHandle): number {
    return this.colliders.get(handle.entityId)?.length ?? 0;
  }

  getPhysicsBodyCollider(
    handle: PhysicsEntityHandle,
    colliderIndex: number,
  ): PhysicsBodyColliderSnapshot | undefined {
    const collider = this.colliders.get(handle.entityId)?.[colliderIndex];
    return collider === undefined ? undefined : {
      ...collider,
      colliderMaterial: { ...collider.colliderMaterial },
    };
  }

  getPhysicsEntity(handle: PhysicsEntityHandle): PhysicsEntitySnapshot | undefined {
    return cloneBody(this.bodies.get(handle.entityId));
  }

  capturePhysicsBodyStateBuffer(
    handles: readonly PhysicsEntityHandle[],
  ): PhysicsBodyStateBufferSnapshot {
    this.bulkCaptureCount += 1;
    return createPhysicsBodyStateBufferSnapshot(handles.map((handle) => {
      const body = cloneBody(this.bodies.get(handle.entityId));
      if (body === undefined) {
        throw new Error("missing fake physics body");
      }
      return body;
    }));
  }

  restorePhysicsBodyStateBuffer(snapshot: PhysicsBodyStateBufferSnapshot): boolean {
    this.bulkRestoreCount += 1;
    for (const state of snapshot.states) {
      if (!this.bodies.has(state.entityId)) {
        return false;
      }
      const body = cloneBody(state);
      if (body === undefined) {
        return false;
      }
      this.bodies.set(state.entityId, body);
      const primary = this.colliders.get(state.entityId)?.[0];
      if (primary !== undefined) {
        primary.colliderType = state.colliderType;
        primary.colliderEnabled = state.colliderEnabled;
        primary.colliderIsTrigger = state.colliderIsTrigger;
        primary.colliderOffsetX = state.colliderOffsetX;
        primary.colliderOffsetY = state.colliderOffsetY;
        primary.colliderMaterialOverride = state.colliderMaterialOverride;
        primary.colliderMaterial = { ...state.colliderMaterial };
      }
    }
    return true;
  }

  despawnPhysicsEntity(handle: PhysicsEntityHandle): boolean {
    this.heightSpans.delete(handle.entityId);
    this.colliders.delete(handle.entityId);
    return this.bodies.delete(handle.entityId);
  }

  setPhysicsBodyHeightSpan(handle: PhysicsEntityHandle, span: PhysicsBodyHeightSpan): boolean {
    if (!this.bodies.has(handle.entityId)) return false;
    this.heightSpans.set(handle.entityId, { ...span });
    return true;
  }

  clearPhysicsBodyHeightSpan(handle: PhysicsEntityHandle): boolean {
    if (!this.bodies.has(handle.entityId)) return false;
    this.heightSpans.delete(handle.entityId);
    return true;
  }

  getPhysicsBodyHeightSpan(handle: PhysicsEntityHandle): PhysicsBodyHeightSpan | undefined {
    const span = this.heightSpans.get(handle.entityId);
    return span === undefined ? undefined : { ...span };
  }

  setPhysicsBodyPosition(handle: PhysicsEntityHandle, x: number, y: number): boolean {
    const body = this.bodies.get(handle.entityId);
    if (!body) return false;
    body.x = x;
    body.y = y;
    return true;
  }

  setPhysicsBodyVelocity(handle: PhysicsEntityHandle, velocityX: number, velocityY: number): boolean {
    const body = this.bodies.get(handle.entityId);
    if (!body) return false;
    body.velocityX = velocityX;
    body.velocityY = velocityY;
    return true;
  }

  setPhysicsBodyRotation(handle: PhysicsEntityHandle, rotationRadians: number): boolean {
    const body = this.bodies.get(handle.entityId);
    if (!body) return false;
    body.rotationRadians = rotationRadians;
    return true;
  }

  setPhysicsBodyAngularVelocity(handle: PhysicsEntityHandle, radiansPerSecond: number): boolean {
    const body = this.bodies.get(handle.entityId);
    if (!body) return false;
    body.angularVelocityRadiansPerSecond = radiansPerSecond;
    return true;
  }

  setPhysicsBodyEnabled(handle: PhysicsEntityHandle, enabled: boolean): boolean {
    const body = this.bodies.get(handle.entityId);
    if (!body) return false;
    body.bodyEnabled = enabled;
    return true;
  }

  setPhysicsColliderOffset(handle: PhysicsEntityHandle, offsetX: number, offsetY: number): boolean {
    const body = this.bodies.get(handle.entityId);
    const primary = this.colliders.get(handle.entityId)?.[0];
    if (!body) return false;
    body.colliderOffsetX = offsetX;
    body.colliderOffsetY = offsetY;
    if (primary) {
      primary.colliderOffsetX = offsetX;
      primary.colliderOffsetY = offsetY;
    }
    return true;
  }

  setPhysicsColliderEnabled(handle: PhysicsEntityHandle, enabled: boolean): boolean {
    const body = this.bodies.get(handle.entityId);
    const primary = this.colliders.get(handle.entityId)?.[0];
    if (!body) return false;
    body.colliderEnabled = enabled;
    if (primary) {
      primary.colliderEnabled = enabled;
    }
    return true;
  }

  setPhysicsBodyMassProperties(
    handle: PhysicsEntityHandle,
    properties: { mass: number; inertia: number },
  ): boolean {
    const body = this.bodies.get(handle.entityId);
    if (!body) return false;
    body.mass = properties.mass;
    body.inverseMass = 1 / properties.mass;
    body.inertia = properties.inertia;
    body.inverseInertia = 1 / properties.inertia;
    return true;
  }

  setPhysicsBodyTuning(
    handle: PhysicsEntityHandle,
    tuning: { gravityScale?: number; linearDamping?: number; angularDamping?: number },
  ): boolean {
    const body = this.bodies.get(handle.entityId);
    if (!body) return false;
    body.gravityScale = tuning.gravityScale ?? body.gravityScale;
    body.linearDamping = tuning.linearDamping ?? body.linearDamping;
    body.angularDamping = tuning.angularDamping ?? body.angularDamping;
    return true;
  }

  setPhysicsBodyMaterial(handle: PhysicsEntityHandle, material: PhysicsRigidBodyMaterial): boolean {
    const body = this.bodies.get(handle.entityId);
    if (!body) return false;
    const resolved = materialSnapshot(material);
    Object.assign(body, resolved);
    if (!body.colliderMaterialOverride) {
      body.colliderMaterial = resolved;
    }
    for (const collider of this.colliders.get(handle.entityId) ?? []) {
      if (!collider.colliderMaterialOverride) {
        collider.colliderMaterial = resolved;
      }
    }
    return true;
  }

  applyPhysicsBodyForce(handle: PhysicsEntityHandle, forceX: number, forceY: number): boolean {
    return this.applyPhysicsBodyImpulse(handle, forceX, forceY);
  }

  applyPhysicsBodyImpulse(handle: PhysicsEntityHandle, impulseX: number, impulseY: number): boolean {
    const body = this.bodies.get(handle.entityId);
    if (!body) return false;
    body.velocityX += impulseX / body.mass;
    body.velocityY += impulseY / body.mass;
    return true;
  }

  setPhysicsColliderMaterial(handle: PhysicsEntityHandle, material: PhysicsRigidBodyMaterial): boolean {
    const body = this.bodies.get(handle.entityId);
    const primary = this.colliders.get(handle.entityId)?.[0];
    if (!body) return false;
    body.colliderMaterialOverride = true;
    body.colliderMaterial = materialSnapshot(material);
    if (primary) {
      primary.colliderMaterialOverride = true;
      primary.colliderMaterial = materialSnapshot(material);
    }
    return true;
  }

  setPhysicsBodyColliderMaterial(
    handle: PhysicsEntityHandle,
    colliderIndex: number,
    material: PhysicsRigidBodyMaterial,
  ): boolean {
    const collider = this.colliders.get(handle.entityId)?.[colliderIndex];
    if (!collider) return false;
    collider.colliderMaterialOverride = true;
    collider.colliderMaterial = materialSnapshot(material);
    return true;
  }

  clearPhysicsColliderMaterial(handle: PhysicsEntityHandle): boolean {
    const body = this.bodies.get(handle.entityId);
    const primary = this.colliders.get(handle.entityId)?.[0];
    if (!body) return false;
    body.colliderMaterialOverride = false;
    body.colliderMaterial = materialSnapshot(body);
    if (primary) {
      primary.colliderMaterialOverride = false;
      primary.colliderMaterial = materialSnapshot(body);
    }
    return true;
  }

  spawnPhysicsJoint(options: PhysicsJointSpawnOptions): PhysicsJointHandle {
    const handle = {
      jointType: options.type,
      jointIndex: this.nextJointIndex,
      jointGeneration: 1,
    };
    this.nextJointIndex += 1;
    this.joints.set(handle.jointIndex, {
      ...handle,
      entityA: options.entityA,
      entityB: options.entityB,
      enabled: options.enabled ?? true,
      restLength: "restLength" in options ? options.restLength : 0,
      maxLength: "maxLength" in options ? options.maxLength : 0,
      ratio: "ratio" in options ? options.ratio ?? 1 : 1,
      slack: "slack" in options ? options.slack === true : false,
      referenceAngle: "referenceAngle" in options ? options.referenceAngle ?? 0 : 0,
      breakDistance: "breakDistance" in options ? options.breakDistance ?? 0 : 0,
      breakAngle: "breakAngle" in options ? options.breakAngle ?? 0 : 0,
      stiffness: options.stiffness ?? 1,
      damping: options.damping ?? 0,
      angularStiffness: "angularStiffness" in options ? options.angularStiffness ?? 1 : 1,
      angularDamping: "angularDamping" in options ? options.angularDamping ?? 1 : 1,
      localAnchorAX: "localAnchorAX" in options ? options.localAnchorAX ?? 0 : 0,
      localAnchorAY: "localAnchorAY" in options ? options.localAnchorAY ?? 0 : 0,
      localAnchorBX: "localAnchorBX" in options ? options.localAnchorBX ?? 0 : 0,
      localAnchorBY: "localAnchorBY" in options ? options.localAnchorBY ?? 0 : 0,
      localAxisAX: "localAxisAX" in options ? options.localAxisAX ?? 1 : 1,
      localAxisAY: "localAxisAY" in options ? options.localAxisAY ?? 0 : 0,
      groundAnchorAX: "groundAnchorAX" in options ? options.groundAnchorAX : 0,
      groundAnchorAY: "groundAnchorAY" in options ? options.groundAnchorAY : 0,
      groundAnchorBX: "groundAnchorBX" in options ? options.groundAnchorBX : 0,
      groundAnchorBY: "groundAnchorBY" in options ? options.groundAnchorBY : 0,
      limitEnabled: "limitEnabled" in options ? options.limitEnabled === true : false,
      continuousLimit: "continuousLimit" in options
        ? options.continuousLimit === true
        : false,
      lowerAngle: "lowerAngle" in options ? options.lowerAngle ?? 0 : 0,
      upperAngle: "upperAngle" in options ? options.upperAngle ?? 0 : 0,
      lowerTranslation: "lowerTranslation" in options ? options.lowerTranslation ?? 0 : 0,
      upperTranslation: "upperTranslation" in options ? options.upperTranslation ?? 0 : 0,
      motorEnabled: "motorEnabled" in options ? options.motorEnabled === true : false,
      motorSpeed: "motorSpeed" in options ? options.motorSpeed ?? 0 : 0,
      maxMotorForce: "maxMotorForce" in options ? options.maxMotorForce ?? 0 : 0,
      maxMotorTorque: "maxMotorTorque" in options ? options.maxMotorTorque ?? 0 : 0,
    });
    return handle;
  }

  getPhysicsJoint(handle: PhysicsJointHandle): PhysicsJointSnapshot | undefined {
    const joint = this.joints.get(handle.jointIndex);
    return joint === undefined ? undefined : { ...joint, entityA: { ...joint.entityA }, entityB: { ...joint.entityB } };
  }

  clearPhysicsJoint(handle: PhysicsJointHandle): boolean {
    return this.joints.delete(handle.jointIndex);
  }

  setPhysicsJointEnabled(handle: PhysicsJointHandle, enabled: boolean): boolean {
    const joint = this.joints.get(handle.jointIndex);
    if (!joint) return false;
    joint.enabled = enabled;
    return true;
  }

  stepRigidBodies(deltaSeconds: number, _options?: PhysicsRigidBodyStepOptions): PhysicsRigidBodyStepStats {
    for (const body of this.bodies.values()) {
      if (!body.bodyEnabled || body.bodyType === "static") {
        continue;
      }
      body.x += body.velocityX * deltaSeconds;
      body.y += body.velocityY * deltaSeconds;
      body.rotationRadians += body.angularVelocityRadiansPerSecond * deltaSeconds;
    }
    return {} as PhysicsRigidBodyStepStats;
  }
}

test("physics world snapshot captures versioned state and restores via Physics Spec", () => {
  const fake = new FakeSnapshotEngine();
  const engine = fake as unknown as FerrumEngine;
  const world = createPhysicsWorldFromSpec(engine, {
    mode: "rigid",
    solver: { stepSeconds: 0.25 },
    bodies: {
      crate: {
        type: "dynamic",
        collider: { shape: "box", size: [20, 20] },
        velocity: [4, 0],
        mass: 2,
      },
    },
  });

  engine.stepRigidBodies(0.5, world.stepOptions);
  const snapshot = capturePhysicsWorldSnapshot(engine, world, { frame: 2 });
  equal(snapshot.version, PHYSICS_WORLD_SNAPSHOT_VERSION);
  equal(snapshot.bodyCount, 1);
  equal(snapshot.bodies.crate.state.x, 2);
  equal(snapshot.bodies.crate.state.velocityX, 4);

  engine.setPhysicsBodyVelocity(world.bodies.crate, -10, 0);
  const restored = restorePhysicsWorldSnapshot(engine, snapshot, { replace: world });
  const restoredState = engine.getPhysicsEntity(restored.bodies.crate);
  equal(restoredState?.x, 2);
  equal(restoredState?.velocityX, 4);
  equal(restored.sourceSnapshot.replayHash, snapshot.replayHash);
  equal(hashPhysicsWorldSnapshot(snapshot), snapshot.replayHash);
  equal(fake.bulkCaptureCount, 1);
  equal(fake.bulkRestoreCount, 1);
});

test("physics world snapshot accepts legacy v1 joint snapshots without newer boolean fields", () => {
  const fake = new FakeSnapshotEngine();
  const engine = fake as unknown as FerrumEngine;
  const world = createPhysicsWorldFromSpec(engine, {
    mode: "rigid",
    solver: { stepSeconds: 0.25 },
    bodies: {
      anchor: { type: "static", collider: { shape: "box", size: [10, 10] } },
      crate: { type: "dynamic", collider: { shape: "box", size: [20, 20] } },
    },
    joints: {
      rope: {
        type: "pulley",
        bodyA: "anchor",
        bodyB: "crate",
        groundAnchorA: [0, 0],
        groundAnchorB: [20, 0],
        restLength: 40,
        ratio: 1,
      },
      hinge: {
        type: "revolute",
        bodyA: "anchor",
        bodyB: "crate",
        limit: { enabled: true, lower: -1, upper: 1 },
      },
    },
  });
  const snapshot = capturePhysicsWorldSnapshot(engine, world, { frame: 3 });
  const legacy = jsonClone(snapshot);
  delete (legacy.joints.rope.state as Partial<PhysicsJointSnapshot>).slack;
  delete (legacy.joints.rope.state as Partial<PhysicsJointSnapshot>).continuousLimit;
  delete (legacy.joints.hinge.state as Partial<PhysicsJointSnapshot>).slack;
  delete (legacy.joints.hinge.state as Partial<PhysicsJointSnapshot>).continuousLimit;
  delete (legacy.spec.joints.rope as { slack?: boolean }).slack;
  delete (legacy.spec.joints.rope as { continuousLimit?: boolean }).continuousLimit;
  delete (legacy.spec.joints.hinge as { slack?: boolean }).slack;
  delete (legacy.spec.joints.hinge as { continuousLimit?: boolean }).continuousLimit;
  legacy.replayHash = hashPhysicsWorldSnapshot(legacy);

  const restored = restorePhysicsWorldSnapshot(engine, legacy, { replace: world });

  equal(restored.restoredJointCount, 2);
  equal(restored.sourceSnapshot.replayHash, legacy.replayHash);
});

test("physics world snapshot preserves HD-2D height spans outside bulk body ABI", () => {
  const fake = new FakeSnapshotEngine();
  const engine = fake as unknown as FerrumEngine;
  const world = createPhysicsWorldFromSpec(engine, {
    mode: "rigid",
    hd2d: {
      enabled: true,
      defaultHeight: 24,
    },
    bodies: {
      lower: {
        type: "kinematic",
        floor: "ground",
        elevation: 0,
        collider: { shape: "circle", radius: 6 },
      },
      upper: {
        type: "kinematic",
        floor: "bridge",
        elevation: 16,
        height: 20,
        collider: { shape: "circle", radius: 6 },
      },
    },
  });

  const lowerInitialSpan = engine.getPhysicsBodyHeightSpan(world.bodies.lower);
  const upperInitialSpan = engine.getPhysicsBodyHeightSpan(world.bodies.upper);
  ok((lowerInitialSpan?.floorId ?? 0) > 0);
  equal(lowerInitialSpan?.height, 24);
  ok((upperInitialSpan?.floorId ?? 0) > 0);
  ok(lowerInitialSpan?.floorId !== upperInitialSpan?.floorId);

  ok(engine.setPhysicsBodyHeightSpan(world.bodies.upper, {
    floorId: 3,
    elevation: 32,
    height: 12,
  }));
  const snapshot = capturePhysicsWorldSnapshot(engine, world, { frame: 1 });

  equal(snapshot.bodies.upper.state.heightSpan?.floorId, 3);
  equal(snapshot.bodies.upper.state.heightSpan?.elevation, 32);
  equal(snapshot.bodies.upper.state.heightSpan?.height, 12);

  ok(engine.setPhysicsBodyHeightSpan(world.bodies.upper, {
    floorId: 9,
    elevation: 0,
    height: 1,
  }));
  const changed = capturePhysicsWorldSnapshot(engine, world, { frame: 1 });
  ok(hashPhysicsWorldSnapshot(changed) !== snapshot.replayHash);

  const restored = restorePhysicsWorldSnapshot(engine, snapshot, { replace: world });
  const restoredSpan = engine.getPhysicsBodyHeightSpan(restored.bodies.upper);
  equal(restoredSpan?.floorId, 3);
  equal(restoredSpan?.elevation, 32);
  equal(restoredSpan?.height, 12);
});

test("physics world snapshot rejects malformed public JSON before restore", () => {
  const fake = new FakeSnapshotEngine();
  const engine = fake as unknown as FerrumEngine;
  const world = createPhysicsWorldFromSpec(engine, {
    mode: "rigid",
    solver: { stepSeconds: 0.25 },
    bodies: {
      crate: {
        type: "dynamic",
        collider: { shape: "box", size: [20, 20] },
        velocity: [4, 0],
      },
    },
  });
  const snapshot = capturePhysicsWorldSnapshot(engine, world, { frame: 1 });
  const mismatchedCount = jsonClone(snapshot);
  mismatchedCount.bodyCount += 1;
  throwsDiagnostic(
    () => restorePhysicsWorldSnapshot(engine, mismatchedCount, { replace: world }),
    /bodyCount/,
  );

  const staleHash = jsonClone(snapshot);
  staleHash.bodies.crate.state.x += 1;
  throwsDiagnostic(
    () => restorePhysicsWorldSnapshot(engine, staleHash, { replace: world }),
    /replayHash/,
  );

  const missingBody = jsonClone(snapshot);
  delete missingBody.bodies.crate;
  missingBody.bodyCount = 0;
  missingBody.replayHash = hashPhysicsWorldSnapshot(missingBody as PhysicsWorldSnapshot);
  throwsDiagnostic(
    () => restorePhysicsWorldSnapshot(engine, missingBody, { replace: world }),
    /spec\.bodies\.crate/,
  );
});

test("physics replay rollback compares deterministic snapshot hashes", () => {
  const fake = new FakeSnapshotEngine();
  const engine = fake as unknown as FerrumEngine;
  const world = createPhysicsWorldFromSpec(engine, {
    mode: "rigid",
    solver: { stepSeconds: 0.1 },
    bodies: {
      mover: {
        type: "dynamic",
        collider: { shape: "circle", radius: 5 },
        velocity: [3, 2],
      },
    },
  });

  const result = verifyPhysicsReplayRollback(engine, world, {
    frames: 5,
    deltaSeconds: 0.1,
  });

  ok(result.passed);
  equal(result.expectedHash, result.actualHash);
  ok(Math.abs(result.expectedSnapshot.bodies.mover.state.x - 1.5) < 0.0001);
  ok(Math.abs(result.actualSnapshot.bodies.mover.state.y - 1) < 0.0001);
});

test("physics replay input stream records interval snapshots and rollback hashes", () => {
  const fake = new FakeSnapshotEngine();
  const engine = fake as unknown as FerrumEngine;
  const world = createPhysicsWorldFromSpec(engine, {
    mode: "rigid",
    solver: { stepSeconds: 0.5 },
    bodies: {
      mover: {
        type: "dynamic",
        collider: { shape: "circle", radius: 5 },
        velocity: [1, 0],
        mass: 2,
      },
    },
  });
  const inputStream = createPhysicsReplayInputStream({
    frameCount: 4,
    fixedStepSeconds: 0.5,
    seed: 7,
    snapshotIntervalFrames: 2,
    events: [
      { frame: 1, body: "mover", type: "setVelocity", velocityX: 2, velocityY: 0 },
      { frame: 2, body: "mover", type: "applyImpulse", impulseX: 2, impulseY: 0 },
    ],
  });

  equal(inputStream.format, PHYSICS_REPLAY_INPUT_STREAM_FORMAT);
  equal(inputStream.version, PHYSICS_REPLAY_INPUT_STREAM_VERSION);
  const run = runPhysicsReplayInputStream(engine, world, inputStream);

  equal(run.snapshots.length, 3);
  equal(run.snapshots[0].frame, 0);
  equal(run.snapshots[1].frame, 2);
  equal(run.snapshots[2].frame, 4);
  equal(run.finalSnapshot.bodies.mover.state.x, 4.5);

  const rollbackFake = new FakeSnapshotEngine();
  const rollbackEngine = rollbackFake as unknown as FerrumEngine;
  const rollbackWorld = createPhysicsWorldFromSpec(rollbackEngine, {
    mode: "rigid",
    solver: { stepSeconds: 0.5 },
    bodies: {
      mover: {
        type: "dynamic",
        collider: { shape: "circle", radius: 5 },
        velocity: [1, 0],
        mass: 2,
      },
    },
  });
  const rollback = verifyPhysicsReplayInputStreamRollback(rollbackEngine, rollbackWorld, inputStream);
  ok(rollback.passed);
  equal(rollback.expectedHash, rollback.actualHash);
  equal(rollback.expectedRun.finalSnapshot.bodies.mover.state.x, 4.5);
});

test("physics replay input stream rejects malformed public JSON", () => {
  const fake = new FakeSnapshotEngine();
  const engine = fake as unknown as FerrumEngine;
  const world = createPhysicsWorldFromSpec(engine, {
    mode: "rigid",
    solver: { stepSeconds: 0.5 },
    bodies: {
      mover: {
        type: "dynamic",
        collider: { shape: "circle", radius: 5 },
        velocity: [1, 0],
      },
    },
  });
  const baseStream = {
    format: PHYSICS_REPLAY_INPUT_STREAM_FORMAT,
    version: PHYSICS_REPLAY_INPUT_STREAM_VERSION,
    frameCount: 1,
  };

  throwsDiagnostic(
    () =>
      runPhysicsReplayInputStream(engine, world, {
        ...baseStream,
        events: {},
      } as unknown as ReturnType<typeof createPhysicsReplayInputStream>),
    /events/,
  );
  throwsDiagnostic(
    () =>
      runPhysicsReplayInputStream(engine, world, {
        ...baseStream,
        events: [{ frame: 0, body: 1, type: "setPosition", x: 0, y: 0 }],
      } as unknown as ReturnType<typeof createPhysicsReplayInputStream>),
    /body/,
  );
  throwsDiagnostic(
    () =>
      runPhysicsReplayInputStream(engine, world, {
        ...baseStream,
        events: [{ frame: 0, body: "mover", type: "setEnabled", enabled: "yes" }],
      } as unknown as ReturnType<typeof createPhysicsReplayInputStream>),
    /enabled/,
  );
});

test("physics world snapshot hashes and restores secondary collider material state", () => {
  const fake = new FakeSnapshotEngine();
  const engine = fake as unknown as FerrumEngine;
  const world = createPhysicsWorldFromSpec(engine, {
    mode: "rigid",
    materials: {
      rubber: { friction: 0.9, restitution: 0.7, density: 1.2 },
    },
    bodies: {
      compound: {
        type: "dynamic",
        colliders: [
          { shape: "circle", radius: 8 },
          { shape: "box", size: [16, 4] },
        ],
      },
    },
  });

  ok(engine.setPhysicsBodyColliderMaterial(world.bodies.compound, 1, {
    friction: 0.9,
    restitution: 0.7,
    density: 1.2,
  }));
  const snapshot = capturePhysicsWorldSnapshot(engine, world, { frame: 1 });

  equal(snapshot.bodies.compound.colliders.length, 2);
  equal(snapshot.bodies.compound.colliders[1]?.state.colliderMaterialOverride, true);
  equal(snapshot.bodies.compound.colliders[1]?.state.colliderMaterial.friction, 0.9);

  ok(engine.setPhysicsBodyColliderMaterial(world.bodies.compound, 1, {
    friction: 0.1,
    restitution: 0,
    density: 1,
  }));
  const changed = capturePhysicsWorldSnapshot(engine, world, { frame: 1 });
  ok(hashPhysicsWorldSnapshot(changed) !== snapshot.replayHash);

  const restored = restorePhysicsWorldSnapshot(engine, snapshot, { replace: world });
  equal(engine.getPhysicsBodyCollider(restored.bodies.compound, 1)?.colliderMaterial.friction, 0.9);
});

test("physics world snapshot preserves dedicated chain colliders", () => {
  const fake = new FakeSnapshotEngine();
  const engine = fake as unknown as FerrumEngine;
  const world = createPhysicsWorldFromSpec(engine, {
    mode: "rigid",
    bodies: {
      chainWall: {
        type: "static",
        collider: {
          shape: "chain",
          vertices: [[0, 0], [16, 0], [16, 16]],
          loop: true,
        },
      },
    },
  });

  const snapshot = capturePhysicsWorldSnapshot(engine, world, { frame: 1 });

  equal(snapshot.bodies.chainWall.colliders.length, 1);
  equal(snapshot.bodies.chainWall.colliders[0]?.spec.shape, "chain");
  equal(snapshot.bodies.chainWall.colliders[0]?.state.colliderType, "chain");

  const restored = restorePhysicsWorldSnapshot(engine, snapshot, { replace: world });
  equal(engine.getPhysicsBodyColliderCount(restored.bodies.chainWall), 1);
});

test("physics world snapshot rejects runtime colliders outside the resolved spec", () => {
  const fake = new FakeSnapshotEngine();
  const engine = fake as unknown as FerrumEngine;
  const world = createPhysicsWorldFromSpec(engine, {
    mode: "rigid",
    bodies: {
      crate: {
        type: "dynamic",
        collider: { shape: "box", size: [20, 20] },
      },
    },
  });

  ok(engine.addPhysicsBodyCollider(world.bodies.crate, {
    collider: { type: "circle", radius: 4 },
  }));
  let rejected = false;
  try {
    capturePhysicsWorldSnapshot(engine, world);
  } catch (error) {
    rejected = String(error).includes("runtime collider count must match the expanded resolved spec collider count");
  }
  ok(rejected);
});

function materialSnapshot(material: PhysicsRigidBodyMaterial | undefined): PhysicsMaterialSnapshot {
  return {
    restitution: material?.restitution ?? 0,
    friction: material?.friction ?? 0.4,
    surfaceVelocityX: material?.surfaceVelocityX ?? 0,
    surfaceVelocityY: material?.surfaceVelocityY ?? 0,
    density: material?.density ?? 1,
    contactBaumgarteBiasScale: material?.contactBaumgarteBiasScale ?? 1,
    maxContactBaumgarteBiasVelocityScale: material?.maxContactBaumgarteBiasVelocityScale ?? 1,
    contactPositionCorrectionScale: material?.contactPositionCorrectionScale ?? 1,
    contactPositionCorrectionSlopScale: material?.contactPositionCorrectionSlopScale ?? 1,
  };
}

function cloneBody(body: PhysicsEntitySnapshot | undefined): PhysicsEntitySnapshot | undefined {
  return body === undefined
    ? undefined
    : {
        ...body,
        colliderMaterial: { ...body.colliderMaterial },
      };
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function throwsDiagnostic(run: () => void, pattern: RegExp): void {
  try {
    run();
  } catch (error) {
    ok(pattern.test(String(error)), `expected ${String(error)} to match ${pattern}`);
    return;
  }
  ok(false, `expected error matching ${pattern}`);
}
