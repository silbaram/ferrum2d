export type PhysicsMode = "none" | "arcade" | "rigid";
export type PhysicsSpecBodyType = "static" | "kinematic" | "dynamic";
export type PhysicsSpecColliderShape =
  | "aabb"
  | "box"
  | "circle"
  | "capsule"
  | "orientedBox"
  | "convexPolygon"
  | "edge"
  | "chain";
export type PhysicsSpecJointType =
  | "distance"
  | "rope"
  | "spring"
  | "pulley"
  | "revolute"
  | "prismatic"
  | "weld"
  | "gear";

export type PhysicsSpecVector2 = readonly [number, number];

export interface PhysicsSpec {
  mode?: PhysicsMode;
  gravity?: PhysicsSpecVector2;
  continuous?: boolean;
  solver?: PhysicsSolverSpec;
  materials?: Record<string, PhysicsMaterialSpec>;
  layers?: Record<string, PhysicsLayerSpec>;
  bodies?: Record<string, PhysicsBodySpec>;
  joints?: Record<string, PhysicsJointSpec>;
  debug?: boolean | PhysicsDebugSpec;
}

export interface PhysicsSolverSpec {
  fixedTimestep?: boolean;
  stepSeconds?: number;
  velocityIterations?: number;
  positionIterations?: number;
  sleep?: boolean;
}

export interface PhysicsMaterialSpec {
  friction?: number;
  restitution?: number;
  density?: number;
}

export interface PhysicsLayerSpec {
  mask?: string[];
}

export interface PhysicsBodySpec {
  type?: PhysicsSpecBodyType;
  position?: PhysicsSpecVector2;
  rotationRadians?: number;
  velocity?: PhysicsSpecVector2;
  angularVelocityRadiansPerSecond?: number;
  mass?: number;
  inertia?: number;
  material?: string;
  layer?: string;
  collider?: PhysicsColliderSpec;
  colliders?: PhysicsColliderSpec[];
  gravityScale?: number;
  linearDamping?: number;
  angularDamping?: number;
  enabled?: boolean;
  canSleep?: boolean;
}

export type PhysicsColliderSpec =
  | PhysicsBoxColliderSpec
  | PhysicsCircleColliderSpec
  | PhysicsCapsuleColliderSpec
  | PhysicsOrientedBoxColliderSpec
  | PhysicsConvexPolygonColliderSpec
  | PhysicsEdgeColliderSpec
  | PhysicsChainColliderSpec;

export interface PhysicsColliderSpecBase {
  shape: PhysicsSpecColliderShape;
  offset?: PhysicsSpecVector2;
  material?: string;
  layer?: string;
  trigger?: boolean;
  enabled?: boolean;
}

export interface PhysicsBoxColliderSpec extends PhysicsColliderSpecBase {
  shape: "aabb" | "box";
  size?: PhysicsSpecVector2;
  halfSize?: PhysicsSpecVector2;
}

export interface PhysicsCircleColliderSpec extends PhysicsColliderSpecBase {
  shape: "circle";
  radius: number;
}

export interface PhysicsCapsuleColliderSpec extends PhysicsColliderSpecBase {
  shape: "capsule";
  start: PhysicsSpecVector2;
  end: PhysicsSpecVector2;
  radius: number;
}

export interface PhysicsOrientedBoxColliderSpec extends PhysicsColliderSpecBase {
  shape: "orientedBox";
  size?: PhysicsSpecVector2;
  halfSize?: PhysicsSpecVector2;
  rotationRadians?: number;
}

export interface PhysicsConvexPolygonColliderSpec extends PhysicsColliderSpecBase {
  shape: "convexPolygon";
  vertices: PhysicsSpecVector2[];
  rotationRadians?: number;
}

export interface PhysicsEdgeColliderSpec extends PhysicsColliderSpecBase {
  shape: "edge";
  start: PhysicsSpecVector2;
  end: PhysicsSpecVector2;
}

export interface PhysicsChainColliderSpec extends PhysicsColliderSpecBase {
  shape: "chain";
  vertices: PhysicsSpecVector2[];
  loop?: boolean;
}

export interface PhysicsJointSpec {
  type: PhysicsSpecJointType;
  bodyA: string;
  bodyB: string;
  anchor?: PhysicsSpecVector2;
  localAnchorA?: PhysicsSpecVector2;
  localAnchorB?: PhysicsSpecVector2;
  groundAnchorA?: PhysicsSpecVector2;
  groundAnchorB?: PhysicsSpecVector2;
  localAxisA?: PhysicsSpecVector2;
  restLength?: number;
  maxLength?: number;
  stiffness?: number;
  damping?: number;
  enabled?: boolean;
  limit?: PhysicsJointLimitSpec;
  motor?: PhysicsJointMotorSpec;
  ratio?: number;
  referenceAngle?: number;
  breakDistance?: number;
  breakAngle?: number;
}

export interface PhysicsJointLimitSpec {
  enabled?: boolean;
  lower?: number;
  upper?: number;
}

export interface PhysicsJointMotorSpec {
  enabled?: boolean;
  speed?: number;
  maxForce?: number;
  maxTorque?: number;
}

