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
