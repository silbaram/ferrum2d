import type { AssetManifest } from "./assetLoader.js";
import type {
  LevelChunkManifestSpec,
  LevelChunkSpec,
  LevelStreamingOrigin,
  LevelTilemapChunkSpec,
  ResolveLevelChunkManifestOptions,
  ResolvedLevelChunk,
  ResolvedLevelChunkManifest,
  ResolvedLevelTilemapChunk,
} from "./levelStreamingTypes.js";
import {
  finiteNumber,
  integer,
  invalid,
  isRecord,
  positiveInteger,
  positiveNumber,
  stringValue,
} from "./levelStreamingValidation.js";

const DEFAULT_MANIFEST_ID = "level";
const DEFAULT_TILE_SIZE = 32;
const DEFAULT_CHUNK_TILES = 16;

export function resolveLevelChunkManifest(
  manifest: LevelChunkManifestSpec,
  options: ResolveLevelChunkManifestOptions = {},
): ResolvedLevelChunkManifest {
  const path = options.path ?? "levelStreaming";
  if (!isRecord(manifest)) {
    throw invalid(path, "must be an object");
  }
  const input = manifest as LevelChunkManifestSpec;
  const id = stringValue(input.id ?? DEFAULT_MANIFEST_ID, `${path}.id`);
  const tileWidth = positiveNumber(input.tileWidth ?? DEFAULT_TILE_SIZE, `${path}.tileWidth`);
  const tileHeight = positiveNumber(input.tileHeight ?? DEFAULT_TILE_SIZE, `${path}.tileHeight`);
  const chunkColumns = positiveInteger(input.chunkColumns ?? DEFAULT_CHUNK_TILES, `${path}.chunkColumns`);
  const chunkRows = positiveInteger(input.chunkRows ?? DEFAULT_CHUNK_TILES, `${path}.chunkRows`);
  const origin = resolveOrigin(input.origin, `${path}.origin`);
  if (!Array.isArray(input.chunks) || input.chunks.length === 0) {
    throw invalid(`${path}.chunks`, "must be a non-empty array");
  }

  const chunksById: Record<string, ResolvedLevelChunk> = {};
  const chunks = input.chunks.map((chunk, index) => {
    const resolved = resolveChunk(chunk, {
      path: `${path}.chunks[${index}]`,
      tileWidth,
      tileHeight,
      chunkColumns,
      chunkRows,
      origin,
    });
    if (chunksById[resolved.id] !== undefined) {
      throw invalid(`${path}.chunks[${index}].id`, `duplicates chunk id '${resolved.id}'`);
    }
    chunksById[resolved.id] = resolved;
    return resolved;
  }).sort(compareChunks);

  return {
    id,
    tileWidth,
    tileHeight,
    chunkColumns,
    chunkRows,
    origin,
    chunks,
    chunksById,
  };
}

export function resolveManifestInput(manifest: LevelChunkManifestSpec | ResolvedLevelChunkManifest): ResolvedLevelChunkManifest {
  if (isResolvedLevelChunkManifest(manifest)) {
    return manifest;
  }
  return resolveLevelChunkManifest(manifest);
}

export function compareChunks(a: ResolvedLevelChunk, b: ResolvedLevelChunk): number {
  return a.chunkY - b.chunkY || a.chunkX - b.chunkX || a.id.localeCompare(b.id);
}

function resolveChunk(
  chunk: LevelChunkSpec,
  options: {
    path: string;
    tileWidth: number;
    tileHeight: number;
    chunkColumns: number;
    chunkRows: number;
    origin: Required<LevelStreamingOrigin>;
  },
): ResolvedLevelChunk {
  if (!isRecord(chunk)) {
    throw invalid(options.path, "must be an object");
  }
  const id = stringValue(chunk.id, `${options.path}.id`);
  const chunkX = integer(chunk.chunkX, `${options.path}.chunkX`);
  const chunkY = integer(chunk.chunkY, `${options.path}.chunkY`);
  const columns = positiveInteger(chunk.columns ?? options.chunkColumns, `${options.path}.columns`);
  const rows = positiveInteger(chunk.rows ?? options.chunkRows, `${options.path}.rows`);
  const minX = options.origin.x + chunkX * options.chunkColumns * options.tileWidth;
  const minY = options.origin.y + chunkY * options.chunkRows * options.tileHeight;
  const width = columns * options.tileWidth;
  const height = rows * options.tileHeight;
  return {
    id,
    chunkX,
    chunkY,
    columns,
    rows,
    bounds: {
      minX,
      minY,
      maxX: minX + width,
      maxY: minY + height,
      width,
      height,
    },
    ...(chunk.tilemap === undefined ? {} : {
      tilemap: resolveTilemapChunk(chunk.tilemap, {
        path: `${options.path}.tilemap`,
        columns,
        rows,
      }),
    }),
    assets: resolveAssetManifest(chunk.assets ?? {}, `${options.path}.assets`),
  };
}

function resolveTilemapChunk(
  tilemap: LevelTilemapChunkSpec,
  options: { path: string; columns: number; rows: number },
): ResolvedLevelTilemapChunk {
  if (!isRecord(tilemap)) {
    throw invalid(options.path, "must be an object");
  }
  return {
    ...(tilemap.url === undefined ? {} : { url: stringValue(tilemap.url, `${options.path}.url`) }),
    layer: stringValue(tilemap.layer ?? "main", `${options.path}.layer`),
    columns: positiveInteger(tilemap.columns ?? options.columns, `${options.path}.columns`),
    rows: positiveInteger(tilemap.rows ?? options.rows, `${options.path}.rows`),
  };
}

function resolveAssetManifest(manifest: AssetManifest, path: string): AssetManifest {
  if (!isRecord(manifest)) {
    throw invalid(path, "must be an object");
  }
  return {
    textures: resolveAssetMap(manifest.textures, `${path}.textures`),
    sounds: resolveAssetMap(manifest.sounds, `${path}.sounds`),
    json: resolveAssetMap(manifest.json, `${path}.json`),
  };
}

function resolveAssetMap(value: unknown, path: string): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw invalid(path, "must be an object");
  }
  const entries: Record<string, string> = {};
  for (const [key, url] of Object.entries(value)) {
    entries[stringValue(key, `${path} key`)] = stringValue(url, `${path}.${key}`);
  }
  return entries;
}

function resolveOrigin(origin: LevelStreamingOrigin | undefined, path: string): Required<LevelStreamingOrigin> {
  if (origin === undefined) {
    return { x: 0, y: 0 };
  }
  if (!isRecord(origin)) {
    throw invalid(path, "must be an object");
  }
  return {
    x: finiteNumber(origin.x ?? 0, `${path}.x`),
    y: finiteNumber(origin.y ?? 0, `${path}.y`),
  };
}

function isResolvedLevelChunkManifest(
  manifest: LevelChunkManifestSpec | ResolvedLevelChunkManifest,
): manifest is ResolvedLevelChunkManifest {
  return isRecord(manifest)
    && typeof manifest.id === "string"
    && typeof manifest.tileWidth === "number"
    && isRecord(manifest.chunksById)
    && Array.isArray(manifest.chunks);
}
