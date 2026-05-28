import type { Engine } from "../pkg/ferrum_core";
import { finiteNumber, uint32Number } from "./particlePreset";
import { nonNegativeNumber, positiveNumber } from "./physicsAuthoringNumbers.js";
import {
  applyPhysicsBodyMaterial,
  applyPhysicsColliderMaterial,
  DEFAULT_RIGID_BODY_DENSITY,
} from "./physicsBodyMaterials.js";
import { physicsEntityHandle, readPhysicsEntityHandle } from "./physicsHandles.js";
import { DEFAULT_PHYSICS_MASK_BITS, physicsVertexBuffer } from "./physicsWasmInputs.js";
import type {
  PhysicsBodyColliderOptions,
  PhysicsCollisionLayer,
  PhysicsEntityHandle,
  PhysicsRigidBodyCollider,
  PhysicsRigidBodySpawnOptions,
  PhysicsRigidBodyType,
} from "./engineTypes.js";

const PHYSICS_BODY_TYPE_CODES: Record<PhysicsRigidBodyType, number> = Object.freeze({
  static: 0,
  kinematic: 1,
  dynamic: 2,
});

const PHYSICS_LAYER_CODES: Record<PhysicsCollisionLayer, number> = Object.freeze({
  player: 0,
  enemy: 1,
  bullet: 2,
  wall: 3,
});

const PHYSICS_LAYER_MASK_BITS: Record<PhysicsCollisionLayer, number> = Object.freeze({
  player: 1 << 0,
  enemy: 1 << 1,
  bullet: 1 << 2,
  wall: 1 << 3,
});

