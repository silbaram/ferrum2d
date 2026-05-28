import type { PhysicsDebugLineBufferView, PhysicsDebugLineView } from "../wasmBridge";
import type { PhysicsConvexPolygonVertexBuffer } from "./physicsGeometry.js";

export interface PhysicsNearestBodyQuery {
  x: number;
  y: number;
  maxDistance: number;
  queryMaskBits?: number;
}

export interface PhysicsNearestBodyHit {
  entityId: number;
  entityGeneration: number;
  pointX: number;
  pointY: number;
  distance: number;
}

export interface PhysicsNearestTileObstacleQuery {
  x: number;
  y: number;
  maxDistance: number;
}

export interface PhysicsNearestTileObstacleHit {
  layerIndex: number;
  tileIndex: number;
  pointX: number;
  pointY: number;
  distance: number;
}

export interface TilemapNavigationWaypointQuery {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export interface TilemapNavigationWaypoint {
  x: number;
  y: number;
  distance: number;
}

export type TilemapNavigationPathQuery = TilemapNavigationWaypointQuery;

export interface TilemapNavigationPathPoint {
  x: number;
  y: number;
}

export interface TilemapNavigationPath {
  pointBuffer: Float32Array;
  pointCount: number;
  points: readonly TilemapNavigationPathPoint[];
  distance: number;
  debugLineBuffer: PhysicsDebugLineBufferView;
  debugLines: readonly PhysicsDebugLineView[];
}

export interface TilemapRectEditOptions {
  maxCollisionRebuildChunks?: number;
}

export interface PhysicsBodyContactQuery {
  categoryABits?: number;
  categoryBBits?: number;
}

export type PhysicsBodyManifoldQuery = PhysicsBodyContactQuery;

export interface PhysicsPointBodyQuery {
  x: number;
  y: number;
  queryMaskBits?: number;
}

export interface PhysicsAabbBodyQuery {
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
  queryMaskBits?: number;
}

export interface PhysicsCircleBodyQuery {
  x: number;
  y: number;
  radius: number;
  queryMaskBits?: number;
}

export interface PhysicsOrientedBoxBodyQuery {
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
  rotationRadians: number;
  queryMaskBits?: number;
}

export interface PhysicsCapsuleBodyQuery {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  radius: number;
  queryMaskBits?: number;
}

export interface PhysicsConvexPolygonBodyQuery {
  vertices: PhysicsConvexPolygonVertexBuffer;
  queryMaskBits?: number;
}

export interface PhysicsRaycastBodyQuery {
  originX: number;
  originY: number;
  directionX: number;
  directionY: number;
  maxDistance: number;
  queryMaskBits?: number;
}

export interface PhysicsSegmentCastBodyQuery {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  queryMaskBits?: number;
}

export interface PhysicsRaycastTileObstacleQuery {
  originX: number;
  originY: number;
  directionX: number;
  directionY: number;
  maxDistance: number;
}

export interface PhysicsSegmentCastTileObstacleQuery {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export interface PhysicsShapeCastMotionQuery {
  directionX: number;
  directionY: number;
  maxDistance: number;
  queryMaskBits?: number;
}

export interface PhysicsTileShapeCastMotionQuery {
  directionX: number;
  directionY: number;
  maxDistance: number;
}

export interface PhysicsAabbBodyShapeCastQuery extends PhysicsShapeCastMotionQuery {
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
}

export interface PhysicsAabbTileObstacleShapeCastQuery extends PhysicsTileShapeCastMotionQuery {
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
}

export interface PhysicsAabbTileObstacleContactQuery {
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
}

export interface PhysicsAabbTileObstacleManifoldQuery {
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
}

export interface PhysicsCircleBodyShapeCastQuery extends PhysicsShapeCastMotionQuery {
  x: number;
  y: number;
  radius: number;
}

export interface PhysicsOrientedBoxBodyShapeCastQuery extends PhysicsShapeCastMotionQuery {
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
  rotationRadians: number;
}

export interface PhysicsCapsuleBodyShapeCastQuery extends PhysicsShapeCastMotionQuery {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  radius: number;
}

export interface PhysicsConvexPolygonBodyShapeCastQuery extends PhysicsShapeCastMotionQuery {
  vertices: PhysicsConvexPolygonVertexBuffer;
}
