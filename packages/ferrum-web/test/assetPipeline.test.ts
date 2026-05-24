import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  importAsepriteAtlas,
  importAsepriteAtlasFrames,
  importLDtkGameSpec,
  importLDtkTilemap,
  importTiledGameSpec,
  importTiledTilemap,
} from "../src/assetPipeline.js";

function rejectsWithMessage(run: () => unknown, expected: string): void {
  try {
    run();
  } catch (error) {
    equal(error instanceof Error ? error.message : String(error), expected);
    return;
  }
  throw new Error("Expected function to throw.");
}

test("importAsepriteAtlas converts hash frames into Shooter atlas metadata", () => {
  const imported = importAsepriteAtlas({
    frames: {
      "player.idle.0.png": {
        frame: { x: 0, y: 0, w: 16, h: 24 },
        rotated: false,
        trimmed: false,
        sourceSize: { w: 16, h: 24 },
      },
      "bullet.default.png": {
        frame: { x: 32, y: 8, w: 8, h: 8 },
        rotated: false,
        trimmed: false,
        sourceSize: { w: 8, h: 8 },
      },
    },
    meta: {
      image: "sprites.png",
      size: { w: 64, h: 32 },
    },
  }, { texture: "sprites", frameNamePrefix: "game." });

  deepEqual(imported.frameNames, ["game.player.idle.0", "game.bullet.default"]);
  equal(imported.image, "sprites.png");
  equal(imported.width, 64);
  equal(imported.height, 32);
  deepEqual(imported.atlas.frames?.["game.player.idle.0"], {
    texture: "sprites",
    uv: { u0: 0, v0: 0, u1: 0.25, v1: 0.75 },
    size: { width: 16, height: 24 },
  });
  deepEqual(imported.atlas.frames?.["game.bullet.default"], {
    texture: "sprites",
    uv: { u0: 0.5, v0: 0.25, u1: 0.625, v1: 0.5 },
    size: { width: 8, height: 8 },
  });
});

test("importAsepriteAtlas supports array frames and source-size display mode", () => {
  const frames = importAsepriteAtlasFrames({
    frames: [
      {
        filename: "enemy.png",
        frame: { x: 32, y: 0, w: 16, h: 16 },
        rotated: false,
        trimmed: true,
        sourceSize: { w: 24, h: 20 },
      },
    ],
    meta: {
      image: "sprites.png",
      size: { w: 64, h: 64 },
    },
  }, { texture: 3, sizeSource: "source" });

  deepEqual(frames.enemy, {
    texture: 3,
    uv: { u0: 0.5, v0: 0, u1: 0.75, v1: 0.25 },
    size: { width: 24, height: 20 },
  });
});

test("importAsepriteAtlas rejects rotated frames", () => {
  rejectsWithMessage(
    () => importAsepriteAtlas({
      frames: {
        spin: {
          frame: { x: 0, y: 0, w: 16, h: 16 },
          rotated: true,
        },
      },
      meta: { size: { w: 64, h: 64 } },
    }, { texture: "sprites" }),
    "Invalid asset pipeline metadata: kind=asset-pipeline path='assetPipeline.aseprite.frames.spin' detail='rotated Aseprite frames are not supported'.",
  );
});

test("importAsepriteAtlas rejects duplicate normalized frame names", () => {
  rejectsWithMessage(
    () => importAsepriteAtlas({
      frames: {
        "hero.png": { frame: { x: 0, y: 0, w: 16, h: 16 } },
        "hero.aseprite": { frame: { x: 16, y: 0, w: 16, h: 16 } },
      },
      meta: { size: { w: 64, h: 64 } },
    }, { texture: "sprites" }),
    "Invalid asset pipeline metadata: kind=asset-pipeline path='assetPipeline.aseprite.frames.hero.aseprite' detail='duplicate imported frame name \\'hero\\''.",
  );
});

test("importAsepriteAtlas rejects frames outside atlas bounds", () => {
  rejectsWithMessage(
    () => importAsepriteAtlas({
      frames: {
        wall: { frame: { x: 48, y: 0, w: 32, h: 16 } },
      },
      meta: { size: { w: 64, h: 64 } },
    }, { texture: "sprites" }),
    "Invalid asset pipeline metadata: kind=asset-pipeline path='assetPipeline.aseprite.frames.wall.frame.w' detail='frame exceeds atlas width'.",
  );
});

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
    "Invalid asset pipeline metadata: kind=asset-pipeline path='assetPipeline.tiled.tilesets.0.source' detail='external Tiled tilesets must be resolved before import'.",
  );
});

