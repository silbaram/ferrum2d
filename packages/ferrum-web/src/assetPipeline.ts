import { assetPipelineDiagnosticError, describeError } from "./diagnostics.js";
import type {
  ShooterAtlasFrameSpec,
  ShooterAtlasSpec,
  ShooterGameSpec,
  ShooterTileSlopeSpec,
  ShooterTileSpec,
  ShooterTilemapSpec,
} from "./gameSpec.js";

export type AsepriteAtlasFrameSizeSource = "frame" | "source";

export interface AsepriteAtlasImportOptions {
  texture: string | number;
  frameNamePrefix?: string;
  stripFrameExtension?: boolean;
  sizeSource?: AsepriteAtlasFrameSizeSource;
}

export interface AsepriteAtlasImportResult {
  atlas: ShooterAtlasSpec;
  frameNames: string[];
  image?: string;
  width: number;
  height: number;
}

export interface TiledTilesetFrameContext {
  firstGid: number;
  gid: number;
  localId: number;
  tilesetName: string;
}

export interface TiledLayerCompressionContext {
  compression: string;
  path: string;
  expectedByteLength: number;
}

export type TiledLayerDataDecoder = (
  data: Uint8Array,
  context: TiledLayerCompressionContext,
) => Uint8Array | ArrayBuffer;

export interface TiledTilemapImportOptions {
  externalTilesets?: Record<string, unknown>;
  texture?: string | number | ((context: TiledTilesetFrameContext) => string | number);
  frameNamePrefix?: string;
  frameNameForGid?: (context: TiledTilesetFrameContext) => string;
  decodeCompressedLayerData?: TiledLayerDataDecoder;
  collisionLayerNames?: readonly string[];
  includeHiddenLayers?: boolean;
  origin?: {
    x?: number;
    y?: number;
  };
}

export interface TiledTilemapImportResult {
  gameSpec: Pick<ShooterGameSpec, "atlas" | "tilemap">;
  atlas: ShooterAtlasSpec;
  tilemap: ShooterTilemapSpec;
  usedGids: number[];
  layerNames: string[];
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
}

export interface LDtkTilesetFrameContext {
  gameTileId: number;
  ldtkTileId: number;
  tilesetUid: number;
  tilesetIdentifier: string;
  srcX: number;
  srcY: number;
  relPath?: string;
}

export interface LDtkEntityInstance {
  identifier: string;
  iid?: string;
  defUid?: number;
  layerName: string;
  layerIndex: number;
  x: number;
  y: number;
  gridX: number;
  gridY: number;
  width: number;
  height: number;
  fields: Record<string, unknown>;
  fieldTypes: Record<string, string>;
}

export interface LDtkTilemapImportOptions {
  levelIdentifier?: string;
  levelIid?: string;
  levelIndex?: number;
  externalLevels?: Record<string, unknown>;
  texture?: string | number | ((context: LDtkTilesetFrameContext) => string | number);
  frameNamePrefix?: string;
  frameNameForTile?: (context: LDtkTilesetFrameContext) => string;
  collisionLayerNames?: readonly string[];
  includeHiddenLayers?: boolean;
  origin?: {
    x?: number;
    y?: number;
  };
}

export interface LDtkTilemapImportResult {
  gameSpec: Pick<ShooterGameSpec, "atlas" | "tilemap">;
  atlas: ShooterAtlasSpec;
  tilemap: ShooterTilemapSpec;
  usedTileIds: number[];
  layerNames: string[];
  entities: LDtkEntityInstance[];
  tilesetNames: string[];
  levelIdentifier: string;
  levelIid?: string;
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
}

interface AsepriteFrameEntry {
  rawName: string;
  value: JsonRecord;
  path: string;
}

interface TiledTileset {
  firstGid: number;
  name: string;
  tileWidth: number;
  tileHeight: number;
  imageWidth: number;
  imageHeight: number;
  columns: number;
  tileCount: number;
  tileSlopes: Map<number, ShooterTileSlopeSpec>;
  tileOneWayPlatforms: Set<number>;
  margin: number;
  spacing: number;
  path: string;
}

interface LDtkTileset {
  uid: number;
  identifier: string;
  tileWidth: number;
  tileHeight: number;
  imageWidth: number;
  imageHeight: number;
  padding: number;
  spacing: number;
  columns: number;
  relPath?: string;
  tileSlopes: Map<number, ShooterTileSlopeSpec>;
  tileOneWayPlatforms: Set<number>;
  path: string;
}

interface LDtkLevel {
  identifier: string;
  iid?: string;
  width: number;
  height: number;
  layers: unknown[];
  path: string;
}

interface LDtkTileRef {
  gameTileId: number;
  ldtkTileId: number;
  tileset: LDtkTileset;
  srcX: number;
  srcY: number;
  slope?: ShooterTileSlopeSpec;
  oneWayPlatform?: boolean;
  path: string;
}

type JsonRecord = Record<string, unknown>;

const ASEPRITE_ROOT_PATH = "assetPipeline.aseprite";
const TILED_ROOT_PATH = "assetPipeline.tiled";
const LDTK_ROOT_PATH = "assetPipeline.ldtk";
const TILED_GID_FLAG_MASK = 0xf0000000;
const TILED_GID_MASK = 0x0fffffff;
const LDTK_RAW_INT_GRID_SOLID_TILE_ID = 0xffffffff;

export function importAsepriteAtlas(
  input: unknown,
  options: AsepriteAtlasImportOptions,
): AsepriteAtlasImportResult {
  const texture = textureValue(options.texture, `${ASEPRITE_ROOT_PATH}.texture`);
  const root = objectValue(input, ASEPRITE_ROOT_PATH);
  const meta = objectValue(root.meta, `${ASEPRITE_ROOT_PATH}.meta`);
  const size = objectValue(meta.size, `${ASEPRITE_ROOT_PATH}.meta.size`);
  const width = positiveNumber(size.w, `${ASEPRITE_ROOT_PATH}.meta.size.w`);
  const height = positiveNumber(size.h, `${ASEPRITE_ROOT_PATH}.meta.size.h`);
  const image = optionalString(meta.image, `${ASEPRITE_ROOT_PATH}.meta.image`);
  const frames: Record<string, ShooterAtlasFrameSpec> = {};
  const frameNames: string[] = [];
  const usedNames = new Set<string>();

  for (const entry of asepriteFrames(root.frames, `${ASEPRITE_ROOT_PATH}.frames`)) {
    const frameName = normalizeFrameName(entry.rawName, options);
    if (frameName.length === 0) {
      throw assetPipelineDiagnosticError(entry.path, "frame name must not be empty");
    }
    if (usedNames.has(frameName)) {
      throw assetPipelineDiagnosticError(entry.path, `duplicate imported frame name '${frameName}'`);
    }
    usedNames.add(frameName);
    frameNames.push(frameName);
    frames[frameName] = asepriteFrameSpec(entry, texture, width, height, options.sizeSource ?? "frame");
  }

  return {
    atlas: { frames },
    frameNames,
    image,
    width,
    height,
  };
}

export function importAsepriteAtlasFrames(
  input: unknown,
  options: AsepriteAtlasImportOptions,
): Record<string, ShooterAtlasFrameSpec> {
  return importAsepriteAtlas(input, options).atlas.frames ?? {};
}

