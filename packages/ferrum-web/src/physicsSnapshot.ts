import type {
  FerrumEngine,
  PhysicsBodyColliderSnapshot,
  PhysicsEntityHandle,
  PhysicsEntitySnapshot,
  PhysicsJointHandle,
  PhysicsJointSnapshot,
  PhysicsRigidBodyMaterial,
  PhysicsRigidBodyStepOptions,
  PhysicsRigidBodyStepStats,
} from "./createEngine.js";
import { physicsSpecDiagnosticError } from "./diagnostics.js";
import {
  createPhysicsBodyStateBufferSnapshot,
  type PhysicsBodyStateBufferSnapshot,
} from "./physicsBodyStateBuffer.js";
import {
  createPhysicsWorldFromSpec,
  resolvedPhysicsColliderRuntimeCount,
  type PhysicsWorldApplyOptions,
  type PhysicsWorldApplyResult,
} from "./physicsAuthoring.js";
import type { ResolvedPhysicsColliderSpec, ResolvedPhysicsSpec } from "./physicsSpec.js";

export const PHYSICS_WORLD_SNAPSHOT_FORMAT = "ferrum2d.physics-world.snapshot";
export const PHYSICS_WORLD_SNAPSHOT_VERSION = 1;
export const PHYSICS_REPLAY_INPUT_STREAM_FORMAT = "ferrum2d.physics-replay.input-stream";
export const PHYSICS_REPLAY_INPUT_STREAM_VERSION = 1;

export interface PhysicsWorldSnapshot {
  format: typeof PHYSICS_WORLD_SNAPSHOT_FORMAT;
  version: typeof PHYSICS_WORLD_SNAPSHOT_VERSION;
  frame: number;
  source: "physics-spec";
  spec: ResolvedPhysicsSpec;
  stepSeconds: number;
  stepOptions: PhysicsRigidBodyStepOptions;
  bodies: Record<string, PhysicsWorldSnapshotBody>;
  joints: Record<string, PhysicsWorldSnapshotJoint>;
  worldAnchors: readonly PhysicsEntityHandle[];
  bodyCount: number;
  jointCount: number;
  replayHash: string;
}

export interface PhysicsWorldSnapshotBody {
  id: string;
  handle: PhysicsEntityHandle;
  state: PhysicsEntitySnapshot;
  colliders: readonly PhysicsWorldSnapshotCollider[];
}

export interface PhysicsWorldSnapshotCollider {
  colliderIndex: number;
  spec: ResolvedPhysicsColliderSpec;
  state: PhysicsBodyColliderSnapshot;
}

export interface PhysicsWorldSnapshotJoint {
  id: string;
  handle: PhysicsJointHandle;
  state: PhysicsJointSnapshot;
}

export interface CapturePhysicsWorldSnapshotOptions {
  frame?: number;
}

export interface RestorePhysicsWorldSnapshotOptions
  extends Pick<PhysicsWorldApplyOptions, "path" | "unsafeUnitScaleThreshold" | "onWarning"> {
  replace?: PhysicsWorldApplyResult;
}

export interface PhysicsWorldRestoreResult extends PhysicsWorldApplyResult {
  sourceSnapshot: PhysicsWorldSnapshot;
  restoredBodyCount: number;
  restoredJointCount: number;
}

export interface PhysicsWorldSnapshotHashOptions {
  includeHandles?: boolean;
}

export interface PhysicsReplayRollbackOptions {
  frames: number;
  deltaSeconds?: number;
  stepOptions?: PhysicsRigidBodyStepOptions;
  path?: string;
}

export interface PhysicsReplayInputStream {
  format: typeof PHYSICS_REPLAY_INPUT_STREAM_FORMAT;
  version: typeof PHYSICS_REPLAY_INPUT_STREAM_VERSION;
  frameCount: number;
  fixedStepSeconds?: number;
  seed?: number;
  snapshotIntervalFrames?: number;
  events?: readonly PhysicsReplayInputEvent[];
}

export type PhysicsReplayInputEvent =
  | PhysicsReplaySetPositionEvent
  | PhysicsReplaySetVelocityEvent
  | PhysicsReplaySetEnabledEvent
  | PhysicsReplayApplyForceEvent
  | PhysicsReplayApplyImpulseEvent;

export interface PhysicsReplayInputEventBase {
  frame: number;
  body: string;
}

export interface PhysicsReplaySetPositionEvent extends PhysicsReplayInputEventBase {
  type: "setPosition";
  x: number;
  y: number;
}

