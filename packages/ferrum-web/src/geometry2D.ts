import type {
  ResolvedPhysicsBoxColliderSpec,
  ResolvedPhysicsCapsuleColliderSpec,
  ResolvedPhysicsCircleColliderSpec,
  ResolvedPhysicsConvexPolygonColliderSpec,
  ResolvedPhysicsOrientedBoxColliderSpec,
} from "./physicsSpecTypes.js";

/** 읽기 전용 2D 점입니다. 좌표 단위와 축은 Ferrum2D world 규약을 따릅니다. */
export interface Point2D {
  readonly x: number;
  readonly y: number;
}

/** 결과 객체를 재사용하는 allocation-aware point helper용 mutable 2D 점입니다. */
export interface MutablePoint2D {
  x: number;
  y: number;
}

/** Scale -> rotation -> translation 순서로 합성되는 2D 변환입니다. */
export interface Transform2DInput {
  readonly x: number;
  readonly y: number;
  readonly rotationRadians: number;
  readonly scaleX?: number;
  readonly scaleY?: number;
}

/** Physics body 원점의 world 위치와 회전입니다. */
export interface PhysicsBodyTransform2D {
  readonly x: number;
  readonly y: number;
  readonly rotationRadians: number;
}

/** Public geometry helper가 지원하는 resolved Physics Spec collider입니다. */
export type PhysicsGeometryCollider2D =
  | ResolvedPhysicsBoxColliderSpec
  | ResolvedPhysicsCircleColliderSpec
  | ResolvedPhysicsCapsuleColliderSpec
  | ResolvedPhysicsOrientedBoxColliderSpec
  | ResolvedPhysicsConvexPolygonColliderSpec;

/** `Float32Array`, `Float64Array`, number array와 호환되는 mutable numeric buffer입니다. */
export interface MutablePointBuffer2D {
  readonly length: number;
  [index: number]: number;
}

const MAX_CONVEX_POLYGON_POINTS = 16;

/**
 * 점을 원점 기준으로 회전합니다. Ferrum2D의 y-down world에서는 양의 각도가 화면상 시계 방향입니다.
 * `out`을 제공하면 새 객체를 할당하지 않습니다.
 */
export function rotatePoint2D(
  point: Point2D,
  rotationRadians: number,
  out?: MutablePoint2D,
): MutablePoint2D {
  const x = finite(point.x, "point.x");
  const y = finite(point.y, "point.y");
  const rotation = finite(rotationRadians, "rotationRadians");
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return writePoint(out, x * cos - y * sin, x * sin + y * cos);
}

/** Scale -> rotation -> translation 순서로 점을 변환합니다. */
export function transformPoint2D(
  point: Point2D,
  transform: Transform2DInput,
  out?: MutablePoint2D,
): MutablePoint2D {
  const x = finite(point.x, "point.x");
  const y = finite(point.y, "point.y");
  const positionX = finite(transform.x, "transform.x");
  const positionY = finite(transform.y, "transform.y");
  const rotation = finite(transform.rotationRadians, "transform.rotationRadians");
  const scaleX = finite(transform.scaleX ?? 1, "transform.scaleX");
  const scaleY = finite(transform.scaleY ?? 1, "transform.scaleY");
  const scaledX = x * scaleX;
  const scaledY = y * scaleY;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return writePoint(
    out,
    positionX + scaledX * cos - scaledY * sin,
    positionY + scaledX * sin + scaledY * cos,
  );
}

/** Translation -> inverse rotation -> inverse scale 순서로 world 점을 local 점으로 되돌립니다. */
export function inverseTransformPoint2D(
  point: Point2D,
  transform: Transform2DInput,
  out?: MutablePoint2D,
): MutablePoint2D {
  const x = finite(point.x, "point.x") - finite(transform.x, "transform.x");
  const y = finite(point.y, "point.y") - finite(transform.y, "transform.y");
  const rotation = finite(transform.rotationRadians, "transform.rotationRadians");
  const scaleX = nonZeroFinite(transform.scaleX ?? 1, "transform.scaleX");
  const scaleY = nonZeroFinite(transform.scaleY ?? 1, "transform.scaleY");
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return writePoint(
    out,
    (x * cos + y * sin) / scaleX,
    (-x * sin + y * cos) / scaleY,
  );
}

/** Rust body transform과 같은 translation + rotation으로 local 점을 world 점으로 변환합니다. */
export function bodyLocalToWorld2D(
  point: Point2D,
  body: PhysicsBodyTransform2D,
  out?: MutablePoint2D,
): MutablePoint2D {
  return transformPoint2D(point, body, out);
}

