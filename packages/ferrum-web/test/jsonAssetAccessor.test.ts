import "./nativeRuntimeTestHelper.js";
import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import { AssetLoader, type AssetReleaseEntry } from "../src/assetLoader.js";
import { BrowserPlatformHost } from "../src/browserPlatformHost.js";
import { createEngine } from "../src/createEngine.js";
import { assetFileOwner, registerTextureFileOwner, type ResourceTextureData } from "../src/nativeFileResourceOwners.js";
import { registerResourceModelCacheOwner } from "../src/nativeFileResourceModelCaches.js";
import { ResourceBudget } from "../src/nativeFileResourceBudget.js";
import { captureNativeFileResourceSession, prepareNativeFileResourceSession } from "../src/nativeFileResourceSession.js";

const manager = () => ({ async loadTexture() { throw Error("JSON access must not load a texture"); } });
const release = (name: string, url: string) => {
  const entry: AssetReleaseEntry = { kind: "json", name, url };
  return { entries: [entry], json: [entry], textures: [], sounds: [], total: 1 };
};

/** Empty platform texture/model owners isolate JSON preparation in this unit.
 * No browser GPU context or texture pixels are exercised by this fixture. */
class EmptyRenderer {
  constructor() {
    const data: ResourceTextureData = { backend: "webgpu", generation: 0, contentRevision: 0, colorManagement: "legacy", entries: [] };
    registerTextureFileOwner(this, {
      capture: async () => data, revision: () => 0,
      prepare: async input => {
        deepEqual(input, data);
        return { owner: this, adopt() {}, dispose() {} };
      },
    });
    registerResourceModelCacheOwner(this, {
      capture: () => ({ backend: "webgpu", roots: [], active: [], warmed: [], prepared: [], assertCurrent() {} }),
      prepare: async input => { equal(input.all.length, 0); },
    });
  }
  async loadTexture(): Promise<never> { throw Error("JSON access must not load a texture"); }
}

test("AssetLoader JSON getter retains LoadedAssets identity, mutable data, -0 and current replacement", async () => {
  const previous = globalThis.fetch, loader = new AssetLoader(manager());
  let requests = 0;
  globalThis.fetch = async () => { requests++; return new Response('{"n":-0,"nested":{"x":1}}'); };
  try {
    equal(loader.getJsonAsset("missing"), undefined);
    const assets = await loader.loadAssets({ json: { game: "game.json" } });
    const value = assets.json.game as { n: number; nested: { x: number } };
    equal(loader.getJsonAsset("game"), value); ok(Object.is(value.n, -0));
    value.nested.x = 7;
    equal((loader.getJsonAsset("game") as typeof value).nested.x, 7);
    (loader.getJsonAsset("game") as typeof value).n = 9;
    equal(value.n, 9); equal(requests, 1);
    globalThis.fetch = async () => { requests++; return new Response("null"); };
    await loader.loadAssets({ json: { game: "new.json" } });
    equal(loader.getJsonAsset("game"), null); equal(value.n, 9); equal(requests, 2);
    loader.releaseAssets(release("game", "game.json"));
    equal(loader.getJsonAsset("game"), null);
    loader.releaseAssets(release("game", "new.json"));
    equal(loader.getJsonAsset("game"), undefined);
    assetFileOwner(loader).dispose();
    throws(() => loader.getJsonAsset("game"), /STALE.*asset owner disposed/);
  } finally { assetFileOwner(loader).dispose(); globalThis.fetch = previous; }
});

test("BrowserPlatformHost delegates current JSON identity and preserves release/destroy lifetime", async () => {
  const previous = globalThis.fetch, host = new BrowserPlatformHost(manager());
  globalThis.fetch = async () => new Response('{"zero":-0}');
  try {
    equal(host.getJsonAsset("missing"), undefined);
    const assets = await host.loadAssets({ json: { game: "game.json" } });
    equal(host.getJsonAsset("game"), assets.json.game);
    ok(Object.is((host.getJsonAsset("game") as { zero: number }).zero, -0));
    host.releaseAssets(release("game", "game.json")); equal(host.getJsonAsset("game"), undefined);
    host.destroy(); throws(() => host.getJsonAsset("game"), /BrowserPlatformHost has been destroyed/);
  } finally { host.destroy(); globalThis.fetch = previous; }
});

test("actual ResourceSession prepare/adopt restores JSON getter without download/reapply and retains cross-asset aliases", async () => {
  const previous = globalThis.fetch;
  const sourceHost = new BrowserPlatformHost(new EmptyRenderer()), targetHost = new BrowserPlatformHost(new EmptyRenderer());
  const source = await createEngine(undefined, undefined, sourceHost), target = await createEngine(undefined, undefined, targetHost);
  let requests = 0, lease: Awaited<ReturnType<typeof prepareNativeFileResourceSession>> | undefined;
  globalThis.fetch = async () => { requests++; return new Response('{"n":-0,"shared":null}'); };
  try {
    const loaded = await sourceHost.loadAssets({ json: { game: "game.json", other: "other.json" } });
    const a = loaded.json.game as { n: number; shared: unknown }, b = loaded.json.other as typeof a;
    const shared = { changed: 17 }; a.shared = shared; b.shared = shared;
    const saved = await captureNativeFileResourceSession(source, new ResourceBudget());
    globalThis.fetch = async () => { throw Error("No resource URL may be fetched while restoring JSON"); };
    lease = await prepareNativeFileResourceSession(target, saved.manifestBytes, saved.dataBytes, new ResourceBudget());
    equal(targetHost.getJsonAsset("game"), undefined);
    lease.adopt();
    const restored = targetHost.getJsonAsset("game") as typeof a, other = targetHost.getJsonAsset("other") as typeof b;
    deepEqual(restored, a); ok(restored !== a); equal(restored.shared, other.shared); ok(restored.shared !== shared);
    ok(Object.is(restored.n, -0)); equal(targetHost.getJsonAsset("game"), restored); equal(requests, 2);
    (restored.shared as typeof shared).changed = 29;
    equal((other.shared as typeof shared).changed, 29); equal(shared.changed, 17);
    saved.assertCurrent();
    targetHost.releaseAssets(release("game", "game.json")); equal(targetHost.getJsonAsset("game"), undefined);
    equal((targetHost.getJsonAsset("other") as typeof b).shared, other.shared);
  } finally {
    await lease?.dispose(); source.destroy(); target.destroy(); sourceHost.destroy(); targetHost.destroy(); globalThis.fetch = previous;
  }
});
