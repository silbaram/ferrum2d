import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import type { Engine } from "../pkg/ferrum_core";
import {
  createPhysicsQueryApi,
} from "../src/physicsQueryApi.js";
import type { PhysicsQueryApiContext } from "../src/physicsQueryApi.js";
import {
  DEFAULT_PHYSICS_MASK_BITS,
  physicsMaskBits,
  physicsVertexBuffer,
} from "../src/physicsWasmInputs.js";

test("physics mask and vertex buffer helpers preserve existing defaults", () => {
  equal(physicsMaskBits(undefined), DEFAULT_PHYSICS_MASK_BITS);
  equal(physicsMaskBits(-1), DEFAULT_PHYSICS_MASK_BITS);
  const existing = new Float32Array([1, 2, 3, 4]);
  equal(physicsVertexBuffer(existing), existing);
  deepEqual(Array.from(physicsVertexBuffer([5, 6, 7, 8])), [5, 6, 7, 8]);
});

test("createPhysicsQueryApi forwards nearest body query and reads scalar hit fields", () => {
  const context = fakeQueryContext();
  const api = createPhysicsQueryApi(context);

  const hit = api.queryNearestBody({
    x: 10,
    y: 20,
    maxDistance: 30,
    queryMaskBits: 0x80,
  });

  deepEqual(context.calls, [["alive"], ["query_nearest_body", 10, 20, 30, 0x80]]);
  deepEqual(hit, {
    entityId: 7,
    entityGeneration: 9,
    pointX: 11,
    pointY: 12,
    distance: 13,
  });
});

test("createPhysicsQueryApi keeps buffer based query decode paths", () => {
  const context = fakeQueryContext();
  const api = createPhysicsQueryApi(context);
  const contacts = api.queryBodyContacts();
  const hits = api.queryConvexPolygonBodies({
    vertices: [0, 0, 1, 0, 0, 1],
  });

  deepEqual(context.calls, [
    ["alive"],
    ["query_body_contacts", DEFAULT_PHYSICS_MASK_BITS, DEFAULT_PHYSICS_MASK_BITS],
    ["readPhysicsBodyContactHits"],
    ["alive"],
    ["query_convex_polygon_bodies", [0, 0, 1, 0, 0, 1], DEFAULT_PHYSICS_MASK_BITS],
    ["readPhysicsQueryHits"],
  ]);
  equal(contacts.length, 1);
  equal(hits.length, 1);
});

