import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import { test } from "node:test";
import { AssetLoader } from "../src/assetLoader.js";
import { preloadAssetManifest } from "../src/assetPreload.js";
import { BrowserPlatformHost } from "../src/browserPlatformHost.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !predicate(); i++) await Promise.resolve();
  ok(predicate(), "expected async state was not reached");
}

test("manifest concurrency bounds all asset kinds and preserves ID/start order", async () => {
  const starts: { id: number; url: string; gate: ReturnType<typeof deferred<void>> }[] = [];
  const load = async (id: number, url: string) => {
    const gate = deferred<void>();
    starts.push({ id, url, gate });
    await gate.promise;
  };
  const loader = new AssetLoader({ loadTexture: load }, {
    loadSound: async (id, url) => { await load(id, url); return {} as AudioBuffer; },
  });
  const progress: string[] = [];
  const result = loader.loadAssets({
    textures: { a: "/a", b: "/b", c: "/c" }, sounds: { hit: "/hit" },
  }, p => progress.push(`${p.loaded}:${p.name ?? "start"}`), { concurrency: 2 });
  equal(starts.length, 2);
  starts[1].gate.resolve();
  await until(() => starts.length === 3);
  equal(starts.length, 3);
  starts[0].gate.resolve();
  await until(() => starts.length === 4);
  starts[3].gate.resolve();
  await until(() => progress.length === 4);
  starts[2].gate.resolve();
  const assets = await result;
  deepEqual(starts.map(s => [s.id, s.url]), [[1, "/a"], [2, "/b"], [3, "/c"], [1, "/hit"]]);
  deepEqual(progress, ["0:start", "1:b", "2:a", "3:hit", "4:c"]);
  equal(assets.progress.ratio, 1);
});

test("first failure aborts siblings, drains late work and does not report late progress", async () => {
  const slow = deferred<void>(), fail = deferred<void>();
  const starts: string[] = [];
  const signals: AbortSignal[] = [];
  const progress: number[] = [];
  const loader = new AssetLoader({ loadTexture: async (_id, url, options) => {
    starts.push(url);
    if (!options?.signal) throw new Error("missing load signal");
    signals.push(options.signal);
    await (url === "/slow" ? slow.promise : fail.promise);
  } });
  let settled = false;
  const result = loader.loadAssets({ textures: { slow: "/slow", fail: "/fail", queued: "/queued" } },
    p => progress.push(p.loaded), { concurrency: 2 });
  const checked = rejects(result, /name='fail'.*original failure/).then(() => { settled = true; });
  fail.reject(new Error("original failure"));
  await until(() => signals[0].aborted);
  equal(settled, false);
  slow.resolve();
  await checked;
  deepEqual(starts, ["/slow", "/fail"]);
  deepEqual(progress, [0]);
});

test("batch cancellation combines with texture signals and prevents queued jobs", async () => {
  for (const cancelTexture of [false, true]) {
    const batch = new AbortController(), texture = new AbortController();
    const gate = deferred<void>();
    let loads = 0;
    let active: AbortSignal | undefined;
    const loader = new AssetLoader({ loadTexture: async (_id, _url, options) => {
      loads++;
      active = options?.signal;
      await gate.promise;
    } });
    const progress: number[] = [];
    const checked = rejects(loader.loadAssets({ textures: { a: "/a", b: "/b" },
      textureOptions: { a: { signal: texture.signal } } }, p => progress.push(p.loaded), { signal: batch.signal }),
    /AbortError/);
    (cancelTexture ? texture : batch).abort();
    equal(active?.aborted, true);
    gate.resolve();
    await checked;
    equal(loads, 1);
    deepEqual(progress, [0]);
  }
});

