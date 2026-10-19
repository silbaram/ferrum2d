import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import type { Engine } from "../pkg/ferrum_core.js";
import { supportsDataSceneCombatActions } from "../src/dataSceneGameplay.js";
import { finalCombatActions } from "../src/dataSceneCombatActions.js";
import { resolveSceneAuthoringDocument } from "../src/sceneAuthoringDocument.js";
import {
  applyGameplayBehaviorCommands,
  bindSceneBehaviorRecipes,
  type GameplayBehaviorRuntimeEngine,
} from "../src/gameplayAuthoring.js";
import { preflightDataSceneGameplay } from "../src/dataSceneGameplayAuthoring.js";
import {
  applyDataSceneAuthoringDocument,
  attachDataSceneRuntimeEngineAdapter,
} from "../src/dataSceneRuntimeTarget.js";
import { assertDataSceneCombatSaveSupported } from "../src/dataSceneProgress.js";
import {
  combatProgressValues,
  decodeCombatProgress,
  validateDataSceneCombatProgress,
  type DataSceneCombatProgressSnapshot,
} from "../src/dataSceneCombatProgress.js";
import type { FerrumEngine } from "../src/engineTypes.js";

function scene(recipes: readonly unknown[], bodyType = "kinematic", layer = "player") {
  return resolveSceneAuthoringDocument({
    format: "ferrum2d.consumer.scene-authoring",
    version: 1,
    gameplay: { primaryActor: "actor", combat: true },
    ids: { actions: { hit: 7, dash: 8 }, timers: { attack: 9 } },
    sceneComposition: {
      initialFragment: "arena",
      prefabs: {
        actor: {
          props: {
            components: {
              visual: { kind: "sprite", texture: 1, width: 8, height: 16 },
              collider: { type: "aabb", halfWidth: 2, halfHeight: 2 },
              layer,
              body: { type: bodyType, heightSpan: { floorId: 0, elevation: 0, height: 8 } },
            },
            behaviorRecipes: ["actions"],
          },
        },
      },
      fragments: { arena: { instances: [{ id: "actor", prefab: "actor", x: 0, y: 0 }] } },
    },
    behaviorRecipes: { entities: { actions: { recipes } } },
  });
}
const modern = {
  configureDataSceneGameplay: () => true,
  dataSceneCombatStats: () => ({}),
  supportsDataSceneCombatActions: () => true,
  supportsDataSceneCombatProgress: () => true,
  supportsDataSceneInputProjectiles: () => true,
} as unknown as FerrumEngine;
const melee = { kind: "meleeAction", action: "hit", range: 24, damage: 2, cooldownSeconds: 0.5 };
const dash = { kind: "dashAction", action: "dash", distance: 32, cooldownSeconds: 0.8 };
const timer = { kind: "timerTrigger", timer: "attack", action: "hit", seconds: 0.2 };
function preflight(document: ReturnType<typeof scene>, engine = modern) {
  const plan = bindSceneBehaviorRecipes(document.sceneComposition, document.behaviorRecipes);
  preflightDataSceneGameplay(engine, document, plan, document.ids, "scene");
  return plan;
}

test("melee/dash require their native capability before authoring activation and save", () => {
  equal(supportsDataSceneCombatActions({} as Engine), false);
  for (const version of [0, 2, undefined, NaN])
    equal(
      supportsDataSceneCombatActions({
        data_scene_combat_actions_version: () => version,
      } as unknown as Engine),
      false,
    );
  equal(
    supportsDataSceneCombatActions({
      data_scene_combat_actions_version: () => 1,
    } as unknown as Engine),
    true,
  );
  const old = { ...modern, supportsDataSceneCombatActions: () => false };
  let mutations = 0;
  const wrapped = attachDataSceneRuntimeEngineAdapter(old, {
    useDataScene() {
      mutations++;
    },
    textureId() {
      mutations++;
      return 1;
    },
    spawnDataSceneEntity() {
      mutations++;
      return { entityId: 1, entityGeneration: 1 };
    },
  });
  for (const recipe of [melee, dash]) {
    throws(() => applyDataSceneAuthoringDocument(wrapped, scene([recipe])), /combat-action Wasm/);
    throws(() => assertDataSceneCombatSaveSupported(old, scene([recipe])), /combat-action Wasm/);
    assertDataSceneCombatSaveSupported(modern, scene([recipe]));
  }
  equal(mutations, 0);
});

