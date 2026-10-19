import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import type { Engine } from "../pkg/ferrum_core.js";
import type { FerrumEngine } from "../src/engineTypes.js";
import { resolveSceneAuthoringDocument } from "../src/sceneAuthoringDocument.js";
import {
  configureDataSceneGameplay,
  supportsDataSceneSpawnPrefabs,
  supportsDataSceneProjectilePrefabs,
  supportsDataSceneCombatProgress,
} from "../src/dataSceneGameplay.js";
import { compileDataSceneSpawnPrefabs } from "../src/dataSceneSpawnPrefabs.js";
import {
  combatSpawnPrefabNames,
  type DataSceneCombatSpawnProgressSnapshot,
  type DataSceneCombatSpawnedActorState,
} from "../src/dataSceneSpawnProgress.js";
import {
  combatProgressValues,
  decodeCombatProgress,
  validateDataSceneCombatProgress,
} from "../src/dataSceneCombatProgress.js";
import {
  attachDataSceneRuntimeEngineAdapter,
  applyDataSceneAuthoringDocument,
} from "../src/dataSceneRuntimeTarget.js";
import {
  attachDataSceneProgressAdapter,
  preflightDataSceneProgressRestore,
} from "../src/dataSceneProgress.js";
import { assertDataSceneCombatSaveSupported } from "../src/dataSceneProgress.js";

function document() {
  const components = {
    visual: { kind: "sprite", texture: 1, width: 8, height: 16 },
    collider: { type: "aabb", halfWidth: 2, halfHeight: 2 },
    layer: "enemy",
    body: { type: "kinematic", heightSpan: { floorId: 0, elevation: 0, height: 8 } },
  };
  return {
    format: "ferrum2d.consumer.scene-authoring",
    version: 1,
    gameplay: {
      combat: true,
      primaryActor: "actor",
      spawnPrefabs: { minion: { prototypeInstanceId: "seed" } },
    },
    ids: { actions: { summon: 7, fire: 8 }, timers: { spawn: 9 }, prefabs: { minion: 0xffffffff } },
    sceneComposition: {
      initialFragment: "arena",
      prefabs: {
        actor: { props: { components, behaviorRecipes: ["spawner"] } },
        seed: { props: { components, behaviorRecipes: ["seed"] } },
      },
      fragments: {
        arena: {
          instances: [
            { id: "actor", prefab: "actor", x: 0, y: 0 },
            { id: "seed", prefab: "seed", x: 80, y: 0 },
          ],
        },
      },
    },
    behaviorRecipes: {
      entities: {
        spawner: {
          recipes: [
            {
              kind: "spawnPrefabAction",
              action: "summon",
              prefab: "minion",
              cooldownSeconds: 1,
              offsetX: 12,
              offsetY: -6,
            },
          ],
        },
        seed: {
          recipes: [
            { kind: "health", max: 10, start: 4 },
            {
              kind: "projectileAction",
              action: "fire",
              aim: "targetPlayer",
              collisionTarget: "player",
              cooldownSeconds: 0.5,
            },
          ],
        },
      },
    },
  };
}
function fixture(): {
  source: ReturnType<typeof document>;
  combat: DataSceneCombatSpawnProgressSnapshot;
  instances: { id: string; removed: boolean; interactionConsumed: boolean }[];
} {
  const source = document(),
    state: DataSceneCombatSpawnedActorState = {
      pose: {
        x: 12,
        y: -6,
        rotationRadians: 0,
        heightSpan: { floorId: 0, elevation: 0, height: 8 },
      },
      velocityX: 1,
      velocityY: 0,
      angularVelocityRadiansPerSecond: 0,
      health: 3,
      lifetimeSeconds: null,
      timer: null,
      actionCooldowns: [{ actionId: 8, remainingSeconds: 0.2 }],
      reactionCooldowns: [],
      interactionConsumed: false,
      bodyEnabled: true,
      colliderEnabled: [false],
      animation: null,
      legacyAnimation: null,
      visualElevation: 0,
      origin: { x: 12, y: -6 },
    };
  const combat: DataSceneCombatSpawnProgressSnapshot = {
    version: 3,
    lastSpawnSerial: 9,
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
        actionCooldowns: [{ actionId: 7, remainingSeconds: 0.4 }],
        reactionCooldowns: [],
      },
    ],
    spawnedActors: [
      { serial: 3, prefab: "minion", removed: false, state },
      { serial: 8, prefab: "minion", removed: true },
    ],
    projectiles: [
      {
        source: { spawnSerial: 8 },
        x: 10,
        y: 0,
        velocityX: 20,
        velocityY: 0,
        heightSpan: { floorId: 0, elevation: 0, height: 1 },
        lifetimeSeconds: 1,
        damage: 1,
        collisionTarget: "player",
        sprite: { width: 4, height: 4, u0: 0, v0: 0, u1: 1, v1: 1 },
        collider: { halfWidth: 2, halfHeight: 2 },
        billboard: { unitsPerPixel: 1, alphaCutoff: 0.01, elevation: 0 },
        faction: null,
      },
    ],
    contacts: [[{ instanceId: "actor" }, { spawnSerial: 3 }]],
  };
  return {
    source,
    combat,
    instances: [
      { id: "actor", removed: false, interactionConsumed: false },
      { id: "seed", removed: true, interactionConsumed: false },
    ],
  };
}

