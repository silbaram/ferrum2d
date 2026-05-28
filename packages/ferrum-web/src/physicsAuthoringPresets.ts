import type { PhysicsRigidBodyMaterial } from "./engineTypes.js";
import type { PhysicsLayerPattern, PhysicsMaterialPresetName } from "./physicsAuthoringTypes.js";

export const PHYSICS_MATERIAL_PRESETS = {
  default: { friction: 0.4, restitution: 0, density: 1 },
  ice: { friction: 0.02, restitution: 0.05, density: 1 },
  rubber: { friction: 0.8, restitution: 0.9, density: 1 },
  wood: { friction: 0.6, restitution: 0.2, density: 0.8 },
  metal: { friction: 0.35, restitution: 0.05, density: 3 },
  platform: { friction: 0.7, restitution: 0, density: 1 },
} as const satisfies Record<string, Readonly<Required<Pick<PhysicsRigidBodyMaterial, "friction" | "restitution" | "density">>>>;

export const PHYSICS_BUILTIN_COLLISION_LAYERS = ["player", "enemy", "bullet", "wall"] as const;

export const PHYSICS_COMMON_LAYER_PATTERN = {
  player: ["world", "enemy", "pickup", "trigger"],
  world: ["player", "enemy", "projectile"],
  enemy: ["player", "world", "projectile"],
  projectile: ["world", "enemy"],
  pickup: ["player"],
  trigger: ["player", "enemy"],
  sensor: ["player", "enemy"],
} as const satisfies PhysicsLayerPattern;
