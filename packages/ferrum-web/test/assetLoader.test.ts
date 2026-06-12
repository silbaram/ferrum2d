import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { AssetLoader, type SoundAssetManager, type TextureAssetManager } from "../src/assetLoader.js";

class FakeTextureManager implements TextureAssetManager {
  readonly loaded: Array<{ textureId: number; url: string }> = [];
  readonly evicted: number[] = [];

  async loadTexture(textureId: number, url: string): Promise<WebGLTexture> {
    this.loaded.push({ textureId, url });
    return { textureId, url } as unknown as WebGLTexture;
  }

  evictTexture(textureId: number): boolean {
    this.evicted.push(textureId);
    return true;
  }
}

class FakeAudioManager implements SoundAssetManager {
  readonly loaded: Array<{ soundId: number; url: string }> = [];
  readonly evicted: number[] = [];

  async loadSound(soundId: number, url: string): Promise<AudioBuffer> {
    this.loaded.push({ soundId, url });
    return { soundId, url } as unknown as AudioBuffer;
  }

  evictSound(soundId: number): boolean {
    this.evicted.push(soundId);
    return true;
  }
}

class FailingTextureManager implements TextureAssetManager {
  async loadTexture(): Promise<WebGLTexture> {
    throw new Error("decode failed");
  }
}

class FailingAudioManager implements SoundAssetManager {
  async loadSound(): Promise<AudioBuffer> {
    throw new Error("decode failed");
  }
}

function jsonResponse(value: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: {
      get: () => null,
    },
    json: async () => value,
  } as unknown as Response;
}

async function rejectsWithMessage(promise: Promise<unknown>, expected: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    equal(error instanceof Error ? error.message : String(error), expected);
    return;
  }
  throw new Error("Expected promise to reject.");
}

test("AssetLoader parses texture, sound, and JSON manifests with progress", async () => {
  const previousFetch = globalThis.fetch;
  const textureManager = new FakeTextureManager();
  const audioManager = new FakeAudioManager();
  const progress: string[] = [];
  (globalThis as unknown as { fetch: typeof fetch }).fetch = async (input) => jsonResponse({ source: String(input) });

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

test("AssetLoader reports texture load failures with diagnostic context", async () => {
  const loader = new AssetLoader(new FailingTextureManager());

  await rejectsWithMessage(
    loader.loadAssets({ textures: { player: "/assets/missing-player.png" } }),
    "Asset load error: kind=texture name='player' url='/assets/missing-player.png' detail='decode failed'.",
  );
});

test("AssetLoader reports sound load failures with diagnostic context", async () => {
  const loader = new AssetLoader(new FakeTextureManager(), new FailingAudioManager());

  await rejectsWithMessage(
    loader.loadAssets({ sounds: { shoot: "/assets/missing-shoot.wav" } }),
    "Asset load error: kind=sound name='shoot' url='/assets/missing-shoot.wav' detail='decode failed'.",
  );
});

test("AssetLoader reports missing audio manager with diagnostic context", async () => {
  const loader = new AssetLoader(new FakeTextureManager());

  await rejectsWithMessage(
    loader.loadAssets({ sounds: { shoot: "/assets/shoot.wav" } }),
    "Asset load error: kind=sound name='shoot' url='/assets/shoot.wav' detail='AudioManager is required before loading sound assets'.",
  );
});

test("AssetLoader reports JSON HTTP failures with diagnostic context", async () => {
  const previousFetch = globalThis.fetch;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = async () => ({
    ok: false,
    status: 404,
    statusText: "Not Found",
  } as unknown as Response);

  try {
    const loader = new AssetLoader(new FakeTextureManager());
    await rejectsWithMessage(
      loader.loadAssets({ json: { game: "/missing-game.json" } }),
      "Asset load error: kind=json name='game' url='/missing-game.json' detail='HTTP 404 Not Found'.",
    );
  } finally {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = previousFetch;
  }
});

test("AssetLoader reports JSON parse failures with diagnostic context", async () => {
  const previousFetch = globalThis.fetch;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    headers: {
      get: () => null,
    },
    json: async () => {
      throw new Error("Unexpected token");
    },
  } as unknown as Response);

  try {
    const loader = new AssetLoader(new FakeTextureManager());
    await rejectsWithMessage(
      loader.loadAssets({ json: { game: "/bad-game.json" } }),
      "Asset load error: kind=json name='game' url='/bad-game.json' detail='Invalid JSON: Unexpected token'.",
    );
  } finally {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = previousFetch;
  }
});

