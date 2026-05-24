export const U32S_PER_PHYSICS_QUERY_HIT = 2;
export const BYTES_PER_PHYSICS_RAYCAST_HIT = 28;
export const BYTES_PER_PHYSICS_TILE_SHAPE_CAST_HIT = 28;
export const BYTES_PER_PHYSICS_TILE_CONTACT_HIT = 28;
export const BYTES_PER_PHYSICS_TILE_MANIFOLD_HIT = 48;
export const BYTES_PER_PHYSICS_BODY_CONTACT_HIT = 36;
export const BYTES_PER_PHYSICS_BODY_MANIFOLD_HIT = 56;
export const BYTES_PER_PHYSICS_RIGID_CONTACT_IMPULSE_HIT = 40;

export interface PhysicsQueryHitBufferView {
  buffer: Uint32Array;
  hitCount: number;
  u32sPerHit: number;
}

export interface PhysicsBodyQueryHit {
  entityId: number;
  entityGeneration: number;
}

export interface PhysicsRaycastHitBufferView {
  buffer: DataView;
  hitCount: number;
  bytesPerHit: number;
}

export interface PhysicsRaycastBodyHit {
  entityId: number;
  entityGeneration: number;
  distance: number;
  pointX: number;
  pointY: number;
  normalX: number;
  normalY: number;
}

export type PhysicsShapeCastHitBufferView = PhysicsRaycastHitBufferView;
export type PhysicsShapeCastBodyHit = PhysicsRaycastBodyHit;

export interface PhysicsTileShapeCastHitBufferView {
  buffer: DataView;
  hitCount: number;
  bytesPerHit: number;
}

export interface PhysicsTileShapeCastHit {
  layerIndex: number;
  tileIndex: number;
  distance: number;
  pointX: number;
  pointY: number;
  normalX: number;
  normalY: number;
}

export type PhysicsTileRaycastHitBufferView = PhysicsTileShapeCastHitBufferView;
export type PhysicsTileRaycastHit = PhysicsTileShapeCastHit;

export interface PhysicsTileContactHitBufferView {
  buffer: DataView;
  hitCount: number;
  bytesPerHit: number;
}

export interface PhysicsTileContactHit {
  layerIndex: number;
  tileIndex: number;
  normalX: number;
  normalY: number;
  penetration: number;
  pointX: number;
  pointY: number;
}

export interface PhysicsTileManifoldHitBufferView {
  buffer: DataView;
  hitCount: number;
  bytesPerHit: number;
}

export interface PhysicsTileManifoldPoint {
  pointX: number;
  pointY: number;
  penetration: number;
}

export interface PhysicsTileManifoldHit {
  layerIndex: number;
  tileIndex: number;
  pointCount: number;
  normalX: number;
  normalY: number;
  penetration: number;
  points: readonly PhysicsTileManifoldPoint[];
}

export interface PhysicsBodyContactHitBufferView {
  buffer: DataView;
  hitCount: number;
  bytesPerHit: number;
}

export interface PhysicsBodyContactHit {
  aEntityId: number;
  aEntityGeneration: number;
  bEntityId: number;
  bEntityGeneration: number;
  normalX: number;
  normalY: number;
  penetration: number;
  pointX: number;
  pointY: number;
}

export interface PhysicsBodyManifoldHitBufferView {
  buffer: DataView;
  hitCount: number;
  bytesPerHit: number;
}

export interface PhysicsBodyManifoldPoint {
  pointX: number;
  pointY: number;
  penetration: number;
}

export interface PhysicsBodyManifoldHit {
  aEntityId: number;
  aEntityGeneration: number;
  bEntityId: number;
  bEntityGeneration: number;
  pointCount: number;
  normalX: number;
  normalY: number;
  penetration: number;
  points: readonly PhysicsBodyManifoldPoint[];
}

export interface PhysicsRigidContactImpulseHitBufferView {
  buffer: DataView;
  hitCount: number;
  bytesPerHit: number;
}

export interface PhysicsRigidContactImpulseHit {
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
}

export const EMPTY_PHYSICS_QUERY_HITS: readonly PhysicsBodyQueryHit[] = Object.freeze([]);
export const EMPTY_PHYSICS_RAYCAST_HITS: readonly PhysicsRaycastBodyHit[] = Object.freeze([]);
export const EMPTY_PHYSICS_SHAPE_CAST_HITS = EMPTY_PHYSICS_RAYCAST_HITS;
export const EMPTY_PHYSICS_TILE_SHAPE_CAST_HITS: readonly PhysicsTileShapeCastHit[] =
  Object.freeze([]);
export const EMPTY_PHYSICS_TILE_RAYCAST_HITS = EMPTY_PHYSICS_TILE_SHAPE_CAST_HITS;
export const EMPTY_PHYSICS_TILE_CONTACT_HITS: readonly PhysicsTileContactHit[] = Object.freeze([]);
export const EMPTY_PHYSICS_TILE_MANIFOLD_HITS: readonly PhysicsTileManifoldHit[] =
  Object.freeze([]);
