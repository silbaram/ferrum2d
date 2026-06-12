import type { AssetManifest } from "./assetLoader.js";
import {
  preloadAssetManifest,
  resolveAssetPreloadPlan,
} from "./assetPreload.js";
import type {
  AssetPreloadCache,
  AssetPreloadCachePolicy,
  PreloadedAssetManifest,
  PreloadAssetManifestOptions,
} from "./assetPreload.js";
import { LevelChunkStreamer } from "./levelStreamingStreamer.js";
import type {
  LevelChunkManifestSpec,
  LevelChunkStreamerSnapshot,
  LevelStreamingAssetLifetimePolicy,
  LevelStreamingPlan,
  LevelStreamingViewport,
  ResolvedLevelChunk,
  ResolvedLevelChunkManifest,
} from "./levelStreamingTypes.js";
import type { FerrumRuntimeFrame } from "./createFerrumRuntime.js";

export type FerrumRuntimeLevelStreamingViewportProvider =
  (frame: FerrumRuntimeFrame) => LevelStreamingViewport | false | undefined;

export interface FerrumRuntimeLevelStreamingPreloadOptions extends PreloadAssetManifestOptions {
  cache?: AssetPreloadCache;
  cachePolicy?: AssetPreloadCachePolicy;
}

export type FerrumRuntimeLevelStreamingReleasedAssetKind = "texture" | "sound" | "json";

export interface FerrumRuntimeLevelStreamingReleasedAsset {
  kind: FerrumRuntimeLevelStreamingReleasedAssetKind;
  name: string;
  url: string;
}

export interface FerrumRuntimeLevelStreamingReleasedAssets {
  entries: readonly FerrumRuntimeLevelStreamingReleasedAsset[];
  textures: readonly FerrumRuntimeLevelStreamingReleasedAsset[];
  sounds: readonly FerrumRuntimeLevelStreamingReleasedAsset[];
  json: readonly FerrumRuntimeLevelStreamingReleasedAsset[];
  total: number;
}

export interface FerrumRuntimeLevelStreamingUpdateResult {
  plan: LevelStreamingPlan;
  snapshot: LevelChunkStreamerSnapshot;
  loadChunkIds: readonly string[];
  unloadChunkIds: readonly string[];
  pendingChunkIds: readonly string[];
  preloaded?: PreloadedAssetManifest;
  releasedAssets?: FerrumRuntimeLevelStreamingReleasedAssets;
}

export interface FerrumRuntimeLevelStreamingChunkContext {
  result: FerrumRuntimeLevelStreamingUpdateResult;
  frame: FerrumRuntimeFrame;
  levelStreaming: FerrumRuntimeLevelStreaming;
}

export interface FerrumRuntimeLevelStreamingTarget {
  applyChunk?: (
    chunk: ResolvedLevelChunk,
    context: FerrumRuntimeLevelStreamingChunkContext,
  ) => void;
  unloadChunk?: (
    chunk: ResolvedLevelChunk,
    context: FerrumRuntimeLevelStreamingChunkContext,
  ) => void;
  releaseAssets?: (
    assets: FerrumRuntimeLevelStreamingReleasedAssets,
    context: FerrumRuntimeLevelStreamingChunkContext,
  ) => void;
  rebuildColliders?: (
    context: FerrumRuntimeLevelStreamingChunkContext,
  ) => void;
}

