import { createAssetLoadScope, runAssetLoadTasks, throwIfAssetLoadAborted } from "./assetLoadTasks.js";
import type { AssetLoadOptions } from "./assetLoadTasks.js";
export type { AssetLoadOptions } from "./assetLoadTasks.js";

import { assetLoadError, describeError } from "./diagnostics.js";
import type { JsonAssetCache } from "./indexedDbAssetCache.js";
import { SoundRegistry } from "./soundRegistry.js";
import { TextureRegistry } from "./textureRegistry.js";
import { resolveTextureColorSpace } from "./colorManagement.js";
import type { TextureLoadOptions } from "./colorManagement.js";

export interface TextureAssetManager {
  loadTexture(textureId: number, url: string, options?: TextureLoadOptions): Promise<unknown>;
  evictTexture?(textureId: number): boolean;
}

export interface SoundAssetManager {
  loadSound(soundId: number, url: string, options?: { signal?: AbortSignal }): Promise<AudioBuffer>;
  evictSound?(soundId: number): boolean;
}

export interface AssetManifest {
  textures?: Record<string, string>;
  /** Per-texture decode metadata. Keys must also appear in textures. */
  textureOptions?: Record<string, TextureLoadOptions>;
  sounds?: Record<string, string>;
  json?: Record<string, string>;
}

export type AssetReleaseKind = "texture" | "sound" | "json";

export interface AssetReleaseEntry {
  kind: AssetReleaseKind;
  name: string;
  url: string;
}

export interface AssetReleasePayload {
  entries: readonly AssetReleaseEntry[];
  textures: readonly AssetReleaseEntry[];
  sounds: readonly AssetReleaseEntry[];
  json: readonly AssetReleaseEntry[];
  total: number;
}

export interface AssetLoadProgress {
  loaded: number;
  total: number;
  ratio?: number;
  elapsedMs?: number;
  kind?: "texture" | "sound" | "json";
  name?: string;
  url?: string;
  cached?: boolean;
}

export type AssetLoadProgressCallback = (progress: AssetLoadProgress) => void;

export interface LoadedAssets {
  textures: TextureRegistry;
  sounds: SoundRegistry;
  json: Record<string, unknown>;
  progress: AssetLoadProgress;
}

export class AssetLoader {
  constructor(
    private readonly textureManager: TextureAssetManager,
    private readonly audioManager?: SoundAssetManager,
    private readonly textureRegistry = new TextureRegistry(),
    private readonly soundRegistry = new SoundRegistry(),
    private readonly cache?: JsonAssetCache,
    private readonly cacheVersion = "v1",
    private readonly cacheTtlMs = 24 * 60 * 60 * 1000,
  ) {}

  async loadAssets(
    manifest: AssetManifest,
    onProgress?: AssetLoadProgressCallback,
    options: AssetLoadOptions = {},
  ): Promise<LoadedAssets> {
    validateAssetTextureOptions(manifest);
    const startedAtMs = nowMs();
    const textureEntries = Object.entries(manifest.textures ?? {});
    const soundEntries = Object.entries(manifest.sounds ?? {});
    const jsonEntries = Object.entries(manifest.json ?? {});
    const total = textureEntries.length + soundEntries.length + jsonEntries.length;
    let loaded = 0;
    const json: Record<string, unknown> = {};

    const emitProgress = (progress: Omit<AssetLoadProgress, "loaded" | "total"> = {}): void => {
      onProgress?.({
        loaded,
        total,
        ratio: total <= 0 ? 1 : loaded / total,
        elapsedMs: nowMs() - startedAtMs,
        ...progress,
      });
    };

    const entries: (AssetReleaseEntry & { textureOptions?: TextureLoadOptions })[] = [
      ...textureEntries.map(([name, url]) => ({ kind: "texture" as const, name, url,
        textureOptions: manifest.textureOptions?.[name] === undefined ? undefined : { ...manifest.textureOptions[name] } })),
      ...soundEntries.map(([name, url]) => ({ kind: "sound" as const, name, url })),
      ...jsonEntries.map(([name, url]) => ({ kind: "json" as const, name, url })),
    ];
    await runAssetLoadTasks(entries, options, async (entry, signal) => {
      const { kind, name, url } = entry;
      let cached: boolean | undefined;
      if (kind === "texture") {
        const scope = createAssetLoadScope(signal, entry.textureOptions?.signal);
        try {
          throwIfAssetLoadAborted(scope.controller.signal);
          const textureId = this.textureRegistry.reserve(name, url);
          await this.textureManager.loadTexture(textureId, url, { ...entry.textureOptions, signal: scope.controller.signal });
          throwIfAssetLoadAborted(scope.controller.signal);
        } catch (error) {
          throwIfAssetLoadAborted(scope.controller.signal);
          throw assetLoadError({ kind, name, url, detail: describeError(error) });
        } finally {
          scope.dispose();
        }
      } else if (kind === "sound") {
        const soundId = this.soundRegistry.reserve(name, url);
        await this.loadSound(name, soundId, url, signal);
      } else {
        const loadedJson = await this.loadJson(name, url, signal);
        throwIfAssetLoadAborted(signal);
        json[name] = loadedJson.value;
        cached = loadedJson.cached;
      }
      throwIfAssetLoadAborted(signal);
      loaded += 1;
      emitProgress({ kind, name, url, ...(cached === undefined ? {} : { cached }) });
    }, emitProgress);

    return {
      textures: this.textureRegistry,
      sounds: this.soundRegistry,
      json,
      progress: { loaded, total, ratio: total <= 0 ? 1 : loaded / total, elapsedMs: nowMs() - startedAtMs },
    };
  }

