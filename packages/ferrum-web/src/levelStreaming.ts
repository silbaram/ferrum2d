import type { AssetManifest } from "./assetLoader.js";
import { levelStreamingDiagnosticError } from "./diagnostics.js";

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

export class LevelChunkStreamer {
  private readonly loadedChunkIds = new Set<string>();

  constructor(
    private readonly manifest: ResolvedLevelChunkManifest,
    private readonly assetLifetime: LevelStreamingAssetLifetimePolicy = {},
  ) {}

  static create(
    manifest: LevelChunkManifestSpec | ResolvedLevelChunkManifest,
    assetLifetime: LevelStreamingAssetLifetimePolicy = {},
  ): LevelChunkStreamer {
    return new LevelChunkStreamer(resolveManifestInput(manifest), assetLifetime);
  }

  plan(viewport: LevelStreamingViewport): LevelStreamingPlan {
    return resolveLevelStreamingPlan(this.manifest, viewport, {
      loadedChunkIds: [...this.loadedChunkIds],
      assetLifetime: this.assetLifetime,
    });
  }

  markLoaded(chunkIds: readonly string[]): LevelChunkStreamerSnapshot {
    for (const chunkId of chunkIds) {
      this.requireChunk(chunkId);
      this.loadedChunkIds.add(chunkId);
    }
    return this.snapshot();
  }

  markUnloaded(chunkIds: readonly string[]): LevelChunkStreamerSnapshot {
    for (const chunkId of chunkIds) {
      this.loadedChunkIds.delete(chunkId);
    }
    return this.snapshot();
  }

  snapshot(): LevelChunkStreamerSnapshot {
    return {
      manifestId: this.manifest.id,
      loadedChunkIds: [...this.loadedChunkIds].sort(),
    };
  }

  private requireChunk(chunkId: string): void {
    if (this.manifest.chunksById[chunkId] === undefined) {
      throw invalid("levelStreaming.loadedChunkIds", `references missing chunk '${chunkId}'`);
    }
  }
}

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

export function resolveLevelStreamingPlan(
  manifest: LevelChunkManifestSpec | ResolvedLevelChunkManifest,
  viewport: LevelStreamingViewport,
  options: LevelStreamingPlanOptions = {},
): LevelStreamingPlan {
  const resolved = resolveManifestInput(manifest);
  const normalizedViewport = resolveViewport(viewport, "levelStreaming.viewport");
  const policy = resolveAssetLifetimePolicy(options.assetLifetime ?? {}, "levelStreaming.assetLifetime");
  const loaded = new Set(options.loadedChunkIds ?? []);
  for (const chunkId of loaded) {
    if (resolved.chunksById[chunkId] === undefined) {
      throw invalid("levelStreaming.loadedChunkIds", `references missing chunk '${chunkId}'`);
    }
  }

  const activeViewport = viewportBounds(normalizedViewport, 0);
  const preloadViewport = viewportBounds(
    normalizedViewport,
    policy.preloadMarginChunks * chunkMarginWorldSize(resolved),
  );
  const retainViewport = viewportBounds(
    normalizedViewport,
    policy.retainMarginChunks * chunkMarginWorldSize(resolved),
  );
  const activeChunks = resolved.chunks.filter((chunk) => intersects(chunk.bounds, activeViewport));
  const preloadChunks = resolved.chunks.filter((chunk) => intersects(chunk.bounds, preloadViewport));
  const retainChunks = capRetainedChunks(
    resolved.chunks.filter((chunk) => intersects(chunk.bounds, retainViewport)),
    normalizedViewport,
    policy.maxRetainedChunks,
  );
  const retainChunkIds = new Set(retainChunks.map((chunk) => chunk.id));
  const preloadChunkIds = new Set(preloadChunks.map((chunk) => chunk.id));
  const loadChunkIds = preloadChunks
    .filter((chunk) => !loaded.has(chunk.id))
    .map((chunk) => chunk.id);
  const unloadChunkIds = [...loaded]
    .filter((chunkId) => !retainChunkIds.has(chunkId))
    .sort();

  return {
    manifestId: resolved.id,
    activeChunkIds: activeChunks.map((chunk) => chunk.id),
    preloadChunkIds: [...preloadChunkIds].sort(),
    retainChunkIds: [...retainChunkIds].sort(),
    loadChunkIds,
    unloadChunkIds,
    assetManifest: assetManifestForChunks(preloadChunks.filter((chunk) => !loaded.has(chunk.id))),
    activeChunks,
    preloadChunks,
    retainChunks,
  };
}