export interface FerrumRuntimeLevelStreamingOptions {
  manifest?: LevelChunkManifestSpec | ResolvedLevelChunkManifest;
  streamer?: LevelChunkStreamer;
  assetLifetime?: LevelStreamingAssetLifetimePolicy;
  viewport?: LevelStreamingViewport | FerrumRuntimeLevelStreamingViewportProvider;
  preload?: boolean | FerrumRuntimeLevelStreamingPreloadOptions;
  target?: FerrumRuntimeLevelStreamingTarget;
  updateIntervalFrames?: number;
  onPlan?: (
    result: FerrumRuntimeLevelStreamingUpdateResult,
    frame: FerrumRuntimeFrame,
    levelStreaming: FerrumRuntimeLevelStreaming,
  ) => void;
  onLoad?: (
    result: FerrumRuntimeLevelStreamingUpdateResult,
    frame: FerrumRuntimeFrame,
    levelStreaming: FerrumRuntimeLevelStreaming,
  ) => void;
  onUnload?: (
    result: FerrumRuntimeLevelStreamingUpdateResult,
    frame: FerrumRuntimeFrame,
    levelStreaming: FerrumRuntimeLevelStreaming,
  ) => void;
  onError?: (
    error: unknown,
    frame: FerrumRuntimeFrame,
    levelStreaming: FerrumRuntimeLevelStreaming,
  ) => void;
}

export interface FerrumRuntimeLevelStreaming {
  streamer: LevelChunkStreamer;
  update(frame: FerrumRuntimeFrame): FerrumRuntimeLevelStreamingUpdateResult | undefined;
  snapshot(): LevelChunkStreamerSnapshot;
  lastPlan(): LevelStreamingPlan | undefined;
  pendingChunkIds(): readonly string[];
  destroy(): void;
}

interface CompletedRuntimePreload {
  loadChunkIds: readonly string[];
  preloaded: PreloadedAssetManifest;
}

interface FailedRuntimePreload {
  loadChunkIds: readonly string[];
  error: unknown;
}

export function createRuntimeLevelStreaming(
  options: FerrumRuntimeLevelStreamingOptions | LevelChunkStreamer,
  viewportSize: () => { width: number; height: number },
  onAssetProgress?: PreloadAssetManifestOptions["onProgress"],
): FerrumRuntimeLevelStreaming {
  const normalized = normalizeOptions(options);
  const streamer = normalized.streamer ?? LevelChunkStreamer.create(
    requireManifest(normalized),
    normalized.assetLifetime,
  );
  const pendingChunkIds = new Set<string>();
  const completedPreloads: CompletedRuntimePreload[] = [];
  const failedPreloads: FailedRuntimePreload[] = [];
  let destroyed = false;
  let lastPlan: LevelStreamingPlan | undefined;
  let lastViewportKey: string | undefined;
  let dirty = true;
  let frameCount = 0;
  let levelStreaming: FerrumRuntimeLevelStreaming;

  const updateIntervalFrames = positiveUpdateInterval(normalized.updateIntervalFrames);

  levelStreaming = {
    streamer,
    update: (frame) => {
      if (destroyed) {
        return undefined;
      }
      frameCount += 1;
      const viewport = resolveRuntimeViewport(normalized.viewport, frame, viewportSize);
      if (viewport === false) {
        return undefined;
      }

      const viewportKeyValue = viewportKey(viewport);
      const shouldUpdate = dirty
        || viewportKeyValue !== lastViewportKey
        || frameCount % updateIntervalFrames === 0;
      if (!shouldUpdate) {
        return undefined;
      }
      dirty = false;
      lastViewportKey = viewportKeyValue;

      flushFailedLoads(
        failedPreloads,
        normalized,
        frame,
        levelStreaming,
        pendingChunkIds,
      );
      let plan = streamer.plan(viewport);
      const appliedCompletedLoads = flushCompletedLoads(
        completedPreloads,
        normalized,
        plan,
        frame,
        levelStreaming,
        pendingChunkIds,
      );
      if (appliedCompletedLoads) {
        plan = streamer.plan(viewport);
      }
      lastPlan = plan;
      const unloaded = applyUnloads(streamer, plan.unloadChunkIds);
      const unloadedChunks = chunksForIds(plan.unloadChunks, unloaded);
      const releasedAssets = releaseAssetsForUnloadedChunks(unloadedChunks, plan);
      if (unloaded.length > 0) {
        dirty = true;
        const unloadResult = updateResult(
          plan,
          streamer.snapshot(),
          pendingChunkIds,
          [],
          unloaded,
          undefined,
          releasedAssets,
        );
        applyTargetUnloads(
          normalized.target,
          unloadedChunks,
          unloadResult,
          frame,
          levelStreaming,
        );
      }
      const startedLoadChunkIds = startLoads(
        plan,
        normalized,
        frame,
        levelStreaming,
        pendingChunkIds,
        completedPreloads,
        failedPreloads,
        onAssetProgress,
        () => destroyed,
        () => {
          dirty = true;
        },
      );
      const result = updateResult(
        plan,
        streamer.snapshot(),
        pendingChunkIds,
        startedLoadChunkIds,
        unloaded,
        undefined,
        releasedAssets,
      );
      normalized.onPlan?.(result, frame, levelStreaming);
      if (unloaded.length > 0) {
        normalized.onUnload?.(result, frame, levelStreaming);
      }
      return result;
    },
    snapshot: () => streamer.snapshot(),
    lastPlan: () => lastPlan,
    pendingChunkIds: () => [...pendingChunkIds].sort(),
    destroy: () => {
      destroyed = true;
      pendingChunkIds.clear();
      completedPreloads.length = 0;
      failedPreloads.length = 0;
    },
  };

  return levelStreaming;
}

