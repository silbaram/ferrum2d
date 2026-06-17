import type { Engine } from "../pkg/ferrum_core";
import { finiteNumber, uint32Number } from "./particlePreset";
import {
  breakLimitNumber,
  nonNegativeNumber,
  positiveNumber,
  unitIntervalNumber,
} from "./physicsAuthoringNumbers.js";
import { physicsEntityHandle } from "./physicsHandles.js";
import type {
  FerrumPhysicsJointApi,
  PhysicsJointHandle,
  PhysicsJointSnapshot,
  PhysicsJointSpawnOptions,
  PhysicsJointType,
} from "./engineTypes.js";

const PHYSICS_JOINT_TYPE_CODES: Record<PhysicsJointType, number> = Object.freeze({
  distance: 0,
  rope: 1,
  spring: 2,
  revolute: 3,
  prismatic: 4,
  gear: 5,
  weld: 6,
  pulley: 7,
});
const PHYSICS_JOINT_TYPES: readonly PhysicsJointType[] = Object.freeze([
  "distance",
  "rope",
  "spring",
  "revolute",
  "prismatic",
  "gear",
  "weld",
  "pulley",
]);

export interface PhysicsJointApiContext {
  rustEngine: Engine;
  requireAlive(): void;
}

export function createPhysicsJointApi({
  rustEngine,
  requireAlive,
}: PhysicsJointApiContext): FerrumPhysicsJointApi {
  return {
    spawnPhysicsJoint(options) {
      requireAlive();
      const entityA = physicsEntityHandle(options.entityA);
      const entityB = physicsEntityHandle(options.entityB);
      const enabled = options.enabled ?? true;
      let spawned = false;

      switch (options.type) {
        case "distance":
          spawned = rustEngine.spawn_physics_distance_joint(
            entityA.entityId,
            entityA.entityGeneration,
            entityB.entityId,
            entityB.entityGeneration,
            finiteNumber(options.localAnchorAX ?? 0, "physics distance joint localAnchorAX"),
            finiteNumber(options.localAnchorAY ?? 0, "physics distance joint localAnchorAY"),
            finiteNumber(options.localAnchorBX ?? 0, "physics distance joint localAnchorBX"),
            finiteNumber(options.localAnchorBY ?? 0, "physics distance joint localAnchorBY"),
            nonNegativeNumber(options.restLength, "physics distance joint restLength"),
            unitIntervalNumber(options.stiffness ?? 1, "physics distance joint stiffness"),
            unitIntervalNumber(options.damping ?? 0, "physics distance joint damping"),
            breakLimitNumber(
              options.breakDistance ?? Number.POSITIVE_INFINITY,
              "physics distance joint breakDistance",
            ),
            enabled,
          );
          break;
        case "rope":
          spawned = rustEngine.spawn_physics_rope_joint(
            entityA.entityId,
            entityA.entityGeneration,
            entityB.entityId,
            entityB.entityGeneration,
            finiteNumber(options.localAnchorAX ?? 0, "physics rope joint localAnchorAX"),
            finiteNumber(options.localAnchorAY ?? 0, "physics rope joint localAnchorAY"),
            finiteNumber(options.localAnchorBX ?? 0, "physics rope joint localAnchorBX"),
            finiteNumber(options.localAnchorBY ?? 0, "physics rope joint localAnchorBY"),
            nonNegativeNumber(options.maxLength, "physics rope joint maxLength"),
            unitIntervalNumber(options.stiffness ?? 1, "physics rope joint stiffness"),
            unitIntervalNumber(options.damping ?? 0, "physics rope joint damping"),
            breakLimitNumber(
              options.breakDistance ?? Number.POSITIVE_INFINITY,
              "physics rope joint breakDistance",
            ),
            enabled,
          );
          break;
        case "spring":
          spawned = rustEngine.spawn_physics_spring_joint(
            entityA.entityId,
            entityA.entityGeneration,
            entityB.entityId,
            entityB.entityGeneration,
            finiteNumber(options.localAnchorAX ?? 0, "physics spring joint localAnchorAX"),
            finiteNumber(options.localAnchorAY ?? 0, "physics spring joint localAnchorAY"),
            finiteNumber(options.localAnchorBX ?? 0, "physics spring joint localAnchorBX"),
            finiteNumber(options.localAnchorBY ?? 0, "physics spring joint localAnchorBY"),
            nonNegativeNumber(options.restLength, "physics spring joint restLength"),
            unitIntervalNumber(options.stiffness ?? 1, "physics spring joint stiffness"),
            unitIntervalNumber(options.damping ?? 0, "physics spring joint damping"),
            breakLimitNumber(
              options.breakDistance ?? Number.POSITIVE_INFINITY,
              "physics spring joint breakDistance",
            ),
            enabled,
          );
          break;
        case "pulley":
          spawned = rustEngine.spawn_physics_pulley_joint(
            entityA.entityId,
            entityA.entityGeneration,
            entityB.entityId,
            entityB.entityGeneration,
            finiteNumber(options.groundAnchorAX, "physics pulley joint groundAnchorAX"),
            finiteNumber(options.groundAnchorAY, "physics pulley joint groundAnchorAY"),
            finiteNumber(options.groundAnchorBX, "physics pulley joint groundAnchorBX"),
            finiteNumber(options.groundAnchorBY, "physics pulley joint groundAnchorBY"),
            finiteNumber(options.localAnchorAX ?? 0, "physics pulley joint localAnchorAX"),
            finiteNumber(options.localAnchorAY ?? 0, "physics pulley joint localAnchorAY"),
            finiteNumber(options.localAnchorBX ?? 0, "physics pulley joint localAnchorBX"),
            finiteNumber(options.localAnchorBY ?? 0, "physics pulley joint localAnchorBY"),
            nonNegativeNumber(options.restLength, "physics pulley joint restLength"),
            positiveNumber(options.ratio ?? 1, "physics pulley joint ratio"),
            unitIntervalNumber(options.stiffness ?? 1, "physics pulley joint stiffness"),
            unitIntervalNumber(options.damping ?? 0, "physics pulley joint damping"),
            breakLimitNumber(
              options.breakDistance ?? Number.POSITIVE_INFINITY,
              "physics pulley joint breakDistance",
            ),
            enabled,
          );
          break;
        case "revolute":
          spawned = rustEngine.spawn_physics_revolute_joint(
            entityA.entityId,
            entityA.entityGeneration,
            entityB.entityId,
            entityB.entityGeneration,
            finiteNumber(options.localAnchorAX ?? 0, "physics revolute joint localAnchorAX"),
            finiteNumber(options.localAnchorAY ?? 0, "physics revolute joint localAnchorAY"),
            finiteNumber(options.localAnchorBX ?? 0, "physics revolute joint localAnchorBX"),
            finiteNumber(options.localAnchorBY ?? 0, "physics revolute joint localAnchorBY"),
            unitIntervalNumber(options.stiffness ?? 1, "physics revolute joint stiffness"),
            unitIntervalNumber(options.damping ?? 1, "physics revolute joint damping"),
            breakLimitNumber(
              options.breakDistance ?? Number.POSITIVE_INFINITY,
              "physics revolute joint breakDistance",
            ),
            options.limitEnabled === true,
            finiteNumber(options.lowerAngle ?? 0, "physics revolute joint lowerAngle"),
            finiteNumber(options.upperAngle ?? 0, "physics revolute joint upperAngle"),
            options.motorEnabled === true,
            finiteNumber(options.motorSpeed ?? 0, "physics revolute joint motorSpeed"),
            nonNegativeNumber(options.maxMotorTorque ?? 0, "physics revolute joint maxMotorTorque"),
            enabled,
          );
          break;
        case "prismatic":
          spawned = rustEngine.spawn_physics_prismatic_joint(
            entityA.entityId,
            entityA.entityGeneration,
            entityB.entityId,
            entityB.entityGeneration,
            finiteNumber(options.localAnchorAX ?? 0, "physics prismatic joint localAnchorAX"),
            finiteNumber(options.localAnchorAY ?? 0, "physics prismatic joint localAnchorAY"),
            finiteNumber(options.localAnchorBX ?? 0, "physics prismatic joint localAnchorBX"),
            finiteNumber(options.localAnchorBY ?? 0, "physics prismatic joint localAnchorBY"),
            finiteNumber(options.localAxisAX ?? 1, "physics prismatic joint localAxisAX"),
            finiteNumber(options.localAxisAY ?? 0, "physics prismatic joint localAxisAY"),
            finiteNumber(options.referenceAngle ?? 0, "physics prismatic joint referenceAngle"),
            unitIntervalNumber(options.stiffness ?? 1, "physics prismatic joint stiffness"),
            unitIntervalNumber(options.damping ?? 1, "physics prismatic joint damping"),
            unitIntervalNumber(
              options.angularStiffness ?? 1,
              "physics prismatic joint angularStiffness",
            ),
            unitIntervalNumber(
              options.angularDamping ?? 1,
              "physics prismatic joint angularDamping",
            ),
            breakLimitNumber(
              options.breakDistance ?? Number.POSITIVE_INFINITY,
              "physics prismatic joint breakDistance",
            ),
            options.limitEnabled === true,
            finiteNumber(
              options.lowerTranslation ?? 0,
              "physics prismatic joint lowerTranslation",
            ),
            finiteNumber(
              options.upperTranslation ?? 0,
              "physics prismatic joint upperTranslation",
            ),
            options.motorEnabled === true,
            finiteNumber(options.motorSpeed ?? 0, "physics prismatic joint motorSpeed"),
            nonNegativeNumber(options.maxMotorForce ?? 0, "physics prismatic joint maxMotorForce"),
            enabled,
          );
          break;
        case "weld":
          spawned = rustEngine.spawn_physics_weld_joint(
            entityA.entityId,
            entityA.entityGeneration,
            entityB.entityId,
            entityB.entityGeneration,
            finiteNumber(options.localAnchorAX ?? 0, "physics weld joint localAnchorAX"),
            finiteNumber(options.localAnchorAY ?? 0, "physics weld joint localAnchorAY"),
            finiteNumber(options.localAnchorBX ?? 0, "physics weld joint localAnchorBX"),
            finiteNumber(options.localAnchorBY ?? 0, "physics weld joint localAnchorBY"),
            finiteNumber(options.referenceAngle ?? 0, "physics weld joint referenceAngle"),
            unitIntervalNumber(options.stiffness ?? 1, "physics weld joint stiffness"),
            unitIntervalNumber(options.damping ?? 1, "physics weld joint damping"),
            unitIntervalNumber(
              options.angularStiffness ?? 1,
              "physics weld joint angularStiffness",
            ),
            unitIntervalNumber(options.angularDamping ?? 1, "physics weld joint angularDamping"),
            breakLimitNumber(
              options.breakDistance ?? Number.POSITIVE_INFINITY,
              "physics weld joint breakDistance",
            ),
            breakLimitNumber(
              options.breakAngle ?? Number.POSITIVE_INFINITY,
              "physics weld joint breakAngle",
            ),
            enabled,
          );
          break;
        case "gear":
          spawned = rustEngine.spawn_physics_gear_joint(
            entityA.entityId,
            entityA.entityGeneration,
            entityB.entityId,
            entityB.entityGeneration,
            finiteNumber(options.ratio ?? 1, "physics gear joint ratio"),
            finiteNumber(options.referenceAngle ?? 0, "physics gear joint referenceAngle"),
            unitIntervalNumber(options.stiffness ?? 1, "physics gear joint stiffness"),
            unitIntervalNumber(options.damping ?? 1, "physics gear joint damping"),
            breakLimitNumber(
              options.breakAngle ?? Number.POSITIVE_INFINITY,
              "physics gear joint breakAngle",
            ),
            enabled,
          );
          break;
        default:
          throw new Error("physics joint type is not supported.");
      }

      if (!spawned) {
        throw new Error("spawnPhysicsJoint() rejected invalid physics joint options.");
      }
      return readPhysicsJointHandle(rustEngine);
    },

    getPhysicsJoint(handle) {
      requireAlive();
      const resolved = physicsJointHandle(handle);
      if (
        !rustEngine.query_physics_joint(
          PHYSICS_JOINT_TYPE_CODES[resolved.jointType],
          resolved.jointIndex,
          resolved.jointGeneration,
        )
      ) {
        return undefined;
      }
      return readPhysicsJointSnapshot(rustEngine);
    },

    clearPhysicsJoint(handle) {
      requireAlive();
      const resolved = physicsJointHandle(handle);
      return rustEngine.clear_physics_joint(
        PHYSICS_JOINT_TYPE_CODES[resolved.jointType],
        resolved.jointIndex,
        resolved.jointGeneration,
      );
    },

    setPhysicsJointEnabled(handle, enabled) {
      requireAlive();
      const resolved = physicsJointHandle(handle);
      return rustEngine.set_physics_joint_enabled(
        PHYSICS_JOINT_TYPE_CODES[resolved.jointType],
        resolved.jointIndex,
        resolved.jointGeneration,
        enabled,
      );
    },
  };
}

