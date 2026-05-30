import type { Engine } from "../pkg/ferrum_core";
import { readPhysicsEntityHandle } from "./physicsHandles.js";
import type {
  PhysicsBodyColliderSnapshot,
  PhysicsColliderType,
  PhysicsEntitySnapshot,
  PhysicsRigidBodyType,
} from "./engineTypes.js";

const PHYSICS_BODY_TYPES: readonly PhysicsRigidBodyType[] = Object.freeze([
  "static",
  "kinematic",
  "dynamic",
]);
const PHYSICS_COLLIDER_TYPES: readonly PhysicsColliderType[] = Object.freeze([
  "none",
  "aabb",
  "circle",
  "capsule",
  "orientedBox",
  "convexPolygon",
  "edge",
  "chain",
]);
export function readPhysicsEntitySnapshot(rustEngine: Engine): PhysicsEntitySnapshot {
  const handle = readPhysicsEntityHandle(rustEngine);
  const heightSpan = rustEngine.physics_body_has_height_span(
    handle.entityId,
    handle.entityGeneration,
  )
    ? {
        floorId: rustEngine.physics_body_floor_id(handle.entityId, handle.entityGeneration),
        elevation: rustEngine.physics_body_elevation(handle.entityId, handle.entityGeneration),
        height: rustEngine.physics_body_height(handle.entityId, handle.entityGeneration),
      }
    : undefined;
  return {
    ...handle,
    x: rustEngine.physics_entity_x(),
    y: rustEngine.physics_entity_y(),
    velocityX: rustEngine.physics_entity_velocity_x(),
    velocityY: rustEngine.physics_entity_velocity_y(),
    rotationRadians: rustEngine.physics_entity_rotation_radians(),
    angularVelocityRadiansPerSecond:
      rustEngine.physics_entity_angular_velocity_radians_per_second(),
    bodyType: PHYSICS_BODY_TYPES[rustEngine.physics_entity_body_type()] ?? "dynamic",
    bodyEnabled: rustEngine.physics_entity_body_enabled(),
    isSleeping: rustEngine.physics_entity_is_sleeping(),
    colliderType: PHYSICS_COLLIDER_TYPES[rustEngine.physics_entity_collider_type()] ?? "none",
    colliderEnabled: rustEngine.physics_entity_collider_enabled(),
    colliderIsTrigger: rustEngine.physics_entity_collider_is_trigger(),
    colliderOffsetX: rustEngine.physics_entity_collider_offset_x(),
    colliderOffsetY: rustEngine.physics_entity_collider_offset_y(),
    colliderMaterialOverride: rustEngine.physics_entity_collider_material_override(),
    colliderMaterial: {
      restitution: rustEngine.physics_entity_collider_restitution(),
      friction: rustEngine.physics_entity_collider_friction(),
      surfaceVelocityX: rustEngine.physics_entity_collider_surface_velocity_x(),
      surfaceVelocityY: rustEngine.physics_entity_collider_surface_velocity_y(),
      density: rustEngine.physics_entity_collider_density(),
      contactBaumgarteBiasScale:
        rustEngine.physics_entity_collider_contact_baumgarte_bias_scale(),
      maxContactBaumgarteBiasVelocityScale:
        rustEngine.physics_entity_collider_max_contact_baumgarte_bias_velocity_scale(),
      contactPositionCorrectionScale:
        rustEngine.physics_entity_collider_contact_position_correction_scale(),
      contactPositionCorrectionSlopScale:
        rustEngine.physics_entity_collider_contact_position_correction_slop_scale(),
    },
    mass: rustEngine.physics_entity_mass(),
    inverseMass: rustEngine.physics_entity_inverse_mass(),
    inertia: rustEngine.physics_entity_inertia(),
    inverseInertia: rustEngine.physics_entity_inverse_inertia(),
    gravityScale: rustEngine.physics_entity_gravity_scale(),
    linearDamping: rustEngine.physics_entity_linear_damping(),
    angularDamping: rustEngine.physics_entity_angular_damping(),
    restitution: rustEngine.physics_entity_restitution(),
    friction: rustEngine.physics_entity_friction(),
    surfaceVelocityX: rustEngine.physics_entity_surface_velocity_x(),
    surfaceVelocityY: rustEngine.physics_entity_surface_velocity_y(),
    density: rustEngine.physics_entity_density(),
    contactBaumgarteBiasScale: rustEngine.physics_entity_contact_baumgarte_bias_scale(),
    maxContactBaumgarteBiasVelocityScale:
      rustEngine.physics_entity_max_contact_baumgarte_bias_velocity_scale(),
    contactPositionCorrectionScale:
      rustEngine.physics_entity_contact_position_correction_scale(),
    contactPositionCorrectionSlopScale:
      rustEngine.physics_entity_contact_position_correction_slop_scale(),
    ...(heightSpan ? { heightSpan } : {}),
  };
}

export function readPhysicsBodyColliderSnapshot(rustEngine: Engine): PhysicsBodyColliderSnapshot {
  return {
    colliderIndex: rustEngine.physics_body_collider_index(),
    colliderType: PHYSICS_COLLIDER_TYPES[rustEngine.physics_body_collider_type()] ?? "none",
    colliderEnabled: rustEngine.physics_body_collider_enabled(),
    colliderIsTrigger: rustEngine.physics_body_collider_is_trigger(),
    colliderOffsetX: rustEngine.physics_body_collider_offset_x(),
    colliderOffsetY: rustEngine.physics_body_collider_offset_y(),
    colliderMaterialOverride: rustEngine.physics_body_collider_material_override(),
    colliderMaterial: {
      restitution: rustEngine.physics_body_collider_restitution(),
      friction: rustEngine.physics_body_collider_friction(),
      surfaceVelocityX: rustEngine.physics_body_collider_surface_velocity_x(),
      surfaceVelocityY: rustEngine.physics_body_collider_surface_velocity_y(),
      density: rustEngine.physics_body_collider_density(),
      contactBaumgarteBiasScale:
        rustEngine.physics_body_collider_contact_baumgarte_bias_scale(),
      maxContactBaumgarteBiasVelocityScale:
        rustEngine.physics_body_collider_max_contact_baumgarte_bias_velocity_scale(),
      contactPositionCorrectionScale:
        rustEngine.physics_body_collider_contact_position_correction_scale(),
      contactPositionCorrectionSlopScale:
        rustEngine.physics_body_collider_contact_position_correction_slop_scale(),
    },
    categoryBits: rustEngine.physics_body_collider_category_bits(),
    maskBits: rustEngine.physics_body_collider_mask_bits(),
  };
}