/** Rust body transform과 같은 translation + rotation을 역으로 적용합니다. */
export function bodyWorldToLocal2D(
  point: Point2D,
  body: PhysicsBodyTransform2D,
  out?: MutablePoint2D,
): MutablePoint2D {
  return inverseTransformPoint2D(point, body, out);
}

/**
 * Rust collider query/debug 계산과 같은 world center를 반환합니다.
 * collider offset은 body rotation과 무관하게 world 축으로 더해집니다.
 */
export function physicsColliderWorldCenter2D(
  collider: PhysicsGeometryCollider2D,
  body: PhysicsBodyTransform2D,
  out?: MutablePoint2D,
): MutablePoint2D {
  const originX = finite(body.x, "body.x") + finite(collider.offsetX, "collider.offsetX");
  const originY = finite(body.y, "body.y") + finite(collider.offsetY, "collider.offsetY");

  if (collider.shape === "capsule") {
    return writePoint(
      out,
      originX + (finite(collider.startX, "collider.startX") + finite(collider.endX, "collider.endX")) * 0.5,
      originY + (finite(collider.startY, "collider.startY") + finite(collider.endY, "collider.endY")) * 0.5,
    );
  }
  if (collider.shape === "convexPolygon") {
    validateConvexVertices(collider);
    let localX = 0;
    let localY = 0;
    for (let index = 0; index < collider.vertices.length; index += 1) {
      const vertex = collider.vertices[index];
      localX += finiteColliderVertex(vertex.x, index, "x");
      localY += finiteColliderVertex(vertex.y, index, "y");
    }
    const scale = 1 / collider.vertices.length;
    return writeRotatedTranslatedPoint(
      localX * scale,
      localY * scale,
      originX,
      originY,
      totalColliderRotation(body, collider),
      out,
    );
  }
  if (collider.shape === "orientedBox") {
    totalColliderRotation(body, collider);
  }
  return writePoint(out, originX, originY);
}

/** Collider outline을 대표하는 world point 개수를 반환합니다. */
export function physicsColliderWorldReferencePointCount(
  collider: PhysicsGeometryCollider2D,
): number {
  switch (collider.shape) {
    case "aabb":
    case "box":
    case "orientedBox":
      return 4;
    case "circle":
      return 1;
    case "capsule":
      return 2;
    case "convexPolygon":
      validateConvexVertices(collider);
      return collider.vertices.length;
  }
}

/**
 * Rust collider query/debug 계산과 같은 world reference point를 `[x0, y0, ...]`에 기록합니다.
 * AABB/box는 world 좌상단부터 시계 방향 꼭짓점, oriented box는 local 좌상단부터
 * 시계 방향인 꼭짓점을 world로 변환한 순서, circle은 중심, capsule은 start/end,
 * convex polygon은 authored vertex 순서를 사용합니다.
 */
