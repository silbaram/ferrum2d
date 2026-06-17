import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import type { Engine } from "../pkg/ferrum_core";
import {
  createPhysicsJointApi,
} from "../src/physicsJointApi.js";
import type { PhysicsJointApiContext } from "../src/physicsJointApi.js";
import type { PhysicsJointSpawnOptions } from "../src/createEngine.js";

const ENTITY_A = Object.freeze({ entityId: 1, entityGeneration: 2 });
const ENTITY_B = Object.freeze({ entityId: 3, entityGeneration: 4 });

test("createPhysicsJointApi forwards every joint spawn type with stable defaults", () => {
  const context = fakeJointContext();
  const api = createPhysicsJointApi(context);
  const options: readonly PhysicsJointSpawnOptions[] = [
    { type: "distance", entityA: ENTITY_A, entityB: ENTITY_B, restLength: 10 },
    { type: "rope", entityA: ENTITY_A, entityB: ENTITY_B, maxLength: 11 },
    { type: "spring", entityA: ENTITY_A, entityB: ENTITY_B, restLength: 12 },
    {
      type: "pulley",
      entityA: ENTITY_A,
      entityB: ENTITY_B,
      groundAnchorAX: 1,
      groundAnchorAY: 2,
      groundAnchorBX: 3,
      groundAnchorBY: 4,
      restLength: 13,
    },
    { type: "revolute", entityA: ENTITY_A, entityB: ENTITY_B },
    { type: "prismatic", entityA: ENTITY_A, entityB: ENTITY_B },
    { type: "weld", entityA: ENTITY_A, entityB: ENTITY_B },
    { type: "gear", entityA: ENTITY_A, entityB: ENTITY_B },
  ];

  const handles = options.map((option) => api.spawnPhysicsJoint(option));

  deepEqual(handles, [
    { jointType: "distance", jointIndex: 5, jointGeneration: 6 },
    { jointType: "distance", jointIndex: 5, jointGeneration: 6 },
    { jointType: "distance", jointIndex: 5, jointGeneration: 6 },
    { jointType: "distance", jointIndex: 5, jointGeneration: 6 },
    { jointType: "distance", jointIndex: 5, jointGeneration: 6 },
    { jointType: "distance", jointIndex: 5, jointGeneration: 6 },
    { jointType: "distance", jointIndex: 5, jointGeneration: 6 },
    { jointType: "distance", jointIndex: 5, jointGeneration: 6 },
  ]);
  deepEqual(context.calls.map((call) => call[0]), [
    "alive",
    "spawn_physics_distance_joint",
    "alive",
    "spawn_physics_rope_joint",
    "alive",
    "spawn_physics_spring_joint",
    "alive",
    "spawn_physics_pulley_joint",
    "alive",
    "spawn_physics_revolute_joint",
    "alive",
    "spawn_physics_prismatic_joint",
    "alive",
    "spawn_physics_weld_joint",
    "alive",
    "spawn_physics_gear_joint",
  ]);
  deepEqual(context.calls[1], [
    "spawn_physics_distance_joint",
    1,
    2,
    3,
    4,
    0,
    0,
    0,
    0,
    10,
    1,
    0,
    Number.POSITIVE_INFINITY,
    true,
  ]);
});

test("createPhysicsJointApi forwards local anchors for linear joints", () => {
  const context = fakeJointContext();
  const api = createPhysicsJointApi(context);

  api.spawnPhysicsJoint({
    type: "distance",
    entityA: ENTITY_A,
    entityB: ENTITY_B,
    localAnchorAX: -1,
    localAnchorAY: 2,
    localAnchorBX: 3,
    localAnchorBY: -4,
    restLength: 10,
  });
  api.spawnPhysicsJoint({
    type: "rope",
    entityA: ENTITY_A,
    entityB: ENTITY_B,
    localAnchorAX: -5,
    localAnchorAY: 6,
    localAnchorBX: 7,
    localAnchorBY: -8,
    maxLength: 11,
  });
  api.spawnPhysicsJoint({
    type: "spring",
    entityA: ENTITY_A,
    entityB: ENTITY_B,
    localAnchorAX: -9,
    localAnchorAY: 10,
    localAnchorBX: 11,
    localAnchorBY: -12,
    restLength: 12,
  });

  deepEqual(context.calls[1], [
    "spawn_physics_distance_joint",
    1,
    2,
    3,
    4,
    -1,
    2,
    3,
    -4,
    10,
    1,
    0,
    Number.POSITIVE_INFINITY,
    true,
  ]);
  deepEqual(context.calls[3], [
    "spawn_physics_rope_joint",
    1,
    2,
    3,
    4,
    -5,
    6,
    7,
    -8,
    11,
    1,
    0,
    Number.POSITIVE_INFINITY,
    true,
  ]);
  deepEqual(context.calls[5], [
    "spawn_physics_spring_joint",
    1,
    2,
    3,
    4,
    -9,
    10,
    11,
    -12,
    12,
    1,
    0,
    Number.POSITIVE_INFINITY,
    true,
  ]);
});

