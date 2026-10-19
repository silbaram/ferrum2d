import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import type { Engine } from "../pkg/ferrum_core.js";
import {
  compileDataSceneProjectilePrefabs,
  resolveDataSceneProjectilePrefabs,
  type DataSceneProjectilePrefabSpec,
} from "../src/dataSceneProjectilePrefabs.js";
import {
  configureDataSceneGameplay,
  supportsDataSceneProjectilePrefabs,
} from "../src/dataSceneGameplay.js";
import { resolveSceneAuthoringDocument } from "../src/sceneAuthoringDocument.js";
import {
  bindSceneBehaviorRecipes,
  applyGameplayBehaviorCommands,
} from "../src/gameplayAuthoring.js";
import type { GameplayBehaviorRuntimeEngine } from "../src/gameplayAuthoring.js";
import {
  applyDataSceneAuthoringDocument,
  attachDataSceneRuntimeEngineAdapter,
} from "../src/dataSceneRuntimeTarget.js";
import type { FerrumEngine } from "../src/engineTypes.js";
import {
  combatProgressValues,
  decodeCombatProgress,
  validateDataSceneCombatProgress,
  type DataSceneCombatProgressSnapshot,
} from "../src/dataSceneCombatProgress.js";
import { compileWeaponProfiles, projectile, weapon } from "../src/projectileAuthoring.js";

function prefab(texture: string | number = "spark"): DataSceneProjectilePrefabSpec {
  return {
    sprite: { texture, width: 12, height: 8, frame: { u0: 0.75, v0: 0.25, u1: 0.25, v1: 0.75 } },
    collider: { halfWidth: 6, halfHeight: 3 },
    billboard: { unitsPerPixel: 0.75, alphaCutoff: 0.25, elevation: 5 },
    color: "#8040ff80",
  };
}
function document() {
  return {
    format: "ferrum2d.consumer.scene-authoring",
    version: 1,
    gameplay: { primaryActor: "actor", combat: true, projectilePrefabs: { spark: prefab() } },
    ids: { actions: { fire: 31 } },
    sceneComposition: {
      initialFragment: "arena",
      prefabs: {
        actor: {
          props: {
            components: {
              visual: { kind: "sprite", texture: 1, width: 12, height: 20 },
              collider: { type: "aabb", halfWidth: 4, halfHeight: 4 },
              layer: "player",
              body: { type: "kinematic", heightSpan: { floorId: 0, elevation: 0, height: 8 } },
            },
            behaviorRecipes: ["actor"],
          },
        },
      },
      fragments: { arena: { instances: [{ id: "actor", prefab: "actor", x: 0, y: 0 }] } },
    },
    behaviorRecipes: {
      entities: {
        actor: {
          recipes: [{ kind: "projectileAction", action: "fire", projectilePrefab: "spark" }],
        },
      },
    },
  };
}

test("projectile prefab validation keeps explicit world collider units and rejects unsupported or unrepresentable fields", () => {
  deepEqual(resolveDataSceneProjectilePrefabs({ spark: prefab() }, "catalog").spark, prefab());
  const p = prefab();
  for (const invalid of [
    null,
    [],
    { bad: prefab(0x1000000) },
    { bad: { ...p, animation: {} } },
    { bad: { ...p, sprite: { ...p.sprite, width: 1e-100 } } },
    { bad: { ...p, sprite: { ...p.sprite, frame: { u0: 0.5, u1: 0.5 } } } },
    { bad: { ...p, collider: { ...p.collider, halfWidth: 0 } } },
    { bad: { ...p, billboard: { unitsPerPixel: 10001 } } },
    { bad: { ...p, color: "red" } },
    { bad: { ...p, color: 12 } },
    Object.fromEntries(Array.from({ length: 257 }, (_, i) => [String(i), p])),
  ])
    throws(() => resolveDataSceneProjectilePrefabs(invalid, "catalog"));
});

test("projectile prefab batch uses stable sorted IDs, float32 buffers and renderer color conversion", () => {
  const catalog = { z: prefab(0xffffff), a: prefab(6) };
  const binding = {
    source: { entityId: 12, entityGeneration: 7 },
    actionId: 0xffffffff,
    prefab: "z",
  };
  const batch = compileDataSceneProjectilePrefabs(catalog, [binding], "linear-srgb");
  deepEqual([...batch.metadata], [1, 6, 2, 0xffffff]);
  deepEqual([...batch.bindings], [12, 7, 0xffffffff, 2]);
  equal(batch.values.length, 30);
  equal(batch.values[8], 0.75);
  equal(batch.values[6], 6);
  equal(batch.values[11]! < 0.3, true);
  equal(batch.values[14], Math.fround(128 / 255));
  throws(
    () => compileDataSceneProjectilePrefabs(catalog, [{ ...binding, prefab: "missing" }]),
    /declared projectile prefab/,
  );
  throws(() => compileDataSceneProjectilePrefabs(catalog, [binding, binding]), /only once/);
});

