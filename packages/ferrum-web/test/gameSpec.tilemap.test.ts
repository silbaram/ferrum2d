import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { resolveShooterGameSpec } from "../src/gameSpec.js";

test("resolveShooterGameSpec resolves static tilemap layers", () => {
  const spec = resolveShooterGameSpec({
    atlas: {
      frames: {
        "terrain.floor": {
          texture: "terrain",
          uv: { u0: 0, v0: 0, u1: 0.5, v1: 0.5 },
          size: { width: 16, height: 16 },
        },
        "terrain.trim": {
          texture: 0,
          uv: { u0: 0.5, v0: 0, u1: 1, v1: 0.5 },
          size: { width: 16, height: 16 },
        },
      },
    },
    tilemap: {
      tileWidth: 16,
      tileHeight: 24,
      origin: { x: -8, y: 4 },
      tiles: {
        "2": {
          frame: "terrain.trim",
          color: [0.8, 0.7, 0.6, 0.5],
          slope: { x0: 0, y0: 1, x1: 1, y1: 0 },
        },
        "1": { frame: "terrain.floor", oneWayPlatform: true },
      },
      layers: [
        {
          name: "floor",
          columns: 3,
          rows: 2,
          collision: true,
          data: [1, 0, 2, 2, 1, 0],
        },
      ],
    },
  });

  deepEqual(spec.tilemap, {
    tiles: [
      {
        id: 1,
        frame: {
          name: "terrain.floor",
          texture: "terrain",
          width: 16,
          height: 16,
          u0: 0,
          v0: 0,
          u1: 0.5,
          v1: 0.5,
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
        oneWayPlatform: true,
      },
      {
        id: 2,
        frame: {
          name: "terrain.trim",
          texture: 0,
          width: 16,
          height: 16,
          u0: 0.5,
          v0: 0,
          u1: 1,
          v1: 0.5,
        },
        color: [0.8, 0.7, 0.6, 0.5],
        floor: "default",
        elevation: 0,
        height: 0,
        kind: "flat",
        blocksMovement: true,
        blocksProjectile: true,
        blocksVision: true,
        occluderHeight: 0,
        slope: { x0: 0, y0: 1, x1: 1, y1: 0 },
      },
    ],
    layers: [
      {
        index: 0,
        name: "floor",
        columns: 3,
        rows: 2,
        tileWidth: 16,
        tileHeight: 24,
        originX: -8,
        originY: 4,
        collision: true,
        collisionOnly: false,
        data: [1, 0, 2, 2, 1, 0],
      },
    ],
  });
});

test("resolveShooterGameSpec resolves HD-2D tile metadata", () => {
  const spec = resolveShooterGameSpec({
    atlas: {
      frames: {
        "terrain.bridge": {
          texture: 0,
          uv: { u0: 0, v0: 0, u1: 1, v1: 1 },
          size: { width: 16, height: 16 },
        },
        "terrain.ramp": {
          texture: 0,
          uv: { u0: 0, v0: 0, u1: 1, v1: 1 },
          size: { width: 16, height: 16 },
        },
      },
    },
    tilemap: {
      tiles: {
        "1": {
          frame: "terrain.bridge",
          kind: "bridge",
          floor: "ground",
          height: 8,
          blocksMovement: false,
          blocksProjectile: false,
          blocksVision: false,
          occluderHeight: 6,
          bridgePortal: {
            lowerFloor: "ground",
            upperFloor: "bridge",
            upperElevation: 12,
            navigationCost: 2,
          },
        },
        "2": {
          frame: "terrain.ramp",
          elevation: 4,
          kind: "ramp",
          ramp: { axis: "y", startElevation: 4, endElevation: 12 },
        },
      },
    },
  });

  deepEqual(spec.tilemap?.tiles.map((tile) => ({
    id: tile.id,
    kind: tile.kind,
    blocksMovement: tile.blocksMovement,
    blocksProjectile: tile.blocksProjectile,
    blocksVision: tile.blocksVision,
    occluderHeight: tile.occluderHeight,
    ramp: tile.ramp,
    bridgePortal: tile.bridgePortal,
  })), [
    {
      id: 1,
      kind: "bridge",
      blocksMovement: false,
      blocksProjectile: false,
      blocksVision: false,
      occluderHeight: 6,
      ramp: undefined,
      bridgePortal: {
        lowerFloor: "ground",
        upperFloor: "bridge",
        lowerElevation: 0,
        upperElevation: 12,
        navigationCost: 2,
      },
    },
    {
      id: 2,
      kind: "ramp",
      blocksMovement: true,
      blocksProjectile: true,
      blocksVision: true,
      occluderHeight: 0,
      ramp: { axis: "y", startElevation: 4, endElevation: 12 },
      bridgePortal: undefined,
    },
  ]);
});

test("resolveShooterGameSpec rejects invalid HD-2D tile metadata", () => {
  try {
    resolveShooterGameSpec({
      atlas: {
        frames: {
          "terrain.bridge": {
            texture: 0,
            uv: { u0: 0, v0: 0, u1: 1, v1: 1 },
            size: { width: 16, height: 16 },
          },
        },
      },
      tilemap: {
        tiles: {
          "1": { frame: "terrain.bridge", kind: "bridge", ramp: { axis: "x" } },
        },
      },
    });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='tilemap.tiles.1.ramp' detail='requires kind to be ramp'.",
    );
    return;
  }
  throw new Error("Expected invalid HD-2D tile metadata to throw.");
});

