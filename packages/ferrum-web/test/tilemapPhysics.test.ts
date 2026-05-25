import { equal, deepEqual, ok } from "node:assert/strict";
import { test } from "node:test";
import { extractTilemapBoundaryChains } from "../src/tilemapPhysics.js";
import type { ResolvedShooterTilemap } from "../src/gameSpec.js";

test("extractTilemapBoundaryChains converts collision tile runs to Physics Spec chain bodies", () => {
  const tilemap: ResolvedShooterTilemap = {
    tiles: [tile(1)],
    layers: [{
      index: 0,
      name: "terrain",
      columns: 2,
      rows: 1,
      tileWidth: 10,
      tileHeight: 10,
      originX: 0,
      originY: 0,
      collision: true,
      collisionOnly: false,
      data: [1, 1],
    }],
  };

  const extracted = extractTilemapBoundaryChains(tilemap, {
    physicsLayer: "world",
    material: "stone",
  });

  equal(extracted.chainCount, 1);
  equal(extracted.segmentCount, 6);
  const chain = extracted.chains[0];
  equal(chain.bodyId, "tilemapBoundary.0.0");
  equal(chain.collider.shape, "chain");
  equal(chain.collider.loop, true);
  equal(chain.collider.layer, "world");
  equal(chain.collider.material, "stone");
  deepEqual(chain.collider.vertices, [[0, 0], [10, 0], [20, 0], [20, 10], [10, 10], [0, 10]]);
  equal(extracted.bodies["tilemapBoundary.0.0"]?.type, "static");
  equal(extracted.bodies["tilemapBoundary.0.0"]?.collider?.shape, "chain");
});

test("extractTilemapBoundaryChains skips non-solid special tile metadata and supports collisionOnly layers", () => {
  const tilemap: ResolvedShooterTilemap = {
    tiles: [
      tile(1, { slope: { x0: 0, y0: 1, x1: 1, y1: 0 } }),
      tile(2, { oneWayPlatform: true }),
      tile(3),
    ],
    layers: [
      {
        index: 0,
        name: "metadata",
        columns: 3,
        rows: 1,
        tileWidth: 8,
        tileHeight: 8,
        originX: 0,
        originY: 0,
        collision: true,
        collisionOnly: false,
        data: [1, 2, 3],
      },
      {
        index: 1,
        name: "intgrid",
        columns: 1,
        rows: 1,
        tileWidth: 8,
        tileHeight: 8,
        originX: 40,
        originY: 0,
        collision: true,
        collisionOnly: true,
        data: [99],
      },
    ],
  };

  const visual = extractTilemapBoundaryChains(tilemap, { layerIndex: 0 });
  equal(visual.chainCount, 1);
  deepEqual(visual.chains[0].collider.vertices[0], [16, 0]);

  const collisionOnly = extractTilemapBoundaryChains(tilemap, { layerIndex: 1 });
  equal(collisionOnly.chainCount, 1);
  deepEqual(collisionOnly.chains[0].collider.vertices[0], [40, 0]);
});

test("extractTilemapBoundaryChains splits long chains to runtime vertex limits", () => {
  const data = Array.from({ length: 70 }, () => 1);
  const tilemap: ResolvedShooterTilemap = {
    tiles: [tile(1)],
    layers: [{
      index: 0,
      name: "long",
      columns: 70,
      rows: 1,
      tileWidth: 1,
      tileHeight: 1,
      originX: 0,
      originY: 0,
      collision: true,
      collisionOnly: false,
      data,
    }],
  };

  const extracted = extractTilemapBoundaryChains(tilemap);

  ok(extracted.chainCount > 1);
  ok(extracted.chains.every((chain) => chain.collider.vertices.length <= 64));
});

function tile(
  id: number,
  options: Partial<Pick<ResolvedShooterTilemap["tiles"][number], "slope" | "oneWayPlatform">> = {},
): ResolvedShooterTilemap["tiles"][number] {
  return {
    id,
    frame: {
      name: `tile-${id}`,
      texture: "terrain",
      width: 8,
      height: 8,
      u0: 0,
      v0: 0,
      u1: 1,
      v1: 1,
    },
    color: [1, 1, 1, 1],
    ...options,
  };
}
