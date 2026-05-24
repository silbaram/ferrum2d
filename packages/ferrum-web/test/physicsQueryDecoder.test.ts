import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  BYTES_PER_PHYSICS_BODY_CONTACT_HIT,
  BYTES_PER_PHYSICS_BODY_MANIFOLD_HIT,
  BYTES_PER_PHYSICS_RAYCAST_HIT,
  BYTES_PER_PHYSICS_RIGID_CONTACT_IMPULSE_HIT,
  BYTES_PER_PHYSICS_TILE_CONTACT_HIT,
  BYTES_PER_PHYSICS_TILE_MANIFOLD_HIT,
  BYTES_PER_PHYSICS_TILE_SHAPE_CAST_HIT,
  decodePhysicsBodyContactHits,
  decodePhysicsBodyManifoldHits,
  decodePhysicsQueryHits,
  decodePhysicsRaycastHits,
  decodePhysicsRigidContactImpulseHits,
  decodePhysicsShapeCastHits,
  decodePhysicsTileContactHits,
  decodePhysicsTileManifoldHits,
  decodePhysicsTileRaycastHits,
  decodePhysicsTileShapeCastHits,
  EMPTY_PHYSICS_BODY_CONTACT_HITS,
  EMPTY_PHYSICS_BODY_MANIFOLD_HITS,
  EMPTY_PHYSICS_QUERY_HITS,
  EMPTY_PHYSICS_RAYCAST_HITS,
  EMPTY_PHYSICS_RIGID_CONTACT_IMPULSE_HITS,
  EMPTY_PHYSICS_SHAPE_CAST_HITS,
  EMPTY_PHYSICS_TILE_CONTACT_HITS,
  EMPTY_PHYSICS_TILE_MANIFOLD_HITS,
  EMPTY_PHYSICS_TILE_RAYCAST_HITS,
  EMPTY_PHYSICS_TILE_SHAPE_CAST_HITS,
} from "../src/physicsQueryDecoder.js";

test("decodePhysicsQueryHits parses entity id and generation pairs", () => {
  const hits = decodePhysicsQueryHits({
    buffer: new Uint32Array([7, 1, 11, 2]),
    hitCount: 2,
    u32sPerHit: 2,
  });

  deepEqual(hits, [
    { entityId: 7, entityGeneration: 1 },
    { entityId: 11, entityGeneration: 2 },
  ]);
});

test("decodePhysicsQueryHits reuses empty query hit array", () => {
  const hits = decodePhysicsQueryHits({
    buffer: new Uint32Array(),
    hitCount: 0,
    u32sPerHit: 2,
  });

  equal(hits, EMPTY_PHYSICS_QUERY_HITS);
});

test("decodePhysicsRaycastHits parses mixed entity and surface fields", () => {
  const buffer = new ArrayBuffer(BYTES_PER_PHYSICS_RAYCAST_HIT * 2);
  const dataView = new DataView(buffer);
  writeRaycastHit(dataView, 0, {
    entityId: 7,
    entityGeneration: 1,
    distance: 12.5,
    pointX: 4,
    pointY: 5,
    normalX: -1,
    normalY: 0,
  });
  writeRaycastHit(dataView, BYTES_PER_PHYSICS_RAYCAST_HIT, {
    entityId: 11,
    entityGeneration: 2,
    distance: 20,
    pointX: 8,
    pointY: 9,
    normalX: 0,
    normalY: 1,
  });

  const hits = decodePhysicsRaycastHits({
    buffer: dataView,
    hitCount: 2,
    bytesPerHit: BYTES_PER_PHYSICS_RAYCAST_HIT,
  });

  deepEqual(hits, [
    {
      entityId: 7,
      entityGeneration: 1,
      distance: 12.5,
      pointX: 4,
      pointY: 5,
      normalX: -1,
      normalY: 0,
    },
    {
      entityId: 11,
      entityGeneration: 2,
      distance: 20,
      pointX: 8,
      pointY: 9,
      normalX: 0,
      normalY: 1,
    },
  ]);
});

