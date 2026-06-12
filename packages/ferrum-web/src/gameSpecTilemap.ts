import { TILE_SLOPE_MIN_HORIZONTAL_SPAN } from "./gameSpecDefaults.js";
import {
  booleanValue,
  finiteNumber,
  gameSpecError,
  layerName,
  nonNegativeInteger,
  nonNegativeNumber,
  normalizedNumber,
  optionalObject,
  positiveNumber,
  requiredPositiveInteger,
} from "./gameSpecValidation.js";
import type {
  ResolvedShooterAtlasFrame,
  ResolvedShooterTileBridgePortalDefinition,
  ResolvedShooterTileDefinition,
  ResolvedShooterTileLayer,
  ResolvedShooterTileRampDefinition,
  ResolvedShooterTileSlopeDefinition,
  ResolvedShooterTilemap,
  ShooterTileKind,
  ShooterTileRampAxis,
} from "./gameSpecTypes.js";
import { atlasFrameReference } from "./gameSpecAtlas.js";

export interface ShooterTilemapResolveOptions {
  defaultHeight?: number;
}

const TILE_KINDS = new Set<ShooterTileKind>(["flat", "stair", "ramp", "ledge", "bridge"]);
const TILE_RAMP_AXES = new Set<ShooterTileRampAxis>(["x", "y"]);

export function shooterTilemap(
  value: unknown,
  path: string,
  atlasFrames: Record<string, ResolvedShooterAtlasFrame>,
  options: ShooterTilemapResolveOptions = {},
): ResolvedShooterTilemap | undefined {
  if (value === undefined) {
    return undefined;
  }

  const tilemap = optionalObject(value, path);
  const origin = optionalObject(tilemap.origin, `${path}.origin`);
  const tileWidth = positiveNumber(tilemap.tileWidth, `${path}.tileWidth`, 32);
  const tileHeight = positiveNumber(tilemap.tileHeight, `${path}.tileHeight`, 32);
  const originX = finiteNumber(origin.x, `${path}.origin.x`, 0);
  const originY = finiteNumber(origin.y, `${path}.origin.y`, 0);
  const tiles = tileDefinitions(tilemap.tiles, `${path}.tiles`, atlasFrames, {
    defaultHeight: options.defaultHeight ?? 0,
  });
  const tileIds = new Set(tiles.map((tile) => tile.id));
  const layers = tilemapLayers(tilemap.layers, `${path}.layers`, {
    tileWidth,
    tileHeight,
    originX,
    originY,
    tileIds,
  });

  return { tiles, layers };
}

function tileDefinitions(
  value: unknown,
  path: string,
  atlasFrames: Record<string, ResolvedShooterAtlasFrame>,
  options: Required<ShooterTilemapResolveOptions>,
): ResolvedShooterTileDefinition[] {
  const tiles = optionalObject(value, path);
  const resolved: ResolvedShooterTileDefinition[] = [];

  for (const [idText, tileValue] of Object.entries(tiles)) {
    const tilePath = `${path}.${idText}`;
    const id = tileId(idText, tilePath);
    const tile = optionalObject(tileValue, tilePath);
    const elevation = finiteNumber(tile.elevation, `${tilePath}.elevation`, 0);
    const height = nonNegativeNumber(tile.height, `${tilePath}.height`, options.defaultHeight);
    const kind = tileKind(tile.kind, `${tilePath}.kind`);
    const ramp = tileRamp(tile.ramp, `${tilePath}.ramp`, kind, elevation);
    const bridgePortal = tileBridgePortal(tile.bridgePortal, `${tilePath}.bridgePortal`, kind, {
      floor: layerName(tile.floor, `${tilePath}.floor`, "default"),
      elevation,
      height,
    });
    const blocksMovement = booleanValue(tile.blocksMovement, `${tilePath}.blocksMovement`, true);
    const slope = tileSlope(tile.slope, `${tilePath}.slope`);
    const oneWayPlatform = booleanValue(tile.oneWayPlatform, `${tilePath}.oneWayPlatform`, false);
    if (slope && oneWayPlatform) {
      throw gameSpecError(`${tilePath}.oneWayPlatform`, "cannot be combined with slope");
    }
    resolved.push({
      id,
      frame: atlasFrameReference(tile.frame, `${tilePath}.frame`, atlasFrames),
      color: tileColor(tile.color, `${tilePath}.color`),
      floor: bridgePortal?.lowerFloor ?? layerName(tile.floor, `${tilePath}.floor`, "default"),
      elevation,
      height,
      kind,
      blocksMovement,
      blocksProjectile: booleanValue(tile.blocksProjectile, `${tilePath}.blocksProjectile`, blocksMovement),
      blocksVision: booleanValue(tile.blocksVision, `${tilePath}.blocksVision`, blocksMovement),
      occluderHeight: nonNegativeNumber(tile.occluderHeight, `${tilePath}.occluderHeight`, height),
      ...(ramp ? { ramp } : {}),
      ...(bridgePortal ? { bridgePortal } : {}),
      ...(slope ? { slope } : {}),
      ...(oneWayPlatform ? { oneWayPlatform } : {}),
    });
  }

  return resolved.sort((a, b) => a.id - b.id);
}

