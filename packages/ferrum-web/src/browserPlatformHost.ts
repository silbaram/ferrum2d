import { AssetLoader } from "./assetLoader.js";
import type {
  AssetLoadProgressCallback,
  AssetManifest,
  AssetReleasePayload,
  LoadedAssets,
  TextureAssetManager,
} from "./assetLoader.js";
import { AudioManager } from "./audioManager.js";
import type { AudioManagerConfig, PlayBgmOptions, StopBgmOptions } from "./audioManager.js";
import type { AssetHost } from "./engineTypes.js";
import type { PostProcessStackInput } from "./cameraPostProcessing.js";
import type { AudioEventBufferView, AudioEventView } from "./wasmBridge.js";

interface PostProcessTarget {
  setPostProcess?(postProcess: PostProcessStackInput): void;
}

export class BrowserPlatformHost implements AssetHost {
  private readonly audioManager: AudioManager;
  private readonly assetLoader: AssetLoader;
  private destroyed = false;

  constructor(private readonly textureAssetManager: TextureAssetManager & PostProcessTarget, audioManager = new AudioManager()) {
    this.audioManager = audioManager;
    this.assetLoader = new AssetLoader(this.textureAssetManager, audioManager);
  }

  async loadAssets(manifest: AssetManifest, onProgress?: AssetLoadProgressCallback): Promise<LoadedAssets> {
    this.assertAlive();
    const assets = await this.assetLoader.loadAssets(manifest, onProgress);
    this.assertAlive();
    return assets;
  }

  releaseAssets(assets: AssetReleasePayload): void {
    this.assertAlive();
    this.assetLoader.releaseAssets(assets);
  }

  textureId(name: string): number {
    this.assertAlive();
    return this.assetLoader.textureId(name);
  }

  soundId(name: string): number {
    this.assertAlive();
    return this.assetLoader.soundId(name);
  }

  hasSound(soundId: number): boolean {
    this.assertAlive();
    return this.audioManager.hasSound(soundId);
  }

  playAudioEvents(events: readonly AudioEventView[]): void {
    this.assertAlive();
    this.audioManager.playEvents(events);
  }

  playAudioEventBuffer(events: AudioEventBufferView): void {
    this.assertAlive();
    this.audioManager.playEventBuffer(events);
  }

  playBgm(soundId: number, options: PlayBgmOptions = {}): void {
    this.assertAlive();
    this.audioManager.playBgm(soundId, options);
  }

  stopBgm(options: StopBgmOptions = {}): void {
    this.assertAlive();
    this.audioManager.stopBgm(options);
  }

  configureAudio(config: AudioManagerConfig): void {
    this.assertAlive();
    this.audioManager.configure(config);
  }

  setPostProcess(postProcess: PostProcessStackInput): void {
    this.assertAlive();
    this.textureAssetManager.setPostProcess?.(postProcess);
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
