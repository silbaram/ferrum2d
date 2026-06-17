import type { PhysicsEntityHandle } from "./physicsBodies.js";

export type PhysicsJointType =
  | "distance"
  | "rope"
  | "spring"
  | "revolute"
  | "prismatic"
  | "weld"
  | "gear"
  | "pulley";

export interface PhysicsJointHandle {
  jointType: PhysicsJointType;
  jointIndex: number;
  jointGeneration: number;
}

export interface PhysicsJointBaseOptions {
  entityA: PhysicsEntityHandle;
  entityB: PhysicsEntityHandle;
  stiffness?: number;
  damping?: number;
  enabled?: boolean;
}

export type PhysicsJointSpawnOptions =
  | (PhysicsJointBaseOptions & {
      type: "distance";
      localAnchorAX?: number;
      localAnchorAY?: number;
      localAnchorBX?: number;
      localAnchorBY?: number;
      restLength: number;
      breakDistance?: number;
    })
  | (PhysicsJointBaseOptions & {
      type: "rope";
      localAnchorAX?: number;
      localAnchorAY?: number;
      localAnchorBX?: number;
      localAnchorBY?: number;
      maxLength: number;
      breakDistance?: number;
    })
  | (PhysicsJointBaseOptions & {
      type: "spring";
      localAnchorAX?: number;
      localAnchorAY?: number;
      localAnchorBX?: number;
      localAnchorBY?: number;
      restLength: number;
      breakDistance?: number;
    })
  | (PhysicsJointBaseOptions & {
      type: "pulley";
      groundAnchorAX: number;
      groundAnchorAY: number;
      groundAnchorBX: number;
      groundAnchorBY: number;
      localAnchorAX?: number;
      localAnchorAY?: number;
      localAnchorBX?: number;
      localAnchorBY?: number;
      restLength: number;
      ratio?: number;
      breakDistance?: number;
    })
  | (PhysicsJointBaseOptions & {
      type: "revolute";
      localAnchorAX?: number;
      localAnchorAY?: number;
      localAnchorBX?: number;
      localAnchorBY?: number;
      breakDistance?: number;
      limitEnabled?: boolean;
      lowerAngle?: number;
      upperAngle?: number;
      motorEnabled?: boolean;
      motorSpeed?: number;
      maxMotorTorque?: number;
    })
  | (PhysicsJointBaseOptions & {
      type: "prismatic";
      localAnchorAX?: number;
      localAnchorAY?: number;
      localAnchorBX?: number;
      localAnchorBY?: number;
      localAxisAX?: number;
      localAxisAY?: number;
      referenceAngle?: number;
      angularStiffness?: number;
      angularDamping?: number;
      breakDistance?: number;
      limitEnabled?: boolean;
      lowerTranslation?: number;
      upperTranslation?: number;
      motorEnabled?: boolean;
      motorSpeed?: number;
      maxMotorForce?: number;
    })
  | (PhysicsJointBaseOptions & {
      type: "weld";
      localAnchorAX?: number;
      localAnchorAY?: number;
      localAnchorBX?: number;
      localAnchorBY?: number;
      referenceAngle?: number;
      angularStiffness?: number;
      angularDamping?: number;
      breakDistance?: number;
      breakAngle?: number;
    })
  | (PhysicsJointBaseOptions & {
      type: "gear";
      ratio?: number;
      referenceAngle?: number;
      breakAngle?: number;
    });

export interface PhysicsJointSnapshot extends PhysicsJointHandle {
  entityA: PhysicsEntityHandle;
  entityB: PhysicsEntityHandle;
  enabled: boolean;
  restLength: number;
  maxLength: number;
  ratio: number;
  referenceAngle: number;
  breakDistance: number;
  breakAngle: number;
  stiffness: number;
  damping: number;
  angularStiffness: number;
  angularDamping: number;
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
  limitEnabled: boolean;
  lowerAngle: number;
  upperAngle: number;
  lowerTranslation: number;
  upperTranslation: number;
  motorEnabled: boolean;
  motorSpeed: number;
  maxMotorForce: number;
  maxMotorTorque: number;
}
