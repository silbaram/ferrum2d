import { SoundRegistry } from "./soundRegistry.js";
import { TextureRegistry } from "./textureRegistry.js";
import { IndexedDbAssetCache, type JsonAssetCache } from "./indexedDbAssetCache.js";

export interface TextureAssetManager {
  loadTexture(textureId: number, url: string): Promise<WebGLTexture>;
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
  kind?: "texture" | "sound" | "json";
  name?: string;
  url?: string;
}

export type AssetLoadProgressCallback = (progress: AssetLoadProgress) => void;

export interface LoadedAssets {
  textures: TextureRegistry;
  sounds: SoundRegistry;
  json: Record<string, unknown>;
  progress: AssetLoadProgress;
}

type AssetErrorKind = "texture" | "sound" | "json";

function formatAssetLoadError(
  code: string,
  kind: AssetErrorKind,
  name: string,
  url: string,
  detail: string,
): Error {
  return new Error(`[Ferrum2D AssetError:${code}] kind=${kind} name='${name}' url='${url}' detail='${detail}'`);
}

export class AssetLoader {
  constructor(
    private readonly textureManager: TextureAssetManager,
    private readonly audioManager?: SoundAssetManager,
    private readonly textureRegistry = new TextureRegistry(),
    private readonly soundRegistry = new SoundRegistry(),
    private readonly cache: JsonAssetCache = new IndexedDbAssetCache(),
    private readonly cacheVersion = "v1",
    private readonly cacheTtlMs = 24 * 60 * 60 * 1000,
  ) {}

  async loadAssets(
    manifest: AssetManifest,
    onProgress?: AssetLoadProgressCallback,
  ): Promise<LoadedAssets> {
    const textureEntries = Object.entries(manifest.textures ?? {});
    const soundEntries = Object.entries(manifest.sounds ?? {});
    const jsonEntries = Object.entries(manifest.json ?? {});
    const total = textureEntries.length + soundEntries.length + jsonEntries.length;
    let loaded = 0;
    const json: Record<string, unknown> = {};

    const emitProgress = (progress: Omit<AssetLoadProgress, "loaded" | "total"> = {}): void => {
      onProgress?.({ loaded, total, ...progress });
    };

    emitProgress();

    for (const [name, url] of textureEntries) {
      const textureId = this.textureRegistry.reserve(name, url);
      await this.textureManager.loadTexture(textureId, url);
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
      json[name] = await this.loadJson(name, url);
      loaded += 1;
      emitProgress({ kind: "json", name, url });
    }

    return {
      textures: this.textureRegistry,
      sounds: this.soundRegistry,
      json,
      progress: { loaded, total },
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

  invalidateJsonCache(url: string): Promise<void> {
    return this.cache.invalidateJson(url, { version: this.cacheVersion });
  }

  private async loadSound(name: string, soundId: number, url: string): Promise<void> {
    if (!this.audioManager) {
      throw formatAssetLoadError(
        "FERRUM_AUDIO_MANAGER_REQUIRED",
        "sound",
        name,
        url,
        "Sound asset requires an AudioManager. Pass one to AssetLoader before loading sounds.",
      );
    }

    try {
      await this.audioManager.loadSound(soundId, url);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw formatAssetLoadError("FERRUM_SOUND_LOAD_FAILED", "sound", name, url, detail);
    }
  }

  private async loadJson(name: string, url: string): Promise<unknown> {
    const cached = await this.cache.getJson(url, { version: this.cacheVersion });
    if (cached !== null) {
      return cached;
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw formatAssetLoadError(
        "FERRUM_JSON_HTTP_FAILED",
        "json",
        name,
        url,
        `${response.status} ${response.statusText}`,
      );
    }

    try {
      const parsed = await response.json();
      await this.cache.setJson(url, parsed, {
        version: this.cacheVersion,
        ttlMs: this.cacheTtlMs,
        etag: response.headers.get("etag") ?? undefined,
        lastModified: response.headers.get("last-modified") ?? undefined,
      });
      return parsed;
    } catch {
      throw formatAssetLoadError("FERRUM_JSON_PARSE_FAILED", "json", name, url, "response.json() parse failed");
    }
  }
}
