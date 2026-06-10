import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { createRuntimeLevelStreaming } from "../src/levelStreamingRuntime.js";
import type { FerrumRuntimeFrame } from "../src/createFerrumRuntime.js";

test("createRuntimeLevelStreaming preloads chunk assets and tracks unload candidates", async () => {
  const loaded: string[][] = [];
  const unloaded: string[][] = [];
  const targetLoads: string[] = [];
  const targetUnloads: string[] = [];
  const colliderRebuilds: Array<{ loaded: readonly string[]; load: readonly string[]; unload: readonly string[] }> = [];
  const progress: Array<{ loaded: number; total: number }> = [];
  let viewportX = 0;
  const levelStreaming = createRuntimeLevelStreaming({
    manifest: {
      id: "runtime-map",
      tileWidth: 16,
      tileHeight: 16,
      chunkColumns: 4,
      chunkRows: 4,
      chunks: [
        { id: "0,0", chunkX: 0, chunkY: 0, tilemap: { url: "/chunks/0-0.json" } },
        { id: "1,0", chunkX: 1, chunkY: 0, tilemap: { url: "/chunks/1-0.json" }, assets: { json: { spawn: "/spawn-1-0.json" } } },
      ],
    },
    assetLifetime: { preloadMarginChunks: 0, retainMarginChunks: 0 },
    viewport: () => ({ x: viewportX, y: 0, width: 32, height: 32 }),
    preload: {
      fetch: async (url) => new Response(JSON.stringify({ url }), {
        headers: { "content-type": "application/json" },
      }),
      onProgress: (nextProgress) => {
        progress.push({ loaded: nextProgress.loaded, total: nextProgress.total });
      },
    },
    target: {
      applyChunk: (chunk, context) => {
        targetLoads.push(chunk.id);
        equal(context.result.loadChunkIds.includes(chunk.id), true);
      },
      unloadChunk: (chunk, context) => {
        targetUnloads.push(chunk.id);
        equal(context.result.unloadChunkIds.includes(chunk.id), true);
      },
      rebuildColliders: (context) => {
        colliderRebuilds.push({
          loaded: context.result.snapshot.loadedChunkIds,
          load: context.result.loadChunkIds,
          unload: context.result.unloadChunkIds,
        });
      },
    },
    onLoad: (result) => {
      loaded.push([...result.loadChunkIds]);
    },
    onUnload: (result) => {
      unloaded.push([...result.unloadChunkIds]);
    },
  }, () => ({ width: 32, height: 32 }));

  const first = levelStreaming.update(runtimeFrame());
  deepEqual(first?.plan.activeChunkIds, ["0,0"]);
  deepEqual(first?.pendingChunkIds, ["0,0"]);
  await flushAsyncWork();
  levelStreaming.update(runtimeFrame());
  deepEqual(loaded, [["0,0"]]);
  deepEqual(levelStreaming.snapshot().loadedChunkIds, ["0,0"]);

  viewportX = 80;
  const second = levelStreaming.update(runtimeFrame());
  deepEqual(second?.plan.activeChunkIds, ["1,0"]);
  deepEqual(second?.unloadChunkIds, ["0,0"]);
  await flushAsyncWork();
  levelStreaming.update(runtimeFrame());
  deepEqual(loaded, [["0,0"], ["1,0"]]);
  deepEqual(unloaded, [["0,0"]]);
  deepEqual(targetLoads, ["0,0", "1,0"]);
  deepEqual(targetUnloads, ["0,0"]);
  equal(colliderRebuilds.some((entry) => entry.load.join(",") === "1,0"), true);
  equal(colliderRebuilds.some((entry) => entry.unload.join(",") === "0,0"), true);
  deepEqual(levelStreaming.snapshot().loadedChunkIds, ["1,0"]);
  equal(progress.some((entry) => entry.total > 0), true);
});