test("spawn catalog requires stable unique IDs, known standalone prototypes and catalog action references", () => {
  const source = document();
  equal(
    resolveSceneAuthoringDocument(source).gameplay!.spawnPrefabs!.minion.prototypeInstanceId,
    "seed",
  );
  for (const change of [
    { ids: { ...source.ids, prefabs: {} } },
    {
      gameplay: {
        ...source.gameplay,
        spawnPrefabs: { ...source.gameplay.spawnPrefabs, alias: { prototypeInstanceId: "seed" } },
      },
      ids: { ...source.ids, prefabs: { minion: 7, alias: 7 } },
    },
    {
      gameplay: {
        ...source.gameplay,
        spawnPrefabs: { minion: { prototypeInstanceId: "unknown" } },
      },
    },
    { gameplay: { ...source.gameplay, spawnPrefabs: {} } },
    { gameplay: { ...source.gameplay, combat: false } },
  ])
    throws(
      () => resolveSceneAuthoringDocument({ ...source, ...change }),
      /prefab|prototype|combat:true/i,
    );
  source.behaviorRecipes.entities.spawner.recipes[0] = {
    ...source.behaviorRecipes.entities.spawner.recipes[0],
    prefabId: 1,
  } as (typeof source.behaviorRecipes.entities.spawner.recipes)[0];
  throws(() => resolveSceneAuthoringDocument(source), /same declared prefab ID/);
});

test("spawn registration preserves sparse u32 IDs and probes additive capability plus codec3", () => {
  let received: unknown[] = [];
  const runtime = {
    data_scene_spawn_prefabs_version: () => 1,
    data_scene_combat_progress_version: () => 3,
    data_scene_projectile_prefabs_version: () => 1,
    configure_data_scene_gameplay_v3: () => true,
    configure_data_scene_gameplay_v7: (...args: unknown[]) => {
      received = args;
      return true;
    },
  } as unknown as Engine;
  equal(supportsDataSceneSpawnPrefabs(runtime), true);
  equal(supportsDataSceneCombatProgress(runtime), true);
  equal(supportsDataSceneProjectilePrefabs(runtime), true);
  const prototype = { entityId: 3, entityGeneration: 7 },
    bindings = [
      { prefabId: 0xffffffff, prototype },
      { prefabId: 2, prototype },
    ];
  equal(
    configureDataSceneGameplay(runtime, {
      combat: true,
      primaryActor: prototype,
      spawnPrefabs: bindings,
    }),
    true,
  );
  deepEqual([...(received[12] as Uint32Array)], [2, 3, 7, 0xffffffff, 3, 7]);
  throws(
    () => compileDataSceneSpawnPrefabs([bindings[0]!, bindings[0]!]),
    /unique positive uint32/,
  );
  for (const version of [undefined, 1, 2, 5])
    equal(
      supportsDataSceneSpawnPrefabs({
        ...runtime,
        data_scene_combat_progress_version: () => version,
      } as unknown as Engine),
      false,
    );
});

