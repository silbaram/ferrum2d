import { equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { IndexedDbAssetCache } from "../src/indexedDbAssetCache.js";
import { WebGPURenderer } from "../src/webgpuRenderer.js";
import { createWorkerFrameClock } from "../src/workerFrameClock.js";

test("createWorkerFrameClock remains a deprecated no-op shim", () => {
  equal(createWorkerFrameClock(), null);
});

test("IndexedDbAssetCache remains a deprecated cache-miss shim", async () => {
  const cache = new IndexedDbAssetCache();

  equal(await cache.getJson("/game.json"), null);
  await cache.setJson("/game.json", { ok: true });
  equal(await cache.getJson("/game.json"), null);
  await cache.invalidateJson("/game.json");
});

test("WebGPURenderer reports unsupported MVP scope", async () => {
  try {
    await WebGPURenderer.create();
  } catch (error) {
    ok(/WebGPU renderer is outside the current Ferrum2D MVP scope/.test(String(error)));
    return;
  }

  throw new Error("Expected WebGPURenderer.create() to reject.");
});
