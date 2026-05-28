import type {
  FerrumEngine,
  PhysicsEntityHandle,
  PhysicsRigidBodyMaterial,
  PhysicsRigidBodySpawnOptions,
} from "./engineTypes.js";
import { describeError, physicsSpecDiagnosticError } from "./diagnostics.js";

export function spawnBody(
  engine: FerrumEngine,
  options: PhysicsRigidBodySpawnOptions,
  path: string,
): PhysicsEntityHandle {
  try {
    return engine.spawnRigidBody(options);
  } catch (error) {
    throw physicsSpecDiagnosticError(path, `runtime rejected body: ${describeError(error)}`);
  }
}

export function setBodyMassProperties(
  engine: FerrumEngine,
  handle: PhysicsEntityHandle,
  properties: { mass: number; inertia: number },
  path: string,
): void {
  if (!engine.setPhysicsBodyMassProperties(handle, properties)) {
    throw physicsSpecDiagnosticError(path, "runtime rejected body mass properties");
  }
}

export function setBodyColliderMaterial(
  engine: FerrumEngine,
  handle: PhysicsEntityHandle,
  colliderIndex: number,
  material: PhysicsRigidBodyMaterial,
  path: string,
): void {
  if (!engine.setPhysicsBodyColliderMaterial(handle, colliderIndex, material)) {
    throw physicsSpecDiagnosticError(path, "runtime rejected compound collider material");
  }
}
