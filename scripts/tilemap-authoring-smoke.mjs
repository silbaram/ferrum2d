#!/usr/bin/env node
import {
  applyTileRules,
  bakeAnimatedTileLayer,
  importLDtkTilemap,
  importTiledGameSpec,
  resolveAnimatedTileFrame,
} from "../packages/ferrum-web/dist/index.js";

const source = {
  columns: 3,
  rows: 3,
  data: [
    0, 1, 0,
    1, 1, 1,
    0, 1, 0,
  ],
};

const autotiled = applyTileRules(source, [{
  match: 1,
  neighbors: {
    n: "same",
    e: "same",
    s: "same",
    w: "same",
  },
  output: 7,
}, {
  match: "filled",
  output: 2,
}]);

const animatedFrame = resolveAnimatedTileFrame({
  fps: 4,
  frames: [2, 3, 4, 5],
}, {
  timeSeconds: 0.51,
});

const animated = bakeAnimatedTileLayer({
  columns: 3,
  rows: 3,
  data: autotiled,
}, {
  2: { frames: [2, 3], fps: 2 },
  7: { frames: [{ tile: 7, durationMs: 100 }, { tile: 8, durationMs: 100 }], loop: false },
}, {
  timeSeconds: 0.15,
});

const tiledSpec = importTiledGameSpec({
  orientation: "orthogonal",
  width: 3,
  height: 3,
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
  layers: [
    { type: "tilelayer", name: "ground", width: 3, height: 3, data: source.data },
    { type: "tilelayer", name: "walls", width: 3, height: 3, data: [0, 0, 0, 0, 2, 0, 0, 0, 0] },
  ],
}, {
  collisionLayerNames: ["walls"],
});
const tiledGroundLayer = requiredLayer(tiledSpec, "ground");
const tiledAutotiled = applyTileRules({
  columns: tiledGroundLayer.columns,
  rows: tiledGroundLayer.rows,
  data: tiledGroundLayer.data,
}, [{
  match: "filled",
  neighbors: { n: "empty" },
  output: 6,
}, {
  match: "filled",
  output: 4,
}]);

const ldtk = importLDtkTilemap({
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
        { px: [0, 0], src: [0, 0], t: 0, f: 0 },
        { px: [16, 0], src: [16, 0], t: 1, f: 0 },
      ],
    }, {
      __identifier: "actors",
      __type: "Entities",
      __gridSize: 16,
      entityInstances: [{
        __identifier: "Spawn",
        px: [16, 0],
        width: 16,
        height: 16,
        fieldInstances: [{
          __identifier: "role",
          __type: "String",
          __value: "player",
        }],
      }],
    }],
  }],
});

assertEqual(autotiled.join(","), "0,2,0,2,7,2,0,2,0", "autotile output mismatch");
assertEqual(animatedFrame, 4, "animated frame selection mismatch");
assertEqual(animated.join(","), "0,2,0,2,8,2,0,2,0", "animated tile bake mismatch");
assertEqual(tiledSpec.tilemap?.layers?.[1]?.collision, true, "Tiled collision layer fixture mismatch");
assertEqual(tiledAutotiled.join(","), "0,6,0,6,4,6,0,4,0", "Tiled authoring fixture mismatch");
assertEqual(ldtk.tilemap.layers?.[0]?.data.join(","), "1,2", "LDtk tile layer fixture mismatch");
assertEqual(ldtk.entities[0]?.fields.role, "player", "LDtk entity fixture mismatch");

console.log("tilemap authoring smoke ok");
console.log(JSON.stringify({
  autotiled,
  animatedFrame,
  animated,
  tiled: {
    layers: tiledSpec.tilemap?.layers?.map((layer) => ({ name: layer.name, collision: layer.collision })),
    authored: tiledAutotiled,
  },
  ldtk: {
    layers: ldtk.layerNames,
    entities: ldtk.entities.map((entity) => entity.identifier),
  },
}, null, 2));

function requiredLayer(gameSpec, name) {
  const layer = gameSpec.tilemap?.layers?.find((entry) => entry.name === name);
  if (!layer) {
    throw new Error(`Missing tilemap layer fixture: ${name}`);
  }
  return layer;
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}