test("projectile prefab runtime configuration is additive and probes both prefab and checkpoint capabilities", () => {
  let calls = 0,
    metadata: Uint32Array | undefined;
  const engine = {
    data_scene_projectile_prefabs_version: () => 1,
    data_scene_combat_progress_version: () => 2,
    configure_data_scene_gameplay_v3: (...args: unknown[]) => {
      calls++;
      metadata = args[5] as Uint32Array;
      return true;
    },
  } as unknown as Engine;
  const config = {
    combat: true,
    primaryActor: { entityId: 3, entityGeneration: 4 },
    projectilePrefabs: { spark: prefab() },
    projectileBindings: [
      { source: { entityId: 3, entityGeneration: 4 }, actionId: 31, prefab: "spark" },
    ],
  };
  equal(supportsDataSceneProjectilePrefabs(engine), true);
  equal(
    configureDataSceneGameplay(engine, config, () => 71),
    true,
  );
  deepEqual([...metadata!], [1, 71]);
  equal(calls, 1);
  throws(() => configureDataSceneGameplay(engine, config), /texture resolver/);
  equal(calls, 1);
  throws(() => configureDataSceneGameplay(engine, config, () => -1), /float32/);
  equal(calls, 1);
  for (const version of [undefined, 0, 1, 5])
    equal(
      supportsDataSceneProjectilePrefabs({
        data_scene_projectile_prefabs_version: () => 1,
        data_scene_combat_progress_version: () => version,
      } as unknown as Engine),
      false,
    );
  throws(() => configureDataSceneGameplay({} as Engine, config), /compatible projectile-prefab/);
});

test("authoring resolves prefab references and refuses standalone command application that cannot consume them", () => {
  const source = document(),
    resolved = resolveSceneAuthoringDocument(source),
    plan = bindSceneBehaviorRecipes(resolved.sceneComposition, resolved.behaviorRecipes);
  equal(plan.commands[0]!.type, "configureProjectileAction");
  throws(
    () =>
      applyGameplayBehaviorCommands({} as GameplayBehaviorRuntimeEngine, plan.commands, {
        actor: { entityId: 1, entityGeneration: 2 },
      }),
    /applyDataSceneAuthoringDocument/,
  );
  source.behaviorRecipes.entities.actor.recipes[0]!.projectilePrefab = "missing";
  throws(
    () => resolveSceneAuthoringDocument(source, { validateBindings: true }),
    /projectilePrefab/,
  );
  const bad = document();
  bad.gameplay.combat = false;
  throws(() => resolveSceneAuthoringDocument(bad), /combat:true/);
});

test("old Wasm and unresolved projectile textures reject before authoring activation or spawning", () => {
  let mutations = 0;
  const mock = {
    configureDataSceneGameplay: () => {
      mutations++;
      return true;
    },
    supportsDataSceneInputProjectiles: () => true,
    supportsDataSceneProjectilePrefabs: () => false,
    dataSceneCombatStats: () => ({}),
  } as unknown as FerrumEngine;
  const engine = attachDataSceneRuntimeEngineAdapter(mock, {
    useDataScene: () => {
      mutations++;
    },
    textureId: () => {
      throw Error("texture not loaded");
    },
    spawnDataSceneEntity: () => {
      mutations++;
      return { entityId: 1, entityGeneration: 2 };
    },
  });
  throws(() => applyDataSceneAuthoringDocument(engine, document()), /compatible projectile-prefab/);
  equal(mutations, 0);
  mock.supportsDataSceneProjectilePrefabs = () => true;
  throws(() => applyDataSceneAuthoringDocument(engine, document()), /texture not loaded/);
  equal(mutations, 0);
});

test("combat checkpoint v2 persists prefab names and remaps catalog order without serializing texture IDs", () => {
  const source = document(),
    p = prefab(),
    progress: DataSceneCombatProgressSnapshot = {
      version: 2,
      actors: [],
      contacts: [],
      projectiles: [
        {
          prefab: "spark",
          sourceInstanceId: "actor",
          x: 10,
          y: 0,
          velocityX: 100,
          velocityY: 0,
          heightSpan: { floorId: 0, elevation: 4, height: 1 },
          lifetimeSeconds: 0.8,
          damage: 1,
          collisionTarget: "enemies",
          sprite: { width: 12, height: 8, u0: 0.75, v0: 0.25, u1: 0.25, v1: 0.75 },
          collider: p.collider,
          billboard: { unitsPerPixel: 0.75, alphaCutoff: 0.25, elevation: 5 },
          faction: null,
        },
      ],
    };
  const instances = [{ id: "actor", removed: true, interactionConsumed: false }];
  validateDataSceneCombatProgress(progress, source, instances);
  const values = combatProgressValues(progress, ["actor"], ["other", "spark"]);
  equal(values.length, 102);
  equal(values[101], 2);
  const decoded = decodeCombatProgress(values, ["actor"], ["other", "spark"]);
  deepEqual(decoded, progress);
  const shifted = combatProgressValues(decoded, ["actor"], ["spark"]);
  equal(shifted[101], 1);
  for (const invalid of [
    { ...progress, version: 1 },
    { ...progress, projectiles: [{ ...progress.projectiles[0], prefab: "missing" }] },
    {
      ...progress,
      projectiles: [
        { ...progress.projectiles[0], sprite: { ...progress.projectiles[0]!.sprite, width: 4 } },
      ],
    },
  ])
    throws(() => validateDataSceneCombatProgress(invalid, source, instances), /combat progress/);
  throws(() => decodeCombatProgress(values, ["actor"], ["spark"]), /prefab is out of bounds/);
  throws(() => combatProgressValues(progress, ["actor"]), /missing from the authored catalog/);
  const json = JSON.stringify(progress);
  equal(json.includes("texture"), false);
});

test("projectile builder carries its optional prefab reference through weapon and recipe compilation", () => {
  const result = compileWeaponProfiles([
    weapon("fire").fire(projectile("spark-shot").prefab("spark")),
  ]);
  const recipe = result.entities.fire.recipes[0]!;
  if (recipe.kind !== "projectileAction") throw Error("wrong recipe");
  equal(recipe.projectilePrefab, "spark");
  throws(() => projectile("bad").prefab(" "), /non-empty/);
});
