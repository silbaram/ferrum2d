import type { PhysicsRigidBodyMaterial } from "./engineTypes.js";
import { physicsSpecDiagnosticError } from "./diagnostics.js";
import { PHYSICS_MATERIAL_PRESETS } from "./physicsAuthoringPresets.js";
import type { PhysicsMaterialAuthoringInput, PhysicsMaterialPresetName } from "./physicsAuthoringTypes.js";
import type { ResolvedPhysicsMaterialSpec } from "./physicsSpec.js";

export function physicsMaterial(
  material: PhysicsMaterialAuthoringInput = "default",
  overrides?: PhysicsRigidBodyMaterial,
  path = "physics.material",
): PhysicsRigidBodyMaterial {
  const base = typeof material === "string" ? materialPreset(material, path) : material;
  return {
    ...base,
    ...overrides,
  };
}

export function materialFromSpec(
  materials: Record<string, ResolvedPhysicsMaterialSpec>,
  name: string,
  path: string,
): PhysicsRigidBodyMaterial {
  if (!hasOwnKey(materials, name)) {
    throw physicsSpecDiagnosticError(path, `references unknown material '${name}'`);
  }
  const material = materials[name];
  return {
    friction: material.friction,
    restitution: material.restitution,
    density: material.density,
  };
}

function materialPreset(name: string, path: string): PhysicsRigidBodyMaterial {
  if (isPhysicsMaterialPresetName(name)) {
    return { ...PHYSICS_MATERIAL_PRESETS[name] };
  }
  throw physicsSpecDiagnosticError(path, `must be one of ${Object.keys(PHYSICS_MATERIAL_PRESETS).join(", ")}`);
}

function isPhysicsMaterialPresetName(name: string): name is PhysicsMaterialPresetName {
  return hasOwnKey(PHYSICS_MATERIAL_PRESETS, name);
}

function hasOwnKey<T>(object: Record<string, T>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}
