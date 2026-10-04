import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { createDataSceneMovementApi, type DataSceneMoveOptions } from "../src/dataSceneMovement.js";

test("move destination options are validated completely before calling the runtime", () => {
  const calls: unknown[][] = [];
  const api = createDataSceneMovementApi({
    move_data_scene_actor_to: (...args) => { calls.push(args); return true; },
    cancel_data_scene_move: () => false,
    data_scene_move_status: () => 0,
  }, () => {});
  for (const change of [
    { x: NaN }, { y: Infinity }, { x: 1e39 }, { speed: 1e-100 }, { speed: 0 }, { speed: -1 },
    { arrivalRadius: -1 }, { arrivalRadius: -1e-100 }, { arrivalRadius: null }, { solidMaskBits: -1 }, { solidMaskBits: 0x100000000 },
    { solidMaskBits: null }, { cancelOnInput: null }, { cancelOnInput: 1 }, { typo: 1 },
  ]) {
    throws(() => api.moveDataSceneActorTo({ x: 10, y: 20, speed: 40, ...change } as DataSceneMoveOptions));
  }
  equal(calls.length, 0);
  equal(api.moveDataSceneActorTo({ x: 10, y: 20, speed: 40 }), true);
  deepEqual(calls, [[10, 20, 40, 0.5, 0xffffffff, true]]);
  equal(api.moveDataSceneActorTo({ x: 10, y: 20, speed: 40, arrivalRadius: 0, solidMaskBits: 0, cancelOnInput: false }), true);
  deepEqual(calls[1], [10, 20, 40, 0, 0, false]);
});

test("movement exposes runtime rejection, all status codes, and unsupported scenes", () => {
  let code = 0;
  const api = createDataSceneMovementApi({
    move_data_scene_actor_to: () => false,
    cancel_data_scene_move: () => true,
    data_scene_move_status: () => code,
  }, () => {});
  equal(api.moveDataSceneActorTo({ x: 1, y: 2, speed: 3 }), false);
  equal(api.cancelDataSceneMove(), true);
  for (const status of ["idle", "moving", "arrived", "blocked", "cancelled"]) {
    equal(api.dataSceneMoveStatus(), status); code++;
  }
  throws(() => api.dataSceneMoveStatus(), /Unsupported Data Scene move status/);
  code = 0xffffffff;
  equal(api.dataSceneMoveStatus(), undefined);
});

test("movement API rejects destroyed runtimes before any Wasm call", () => {
  const unreachable = () => { throw new Error("Wasm was reached"); };
  const api = createDataSceneMovementApi({
    move_data_scene_actor_to: unreachable, cancel_data_scene_move: unreachable, data_scene_move_status: unreachable,
  }, () => { throw new Error("engine destroyed"); });
  throws(() => api.moveDataSceneActorTo({ x: 1, y: 2, speed: 3 }), /engine destroyed/);
  throws(() => api.cancelDataSceneMove(), /engine destroyed/);
  throws(() => api.dataSceneMoveStatus(), /engine destroyed/);
});
