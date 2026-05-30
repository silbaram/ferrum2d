import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import type { Engine } from "../pkg/ferrum_core";
import { createTilemapSceneApi } from "../src/engineTilemapApi.js";
import type { TilemapSceneApiContext } from "../src/engineTilemapApi.js";
import type { WasmBridge } from "../src/wasmBridge";

test("createTilemapSceneApi forwards optional navigation height spans", () => {
  const context = fakeTilemapContext();
  const api = createTilemapSceneApi(context);

  const waypoint = api.queryTilemapNavigationWaypoint({
    fromX: 1,
    fromY: 2,
    toX: 3,
    toY: 4,
    heightSpan: { floorId: 5, elevation: 6, height: 7 },
  });
  const path = api.queryTilemapNavigationPath({
    fromX: 8,
    fromY: 9,
    toX: 10,
    toY: 11,
    heightSpan: { elevation: 12, height: 13 },
    toHeightSpan: { floorId: 2, elevation: 20, height: 13 },
  });

  deepEqual(context.calls, [
    ["alive"],
    ["query_tilemap_navigation_waypoint_with_height_span", 1, 2, 3, 4, 5, 6, 7],
    ["alive"],
    ["query_tilemap_navigation_path_between_height_spans", 8, 9, 10, 11, 0, 12, 13, 2, 20, 13],
    ["readTilemapNavigationPathBuffer"],
    ["readTilemapNavigationDebugLineBuffer"],
    ["decodePhysicsDebugLines", 0],
  ]);
  deepEqual(waypoint, { x: 31, y: 32, distance: 33, heightSpan: { floorId: 5, elevation: 6, height: 7 } });
  equal(path?.pointCount, 2);
  deepEqual(path?.points, [
    { x: 41, y: 42, heightSpan: { floorId: 0, elevation: 12, height: 13 } },
    { x: 51, y: 52, heightSpan: { floorId: 2, elevation: 20, height: 13 } },
  ]);
  deepEqual(Array.from(path?.pointBuffer ?? []), [41, 42, 0, 12, 13, 51, 52, 2, 20, 13]);
});

test("createTilemapSceneApi validates optional navigation height spans before Wasm", () => {
  const context = fakeTilemapContext();
  const api = createTilemapSceneApi(context);

  throwsError(() => api.queryTilemapNavigationWaypoint({
    fromX: 1,
    fromY: 2,
    toX: 3,
    toY: 4,
    heightSpan: { floorId: -1, elevation: 0, height: 1 },
  }));
  throwsError(() => api.queryTilemapNavigationPath({
    fromX: 1,
    fromY: 2,
    toX: 3,
    toY: 4,
    heightSpan: { floorId: 0, elevation: Number.NaN, height: 1 },
  }));
  throwsError(() => api.queryTilemapNavigationPath({
    fromX: 1,
    fromY: 2,
    toX: 3,
    toY: 4,
    heightSpan: { floorId: 0, elevation: 0, height: -1 },
  }));

  deepEqual(context.calls, [["alive"], ["alive"], ["alive"]]);
});

test("createTilemapSceneApi forwards HD-2D tile metadata", () => {
  const context = fakeTilemapContext();
  const api = createTilemapSceneApi(context);

  equal(api.setShooterTileHd2dMetadata(3, {
    kind: "ramp",
    ramp: { axis: "y", startElevation: 1, endElevation: 5 },
    blocksMovement: false,
  }), true);
  equal(api.clearShooterTileHd2dMetadata(3), true);

  deepEqual(context.calls, [
    ["alive"],
    ["set_shooter_tile_hd2d_metadata", 3, 2, false, false, false, 0, true, 1, 1, 5],
    ["alive"],
    ["clear_shooter_tile_hd2d_metadata", 3],
  ]);
});

test("createTilemapSceneApi forwards bridge portal metadata", () => {
  const context = fakeTilemapContext();
  const api = createTilemapSceneApi(context);

  equal(api.setShooterTileBridgePortal(7, {
    lowerFloorId: 1,
    upperFloorId: 2,
    lowerElevation: 0,
    upperElevation: 12,
    navigationCost: 3,
  }), true);
  equal(api.setShooterTileHd2dMetadata(8, {
    kind: "bridge",
    blocksMovement: false,
    bridgePortal: {
      lowerFloorId: 1,
      upperFloorId: 2,
      lowerElevation: 0,
      upperElevation: 12,
    },
  }), true);
  equal(api.clearShooterTileBridgePortal(7), true);

  deepEqual(context.calls, [
    ["alive"],
    ["set_shooter_tile_bridge_portal", 7, 1, 2, 0, 12, 3],
    ["alive"],
    ["set_shooter_tile_hd2d_metadata", 8, 4, false, false, false, 0, false, 0, 0, 0],
    ["set_shooter_tile_bridge_portal", 8, 1, 2, 0, 12, 1],
    ["alive"],
    ["clear_shooter_tile_bridge_portal", 7],
  ]);
});