export const EMPTY_PHYSICS_BODY_CONTACT_HITS: readonly PhysicsBodyContactHit[] = Object.freeze([]);
export const EMPTY_PHYSICS_BODY_MANIFOLD_HITS: readonly PhysicsBodyManifoldHit[] =
  Object.freeze([]);
export const EMPTY_PHYSICS_RIGID_CONTACT_IMPULSE_HITS: readonly PhysicsRigidContactImpulseHit[] =
  Object.freeze([]);

export function decodePhysicsQueryHits(
  view: PhysicsQueryHitBufferView,
): readonly PhysicsBodyQueryHit[] {
  if (view.hitCount === 0) {
    return EMPTY_PHYSICS_QUERY_HITS;
  }

  const hits: PhysicsBodyQueryHit[] = [];
  for (let i = 0; i < view.hitCount; i += 1) {
    const offset = i * view.u32sPerHit;
    hits.push({
      entityId: view.buffer[offset],
      entityGeneration: view.buffer[offset + 1],
    });
  }
  return hits;
}

export function decodePhysicsRaycastHits(
  view: PhysicsRaycastHitBufferView,
): readonly PhysicsRaycastBodyHit[] {
  if (view.hitCount === 0) {
    return EMPTY_PHYSICS_RAYCAST_HITS;
  }

  const hits: PhysicsRaycastBodyHit[] = [];
  for (let i = 0; i < view.hitCount; i += 1) {
    const offset = i * view.bytesPerHit;
    hits.push({
      entityId: view.buffer.getUint32(offset, true),
      entityGeneration: view.buffer.getUint32(offset + 4, true),
      distance: view.buffer.getFloat32(offset + 8, true),
      pointX: view.buffer.getFloat32(offset + 12, true),
      pointY: view.buffer.getFloat32(offset + 16, true),
      normalX: view.buffer.getFloat32(offset + 20, true),
      normalY: view.buffer.getFloat32(offset + 24, true),
    });
  }
  return hits;
}

export function decodePhysicsShapeCastHits(
  view: PhysicsShapeCastHitBufferView,
): readonly PhysicsShapeCastBodyHit[] {
  return decodePhysicsRaycastHits(view);
}

export function decodePhysicsTileShapeCastHits(
  view: PhysicsTileShapeCastHitBufferView,
): readonly PhysicsTileShapeCastHit[] {
  if (view.hitCount === 0) {
    return EMPTY_PHYSICS_TILE_SHAPE_CAST_HITS;
  }

  const hits: PhysicsTileShapeCastHit[] = [];
  for (let i = 0; i < view.hitCount; i += 1) {
    const offset = i * view.bytesPerHit;
    hits.push({
      layerIndex: view.buffer.getUint32(offset, true),
      tileIndex: view.buffer.getUint32(offset + 4, true),
      distance: view.buffer.getFloat32(offset + 8, true),
      pointX: view.buffer.getFloat32(offset + 12, true),
      pointY: view.buffer.getFloat32(offset + 16, true),
      normalX: view.buffer.getFloat32(offset + 20, true),
      normalY: view.buffer.getFloat32(offset + 24, true),
    });
  }
  return hits;
}

export function decodePhysicsTileRaycastHits(
  view: PhysicsTileRaycastHitBufferView,
): readonly PhysicsTileRaycastHit[] {
  return decodePhysicsTileShapeCastHits(view);
}

export function decodePhysicsTileContactHits(
  view: PhysicsTileContactHitBufferView,
): readonly PhysicsTileContactHit[] {
  if (view.hitCount === 0) {
    return EMPTY_PHYSICS_TILE_CONTACT_HITS;
  }

  const hits: PhysicsTileContactHit[] = [];
  for (let i = 0; i < view.hitCount; i += 1) {
    const offset = i * view.bytesPerHit;
    hits.push({
      layerIndex: view.buffer.getUint32(offset, true),
      tileIndex: view.buffer.getUint32(offset + 4, true),
      normalX: view.buffer.getFloat32(offset + 8, true),
      normalY: view.buffer.getFloat32(offset + 12, true),
      penetration: view.buffer.getFloat32(offset + 16, true),
      pointX: view.buffer.getFloat32(offset + 20, true),
      pointY: view.buffer.getFloat32(offset + 24, true),
    });
  }
  return hits;
}

