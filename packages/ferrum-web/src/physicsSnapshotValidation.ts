import { physicsSpecDiagnosticError } from "./diagnostics.js";
import type {
  PhysicsBodyColliderSnapshot,
  PhysicsEntityHandle,
  PhysicsEntitySnapshot,
  PhysicsJointHandle,
  PhysicsJointSnapshot,
  PhysicsMaterialSnapshot,
  PhysicsRigidBodyStepOptions,
} from "./engineTypes.js";
import {
  hashPhysicsWorldSnapshot,
} from "./physicsSnapshotHash.js";
import {
  PHYSICS_REPLAY_INPUT_STREAM_FORMAT,
  PHYSICS_REPLAY_INPUT_STREAM_VERSION,
  PHYSICS_WORLD_SNAPSHOT_FORMAT,
  PHYSICS_WORLD_SNAPSHOT_VERSION,
  type PhysicsReplayInputEvent,
  type PhysicsReplayInputStream,
  type PhysicsWorldSnapshot,
} from "./physicsSnapshotTypes.js";

const BODY_TYPES = new Set(["static", "kinematic", "dynamic"]);
const COLLIDER_TYPES = new Set([
  "none",
  "aabb",
  "circle",
  "capsule",
  "orientedBox",
  "convexPolygon",
  "edge",
  "chain",
]);
const JOINT_TYPES = new Set([
  "distance",
  "rope",
  "spring",
  "revolute",
  "prismatic",
  "weld",
  "gear",
  "pulley",
]);
const RESOLVED_COLLIDER_SHAPES = new Set([
  "aabb",
  "box",
  "circle",
  "capsule",
  "orientedBox",
  "convexPolygon",
  "edge",
  "chain",
]);

const STEP_OPTION_NUMBER_FIELDS: readonly (keyof PhysicsRigidBodyStepOptions)[] = [
  "gravityX",
  "gravityY",
  "velocityIterations",
  "positionIterations",
  "positionCorrectionPercent",
  "positionCorrectionSlop",
  "restitutionVelocityThreshold",
  "contactBaumgarteBiasFactor",
  "maxContactBaumgarteBiasVelocity",
];

const MATERIAL_NUMBER_FIELDS: readonly (keyof PhysicsMaterialSnapshot)[] = [
  "restitution",
  "friction",
  "surfaceVelocityX",
  "surfaceVelocityY",
  "density",
  "contactBaumgarteBiasScale",
  "maxContactBaumgarteBiasVelocityScale",
  "contactPositionCorrectionScale",
  "contactPositionCorrectionSlopScale",
];

const BODY_STATE_NUMBER_FIELDS: readonly (keyof PhysicsEntitySnapshot)[] = [
  "x",
  "y",
  "velocityX",
  "velocityY",
  "rotationRadians",
  "angularVelocityRadiansPerSecond",
  "colliderOffsetX",
  "colliderOffsetY",
  "mass",
  "inverseMass",
  "inertia",
  "inverseInertia",
  "gravityScale",
  "linearDamping",
  "angularDamping",
  "restitution",
  "friction",
  "surfaceVelocityX",
  "surfaceVelocityY",
  "density",
  "contactBaumgarteBiasScale",
  "maxContactBaumgarteBiasVelocityScale",
  "contactPositionCorrectionScale",
  "contactPositionCorrectionSlopScale",
];

const BODY_STATE_BOOLEAN_FIELDS: readonly (keyof PhysicsEntitySnapshot)[] = [
  "bodyEnabled",
  "isSleeping",
  "colliderEnabled",
  "colliderIsTrigger",
  "colliderMaterialOverride",
];

const COLLIDER_STATE_NUMBER_FIELDS: readonly (keyof PhysicsBodyColliderSnapshot)[] = [
  "colliderOffsetX",
  "colliderOffsetY",
];

const COLLIDER_STATE_BOOLEAN_FIELDS: readonly (keyof PhysicsBodyColliderSnapshot)[] = [
  "colliderEnabled",
  "colliderIsTrigger",
  "colliderMaterialOverride",
];

