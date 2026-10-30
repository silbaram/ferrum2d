import { encodePngRgba } from "../../scripts/tools/pack-textures.mjs";

/** Repack the same stable local tile IDs into a wider atlas; change red to blue. */
export function tileFixture(kind, updated = false) {
  const width = updated ? 48 : 32,
    height = 16,
    data = new Uint8Array(width * height * 4);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < width; x++) {
      const color =
        x < 16
          ? updated
            ? [20, 70, 220, 255]
            : [220, 30, 20, 255]
          : [30, 220, 50, 255];
      data.set(color, (y * width + x) * 4);
    }
  const png = encodePngRgba(width, height, data);
  const tiled = {
    orientation: "orthogonal",
    width: 2,
    height: 1,
    tilewidth: 16,
    tileheight: 16,
    tilesets: [
      {
        firstgid: updated ? 21 : 1,
        name: "terrain",
        image: "tiles.png",
        imagewidth: width,
        imageheight: height,
        tilewidth: 16,
        tileheight: 16,
        columns: width / 16,
        tilecount: width / 16,
      },
    ],
    layers: [
      {
        type: "tilelayer",
        name: "ground",
        width: 2,
        height: 1,
        data: updated ? [22, 21] : [1, 2],
      },
    ],
  };
  const ldtk = {
    defs: {
      tilesets: [
        {
          uid: 7,
          identifier: "terrain",
          relPath: "tiles.png",
          pxWid: width,
          pxHei: height,
          tileGridSize: 16,
          padding: 0,
          spacing: 0,
        },
      ],
    },
    levels: [
      {
        identifier: "Level_0",
        iid: "level-0",
        pxWid: 32,
        pxHei: 16,
        layerInstances: [
          {
            __identifier: "ground",
            __type: "Tiles",
            __cWid: 2,
            __cHei: 1,
            __gridSize: 16,
            __tilesetDefUid: 7,
            __pxTotalOffsetX: 0,
            __pxTotalOffsetY: 0,
            gridTiles: updated
              ? [
                  { px: [0, 0], src: [16, 0], t: 1, f: 0 },
                  { px: [16, 0], src: [0, 0], t: 0, f: 0 },
                ]
              : [
                  { px: [0, 0], src: [0, 0], t: 0, f: 0 },
                  { px: [16, 0], src: [16, 0], t: 1, f: 0 },
                ],
          },
          {
            __identifier: "actors",
            __type: "Entities",
            __gridSize: 16,
            __pxTotalOffsetX: 0,
            __pxTotalOffsetY: 0,
            entityInstances: [
              {
                __identifier: "Spawn",
                iid: "spawn-1",
                px: [8, 8],
                __grid: [0, 0],
                width: 8,
                height: 8,
                fieldInstances: [],
              },
            ],
          },
        ],
      },
    ],
  };
  return { png, json: kind === "tiled" ? tiled : ldtk };
}

/** Target is initially second; reorder definitions on update without changing its identity. */
export function multiTileFixture(kind, updated = false) {
  const f = tileFixture(kind, updated);
  if (kind === "tiled") {
    const target = f.json.tilesets[0],
      other = {
        ...target,
        name: "decor",
        image: "decor.png",
        firstgid: updated ? 200 : 100,
        imagewidth: 16,
        imageheight: 16,
        columns: 1,
        tilecount: 1,
      };
    f.json.tilesets = updated ? [target, other] : [other, target];
    f.json.width = f.json.layers[0].width = 3;
    f.json.layers[0].data = updated ? [22, 200, 21] : [1, 100, 2];
  } else {
    const target = f.json.defs.tilesets[0],
      other = {
        ...target,
        uid: 8,
        identifier: "decor",
        relPath: "decor.png",
        pxWid: 16,
        pxHei: 16,
      };
    f.json.defs.tilesets = updated ? [target, other] : [other, target];
    const layer = structuredClone(f.json.levels[0].layerInstances[0]);
    layer.__identifier = "decor";
    layer.__tilesetDefUid = 8;
    layer.gridTiles = [{ px: [0, 0], src: [0, 0], t: 0, f: 0 }];
    f.json.levels[0].layerInstances.unshift(layer);
  }
  return f;
}

/** Original map is unchanged on TSJ-only update; selected TSJ metadata and PNG change. */
export function externalTileFixture(updated = false) {
  const f = multiTileFixture("tiled", false);
  const target = tileFixture("tiled", updated);
  f.png = target.png;
  f.dependencies = f.json.tilesets.map((set) => {
    const source = `../tiles/${set.name}.tsj`;
    const json = {
      ...(set.name === "terrain" ? target.json.tilesets[0] : set),
    };
    delete json.firstgid;
    json.image = `../images/${json.image}`;
    Object.assign(set, { source });
    const firstgid = set.firstgid;
    for (const key of Object.keys(set)) delete set[key];
    Object.assign(set, { firstgid, source });
    return { source, name: source.split("/").at(-1), json };
  });
  return f;
}


/** Whole-map regression: resize 2x2 -> 3x2 without moving existing grid cells. */
export function tileMapFixture(kind, updated=false) {
  const f=tileFixture(kind,updated),columns=updated?3:2;
  const tiles=updated?[1,0,0,1,0,-1]:[0,1,0,1];
  if(kind==='tiled') {
    const gid=f.json.tilesets[0].firstgid;
    Object.assign(f.json,{width:columns,height:2});
    Object.assign(f.json.layers[0],{width:columns,height:2,data:tiles.map(t=>t<0?0:gid+t)});
  } else {
    Object.assign(f.json.levels[0],{pxWid:columns*16,pxHei:32});
    Object.assign(f.json.levels[0].layerInstances[0],{__cWid:columns,__cHei:2,gridTiles:tiles.flatMap((t,i)=>t<0?[]:[{px:[(i%columns)*16,Math.floor(i/columns)*16],src:[t*16,0],t,f:0}])});
  }
  return f;
}