test("createPhysicsQueryApi forwards optional body query height spans", () => {
  const context = fakeQueryContext();
  const api = createPhysicsQueryApi(context);
  api.queryNearestBody({
    x: 9,
    y: 10,
    maxDistance: 11,
    queryMaskBits: 0x20,
    heightSpan: { floorId: 2, elevation: 3, height: 4 },
  });
  api.queryPointBodies({
    x: 1,
    y: 2,
    queryMaskBits: 0x40,
    heightSpan: { floorId: 3, elevation: 4, height: 5 },
  });
  api.queryAabbBodies({
    x: 1,
    y: 2,
    halfWidth: 3,
    halfHeight: 4,
    heightSpan: { floorId: 4, elevation: 5, height: 6 },
  });
  api.queryCircleBodies({
    x: 1,
    y: 2,
    radius: 3,
    heightSpan: { floorId: 5, elevation: 6, height: 7 },
  });
  api.queryOrientedBoxBodies({
    x: 1,
    y: 2,
    halfWidth: 3,
    halfHeight: 4,
    rotationRadians: 5,
    heightSpan: { floorId: 6, elevation: 7, height: 8 },
  });
  api.queryCapsuleBodies({
    startX: 1,
    startY: 2,
    endX: 3,
    endY: 4,
    radius: 5,
    heightSpan: { floorId: 7, elevation: 8, height: 9 },
  });
  api.queryConvexPolygonBodies({
    vertices: [0, 0, 1, 0, 0, 1],
    heightSpan: { floorId: 8, elevation: 9, height: 10 },
  });
  api.raycastBodies({
    originX: 0,
    originY: 1,
    directionX: 1,
    directionY: 0,
    maxDistance: 10,
    heightSpan: { elevation: 2, height: 3 },
  });
  api.segmentCastBodies({
    startX: 1,
    startY: 2,
    endX: 3,
    endY: 4,
    heightSpan: { floorId: 9, elevation: 10, height: 11 },
  });
  api.shapeCastAabbBodies({
    x: 0,
    y: 0,
    halfWidth: 2,
    halfHeight: 3,
    directionX: 1,
    directionY: 0,
    maxDistance: 10,
    heightSpan: { floorId: 10, elevation: 11, height: 12 },
  });
  api.shapeCastCircleBodies({
    x: 0,
    y: 0,
    radius: 2,
    directionX: 1,
    directionY: 0,
    maxDistance: 10,
    queryMaskBits: 0x80,
    heightSpan: { floorId: 7, elevation: 8, height: 9 },
  });

  api.shapeCastOrientedBoxBodies({
    x: 0,
    y: 0,
    halfWidth: 2,
    halfHeight: 3,
    rotationRadians: 4,
    directionX: 1,
    directionY: 0,
    maxDistance: 10,
    heightSpan: { floorId: 12, elevation: 13, height: 14 },
  });
  api.shapeCastCapsuleBodies({
    startX: 0,
    startY: 1,
    endX: 2,
    endY: 3,
    radius: 4,
    directionX: 1,
    directionY: 0,
    maxDistance: 10,
    heightSpan: { floorId: 13, elevation: 14, height: 15 },
  });
  api.shapeCastConvexPolygonBodies({
    vertices: [0, 0, 1, 0, 0, 1],
    directionX: 1,
    directionY: 0,
    maxDistance: 10,
    heightSpan: { floorId: 14, elevation: 15, height: 16 },
  });

  deepEqual(context.calls, [
    ["alive"],
    ["query_nearest_body_with_height_span", 9, 10, 11, 0x20, 2, 3, 4],
    ["alive"],
    ["query_point_bodies_with_height_span", 1, 2, 0x40, 3, 4, 5],
    ["readPhysicsQueryHits"],
    ["alive"],
    ["query_aabb_bodies_with_height_span", 1, 2, 3, 4, DEFAULT_PHYSICS_MASK_BITS, 4, 5, 6],
    ["readPhysicsQueryHits"],
    ["alive"],
    ["query_circle_bodies_with_height_span", 1, 2, 3, DEFAULT_PHYSICS_MASK_BITS, 5, 6, 7],
    ["readPhysicsQueryHits"],
    ["alive"],
    ["query_oriented_box_bodies_with_height_span", 1, 2, 3, 4, 5, DEFAULT_PHYSICS_MASK_BITS, 6, 7, 8],
    ["readPhysicsQueryHits"],
    ["alive"],
    ["query_capsule_bodies_with_height_span", 1, 2, 3, 4, 5, DEFAULT_PHYSICS_MASK_BITS, 7, 8, 9],
    ["readPhysicsQueryHits"],
    ["alive"],
    ["query_convex_polygon_bodies_with_height_span", [0, 0, 1, 0, 0, 1], DEFAULT_PHYSICS_MASK_BITS, 8, 9, 10],
    ["readPhysicsQueryHits"],
    ["alive"],
    ["raycast_bodies_with_height_span", 0, 1, 1, 0, 10, DEFAULT_PHYSICS_MASK_BITS, 0, 2, 3],
    ["readPhysicsRaycastHits"],
    ["alive"],
    ["segment_cast_bodies_with_height_span", 1, 2, 3, 4, DEFAULT_PHYSICS_MASK_BITS, 9, 10, 11],
    ["readPhysicsRaycastHits"],
    ["alive"],
    ["shape_cast_aabb_bodies_with_height_span", 0, 0, 2, 3, 1, 0, 10, DEFAULT_PHYSICS_MASK_BITS, 10, 11, 12],
    ["readPhysicsShapeCastHits"],
    ["alive"],
    ["shape_cast_circle_bodies_with_height_span", 0, 0, 2, 1, 0, 10, 0x80, 7, 8, 9],
    ["readPhysicsShapeCastHits"],
    ["alive"],
    ["shape_cast_oriented_box_bodies_with_height_span", 0, 0, 2, 3, 4, 1, 0, 10, DEFAULT_PHYSICS_MASK_BITS, 12, 13, 14],
    ["readPhysicsShapeCastHits"],
    ["alive"],
    ["shape_cast_capsule_bodies_with_height_span", 0, 1, 2, 3, 4, 1, 0, 10, DEFAULT_PHYSICS_MASK_BITS, 13, 14, 15],
    ["readPhysicsShapeCastHits"],
    ["alive"],
    ["shape_cast_convex_polygon_bodies_with_height_span", [0, 0, 1, 0, 0, 1], 1, 0, 10, DEFAULT_PHYSICS_MASK_BITS, 14, 15, 16],
    ["readPhysicsShapeCastHits"],
  ]);
});