test("importTiledTilemap rejects encoded tile layer data", () => {
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
      layers: [{ type: "tilelayer", width: 1, height: 1, encoding: "base64", data: "AAAA" }],
    }),
    "Invalid asset pipeline metadata: kind=asset-pipeline path='assetPipeline.tiled.layers.0.data' detail='must be an array'.",
  );
});

test("importLDtkTilemap converts embedded level tile layers and atlas frames", () => {
  const imported = importLDtkTilemap({
    defs: {
      tilesets: [{
        uid: 1,
        identifier: "terrain",
        relPath: "terrain.png",
        pxWid: 64,
        pxHei: 32,
        tileGridSize: 16,
        spacing: 0,
        padding: 0,
        customData: [{
          tileId: 1,
          data: "{\"oneWayPlatform\":true}",
        }, {
          tileId: 2,
          data: "{\"slope\":{\"x0\":0,\"y0\":1,\"x1\":1,\"y1\":0}}",
        }],
      }],
    },
    levels: [{
      identifier: "Level_0",
      iid: "level-iid",
      pxWid: 48,
      pxHei: 32,
      layerInstances: [
        {
          __identifier: "ground",
          __type: "Tiles",
          __cWid: 3,
          __cHei: 2,
          __gridSize: 16,
          __tilesetDefUid: 1,
          __pxTotalOffsetX: 0,
          __pxTotalOffsetY: 0,
          gridTiles: [
            { px: [0, 0], src: [0, 0], t: 0, f: 0 },
            { px: [32, 0], src: [16, 0], t: 1, f: 0 },
            { px: [0, 16], src: [0, 16], t: 4, f: 0 },
          ],
        },
        {
          __identifier: "walls",
          __type: "AutoLayer",
          __cWid: 3,
          __cHei: 2,
          __gridSize: 16,
          __tilesetDefUid: 1,
          __pxTotalOffsetX: 2,
          __pxTotalOffsetY: 4,
          autoLayerTiles: [
            { px: [16, 0], src: [32, 0], t: 2, f: 0 },
          ],
        },
        { __identifier: "actors", __type: "Entities", entityInstances: [] },
      ],
    }],
  }, { collisionLayerNames: ["walls"], origin: { x: -8, y: 4 } });

  deepEqual(imported.usedTileIds, [1, 2, 3, 4]);
  deepEqual(imported.layerNames, ["ground", "walls"]);
  deepEqual(imported.tilesetNames, ["terrain"]);
  equal(imported.levelIdentifier, "Level_0");
  equal(imported.levelIid, "level-iid");
  deepEqual(imported.tilemap, {
    tileWidth: 16,
    tileHeight: 16,
    origin: { x: -8, y: 4 },
    tiles: {
      "1": { frame: "terrain.0" },
      "2": { frame: "terrain.1", oneWayPlatform: true },
      "3": { frame: "terrain.4" },
      "4": { frame: "terrain.2", slope: { x0: 0, y0: 1, x1: 1, y1: 0 } },
    },
    layers: [
      {
        name: "ground",
        columns: 3,
        rows: 2,
        tileWidth: 16,
        tileHeight: 16,
        origin: { x: -8, y: 4 },
        collision: false,
        data: [1, 0, 2, 3, 0, 0],
      },
      {
        name: "walls",
        columns: 3,
        rows: 2,
        tileWidth: 16,
        tileHeight: 16,
        origin: { x: -6, y: 8 },
        collision: true,
        data: [0, 4, 0, 0, 0, 0],
      },
    ],
  });
  deepEqual(imported.atlas.frames?.["terrain.4"], {
    texture: "terrain",
    uv: { u0: 0, v0: 0.5, u1: 0.25, v1: 1 },
    size: { width: 16, height: 16 },
  });
  deepEqual(imported.atlas.frames?.["terrain.2"], {
    texture: "terrain",
    uv: { u0: 0.5, v0: 0, u1: 0.75, v1: 0.5 },
    size: { width: 16, height: 16 },
  });
});

