import type { AssetManifest } from "./assetLoader.js";

export interface LevelStreamingOrigin {
  x?: number;
  y?: number;
}

export interface LevelTilemapChunkSpec {
  url?: string;
  layer?: string;
  columns?: number;
  rows?: number;
}

export interface LevelChunkSpec {
  id: string;
  chunkX: number;
  chunkY: number;
  columns?: number;
  rows?: number;
  tilemap?: LevelTilemapChunkSpec;
  assets?: AssetManifest;
}

export interface LevelChunkManifestSpec {
  id?: string;
  tileWidth?: number;
  tileHeight?: number;
  chunkColumns?: number;
  chunkRows?: number;
  origin?: LevelStreamingOrigin;
  chunks: readonly LevelChunkSpec[];
}

export interface ResolveLevelChunkManifestOptions {
  path?: string;
}

export interface LevelChunkBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface ResolvedLevelTilemapChunk {
  url?: string;
  layer: string;
  columns: number;
  rows: number;
}

export interface ResolvedLevelChunk {
  id: string;
  chunkX: number;
  chunkY: number;
  columns: number;
  rows: number;
  bounds: LevelChunkBounds;
  tilemap?: ResolvedLevelTilemapChunk;
  assets: AssetManifest;
}

export interface ResolvedLevelChunkManifest {
  id: string;
  tileWidth: number;
  tileHeight: number;
  chunkColumns: number;
  chunkRows: number;
  origin: Required<LevelStreamingOrigin>;
  chunks: readonly ResolvedLevelChunk[];
  chunksById: Readonly<Record<string, ResolvedLevelChunk>>;
}

export interface LevelStreamingViewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LevelStreamingAssetLifetimePolicy {
  preloadMarginChunks?: number;
  retainMarginChunks?: number;
  maxRetainedChunks?: number;
}

export interface LevelStreamingPlanOptions {
  loadedChunkIds?: readonly string[];
  assetLifetime?: LevelStreamingAssetLifetimePolicy;
}

export interface LevelStreamingPlan {
  manifestId: string;
  activeChunkIds: readonly string[];
  preloadChunkIds: readonly string[];
  retainChunkIds: readonly string[];
  loadChunkIds: readonly string[];
  unloadChunkIds: readonly string[];
  assetManifest: AssetManifest;
  activeChunks: readonly ResolvedLevelChunk[];
  preloadChunks: readonly ResolvedLevelChunk[];
  retainChunks: readonly ResolvedLevelChunk[];
}

export interface LevelChunkStreamerSnapshot {
  manifestId: string;
  loadedChunkIds: readonly string[];
}
