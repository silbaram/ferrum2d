import type {
  FerrumEngine,
  PhysicsBodyColliderSnapshot,
  PhysicsBodyHeightSpan,
  PhysicsEntityHandle,
  PhysicsEntitySnapshot,
  PhysicsRigidBodyMaterial,
  PhysicsRigidBodyStepStats,
} from "./engineTypes.js";
import { physicsSpecDiagnosticError } from "./diagnostics.js";
import {
  createPhysicsBodyStateBufferSnapshot,
  type PhysicsBodyStateBufferSnapshot,
} from "./physicsBodyStateBuffer.js";
import {
  createPhysicsWorldFromSpec,
  resolvedPhysicsColliderRuntimeCount,
  type PhysicsWorldApplyResult,
} from "./physicsAuthoring.js";
import type { ResolvedPhysicsColliderSpec } from "./physicsSpec.js";
import {
  PHYSICS_WORLD_SNAPSHOT_FORMAT,
  PHYSICS_WORLD_SNAPSHOT_VERSION,
  type CapturePhysicsWorldSnapshotOptions,
  type PhysicsReplayRollbackOptions,
  type PhysicsReplayRollbackResult,
  type PhysicsWorldRestoreResult,
  type PhysicsWorldSnapshot,
  type PhysicsWorldSnapshotCollider,
  type RestorePhysicsWorldSnapshotOptions,
} from "./physicsSnapshotTypes.js";
import {
  hashPhysicsWorldSnapshot,
} from "./physicsSnapshotHash.js";
import {
  ensureRuntimeAccepted,
  finitePositiveNumber,
  nonNegativeInteger,
  validatePhysicsWorldSnapshot,
} from "./physicsSnapshotValidation.js";

export function capturePhysicsWorldSnapshot(
  engine: FerrumEngine,
  world: PhysicsWorldApplyResult,
  options: CapturePhysicsWorldSnapshotOptions = {},
): PhysicsWorldSnapshot {
  const frame = nonNegativeInteger(options.frame ?? 0, "physics snapshot frame");
  const bodyEntries = Object.entries(world.bodies);
  const bulkBodyState = captureBulkBodyState(engine, bodyEntries.map(([, handle]) => handle));
  const bodies = Object.fromEntries(
    bodyEntries.map(([id, handle], entryIndex) => {
      const capturedState = bulkBodyState?.states[entryIndex] ?? engine.getPhysicsEntity(handle);
      const state = capturedState === undefined
        ? undefined
        : withRuntimeHeightSpan(engine, handle, capturedState);
      if (state === undefined) {
        throw physicsSpecDiagnosticError(`physics.snapshot.bodies.${id}`, "body handle is no longer alive");
      }
      const bodySpec = world.spec.bodies[id];
      if (!bodySpec) {
        throw physicsSpecDiagnosticError(`physics.snapshot.bodies.${id}`, "body is missing from resolved spec");
      }
      const runtimeColliderCount = engine.getPhysicsBodyColliderCount(handle);
      const runtimeColliderSpecs = runtimeColliderSpecsForSnapshot(bodySpec.colliders);
      if (runtimeColliderCount !== runtimeColliderSpecs.length) {
        throw physicsSpecDiagnosticError(
          `physics.snapshot.bodies.${id}.colliders`,
          "runtime collider count must match the expanded resolved spec collider count",
        );
      }
      const colliders = runtimeColliderSpecs.map((collider, colliderIndex) => {
        const colliderState = engine.getPhysicsBodyCollider(handle, colliderIndex);
        if (!colliderState) {
          throw physicsSpecDiagnosticError(
            `physics.snapshot.bodies.${id}.colliders.${colliderIndex}`,
            "collider handle is no longer alive",
          );
        }
        return {
          colliderIndex,
          spec: collider,
          state: colliderState,
        };
      });
      return [id, { id, handle: { ...handle }, state, colliders }];
    }),
  );
  const joints = Object.fromEntries(
    Object.entries(world.joints).map(([id, handle]) => {
      const state = engine.getPhysicsJoint(handle);
      if (!state) {
        throw physicsSpecDiagnosticError(`physics.snapshot.joints.${id}`, "joint handle is no longer alive");
      }
      return [id, { id, handle: { ...handle }, state }];
    }),
  );
  const snapshot: PhysicsWorldSnapshot = {
    format: PHYSICS_WORLD_SNAPSHOT_FORMAT,
    version: PHYSICS_WORLD_SNAPSHOT_VERSION,
    frame,
    source: "physics-spec",
    spec: world.spec,
    stepSeconds: world.stepSeconds,
    stepOptions: { ...world.stepOptions },
    bodies,
    joints,
    worldAnchors: world.worldAnchors.map((handle) => ({ ...handle })),
    bodyCount: Object.keys(bodies).length,
    jointCount: Object.keys(joints).length,
    replayHash: "",
  };
  return {
    ...snapshot,
    replayHash: hashPhysicsWorldSnapshot(snapshot),
  };
}