export function importTiledTilemap(
  input: unknown,
  options: TiledTilemapImportOptions = {},
): TiledTilemapImportResult {
  const root = objectValue(input, TILED_ROOT_PATH);
  const orientation = optionalString(root.orientation, `${TILED_ROOT_PATH}.orientation`);
  if (orientation !== undefined && orientation !== "orthogonal") {
    throw assetPipelineDiagnosticError(`${TILED_ROOT_PATH}.orientation`, "must be orthogonal");
  }
  if (root.infinite === true) {
    throw assetPipelineDiagnosticError(`${TILED_ROOT_PATH}.infinite`, "infinite Tiled maps are not supported");
  }

  const width = positiveInteger(root.width, `${TILED_ROOT_PATH}.width`);
  const height = positiveInteger(root.height, `${TILED_ROOT_PATH}.height`);
  const tileWidth = positiveNumber(root.tilewidth, `${TILED_ROOT_PATH}.tilewidth`);
  const tileHeight = positiveNumber(root.tileheight, `${TILED_ROOT_PATH}.tileheight`);
  const tilesets = tiledTilesets(root.tilesets, {
    path: `${TILED_ROOT_PATH}.tilesets`,
    externalTilesets: options.externalTilesets,
  });
  const usedGids = new Set<number>();
  const layerNames: string[] = [];
  const layers = tiledLayers(root.layers, {
    path: `${TILED_ROOT_PATH}.layers`,
    mapWidth: width,
    mapHeight: height,
    decodeCompressedLayerData: options.decodeCompressedLayerData,
    includeHiddenLayers: options.includeHiddenLayers === true,
    collisionLayerNames: new Set(options.collisionLayerNames ?? []),
    usedGids,
  });
  const sortedGids = [...usedGids].sort((a, b) => a - b);
  const atlasFrames: Record<string, ShooterAtlasFrameSpec> = {};
  const tiles: Record<string, ShooterTileSpec> = {};

  for (const gid of sortedGids) {
    const tileset = tilesetForGid(tilesets, gid, `${TILED_ROOT_PATH}.tilesets`);
    const localId = gid - tileset.firstGid;
    const context: TiledTilesetFrameContext = {
      firstGid: tileset.firstGid,
      gid,
      localId,
      tilesetName: tileset.name,
    };
    const frameName = tiledFrameName(context, options);
    const slope = tileset.tileSlopes.get(localId);
    const oneWayPlatform = tileset.tileOneWayPlatforms.has(localId);
    if (slope && oneWayPlatform) {
      throw assetPipelineDiagnosticError(
        `${tileset.path}.tiles`,
        `tile id ${localId} cannot define both slope and oneWayPlatform`,
      );
    }
    tiles[String(gid)] = {
      frame: frameName,
      ...(slope ? { slope } : {}),
      ...(oneWayPlatform ? { oneWayPlatform } : {}),
    };
    atlasFrames[frameName] = tiledAtlasFrameSpec(tileset, context, options);
  }

  for (const layer of layers) {
    layerNames.push(layer.name ?? `layer-${layerNames.length}`);
  }

  const tilemap: ShooterTilemapSpec = {
    tileWidth,
    tileHeight,
    origin: {
      x: finiteNumber(options.origin?.x, `${TILED_ROOT_PATH}.origin.x`, 0),
      y: finiteNumber(options.origin?.y, `${TILED_ROOT_PATH}.origin.y`, 0),
    },
    tiles,
    layers,
  };
  const atlas: ShooterAtlasSpec = { frames: atlasFrames };

  return {
    gameSpec: { atlas, tilemap },
    atlas,
    tilemap,
    usedGids: sortedGids,
    layerNames,
    width,
    height,
    tileWidth,
    tileHeight,
  };
}

export function importTiledGameSpec(
  input: unknown,
  options: TiledTilemapImportOptions = {},
): Pick<ShooterGameSpec, "atlas" | "tilemap"> {
  return importTiledTilemap(input, options).gameSpec;
}

export function importLDtkTilemap(
  input: unknown,
  options: LDtkTilemapImportOptions = {},
): LDtkTilemapImportResult {
  const root = objectValue(input, LDTK_ROOT_PATH);
  const tilesets = ldtkTilesets(root.defs, `${LDTK_ROOT_PATH}.defs`);
  const level = ldtkLevel(root, options);
  const collisionLayerNames = new Set(options.collisionLayerNames ?? []);
  const importedTiles = new Map<string, LDtkTileRef>();
  const layers: NonNullable<ShooterTilemapSpec["layers"]> = [];
  const entities: LDtkEntityInstance[] = [];
  const originX = finiteNumber(options.origin?.x, `${LDTK_ROOT_PATH}.origin.x`, 0);
  const originY = finiteNumber(options.origin?.y, `${LDTK_ROOT_PATH}.origin.y`, 0);

  for (const [index, entry] of level.layers.entries()) {
    const path = `${level.path}.layerInstances.${index}`;
    entities.push(...ldtkEntityLayer(entry, {
      path,
      fallbackName: `layer-${index}`,
      layerIndex: index,
      includeHiddenLayers: options.includeHiddenLayers === true,
      originX,
      originY,
    }));
    const imported = ldtkLayer(entry, {
      path,
      fallbackName: `layer-${index}`,
      tilesets,
      includeHiddenLayers: options.includeHiddenLayers === true,
      collisionLayerNames,
      importedTiles,
      originX,
      originY,
    });
    if (imported) {
      layers.push(imported);
    }
  }

  if (layers.length === 0) {
    throw assetPipelineDiagnosticError(`${level.path}.layerInstances`, "must contain at least one supported LDtk tile layer");
  }

  const atlasFrames: Record<string, ShooterAtlasFrameSpec> = {};
  const tiles: Record<string, ShooterTileSpec> = {};
  const usedFrameNames = new Set<string>();
  const tileRefs = [...importedTiles.values()].sort((a, b) => a.gameTileId - b.gameTileId);

  for (const tile of tileRefs) {
    const context = ldtkTilesetFrameContext(tile);
    const frameName = ldtkFrameName(context, options);
    if (usedFrameNames.has(frameName)) {
      throw assetPipelineDiagnosticError(tile.path, `duplicate imported frame name '${frameName}'`);
    }
    usedFrameNames.add(frameName);
    tiles[String(tile.gameTileId)] = {
      frame: frameName,
      ...(tile.slope ? { slope: tile.slope } : {}),
      ...(tile.oneWayPlatform ? { oneWayPlatform: true } : {}),
    };
    atlasFrames[frameName] = ldtkAtlasFrameSpec(tile, context, options);
  }

  const tileWidth = layers[0]?.tileWidth ?? 1;
  const tileHeight = layers[0]?.tileHeight ?? 1;
  const tilemap: ShooterTilemapSpec = {
    tileWidth,
    tileHeight,
    origin: { x: originX, y: originY },
    tiles,
    layers,
  };
  const atlas: ShooterAtlasSpec = { frames: atlasFrames };

  return {
    gameSpec: { atlas, tilemap },
    atlas,
    tilemap,
    usedTileIds: tileRefs.map((tile) => tile.gameTileId),
    layerNames: layers.map((layer, index) => layer.name ?? `layer-${index}`),
    entities,
    tilesetNames: [...new Set(tileRefs.map((tile) => tile.tileset.identifier))],
    levelIdentifier: level.identifier,
    levelIid: level.iid,
    width: level.width,
    height: level.height,
    tileWidth,
    tileHeight,
  };
}

export function importLDtkGameSpec(
  input: unknown,
  options: LDtkTilemapImportOptions = {},
): Pick<ShooterGameSpec, "atlas" | "tilemap"> {
  return importLDtkTilemap(input, options).gameSpec;
}

function asepriteFrames(value: unknown, path: string): AsepriteFrameEntry[] {
  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      const entryPath = `${path}.${index}`;
      const record = objectValue(entry, entryPath);
      return {
        rawName: requiredString(record.filename, `${entryPath}.filename`),
        value: record,
        path: entryPath,
      };
    });
  }

  const record = objectValue(value, path);
  return Object.entries(record).map(([rawName, entry]) => ({
    rawName,
    value: objectValue(entry, `${path}.${rawName}`),
    path: `${path}.${rawName}`,
  }));
}