function normalizeOptions(
  options: FerrumRuntimeLevelStreamingOptions | LevelChunkStreamer,
): FerrumRuntimeLevelStreamingOptions {
  return options instanceof LevelChunkStreamer ? { streamer: options } : options;
}

function requireManifest(options: FerrumRuntimeLevelStreamingOptions): LevelChunkManifestSpec | ResolvedLevelChunkManifest {
  if (options.manifest === undefined) {
    throw new Error("FerrumRuntime levelStreaming requires a manifest or streamer.");
  }
  return options.manifest;
}

function positiveUpdateInterval(value: number | undefined): number {
  if (value === undefined) {
    return 1;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("FerrumRuntime levelStreaming.updateIntervalFrames must be a positive integer.");
  }
  return value;
}

function resolveRuntimeViewport(
  viewport: FerrumRuntimeLevelStreamingOptions["viewport"],
  frame: FerrumRuntimeFrame,
  viewportSize: () => { width: number; height: number },
): LevelStreamingViewport | false {
  if (typeof viewport === "function") {
    return viewport(frame) ?? false;
  }
  if (viewport !== undefined) {
    return viewport;
  }
  const size = viewportSize();
  return {
    x: frame.frame.cameraX - size.width / 2,
    y: frame.frame.cameraY - size.height / 2,
    width: size.width,
    height: size.height,
  };
}

function viewportKey(viewport: LevelStreamingViewport): string {
  return `${viewport.x}:${viewport.y}:${viewport.width}:${viewport.height}`;
}

function applyUnloads(streamer: LevelChunkStreamer, chunkIds: readonly string[]): readonly string[] {
  if (chunkIds.length === 0) {
    return [];
  }
  streamer.markUnloaded(chunkIds);
  return [...chunkIds].sort();
}