test("createPhysicsQueryApi forwards optional tile query height spans", () => {
  const context = fakeQueryContext();
  const api = createPhysicsQueryApi(context);

  api.queryNearestTileObstacle({
    x: 1,
    y: 2,
    maxDistance: 3,
    heightSpan: { floorId: 2, elevation: 4, height: 6 },
  });
  api.raycastTileObstacles({
    originX: 0,
    originY: 1,
    directionX: 1,
    directionY: 0,
    maxDistance: 10,
    heightSpan: { floorId: 3, elevation: 5, height: 7 },
  });
  api.segmentCastTileObstacles({
    startX: 1,
    startY: 2,
    endX: 3,
    endY: 4,
    heightSpan: { floorId: 4, elevation: 6, height: 8 },
  });
  api.shapeCastAabbTileObstacles({
    x: 1,
    y: 2,
    halfWidth: 3,
    halfHeight: 4,
    directionX: 1,
    directionY: 0,
    maxDistance: 9,
    heightSpan: { floorId: 5, elevation: 7, height: 9 },
  });
  api.queryAabbTileObstacleContacts({
    x: 1,
    y: 2,
    halfWidth: 3,
    halfHeight: 4,
    heightSpan: { floorId: 6, elevation: 8, height: 10 },
  });
  api.queryAabbTileObstacleManifolds({
    x: 1,
    y: 2,
    halfWidth: 3,
    halfHeight: 4,
    heightSpan: { elevation: 9, height: 11 },
  });

  deepEqual(context.calls, [
    ["alive"],
    ["query_nearest_tile_obstacle_with_height_span", 1, 2, 3, 2, 4, 6],
    ["alive"],
    ["raycast_tile_obstacles_with_height_span", 0, 1, 1, 0, 10, 3, 5, 7],
    ["readPhysicsTileRaycastHits"],
    ["alive"],
    ["segment_cast_tile_obstacles_with_height_span", 1, 2, 3, 4, 4, 6, 8],
    ["readPhysicsTileRaycastHits"],
    ["alive"],
    ["shape_cast_aabb_tile_obstacles_with_height_span", 1, 2, 3, 4, 1, 0, 9, 5, 7, 9],
    ["readPhysicsTileShapeCastHits"],
    ["alive"],
    ["query_aabb_tile_obstacle_contacts_with_height_span", 1, 2, 3, 4, 6, 8, 10],
    ["readPhysicsTileContactHits"],
    ["alive"],
    ["query_aabb_tile_obstacle_manifolds_with_height_span", 1, 2, 3, 4, 0, 9, 11],
    ["readPhysicsTileManifoldHits"],
  ]);
});

test("createPhysicsQueryApi validates optional body query height spans before Wasm", () => {
  const context = fakeQueryContext();
  const api = createPhysicsQueryApi(context);

  let thrownError: unknown;
  try {
    api.queryPointBodies({
      x: 1,
      y: 2,
      heightSpan: { floorId: -1, elevation: 0, height: 1 },
    });
  } catch (error) {
    thrownError = error;
  }

  if (!(thrownError instanceof Error) || !thrownError.message.includes("physics query heightSpan.floorId")) {
    throw new Error("Expected queryPointBodies to reject invalid heightSpan.floorId.");
  }
  deepEqual(context.calls, [["alive"]]);
});

test("createPhysicsQueryApi validates optional tile query height spans before Wasm", () => {
  const context = fakeQueryContext();
  const api = createPhysicsQueryApi(context);

  let thrownError: unknown;
  try {
    api.queryNearestTileObstacle({
      x: 1,
      y: 2,
      maxDistance: 3,
      heightSpan: { floorId: 0, elevation: 0, height: -1 },
    });
  } catch (error) {
    thrownError = error;
  }

  if (!(thrownError instanceof Error) || !thrownError.message.includes("physics query heightSpan.height")) {
    throw new Error("Expected queryNearestTileObstacle to reject invalid heightSpan.height.");
  }
  deepEqual(context.calls, [["alive"]]);
});

test("createPhysicsQueryApi gates all calls through requireAlive", () => {
  const context = fakeQueryContext(() => {
    throw new Error("destroyed");
  });
  const api = createPhysicsQueryApi(context);

  let thrownError: unknown;
  try {
    api.queryPointBodies({ x: 1, y: 2 });
  } catch (error) {
    thrownError = error;
  }
  if (!(thrownError instanceof Error) || thrownError.message !== "destroyed") {
    throw new Error("Expected queryPointBodies to throw destroyed.");
  }
  deepEqual(context.calls, [["alive"]]);
});