function asepriteFrameSpec(
  entry: AsepriteFrameEntry,
  texture: string | number,
  atlasWidth: number,
  atlasHeight: number,
  sizeSource: AsepriteAtlasFrameSizeSource,
): ShooterAtlasFrameSpec {
  const rotated = optionalBoolean(entry.value.rotated, `${entry.path}.rotated`);
  if (rotated === true) {
    throw assetPipelineDiagnosticError(entry.path, "rotated Aseprite frames are not supported");
  }

  const frame = objectValue(entry.value.frame, `${entry.path}.frame`);
  const x = nonNegativeNumber(frame.x, `${entry.path}.frame.x`);
  const y = nonNegativeNumber(frame.y, `${entry.path}.frame.y`);
  const width = positiveNumber(frame.w, `${entry.path}.frame.w`);
  const height = positiveNumber(frame.h, `${entry.path}.frame.h`);
  if (x + width > atlasWidth) {
    throw assetPipelineDiagnosticError(`${entry.path}.frame.w`, "frame exceeds atlas width");
  }
  if (y + height > atlasHeight) {
    throw assetPipelineDiagnosticError(`${entry.path}.frame.h`, "frame exceeds atlas height");
  }

  const sourceSize = optionalObject(entry.value.sourceSize, `${entry.path}.sourceSize`);
  const displayWidth = sizeSource === "source" && sourceSize.w !== undefined
    ? positiveNumber(sourceSize.w, `${entry.path}.sourceSize.w`)
    : width;
  const displayHeight = sizeSource === "source" && sourceSize.h !== undefined
    ? positiveNumber(sourceSize.h, `${entry.path}.sourceSize.h`)
    : height;

  return {
    texture,
    uv: {
      u0: x / atlasWidth,
      v0: y / atlasHeight,
      u1: (x + width) / atlasWidth,
      v1: (y + height) / atlasHeight,
    },
    size: {
      width: displayWidth,
      height: displayHeight,
    },
  };
}

function normalizeFrameName(rawName: string, options: AsepriteAtlasImportOptions): string {
  const stripped = options.stripFrameExtension === false
    ? rawName
    : rawName.replace(/\.[^/.\\]+$/, "");
  return `${options.frameNamePrefix ?? ""}${stripped}`;
}

function tiledTilesets(
  value: unknown,
  options: { path: string; externalTilesets: Record<string, unknown> | undefined },
): TiledTileset[] {
  const entries = arrayValue(value, options.path);
  if (entries.length === 0) {
    throw assetPipelineDiagnosticError(options.path, "must contain at least one tileset");
  }

  return entries.map((entry, index) => {
    const entryPath = `${options.path}.${index}`;
    const tileset = tiledTilesetRecord(entry, {
      path: entryPath,
      externalTilesets: options.externalTilesets,
    });
    const { firstGid, record, metadataPath } = tileset;
    const name = requiredString(record.name, `${metadataPath}.name`);
    const tileWidth = positiveNumber(record.tilewidth, `${metadataPath}.tilewidth`);
    const tileHeight = positiveNumber(record.tileheight, `${metadataPath}.tileheight`);
    const imageWidth = positiveNumber(record.imagewidth, `${metadataPath}.imagewidth`);
    const imageHeight = positiveNumber(record.imageheight, `${metadataPath}.imageheight`);
    const columns = positiveInteger(record.columns, `${metadataPath}.columns`);
    const tileCount = positiveInteger(record.tilecount, `${metadataPath}.tilecount`);
    const tileSlopes = tiledTileSlopes(record.tiles, {
      path: `${metadataPath}.tiles`,
      tileCount,
    });
    const tileOneWayPlatforms = tiledTileOneWayPlatforms(record.tiles, {
      path: `${metadataPath}.tiles`,
      tileCount,
    });
    return {
      firstGid,
      name,
      tileWidth,
      tileHeight,
      imageWidth,
      imageHeight,
      columns,
      tileCount,
      tileSlopes,
      tileOneWayPlatforms,
      margin: nonNegativeNumber(record.margin ?? 0, `${metadataPath}.margin`),
      spacing: nonNegativeNumber(record.spacing ?? 0, `${metadataPath}.spacing`),
      path: entryPath,
    };
  }).sort((a, b) => a.firstGid - b.firstGid);
}

function tiledTilesetRecord(
  value: unknown,
  options: { path: string; externalTilesets: Record<string, unknown> | undefined },
): { firstGid: number; record: JsonRecord; metadataPath: string } {
  const mapEntry = objectValue(value, options.path);
  const firstGid = positiveInteger(mapEntry.firstgid, `${options.path}.firstgid`);
  const source = optionalString(mapEntry.source, `${options.path}.source`);
  if (source === undefined) {
    return { firstGid, record: mapEntry, metadataPath: options.path };
  }

  const externalTileset = options.externalTilesets?.[source];
  if (externalTileset === undefined) {
    throw assetPipelineDiagnosticError(
      `${options.path}.source`,
      `external Tiled tileset ${source} must be provided in options.externalTilesets`,
    );
  }
  const metadataPath = `${TILED_ROOT_PATH}.externalTilesets.${source}`;
  const record = objectValue(externalTileset, metadataPath);
  return { firstGid, record, metadataPath };
}

function tiledTileSlopes(
  value: unknown,
  options: { path: string; tileCount: number },
): Map<number, ShooterTileSlopeSpec> {
  const slopes = new Map<number, ShooterTileSlopeSpec>();
  if (value === undefined) {
    return slopes;
  }

  for (const [index, entry] of arrayValue(value, options.path).entries()) {
    const tilePath = `${options.path}.${index}`;
    const tile = objectValue(entry, tilePath);
    const slope = tiledTileSlope(tile.properties, `${tilePath}.properties`);
    if (!slope) {
      continue;
    }
    const id = nonNegativeInteger(tile.id, `${tilePath}.id`);
    if (id >= options.tileCount) {
      throw assetPipelineDiagnosticError(`${tilePath}.id`, "must reference a tile inside the tileset");
    }
    if (slopes.has(id)) {
      throw assetPipelineDiagnosticError(`${tilePath}.id`, `duplicate slope metadata for tile id ${id}`);
    }
    slopes.set(id, slope);
  }
  return slopes;
}

function tiledTileOneWayPlatforms(value: unknown, options: { path: string; tileCount: number }): Set<number> {
  const oneWayPlatforms = new Set<number>();
  if (value === undefined) {
    return oneWayPlatforms;
  }

  for (const [index, entry] of arrayValue(value, options.path).entries()) {
    const tilePath = `${options.path}.${index}`;
    const tile = objectValue(entry, tilePath);
    const oneWayPlatform = tiledBooleanProperty(tile.properties, "oneWayPlatform", `${tilePath}.properties`);
    if (oneWayPlatform !== true) {
      continue;
    }
    const id = nonNegativeInteger(tile.id, `${tilePath}.id`);
    if (id >= options.tileCount) {
      throw assetPipelineDiagnosticError(`${tilePath}.id`, "must reference a tile inside the tileset");
    }
    if (oneWayPlatforms.has(id)) {
      throw assetPipelineDiagnosticError(`${tilePath}.id`, `duplicate oneWayPlatform metadata for tile id ${id}`);
    }
    oneWayPlatforms.add(id);
  }
  return oneWayPlatforms;
}

