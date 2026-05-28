import type { Engine } from "../pkg/ferrum_core";
import type {
  FerrumSceneApi,
  TilemapNavigationPath,
  TilemapNavigationPathPoint,
  TilemapNavigationPathQuery,
  TilemapNavigationWaypoint,
  TilemapNavigationWaypointQuery,
  TilemapRectEditOptions,
} from "./engineTypes.js";
import { uint32Number } from "./particlePreset";
import type {
  PhysicsDebugLineBufferView,
  TilemapNavigationPathBufferView,
  WasmBridge,
} from "./wasmBridge";

type FerrumTilemapSceneApi = Pick<
  FerrumSceneApi,
  | "setShooterTilemapTile"
  | "setShooterTilemapTilesRect"
  | "setShooterTilemapNavigationCost"
  | "queryTilemapNavigationWaypoint"
  | "queryTilemapNavigationPath"
>;

export interface TilemapSceneApiContext {
  rustEngine: Engine;
  bridge: WasmBridge;
  requireAlive(): void;
}

export function createTilemapSceneApi({
  rustEngine,
  bridge,
  requireAlive,
}: TilemapSceneApiContext): FerrumTilemapSceneApi {
  return {
    setShooterTilemapTile(layerIndex, column, row, tileId) {
      requireAlive();
      return rustEngine.set_shooter_tilemap_tile(
        uint32Number(layerIndex, "tilemap layer index"),
        uint32Number(column, "tilemap column"),
        uint32Number(row, "tilemap row"),
        uint32Number(tileId, "tile id"),
      );
    },
    setShooterTilemapTilesRect(layerIndex, column, row, width, height, tileId, options) {
      requireAlive();
      return setShooterTilemapTilesRect(
        rustEngine,
        layerIndex,
        column,
        row,
        width,
        height,
        tileId,
        options,
      );
    },
    setShooterTilemapNavigationCost(layerIndex, column, row, cost) {
      requireAlive();
      return rustEngine.set_shooter_tilemap_navigation_cost(
        uint32Number(layerIndex, "tilemap layer index"),
        uint32Number(column, "tilemap column"),
        uint32Number(row, "tilemap row"),
        uint32Number(cost, "tilemap navigation cost"),
      );
    },
    queryTilemapNavigationWaypoint(query) {
      requireAlive();
      return queryTilemapNavigationWaypoint(rustEngine, query);
    },
    queryTilemapNavigationPath(query) {
      requireAlive();
      return queryTilemapNavigationPath(rustEngine, bridge, query);
    },
  };
}

function setShooterTilemapTilesRect(
  rustEngine: Engine,
  layerIndex: number,
  column: number,
  row: number,
  width: number,
  height: number,
  tileId: number,
  options: TilemapRectEditOptions | undefined,
): boolean {
  if (options?.maxCollisionRebuildChunks !== undefined) {
    return rustEngine.set_shooter_tilemap_tiles_rect_with_rebuild_budget(
      uint32Number(layerIndex, "tilemap layer index"),
      uint32Number(column, "tilemap column"),
      uint32Number(row, "tilemap row"),
      uint32Number(width, "tilemap rect width"),
      uint32Number(height, "tilemap rect height"),
      uint32Number(tileId, "tile id"),
      uint32Number(options.maxCollisionRebuildChunks, "tilemap collision rebuild chunk budget"),
    );
  }
  return rustEngine.set_shooter_tilemap_tiles_rect(
    uint32Number(layerIndex, "tilemap layer index"),
    uint32Number(column, "tilemap column"),
    uint32Number(row, "tilemap row"),
    uint32Number(width, "tilemap rect width"),
    uint32Number(height, "tilemap rect height"),
    uint32Number(tileId, "tile id"),
  );
}

function queryTilemapNavigationWaypoint(
  rustEngine: Engine,
  query: TilemapNavigationWaypointQuery,
): TilemapNavigationWaypoint | undefined {
  const hit = rustEngine.query_tilemap_navigation_waypoint(
    query.fromX,
    query.fromY,
    query.toX,
    query.toY,
  );
  if (!hit) {
    return undefined;
  }
  return {
    x: rustEngine.physics_query_point_x(),
    y: rustEngine.physics_query_point_y(),
    distance: rustEngine.physics_query_distance(),
  };
}

function queryTilemapNavigationPath(
  rustEngine: Engine,
  bridge: WasmBridge,
  query: TilemapNavigationPathQuery,
): TilemapNavigationPath | undefined {
  const hit = rustEngine.query_tilemap_navigation_path(
    query.fromX,
    query.fromY,
    query.toX,
    query.toY,
  );
  if (!hit) {
    return undefined;
  }

  const pathBuffer = bridge.readTilemapNavigationPathBuffer();
  const pointBuffer = new Float32Array(pathBuffer.buffer);
  const copiedPathBuffer: TilemapNavigationPathBufferView = {
    buffer: pointBuffer,
    pointCount: pathBuffer.pointCount,
    floatsPerPoint: pathBuffer.floatsPerPoint,
  };
  const debugLineBuffer = bridge.readTilemapNavigationDebugLineBuffer();
  const copiedDebugLineBuffer: PhysicsDebugLineBufferView = {
    buffer: new Float32Array(debugLineBuffer.buffer),
    lineCount: debugLineBuffer.lineCount,
    floatsPerLine: debugLineBuffer.floatsPerLine,
  };

  return {
    pointBuffer,
    pointCount: copiedPathBuffer.pointCount,
    points: decodeTilemapNavigationPathPoints(copiedPathBuffer),
    distance: rustEngine.physics_query_distance(),
    debugLineBuffer: copiedDebugLineBuffer,
    debugLines: bridge.decodePhysicsDebugLines(copiedDebugLineBuffer),
  };
}

function decodeTilemapNavigationPathPoints(
  view: TilemapNavigationPathBufferView,
): readonly TilemapNavigationPathPoint[] {
  const points: TilemapNavigationPathPoint[] = [];
  for (let index = 0; index < view.pointCount; index += 1) {
    const offset = index * view.floatsPerPoint;
    points.push({
      x: view.buffer[offset],
      y: view.buffer[offset + 1],
    });
  }
  return points;
}
