import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import type { Engine } from "../pkg/ferrum_core.js";
import type { FerrumEngine } from "../src/engineTypes.js";
import {
  compileDataSceneProjectilePrefabs,
  resolveDataSceneProjectilePrefabs,
} from "../src/dataSceneProjectilePrefabs.js";
import {
  configureDataSceneGameplay,
  supportsDataSceneProjectileVisuals,
} from "../src/dataSceneGameplay.js";
import {
  combatProgressValues,
  decodeCombatProgress,
  validateDataSceneCombatProgress,
} from "../src/dataSceneCombatProgress.js";
import type { DataSceneCombatVisualProgressSnapshot } from "../src/dataSceneProjectileVisualProgress.js";
import {
  applyDataSceneAuthoringDocument,
  attachDataSceneRuntimeEngineAdapter,
} from "../src/dataSceneRuntimeTarget.js";
import {
  attachDataSceneProgressAdapter,
  rememberDataSceneProgressContext,
  restoreDataSceneProgress,
  captureDataSceneProgress,
  assertDataSceneCombatSaveSupported,
} from "../src/dataSceneProgress.js";
import { combatSpawnPrefabNames } from "../src/dataSceneSpawnProgress.js";

function prefab() {
  return {
    sprite: {
      texture: "bolt",
      width: 12,
      height: 4,
      animation: {
        fps: 3,
        loop: true,
        frames: [
          { u0: 0, v0: 0, u1: 0.5, v1: 1 },
          { u0: 1, v0: 0, u1: 0.5, v1: 1 },
        ],
      },
    },
    rotateToVelocity: true,
    collider: { halfWidth: 2, halfHeight: 1 },
    billboard: { unitsPerPixel: 1, alphaCutoff: 0.1, elevation: 0 },
  };
}
function fixture() {
  const source = {
    format: "ferrum2d.consumer.scene-authoring",
    version: 1,
    gameplay: { combat: true, primaryActor: "actor", projectilePrefabs: { spark: prefab() } },
    ids: { actions: { fire: 31 } },
    sceneComposition: {
      initialFragment: "arena",
      prefabs: {
        actor: {
          props: {
            components: {
              visual: { kind: "sprite", texture: 1, width: 8, height: 16 },
              collider: { type: "aabb", halfWidth: 2, halfHeight: 2 },
              body: { type: "kinematic", heightSpan: { floorId: 0, elevation: 0, height: 8 } },
              layer: "player",
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
          recipes: [
            {
              kind: "projectileAction",
              action: "fire",
              cooldownSeconds: 0.5,
              projectilePrefab: "spark",
            },
          ],
        },
      },
    },
  };
  const combat: DataSceneCombatVisualProgressSnapshot = {
    version: 4,
    lastSpawnSerial: 0,
    spawnedActors: [],
    contacts: [],
    actors: [
      {
        id: "actor",
        pose: {
          x: 0,
          y: 0,
          rotationRadians: 0,
          heightSpan: { floorId: 0, elevation: 0, height: 8 },
        },
        velocityX: 0,
        velocityY: 0,
        angularVelocityRadiansPerSecond: 0,
        health: null,
        lifetimeSeconds: null,
        timer: null,
        actionCooldowns: [{ actionId: 31, remainingSeconds: 0.2 }],
        reactionCooldowns: [],
      },
    ],
    projectiles: [
      {
        source: { instanceId: "actor" },
        prefab: "spark",
        x: 8,
        y: 0,
        velocityX: 100,
        velocityY: 50,
        heightSpan: { floorId: 0, elevation: 4, height: 1 },
        lifetimeSeconds: 1,
        damage: 1,
        collisionTarget: "enemies",
        sprite: { width: 12, height: 4, u0: 0.5, v0: 0, u1: 1, v1: 1 },
        collider: { halfWidth: 2, halfHeight: 1 },
        billboard: { unitsPerPixel: 1, alphaCutoff: 0.1, elevation: 0 },
        faction: null,
        animation: { elapsedSeconds: 0.4, paused: false, flipX: true, flipY: false },
      },
    ],
  };
  return {
    source,
    combat,
    instances: [{ id: "actor", removed: false, interactionConsumed: false }],
  };
}

test("animated projectile catalog compiles bounded UVs and visual metadata without changing the static ABI", () => {
  const value = prefab(),
    catalog = resolveDataSceneProjectilePrefabs(
      { spark: { ...value, sprite: { ...value.sprite, texture: 71 } } },
      "prefabs",
    ),
    batch = compileDataSceneProjectilePrefabs(catalog, []);
  equal(batch.values.length, 15);
  deepEqual([...batch.visuals!.metadata], [1, 2, 1, 1]);
  deepEqual([...batch.visuals!.fps], [3]);
  deepEqual([...batch.visuals!.frames], [0, 0, 0.5, 1, 1, 0, 0.5, 1]);
  deepEqual(resolveDataSceneProjectilePrefabs(catalog, "prefabs"), catalog);
  const { animation: _animation, ...sprite } = catalog.spark.sprite;
  equal(
    compileDataSceneProjectilePrefabs(
      { static: { ...catalog.spark, sprite, rotateToVelocity: false } },
      [],
    ).visuals,
    undefined,
  );
  for (const change of [
    { sprite: { ...value.sprite, animation: { ...value.sprite.animation, frames: [] } } },
    {
      sprite: {
        ...value.sprite,
        animation: { ...value.sprite.animation, frames: Array.from({ length: 33 }, () => ({})) },
      },
    },
    { sprite: { ...value.sprite, animation: { ...value.sprite.animation, fps: 0 } } },
    { sprite: { ...value.sprite, animation: { ...value.sprite.animation, loop: 1 } } },
    {
      sprite: {
        ...value.sprite,
        animation: { ...value.sprite.animation, frames: [{ u0: 1, u1: 1 }] },
      },
    },
    { sprite: { ...value.sprite, frame: {} } },
    { rotateToVelocity: 1 },
  ])
    throws(
      () => resolveDataSceneProjectilePrefabs({ spark: { ...value, ...change } }, "prefabs"),
      /frames|float32|boolean|first frame/,
    );
});

test("projectile visual capability probes codec4 and configures the additive native batch", () => {
  let received: unknown[] = [];
  const engine = {
    data_scene_projectile_visuals_version: () => 1,
    data_scene_projectile_prefabs_version: () => 1,
    data_scene_combat_progress_version: () => 4,
    configure_data_scene_gameplay_v3: () => true,
    configure_data_scene_gameplay_v8: (...args: unknown[]) => {
      received = args;
      return true;
    },
  } as unknown as Engine;
  equal(supportsDataSceneProjectileVisuals(engine), true);
  const primaryActor = { entityId: 1, entityGeneration: 2 };
  equal(
    configureDataSceneGameplay(
      engine,
      {
        combat: true,
        primaryActor,
        projectilePrefabs: { spark: prefab() },
        projectileBindings: [{ source: primaryActor, actionId: 31, prefab: "spark" }],
      },
      () => 71,
    ),
    true,
  );
  deepEqual([...(received[13] as Uint32Array)], [1, 2, 1, 1]);
  deepEqual([...(received[14] as Float32Array)], [3]);
  equal((received[15] as Float32Array).length, 8);
  for (const version of [undefined, 1, 2, 3, 5])
    equal(
      supportsDataSceneProjectileVisuals({
        ...engine,
        data_scene_combat_progress_version: () => version,
      } as unknown as Engine),
      false,
    );
});

test("combat codec4 roundtrips per-projectile clocks and explicit source identity", () => {
  const { source, combat, instances } = fixture();
  validateDataSceneCombatProgress(combat, source, instances);
  const values = combatProgressValues(combat, ["actor"], ["spark"]);
  equal(values.length, 111);
  deepEqual([...values.subarray(0, 7)], [4, 1, 1, 0, 0, 0, 0]);
  deepEqual([...values.subarray(105)], [1, 0, 0.4, 0, 1, 0]);
  const decoded = decodeCombatProgress(values, ["actor"], ["spark"]);
  deepEqual(decoded, combat);
  validateDataSceneCombatProgress(decoded, source, instances);
  deepEqual(combatProgressValues(decoded, ["actor"], ["spark"]), values);
  const empty = { ...combat, projectiles: [] };
  validateDataSceneCombatProgress(empty, source, instances);
  deepEqual(
    decodeCombatProgress(combatProgressValues(empty, ["actor"], ["spark"]), ["actor"], ["spark"]),
    empty,
  );
});

test("codec4 rejects mismatched animation definitions, frames, flags and absent actor catalogs", () => {
  const { source, combat, instances } = fixture(),
    shot = combat.projectiles[0]!;
  const invalid = [
    { ...combat, version: 3 },
    { ...combat, lastSpawnSerial: 1 },
    ...[
      { animation: null },
      { animation: { ...shot.animation, elapsedSeconds: 1 } },
      { animation: { ...shot.animation, paused: 0 } },
      { animation: { ...shot.animation, clip: 1 } },
      { sprite: { ...shot.sprite, u0: 0, u1: 0.5 } },
      { source: { spawnSerial: 1 } },
    ].map((change) => ({ ...combat, projectiles: [{ ...shot, ...change }] })),
  ];
  for (const value of invalid)
    throws(() => validateDataSceneCombatProgress(value, source, instances), /combat progress/);
  const values = combatProgressValues(combat, ["actor"], ["spark"]);
  for (const [offset, value] of [
    [6, 1],
    [106, 1],
    [108, 2],
  ]) {
    const copy = values.slice();
    copy[offset!] = value!;
    throws(() => decodeCombatProgress(copy, ["actor"], ["spark"]), /native/);
  }
});

test("codec4 retains the C4 actor catalog and removed spawned projectile sources", () => {
  const { source, combat, instances } = fixture();
  const doc = {
    ...source,
    gameplay: { ...source.gameplay, spawnPrefabs: { minion: { prototypeInstanceId: "actor" } } },
    ids: { ...source.ids, prefabs: { minion: 0xffffffff } },
  };
  const progress: DataSceneCombatVisualProgressSnapshot = {
    ...combat,
    lastSpawnSerial: 8,
    spawnedActors: [{ serial: 8, prefab: "minion", removed: true }],
    projectiles: [{ ...combat.projectiles[0]!, source: { spawnSerial: 8 } }],
  };
  validateDataSceneCombatProgress(progress, doc, instances);
  const names = combatSpawnPrefabNames(doc),
    values = combatProgressValues(progress, ["actor"], ["spark"], names);
  deepEqual([...values.subarray(4, 7)], [1, 8, 1]);
  deepEqual(decodeCombatProgress(values, ["actor"], ["spark"], names), progress);
});

test("old Wasm refuses projectile animation/rotation before activation, assets or save", () => {
  let mutations = 0;
  const old = {
    configureDataSceneGameplay: () => true,
    dataSceneCombatStats: () => ({}),
    supportsDataSceneProjectilePrefabs: () => true,
    supportsDataSceneProjectileVisuals: () => false,
    supportsDataSceneCombatProgress: () => true,
  } as unknown as FerrumEngine;
  const engine = attachDataSceneRuntimeEngineAdapter(old, {
    useDataScene: () => {
      mutations++;
    },
    textureId: () => {
      mutations++;
      return 71;
    },
    spawnDataSceneEntity: () => {
      mutations++;
      return { entityId: 1, entityGeneration: 1 };
    },
  });
  const { source } = fixture();
  throws(() => applyDataSceneAuthoringDocument(engine, source), /projectile-visual Wasm/);
  throws(() => assertDataSceneCombatSaveSupported(engine, source), /animation\/rotation/);
  equal(mutations, 0);
});

test("successful flat progress restore refreshes revision without allowing later runtime spatial edits", () => {
  let revision = 1,
    succeeds = true;
  const engine = { clearDataSceneNavigation: () => true } as unknown as FerrumEngine;
  const document = {
    format: "ferrum2d.consumer.scene-authoring",
    version: 1,
    sceneComposition: {
      initialFragment: "empty",
      prefabs: {},
      fragments: { empty: { instances: [] } },
    },
    behaviorRecipes: { entities: {} },
  };
  attachDataSceneProgressAdapter(engine, {
    epoch: () => 1,
    capture: () => new Uint32Array(),
    animations: () => new Float64Array(),
    navigation: () => new Float64Array(),
    obstacles: () => new Uint32Array(),
    spatial: () => new Float64Array([0]),
    spatialRevision: () => revision,
    viewport: () => ({ width: 800, height: 480 }),
    preflightSpatial: () => true,
    restore: () => {
      if (succeeds) revision++;
      return succeeds;
    },
  });
  rememberDataSceneProgressContext(engine, document, {}, {});
  const progress = { instances: [], navigation: null };
  deepEqual(captureDataSceneProgress(engine, document), progress);
  restoreDataSceneProgress(engine, progress, {});
  deepEqual(captureDataSceneProgress(engine, document), progress);
  revision++;
  succeeds = false;
  throws(() => restoreDataSceneProgress(engine, progress, {}), /restore rejected/);
  throws(() => captureDataSceneProgress(engine, document), /runtime spatial configuration/);
});