export function restorePhysicsWorldSnapshot(
  engine: FerrumEngine,
  snapshot: PhysicsWorldSnapshot,
  options: RestorePhysicsWorldSnapshotOptions = {},
): PhysicsWorldRestoreResult {
  validatePhysicsWorldSnapshot(snapshot, options.path ?? "physics.snapshot");
  const restored = createPhysicsWorldFromSpec(engine, snapshot.spec, {
    path: options.path ?? "physics",
    replace: options.replace,
    unsafeUnitScaleThreshold: options.unsafeUnitScaleThreshold,
    onWarning: options.onWarning,
  });

  const bodyEntries = Object.entries(snapshot.bodies);
  const restoredBodyStates: PhysicsEntitySnapshot[] = [];
  for (const [id, entry] of bodyEntries) {
    const handle = restored.bodies[id];
    if (!handle) {
      throw physicsSpecDiagnosticError(`physics.snapshot.bodies.${id}`, "body is missing after restore");
    }
    restoredBodyStates.push({ ...entry.state, ...handle });
  }
  if (!restoreBulkBodyState(engine, restoredBodyStates)) {
    for (const [id, entry] of bodyEntries) {
      const handle = restored.bodies[id];
      if (!handle) {
        throw physicsSpecDiagnosticError(`physics.snapshot.bodies.${id}`, "body is missing after restore");
      }
      restorePhysicsBodyState(engine, handle, entry.state, `physics.snapshot.bodies.${id}`);
    }
  }

  for (const [id, entry] of bodyEntries) {
    const handle = restored.bodies[id];
    if (!handle) {
      throw physicsSpecDiagnosticError(`physics.snapshot.bodies.${id}`, "body is missing after restore");
    }
    restorePhysicsBodyHeightSpan(engine, handle, entry.state, `physics.snapshot.bodies.${id}.state.heightSpan`);
  }

  for (const [id, entry] of bodyEntries) {
    const handle = restored.bodies[id];
    if (!handle) {
      throw physicsSpecDiagnosticError(`physics.snapshot.bodies.${id}`, "body is missing after restore");
    }
    restorePhysicsBodyColliderStates(engine, handle, entry.colliders, `physics.snapshot.bodies.${id}.colliders`);
  }

  for (const [id, entry] of Object.entries(snapshot.joints)) {
    const handle = restored.joints[id];
    if (!handle) {
      throw physicsSpecDiagnosticError(`physics.snapshot.joints.${id}`, "joint is missing after restore");
    }
    if (!engine.setPhysicsJointEnabled(handle, entry.state.enabled)) {
      throw physicsSpecDiagnosticError(`physics.snapshot.joints.${id}.enabled`, "runtime rejected joint enabled state");
    }
  }

  return {
    ...restored,
    sourceSnapshot: snapshot,
    restoredBodyCount: Object.keys(snapshot.bodies).length,
    restoredJointCount: Object.keys(snapshot.joints).length,
  };
}

