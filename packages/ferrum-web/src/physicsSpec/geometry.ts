import {
  physicsSpecError,
  requireDistinctPoints,
  requiredPositiveVector2,
  requiredVector2,
} from "../physicsSpecValidation.js";
import type {
  PhysicsSpecColliderShape,
  ResolvedPhysicsVector2,
} from "../physicsSpecTypes.js";
import { COLLIDER_BASE_KEYS } from "./keys.js";

const BOX_COLLIDER_KEYS = colliderKeySet(["size", "halfSize"]);
const CIRCLE_COLLIDER_KEYS = colliderKeySet(["radius"]);
const CAPSULE_COLLIDER_KEYS = colliderKeySet(["start", "end", "radius"]);
const ORIENTED_BOX_COLLIDER_KEYS = colliderKeySet(["size", "halfSize", "rotationRadians"]);
const CONVEX_POLYGON_COLLIDER_KEYS = colliderKeySet(["vertices", "rotationRadians"]);
const EDGE_COLLIDER_KEYS = colliderKeySet(["start", "end"]);
const CHAIN_COLLIDER_KEYS = colliderKeySet(["vertices", "loop"]);

export function colliderAllowedKeys(shape: PhysicsSpecColliderShape): ReadonlySet<string> {
  switch (shape) {
    case "aabb":
    case "box":
      return BOX_COLLIDER_KEYS;
    case "circle":
      return CIRCLE_COLLIDER_KEYS;
    case "capsule":
      return CAPSULE_COLLIDER_KEYS;
    case "orientedBox":
      return ORIENTED_BOX_COLLIDER_KEYS;
    case "convexPolygon":
      return CONVEX_POLYGON_COLLIDER_KEYS;
    case "edge":
      return EDGE_COLLIDER_KEYS;
    case "chain":
      return CHAIN_COLLIDER_KEYS;
  }
}

export function boxHalfSize(object: Record<string, unknown>, path: string): ResolvedPhysicsVector2 {
  if (object.size !== undefined && object.halfSize !== undefined) {
    throw physicsSpecError(`${path}.size`, "cannot be combined with halfSize");
  }
  if (object.halfSize !== undefined) {
    return requiredPositiveVector2(object.halfSize, `${path}.halfSize`);
  }
  const size = requiredPositiveVector2(object.size, `${path}.size`);
  return { x: size.x / 2, y: size.y / 2 };
}

export function polygonVertices(value: unknown, path: string, minItems: number): ResolvedPhysicsVector2[] {
  if (!Array.isArray(value)) {
    throw physicsSpecError(path, "must be an array");
  }
  if (value.length < minItems) {
    throw physicsSpecError(path, `must contain at least ${minItems} vertices`);
  }
  if (value.length > 64) {
    throw physicsSpecError(path, "must contain at most 64 vertices");
  }
  const vertices: ResolvedPhysicsVector2[] = [];
  for (let index = 0; index < value.length; index += 1) {
    vertices.push(requiredVector2(value[index], `${path}.${index}`));
    if (index > 0) {
      requireDistinctPoints(vertices[index - 1], vertices[index], `${path}.${index}`);
    }
  }
  return vertices;
}

export function convexPolygonVertices(value: unknown, path: string): ResolvedPhysicsVector2[] {
  const vertices = polygonVertices(value, path, 3);
  if (vertices.length > 16) {
    throw physicsSpecError(path, "must define a convex polygon with at most 16 vertices");
  }
  if (!isStrictlyConvexPolygon(vertices)) {
    throw physicsSpecError(path, "must define a convex polygon with non-collinear vertices");
  }
  return vertices;
}

function isStrictlyConvexPolygon(vertices: readonly ResolvedPhysicsVector2[]): boolean {
  let sign = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const a = vertices[index];
    const b = vertices[(index + 1) % vertices.length];
    const c = vertices[(index + 2) % vertices.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross === 0) {
      return false;
    }
    const currentSign = Math.sign(cross);
    if (sign === 0) {
      sign = currentSign;
      continue;
    }
    if (currentSign !== sign) {
      return false;
    }
  }
  return true;
}

function colliderKeySet(keys: readonly string[]): ReadonlySet<string> {
  return new Set([...COLLIDER_BASE_KEYS, ...keys]);
}
