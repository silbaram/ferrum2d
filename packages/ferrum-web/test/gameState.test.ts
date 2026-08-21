import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import {
  dataSceneGameStateFromCode,
  GAME_STATE_CODE,
  gameStateName,
  resolveDataSceneGameState,
  resolveGameStateCode,
} from "../src/gameState.js";

test("game state codes keep the fixed Rust/Wasm and snapshot mapping", () => {
  deepEqual(GAME_STATE_CODE, {
    title: 0,
    playing: 1,
    gameOver: 2,
    paused: 3,
    levelComplete: 4,
  });
  equal(gameStateName(resolveGameStateCode(3)), "paused");
  equal(gameStateName(resolveGameStateCode(4)), "levelComplete");
  throws(() => resolveGameStateCode(5), /known game state code/);
  throws(() => gameStateName(5 as never), /known game state code/);
});

test("data scene state mapping excludes built-in-only and invalid states", () => {
  equal(dataSceneGameStateFromCode(GAME_STATE_CODE.playing), "playing");
  equal(dataSceneGameStateFromCode(GAME_STATE_CODE.paused), "paused");
  equal(dataSceneGameStateFromCode(GAME_STATE_CODE.levelComplete), "levelComplete");
  equal(dataSceneGameStateFromCode(GAME_STATE_CODE.title), undefined);
  equal(dataSceneGameStateFromCode(GAME_STATE_CODE.gameOver), undefined);
  equal(dataSceneGameStateFromCode(0xffffffff), undefined);
  equal(resolveDataSceneGameState(0xffffffff), undefined);
  equal(resolveDataSceneGameState(GAME_STATE_CODE.paused), "paused");
  throws(() => resolveDataSceneGameState(GAME_STATE_CODE.title), /must be playing/);
  throws(() => resolveDataSceneGameState(5), /known game state code/);
});
