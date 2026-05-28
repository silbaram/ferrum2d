import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import type { Engine } from "../pkg/ferrum_core";
import {
  createPhysicsBodyApi,
} from "../src/physicsBodyApi.js";
import type { PhysicsBodyApiContext } from "../src/physicsBodyApi.js";
import {
  PHYSICS_BODY_STATE_FLOATS_PER_BODY,
  PHYSICS_BODY_STATE_U32S_PER_BODY,
} from "../src/physicsBodyStateBuffer.js";
import { DEFAULT_PHYSICS_MASK_BITS } from "../src/physicsWasmInputs.js";

test("createPhysicsBodyApi forwards rigid body spawn defaults and post-spawn controls", () => {
  const context = fakeBodyContext();
  const api = createPhysicsBodyApi(context);

  const handle = api.spawnRigidBody({
    x: 10,
    y: 20,
    bodyType: "static",
    collider: { type: "aabb", halfWidth: 3, halfHeight: 4 },
    velocityX: 5,
    rotationRadians: 0.5,
  });

  deepEqual(handle, { entityId: 101, entityGeneration: 202 });
  deepEqual(context.calls, [
    ["alive"],
    [
      "spawn_physics_aabb_body",
      10,
      20,
      3,
      4,
      0,
      1,
      true,
      3,
      8,
      DEFAULT_PHYSICS_MASK_BITS,
      false,
      true,
      true,
      false,
    ],
    ["set_physics_body_velocity", 101, 202, 5, 0],
    ["set_physics_body_rotation", 101, 202, 0.5],
  ]);
});

test("createPhysicsBodyApi rejects inherited body and layer names", () => {
  const bodyContext = fakeBodyContext();
  const bodyApi = createPhysicsBodyApi(bodyContext);

  const bodyError = captureError(() => bodyApi.spawnRigidBody({
    x: 0,
    y: 0,
    bodyType: "toString" as never,
    collider: { type: "circle", radius: 4 },
  }));
  if (!(bodyError instanceof Error)) {
    throw new Error("Expected invalid body type to throw an Error.");
  }
  ok(bodyError.message.includes("physics bodyType must be static"));
  deepEqual(bodyContext.calls, [["alive"]]);

  const layerContext = fakeBodyContext();
  const layerApi = createPhysicsBodyApi(layerContext);
  const layerError = captureError(() => layerApi.spawnRigidBody({
    x: 0,
    y: 0,
    layer: "toString" as never,
    collider: { type: "circle", radius: 4 },
  }));
  if (!(layerError instanceof Error)) {
    throw new Error("Expected invalid layer to throw an Error.");
  }
  ok(layerError.message.includes("physics collision layer must be player"));
  deepEqual(layerContext.calls, [["alive"]]);
});

test("createPhysicsBodyApi adds chain colliders with shared vertex and mask defaults", () => {
  const context = fakeBodyContext();
  const api = createPhysicsBodyApi(context);
  const vertices = new Float32Array([0, 0, 8, 0, 8, 8]);

  equal(api.addPhysicsBodyCollider(
    { entityId: 7, entityGeneration: 9 },
    {
      layer: "enemy",
      collider: { type: "chain", vertices, loop: true, offsetX: 1, offsetY: 2 },
    },
  ), true);

  deepEqual(context.calls, [
    ["alive"],
    ["add_physics_chain_collider", 7, 9, [0, 0, 8, 0, 8, 8], true, 1, 2, 1, 2, DEFAULT_PHYSICS_MASK_BITS, false, true],
  ]);
});

test("createPhysicsBodyApi captures body state buffers with copied arrays and decoded states", () => {
  const context = fakeBodyContext();
  const api = createPhysicsBodyApi(context);
  const snapshot = api.capturePhysicsBodyStateBuffer([{ entityId: 11, entityGeneration: 12 }]);

  equal(snapshot.bodyCount, 1);
  deepEqual(Array.from(snapshot.handles), [11, 12]);
  ok(snapshot.floats !== context.bodyStateView.floats);
  ok(snapshot.u32s !== context.bodyStateView.u32s);
  deepEqual(snapshot.states[0], {
    entityId: 11,
    entityGeneration: 12,
    x: 1,
    y: 2,
    velocityX: 3,
    velocityY: 4,
    rotationRadians: 5,
    angularVelocityRadiansPerSecond: 6,
    bodyType: "dynamic",
    bodyEnabled: true,
    isSleeping: false,
    colliderType: "circle",
    colliderEnabled: true,
    colliderIsTrigger: true,
    colliderOffsetX: 21,
    colliderOffsetY: 22,
    colliderMaterialOverride: true,
    colliderMaterial: {
      restitution: 23,
      friction: 24,
      surfaceVelocityX: 25,
      surfaceVelocityY: 26,
      density: 27,
      contactBaumgarteBiasScale: 28,
      maxContactBaumgarteBiasVelocityScale: 29,
      contactPositionCorrectionScale: 30,
      contactPositionCorrectionSlopScale: 31,
    },
    mass: 7,
    inverseMass: 1 / 7,
    inertia: 8,
    inverseInertia: 1 / 8,
    gravityScale: 9,
    linearDamping: 10,
    angularDamping: 11,
    restitution: 12,
    friction: 13,
    surfaceVelocityX: 14,
    surfaceVelocityY: 15,
    density: 16,
    contactBaumgarteBiasScale: 17,
    maxContactBaumgarteBiasVelocityScale: 18,
    contactPositionCorrectionScale: 19,
    contactPositionCorrectionSlopScale: 20,
  });
});