test("spawn codec3 preserves removed sources, sparse IDs, contacts, flags and last issued serial", () => {
  const { source, combat, instances } = fixture(),
    ids = ["seed", "actor"],
    names = combatSpawnPrefabNames(source);
  validateDataSceneCombatProgress(combat, source, instances);
  const values = combatProgressValues(combat, ids, [], names);
  equal(values[4], 2);
  equal(values[5], 9);
  equal(values[6 + 144 + 1], 0xffffffff);
  const decoded = decodeCombatProgress(values, ids, [], names);
  deepEqual(decoded, combat);
  validateDataSceneCombatProgress(decoded, source, instances);
  deepEqual(combatProgressValues(decoded, ids, [], names), values);
  const empty = { ...combat, spawnedActors: [], projectiles: [], contacts: [] };
  const recovered = decodeCombatProgress(
    combatProgressValues(empty, ids, [], names),
    ids,
    [],
    names,
  );
  equal(recovered.version, 3);
  if (recovered.version === 3) equal(recovered.lastSpawnSerial, 9);
  throws(() => combatProgressValues(combat, ids), /spawn prefab is missing/);
  throws(() => decodeCombatProgress(values.slice(0, -1), ids, [], names), /codec layout/);
});

test("spawn checkpoints reject invalid definitions and topology before replacing the running scene", () => {
  const { source, combat, instances } = fixture(),
    actor = combat.spawnedActors[0]!;
  if (actor.removed) throw Error("fixture requires a live spawn");
  const invalid: unknown[] = [
    { ...combat, lastSpawnSerial: 7 },
    { ...combat, spawnedActors: [...combat.spawnedActors].reverse() },
    { ...combat, spawnedActors: [actor, actor] },
    { ...combat, projectiles: [] },
    { ...combat, projectiles: [{ ...combat.projectiles[0], source: { spawnSerial: 12 } }] },
    {
      ...combat,
      projectiles: [{ ...combat.projectiles[0], source: { instanceId: "actor", spawnSerial: 8 } }],
    },
    { ...combat, contacts: [[{ instanceId: "actor" }, { spawnSerial: 8 }]] },
    ...[
      { health: 5 },
      { colliderEnabled: [] },
      { interactionConsumed: true },
      { bodyEnabled: null },
      { visualElevation: 1 },
      { animation: { clip: 1 } },
      { extra: true },
      { pose: null },
      { origin: { x: 1e7, y: 0 } },
    ].map((state) => ({
      ...combat,
      spawnedActors: [{ ...actor, state: { ...actor.state, ...state } }, combat.spawnedActors[1]],
    })),
  ];
  let mutations = 0;
  const engine = {
    supportsDataSceneSpawnPrefabs: () => true,
    supportsDataSceneCombatProgress: () => true,
    useDataScene: () => {
      mutations++;
    },
  } as unknown as FerrumEngine;
  attachDataSceneProgressAdapter(engine, {
    epoch: () => 1,
    capture: () => new Uint32Array(),
    navigation: () => new Float64Array(),
    obstacles: () => new Uint32Array(),
    animations: () => new Float64Array(),
    spatialRevision: () => 1,
    viewport: () => ({ width: 800, height: 480 }),
    spatial: () => new Float64Array(),
    preflightSpatial: () => true,
    restore: () => {
      mutations++;
      return true;
    },
  });
  for (const value of invalid) {
    throws(() => validateDataSceneCombatProgress(value, source, instances), /combat progress/);
    throws(
      () =>
        preflightDataSceneProgressRestore(
          engine,
          {},
          { instances, navigation: null, combat: value } as never,
          source,
        ),
      /combat progress/,
    );
  }
  equal(mutations, 0);
});