test("createRuntimeLevelStreaming skips stale pending preload completion after viewport changes", async () => {
  const loaded: string[][] = [];
  const targetLoads: string[] = [];
  let viewportX = 0;
  let resolveStaleChunk: (() => void) | undefined;
  const staleChunkLoaded = new Promise<Response>((resolve) => {
    resolveStaleChunk = () => {
      resolve(new Response(JSON.stringify({ url: "/chunks/0-0.json" }), {
        headers: { "content-type": "application/json" },
      }));
    };
  });
  const levelStreaming = createRuntimeLevelStreaming({
    manifest: {
      id: "runtime-map",
      tileWidth: 16,
      tileHeight: 16,
      chunkColumns: 4,
      chunkRows: 4,
      chunks: [
        { id: "0,0", chunkX: 0, chunkY: 0, tilemap: { url: "/chunks/0-0.json" } },
        { id: "1,0", chunkX: 1, chunkY: 0, tilemap: { url: "/chunks/1-0.json" } },
      ],
    },
    assetLifetime: { preloadMarginChunks: 0, retainMarginChunks: 0 },
    viewport: () => ({ x: viewportX, y: 0, width: 32, height: 32 }),
    preload: {
      fetch: async (url) => {
        if (String(url).endsWith("/chunks/0-0.json")) {
          return staleChunkLoaded;
        }
        return new Response(JSON.stringify({ url }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
    target: {
      applyChunk: (chunk) => {
        targetLoads.push(chunk.id);
      },
    },
    onLoad: (result) => {
      loaded.push([...result.loadChunkIds]);
    },
  }, () => ({ width: 32, height: 32 }));

  const first = levelStreaming.update(runtimeFrame());
  deepEqual(first?.plan.activeChunkIds, ["0,0"]);
  deepEqual(first?.pendingChunkIds, ["0,0"]);

  viewportX = 80;
  const second = levelStreaming.update(runtimeFrame());
  deepEqual(second?.plan.activeChunkIds, ["1,0"]);
  deepEqual(second?.pendingChunkIds, ["0,0", "1,0"]);
  await flushAsyncWork();
  levelStreaming.update(runtimeFrame());
  deepEqual(loaded, [["1,0"]]);
  deepEqual(targetLoads, ["1,0"]);
  deepEqual(levelStreaming.snapshot().loadedChunkIds, ["1,0"]);

  resolveStaleChunk?.();
  await flushAsyncWork();
  levelStreaming.update(runtimeFrame());
  deepEqual(levelStreaming.pendingChunkIds(), []);
  deepEqual(loaded, [["1,0"]]);
  deepEqual(targetLoads, ["1,0"]);
  deepEqual(levelStreaming.snapshot().loadedChunkIds, ["1,0"]);
});

test("createRuntimeLevelStreaming applies retained async preload on the latest frame", async () => {
  const loaded: string[][] = [];
  const targetFrameCameraXs: number[] = [];
  const preloadedEntryNames: string[][] = [];
  const preloadedJsonKeys: string[][] = [];
  const fetchedUrls: string[] = [];
  let viewportX = 0;
  let resolveDelayedChunk: (() => void) | undefined;
  const delayedChunkLoaded = new Promise<Response>((resolve) => {
    resolveDelayedChunk = () => {
      resolve(new Response(JSON.stringify({ url: "/chunks/0-0.json" }), {
        headers: { "content-type": "application/json" },
      }));
    };
  });
  const levelStreaming = createRuntimeLevelStreaming({
    manifest: {
      id: "runtime-map",
      tileWidth: 16,
      tileHeight: 16,
      chunkColumns: 4,
      chunkRows: 4,
      chunks: [
        {
          id: "0,0",
          chunkX: 0,
          chunkY: 0,
          tilemap: { url: "/chunks/0-0.json" },
          assets: { json: { stale: "/stale.json" } },
        },
        {
          id: "4,0",
          chunkX: 4,
          chunkY: 0,
          tilemap: { url: "/chunks/4-0.json" },
          assets: { json: { kept: "/kept.json" } },
        },
      ],
    },
    assetLifetime: { preloadMarginChunks: 2, retainMarginChunks: 0 },
    viewport: () => ({ x: viewportX, y: 0, width: 32, height: 32 }),
    preload: {
      fetch: async (url) => {
        const stringUrl = String(url);
        fetchedUrls.push(stringUrl);
        if (stringUrl.endsWith("/chunks/0-0.json")) {
          return delayedChunkLoaded;
        }
        return new Response(JSON.stringify({ url: stringUrl }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
    target: {
      applyChunk: (_chunk, context) => {
        targetFrameCameraXs.push(context.frame.frame.cameraX);
      },
    },
    onLoad: (result, frame) => {
      loaded.push([...result.loadChunkIds]);
      preloadedEntryNames.push(result.preloaded?.plan.entries.map((entry) => entry.name) ?? []);
      preloadedJsonKeys.push(Object.keys(result.preloaded?.json ?? {}));
      equal(frame.frame.cameraX, 64);
    },
  }, () => ({ width: 32, height: 32 }));

  viewportX = 128;
  const first = levelStreaming.update(runtimeFrame(0));
  deepEqual(first?.loadChunkIds, ["0,0", "4,0"]);

  viewportX = 256;
  const second = levelStreaming.update(runtimeFrame(16));
  deepEqual(second?.plan.activeChunkIds, ["4,0"]);
  deepEqual(second?.pendingChunkIds, ["0,0", "4,0"]);

  resolveDelayedChunk?.();
  await waitFor(() => fetchedUrls.some((url) => url.endsWith("/kept.json")));
  await flushAsyncWork();
  deepEqual(loaded, []);
  deepEqual(targetFrameCameraXs, []);

  levelStreaming.update(runtimeFrame(64));

  deepEqual(loaded, [["4,0"]]);
  deepEqual(targetFrameCameraXs, [64]);
  deepEqual(preloadedEntryNames, [["4,0:tilemap", "kept"]]);
  deepEqual(preloadedJsonKeys, [["4,0:tilemap", "kept"]]);
  deepEqual(levelStreaming.snapshot().loadedChunkIds, ["4,0"]);
});

function runtimeFrame(cameraX = 0): FerrumRuntimeFrame {
  return {
    frame: {
      cameraX,
      cameraY: 0,
      frameTimeMs: 16,
    } as FerrumRuntimeFrame["frame"],
    rendererStats: {} as FerrumRuntimeFrame["rendererStats"],
    debugMetrics: {} as FerrumRuntimeFrame["debugMetrics"],
    fps: 60,
    renderTimeMs: 1,
  };
}

async function flushAsyncWork(): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("timed out waiting for level streaming runtime update");
}
