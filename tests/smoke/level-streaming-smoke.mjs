import {
  createLevelStreamingPixelMaskTerrainPhysicsOptions,
  createRuntimeLevelStreaming,
  extractLevelStreamingTilemapChunkBoundaryChains,
  LevelChunkStreamer,
  resolveLevelChunkManifest,
  resolveLevelStreamingPlan,
  tilemapLayerForLevelStreamingChunk,
} from "../../packages/ferrum-web/dist/levelStreaming.js";

const manifest = resolveLevelChunkManifest({
  id: "smoke-map",
  tileWidth: 16,
  tileHeight: 16,
  chunkColumns: 4,
  chunkRows: 4,
  chunks: [
    { id: "0,0", chunkX: 0, chunkY: 0, tilemap: { url: "/chunks/0-0.json" }, assets: { textures: { terrain: "/terrain.png" } } },
    { id: "1,0", chunkX: 1, chunkY: 0, tilemap: { url: "/chunks/1-0.json" } },
    { id: "0,1", chunkX: 0, chunkY: 1, tilemap: { url: "/chunks/0-1.json" } },
    { id: "1,1", chunkX: 1, chunkY: 1, tilemap: { url: "/chunks/1-1.json" }, assets: { json: { spawn: "/spawn.json" } } },
  ],
});

const firstPlan = resolveLevelStreamingPlan(manifest, {
  x: 0,
  y: 0,
  width: 32,
  height: 32,
}, {
  assetLifetime: { preloadMarginChunks: 1, retainMarginChunks: 0 },
});
if (firstPlan.activeChunkIds.join(",") !== "0,0") {
  throw new Error(`unexpected active chunks: ${firstPlan.activeChunkIds.join(",")}`);
}
if (firstPlan.preloadChunkIds.length !== 4 || firstPlan.assetManifest.json?.["1,1:tilemap"] !== "/chunks/1-1.json") {
  throw new Error("level streaming plan must include neighboring chunk tilemap assets.");
}

const streamer = LevelChunkStreamer.create(manifest, { preloadMarginChunks: 0, retainMarginChunks: 0 });
streamer.markLoaded(firstPlan.activeChunkIds);
const secondPlan = streamer.plan({
  x: 80,
  y: 80,
  width: 16,
  height: 16,
});
if (secondPlan.activeChunkIds.join(",") !== "1,1" || secondPlan.unloadChunkIds.join(",") !== "0,0") {
  throw new Error("level streamer must identify next active chunk and unload candidates.");
}

const alignedPixelMaskPhysics = createLevelStreamingPixelMaskTerrainPhysicsOptions(manifest, {
  engine: {},
  boundary: { tileWidth: 99, originX: 99 },
});
if (
  alignedPixelMaskPhysics.chunkWidth !== manifest.chunkColumns ||
  alignedPixelMaskPhysics.chunkHeight !== manifest.chunkRows ||
  alignedPixelMaskPhysics.boundary.tileWidth !== manifest.tileWidth ||
  alignedPixelMaskPhysics.boundary.originX !== manifest.origin.x
) {
  throw new Error(`pixel mask terrain physics options must align with level streaming chunks: ${
    JSON.stringify(alignedPixelMaskPhysics)
  }`);
}

const tilemapChunk = manifest.chunksById["1,0"];
const chunkTilemap = streamingTilemap();
const chunkLayer = tilemapLayerForLevelStreamingChunk(chunkTilemap.layers[0], tilemapChunk);
const chunkBoundary = extractLevelStreamingTilemapChunkBoundaryChains(chunkTilemap, tilemapChunk, {
  physicsLayer: "world",
});
if (
  chunkLayer.originX !== tilemapChunk.bounds.minX ||
  chunkLayer.columns !== tilemapChunk.columns ||
  chunkBoundary.chainCount <= 0 ||
  !chunkBoundary.chains.every((chain) => chain.bodyId.startsWith("levelStreamingChunk.1,0."))
) {
  throw new Error(`level streaming tilemap chunk boundary mismatch: ${JSON.stringify({
    chunkLayer,
    chunkBoundary,
  })}`);
}

const runtimeLoads = [];
const runtimeUnloads = [];
const runtimeTargetLoads = [];
const runtimeTargetUnloads = [];
const runtimeColliderRebuilds = [];
const runtimeReleasedAssets = [];
const evictedTextureIds = [];
const renderer = {
  evictTexture(textureId) {
    evictedTextureIds.push(textureId);
    return true;
  },
};
const textureIdsByName = new Map([["terrain", 7]]);
let runtimeViewport = { x: 0, y: 0, width: 32, height: 32 };
const runtime = createRuntimeLevelStreaming({
  manifest,
  assetLifetime: { preloadMarginChunks: 0, retainMarginChunks: 0 },
  viewport: () => runtimeViewport,
  preload: {
    fetch: async (url) => new Response(JSON.stringify({ url }), {
      headers: { "content-type": "application/json" },
    }),
  },
  target: {
    applyChunk: (chunk, context) => {
      runtimeTargetLoads.push(chunk.id);
      if (!context.result.loadChunkIds.includes(chunk.id)) {
        throw new Error(`target apply should receive a loaded chunk: ${chunk.id}`);
      }
    },
    unloadChunk: (chunk, context) => {
      runtimeTargetUnloads.push(chunk.id);
      if (!context.result.unloadChunkIds.includes(chunk.id)) {
        throw new Error(`target unload should receive an unloaded chunk: ${chunk.id}`);
      }
    },
    releaseAssets: (assets, context) => {
      runtimeReleasedAssets.push(assets.entries.map((entry) => `${entry.kind}:${entry.name}`));
      if (context.result.releasedAssets !== assets) {
        throw new Error("target releaseAssets should receive the update result release payload.");
      }
      for (const entry of assets.textures) {
        const textureId = textureIdsByName.get(entry.name);
        if (textureId !== undefined) {
          renderer.evictTexture(textureId);
        }
      }
    },
    rebuildColliders: (context) => {
      runtimeColliderRebuilds.push({
        loaded: context.result.snapshot.loadedChunkIds,
        load: context.result.loadChunkIds,
        unload: context.result.unloadChunkIds,
      });
    },
  },
  onLoad: (result) => {
    runtimeLoads.push([...result.loadChunkIds]);
  },
  onUnload: (result) => {
    runtimeUnloads.push([...result.unloadChunkIds]);
  },
}, () => ({ width: 32, height: 32 }));