export interface PhysicsDebugSpec {
  colliders?: boolean;
  contacts?: boolean;
  manifolds?: boolean;
  broadphase?: boolean;
  joints?: boolean;
  sleeping?: boolean;
  layers?: boolean;
  ccd?: boolean;
}

export interface ResolvedPhysicsSpec {
  mode: PhysicsMode;
  gravityX: number;
  gravityY: number;
  continuous: boolean;
  solver: ResolvedPhysicsSolverSpec;
  materials: Record<string, ResolvedPhysicsMaterialSpec>;
  layers: Record<string, ResolvedPhysicsLayerSpec>;
  bodies: Record<string, ResolvedPhysicsBodySpec>;
  joints: Record<string, ResolvedPhysicsJointSpec>;
  debug: ResolvedPhysicsDebugSpec;
}

export interface ResolvedPhysicsSolverSpec {
  fixedTimestep: boolean;
  stepSeconds: number;
  velocityIterations: number;
  positionIterations: number;
  sleep: boolean;
}

export interface ResolvedPhysicsMaterialSpec {
  friction: number;
  restitution: number;
  density: number;
}

export interface ResolvedPhysicsLayerSpec {
  name: string;
  categoryBits: number;
  mask: string[];
  maskBits: number;
}

export interface ResolvedPhysicsBodySpec {
  id: string;
  type: PhysicsSpecBodyType;
  positionX: number;
  positionY: number;
  rotationRadians: number;
  velocityX: number;
  velocityY: number;
  angularVelocityRadiansPerSecond: number;
  mass?: number;
  inertia?: number;
  material?: string;
  layer?: string;
  colliders: ResolvedPhysicsColliderSpec[];
  gravityScale: number;
  linearDamping: number;
  angularDamping: number;
  enabled: boolean;
  canSleep: boolean;
}

export type ResolvedPhysicsColliderSpec =
  | ResolvedPhysicsBoxColliderSpec
  | ResolvedPhysicsCircleColliderSpec
  | ResolvedPhysicsCapsuleColliderSpec
  | ResolvedPhysicsOrientedBoxColliderSpec
  | ResolvedPhysicsConvexPolygonColliderSpec
  | ResolvedPhysicsEdgeColliderSpec
  | ResolvedPhysicsChainColliderSpec;

export interface ResolvedPhysicsColliderBaseSpec {
  shape: PhysicsSpecColliderShape;
  offsetX: number;
  offsetY: number;
  material?: string;
  layer?: string;
  trigger: boolean;
  enabled: boolean;
}

export interface ResolvedPhysicsBoxColliderSpec extends ResolvedPhysicsColliderBaseSpec {
  shape: "aabb" | "box";
  halfWidth: number;
  halfHeight: number;
}

export interface ResolvedPhysicsCircleColliderSpec extends ResolvedPhysicsColliderBaseSpec {
  shape: "circle";
  radius: number;
}

export interface ResolvedPhysicsCapsuleColliderSpec extends ResolvedPhysicsColliderBaseSpec {
  shape: "capsule";
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  radius: number;
}

export interface ResolvedPhysicsOrientedBoxColliderSpec extends ResolvedPhysicsColliderBaseSpec {
  shape: "orientedBox";
  halfWidth: number;
  halfHeight: number;
  rotationRadians: number;
}

export interface ResolvedPhysicsConvexPolygonColliderSpec extends ResolvedPhysicsColliderBaseSpec {
  shape: "convexPolygon";
  vertices: ResolvedPhysicsVector2[];
  rotationRadians: number;
}

export interface ResolvedPhysicsEdgeColliderSpec extends ResolvedPhysicsColliderBaseSpec {
  shape: "edge";
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export interface ResolvedPhysicsChainColliderSpec extends ResolvedPhysicsColliderBaseSpec {
  shape: "chain";
  vertices: ResolvedPhysicsVector2[];
  loop: boolean;
}

export interface ResolvedPhysicsVector2 {
  x: number;
  y: number;
}

export interface ResolvedPhysicsJointSpec {
  id: string;
  type: PhysicsSpecJointType;
  bodyA: string;
  bodyB: string;
  anchorX: number;
  anchorY: number;
  localAnchorAX: number;
  localAnchorAY: number;
  localAnchorBX: number;
  localAnchorBY: number;
  localAxisAX: number;
  localAxisAY: number;
  groundAnchorAX: number;
  groundAnchorAY: number;
  groundAnchorBX: number;
  groundAnchorBY: number;
  restLength: number;
  maxLength: number;
  stiffness: number;
  damping: number;
  enabled: boolean;
  limitEnabled: boolean;
  lowerLimit: number;
  upperLimit: number;
  motorEnabled: boolean;
  motorSpeed: number;
  maxMotorForce: number;
  maxMotorTorque: number;
  ratio: number;
  referenceAngle: number;
  breakDistance: number;
  breakAngle: number;
}

export interface ResolvedPhysicsDebugSpec {
  enabled: boolean;
  colliders: boolean;
  contacts: boolean;
  manifolds: boolean;
  broadphase: boolean;
  joints: boolean;
  sleeping: boolean;
  layers: boolean;
  ccd: boolean;
}

export interface ResolvePhysicsSpecOptions {
  path?: string;
  defaultMode?: PhysicsMode;
  modeOverride?: PhysicsMode;
}