function fakeQueryContext(requireAliveOverride?: () => void): PhysicsQueryApiContext & {
  calls: unknown[][];
} {
  const calls: unknown[][] = [];
  const rustEngine = {
    query_nearest_body(...args: unknown[]) {
      calls.push(["query_nearest_body", ...args]);
      return true;
    },
    query_nearest_body_with_height_span(...args: unknown[]) {
      calls.push(["query_nearest_body_with_height_span", ...args]);
      return true;
    },
    physics_query_entity_id: () => 7,
    physics_query_entity_generation: () => 9,
    physics_query_tile_layer_index: () => 2,
    physics_query_tile_index: () => 3,
    physics_query_point_x: () => 11,
    physics_query_point_y: () => 12,
    physics_query_distance: () => 13,
    query_nearest_tile_obstacle(...args: unknown[]) {
      calls.push(["query_nearest_tile_obstacle", ...args]);
      return true;
    },
    query_nearest_tile_obstacle_with_height_span(...args: unknown[]) {
      calls.push(["query_nearest_tile_obstacle_with_height_span", ...args]);
      return true;
    },
    query_body_contacts(...args: unknown[]) {
      calls.push(["query_body_contacts", ...args]);
    },
    query_body_manifolds(...args: unknown[]) {
      calls.push(["query_body_manifolds", ...args]);
    },
    query_rigid_contact_impulses() {
      calls.push(["query_rigid_contact_impulses"]);
    },
    query_point_bodies(...args: unknown[]) {
      calls.push(["query_point_bodies", ...args]);
    },
    query_point_bodies_with_height_span(...args: unknown[]) {
      calls.push(["query_point_bodies_with_height_span", ...args]);
    },
    query_aabb_bodies(...args: unknown[]) {
      calls.push(["query_aabb_bodies", ...args]);
    },
    query_aabb_bodies_with_height_span(...args: unknown[]) {
      calls.push(["query_aabb_bodies_with_height_span", ...args]);
    },
    query_circle_bodies(...args: unknown[]) {
      calls.push(["query_circle_bodies", ...args]);
    },
    query_circle_bodies_with_height_span(...args: unknown[]) {
      calls.push(["query_circle_bodies_with_height_span", ...args]);
    },
    query_oriented_box_bodies(...args: unknown[]) {
      calls.push(["query_oriented_box_bodies", ...args]);
    },
    query_oriented_box_bodies_with_height_span(...args: unknown[]) {
      calls.push(["query_oriented_box_bodies_with_height_span", ...args]);
    },
    query_capsule_bodies(...args: unknown[]) {
      calls.push(["query_capsule_bodies", ...args]);
    },
    query_capsule_bodies_with_height_span(...args: unknown[]) {
      calls.push(["query_capsule_bodies_with_height_span", ...args]);
    },
    query_convex_polygon_bodies(vertices: Float32Array, maskBits: number) {
      calls.push(["query_convex_polygon_bodies", Array.from(vertices), maskBits]);
    },
    query_convex_polygon_bodies_with_height_span(vertices: Float32Array, ...args: unknown[]) {
      calls.push(["query_convex_polygon_bodies_with_height_span", Array.from(vertices), ...args]);
    },
    raycast_bodies(...args: unknown[]) {
      calls.push(["raycast_bodies", ...args]);
    },
    raycast_bodies_with_height_span(...args: unknown[]) {
      calls.push(["raycast_bodies_with_height_span", ...args]);
    },
    segment_cast_bodies(...args: unknown[]) {
      calls.push(["segment_cast_bodies", ...args]);
    },
    segment_cast_bodies_with_height_span(...args: unknown[]) {
      calls.push(["segment_cast_bodies_with_height_span", ...args]);
    },
    raycast_tile_obstacles(...args: unknown[]) {
      calls.push(["raycast_tile_obstacles", ...args]);
    },
    raycast_tile_obstacles_with_height_span(...args: unknown[]) {
      calls.push(["raycast_tile_obstacles_with_height_span", ...args]);
    },
    segment_cast_tile_obstacles(...args: unknown[]) {
      calls.push(["segment_cast_tile_obstacles", ...args]);
    },
    segment_cast_tile_obstacles_with_height_span(...args: unknown[]) {
      calls.push(["segment_cast_tile_obstacles_with_height_span", ...args]);
    },
    shape_cast_aabb_bodies(...args: unknown[]) {
      calls.push(["shape_cast_aabb_bodies", ...args]);
    },
    shape_cast_aabb_bodies_with_height_span(...args: unknown[]) {
      calls.push(["shape_cast_aabb_bodies_with_height_span", ...args]);
    },
    shape_cast_circle_bodies(...args: unknown[]) {
      calls.push(["shape_cast_circle_bodies", ...args]);
    },
    shape_cast_circle_bodies_with_height_span(...args: unknown[]) {
      calls.push(["shape_cast_circle_bodies_with_height_span", ...args]);
    },
    shape_cast_oriented_box_bodies(...args: unknown[]) {
      calls.push(["shape_cast_oriented_box_bodies", ...args]);
    },
    shape_cast_oriented_box_bodies_with_height_span(...args: unknown[]) {
      calls.push(["shape_cast_oriented_box_bodies_with_height_span", ...args]);
    },
    shape_cast_capsule_bodies(...args: unknown[]) {
      calls.push(["shape_cast_capsule_bodies", ...args]);
    },
    shape_cast_capsule_bodies_with_height_span(...args: unknown[]) {
      calls.push(["shape_cast_capsule_bodies_with_height_span", ...args]);
    },
    shape_cast_convex_polygon_bodies(vertices: Float32Array, ...args: unknown[]) {
      calls.push(["shape_cast_convex_polygon_bodies", Array.from(vertices), ...args]);
    },
    shape_cast_convex_polygon_bodies_with_height_span(vertices: Float32Array, ...args: unknown[]) {
      calls.push(["shape_cast_convex_polygon_bodies_with_height_span", Array.from(vertices), ...args]);
    },
    shape_cast_aabb_tile_obstacles(...args: unknown[]) {
      calls.push(["shape_cast_aabb_tile_obstacles", ...args]);
    },
    shape_cast_aabb_tile_obstacles_with_height_span(...args: unknown[]) {
      calls.push(["shape_cast_aabb_tile_obstacles_with_height_span", ...args]);
    },
    query_aabb_tile_obstacle_contacts(...args: unknown[]) {
      calls.push(["query_aabb_tile_obstacle_contacts", ...args]);
    },
    query_aabb_tile_obstacle_contacts_with_height_span(...args: unknown[]) {
      calls.push(["query_aabb_tile_obstacle_contacts_with_height_span", ...args]);
    },
    query_aabb_tile_obstacle_manifolds(...args: unknown[]) {
      calls.push(["query_aabb_tile_obstacle_manifolds", ...args]);
    },
    query_aabb_tile_obstacle_manifolds_with_height_span(...args: unknown[]) {
      calls.push(["query_aabb_tile_obstacle_manifolds_with_height_span", ...args]);
    },
  } as unknown as Engine;
  const bridge = {
    readPhysicsBodyContactHits() {
      calls.push(["readPhysicsBodyContactHits"]);
      return [{ normalX: 1 }];
    },
    readPhysicsBodyManifoldHits() {
      calls.push(["readPhysicsBodyManifoldHits"]);
      return [];
    },
    readPhysicsRigidContactImpulseHits() {
      calls.push(["readPhysicsRigidContactImpulseHits"]);
      return [];
    },
    readPhysicsQueryHits() {
      calls.push(["readPhysicsQueryHits"]);
      return [{ entityId: 1, entityGeneration: 2 }];
    },
    readPhysicsRaycastHits() {
      calls.push(["readPhysicsRaycastHits"]);
      return [];
    },
    readPhysicsTileRaycastHits() {
      calls.push(["readPhysicsTileRaycastHits"]);
      return [];
    },
    readPhysicsShapeCastHits() {
      calls.push(["readPhysicsShapeCastHits"]);
      return [];
    },
    readPhysicsTileShapeCastHits() {
      calls.push(["readPhysicsTileShapeCastHits"]);
      return [];
    },
    readPhysicsTileContactHits() {
      calls.push(["readPhysicsTileContactHits"]);
      return [];
    },
    readPhysicsTileManifoldHits() {
      calls.push(["readPhysicsTileManifoldHits"]);
      return [];
    },
  };
  return {
    rustEngine,
    bridge: bridge as unknown as PhysicsQueryApiContext["bridge"],
    requireAlive() {
      calls.push(["alive"]);
      requireAliveOverride?.();
    },
    calls,
  };
}
