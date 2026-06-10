import { assetLoadError, describeError } from "./diagnostics.js";
import type { JsonAssetCache } from "./indexedDbAssetCache.js";
import { SoundRegistry } from "./soundRegistry.js";
import { TextureRegistry } from "./textureRegistry.js";

export interface TextureAssetManager {
  loadTexture(textureId: number, url: string): Promise<unknown>;
  evictTexture?(textureId: number): boolean;
}

export interface SoundAssetManager {
  loadSound(soundId: number, url: string): Promise<AudioBuffer>;
}

export interface AssetManifest {
  textures?: Record<string, string>;
  sounds?: Record<string, string>;
  json?: Record<string, string>;
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
  ): Promise<LoadedAssets> {
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

    emitProgress();

    for (const [name, url] of textureEntries) {
      const textureId = this.textureRegistry.reserve(name, url);
      try {
        await this.textureManager.loadTexture(textureId, url);
      } catch (error) {
        throw assetLoadError({
          kind: "texture",
          name,
          url,
          detail: describeError(error),
        });
      }
      loaded += 1;
      emitProgress({ kind: "texture", name, url });
    }

    for (const [name, url] of soundEntries) {
      const soundId = this.soundRegistry.reserve(name, url);
      await this.loadSound(name, soundId, url);
      loaded += 1;
      emitProgress({ kind: "sound", name, url });
    }

    for (const [name, url] of jsonEntries) {
      const loadedJson = await this.loadJson(name, url);
      json[name] = loadedJson.value;
      loaded += 1;
      emitProgress({ kind: "json", name, url, cached: loadedJson.cached });
    }

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

  /** @deprecated IndexedDB asset cache는 현재 MVP 범위 밖입니다. 주입된 cache가 있을 때만 위임합니다. */
  async invalidateJsonCache(url: string): Promise<void> {
    await this.cache?.invalidateJson(url, { version: this.cacheVersion });
  }

  private async loadSound(name: string, soundId: number, url: string): Promise<void> {
    if (!this.audioManager) {
      throw assetLoadError({
        kind: "sound",
        name,
        url,
        detail: "AudioManager is required before loading sound assets",
      });
    }

    try {
      await this.audioManager.loadSound(soundId, url);
    } catch (error) {
      throw assetLoadError({
        kind: "sound",
        name,
        url,
        detail: describeError(error),
      });
    }
  }

  private async loadJson(name: string, url: string): Promise<{ value: unknown; cached: boolean }> {
    const cached = await this.cache?.getJson(url, { version: this.cacheVersion });
    if (cached !== undefined && cached !== null) {
      return { value: cached, cached: true };
    }

    let response: Response;
    try {
      response = await fetch(url);
    } catch (error) {
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
      await this.cache?.setJson(url, parsed, {
        version: this.cacheVersion,
        ttlMs: this.cacheTtlMs,
        etag: response.headers?.get("etag") ?? undefined,
        lastModified: response.headers?.get("last-modified") ?? undefined,
      });
      return { value: parsed, cached: false };
    } catch (error) {
      throw assetLoadError({
        kind: "json",
        name,
        url,
        detail: `Invalid JSON: ${describeError(error)}`,
      });
    }
  }
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