export interface PhysicsReplaySetVelocityEvent extends PhysicsReplayInputEventBase {
  type: "setVelocity";
  velocityX: number;
  velocityY: number;
}

export interface PhysicsReplaySetEnabledEvent extends PhysicsReplayInputEventBase {
  type: "setEnabled";
  enabled: boolean;
}

export interface PhysicsReplayApplyForceEvent extends PhysicsReplayInputEventBase {
  type: "applyForce";
  forceX: number;
  forceY: number;
}

export interface PhysicsReplayApplyImpulseEvent extends PhysicsReplayInputEventBase {
  type: "applyImpulse";
  impulseX: number;
  impulseY: number;
}

export interface PhysicsReplayInputRunOptions {
  path?: string;
  stepOptions?: PhysicsRigidBodyStepOptions;
}

export interface PhysicsReplayInputRunResult {
  inputStream: PhysicsReplayInputStream;
  frameCount: number;
  deltaSeconds: number;
  seed?: number;
  replayHash: string;
  snapshots: readonly PhysicsReplayFrameSnapshot[];
  finalSnapshot: PhysicsWorldSnapshot;
  stepStats: readonly PhysicsRigidBodyStepStats[];
}

export interface PhysicsReplayFrameSnapshot {
  frame: number;
  snapshot: PhysicsWorldSnapshot;
  replayHash: string;
}

export interface PhysicsReplayInputRollbackOptions extends PhysicsReplayInputRunOptions {
  restorePath?: string;
}

export interface PhysicsReplayInputRollbackResult {
  passed: boolean;
  initialHash: string;
  expectedHash: string;
  actualHash: string;
  expectedRun: PhysicsReplayInputRunResult;
  actualRun: PhysicsReplayInputRunResult;
  restoredWorld: PhysicsWorldRestoreResult;
}

export interface PhysicsReplayRollbackResult {
  passed: boolean;
  frames: number;
  deltaSeconds: number;
  initialHash: string;
  expectedHash: string;
  actualHash: string;
  expectedSnapshot: PhysicsWorldSnapshot;
  actualSnapshot: PhysicsWorldSnapshot;
  restoredWorld: PhysicsWorldRestoreResult;
  stepStats: readonly PhysicsRigidBodyStepStats[];
}

export function createPhysicsReplayInputStream(
  options: Omit<PhysicsReplayInputStream, "format" | "version">,
): PhysicsReplayInputStream {
  const stream: PhysicsReplayInputStream = {
    format: PHYSICS_REPLAY_INPUT_STREAM_FORMAT,
    version: PHYSICS_REPLAY_INPUT_STREAM_VERSION,
    frameCount: nonNegativeInteger(options.frameCount, "physics replay frameCount"),
    ...(options.fixedStepSeconds === undefined
      ? {}
      : { fixedStepSeconds: finitePositiveNumber(options.fixedStepSeconds, "physics replay fixedStepSeconds") }),
    ...(options.seed === undefined ? {} : { seed: nonNegativeInteger(options.seed, "physics replay seed") }),
    ...(options.snapshotIntervalFrames === undefined
      ? {}
      : {
          snapshotIntervalFrames: positiveInteger(
            options.snapshotIntervalFrames,
            "physics replay snapshotIntervalFrames",
          ),
        }),
    events: [...(options.events ?? [])],
  };
  validatePhysicsReplayInputStream(stream, "physics.replay");
  return stream;
}

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
      const state = bulkBodyState?.states[entryIndex] ?? engine.getPhysicsEntity(handle);
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

