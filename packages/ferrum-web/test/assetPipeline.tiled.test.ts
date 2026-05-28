import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  importTiledGameSpec,
  importTiledTilemap,
} from "../src/assetPipeline.js";
import { compressedTiledLayerData, rejectsWithMessage } from "./assetPipeline.shared.js";

test("importTiledTilemap converts orthogonal tile layers and tileset atlas frames", () => {
  const imported = importTiledTilemap({
    orientation: "orthogonal",
    width: 3,
    height: 2,
    tilewidth: 16,
    tileheight: 16,
    tilesets: [{
      firstgid: 1,
      name: "terrain",
      image: "terrain.png",
      imagewidth: 64,
      imageheight: 32,
      tilewidth: 16,
      tileheight: 16,
      columns: 4,
      tilecount: 8,
      tiles: [{
        id: 1,
        properties: [
          { name: "slopeX0", type: "float", value: 0 },
          { name: "slopeY0", type: "float", value: 1 },
          { name: "slopeX1", type: "float", value: 1 },
          { name: "slopeY1", type: "float", value: 0 },
        ],
      }, {
        id: 2,
        properties: [
          { name: "oneWayPlatform", type: "bool", value: true },
        ],
      }],
    }],
    layers: [
      { type: "tilelayer", name: "ground", width: 3, height: 2, data: [1, 0, 2, 5, 1, 0] },
      {
        type: "tilelayer",
        name: "walls",
        width: 3,
        height: 2,
        properties: [{ name: "collision", type: "bool", value: true }],
        data: [0, 3, 0, 0, 0, 4],
      },
      { type: "objectgroup", name: "spawn-points", objects: [] },
    ],
  }, { origin: { x: -8, y: 4 } });

  deepEqual(imported.usedGids, [1, 2, 3, 4, 5]);
  deepEqual(imported.layerNames, ["ground", "walls"]);
  deepEqual(imported.tilemap, {
    tileWidth: 16,
    tileHeight: 16,
    origin: { x: -8, y: 4 },
    tiles: {
      "1": { frame: "terrain.0" },
      "2": { frame: "terrain.1", slope: { x0: 0, y0: 1, x1: 1, y1: 0 } },
      "3": { frame: "terrain.2", oneWayPlatform: true },
      "4": { frame: "terrain.3" },
      "5": { frame: "terrain.4" },
    },
    layers: [
      { name: "ground", columns: 3, rows: 2, collision: false, data: [1, 0, 2, 5, 1, 0] },
      { name: "walls", columns: 3, rows: 2, collision: true, data: [0, 3, 0, 0, 0, 4] },
    ],
  });
  deepEqual(imported.atlas.frames?.["terrain.0"], {
    texture: "terrain",
    uv: { u0: 0, v0: 0, u1: 0.25, v1: 0.5 },
    size: { width: 16, height: 16 },
  });
  deepEqual(imported.atlas.frames?.["terrain.4"], {
    texture: "terrain",
    uv: { u0: 0, v0: 0.5, u1: 0.25, v1: 1 },
    size: { width: 16, height: 16 },
  });
});

test("importTiledTilemap rejects invalid tile slope metadata", () => {
  rejectsWithMessage(
    () => importTiledTilemap({
      orientation: "orthogonal",
      width: 1,
      height: 1,
      tilewidth: 16,
      tileheight: 16,
      tilesets: [{
        firstgid: 1,
        name: "terrain",
        imagewidth: 16,
        imageheight: 16,
        tilewidth: 16,
        tileheight: 16,
        columns: 1,
        tilecount: 1,
        tiles: [{
          id: 0,
          properties: [
            { name: "slopeX0", type: "float", value: 0.5 },
            { name: "slopeY0", type: "float", value: 1 },
            { name: "slopeX1", type: "float", value: 0.5 },
            { name: "slopeY1", type: "float", value: 0 },
          ],
        }],
      }],
      layers: [{ type: "tilelayer", width: 1, height: 1, data: [1] }],
    }),
    "Invalid asset pipeline metadata: kind=asset-pipeline path='assetPipeline.tiled.tilesets.0.tiles.0.properties.slopeX1' detail='must differ from slopeX0'.",
  );
});

