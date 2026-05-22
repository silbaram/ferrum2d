import { assetPipelineDiagnosticError } from "./diagnostics.js";
import type { ShooterAtlasFrameSpec, ShooterAtlasSpec, ShooterGameSpec, ShooterTilemapSpec } from "./gameSpec.js";

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

export interface TiledTilemapImportOptions {
  texture?: string | number | ((context: TiledTilesetFrameContext) => string | number);
  frameNamePrefix?: string;
  frameNameForGid?: (context: TiledTilesetFrameContext) => string;
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

export interface LDtkTilemapImportOptions {
  levelIdentifier?: string;
  levelIid?: string;
  levelIndex?: number;
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
  path: string;
}

type JsonRecord = Record<string, unknown>;

const ASEPRITE_ROOT_PATH = "assetPipeline.aseprite";
const TILED_ROOT_PATH = "assetPipeline.tiled";
const LDTK_ROOT_PATH = "assetPipeline.ldtk";
const TILED_GID_FLAG_MASK = 0xf0000000;
const TILED_GID_MASK = 0x0fffffff;

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
  const tilesets = tiledTilesets(root.tilesets, `${TILED_ROOT_PATH}.tilesets`);
  const usedGids = new Set<number>();
  const layerNames: string[] = [];
  const layers = tiledLayers(root.layers, {
    path: `${TILED_ROOT_PATH}.layers`,
    mapWidth: width,
    mapHeight: height,
    includeHiddenLayers: options.includeHiddenLayers === true,
    collisionLayerNames: new Set(options.collisionLayerNames ?? []),
    usedGids,
  });
  const sortedGids = [...usedGids].sort((a, b) => a - b);
  const atlasFrames: Record<string, ShooterAtlasFrameSpec> = {};
  const tiles: Record<string, { frame: string }> = {};

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
    tiles[String(gid)] = { frame: frameName };
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
  const originX = finiteNumber(options.origin?.x, `${LDTK_ROOT_PATH}.origin.x`, 0);
  const originY = finiteNumber(options.origin?.y, `${LDTK_ROOT_PATH}.origin.y`, 0);

  for (const [index, entry] of level.layers.entries()) {
    const imported = ldtkLayer(entry, {
      path: `${level.path}.layerInstances.${index}`,
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
  const tiles: Record<string, { frame: string }> = {};
  const usedFrameNames = new Set<string>();
  const tileRefs = [...importedTiles.values()].sort((a, b) => a.gameTileId - b.gameTileId);

  for (const tile of tileRefs) {
    const context = ldtkTilesetFrameContext(tile);
    const frameName = ldtkFrameName(context, options);
    if (usedFrameNames.has(frameName)) {
      throw assetPipelineDiagnosticError(tile.path, `duplicate imported frame name '${frameName}'`);
    }
    usedFrameNames.add(frameName);
    tiles[String(tile.gameTileId)] = { frame: frameName };
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

function tiledTilesets(value: unknown, path: string): TiledTileset[] {
  const entries = arrayValue(value, path);
  if (entries.length === 0) {
    throw assetPipelineDiagnosticError(path, "must contain at least one tileset");
  }

  return entries.map((entry, index) => {
    const entryPath = `${path}.${index}`;
    const record = objectValue(entry, entryPath);
    if (record.source !== undefined) {
      throw assetPipelineDiagnosticError(`${entryPath}.source`, "external Tiled tilesets must be resolved before import");
    }
    const firstGid = positiveInteger(record.firstgid, `${entryPath}.firstgid`);
    const name = requiredString(record.name, `${entryPath}.name`);
    const tileWidth = positiveNumber(record.tilewidth, `${entryPath}.tilewidth`);
    const tileHeight = positiveNumber(record.tileheight, `${entryPath}.tileheight`);
    const imageWidth = positiveNumber(record.imagewidth, `${entryPath}.imagewidth`);
    const imageHeight = positiveNumber(record.imageheight, `${entryPath}.imageheight`);
    const columns = positiveInteger(record.columns, `${entryPath}.columns`);
    const tileCount = positiveInteger(record.tilecount, `${entryPath}.tilecount`);
    return {
      firstGid,
      name,
      tileWidth,
      tileHeight,
      imageWidth,
      imageHeight,
      columns,
      tileCount,
      margin: nonNegativeNumber(record.margin ?? 0, `${entryPath}.margin`),
      spacing: nonNegativeNumber(record.spacing ?? 0, `${entryPath}.spacing`),
      path: entryPath,
    };
  }).sort((a, b) => a.firstGid - b.firstGid);
}

function tiledLayers(
  value: unknown,
  options: {
    path: string;
    mapWidth: number;
    mapHeight: number;
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
    const data = tiledLayerData(layer.data, {
      path: `${entryPath}.data`,
      expectedLength: columns * rows,
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
  value: unknown,
  options: { path: string; expectedLength: number; usedGids: Set<number> },
): number[] {
  const values = arrayValue(value, options.path);
  if (values.length !== options.expectedLength) {
    throw assetPipelineDiagnosticError(options.path, `must contain exactly ${options.expectedLength} tile ids`);
  }
  return values.map((value, index) => {
    const path = `${options.path}.${index}`;
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
  if (record.layerInstances === null && record.externalRelPath !== undefined) {
    throw assetPipelineDiagnosticError(
      `${levelPath}.layerInstances`,
      "external LDtk levels must be loaded into the project JSON before import",
    );
  }

  return {
    identifier: optionalString(record.identifier, `${levelPath}.identifier`) ?? `level-${index}`,
    iid: optionalString(record.iid, `${levelPath}.iid`),
    width: positiveNumber(record.pxWid, `${levelPath}.pxWid`),
    height: positiveNumber(record.pxHei, `${levelPath}.pxHei`),
    layers: arrayValue(record.layerInstances, `${levelPath}.layerInstances`),
    path: levelPath,
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
    if (type === "IntGrid" && options.collisionLayerNames.has(name)) {
      throw assetPipelineDiagnosticError(
        options.path,
        "raw LDtk IntGrid collision layers are not supported; use rendered tiles or a tile layer collision mask",
      );
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
  const ref: LDtkTileRef = {
    gameTileId: options.importedTiles.size + 1,
    ldtkTileId: options.ldtkTileId,
    tileset: options.tileset,
    srcX: options.srcX,
    srcY: options.srcY,
    path: options.path,
  };
  options.importedTiles.set(key, ref);
  return ref;
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
