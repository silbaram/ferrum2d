import { SoundRegistry } from "./soundRegistry.js";
import { TextureRegistry } from "./textureRegistry.js";
import { assetLoadError, describeError } from "./diagnostics.js";

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

export class AssetLoader {
  constructor(
    private readonly textureManager: TextureAssetManager,
    private readonly audioManager?: SoundAssetManager,
    private readonly textureRegistry = new TextureRegistry(),
    private readonly soundRegistry = new SoundRegistry(),
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

  private async loadJson(name: string, url: string): Promise<unknown> {
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
      return await response.json();
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
