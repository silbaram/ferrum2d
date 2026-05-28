import {
  nonNegativeNumber,
  optionalObject,
  physicsSpecError,
  positiveNumber,
  rejectUnknownKeys,
  requireName,
  requiredObject,
  stringArray,
} from "../physicsSpecValidation.js";
import type {
  ResolvedPhysicsLayerSpec,
  ResolvedPhysicsMaterialSpec,
} from "../physicsSpecTypes.js";
import { DEFAULT_MATERIAL } from "./defaults.js";
import { LAYER_KEYS, MATERIAL_KEYS } from "./keys.js";
import { setRecordEntry } from "./records.js";

export function physicsMaterials(value: unknown, path: string): Record<string, ResolvedPhysicsMaterialSpec> {
  const materials = optionalObject(value, path);
  const resolved: Record<string, ResolvedPhysicsMaterialSpec> = {};
  for (const [name, material] of Object.entries(materials)) {
    const materialPath = `${path}.${name}`;
    requireName(name, materialPath);
    const object = requiredObject(material, materialPath);
    rejectUnknownKeys(object, materialPath, MATERIAL_KEYS);
    setRecordEntry(resolved, name, {
      friction: nonNegativeNumber(object.friction, `${materialPath}.friction`, DEFAULT_MATERIAL.friction),
      restitution: nonNegativeNumber(object.restitution, `${materialPath}.restitution`, DEFAULT_MATERIAL.restitution),
      density: positiveNumber(object.density, `${materialPath}.density`, DEFAULT_MATERIAL.density),
    });
  }
  return resolved;
}

export function physicsLayers(value: unknown, path: string): Record<string, ResolvedPhysicsLayerSpec> {
  const layers = optionalObject(value, path);
  const names = Object.keys(layers);
  if (names.length > 31) {
    throw physicsSpecError(path, "must contain at most 31 layers");
  }
  const layerIndices = new Map(names.map((name, index) => [name, index]));
  const resolved: Record<string, ResolvedPhysicsLayerSpec> = {};
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    const layerPath = `${path}.${name}`;
    requireName(name, layerPath);
    const object = requiredObject(layers[name], layerPath);
    rejectUnknownKeys(object, layerPath, LAYER_KEYS);
    const mask = stringArray(object.mask, `${layerPath}.mask`, []);
    let maskBits = 0;
    for (const target of mask) {
      const targetIndex = layerIndices.get(target);
      if (targetIndex === undefined) {
        throw physicsSpecError(`${layerPath}.mask`, `must reference an existing layer: ${target}`);
      }
      maskBits |= 1 << targetIndex;
    }
    setRecordEntry(resolved, name, {
      name,
      categoryBits: 1 << index,
      mask,
      maskBits,
    });
  }
  return resolved;
}
