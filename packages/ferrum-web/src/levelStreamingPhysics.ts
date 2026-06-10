import type { ResolvedShooterTileLayer, ResolvedShooterTilemap } from "./gameSpec.js";
import { resolveManifestInput } from "./levelStreamingManifest.js";
import type {
  LevelChunkManifestSpec,
  ResolvedLevelChunk,
  ResolvedLevelChunkManifest,
} from "./levelStreamingTypes.js";
import type { PixelMaskTerrainRuntimePhysicsOptions } from "./pixelMaskTerrainRuntime.js";
import {
  extractTilemapBoundaryChains,
  type TilemapBoundaryExtractionOptions,
  type TilemapBoundaryExtractionResult,
} from "./tilemapPhysics.js";

const ALIGNMENT_EPSILON = 1e-6;

export type LevelStreamingPixelMaskTerrainPhysicsOptions =
  Omit<PixelMaskTerrainRuntimePhysicsOptions, "chunkWidth" | "chunkHeight">;

export interface LevelStreamingTilemapChunkBoundaryOptions extends TilemapBoundaryExtractionOptions {
  layerName?: string;
}

export function createLevelStreamingPixelMaskTerrainPhysicsOptions(
  manifest: LevelChunkManifestSpec | ResolvedLevelChunkManifest,
  options: LevelStreamingPixelMaskTerrainPhysicsOptions,
): PixelMaskTerrainRuntimePhysicsOptions {
  const resolved = resolveManifestInput(manifest);
  return {
    ...options,
    chunkWidth: resolved.chunkColumns,
    chunkHeight: resolved.chunkRows,
    boundary: {
      ...(options.boundary ?? {}),
      tileWidth: resolved.tileWidth,
      tileHeight: resolved.tileHeight,
      originX: resolved.origin.x,
      originY: resolved.origin.y,
    },
  };
}

export function extractLevelStreamingTilemapChunkBoundaryChains(
  tilemap: ResolvedShooterTilemap,
  chunk: ResolvedLevelChunk,
  options: LevelStreamingTilemapChunkBoundaryOptions = {},
): TilemapBoundaryExtractionResult {
  const layers = tilemap.layers.filter((layer) => matchesRequestedLayer(layer, chunk, options));
  if (layers.length === 0) {
    throw new Error(`level streaming chunk '${chunk.id}' does not match any tilemap layer.`);
  }
  const chunkTilemap: ResolvedShooterTilemap = {
    tiles: tilemap.tiles,
    layers: layers.map((layer) => tilemapLayerForLevelStreamingChunk(layer, chunk)),
  };
  const { layerName: _layerName, ...boundaryOptions } = options;
  return extractTilemapBoundaryChains(chunkTilemap, {
    ...boundaryOptions,
    bodyIdPrefix: chunkBoundaryBodyIdPrefix(options.bodyIdPrefix, chunk),
  });
}

export function tilemapLayerForLevelStreamingChunk(
  layer: ResolvedShooterTileLayer,
  chunk: ResolvedLevelChunk,
): ResolvedShooterTileLayer {
  const chunkTileWidth = chunk.bounds.width / chunk.columns;
  const chunkTileHeight = chunk.bounds.height / chunk.rows;
  assertAlignedTileSize(layer.tileWidth, chunkTileWidth, `levelStreaming.chunks.${chunk.id}.tileWidth`);
  assertAlignedTileSize(layer.tileHeight, chunkTileHeight, `levelStreaming.chunks.${chunk.id}.tileHeight`);
  const startColumn = alignedGridOffset(
    (chunk.bounds.minX - layer.originX) / layer.tileWidth,
    `levelStreaming.chunks.${chunk.id}.columnOffset`,
  );
  const startRow = alignedGridOffset(
    (chunk.bounds.minY - layer.originY) / layer.tileHeight,
    `levelStreaming.chunks.${chunk.id}.rowOffset`,
  );
  if (
    startColumn < 0
    || startRow < 0
    || startColumn + chunk.columns > layer.columns
    || startRow + chunk.rows > layer.rows
  ) {
    throw new Error(`level streaming chunk '${chunk.id}' is outside tilemap layer '${layer.name}'.`);
  }
  if (layer.data.length < layer.columns * layer.rows) {
    throw new Error(`tilemap layer '${layer.name}' data length is smaller than columns * rows.`);
  }

  const data: number[] = [];
  for (let row = 0; row < chunk.rows; row += 1) {
    const sourceStart = (startRow + row) * layer.columns + startColumn;
    data.push(...layer.data.slice(sourceStart, sourceStart + chunk.columns));
  }

  return {
    ...layer,
    name: `${layer.name}.${chunk.id}`,
    columns: chunk.columns,
    rows: chunk.rows,
    originX: layer.originX + startColumn * layer.tileWidth,
    originY: layer.originY + startRow * layer.tileHeight,
    data,
  };
}

function matchesRequestedLayer(
  layer: ResolvedShooterTileLayer,
  chunk: ResolvedLevelChunk,
  options: LevelStreamingTilemapChunkBoundaryOptions,
): boolean {
  const layerName = options.layerName ?? chunk.tilemap?.layer;
  return (layerName === undefined || layer.name === layerName)
    && (options.layerIndex === undefined || layer.index === options.layerIndex);
}

function chunkBoundaryBodyIdPrefix(
  bodyIdPrefix: string | undefined,
  chunk: ResolvedLevelChunk,
): string {
  const prefix = bodyIdPrefix?.trim() || "levelStreamingChunk";
  return `${prefix}.${chunk.id}`;
}

function assertAlignedTileSize(actual: number, expected: number, path: string): void {
  if (!Number.isFinite(actual) || !Number.isFinite(expected) || Math.abs(actual - expected) > ALIGNMENT_EPSILON) {
    throw new Error(`${path} must match the tilemap layer tile size.`);
  }
}

function alignedGridOffset(value: number, path: string): number {
  const rounded = Math.round(value);
  if (!Number.isFinite(value) || Math.abs(value - rounded) > ALIGNMENT_EPSILON) {
    throw new Error(`${path} must align to the tilemap grid.`);
  }
  return rounded;
}