test("decodePhysicsRaycastHits reuses empty raycast hit array", () => {
  const hits = decodePhysicsRaycastHits({
    buffer: new DataView(new ArrayBuffer(0)),
    hitCount: 0,
    bytesPerHit: BYTES_PER_PHYSICS_RAYCAST_HIT,
  });

  equal(hits, EMPTY_PHYSICS_RAYCAST_HITS);
});

test("decodePhysicsShapeCastHits reuses raycast hit ABI", () => {
  const buffer = new ArrayBuffer(BYTES_PER_PHYSICS_RAYCAST_HIT);
  const dataView = new DataView(buffer);
  writeRaycastHit(dataView, 0, {
    entityId: 17,
    entityGeneration: 3,
    distance: 6,
    pointX: 1,
    pointY: 2,
    normalX: 0,
    normalY: -1,
  });

  const hits = decodePhysicsShapeCastHits({
    buffer: dataView,
    hitCount: 1,
    bytesPerHit: BYTES_PER_PHYSICS_RAYCAST_HIT,
  });

  deepEqual(hits, [
    {
      entityId: 17,
      entityGeneration: 3,
      distance: 6,
      pointX: 1,
      pointY: 2,
      normalX: 0,
      normalY: -1,
    },
  ]);
});

test("decodePhysicsShapeCastHits reuses empty shape-cast hit array", () => {
  const hits = decodePhysicsShapeCastHits({
    buffer: new DataView(new ArrayBuffer(0)),
    hitCount: 0,
    bytesPerHit: BYTES_PER_PHYSICS_RAYCAST_HIT,
  });

  equal(hits, EMPTY_PHYSICS_SHAPE_CAST_HITS);
});

test("decodePhysicsTileShapeCastHits parses mixed tile and surface fields", () => {
  const buffer = new ArrayBuffer(BYTES_PER_PHYSICS_TILE_SHAPE_CAST_HIT * 2);
  const dataView = new DataView(buffer);
  writeTileShapeCastHit(dataView, 0, {
    layerIndex: 2,
    tileIndex: 7,
    distance: 9,
    pointX: 9,
    pointY: 5,
    normalX: -1,
    normalY: 0,
  });
  writeTileShapeCastHit(dataView, BYTES_PER_PHYSICS_TILE_SHAPE_CAST_HIT, {
    layerIndex: 3,
    tileIndex: 11,
    distance: 12.5,
    pointX: 4,
    pointY: 8,
    normalX: 0,
    normalY: -1,
  });

  const hits = decodePhysicsTileShapeCastHits({
    buffer: dataView,
    hitCount: 2,
    bytesPerHit: BYTES_PER_PHYSICS_TILE_SHAPE_CAST_HIT,
  });

  deepEqual(hits, [
    {
      layerIndex: 2,
      tileIndex: 7,
      distance: 9,
      pointX: 9,
      pointY: 5,
      normalX: -1,
      normalY: 0,
    },
    {
      layerIndex: 3,
      tileIndex: 11,
      distance: 12.5,
      pointX: 4,
      pointY: 8,
      normalX: 0,
      normalY: -1,
    },
  ]);
});

test("decodePhysicsTileShapeCastHits reuses empty tile shape-cast hit array", () => {
  const hits = decodePhysicsTileShapeCastHits({
    buffer: new DataView(new ArrayBuffer(0)),
    hitCount: 0,
    bytesPerHit: BYTES_PER_PHYSICS_TILE_SHAPE_CAST_HIT,
  });

  equal(hits, EMPTY_PHYSICS_TILE_SHAPE_CAST_HITS);
});

test("decodePhysicsTileRaycastHits reuses tile shape-cast ABI", () => {
  const buffer = new ArrayBuffer(BYTES_PER_PHYSICS_TILE_SHAPE_CAST_HIT);
  const dataView = new DataView(buffer);
  writeTileShapeCastHit(dataView, 0, {
    layerIndex: 2,
    tileIndex: 7,
    distance: 9,
    pointX: 9,
    pointY: 5,
    normalX: -1,
    normalY: 0,
  });

  const hits = decodePhysicsTileRaycastHits({
    buffer: dataView,
    hitCount: 1,
    bytesPerHit: BYTES_PER_PHYSICS_TILE_SHAPE_CAST_HIT,
  });

  deepEqual(hits, [
    {
      layerIndex: 2,
      tileIndex: 7,
      distance: 9,
      pointX: 9,
      pointY: 5,
      normalX: -1,
      normalY: 0,
    },
  ]);
});