function tiledLayers(
  value: unknown,
  options: {
    path: string;
    mapWidth: number;
    mapHeight: number;
    decodeCompressedLayerData: TiledLayerDataDecoder | undefined;
    includeHiddenLayers: boolean;
    collisionLayerNames: Set<string>;
    usedGids: Set<number>;
  },
): NonNullable<ShooterTilemapSpec["layers"]> {
  return arrayValue(value, options.path).flatMap((entry, index) => {
    const entryPath = `${options.path}.${index}`;
    const layer = objectValue(entry, entryPath);
    const type = optionalString(layer.type, `${entryPath}.type`) ?? "tilelayer";
    if (type !== "tilelayer") {
      return [];
    }
    if (layer.chunks !== undefined) {
      throw assetPipelineDiagnosticError(`${entryPath}.chunks`, "infinite/chunked Tiled layers are not supported");
    }
    if (layer.visible === false && !options.includeHiddenLayers) {
      return [];
    }
    const columns = positiveInteger(layer.width, `${entryPath}.width`);
    const rows = positiveInteger(layer.height, `${entryPath}.height`);
    if (columns !== options.mapWidth) {
      throw assetPipelineDiagnosticError(`${entryPath}.width`, "must match map width");
    }
    if (rows !== options.mapHeight) {
      throw assetPipelineDiagnosticError(`${entryPath}.height`, "must match map height");
    }
    const data = tiledLayerData(layer, {
      path: entryPath,
      expectedLength: columns * rows,
      decodeCompressedLayerData: options.decodeCompressedLayerData,
      usedGids: options.usedGids,
    });
    const name = optionalString(layer.name, `${entryPath}.name`) ?? `layer-${index}`;
    return [{
      name,
      columns,
      rows,
      collision: isCollisionLayer(layer, name, options.collisionLayerNames, entryPath),
      data,
    }];
  });
}

function tiledLayerData(
  layer: JsonRecord,
  options: {
    path: string;
    expectedLength: number;
    decodeCompressedLayerData: TiledLayerDataDecoder | undefined;
    usedGids: Set<number>;
  },
): number[] {
  const values = tiledLayerDataValues(layer, options);
  if (values.length !== options.expectedLength) {
    throw assetPipelineDiagnosticError(`${options.path}.data`, `must contain exactly ${options.expectedLength} tile ids`);
  }
  return values.map((value, index) => {
    const path = `${options.path}.data.${index}`;
    const rawGid = nonNegativeInteger(value, path);
    const flags = rawGid & TILED_GID_FLAG_MASK;
    if (flags !== 0) {
      throw assetPipelineDiagnosticError(path, "flipped/rotated Tiled gids are not supported");
    }
    const gid = rawGid & TILED_GID_MASK;
    if (gid > 0) {
      options.usedGids.add(gid);
    }
    return gid;
  });
}

function tiledLayerDataValues(
  layer: JsonRecord,
  options: {
    path: string;
    expectedLength: number;
    decodeCompressedLayerData: TiledLayerDataDecoder | undefined;
  },
): unknown[] {
  const compression = optionalString(layer.compression, `${options.path}.compression`);
  const encoding = optionalString(layer.encoding, `${options.path}.encoding`);
  if (encoding === undefined) {
    if (compression !== undefined) {
      throw assetPipelineDiagnosticError(`${options.path}.compression`, "compressed Tiled layer data requires base64 encoding");
    }
    return arrayValue(layer.data, `${options.path}.data`);
  }
  if (encoding !== "base64") {
    throw assetPipelineDiagnosticError(`${options.path}.encoding`, "must be base64 or omitted");
  }
  return tiledBase64LayerData(requiredString(layer.data, `${options.path}.data`), {
    path: `${options.path}.data`,
    compressionPath: `${options.path}.compression`,
    expectedLength: options.expectedLength,
    compression,
    decodeCompressedLayerData: options.decodeCompressedLayerData,
  });
}

function tiledBase64LayerData(
  value: string,
  options: {
    path: string;
    compressionPath: string;
    expectedLength: number;
    compression: string | undefined;
    decodeCompressedLayerData: TiledLayerDataDecoder | undefined;
  },
): number[] {
  const expectedByteLength = options.expectedLength * 4;
  const bytes = decodeTiledLayerBytes(decodeBase64Bytes(value, options.path), {
    path: options.path,
    compressionPath: options.compressionPath,
    expectedByteLength,
    compression: options.compression,
    decodeCompressedLayerData: options.decodeCompressedLayerData,
  });
  if (bytes.byteLength !== expectedByteLength) {
    throw assetPipelineDiagnosticError(options.path, `must decode to exactly ${expectedByteLength} bytes`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: options.expectedLength }, (_, index) => view.getUint32(index * 4, true));
}

function decodeTiledLayerBytes(
  bytes: Uint8Array,
  options: {
    path: string;
    compressionPath: string;
    expectedByteLength: number;
    compression: string | undefined;
    decodeCompressedLayerData: TiledLayerDataDecoder | undefined;
  },
): Uint8Array {
  if (options.compression === undefined) {
    return bytes;
  }
  if (!options.decodeCompressedLayerData) {
    throw assetPipelineDiagnosticError(
      options.compressionPath,
      "compressed Tiled layer data requires options.decodeCompressedLayerData",
    );
  }
  try {
    return normalizeDecodedBytes(options.decodeCompressedLayerData(bytes, {
      compression: options.compression,
      path: options.path,
      expectedByteLength: options.expectedByteLength,
    }));
  } catch (error) {
    throw assetPipelineDiagnosticError(
      options.compressionPath,
      `compressed Tiled layer decode failed: ${describeError(error)}`,
    );
  }
}

