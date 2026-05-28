import type { PhysicsRigidBodyCollider } from "./engineTypes.js";
import { physicsSpecDiagnosticError } from "./diagnostics.js";
import type { PhysicsAuthoringContext, PhysicsColliderAuthoringOptions, RuntimeResolvedCollider } from "./physicsAuthoringTypes.js";
import type { PhysicsSpecVector2, ResolvedPhysicsColliderSpec, ResolvedPhysicsVector2 } from "./physicsSpec.js";
import {
  finiteNumber,
  positiveNumber,
  requireDistinctPoints,
  requiredPositiveVector2,
  requiredVector2,
} from "./physicsAuthoringValidation.js";

export function resolvedPhysicsColliderRuntimeCount(_collider: ResolvedPhysicsColliderSpec): number {
  return 1;
}

export function createCollider(
  options: PhysicsColliderAuthoringOptions,
  context: PhysicsAuthoringContext = {},
): PhysicsRigidBodyCollider {
  const path = context.path ?? "physics.collider";
  switch (options.type) {
    case "aabb":
    case "box": {
      const halfSize = boxHalfSize(options, path);
      return withColliderOffset({
        type: "aabb",
        halfWidth: halfSize.x,
        halfHeight: halfSize.y,
      }, options.offset, path);
    }
    case "circle":
      return withColliderOffset({
        type: "circle",
        radius: positiveNumber(options.radius, `${path}.radius`),
      }, options.offset, path);
    case "capsule": {
      const start = requiredVector2(options.start, `${path}.start`);
      const end = requiredVector2(options.end, `${path}.end`);
      requireDistinctPoints(start, end, path);
      return withColliderOffset({
        type: "capsule",
        startX: start.x,
        startY: start.y,
        endX: end.x,
        endY: end.y,
        radius: positiveNumber(options.radius, `${path}.radius`),
      }, options.offset, path);
    }
    case "orientedBox": {
      const halfSize = boxHalfSize(options, path);
      return withColliderOffset({
        type: "orientedBox",
        halfWidth: halfSize.x,
        halfHeight: halfSize.y,
        rotationRadians: finiteNumber(options.rotationRadians ?? 0, `${path}.rotationRadians`),
      }, options.offset, path);
    }
    case "convexPolygon":
      return withColliderOffset({
        type: "convexPolygon",
        vertices: flattenConvexVertices(options.vertices, `${path}.vertices`),
        rotationRadians: finiteNumber(options.rotationRadians ?? 0, `${path}.rotationRadians`),
      }, options.offset, path);
    case "edge": {
      const start = requiredVector2(options.start, `${path}.start`);
      const end = requiredVector2(options.end, `${path}.end`);
      requireDistinctPoints(start, end, path);
      return withColliderOffset({
        type: "edge",
        startX: start.x,
        startY: start.y,
        endX: end.x,
        endY: end.y,
      }, options.offset, path);
    }
    case "chain":
      return withColliderOffset({
        type: "chain",
        vertices: flattenChainVertices(options.vertices, `${path}.vertices`, options.loop === true),
        loop: options.loop === true,
      }, options.offset, path);
  }
}


