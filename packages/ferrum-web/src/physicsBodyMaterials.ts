import type { Engine } from "../pkg/ferrum_core";
import { finiteNumber, uint32Number } from "./particlePreset";
import { nonNegativeNumber, positiveNumber } from "./physicsAuthoringNumbers.js";
import { readPhysicsEntitySnapshot } from "./physicsBodySnapshots.js";
import type {
  PhysicsEntityHandle,
  PhysicsMaterialSnapshot,
  PhysicsRigidBodyMaterial,
} from "./engineTypes.js";

export const DEFAULT_RIGID_BODY_DENSITY = 1;
const DEFAULT_RIGID_BODY_RESTITUTION = 0;
const DEFAULT_RIGID_BODY_FRICTION = 0.4;
const DEFAULT_RIGID_BODY_MATERIAL_SCALE = 1;

export function applyPhysicsBodyMaterial(
  rustEngine: Engine,
  handle: PhysicsEntityHandle,
  material: PhysicsRigidBodyMaterial,
): void {
  setPhysicsBodyMaterialValues(rustEngine, handle, {
    restitution: material.restitution ?? DEFAULT_RIGID_BODY_RESTITUTION,
    friction: material.friction ?? DEFAULT_RIGID_BODY_FRICTION,
    surfaceVelocityX: material.surfaceVelocityX ?? 0,
    surfaceVelocityY: material.surfaceVelocityY ?? 0,
    density: material.density ?? DEFAULT_RIGID_BODY_DENSITY,
    contactBaumgarteBiasScale:
      material.contactBaumgarteBiasScale ?? DEFAULT_RIGID_BODY_MATERIAL_SCALE,
    maxContactBaumgarteBiasVelocityScale:
      material.maxContactBaumgarteBiasVelocityScale ?? DEFAULT_RIGID_BODY_MATERIAL_SCALE,
    contactPositionCorrectionScale:
      material.contactPositionCorrectionScale ?? DEFAULT_RIGID_BODY_MATERIAL_SCALE,
    contactPositionCorrectionSlopScale:
      material.contactPositionCorrectionSlopScale ?? DEFAULT_RIGID_BODY_MATERIAL_SCALE,
  });
}

export function applyPhysicsColliderMaterial(
  rustEngine: Engine,
  handle: PhysicsEntityHandle,
  material: PhysicsRigidBodyMaterial,
): void {
  if (!rustEngine.query_physics_entity(handle.entityId, handle.entityGeneration)) {
    return;
  }
  const current = readPhysicsEntitySnapshot(rustEngine);
  setPhysicsColliderMaterialValues(rustEngine, handle, {
    restitution: material.restitution ?? current.colliderMaterial.restitution,
    friction: material.friction ?? current.colliderMaterial.friction,
    surfaceVelocityX: material.surfaceVelocityX ?? current.colliderMaterial.surfaceVelocityX,
    surfaceVelocityY: material.surfaceVelocityY ?? current.colliderMaterial.surfaceVelocityY,
    density: material.density ?? current.colliderMaterial.density,
    contactBaumgarteBiasScale:
      material.contactBaumgarteBiasScale ?? current.colliderMaterial.contactBaumgarteBiasScale,
    maxContactBaumgarteBiasVelocityScale:
      material.maxContactBaumgarteBiasVelocityScale ??
      current.colliderMaterial.maxContactBaumgarteBiasVelocityScale,
    contactPositionCorrectionScale:
      material.contactPositionCorrectionScale ??
      current.colliderMaterial.contactPositionCorrectionScale,
    contactPositionCorrectionSlopScale:
      material.contactPositionCorrectionSlopScale ??
      current.colliderMaterial.contactPositionCorrectionSlopScale,
  });
}

