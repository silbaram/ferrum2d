import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import type { Engine } from "../pkg/ferrum_core.js";
import {
  configureDataSceneGameplay,
  dataSceneCombatStats,
  supportsDataSceneInputProjectiles,
} from "../src/dataSceneGameplay.js";
import { assertDataSceneCombatSaveSupported } from "../src/dataSceneProgress.js";
import type { FerrumEngine } from "../src/engineTypes.js";

test("combat configuration preserves the legacy ABI and rejects old Wasm before configuration", () => {
  const calls: unknown[][] = [];
  const legacy = {
    configure_data_scene_gameplay: (...args: unknown[]) => {
      calls.push(args);
      return true;
    },
  } as unknown as Engine;
  const primaryActor = { entityId: 4, entityGeneration: 7 };
  equal(configureDataSceneGameplay(legacy, { primaryActor }), true);
  deepEqual(calls, [[true, 4, 7, 0]]);
  throws(
    () => configureDataSceneGameplay(legacy, { primaryActor, combat: true }),
    /compatible combat Wasm/,
  );
  equal(calls.length, 1);
  const modern = {
    configure_data_scene_gameplay_v2: (...args: unknown[]) => {
      calls.push(args);
      return true;
    },
  } as unknown as Engine;
  equal(configureDataSceneGameplay(modern, { primaryActor, combat: true }), true);
  deepEqual(calls[1], [true, 4, 7, 0, true]);
  throws(() => configureDataSceneGameplay(modern, { combat: true }), /primaryActor/);
});

test("combat diagnostics are versioned scalar copies and refuse mismatched native schemas", () => {
  equal(dataSceneCombatStats({} as unknown as Engine), undefined);
  deepEqual(
    dataSceneCombatStats({
      data_scene_combat_stats: () => Uint32Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10),
    } as unknown as Engine),
    {
      actors: 2,
      projectiles: 3,
      aiSteps: 4,
      spawned: 5,
      hits: 6,
      kills: 7,
      expired: 8,
      capped: 9,
      particlesSpawned: 10,
    },
  );
  for (const values of [[], [2, 2, 3, 4, 5, 6, 7, 8, 9, 10], [1, 2]])
    throws(
      () =>
        dataSceneCombatStats({
          data_scene_combat_stats: () => Uint32Array.from(values),
        } as unknown as Engine),
      /diagnostics ABI/,
    );
});

test("combat progress capture and restore fail before exploration adapters can mutate", () => {
  throws(
    () =>
      assertDataSceneCombatSaveSupported({ dataSceneCombatEnabled: () => true } as FerrumEngine),
    /combat capture\/restore/,
  );
  assertDataSceneCombatSaveSupported({} as FerrumEngine);
});

test("input projectiles explicitly probe their own native version instead of combat availability", () => {
  equal(supportsDataSceneInputProjectiles({} as Engine), false);
  equal(
    supportsDataSceneInputProjectiles({
      data_scene_combat_stats: () => Uint32Array.of(1),
    } as unknown as Engine),
    false,
  );
  for (const version of [0, 2, NaN, undefined]) {
    equal(
      supportsDataSceneInputProjectiles({
        data_scene_input_projectiles_version: () => version,
      } as unknown as Engine),
      false,
    );
  }
  equal(
    supportsDataSceneInputProjectiles({
      data_scene_input_projectiles_version: () => 1,
    } as unknown as Engine),
    true,
  );
});
