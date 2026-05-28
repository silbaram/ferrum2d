import { assetPipelineDiagnosticError } from "./diagnostics.js";
import type { ShooterTileSlopeSpec } from "./gameSpec.js";
import {
  arrayValue,
  isRecord,
  nonNegativeInteger,
  nonNegativeNumber,
  objectValue,
  optionalBoolean,
  optionalNullableString,
  optionalString,
  positiveInteger,
  positiveNumber,
  requiredString,
} from "./assetPipelineValidation.js";
import { tileSlopeFromRecord } from "./assetPipelineTileMetadata.js";

export interface LDtkTileset {
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

export interface LDtkTileRef {
  gameTileId: number;
  ldtkTileId: number;
  tileset: LDtkTileset;
  srcX: number;
  srcY: number;
  slope?: ShooterTileSlopeSpec;
  oneWayPlatform?: boolean;
  path: string;
}

export function ldtkTilesets(value: unknown, path: string): Map<number, LDtkTileset> {
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

export function ldtkImportedTile(options: {
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