test("createTilemapSceneApi validates HD-2D ramp metadata before Wasm", () => {
  const context = fakeTilemapContext();
  const api = createTilemapSceneApi(context);

  throwsError(() => api.setShooterTileHd2dMetadata(1, { kind: "ramp" }));
  throwsError(() => api.setShooterTileHd2dMetadata(1, { kind: "bridge", ramp: { axis: "x" } }));

  deepEqual(context.calls, [["alive"], ["alive"]]);
});

function fakeTilemapContext(): TilemapSceneApiContext & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  const rustEngine = {
    query_tilemap_navigation_waypoint_with_height_span(
      fromX: number,
      fromY: number,
      toX: number,
      toY: number,
      floorId: number,
      elevation: number,
      height: number,
    ): boolean {
      calls.push([
        "query_tilemap_navigation_waypoint_with_height_span",
        fromX,
        fromY,
        toX,
        toY,
        floorId,
        elevation,
        height,
      ]);
      return true;
    },
    query_tilemap_navigation_path_with_height_span(
      fromX: number,
      fromY: number,
      toX: number,
      toY: number,
      floorId: number,
      elevation: number,
      height: number,
    ): boolean {
      calls.push([
        "query_tilemap_navigation_path_with_height_span",
        fromX,
        fromY,
        toX,
        toY,
        floorId,
        elevation,
        height,
      ]);
      return true;
    },
    query_tilemap_navigation_path_between_height_spans(
      fromX: number,
      fromY: number,
      toX: number,
      toY: number,
      fromFloorId: number,
      fromElevation: number,
      fromHeight: number,
      toFloorId: number,
      toElevation: number,
      toHeight: number,
    ): boolean {
      calls.push([
        "query_tilemap_navigation_path_between_height_spans",
        fromX,
        fromY,
        toX,
        toY,
        fromFloorId,
        fromElevation,
        fromHeight,
        toFloorId,
        toElevation,
        toHeight,
      ]);
      return true;
    },
    physics_query_point_x: () => 31,
    physics_query_point_y: () => 32,
    physics_query_distance: () => 33,
    set_shooter_tile_hd2d_metadata(
      tileId: number,
      kind: number,
      blocksMovement: boolean,
      blocksProjectile: boolean,
      blocksVision: boolean,
      occluderHeight: number,
      hasRamp: boolean,
      rampAxis: number,
      rampStartElevation: number,
      rampEndElevation: number,
    ): boolean {
      calls.push([
        "set_shooter_tile_hd2d_metadata",
        tileId,
        kind,
        blocksMovement,
        blocksProjectile,
        blocksVision,
        occluderHeight,
        hasRamp,
        rampAxis,
        rampStartElevation,
        rampEndElevation,
      ]);
      return true;
    },
    set_shooter_tile_bridge_portal(
      tileId: number,
      lowerFloorId: number,
      upperFloorId: number,
      lowerElevation: number,
      upperElevation: number,
      navigationCost: number,
    ): boolean {
      calls.push([
        "set_shooter_tile_bridge_portal",
        tileId,
        lowerFloorId,
        upperFloorId,
        lowerElevation,
        upperElevation,
        navigationCost,
      ]);
      return true;
    },
    clear_shooter_tile_bridge_portal(tileId: number): boolean {
      calls.push(["clear_shooter_tile_bridge_portal", tileId]);
      return true;
    },
    clear_shooter_tile_hd2d_metadata(tileId: number): boolean {
      calls.push(["clear_shooter_tile_hd2d_metadata", tileId]);
      return true;
    },
  } as unknown as Engine;
  const bridge = {
    readTilemapNavigationPathBuffer() {
      calls.push(["readTilemapNavigationPathBuffer"]);
      return {
        buffer: new Float32Array([41, 42, 0, 12, 13, 51, 52, 2, 20, 13]),
        pointCount: 2,
        floatsPerPoint: 5,
      };
    },
    readTilemapNavigationDebugLineBuffer() {
      calls.push(["readTilemapNavigationDebugLineBuffer"]);
      return {
        buffer: new Float32Array(),
        lineCount: 0,
        floatsPerLine: 8,
      };
    },
    decodePhysicsDebugLines(view: { lineCount: number }) {
      calls.push(["decodePhysicsDebugLines", view.lineCount]);
      return [];
    },
  } as unknown as WasmBridge;
  return {
    calls,
    rustEngine,
    bridge,
    requireAlive() {
      calls.push(["alive"]);
    },
  };
}

function throwsError(action: () => unknown): void {
  try {
    action();
  } catch (error) {
    equal(error instanceof Error, true);
    return;
  }
  throw new Error("expected Error");
}