function tileBridgePortal(
  value: unknown,
  path: string,
  kind: ShooterTileKind,
  defaults: { floor: string; elevation: number; height: number },
): ResolvedShooterTileBridgePortalDefinition | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (kind !== "bridge") {
    throw gameSpecError(path, "requires kind to be bridge");
  }
  const portal = optionalObject(value, path);
  const lowerFloor = layerName(portal.lowerFloor, `${path}.lowerFloor`, defaults.floor);
  const upperFloor = layerName(portal.upperFloor, `${path}.upperFloor`, "bridge");
  if (lowerFloor === upperFloor) {
    throw gameSpecError(`${path}.upperFloor`, "must differ from bridgePortal.lowerFloor");
  }
  return {
    lowerFloor,
    upperFloor,
    lowerElevation: finiteNumber(portal.lowerElevation, `${path}.lowerElevation`, defaults.elevation),
    upperElevation: finiteNumber(
      portal.upperElevation,
      `${path}.upperElevation`,
      defaults.elevation + defaults.height,
    ),
    navigationCost: nonNegativeInteger(portal.navigationCost, `${path}.navigationCost`, 1),
  };
}

function tileId(value: string, path: string): number {
  if (/^[1-9]\d*$/.test(value)) {
    const id = Number(value);
    if (Number.isSafeInteger(id)) {
      return id;
    }
  }
  throw gameSpecError(path, "tile id must be a positive integer string");
}

function tileKind(value: unknown, path: string): ShooterTileKind {
  if (value === undefined) {
    return "flat";
  }
  if (typeof value === "string" && TILE_KINDS.has(value as ShooterTileKind)) {
    return value as ShooterTileKind;
  }
  throw gameSpecError(path, "must be one of flat, stair, ramp, ledge, or bridge");
}

function tileRamp(
  value: unknown,
  path: string,
  kind: ShooterTileKind,
  elevation: number,
): ResolvedShooterTileRampDefinition | undefined {
  if (value === undefined) {
    if (kind === "ramp") {
      throw gameSpecError(path, "is required when kind is ramp");
    }
    return undefined;
  }
  if (kind !== "ramp") {
    throw gameSpecError(path, "requires kind to be ramp");
  }
  const ramp = optionalObject(value, path);
  return {
    axis: tileRampAxis(ramp.axis, `${path}.axis`),
    startElevation: finiteNumber(ramp.startElevation, `${path}.startElevation`, elevation),
    endElevation: finiteNumber(ramp.endElevation, `${path}.endElevation`, elevation),
  };
}

function tileRampAxis(value: unknown, path: string): ShooterTileRampAxis {
  if (value === undefined) {
    return "x";
  }
  if (typeof value === "string" && TILE_RAMP_AXES.has(value as ShooterTileRampAxis)) {
    return value as ShooterTileRampAxis;
  }
  throw gameSpecError(path, "must be x or y");
}

function tileColor(value: unknown, path: string): [number, number, number, number] {
  if (value === undefined) {
    return [1, 1, 1, 1];
  }
  if (!Array.isArray(value) || value.length !== 4) {
    throw gameSpecError(path, "must be an array of four normalized numbers");
  }
  return [
    normalizedNumber(value[0], `${path}.0`),
    normalizedNumber(value[1], `${path}.1`),
    normalizedNumber(value[2], `${path}.2`),
    normalizedNumber(value[3], `${path}.3`),
  ];
}

function tileSlope(value: unknown, path: string): ResolvedShooterTileSlopeDefinition | undefined {
  if (value === undefined) {
    return undefined;
  }
  const slope = optionalObject(value, path);
  const x0 = normalizedNumber(slope.x0, `${path}.x0`);
  const y0 = normalizedNumber(slope.y0, `${path}.y0`);
  const x1 = normalizedNumber(slope.x1, `${path}.x1`);
  const y1 = normalizedNumber(slope.y1, `${path}.y1`);
  if (Math.abs(x1 - x0) <= TILE_SLOPE_MIN_HORIZONTAL_SPAN) {
    throw gameSpecError(`${path}.x1`, "must differ from slope.x0");
  }
  return { x0, y0, x1, y1 };
}

interface TilemapLayerDefaults {
  tileWidth: number;
  tileHeight: number;
  originX: number;
  originY: number;
  tileIds: Set<number>;
}