test("pre-abort and invalid concurrency cause no requests, reservations or progress", async () => {
  const controller = new AbortController(); controller.abort();
  let effects = 0;
  const loader = new AssetLoader({ loadTexture: async () => { effects++; } });
  const manifest = { textures: { a: "/a" } };
  await rejects(loader.loadAssets(manifest, () => { effects++; }, { signal: controller.signal }), /AbortError/);
  for (const concurrency of [0, -1, 17, 1.5, NaN, Infinity]) {
    await rejects(loader.loadAssets(manifest, () => { effects++; }, { concurrency }), /concurrency/);
  }
  equal(effects, 0);
  equal(loader.textureIds().entries().length, 0);
  await rejects(preloadAssetManifest({}, { signal: controller.signal }), /AbortError/);
});

test("preload uses a shared bound for texture, sound and JSON and counts completion", async () => {
  const third = deferred<void>();
  const starts: { url: string; gate: ReturnType<typeof deferred<Response>> }[] = [];
  const progress: number[] = [];
  const result = preloadAssetManifest({ textures: { a: "/a" }, sounds: { b: "/b" }, json: { c: "/c" } }, {
    concurrency: 2,
    fetch: async url => {
      const gate = deferred<Response>(); starts.push({ url: String(url), gate });
      if (starts.length === 3) third.resolve();
      return gate.promise;
    }, onProgress: p => progress.push(p.loaded),
  });
  equal(starts.length, 2);
  starts[1].gate.resolve(new Response("sound"));
  await third.promise;
  starts[2].gate.resolve(new Response('{"ok":true}'));
  starts[0].gate.resolve(new Response("texture"));
  const loaded = await result;
  deepEqual(starts.map(s => s.url), ["/a", "/b", "/c"]);
  deepEqual(progress, [0, 1, 2, 3]);
  equal(loaded.fetched, 3);
  deepEqual(loaded.json.c, { ok: true });
});

test("preload cancellation during cache lookup never fetches or reports success", async () => {
  const gate = deferred<unknown>();
  const controller = new AbortController();
  let fetches = 0, writes = 0;
  const progress: number[] = [];
  const checked = rejects(preloadAssetManifest({ json: { a: "/a", b: "/b" } }, {
    signal: controller.signal, cachePolicy: { json: true },
    cache: { getJson: () => gate.promise, setJson: async () => { writes++; }, invalidateJson: async () => {} },
    fetch: async () => { fetches++; return new Response("{}"); }, onProgress: p => progress.push(p.loaded),
  }), /AbortError/);
  controller.abort(); gate.resolve({ cached: true });
  await checked;
  equal(fetches, 0); equal(writes, 0); deepEqual(progress, [0]);
});

test("preload cancellation during body decode skips cache writes and queued work", async () => {
  const gate = deferred<ArrayBuffer>();
  const controller = new AbortController();
  let fetches = 0, writes = 0, decoding = false;
  const checked = rejects(preloadAssetManifest({ textures: { a: "/a", b: "/b" } }, {
    signal: controller.signal, cachePolicy: { binary: true },
    cache: { getJson: async () => null, setJson: async () => {}, invalidateJson: async () => {},
      getBinary: async () => null, setBinary: async () => { writes++; } },
    fetch: async () => {
      fetches++;
      return { ok: true, arrayBuffer: () => { decoding = true; return gate.promise; } } as Response;
    },
  }), /AbortError/);
  await until(() => decoding);
  controller.abort(); gate.resolve(new ArrayBuffer(1));
  await checked;
  equal(fetches, 1); equal(writes, 0);
});

test("host destroy aborts pending loads without destroying the externally owned texture manager", async () => {
  const gate = deferred<void>();
  let signal: AbortSignal | undefined;
  let loads = 0;
  const host = new BrowserPlatformHost({ loadTexture: async (_id, _url, options) => {
    loads++; signal = options?.signal; await gate.promise;
  } });
  const checked = rejects(host.loadAssets({ textures: { a: "/a", b: "/b" } }), /AbortError/);
  host.destroy();
  equal(signal?.aborted, true);
  gate.resolve(); await checked;
  equal(loads, 1);
});