test("createPhysicsJointApi queries, clears, and toggles joints through type codes", () => {
  const context = fakeJointContext();
  const api = createPhysicsJointApi(context);

  const snapshot = api.getPhysicsJoint({ jointType: "gear", jointIndex: 8, jointGeneration: 9 });
  equal(api.clearPhysicsJoint({ jointType: "pulley", jointIndex: 10, jointGeneration: 11 }), true);
  equal(api.setPhysicsJointEnabled({ jointType: "weld", jointIndex: 12, jointGeneration: 13 }, false), true);

  deepEqual(context.calls, [
    ["alive"],
    ["query_physics_joint", 5, 8, 9],
    ["alive"],
    ["clear_physics_joint", 7, 10, 11],
    ["alive"],
    ["set_physics_joint_enabled", 6, 12, 13, false],
  ]);
  deepEqual(snapshot, {
    jointType: "distance",
    jointIndex: 5,
    jointGeneration: 6,
    entityA: { entityId: 101, entityGeneration: 102 },
    entityB: { entityId: 201, entityGeneration: 202 },
    enabled: true,
    restLength: 1,
    maxLength: 2,
    ratio: 3,
    referenceAngle: 4,
    breakDistance: 5,
    breakAngle: 6,
    stiffness: 0.7,
    damping: 0.8,
    angularStiffness: 0.9,
    angularDamping: 1,
    localAnchorAX: 11,
    localAnchorAY: 12,
    localAnchorBX: 13,
    localAnchorBY: 14,
    localAxisAX: 15,
    localAxisAY: 16,
    groundAnchorAX: 17,
    groundAnchorAY: 18,
    groundAnchorBX: 19,
    groundAnchorBY: 20,
    limitEnabled: true,
    lowerAngle: -1,
    upperAngle: 1,
    lowerTranslation: -2,
    upperTranslation: 2,
    motorEnabled: true,
    motorSpeed: 30,
    maxMotorForce: 40,
    maxMotorTorque: 50,
  });
});

test("createPhysicsJointApi preserves requireAlive and validation gates", () => {
  const context = fakeJointContext(() => {
    throw new Error("destroyed");
  });
  const api = createPhysicsJointApi(context);

  let destroyedError: unknown;
  try {
    api.clearPhysicsJoint({ jointType: "distance", jointIndex: 1, jointGeneration: 2 });
  } catch (error) {
    destroyedError = error;
  }
  if (!(destroyedError instanceof Error) || destroyedError.message !== "destroyed") {
    throw new Error("Expected clearPhysicsJoint to throw destroyed.");
  }
  deepEqual(context.calls, [["alive"]]);

  const invalidContext = fakeJointContext();
  const invalidApi = createPhysicsJointApi(invalidContext);
  let invalidError: unknown;
  try {
    invalidApi.spawnPhysicsJoint({
      type: "distance",
      entityA: { entityId: -1, entityGeneration: 0 },
      entityB: ENTITY_B,
      restLength: 1,
    });
  } catch (error) {
    invalidError = error;
  }
  if (!(invalidError instanceof Error) || !invalidError.message.includes("physics entity id")) {
    throw new Error("Expected spawnPhysicsJoint to validate entity handles.");
  }
  deepEqual(invalidContext.calls, [["alive"]]);

  const invalidHandleContext = fakeJointContext();
  const invalidHandleApi = createPhysicsJointApi(invalidHandleContext);
  let invalidHandleError: unknown;
  try {
    invalidHandleApi.clearPhysicsJoint({
      jointType: "toString" as never,
      jointIndex: 1,
      jointGeneration: 2,
    });
  } catch (error) {
    invalidHandleError = error;
  }
  if (
    !(invalidHandleError instanceof Error)
    || !invalidHandleError.message.includes("physics jointType must be distance")
  ) {
    throw new Error("Expected clearPhysicsJoint to reject inherited jointType names.");
  }
  deepEqual(invalidHandleContext.calls, [["alive"]]);
});