function normalizeDecodedBytes(value: Uint8Array | ArrayBuffer): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function decodeBase64Bytes(value: string, path: string): Uint8Array {
  const compact = value.replace(/\s+/g, "");
  let decoded: string;
  try {
    decoded = globalThis.atob(compact);
  } catch {
    throw assetPipelineDiagnosticError(path, "must be valid base64");
  }
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function isCollisionLayer(
  layer: JsonRecord,
  name: string,
  collisionLayerNames: Set<string>,
  path: string,
): boolean {
  const collisionProperty = tiledBooleanProperty(layer.properties, "collision", `${path}.properties`);
  return collisionProperty ?? collisionLayerNames.has(name);
}

function tiledBooleanProperty(value: unknown, name: string, path: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  for (const [index, entry] of arrayValue(value, path).entries()) {
    const propertyPath = `${path}.${index}`;
    const property = objectValue(entry, propertyPath);
    const propertyName = optionalString(property.name, `${propertyPath}.name`);
    if (propertyName !== name) {
      continue;
    }
    return optionalBoolean(property.value, `${propertyPath}.value`);
  }
  return undefined;
}

function tiledTileSlope(value: unknown, path: string): ShooterTileSlopeSpec | undefined {
  if (value === undefined) {
    return undefined;
  }
  return tileSlopeFromEndpointProperties(
    tiledNumberProperty(value, "slopeX0", path),
    tiledNumberProperty(value, "slopeY0", path),
    tiledNumberProperty(value, "slopeX1", path),
    tiledNumberProperty(value, "slopeY1", path),
    path,
  );
}

function tiledNumberProperty(
  value: unknown,
  name: string,
  path: string,
): { value: unknown; path: string } | undefined {
  for (const [index, entry] of arrayValue(value, path).entries()) {
    const propertyPath = `${path}.${index}`;
    const property = objectValue(entry, propertyPath);
    const propertyName = optionalString(property.name, `${propertyPath}.name`);
    if (propertyName !== name) {
      continue;
    }
    return { value: property.value, path: `${propertyPath}.value` };
  }
  return undefined;
}

function tilesetForGid(tilesets: readonly TiledTileset[], gid: number, path: string): TiledTileset {
  let result: TiledTileset | undefined;
  for (const tileset of tilesets) {
    if (tileset.firstGid <= gid) {
      result = tileset;
    }
  }
  if (!result || gid >= result.firstGid + result.tileCount) {
    throw assetPipelineDiagnosticError(path, `gid ${gid} must reference an imported tileset`);
  }
  return result;
}

function tiledFrameName(context: TiledTilesetFrameContext, options: TiledTilemapImportOptions): string {
  const frameName = options.frameNameForGid?.(context)
    ?? `${options.frameNamePrefix ?? ""}${context.tilesetName}.${context.localId}`;
  if (frameName.trim().length === 0) {
    throw assetPipelineDiagnosticError(`${TILED_ROOT_PATH}.tilesets`, "frameNameForGid must return a non-empty string");
  }
  return frameName;
}

function tiledAtlasFrameSpec(
  tileset: TiledTileset,
  context: TiledTilesetFrameContext,
  options: TiledTilemapImportOptions,
): ShooterAtlasFrameSpec {
  const column = context.localId % tileset.columns;
  const row = Math.floor(context.localId / tileset.columns);
  const x = tileset.margin + column * (tileset.tileWidth + tileset.spacing);
  const y = tileset.margin + row * (tileset.tileHeight + tileset.spacing);
  if (x + tileset.tileWidth > tileset.imageWidth) {
    throw assetPipelineDiagnosticError(`${tileset.path}.imagewidth`, `gid ${context.gid} exceeds tileset image width`);
  }
  if (y + tileset.tileHeight > tileset.imageHeight) {
    throw assetPipelineDiagnosticError(`${tileset.path}.imageheight`, `gid ${context.gid} exceeds tileset image height`);
  }
  return {
    texture: tiledTexture(context, options),
    uv: {
      u0: x / tileset.imageWidth,
      v0: y / tileset.imageHeight,
      u1: (x + tileset.tileWidth) / tileset.imageWidth,
      v1: (y + tileset.tileHeight) / tileset.imageHeight,
    },
    size: {
      width: tileset.tileWidth,
      height: tileset.tileHeight,
    },
  };
}

function tiledTexture(context: TiledTilesetFrameContext, options: TiledTilemapImportOptions): string | number {
  if (typeof options.texture === "function") {
    return textureValue(options.texture(context), `${TILED_ROOT_PATH}.texture`);
  }
  if (options.texture !== undefined) {
    return textureValue(options.texture, `${TILED_ROOT_PATH}.texture`);
  }
  return context.tilesetName;
}

function ldtkTilesets(value: unknown, path: string): Map<number, LDtkTileset> {
  const defs = objectValue(value, path);
  const entries = arrayValue(defs.tilesets, `${path}.tilesets`);
  if (entries.length === 0) {
    throw assetPipelineDiagnosticError(`${path}.tilesets`, "must contain at least one tileset");
  }

  const tilesets = new Map<number, LDtkTileset>();
  for (const [index, entry] of entries.entries()) {
    const entryPath = `${path}.tilesets.${index}`;
    const record = objectValue(entry, entryPath);
    const uid = positiveInteger(record.uid, `${entryPath}.uid`);
    if (tilesets.has(uid)) {
      throw assetPipelineDiagnosticError(`${entryPath}.uid`, `duplicate LDtk tileset uid ${uid}`);
    }
    const tileWidth = positiveNumber(record.tileGridSize, `${entryPath}.tileGridSize`);
    const tileHeight = tileWidth;
    const imageWidth = positiveNumber(record.pxWid, `${entryPath}.pxWid`);
    const imageHeight = positiveNumber(record.pxHei, `${entryPath}.pxHei`);
    const padding = nonNegativeNumber(record.padding ?? 0, `${entryPath}.padding`);
    const spacing = nonNegativeNumber(record.spacing ?? 0, `${entryPath}.spacing`);
    const columns = ldtkTilesetColumns({
      imageWidth,
      tileWidth,
      padding,
      spacing,
      path: entryPath,
    });
    tilesets.set(uid, {
      uid,
      identifier: requiredString(record.identifier, `${entryPath}.identifier`),
      tileWidth,
      tileHeight,
      imageWidth,
      imageHeight,
      padding,
      spacing,
      columns,
      relPath: optionalNullableString(record.relPath, `${entryPath}.relPath`),
      tileSlopes: ldtkTileSlopes(record.customData, `${entryPath}.customData`),
      tileOneWayPlatforms: ldtkTileOneWayPlatforms(record.customData, `${entryPath}.customData`),
      path: entryPath,
    });
  }
  return tilesets;
}

function ldtkTilesetColumns(options: {
  imageWidth: number;
  tileWidth: number;
  padding: number;
  spacing: number;
  path: string;
}): number {
  const usableWidth = options.imageWidth - options.padding * 2 + options.spacing;
  const step = options.tileWidth + options.spacing;
  const columns = Math.floor(usableWidth / step);
  if (columns <= 0) {
    throw assetPipelineDiagnosticError(`${options.path}.pxWid`, "tileset image must contain at least one tile column");
  }
  return columns;
}

function ldtkLevel(root: JsonRecord, options: LDtkTilemapImportOptions): LDtkLevel {
  const levels = arrayValue(root.levels, `${LDTK_ROOT_PATH}.levels`);
  if (levels.length === 0) {
    throw assetPipelineDiagnosticError(`${LDTK_ROOT_PATH}.levels`, "must contain at least one level");
  }

  const selectorCount = [
    options.levelIdentifier,
    options.levelIid,
    options.levelIndex,
  ].filter((value) => value !== undefined).length;
  if (selectorCount > 1) {
    throw assetPipelineDiagnosticError(
      `${LDTK_ROOT_PATH}.level`,
      "select only one of levelIdentifier, levelIid, or levelIndex",
    );
  }

  const index = ldtkLevelIndex(levels, options);
  const levelPath = `${LDTK_ROOT_PATH}.levels.${index}`;
  const record = objectValue(levels[index], levelPath);
  const externalRelPath = optionalString(record.externalRelPath, `${levelPath}.externalRelPath`);
  const layerSource = ldtkLevelLayerSource(record, {
    levelPath,
    externalRelPath,
    externalLevels: options.externalLevels,
  });

  return {
    identifier: optionalString(record.identifier, `${levelPath}.identifier`) ?? `level-${index}`,
    iid: optionalString(record.iid, `${levelPath}.iid`),
    width: positiveNumber(record.pxWid, `${levelPath}.pxWid`),
    height: positiveNumber(record.pxHei, `${levelPath}.pxHei`),
    layers: layerSource.layers,
    path: layerSource.path,
  };
}

function ldtkLevelLayerSource(
  level: JsonRecord,
  options: {
    levelPath: string;
    externalRelPath: string | undefined;
    externalLevels: Record<string, unknown> | undefined;
  },
): { layers: unknown[]; path: string } {
  if (level.layerInstances !== null || options.externalRelPath === undefined) {
    return {
      layers: arrayValue(level.layerInstances, `${options.levelPath}.layerInstances`),
      path: options.levelPath,
    };
  }

  const externalLevel = options.externalLevels?.[options.externalRelPath];
  if (externalLevel === undefined) {
    throw assetPipelineDiagnosticError(
      `${options.levelPath}.layerInstances`,
      `external LDtk level ${options.externalRelPath} must be provided in options.externalLevels`,
    );
  }

  const externalPath = `${LDTK_ROOT_PATH}.externalLevels.${options.externalRelPath}`;
  const externalRecord = objectValue(externalLevel, externalPath);
  return {
    layers: arrayValue(externalRecord.layerInstances, `${externalPath}.layerInstances`),
    path: externalPath,
  };
}

function ldtkLevelIndex(levels: unknown[], options: LDtkTilemapImportOptions): number {
  if (options.levelIdentifier !== undefined) {
    const levelIdentifier = requiredString(options.levelIdentifier, `${LDTK_ROOT_PATH}.levelIdentifier`);
    const found = levels.findIndex((entry, index) => {
      const level = objectValue(entry, `${LDTK_ROOT_PATH}.levels.${index}`);
      return level.identifier === levelIdentifier;
    });
    if (found < 0) {
      throw assetPipelineDiagnosticError(`${LDTK_ROOT_PATH}.levelIdentifier`, `level '${levelIdentifier}' was not found`);
    }
    return found;
  }

  if (options.levelIid !== undefined) {
    const levelIid = requiredString(options.levelIid, `${LDTK_ROOT_PATH}.levelIid`);
    const found = levels.findIndex((entry, index) => {
      const level = objectValue(entry, `${LDTK_ROOT_PATH}.levels.${index}`);
      return level.iid === levelIid;
    });
    if (found < 0) {
      throw assetPipelineDiagnosticError(`${LDTK_ROOT_PATH}.levelIid`, `level iid '${levelIid}' was not found`);
    }
    return found;
  }

  if (options.levelIndex !== undefined) {
    const levelIndex = nonNegativeInteger(options.levelIndex, `${LDTK_ROOT_PATH}.levelIndex`);
    if (levelIndex >= levels.length) {
      throw assetPipelineDiagnosticError(`${LDTK_ROOT_PATH}.levelIndex`, "must reference an existing level");
    }
    return levelIndex;
  }

  return 0;
}

function ldtkEntityLayer(
  value: unknown,
  options: {
    path: string;
    fallbackName: string;
    layerIndex: number;
    includeHiddenLayers: boolean;
    originX: number;
    originY: number;
  },
): LDtkEntityInstance[] {
  const layer = objectValue(value, options.path);
  const type = optionalString(layer.__type, `${options.path}.__type`) ?? "Tiles";
  if (type !== "Entities") {
    return [];
  }

  const visible = optionalBoolean(layer.visible, `${options.path}.visible`) ?? true;
  if (!visible && !options.includeHiddenLayers) {
    return [];
  }

  const name = optionalString(layer.__identifier, `${options.path}.__identifier`) ?? options.fallbackName;
  const gridSize = positiveNumber(layer.__gridSize, `${options.path}.__gridSize`);
  const offsetX = finiteNumber(layer.__pxTotalOffsetX, `${options.path}.__pxTotalOffsetX`, 0);
  const offsetY = finiteNumber(layer.__pxTotalOffsetY, `${options.path}.__pxTotalOffsetY`, 0);
  return arrayValue(layer.entityInstances, `${options.path}.entityInstances`).map((entry, index) => {
    return ldtkEntityInstance(entry, {
      path: `${options.path}.entityInstances.${index}`,
      layerName: name,
      layerIndex: options.layerIndex,
      gridSize,
      offsetX: options.originX + offsetX,
      offsetY: options.originY + offsetY,
    });
  });
}

function ldtkEntityInstance(
  value: unknown,
  options: {
    path: string;
    layerName: string;
    layerIndex: number;
    gridSize: number;
    offsetX: number;
    offsetY: number;
  },
): LDtkEntityInstance {
  const entity = objectValue(value, options.path);
  const [pxX, pxY] = ldtkNumberPair(entity.px, `${options.path}.px`);
  const [gridX, gridY] = ldtkOptionalIntegerPair(entity.__grid, `${options.path}.__grid`, [
    Math.floor(pxX / options.gridSize),
    Math.floor(pxY / options.gridSize),
  ]);
  const fields = ldtkEntityFields(entity.fieldInstances, `${options.path}.fieldInstances`);
  const defUid = entity.defUid === undefined
    ? undefined
    : positiveInteger(entity.defUid, `${options.path}.defUid`);

  return {
    identifier: requiredString(entity.__identifier, `${options.path}.__identifier`),
    ...(entity.iid === undefined ? {} : { iid: requiredString(entity.iid, `${options.path}.iid`) }),
    ...(defUid === undefined ? {} : { defUid }),
    layerName: options.layerName,
    layerIndex: options.layerIndex,
    x: options.offsetX + pxX,
    y: options.offsetY + pxY,
    gridX,
    gridY,
    width: positiveNumber(entity.width, `${options.path}.width`),
    height: positiveNumber(entity.height, `${options.path}.height`),
    fields: fields.values,
    fieldTypes: fields.types,
  };
}

function ldtkOptionalIntegerPair(
  value: unknown,
  path: string,
  fallback: [number, number],
): [number, number] {
  if (value === undefined) {
    return fallback;
  }
  const values = arrayValue(value, path);
  if (values.length !== 2) {
    throw assetPipelineDiagnosticError(path, "must contain exactly two integers");
  }
  return [
    nonNegativeInteger(values[0], `${path}.0`),
    nonNegativeInteger(values[1], `${path}.1`),
  ];
}

function ldtkEntityFields(value: unknown, path: string): {
  values: Record<string, unknown>;
  types: Record<string, string>;
} {
  const fields: Record<string, unknown> = {};
  const types: Record<string, string> = {};
  for (const [index, entry] of optionalArray(value, path).entries()) {
    const fieldPath = `${path}.${index}`;
    const field = objectValue(entry, fieldPath);
    const identifier = requiredString(field.__identifier, `${fieldPath}.__identifier`);
    if (Object.prototype.hasOwnProperty.call(fields, identifier)) {
      throw assetPipelineDiagnosticError(`${fieldPath}.__identifier`, `duplicate LDtk entity field '${identifier}'`);
    }
    fields[identifier] = field.__value;
    const type = optionalString(field.__type, `${fieldPath}.__type`);
    if (type !== undefined) {
      types[identifier] = type;
    }
  }
  return { values: fields, types };
}

function ldtkLayer(
  value: unknown,
  options: {
    path: string;
    fallbackName: string;
    tilesets: Map<number, LDtkTileset>;
    includeHiddenLayers: boolean;
    collisionLayerNames: Set<string>;
    importedTiles: Map<string, LDtkTileRef>;
    originX: number;
    originY: number;
  },
): NonNullable<ShooterTilemapSpec["layers"]>[number] | undefined {
  const layer = objectValue(value, options.path);
  const name = optionalString(layer.__identifier, `${options.path}.__identifier`) ?? options.fallbackName;
  const visible = optionalBoolean(layer.visible, `${options.path}.visible`) ?? true;
  if (!visible && !options.includeHiddenLayers) {
    return undefined;
  }

  const type = optionalString(layer.__type, `${options.path}.__type`) ?? "Tiles";
  if (type !== "Tiles" && type !== "AutoLayer" && type !== "IntGrid") {
    return undefined;
  }

  const tileEntries = ldtkLayerTileEntries(layer, options.path);
  if (tileEntries.length === 0) {
    if (type === "IntGrid") {
      if (options.collisionLayerNames.has(name)) {
        return ldtkRawIntGridLayer(layer, {
          path: options.path,
          name,
          originX: options.originX,
          originY: options.originY,
        });
      }
      return undefined;
    }
    return undefined;
  }

  const columns = positiveInteger(layer.__cWid, `${options.path}.__cWid`);
  const rows = positiveInteger(layer.__cHei, `${options.path}.__cHei`);
  const tileWidth = positiveNumber(layer.__gridSize, `${options.path}.__gridSize`);
  const tileHeight = tileWidth;
  const tilesetUid = positiveInteger(layer.__tilesetDefUid, `${options.path}.__tilesetDefUid`);
  const tileset = options.tilesets.get(tilesetUid);
  if (!tileset) {
    throw assetPipelineDiagnosticError(`${options.path}.__tilesetDefUid`, `tileset uid ${tilesetUid} was not found`);
  }

  const data = Array.from({ length: columns * rows }, () => 0);
  for (const tileEntry of tileEntries) {
    const tile = ldtkTileInstance(tileEntry.value, {
      path: tileEntry.path,
      tileset,
      gridSize: tileWidth,
      columns,
      rows,
      importedTiles: options.importedTiles,
    });
    const cellIndex = tile.row * columns + tile.column;
    if (data[cellIndex] !== 0) {
      throw assetPipelineDiagnosticError(tileEntry.path, "multiple LDtk tiles in the same grid cell are not supported");
    }
    data[cellIndex] = tile.ref.gameTileId;
  }

  return {
    name,
    columns,
    rows,
    tileWidth,
    tileHeight,
    origin: {
      x: options.originX + finiteNumber(layer.__pxTotalOffsetX, `${options.path}.__pxTotalOffsetX`, 0),
      y: options.originY + finiteNumber(layer.__pxTotalOffsetY, `${options.path}.__pxTotalOffsetY`, 0),
    },
    collision: options.collisionLayerNames.has(name),
    data,
  };
}

function ldtkRawIntGridLayer(
  layer: JsonRecord,
  options: {
    path: string;
    name: string;
    originX: number;
    originY: number;
  },
): NonNullable<ShooterTilemapSpec["layers"]>[number] {
  const columns = positiveInteger(layer.__cWid, `${options.path}.__cWid`);
  const rows = positiveInteger(layer.__cHei, `${options.path}.__cHei`);
  const tileWidth = positiveNumber(layer.__gridSize, `${options.path}.__gridSize`);
  const intGridCsv = ldtkIntGridCsv(layer.intGridCsv, {
    path: `${options.path}.intGridCsv`,
    expectedLength: columns * rows,
  });

  return {
    name: options.name,
    columns,
    rows,
    tileWidth,
    tileHeight: tileWidth,
    origin: {
      x: options.originX + finiteNumber(layer.__pxTotalOffsetX, `${options.path}.__pxTotalOffsetX`, 0),
      y: options.originY + finiteNumber(layer.__pxTotalOffsetY, `${options.path}.__pxTotalOffsetY`, 0),
    },
    collision: true,
    collisionOnly: true,
    data: intGridCsv.map((value) => value === 0 ? 0 : LDTK_RAW_INT_GRID_SOLID_TILE_ID),
  };
}

function ldtkIntGridCsv(
  value: unknown,
  options: { path: string; expectedLength: number },
): number[] {
  const values = arrayValue(value, options.path);
  if (values.length !== options.expectedLength) {
    throw assetPipelineDiagnosticError(options.path, `must contain exactly ${options.expectedLength} IntGrid values`);
  }
  return values.map((entry, index) => nonNegativeInteger(entry, `${options.path}.${index}`));
}

function ldtkLayerTileEntries(layer: JsonRecord, path: string): Array<{ value: unknown; path: string }> {
  const entries: Array<{ value: unknown; path: string }> = [];
  for (const [field, values] of [
    ["gridTiles", optionalArray(layer.gridTiles, `${path}.gridTiles`)],
    ["autoLayerTiles", optionalArray(layer.autoLayerTiles, `${path}.autoLayerTiles`)],
  ] as const) {
    values.forEach((value, index) => {
      entries.push({ value, path: `${path}.${field}.${index}` });
    });
  }
  return entries;
}

function ldtkTileInstance(
  value: unknown,
  options: {
    path: string;
    tileset: LDtkTileset;
    gridSize: number;
    columns: number;
    rows: number;
    importedTiles: Map<string, LDtkTileRef>;
  },
): { column: number; row: number; ref: LDtkTileRef } {
  const tile = objectValue(value, options.path);
  const flags = nonNegativeInteger(tile.f ?? 0, `${options.path}.f`);
  if (flags !== 0) {
    throw assetPipelineDiagnosticError(`${options.path}.f`, "flipped LDtk tiles are not supported");
  }
  const [pxX, pxY] = ldtkNumberPair(tile.px, `${options.path}.px`);
  const [srcX, srcY] = ldtkNumberPair(tile.src, `${options.path}.src`);
  const column = ldtkGridCoordinate(pxX, options.gridSize, `${options.path}.px.0`);
  const row = ldtkGridCoordinate(pxY, options.gridSize, `${options.path}.px.1`);
  if (column >= options.columns) {
    throw assetPipelineDiagnosticError(`${options.path}.px.0`, "tile exceeds layer width");
  }
  if (row >= options.rows) {
    throw assetPipelineDiagnosticError(`${options.path}.px.1`, "tile exceeds layer height");
  }

  const ldtkTileId = ldtkTileIdValue(tile.t, {
    path: `${options.path}.t`,
    srcX,
    srcY,
    tileset: options.tileset,
  });
  return {
    column,
    row,
    ref: ldtkImportedTile({
      ldtkTileId,
      srcX,
      srcY,
      tileset: options.tileset,
      path: options.path,
      importedTiles: options.importedTiles,
    }),
  };
}

function ldtkNumberPair(value: unknown, path: string): [number, number] {
  const values = arrayValue(value, path);
  if (values.length !== 2) {
    throw assetPipelineDiagnosticError(path, "must contain exactly two numbers");
  }
  return [
    nonNegativeNumber(values[0], `${path}.0`),
    nonNegativeNumber(values[1], `${path}.1`),
  ];
}

function ldtkGridCoordinate(value: number, gridSize: number, path: string): number {
  const coordinate = value / gridSize;
  if (!Number.isInteger(coordinate)) {
    throw assetPipelineDiagnosticError(path, "must align to the LDtk layer grid");
  }
  return coordinate;
}

function ldtkTileIdValue(
  value: unknown,
  options: { path: string; srcX: number; srcY: number; tileset: LDtkTileset },
): number {
  const sourcePath = options.path.replace(/\.t$/, ".src");
  ldtkValidateSource(options.srcX, options.srcY, options.tileset, sourcePath);
  if (value !== undefined) {
    return nonNegativeInteger(value, options.path);
  }
  const column = ldtkGridCoordinate(
    options.srcX - options.tileset.padding,
    options.tileset.tileWidth + options.tileset.spacing,
    `${sourcePath}.0`,
  );
  const row = ldtkGridCoordinate(
    options.srcY - options.tileset.padding,
    options.tileset.tileHeight + options.tileset.spacing,
    `${sourcePath}.1`,
  );
  return row * options.tileset.columns + column;
}

function ldtkValidateSource(srcX: number, srcY: number, tileset: LDtkTileset, path: string): void {
  if (srcX < tileset.padding) {
    throw assetPipelineDiagnosticError(`${path}.0`, "tile source must be inside tileset padding");
  }
  if (srcY < tileset.padding) {
    throw assetPipelineDiagnosticError(`${path}.1`, "tile source must be inside tileset padding");
  }
  if (srcX + tileset.tileWidth > tileset.imageWidth) {
    throw assetPipelineDiagnosticError(`${path}.0`, "tile source exceeds tileset image width");
  }
  if (srcY + tileset.tileHeight > tileset.imageHeight) {
    throw assetPipelineDiagnosticError(`${path}.1`, "tile source exceeds tileset image height");
  }
}

function ldtkImportedTile(options: {
  ldtkTileId: number;
  srcX: number;
  srcY: number;
  tileset: LDtkTileset;
  path: string;
  importedTiles: Map<string, LDtkTileRef>;
}): LDtkTileRef {
  const key = `${options.tileset.uid}:${options.srcX}:${options.srcY}`;
  const existing = options.importedTiles.get(key);
  if (existing) {
    return existing;
  }
  const slope = options.tileset.tileSlopes.get(options.ldtkTileId);
  const oneWayPlatform = options.tileset.tileOneWayPlatforms.has(options.ldtkTileId);
  if (slope && oneWayPlatform) {
    throw assetPipelineDiagnosticError(
      options.path,
      `tile id ${options.ldtkTileId} cannot define both slope and oneWayPlatform`,
    );
  }
  const ref: LDtkTileRef = {
    gameTileId: options.importedTiles.size + 1,
    ldtkTileId: options.ldtkTileId,
    tileset: options.tileset,
    srcX: options.srcX,
    srcY: options.srcY,
    ...(slope ? { slope } : {}),
    ...(oneWayPlatform ? { oneWayPlatform } : {}),
    path: options.path,
  };
  options.importedTiles.set(key, ref);
  return ref;
}

function ldtkTileSlopes(value: unknown, path: string): Map<number, ShooterTileSlopeSpec> {
  const slopes = new Map<number, ShooterTileSlopeSpec>();
  if (value === undefined) {
    return slopes;
  }

  for (const [index, entry] of arrayValue(value, path).entries()) {
    const entryPath = `${path}.${index}`;
    const metadata = objectValue(entry, entryPath);
    const data = optionalString(metadata.data, `${entryPath}.data`);
    if (data === undefined) {
      continue;
    }
    const slope = ldtkCustomDataSlope(data, `${entryPath}.data`);
    if (!slope) {
      continue;
    }
    const tileId = nonNegativeInteger(metadata.tileId, `${entryPath}.tileId`);
    if (slopes.has(tileId)) {
      throw assetPipelineDiagnosticError(`${entryPath}.tileId`, `duplicate slope metadata for tile id ${tileId}`);
    }
    slopes.set(tileId, slope);
  }
  return slopes;
}

function ldtkTileOneWayPlatforms(value: unknown, path: string): Set<number> {
  const oneWayPlatforms = new Set<number>();
  if (value === undefined) {
    return oneWayPlatforms;
  }

  for (const [index, entry] of arrayValue(value, path).entries()) {
    const entryPath = `${path}.${index}`;
    const metadata = objectValue(entry, entryPath);
    const data = optionalString(metadata.data, `${entryPath}.data`);
    if (data === undefined) {
      continue;
    }
    const oneWayPlatform = ldtkCustomDataOneWayPlatform(data, `${entryPath}.data`);
    if (!oneWayPlatform) {
      continue;
    }
    const tileId = nonNegativeInteger(metadata.tileId, `${entryPath}.tileId`);
    if (oneWayPlatforms.has(tileId)) {
      throw assetPipelineDiagnosticError(`${entryPath}.tileId`, `duplicate oneWayPlatform metadata for tile id ${tileId}`);
    }
    oneWayPlatforms.add(tileId);
  }
  return oneWayPlatforms;
}

function ldtkCustomDataSlope(value: string, path: string): ShooterTileSlopeSpec | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{")) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || parsed.slope === undefined) {
    return undefined;
  }
  return tileSlopeFromRecord(objectValue(parsed.slope, `${path}.slope`), `${path}.slope`);
}