test("old spawn Wasm refuses authoring and saves before mutation", () => {
  let mutations = 0;
  const old = {
    configureDataSceneGameplay: () => true,
    supportsDataSceneSpawnPrefabs: () => false,
    supportsDataSceneCombatProgress: () => true,
    dataSceneCombatStats: () => ({}),
  } as unknown as FerrumEngine;
  const engine = attachDataSceneRuntimeEngineAdapter(old, {
    useDataScene: () => {
      mutations++;
    },
    textureId: () => 1,
    spawnDataSceneEntity: () => {
      mutations++;
      return { entityId: 1, entityGeneration: 1 };
    },
  });
  throws(() => applyDataSceneAuthoringDocument(engine, document()), /spawn-prefab Wasm/);
  throws(() => assertDataSceneCombatSaveSupported(engine, document()), /spawn-prefab.*Wasm/);
  equal(mutations, 0);
});

test("spawn animation presence follows the native single-frame optimization and bounded clip clocks", () => {
  const { source, combat, instances } = fixture(),
    actor = combat.spawnedActors[0]!;
  if (actor.removed) throw Error("fixture requires a live spawn");
  const seed = source.sceneComposition.prefabs.seed,
    components = seed.props.components;
  const withVisual = (visual: unknown) => ({
    ...source,
    sceneComposition: {
      ...source.sceneComposition,
      prefabs: {
        ...source.sceneComposition.prefabs,
        seed: { props: { ...seed.props, components: { ...components, visual } } },
      },
    },
  });
  const change = (state: Partial<DataSceneCombatSpawnedActorState>) => ({
    ...combat,
    spawnedActors: [{ ...actor, state: { ...actor.state, ...state } }, combat.spawnedActors[1]],
  });
  const single = withVisual({ ...components.visual, animation: { frameCount: 1, fps: 10 } });
  validateDataSceneCombatProgress(combat, single, instances);
  throws(
    () =>
      validateDataSceneCombatProgress(
        change({ legacyAnimation: { state: "idle", frame: 0, elapsedSeconds: 0 } }),
        single,
        instances,
      ),
    /legacyAnimation must match/,
  );
  const legacy = withVisual({ ...components.visual, animation: { frameCount: 2, fps: 10 } });
  validateDataSceneCombatProgress(
    change({ legacyAnimation: { state: "moving", frame: 1, elapsedSeconds: 0.01 } }),
    legacy,
    instances,
  );
  throws(
    () =>
      validateDataSceneCombatProgress(
        change({ legacyAnimation: { state: "idle", frame: 2, elapsedSeconds: 0 } }),
        legacy,
        instances,
      ),
    /integer|finite float32/,
  );
  const clips = withVisual({
    ...components.visual,
    animationSet: { clips: [{ id: 6, fps: 2, frames: [{}, {}], loop: true }] },
  });
  const animation = { clip: 6, elapsedSeconds: 0.75, paused: true, flipX: true, flipY: false };
  validateDataSceneCombatProgress(change({ animation }), clips, instances);
  throws(
    () =>
      validateDataSceneCombatProgress(
        change({ animation: { ...animation, elapsedSeconds: 1 } }),
        clips,
        instances,
      ),
    /looping time/,
  );
});

test("spawn consumed interaction validates the final authored upsert", () => {
  const { source, combat, instances } = fixture(),
    actor = combat.spawnedActors[0]!;
  if (actor.removed) throw Error("fixture requires a live spawn");
  const seed = source.behaviorRecipes.entities.seed;
  const document = {
    ...source,
    behaviorRecipes: {
      entities: {
        ...source.behaviorRecipes.entities,
        seed: {
          recipes: [
            ...seed.recipes,
            { kind: "interaction", action: "summon", once: true },
            { kind: "interaction", action: "summon", once: false },
          ],
        },
      },
    },
  };
  throws(
    () =>
      validateDataSceneCombatProgress(
        {
          ...combat,
          spawnedActors: [
            { ...actor, state: { ...actor.state, interactionConsumed: true } },
            combat.spawnedActors[1],
          ],
        },
        document,
        instances,
      ),
    /once interaction/,
  );
});
