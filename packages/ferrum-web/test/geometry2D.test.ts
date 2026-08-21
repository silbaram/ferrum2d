import { equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import {
  bodyLocalToWorld2D,
  bodyWorldToLocal2D,
  inverseTransformPoint2D,
  physicsColliderWorldCenter2D,
  physicsColliderWorldReferencePointCount,
  rotatePoint2D,
  transformPoint2D,
  writePhysicsColliderWorldReferencePoints,
  type MutablePoint2D,
  type PhysicsBodyTransform2D,
  type PhysicsGeometryCollider2D,
  type Transform2DInput,
} from "../src/geometry2D.js";

const EPSILON = 1e-5;
const QUARTER_TURN = Math.PI * 0.5;
const BODY: PhysicsBodyTransform2D = Object.freeze({
  x: 10,
  y: 20,
  rotationRadians: QUARTER_TURN,
});
const COLLIDER_BASE = Object.freeze({
  offsetX: 3,
  offsetY: -2,
  trigger: false,
  enabled: true,
});

test("point transforms use scale, clockwise visual rotation in y-down world, and reusable outputs", () => {
  const out: MutablePoint2D = { x: 0, y: 0 };
  equal(rotatePoint2D({ x: 2, y: -3 }, QUARTER_TURN, out), out);
  assertPoint(out, 3, 2);

  const transform: Transform2DInput = {
    x: 10,
    y: 20,
    rotationRadians: QUARTER_TURN,
    scaleX: 2,
    scaleY: 0.5,
  };
  equal(transformPoint2D({ x: 2, y: -3 }, transform, out), out);
  assertPoint(out, 11.5, 24);
  equal(inverseTransformPoint2D(out, transform, out), out);
  assertPoint(out, 2, -3);
});

test("body local/world transforms match the canonical Rust oriented-box basis", () => {
  const world = bodyLocalToWorld2D({ x: 2, y: -3 }, BODY);
  assertPoint(world, 13, 22);
  assertPoint(bodyWorldToLocal2D(world, BODY), 2, -3);
});

test("collider reference points match Rust collider query and debug geometry", () => {
  const cases: readonly {
    collider: PhysicsGeometryCollider2D;
    expectedCenter: readonly [number, number];
    expectedPoints: readonly number[];
  }[] = [
    {
      collider: {
        ...COLLIDER_BASE,
        shape: "aabb",
        halfWidth: 4,
        halfHeight: 6,
      },
      expectedCenter: [13, 18],
      expectedPoints: [9, 12, 17, 12, 17, 24, 9, 24],
    },
    {
      collider: {
        ...COLLIDER_BASE,
        shape: "box",
        halfWidth: 4,
        halfHeight: 6,
      },
      expectedCenter: [13, 18],
      expectedPoints: [9, 12, 17, 12, 17, 24, 9, 24],
    },
    {
      collider: {
        ...COLLIDER_BASE,
        shape: "circle",
        radius: 5,
      },
      expectedCenter: [13, 18],
      expectedPoints: [13, 18],
    },
    {
      collider: {
        ...COLLIDER_BASE,
        shape: "capsule",
        startX: -4,
        startY: 0,
        endX: 4,
        endY: 0,
        radius: 2,
      },
      expectedCenter: [13, 18],
      expectedPoints: [9, 18, 17, 18],
    },
    {
      collider: {
        ...COLLIDER_BASE,
        shape: "orientedBox",
        halfWidth: 4,
        halfHeight: 6,
        rotationRadians: QUARTER_TURN,
      },
      expectedCenter: [13, 18],
      expectedPoints: [17, 24, 9, 24, 9, 12, 17, 12],
    },
    {
      collider: {
        ...COLLIDER_BASE,
        shape: "convexPolygon",
        vertices: [
          { x: -2, y: -1 },
          { x: 3, y: -1 },
          { x: 0, y: 4 },
        ],
        rotationRadians: QUARTER_TURN,
      },
      expectedCenter: [12 + 2 / 3, 17 + 1 / 3],
      expectedPoints: [15, 19, 10, 19, 13, 14],
    },
  ];

  const target = new Float64Array(16);
  for (const entry of cases) {
    const center = physicsColliderWorldCenter2D(entry.collider, BODY);
    assertPoint(center, entry.expectedCenter[0], entry.expectedCenter[1]);
    const pointCount = physicsColliderWorldReferencePointCount(entry.collider);
    equal(pointCount, entry.expectedPoints.length / 2);
    target.fill(Number.NaN);
    equal(writePhysicsColliderWorldReferencePoints(entry.collider, BODY, target), pointCount);
    assertNumbers(target.subarray(0, pointCount * 2), entry.expectedPoints);
  }
});

test("collider point writer validates inverse scales, geometry, and target capacity", () => {
  throws(
    () => inverseTransformPoint2D(
      { x: 1, y: 2 },
      { x: 0, y: 0, rotationRadians: 0, scaleX: 0 },
    ),
    /transform\.scaleX must not be zero/,
  );
  const circle: PhysicsGeometryCollider2D = { ...COLLIDER_BASE, shape: "circle", radius: 4 };
  throws(
    () => writePhysicsColliderWorldReferencePoints(circle, BODY, new Float32Array(1)),
    /target length/,
  );

  const offsetTarget = new Float64Array(6).fill(-1);
  equal(writePhysicsColliderWorldReferencePoints(circle, BODY, offsetTarget, 4), 1);
  assertNumbers(offsetTarget, [-1, -1, -1, -1, 13, 18]);
  throws(
    () => writePhysicsColliderWorldReferencePoints(circle, BODY, offsetTarget, -1),
    /floatOffset must be a non-negative safe integer/,
  );

  const tooSmallPolygon: PhysicsGeometryCollider2D = {
    ...COLLIDER_BASE,
    shape: "convexPolygon",
    vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    rotationRadians: 0,
  };
  throws(
    () => physicsColliderWorldReferencePointCount(tooSmallPolygon),
    /collider\.vertices must contain between 3 and 16 points/,
  );
});

test("collider geometry ignores or normalizes invalid body rotation like Rust", () => {
  const bodyWithUnusedRotation: PhysicsBodyTransform2D = {
    x: BODY.x,
    y: BODY.y,
    rotationRadians: Number.NaN,
  };
  const target = new Float64Array(8);
  const aabb: PhysicsGeometryCollider2D = {
    ...COLLIDER_BASE,
    shape: "aabb",
    halfWidth: 4,
    halfHeight: 6,
  };
  const circle: PhysicsGeometryCollider2D = {
    ...COLLIDER_BASE,
    shape: "circle",
    radius: 5,
  };
  const capsule: PhysicsGeometryCollider2D = {
    ...COLLIDER_BASE,
    shape: "capsule",
    startX: -4,
    startY: 0,
    endX: 4,
    endY: 0,
    radius: 2,
  };
  const orientedBox: PhysicsGeometryCollider2D = {
    ...COLLIDER_BASE,
    shape: "orientedBox",
    halfWidth: 4,
    halfHeight: 6,
    rotationRadians: 0,
  };
  const convexPolygon: PhysicsGeometryCollider2D = {
    ...COLLIDER_BASE,
    shape: "convexPolygon",
    vertices: [
      { x: -2, y: -1 },
      { x: 3, y: -1 },
      { x: 0, y: 4 },
    ],
    rotationRadians: 0,
  };

  equal(writePhysicsColliderWorldReferencePoints(aabb, bodyWithUnusedRotation, target), 4);
  equal(writePhysicsColliderWorldReferencePoints(circle, bodyWithUnusedRotation, target), 1);
  equal(writePhysicsColliderWorldReferencePoints(capsule, bodyWithUnusedRotation, target), 2);
  assertPoint(physicsColliderWorldCenter2D(capsule, bodyWithUnusedRotation), 13, 18);
  equal(writePhysicsColliderWorldReferencePoints(orientedBox, bodyWithUnusedRotation, target), 4);
  assertNumbers(target, [9, 12, 17, 12, 17, 24, 9, 24]);
  assertPoint(physicsColliderWorldCenter2D(orientedBox, bodyWithUnusedRotation), 13, 18);
  equal(writePhysicsColliderWorldReferencePoints(convexPolygon, bodyWithUnusedRotation, target), 3);
  assertNumbers(target.subarray(0, 6), [11, 17, 16, 17, 13, 22]);
  assertPoint(
    physicsColliderWorldCenter2D(convexPolygon, bodyWithUnusedRotation),
    13 + 1 / 3,
    18 + 2 / 3,
  );
  throws(
    () => writePhysicsColliderWorldReferencePoints(
      { ...orientedBox, rotationRadians: Number.MAX_VALUE },
      { ...BODY, rotationRadians: Number.MAX_VALUE },
      target,
    ),
    /body\.rotationRadians \+ collider\.rotationRadians must be finite/,
  );
});

test("point transforms round-trip non-uniform and reflected scales", () => {
  const rotations = [-Math.PI, -0.75, 0, 0.5, Math.PI];
  const scales = [-2, -0.5, 0.25, 3];
  const source = Object.freeze({ x: 7.25, y: -4.5 });
  const scratch: MutablePoint2D = { x: 0, y: 0 };

  for (const rotationRadians of rotations) {
    for (const scaleX of scales) {
      for (const scaleY of scales) {
        const transform: Transform2DInput = {
          x: 11,
          y: -9,
          rotationRadians,
          scaleX,
          scaleY,
        };
        transformPoint2D(source, transform, scratch);
        inverseTransformPoint2D(scratch, transform, scratch);
        assertPoint(scratch, source.x, source.y);
      }
    }
  }
});

function assertPoint(actual: { x: number; y: number }, x: number, y: number): void {
  ok(Math.abs(actual.x - x) <= EPSILON, `expected x=${x}, received ${actual.x}`);
  ok(Math.abs(actual.y - y) <= EPSILON, `expected y=${y}, received ${actual.y}`);
}

function assertNumbers(actual: ArrayLike<number>, expected: readonly number[]): void {
  equal(actual.length, expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    ok(
      Math.abs(actual[index] - expected[index]) <= EPSILON,
      `expected value[${index}]=${expected[index]}, received ${actual[index]}`,
    );
  }
}