export function verifyPhysicsReplayRollback(
  engine: FerrumEngine,
  world: PhysicsWorldApplyResult,
  options: PhysicsReplayRollbackOptions,
): PhysicsReplayRollbackResult {
  const frames = nonNegativeInteger(options.frames, "physics replay frames");
  const deltaSeconds = finitePositiveNumber(options.deltaSeconds ?? world.stepSeconds, "physics replay deltaSeconds");
  const initialSnapshot = capturePhysicsWorldSnapshot(engine, world, { frame: 0 });
  const stepStats: PhysicsRigidBodyStepStats[] = [];
  for (let frame = 0; frame < frames; frame += 1) {
    stepStats.push(engine.stepRigidBodies(deltaSeconds, options.stepOptions ?? world.stepOptions));
  }
  const expectedSnapshot = capturePhysicsWorldSnapshot(engine, world, { frame: frames });
  const restoredWorld = restorePhysicsWorldSnapshot(engine, initialSnapshot, {
    replace: world,
    path: options.path,
  });
  for (let frame = 0; frame < frames; frame += 1) {
    stepStats.push(engine.stepRigidBodies(deltaSeconds, options.stepOptions ?? restoredWorld.stepOptions));
  }
  const actualSnapshot = capturePhysicsWorldSnapshot(engine, restoredWorld, { frame: frames });
  const expectedHash = hashPhysicsWorldSnapshot(expectedSnapshot);
  const actualHash = hashPhysicsWorldSnapshot(actualSnapshot);

  return {
    passed: expectedHash === actualHash,
    frames,
    deltaSeconds,
    initialHash: hashPhysicsWorldSnapshot(initialSnapshot),
    expectedHash,
    actualHash,
    expectedSnapshot,
    actualSnapshot,
    restoredWorld,
    stepStats,
  };
}

function runtimeColliderSpecsForSnapshot(
  colliders: readonly ResolvedPhysicsColliderSpec[],
): readonly ResolvedPhysicsColliderSpec[] {
  return colliders.flatMap((collider) =>
    Array.from({ length: resolvedPhysicsColliderRuntimeCount(collider) }, () => collider)
  );
}

function captureBulkBodyState(
  engine: FerrumEngine,
  handles: readonly PhysicsEntityHandle[],
): PhysicsBodyStateBufferSnapshot | undefined {
  if (handles.length === 0 || typeof engine.capturePhysicsBodyStateBuffer !== "function") {
    return undefined;
  }
  return engine.capturePhysicsBodyStateBuffer(handles);
}

function restoreBulkBodyState(
  engine: FerrumEngine,
  states: readonly PhysicsEntitySnapshot[],
): boolean {
  if (states.length === 0) {
    return true;
  }
  if (typeof engine.restorePhysicsBodyStateBuffer !== "function") {
    return false;
  }
  return engine.restorePhysicsBodyStateBuffer(createPhysicsBodyStateBufferSnapshot(states));
}

function withRuntimeHeightSpan(
  engine: FerrumEngine,
  handle: PhysicsEntityHandle,
  state: PhysicsEntitySnapshot,
): PhysicsEntitySnapshot {
  const heightSpan = readRuntimeHeightSpan(engine, handle);
  return {
    ...state,
    heightSpan: heightSpan === undefined ? null : heightSpan,
  };
}

function readRuntimeHeightSpan(
  engine: FerrumEngine,
  handle: PhysicsEntityHandle,
): PhysicsBodyHeightSpan | undefined {
  const reader = (engine as FerrumEngine & {
    getPhysicsBodyHeightSpan?: (body: PhysicsEntityHandle) => PhysicsBodyHeightSpan | undefined;
  }).getPhysicsBodyHeightSpan;
  if (typeof reader !== "function") {
    return undefined;
  }
  const heightSpan = reader.call(engine, handle);
  return heightSpan === undefined ? undefined : { ...heightSpan };
}