function fakeJointContext(requireAliveOverride?: () => void): PhysicsJointApiContext & {
  calls: unknown[][];
} {
  const calls: unknown[][] = [];
  const rustEngine = {
    spawn_physics_distance_joint: (...args: unknown[]) => spawn(calls, "spawn_physics_distance_joint", args),
    spawn_physics_rope_joint: (...args: unknown[]) => spawn(calls, "spawn_physics_rope_joint", args),
    spawn_physics_spring_joint: (...args: unknown[]) => spawn(calls, "spawn_physics_spring_joint", args),
    spawn_physics_pulley_joint: (...args: unknown[]) => spawn(calls, "spawn_physics_pulley_joint", args),
    spawn_physics_revolute_joint: (...args: unknown[]) => spawn(calls, "spawn_physics_revolute_joint", args),
    spawn_physics_prismatic_joint: (...args: unknown[]) => spawn(calls, "spawn_physics_prismatic_joint", args),
    spawn_physics_weld_joint: (...args: unknown[]) => spawn(calls, "spawn_physics_weld_joint", args),
    spawn_physics_gear_joint: (...args: unknown[]) => spawn(calls, "spawn_physics_gear_joint", args),
    physics_joint_type: () => 0,
    physics_joint_index: () => 5,
    physics_joint_generation: () => 6,
    query_physics_joint(...args: unknown[]) {
      calls.push(["query_physics_joint", ...args]);
      return true;
    },
    clear_physics_joint(...args: unknown[]) {
      calls.push(["clear_physics_joint", ...args]);
      return true;
    },
    set_physics_joint_enabled(...args: unknown[]) {
      calls.push(["set_physics_joint_enabled", ...args]);
      return true;
    },
    physics_joint_entity_a_id: () => 101,
    physics_joint_entity_a_generation: () => 102,
    physics_joint_entity_b_id: () => 201,
    physics_joint_entity_b_generation: () => 202,
    physics_joint_enabled: () => true,
    physics_joint_rest_length: () => 1,
    physics_joint_max_length: () => 2,
    physics_joint_ratio: () => 3,
    physics_joint_reference_angle: () => 4,
    physics_joint_break_distance: () => 5,
    physics_joint_break_angle: () => 6,
    physics_joint_stiffness: () => 0.7,
    physics_joint_damping: () => 0.8,
    physics_joint_angular_stiffness: () => 0.9,
    physics_joint_angular_damping: () => 1,
    physics_joint_local_anchor_a_x: () => 11,
    physics_joint_local_anchor_a_y: () => 12,
    physics_joint_local_anchor_b_x: () => 13,
    physics_joint_local_anchor_b_y: () => 14,
    physics_joint_local_axis_a_x: () => 15,
    physics_joint_local_axis_a_y: () => 16,
    physics_joint_ground_anchor_a_x: () => 17,
    physics_joint_ground_anchor_a_y: () => 18,
    physics_joint_ground_anchor_b_x: () => 19,
    physics_joint_ground_anchor_b_y: () => 20,
    physics_joint_limit_enabled: () => true,
    physics_joint_lower_angle: () => -1,
    physics_joint_upper_angle: () => 1,
    physics_joint_lower_translation: () => -2,
    physics_joint_upper_translation: () => 2,
    physics_joint_motor_enabled: () => true,
    physics_joint_motor_speed: () => 30,
    physics_joint_max_motor_force: () => 40,
    physics_joint_max_motor_torque: () => 50,
  } as unknown as Engine;

  return {
    rustEngine,
    requireAlive() {
      calls.push(["alive"]);
      requireAliveOverride?.();
    },
    calls,
  };
}

function spawn(calls: unknown[][], name: string, args: unknown[]): boolean {
  calls.push([name, ...args]);
  return true;
}