function startLoads(
  plan: LevelStreamingPlan,
  options: FerrumRuntimeLevelStreamingOptions,
  frame: FerrumRuntimeFrame,
  levelStreaming: FerrumRuntimeLevelStreaming,
  pendingChunkIds: Set<string>,
  completedPreloads: CompletedRuntimePreload[],
  failedPreloads: FailedRuntimePreload[],
  onAssetProgress: PreloadAssetManifestOptions["onProgress"] | undefined,
  isDestroyed: () => boolean,
  markDirty: () => void,
): readonly string[] {
  const loadChunkIds = plan.loadChunkIds.filter((chunkId) => !pendingChunkIds.has(chunkId));
  if (loadChunkIds.length === 0) {
    return [];
  }

  for (const chunkId of loadChunkIds) {
    pendingChunkIds.add(chunkId);
  }
  const loadManifest = assetManifestForRuntimeChunks(
    plan.preloadChunks.filter((chunk) => loadChunkIds.includes(chunk.id)),
  );
  const preloadPlan = resolveAssetPreloadPlan(loadManifest);
  if (options.preload === false || preloadPlan.total === 0) {
    const snapshot = levelStreaming.streamer.markLoaded(loadChunkIds);
    for (const chunkId of loadChunkIds) {
      pendingChunkIds.delete(chunkId);
    }
    markDirty();
    const result = updateResult(plan, snapshot, pendingChunkIds, loadChunkIds, []);
    applyTargetLoads(
      options.target,
      chunksForIds(plan.preloadChunks, loadChunkIds),
      result,
      frame,
      levelStreaming,
    );
    options.onLoad?.(
      result,
      frame,
      levelStreaming,
    );
    return [...loadChunkIds].sort();
  }

  const preloadOptions = runtimePreloadOptions(options.preload, onAssetProgress);
  void preloadAssetManifest(loadManifest, preloadOptions)
    .then((preloaded) => {
      if (isDestroyed()) {
        return;
      }
      completedPreloads.push({
        loadChunkIds: [...loadChunkIds],
        preloaded,
      });
      markDirty();
    })
    .catch((error) => {
      if (isDestroyed()) {
        return;
      }
      failedPreloads.push({
        loadChunkIds: [...loadChunkIds],
        error,
      });
      markDirty();
    });
  return [...loadChunkIds].sort();
}

function flushFailedLoads(
  failedPreloads: FailedRuntimePreload[],
  options: FerrumRuntimeLevelStreamingOptions,
  frame: FerrumRuntimeFrame,
  levelStreaming: FerrumRuntimeLevelStreaming,
  pendingChunkIds: Set<string>,
): void {
  if (failedPreloads.length === 0) {
    return;
  }
  const failures = failedPreloads.splice(0);
  for (const failure of failures) {
    for (const chunkId of failure.loadChunkIds) {
      pendingChunkIds.delete(chunkId);
    }
    options.onError?.(failure.error, frame, levelStreaming);
  }
}

function flushCompletedLoads(
  completedPreloads: CompletedRuntimePreload[],
  options: FerrumRuntimeLevelStreamingOptions,
  plan: LevelStreamingPlan,
  frame: FerrumRuntimeFrame,
  levelStreaming: FerrumRuntimeLevelStreaming,
  pendingChunkIds: Set<string>,
): boolean {
  if (completedPreloads.length === 0) {
    return false;
  }
  let appliedLoads = false;
  const completions = completedPreloads.splice(0);
  for (const completion of completions) {
    const retainedLoadChunkIds = retainedLoadChunkIdsForPlan(completion.loadChunkIds, plan);
    for (const chunkId of completion.loadChunkIds) {
      pendingChunkIds.delete(chunkId);
    }
    if (retainedLoadChunkIds.length === 0) {
      continue;
    }

    const retainedChunks = chunksForIds(plan.preloadChunks, retainedLoadChunkIds);
    const snapshot = levelStreaming.streamer.markLoaded(retainedLoadChunkIds);
    const preloaded = filterPreloadedForChunks(completion.preloaded, retainedChunks);
    const result = updateResult(plan, snapshot, pendingChunkIds, retainedLoadChunkIds, [], preloaded);
    applyTargetLoads(
      options.target,
      retainedChunks,
      result,
      frame,
      levelStreaming,
    );
    options.onLoad?.(
      result,
      frame,
      levelStreaming,
    );
    appliedLoads = true;
  }
  return appliedLoads;
}

function retainedLoadChunkIdsForPlan(
  loadChunkIds: readonly string[],
  plan: LevelStreamingPlan,
): readonly string[] {
  const retained = new Set([...plan.preloadChunkIds, ...plan.retainChunkIds]);
  return loadChunkIds.filter((chunkId) => retained.has(chunkId));
}

