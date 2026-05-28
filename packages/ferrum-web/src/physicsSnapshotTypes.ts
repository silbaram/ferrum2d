import type {
  PhysicsBodyColliderSnapshot,
  PhysicsEntityHandle,
  PhysicsEntitySnapshot,
  PhysicsJointHandle,
  PhysicsJointSnapshot,
  PhysicsRigidBodyStepOptions,
  PhysicsRigidBodyStepStats,
} from "./engineTypes.js";
import type {
  PhysicsWorldApplyOptions,
  PhysicsWorldApplyResult,
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