function ldtkCustomDataOneWayPlatform(value: string, path: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{")) {
    return false;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return false;
  }
  if (!isRecord(parsed) || parsed.oneWayPlatform === undefined) {
    return false;
  }
  return optionalBoolean(parsed.oneWayPlatform, `${path}.oneWayPlatform`) === true;
}

function ldtkTilesetFrameContext(tile: LDtkTileRef): LDtkTilesetFrameContext {
  return {
    gameTileId: tile.gameTileId,
    ldtkTileId: tile.ldtkTileId,
    tilesetUid: tile.tileset.uid,
    tilesetIdentifier: tile.tileset.identifier,
    srcX: tile.srcX,
    srcY: tile.srcY,
    relPath: tile.tileset.relPath,
  };
}

function ldtkFrameName(context: LDtkTilesetFrameContext, options: LDtkTilemapImportOptions): string {
  const frameName = options.frameNameForTile?.(context)
    ?? `${options.frameNamePrefix ?? ""}${context.tilesetIdentifier}.${context.ldtkTileId}`;
  if (frameName.trim().length === 0) {
    throw assetPipelineDiagnosticError(`${LDTK_ROOT_PATH}.defs.tilesets`, "frameNameForTile must return a non-empty string");
  }
  return frameName;
}

function ldtkAtlasFrameSpec(
  tile: LDtkTileRef,
  context: LDtkTilesetFrameContext,
  options: LDtkTilemapImportOptions,
): ShooterAtlasFrameSpec {
  return {
    texture: ldtkTexture(context, options),
    uv: {
      u0: tile.srcX / tile.tileset.imageWidth,
      v0: tile.srcY / tile.tileset.imageHeight,
      u1: (tile.srcX + tile.tileset.tileWidth) / tile.tileset.imageWidth,
      v1: (tile.srcY + tile.tileset.tileHeight) / tile.tileset.imageHeight,
    },
    size: {
      width: tile.tileset.tileWidth,
      height: tile.tileset.tileHeight,
    },
  };
}