test("decodePhysicsTileRaycastHits reuses empty tile raycast hit array", () => {
  const hits = decodePhysicsTileRaycastHits({
    buffer: new DataView(new ArrayBuffer(0)),
    hitCount: 0,
    bytesPerHit: BYTES_PER_PHYSICS_TILE_SHAPE_CAST_HIT,
  });

  equal(hits, EMPTY_PHYSICS_TILE_RAYCAST_HITS);
});

test("decodePhysicsTileContactHits parses mixed tile contact fields", () => {
  const buffer = new ArrayBuffer(BYTES_PER_PHYSICS_TILE_CONTACT_HIT * 2);
  const dataView = new DataView(buffer);
  writeTileContactHit(dataView, 0, {
    layerIndex: 2,
    tileIndex: 7,
    normalX: -1,
    normalY: 0,
    penetration: 1.5,
    pointX: 10,
    pointY: 5,
  });
  writeTileContactHit(dataView, BYTES_PER_PHYSICS_TILE_CONTACT_HIT, {
    layerIndex: 3,
    tileIndex: 11,
    normalX: 0,
    normalY: -1,
    penetration: 2.25,
    pointX: 4,
    pointY: 8,
  });

  const hits = decodePhysicsTileContactHits({
    buffer: dataView,
    hitCount: 2,
    bytesPerHit: BYTES_PER_PHYSICS_TILE_CONTACT_HIT,
  });

  deepEqual(hits, [
    {
      layerIndex: 2,
      tileIndex: 7,
      normalX: -1,
      normalY: 0,
      penetration: 1.5,
      pointX: 10,
      pointY: 5,
    },
    {
      layerIndex: 3,
      tileIndex: 11,
      normalX: 0,
      normalY: -1,
      penetration: 2.25,
      pointX: 4,
      pointY: 8,
    },
  ]);
});

test("decodePhysicsTileContactHits reuses empty tile contact hit array", () => {
  const hits = decodePhysicsTileContactHits({
    buffer: new DataView(new ArrayBuffer(0)),
    hitCount: 0,
    bytesPerHit: BYTES_PER_PHYSICS_TILE_CONTACT_HIT,
  });

  equal(hits, EMPTY_PHYSICS_TILE_CONTACT_HITS);
});

test("decodePhysicsTileManifoldHits parses up to two tile contact points", () => {
  const buffer = new ArrayBuffer(BYTES_PER_PHYSICS_TILE_MANIFOLD_HIT);
  const dataView = new DataView(buffer);
  writeTileManifoldHit(dataView, 0, {
    layerIndex: 2,
    tileIndex: 7,
    pointCount: 2,
    normalX: -1,
    normalY: 0,
    penetration: 1.5,
    points: [
      { pointX: 10, pointY: 3, penetration: 1.5 },
      { pointX: 10, pointY: 7, penetration: 1.5 },
    ],
  });

  const hits = decodePhysicsTileManifoldHits({
    buffer: dataView,
    hitCount: 1,
    bytesPerHit: BYTES_PER_PHYSICS_TILE_MANIFOLD_HIT,
  });

  deepEqual(hits, [
    {
      layerIndex: 2,
      tileIndex: 7,
      pointCount: 2,
      normalX: -1,
      normalY: 0,
      penetration: 1.5,
      points: [
        { pointX: 10, pointY: 3, penetration: 1.5 },
        { pointX: 10, pointY: 7, penetration: 1.5 },
      ],
    },
  ]);
});

