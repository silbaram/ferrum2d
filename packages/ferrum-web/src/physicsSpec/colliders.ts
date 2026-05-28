import {
  booleanValue,
  colliderShape,
  finiteNumber,
  optionalReference,
  physicsSpecError,
  positiveNumber,
  rejectUnknownKeys,
  requireDistinctPoints,
  requiredObject,
  requiredVector2,
  vector2,
} from "../physicsSpecValidation.js";
import type {
  PhysicsSpecColliderShape,
  ResolvedPhysicsColliderBaseSpec,
  ResolvedPhysicsColliderSpec,
  ResolvedPhysicsLayerSpec,
  ResolvedPhysicsMaterialSpec,
} from "../physicsSpecTypes.js";
import { boxHalfSize, colliderAllowedKeys, convexPolygonVertices, polygonVertices } from "./geometry.js";

export function physicsColliderArray(
  value: unknown,
  path: string,
  materials: Record<string, ResolvedPhysicsMaterialSpec>,
  layers: Record<string, ResolvedPhysicsLayerSpec>,
): ResolvedPhysicsColliderSpec[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw physicsSpecError(path, "must be an array");
  }
  const colliders: ResolvedPhysicsColliderSpec[] = [];
  for (let index = 0; index < value.length; index += 1) {
    colliders.push(physicsCollider(value[index], `${path}.${index}`, materials, layers));
  }
  return colliders;
}

export function physicsCollider(
  value: unknown,
  path: string,
  materials: Record<string, ResolvedPhysicsMaterialSpec>,
  layers: Record<string, ResolvedPhysicsLayerSpec>,
): ResolvedPhysicsColliderSpec {
  const object = requiredObject(value, path);
  const shape = colliderShape(object.shape, `${path}.shape`);
  rejectUnknownKeys(object, path, colliderAllowedKeys(shape));
  const base = physicsColliderBase(object, path, shape, materials, layers);
  switch (shape) {
    case "aabb":
    case "box": {
      const halfSize = boxHalfSize(object, path);
      return { ...base, shape, halfWidth: halfSize.x, halfHeight: halfSize.y };
    }
    case "circle":
      return { ...base, shape, radius: positiveNumber(object.radius, `${path}.radius`, 1) };
    case "capsule": {
      const start = requiredVector2(object.start, `${path}.start`);
      const end = requiredVector2(object.end, `${path}.end`);
      requireDistinctPoints(start, end, path);
      return {
        ...base,
        shape,
        startX: start.x,
        startY: start.y,
        endX: end.x,
        endY: end.y,
        radius: positiveNumber(object.radius, `${path}.radius`, 1),
      };
    }
    case "orientedBox": {
      const halfSize = boxHalfSize(object, path);
      return {
        ...base,
        shape,
        halfWidth: halfSize.x,
        halfHeight: halfSize.y,
        rotationRadians: finiteNumber(object.rotationRadians, `${path}.rotationRadians`, 0),
      };
    }
    case "convexPolygon":
      return {
        ...base,
        shape,
        vertices: convexPolygonVertices(object.vertices, `${path}.vertices`),
        rotationRadians: finiteNumber(object.rotationRadians, `${path}.rotationRadians`, 0),
      };
    case "edge": {
      const start = requiredVector2(object.start, `${path}.start`);
      const end = requiredVector2(object.end, `${path}.end`);
      requireDistinctPoints(start, end, path);
      return { ...base, shape, startX: start.x, startY: start.y, endX: end.x, endY: end.y };
    }
    case "chain":
      return {
        ...base,
        shape,
        vertices: polygonVertices(object.vertices, `${path}.vertices`, 2),
        loop: booleanValue(object.loop, `${path}.loop`, false),
      };
  }
}

function physicsColliderBase(
  object: Record<string, unknown>,
  path: string,
  shape: PhysicsSpecColliderShape,
  materials: Record<string, ResolvedPhysicsMaterialSpec>,
  layers: Record<string, ResolvedPhysicsLayerSpec>,
): ResolvedPhysicsColliderBaseSpec {
  const offset = vector2(object.offset, `${path}.offset`, { x: 0, y: 0 });
  const material = optionalReference(object.material, `${path}.material`, materials);
  const layer = optionalReference(object.layer, `${path}.layer`, layers);
  const base: ResolvedPhysicsColliderBaseSpec = {
    shape,
    offsetX: offset.x,
    offsetY: offset.y,
    trigger: booleanValue(object.trigger, `${path}.trigger`, false),
    enabled: booleanValue(object.enabled, `${path}.enabled`, true),
  };
  if (material !== undefined) {
    base.material = material;
  }
  if (layer !== undefined) {
    base.layer = layer;
  }
  return base;
}