function resolveManifestInput(manifest: LevelChunkManifestSpec | ResolvedLevelChunkManifest): ResolvedLevelChunkManifest {
  if (isResolvedLevelChunkManifest(manifest)) {
    return manifest;
  }
  return resolveLevelChunkManifest(manifest);
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

function resolveViewport(viewport: LevelStreamingViewport, path: string): LevelStreamingViewport {
  if (!isRecord(viewport)) {
    throw invalid(path, "must be an object");
  }
  return {
    x: finiteNumber(viewport.x, `${path}.x`),
    y: finiteNumber(viewport.y, `${path}.y`),
    width: positiveNumber(viewport.width, `${path}.width`),
    height: positiveNumber(viewport.height, `${path}.height`),
  };
}

function resolveAssetLifetimePolicy(
  policy: LevelStreamingAssetLifetimePolicy,
  path: string,
): Required<LevelStreamingAssetLifetimePolicy> {
  if (!isRecord(policy)) {
    throw invalid(path, "must be an object");
  }
  const preloadMarginChunks = nonNegativeInteger(policy.preloadMarginChunks ?? 1, `${path}.preloadMarginChunks`);
  const retainMarginChunks = nonNegativeInteger(
    policy.retainMarginChunks ?? preloadMarginChunks,
    `${path}.retainMarginChunks`,
  );
  return {
    preloadMarginChunks,
    retainMarginChunks,
    maxRetainedChunks: positiveInteger(policy.maxRetainedChunks ?? Number.MAX_SAFE_INTEGER, `${path}.maxRetainedChunks`),
  };
}

function viewportBounds(viewport: LevelStreamingViewport, margin: number): LevelChunkBounds {
  return {
    minX: viewport.x - margin,
    minY: viewport.y - margin,
    maxX: viewport.x + viewport.width + margin,
    maxY: viewport.y + viewport.height + margin,
    width: viewport.width + margin * 2,
    height: viewport.height + margin * 2,
  };
}

function intersects(a: LevelChunkBounds, b: LevelChunkBounds): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

function chunkMarginWorldSize(manifest: ResolvedLevelChunkManifest): number {
  return Math.max(manifest.chunkColumns * manifest.tileWidth, manifest.chunkRows * manifest.tileHeight);
}

function capRetainedChunks(
  chunks: readonly ResolvedLevelChunk[],
  viewport: LevelStreamingViewport,
  maxRetainedChunks: number,
): readonly ResolvedLevelChunk[] {
  if (chunks.length <= maxRetainedChunks) {
    return chunks;
  }
  const centerX = viewport.x + viewport.width / 2;
  const centerY = viewport.y + viewport.height / 2;
  return [...chunks]
    .sort((a, b) => chunkDistanceSquared(a, centerX, centerY) - chunkDistanceSquared(b, centerX, centerY)
      || compareChunks(a, b))
    .slice(0, maxRetainedChunks)
    .sort(compareChunks);
}

function chunkDistanceSquared(chunk: ResolvedLevelChunk, x: number, y: number): number {
  const chunkCenterX = (chunk.bounds.minX + chunk.bounds.maxX) / 2;
  const chunkCenterY = (chunk.bounds.minY + chunk.bounds.maxY) / 2;
  return (chunkCenterX - x) ** 2 + (chunkCenterY - y) ** 2;
}

function assetManifestForChunks(chunks: readonly ResolvedLevelChunk[]): AssetManifest {
  const manifest: AssetManifest = {};
  for (const chunk of chunks) {
    if (chunk.tilemap?.url !== undefined) {
      appendAsset(manifest, "json", `${chunk.id}:tilemap`, chunk.tilemap.url);
    }
    appendAssetMap(manifest, "textures", chunk.assets.textures);
    appendAssetMap(manifest, "sounds", chunk.assets.sounds);
    appendAssetMap(manifest, "json", chunk.assets.json);
  }
  return manifest;
}

function appendAssetMap(
  manifest: AssetManifest,
  kind: "textures" | "sounds" | "json",
  entries: Record<string, string> | undefined,
): void {
  if (entries === undefined) {
    return;
  }
  for (const [name, url] of Object.entries(entries)) {
    appendAsset(manifest, kind, name, url);
  }
}

function appendAsset(
  manifest: AssetManifest,
  kind: "textures" | "sounds" | "json",
  name: string,
  url: string,
): void {
  const bucket = manifest[kind] ?? {};
  if (bucket[name] !== undefined && bucket[name] !== url) {
    throw invalid("levelStreaming.assetManifest", `asset '${name}' maps to multiple URLs`);
  }
  bucket[name] = url;
  manifest[kind] = bucket;
}

function compareChunks(a: ResolvedLevelChunk, b: ResolvedLevelChunk): number {
  return a.chunkY - b.chunkY || a.chunkX - b.chunkX || a.id.localeCompare(b.id);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalid(path, "must be a non-empty string");
  }
  return value;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalid(path, "must be a finite number");
  }
  return value;
}

function positiveNumber(value: unknown, path: string): number {
  const number = finiteNumber(value, path);
  if (number <= 0) {
    throw invalid(path, "must be greater than 0");
  }
  return number;
}

function integer(value: unknown, path: string): number {
  const number = finiteNumber(value, path);
  if (!Number.isInteger(number)) {
    throw invalid(path, "must be an integer");
  }
  return number;
}

function positiveInteger(value: unknown, path: string): number {
  const number = integer(value, path);
  if (number <= 0) {
    throw invalid(path, "must be greater than 0");
  }
  return number;
}

function nonNegativeInteger(value: unknown, path: string): number {
  const number = integer(value, path);
  if (number < 0) {
    throw invalid(path, "must be greater than or equal to 0");
  }
  return number;
}

function invalid(path: string, detail: string): Error {
  return levelStreamingDiagnosticError(path, detail);
}
