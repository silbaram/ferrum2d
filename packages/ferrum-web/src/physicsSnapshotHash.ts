import type {
  PhysicsReplayFrameSnapshot,
  PhysicsReplayInputStream,
  PhysicsWorldSnapshot,
  PhysicsWorldSnapshotBody,
  PhysicsWorldSnapshotCollider,
  PhysicsWorldSnapshotHashOptions,
  PhysicsWorldSnapshotJoint,
} from "./physicsSnapshotTypes.js";

export function hashPhysicsWorldSnapshot(
  snapshot: PhysicsWorldSnapshot,
  options: PhysicsWorldSnapshotHashOptions = {},
): string {
  const canonical = {
    format: snapshot.format,
    version: snapshot.version,
    frame: snapshot.frame,
    source: snapshot.source,
    spec: snapshot.spec,
    stepSeconds: snapshot.stepSeconds,
    stepOptions: snapshot.stepOptions,
    bodies: Object.fromEntries(
      Object.entries(snapshot.bodies)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([id, body]) => [id, canonicalBodySnapshot(body, options.includeHandles === true)]),
    ),
    joints: Object.fromEntries(
      Object.entries(snapshot.joints)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([id, joint]) => [id, canonicalJointSnapshot(joint, options.includeHandles === true)]),
    ),
  };
  return fnv1a32(stableStringify(canonical));
}

export function hashPhysicsReplayRun(
  inputStream: PhysicsReplayInputStream,
  snapshots: readonly PhysicsReplayFrameSnapshot[],
): string {
  return fnv1a32(stableStringify({
    format: "ferrum2d.physics-replay.run",
    version: 1,
    inputStream: canonicalReplayInputStream(inputStream),
    snapshots: snapshots.map((entry) => ({
      frame: entry.frame,
      replayHash: entry.replayHash,
    })),
  }));
}

function canonicalReplayInputStream(inputStream: PhysicsReplayInputStream): object {
  return {
    format: inputStream.format,
    version: inputStream.version,
    frameCount: inputStream.frameCount,
    fixedStepSeconds: inputStream.fixedStepSeconds,
    seed: inputStream.seed,
    snapshotIntervalFrames: inputStream.snapshotIntervalFrames,
    events: [...(inputStream.events ?? [])].sort((left, right) => {
      const frameOrder = left.frame - right.frame;
      if (frameOrder !== 0) {
        return frameOrder;
      }
      const bodyOrder = left.body.localeCompare(right.body);
      if (bodyOrder !== 0) {
        return bodyOrder;
      }
      return left.type.localeCompare(right.type);
    }),
  };
}

function canonicalBodySnapshot(body: PhysicsWorldSnapshotBody, includeHandles: boolean): object {
  const state = body.state;
  return {
    id: body.id,
    ...(includeHandles ? { handle: body.handle } : {}),
    state: {
      ...(includeHandles ? { entityId: state.entityId, entityGeneration: state.entityGeneration } : {}),
      x: state.x,
      y: state.y,
      velocityX: state.velocityX,
      velocityY: state.velocityY,
      rotationRadians: state.rotationRadians,
      angularVelocityRadiansPerSecond: state.angularVelocityRadiansPerSecond,
      bodyType: state.bodyType,
      bodyEnabled: state.bodyEnabled,
      colliderType: state.colliderType,
      colliderEnabled: state.colliderEnabled,
      colliderIsTrigger: state.colliderIsTrigger,
      colliderOffsetX: state.colliderOffsetX,
      colliderOffsetY: state.colliderOffsetY,
      colliderMaterialOverride: state.colliderMaterialOverride,
      colliderMaterial: state.colliderMaterial,
      mass: state.mass,
      inverseMass: state.inverseMass,
      inertia: state.inertia,
      inverseInertia: state.inverseInertia,
      gravityScale: state.gravityScale,
      linearDamping: state.linearDamping,
      angularDamping: state.angularDamping,
      restitution: state.restitution,
      friction: state.friction,
      surfaceVelocityX: state.surfaceVelocityX,
      surfaceVelocityY: state.surfaceVelocityY,
      density: state.density,
      contactBaumgarteBiasScale: state.contactBaumgarteBiasScale,
      maxContactBaumgarteBiasVelocityScale: state.maxContactBaumgarteBiasVelocityScale,
      contactPositionCorrectionScale: state.contactPositionCorrectionScale,
      contactPositionCorrectionSlopScale: state.contactPositionCorrectionSlopScale,
    },
    colliders: body.colliders.map((collider) => canonicalColliderSnapshot(collider)),
  };
}

function canonicalColliderSnapshot(collider: PhysicsWorldSnapshotCollider): object {
  const state = collider.state;
  return {
    colliderIndex: collider.colliderIndex,
    spec: collider.spec,
    state: {
      colliderIndex: state.colliderIndex,
      colliderType: state.colliderType,
      colliderEnabled: state.colliderEnabled,
      colliderIsTrigger: state.colliderIsTrigger,
      colliderOffsetX: state.colliderOffsetX,
      colliderOffsetY: state.colliderOffsetY,
      colliderMaterialOverride: state.colliderMaterialOverride,
      colliderMaterial: state.colliderMaterial,
      categoryBits: state.categoryBits,
      maskBits: state.maskBits,
    },
  };
}

function canonicalJointSnapshot(joint: PhysicsWorldSnapshotJoint, includeHandles: boolean): object {
  const state = joint.state;
  return {
    id: joint.id,
    ...(includeHandles ? { handle: joint.handle } : {}),
    state: {
      ...(includeHandles
        ? {
            jointType: state.jointType,
            jointIndex: state.jointIndex,
            jointGeneration: state.jointGeneration,
            entityA: state.entityA,
            entityB: state.entityB,
          }
        : {}),
      enabled: state.enabled,
      restLength: state.restLength,
      maxLength: state.maxLength,
      ratio: state.ratio,
      referenceAngle: state.referenceAngle,
      breakDistance: state.breakDistance,
      breakAngle: state.breakAngle,
      stiffness: state.stiffness,
      damping: state.damping,
      angularStiffness: state.angularStiffness,
      angularDamping: state.angularDamping,
      localAnchorAX: state.localAnchorAX,
      localAnchorAY: state.localAnchorAY,
      localAnchorBX: state.localAnchorBX,
      localAnchorBY: state.localAnchorBY,
      localAxisAX: state.localAxisAX,
      localAxisAY: state.localAxisAY,
      groundAnchorAX: state.groundAnchorAX,
      groundAnchorAY: state.groundAnchorAY,
      groundAnchorBX: state.groundAnchorBX,
      groundAnchorBY: state.groundAnchorBY,
      limitEnabled: state.limitEnabled,
      lowerAngle: state.lowerAngle,
      upperAngle: state.upperAngle,
      lowerTranslation: state.lowerTranslation,
      upperTranslation: state.upperTranslation,
      motorEnabled: state.motorEnabled,
      motorSpeed: state.motorSpeed,
      maxMotorForce: state.maxMotorForce,
      maxMotorTorque: state.maxMotorTorque,
    },
  };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
