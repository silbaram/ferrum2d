import type { Engine } from "../pkg/ferrum_core";
import type { FerrumPhysicsQueryApi, PhysicsBodyHeightSpan } from "./engineTypes.js";
import { finiteNumber, uint32Number } from "./particlePreset";
import { nonNegativeNumber } from "./physicsAuthoringNumbers.js";
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
      const maskBits = physicsMaskBits(query.queryMaskBits);
      const heightSpan = queryHeightSpanArgs(query.heightSpan);
      const hit = heightSpan === undefined
        ? rustEngine.query_nearest_body(
            query.x,
            query.y,
            query.maxDistance,
            maskBits,
          )
        : rustEngine.query_nearest_body_with_height_span(
            query.x,
            query.y,
            query.maxDistance,
            maskBits,
            ...heightSpan,
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
      const heightSpan = queryHeightSpanArgs(query.heightSpan);
      const hit = heightSpan === undefined
        ? rustEngine.query_nearest_tile_obstacle(query.x, query.y, query.maxDistance)
        : rustEngine.query_nearest_tile_obstacle_with_height_span(
            query.x,
            query.y,
            query.maxDistance,
            ...heightSpan,
          );
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
      const maskBits = physicsMaskBits(query.queryMaskBits);
      const heightSpan = queryHeightSpanArgs(query.heightSpan);
      if (heightSpan === undefined) {
        rustEngine.query_point_bodies(query.x, query.y, maskBits);
      } else {
        rustEngine.query_point_bodies_with_height_span(query.x, query.y, maskBits, ...heightSpan);
      }
      return bridge.readPhysicsQueryHits();
    },

    queryAabbBodies(query) {
      requireAlive();
      const maskBits = physicsMaskBits(query.queryMaskBits);
      const heightSpan = queryHeightSpanArgs(query.heightSpan);
      if (heightSpan === undefined) {
        rustEngine.query_aabb_bodies(
          query.x,
          query.y,
          query.halfWidth,
          query.halfHeight,
          maskBits,
        );
      } else {
        rustEngine.query_aabb_bodies_with_height_span(
          query.x,
          query.y,
          query.halfWidth,
          query.halfHeight,
          maskBits,
          ...heightSpan,
        );
      }
      return bridge.readPhysicsQueryHits();
    },

    queryCircleBodies(query) {
      requireAlive();
      const maskBits = physicsMaskBits(query.queryMaskBits);
      const heightSpan = queryHeightSpanArgs(query.heightSpan);
      if (heightSpan === undefined) {
        rustEngine.query_circle_bodies(
          query.x,
          query.y,
          query.radius,
          maskBits,
        );
      } else {
        rustEngine.query_circle_bodies_with_height_span(
          query.x,
          query.y,
          query.radius,
          maskBits,
          ...heightSpan,
        );
      }
      return bridge.readPhysicsQueryHits();
    },

    queryOrientedBoxBodies(query) {
      requireAlive();
      const maskBits = physicsMaskBits(query.queryMaskBits);
      const heightSpan = queryHeightSpanArgs(query.heightSpan);
      if (heightSpan === undefined) {
        rustEngine.query_oriented_box_bodies(
          query.x,
          query.y,
          query.halfWidth,
          query.halfHeight,
          query.rotationRadians,
          maskBits,
        );
      } else {
        rustEngine.query_oriented_box_bodies_with_height_span(
          query.x,
          query.y,
          query.halfWidth,
          query.halfHeight,
          query.rotationRadians,
          maskBits,
          ...heightSpan,
        );
      }
      return bridge.readPhysicsQueryHits();
    },

    queryCapsuleBodies(query) {
      requireAlive();
      const maskBits = physicsMaskBits(query.queryMaskBits);
      const heightSpan = queryHeightSpanArgs(query.heightSpan);
      if (heightSpan === undefined) {
        rustEngine.query_capsule_bodies(
          query.startX,
          query.startY,
          query.endX,
          query.endY,
          query.radius,
          maskBits,
        );
      } else {
        rustEngine.query_capsule_bodies_with_height_span(
          query.startX,
          query.startY,
          query.endX,
          query.endY,
          query.radius,
          maskBits,
          ...heightSpan,
        );
      }
      return bridge.readPhysicsQueryHits();
    },

    queryConvexPolygonBodies(query) {
      requireAlive();
      const maskBits = physicsMaskBits(query.queryMaskBits);
      const vertices = physicsVertexBuffer(query.vertices);
      const heightSpan = queryHeightSpanArgs(query.heightSpan);
      if (heightSpan === undefined) {
        rustEngine.query_convex_polygon_bodies(vertices, maskBits);
      } else {
        rustEngine.query_convex_polygon_bodies_with_height_span(vertices, maskBits, ...heightSpan);
      }
      return bridge.readPhysicsQueryHits();
    },

    raycastBodies(query) {
      requireAlive();
      const maskBits = physicsMaskBits(query.queryMaskBits);
      const heightSpan = queryHeightSpanArgs(query.heightSpan);
      if (heightSpan === undefined) {
        rustEngine.raycast_bodies(
          query.originX,
          query.originY,
          query.directionX,
          query.directionY,
          query.maxDistance,
          maskBits,
        );
      } else {
        rustEngine.raycast_bodies_with_height_span(
          query.originX,
          query.originY,
          query.directionX,
          query.directionY,
          query.maxDistance,
          maskBits,
          ...heightSpan,
        );
      }
      return bridge.readPhysicsRaycastHits();
    },

    segmentCastBodies(query) {
      requireAlive();
      const maskBits = physicsMaskBits(query.queryMaskBits);
      const heightSpan = queryHeightSpanArgs(query.heightSpan);
      if (heightSpan === undefined) {
        rustEngine.segment_cast_bodies(
          query.startX,
          query.startY,
          query.endX,
          query.endY,
          maskBits,
        );
      } else {
        rustEngine.segment_cast_bodies_with_height_span(
          query.startX,
          query.startY,
          query.endX,
          query.endY,
          maskBits,
          ...heightSpan,
        );
      }
      return bridge.readPhysicsRaycastHits();
    },

    raycastTileObstacles(query) {
      requireAlive();
      const heightSpan = queryHeightSpanArgs(query.heightSpan);
      if (heightSpan === undefined) {
        rustEngine.raycast_tile_obstacles(
          query.originX,
          query.originY,
          query.directionX,
          query.directionY,
          query.maxDistance,
        );
      } else {
        rustEngine.raycast_tile_obstacles_with_height_span(
          query.originX,
          query.originY,
          query.directionX,
          query.directionY,
          query.maxDistance,
          ...heightSpan,
        );
      }
      return bridge.readPhysicsTileRaycastHits();
    },

    segmentCastTileObstacles(query) {
      requireAlive();
      const heightSpan = queryHeightSpanArgs(query.heightSpan);
      if (heightSpan === undefined) {
        rustEngine.segment_cast_tile_obstacles(
          query.startX,
          query.startY,
          query.endX,
          query.endY,
        );
      } else {
        rustEngine.segment_cast_tile_obstacles_with_height_span(
          query.startX,
          query.startY,
          query.endX,
          query.endY,
          ...heightSpan,
        );
      }
      return bridge.readPhysicsTileRaycastHits();
    },

    shapeCastAabbBodies(query) {
      requireAlive();
      const maskBits = physicsMaskBits(query.queryMaskBits);
      const heightSpan = queryHeightSpanArgs(query.heightSpan);
      if (heightSpan === undefined) {
        rustEngine.shape_cast_aabb_bodies(
          query.x,
          query.y,
          query.halfWidth,
          query.halfHeight,
          query.directionX,
          query.directionY,
          query.maxDistance,
          maskBits,
        );
      } else {
        rustEngine.shape_cast_aabb_bodies_with_height_span(
          query.x,
          query.y,
          query.halfWidth,
          query.halfHeight,
          query.directionX,
          query.directionY,
          query.maxDistance,
          maskBits,
          ...heightSpan,
        );
      }
      return bridge.readPhysicsShapeCastHits();
    },

    shapeCastCircleBodies(query) {
      requireAlive();
      const maskBits = physicsMaskBits(query.queryMaskBits);
      const heightSpan = queryHeightSpanArgs(query.heightSpan);
      if (heightSpan === undefined) {
        rustEngine.shape_cast_circle_bodies(
          query.x,
          query.y,
          query.radius,
          query.directionX,
          query.directionY,
          query.maxDistance,
          maskBits,
        );
      } else {
        rustEngine.shape_cast_circle_bodies_with_height_span(
          query.x,
          query.y,
          query.radius,
          query.directionX,
          query.directionY,
          query.maxDistance,
          maskBits,
          ...heightSpan,
        );
      }
      return bridge.readPhysicsShapeCastHits();
    },

    shapeCastOrientedBoxBodies(query) {
      requireAlive();
      const maskBits = physicsMaskBits(query.queryMaskBits);
      const heightSpan = queryHeightSpanArgs(query.heightSpan);
      if (heightSpan === undefined) {
        rustEngine.shape_cast_oriented_box_bodies(
          query.x,
          query.y,
          query.halfWidth,
          query.halfHeight,
          query.rotationRadians,
          query.directionX,
          query.directionY,
          query.maxDistance,
          maskBits,
        );
      } else {
        rustEngine.shape_cast_oriented_box_bodies_with_height_span(
          query.x,
          query.y,
          query.halfWidth,
          query.halfHeight,
          query.rotationRadians,
          query.directionX,
          query.directionY,
          query.maxDistance,
          maskBits,
          ...heightSpan,
        );
      }
      return bridge.readPhysicsShapeCastHits();
    },

    shapeCastCapsuleBodies(query) {
      requireAlive();
      const maskBits = physicsMaskBits(query.queryMaskBits);
      const heightSpan = queryHeightSpanArgs(query.heightSpan);
      if (heightSpan === undefined) {
        rustEngine.shape_cast_capsule_bodies(
          query.startX,
          query.startY,
          query.endX,
          query.endY,
          query.radius,
          query.directionX,
          query.directionY,
          query.maxDistance,
          maskBits,
        );
      } else {
        rustEngine.shape_cast_capsule_bodies_with_height_span(
          query.startX,
          query.startY,
          query.endX,
          query.endY,
          query.radius,
          query.directionX,
          query.directionY,
          query.maxDistance,
          maskBits,
          ...heightSpan,
        );
      }
      return bridge.readPhysicsShapeCastHits();
    },

    shapeCastConvexPolygonBodies(query) {
      requireAlive();
      const maskBits = physicsMaskBits(query.queryMaskBits);
      const vertices = physicsVertexBuffer(query.vertices);
      const heightSpan = queryHeightSpanArgs(query.heightSpan);
      if (heightSpan === undefined) {
        rustEngine.shape_cast_convex_polygon_bodies(
          vertices,
          query.directionX,
          query.directionY,
          query.maxDistance,
          maskBits,
        );
      } else {
        rustEngine.shape_cast_convex_polygon_bodies_with_height_span(
          vertices,
          query.directionX,
          query.directionY,
          query.maxDistance,
          maskBits,
          ...heightSpan,
        );
      }
      return bridge.readPhysicsShapeCastHits();
    },

    shapeCastAabbTileObstacles(query) {
      requireAlive();
      const heightSpan = queryHeightSpanArgs(query.heightSpan);
      if (heightSpan === undefined) {
        rustEngine.shape_cast_aabb_tile_obstacles(
          query.x,
          query.y,
          query.halfWidth,
          query.halfHeight,
          query.directionX,
          query.directionY,
          query.maxDistance,
        );
      } else {
        rustEngine.shape_cast_aabb_tile_obstacles_with_height_span(
          query.x,
          query.y,
          query.halfWidth,
          query.halfHeight,
          query.directionX,
          query.directionY,
          query.maxDistance,
          ...heightSpan,
        );
      }
      return bridge.readPhysicsTileShapeCastHits();
    },

    queryAabbTileObstacleContacts(query) {
      requireAlive();
      const heightSpan = queryHeightSpanArgs(query.heightSpan);
      if (heightSpan === undefined) {
        rustEngine.query_aabb_tile_obstacle_contacts(
          query.x,
          query.y,
          query.halfWidth,
          query.halfHeight,
        );
      } else {
        rustEngine.query_aabb_tile_obstacle_contacts_with_height_span(
          query.x,
          query.y,
          query.halfWidth,
          query.halfHeight,
          ...heightSpan,
        );
      }
      return bridge.readPhysicsTileContactHits();
    },

    queryAabbTileObstacleManifolds(query) {
      requireAlive();
      const heightSpan = queryHeightSpanArgs(query.heightSpan);
      if (heightSpan === undefined) {
        rustEngine.query_aabb_tile_obstacle_manifolds(
          query.x,
          query.y,
          query.halfWidth,
          query.halfHeight,
        );
      } else {
        rustEngine.query_aabb_tile_obstacle_manifolds_with_height_span(
          query.x,
          query.y,
          query.halfWidth,
          query.halfHeight,
          ...heightSpan,
        );
      }
      return bridge.readPhysicsTileManifoldHits();
    },
  };
}

function queryHeightSpanArgs(
  heightSpan: PhysicsBodyHeightSpan | undefined,
): [number, number, number] | undefined {
  if (heightSpan === undefined) {
    return undefined;
  }
  return [
    uint32Number(heightSpan.floorId ?? 0, "physics query heightSpan.floorId"),
    finiteNumber(heightSpan.elevation, "physics query heightSpan.elevation"),
    nonNegativeNumber(heightSpan.height, "physics query heightSpan.height"),
  ];
}