const JOINT_STATE_NUMBER_FIELDS: readonly (keyof PhysicsJointSnapshot)[] = [
  "restLength",
  "maxLength",
  "ratio",
  "referenceAngle",
  "breakDistance",
  "breakAngle",
  "stiffness",
  "damping",
  "angularStiffness",
  "angularDamping",
  "localAnchorAX",
  "localAnchorAY",
  "localAnchorBX",
  "localAnchorBY",
  "localAxisAX",
  "localAxisAY",
  "groundAnchorAX",
  "groundAnchorAY",
  "groundAnchorBX",
  "groundAnchorBY",
  "lowerAngle",
  "upperAngle",
  "lowerTranslation",
  "upperTranslation",
  "motorSpeed",
  "maxMotorForce",
  "maxMotorTorque",
];

const JOINT_STATE_BOOLEAN_FIELDS: readonly (keyof PhysicsJointSnapshot)[] = [
  "enabled",
  "limitEnabled",
  "motorEnabled",
];

export function validatePhysicsWorldSnapshot(
  snapshot: unknown,
  path: string,
): asserts snapshot is PhysicsWorldSnapshot {
  const snapshotRecord = recordValue(snapshot, path);
  if (snapshotRecord.format !== PHYSICS_WORLD_SNAPSHOT_FORMAT) {
    throw physicsSpecDiagnosticError(`${path}.format`, `must be '${PHYSICS_WORLD_SNAPSHOT_FORMAT}'`);
  }
  if (snapshotRecord.version !== PHYSICS_WORLD_SNAPSHOT_VERSION) {
    throw physicsSpecDiagnosticError(`${path}.version`, `must be ${PHYSICS_WORLD_SNAPSHOT_VERSION}`);
  }
  if (snapshotRecord.source !== "physics-spec") {
    throw physicsSpecDiagnosticError(`${path}.source`, "must be 'physics-spec'");
  }
  nonNegativeInteger(snapshotRecord.frame, `${path}.frame`);
  finitePositiveNumber(snapshotRecord.stepSeconds, `${path}.stepSeconds`);
  const spec = validateResolvedPhysicsSpecShape(snapshotRecord.spec, `${path}.spec`);
  validateStepOptions(snapshotRecord.stepOptions, `${path}.stepOptions`);
  const bodies = recordValue(snapshotRecord.bodies, `${path}.bodies`);
  const joints = recordValue(snapshotRecord.joints, `${path}.joints`);
  const specBodies = recordValue(spec.bodies, `${path}.spec.bodies`);
  const specJoints = recordValue(spec.joints, `${path}.spec.joints`);
  const bodyCount = nonNegativeInteger(snapshotRecord.bodyCount, `${path}.bodyCount`);
  const jointCount = nonNegativeInteger(snapshotRecord.jointCount, `${path}.jointCount`);
  const bodyEntries = Object.entries(bodies);
  const jointEntries = Object.entries(joints);
  assertMatchingRecordKeys(bodies, specBodies, `${path}.bodies`, `${path}.spec.bodies`);
  assertMatchingRecordKeys(joints, specJoints, `${path}.joints`, `${path}.spec.joints`);
  if (bodyCount !== bodyEntries.length) {
    throw physicsSpecDiagnosticError(`${path}.bodyCount`, "must match bodies entry count");
  }
  if (jointCount !== jointEntries.length) {
    throw physicsSpecDiagnosticError(`${path}.jointCount`, "must match joints entry count");
  }
  for (const [bodyId, body] of bodyEntries) {
    if (specBodies[bodyId] === undefined) {
      throw physicsSpecDiagnosticError(`${path}.bodies.${bodyId}`, "must exist in snapshot spec bodies");
    }
    validateWorldSnapshotBody(body, bodyId, `${path}.bodies.${bodyId}`, specBodies[bodyId]);
  }
  for (const [jointId, joint] of jointEntries) {
    if (specJoints[jointId] === undefined) {
      throw physicsSpecDiagnosticError(`${path}.joints.${jointId}`, "must exist in snapshot spec joints");
    }
    validateWorldSnapshotJoint(joint, jointId, `${path}.joints.${jointId}`);
  }
  arrayValue(snapshotRecord.worldAnchors, `${path}.worldAnchors`).forEach((handle, index) => {
    validateEntityHandle(handle, `${path}.worldAnchors.${index}`);
  });
  stringValue(snapshotRecord.replayHash, `${path}.replayHash`);
  const expectedHash = hashPhysicsWorldSnapshot(snapshot as PhysicsWorldSnapshot);
  if (snapshotRecord.replayHash !== expectedHash) {
    throw physicsSpecDiagnosticError(`${path}.replayHash`, "must match the canonical snapshot hash");
  }
}

