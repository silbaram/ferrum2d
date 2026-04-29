import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { AssetLoader, type SoundAssetManager, type TextureAssetManager } from "../src/assetLoader.js";

class FakeTextureManager implements TextureAssetManager {
  readonly loaded: Array<{ textureId: number; url: string }> = [];

  async loadTexture(textureId: number, url: string): Promise<WebGLTexture> {
    this.loaded.push({ textureId, url });
    return { textureId, url } as unknown as WebGLTexture;
  }
}

class FakeAudioManager implements SoundAssetManager {
  readonly loaded: Array<{ soundId: number; url: string }> = [];

  async loadSound(soundId: number, url: string): Promise<AudioBuffer> {
    this.loaded.push({ soundId, url });
    return { soundId, url } as unknown as AudioBuffer;
  }
}

test("AssetLoader parses texture, sound, and JSON manifests with progress", async () => {
  const previousFetch = globalThis.fetch;
  const textureManager = new FakeTextureManager();
  const audioManager = new FakeAudioManager();
  const progress: string[] = [];
  (globalThis as unknown as { fetch: typeof fetch }).fetch = async (input) => ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ source: String(input) }),
  } as Response);

  try {
    const loader = new AssetLoader(textureManager, audioManager);
    const assets = await loader.loadAssets({
      textures: {
        player: "/assets/player.png",
        enemy: "/assets/enemy.png",
      },
      sounds: {
        shoot: "/assets/shoot.wav",
      },
      json: {
        config: "/assets/config.json",
      },
    }, ({ loaded, total, kind, name }) => {
      progress.push(`${loaded}/${total}:${kind ?? "start"}:${name ?? "-"}`);
    });

    equal(assets.textures.textureId("player"), 1);
    equal(assets.textures.textureId("enemy"), 2);
    equal(assets.sounds.soundId("shoot"), 1);
    deepEqual(textureManager.loaded, [
      { textureId: 1, url: "/assets/player.png" },
      { textureId: 2, url: "/assets/enemy.png" },
    ]);
    deepEqual(audioManager.loaded, [
      { soundId: 1, url: "/assets/shoot.wav" },
    ]);
    deepEqual(assets.json.config, { source: "/assets/config.json" });
    deepEqual(progress, [
      "0/4:start:-",
      "1/4:texture:player",
      "2/4:texture:enemy",
      "3/4:sound:shoot",
      "4/4:json:config",
    ]);
  } finally {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = previousFetch;
  }
});
