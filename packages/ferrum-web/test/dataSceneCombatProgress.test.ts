import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import {
  combatProgressValues,
  decodeCombatProgress,
  validateDataSceneCombatProgress,
  type DataSceneCombatProgressSnapshot,
} from "../src/dataSceneCombatProgress.js";
import {
  preflightDataSceneProgressRestore,
  attachDataSceneProgressAdapter,
  type DataSceneProgressSnapshot,
} from "../src/dataSceneProgress.js";
import { supportsDataSceneCombatProgress } from "../src/dataSceneGameplay.js";
import {
  captureGameStateSnapshot,
  hashGameStateSnapshot,
  restoreGameStateSnapshot,
  validateDataSceneStateSnapshot,
  type GameStateSnapshot,
  type GameStateSnapshotJsonValue,
} from "../src/gameStateSnapshot.js";
import type { Engine } from "../pkg/ferrum_core.js";
import type { FerrumEngine } from "../src/engineTypes.js";
import type { PhysicsWorldApplyResult } from "../src/physicsAuthoring.js";

function fixture() {
  const components = {
    visual: { kind: "sprite", texture: 1, width: 12, height: 16 },
    collider: { type: "aabb", halfWidth: 4, halfHeight: 4 },
    layer: "player",
    body: { type: "kinematic", heightSpan: { floorId: 0, elevation: 4, height: 8 } },
  };
  const document = {
    format: "ferrum2d.consumer.scene-authoring",
    version: 1,
    gameplay: { primaryActor: "player", combat: true },
    ids: { actions: { fire: 0xffffffff }, timers: { fire: 12 } },
    sceneComposition: {
      initialFragment: "arena",
      prefabs: {
        player: { props: { components, behaviorRecipes: ["player"] } },
        enemy: { props: { components, behaviorRecipes: ["enemy"] } },
      },
      fragments: {
        arena: {
          instances: [
            { id: "player", prefab: "player", x: 0, y: 0 },
            { id: "enemy", prefab: "enemy", x: 30, y: 0 },
            { id: "dead", prefab: "enemy", x: 20, y: 0 },
          ],
        },
      },
    },
    behaviorRecipes: {
      entities: {
        player: {
          recipes: [
            { kind: "health", max: 10 },
            { kind: "projectileAction", action: "fire", cooldownSeconds: 0.4 },
            {
              kind: "collisionParticle",
              presetId: 3,
              target: "self",
              cooldownSeconds: 0.5,
              trigger: "enter",
            },
          ],
        },
        enemy: {
          recipes: [
            { kind: "health", max: 3 },
            {
              kind: "projectileAction",
              action: "fire",
              aim: "targetPlayer",
              collisionTarget: "player",
              cooldownSeconds: 0.5,
            },
            { kind: "timerTrigger", timer: "fire", action: "fire", seconds: 0.6 },
          ],
        },
      },
    },
  };
  const combat: DataSceneCombatProgressSnapshot = {
    version: 1,
    actors: [
      {
        id: "player",
        pose: {
          x: 0,
          y: 0,
          rotationRadians: 0,
          heightSpan: { floorId: 0, elevation: 4, height: 8 },
        },
        velocityX: 2,
        velocityY: 0,
        angularVelocityRadiansPerSecond: 0,
        health: 7,
        lifetimeSeconds: null,
        timer: null,
        actionCooldowns: [{ actionId: 0xffffffff, remainingSeconds: 0.1 }],
        reactionCooldowns: [0.2],
      },
      {
        id: "enemy",
        pose: {
          x: 30,
          y: 0,
          rotationRadians: 0,
          heightSpan: { floorId: 0, elevation: 4, height: 8 },
        },
        velocityX: 0,
        velocityY: 0,
        angularVelocityRadiansPerSecond: 0,
        health: 2,
        lifetimeSeconds: null,
        timer: { timerId: 12, remainingSeconds: 0.2, fired: false },
        actionCooldowns: [{ actionId: 0xffffffff, remainingSeconds: 0.3 }],
        reactionCooldowns: [],
      },
    ],
    projectiles: [
      {
        sourceInstanceId: "dead",
        x: 22,
        y: 0,
        velocityX: 10,
        velocityY: 0,
        heightSpan: { floorId: 0, elevation: 8, height: 1 },
        lifetimeSeconds: 0.6,
        damage: 1,
        collisionTarget: "player",
        sprite: { width: 4, height: 4, u0: 1, v0: 0, u1: 0, v1: 1 },
        collider: { halfWidth: 2, halfHeight: 2 },
        billboard: { unitsPerPixel: 1, alphaCutoff: 0.01, elevation: 7 },
        faction: { id: 31, damageMask: 0xffffffff },
      },
    ],
    contacts: [["player", "enemy"]],
  };
  const progress: DataSceneProgressSnapshot = {
    instances: [
      { id: "player", removed: false, interactionConsumed: false },
      { id: "enemy", removed: false, interactionConsumed: false },
      { id: "dead", removed: true, interactionConsumed: false },
    ],
    navigation: null,
    combat,
  };
  return { document, progress, combat };
}

