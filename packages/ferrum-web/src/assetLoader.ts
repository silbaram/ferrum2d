import { SoundRegistry } from "./soundRegistry.js";
import { TextureRegistry } from "./textureRegistry.js";

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

  private async loadSound(name: string, soundId: number, url: string): Promise<void> {
    if (!this.audioManager) {
      throw new Error(`Sound asset '${name}' requires an AudioManager. Pass one to AssetLoader before loading sounds.`);
    }

    try {
      await this.audioManager.loadSound(soundId, url);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Sound asset '${name}' failed to load from '${url}': ${detail}`);
    }
  }

  private async loadJson(name: string, url: string): Promise<unknown> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`JSON asset '${name}' failed to load from '${url}' (${response.status} ${response.statusText}).`);
    }

    try {
      return await response.json();
    } catch {
      throw new Error(`JSON asset '${name}' failed to parse from '${url}'.`);
    }
  }
}
