import type { PhysicsCollisionLayer } from "./engineTypes.js";
import { physicsSpecDiagnosticError } from "./diagnostics.js";
import { PHYSICS_BUILTIN_COLLISION_LAYERS } from "./physicsAuthoringPresets.js";
import type {
  PhysicsAuthoringLayer,
  PhysicsLayerMapOptions,
  PhysicsLayerPattern,
  PhysicsLayerPatternEntry,
} from "./physicsAuthoringTypes.js";
import { requireName } from "./physicsAuthoringValidation.js";

const BUILTIN_COLLISION_LAYER_SET = new Set<string>(PHYSICS_BUILTIN_COLLISION_LAYERS);

export function createPhysicsLayerSpec(pattern: PhysicsLayerPattern): Record<string, { mask: string[] }> {
  return Object.fromEntries(Object.entries(pattern).map(([name, entry]) => {
    const mask = layerPatternMask(entry);
    return [name, { mask: [...mask] }];
  }));
}

export function createPhysicsLayerMap(
  pattern: PhysicsLayerPattern,
  options: PhysicsLayerMapOptions = {},
): Record<string, PhysicsAuthoringLayer> {
  const path = options.path ?? "physics.layers";
  const names = Object.keys(pattern);
  if (names.length > 31) {
    throw physicsSpecDiagnosticError(path, "must contain at most 31 layers");
  }
  const nameSet = new Set(names);
  return Object.fromEntries(names.map((name, index) => {
    requireName(name, `${path}.${name}`);
    const entry = pattern[name];
    const mask = layerPatternMask(entry);
    for (const target of mask) {
      if (!nameSet.has(target)) {
        throw physicsSpecDiagnosticError(`${path}.${name}.mask`, `references unknown layer '${target}'`);
      }
    }
    return [name, {
      name,
      categoryBits: 1 << index,
      mask: [...mask],
      maskBits: mask.reduce<number>((bits, target) => bits | (1 << names.indexOf(target)), 0),
    }];
  }));
}

export function physicsLayerMaskBits(
  layers: Record<string, PhysicsAuthoringLayer>,
  names: readonly string[],
  path = "physics.layerMask",
): number {
  return names.reduce((bits, name, index) => {
    const layer = layers[name];
    if (!layer) {
      throw physicsSpecDiagnosticError(`${path}.${index}`, `references unknown layer '${name}'`);
    }
    return bits | layer.categoryBits;
  }, 0);
}

function layerPatternMask(entry: readonly string[] | PhysicsLayerPatternEntry): readonly string[] {
  if (isLayerMaskArray(entry)) {
    return entry;
  }
  return entry.mask ?? [];
}

function isLayerMaskArray(entry: readonly string[] | PhysicsLayerPatternEntry): entry is readonly string[] {
  return Array.isArray(entry);
}

export function authoringCollisionLayer(
  name: string | undefined,
  categoryBits: number | undefined,
  maskBits: number | undefined,
  path: string,
): PhysicsCollisionLayer | undefined {
  if (name === undefined) {
    return undefined;
  }
  const layer = builtinCollisionLayer(name);
  if (layer) {
    return layer;
  }
  if (categoryBits === undefined || maskBits === undefined) {
    throw physicsSpecDiagnosticError(path, `custom layer '${name}' requires categoryBits and maskBits`);
  }
  return undefined;
}

export function builtinCollisionLayer(name: string | undefined): PhysicsCollisionLayer | undefined {
  if (name !== undefined && BUILTIN_COLLISION_LAYER_SET.has(name)) {
    return name as PhysicsCollisionLayer;
  }
  return undefined;
}