test("decodePhysicsTileManifoldHits reuses empty tile manifold hit array", () => {
  const hits = decodePhysicsTileManifoldHits({
    buffer: new DataView(new ArrayBuffer(0)),
    hitCount: 0,
    bytesPerHit: BYTES_PER_PHYSICS_TILE_MANIFOLD_HIT,
  });

  equal(hits, EMPTY_PHYSICS_TILE_MANIFOLD_HITS);
});

test("decodePhysicsBodyContactHits parses mixed contact fields", () => {
  const buffer = new ArrayBuffer(BYTES_PER_PHYSICS_BODY_CONTACT_HIT);
  const dataView = new DataView(buffer);
  writeBodyContactHit(dataView, 0, {
    aEntityId: 2,
    aEntityGeneration: 0,
    bEntityId: 7,
    bEntityGeneration: 1,
    normalX: 1,
    normalY: 0,
    penetration: 3.5,
    pointX: 12,
    pointY: 4,
  });

  const hits = decodePhysicsBodyContactHits({
    buffer: dataView,
    hitCount: 1,
    bytesPerHit: BYTES_PER_PHYSICS_BODY_CONTACT_HIT,
  });

  deepEqual(hits, [
    {
      aEntityId: 2,
      aEntityGeneration: 0,
      bEntityId: 7,
      bEntityGeneration: 1,
      normalX: 1,
      normalY: 0,
      penetration: 3.5,
      pointX: 12,
      pointY: 4,
    },
  ]);
});

test("decodePhysicsBodyContactHits reuses empty contact hit array", () => {
  const hits = decodePhysicsBodyContactHits({
    buffer: new DataView(new ArrayBuffer(0)),
    hitCount: 0,
    bytesPerHit: BYTES_PER_PHYSICS_BODY_CONTACT_HIT,
  });

  equal(hits, EMPTY_PHYSICS_BODY_CONTACT_HITS);
});

test("decodePhysicsBodyManifoldHits parses up to two contact points", () => {
  const buffer = new ArrayBuffer(BYTES_PER_PHYSICS_BODY_MANIFOLD_HIT);
  const dataView = new DataView(buffer);
  writeBodyManifoldHit(dataView, 0, {
    aEntityId: 2,
    aEntityGeneration: 0,
    bEntityId: 7,
    bEntityGeneration: 1,
    pointCount: 2,
    normalX: -1,
    normalY: 0,
    penetration: 4,
    points: [
      { pointX: 8, pointY: 1, penetration: 4 },
      { pointX: 8, pointY: 5, penetration: 4 },
    ],
  });

  const hits = decodePhysicsBodyManifoldHits({
    buffer: dataView,
    hitCount: 1,
    bytesPerHit: BYTES_PER_PHYSICS_BODY_MANIFOLD_HIT,
  });

  deepEqual(hits, [
    {
      aEntityId: 2,
      aEntityGeneration: 0,
      bEntityId: 7,
      bEntityGeneration: 1,
      pointCount: 2,
      normalX: -1,
      normalY: 0,
      penetration: 4,
      points: [
        { pointX: 8, pointY: 1, penetration: 4 },
        { pointX: 8, pointY: 5, penetration: 4 },
      ],
    },
  ]);
});

test("decodePhysicsBodyManifoldHits reuses empty manifold hit array", () => {
  const hits = decodePhysicsBodyManifoldHits({
    buffer: new DataView(new ArrayBuffer(0)),
    hitCount: 0,
    bytesPerHit: BYTES_PER_PHYSICS_BODY_MANIFOLD_HIT,
  });

  equal(hits, EMPTY_PHYSICS_BODY_MANIFOLD_HITS);
});

