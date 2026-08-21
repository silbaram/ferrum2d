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
  bodyWorldToLocal2D as coreBodyWorldToLocal2D,
  inverseTransformPoint2D as coreInverseTransformPoint2D,
  physicsColliderWorldCenter2D as corePhysicsColliderWorldCenter2D,
  physicsColliderWorldReferencePointCount as corePhysicsColliderWorldReferencePointCount,
  rotatePoint2D as coreRotatePoint2D,
  transformPoint2D as coreTransformPoint2D,
  writePhysicsColliderWorldReferencePoints as coreWritePhysicsColliderWorldReferencePoints,
} from "../src/core.js";

import type {
  MutablePoint2D as CoreMutablePoint2D,
  MutablePointBuffer2D as CoreMutablePointBuffer2D,
  PhysicsBodyTransform2D as CorePhysicsBodyTransform2D,
  PhysicsGeometryCollider2D as CorePhysicsGeometryCollider2D,
  Point2D as CorePoint2D,
  Transform2DInput as CoreTransform2DInput,
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
  const stableCoreBodyWorldToLocal: CoreApi["bodyWorldToLocal2D"] = coreBodyWorldToLocal2D;
  const stableCoreInverseTransform: CoreApi["inverseTransformPoint2D"] = coreInverseTransformPoint2D;
  const stableCoreColliderCenter: CoreApi["physicsColliderWorldCenter2D"] =
    corePhysicsColliderWorldCenter2D;
  const stableCoreColliderPointCount: CoreApi["physicsColliderWorldReferencePointCount"] =
    corePhysicsColliderWorldReferencePointCount;
  const stableCoreRotate: CoreApi["rotatePoint2D"] = coreRotatePoint2D;
  const stableCoreTransform: CoreApi["transformPoint2D"] = coreTransformPoint2D;
  const stableCoreWriteColliderPoints: CoreApi["writePhysicsColliderWorldReferencePoints"] =
    coreWritePhysicsColliderWorldReferencePoints;

  const point: Point2D = { x: 2, y: -3 };
  const transform: Transform2DInput = { x: 10, y: 20, rotationRadians: Math.PI * 0.5 };
  const stableCorePoint: CorePoint2D = point;
  const stableCoreTransformInput: CoreTransform2DInput = transform;
  const body: PhysicsBodyTransform2D = transform;
  const stableCoreBody: CorePhysicsBodyTransform2D = body;
  const out: MutablePoint2D = { x: 0, y: 0 };
  const stableCoreOut: CoreMutablePoint2D = out;
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
  const stableCorePointBuffer: CoreMutablePointBuffer2D = pointBuffer;
  const stableCoreCollider: CorePhysicsGeometryCollider2D = collider;

  equal(publicRotate(point, 0, out), out);
  equal(publicTransform(point, transform, out), out);
  equal(publicInverseTransform(out, transform, out), out);
  equal(publicBodyLocalToWorld(point, body, out), out);
  equal(publicBodyWorldToLocal(out, body, out), out);
  equal(publicColliderCenter(collider, body, out), out);
  equal(publicColliderPointCount(collider), 4);
  equal(publicWriteColliderPoints(collider, body, pointBuffer), 4);
  equal(stableCoreRotate(stableCorePoint, 0, stableCoreOut), out);
  equal(stableCoreTransform(stableCorePoint, stableCoreTransformInput, stableCoreOut), out);
  equal(stableCoreInverseTransform(stableCoreOut, stableCoreTransformInput, stableCoreOut), out);
  equal(stableCoreBodyLocalToWorld(stableCorePoint, stableCoreBody, stableCoreOut), out);
  equal(stableCoreBodyWorldToLocal(stableCoreOut, stableCoreBody, stableCoreOut), out);
  equal(stableCoreColliderCenter(stableCoreCollider, stableCoreBody, stableCoreOut), out);
  equal(stableCoreColliderPointCount(stableCoreCollider), 4);
  equal(stableCoreWriteColliderPoints(stableCoreCollider, stableCoreBody, stableCorePointBuffer), 4);
});