export function writePhysicsColliderWorldReferencePoints(
  collider: PhysicsGeometryCollider2D,
  body: PhysicsBodyTransform2D,
  target: MutablePointBuffer2D,
  floatOffset = 0,
): number {
  const pointCount = physicsColliderWorldReferencePointCount(collider);
  const offset = nonNegativeInteger(floatOffset, "floatOffset");
  if (target.length < offset + pointCount * 2) {
    throw new RangeError("target length must contain floatOffset + pointCount * 2 values");
  }

  const originX = finite(body.x, "body.x") + finite(collider.offsetX, "collider.offsetX");
  const originY = finite(body.y, "body.y") + finite(collider.offsetY, "collider.offsetY");

  switch (collider.shape) {
    case "aabb":
    case "box": {
      const halfWidth = positiveFinite(collider.halfWidth, "collider.halfWidth");
      const halfHeight = positiveFinite(collider.halfHeight, "collider.halfHeight");
      writeBufferPoint(target, offset, originX - halfWidth, originY - halfHeight);
      writeBufferPoint(target, offset + 2, originX + halfWidth, originY - halfHeight);
      writeBufferPoint(target, offset + 4, originX + halfWidth, originY + halfHeight);
      writeBufferPoint(target, offset + 6, originX - halfWidth, originY + halfHeight);
      break;
    }
    case "circle":
      positiveFinite(collider.radius, "collider.radius");
      writeBufferPoint(target, offset, originX, originY);
      break;
    case "capsule":
      positiveFinite(collider.radius, "collider.radius");
      writeBufferPoint(
        target,
        offset,
        originX + finite(collider.startX, "collider.startX"),
        originY + finite(collider.startY, "collider.startY"),
      );
      writeBufferPoint(
        target,
        offset + 2,
        originX + finite(collider.endX, "collider.endX"),
        originY + finite(collider.endY, "collider.endY"),
      );
      break;
    case "orientedBox": {
      const halfWidth = positiveFinite(collider.halfWidth, "collider.halfWidth");
      const halfHeight = positiveFinite(collider.halfHeight, "collider.halfHeight");
      const rotation = totalColliderRotation(body, collider);
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      writeRotatedBufferPoint(target, offset, -halfWidth, -halfHeight, originX, originY, cos, sin);
      writeRotatedBufferPoint(target, offset + 2, halfWidth, -halfHeight, originX, originY, cos, sin);
      writeRotatedBufferPoint(target, offset + 4, halfWidth, halfHeight, originX, originY, cos, sin);
      writeRotatedBufferPoint(target, offset + 6, -halfWidth, halfHeight, originX, originY, cos, sin);
      break;
    }
    case "convexPolygon": {
      validateConvexVertices(collider);
      const rotation = totalColliderRotation(body, collider);
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      for (let index = 0; index < collider.vertices.length; index += 1) {
        const vertex = collider.vertices[index];
        const localX = finiteColliderVertex(vertex.x, index, "x");
        const localY = finiteColliderVertex(vertex.y, index, "y");
        writeBufferPoint(
          target,
          offset + index * 2,
          originX + localX * cos - localY * sin,
          originY + localX * sin + localY * cos,
        );
      }
      break;
    }
  }
  return pointCount;
}

function totalColliderRotation(
  body: PhysicsBodyTransform2D,
  collider: ResolvedPhysicsOrientedBoxColliderSpec | ResolvedPhysicsConvexPolygonColliderSpec,
): number {
  const bodyRotation = Number.isFinite(body.rotationRadians) ? body.rotationRadians : 0;
  return finite(
    bodyRotation + finite(collider.rotationRadians, "collider.rotationRadians"),
    "body.rotationRadians + collider.rotationRadians",
  );
}

function validateConvexVertices(collider: ResolvedPhysicsConvexPolygonColliderSpec): void {
  if (collider.vertices.length < 3 || collider.vertices.length > MAX_CONVEX_POLYGON_POINTS) {
    throw new RangeError(`collider.vertices must contain between 3 and ${MAX_CONVEX_POLYGON_POINTS} points`);
  }
}

function writeRotatedTranslatedPoint(
  localX: number,
  localY: number,
  originX: number,
  originY: number,
  rotationRadians: number,
  out?: MutablePoint2D,
): MutablePoint2D {
  const cos = Math.cos(rotationRadians);
  const sin = Math.sin(rotationRadians);
  return writePoint(
    out,
    originX + localX * cos - localY * sin,
    originY + localX * sin + localY * cos,
  );
}

function writeRotatedBufferPoint(
  target: MutablePointBuffer2D,
  offset: number,
  localX: number,
  localY: number,
  originX: number,
  originY: number,
  cos: number,
  sin: number,
): void {
  writeBufferPoint(
    target,
    offset,
    originX + localX * cos - localY * sin,
    originY + localX * sin + localY * cos,
  );
}

function writePoint(out: MutablePoint2D | undefined, x: number, y: number): MutablePoint2D {
  const target = out ?? { x: 0, y: 0 };
  target.x = x;
  target.y = y;
  return target;
}

function writeBufferPoint(target: MutablePointBuffer2D, offset: number, x: number, y: number): void {
  target[offset] = x;
  target[offset + 1] = y;
}

function finite(value: number, path: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${path} must be finite`);
  }
  return value;
}

function finiteColliderVertex(value: number, index: number, axis: "x" | "y"): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`collider.vertices.${index}.${axis} must be finite`);
  }
  return value;
}

function nonZeroFinite(value: number, path: string): number {
  const resolved = finite(value, path);
  if (resolved === 0) {
    throw new RangeError(`${path} must not be zero`);
  }
  return resolved;
}

function positiveFinite(value: number, path: string): number {
  const resolved = finite(value, path);
  if (resolved <= 0) {
    throw new RangeError(`${path} must be greater than zero`);
  }
  return resolved;
}

function nonNegativeInteger(value: number, path: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${path} must be a non-negative safe integer`);
  }
  return value;
}