test("decodePhysicsRigidContactImpulseHits parses post-solve impulse fields", () => {
  const buffer = new ArrayBuffer(BYTES_PER_PHYSICS_RIGID_CONTACT_IMPULSE_HIT);
  const dataView = new DataView(buffer);
  writeRigidContactImpulseHit(dataView, 0, {
    aEntityId: 2,
    aEntityGeneration: 0,
    bEntityId: 7,
    bEntityGeneration: 1,
    pointX: 8,
    pointY: 5,
    normalX: -1,
    normalY: 0,
    normalImpulse: 3.5,
    tangentImpulse: -0.25,
  });

  const hits = decodePhysicsRigidContactImpulseHits({
    buffer: dataView,
    hitCount: 1,
    bytesPerHit: BYTES_PER_PHYSICS_RIGID_CONTACT_IMPULSE_HIT,
  });

  deepEqual(hits, [
    {
      aEntityId: 2,
      aEntityGeneration: 0,
      bEntityId: 7,
      bEntityGeneration: 1,
      pointX: 8,
      pointY: 5,
      normalX: -1,
      normalY: 0,
      normalImpulse: 3.5,
      tangentImpulse: -0.25,
    },
  ]);
});

test("decodePhysicsRigidContactImpulseHits reuses empty impulse hit array", () => {
  const hits = decodePhysicsRigidContactImpulseHits({
    buffer: new DataView(new ArrayBuffer(0)),
    hitCount: 0,
    bytesPerHit: BYTES_PER_PHYSICS_RIGID_CONTACT_IMPULSE_HIT,
  });

  equal(hits, EMPTY_PHYSICS_RIGID_CONTACT_IMPULSE_HITS);
});

function writeRaycastHit(
  buffer: DataView,
  offset: number,
  hit: {
    entityId: number;
    entityGeneration: number;
    distance: number;
    pointX: number;
    pointY: number;
    normalX: number;
    normalY: number;
  },
): void {
  buffer.setUint32(offset, hit.entityId, true);
  buffer.setUint32(offset + 4, hit.entityGeneration, true);
  buffer.setFloat32(offset + 8, hit.distance, true);
  buffer.setFloat32(offset + 12, hit.pointX, true);
  buffer.setFloat32(offset + 16, hit.pointY, true);
  buffer.setFloat32(offset + 20, hit.normalX, true);
  buffer.setFloat32(offset + 24, hit.normalY, true);
}

function writeTileShapeCastHit(
  buffer: DataView,
  offset: number,
  hit: {
    layerIndex: number;
    tileIndex: number;
    distance: number;
    pointX: number;
    pointY: number;
    normalX: number;
    normalY: number;
  },
): void {
  buffer.setUint32(offset, hit.layerIndex, true);
  buffer.setUint32(offset + 4, hit.tileIndex, true);
  buffer.setFloat32(offset + 8, hit.distance, true);
  buffer.setFloat32(offset + 12, hit.pointX, true);
  buffer.setFloat32(offset + 16, hit.pointY, true);
  buffer.setFloat32(offset + 20, hit.normalX, true);
  buffer.setFloat32(offset + 24, hit.normalY, true);
}

function writeTileContactHit(
  buffer: DataView,
  offset: number,
  hit: {
    layerIndex: number;
    tileIndex: number;
    normalX: number;
    normalY: number;
    penetration: number;
    pointX: number;
    pointY: number;
  },
): void {
  buffer.setUint32(offset, hit.layerIndex, true);
  buffer.setUint32(offset + 4, hit.tileIndex, true);
  buffer.setFloat32(offset + 8, hit.normalX, true);
  buffer.setFloat32(offset + 12, hit.normalY, true);
  buffer.setFloat32(offset + 16, hit.penetration, true);
  buffer.setFloat32(offset + 20, hit.pointX, true);
  buffer.setFloat32(offset + 24, hit.pointY, true);
}

function writeTileManifoldHit(
  buffer: DataView,
  offset: number,
  hit: {
    layerIndex: number;
    tileIndex: number;
    pointCount: number;
    normalX: number;
    normalY: number;
    penetration: number;
    points: [{ pointX: number; pointY: number; penetration: number }, { pointX: number; pointY: number; penetration: number }];
  },
): void {
  buffer.setUint32(offset, hit.layerIndex, true);
  buffer.setUint32(offset + 4, hit.tileIndex, true);
  buffer.setUint32(offset + 8, hit.pointCount, true);
  buffer.setFloat32(offset + 12, hit.normalX, true);
  buffer.setFloat32(offset + 16, hit.normalY, true);
  buffer.setFloat32(offset + 20, hit.penetration, true);
  buffer.setFloat32(offset + 24, hit.points[0].pointX, true);
  buffer.setFloat32(offset + 28, hit.points[0].pointY, true);
  buffer.setFloat32(offset + 32, hit.points[0].penetration, true);
  buffer.setFloat32(offset + 36, hit.points[1].pointX, true);
  buffer.setFloat32(offset + 40, hit.points[1].pointY, true);
  buffer.setFloat32(offset + 44, hit.points[1].penetration, true);
}