export function spawnPhysicsRigidBody(
  rustEngine: Engine,
  options: PhysicsRigidBodySpawnOptions,
): PhysicsEntityHandle {
  const x = finiteNumber(options.x, "physics body x");
  const y = finiteNumber(options.y, "physics body y");
  const bodyType = physicsRigidBodyType(options.bodyType);
  const bodyTypeCode = PHYSICS_BODY_TYPE_CODES[bodyType];
  const layer = options.layer ?? (bodyType === "static" ? "wall" : "player");
  const layerCode = physicsCollisionLayerCode(layer);
  const categoryBits = uint32Number(
    options.categoryBits ?? PHYSICS_LAYER_MASK_BITS[layer],
    "physics body categoryBits",
  );
  const maskBits = uint32Number(options.maskBits ?? DEFAULT_PHYSICS_MASK_BITS, "physics body maskBits");
  const material = options.material;
  const density = positiveNumber(
    options.density ?? material?.density ?? DEFAULT_RIGID_BODY_DENSITY,
    "physics body density",
  );
  const mass = options.mass === undefined
    ? density
    : positiveNumber(options.mass, "physics body mass");
  const useDensity = options.mass === undefined;
  const colliderEnabled = options.colliderEnabled ?? true;
  const bodyEnabled = options.bodyEnabled ?? true;
  const canSleep = options.canSleep ?? bodyType === "dynamic";
  const collider = options.collider;
  let spawned = false;

  switch (collider.type) {
    case "aabb":
      spawned = rustEngine.spawn_physics_aabb_body(
        x,
        y,
        positiveNumber(collider.halfWidth, "physics aabb halfWidth"),
        positiveNumber(collider.halfHeight, "physics aabb halfHeight"),
        bodyTypeCode,
        mass,
        useDensity,
        layerCode,
        categoryBits,
        maskBits,
        options.isTrigger === true,
        colliderEnabled,
        bodyEnabled,
        canSleep,
      );
      break;
    case "circle":
      spawned = rustEngine.spawn_physics_circle_body(
        x,
        y,
        positiveNumber(collider.radius, "physics circle radius"),
        bodyTypeCode,
        mass,
        useDensity,
        layerCode,
        categoryBits,
        maskBits,
        options.isTrigger === true,
        colliderEnabled,
        bodyEnabled,
        canSleep,
      );
      break;
    case "capsule":
      spawned = rustEngine.spawn_physics_capsule_body(
        x,
        y,
        finiteNumber(collider.startX, "physics capsule startX"),
        finiteNumber(collider.startY, "physics capsule startY"),
        finiteNumber(collider.endX, "physics capsule endX"),
        finiteNumber(collider.endY, "physics capsule endY"),
        positiveNumber(collider.radius, "physics capsule radius"),
        bodyTypeCode,
        mass,
        useDensity,
        layerCode,
        categoryBits,
        maskBits,
        options.isTrigger === true,
        colliderEnabled,
        bodyEnabled,
        canSleep,
      );
      break;
    case "edge":
      spawned = rustEngine.spawn_physics_edge_body(
        x,
        y,
        finiteNumber(collider.startX, "physics edge startX"),
        finiteNumber(collider.startY, "physics edge startY"),
        finiteNumber(collider.endX, "physics edge endX"),
        finiteNumber(collider.endY, "physics edge endY"),
        bodyTypeCode,
        mass,
        useDensity,
        layerCode,
        categoryBits,
        maskBits,
        options.isTrigger === true,
        colliderEnabled,
        bodyEnabled,
        canSleep,
      );
      break;
    case "chain":
      spawned = rustEngine.spawn_physics_chain_body(
        x,
        y,
        physicsVertexBuffer(collider.vertices),
        collider.loop === true,
        bodyTypeCode,
        mass,
        useDensity,
        layerCode,
        categoryBits,
        maskBits,
        options.isTrigger === true,
        colliderEnabled,
        bodyEnabled,
        canSleep,
      );
      break;
    case "orientedBox":
      spawned = rustEngine.spawn_physics_oriented_box_body(
        x,
        y,
        positiveNumber(collider.halfWidth, "physics orientedBox halfWidth"),
        positiveNumber(collider.halfHeight, "physics orientedBox halfHeight"),
        finiteNumber(collider.rotationRadians ?? 0, "physics orientedBox rotationRadians"),
        bodyTypeCode,
        mass,
        useDensity,
        layerCode,
        categoryBits,
        maskBits,
        options.isTrigger === true,
        colliderEnabled,
        bodyEnabled,
        canSleep,
      );
      break;
    case "convexPolygon":
      spawned = rustEngine.spawn_physics_convex_polygon_body(
        x,
        y,
        physicsVertexBuffer(collider.vertices),
        finiteNumber(collider.rotationRadians ?? 0, "physics convexPolygon rotationRadians"),
        bodyTypeCode,
        mass,
        useDensity,
        layerCode,
        categoryBits,
        maskBits,
        options.isTrigger === true,
        colliderEnabled,
        bodyEnabled,
        canSleep,
      );
      break;
    default:
      throw new Error("physics collider type is not supported.");
  }

  if (!spawned) {
    throw new Error("spawnRigidBody() rejected invalid physics body options.");
  }
  const handle = readPhysicsEntityHandle(rustEngine);
  applyPhysicsColliderOffset(rustEngine, handle, collider);
  applyPhysicsBodyTuning(rustEngine, handle, bodyType, options);
  if (material !== undefined) {
    applyPhysicsBodyMaterial(rustEngine, handle, material);
  }
  if (options.colliderMaterial !== undefined) {
    applyPhysicsColliderMaterial(rustEngine, handle, options.colliderMaterial);
  }
  if (options.velocityX !== undefined || options.velocityY !== undefined) {
    rustEngine.set_physics_body_velocity(
      handle.entityId,
      handle.entityGeneration,
      finiteNumber(options.velocityX ?? 0, "physics body velocityX"),
      finiteNumber(options.velocityY ?? 0, "physics body velocityY"),
    );
  }
  if (options.rotationRadians !== undefined) {
    rustEngine.set_physics_body_rotation(
      handle.entityId,
      handle.entityGeneration,
      finiteNumber(options.rotationRadians, "physics body rotationRadians"),
    );
  }
  if (options.angularVelocityRadiansPerSecond !== undefined) {
    rustEngine.set_physics_body_angular_velocity(
      handle.entityId,
      handle.entityGeneration,
      finiteNumber(
        options.angularVelocityRadiansPerSecond,
        "physics body angularVelocityRadiansPerSecond",
      ),
    );
  }
  return handle;
}

