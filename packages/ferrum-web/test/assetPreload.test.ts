import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  assetManifestFingerprint,
  createAssetPreloadCachePolicy,
  invalidatePreloadedAssetCache,
  preloadAssetManifest,
  resolveAssetPreloadPlan,
} from "../src/assetPreload.js";
import type { BinaryAssetCache, JsonAssetCache } from "../src/indexedDbAssetCache.js";

test("resolveAssetPreloadPlan expands manifest entries in runtime load order", () => {
  const plan = resolveAssetPreloadPlan({
    textures: { player: "/player.png" },
    sounds: { shoot: "/shoot.wav" },
    json: { game: "/game.json", level: "/level.json" },
  });

  equal(plan.total, 4);
  equal(plan.textures, 1);
  equal(plan.sounds, 1);
  equal(plan.json, 2);
  deepEqual(plan.entries.map(({ kind, name, index }) => `${index}:${kind}:${name}`), [
    "0:texture:player",
    "1:sound:shoot",
    "2:json:game",
    "3:json:level",
  ]);
});

test("preloadAssetManifest fetches assets and emits progress for loading screens", async () => {
  const fetched: string[] = [];
  const progress: string[] = [];
  const result = await preloadAssetManifest({
    textures: { player: "/player.png" },
    json: { game: "/game.json" },
  }, {
    fetch: async (url) => {
      fetched.push(String(url));
      return responseFor(url);
    },
    onProgress: ({ loaded, total, ratio, kind, name, cached }) => {
      progress.push(`${loaded}/${total}:${ratio?.toFixed(2)}:${kind ?? "start"}:${name ?? "-"}:${cached === true}`);
    },
  });

  deepEqual(fetched, ["/player.png", "/game.json"]);
  deepEqual(result.json.game, { url: "/game.json" });
  equal(result.fetched, 2);
  equal(result.cached, 0);
  deepEqual(progress, [
    "0/2:0.00:start:-:false",
    "1/2:0.50:texture:player:false",
    "2/2:1.00:json:game:false",
  ]);
});

test("preloadAssetManifest uses opt-in JSON cache policy", async () => {
  const fetched: string[] = [];
  const cache = memoryJsonCache();

  const first = await preloadAssetManifest({ json: { game: "/game.json" } }, {
    cache,
    cachePolicy: { json: true, version: "test", ttlMs: 1000 },
    fetch: async (url) => {
      fetched.push(String(url));
      return responseFor(url);
    },
  });
  const second = await preloadAssetManifest({ json: { game: "/game.json" } }, {
    cache,
    cachePolicy: { json: true, version: "test", ttlMs: 1000 },
    fetch: async (url) => {
      fetched.push(String(url));
      return responseFor(url);
    },
  });

  deepEqual(first.json.game, { url: "/game.json" });
  deepEqual(second.json.game, { url: "/game.json" });
  equal(first.fetched, 1);
  equal(second.fetched, 0);
  equal(second.cached, 1);
  deepEqual(fetched, ["/game.json"]);
});

test("preloadAssetManifest uses opt-in binary cache policy for texture bodies", async () => {
  const fetched: string[] = [];
  const cache = memoryAssetCache();

  const first = await preloadAssetManifest({ textures: { player: "/player.png" } }, {
    cache,
    cachePolicy: { textures: true, version: "texture-test", ttlMs: 1000 },
    fetch: async (url) => {
      fetched.push(String(url));
      return responseFor(url);
    },
  });
  const second = await preloadAssetManifest({ textures: { player: "/player.png" } }, {
    cache,
    cachePolicy: { textures: true, version: "texture-test", ttlMs: 1000 },
    fetch: async (url) => {
      fetched.push(String(url));
      return responseFor(url);
    },
  });

  equal(first.fetched, 1);
  equal(first.cached, 0);
  equal(second.fetched, 0);
  equal(second.cached, 1);
  deepEqual(fetched, ["/player.png"]);
});

test("preloadAssetManifest lets per-kind binary cache disables override binary default", async () => {
  const fetched: string[] = [];
  const cache = memoryAssetCache();
  const manifest = {
    textures: { player: "/player.png" },
    sounds: { shoot: "/shoot.wav" },
  };
  const options = {
    cache,
    cachePolicy: { textures: false, sounds: false, binary: true, version: "disabled-binary-test" },
    fetch: async (url: unknown) => {
      fetched.push(String(url));
      return responseFor(url);
    },
  };

  const first = await preloadAssetManifest(manifest, options);
  const second = await preloadAssetManifest(manifest, options);

  equal(first.fetched, 2);
  equal(first.cached, 0);
  equal(second.fetched, 2);
  equal(second.cached, 0);
  deepEqual(fetched, ["/player.png", "/shoot.wav", "/player.png", "/shoot.wav"]);
});