test("melee/dash input and timer validation follows final action-id upserts across kinds", () => {
  preflight(scene([melee, dash]));
  preflight(scene([{ ...melee, target: "player" }, timer]));
  preflight(scene([{ ...dash, action: "hit", aim: "targetPlayer" }, timer]));
  for (const recipe of [melee, { ...dash, action: "hit" }])
    throws(() => preflight(scene([recipe, timer])), /timer actions require/);
  throws(
    () => preflight(scene([{ ...melee, target: "player" }, timer, { ...dash, action: "hit" }])),
    /timer actions require/,
  );
  const document = scene([
    { kind: "projectileAction", action: "hit", projectilePrefab: "spark" },
    { ...dash, action: "hit" },
  ]);
  const plan = bindSceneBehaviorRecipes(document.sceneComposition, document.behaviorRecipes);
  deepEqual(
    finalCombatActions(plan.commands, document.ids).map((action) => action.type),
    ["configureDashAction"],
  );
});

test("dash rejects incompatible bodies and float32-invalid payloads before apply", () => {
  throws(() => preflight(scene([dash], "static")), /kinematic AABB/);
  for (const recipe of [
    { ...melee, range: 1e-100 },
    { ...melee, damage: 1e39 },
    { ...dash, distance: 1e39 },
    { ...dash, cooldownSeconds: 1e39 },
  ])
    throws(() => preflight(scene([recipe])), /float32/);
  const document = scene([melee]);
  const arena = document.sceneComposition.fragments.arena!;
  const expanded = {
    ...document,
    sceneComposition: {
      ...document.sceneComposition,
      fragments: {
        arena: {
          ...arena,
          instances: [...arena.instances, { ...arena.instances[0]!, id: "enemy", x: 10 }],
        },
      },
    },
  };
  throws(() => preflight(expanded), /input melee\/dash require the gameplay primaryActor/);
  const rotated = {
    ...document,
    sceneComposition: {
      ...document.sceneComposition,
      fragments: {
        arena: { ...arena, instances: [{ ...arena.instances[0]!, rotationRadians: 0.1 }] },
      },
    },
  };
  throws(
    () => preflight({ ...rotated, behaviorRecipes: scene([dash]).behaviorRecipes }),
    /zero instance rotation/,
  );
});

test("overwritten input actions do not reject valid final timer or prefab bindings", () => {
  const document = scene([{ ...dash, action: "hit" }, { ...melee, target: "player" }, timer]);
  const prefab = document.sceneComposition.prefabs.actor!;
  const expanded = {
    ...document,
    gameplay: { ...document.gameplay, primaryActor: "hero" },
    sceneComposition: {
      ...document.sceneComposition,
      prefabs: {
        ...document.sceneComposition.prefabs,
        hero: { ...prefab, props: { ...prefab.props, behaviorRecipes: [] } },
      },
      fragments: {
        arena: {
          ...document.sceneComposition.fragments.arena!,
          instances: [
            ...document.sceneComposition.fragments.arena!.instances,
            {
              ...document.sceneComposition.fragments.arena!.instances[0]!,
              id: "hero",
              prefab: "hero",
              x: 40,
            },
          ],
        },
      },
    },
  };
  preflight(expanded);
  preflight(
    scene([
      { kind: "projectileAction", action: "hit", projectilePrefab: "not-in-catalog" },
      { ...melee },
    ]),
  );
});