export function validatePhysicsReplayInputStream(
  inputStream: unknown,
  path: string,
): asserts inputStream is PhysicsReplayInputStream {
  const stream = recordValue(inputStream, path);
  if (stream.format !== PHYSICS_REPLAY_INPUT_STREAM_FORMAT) {
    throw physicsSpecDiagnosticError(`${path}.format`, `must be '${PHYSICS_REPLAY_INPUT_STREAM_FORMAT}'`);
  }
  if (stream.version !== PHYSICS_REPLAY_INPUT_STREAM_VERSION) {
    throw physicsSpecDiagnosticError(`${path}.version`, `must be ${PHYSICS_REPLAY_INPUT_STREAM_VERSION}`);
  }
  const frameCount = nonNegativeInteger(stream.frameCount, `${path}.frameCount`);
  if (stream.fixedStepSeconds !== undefined) {
    finitePositiveNumber(stream.fixedStepSeconds, `${path}.fixedStepSeconds`);
  }
  if (stream.seed !== undefined) {
    nonNegativeInteger(stream.seed, `${path}.seed`);
  }
  if (stream.snapshotIntervalFrames !== undefined) {
    positiveInteger(stream.snapshotIntervalFrames, `${path}.snapshotIntervalFrames`);
  }
  if (stream.events === undefined) {
    return;
  }
  arrayValue(stream.events, `${path}.events`).forEach((event, index) => {
    const eventPath = `${path}.events.${index}`;
    const eventRecord = recordValue(event, eventPath);
    const frame = nonNegativeInteger(eventRecord.frame, `${eventPath}.frame`);
    if (frame >= frameCount) {
      throw physicsSpecDiagnosticError(`${eventPath}.frame`, "must be less than frameCount");
    }
    const body = stringValue(eventRecord.body, `${eventPath}.body`);
    if (body.trim().length === 0) {
      throw physicsSpecDiagnosticError(`${eventPath}.body`, "must reference a body id");
    }
    validatePhysicsReplayEventPayload(event as PhysicsReplayInputEvent, eventPath);
  });
}

export function validatePhysicsReplayEventPayload(event: PhysicsReplayInputEvent, path: string): void {
  const eventRecord = recordValue(event, path);
  switch (eventRecord.type) {
    case "setPosition":
      finiteNumber(eventRecord.x, `${path}.x`);
      finiteNumber(eventRecord.y, `${path}.y`);
      break;
    case "setVelocity":
      finiteNumber(eventRecord.velocityX, `${path}.velocityX`);
      finiteNumber(eventRecord.velocityY, `${path}.velocityY`);
      break;
    case "setEnabled":
      booleanValue(eventRecord.enabled, `${path}.enabled`);
      break;
    case "applyForce":
      finiteNumber(eventRecord.forceX, `${path}.forceX`);
      finiteNumber(eventRecord.forceY, `${path}.forceY`);
      break;
    case "applyImpulse":
      finiteNumber(eventRecord.impulseX, `${path}.impulseX`);
      finiteNumber(eventRecord.impulseY, `${path}.impulseY`);
      break;
    default:
      throw physicsSpecDiagnosticError(`${path}.type`, "must be a supported replay event type");
  }
}

export function ensureRuntimeAccepted(accepted: boolean, path: string): void {
  if (!accepted) {
    throw physicsSpecDiagnosticError(path, "runtime rejected snapshot state");
  }
}

export function nonNegativeInteger(value: unknown, label: string): number {
  if (Number.isInteger(value) && (value as number) >= 0) {
    return value as number;
  }
  throw physicsSpecDiagnosticError(label, "must be a non-negative integer");
}

export function positiveInteger(value: unknown, label: string): number {
  if (Number.isInteger(value) && (value as number) > 0) {
    return value as number;
  }
  throw physicsSpecDiagnosticError(label, "must be a positive integer");
}

export function finiteNumber(value: unknown, label: string): number {
  if (Number.isFinite(value)) {
    return value as number;
  }
  throw physicsSpecDiagnosticError(label, "must be a finite number");
}

