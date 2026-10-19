import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import type { Engine } from "../pkg/ferrum_core.js";
import type { FerrumEngine } from "../src/engineTypes.js";
import {
  combatNavigationValues,
  resolveCombatNavigation,
  supportsDataSceneCombatNavigation,
  dataSceneCombatNavigationStats,
} from "../src/dataSceneCombatNavigation.js";
import {
  configureDataSceneGameplay,
  resolveDataSceneGameplaySpec,
} from "../src/dataSceneGameplay.js";
import { resolveSceneAuthoringDocument } from "../src/sceneAuthoringDocument.js";
import { preflightDataSceneGameplay } from "../src/dataSceneGameplayAuthoring.js";
import { bindSceneBehaviorRecipes } from "../src/gameplayAuthoring.js";
import { assertDataSceneCombatSaveSupported } from "../src/dataSceneProgress.js";

function document() {
  const components = {
    visual: { kind: "sprite", texture: 1, width: 8, height: 16 },
    collider: { type: "aabb", halfWidth: 2, halfHeight: 2, isTrigger: true },
    layer: "enemy",
    body: { type: "kinematic", heightSpan: { floorId: 0, elevation: 0, height: 8 } },
  };
  return {
    format: "ferrum2d.consumer.scene-authoring",
    version: 1,
    gameplay: { primaryActor: "actor", combat: true, combatNavigation: { maxAgents: 1 } },
    sceneComposition: {
      initialFragment: "arena",
      prefabs: {
        actor: { props: { components } },
        enemy: { props: { components, behaviorRecipes: ["chaser"] } },
      },
      fragments: {
        arena: {
          instances: [
            { id: "actor", prefab: "actor", x: 0, y: 80 },
            { id: "enemy", prefab: "enemy", x: 0, y: 16 },
          ],
        },
      },
    },
    behaviorRecipes: {
      entities: { chaser: { recipes: [{ kind: "chase", speed: 64, stopDistance: 0 }] } },
    },
    spatial: {
      camera: {
        projection: "orthographic",
        position: { x: 0, y: -100, elevation: 200 },
        target: { x: 0, y: 50, elevation: 0 },
        height: 200,
      },
      terrain: [{ id: "ground", x: -32, y: 0, width: 64, depth: 112, elevation: 0 }],
      billboards: { actor: {}, enemy: {} },
    },
  };
}
test("combat navigation config is bounded, opt-in and rejects null/unknown/f32 underflow", () => {
  deepEqual([...combatNavigationValues({})], [8, 8, 40, 0.5, 4, 32]);
  for (const value of [
    null,
    [],
    { typo: 1 },
    { cellSize: 0 },
    { cellSize: 1e-100 },
    { maxStepHeight: -1 },
    { maxDropHeight: Infinity },
    { repathIntervalSeconds: 0.01 },
    { arrivalRadius: null },
    { maxAgents: 1.5 },
    { maxAgents: 65 },
  ])
    throws(() => resolveCombatNavigation(value, "nav"));
  throws(() => resolveDataSceneGameplaySpec({ combatNavigation: {} }), /requires combat/);
  throws(
    () => resolveDataSceneGameplaySpec({ combat: true, combatNavigation: {} }),
    /primaryActor/,
  );
});
test("combat navigation issues one additive v4 bulk configuration and never falls back silently", () => {
  let calls = 0;
  const raw = {
    data_scene_projectile_prefabs_version: () => 1,
    data_scene_combat_progress_version: () => 2,
    data_scene_combat_navigation_version: () => 1,
    configure_data_scene_gameplay_v3: () => {
      throw new Error("v3 fallback");
    },
    configure_data_scene_gameplay_v4: (...args: unknown[]) => {
      calls++;
      deepEqual([...(args[8] as Float32Array)], [8, 8, 40, 0.5, 4, 32]);
      equal((args[5] as Uint32Array).length, 0);
      return true;
    },
  } as unknown as Engine;
  equal(supportsDataSceneCombatNavigation(raw), true);
  equal(
    configureDataSceneGameplay(raw, {
      combat: true,
      primaryActor: { entityId: 3, entityGeneration: 4 },
      combatNavigation: {},
    }),
    true,
  );
  equal(calls, 1);
  const old = { ...raw, data_scene_combat_navigation_version: () => 0 } as unknown as Engine;
  throws(
    () =>
      configureDataSceneGameplay(old, {
        combat: true,
        primaryActor: { entityId: 3, entityGeneration: 4 },
        combatNavigation: {},
      }),
    /compatible combat-navigation/,
  );
  equal(calls, 1);
});
test("authoring rejects unsupported sources and missing spatial data before activation", () => {
  const resolved = resolveSceneAuthoringDocument(document(), { validateBindings: true });
  const engine = {
    configureDataSceneGameplay: () => true,
    dataSceneCombatStats: () => ({}),
    supportsDataSceneCombatNavigation: () => true,
  } as unknown as FerrumEngine;
  const plan = bindSceneBehaviorRecipes(resolved.sceneComposition, resolved.behaviorRecipes);
  preflightDataSceneGameplay(engine, resolved, plan, resolved.ids, "scene");
  throws(
    () =>
      preflightDataSceneGameplay(
        { ...engine, supportsDataSceneCombatNavigation: () => false },
        resolved,
        plan,
        resolved.ids,
        "scene",
      ),
    /compatible combat-navigation/,
  );
  const noSpatial = { ...document(), spatial: undefined };
  throws(() => resolveSceneAuthoringDocument(noSpatial), /requires spatial/);
  const invalid = document();
  invalid.sceneComposition.prefabs.enemy.props.components.body.type = "static";
  throws(() => resolveSceneAuthoringDocument(invalid, { validateBindings: true }), /kinematic/);
  const over = document();
  over.sceneComposition.fragments.arena.instances.push({
    id: "second",
    prefab: "enemy",
    x: 8,
    y: 16,
  });
  throws(() => resolveSceneAuthoringDocument(over, { validateBindings: true }), /maxAgents/);
});
test("navigation diagnostics use a separate fixed ABI and save preflight refuses an older build", () => {
  equal(dataSceneCombatNavigationStats({} as Engine), undefined);
  const raw = {
    data_scene_combat_navigation_stats: () =>
      new Uint32Array([1, 1, 4, 3, 1, 8, 2, 9, 1, 999999, 7, 20, 50]),
  } as unknown as Engine;
  const stats = dataSceneCombatNavigationStats(raw)!;
  equal(stats.agents, 4);
  equal(stats.frameWorkUnits, 999999);
  equal(stats.lastRequestStatus, 7);
  throws(
    () =>
      dataSceneCombatNavigationStats({
        data_scene_combat_navigation_stats: () => new Uint32Array(14),
      } as unknown as Engine),
    /diagnostics ABI/,
  );
  throws(
    () =>
      assertDataSceneCombatSaveSupported(
        { supportsDataSceneCombatProgress: () => true } as FerrumEngine,
        document(),
      ),
    /navigation.*compatible/,
  );
});