export function runPhysicsReplayInputStream(
  engine: FerrumEngine,
  world: PhysicsWorldApplyResult,
  inputStream: PhysicsReplayInputStream,
  options: PhysicsReplayInputRunOptions = {},
): PhysicsReplayInputRunResult {
  const path = options.path ?? "physics.replay";
  validatePhysicsReplayInputStream(inputStream, path);
  const frameCount = inputStream.frameCount;
  const deltaSeconds = finitePositiveNumber(
    inputStream.fixedStepSeconds ?? world.stepSeconds,
    `${path}.fixedStepSeconds`,
  );
  const eventsByFrame = replayEventsByFrame(inputStream, path);
  const stepOptions = options.stepOptions ?? world.stepOptions;
  const stepStats: PhysicsRigidBodyStepStats[] = [];
  const snapshots: PhysicsReplayFrameSnapshot[] = [];
  const snapshotIntervalFrames = inputStream.snapshotIntervalFrames;

  appendReplaySnapshot(engine, world, 0, snapshots);
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (const event of eventsByFrame.get(frame) ?? []) {
      applyPhysicsReplayInputEvent(engine, world, event, path);
    }
    stepStats.push(engine.stepRigidBodies(deltaSeconds, stepOptions));
    const nextFrame = frame + 1;
    if (
      nextFrame === frameCount ||
      (snapshotIntervalFrames !== undefined && nextFrame % snapshotIntervalFrames === 0)
    ) {
      appendReplaySnapshot(engine, world, nextFrame, snapshots);
    }
  }

  const finalSnapshot = snapshots[snapshots.length - 1]?.snapshot
    ?? capturePhysicsWorldSnapshot(engine, world, { frame: frameCount });
  const resultHash = hashPhysicsReplayRun(inputStream, snapshots);
  return {
    inputStream,
    frameCount,
    deltaSeconds,
    ...(inputStream.seed === undefined ? {} : { seed: inputStream.seed }),
    replayHash: resultHash,
    snapshots,
    finalSnapshot,
    stepStats,
  };
}