export function runtimeCollidersFromResolved(
  collider: ResolvedPhysicsColliderSpec,
  path: string,
): readonly RuntimeResolvedCollider[] {
  switch (collider.shape) {
    case "aabb":
    case "box":
      return [{
        path,
        collider: {
          type: "aabb",
          halfWidth: collider.halfWidth,
          halfHeight: collider.halfHeight,
          offsetX: collider.offsetX,
          offsetY: collider.offsetY,
        },
      }];
    case "circle":
      return [{
        path,
        collider: {
          type: "circle",
          radius: collider.radius,
          offsetX: collider.offsetX,
          offsetY: collider.offsetY,
        },
      }];
    case "capsule":
      return [{
        path,
        collider: {
          type: "capsule",
          startX: collider.startX,
          startY: collider.startY,
          endX: collider.endX,
          endY: collider.endY,
          radius: collider.radius,
          offsetX: collider.offsetX,
          offsetY: collider.offsetY,
        },
      }];
    case "orientedBox":
      return [{
        path,
        collider: {
          type: "orientedBox",
          halfWidth: collider.halfWidth,
          halfHeight: collider.halfHeight,
          rotationRadians: collider.rotationRadians,
          offsetX: collider.offsetX,
          offsetY: collider.offsetY,
        },
      }];
    case "convexPolygon":
      return [{
        path,
        collider: {
          type: "convexPolygon",
          vertices: flattenResolvedVertices(collider.vertices),
          rotationRadians: collider.rotationRadians,
          offsetX: collider.offsetX,
          offsetY: collider.offsetY,
        },
      }];
    case "edge":
      return [{
        path,
        collider: {
          type: "edge",
          startX: collider.startX,
          startY: collider.startY,
          endX: collider.endX,
          endY: collider.endY,
          offsetX: collider.offsetX,
          offsetY: collider.offsetY,
        },
      }];
    case "chain":
      return [{
        path,
        collider: {
          type: "chain",
          vertices: flattenResolvedVertices(collider.vertices),
          loop: collider.loop,
          offsetX: collider.offsetX,
          offsetY: collider.offsetY,
        },
      }];
  }
}

function withColliderOffset<T extends PhysicsRigidBodyCollider>(
  collider: T,
  offset: PhysicsSpecVector2 | undefined,
  path: string,
): T {
  if (offset === undefined) {
    return collider;
  }
  const resolved = requiredVector2(offset, `${path}.offset`);
  return {
    ...collider,
    offsetX: resolved.x,
    offsetY: resolved.y,
  };
}

function boxHalfSize(
  options: { size?: PhysicsSpecVector2; halfSize?: PhysicsSpecVector2 },
  path: string,
): ResolvedPhysicsVector2 {
  if (options.size !== undefined && options.halfSize !== undefined) {
    throw physicsSpecDiagnosticError(`${path}.size`, "cannot be combined with halfSize");
  }
  if (options.halfSize !== undefined) {
    return requiredPositiveVector2(options.halfSize, `${path}.halfSize`);
  }
  const size = requiredPositiveVector2(options.size, `${path}.size`);
  return { x: size.x / 2, y: size.y / 2 };
}

function flattenResolvedVertices(vertices: readonly ResolvedPhysicsVector2[]): readonly number[] {
  return vertices.flatMap((vertex) => [vertex.x, vertex.y]);
}

function flattenConvexVertices(vertices: readonly PhysicsSpecVector2[], path: string): readonly number[] {
  if (!Array.isArray(vertices)) {
    throw physicsSpecDiagnosticError(path, "must be an array");
  }
  if (vertices.length < 3 || vertices.length > 16) {
    throw physicsSpecDiagnosticError(path, "must define a convex polygon with 3-16 vertices");
  }
  const resolved = vertices.map((vertex, index) => requiredVector2(vertex, `${path}.${index}`));
  for (let index = 1; index < resolved.length; index += 1) {
    requireDistinctPoints(resolved[index - 1], resolved[index], `${path}.${index}`);
  }
  if (!isStrictlyConvexPolygon(resolved)) {
    throw physicsSpecDiagnosticError(path, "must define a convex polygon with non-collinear vertices");
  }
  return flattenResolvedVertices(resolved);
}

function flattenChainVertices(
  vertices: readonly PhysicsSpecVector2[],
  path: string,
  loop: boolean,
): readonly number[] {
  if (!Array.isArray(vertices)) {
    throw physicsSpecDiagnosticError(path, "must be an array");
  }
  if (vertices.length < 2 || vertices.length > 64) {
    throw physicsSpecDiagnosticError(path, "must define a chain with 2-64 vertices");
  }
  const resolved = vertices.map((vertex, index) => requiredVector2(vertex, `${path}.${index}`));
  for (let index = 1; index < resolved.length; index += 1) {
    requireDistinctPoints(resolved[index - 1], resolved[index], `${path}.${index}`);
  }
  if (loop && resolved.length > 2) {
    const first = resolved[0];
    const last = resolved[resolved.length - 1];
    if (first.x !== last.x || first.y !== last.y) {
      requireDistinctPoints(last, first, `${path}.loop`);
    }
  }
  return flattenResolvedVertices(resolved);
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