function writeBodyContactHit(
  buffer: DataView,
  offset: number,
  hit: {
    aEntityId: number;
    aEntityGeneration: number;
    bEntityId: number;
    bEntityGeneration: number;
    normalX: number;
    normalY: number;
    penetration: number;
    pointX: number;
    pointY: number;
  },
): void {
  buffer.setUint32(offset, hit.aEntityId, true);
  buffer.setUint32(offset + 4, hit.aEntityGeneration, true);
  buffer.setUint32(offset + 8, hit.bEntityId, true);
  buffer.setUint32(offset + 12, hit.bEntityGeneration, true);
  buffer.setFloat32(offset + 16, hit.normalX, true);
  buffer.setFloat32(offset + 20, hit.normalY, true);
  buffer.setFloat32(offset + 24, hit.penetration, true);
  buffer.setFloat32(offset + 28, hit.pointX, true);
  buffer.setFloat32(offset + 32, hit.pointY, true);
}

function writeBodyManifoldHit(
  buffer: DataView,
  offset: number,
  hit: {
    aEntityId: number;
    aEntityGeneration: number;
    bEntityId: number;
    bEntityGeneration: number;
    pointCount: number;
    normalX: number;
    normalY: number;
    penetration: number;
    points: [{ pointX: number; pointY: number; penetration: number }, { pointX: number; pointY: number; penetration: number }];
  },
): void {
  buffer.setUint32(offset, hit.aEntityId, true);
  buffer.setUint32(offset + 4, hit.aEntityGeneration, true);
  buffer.setUint32(offset + 8, hit.bEntityId, true);
  buffer.setUint32(offset + 12, hit.bEntityGeneration, true);
  buffer.setUint32(offset + 16, hit.pointCount, true);
  buffer.setFloat32(offset + 20, hit.normalX, true);
  buffer.setFloat32(offset + 24, hit.normalY, true);
  buffer.setFloat32(offset + 28, hit.penetration, true);
  buffer.setFloat32(offset + 32, hit.points[0].pointX, true);
  buffer.setFloat32(offset + 36, hit.points[0].pointY, true);
  buffer.setFloat32(offset + 40, hit.points[0].penetration, true);
  buffer.setFloat32(offset + 44, hit.points[1].pointX, true);
  buffer.setFloat32(offset + 48, hit.points[1].pointY, true);
  buffer.setFloat32(offset + 52, hit.points[1].penetration, true);
}

function writeRigidContactImpulseHit(
  buffer: DataView,
  offset: number,
  hit: {
    aEntityId: number;
    aEntityGeneration: number;
    bEntityId: number;
    bEntityGeneration: number;
    pointX: number;
    pointY: number;
    normalX: number;
    normalY: number;
    normalImpulse: number;
    tangentImpulse: number;
  },
): void {
  buffer.setUint32(offset, hit.aEntityId, true);
  buffer.setUint32(offset + 4, hit.aEntityGeneration, true);
  buffer.setUint32(offset + 8, hit.bEntityId, true);
  buffer.setUint32(offset + 12, hit.bEntityGeneration, true);
  buffer.setFloat32(offset + 16, hit.pointX, true);
  buffer.setFloat32(offset + 20, hit.pointY, true);
  buffer.setFloat32(offset + 24, hit.normalX, true);
  buffer.setFloat32(offset + 28, hit.normalY, true);
  buffer.setFloat32(offset + 32, hit.normalImpulse, true);
  buffer.setFloat32(offset + 36, hit.tangentImpulse, true);
}