export function setPhysicsBodyMaterialValues(
  rustEngine: Engine,
  handle: PhysicsEntityHandle,
  material: Required<PhysicsRigidBodyMaterial>,
): boolean {
  return rustEngine.set_physics_body_material(
    handle.entityId,
    handle.entityGeneration,
    nonNegativeNumber(
      material.restitution,
      "physics body material restitution",
    ),
    nonNegativeNumber(
      material.friction,
      "physics body material friction",
    ),
    finiteNumber(material.surfaceVelocityX, "physics body material surfaceVelocityX"),
    finiteNumber(material.surfaceVelocityY, "physics body material surfaceVelocityY"),
    positiveNumber(material.density, "physics body material density"),
    nonNegativeNumber(
      material.contactBaumgarteBiasScale,
      "physics body material contactBaumgarteBiasScale",
    ),
    nonNegativeNumber(
      material.maxContactBaumgarteBiasVelocityScale,
      "physics body material maxContactBaumgarteBiasVelocityScale",
    ),
    nonNegativeNumber(
      material.contactPositionCorrectionScale,
      "physics body material contactPositionCorrectionScale",
    ),
    nonNegativeNumber(
      material.contactPositionCorrectionSlopScale,
      "physics body material contactPositionCorrectionSlopScale",
    ),
  );
}

export function setPhysicsColliderMaterialValues(
  rustEngine: Engine,
  handle: PhysicsEntityHandle,
  material: PhysicsMaterialSnapshot,
): boolean {
  return rustEngine.set_physics_collider_material(
    handle.entityId,
    handle.entityGeneration,
    nonNegativeNumber(
      material.restitution,
      "physics collider material restitution",
    ),
    nonNegativeNumber(
      material.friction,
      "physics collider material friction",
    ),
    finiteNumber(material.surfaceVelocityX, "physics collider material surfaceVelocityX"),
    finiteNumber(material.surfaceVelocityY, "physics collider material surfaceVelocityY"),
    positiveNumber(material.density, "physics collider material density"),
    nonNegativeNumber(
      material.contactBaumgarteBiasScale,
      "physics collider material contactBaumgarteBiasScale",
    ),
    nonNegativeNumber(
      material.maxContactBaumgarteBiasVelocityScale,
      "physics collider material maxContactBaumgarteBiasVelocityScale",
    ),
    nonNegativeNumber(
      material.contactPositionCorrectionScale,
      "physics collider material contactPositionCorrectionScale",
    ),
    nonNegativeNumber(
      material.contactPositionCorrectionSlopScale,
      "physics collider material contactPositionCorrectionSlopScale",
    ),
  );
}

export function setPhysicsCompoundColliderMaterialValues(
  rustEngine: Engine,
  handle: PhysicsEntityHandle,
  colliderIndex: number,
  material: PhysicsMaterialSnapshot,
): boolean {
  return rustEngine.set_physics_compound_collider_material(
    handle.entityId,
    handle.entityGeneration,
    uint32Number(colliderIndex, "physics collider index"),
    nonNegativeNumber(
      material.restitution,
      "physics collider material restitution",
    ),
    nonNegativeNumber(
      material.friction,
      "physics collider material friction",
    ),
    finiteNumber(material.surfaceVelocityX, "physics collider material surfaceVelocityX"),
    finiteNumber(material.surfaceVelocityY, "physics collider material surfaceVelocityY"),
    positiveNumber(material.density, "physics collider material density"),
    nonNegativeNumber(
      material.contactBaumgarteBiasScale,
      "physics collider material contactBaumgarteBiasScale",
    ),
    nonNegativeNumber(
      material.maxContactBaumgarteBiasVelocityScale,
      "physics collider material maxContactBaumgarteBiasVelocityScale",
    ),
    nonNegativeNumber(
      material.contactPositionCorrectionScale,
      "physics collider material contactPositionCorrectionScale",
    ),
    nonNegativeNumber(
      material.contactPositionCorrectionSlopScale,
      "physics collider material contactPositionCorrectionSlopScale",
    ),
  );
}
