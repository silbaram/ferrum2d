import {
  bodyLocalToWorld2D,
  bodyWorldToLocal2D,
  equal,
  inverseTransformPoint2D,
  physicsColliderWorldCenter2D,
  physicsColliderWorldReferencePointCount,
  rotatePoint2D,
  test,
  transformPoint2D,
  writePhysicsColliderWorldReferencePoints,
} from "./publicApiTypes.shared.js";

import type {
  MutablePoint2D,
  MutablePointBuffer2D,
  PhysicsBodyTransform2D,
  PhysicsGeometryCollider2D,
  Point2D,
  PublicApi,
  Transform2DInput,
} from "./publicApiTypes.shared.js";

import {
  bodyLocalToWorld2D as coreBodyLocalToWorld2D,
  writePhysicsColliderWorldReferencePoints as coreWritePhysicsColliderWorldReferencePoints,
} from "../src/core.js";

import type {
  PhysicsBodyTransform2D as CorePhysicsBodyTransform2D,
  PhysicsGeometryCollider2D as CorePhysicsGeometryCollider2D,
} from "../src/core.js";

type CoreApi = typeof import("../src/core.js");

test("public API exposes allocation-aware 2D geometry transforms", () => {
  const publicRotate: PublicApi["rotatePoint2D"] = rotatePoint2D;
  const publicTransform: PublicApi["transformPoint2D"] = transformPoint2D;
  const publicInverseTransform: PublicApi["inverseTransformPoint2D"] = inverseTransformPoint2D;
  const publicBodyLocalToWorld: PublicApi["bodyLocalToWorld2D"] = bodyLocalToWorld2D;
  const publicBodyWorldToLocal: PublicApi["bodyWorldToLocal2D"] = bodyWorldToLocal2D;
  const publicColliderCenter: PublicApi["physicsColliderWorldCenter2D"] = physicsColliderWorldCenter2D;
  const publicColliderPointCount: PublicApi["physicsColliderWorldReferencePointCount"] =
    physicsColliderWorldReferencePointCount;
  const publicWriteColliderPoints: PublicApi["writePhysicsColliderWorldReferencePoints"] =
    writePhysicsColliderWorldReferencePoints;
  const stableCoreBodyLocalToWorld: CoreApi["bodyLocalToWorld2D"] = coreBodyLocalToWorld2D;
  const stableCoreWriteColliderPoints: CoreApi["writePhysicsColliderWorldReferencePoints"] =
    coreWritePhysicsColliderWorldReferencePoints;

  const point: Point2D = { x: 2, y: -3 };
  const transform: Transform2DInput = { x: 10, y: 20, rotationRadians: Math.PI * 0.5 };
  const body: PhysicsBodyTransform2D = transform;
  const stableCoreBody: CorePhysicsBodyTransform2D = body;
  const out: MutablePoint2D = { x: 0, y: 0 };
  const collider: PhysicsGeometryCollider2D = {
    shape: "aabb",
    halfWidth: 4,
    halfHeight: 6,
    offsetX: 3,
    offsetY: -2,
    trigger: false,
    enabled: true,
  };
  const pointBuffer: MutablePointBuffer2D = new Float32Array(8);
  const stableCoreCollider: CorePhysicsGeometryCollider2D = collider;

  equal(publicRotate(point, 0, out), out);
  equal(publicTransform(point, transform, out), out);
  equal(publicInverseTransform(out, transform, out), out);
  equal(publicBodyLocalToWorld(point, body, out), out);
  equal(publicBodyWorldToLocal(out, body, out), out);
  equal(publicColliderCenter(collider, body, out), out);
  equal(publicColliderPointCount(collider), 4);
  equal(publicWriteColliderPoints(collider, body, pointBuffer), 4);
  equal(stableCoreBodyLocalToWorld(point, stableCoreBody, out), out);
  equal(stableCoreWriteColliderPoints(stableCoreCollider, stableCoreBody, pointBuffer), 4);
});