test("AssetLoader fetches JSON manifests directly for each load", async () => {
  const previousFetch = globalThis.fetch;
  const textureManager = new FakeTextureManager();
  const audioManager = new FakeAudioManager();
  const fetchCalls: string[] = [];

  (globalThis as unknown as { fetch: typeof fetch }).fetch = async (input) => {
    fetchCalls.push(String(input));
    return jsonResponse({ version: fetchCalls.length, source: String(input) });
  };

  try {
    const loader = new AssetLoader(textureManager, audioManager);
    const first = await loader.loadAssets({ json: { game: "/game.json" } });
    const second = await loader.loadAssets({ json: { game: "/game.json" } });

    deepEqual(first.json.game, { version: 1, source: "/game.json" });
    deepEqual(second.json.game, { version: 2, source: "/game.json" });
    deepEqual(fetchCalls, ["/game.json", "/game.json"]);
  } finally {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = previousFetch;
  }
});

test("AssetLoader releases texture and sound resources only when registry URLs still match", async () => {
  const previousFetch = globalThis.fetch;
  const textureManager = new FakeTextureManager();
  const audioManager = new FakeAudioManager();
  (globalThis as unknown as { fetch: typeof fetch }).fetch = async (input) => jsonResponse({ source: String(input) });

  try {
    const loader = new AssetLoader(textureManager, audioManager);
    await loader.loadAssets({
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
    });

    loader.releaseAssets({
      entries: [
        { kind: "texture", name: "player", url: "/assets/player.png" },
        { kind: "texture", name: "enemy", url: "/assets/stale-enemy.png" },
        { kind: "texture", name: "missing", url: "/assets/missing.png" },
        { kind: "sound", name: "shoot", url: "/assets/shoot.wav" },
        { kind: "sound", name: "missing", url: "/assets/missing.wav" },
        { kind: "json", name: "config", url: "/assets/config.json" },
      ],
      textures: [
        { kind: "texture", name: "player", url: "/assets/player.png" },
        { kind: "texture", name: "enemy", url: "/assets/stale-enemy.png" },
        { kind: "texture", name: "missing", url: "/assets/missing.png" },
        { kind: "sound", name: "enemy", url: "/assets/enemy.png" },
      ],
      sounds: [
        { kind: "sound", name: "shoot", url: "/assets/shoot.wav" },
        { kind: "sound", name: "missing", url: "/assets/missing.wav" },
        { kind: "texture", name: "shoot", url: "/assets/shoot.wav" },
      ],
      json: [
        { kind: "json", name: "config", url: "/assets/config.json" },
      ],
      total: 6,
    });

    deepEqual(textureManager.evicted, [1]);
    deepEqual(audioManager.evicted, [1]);
  } finally {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = previousFetch;
  }
});

test("AssetLoader preserves injected JSON cache compatibility path", async () => {
  const previousFetch = globalThis.fetch;
  const fetchCalls: string[] = [];
  const cacheStore = new Map<string, unknown>();

  (globalThis as unknown as { fetch: typeof fetch }).fetch = async (input) => {
    fetchCalls.push(String(input));
    return jsonResponse({ version: 1, source: String(input) });
  };

  const fakeCache = {
    async getJson(url: string): Promise<unknown | null> {
      return cacheStore.has(url) ? cacheStore.get(url)! : null;
    },
    async setJson(url: string, value: unknown): Promise<void> {
      cacheStore.set(url, value);
    },
    async invalidateJson(): Promise<void> {},
  };

  try {
    const loader = new AssetLoader(new FakeTextureManager(), new FakeAudioManager(), undefined, undefined, fakeCache);
    const first = await loader.loadAssets({ json: { game: "/game.json" } });
    const second = await loader.loadAssets({ json: { game: "/game.json" } });

    deepEqual(first.json.game, { version: 1, source: "/game.json" });
    deepEqual(second.json.game, { version: 1, source: "/game.json" });
    deepEqual(fetchCalls, ["/game.json"]);
  } finally {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = previousFetch;
  }
});
