import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import type { Engine } from "../pkg/ferrum_core.js";
import type { FerrumEngine } from "../src/engineTypes.js";
import { configureDataSceneGameplay } from "../src/dataSceneGameplay.js";
import { resolveCombatNavigation } from "../src/dataSceneCombatNavigation.js";
import {
  combatChaseCommands,
  compileCombatChaseBindings,
  dataSceneCombatCrowdStats,
  supportsDataSceneCombatCrowd,
} from "../src/dataSceneCombatCrowd.js";
import { resolveSceneAuthoringDocument } from "../src/sceneAuthoringDocument.js";
import { bindSceneBehaviorRecipes } from "../src/gameplayAuthoring.js";
import { preflightDataSceneGameplay } from "../src/dataSceneGameplayAuthoring.js";
import { assertDataSceneCombatSaveSupported } from "../src/dataSceneProgress.js";

function document(distance = 12) {
  const components = {
    visual: { kind: "sprite", texture: 1, width: 8, height: 16 },
    collider: { type: "aabb", halfWidth: 2, halfHeight: 2, isTrigger: true },
    layer: "enemy",
    body: { type: "kinematic", heightSpan: { floorId: 0, elevation: 0, height: 8 } },
  };
  return {
    format: "ferrum2d.consumer.scene-authoring",
    version: 1,
    gameplay: {
      primaryActor: "actor",
      combat: true,
      combatNavigation: { maxAgents: 2, crowdAvoidance: { padding: 1 } },
    },
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
      entities: { chaser: { recipes: [{ kind: "chase", speed: 64, stopDistance: distance }] } },
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
test("crowd avoidance is optional, bounded and validates nested fields before activation", () => {
  equal(resolveCombatNavigation({}, "nav").crowdAvoidance, undefined);
  deepEqual(resolveCombatNavigation({ crowdAvoidance: {} }, "nav").crowdAvoidance, { padding: 0 });
  for (const crowdAvoidance of [
    null,
    false,
    [],
    { typo: true },
    { padding: null },
    { padding: -1 },
    { padding: 4097 },
    { padding: Infinity },
    { padding: 1e-100 },
  ])
    throws(() => resolveCombatNavigation({ crowdAvoidance }, "nav"));
  for (const distance of [-1, 4097, 1e39, 1e-100])
    throws(() => resolveSceneAuthoringDocument(document(distance), { validateBindings: true }));
});
test("chase distance batch uses one generation-safe numeric record per source", () => {
  const source = { entityId: 7, entityGeneration: 3 };
  const batch = compileCombatChaseBindings([
    { source, stopDistance: 12 },
    { source: { entityId: 8, entityGeneration: 9 }, stopDistance: 0 },
  ]);
  deepEqual([...batch.agents], [7, 3, 8, 9]);
  deepEqual([...batch.distances], [12, 0]);
  throws(() =>
    compileCombatChaseBindings([
      { source, stopDistance: 12 },
      { source, stopDistance: 20 },
    ]),
  );
  throws(() => compileCombatChaseBindings(new Array(1)));
});
test("new settings use atomic v5 while older navigation keeps its v4 path", () => {
  let v4 = 0,
    v5 = 0;
  const raw = {
    data_scene_projectile_prefabs_version: () => 1,
    data_scene_combat_progress_version: () => 2,
    data_scene_combat_navigation_version: () => 1,
    data_scene_combat_crowd_version: () => 1,
    configure_data_scene_gameplay_v3: () => true,
    configure_data_scene_gameplay_v4: () => {
      v4++;
      return true;
    },
    configure_data_scene_gameplay_v5: (...args: unknown[]) => {
      v5++;
      deepEqual([...(args[8] as Float32Array)], [8, 8, 40, 0.5, 4, 32, 1]);
      deepEqual([...(args[9] as Uint32Array)], [7, 3]);
      deepEqual([...(args[10] as Float32Array)], [12]);
      return true;
    },
  } as unknown as Engine;
  const source = { entityId: 7, entityGeneration: 3 },
    config = { combat: true, primaryActor: { entityId: 1, entityGeneration: 1 } };
  equal(supportsDataSceneCombatCrowd(raw), true);
  equal(configureDataSceneGameplay(raw, { ...config, combatNavigation: {} }), true);
  equal(v4, 1);
  equal(v5, 0);
  equal(
    configureDataSceneGameplay(raw, {
      ...config,
      combatNavigation: { crowdAvoidance: { padding: 1 } },
      chaseBindings: [{ source, stopDistance: 12 }],
    }),
    true,
  );
  equal(v5, 1);
  throws(
    () =>
      configureDataSceneGameplay(
        { ...raw, data_scene_combat_crowd_version: () => 0 } as unknown as Engine,
        { ...config, combatNavigation: { crowdAvoidance: {} } },
      ),
    /combat-crowd/,
  );
  throws(
    () => configureDataSceneGameplay(raw, { ...config, chaseBindings: [] }),
    /require navigation/,
  );
});
test("positive recipe distances require crowd capability and an applied navigation source", () => {
  const resolved = resolveSceneAuthoringDocument(document(), { validateBindings: true });
  const plan = bindSceneBehaviorRecipes(resolved.sceneComposition, resolved.behaviorRecipes);
  const engine = {
    configureDataSceneGameplay: () => true,
    dataSceneCombatStats: () => ({}),
    supportsDataSceneCombatNavigation: () => true,
    supportsDataSceneCombatCrowd: () => true,
  } as unknown as FerrumEngine;
  preflightDataSceneGameplay(engine, resolved, plan, resolved.ids, "scene");
  throws(
    () =>
      preflightDataSceneGameplay(
        { ...engine, supportsDataSceneCombatCrowd: () => false },
        resolved,
        plan,
        resolved.ids,
        "scene",
      ),
    /combat-crowd/,
  );
  const primary = document();
  primary.sceneComposition.prefabs.actor.props = primary.sceneComposition.prefabs.enemy.props;
  throws(() => resolveSceneAuthoringDocument(primary, { validateBindings: true }), /non-primary/);
  const last = {
    ...plan,
    commands: [
      ...plan.commands,
      {
        type: "configureAccelerate" as const,
        recipe: "test",
        tags: [],
        entity: "enemy",
        accelerationX: 0,
        accelerationY: 1,
        maxSpeed: 10,
      },
    ],
  };
  deepEqual(combatChaseCommands(last), []);
});
test("crowd checkpoints reject an older native build and diagnostics keep a separate ABI", () => {
  throws(
    () =>
      assertDataSceneCombatSaveSupported(
        {
          supportsDataSceneCombatProgress: () => true,
          supportsDataSceneCombatNavigation: () => true,
        } as FerrumEngine,
        document(),
      ),
    /crowd.*compatible/,
  );
  equal(dataSceneCombatCrowdStats({} as Engine), undefined);
  deepEqual(
    dataSceneCombatCrowdStats({
      data_scene_combat_crowd_stats: () => new Uint32Array([1, 1, 3, 7, 100, 80, 4]),
    } as unknown as Engine),
    {
      enabled: true,
      stoppedAgents: 3,
      yieldedMoves: 7,
      neighborTests: 100,
      frameNeighborTests: 80,
      frameAvoidanceMoves: 4,
    },
  );
  throws(() =>
    dataSceneCombatCrowdStats({
      data_scene_combat_crowd_stats: () => new Uint32Array(8),
    } as unknown as Engine),
  );
});
