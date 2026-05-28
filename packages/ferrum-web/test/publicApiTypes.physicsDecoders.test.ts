import {
  decodeCollisionEvents,
  decodePhysicsBodyContactHits,
  decodePhysicsBodyManifoldHits,
  decodePhysicsDebugLines,
  decodePhysicsQueryHits,
  decodePhysicsRaycastHits,
  decodePhysicsRigidContactImpulseHits,
  decodePhysicsShapeCastHits,
  decodePhysicsTileContactHits,
  decodePhysicsTileManifoldHits,
  decodePhysicsTileRaycastHits,
  decodePhysicsTileShapeCastHits,
  equal,
  f32Bits,
  test,
} from "./publicApiTypes.shared.js";

import type {
  CollisionEventBufferView,
  CollisionEventView,
  PhysicsAabbTileObstacleContactQuery,
  PhysicsAabbTileObstacleManifoldQuery,
  PhysicsAabbTileObstacleShapeCastQuery,
  PhysicsBodyContactHit,
  PhysicsBodyContactHitBufferView,
  PhysicsBodyManifoldHit,
  PhysicsBodyManifoldHitBufferView,
  PhysicsBodyQueryHit,
  PhysicsDebugLineBufferView,
  PhysicsDebugLineView,
  PhysicsQueryHitBufferView,
  PhysicsRaycastBodyHit,
  PhysicsRaycastHitBufferView,
  PhysicsRaycastTileObstacleQuery,
  PhysicsRigidContactImpulseHit,
  PhysicsRigidContactImpulseHitBufferView,
  PhysicsSegmentCastTileObstacleQuery,
  PhysicsShapeCastBodyHit,
  PhysicsShapeCastHitBufferView,
  PhysicsTileContactHit,
  PhysicsTileContactHitBufferView,
  PhysicsTileManifoldHit,
  PhysicsTileManifoldHitBufferView,
  PhysicsTileRaycastHit,
  PhysicsTileRaycastHitBufferView,
  PhysicsTileShapeCastHit,
  PhysicsTileShapeCastHitBufferView,
  PhysicsTileShapeCastMotionQuery,
  PublicApi,
} from "./publicApiTypes.shared.js";