test("resolveShooterGameSpec rejects bridge portal on non-bridge tiles", () => {
  try {
    resolveShooterGameSpec({
      atlas: {
        frames: {
          "terrain.floor": {
            texture: 0,
            uv: { u0: 0, v0: 0, u1: 1, v1: 1 },
            size: { width: 16, height: 16 },
          },
        },
      },
      tilemap: {
        tiles: {
          "1": {
            frame: "terrain.floor",
            kind: "flat",
            bridgePortal: { lowerFloor: "ground", upperFloor: "bridge" },
          },
        },
      },
    });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='tilemap.tiles.1.bridgePortal' detail='requires kind to be bridge'.",
    );
    return;
  }
  throw new Error("Expected invalid bridge portal metadata to throw.");
});

test("resolveShooterGameSpec rejects bridge portal with same floors", () => {
  try {
    resolveShooterGameSpec({
      atlas: {
        frames: {
          "terrain.bridge": {
            texture: 0,
            uv: { u0: 0, v0: 0, u1: 1, v1: 1 },
            size: { width: 16, height: 16 },
          },
        },
      },
      tilemap: {
        tiles: {
          "1": {
            frame: "terrain.bridge",
            kind: "bridge",
            bridgePortal: { lowerFloor: "ground", upperFloor: "ground" },
          },
        },
      },
    });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='tilemap.tiles.1.bridgePortal.upperFloor' detail='must differ from bridgePortal.lowerFloor'.",
    );
    return;
  }
  throw new Error("Expected invalid bridge portal floor metadata to throw.");
});

test("resolveShooterGameSpec rejects vertical tile slope definitions", () => {
  try {
    resolveShooterGameSpec({
      atlas: {
        frames: {
          "terrain.ramp": {
            texture: 0,
            uv: { u0: 0, v0: 0, u1: 1, v1: 1 },
            size: { width: 16, height: 16 },
          },
        },
      },
      tilemap: {
        tiles: {
          "1": { frame: "terrain.ramp", slope: { x0: 0.5, y0: 1, x1: 0.5, y1: 0 } },
        },
      },
    });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='tilemap.tiles.1.slope.x1' detail='must differ from slope.x0'.",
    );
    return;
  }
  throw new Error("Expected vertical tile slope spec to throw.");
});

test("resolveShooterGameSpec rejects non-boolean one-way tile metadata", () => {
  try {
    resolveShooterGameSpec({
      atlas: {
        frames: {
          "terrain.platform": {
            texture: 0,
            uv: { u0: 0, v0: 0, u1: 1, v1: 1 },
            size: { width: 16, height: 16 },
          },
        },
      },
      tilemap: {
        tiles: {
          "1": { frame: "terrain.platform", oneWayPlatform: "yes" },
        },
      },
    });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='tilemap.tiles.1.oneWayPlatform' detail='must be a boolean'.",
    );
    return;
  }
  throw new Error("Expected non-boolean one-way tile metadata to throw.");
});