function ldtkTexture(context: LDtkTilesetFrameContext, options: LDtkTilemapImportOptions): string | number {
  if (typeof options.texture === "function") {
    return textureValue(options.texture(context), `${LDTK_ROOT_PATH}.texture`);
  }
  if (options.texture !== undefined) {
    return textureValue(options.texture, `${LDTK_ROOT_PATH}.texture`);
  }
  return context.tilesetIdentifier;
}

function objectValue(value: unknown, path: string): JsonRecord {
  if (!isRecord(value)) {
    throw assetPipelineDiagnosticError(path, "must be an object");
  }
  return value;
}

function arrayValue(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw assetPipelineDiagnosticError(path, "must be an array");
  }
  return value;
}

function optionalArray(value: unknown, path: string): unknown[] {
  if (value === undefined) {
    return [];
  }
  return arrayValue(value, path);
}

function optionalObject(value: unknown, path: string): JsonRecord {
  if (value === undefined) {
    return {};
  }
  return objectValue(value, path);
}

function textureValue(value: unknown, path: string): string | number {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  if (Number.isInteger(value) && typeof value === "number" && value >= 0) {
    return value;
  }
  throw assetPipelineDiagnosticError(path, "must be a non-empty string or non-negative integer");
}

function requiredString(value: unknown, path: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  throw assetPipelineDiagnosticError(path, "must be a non-empty string");
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requiredString(value, path);
}

