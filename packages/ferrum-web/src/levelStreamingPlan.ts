import type { AssetManifest } from "./assetLoader.js";
import { compareChunks, resolveManifestInput } from "./levelStreamingManifest.js";
import type {
  LevelChunkBounds,
  LevelChunkManifestSpec,
  LevelStreamingAssetLifetimePolicy,
  LevelStreamingPlan,
  LevelStreamingPlanOptions,
  LevelStreamingViewport,
  ResolvedLevelChunk,
  ResolvedLevelChunkManifest,
} from "./levelStreamingTypes.js";
import {
  finiteNumber,
  invalid,
  isRecord,
  nonNegativeInteger,
  positiveInteger,
  positiveNumber,
} from "./levelStreamingValidation.js";

export function resolveLevelStreamingPlan(
  manifest: LevelChunkManifestSpec | ResolvedLevelChunkManifest,
  viewport: LevelStreamingViewport,
  options: LevelStreamingPlanOptions = {},
): LevelStreamingPlan {
  const resolved = resolveManifestInput(manifest);
  const loaded = new Set(options.loadedChunkIds ?? []);
  return resolveLevelStreamingPlanForResolvedManifest(
    resolved,
    viewport,
    options.assetLifetime ?? {},
    loaded,
    true,
  );
}

export function resolveLevelStreamingPlanForResolvedManifest(
  resolved: ResolvedLevelChunkManifest,
  viewport: LevelStreamingViewport,
  assetLifetime: LevelStreamingAssetLifetimePolicy,
  loaded: ReadonlySet<string>,
  validateLoadedChunks: boolean,
): LevelStreamingPlan {
  const normalizedViewport = resolveViewport(viewport, "levelStreaming.viewport");
  const policy = resolveAssetLifetimePolicy(assetLifetime, "levelStreaming.assetLifetime");
  if (validateLoadedChunks) {
    validateLoadedChunkIds(resolved, loaded);
  }

  const activeViewport = viewportBounds(normalizedViewport, 0);
  const chunkMargin = chunkMarginWorldSize(resolved);
  const preloadViewport = viewportBounds(
    normalizedViewport,
    policy.preloadMarginChunks * chunkMargin,
  );
  const retainViewport = viewportBounds(
    normalizedViewport,
    policy.retainMarginChunks * chunkMargin,
  );
  const classification = classifyStreamingChunks(
    resolved.chunks,
    activeViewport,
    preloadViewport,
    retainViewport,
    loaded,
  );
  const retainChunks = capRetainedChunks(
    classification.retainCandidates,
    normalizedViewport,
    policy.maxRetainedChunks,
  );
  const retainChunkIds = sortedChunkIds(retainChunks);
  const retainChunkIdSet = new Set(retainChunkIds);
  const unloadChunkIds = unloadedChunkIds(loaded, retainChunkIdSet);

  return {
    manifestId: resolved.id,
    activeChunkIds: classification.activeChunkIds,
    preloadChunkIds: classification.preloadChunkIds.sort(),
    retainChunkIds,
    loadChunkIds: classification.loadChunkIds,
    unloadChunkIds,
    assetManifest: assetManifestForChunks(classification.preloadAssetChunks),
    activeChunks: classification.activeChunks,
    preloadChunks: classification.preloadChunks,
    retainChunks,
    unloadChunks: chunksByIds(resolved, unloadChunkIds),
  };
}

function validateLoadedChunkIds(
  manifest: ResolvedLevelChunkManifest,
  loaded: ReadonlySet<string>,
): void {
  for (const chunkId of loaded) {
    if (manifest.chunksById[chunkId] === undefined) {
      throw invalid("levelStreaming.loadedChunkIds", `references missing chunk '${chunkId}'`);
    }
  }
}

interface StreamingChunkClassification {
  activeChunks: ResolvedLevelChunk[];
  activeChunkIds: string[];
  preloadChunks: ResolvedLevelChunk[];
  preloadChunkIds: string[];
  preloadAssetChunks: ResolvedLevelChunk[];
  loadChunkIds: string[];
  retainCandidates: ResolvedLevelChunk[];
}

function classifyStreamingChunks(
  chunks: readonly ResolvedLevelChunk[],
  activeViewport: LevelChunkBounds,
  preloadViewport: LevelChunkBounds,
  retainViewport: LevelChunkBounds,
  loaded: ReadonlySet<string>,
): StreamingChunkClassification {
  const activeChunks: ResolvedLevelChunk[] = [];
  const activeChunkIds: string[] = [];
  const preloadChunks: ResolvedLevelChunk[] = [];
  const preloadChunkIds: string[] = [];
  const preloadAssetChunks: ResolvedLevelChunk[] = [];
  const loadChunkIds: string[] = [];
  const retainCandidates: ResolvedLevelChunk[] = [];

  for (const chunk of chunks) {
    if (intersects(chunk.bounds, activeViewport)) {
      activeChunks.push(chunk);
      activeChunkIds.push(chunk.id);
    }
    if (intersects(chunk.bounds, preloadViewport)) {
      preloadChunks.push(chunk);
      preloadChunkIds.push(chunk.id);
      if (!loaded.has(chunk.id)) {
        preloadAssetChunks.push(chunk);
        loadChunkIds.push(chunk.id);
      }
    }
    if (intersects(chunk.bounds, retainViewport)) {
      retainCandidates.push(chunk);
    }
  }

  return {
    activeChunks,
    activeChunkIds,
    preloadChunks,
    preloadChunkIds,
    preloadAssetChunks,
    loadChunkIds,
    retainCandidates,
  };
}

function sortedChunkIds(chunks: readonly ResolvedLevelChunk[]): string[] {
  const ids: string[] = [];
  for (const chunk of chunks) {
    ids.push(chunk.id);
  }
  return ids.sort();
}

function unloadedChunkIds(
  loaded: ReadonlySet<string>,
  retained: ReadonlySet<string>,
): string[] {
  const chunkIds: string[] = [];
  for (const chunkId of loaded) {
    if (!retained.has(chunkId)) {
      chunkIds.push(chunkId);
    }
  }
  return chunkIds.sort();
}

function chunksByIds(
  manifest: ResolvedLevelChunkManifest,
  chunkIds: readonly string[],
): readonly ResolvedLevelChunk[] {
  const chunks: ResolvedLevelChunk[] = [];
  for (const chunkId of chunkIds) {
    const chunk = manifest.chunksById[chunkId];
    if (chunk !== undefined) {
      chunks.push(chunk);
    }
  }
  return chunks;
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