test("resolveShooterGameSpec rejects invalid tile height metadata", () => {
  try {
    resolveShooterGameSpec({
      atlas: {
        frames: {
          "terrain.block": {
            texture: 0,
            uv: { u0: 0, v0: 0, u1: 1, v1: 1 },
            size: { width: 16, height: 16 },
          },
        },
      },
      tilemap: {
        tiles: {
          "1": { frame: "terrain.block", floor: "", elevation: 0, height: 8 },
        },
      },
    });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='tilemap.tiles.1.floor' detail='must be a non-empty string'.",
    );
    return;
  }
  throw new Error("Expected invalid tile height metadata to throw.");
});

test("resolveShooterGameSpec rejects tiles that combine slope and one-way platform metadata", () => {
  try {
    resolveShooterGameSpec({
      atlas: {
        frames: {
          "terrain.ramp": {
            texture: 0,
            uv: { u0: 0, v0: 0, u1: 1, v1: 1 },
            size: { width: 16, height: 16 },
          },
        },
      },
      tilemap: {
        tiles: {
          "1": {
            frame: "terrain.ramp",
            slope: { x0: 0, y0: 1, x1: 1, y1: 0 },
            oneWayPlatform: true,
          },
        },
      },
    });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='tilemap.tiles.1.oneWayPlatform' detail='cannot be combined with slope'.",
    );
    return;
  }
  throw new Error("Expected combined slope and one-way tile metadata to throw.");
});

test("resolveShooterGameSpec rejects tilemap data that references missing tiles", () => {
  try {
    resolveShooterGameSpec({
      tilemap: {
        tiles: {},
        layers: [{ columns: 1, rows: 1, data: [1] }],
      },
    });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='tilemap.layers.0.data.0' detail='must reference a tile id in tilemap.tiles or be 0'.",
    );
    return;
  }
  throw new Error("Expected invalid tilemap data spec to throw.");
});

test("resolveShooterGameSpec rejects tilemap layer data length mismatches", () => {
  try {
    resolveShooterGameSpec({
      tilemap: {
        layers: [{ columns: 2, rows: 2, data: [0, 0, 0] }],
      },
    });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='tilemap.layers.0.data' detail='must contain exactly 4 tile ids'.",
    );
    return;
  }
  throw new Error("Expected invalid tilemap layer spec to throw.");
});

test("resolveShooterGameSpec rejects non-boolean tilemap collision flags", () => {
  try {
    resolveShooterGameSpec({
      tilemap: {
        layers: [{ columns: 1, rows: 1, collision: "yes", data: [0] }],
      },
    });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='tilemap.layers.0.collision' detail='must be a boolean'.",
    );
    return;
  }
  throw new Error("Expected invalid tilemap collision spec to throw.");
});

test("resolveShooterGameSpec accepts collision-only tilemap layers with undefined solid ids", () => {
  const spec = resolveShooterGameSpec({
    tilemap: {
      layers: [{
        name: "raw-int-grid",
        columns: 2,
        rows: 2,
        collision: true,
        collisionOnly: true,
        data: [0, 4294967295, 0, 4294967295],
      }],
    },
  });

  deepEqual(spec.tilemap?.layers[0], {
    index: 0,
    name: "raw-int-grid",
    columns: 2,
    rows: 2,
    tileWidth: 32,
    tileHeight: 32,
    originX: 0,
    originY: 0,
    collision: true,
    collisionOnly: true,
    data: [0, 4294967295, 0, 4294967295],
  });
});

test("resolveShooterGameSpec rejects collision-only tilemap layers without collision", () => {
  try {
    resolveShooterGameSpec({
      tilemap: {
        layers: [{ columns: 1, rows: 1, collisionOnly: true, data: [1] }],
      },
    });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='tilemap.layers.0.collisionOnly' detail='requires collision to be true'.",
    );
    return;
  }
  throw new Error("Expected invalid collision-only layer spec to throw.");
});

test("resolveShooterGameSpec rejects tilemap tiles with unknown atlas frames", () => {
  try {
    resolveShooterGameSpec({
      tilemap: {
        tiles: { "1": { frame: "missing" } },
      },
    });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='tilemap.tiles.1.frame' detail='must reference a frame in atlas.frames'.",
    );
    return;
  }
  throw new Error("Expected invalid tilemap frame spec to throw.");
});
