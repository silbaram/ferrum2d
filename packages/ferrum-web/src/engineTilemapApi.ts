import type { Engine } from "../pkg/ferrum_core";
import type {
  FerrumSceneApi,
  PhysicsBodyHeightSpan,
  TilemapNavigationPath,
  TilemapNavigationPathPoint,
  TilemapNavigationPathQuery,
  TilemapNavigationWaypoint,
  TilemapNavigationWaypointQuery,
  TilemapRectEditOptions,
  ShooterTileBridgePortalMetadata,
  ShooterTileHd2dMetadata,
} from "./engineTypes.js";
import { finiteNumber, uint32Number } from "./particlePreset";
import { nonNegativeNumber } from "./physicsAuthoringNumbers.js";
import type {
  PhysicsDebugLineBufferView,
  TilemapNavigationPathBufferView,
  WasmBridge,
} from "./wasmBridge";

type FerrumTilemapSceneApi = Pick<
  FerrumSceneApi,
  | "setShooterTilemapTile"
  | "setShooterTilemapTilesRect"
  | "setShooterTileHeightSpan"
  | "clearShooterTileHeightSpan"
  | "setShooterTileHd2dMetadata"
  | "clearShooterTileHd2dMetadata"
  | "setShooterTileBridgePortal"
  | "clearShooterTileBridgePortal"
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
    setShooterTileHeightSpan(tileId, heightSpan) {
      requireAlive();
      return rustEngine.set_shooter_tile_height_span(
        uint32Number(tileId, "tile id"),
        ...tileHeightSpanArgs(heightSpan),
      );
    },
    clearShooterTileHeightSpan(tileId) {
      requireAlive();
      return rustEngine.clear_shooter_tile_height_span(
        uint32Number(tileId, "tile id"),
      );
    },
    setShooterTileHd2dMetadata(tileId, metadata) {
      requireAlive();
      const numericTileId = uint32Number(tileId, "tile id");
      const accepted = rustEngine.set_shooter_tile_hd2d_metadata(
        numericTileId,
        ...tileHd2dMetadataArgs(metadata),
      );
      if (!accepted || metadata.bridgePortal === undefined) {
        return accepted;
      }
      return rustEngine.set_shooter_tile_bridge_portal(
        numericTileId,
        ...tileBridgePortalArgs(metadata.bridgePortal),
      );
    },
    clearShooterTileHd2dMetadata(tileId) {
      requireAlive();
      return rustEngine.clear_shooter_tile_hd2d_metadata(
        uint32Number(tileId, "tile id"),
      );
    },
    setShooterTileBridgePortal(tileId, portal) {
      requireAlive();
      return rustEngine.set_shooter_tile_bridge_portal(
        uint32Number(tileId, "tile id"),
        ...tileBridgePortalArgs(portal),
      );
    },
    clearShooterTileBridgePortal(tileId) {
      requireAlive();
      return rustEngine.clear_shooter_tile_bridge_portal(
        uint32Number(tileId, "tile id"),
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

const TILE_KIND_CODES = Object.freeze({
  flat: 0,
  stair: 1,
  ramp: 2,
  ledge: 3,
  bridge: 4,
});

const TILE_RAMP_AXIS_CODES = Object.freeze({
  x: 0,
  y: 1,
});

function tileHeightSpanArgs(heightSpan: PhysicsBodyHeightSpan): [number, number, number] {
  return [
    uint32Number(heightSpan.floorId ?? 0, "tile heightSpan.floorId"),
    finiteNumber(heightSpan.elevation, "tile heightSpan.elevation"),
    nonNegativeNumber(heightSpan.height, "tile heightSpan.height"),
  ];
}

function tileHd2dMetadataArgs(
  metadata: ShooterTileHd2dMetadata,
): [number, boolean, boolean, boolean, number, boolean, number, number, number] {
  const kind = metadata.kind ?? (metadata.ramp !== undefined ? "ramp" : metadata.bridgePortal !== undefined ? "bridge" : "flat");
  const kindCode = TILE_KIND_CODES[kind];
  if (kindCode === undefined) {
    throw new Error("tile HD-2D kind must be one of flat, stair, ramp, ledge, or bridge.");
  }
  if (kind !== "ramp" && metadata.ramp !== undefined) {
    throw new Error("tile HD-2D ramp metadata requires kind to be ramp.");
  }
  if (kind === "ramp" && metadata.ramp === undefined) {
    throw new Error("tile HD-2D kind ramp requires ramp metadata.");
  }
  if (kind !== "bridge" && metadata.bridgePortal !== undefined) {
    throw new Error("tile HD-2D bridgePortal metadata requires kind to be bridge.");
  }
  const blocksMovement = booleanFlag(metadata.blocksMovement, "tile HD-2D blocksMovement", true);
  const ramp = metadata.ramp;
  const rampAxis = ramp === undefined ? 0 : TILE_RAMP_AXIS_CODES[ramp.axis ?? "x"];
  if (rampAxis === undefined) {
    throw new Error("tile HD-2D ramp axis must be x or y.");
  }
  return [
    kindCode,
    blocksMovement,
    booleanFlag(metadata.blocksProjectile, "tile HD-2D blocksProjectile", blocksMovement),
    booleanFlag(metadata.blocksVision, "tile HD-2D blocksVision", blocksMovement),
    nonNegativeNumber(metadata.occluderHeight ?? 0, "tile HD-2D occluderHeight"),
    ramp !== undefined,
    rampAxis,
    finiteNumber(ramp?.startElevation ?? 0, "tile HD-2D ramp.startElevation"),
    finiteNumber(ramp?.endElevation ?? 0, "tile HD-2D ramp.endElevation"),
  ];
}

function tileBridgePortalArgs(
  portal: ShooterTileBridgePortalMetadata,
): [number, number, number, number, number] {
  return [
    uint32Number(portal.lowerFloorId, "tile bridgePortal.lowerFloorId"),
    uint32Number(portal.upperFloorId, "tile bridgePortal.upperFloorId"),
    finiteNumber(portal.lowerElevation, "tile bridgePortal.lowerElevation"),
    finiteNumber(portal.upperElevation, "tile bridgePortal.upperElevation"),
    uint32Number(portal.navigationCost ?? 1, "tile bridgePortal.navigationCost"),
  ];
}

function booleanFlag(value: boolean | undefined, label: string, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean.`);
  }
  return value;
}

function queryTilemapNavigationWaypoint(
  rustEngine: Engine,
  query: TilemapNavigationWaypointQuery,
): TilemapNavigationWaypoint | undefined {
  const heightSpan = query.heightSpan === undefined
    ? undefined
    : tileHeightSpanArgs(query.heightSpan);
  const toHeightSpan = query.toHeightSpan === undefined
    ? undefined
    : tileHeightSpanArgs(query.toHeightSpan);
  if (toHeightSpan !== undefined && heightSpan === undefined) {
    throw new Error("tilemap navigation toHeightSpan requires heightSpan.");
  }
  const hit = heightSpan === undefined
    ? rustEngine.query_tilemap_navigation_waypoint(
      query.fromX,
      query.fromY,
      query.toX,
      query.toY,
    )
    : toHeightSpan === undefined
      ? rustEngine.query_tilemap_navigation_waypoint_with_height_span(
        query.fromX,
        query.fromY,
        query.toX,
        query.toY,
        ...heightSpan,
      )
      : rustEngine.query_tilemap_navigation_path_between_height_spans(
        query.fromX,
        query.fromY,
        query.toX,
        query.toY,
        ...heightSpan,
        ...toHeightSpan,
      );
  if (!hit) {
    return undefined;
  }
  return {
    x: rustEngine.physics_query_point_x(),
    y: rustEngine.physics_query_point_y(),
    distance: rustEngine.physics_query_distance(),
    ...(heightSpan === undefined || toHeightSpan !== undefined ? {} : {
      heightSpan: {
        floorId: heightSpan[0],
        elevation: heightSpan[1],
        height: heightSpan[2],
      },
    }),
  };
}

function queryTilemapNavigationPath(
  rustEngine: Engine,
  bridge: WasmBridge,
  query: TilemapNavigationPathQuery,
): TilemapNavigationPath | undefined {
  const heightSpan = query.heightSpan === undefined
    ? undefined
    : tileHeightSpanArgs(query.heightSpan);
  const toHeightSpan = query.toHeightSpan === undefined
    ? undefined
    : tileHeightSpanArgs(query.toHeightSpan);
  if (toHeightSpan !== undefined && heightSpan === undefined) {
    throw new Error("tilemap navigation toHeightSpan requires heightSpan.");
  }
  const hit = heightSpan === undefined
    ? rustEngine.query_tilemap_navigation_path(
      query.fromX,
      query.fromY,
      query.toX,
      query.toY,
    )
    : toHeightSpan === undefined
      ? rustEngine.query_tilemap_navigation_path_with_height_span(
        query.fromX,
        query.fromY,
        query.toX,
        query.toY,
        ...heightSpan,
      )
      : rustEngine.query_tilemap_navigation_path_between_height_spans(
        query.fromX,
        query.fromY,
        query.toX,
        query.toY,
        ...heightSpan,
        ...toHeightSpan,
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
    const point: TilemapNavigationPathPoint = {
      x: view.buffer[offset],
      y: view.buffer[offset + 1],
    };
    if (view.floatsPerPoint >= 5) {
      point.heightSpan = {
        floorId: view.buffer[offset + 2],
        elevation: view.buffer[offset + 3],
        height: view.buffer[offset + 4],
      };
    }
    points.push(point);
  }
  return points;
}
