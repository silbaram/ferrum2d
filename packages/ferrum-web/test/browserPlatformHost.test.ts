import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { BrowserPlatformHost } from "../src/browserPlatformHost.js";
import type { TextureAssetManager } from "../src/assetLoader.js";
import type { AudioManager } from "../src/audioManager.js";

class FakeTextureManager implements TextureAssetManager {
  readonly loaded: Array<{ textureId: number; url: string }> = [];
  readonly evictedTextureIds: number[] = [];

  async loadTexture(textureId: number, url: string): Promise<WebGLTexture> {
    this.loaded.push({ textureId, url });
    return { textureId, url } as unknown as WebGLTexture;
  }

  evictTexture(textureId: number): boolean {
    this.evictedTextureIds.push(textureId);
    return true;
  }
}

class FakeAudioManager {
  destroyCount = 0;
  eventBufferCount = 0;
  readonly evictedSoundIds: number[] = [];
  readonly loadedSoundIds = new Set<number>();

  async loadSound(soundId: number, _url: string): Promise<AudioBuffer> {
    this.loadedSoundIds.add(soundId);
    return {} as AudioBuffer;
  }

  hasSound(soundId: number): boolean {
    return this.loadedSoundIds.has(soundId);
  }

  evictSound(soundId: number): boolean {
    if (!this.loadedSoundIds.delete(soundId)) {
      return false;
    }
    this.evictedSoundIds.push(soundId);
    return true;
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
      sounds: { hit: "/assets/hit.wav" },
      json: { game: "/game.json" },
    });

    equal(host.textureId("player"), 1);
    equal(host.soundId("hit"), 1);
    equal(host.hasSound(1), true);
    equal(host.hasSound(2), false);
    equal(assets.textures.textureId("player"), 1);
    equal(assets.sounds.soundId("hit"), 1);
    deepEqual(textureManager.loaded, [{ textureId: 1, url: "/assets/player.png" }]);
    deepEqual(assets.json.game, { source: "/game.json" });
    host.releaseAssets({
      entries: [
        { kind: "texture", name: "player", url: "/assets/player.png" },
        { kind: "texture", name: "player", url: "/assets/stale-player.png" },
        { kind: "sound", name: "hit", url: "/assets/hit.wav" },
        { kind: "json", name: "game", url: "/game.json" },
      ],
      textures: [
        { kind: "texture", name: "player", url: "/assets/player.png" },
        { kind: "texture", name: "player", url: "/assets/stale-player.png" },
      ],
      sounds: [
        { kind: "sound", name: "hit", url: "/assets/hit.wav" },
      ],
      json: [
        { kind: "json", name: "game", url: "/game.json" },
      ],
      total: 4,
    });
    deepEqual(textureManager.evictedTextureIds, [1]);
    deepEqual(audioManager.evictedSoundIds, [1]);
    equal(host.hasSound(1), false);
    host.playAudioEventBuffer({ buffer: new Float32Array(), eventCount: 0, floatsPerEvent: 3 });
    host.destroy();
    host.destroy();
    equal(audioManager.eventBufferCount, 1);
    equal(audioManager.destroyCount, 1);
  } finally {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = previousFetch;
  }
});
