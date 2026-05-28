import type { Engine } from "../pkg/ferrum_core";
import type { FerrumPhysicsQueryApi } from "./engineTypes.js";
import { physicsMaskBits, physicsVertexBuffer } from "./physicsWasmInputs.js";
import type { WasmBridge } from "./wasmBridge";

export interface PhysicsQueryApiContext {
  rustEngine: Engine;
  bridge: WasmBridge;
  requireAlive(): void;
}

export function createPhysicsQueryApi({
  rustEngine,
  bridge,
  requireAlive,
}: PhysicsQueryApiContext): FerrumPhysicsQueryApi {
  return {
    queryNearestBody(query) {
      requireAlive();
      const hit = rustEngine.query_nearest_body(
        query.x,
        query.y,
        query.maxDistance,
        physicsMaskBits(query.queryMaskBits),
      );
      if (!hit) {
        return undefined;
      }
      return {
        entityId: rustEngine.physics_query_entity_id(),
        entityGeneration: rustEngine.physics_query_entity_generation(),
        pointX: rustEngine.physics_query_point_x(),
        pointY: rustEngine.physics_query_point_y(),
        distance: rustEngine.physics_query_distance(),
      };
    },

    queryNearestTileObstacle(query) {
      requireAlive();
      const hit = rustEngine.query_nearest_tile_obstacle(query.x, query.y, query.maxDistance);
      if (!hit) {
        return undefined;
      }
      return {
        layerIndex: rustEngine.physics_query_tile_layer_index(),
        tileIndex: rustEngine.physics_query_tile_index(),
        pointX: rustEngine.physics_query_point_x(),
        pointY: rustEngine.physics_query_point_y(),
        distance: rustEngine.physics_query_distance(),
      };
    },

    queryBodyContacts(query = {}) {
      requireAlive();
      rustEngine.query_body_contacts(
        physicsMaskBits(query.categoryABits),
        physicsMaskBits(query.categoryBBits),
      );
      return bridge.readPhysicsBodyContactHits();
    },

    queryBodyManifolds(query = {}) {
      requireAlive();
      rustEngine.query_body_manifolds(
        physicsMaskBits(query.categoryABits),
        physicsMaskBits(query.categoryBBits),
      );
      return bridge.readPhysicsBodyManifoldHits();
    },

    queryRigidContactImpulses() {
      requireAlive();
      rustEngine.query_rigid_contact_impulses();
      return bridge.readPhysicsRigidContactImpulseHits();
    },

    queryPointBodies(query) {
      requireAlive();
      rustEngine.query_point_bodies(query.x, query.y, physicsMaskBits(query.queryMaskBits));
      return bridge.readPhysicsQueryHits();
    },

    queryAabbBodies(query) {
      requireAlive();
      rustEngine.query_aabb_bodies(
        query.x,
        query.y,
        query.halfWidth,
        query.halfHeight,
        physicsMaskBits(query.queryMaskBits),
      );
      return bridge.readPhysicsQueryHits();
    },

    queryCircleBodies(query) {
      requireAlive();
      rustEngine.query_circle_bodies(
        query.x,
        query.y,
        query.radius,
        physicsMaskBits(query.queryMaskBits),
      );
      return bridge.readPhysicsQueryHits();
    },

    queryOrientedBoxBodies(query) {
      requireAlive();
      rustEngine.query_oriented_box_bodies(
        query.x,
        query.y,
        query.halfWidth,
        query.halfHeight,
        query.rotationRadians,
        physicsMaskBits(query.queryMaskBits),
      );
      return bridge.readPhysicsQueryHits();
    },

    queryCapsuleBodies(query) {
      requireAlive();
      rustEngine.query_capsule_bodies(
        query.startX,
        query.startY,
        query.endX,
        query.endY,
        query.radius,
        physicsMaskBits(query.queryMaskBits),
      );
      return bridge.readPhysicsQueryHits();
    },

    queryConvexPolygonBodies(query) {
      requireAlive();
      rustEngine.query_convex_polygon_bodies(
        physicsVertexBuffer(query.vertices),
        physicsMaskBits(query.queryMaskBits),
      );
      return bridge.readPhysicsQueryHits();
    },

    raycastBodies(query) {
      requireAlive();
      rustEngine.raycast_bodies(
        query.originX,
        query.originY,
        query.directionX,
        query.directionY,
        query.maxDistance,
        physicsMaskBits(query.queryMaskBits),
      );
      return bridge.readPhysicsRaycastHits();
    },

    segmentCastBodies(query) {
      requireAlive();
      rustEngine.segment_cast_bodies(
        query.startX,
        query.startY,
        query.endX,
        query.endY,
        physicsMaskBits(query.queryMaskBits),
      );
      return bridge.readPhysicsRaycastHits();
    },

    raycastTileObstacles(query) {
      requireAlive();
      rustEngine.raycast_tile_obstacles(
        query.originX,
        query.originY,
        query.directionX,
        query.directionY,
        query.maxDistance,
      );
      return bridge.readPhysicsTileRaycastHits();
    },

    segmentCastTileObstacles(query) {
      requireAlive();
      rustEngine.segment_cast_tile_obstacles(
        query.startX,
        query.startY,
        query.endX,
        query.endY,
      );
      return bridge.readPhysicsTileRaycastHits();
    },

    shapeCastAabbBodies(query) {
      requireAlive();
      rustEngine.shape_cast_aabb_bodies(
        query.x,
        query.y,
        query.halfWidth,
        query.halfHeight,
        query.directionX,
        query.directionY,
        query.maxDistance,
        physicsMaskBits(query.queryMaskBits),
      );
      return bridge.readPhysicsShapeCastHits();
    },

    shapeCastCircleBodies(query) {
      requireAlive();
      rustEngine.shape_cast_circle_bodies(
        query.x,
        query.y,
        query.radius,
        query.directionX,
        query.directionY,
        query.maxDistance,
        physicsMaskBits(query.queryMaskBits),
      );
      return bridge.readPhysicsShapeCastHits();
    },

    shapeCastOrientedBoxBodies(query) {
      requireAlive();
      rustEngine.shape_cast_oriented_box_bodies(
        query.x,
        query.y,
        query.halfWidth,
        query.halfHeight,
        query.rotationRadians,
        query.directionX,
        query.directionY,
        query.maxDistance,
        physicsMaskBits(query.queryMaskBits),
      );
      return bridge.readPhysicsShapeCastHits();
    },

    shapeCastCapsuleBodies(query) {
      requireAlive();
      rustEngine.shape_cast_capsule_bodies(
        query.startX,
        query.startY,
        query.endX,
        query.endY,
        query.radius,
        query.directionX,
        query.directionY,
        query.maxDistance,
        physicsMaskBits(query.queryMaskBits),
      );
      return bridge.readPhysicsShapeCastHits();
    },

    shapeCastConvexPolygonBodies(query) {
      requireAlive();
      rustEngine.shape_cast_convex_polygon_bodies(
        physicsVertexBuffer(query.vertices),
        query.directionX,
        query.directionY,
        query.maxDistance,
        physicsMaskBits(query.queryMaskBits),
      );
      return bridge.readPhysicsShapeCastHits();
    },

    shapeCastAabbTileObstacles(query) {
      requireAlive();
      rustEngine.shape_cast_aabb_tile_obstacles(
        query.x,
        query.y,
        query.halfWidth,
        query.halfHeight,
        query.directionX,
        query.directionY,
        query.maxDistance,
      );
      return bridge.readPhysicsTileShapeCastHits();
    },

    queryAabbTileObstacleContacts(query) {
      requireAlive();
      rustEngine.query_aabb_tile_obstacle_contacts(
        query.x,
        query.y,
        query.halfWidth,
        query.halfHeight,
      );
      return bridge.readPhysicsTileContactHits();
    },

    queryAabbTileObstacleManifolds(query) {
      requireAlive();
      rustEngine.query_aabb_tile_obstacle_manifolds(
        query.x,
        query.y,
        query.halfWidth,
        query.halfHeight,
      );
      return bridge.readPhysicsTileManifoldHits();
    },
  };
}