export function finitePositiveNumber(value: unknown, label: string): number {
  if (Number.isFinite(value) && (value as number) > 0) {
    return value as number;
  }
  throw physicsSpecDiagnosticError(label, "must be a finite positive number");
}

function validateWorldSnapshotBody(
  value: unknown,
  expectedId: string,
  path: string,
  specBody: unknown,
): void {
  const body = recordValue(value, path);
  const id = stringValue(body.id, `${path}.id`);
  if (id !== expectedId) {
    throw physicsSpecDiagnosticError(`${path}.id`, "must match the bodies record key");
  }
  const handle = validateEntityHandle(body.handle, `${path}.handle`);
  const state = validateBodyState(body.state, `${path}.state`);
  if (state.entityId !== handle.entityId || state.entityGeneration !== handle.entityGeneration) {
    throw physicsSpecDiagnosticError(`${path}.state`, "must reference the body handle");
  }
  const specColliderCount = arrayValue(
    recordValue(specBody, `${path}.spec`).colliders,
    `${path}.spec.colliders`,
  ).length;
  const colliders = arrayValue(body.colliders, `${path}.colliders`);
  if (colliders.length !== specColliderCount) {
    throw physicsSpecDiagnosticError(`${path}.colliders`, "must match snapshot spec collider count");
  }
  colliders.forEach((collider, index) => {
    validateWorldSnapshotCollider(collider, index, `${path}.colliders.${index}`);
  });
}

function validateWorldSnapshotCollider(value: unknown, expectedIndex: number, path: string): void {
  const collider = recordValue(value, path);
  const colliderIndex = nonNegativeInteger(collider.colliderIndex, `${path}.colliderIndex`);
  if (colliderIndex !== expectedIndex) {
    throw physicsSpecDiagnosticError(`${path}.colliderIndex`, "must match collider array order");
  }
  validateResolvedColliderSpecShape(collider.spec, `${path}.spec`);
  const state = validateColliderState(collider.state, `${path}.state`);
  if (state.colliderIndex !== colliderIndex) {
    throw physicsSpecDiagnosticError(`${path}.state.colliderIndex`, "must match colliderIndex");
  }
}

function validateWorldSnapshotJoint(value: unknown, expectedId: string, path: string): void {
  const joint = recordValue(value, path);
  const id = stringValue(joint.id, `${path}.id`);
  if (id !== expectedId) {
    throw physicsSpecDiagnosticError(`${path}.id`, "must match the joints record key");
  }
  const handle = validateJointHandle(joint.handle, `${path}.handle`);
  const state = validateJointState(joint.state, `${path}.state`);
  if (
    state.jointType !== handle.jointType
    || state.jointIndex !== handle.jointIndex
    || state.jointGeneration !== handle.jointGeneration
  ) {
    throw physicsSpecDiagnosticError(`${path}.state`, "must reference the joint handle");
  }
}

function validateBodyState(value: unknown, path: string): PhysicsEntitySnapshot {
  const state = recordValue(value, path);
  validateEntityHandle(state, path);
  enumValue(state.bodyType, BODY_TYPES, `${path}.bodyType`);
  enumValue(state.colliderType, COLLIDER_TYPES, `${path}.colliderType`);
  validateMaterialSnapshot(state.colliderMaterial, `${path}.colliderMaterial`);
  for (const field of BODY_STATE_NUMBER_FIELDS) {
    finiteNumber(state[field], `${path}.${String(field)}`);
  }
  for (const field of BODY_STATE_BOOLEAN_FIELDS) {
    booleanValue(state[field], `${path}.${String(field)}`);
  }
  return state as unknown as PhysicsEntitySnapshot;
}

function validateColliderState(value: unknown, path: string): PhysicsBodyColliderSnapshot {
  const state = recordValue(value, path);
  nonNegativeInteger(state.colliderIndex, `${path}.colliderIndex`);
  enumValue(state.colliderType, COLLIDER_TYPES, `${path}.colliderType`);
  validateMaterialSnapshot(state.colliderMaterial, `${path}.colliderMaterial`);
  nonNegativeInteger(state.categoryBits, `${path}.categoryBits`);
  nonNegativeInteger(state.maskBits, `${path}.maskBits`);
  for (const field of COLLIDER_STATE_NUMBER_FIELDS) {
    finiteNumber(state[field], `${path}.${String(field)}`);
  }
  for (const field of COLLIDER_STATE_BOOLEAN_FIELDS) {
    booleanValue(state[field], `${path}.${String(field)}`);
  }
  return state as unknown as PhysicsBodyColliderSnapshot;
}

