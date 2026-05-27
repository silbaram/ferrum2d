import type { AssetLoadProgress, AssetLoadProgressCallback, AssetManifest } from "./assetLoader.js";
import { assetLoadError, describeError } from "./diagnostics.js";
import type { BinaryAssetCache, JsonAssetCache } from "./indexedDbAssetCache.js";

export type AssetPreloadKind = "texture" | "sound" | "json";

export interface AssetPreloadEntry {
  kind: AssetPreloadKind;
  name: string;
  url: string;
  index: number;
}

export interface AssetPreloadPlan {
  entries: readonly AssetPreloadEntry[];
  total: number;
  textures: number;
  sounds: number;
  json: number;
}

export interface AssetPreloadCachePolicy {
  json?: boolean;
  textures?: boolean;
  sounds?: boolean;
  binary?: boolean;
  version?: string;
  ttlMs?: number;
}

export type AssetPreloadCache = JsonAssetCache & Partial<BinaryAssetCache>;

export interface CreateAssetPreloadCachePolicyOptions {
  json?: boolean;
  textures?: boolean;
  sounds?: boolean;
  binary?: boolean;
  version?: string;
  versionPrefix?: string;
  versionSalt?: string;
  ttlMs?: number;
}

export interface InvalidatePreloadedAssetCacheOptions extends CreateAssetPreloadCachePolicyOptions {
  policy?: AssetPreloadCachePolicy;
}

export interface AssetPreloadInvalidationResult {
  version: string;
  invalidatedJson: number;
  invalidatedBinary: number;
  invalidatedTotal: number;
}

export interface PreloadAssetManifestOptions {
  onProgress?: AssetLoadProgressCallback;
  cache?: AssetPreloadCache;
  cachePolicy?: AssetPreloadCachePolicy;
  fetch?: typeof fetch;
}

export interface PreloadedAssetManifest {
  plan: AssetPreloadPlan;
  progress: AssetLoadProgress;
  json: Record<string, unknown>;
  fetched: number;
  cached: number;
}

const DEFAULT_CACHE_VERSION = "v1";
const DEFAULT_CACHE_VERSION_PREFIX = "assets";
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FNV1A_32_OFFSET = 0x811c9dc5;
const FNV1A_32_PRIME = 0x01000193;

export function resolveAssetPreloadPlan(manifest: AssetManifest): AssetPreloadPlan {
  const entries: AssetPreloadEntry[] = [];
  appendEntries(entries, "texture", manifest.textures ?? {});
  appendEntries(entries, "sound", manifest.sounds ?? {});
  appendEntries(entries, "json", manifest.json ?? {});
  return {
    entries,
    total: entries.length,
    textures: countKind(entries, "texture"),
    sounds: countKind(entries, "sound"),
    json: countKind(entries, "json"),
  };
}

export function assetManifestFingerprint(manifest: AssetManifest, versionSalt = ""): string {
  let hash = FNV1A_32_OFFSET;
  hash = hashString(hash, `salt:${versionSalt}\n`);
  for (const entry of fingerprintEntries(manifest)) {
    hash = hashString(hash, `${entry.kind}\0${entry.name}\0${entry.url}\n`);
  }
  return hash.toString(36).padStart(7, "0");
}

export function createAssetPreloadCachePolicy(
  manifest: AssetManifest,
  options: CreateAssetPreloadCachePolicyOptions = {},
): AssetPreloadCachePolicy {
  const version = options.version ?? manifestCacheVersion(manifest, options);
  return {
    json: options.json ?? true,
    textures: options.textures ?? true,
    sounds: options.sounds ?? true,
    binary: options.binary ?? true,
    version,
    ...(options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs }),
  };
}

