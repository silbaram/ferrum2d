import { assetPipelineDiagnosticError, describeError } from "./diagnostics.js";
import type {
  ShooterAtlasFrameSpec,
  ShooterAtlasSpec,
  ShooterGameSpec,
  ShooterTileSlopeSpec,
  ShooterTileSpec,
  ShooterTilemapSpec,
} from "./gameSpec.js";
import type {
  TiledLayerDataDecoder,
  TiledTilemapImportOptions,
  TiledTilemapImportResult,
  TiledTilesetFrameContext,
} from "./assetPipelineTypes.js";
import {
  arrayValue,
  finiteNumber,
  nonNegativeInteger,
  nonNegativeNumber,
  objectValue,
  optionalBoolean,
  optionalString,
  positiveInteger,
  positiveNumber,
  requiredString,
  textureValue,
} from "./assetPipelineValidation.js";
import type { JsonRecord } from "./assetPipelineValidation.js";
import {
  tileHd2dMetadataFromProperties,
  tileHeightMetadataFromProperties,
  tileSlopeFromEndpointProperties,
} from "./assetPipelineTileMetadata.js";

const TILED_ROOT_PATH = "assetPipeline.tiled";
const TILED_GID_FLAG_MASK = 0xf0000000;
const TILED_GID_MASK = 0x0fffffff;

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
  tileHeightMetadata: Map<number, Pick<ShooterTileSpec, "floor" | "elevation" | "height">>;
  tileHd2dMetadata: Map<number, Pick<
    ShooterTileSpec,
    "kind" | "ramp" | "blocksMovement" | "blocksProjectile" | "blocksVision" | "occluderHeight"
  >>;
  margin: number;
  spacing: number;
  path: string;
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
    const heightMetadata = tileset.tileHeightMetadata.get(localId);
    const hd2dMetadata = tileset.tileHd2dMetadata.get(localId);
    if (slope && oneWayPlatform) {
      throw assetPipelineDiagnosticError(
        `${tileset.path}.tiles`,
        `tile id ${localId} cannot define both slope and oneWayPlatform`,
      );
    }
    tiles[String(gid)] = {
      frame: frameName,
      ...(heightMetadata ?? {}),
      ...(hd2dMetadata ?? {}),
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
    const tileHeightMetadata = tiledTileHeightMetadata(record.tiles, {
      path: `${metadataPath}.tiles`,
      tileCount,
    });
    const tileHd2dMetadata = tiledTileHd2dMetadata(record.tiles, {
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
      tileHeightMetadata,
      tileHd2dMetadata,
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

function tiledTileHeightMetadata(
  value: unknown,
  options: { path: string; tileCount: number },
): Map<number, Pick<ShooterTileSpec, "floor" | "elevation" | "height">> {
  const entries = new Map<number, Pick<ShooterTileSpec, "floor" | "elevation" | "height">>();
  if (value === undefined) {
    return entries;
  }

  for (const [index, entry] of arrayValue(value, options.path).entries()) {
    const tilePath = `${options.path}.${index}`;
    const tile = objectValue(entry, tilePath);
    const metadata = tiledTileHeightSpan(tile.properties, `${tilePath}.properties`);
    if (metadata === undefined) {
      continue;
    }
    const id = nonNegativeInteger(tile.id, `${tilePath}.id`);
    if (id >= options.tileCount) {
      throw assetPipelineDiagnosticError(`${tilePath}.id`, "must reference a tile inside the tileset");
    }
    if (entries.has(id)) {
      throw assetPipelineDiagnosticError(`${tilePath}.id`, `duplicate height metadata for tile id ${id}`);
    }
    entries.set(id, metadata);
  }
  return entries;
}

function tiledTileHd2dMetadata(
  value: unknown,
  options: { path: string; tileCount: number },
): Map<number, Pick<
  ShooterTileSpec,
  "kind" | "ramp" | "blocksMovement" | "blocksProjectile" | "blocksVision" | "occluderHeight"
>> {
  const entries = new Map<number, Pick<
    ShooterTileSpec,
    "kind" | "ramp" | "blocksMovement" | "blocksProjectile" | "blocksVision" | "occluderHeight"
  >>();
  if (value === undefined) {
    return entries;
  }

  for (const [index, entry] of arrayValue(value, options.path).entries()) {
    const tilePath = `${options.path}.${index}`;
    const tile = objectValue(entry, tilePath);
    const metadata = tiledTileHd2d(tile.properties, `${tilePath}.properties`);
    if (metadata === undefined) {
      continue;
    }
    const id = nonNegativeInteger(tile.id, `${tilePath}.id`);
    if (id >= options.tileCount) {
      throw assetPipelineDiagnosticError(`${tilePath}.id`, "must reference a tile inside the tileset");
    }
    if (entries.has(id)) {
      throw assetPipelineDiagnosticError(`${tilePath}.id`, `duplicate HD-2D metadata for tile id ${id}`);
    }
    entries.set(id, metadata);
  }
  return entries;
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

function tiledTileHeightSpan(
  value: unknown,
  path: string,
): Pick<ShooterTileSpec, "floor" | "elevation" | "height"> | undefined {
  if (value === undefined) {
    return undefined;
  }
  return tileHeightMetadataFromProperties(
    tiledProperty(value, "floor", path),
    tiledProperty(value, "elevation", path),
    tiledProperty(value, "height", path),
  );
}

function tiledTileHd2d(
  value: unknown,
  path: string,
): Pick<
  ShooterTileSpec,
  "kind" | "ramp" | "blocksMovement" | "blocksProjectile" | "blocksVision" | "occluderHeight"
> | undefined {
  if (value === undefined) {
    return undefined;
  }
  return tileHd2dMetadataFromProperties(
    tiledProperty(value, "kind", path),
    tiledProperty(value, "rampAxis", path),
    tiledProperty(value, "rampStartElevation", path),
    tiledProperty(value, "rampEndElevation", path),
    tiledProperty(value, "blocksMovement", path),
    tiledProperty(value, "blocksProjectile", path),
    tiledProperty(value, "blocksVision", path),
    tiledProperty(value, "occluderHeight", path),
  );
}

function tiledNumberProperty(
  value: unknown,
  name: string,
  path: string,
): { value: unknown; path: string } | undefined {
  return tiledProperty(value, name, path);
}

function tiledProperty(
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
