import type {
  PhysicsEntityHandle,
  PhysicsJointHandle,
  PhysicsRigidBodyCollider,
  PhysicsRigidBodyMaterial,
  PhysicsRigidBodyStepOptions,
  PhysicsRigidBodyType,
} from "./engineTypes.js";
import type { PhysicsSpecVector2, ResolvedPhysicsSpec } from "./physicsSpec.js";

export type PhysicsMaterialPresetName = "default" | "ice" | "rubber" | "wood" | "metal" | "platform";
export type PhysicsMaterialAuthoringInput = PhysicsMaterialPresetName | PhysicsRigidBodyMaterial;
export type PhysicsJointEndpoint = PhysicsEntityHandle | "world";

export interface PhysicsLayerPatternEntry {
  mask?: readonly string[];
}

export type PhysicsLayerPattern = Record<string, readonly string[] | PhysicsLayerPatternEntry>;

export interface PhysicsAuthoringLayer {
  name: string;
  categoryBits: number;
  mask: readonly string[];
  maskBits: number;
}

export interface PhysicsLayerMapOptions {
  path?: string;
}

export interface PhysicsWorldApplyOptions {
  path?: string;
  replace?: PhysicsWorldApplyResult;
  unsafeUnitScaleThreshold?: number;
  onWarning?: (warning: PhysicsWorldApplyWarning) => void;
}

export interface PhysicsWorldApplyWarning {
  path: string;
  detail: string;
  message: string;
}

export interface PhysicsWorldApplyResult {
  spec: ResolvedPhysicsSpec;
  bodies: Record<string, PhysicsEntityHandle>;
  joints: Record<string, PhysicsJointHandle>;
  worldAnchors: readonly PhysicsEntityHandle[];
  bodyCount: number;
  jointCount: number;
  warningCount: number;
  warnings: readonly PhysicsWorldApplyWarning[];
  stepSeconds: number;
  stepOptions: PhysicsRigidBodyStepOptions;
  clear(): void;
}

export interface PhysicsAuthoringJointHandle extends PhysicsJointHandle {
  readonly worldAnchors: readonly PhysicsEntityHandle[];
  clear(): void;
}

export type PhysicsColliderAuthoringOptions =
  | {
      type: "aabb" | "box";
      size?: PhysicsSpecVector2;
      halfSize?: PhysicsSpecVector2;
      offset?: PhysicsSpecVector2;
    }
  | {
      type: "circle";
      radius: number;
      offset?: PhysicsSpecVector2;
    }
  | {
      type: "capsule";
      start: PhysicsSpecVector2;
      end: PhysicsSpecVector2;
      radius: number;
      offset?: PhysicsSpecVector2;
    }
  | {
      type: "orientedBox";
      size?: PhysicsSpecVector2;
      halfSize?: PhysicsSpecVector2;
      rotationRadians?: number;
      offset?: PhysicsSpecVector2;
    }
  | {
      type: "convexPolygon";
      vertices: readonly PhysicsSpecVector2[];
      rotationRadians?: number;
      offset?: PhysicsSpecVector2;
    }
  | {
      type: "edge";
      start: PhysicsSpecVector2;
      end: PhysicsSpecVector2;
      offset?: PhysicsSpecVector2;
    }
  | {
      type: "chain";
      vertices: readonly PhysicsSpecVector2[];
      loop?: boolean;
      offset?: PhysicsSpecVector2;
    };

export interface PhysicsRigidBodyAuthoringOptions {
  type?: PhysicsRigidBodyType;
  position?: PhysicsSpecVector2;
  rotationRadians?: number;
  velocity?: PhysicsSpecVector2;
  angularVelocityRadiansPerSecond?: number;
  collider: PhysicsColliderAuthoringOptions;
  material?: PhysicsMaterialAuthoringInput;
  colliderMaterial?: PhysicsMaterialAuthoringInput;
  layer?: string;
  categoryBits?: number;
  maskBits?: number;
  mass?: number;
  inertia?: number;
  density?: number;
  gravityScale?: number;
  linearDamping?: number;
  angularDamping?: number;
  enabled?: boolean;
  colliderEnabled?: boolean;
  trigger?: boolean;
  canSleep?: boolean;
}

