import type { PhysicsConvexPolygonVertexBuffer } from "./physicsGeometry.js";

export type PhysicsRigidBodyType = "static" | "kinematic" | "dynamic";
export type PhysicsColliderType =
  | "none"
  | "aabb"
  | "circle"
  | "capsule"
  | "orientedBox"
  | "convexPolygon"
  | "edge"
  | "chain";
export type PhysicsCollisionLayer = "player" | "enemy" | "bullet" | "wall" | "pickup";

export interface PhysicsEntityHandle {
  entityId: number;
  entityGeneration: number;
}

export interface PhysicsRigidBodyMaterial {
  restitution?: number;
  friction?: number;
  surfaceVelocityX?: number;
  surfaceVelocityY?: number;
  density?: number;
  contactBaumgarteBiasScale?: number;
  maxContactBaumgarteBiasVelocityScale?: number;
  contactPositionCorrectionScale?: number;
  contactPositionCorrectionSlopScale?: number;
}

export interface PhysicsMaterialSnapshot {
  restitution: number;
  friction: number;
  surfaceVelocityX: number;
  surfaceVelocityY: number;
  density: number;
  contactBaumgarteBiasScale: number;
  maxContactBaumgarteBiasVelocityScale: number;
  contactPositionCorrectionScale: number;
  contactPositionCorrectionSlopScale: number;
}

export interface PhysicsRigidBodyMassProperties {
  mass: number;
  inertia: number;
}

export interface PhysicsRigidBodyTuning {
  gravityScale?: number;
  linearDamping?: number;
  angularDamping?: number;
}

export interface PhysicsBodyHeightSpan {
  floorId?: number;
  elevation: number;
  height: number;
}

export interface PhysicsHd2dKinematicMoveOptions {
  displacementX: number;
  displacementY: number;
  solidMaskBits?: number;
  maxIterations?: number;
  maxStepHeight?: number;
  maxDropHeight?: number;
  allowLedgeDrop?: boolean;
}

/** Per-body automatic planar movement settings. An update replaces all options. */
export interface PhysicsKinematicControllerOptions {
  /** Defaults to all layers (0xffffffff), intersected with each collider's mask. */
  solidMaskBits?: number;
  /** Integer in 1..8; defaults to 4 sweeps per fixed tick. */
  maxIterations?: number;
  /** Finite float32 in 0..65536; defaults to 0. */
  maxStepHeight?: number;
  /** Finite float32 in 0..65536; defaults to 0. */
  maxDropHeight?: number;
  /** Defaults to false. */
  allowLedgeDrop?: boolean;
}

export interface PhysicsHd2dKinematicMoveResult {
  body: PhysicsEntitySnapshot;
  elevationDelta: number;
  hitCount: number;
  steppedUp: boolean;
  steppedDown: boolean;
  changedFloor: boolean;
  passedUnderBridge: boolean;
  blockedByStep: boolean;
  blockedByDrop: boolean;
  blockedX: boolean;
  blockedY: boolean;
}

export type PhysicsRigidBodyCollider =
  | {
      type: "aabb";
      halfWidth: number;
      halfHeight: number;
      offsetX?: number;
      offsetY?: number;
    }
  | {
      type: "circle";
      radius: number;
      offsetX?: number;
      offsetY?: number;
    }
  | {
      type: "capsule";
      startX: number;
      startY: number;
      endX: number;
      endY: number;
      radius: number;
      offsetX?: number;
      offsetY?: number;
    }
  | {
      type: "edge";
      startX: number;
      startY: number;
      endX: number;
      endY: number;
      offsetX?: number;
      offsetY?: number;
    }
  | {
      type: "chain";
      vertices: PhysicsConvexPolygonVertexBuffer;
      loop?: boolean;
      offsetX?: number;
      offsetY?: number;
    }
  | {
      type: "orientedBox";
      halfWidth: number;
      halfHeight: number;
      rotationRadians?: number;
      offsetX?: number;
      offsetY?: number;
    }
  | {
      type: "convexPolygon";
      vertices: PhysicsConvexPolygonVertexBuffer;
      rotationRadians?: number;
      offsetX?: number;
      offsetY?: number;
    };

export interface PhysicsRigidBodySpawnOptions {
  x: number;
  y: number;
  bodyType?: PhysicsRigidBodyType;
  collider: PhysicsRigidBodyCollider;
  mass?: number;
  density?: number;
  layer?: PhysicsCollisionLayer;
  categoryBits?: number;
  maskBits?: number;
  isTrigger?: boolean;
  colliderEnabled?: boolean;
  bodyEnabled?: boolean;
  canSleep?: boolean;
  fixedRotation?: boolean;
  velocityX?: number;
  velocityY?: number;
  rotationRadians?: number;
  angularVelocityRadiansPerSecond?: number;
  heightSpan?: PhysicsBodyHeightSpan;
  gravityScale?: number;
  linearDamping?: number;
  angularDamping?: number;
  material?: PhysicsRigidBodyMaterial;
  colliderMaterial?: PhysicsRigidBodyMaterial;
}

export interface PhysicsBodyColliderOptions {
  collider: PhysicsRigidBodyCollider;
  layer?: PhysicsCollisionLayer;
  categoryBits?: number;
  maskBits?: number;
  isTrigger?: boolean;
  colliderEnabled?: boolean;
}

export interface PhysicsBodyColliderSnapshot {
  colliderIndex: number;
  colliderType: PhysicsColliderType;
  colliderEnabled: boolean;
  colliderIsTrigger: boolean;
  colliderOffsetX: number;
  colliderOffsetY: number;
  colliderMaterialOverride: boolean;
  colliderMaterial: PhysicsMaterialSnapshot;
  categoryBits: number;
  maskBits: number;
}

export interface PhysicsEntitySnapshot extends PhysicsEntityHandle {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  rotationRadians: number;
  angularVelocityRadiansPerSecond: number;
  bodyType: PhysicsRigidBodyType;
  bodyEnabled: boolean;
  isSleeping: boolean;
  fixedRotation?: boolean;
  colliderType: PhysicsColliderType;
  colliderEnabled: boolean;
  colliderIsTrigger: boolean;
  colliderOffsetX: number;
  colliderOffsetY: number;
  colliderMaterialOverride: boolean;
  colliderMaterial: PhysicsMaterialSnapshot;
  mass: number;
  inverseMass: number;
  inertia: number;
  inverseInertia: number;
  gravityScale: number;
  linearDamping: number;
  angularDamping: number;
  restitution: number;
  friction: number;
  surfaceVelocityX: number;
  surfaceVelocityY: number;
  density: number;
  contactBaumgarteBiasScale: number;
  maxContactBaumgarteBiasVelocityScale: number;
  contactPositionCorrectionScale: number;
  contactPositionCorrectionSlopScale: number;
  heightSpan?: PhysicsBodyHeightSpan | null;
}

/** Owned bulk data. Eight accumulator floats/body and six contact floats/contact. */
export interface PhysicsSolverStateBuffer {
  handles: Uint32Array;
  values: Float32Array;
  contactHandles: Uint32Array;
  contacts: Float32Array;
}
