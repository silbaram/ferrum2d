import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { BrowserPlatformHost } from "../src/browserPlatformHost.js";
import type { TextureAssetManager } from "../src/assetLoader.js";
import type { AudioManager } from "../src/audioManager.js";

class FakeTextureManager implements TextureAssetManager {
  readonly loaded: Array<{ textureId: number; url: string }> = [];

  async loadTexture(textureId: number, url: string): Promise<WebGLTexture> {
    this.loaded.push({ textureId, url });
    return { textureId, url } as unknown as WebGLTexture;
  }
}

class FakeAudioManager {
  destroyCount = 0;
  eventBufferCount = 0;

  async loadSound(_soundId: number, _url: string): Promise<AudioBuffer> {
    return {} as AudioBuffer;
  }

  playEvents(): void {}

  playEventBuffer(): void {
    this.eventBufferCount += 1;
  }

  destroy(): void {
    this.destroyCount += 1;
  }
}

test("BrowserPlatformHost loads assets through composed texture manager", async () => {
  const previousFetch = globalThis.fetch;
  const textureManager = new FakeTextureManager();
  const audioManager = new FakeAudioManager();
  (globalThis as unknown as { fetch: typeof fetch }).fetch = async (input) => ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ source: String(input) }),
  } as unknown as Response);

  try {
    const host = new BrowserPlatformHost(textureManager, audioManager as unknown as AudioManager);
    const assets = await host.loadAssets({
      textures: { player: "/assets/player.png" },
      json: { game: "/game.json" },
    });

    equal(host.textureId("player"), 1);
    equal(assets.textures.textureId("player"), 1);
    deepEqual(textureManager.loaded, [{ textureId: 1, url: "/assets/player.png" }]);
    deepEqual(assets.json.game, { source: "/game.json" });
    host.playAudioEventBuffer({ buffer: new Float32Array(), eventCount: 0, floatsPerEvent: 3 });
    host.destroy();
    host.destroy();
    equal(audioManager.eventBufferCount, 1);
    equal(audioManager.destroyCount, 1);
  } finally {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = previousFetch;
  }
});