export function decodePhysicsTileManifoldHits(
  view: PhysicsTileManifoldHitBufferView,
): readonly PhysicsTileManifoldHit[] {
  if (view.hitCount === 0) {
    return EMPTY_PHYSICS_TILE_MANIFOLD_HITS;
  }

  const hits: PhysicsTileManifoldHit[] = [];
  for (let i = 0; i < view.hitCount; i += 1) {
    const offset = i * view.bytesPerHit;
    const pointCount = view.buffer.getUint32(offset + 8, true);
    const points: PhysicsTileManifoldPoint[] = [
      {
        pointX: view.buffer.getFloat32(offset + 24, true),
        pointY: view.buffer.getFloat32(offset + 28, true),
        penetration: view.buffer.getFloat32(offset + 32, true),
      },
      {
        pointX: view.buffer.getFloat32(offset + 36, true),
        pointY: view.buffer.getFloat32(offset + 40, true),
        penetration: view.buffer.getFloat32(offset + 44, true),
      },
    ].slice(0, Math.min(pointCount, 2));
    hits.push({
      layerIndex: view.buffer.getUint32(offset, true),
      tileIndex: view.buffer.getUint32(offset + 4, true),
      pointCount,
      normalX: view.buffer.getFloat32(offset + 12, true),
      normalY: view.buffer.getFloat32(offset + 16, true),
      penetration: view.buffer.getFloat32(offset + 20, true),
      points,
    });
  }
  return hits;
}

export function decodePhysicsBodyContactHits(
  view: PhysicsBodyContactHitBufferView,
): readonly PhysicsBodyContactHit[] {
  if (view.hitCount === 0) {
    return EMPTY_PHYSICS_BODY_CONTACT_HITS;
  }

  const hits: PhysicsBodyContactHit[] = [];
  for (let i = 0; i < view.hitCount; i += 1) {
    const offset = i * view.bytesPerHit;
    hits.push({
      aEntityId: view.buffer.getUint32(offset, true),
      aEntityGeneration: view.buffer.getUint32(offset + 4, true),
      bEntityId: view.buffer.getUint32(offset + 8, true),
      bEntityGeneration: view.buffer.getUint32(offset + 12, true),
      normalX: view.buffer.getFloat32(offset + 16, true),
      normalY: view.buffer.getFloat32(offset + 20, true),
      penetration: view.buffer.getFloat32(offset + 24, true),
      pointX: view.buffer.getFloat32(offset + 28, true),
      pointY: view.buffer.getFloat32(offset + 32, true),
    });
  }
  return hits;
}

export function decodePhysicsBodyManifoldHits(
  view: PhysicsBodyManifoldHitBufferView,
): readonly PhysicsBodyManifoldHit[] {
  if (view.hitCount === 0) {
    return EMPTY_PHYSICS_BODY_MANIFOLD_HITS;
  }

  const hits: PhysicsBodyManifoldHit[] = [];
  for (let i = 0; i < view.hitCount; i += 1) {
    const offset = i * view.bytesPerHit;
    const pointCount = view.buffer.getUint32(offset + 16, true);
    const points: PhysicsBodyManifoldPoint[] = [
      {
        pointX: view.buffer.getFloat32(offset + 32, true),
        pointY: view.buffer.getFloat32(offset + 36, true),
        penetration: view.buffer.getFloat32(offset + 40, true),
      },
      {
        pointX: view.buffer.getFloat32(offset + 44, true),
        pointY: view.buffer.getFloat32(offset + 48, true),
        penetration: view.buffer.getFloat32(offset + 52, true),
      },
    ].slice(0, Math.min(pointCount, 2));
    hits.push({
      aEntityId: view.buffer.getUint32(offset, true),
      aEntityGeneration: view.buffer.getUint32(offset + 4, true),
      bEntityId: view.buffer.getUint32(offset + 8, true),
      bEntityGeneration: view.buffer.getUint32(offset + 12, true),
      pointCount,
      normalX: view.buffer.getFloat32(offset + 20, true),
      normalY: view.buffer.getFloat32(offset + 24, true),
      penetration: view.buffer.getFloat32(offset + 28, true),
      points,
    });
  }
  return hits;
}

export function decodePhysicsRigidContactImpulseHits(
  view: PhysicsRigidContactImpulseHitBufferView,
): readonly PhysicsRigidContactImpulseHit[] {
  if (view.hitCount === 0) {
    return EMPTY_PHYSICS_RIGID_CONTACT_IMPULSE_HITS;
  }

  const hits: PhysicsRigidContactImpulseHit[] = [];
  for (let i = 0; i < view.hitCount; i += 1) {
    const offset = i * view.bytesPerHit;
    hits.push({
      aEntityId: view.buffer.getUint32(offset, true),
      aEntityGeneration: view.buffer.getUint32(offset + 4, true),
      bEntityId: view.buffer.getUint32(offset + 8, true),
      bEntityGeneration: view.buffer.getUint32(offset + 12, true),
      pointX: view.buffer.getFloat32(offset + 16, true),
      pointY: view.buffer.getFloat32(offset + 20, true),
      normalX: view.buffer.getFloat32(offset + 24, true),
      normalY: view.buffer.getFloat32(offset + 28, true),
      normalImpulse: view.buffer.getFloat32(offset + 32, true),
      tangentImpulse: view.buffer.getFloat32(offset + 36, true),
    });
  }
  return hits;
}