function restorePhysicsBodyState(
  engine: FerrumEngine,
  handle: PhysicsEntityHandle,
  state: PhysicsEntitySnapshot,
  path: string,
): void {
  ensureRuntimeAccepted(engine.setPhysicsBodyPosition(handle, state.x, state.y), `${path}.position`);
  ensureRuntimeAccepted(
    engine.setPhysicsBodyVelocity(handle, state.velocityX, state.velocityY),
    `${path}.velocity`,
  );
  ensureRuntimeAccepted(
    engine.setPhysicsBodyRotation(handle, state.rotationRadians),
    `${path}.rotationRadians`,
  );
  ensureRuntimeAccepted(
    engine.setPhysicsBodyAngularVelocity(handle, state.angularVelocityRadiansPerSecond),
    `${path}.angularVelocityRadiansPerSecond`,
  );
  ensureRuntimeAccepted(engine.setPhysicsBodyEnabled(handle, state.bodyEnabled), `${path}.bodyEnabled`);
  ensureRuntimeAccepted(
    engine.setPhysicsColliderOffset(handle, state.colliderOffsetX, state.colliderOffsetY),
    `${path}.colliderOffset`,
  );
  ensureRuntimeAccepted(
    engine.setPhysicsColliderEnabled(handle, state.colliderEnabled),
    `${path}.colliderEnabled`,
  );
  ensureRuntimeAccepted(
    engine.setPhysicsBodyTuning(handle, {
      gravityScale: state.gravityScale,
      linearDamping: state.linearDamping,
      angularDamping: state.angularDamping,
    }),
    `${path}.tuning`,
  );
  if (state.bodyType === "dynamic" && state.mass > 0 && state.inertia > 0) {
    ensureRuntimeAccepted(
      engine.setPhysicsBodyMassProperties(handle, {
        mass: state.mass,
        inertia: state.inertia,
      }),
      `${path}.massProperties`,
    );
  }
  ensureRuntimeAccepted(engine.setPhysicsBodyMaterial(handle, materialFromSnapshot(state)), `${path}.material`);
  if (state.colliderMaterialOverride) {
    ensureRuntimeAccepted(
      engine.setPhysicsColliderMaterial(handle, state.colliderMaterial),
      `${path}.colliderMaterial`,
    );
  } else {
    ensureRuntimeAccepted(engine.clearPhysicsColliderMaterial(handle), `${path}.colliderMaterial`);
  }
}

function restorePhysicsBodyHeightSpan(
  engine: FerrumEngine,
  handle: PhysicsEntityHandle,
  state: PhysicsEntitySnapshot,
  path: string,
): void {
  if (!Object.prototype.hasOwnProperty.call(state, "heightSpan")) {
    return;
  }
  if (state.heightSpan === null || state.heightSpan === undefined) {
    ensureRuntimeAccepted(engine.clearPhysicsBodyHeightSpan(handle), path);
    return;
  }
  ensureRuntimeAccepted(engine.setPhysicsBodyHeightSpan(handle, state.heightSpan), path);
}

function restorePhysicsBodyColliderStates(
  engine: FerrumEngine,
  handle: PhysicsEntityHandle,
  colliders: readonly PhysicsWorldSnapshotCollider[],
  path: string,
): void {
  for (const collider of colliders.slice(1)) {
    if (!collider.state.colliderMaterialOverride) {
      continue;
    }
    ensureRuntimeAccepted(
      engine.setPhysicsBodyColliderMaterial(
        handle,
        collider.colliderIndex,
        materialFromColliderSnapshot(collider.state),
      ),
      `${path}.${collider.colliderIndex}.material`,
    );
  }
}

function materialFromSnapshot(state: PhysicsEntitySnapshot): Required<PhysicsRigidBodyMaterial> {
  return {
    restitution: state.restitution,
    friction: state.friction,
    surfaceVelocityX: state.surfaceVelocityX,
    surfaceVelocityY: state.surfaceVelocityY,
    density: state.density,
    contactBaumgarteBiasScale: state.contactBaumgarteBiasScale,
    maxContactBaumgarteBiasVelocityScale: state.maxContactBaumgarteBiasVelocityScale,
    contactPositionCorrectionScale: state.contactPositionCorrectionScale,
    contactPositionCorrectionSlopScale: state.contactPositionCorrectionSlopScale,
  };
}

function materialFromColliderSnapshot(
  state: PhysicsBodyColliderSnapshot,
): Required<PhysicsRigidBodyMaterial> {
  return {
    restitution: state.colliderMaterial.restitution,
    friction: state.colliderMaterial.friction,
    surfaceVelocityX: state.colliderMaterial.surfaceVelocityX,
    surfaceVelocityY: state.colliderMaterial.surfaceVelocityY,
    density: state.colliderMaterial.density,
    contactBaumgarteBiasScale: state.colliderMaterial.contactBaumgarteBiasScale,
    maxContactBaumgarteBiasVelocityScale:
      state.colliderMaterial.maxContactBaumgarteBiasVelocityScale,
    contactPositionCorrectionScale: state.colliderMaterial.contactPositionCorrectionScale,
    contactPositionCorrectionSlopScale: state.colliderMaterial.contactPositionCorrectionSlopScale,
  };
}