test("importTiledTilemap rejects tiles that combine slope and one-way platform metadata", () => {
  rejectsWithMessage(
    () => importTiledTilemap({
      orientation: "orthogonal",
      width: 1,
      height: 1,
      tilewidth: 16,
      tileheight: 16,
      tilesets: [{
        firstgid: 1,
        name: "terrain",
        imagewidth: 16,
        imageheight: 16,
        tilewidth: 16,
        tileheight: 16,
        columns: 1,
        tilecount: 1,
        tiles: [{
          id: 0,
          properties: [
            { name: "slopeX0", type: "float", value: 0 },
            { name: "slopeY0", type: "float", value: 1 },
            { name: "slopeX1", type: "float", value: 1 },
            { name: "slopeY1", type: "float", value: 0 },
            { name: "oneWayPlatform", type: "bool", value: true },
          ],
        }],
      }],
      layers: [{ type: "tilelayer", width: 1, height: 1, data: [1] }],
    }),
    "Invalid asset pipeline metadata: kind=asset-pipeline path='assetPipeline.tiled.tilesets.0.tiles' detail='tile id 0 cannot define both slope and oneWayPlatform'.",
  );
});

test("importTiledGameSpec supports frame and texture callbacks", () => {
  const gameSpec = importTiledGameSpec({
    orientation: "orthogonal",
    width: 1,
    height: 1,
    tilewidth: 8,
    tileheight: 8,
    tilesets: [{
      firstgid: 10,
      name: "terrain",
      imagewidth: 16,
      imageheight: 8,
      tilewidth: 8,
      tileheight: 8,
      columns: 2,
      tilecount: 2,
    }],
    layers: [{ type: "tilelayer", name: "collision", width: 1, height: 1, data: [11] }],
  }, {
    collisionLayerNames: ["collision"],
    frameNameForGid: ({ tilesetName, localId }) => `tiles.${tilesetName}.${localId}`,
    texture: ({ tilesetName }) => `${tilesetName}-atlas`,
  });

  deepEqual(gameSpec.tilemap?.tiles, {
    "11": { frame: "tiles.terrain.1" },
  });
  deepEqual(gameSpec.tilemap?.layers?.[0], {
    name: "collision",
    columns: 1,
    rows: 1,
    collision: true,
    data: [11],
  });
  deepEqual(gameSpec.atlas?.frames?.["tiles.terrain.1"], {
    texture: "terrain-atlas",
    uv: { u0: 0.5, v0: 0, u1: 1, v1: 1 },
    size: { width: 8, height: 8 },
  });
});

test("importTiledTilemap rejects flipped gids", () => {
  rejectsWithMessage(
    () => importTiledTilemap({
      orientation: "orthogonal",
      width: 1,
      height: 1,
      tilewidth: 16,
      tileheight: 16,
      tilesets: [{
        firstgid: 1,
        name: "terrain",
        imagewidth: 16,
        imageheight: 16,
        tilewidth: 16,
        tileheight: 16,
        columns: 1,
        tilecount: 1,
      }],
      layers: [{ type: "tilelayer", width: 1, height: 1, data: [0x80000001] }],
    }),
    "Invalid asset pipeline metadata: kind=asset-pipeline path='assetPipeline.tiled.layers.0.data.0' detail='flipped/rotated Tiled gids are not supported'.",
  );
});

test("importTiledTilemap rejects unresolved external tilesets", () => {
  rejectsWithMessage(
    () => importTiledTilemap({
      orientation: "orthogonal",
      width: 1,
      height: 1,
      tilewidth: 16,
      tileheight: 16,
      tilesets: [{ firstgid: 1, source: "terrain.tsx" }],
      layers: [{ type: "tilelayer", width: 1, height: 1, data: [1] }],
    }),
    "Invalid asset pipeline metadata: kind=asset-pipeline path='assetPipeline.tiled.tilesets.0.source' detail='external Tiled tileset terrain.tsx must be provided in options.externalTilesets'.",
  );
});

test("importTiledTilemap imports preloaded external Tiled tilesets", () => {
  const imported = importTiledTilemap({
    orientation: "orthogonal",
    width: 2,
    height: 1,
    tilewidth: 16,
    tileheight: 16,
    tilesets: [{ firstgid: 10, source: "terrain.tsx" }],
    layers: [{ type: "tilelayer", width: 2, height: 1, data: [10, 11] }],
  }, {
    externalTilesets: {
      "terrain.tsx": {
        name: "terrain",
        image: "terrain.png",
        imagewidth: 32,
        imageheight: 16,
        tilewidth: 16,
        tileheight: 16,
        columns: 2,
        tilecount: 2,
        tiles: [{
          id: 1,
          properties: [{ name: "oneWayPlatform", type: "bool", value: true }],
        }],
      },
    },
  });

  deepEqual(imported.usedGids, [10, 11]);
  deepEqual(imported.tilemap.tiles, {
    "10": { frame: "terrain.0" },
    "11": { frame: "terrain.1", oneWayPlatform: true },
  });
  deepEqual(imported.atlas.frames?.["terrain.1"], {
    texture: "terrain",
    uv: { u0: 0.5, v0: 0, u1: 1, v1: 1 },
    size: { width: 16, height: 16 },
  });
});

