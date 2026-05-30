import type { PhysicsDebugLineBufferView, PhysicsDebugLineView } from "../wasmBridge";
import type { ShooterTileKind, ShooterTileRampSpec } from "../gameSpecTypes.js";
import type { PhysicsBodyHeightSpan } from "./physicsBodies.js";
import type { PhysicsConvexPolygonVertexBuffer } from "./physicsGeometry.js";

export interface PhysicsBodyHeightSpanQuery {
  heightSpan?: PhysicsBodyHeightSpan;
}

export type PhysicsTileHeightSpanQuery = PhysicsBodyHeightSpanQuery;
export type PhysicsTileHeightSpan = PhysicsBodyHeightSpan;

export interface PhysicsNearestBodyQuery extends PhysicsBodyHeightSpanQuery {
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

export interface PhysicsNearestTileObstacleQuery extends PhysicsTileHeightSpanQuery {
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

export interface TilemapNavigationWaypointQuery extends PhysicsTileHeightSpanQuery {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  toHeightSpan?: PhysicsBodyHeightSpan;
}

export interface TilemapNavigationWaypoint {
  x: number;
  y: number;
  distance: number;
  heightSpan?: PhysicsBodyHeightSpan;
}

export type TilemapNavigationPathQuery = TilemapNavigationWaypointQuery;

export interface TilemapNavigationPathPoint {
  x: number;
  y: number;
  heightSpan?: PhysicsBodyHeightSpan;
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

export interface ShooterTileHd2dMetadata {
  kind?: ShooterTileKind;
  ramp?: ShooterTileRampSpec;
  bridgePortal?: ShooterTileBridgePortalMetadata;
  blocksMovement?: boolean;
  blocksProjectile?: boolean;
  blocksVision?: boolean;
  occluderHeight?: number;
}

export interface ShooterTileBridgePortalMetadata {
  lowerFloorId: number;
  upperFloorId: number;
  lowerElevation: number;
  upperElevation: number;
  navigationCost?: number;
}

export interface PhysicsBodyContactQuery {
  categoryABits?: number;
  categoryBBits?: number;
}

export type PhysicsBodyManifoldQuery = PhysicsBodyContactQuery;

export interface PhysicsPointBodyQuery extends PhysicsBodyHeightSpanQuery {
  x: number;
  y: number;
  queryMaskBits?: number;
}

export interface PhysicsAabbBodyQuery extends PhysicsBodyHeightSpanQuery {
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
  queryMaskBits?: number;
}

export interface PhysicsCircleBodyQuery extends PhysicsBodyHeightSpanQuery {
  x: number;
  y: number;
  radius: number;
  queryMaskBits?: number;
}

export interface PhysicsOrientedBoxBodyQuery extends PhysicsBodyHeightSpanQuery {
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
  rotationRadians: number;
  queryMaskBits?: number;
}

export interface PhysicsCapsuleBodyQuery extends PhysicsBodyHeightSpanQuery {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  radius: number;
  queryMaskBits?: number;
}

export interface PhysicsConvexPolygonBodyQuery extends PhysicsBodyHeightSpanQuery {
  vertices: PhysicsConvexPolygonVertexBuffer;
  queryMaskBits?: number;
}

export interface PhysicsRaycastBodyQuery extends PhysicsBodyHeightSpanQuery {
  originX: number;
  originY: number;
  directionX: number;
  directionY: number;
  maxDistance: number;
  queryMaskBits?: number;
}

export interface PhysicsSegmentCastBodyQuery extends PhysicsBodyHeightSpanQuery {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  queryMaskBits?: number;
}

export interface PhysicsRaycastTileObstacleQuery extends PhysicsTileHeightSpanQuery {
  originX: number;
  originY: number;
  directionX: number;
  directionY: number;
  maxDistance: number;
}

export interface PhysicsSegmentCastTileObstacleQuery extends PhysicsTileHeightSpanQuery {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export interface PhysicsShapeCastMotionQuery extends PhysicsBodyHeightSpanQuery {
  directionX: number;
  directionY: number;
  maxDistance: number;
  queryMaskBits?: number;
}

export interface PhysicsTileShapeCastMotionQuery extends PhysicsTileHeightSpanQuery {
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

export interface PhysicsAabbTileObstacleContactQuery extends PhysicsTileHeightSpanQuery {
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
}

export interface PhysicsAabbTileObstacleManifoldQuery extends PhysicsTileHeightSpanQuery {
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