test("importLDtkTilemap rejects invalid tile slope metadata", () => {
  rejectsWithMessage(
    () => importLDtkTilemap({
      defs: {
        tilesets: [{
          uid: 1,
          identifier: "terrain",
          pxWid: 16,
          pxHei: 16,
          tileGridSize: 16,
          customData: [{
            tileId: 0,
            data: "{\"slope\":{\"x0\":0,\"y0\":1.2,\"x1\":1,\"y1\":0}}",
          }],
        }],
      },
      levels: [{
        identifier: "Level_0",
        pxWid: 16,
        pxHei: 16,
        layerInstances: [{
          __identifier: "ground",
          __type: "Tiles",
          __cWid: 1,
          __cHei: 1,
          __gridSize: 16,
          __tilesetDefUid: 1,
          gridTiles: [{ px: [0, 0], src: [0, 0], t: 0, f: 0 }],
        }],
      }],
    }),
    "Invalid asset pipeline metadata: kind=asset-pipeline path='assetPipeline.ldtk.defs.tilesets.0.customData.0.data.slope.y0' detail='must be a normalized number from 0 to 1'.",
  );
});

test("importLDtkTilemap rejects invalid one-way tile metadata", () => {
  rejectsWithMessage(
    () => importLDtkTilemap({
      defs: {
        tilesets: [{
          uid: 1,
          identifier: "terrain",
          pxWid: 16,
          pxHei: 16,
          tileGridSize: 16,
          customData: [{
            tileId: 0,
            data: "{\"oneWayPlatform\":\"yes\"}",
          }],
        }],
      },
      levels: [{
        identifier: "Level_0",
        pxWid: 16,
        pxHei: 16,
        layerInstances: [{
          __identifier: "ground",
          __type: "Tiles",
          __cWid: 1,
          __cHei: 1,
          __gridSize: 16,
          __tilesetDefUid: 1,
          gridTiles: [{ px: [0, 0], src: [0, 0], t: 0, f: 0 }],
        }],
      }],
    }),
    "Invalid asset pipeline metadata: kind=asset-pipeline path='assetPipeline.ldtk.defs.tilesets.0.customData.0.data.oneWayPlatform' detail='must be a boolean'.",
  );
});

test("importLDtkGameSpec supports level selection and frame callbacks", () => {
  const gameSpec = importLDtkGameSpec({
    defs: {
      tilesets: [{
        uid: 9,
        identifier: "decor",
        relPath: "decor.png",
        pxWid: 16,
        pxHei: 16,
        tileGridSize: 8,
      }],
    },
    levels: [
      { identifier: "Ignored", pxWid: 8, pxHei: 8, layerInstances: [] },
      {
        identifier: "Selected",
        pxWid: 8,
        pxHei: 8,
        layerInstances: [{
          __identifier: "decor",
          __type: "Tiles",
          __cWid: 1,
          __cHei: 1,
          __gridSize: 8,
          __tilesetDefUid: 9,
          gridTiles: [{ px: [0, 0], src: [8, 0], t: 1, f: 0 }],
        }],
      },
    ],
  }, {
    levelIdentifier: "Selected",
    frameNameForTile: ({ tilesetIdentifier, gameTileId }) => `ldtk.${tilesetIdentifier}.${gameTileId}`,
    texture: ({ relPath }) => relPath ?? "decor",
  });

  deepEqual(gameSpec.tilemap?.tiles, {
    "1": { frame: "ldtk.decor.1" },
  });
  deepEqual(gameSpec.atlas?.frames?.["ldtk.decor.1"], {
    texture: "decor.png",
    uv: { u0: 0.5, v0: 0, u1: 1, v1: 0.5 },
    size: { width: 8, height: 8 },
  });
});

test("importLDtkTilemap rejects flipped tiles", () => {
  rejectsWithMessage(
    () => importLDtkTilemap({
      defs: {
        tilesets: [{
          uid: 1,
          identifier: "terrain",
          pxWid: 16,
          pxHei: 16,
          tileGridSize: 16,
        }],
      },
      levels: [{
        identifier: "Level_0",
        pxWid: 16,
        pxHei: 16,
        layerInstances: [{
          __identifier: "ground",
          __type: "Tiles",
          __cWid: 1,
          __cHei: 1,
          __gridSize: 16,
          __tilesetDefUid: 1,
          gridTiles: [{ px: [0, 0], src: [0, 0], t: 0, f: 1 }],
        }],
      }],
    }),
    "Invalid asset pipeline metadata: kind=asset-pipeline path='assetPipeline.ldtk.levels.0.layerInstances.0.gridTiles.0.f' detail='flipped LDtk tiles are not supported'.",
  );
});

