import { AssetLoader } from "./assetLoader.js";
import type { AssetLoadProgressCallback, AssetManifest, LoadedAssets, TextureAssetManager } from "./assetLoader.js";
import { AudioManager } from "./audioManager.js";
import type { AudioManagerConfig } from "./audioManager.js";
import type { AssetHost } from "./createEngine.js";
import type { AudioEventBufferView, AudioEventView } from "./wasmBridge.js";

export class BrowserPlatformHost implements AssetHost {
  private readonly audioManager: AudioManager;
  private readonly assetLoader: AssetLoader;
  private destroyed = false;

  constructor(textureAssetManager: TextureAssetManager, audioManager = new AudioManager()) {
    this.audioManager = audioManager;
    this.assetLoader = new AssetLoader(textureAssetManager, audioManager);
  }

  async loadAssets(manifest: AssetManifest, onProgress?: AssetLoadProgressCallback): Promise<LoadedAssets> {
    this.assertAlive();
    const assets = await this.assetLoader.loadAssets(manifest, onProgress);
    this.assertAlive();
    return assets;
  }

  textureId(name: string): number {
    this.assertAlive();
    return this.assetLoader.textureId(name);
  }

  soundId(name: string): number {
    this.assertAlive();
    return this.assetLoader.soundId(name);
  }

  playAudioEvents(events: readonly AudioEventView[]): void {
    this.assertAlive();
    this.audioManager.playEvents(events);
  }

  playAudioEventBuffer(events: AudioEventBufferView): void {
    this.assertAlive();
    this.audioManager.playEventBuffer(events);
  }

  configureAudio(config: AudioManagerConfig): void {
    this.assertAlive();
    this.audioManager.configure(config);
  }

  async unlockAudio(): Promise<boolean> {
    this.assertAlive();
    return await this.audioManager.unlock();
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.audioManager.destroy();
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error("BrowserPlatformHost has been destroyed.");
    }
  }
}