export function addPhysicsBodyColliderToRigidBody(
  rustEngine: Engine,
  handle: PhysicsEntityHandle,
  options: PhysicsBodyColliderOptions,
): boolean {
  const resolved = physicsEntityHandle(handle);
  const layer = options.layer ?? "player";
  const layerCode = physicsCollisionLayerCode(layer);
  const categoryBits = uint32Number(
    options.categoryBits ?? PHYSICS_LAYER_MASK_BITS[layer],
    "physics collider categoryBits",
  );
  const maskBits = uint32Number(options.maskBits ?? DEFAULT_PHYSICS_MASK_BITS, "physics collider maskBits");
  const collider = options.collider;
  let added = false;

  switch (collider.type) {
    case "aabb":
      added = rustEngine.add_physics_aabb_collider(
        resolved.entityId,
        resolved.entityGeneration,
        positiveNumber(collider.halfWidth, "physics aabb halfWidth"),
        positiveNumber(collider.halfHeight, "physics aabb halfHeight"),
        finiteNumber(collider.offsetX ?? 0, "physics collider offsetX"),
        finiteNumber(collider.offsetY ?? 0, "physics collider offsetY"),
        layerCode,
        categoryBits,
        maskBits,
        options.isTrigger === true,
        options.colliderEnabled ?? true,
      );
      break;
    case "circle":
      added = rustEngine.add_physics_circle_collider(
        resolved.entityId,
        resolved.entityGeneration,
        positiveNumber(collider.radius, "physics circle radius"),
        finiteNumber(collider.offsetX ?? 0, "physics collider offsetX"),
        finiteNumber(collider.offsetY ?? 0, "physics collider offsetY"),
        layerCode,
        categoryBits,
        maskBits,
        options.isTrigger === true,
        options.colliderEnabled ?? true,
      );
      break;
    case "capsule":
      added = rustEngine.add_physics_capsule_collider(
        resolved.entityId,
        resolved.entityGeneration,
        finiteNumber(collider.startX, "physics capsule startX"),
        finiteNumber(collider.startY, "physics capsule startY"),
        finiteNumber(collider.endX, "physics capsule endX"),
        finiteNumber(collider.endY, "physics capsule endY"),
        positiveNumber(collider.radius, "physics capsule radius"),
        finiteNumber(collider.offsetX ?? 0, "physics collider offsetX"),
        finiteNumber(collider.offsetY ?? 0, "physics collider offsetY"),
        layerCode,
        categoryBits,
        maskBits,
        options.isTrigger === true,
        options.colliderEnabled ?? true,
      );
      break;
    case "edge":
      added = rustEngine.add_physics_edge_collider(
        resolved.entityId,
        resolved.entityGeneration,
        finiteNumber(collider.startX, "physics edge startX"),
        finiteNumber(collider.startY, "physics edge startY"),
        finiteNumber(collider.endX, "physics edge endX"),
        finiteNumber(collider.endY, "physics edge endY"),
        finiteNumber(collider.offsetX ?? 0, "physics collider offsetX"),
        finiteNumber(collider.offsetY ?? 0, "physics collider offsetY"),
        layerCode,
        categoryBits,
        maskBits,
        options.isTrigger === true,
        options.colliderEnabled ?? true,
      );
      break;
    case "chain":
      added = rustEngine.add_physics_chain_collider(
        resolved.entityId,
        resolved.entityGeneration,
        physicsVertexBuffer(collider.vertices),
        collider.loop === true,
        finiteNumber(collider.offsetX ?? 0, "physics collider offsetX"),
        finiteNumber(collider.offsetY ?? 0, "physics collider offsetY"),
        layerCode,
        categoryBits,
        maskBits,
        options.isTrigger === true,
        options.colliderEnabled ?? true,
      );
      break;
    case "orientedBox":
      added = rustEngine.add_physics_oriented_box_collider(
        resolved.entityId,
        resolved.entityGeneration,
        positiveNumber(collider.halfWidth, "physics orientedBox halfWidth"),
        positiveNumber(collider.halfHeight, "physics orientedBox halfHeight"),
        finiteNumber(collider.rotationRadians ?? 0, "physics orientedBox rotationRadians"),
        finiteNumber(collider.offsetX ?? 0, "physics collider offsetX"),
        finiteNumber(collider.offsetY ?? 0, "physics collider offsetY"),
        layerCode,
        categoryBits,
        maskBits,
        options.isTrigger === true,
        options.colliderEnabled ?? true,
      );
      break;
    case "convexPolygon":
      added = rustEngine.add_physics_convex_polygon_collider(
        resolved.entityId,
        resolved.entityGeneration,
        physicsVertexBuffer(collider.vertices),
        finiteNumber(collider.rotationRadians ?? 0, "physics convexPolygon rotationRadians"),
        finiteNumber(collider.offsetX ?? 0, "physics collider offsetX"),
        finiteNumber(collider.offsetY ?? 0, "physics collider offsetY"),
        layerCode,
        categoryBits,
        maskBits,
        options.isTrigger === true,
        options.colliderEnabled ?? true,
      );
      break;
    default:
      throw new Error("physics collider type is not supported.");
  }

  return added;
}

