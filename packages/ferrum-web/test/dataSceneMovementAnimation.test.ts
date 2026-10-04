import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { createDataSceneMovementAnimationApi, type DataSceneMovementAnimationSpec } from "../src/dataSceneMovementAnimation.js";

const spec = (): DataSceneMovementAnimationSpec => ({
  idle: { up: { clip: 0 }, down: { clip: 1 }, left: { clip: 2, flipX: true }, right: { clip: 2 } },
  walk: { up: { clip: 3, flipY: true }, down: { clip: 4 }, left: { clip: 5, flipX: true }, right: { clip: 5 } },
});

test("movement animation compiles one numeric binding call with stable direction order", () => {
  const calls: unknown[] = [];
  const api = createDataSceneMovementAnimationApi({ configure_data_scene_movement_animation: (poses, facing) => { calls.push([Array.from(poses), facing]); return true; } }, () => {});
  equal(api.configureDataSceneMovementAnimation(spec()), true);
  deepEqual(calls[0], [[0, 0, 0, 1, 0, 0, 2, 1, 0, 2, 0, 0, 3, 0, 1, 4, 0, 0, 5, 1, 0, 5, 0, 0], 1]);
  equal(api.configureDataSceneMovementAnimation({ ...spec(), initialDirection: "left" }), true);
  equal(api.configureDataSceneMovementAnimation(false), true);
  deepEqual(calls[2], [[], 1]);
});

test("invalid movement animation bindings never call Wasm", () => {
  let calls = 0;
  const api = createDataSceneMovementAnimationApi({ configure_data_scene_movement_animation: () => { calls++; return false; } }, () => {});
  const bad: unknown[] = [null, true, [], {}, { ...spec(), initialDirection: null }, { ...spec(), initialDirection: "north" }, { ...spec(), extra: true }];
  for (const pose of [null, [], {}, { clip: -1 }, { clip: 65536 }, { clip: 1.5 }, { clip: NaN }, { clip: Infinity }, { clip: "1" }, { clip: 1, flipX: null }, { clip: 1, flipY: 1 }, { clip: 1, typo: 1 }]) {
    bad.push({ ...spec(), walk: { ...spec().walk, right: pose } });
  }
  bad.push({ ...spec(), idle: { down: { clip: 1 } } });
  for (const value of bad) throws(() => api.configureDataSceneMovementAnimation(value as DataSceneMovementAnimationSpec));
  equal(calls, 0);
  equal(api.configureDataSceneMovementAnimation(spec()), false);
  equal(calls, 1);
});

test("destroyed engines reject movement animation settings and disabling", () => {
  const api = createDataSceneMovementAnimationApi({ configure_data_scene_movement_animation: () => { throw new Error("Wasm reached"); } }, () => { throw new Error("destroyed"); });
  throws(() => api.configureDataSceneMovementAnimation(spec()), /destroyed/);
  throws(() => api.configureDataSceneMovementAnimation(false), /destroyed/);
});
