import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  LevelChunkStreamer,
  resolveLevelChunkManifest,
  resolveLevelStreamingPlan,
} from "../src/levelStreaming.js";
import { diagnosticReport } from "../src/diagnostics.js";

const manifestSpec = {
  id: "overworld",
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
      assets: { textures: { terrain: "/terrain.png" } },
    },
    {
      id: "1,0",
      chunkX: 1,
      chunkY: 0,
      tilemap: { url: "/chunks/1-0.json" },
      assets: { sounds: { wind: "/wind.ogg" } },
    },
    {
      id: "0,1",
      chunkX: 0,
      chunkY: 1,
      tilemap: { url: "/chunks/0-1.json", layer: "ground" },
    },
    {
      id: "1,1",
      chunkX: 1,
      chunkY: 1,
      tilemap: { url: "/chunks/1-1.json" },
      assets: { json: { encounter: "/encounter.json" } },
    },
  ],
};

test("resolveLevelChunkManifest computes deterministic chunk bounds and tilemap metadata", () => {
  const manifest = resolveLevelChunkManifest(manifestSpec);

  equal(manifest.id, "overworld");
  equal(manifest.chunks[0]?.bounds.width, 64);
  equal(manifest.chunksById["1,1"]?.bounds.minX, 64);
  equal(manifest.chunksById["1,1"]?.bounds.minY, 64);
  equal(manifest.chunksById["0,1"]?.tilemap?.layer, "ground");
});

test("resolveLevelStreamingPlan selects active, preload, retain, load, and unload chunks", () => {
  const manifest = resolveLevelChunkManifest(manifestSpec);
  const plan = resolveLevelStreamingPlan(manifest, {
    x: 8,
    y: 8,
    width: 24,
    height: 24,
  }, {
    loadedChunkIds: ["1,1"],
    assetLifetime: {
      preloadMarginChunks: 1,
      retainMarginChunks: 0,
    },
  });

  deepEqual(plan.activeChunkIds, ["0,0"]);
  deepEqual(plan.preloadChunks.map((chunk) => chunk.id), ["0,0", "1,0", "0,1", "1,1"]);
  deepEqual(plan.preloadChunkIds, ["0,0", "0,1", "1,0", "1,1"]);
  deepEqual(plan.retainChunks.map((chunk) => chunk.id), ["0,0"]);
  deepEqual(plan.retainChunkIds, ["0,0"]);
  deepEqual(plan.loadChunkIds, ["0,0", "1,0", "0,1"]);
  deepEqual(plan.unloadChunkIds, ["1,1"]);
  equal(plan.assetManifest.json?.["0,0:tilemap"], "/chunks/0-0.json");
  equal(plan.assetManifest.textures?.terrain, "/terrain.png");
  equal(plan.assetManifest.sounds?.wind, "/wind.ogg");
});

test("LevelChunkStreamer tracks loaded chunks and reuses the streaming policy", () => {
  const streamer = LevelChunkStreamer.create(manifestSpec, {
    preloadMarginChunks: 0,
    retainMarginChunks: 0,
  });
  const firstPlan = streamer.plan({ x: 0, y: 0, width: 16, height: 16 });
  streamer.markLoaded(firstPlan.loadChunkIds);

  const secondPlan = streamer.plan({ x: 72, y: 72, width: 16, height: 16 });
  deepEqual(streamer.snapshot().loadedChunkIds, ["0,0"]);
  deepEqual(secondPlan.activeChunkIds, ["1,1"]);
  deepEqual(secondPlan.loadChunkIds, ["1,1"]);
  deepEqual(secondPlan.unloadChunkIds, ["0,0"]);
});

test("resolveLevelStreamingPlan caps retained chunks before unload decisions", () => {
  const manifest = resolveLevelChunkManifest(manifestSpec);
  const plan = resolveLevelStreamingPlan(manifest, {
    x: 0,
    y: 0,
    width: 16,
    height: 16,
  }, {
    loadedChunkIds: ["0,0", "1,0", "0,1", "1,1"],
    assetLifetime: {
      preloadMarginChunks: 0,
      retainMarginChunks: 1,
      maxRetainedChunks: 2,
    },
  });

  deepEqual(plan.retainChunkIds, ["0,0", "1,0"]);
  deepEqual(plan.retainChunks.map((chunk) => chunk.id), ["0,0", "1,0"]);
  deepEqual(plan.unloadChunkIds, ["0,1", "1,1"]);
});

test("resolveLevelStreamingPlan preserves capped retain membership and string-sorted id summaries", () => {
  const manifest = resolveLevelChunkManifest({
    tileWidth: 16,
    tileHeight: 16,
    chunkColumns: 4,
    chunkRows: 4,
    chunks: [
      { id: "10,0", chunkX: 10, chunkY: 0 },
      { id: "0,0", chunkX: 0, chunkY: 0 },
      { id: "2,0", chunkX: 2, chunkY: 0 },
      { id: "1,0", chunkX: 1, chunkY: 0 },
    ],
  });

  const plan = resolveLevelStreamingPlan(manifest, {
    x: 408,
    y: 0,
    width: 16,
    height: 16,
  }, {
    loadedChunkIds: ["0,0", "1,0", "2,0", "10,0"],
    assetLifetime: {
      preloadMarginChunks: 10,
      retainMarginChunks: 10,
      maxRetainedChunks: 2,
    },
  });

  deepEqual(plan.preloadChunks.map((chunk) => chunk.id), ["0,0", "1,0", "2,0", "10,0"]);
  deepEqual(plan.preloadChunkIds, ["0,0", "1,0", "10,0", "2,0"]);
  deepEqual(plan.retainChunks.map((chunk) => chunk.id), ["2,0", "10,0"]);
  deepEqual(plan.retainChunkIds, ["10,0", "2,0"]);
  deepEqual(plan.loadChunkIds, []);
  deepEqual(plan.unloadChunkIds, ["0,0", "1,0"]);
});

test("resolveLevelChunkManifest rejects duplicate chunk ids with diagnostic context", () => {
  try {
    resolveLevelChunkManifest({
      chunks: [
        { id: "dup", chunkX: 0, chunkY: 0 },
        { id: "dup", chunkX: 1, chunkY: 0 },
      ],
    });
  } catch (error) {
    const report = diagnosticReport(error);
    equal(report.code, "FERRUM_LEVEL_STREAMING_INVALID");
    equal(report.context?.path, "levelStreaming.chunks[1].id");
    return;
  }
  throw new Error("Expected duplicate chunk ids to throw.");
});