test("combat codec remaps removed sources and preserves u32 IDs, flipped atlas UVs and contact identities", () => {
  const { document, progress, combat } = fixture();
  validateDataSceneCombatProgress(combat, document, progress.instances);
  const ids = ["enemy", "dead", "player"],
    values = combatProgressValues(combat, ids),
    decoded = decodeCombatProgress(values, ids);
  equal(values.length, 247);
  if (decoded.version === 3 || decoded.version === 4)
    throw Error("legacy fixture must remain version 1");
  equal(decoded.projectiles[0]!.sourceInstanceId, "dead");
  equal(decoded.projectiles[0]!.sprite.u0, 1);
  equal(decoded.projectiles[0]!.sprite.u1, 0);
  equal(
    decoded.actors.find((actor) => actor.id === "player")!.actionCooldowns[0]!.actionId,
    0xffffffff,
  );
  equal(decoded.projectiles[0]!.faction!.damageMask, 0xffffffff);
  deepEqual(new Set(decoded.contacts[0]), new Set(["player", "enemy"]));
  validateDataSceneCombatProgress(decoded, document, progress.instances);
  deepEqual(combatProgressValues(decoded, ids), values);
});

test("combat semantic validation rejects incomplete topology, components and authored cooldown mismatches", () => {
  const { document, progress, combat } = fixture(),
    actor = combat.actors[0]!,
    shot = combat.projectiles[0]!;
  const invalid: unknown[] = [
    { ...combat, version: 3 },
    { ...combat, extra: true },
    { ...combat, actors: [] },
    { ...combat, actors: [...combat.actors, actor] },
    { ...combat, actors: combat.actors.map((a) => (a.id === "player" ? { ...a, id: "dead" } : a)) },
    ...[
      { health: null },
      { health: 11 },
      { health: 0 },
      { lifetimeSeconds: 1 },
      { velocityX: Infinity },
      { actionCooldowns: [] },
      { actionCooldowns: [{ actionId: 2, remainingSeconds: 0.1 }] },
      { actionCooldowns: [{ actionId: 0xffffffff, remainingSeconds: 0.5 }] },
      { reactionCooldowns: [] },
      { reactionCooldowns: [0.6] },
      { reactionCooldowns: new Array(1) },
    ].map((change) => ({ ...combat, actors: [{ ...actor, ...change }, combat.actors[1]] })),
    {
      ...combat,
      actors: [
        actor,
        { ...combat.actors[1], timer: { timerId: 13, remainingSeconds: 0.2, fired: false } },
      ],
    },
    {
      ...combat,
      actors: [
        actor,
        { ...combat.actors[1], timer: { timerId: 12, remainingSeconds: 0.2, fired: true } },
      ],
    },
    ...[
      { sourceInstanceId: "missing" },
      { lifetimeSeconds: 1e-100 },
      { damage: NaN },
      { faction: { id: 32, damageMask: 1 } },
    ].map((change) => ({ ...combat, projectiles: [{ ...shot, ...change }] })),
    { ...combat, projectiles: Array.from({ length: 513 }, () => shot) },
    { ...combat, contacts: [["player", "dead"]] },
    {
      ...combat,
      contacts: [
        ["player", "enemy"],
        ["enemy", "player"],
      ],
    },
  ];
  for (const value of invalid)
    throws(
      () => validateDataSceneCombatProgress(value, document, progress.instances),
      /combat progress/,
    );
  throws(
    () =>
      validateDataSceneCombatProgress(
        combat,
        { ...document, gameplay: { primaryActor: "player" } },
        progress.instances,
      ),
    /combat authoring document/,
  );
});

test("combat native decode bounds malformed counts before allocating actor slot arrays", () => {
  const { combat } = fixture(),
    values = combatProgressValues(combat, ["player", "enemy", "dead"]);
  for (const count of [NaN, -1, 17, 1e12]) {
    const invalid = values.slice();
    invalid[24] = count;
    throws(() => decodeCombatProgress(invalid, ["player", "enemy", "dead"]), /slot count/);
  }
  throws(
    () => decodeCombatProgress(values.slice(0, -1), ["player", "enemy", "dead"]),
    /codec layout/,
  );
});

test("combat and spatial progress require exactly matching serialized poses before activation", () => {
  const { document, progress, combat } = fixture(),
    actor = combat.actors[0]!;
  const instances = progress.instances.map((instance) =>
    instance.id === "player"
      ? {
          ...instance,
          spatialPose: { ...actor.pose!, heightSpan: actor.pose!.heightSpan, visualElevation: 0 },
        }
      : instance,
  );
  validateDataSceneCombatProgress(combat, document, instances);
  for (const change of [
    { x: 1e-8 },
    { heightSpan: { ...actor.pose!.heightSpan!, elevation: 4.00000001 } },
  ]) {
    const altered = {
      ...combat,
      actors: [{ ...actor, pose: { ...actor.pose, ...change } }, combat.actors[1]],
    };
    throws(
      () => validateDataSceneCombatProgress(altered, document, instances),
      /conflicts with spatial progress/,
    );
  }
});