test("scheduler diagnostics retain a separate versioned ABI and tolerate old Wasm", async () => {
  const {
    dataSceneCombatNavigationSchedulerStats: stats,
    supportsDataSceneCombatNavigationScheduler: supports,
  } = await import("../src/dataSceneCombatNavigation.js");
  equal(stats({} as Engine), undefined);
  equal(supports({} as Engine), false);
  const raw = {
    data_scene_combat_navigation_scheduler_version: () => 1,
    data_scene_combat_navigation_scheduler_stats: () =>
      new Uint32Array([1, 1, 1, 8, 63, 32, 31, 2, 262144, 8000000]),
  } as unknown as Engine;
  equal(supports(raw), true);
  deepEqual(stats(raw), {
    enabled: true,
    pendingSearches: 1,
    cachedRoutes: 8,
    cacheHits: 63,
    searchSlices: 32,
    yieldedSlices: 31,
    cancelledSearches: 2,
    frameSearchWorkUnits: 262144,
    peakSearchWorkUnits: 8000000,
  });
  for (const words of [new Uint32Array(9), new Uint32Array([2, 1, 0, 0, 0, 0, 0, 0, 0, 0])])
    throws(
      () =>
        stats({ data_scene_combat_navigation_scheduler_stats: () => words } as unknown as Engine),
      /scheduler diagnostics ABI/,
    );
});