test("full document apply consumes overwritten projectile metadata without a catalog", () => {
  const applied: string[] = [];
  let activated = 0;
  const raw = {
    set_gameplay_action_projectile: () => {
      applied.push("projectile");
      return true;
    },
    set_gameplay_action_melee: () => {
      applied.push("melee");
      return true;
    },
  } as unknown as GameplayBehaviorRuntimeEngine;
  const engine = attachDataSceneRuntimeEngineAdapter(
    {
      ...modern,
      applyGameplayBehaviorCommands: (commands, handles, options) =>
        applyGameplayBehaviorCommands(raw, commands, handles, options),
    },
    {
      useDataScene() {
        activated++;
      },
      textureId() {
        return 1;
      },
      spawnDataSceneEntity() {
        return { entityId: 1, entityGeneration: 1 };
      },
    },
  );
  const result = applyDataSceneAuthoringDocument(
    engine,
    scene([{ kind: "projectileAction", action: "hit", projectilePrefab: "not-in-catalog" }, melee]),
  );
  equal(activated, 1);
  equal(result.entityHandles.actor!.entityId, 1);
  deepEqual(applied, ["projectile", "melee"]);
});

test("spatial dash needs its body height before activation", () => {
  const document = scene([dash]);
  const prefab = document.sceneComposition.prefabs.actor!,
    props = prefab.props as { components: Record<string, unknown> };
  const noHeight = {
    ...document,
    sceneComposition: {
      ...document.sceneComposition,
      prefabs: {
        actor: {
          ...prefab,
          props: {
            ...prefab.props,
            components: { ...props.components, body: { type: "kinematic" } },
          },
        },
      },
    },
    spatial: {
      camera: {
        projection: "orthographic" as const,
        position: { x: 0, y: -100, elevation: 100 },
        target: { x: 0, y: 0, elevation: 0 },
        height: 100,
      },
      terrain: [],
      billboards: {},
    },
  };
  throws(() => preflight(noHeight), /spatial dash requires an authored body heightSpan/);
  throws(
    () => preflight({ ...noHeight, behaviorRecipes: scene([melee]).behaviorRecipes }),
    /spatial melee requires an authored body heightSpan/,
  );
  const { body: _body, ...visualOnly } = props.components;
  const noCollider = {
    ...document,
    behaviorRecipes: scene([melee]).behaviorRecipes,
    sceneComposition: {
      ...document.sceneComposition,
      prefabs: {
        actor: {
          ...prefab,
          props: { ...prefab.props, components: { ...visualOnly, collider: { type: "none" } } },
        },
      },
    },
  };
  throws(() => preflight(noCollider), /melee requires an enabled inline collider/);
});

test("melee/dash cooldown JSON remains lossless through the existing combat codec", () => {
  const document = scene([melee, dash]);
  const instances = [{ id: "actor", removed: false, interactionConsumed: false }];
  const progress: DataSceneCombatProgressSnapshot = {
    version: 1,
    actors: [
      {
        id: "actor",
        pose: { x: 0, y: 0, rotationRadians: 0, heightSpan: { elevation: 0, height: 8 } },
        velocityX: 0,
        velocityY: 0,
        angularVelocityRadiansPerSecond: 0,
        health: null,
        lifetimeSeconds: null,
        timer: null,
        actionCooldowns: [
          { actionId: 7, remainingSeconds: 0.25 },
          { actionId: 8, remainingSeconds: 0.4 },
        ],
        reactionCooldowns: [],
      },
    ],
    projectiles: [],
    contacts: [],
  };
  validateDataSceneCombatProgress(progress, document, instances);
  const values = combatProgressValues(progress, ["actor"]),
    decoded = decodeCombatProgress(values, ["actor"]);
  validateDataSceneCombatProgress(decoded, document, instances);
  deepEqual(combatProgressValues(decoded, ["actor"]), values);
  for (const cooldowns of [
    [],
    [
      { actionId: 7, remainingSeconds: 0.6 },
      { actionId: 8, remainingSeconds: 0.4 },
    ],
  ])
    throws(
      () =>
        validateDataSceneCombatProgress(
          { ...progress, actors: [{ ...progress.actors[0], actionCooldowns: cooldowns }] },
          document,
          instances,
        ),
      /cooldown/i,
    );
});