function tilemapLayers(
  value: unknown,
  path: string,
  defaults: TilemapLayerDefaults,
): ResolvedShooterTileLayer[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw gameSpecError(path, "must be an array");
  }

  return value.map((layerValue, index) => {
    const layerPath = `${path}.${index}`;
    const layer = optionalObject(layerValue, layerPath);
    const origin = optionalObject(layer.origin, `${layerPath}.origin`);
    const columns = requiredPositiveInteger(layer.columns, `${layerPath}.columns`);
    const rows = requiredPositiveInteger(layer.rows, `${layerPath}.rows`);
    const collision = booleanValue(layer.collision, `${layerPath}.collision`, false);
    const collisionOnly = booleanValue(layer.collisionOnly, `${layerPath}.collisionOnly`, false);
    if (collisionOnly && !collision) {
      throw gameSpecError(`${layerPath}.collisionOnly`, "requires collision to be true");
    }
    return {
      index,
      name: layerName(layer.name, `${layerPath}.name`, `layer-${index}`),
      columns,
      rows,
      tileWidth: positiveNumber(layer.tileWidth, `${layerPath}.tileWidth`, defaults.tileWidth),
      tileHeight: positiveNumber(layer.tileHeight, `${layerPath}.tileHeight`, defaults.tileHeight),
      originX: finiteNumber(origin.x, `${layerPath}.origin.x`, defaults.originX),
      originY: finiteNumber(origin.y, `${layerPath}.origin.y`, defaults.originY),
      collision,
      collisionOnly,
      data: tilemapLayerData(layer.data, layer.chunks, layerPath, {
        columns,
        rows,
        expectedLength: columns * rows,
        tileIds: defaults.tileIds,
        allowUndefinedTileIds: collisionOnly,
      }),
    };
  });
}

function tilemapLayerData(
  dataValue: unknown,
  chunkValue: unknown,
  layerPath: string,
  options: {
    columns: number;
    rows: number;
    expectedLength: number;
    tileIds: Set<number>;
    allowUndefinedTileIds: boolean;
  },
): number[] {
  if (dataValue !== undefined && chunkValue !== undefined) {
    throw gameSpecError(`${layerPath}.chunks`, "cannot be combined with data");
  }
  if (chunkValue !== undefined) {
    return tilemapLayerChunkData(chunkValue, `${layerPath}.chunks`, options);
  }
  return tilemapLayerFlatData(dataValue, `${layerPath}.data`, options);
}

function tilemapLayerChunkData(
  value: unknown,
  path: string,
  options: {
    columns: number;
    rows: number;
    expectedLength: number;
    tileIds: Set<number>;
    allowUndefinedTileIds: boolean;
  },
): number[] {
  if (!Array.isArray(value)) {
    throw gameSpecError(path, "must be an array");
  }
  const data = new Array<number>(options.expectedLength).fill(0);
  for (const [index, chunkValue] of value.entries()) {
    const chunkPath = `${path}.${index}`;
    const chunk = optionalObject(chunkValue, chunkPath);
    const column = nonNegativeInteger(chunk.column, `${chunkPath}.column`, 0);
    const row = nonNegativeInteger(chunk.row, `${chunkPath}.row`, 0);
    const columns = requiredPositiveInteger(chunk.columns, `${chunkPath}.columns`);
    const rows = requiredPositiveInteger(chunk.rows, `${chunkPath}.rows`);
    const endColumn = column + columns;
    const endRow = row + rows;
    if (endColumn > options.columns) {
      throw gameSpecError(`${chunkPath}.columns`, "chunk exceeds layer columns");
    }
    if (endRow > options.rows) {
      throw gameSpecError(`${chunkPath}.rows`, "chunk exceeds layer rows");
    }
    const chunkData = tilemapLayerFlatData(chunk.data, `${chunkPath}.data`, {
      expectedLength: columns * rows,
      tileIds: options.tileIds,
      allowUndefinedTileIds: options.allowUndefinedTileIds,
    });
    for (let chunkRow = 0; chunkRow < rows; chunkRow += 1) {
      for (let chunkColumn = 0; chunkColumn < columns; chunkColumn += 1) {
        const sourceIndex = chunkRow * columns + chunkColumn;
        const targetIndex = (row + chunkRow) * options.columns + column + chunkColumn;
        data[targetIndex] = chunkData[sourceIndex];
      }
    }
  }
  return data;
}

function tilemapLayerFlatData(
  value: unknown,
  path: string,
  options: {
    expectedLength: number;
    tileIds: Set<number>;
    allowUndefinedTileIds: boolean;
  },
): number[] {
  if (!Array.isArray(value)) {
    throw gameSpecError(path, "must be an array");
  }
  if (value.length !== options.expectedLength) {
    throw gameSpecError(path, `must contain exactly ${options.expectedLength} tile ids`);
  }
  return value.map((tileValue, index) => {
    const tile = nonNegativeInteger(tileValue, `${path}.${index}`, 0);
    if (tile !== 0 && !options.allowUndefinedTileIds && !options.tileIds.has(tile)) {
      throw gameSpecError(`${path}.${index}`, "must reference a tile id in tilemap.tiles or be 0");
    }
    return tile;
  });
}