test("importTiledTilemap applies tileset margin/spacing and hidden layer policy", () => {
  const map = {
    orientation: "orthogonal",
    width: 2,
    height: 1,
    tilewidth: 16,
    tileheight: 16,
    tilesets: [{
      firstgid: 1,
      name: "terrain",
      image: "terrain.png",
      imagewidth: 36,
      imageheight: 18,
      tilewidth: 16,
      tileheight: 16,
      margin: 1,
      spacing: 2,
      columns: 2,
      tilecount: 2,
    }],
    layers: [
      { type: "tilelayer", name: "ground", width: 2, height: 1, data: [1, 2] },
      { type: "tilelayer", name: "secret", visible: false, width: 2, height: 1, data: [2, 1] },
    ],
  };

  const skipped = importTiledTilemap(map);
  const included = importTiledTilemap(map, { includeHiddenLayers: true, collisionLayerNames: ["secret"] });

  deepEqual(skipped.layerNames, ["ground"]);
  deepEqual(included.layerNames, ["ground", "secret"]);
  deepEqual(included.tilemap.layers?.[1], {
    name: "secret",
    columns: 2,
    rows: 1,
    collision: true,
    data: [2, 1],
  });
  deepEqual(included.atlas.frames?.["terrain.1"], {
    texture: "terrain",
    uv: { u0: 19 / 36, v0: 1 / 18, u1: 35 / 36, v1: 17 / 18 },
    size: { width: 16, height: 16 },
  });
});

test("importTiledTilemap supports uncompressed base64 tile layer data", () => {
  const imported = importTiledTilemap({
    orientation: "orthogonal",
    width: 2,
    height: 1,
    tilewidth: 16,
    tileheight: 16,
    tilesets: [{
      firstgid: 1,
      name: "terrain",
      imagewidth: 32,
      imageheight: 16,
      tilewidth: 16,
      tileheight: 16,
      columns: 2,
      tilecount: 2,
    }],
    layers: [{
      type: "tilelayer",
      width: 2,
      height: 1,
      encoding: "base64",
      data: "AQAAAAIAAAA=",
    }],
  });

  deepEqual(imported.usedGids, [1, 2]);
  deepEqual(imported.tilemap.layers?.[0]?.data, [1, 2]);
  deepEqual(imported.tilemap.tiles, {
    "1": { frame: "terrain.0" },
    "2": { frame: "terrain.1" },
  });
});

test("importTiledTilemap rejects compressed base64 tile layer data", () => {
  rejectsWithMessage(
    () => importTiledTilemap({
      orientation: "orthogonal",
      width: 1,
      height: 1,
      tilewidth: 16,
      tileheight: 16,
      tilesets: [{
        firstgid: 1,
        name: "terrain",
        imagewidth: 16,
        imageheight: 16,
        tilewidth: 16,
        tileheight: 16,
        columns: 1,
        tilecount: 1,
      }],
      layers: [{ type: "tilelayer", width: 1, height: 1, encoding: "base64", compression: "zlib", data: "AQAAAA==" }],
    }),
    "Invalid asset pipeline metadata: kind=asset-pipeline path='assetPipeline.tiled.layers.0.compression' detail='compressed Tiled layer data requires options.decodeCompressedLayerData'.",
  );
});

test("importTiledTilemap supports compressed base64 data through an explicit decoder hook", () => {
  const imported = importTiledTilemap({
    orientation: "orthogonal",
    width: 2,
    height: 1,
    tilewidth: 16,
    tileheight: 16,
    tilesets: [{
      firstgid: 1,
      name: "terrain",
      imagewidth: 32,
      imageheight: 16,
      tilewidth: 16,
      tileheight: 16,
      columns: 2,
      tilecount: 2,
    }],
    layers: [{
      type: "tilelayer",
      width: 2,
      height: 1,
      encoding: "base64",
      compression: "zlib",
      data: compressedTiledLayerData([1, 2]),
    }],
  }, {
    decodeCompressedLayerData: (bytes, context) => {
      equal(context.compression, "zlib");
      equal(context.expectedByteLength, 8);
      return bytes;
    },
  });

  deepEqual(imported.usedGids, [1, 2]);
  deepEqual(imported.tilemap.layers?.[0]?.data, [1, 2]);
});