function movementDocument() {
  const d = document();
  return {
    ...d,
    gameplay: {
      ...d.gameplay,
      combatNavigation: { maxAgents: 2, movementPatterns: "all" as const },
    },
    sceneComposition: {
      ...d.sceneComposition,
      prefabs: {
        ...d.sceneComposition.prefabs,
        accelerator: {
          props: {
            components: d.sceneComposition.prefabs.enemy.props.components,
            behaviorRecipes: ["accelerator"],
          },
        },
      },
      fragments: {
        arena: {
          instances: [
            ...d.sceneComposition.fragments.arena.instances,
            { id: "accelerator", prefab: "accelerator", x: 12, y: 16 },
          ],
        },
      },
    },
    behaviorRecipes: {
      entities: {
        chaser: {
          recipes: [{ kind: "seekTarget", target: "primaryActor", speed: 64, turnRate: 0.25 }],
        },
        accelerator: {
          recipes: [{ kind: "accelerate", accelerationX: 1, accelerationY: 0, maxSpeed: 32 }],
        },
      },
    },
  };
}
test("all-pattern authoring is explicit and counts both SeekTarget and Accelerate sources", () => {
  equal(resolveCombatNavigation({}, "nav").movementPatterns, undefined);
  equal(resolveCombatNavigation({ movementPatterns: "all" }, "nav").movementPatterns, "all");
  equal(resolveCombatNavigation({ movementPatterns: "chase" }, "nav").movementPatterns, "chase");
  for (const movementPatterns of [null, true, 1, "seek", [], {}])
    throws(() => resolveCombatNavigation({ movementPatterns }, "nav"), /movementPatterns/);
  const d = movementDocument();
  resolveSceneAuthoringDocument(d, { validateBindings: true });
  throws(
    () =>
      resolveSceneAuthoringDocument(
        {
          ...d,
          gameplay: {
            ...d.gameplay,
            combatNavigation: { ...d.gameplay.combatNavigation, maxAgents: 1 },
          },
        },
        { validateBindings: true },
      ),
    /maxAgents/,
  );
  d.sceneComposition.prefabs.accelerator.props.components.body.type = "static";
  throws(() => resolveSceneAuthoringDocument(d, { validateBindings: true }), /kinematic/);
});
test("all-pattern runtime uses additive v6 and rejects old native capability before mutation", async () => {
  const { supportsDataSceneCombatMovement: supports } = await import(
    "../src/dataSceneCombatNavigation.js"
  );
  let calls = 0;
  const raw = {
    data_scene_combat_navigation_version: () => 1,
    configure_data_scene_gameplay_v4: () => {
      throw new Error("v4 fallback");
    },
    data_scene_projectile_prefabs_version: () => 1,
    data_scene_combat_progress_version: () => 2,
    configure_data_scene_gameplay_v3: () => {
      throw new Error("v3 fallback");
    },
    data_scene_combat_movement_version: () => 1,
    configure_data_scene_gameplay_v6: (...args: unknown[]) => {
      calls++;
      deepEqual([...(args[8] as Float32Array)], [8, 8, 40, 0.5, 4, 32, -1]);
      equal((args[9] as Uint32Array).length, 0);
      equal(args[11], 1);
      return true;
    },
  } as unknown as Engine;
  equal(supports(raw), true);
  const options = {
    combat: true,
    primaryActor: { entityId: 3, entityGeneration: 4 },
    combatNavigation: { movementPatterns: "all" as const },
  };
  equal(configureDataSceneGameplay(raw, options), true);
  equal(calls, 1);
  const old = { ...raw, data_scene_combat_movement_version: () => 0 } as unknown as Engine;
  equal(supports(old), false);
  throws(() => configureDataSceneGameplay(old, options), /combat-movement/);
  equal(calls, 1);
});
test("all-pattern authoring and checkpoint preflight require their own native capability", () => {
  const document = movementDocument();
  const resolved = resolveSceneAuthoringDocument(document, { validateBindings: true });
  const plan = bindSceneBehaviorRecipes(resolved.sceneComposition, resolved.behaviorRecipes);
  const engine = {
    configureDataSceneGameplay: () => true,
    dataSceneCombatStats: () => ({}),
    supportsDataSceneCombatNavigation: () => true,
    supportsDataSceneCombatMovement: () => true,
    supportsDataSceneCombatProgress: () => true,
  } as unknown as FerrumEngine;
  preflightDataSceneGameplay(engine, resolved, plan, resolved.ids, "scene");
  assertDataSceneCombatSaveSupported(engine, document);
  const old = { ...engine, supportsDataSceneCombatMovement: () => false };
  throws(
    () => preflightDataSceneGameplay(old, resolved, plan, resolved.ids, "scene"),
    /combat-movement/,
  );
  throws(() => assertDataSceneCombatSaveSupported(old, document), /combat movement/);
});