test("importLDtkTilemap rejects stacked tiles in one grid cell", () => {
  rejectsWithMessage(
    () => importLDtkTilemap({
      defs: {
        tilesets: [{
          uid: 1,
          identifier: "terrain",
          pxWid: 32,
          pxHei: 16,
          tileGridSize: 16,
        }],
      },
      levels: [{
        identifier: "Level_0",
        pxWid: 16,
        pxHei: 16,
        layerInstances: [{
          __identifier: "ground",
          __type: "Tiles",
          __cWid: 1,
          __cHei: 1,
          __gridSize: 16,
          __tilesetDefUid: 1,
          gridTiles: [
            { px: [0, 0], src: [0, 0], t: 0, f: 0 },
            { px: [0, 0], src: [16, 0], t: 1, f: 0 },
          ],
        }],
      }],
    }),
    "Invalid asset pipeline metadata: kind=asset-pipeline path='assetPipeline.ldtk.levels.0.layerInstances.0.gridTiles.1' detail='multiple LDtk tiles in the same grid cell are not supported'.",
  );
});

test("importLDtkTilemap rejects unresolved external levels", () => {
  rejectsWithMessage(
    () => importLDtkTilemap({
      defs: {
        tilesets: [{
          uid: 1,
          identifier: "terrain",
          pxWid: 16,
          pxHei: 16,
          tileGridSize: 16,
        }],
      },
      levels: [{
        identifier: "Level_0",
        pxWid: 16,
        pxHei: 16,
        externalRelPath: "Level_0.ldtkl",
        layerInstances: null,
      }],
    }),
    "Invalid asset pipeline metadata: kind=asset-pipeline path='assetPipeline.ldtk.levels.0.layerInstances' detail='external LDtk level Level_0.ldtkl must be provided in options.externalLevels'.",
  );
});

test("importLDtkTilemap imports preloaded external LDtk levels", () => {
  const imported = importLDtkTilemap({
    defs: {
      tilesets: [{
        uid: 1,
        identifier: "terrain",
        relPath: "terrain.png",
        pxWid: 16,
        pxHei: 16,
        tileGridSize: 16,
      }],
    },
    levels: [{
      identifier: "Level_0",
      iid: "level-iid",
      pxWid: 16,
      pxHei: 16,
      externalRelPath: "levels/Level_0.ldtkl",
      layerInstances: null,
    }],
  }, {
    externalLevels: {
      "levels/Level_0.ldtkl": {
        layerInstances: [{
          __identifier: "ground",
          __type: "Tiles",
          __cWid: 1,
          __cHei: 1,
          __gridSize: 16,
          __tilesetDefUid: 1,
          gridTiles: [{ px: [0, 0], src: [0, 0], t: 0, f: 0 }],
        }],
      },
    },
  });

  deepEqual(imported.usedTileIds, [1]);
  deepEqual(imported.layerNames, ["ground"]);
  deepEqual(imported.tilesetNames, ["terrain"]);
  equal(imported.levelIdentifier, "Level_0");
  equal(imported.levelIid, "level-iid");
  deepEqual(imported.tilemap.layers?.[0], {
    name: "ground",
    columns: 1,
    rows: 1,
    tileWidth: 16,
    tileHeight: 16,
    origin: { x: 0, y: 0 },
    collision: false,
    data: [1],
  });
  deepEqual(imported.tilemap.tiles, {
    "1": { frame: "terrain.0" },
  });
  deepEqual(imported.atlas.frames?.["terrain.0"], {
    texture: "terrain",
    uv: { u0: 0, v0: 0, u1: 1, v1: 1 },
    size: { width: 16, height: 16 },
  });
});

test("importLDtkTilemap converts raw IntGrid collision layers to collision-only tilemap layers", () => {
  const imported = importLDtkTilemap({
    defs: {
      tilesets: [{
        uid: 1,
        identifier: "terrain",
        pxWid: 16,
        pxHei: 16,
        tileGridSize: 16,
      }],
    },
    levels: [{
      identifier: "Level_0",
      pxWid: 32,
      pxHei: 16,
      layerInstances: [{
        __identifier: "walls",
        __type: "IntGrid",
        __cWid: 2,
        __cHei: 1,
        __gridSize: 16,
        intGridCsv: [0, 2],
      }],
    }],
  }, { collisionLayerNames: ["walls"], origin: { x: 4, y: 8 } });

  deepEqual(imported.usedTileIds, []);
  deepEqual(imported.atlas.frames, {});
  deepEqual(imported.tilemap.tiles, {});
  deepEqual(imported.tilemap.layers?.[0], {
    name: "walls",
    columns: 2,
    rows: 1,
    tileWidth: 16,
    tileHeight: 16,
    origin: { x: 4, y: 8 },
    collision: true,
    collisionOnly: true,
    data: [0, 4294967295],
  });
});
