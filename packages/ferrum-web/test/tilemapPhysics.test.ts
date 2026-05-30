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

test("extractTilemapBoundaryChains preserves HD-2D tile height metadata on generated bodies", () => {
  const tilemap: ResolvedShooterTilemap = {
    tiles: [
      tile(1, { floor: "ground", elevation: 0, height: 8 }),
      tile(2, { floor: "bridge", elevation: 16, height: 8 }),
    ],
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
      data: [1, 2],
    }],
  };

  const extracted = extractTilemapBoundaryChains(tilemap);

  equal(extracted.chainCount, 2);
  deepEqual(extracted.chains.map((chain) => [chain.floor, chain.elevation, chain.height]), [
    ["ground", 0, 8],
    ["bridge", 16, 8],
  ]);
  equal(extracted.bodies["tilemapBoundary.0.0"]?.floor, "ground");
  equal(extracted.bodies["tilemapBoundary.0.1"]?.floor, "bridge");
});

test("extractTilemapBoundaryChains skips non-solid special tile metadata and supports collisionOnly layers", () => {
  const tilemap: ResolvedShooterTilemap = {
    tiles: [
      tile(1, { slope: { x0: 0, y0: 1, x1: 1, y1: 0 } }),
      tile(2, { oneWayPlatform: true }),
      tile(3, { kind: "bridge", blocksMovement: false }),
      tile(4),
    ],
    layers: [
      {
        index: 0,
        name: "metadata",
        columns: 4,
        rows: 1,
        tileWidth: 8,
        tileHeight: 8,
        originX: 0,
        originY: 0,
        collision: true,
        collisionOnly: false,
        data: [1, 2, 3, 4],
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
  deepEqual(visual.chains[0].collider.vertices[0], [24, 0]);

  const collisionOnly = extractTilemapBoundaryChains(tilemap, { layerIndex: 1 });
  equal(collisionOnly.chainCount, 1);
  deepEqual(collisionOnly.chains[0].collider.vertices[0], [40, 0]);
});

test("extractTilemapBoundaryChains orders disconnected boundary chains deterministically", () => {
  const tilemap: ResolvedShooterTilemap = {
    tiles: [tile(1)],
    layers: [{
      index: 0,
      name: "islands",
      columns: 3,
      rows: 1,
      tileWidth: 10,
      tileHeight: 10,
      originX: 0,
      originY: 0,
      collision: true,
      collisionOnly: false,
      data: [1, 0, 1],
    }],
  };

  const extracted = extractTilemapBoundaryChains(tilemap);

  equal(extracted.chainCount, 2);
  deepEqual(extracted.chains.map((chain) => chain.bodyId), [
    "tilemapBoundary.0.0",
    "tilemapBoundary.0.1",
  ]);
  deepEqual(extracted.chains[0].collider.vertices, [[0, 0], [10, 0], [10, 10], [0, 10]]);
  deepEqual(extracted.chains[1].collider.vertices, [[20, 0], [30, 0], [30, 10], [20, 10]]);
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
  options: Partial<Pick<
    ResolvedShooterTilemap["tiles"][number],
    "floor" | "elevation" | "height" | "kind" | "blocksMovement" | "slope" | "oneWayPlatform"
  >> = {},
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
    floor: "default",
    elevation: 0,
    height: 0,
    kind: "flat",
    blocksMovement: true,
    blocksProjectile: true,
    blocksVision: true,
    occluderHeight: 0,
    ...options,
  };
}