const runtimeFirst = runtime.update(runtimeFrame());
if (runtimeFirst?.plan.activeChunkIds.join(",") !== "0,0") {
  throw new Error(`runtime level streaming should plan first active chunk: ${runtimeFirst?.plan.activeChunkIds.join(",")}`);
}
await flushAsyncWork();
runtime.update(runtimeFrame());
runtimeViewport = { x: 80, y: 80, width: 16, height: 16 };
const runtimeSecond = runtime.update(runtimeFrame());
await flushAsyncWork();
runtime.update(runtimeFrame());
if (
  runtimeSecond?.plan.activeChunkIds.join(",") !== "1,1" ||
  runtimeUnloads[0]?.join(",") !== "0,0" ||
  runtime.snapshot().loadedChunkIds.join(",") !== "1,1"
) {
  throw new Error(`runtime level streaming load/unload mismatch: ${JSON.stringify({
    runtimeSecond,
    runtimeLoads,
    runtimeUnloads,
    snapshot: runtime.snapshot(),
  })}`);
}
if (
  runtimeTargetLoads.join(",") !== "0,0,1,1" ||
  runtimeTargetUnloads.join(",") !== "0,0" ||
  runtimeReleasedAssets[0]?.join(",") !== "texture:terrain,json:0,0:tilemap" ||
  evictedTextureIds.join(",") !== "7" ||
  !runtimeColliderRebuilds.some((entry) => entry.unload.join(",") === "0,0") ||
  !runtimeColliderRebuilds.some((entry) => entry.load.join(",") === "1,1")
) {
  throw new Error(`runtime level streaming target mismatch: ${JSON.stringify({
    runtimeTargetLoads,
    runtimeTargetUnloads,
    runtimeReleasedAssets,
    evictedTextureIds,
    runtimeColliderRebuilds,
  })}`);
}

console.log(JSON.stringify({
  levelStreamingSmoke: {
    manifestId: manifest.id,
    firstActive: firstPlan.activeChunkIds,
    firstPreload: firstPlan.preloadChunkIds,
    secondActive: secondPlan.activeChunkIds,
    unload: secondPlan.unloadChunkIds,
    alignedPixelMaskPhysics: {
      chunkWidth: alignedPixelMaskPhysics.chunkWidth,
      chunkHeight: alignedPixelMaskPhysics.chunkHeight,
      tileWidth: alignedPixelMaskPhysics.boundary.tileWidth,
      originX: alignedPixelMaskPhysics.boundary.originX,
    },
    chunkBoundary: {
      layerOriginX: chunkLayer.originX,
      layerColumns: chunkLayer.columns,
      chainCount: chunkBoundary.chainCount,
      segmentCount: chunkBoundary.segmentCount,
    },
    runtimeLoads,
    runtimeUnloads,
    runtimeTargetLoads,
    runtimeTargetUnloads,
    runtimeReleasedAssets,
    evictedTextureIds,
    runtimeColliderRebuilds,
    runtimeSnapshot: runtime.snapshot(),
  },
}, null, 2));

function runtimeFrame() {
  return {
    frame: { cameraX: 0, cameraY: 0, frameTimeMs: 16 },
    rendererStats: {},
    debugMetrics: {},
    fps: 60,
    renderTimeMs: 1,
  };
}

function streamingTilemap() {
  return {
    tiles: [{
      id: 1,
      frame: {
        name: "solid",
        texture: "terrain",
        width: 16,
        height: 16,
        u0: 0,
        v0: 0,
        u1: 1,
        v1: 1,
      },
      color: [1, 1, 1, 1],
      floor: "default",
      elevation: 0,
      height: 0,
      kind: "flat",
      blocksMovement: true,
      blocksProjectile: true,
      blocksVision: true,
      occluderHeight: 0,
    }],
    layers: [{
      index: 0,
      name: "main",
      columns: 8,
      rows: 4,
      tileWidth: 16,
      tileHeight: 16,
      originX: 0,
      originY: 0,
      collision: true,
      collisionOnly: false,
      data: [
        0, 0, 0, 0, 1, 1, 0, 0,
        0, 0, 0, 0, 1, 1, 0, 0,
        0, 0, 0, 0, 0, 0, 1, 1,
        0, 0, 0, 0, 0, 0, 1, 1,
      ],
    }],
  };
}

async function flushAsyncWork() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
