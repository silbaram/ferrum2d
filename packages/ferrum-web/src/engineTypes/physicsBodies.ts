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
export type PhysicsCollisionLayer = "player" | "enemy" | "bullet" | "wall";

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
  velocityX?: number;
  velocityY?: number;
  rotationRadians?: number;
  angularVelocityRadiansPerSecond?: number;
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
}