export interface RuntimeResolvedCollider {
  collider: PhysicsRigidBodyCollider;
  path: string;
}

interface PhysicsJointAuthoringBase {
  bodyA: PhysicsJointEndpoint;
  bodyB: PhysicsJointEndpoint;
  anchor?: PhysicsSpecVector2;
  localAnchorA?: PhysicsSpecVector2;
  localAnchorB?: PhysicsSpecVector2;
  stiffness?: number;
  damping?: number;
  enabled?: boolean;
}

export type PhysicsJointAuthoringOptions =
  | (PhysicsJointAuthoringBase & {
      type: "distance";
      restLength: number;
      breakDistance?: number;
    })
  | (PhysicsJointAuthoringBase & {
      type: "rope";
      maxLength: number;
      breakDistance?: number;
    })
  | (PhysicsJointAuthoringBase & {
      type: "spring";
      restLength: number;
      breakDistance?: number;
    })
  | (PhysicsJointAuthoringBase & {
      type: "pulley";
      groundAnchorA: PhysicsSpecVector2;
      groundAnchorB: PhysicsSpecVector2;
      restLength: number;
      ratio?: number;
      slack?: boolean;
      breakDistance?: number;
    })
  | (PhysicsJointAuthoringBase & {
      type: "revolute";
      breakDistance?: number;
      limit?: { enabled?: boolean; lower?: number; upper?: number; continuous?: boolean };
      motor?: { enabled?: boolean; speed?: number; maxTorque?: number };
    })
  | (PhysicsJointAuthoringBase & {
      type: "prismatic";
      localAxisA?: PhysicsSpecVector2;
      referenceAngle?: number;
      angularStiffness?: number;
      angularDamping?: number;
      breakDistance?: number;
      limit?: { enabled?: boolean; lower?: number; upper?: number };
      motor?: { enabled?: boolean; speed?: number; maxForce?: number };
    })
  | (PhysicsJointAuthoringBase & {
      type: "weld";
      referenceAngle?: number;
      angularStiffness?: number;
      angularDamping?: number;
      breakDistance?: number;
      breakAngle?: number;
    })
  | (PhysicsJointAuthoringBase & {
      type: "gear";
      ratio?: number;
      referenceAngle?: number;
      breakAngle?: number;
    });

export interface PhysicsVehicleWheelAuthoringOptions {
  offset: PhysicsSpecVector2;
  radius?: number;
  mass?: number;
  density?: number;
  material?: PhysicsMaterialAuthoringInput;
  layer?: string;
  categoryBits?: number;
  maskBits?: number;
  suspensionAxis?: PhysicsSpecVector2;
  suspensionTravel?: number;
  restLength?: number;
  stiffness?: number;
  damping?: number;
  guideStiffness?: number;
  guideDamping?: number;
  angularVelocityRadiansPerSecond?: number;
  enabled?: boolean;
}

export interface PhysicsVehicleRigAuthoringOptions {
  position?: PhysicsSpecVector2;
  chassisSize?: PhysicsSpecVector2;
  chassisMass?: number;
  chassisDensity?: number;
  chassisMaterial?: PhysicsMaterialAuthoringInput;
  chassisLinearDamping?: number;
  chassisAngularDamping?: number;
  wheelRadius?: number;
  wheelMass?: number;
  wheelDensity?: number;
  wheelMaterial?: PhysicsMaterialAuthoringInput;
  suspensionAxis?: PhysicsSpecVector2;
  suspensionTravel?: number;
  suspensionStiffness?: number;
  suspensionDamping?: number;
  guideStiffness?: number;
  guideDamping?: number;
  layer?: string;
  categoryBits?: number;
  maskBits?: number;
  wheels: readonly PhysicsVehicleWheelAuthoringOptions[];
}

export interface PhysicsVehicleRigResult {
  chassis: PhysicsEntityHandle;
  wheels: readonly PhysicsEntityHandle[];
  guideJoints: readonly PhysicsJointHandle[];
  suspensionJoints: readonly PhysicsJointHandle[];
  bodyCount: number;
  jointCount: number;
  clear(): void;
}

export interface PhysicsAuthoringContext {
  path?: string;
}
