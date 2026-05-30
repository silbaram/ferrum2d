import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  importLDtkGameSpec,
  importLDtkTilemap,
} from "../src/assetPipeline.js";
import { rejectsWithMessage } from "./assetPipeline.shared.js";

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
          data: "{\"oneWayPlatform\":true,\"floor\":\"ground\",\"elevation\":0,\"height\":8,\"kind\":\"bridge\",\"blocksMovement\":false,\"blocksProjectile\":false,\"blocksVision\":false,\"occluderHeight\":6,\"bridgePortal\":{\"lowerFloor\":\"ground\",\"upperFloor\":\"bridge\",\"upperElevation\":12,\"navigationCost\":2}}",
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
        {
          __identifier: "actors",
          __type: "Entities",
          __gridSize: 16,
          __pxTotalOffsetX: 1,
          __pxTotalOffsetY: 2,
          entityInstances: [{
            __identifier: "EnemySpawn",
            iid: "enemy-1",
            defUid: 7,
            px: [16, 8],
            __grid: [1, 0],
            width: 12,
            height: 10,
            fieldInstances: [{
              __identifier: "enemy",
              __type: "LocalEnum.Enemy",
              __value: "grunt",
            }, {
              __identifier: "wave",
              __type: "Int",
              __value: 2,
            }],
          }],
        },
      ],
    }],
  }, { collisionLayerNames: ["walls"], origin: { x: -8, y: 4 } });

  deepEqual(imported.usedTileIds, [1, 2, 3, 4]);
  deepEqual(imported.layerNames, ["ground", "walls"]);
  deepEqual(imported.entities, [{
    identifier: "EnemySpawn",
    iid: "enemy-1",
    defUid: 7,
    layerName: "actors",
    layerIndex: 2,
    x: 9,
    y: 14,
    gridX: 1,
    gridY: 0,
    width: 12,
    height: 10,
    fields: {
      enemy: "grunt",
      wave: 2,
    },
    fieldTypes: {
      enemy: "LocalEnum.Enemy",
      wave: "Int",
    },
  }]);
  deepEqual(imported.tilesetNames, ["terrain"]);
  equal(imported.levelIdentifier, "Level_0");
  equal(imported.levelIid, "level-iid");
  deepEqual(imported.tilemap, {
    tileWidth: 16,
    tileHeight: 16,
    origin: { x: -8, y: 4 },
    tiles: {
      "1": { frame: "terrain.0" },
      "2": {
        frame: "terrain.1",
        floor: "ground",
        elevation: 0,
        height: 8,
        kind: "bridge",
        bridgePortal: {
          lowerFloor: "ground",
          upperFloor: "bridge",
          upperElevation: 12,
          navigationCost: 2,
        },
        blocksMovement: false,
        blocksProjectile: false,
        blocksVision: false,
        occluderHeight: 6,
        oneWayPlatform: true,
      },
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

test("importLDtkTilemap derives tile ids from padded source coordinates", () => {
  const imported = importLDtkTilemap({
    defs: {
      tilesets: [{
        uid: 1,
        identifier: "terrain",
        relPath: "terrain.png",
        pxWid: 36,
        pxHei: 18,
        tileGridSize: 16,
        padding: 1,
        spacing: 2,
      }],
    },
    levels: [{
      identifier: "Level_0",
      pxWid: 32,
      pxHei: 16,
      layerInstances: [{
        __identifier: "ground",
        __type: "Tiles",
        __cWid: 2,
        __cHei: 1,
        __gridSize: 16,
        __tilesetDefUid: 1,
        gridTiles: [
          { px: [16, 0], src: [19, 1], f: 0 },
        ],
      }],
    }],
  });

  deepEqual(imported.usedTileIds, [1]);
  deepEqual(imported.tilemap.layers?.[0]?.data, [0, 1]);
  deepEqual(imported.tilemap.tiles, {
    "1": { frame: "terrain.1" },
  });
  deepEqual(imported.atlas.frames?.["terrain.1"], {
    texture: "terrain",
    uv: { u0: 19 / 36, v0: 1 / 18, u1: 35 / 36, v1: 17 / 18 },
    size: { width: 16, height: 16 },
  });
});

test("importLDtkTilemap rejects duplicate LDtk entity fields", () => {
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
          gridTiles: [{ px: [0, 0], src: [0, 0], t: 0, f: 0 }],
        }, {
          __identifier: "actors",
          __type: "Entities",
          __gridSize: 16,
          entityInstances: [{
            __identifier: "Spawn",
            px: [0, 0],
            width: 16,
            height: 16,
            fieldInstances: [{
              __identifier: "kind",
              __type: "String",
              __value: "a",
            }, {
              __identifier: "kind",
              __type: "String",
              __value: "b",
            }],
          }],
        }],
      }],
    }),
    "Invalid asset pipeline metadata: kind=asset-pipeline path='assetPipeline.ldtk.levels.0.layerInstances.1.entityInstances.0.fieldInstances.1.__identifier' detail='duplicate LDtk entity field \\'kind\\''.",
  );
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