test("createPhysicsBodyApi merges body material updates with current snapshots", () => {
  const context = fakeBodyContext();
  const api = createPhysicsBodyApi(context);

  equal(api.setPhysicsBodyMaterial(
    { entityId: 21, entityGeneration: 22 },
    { friction: 0.75, density: 2.5 },
  ), true);

  deepEqual(context.calls, [
    ["alive"],
    ["query_physics_entity", 21, 22],
    [
      "set_physics_body_material",
      21,
      22,
      0.1,
      0.75,
      0.3,
      0.4,
      2.5,
      0.6,
      0.7,
      0.8,
      0.9,
    ],
  ]);
});

function captureError(action: () => void): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected action to throw.");
}

function fakeBodyContext(): PhysicsBodyApiContext & {
  calls: unknown[][];
  bodyStateView: {
    bodyCount: number;
    floats: Float32Array;
    u32s: Uint32Array;
    floatsPerBody: number;
    u32sPerBody: number;
  };
} {
  const calls: unknown[][] = [];
  const floats = new Float32Array(PHYSICS_BODY_STATE_FLOATS_PER_BODY);
  for (let index = 0; index < floats.length; index += 1) {
    floats[index] = index + 1;
  }
  const u32s = new Uint32Array(PHYSICS_BODY_STATE_U32S_PER_BODY);
  u32s.set([11, 12, 2, 2, 1 | 4 | 8 | 16]);
  const bodyStateView = {
    bodyCount: 1,
    floats,
    u32s,
    floatsPerBody: PHYSICS_BODY_STATE_FLOATS_PER_BODY,
    u32sPerBody: PHYSICS_BODY_STATE_U32S_PER_BODY,
  };
  const rustEngine = {
    spawn_physics_aabb_body(...args: unknown[]) {
      calls.push(["spawn_physics_aabb_body", ...args]);
      return true;
    },
    physics_entity_id: () => 101,
    physics_entity_generation: () => 202,
    set_physics_body_velocity(...args: unknown[]) {
      calls.push(["set_physics_body_velocity", ...args]);
      return true;
    },
    set_physics_body_rotation(...args: unknown[]) {
      calls.push(["set_physics_body_rotation", ...args]);
      return true;
    },
    add_physics_chain_collider(
      entityId: number,
      entityGeneration: number,
      vertices: Float32Array,
      ...args: unknown[]
    ) {
      calls.push(["add_physics_chain_collider", entityId, entityGeneration, Array.from(vertices), ...args]);
      return true;
    },
    capture_physics_body_snapshot_bulk(handles: Uint32Array) {
      calls.push(["capture_physics_body_snapshot_bulk", Array.from(handles)]);
      return true;
    },
    query_physics_entity(...args: unknown[]) {
      calls.push(["query_physics_entity", ...args]);
      return true;
    },
    physics_entity_x: () => 1,
    physics_entity_y: () => 2,
    physics_entity_velocity_x: () => 3,
    physics_entity_velocity_y: () => 4,
    physics_entity_rotation_radians: () => 5,
    physics_entity_angular_velocity_radians_per_second: () => 6,
    physics_entity_body_type: () => 2,
    physics_entity_body_enabled: () => true,
    physics_entity_is_sleeping: () => false,
    physics_entity_collider_type: () => 2,
    physics_entity_collider_enabled: () => true,
    physics_entity_collider_is_trigger: () => false,
    physics_entity_collider_offset_x: () => 0,
    physics_entity_collider_offset_y: () => 0,
    physics_entity_collider_material_override: () => false,
    physics_entity_collider_restitution: () => 1,
    physics_entity_collider_friction: () => 1,
    physics_entity_collider_surface_velocity_x: () => 0,
    physics_entity_collider_surface_velocity_y: () => 0,
    physics_entity_collider_density: () => 1,
    physics_entity_collider_contact_baumgarte_bias_scale: () => 1,
    physics_entity_collider_max_contact_baumgarte_bias_velocity_scale: () => 1,
    physics_entity_collider_contact_position_correction_scale: () => 1,
    physics_entity_collider_contact_position_correction_slop_scale: () => 1,
    physics_entity_mass: () => 1,
    physics_entity_inverse_mass: () => 1,
    physics_entity_inertia: () => 1,
    physics_entity_inverse_inertia: () => 1,
    physics_entity_gravity_scale: () => 1,
    physics_entity_linear_damping: () => 0,
    physics_entity_angular_damping: () => 0,
    physics_entity_restitution: () => 0.1,
    physics_entity_friction: () => 0.2,
    physics_entity_surface_velocity_x: () => 0.3,
    physics_entity_surface_velocity_y: () => 0.4,
    physics_entity_density: () => 0.5,
    physics_entity_contact_baumgarte_bias_scale: () => 0.6,
    physics_entity_max_contact_baumgarte_bias_velocity_scale: () => 0.7,
    physics_entity_contact_position_correction_scale: () => 0.8,
    physics_entity_contact_position_correction_slop_scale: () => 0.9,
    set_physics_body_material(...args: unknown[]) {
      calls.push(["set_physics_body_material", ...args]);
      return true;
    },
  } as unknown as Engine;

  return {
    rustEngine,
    bridge: {
      readPhysicsBodyStateBuffer: () => bodyStateView,
    } as unknown as PhysicsBodyApiContext["bridge"],
    requireAlive() {
      calls.push(["alive"]);
    },
    calls,
    bodyStateView,
  };
}