function physicsRigidBodyType(bodyType: PhysicsRigidBodyType | undefined): PhysicsRigidBodyType {
  if (bodyType === undefined) {
    return "dynamic";
  }
  if (isPhysicsRigidBodyType(bodyType)) {
    return bodyType;
  }
  throw new Error("physics bodyType must be static, kinematic, or dynamic.");
}

function physicsCollisionLayerCode(layer: PhysicsCollisionLayer): number {
  if (isPhysicsCollisionLayer(layer)) {
    return PHYSICS_LAYER_CODES[layer];
  }
  throw new Error("physics collision layer must be player, enemy, bullet, or wall.");
}

function isPhysicsRigidBodyType(bodyType: string): bodyType is PhysicsRigidBodyType {
  return Object.prototype.hasOwnProperty.call(PHYSICS_BODY_TYPE_CODES, bodyType);
}

function isPhysicsCollisionLayer(layer: string): layer is PhysicsCollisionLayer {
  return Object.prototype.hasOwnProperty.call(PHYSICS_LAYER_CODES, layer);
}

function applyPhysicsColliderOffset(
  rustEngine: Engine,
  handle: PhysicsEntityHandle,
  collider: PhysicsRigidBodyCollider,
): void {
  const offsetX = collider.offsetX;
  const offsetY = collider.offsetY;
  if (offsetX === undefined && offsetY === undefined) {
    return;
  }
  rustEngine.set_physics_collider_offset(
    handle.entityId,
    handle.entityGeneration,
    finiteNumber(offsetX ?? 0, "physics collider offsetX"),
    finiteNumber(offsetY ?? 0, "physics collider offsetY"),
  );
}

function applyPhysicsBodyTuning(
  rustEngine: Engine,
  handle: PhysicsEntityHandle,
  bodyType: PhysicsRigidBodyType,
  options: PhysicsRigidBodySpawnOptions,
): void {
  if (
    options.gravityScale === undefined &&
    options.linearDamping === undefined &&
    options.angularDamping === undefined
  ) {
    return;
  }
  rustEngine.set_physics_body_tuning(
    handle.entityId,
    handle.entityGeneration,
    finiteNumber(
      options.gravityScale ?? (bodyType === "dynamic" ? 1 : 0),
      "physics body gravityScale",
    ),
    nonNegativeNumber(options.linearDamping ?? 0, "physics body linearDamping"),
    nonNegativeNumber(options.angularDamping ?? 0, "physics body angularDamping"),
  );
}