function physicsJointHandle(handle: PhysicsJointHandle): PhysicsJointHandle {
  if (!isPhysicsJointType(handle.jointType)) {
    throw new Error(
      "physics jointType must be distance, rope, spring, pulley, revolute, prismatic, weld, or gear.",
    );
  }
  return {
    jointType: handle.jointType,
    jointIndex: uint32Number(handle.jointIndex, "physics joint index"),
    jointGeneration: uint32Number(handle.jointGeneration, "physics joint generation"),
  };
}

function isPhysicsJointType(jointType: string): jointType is PhysicsJointType {
  return Object.prototype.hasOwnProperty.call(PHYSICS_JOINT_TYPE_CODES, jointType);
}

function readPhysicsJointHandle(rustEngine: Engine): PhysicsJointHandle {
  return {
    jointType: PHYSICS_JOINT_TYPES[rustEngine.physics_joint_type()] ?? "distance",
    jointIndex: rustEngine.physics_joint_index(),
    jointGeneration: rustEngine.physics_joint_generation(),
  };
}

function readPhysicsJointSnapshot(rustEngine: Engine): PhysicsJointSnapshot {
  return {
    ...readPhysicsJointHandle(rustEngine),
    entityA: {
      entityId: rustEngine.physics_joint_entity_a_id(),
      entityGeneration: rustEngine.physics_joint_entity_a_generation(),
    },
    entityB: {
      entityId: rustEngine.physics_joint_entity_b_id(),
      entityGeneration: rustEngine.physics_joint_entity_b_generation(),
    },
    enabled: rustEngine.physics_joint_enabled(),
    restLength: rustEngine.physics_joint_rest_length(),
    maxLength: rustEngine.physics_joint_max_length(),
    ratio: rustEngine.physics_joint_ratio(),
    referenceAngle: rustEngine.physics_joint_reference_angle(),
    breakDistance: rustEngine.physics_joint_break_distance(),
    breakAngle: rustEngine.physics_joint_break_angle(),
    stiffness: rustEngine.physics_joint_stiffness(),
    damping: rustEngine.physics_joint_damping(),
    angularStiffness: rustEngine.physics_joint_angular_stiffness(),
    angularDamping: rustEngine.physics_joint_angular_damping(),
    localAnchorAX: rustEngine.physics_joint_local_anchor_a_x(),
    localAnchorAY: rustEngine.physics_joint_local_anchor_a_y(),
    localAnchorBX: rustEngine.physics_joint_local_anchor_b_x(),
    localAnchorBY: rustEngine.physics_joint_local_anchor_b_y(),
    localAxisAX: rustEngine.physics_joint_local_axis_a_x(),
    localAxisAY: rustEngine.physics_joint_local_axis_a_y(),
    groundAnchorAX: rustEngine.physics_joint_ground_anchor_a_x(),
    groundAnchorAY: rustEngine.physics_joint_ground_anchor_a_y(),
    groundAnchorBX: rustEngine.physics_joint_ground_anchor_b_x(),
    groundAnchorBY: rustEngine.physics_joint_ground_anchor_b_y(),
    limitEnabled: rustEngine.physics_joint_limit_enabled(),
    lowerAngle: rustEngine.physics_joint_lower_angle(),
    upperAngle: rustEngine.physics_joint_upper_angle(),
    lowerTranslation: rustEngine.physics_joint_lower_translation(),
    upperTranslation: rustEngine.physics_joint_upper_translation(),
    motorEnabled: rustEngine.physics_joint_motor_enabled(),
    motorSpeed: rustEngine.physics_joint_motor_speed(),
    maxMotorForce: rustEngine.physics_joint_max_motor_force(),
    maxMotorTorque: rustEngine.physics_joint_max_motor_torque(),
  };
}