  textureId(name: string): number {
    return this.textureRegistry.textureId(name);
  }

  textureIds(): TextureRegistry {
    return this.textureRegistry;
  }

  soundId(name: string): number {
    return this.soundRegistry.soundId(name);
  }

  soundIds(): SoundRegistry {
    return this.soundRegistry;
  }

  releaseAssets(assets: AssetReleasePayload): void {
    for (const entry of assets.textures) {
      const texture = entry.kind === "texture" ? this.textureRegistry.tryEntry(entry.name) : undefined;
      if (texture?.url === entry.url) {
        this.textureManager.evictTexture?.(texture.textureId);
      }
    }
    for (const entry of assets.sounds) {
      const sound = entry.kind === "sound" ? this.soundRegistry.tryEntry(entry.name) : undefined;
      if (sound?.url === entry.url) {
        this.audioManager?.evictSound?.(sound.soundId);
      }
    }
  }

  /** @deprecated IndexedDB asset cache는 현재 MVP 범위 밖입니다. 주입된 cache가 있을 때만 위임합니다. */
  async invalidateJsonCache(url: string): Promise<void> {
    await this.cache?.invalidateJson(url, { version: this.cacheVersion });
  }

  private async loadSound(name: string, soundId: number, url: string, signal: AbortSignal): Promise<void> {
    if (!this.audioManager) {
      throw assetLoadError({
        kind: "sound",
        name,
        url,
        detail: "AudioManager is required before loading sound assets",
      });
    }

    try {
      await this.audioManager.loadSound(soundId, url, { signal });
    } catch (error) {
      throwIfAssetLoadAborted(signal);
      throw assetLoadError({
        kind: "sound",
        name,
        url,
        detail: describeError(error),
      });
    }
  }

  private async loadJson(name: string, url: string, signal: AbortSignal): Promise<{ value: unknown; cached: boolean }> {
    const cached = await this.cache?.getJson(url, { version: this.cacheVersion });
    throwIfAssetLoadAborted(signal);
    if (cached !== undefined && cached !== null) {
      return { value: cached, cached: true };
    }

    let response: Response;
    try {
      response = await fetch(url, { signal });
      throwIfAssetLoadAborted(signal);
    } catch (error) {
      throwIfAssetLoadAborted(signal);
      throw assetLoadError({
        kind: "json",
        name,
        url,
        detail: describeError(error),
      });
    }
    if (!response.ok) {
      throw assetLoadError({
        kind: "json",
        name,
        url,
        detail: `HTTP ${response.status} ${response.statusText}`.trim(),
      });
    }

    try {
      const parsed = await response.json();
      throwIfAssetLoadAborted(signal);
      await this.cache?.setJson(url, parsed, {
        version: this.cacheVersion,
        ttlMs: this.cacheTtlMs,
        etag: response.headers?.get("etag") ?? undefined,
        lastModified: response.headers?.get("last-modified") ?? undefined,
      });
      return { value: parsed, cached: false };
    } catch (error) {
      throwIfAssetLoadAborted(signal);
      throw assetLoadError({
        kind: "json",
        name,
        url,
        detail: `Invalid JSON: ${describeError(error)}`,
      });
    }
  }
}

export function validateAssetTextureOptions(manifest: AssetManifest): void {
  if (manifest.textureOptions === undefined) return;
  if (!manifest.textureOptions || typeof manifest.textureOptions !== "object" || Array.isArray(manifest.textureOptions)) {
    throw new Error("AssetManifest.textureOptions must be an object.");
  }
  for (const [name, options] of Object.entries(manifest.textureOptions)) {
    if (!Object.prototype.hasOwnProperty.call(manifest.textures ?? {}, name)) {
      throw new Error(`AssetManifest.textureOptions.${name} has no matching texture.`);
    }
    resolveTextureColorSpace(options);
  }
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
