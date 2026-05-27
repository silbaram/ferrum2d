import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  applyTileRules,
  bakeAnimatedTileLayer,
  resolveAnimatedTileFrame,
} from "../src/tilemapAuthoring.js";

test("applyTileRules maps row-major tile data using ordered neighbor rules", () => {
  const data = applyTileRules({
    columns: 3,
    rows: 3,
    data: [
      0, 1, 0,
      1, 1, 1,
      0, 1, 0,
    ],
  }, [{
    match: 1,
    neighbors: {
      n: "same",
      e: "same",
      s: "same",
      w: "same",
    },
    output: 9,
  }, {
    match: "filled",
    neighbors: { n: "empty" },
    output: 2,
  }]);

  deepEqual(data, [
    0, 2, 0,
    2, 9, 2,
    0, 1, 0,
  ]);
});

test("applyTileRules can clear unmatched cells", () => {
  deepEqual(applyTileRules({
    columns: 2,
    rows: 1,
    data: [1, 2],
  }, [{
    match: [1],
    output: 3,
  }], {
    preserveUnmatched: false,
  }), [3, 0]);
});

test("applyTileRules rejects invalid neighbor directions with path context", () => {
  try {
    applyTileRules({
      columns: 1,
      rows: 1,
      data: [1],
    }, [{
      output: 2,
      neighbors: { north: "same" } as never,
    }]);
  } catch (error) {
    equal(
      (error as Error).message,
      "Invalid shooter game spec: kind=game-spec path='tileRules.rules.0.neighbors.north' detail='must be one of n, e, s, w, ne, se, sw, or nw'.",
    );
    return;
  }
  throw new Error("Expected invalid tile rule to throw.");
});

test("resolveAnimatedTileFrame advances by fps and loops by default", () => {
  equal(resolveAnimatedTileFrame({
    fps: 4,
    frames: [2, 3, 4, 5],
  }, { timeSeconds: 0.51 }), 4);
  equal(resolveAnimatedTileFrame({
    fps: 4,
    frames: [2, 3, 4, 5],
  }, { timeSeconds: 1.1 }), 2);
});

test("bakeAnimatedTileLayer replaces animated tile ids at a sampled time", () => {
  deepEqual(bakeAnimatedTileLayer({
    columns: 3,
    rows: 1,
    data: [0, 7, 1],
  }, {
    7: {
      loop: false,
      frames: [
        { tile: 7, durationMs: 100 },
        { tile: 8, durationMs: 100 },
        { tile: 9, durationMs: 100 },
      ],
    },
  }, {
    timeSeconds: 0.24,
  }), [0, 9, 1]);
});

test("bakeAnimatedTileLayer rejects invalid animation timing with path context", () => {
  try {
    bakeAnimatedTileLayer({
      columns: 1,
      rows: 1,
      data: [1],
    }, {
      1: { fps: 0, frames: [1, 2] },
    });
  } catch (error) {
    equal(
      (error as Error).message,
      "Invalid shooter game spec: kind=game-spec path='animatedTiles.animations.1.fps' detail='must be a positive number'.",
    );
    return;
  }
  throw new Error("Expected invalid animated tile to throw.");
});