function optionalNullableString(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return requiredString(value, path);
}

function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  throw assetPipelineDiagnosticError(path, "must be a boolean");
}

function positiveNumber(value: unknown, path: string): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  throw assetPipelineDiagnosticError(path, "must be a positive finite number");
}

function positiveInteger(value: unknown, path: string): number {
  if (Number.isInteger(value) && typeof value === "number" && value > 0) {
    return value;
  }
  throw assetPipelineDiagnosticError(path, "must be a positive integer");
}

function nonNegativeNumber(value: unknown, path: string): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  throw assetPipelineDiagnosticError(path, "must be a non-negative finite number");
}

function normalizedNumber(value: unknown, path: string): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1) {
    return value;
  }
  throw assetPipelineDiagnosticError(path, "must be a normalized number from 0 to 1");
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (Number.isInteger(value) && typeof value === "number" && value >= 0) {
    return value;
  }
  throw assetPipelineDiagnosticError(path, "must be a non-negative integer");
}

function finiteNumber(value: unknown, path: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  throw assetPipelineDiagnosticError(path, "must be a finite number");
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tileSlopeFromEndpointProperties(
  x0: { value: unknown; path: string } | undefined,
  y0: { value: unknown; path: string } | undefined,
  x1: { value: unknown; path: string } | undefined,
  y1: { value: unknown; path: string } | undefined,
  path: string,
): ShooterTileSlopeSpec | undefined {
  if (!x0 && !y0 && !x1 && !y1) {
    return undefined;
  }
  const slope = {
    x0: normalizedNumber(x0?.value, x0?.path ?? `${path}.slopeX0`),
    y0: normalizedNumber(y0?.value, y0?.path ?? `${path}.slopeY0`),
    x1: normalizedNumber(x1?.value, x1?.path ?? `${path}.slopeX1`),
    y1: normalizedNumber(y1?.value, y1?.path ?? `${path}.slopeY1`),
  };
  validateTileSlope(slope, `${path}.slopeX1`, "slopeX0");
  return slope;
}

function tileSlopeFromRecord(value: JsonRecord, path: string): ShooterTileSlopeSpec {
  const slope = {
    x0: normalizedNumber(value.x0, `${path}.x0`),
    y0: normalizedNumber(value.y0, `${path}.y0`),
    x1: normalizedNumber(value.x1, `${path}.x1`),
    y1: normalizedNumber(value.y1, `${path}.y1`),
  };
  validateTileSlope(slope, `${path}.x1`, "slope.x0");
  return slope;
}

function validateTileSlope(slope: ShooterTileSlopeSpec, path: string, x0Name: string): void {
  if (Math.abs((slope.x1 ?? 0) - (slope.x0 ?? 0)) <= 0.0001) {
    throw assetPipelineDiagnosticError(path, `must differ from ${x0Name}`);
  }
}