export function verifyPhysicsReplayInputStreamRollback(
  engine: FerrumEngine,
  world: PhysicsWorldApplyResult,
  inputStream: PhysicsReplayInputStream,
  options: PhysicsReplayInputRollbackOptions = {},
): PhysicsReplayInputRollbackResult {
  const initialSnapshot = capturePhysicsWorldSnapshot(engine, world, { frame: 0 });
  const expectedRun = runPhysicsReplayInputStream(engine, world, inputStream, options);
  const restoredWorld = restorePhysicsWorldSnapshot(engine, initialSnapshot, {
    replace: world,
    path: options.restorePath ?? options.path,
  });
  const actualRun = runPhysicsReplayInputStream(engine, restoredWorld, inputStream, options);
  return {
    passed: expectedRun.replayHash === actualRun.replayHash,
    initialHash: initialSnapshot.replayHash,
    expectedHash: expectedRun.replayHash,
    actualHash: actualRun.replayHash,
    expectedRun,
    actualRun,
    restoredWorld,
  };
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

function validatePhysicsWorldSnapshot(snapshot: PhysicsWorldSnapshot, path: string): void {
  if (snapshot.format !== PHYSICS_WORLD_SNAPSHOT_FORMAT) {
    throw physicsSpecDiagnosticError(`${path}.format`, `must be '${PHYSICS_WORLD_SNAPSHOT_FORMAT}'`);
  }
  if (snapshot.version !== PHYSICS_WORLD_SNAPSHOT_VERSION) {
    throw physicsSpecDiagnosticError(`${path}.version`, `must be ${PHYSICS_WORLD_SNAPSHOT_VERSION}`);
  }
  if (snapshot.source !== "physics-spec") {
    throw physicsSpecDiagnosticError(`${path}.source`, "must be 'physics-spec'");
  }
}

function validatePhysicsReplayInputStream(inputStream: PhysicsReplayInputStream, path: string): void {
  if (inputStream.format !== PHYSICS_REPLAY_INPUT_STREAM_FORMAT) {
    throw physicsSpecDiagnosticError(`${path}.format`, `must be '${PHYSICS_REPLAY_INPUT_STREAM_FORMAT}'`);
  }
  if (inputStream.version !== PHYSICS_REPLAY_INPUT_STREAM_VERSION) {
    throw physicsSpecDiagnosticError(`${path}.version`, `must be ${PHYSICS_REPLAY_INPUT_STREAM_VERSION}`);
  }
  nonNegativeInteger(inputStream.frameCount, `${path}.frameCount`);
  if (inputStream.fixedStepSeconds !== undefined) {
    finitePositiveNumber(inputStream.fixedStepSeconds, `${path}.fixedStepSeconds`);
  }
  if (inputStream.seed !== undefined) {
    nonNegativeInteger(inputStream.seed, `${path}.seed`);
  }
  if (inputStream.snapshotIntervalFrames !== undefined) {
    positiveInteger(inputStream.snapshotIntervalFrames, `${path}.snapshotIntervalFrames`);
  }
  (inputStream.events ?? []).forEach((event, index) => {
    const eventPath = `${path}.events.${index}`;
    nonNegativeInteger(event.frame, `${eventPath}.frame`);
    if (event.frame >= inputStream.frameCount) {
      throw physicsSpecDiagnosticError(`${eventPath}.frame`, "must be less than frameCount");
    }
    if (event.body.trim().length === 0) {
      throw physicsSpecDiagnosticError(`${eventPath}.body`, "must reference a body id");
    }
    validatePhysicsReplayEventPayload(event, eventPath);
  });
}

function validatePhysicsReplayEventPayload(event: PhysicsReplayInputEvent, path: string): void {
  switch (event.type) {
    case "setPosition":
      finiteNumber(event.x, `${path}.x`);
      finiteNumber(event.y, `${path}.y`);
      break;
    case "setVelocity":
      finiteNumber(event.velocityX, `${path}.velocityX`);
      finiteNumber(event.velocityY, `${path}.velocityY`);
      break;
    case "setEnabled":
      break;
    case "applyForce":
      finiteNumber(event.forceX, `${path}.forceX`);
      finiteNumber(event.forceY, `${path}.forceY`);
      break;
    case "applyImpulse":
      finiteNumber(event.impulseX, `${path}.impulseX`);
      finiteNumber(event.impulseY, `${path}.impulseY`);
      break;
    default:
      throw physicsSpecDiagnosticError(`${path}.type`, "must be a supported replay event type");
  }
}

function replayEventsByFrame(
  inputStream: PhysicsReplayInputStream,
  path: string,
): Map<number, PhysicsReplayInputEvent[]> {
  const eventsByFrame = new Map<number, PhysicsReplayInputEvent[]>();
  (inputStream.events ?? []).forEach((event, index) => {
    const eventPath = `${path}.events.${index}`;
    const bodyEvents = eventsByFrame.get(event.frame) ?? [];
    bodyEvents.push(event);
    eventsByFrame.set(event.frame, bodyEvents);
    validatePhysicsReplayEventPayload(event, eventPath);
  });
  return eventsByFrame;
}

function applyPhysicsReplayInputEvent(
  engine: FerrumEngine,
  world: PhysicsWorldApplyResult,
  event: PhysicsReplayInputEvent,
  path: string,
): void {
  const handle = world.bodies[event.body];
  if (!handle) {
    throw physicsSpecDiagnosticError(`${path}.events.${event.frame}.body`, `references unknown body '${event.body}'`);
  }
  switch (event.type) {
    case "setPosition":
      ensureRuntimeAccepted(engine.setPhysicsBodyPosition(handle, event.x, event.y), `${path}.events.${event.frame}`);
      break;
    case "setVelocity":
      ensureRuntimeAccepted(
        engine.setPhysicsBodyVelocity(handle, event.velocityX, event.velocityY),
        `${path}.events.${event.frame}`,
      );
      break;
    case "setEnabled":
      ensureRuntimeAccepted(engine.setPhysicsBodyEnabled(handle, event.enabled), `${path}.events.${event.frame}`);
      break;
    case "applyForce":
      ensureRuntimeAccepted(
        engine.applyPhysicsBodyForce(handle, event.forceX, event.forceY),
        `${path}.events.${event.frame}`,
      );
      break;
    case "applyImpulse":
      ensureRuntimeAccepted(
        engine.applyPhysicsBodyImpulse(handle, event.impulseX, event.impulseY),
        `${path}.events.${event.frame}`,
      );
      break;
  }
}

function appendReplaySnapshot(
  engine: FerrumEngine,
  world: PhysicsWorldApplyResult,
  frame: number,
  snapshots: PhysicsReplayFrameSnapshot[],
): void {
  const snapshot = capturePhysicsWorldSnapshot(engine, world, { frame });
  snapshots.push({
    frame,
    snapshot,
    replayHash: snapshot.replayHash,
  });
}

function hashPhysicsReplayRun(
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

function ensureRuntimeAccepted(accepted: boolean, path: string): void {
  if (!accepted) {
    throw physicsSpecDiagnosticError(path, "runtime rejected snapshot state");
  }
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

function nonNegativeInteger(value: number, label: string): number {
  if (Number.isInteger(value) && value >= 0) {
    return value;
  }
  throw physicsSpecDiagnosticError(label, "must be a non-negative integer");
}

function positiveInteger(value: number, label: string): number {
  if (Number.isInteger(value) && value > 0) {
    return value;
  }
  throw physicsSpecDiagnosticError(label, "must be a positive integer");
}

function finiteNumber(value: number, label: string): number {
  if (Number.isFinite(value)) {
    return value;
  }
  throw physicsSpecDiagnosticError(label, "must be a finite number");
}

function finitePositiveNumber(value: number, label: string): number {
  if (Number.isFinite(value) && value > 0) {
    return value;
  }
  throw physicsSpecDiagnosticError(label, "must be a finite positive number");
}