function runtimePreloadOptions(
  preload: FerrumRuntimeLevelStreamingOptions["preload"],
  onAssetProgress: PreloadAssetManifestOptions["onProgress"] | undefined,
): PreloadAssetManifestOptions {
  if (preload === false) {
    return {};
  }
  const options: FerrumRuntimeLevelStreamingPreloadOptions =
    preload === true || preload === undefined ? {} : preload;
  return {
    ...options,
    onProgress: (progress) => {
      onAssetProgress?.(progress);
      options.onProgress?.(progress);
    },
  };
}

function applyTargetLoads(
  target: FerrumRuntimeLevelStreamingTarget | undefined,
  chunks: readonly ResolvedLevelChunk[],
  result: FerrumRuntimeLevelStreamingUpdateResult,
  frame: FerrumRuntimeFrame,
  levelStreaming: FerrumRuntimeLevelStreaming,
): void {
  if (target === undefined || chunks.length === 0) {
    return;
  }
  const context = targetContext(result, frame, levelStreaming);
  for (const chunk of chunks) {
    target.applyChunk?.(chunk, context);
  }
  target.rebuildColliders?.(context);
}

function applyTargetUnloads(
  target: FerrumRuntimeLevelStreamingTarget | undefined,
  chunks: readonly ResolvedLevelChunk[],
  result: FerrumRuntimeLevelStreamingUpdateResult,
  frame: FerrumRuntimeFrame,
  levelStreaming: FerrumRuntimeLevelStreaming,
): void {
  if (target === undefined || chunks.length === 0) {
    return;
  }
  const context = targetContext(result, frame, levelStreaming);
  for (const chunk of chunks) {
    target.unloadChunk?.(chunk, context);
  }
  if (result.releasedAssets !== undefined) {
    target.releaseAssets?.(result.releasedAssets, context);
  }
  target.rebuildColliders?.(context);
}

function targetContext(
  result: FerrumRuntimeLevelStreamingUpdateResult,
  frame: FerrumRuntimeFrame,
  levelStreaming: FerrumRuntimeLevelStreaming,
): FerrumRuntimeLevelStreamingChunkContext {
  return {
    result,
    frame,
    levelStreaming,
  };
}

function chunksForIds(
  chunks: readonly ResolvedLevelChunk[],
  chunkIds: readonly string[],
): readonly ResolvedLevelChunk[] {
  const ids = new Set(chunkIds);
  return chunks.filter((chunk) => ids.has(chunk.id));
}

function updateResult(
  plan: LevelStreamingPlan,
  snapshot: LevelChunkStreamerSnapshot,
  pendingChunkIds: ReadonlySet<string>,
  loadChunkIds: readonly string[],
  unloadChunkIds: readonly string[],
  preloaded?: PreloadedAssetManifest,
  releasedAssets?: FerrumRuntimeLevelStreamingReleasedAssets,
): FerrumRuntimeLevelStreamingUpdateResult {
  return {
    plan,
    snapshot,
    loadChunkIds: [...loadChunkIds].sort(),
    unloadChunkIds: [...unloadChunkIds].sort(),
    pendingChunkIds: [...pendingChunkIds].sort(),
    ...(preloaded === undefined ? {} : { preloaded }),
    ...(releasedAssets === undefined ? {} : { releasedAssets }),
  };
}

function releaseAssetsForUnloadedChunks(
  unloadedChunks: readonly ResolvedLevelChunk[],
  plan: LevelStreamingPlan,
): FerrumRuntimeLevelStreamingReleasedAssets | undefined {
  if (unloadedChunks.length === 0) {
    return undefined;
  }

  const retainedAssetKeys = assetKeysForChunks([
    ...plan.preloadChunks,
    ...plan.retainChunks,
  ]);
  const releaseEntriesByKey = new Map<string, FerrumRuntimeLevelStreamingReleasedAsset>();
  for (const entry of assetEntriesForChunks(unloadedChunks)) {
    const key = assetEntryKey(entry);
    if (!retainedAssetKeys.has(key) && !releaseEntriesByKey.has(key)) {
      releaseEntriesByKey.set(key, entry);
    }
  }
  const releaseEntries = [...releaseEntriesByKey.values()].sort(compareReleasedAssets);

  if (releaseEntries.length === 0) {
    return undefined;
  }

  return {
    entries: releaseEntries,
    textures: releaseEntries.filter((entry) => entry.kind === "texture"),
    sounds: releaseEntries.filter((entry) => entry.kind === "sound"),
    json: releaseEntries.filter((entry) => entry.kind === "json"),
    total: releaseEntries.length,
  };
}

