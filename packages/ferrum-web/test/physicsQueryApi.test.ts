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
    query_aabb_bodies(...args: unknown[]) {
      calls.push(["query_aabb_bodies", ...args]);
    },
    query_circle_bodies(...args: unknown[]) {
      calls.push(["query_circle_bodies", ...args]);
    },
    query_oriented_box_bodies(...args: unknown[]) {
      calls.push(["query_oriented_box_bodies", ...args]);
    },
    query_capsule_bodies(...args: unknown[]) {
      calls.push(["query_capsule_bodies", ...args]);
    },
    query_convex_polygon_bodies(vertices: Float32Array, maskBits: number) {
      calls.push(["query_convex_polygon_bodies", Array.from(vertices), maskBits]);
    },
    raycast_bodies(...args: unknown[]) {
      calls.push(["raycast_bodies", ...args]);
    },
    segment_cast_bodies(...args: unknown[]) {
      calls.push(["segment_cast_bodies", ...args]);
    },
    raycast_tile_obstacles(...args: unknown[]) {
      calls.push(["raycast_tile_obstacles", ...args]);
    },
    segment_cast_tile_obstacles(...args: unknown[]) {
      calls.push(["segment_cast_tile_obstacles", ...args]);
    },
    shape_cast_aabb_bodies(...args: unknown[]) {
      calls.push(["shape_cast_aabb_bodies", ...args]);
    },
    shape_cast_circle_bodies(...args: unknown[]) {
      calls.push(["shape_cast_circle_bodies", ...args]);
    },
    shape_cast_oriented_box_bodies(...args: unknown[]) {
      calls.push(["shape_cast_oriented_box_bodies", ...args]);
    },
    shape_cast_capsule_bodies(...args: unknown[]) {
      calls.push(["shape_cast_capsule_bodies", ...args]);
    },
    shape_cast_convex_polygon_bodies(vertices: Float32Array, ...args: unknown[]) {
      calls.push(["shape_cast_convex_polygon_bodies", Array.from(vertices), ...args]);
    },
    shape_cast_aabb_tile_obstacles(...args: unknown[]) {
      calls.push(["shape_cast_aabb_tile_obstacles", ...args]);
    },
    query_aabb_tile_obstacle_contacts(...args: unknown[]) {
      calls.push(["query_aabb_tile_obstacle_contacts", ...args]);
    },
    query_aabb_tile_obstacle_manifolds(...args: unknown[]) {
      calls.push(["query_aabb_tile_obstacle_manifolds", ...args]);
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