export async function invalidatePreloadedAssetCache(
  manifest: AssetManifest,
  cache: AssetPreloadCache,
  options: InvalidatePreloadedAssetCacheOptions = {},
): Promise<AssetPreloadInvalidationResult> {
  const policy = options.policy ?? createAssetPreloadCachePolicy(manifest, options);
  const version = policy.version ?? DEFAULT_CACHE_VERSION;
  let invalidatedJson = 0;
  let invalidatedBinary = 0;

  for (const entry of resolveAssetPreloadPlan(manifest).entries) {
    if (entry.kind === "json" && policy.json === true) {
      await cache.invalidateJson(entry.url, { version });
      invalidatedJson += 1;
      continue;
    }

    if (shouldCacheBinary(entry.kind, policy) && typeof cache.invalidateBinary === "function") {
      await cache.invalidateBinary(entry.url, { version });
      invalidatedBinary += 1;
    }
  }

  return {
    version,
    invalidatedJson,
    invalidatedBinary,
    invalidatedTotal: invalidatedJson + invalidatedBinary,
  };
}

export async function preloadAssetManifest(
  manifest: AssetManifest,
  options: PreloadAssetManifestOptions = {},
): Promise<PreloadedAssetManifest> {
  const plan = resolveAssetPreloadPlan(manifest);
  const fetcher = options.fetch ?? globalThis.fetch;
  if (typeof fetcher !== "function" && plan.total > 0) {
    throw new Error("preloadAssetManifest() requires fetch support.");
  }
  const startedAtMs = nowMs();
  let loaded = 0;
  let fetched = 0;
  let cached = 0;
  const json: Record<string, unknown> = {};

  const emitProgress = (entry?: AssetPreloadEntry, entryCached = false): void => {
    options.onProgress?.({
      loaded,
      total: plan.total,
      ratio: plan.total <= 0 ? 1 : loaded / plan.total,
      elapsedMs: nowMs() - startedAtMs,
      ...(entry === undefined ? {} : {
          kind: entry.kind,
          name: entry.name,
          url: entry.url,
          cached: entryCached,
        }),
    });
  };

  emitProgress();

  for (const entry of plan.entries) {
    if (entry.kind === "json") {
      const result = await preloadJson(entry, fetcher, options);
      json[entry.name] = result.value;
      if (result.cached) {
        cached += 1;
      } else {
        fetched += 1;
      }
      loaded += 1;
      emitProgress(entry, result.cached);
    } else {
      const result = await preloadBinary(entry, fetcher, options);
      if (result.cached) {
        cached += 1;
      } else {
        fetched += 1;
      }
      loaded += 1;
      emitProgress(entry, result.cached);
    }
  }

  return {
    plan,
    progress: {
      loaded,
      total: plan.total,
      ratio: plan.total <= 0 ? 1 : loaded / plan.total,
      elapsedMs: nowMs() - startedAtMs,
    },
    json,
    fetched,
    cached,
  };
}

function appendEntries(
  entries: AssetPreloadEntry[],
  kind: AssetPreloadKind,
  assets: Record<string, string>,
): void {
  for (const [name, url] of Object.entries(assets)) {
    entries.push({
      kind,
      name,
      url,
      index: entries.length,
    });
  }
}

async function preloadJson(
  entry: AssetPreloadEntry,
  fetcher: typeof fetch,
  options: PreloadAssetManifestOptions,
): Promise<{ value: unknown; cached: boolean }> {
  const policy = options.cachePolicy;
  const shouldUseCache = options.cache !== undefined && policy?.json === true;
  const version = policy?.version ?? DEFAULT_CACHE_VERSION;
  if (shouldUseCache) {
    const cached = await options.cache?.getJson(entry.url, { version });
    if (cached !== undefined && cached !== null) {
      return { value: cached, cached: true };
    }
  }

  const response = await fetchAsset(entry, fetcher);
  try {
    const value = await response.json();
    if (shouldUseCache) {
      await options.cache?.setJson(entry.url, value, {
        version,
        ttlMs: policy?.ttlMs ?? DEFAULT_CACHE_TTL_MS,
        etag: response.headers?.get("etag") ?? undefined,
        lastModified: response.headers?.get("last-modified") ?? undefined,
      });
    }
    return { value, cached: false };
  } catch (error) {
    throw assetLoadError({
      kind: "json",
      name: entry.name,
      url: entry.url,
      detail: describeError(error),
    });
  }
}