test("public API physics decoder buffer types", () => {
  const bodyContactHit: PhysicsBodyContactHit = {
    aEntityId: 1,
    aEntityGeneration: 0,
    bEntityId: 2,
    bEntityGeneration: 0,
    normalX: 1,
    normalY: 0,
    penetration: 2,
    pointX: 12,
    pointY: 0,
  };
  const bodyManifoldHit: PhysicsBodyManifoldHit = {
    aEntityId: 1,
    aEntityGeneration: 0,
    bEntityId: 2,
    bEntityGeneration: 0,
    pointCount: 2,
    normalX: 1,
    normalY: 0,
    penetration: 2,
    points: [
      { pointX: 12, pointY: -4, penetration: 2 },
      { pointX: 12, pointY: 4, penetration: 2 },
    ],
  };
  const rigidContactImpulseHit: PhysicsRigidContactImpulseHit = {
    aEntityId: 1,
    aEntityGeneration: 0,
    bEntityId: 2,
    bEntityGeneration: 0,
    pointX: 12,
    pointY: 0,
    normalX: 1,
    normalY: 0,
    normalImpulse: 3,
    tangentImpulse: -0.5,
  };
  const raycastTileObstacleQuery: PhysicsRaycastTileObstacleQuery = {
    originX: 0,
    originY: 5,
    directionX: 1,
    directionY: 0,
    maxDistance: 64,
  };
  const segmentCastTileObstacleQuery: PhysicsSegmentCastTileObstacleQuery = {
    startX: 0,
    startY: 5,
    endX: 10,
    endY: 5,
  };
  const raycastBodyHit: PhysicsRaycastBodyHit = {
    entityId: 2,
    entityGeneration: 0,
    distance: 12,
    pointX: 12,
    pointY: 0,
    normalX: -1,
    normalY: 0,
  };
  const shapeCastBodyHit: PhysicsShapeCastBodyHit = raycastBodyHit;
  const tileShapeCastMotionQuery: PhysicsTileShapeCastMotionQuery = {
    directionX: 1,
    directionY: 0,
    maxDistance: 64,
  };
  const aabbTileShapeCastQuery: PhysicsAabbTileObstacleShapeCastQuery = {
    x: 0,
    y: 0,
    halfWidth: 2,
    halfHeight: 2,
    ...tileShapeCastMotionQuery,
  };
  const aabbTileContactQuery: PhysicsAabbTileObstacleContactQuery = {
    x: 9,
    y: 5,
    halfWidth: 2,
    halfHeight: 2,
  };
  const aabbTileManifoldQuery: PhysicsAabbTileObstacleManifoldQuery = {
    x: 9,
    y: 5,
    halfWidth: 2,
    halfHeight: 2,
  };
  const tileShapeCastHit: PhysicsTileShapeCastHit = {
    layerIndex: 2,
    tileIndex: 1,
    distance: 9,
    pointX: 9,
    pointY: 0,
    normalX: -1,
    normalY: 0,
  };
  const tileContactHit: PhysicsTileContactHit = {
    layerIndex: 2,
    tileIndex: 1,
    normalX: -1,
    normalY: 0,
    penetration: 1,
    pointX: 11,
    pointY: 5,
  };
  const tileManifoldHit: PhysicsTileManifoldHit = {
    layerIndex: 2,
    tileIndex: 1,
    pointCount: 2,
    normalX: -1,
    normalY: 0,
    penetration: 1,
    points: [
      { pointX: 11, pointY: 3, penetration: 1 },
      { pointX: 11, pointY: 7, penetration: 1 },
    ],
  };
  const collisionEventBuffer: CollisionEventBufferView = {
    buffer: new Uint32Array([4, 0, 0, 1, 0, f32Bits(2)]),
    eventCount: 1,
    u32sPerEvent: 6,
  };
  const publicDecodeCollisionEvents: PublicApi["decodeCollisionEvents"] = decodeCollisionEvents;
  const collisionEvent: CollisionEventView = publicDecodeCollisionEvents(collisionEventBuffer)[0];
  const physicsDebugLineBuffer: PhysicsDebugLineBufferView = {
    buffer: new Float32Array([0, 0, 16, 0, 1, 0.2, 0.1, 1]),
    lineCount: 1,
    floatsPerLine: 8,
  };
  const publicDecodePhysicsDebugLines: PublicApi["decodePhysicsDebugLines"] = decodePhysicsDebugLines;
  const physicsDebugLine: PhysicsDebugLineView = publicDecodePhysicsDebugLines(physicsDebugLineBuffer)[0];
  const physicsQueryHitBuffer: PhysicsQueryHitBufferView = {
    buffer: new Uint32Array([2, 0]),
    hitCount: 1,
    u32sPerHit: 2,
  };
  const publicDecodePhysicsQueryHits: PublicApi["decodePhysicsQueryHits"] = decodePhysicsQueryHits;
  const physicsQueryHit: PhysicsBodyQueryHit = publicDecodePhysicsQueryHits(physicsQueryHitBuffer)[0];
  const physicsBodyContactBufferBytes = 36;
  const physicsBodyContactHitBuffer: PhysicsBodyContactHitBufferView = {
    buffer: new DataView(new ArrayBuffer(physicsBodyContactBufferBytes)),
    hitCount: 1,
    bytesPerHit: physicsBodyContactBufferBytes,
  };
  physicsBodyContactHitBuffer.buffer.setUint32(0, bodyContactHit.aEntityId, true);
  physicsBodyContactHitBuffer.buffer.setUint32(4, bodyContactHit.aEntityGeneration, true);
  physicsBodyContactHitBuffer.buffer.setUint32(8, bodyContactHit.bEntityId, true);
  physicsBodyContactHitBuffer.buffer.setUint32(12, bodyContactHit.bEntityGeneration, true);
  physicsBodyContactHitBuffer.buffer.setFloat32(16, bodyContactHit.normalX, true);
  physicsBodyContactHitBuffer.buffer.setFloat32(20, bodyContactHit.normalY, true);
  physicsBodyContactHitBuffer.buffer.setFloat32(24, bodyContactHit.penetration, true);
  physicsBodyContactHitBuffer.buffer.setFloat32(28, bodyContactHit.pointX, true);
  physicsBodyContactHitBuffer.buffer.setFloat32(32, bodyContactHit.pointY, true);
  const publicDecodePhysicsBodyContactHits: PublicApi["decodePhysicsBodyContactHits"] =
    decodePhysicsBodyContactHits;
  const physicsBodyContactHit: PhysicsBodyContactHit =
    publicDecodePhysicsBodyContactHits(physicsBodyContactHitBuffer)[0];
  const physicsBodyManifoldBufferBytes = 56;
  const physicsBodyManifoldHitBuffer: PhysicsBodyManifoldHitBufferView = {
    buffer: new DataView(new ArrayBuffer(physicsBodyManifoldBufferBytes)),
    hitCount: 1,
    bytesPerHit: physicsBodyManifoldBufferBytes,
  };
  physicsBodyManifoldHitBuffer.buffer.setUint32(0, bodyManifoldHit.aEntityId, true);
  physicsBodyManifoldHitBuffer.buffer.setUint32(4, bodyManifoldHit.aEntityGeneration, true);
  physicsBodyManifoldHitBuffer.buffer.setUint32(8, bodyManifoldHit.bEntityId, true);
  physicsBodyManifoldHitBuffer.buffer.setUint32(12, bodyManifoldHit.bEntityGeneration, true);
  physicsBodyManifoldHitBuffer.buffer.setUint32(16, bodyManifoldHit.pointCount, true);
  physicsBodyManifoldHitBuffer.buffer.setFloat32(20, bodyManifoldHit.normalX, true);
  physicsBodyManifoldHitBuffer.buffer.setFloat32(24, bodyManifoldHit.normalY, true);
  physicsBodyManifoldHitBuffer.buffer.setFloat32(28, bodyManifoldHit.penetration, true);
  physicsBodyManifoldHitBuffer.buffer.setFloat32(32, bodyManifoldHit.points[0]?.pointX ?? 0, true);
  physicsBodyManifoldHitBuffer.buffer.setFloat32(36, bodyManifoldHit.points[0]?.pointY ?? 0, true);
  physicsBodyManifoldHitBuffer.buffer.setFloat32(
    40,
    bodyManifoldHit.points[0]?.penetration ?? 0,
    true,
  );
  physicsBodyManifoldHitBuffer.buffer.setFloat32(44, bodyManifoldHit.points[1]?.pointX ?? 0, true);
  physicsBodyManifoldHitBuffer.buffer.setFloat32(48, bodyManifoldHit.points[1]?.pointY ?? 0, true);
  physicsBodyManifoldHitBuffer.buffer.setFloat32(
    52,
    bodyManifoldHit.points[1]?.penetration ?? 0,
    true,
  );
  const publicDecodePhysicsBodyManifoldHits: PublicApi["decodePhysicsBodyManifoldHits"] =
    decodePhysicsBodyManifoldHits;
  const physicsBodyManifoldHit: PhysicsBodyManifoldHit =
    publicDecodePhysicsBodyManifoldHits(physicsBodyManifoldHitBuffer)[0];
  const physicsRigidContactImpulseBufferBytes = 40;
  const physicsRigidContactImpulseHitBuffer: PhysicsRigidContactImpulseHitBufferView = {
    buffer: new DataView(new ArrayBuffer(physicsRigidContactImpulseBufferBytes)),
    hitCount: 1,
    bytesPerHit: physicsRigidContactImpulseBufferBytes,
  };
  physicsRigidContactImpulseHitBuffer.buffer.setUint32(0, rigidContactImpulseHit.aEntityId, true);
  physicsRigidContactImpulseHitBuffer.buffer.setUint32(
    4,
    rigidContactImpulseHit.aEntityGeneration,
    true,
  );
  physicsRigidContactImpulseHitBuffer.buffer.setUint32(8, rigidContactImpulseHit.bEntityId, true);
  physicsRigidContactImpulseHitBuffer.buffer.setUint32(
    12,
    rigidContactImpulseHit.bEntityGeneration,
    true,
  );
  physicsRigidContactImpulseHitBuffer.buffer.setFloat32(16, rigidContactImpulseHit.pointX, true);
  physicsRigidContactImpulseHitBuffer.buffer.setFloat32(20, rigidContactImpulseHit.pointY, true);
  physicsRigidContactImpulseHitBuffer.buffer.setFloat32(24, rigidContactImpulseHit.normalX, true);
  physicsRigidContactImpulseHitBuffer.buffer.setFloat32(28, rigidContactImpulseHit.normalY, true);
  physicsRigidContactImpulseHitBuffer.buffer.setFloat32(
    32,
    rigidContactImpulseHit.normalImpulse,
    true,
  );
  physicsRigidContactImpulseHitBuffer.buffer.setFloat32(
    36,
    rigidContactImpulseHit.tangentImpulse,
    true,
  );
  const publicDecodePhysicsRigidContactImpulseHits: PublicApi["decodePhysicsRigidContactImpulseHits"] =
    decodePhysicsRigidContactImpulseHits;
  const physicsRigidContactImpulseHit: PhysicsRigidContactImpulseHit =
    publicDecodePhysicsRigidContactImpulseHits(physicsRigidContactImpulseHitBuffer)[0];
  const physicsRaycastBufferBytes = 28;
  const physicsRaycastHitBuffer: PhysicsRaycastHitBufferView = {
    buffer: new DataView(new ArrayBuffer(physicsRaycastBufferBytes)),
    hitCount: 1,
    bytesPerHit: physicsRaycastBufferBytes,
  };
  physicsRaycastHitBuffer.buffer.setUint32(0, raycastBodyHit.entityId, true);
  physicsRaycastHitBuffer.buffer.setUint32(4, raycastBodyHit.entityGeneration, true);
  physicsRaycastHitBuffer.buffer.setFloat32(8, raycastBodyHit.distance, true);
  physicsRaycastHitBuffer.buffer.setFloat32(12, raycastBodyHit.pointX, true);
  physicsRaycastHitBuffer.buffer.setFloat32(16, raycastBodyHit.pointY, true);
  physicsRaycastHitBuffer.buffer.setFloat32(20, raycastBodyHit.normalX, true);
  physicsRaycastHitBuffer.buffer.setFloat32(24, raycastBodyHit.normalY, true);
  const publicDecodePhysicsRaycastHits: PublicApi["decodePhysicsRaycastHits"] =
    decodePhysicsRaycastHits;
  const physicsRaycastHit: PhysicsRaycastBodyHit =
    publicDecodePhysicsRaycastHits(physicsRaycastHitBuffer)[0];
  const physicsShapeCastHitBuffer: PhysicsShapeCastHitBufferView = physicsRaycastHitBuffer;
  const publicDecodePhysicsShapeCastHits: PublicApi["decodePhysicsShapeCastHits"] =
    decodePhysicsShapeCastHits;
  const physicsShapeCastHit: PhysicsShapeCastBodyHit =
    publicDecodePhysicsShapeCastHits(physicsShapeCastHitBuffer)[0];
  const physicsTileShapeCastHitBuffer: PhysicsTileShapeCastHitBufferView = {
    buffer: new DataView(new ArrayBuffer(physicsRaycastBufferBytes)),
    hitCount: 1,
    bytesPerHit: physicsRaycastBufferBytes,
  };
  physicsTileShapeCastHitBuffer.buffer.setUint32(0, tileShapeCastHit.layerIndex, true);
  physicsTileShapeCastHitBuffer.buffer.setUint32(4, tileShapeCastHit.tileIndex, true);
  physicsTileShapeCastHitBuffer.buffer.setFloat32(8, tileShapeCastHit.distance, true);
  physicsTileShapeCastHitBuffer.buffer.setFloat32(12, tileShapeCastHit.pointX, true);
  physicsTileShapeCastHitBuffer.buffer.setFloat32(16, tileShapeCastHit.pointY, true);
  physicsTileShapeCastHitBuffer.buffer.setFloat32(20, tileShapeCastHit.normalX, true);
  physicsTileShapeCastHitBuffer.buffer.setFloat32(24, tileShapeCastHit.normalY, true);
  const publicDecodePhysicsTileShapeCastHits: PublicApi["decodePhysicsTileShapeCastHits"] =
    decodePhysicsTileShapeCastHits;
  const physicsTileShapeCastHit: PhysicsTileShapeCastHit =
    publicDecodePhysicsTileShapeCastHits(physicsTileShapeCastHitBuffer)[0];
  const physicsTileRaycastHitBuffer: PhysicsTileRaycastHitBufferView =
    physicsTileShapeCastHitBuffer;
  const publicDecodePhysicsTileRaycastHits: PublicApi["decodePhysicsTileRaycastHits"] =
    decodePhysicsTileRaycastHits;
  const physicsTileRaycastHit: PhysicsTileRaycastHit =
    publicDecodePhysicsTileRaycastHits(physicsTileRaycastHitBuffer)[0];
  const physicsTileContactHitBuffer: PhysicsTileContactHitBufferView = {
    buffer: new DataView(new ArrayBuffer(physicsRaycastBufferBytes)),
    hitCount: 1,
    bytesPerHit: physicsRaycastBufferBytes,
  };
  physicsTileContactHitBuffer.buffer.setUint32(0, tileContactHit.layerIndex, true);
  physicsTileContactHitBuffer.buffer.setUint32(4, tileContactHit.tileIndex, true);
  physicsTileContactHitBuffer.buffer.setFloat32(8, tileContactHit.normalX, true);
  physicsTileContactHitBuffer.buffer.setFloat32(12, tileContactHit.normalY, true);
  physicsTileContactHitBuffer.buffer.setFloat32(16, tileContactHit.penetration, true);
  physicsTileContactHitBuffer.buffer.setFloat32(20, tileContactHit.pointX, true);
  physicsTileContactHitBuffer.buffer.setFloat32(24, tileContactHit.pointY, true);
  const publicDecodePhysicsTileContactHits: PublicApi["decodePhysicsTileContactHits"] =
    decodePhysicsTileContactHits;
  const physicsTileContactHit: PhysicsTileContactHit =
    publicDecodePhysicsTileContactHits(physicsTileContactHitBuffer)[0];
  const physicsTileManifoldBufferBytes = 48;
  const physicsTileManifoldHitBuffer: PhysicsTileManifoldHitBufferView = {
    buffer: new DataView(new ArrayBuffer(physicsTileManifoldBufferBytes)),
    hitCount: 1,
    bytesPerHit: physicsTileManifoldBufferBytes,
  };
  physicsTileManifoldHitBuffer.buffer.setUint32(0, tileManifoldHit.layerIndex, true);
  physicsTileManifoldHitBuffer.buffer.setUint32(4, tileManifoldHit.tileIndex, true);
  physicsTileManifoldHitBuffer.buffer.setUint32(8, tileManifoldHit.pointCount, true);
  physicsTileManifoldHitBuffer.buffer.setFloat32(12, tileManifoldHit.normalX, true);
  physicsTileManifoldHitBuffer.buffer.setFloat32(16, tileManifoldHit.normalY, true);
  physicsTileManifoldHitBuffer.buffer.setFloat32(20, tileManifoldHit.penetration, true);
  physicsTileManifoldHitBuffer.buffer.setFloat32(24, tileManifoldHit.points[0]?.pointX ?? 0, true);
  physicsTileManifoldHitBuffer.buffer.setFloat32(28, tileManifoldHit.points[0]?.pointY ?? 0, true);
  physicsTileManifoldHitBuffer.buffer.setFloat32(
    32,
    tileManifoldHit.points[0]?.penetration ?? 0,
    true,
  );
  physicsTileManifoldHitBuffer.buffer.setFloat32(36, tileManifoldHit.points[1]?.pointX ?? 0, true);
  physicsTileManifoldHitBuffer.buffer.setFloat32(40, tileManifoldHit.points[1]?.pointY ?? 0, true);
  physicsTileManifoldHitBuffer.buffer.setFloat32(
    44,
    tileManifoldHit.points[1]?.penetration ?? 0,
    true,
  );
  const publicDecodePhysicsTileManifoldHits: PublicApi["decodePhysicsTileManifoldHits"] =
    decodePhysicsTileManifoldHits;
  const physicsTileManifoldHit: PhysicsTileManifoldHit =
    publicDecodePhysicsTileManifoldHits(physicsTileManifoldHitBuffer)[0];
  equal(collisionEvent.kind, "hit");
  equal(collisionEvent.damage, 2);
  equal(physicsRigidContactImpulseHit.tangentImpulse, -0.5);
  equal(physicsDebugLine.x1, 16);
  equal(physicsQueryHit.entityId, 2);
  equal(physicsBodyContactHit.pointX, 12);
  equal(physicsBodyManifoldHit.points[1]?.pointY, 4);
  equal(physicsRaycastHit.normalX, -1);
  equal(physicsShapeCastHit.distance, 12);
  equal(physicsTileShapeCastHit.layerIndex, 2);
  equal(physicsTileRaycastHit.normalX, -1);
  equal(physicsTileContactHit.pointX, 11);
  equal(physicsTileManifoldHit.points[1]?.pointY, 7);
});