test("assetManifestFingerprint is deterministic and changes with manifest inputs", () => {
  const first = assetManifestFingerprint({
    textures: { player: "/player.png", enemy: "/enemy.png" },
    sounds: { shoot: "/shoot.wav" },
    json: { game: "/game.json" },
  }, "release-1");
  const reordered = assetManifestFingerprint({
    json: { game: "/game.json" },
    sounds: { shoot: "/shoot.wav" },
    textures: { enemy: "/enemy.png", player: "/player.png" },
  }, "release-1");
  const urlChanged = assetManifestFingerprint({
    textures: { player: "/player.v2.png", enemy: "/enemy.png" },
    sounds: { shoot: "/shoot.wav" },
    json: { game: "/game.json" },
  }, "release-1");

  equal(first, reordered);
  ok(first !== urlChanged);
  ok(first !== assetManifestFingerprint({
    textures: { player: "/player.png", enemy: "/enemy.png" },
    sounds: { shoot: "/shoot.wav" },
    json: { game: "/game.json" },
  }, "release-2"));
});

test("createAssetPreloadCachePolicy derives a manifest-scoped cache version", () => {
  const manifest = {
    textures: { player: "/player.png" },
    sounds: { shoot: "/shoot.wav" },
    json: { game: "/game.json" },
  };
  const policy = createAssetPreloadCachePolicy(manifest, {
    versionPrefix: "topdown",
    versionSalt: "release-1",
    ttlMs: 5000,
  });

  equal(policy.json, true);
  equal(policy.textures, true);
  equal(policy.sounds, true);
  equal(policy.binary, true);
  equal(policy.ttlMs, 5000);
  equal(policy.version, `topdown-${assetManifestFingerprint(manifest, "release-1")}`);
  equal(createAssetPreloadCachePolicy(manifest, { version: "manual", binary: false }).version, "manual");
  equal(createAssetPreloadCachePolicy(manifest, { version: "manual", binary: false }).binary, false);
});

test("invalidatePreloadedAssetCache removes manifest JSON and binary cache entries", async () => {
  const manifest = {
    textures: { player: "/player.png" },
    sounds: { shoot: "/shoot.wav" },
    json: { game: "/game.json" },
  };
  const fetched: string[] = [];
  const cache = memoryAssetCache();
  const cachePolicy = createAssetPreloadCachePolicy(manifest, { versionSalt: "release-1" });
  const preloadOptions = {
    cache,
    cachePolicy,
    fetch: async (url: unknown) => {
      fetched.push(String(url));
      return responseFor(url);
    },
  };

  const first = await preloadAssetManifest(manifest, preloadOptions);
  const second = await preloadAssetManifest(manifest, preloadOptions);
  const invalidation = await invalidatePreloadedAssetCache(manifest, cache, { policy: cachePolicy });
  const third = await preloadAssetManifest(manifest, preloadOptions);

  equal(first.fetched, 3);
  equal(second.cached, 3);
  equal(invalidation.version, cachePolicy.version);
  equal(invalidation.invalidatedJson, 1);
  equal(invalidation.invalidatedBinary, 2);
  equal(invalidation.invalidatedTotal, 3);
  equal(third.fetched, 3);
  deepEqual(fetched, [
    "/player.png",
    "/shoot.wav",
    "/game.json",
    "/player.png",
    "/shoot.wav",
    "/game.json",
  ]);
});

function responseFor(url: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: {
      get: () => null,
    },
    json: async () => ({ url: String(url) }),
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

function memoryJsonCache(): JsonAssetCache {
  const values = new Map<string, unknown>();
  return {
    getJson: async (url, options = {}) => values.get(`${options.version ?? "v1"}:${url}`) ?? null,
    setJson: async (url, value, options = {}) => {
      values.set(`${options.version ?? "v1"}:${url}`, value);
    },
    invalidateJson: async (url, options = {}) => {
      values.delete(`${options.version ?? "v1"}:${url}`);
    },
  };
}

function memoryAssetCache(): JsonAssetCache & BinaryAssetCache {
  const json = new Map<string, unknown>();
  const binary = new Map<string, ArrayBuffer>();
  return {
    getJson: async (url, options = {}) => json.get(`${options.version ?? "v1"}:${url}`) ?? null,
    setJson: async (url, value, options = {}) => {
      json.set(`${options.version ?? "v1"}:${url}`, value);
    },
    invalidateJson: async (url, options = {}) => {
      json.delete(`${options.version ?? "v1"}:${url}`);
    },
    getBinary: async (url, options = {}) => binary.get(`${options.version ?? "v1"}:${url}`)?.slice(0) ?? null,
    setBinary: async (url, value, options = {}) => {
      binary.set(`${options.version ?? "v1"}:${url}`, value.slice(0));
    },
    invalidateBinary: async (url, options = {}) => {
      binary.delete(`${options.version ?? "v1"}:${url}`);
    },
  };
}