function assetKeysForChunks(chunks: readonly ResolvedLevelChunk[]): Set<string> {
  const keys = new Set<string>();
  for (const entry of assetEntriesForChunks(chunks)) {
    keys.add(assetEntryKey(entry));
  }
  return keys;
}

function assetEntriesForChunks(
  chunks: readonly ResolvedLevelChunk[],
): FerrumRuntimeLevelStreamingReleasedAsset[] {
  const entries: FerrumRuntimeLevelStreamingReleasedAsset[] = [];
  for (const chunk of chunks) {
    if (chunk.tilemap?.url !== undefined) {
      entries.push({
        kind: "json",
        name: `${chunk.id}:tilemap`,
        url: chunk.tilemap.url,
      });
    }
    appendAssetReleaseEntries(entries, "texture", chunk.assets.textures);
    appendAssetReleaseEntries(entries, "sound", chunk.assets.sounds);
    appendAssetReleaseEntries(entries, "json", chunk.assets.json);
  }
  return entries;
}

function appendAssetReleaseEntries(
  entries: FerrumRuntimeLevelStreamingReleasedAsset[],
  kind: FerrumRuntimeLevelStreamingReleasedAssetKind,
  assets: Record<string, string> | undefined,
): void {
  if (assets === undefined) {
    return;
  }
  for (const [name, url] of Object.entries(assets)) {
    entries.push({ kind, name, url });
  }
}

function assetEntryKey(entry: FerrumRuntimeLevelStreamingReleasedAsset): string {
  return `${entry.kind}\0${entry.name}\0${entry.url}`;
}

function compareReleasedAssets(
  a: FerrumRuntimeLevelStreamingReleasedAsset,
  b: FerrumRuntimeLevelStreamingReleasedAsset,
): number {
  const kindDelta = releaseKindOrder(a.kind) - releaseKindOrder(b.kind);
  if (kindDelta !== 0) {
    return kindDelta;
  }
  const nameDelta = a.name.localeCompare(b.name);
  if (nameDelta !== 0) {
    return nameDelta;
  }
  return a.url.localeCompare(b.url);
}

function releaseKindOrder(kind: FerrumRuntimeLevelStreamingReleasedAssetKind): number {
  if (kind === "texture") return 0;
  if (kind === "sound") return 1;
  return 2;
}

function filterPreloadedForChunks(
  preloaded: PreloadedAssetManifest,
  chunks: readonly ResolvedLevelChunk[],
): PreloadedAssetManifest {
  const manifest = assetManifestForRuntimeChunks(chunks);
  const plan = resolveAssetPreloadPlan(manifest);
  const retainedJsonNames = new Set(
    plan.entries
      .filter((entry) => entry.kind === "json")
      .map((entry) => entry.name),
  );
  const json = Object.fromEntries(
    Object.entries(preloaded.json).filter(([name]) => retainedJsonNames.has(name)),
  );
  const loaded = plan.total;
  const fetched = Math.min(preloaded.fetched, loaded);
  const cached = Math.min(preloaded.cached, Math.max(0, loaded - fetched));
  return {
    ...preloaded,
    plan,
    progress: {
      ...preloaded.progress,
      loaded,
      total: loaded,
      ratio: 1,
    },
    json,
    fetched,
    cached,
  };
}

function assetManifestForRuntimeChunks(chunks: readonly ResolvedLevelChunk[]): AssetManifest {
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
    throw new Error(`FerrumRuntime levelStreaming asset '${name}' maps to multiple URLs.`);
  }
  bucket[name] = url;
  manifest[kind] = bucket;
}