function validateJointState(value: unknown, path: string): PhysicsJointSnapshot {
  const state = recordValue(value, path);
  validateJointHandle(state, path);
  validateEntityHandle(state.entityA, `${path}.entityA`);
  validateEntityHandle(state.entityB, `${path}.entityB`);
  for (const field of JOINT_STATE_NUMBER_FIELDS) {
    finiteNumber(state[field], `${path}.${String(field)}`);
  }
  for (const field of JOINT_STATE_BOOLEAN_FIELDS) {
    booleanValue(state[field], `${path}.${String(field)}`);
  }
  return state as unknown as PhysicsJointSnapshot;
}

function validateEntityHandle(value: unknown, path: string): PhysicsEntityHandle {
  const handle = recordValue(value, path);
  nonNegativeInteger(handle.entityId, `${path}.entityId`);
  nonNegativeInteger(handle.entityGeneration, `${path}.entityGeneration`);
  return handle as unknown as PhysicsEntityHandle;
}

function validateJointHandle(value: unknown, path: string): PhysicsJointHandle {
  const handle = recordValue(value, path);
  enumValue(handle.jointType, JOINT_TYPES, `${path}.jointType`);
  nonNegativeInteger(handle.jointIndex, `${path}.jointIndex`);
  nonNegativeInteger(handle.jointGeneration, `${path}.jointGeneration`);
  return handle as unknown as PhysicsJointHandle;
}

function validateMaterialSnapshot(value: unknown, path: string): void {
  const material = recordValue(value, path);
  for (const field of MATERIAL_NUMBER_FIELDS) {
    finiteNumber(material[field], `${path}.${String(field)}`);
  }
}

function validateStepOptions(value: unknown, path: string): void {
  const options = recordValue(value, path);
  for (const field of STEP_OPTION_NUMBER_FIELDS) {
    if (options[field] !== undefined) {
      finiteNumber(options[field], `${path}.${String(field)}`);
    }
  }
  if (options.contactSplitImpulse !== undefined) {
    booleanValue(options.contactSplitImpulse, `${path}.contactSplitImpulse`);
  }
}

function validateResolvedPhysicsSpecShape(value: unknown, path: string): Record<string, unknown> {
  const spec = recordValue(value, path);
  recordValue(spec.solver, `${path}.solver`);
  recordValue(spec.materials, `${path}.materials`);
  recordValue(spec.layers, `${path}.layers`);
  recordValue(spec.bodies, `${path}.bodies`);
  recordValue(spec.joints, `${path}.joints`);
  recordValue(spec.debug, `${path}.debug`);
  return spec;
}

function validateResolvedColliderSpecShape(value: unknown, path: string): void {
  const spec = recordValue(value, path);
  enumValue(spec.shape, RESOLVED_COLLIDER_SHAPES, `${path}.shape`);
}

function recordValue(value: unknown, path: string): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw physicsSpecDiagnosticError(path, "must be an object");
}

function arrayValue(value: unknown, path: string): readonly unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  throw physicsSpecDiagnosticError(path, "must be an array");
}

function stringValue(value: unknown, path: string): string {
  if (typeof value === "string") {
    return value;
  }
  throw physicsSpecDiagnosticError(path, "must be a string");
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  throw physicsSpecDiagnosticError(path, "must be a boolean");
}

function enumValue(value: unknown, allowed: ReadonlySet<string>, path: string): string {
  if (typeof value === "string" && allowed.has(value)) {
    return value;
  }
  throw physicsSpecDiagnosticError(path, "must be a supported value");
}

function assertMatchingRecordKeys(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
  actualPath: string,
  expectedPath: string,
): void {
  const actualKeys = new Set(Object.keys(actual));
  for (const key of Object.keys(expected)) {
    if (!actualKeys.delete(key)) {
      throw physicsSpecDiagnosticError(actualPath, `must include ${expectedPath}.${key}`);
    }
  }
  const unexpectedKey = actualKeys.values().next().value as string | undefined;
  if (unexpectedKey !== undefined) {
    throw physicsSpecDiagnosticError(`${actualPath}.${unexpectedKey}`, `must exist in ${expectedPath}`);
  }
}
