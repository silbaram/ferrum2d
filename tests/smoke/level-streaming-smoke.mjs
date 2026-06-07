import {
  LevelChunkStreamer,
  resolveLevelChunkManifest,
  resolveLevelStreamingPlan,
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

console.log(JSON.stringify({
  levelStreamingSmoke: {
    manifestId: manifest.id,
    firstActive: firstPlan.activeChunkIds,
    firstPreload: firstPlan.preloadChunkIds,
    secondActive: secondPlan.activeChunkIds,
    unload: secondPlan.unloadChunkIds,
  },
}, null, 2));