async function preloadBinary(
  entry: AssetPreloadEntry,
  fetcher: typeof fetch,
  options: PreloadAssetManifestOptions,
): Promise<{ cached: boolean }> {
  const policy = options.cachePolicy;
  const shouldUseCache = shouldCacheBinary(entry.kind, policy) && typeof options.cache?.getBinary === "function";
  const version = policy?.version ?? DEFAULT_CACHE_VERSION;
  if (shouldUseCache) {
    const cached = await options.cache?.getBinary?.(entry.url, { version });
    if (cached !== undefined && cached !== null) {
      return { cached: true };
    }
  }

  const response = await fetchAsset(entry, fetcher);
  try {
    const value = await response.arrayBuffer();
    if (shouldUseCache) {
      await options.cache?.setBinary?.(entry.url, value, {
        version,
        ttlMs: policy?.ttlMs ?? DEFAULT_CACHE_TTL_MS,
        etag: response.headers?.get("etag") ?? undefined,
        lastModified: response.headers?.get("last-modified") ?? undefined,
      });
    }
    return { cached: false };
  } catch (error) {
    throw assetLoadError({
      kind: entry.kind,
      name: entry.name,
      url: entry.url,
      detail: describeError(error),
    });
  }
}

function shouldCacheBinary(kind: AssetPreloadKind, policy: AssetPreloadCachePolicy | undefined): boolean {
  if (policy?.binary === false) return false;
  if (kind === "texture") {
    return policy?.textures === true || (policy?.binary === true && policy.textures !== false);
  }
  if (kind === "sound") {
    return policy?.sounds === true || (policy?.binary === true && policy.sounds !== false);
  }
  return false;
}

async function fetchAsset(entry: AssetPreloadEntry, fetcher: typeof fetch): Promise<Response> {
  let response: Response;
  try {
    response = await fetcher(entry.url);
  } catch (error) {
    throw assetLoadError({
      kind: entry.kind,
      name: entry.name,
      url: entry.url,
      detail: describeError(error),
    });
  }
  if (!response.ok) {
    throw assetLoadError({
      kind: entry.kind,
      name: entry.name,
      url: entry.url,
      detail: `HTTP ${response.status} ${response.statusText}`.trim(),
    });
  }
  return response;
}

function countKind(entries: readonly AssetPreloadEntry[], kind: AssetPreloadKind): number {
  return entries.filter((entry) => entry.kind === kind).length;
}

function manifestCacheVersion(manifest: AssetManifest, options: CreateAssetPreloadCachePolicyOptions): string {
  const prefix = options.versionPrefix ?? DEFAULT_CACHE_VERSION_PREFIX;
  const fingerprint = assetManifestFingerprint(manifest, options.versionSalt ?? "");
  return prefix.length > 0 ? `${prefix}-${fingerprint}` : fingerprint;
}

function fingerprintEntries(manifest: AssetManifest): AssetPreloadEntry[] {
  return [...resolveAssetPreloadPlan(manifest).entries].sort(comparePreloadEntry);
}

function comparePreloadEntry(a: AssetPreloadEntry, b: AssetPreloadEntry): number {
  const kindDelta = preloadKindOrder(a.kind) - preloadKindOrder(b.kind);
  if (kindDelta !== 0) {
    return kindDelta;
  }
  const nameDelta = a.name.localeCompare(b.name);
  if (nameDelta !== 0) {
    return nameDelta;
  }
  return a.url.localeCompare(b.url);
}

function preloadKindOrder(kind: AssetPreloadKind): number {
  if (kind === "texture") return 0;
  if (kind === "sound") return 1;
  return 2;
}

function hashString(hash: number, value: string): number {
  let nextHash = hash;
  for (let index = 0; index < value.length; index += 1) {
    nextHash ^= value.charCodeAt(index);
    nextHash = Math.imul(nextHash, FNV1A_32_PRIME) >>> 0;
  }
  return nextHash >>> 0;
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
