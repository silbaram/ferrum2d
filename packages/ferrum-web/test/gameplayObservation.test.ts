import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { createGameplayObservationApi } from "../src/gameplayObservation.js";

test("gameplay position observations use one ordered bulk call and own their results", () => {
  let calls = 0, alive = true;
  const rows = new Float64Array([1, -0, 3, 4, 0, 0, 0, 0, 1, -0, 3, 4]);
  const api = createGameplayObservationApi({
    query_gameplay_positions(handles) {
      calls++;
      deepEqual([...handles], [5, 7, 9, 2, 5, 7]);
      return rows;
    },
    built_in_shooter_player_actions: () => new Float64Array(),
    built_in_shooter_progress: () => new Float64Array(),
  }, () => { if (!alive) throw new Error("destroyed"); });
  const at = api.queryGameplayPositions([{ entityId: 5, entityGeneration: 7 }, { entityId: 9, entityGeneration: 2 }, { entityId: 5, entityGeneration: 7 }]);
  equal(calls, 1);
  deepEqual(at, [{ x: -0, y: 3, z: 4 }, undefined, { x: -0, y: 3, z: 4 }]);
  equal(Object.is(at[0]!.x, -0), true);
  rows[1] = 99;
  equal(Object.is(at[0]!.x, -0), true);
  throws(() => api.queryGameplayPositions(Array(65_537).fill({ entityId: 0, entityGeneration: 0 })), /65536/);
  throws(() => api.queryGameplayPositions([{ entityId: -1, entityGeneration: 7 }]));
  equal(calls, 1);
  alive = false;
  throws(() => api.queryGameplayPositions([]), /destroyed/);
  throws(() => api.builtInShooterProgress(), /destroyed/);
  equal(calls, 1);
});

test("Shooter progress preserves u32 counts, empty scene and f32 timer without a snapshot", () => {
  let values = new Float64Array([0xffff_ffff, Math.fround(0.3), 0xffff_ffff]);
  const api = createGameplayObservationApi({
    query_gameplay_positions: () => new Float64Array(),
    built_in_shooter_player_actions: () => new Float64Array(),
    built_in_shooter_progress: () => values,
  }, () => {});
  const progress = api.builtInShooterProgress();
  deepEqual(progress, { activeWaveIndex: 0xffff_ffff, waveElapsedSeconds: Math.fround(0.3), waveSpawnedCount: 0xffff_ffff });
  values[1] = 99;
  equal(progress!.waveElapsedSeconds, Math.fround(0.3));
  values = new Float64Array();
  equal(api.builtInShooterProgress(), undefined);
  for (const malformed of [[1, 2], [1, -1, 2], [1.5, 0, 2], [0, NaN, 0], [0, 0, 0x1_0000_0000]]) {
    values = new Float64Array(malformed);
    throws(() => api.builtInShooterProgress(), /Invalid/);
  }
});

test("malformed native gameplay position output is rejected", () => {
  let rows = new Float64Array();
  const api = createGameplayObservationApi({
    query_gameplay_positions: () => rows,
    built_in_shooter_player_actions: () => new Float64Array(),
    built_in_shooter_progress: () => new Float64Array(),
  }, () => {});
  for (const malformed of [[], [2, 1, 2, 3], [1, 1, Infinity, 3]]) {
    rows = new Float64Array(malformed);
    throws(() => api.queryGameplayPositions([{ entityId: 1, entityGeneration: 2 }]), /Invalid/);
  }
});

test("read-only player action observations preserve live bindings and omit absent actions", () => {
  let values = new Float64Array([1, 0.5, 0.25, 720, 12, 3, 2, 1, 0.5, 96]);
  const api = createGameplayObservationApi({
    query_gameplay_positions: () => new Float64Array(),
    built_in_shooter_progress: () => new Float64Array(),
    built_in_shooter_player_actions: () => values,
  }, () => {});
  const actions = api.builtInShooterPlayerActions();
  deepEqual(actions, {
    primaryAction: { actionId: 1, cooldownSeconds: 0.5, remainingCooldownSeconds: 0.25, speed: 720, damage: 12, lifetimeSeconds: 3 },
    dashAction: { actionId: 2, cooldownSeconds: 1, remainingCooldownSeconds: 0.5, distance: 96 },
  });
  values[3] = 999;
  equal(actions!.primaryAction!.speed, 720);
  values = new Float64Array(10);
  deepEqual(api.builtInShooterPlayerActions(), {});
  values = new Float64Array();
  equal(api.builtInShooterPlayerActions(), undefined);
  values = new Float64Array([1, -1, 0, 720, 12, 3, 0, 0, 0, 0]);
  throws(() => api.builtInShooterPlayerActions(), /Invalid/);
});
