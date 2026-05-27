import { equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { IndexedDbAssetCache } from "../src/indexedDbAssetCache.js";
import { WebGPURenderer } from "../src/webgpuRenderer.js";
import { createWorkerFrameClock } from "../src/workerFrameClock.js";

test("createWorkerFrameClock remains a deprecated no-op shim", () => {
  equal(createWorkerFrameClock(), null);
});

test("IndexedDbAssetCache is a cache miss when browser IndexedDB is unavailable", async () => {
  const cache = new IndexedDbAssetCache();

  equal(await cache.getJson("/game.json"), null);
  await cache.setJson("/game.json", { ok: true });
  equal(await cache.getJson("/game.json"), null);
  await cache.invalidateJson("/game.json");
  equal(await cache.getBinary("/player.png"), null);
  await cache.setBinary("/player.png", new ArrayBuffer(4));
  equal(await cache.getBinary("/player.png"), null);
  await cache.invalidateBinary("/player.png");
});

test("WebGPURenderer reports missing canvas or unavailable browser support", async () => {
  await rejectsWithMessage(
    async () => await WebGPURenderer.create(),
    /requires an HTMLCanvasElement/,
  );

  if (!WebGPURenderer.isSupported()) {
    await rejectsWithMessage(
      async () => await WebGPURenderer.create({} as HTMLCanvasElement),
      /WebGPU is not available/,
    );
  }
});

async function rejectsWithMessage(run: () => Promise<unknown>, expected: RegExp): Promise<void> {
  try {
    await run();
  } catch (error) {
    ok(expected.test(String(error instanceof Error ? error.message : error)));
    return;
  }
  throw new Error("Expected promise to reject.");
}