test("model combat yaw matches spatial yaw, including a cleared camera without generic pose", () => {
  const { document, progress, combat } = fixture(),
    actor = combat.actors[0]!;
  const spatial = {
    camera: {
      projection: "orthographic",
      position: { x: 0, y: -100, elevation: 100 },
      target: { x: 0, y: 0, elevation: 0 },
      height: 100,
    },
    terrain: [],
    billboards: {},
    models: { player: { asset: "model", contentId: "a".repeat(64) } },
  };
  const source = { ...document, spatial },
    yaw = {
      ...combat,
      actors: [{ ...actor, pose: { ...actor.pose, rotationRadians: 0.1 } }, combat.actors[1]],
    };
  throws(
    () => validateDataSceneCombatProgress(yaw, source, progress.instances),
    /spatial model rotation/,
  );
  const instances = progress.instances.map((instance) =>
    instance.id === "player"
      ? { ...instance, spatialPose: { ...actor.pose!, rotationRadians: 0.2 } }
      : instance,
  );
  throws(() => validateDataSceneCombatProgress(yaw, source, instances), /spatial model rotation/);
});

function snapshot(document: unknown, progress: DataSceneProgressSnapshot): GameStateSnapshot {
  const scene = {
    score: 3,
    gameState: 1 as const,
    entityCount: 3,
    spriteCount: 3,
    cameraX: 0,
    cameraY: 0,
  };
  const value: GameStateSnapshot = {
    format: "ferrum2d.game-state.snapshot",
    version: 2,
    frame: 4,
    source: "ferrum-runtime",
    scene,
    dataScene: {
      format: "ferrum2d.data-scene-state",
      version: 9,
      scene,
      authoringDocument: document as GameStateSnapshotJsonValue,
      progress,
    },
    snapshotHash: "",
  };
  return { ...value, snapshotHash: hashGameStateSnapshot(value) };
}

test("combat requires nested v9 and complete progress while outer snapshot version remains 2", () => {
  const { document, progress } = fixture(),
    value = snapshot(document, progress);
  validateDataSceneStateSnapshot(value.dataScene);
  equal(value.version, 2);
  for (const version of [2, 5, 6, 7, 8])
    throws(() => validateDataSceneStateSnapshot({ ...value.dataScene, version }), /version 9/);
  throws(
    () => validateDataSceneStateSnapshot({ ...value.dataScene, progress: undefined }),
    /complete combat progress/,
  );
});

test("native combat preflight refusal preserves the running scene before authoring activation", () => {
  const { document, progress } = fixture();
  let mutations = 0,
    preflights = 0;
  const engine = {
    supportsDataSceneCombatProgress: () => true,
    dataSceneCombatEnabled: () => false,
    score: () => 0,
    gameState: () => 2,
    entityCount: () => 9,
    spriteCount: () => 0,
    cameraX: () => 0,
    cameraY: () => 0,
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
    preflightCombat: (states, values) => {
      preflights++;
      equal(states.length, 3);
      equal(values[0], 1);
      return false;
    },
    restore: () => {
      mutations++;
      return true;
    },
  });
  throws(
    () => restoreGameStateSnapshot(engine, snapshot(document, progress)),
    /native checkpoint state/,
  );
  equal(preflights, 1);
  equal(mutations, 0);
  equal(engine.entityCount(), 9);
  throws(
    () =>
      preflightDataSceneProgressRestore(
        engine,
        {},
        { ...progress, combat: { ...progress.combat!, actors: [] } },
        document,
      ),
    /every live authored/,
  );
  equal(preflights, 1);
  equal(mutations, 0);
});

test("combat capture requires progress even when the Wasm build supports checkpoints", () => {
  const { document } = fixture();
  const engine = {
    dataSceneCombatEnabled: () => true,
    supportsDataSceneCombatProgress: () => true,
  } as unknown as FerrumEngine;
  throws(
    () =>
      captureGameStateSnapshot(engine, {
        includeDataSceneState: true,
        dataSceneAuthoringDocument: document as unknown as GameStateSnapshotJsonValue,
      }),
    /requires includeDataSceneProgress/,
  );
  throws(
    () =>
      captureGameStateSnapshot(engine, {
        includeDataSceneState: true,
        includeDataSceneProgress: true,
        dataSceneAuthoringDocument: document as unknown as GameStateSnapshotJsonValue,
        physicsWorld: {} as PhysicsWorldApplyResult,
      }),
    /separate physicsWorld/,
  );
});

test("combat checkpoint capability is independent from input and diagnostics capabilities", () => {
  equal(supportsDataSceneCombatProgress({} as Engine), false);
  for (const version of [0, 5])
    equal(
      supportsDataSceneCombatProgress({
        data_scene_combat_progress_version: () => version,
      } as unknown as Engine),
      false,
    );
  equal(
    supportsDataSceneCombatProgress({
      data_scene_combat_progress_version: () => 1,
    } as unknown as Engine),
    true,
  );
  equal(
    supportsDataSceneCombatProgress({
      data_scene_combat_progress_version: () => 2,
    } as unknown as Engine),
    true,
  );
});
