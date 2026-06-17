import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";

import {
  GAMEPLAY_BEHAVIOR_BINDING_PROP,
  applyFactionRelationTable,
  applyGameplayBehaviorCommands,
  applySceneBehaviorRecipes,
  bindSceneBehaviorRecipes,
  classifySceneInstance,
  createGameplayBehaviorRuntimeTarget,
  createSceneInstanceHandleRegistry,
  dryRunSceneBehaviorRecipes,
  registerGameplayPrefabs,
  resolveGameplayBehaviorRuntimeIds,
} from "../src/gameplayAuthoring.js";
import type { BehaviorRecipeDocumentSpec, BehaviorRecipeCommand } from "../src/behaviorRecipes.js";
import type {
  FactionRelationRuntimeEngine,
  GameplayBehaviorRuntimeEngine,
  GameplayEntityHandle,
} from "../src/gameplayAuthoring.js";
import type { SceneCompositionSpec } from "../src/sceneComposition.js";

class MockGameplayEngine implements GameplayBehaviorRuntimeEngine, FactionRelationRuntimeEngine {
  readonly calls: unknown[][] = [];
  failNext = false;

  register_gameplay_enemy_prefab(...args: [number]): boolean {
    this.calls.push(["register_gameplay_enemy_prefab", ...args]);
    return this.consumeResult();
  }

  register_gameplay_bullet_prefab(...args: [number]): boolean {
    this.calls.push(["register_gameplay_bullet_prefab", ...args]);
    return this.consumeResult();
  }

  set_gameplay_health(...args: [number, number, number]): boolean {
    this.calls.push(["set_gameplay_health", ...args]);
    return this.consumeResult();
  }

  clear_gameplay_health(...args: [number, number]): boolean {
    this.calls.push(["clear_gameplay_health", ...args]);
    return this.consumeResult();
  }

  set_gameplay_damage(...args: [number, number, number]): boolean {
    this.calls.push(["set_gameplay_damage", ...args]);
    return this.consumeResult();
  }

  set_gameplay_damage_reaction(...args: [number, number, number, number]): boolean {
    this.calls.push(["set_gameplay_damage_reaction", ...args]);
    return this.consumeResult();
  }

  set_gameplay_area_damage_reaction(...args: [number, number, number, number, number]): boolean {
    this.calls.push(["set_gameplay_area_damage_reaction", ...args]);
    return this.consumeResult();
  }

  clear_gameplay_damage(...args: [number, number]): boolean {
    this.calls.push(["clear_gameplay_damage", ...args]);
    return this.consumeResult();
  }

  set_gameplay_faction(...args: [number, number, number, number]): boolean {
    this.calls.push(["set_gameplay_faction", ...args]);
    return this.consumeResult();
  }

  clear_gameplay_faction(...args: [number, number]): boolean {
    this.calls.push(["clear_gameplay_faction", ...args]);
    return this.consumeResult();
  }

  clear_gameplay_faction_relations(): void {
    this.calls.push(["clear_gameplay_faction_relations"]);
  }

  set_gameplay_faction_default_relation(...args: [number]): boolean {
    this.calls.push(["set_gameplay_faction_default_relation", ...args]);
    return this.consumeResult();
  }

  set_gameplay_faction_relation(...args: [number, number, number]): boolean {
    this.calls.push(["set_gameplay_faction_relation", ...args]);
    return this.consumeResult();
  }

  set_gameplay_tags(...args: [number, number, number]): boolean {
    this.calls.push(["set_gameplay_tags", ...args]);
    return this.consumeResult();
  }

  clear_gameplay_tags(...args: [number, number]): boolean {
    this.calls.push(["clear_gameplay_tags", ...args]);
    return this.consumeResult();
  }

  set_gameplay_lifetime(...args: [number, number, number]): boolean {
    this.calls.push(["set_gameplay_lifetime", ...args]);
    return this.consumeResult();
  }

  clear_gameplay_lifetime(...args: [number, number]): boolean {
    this.calls.push(["clear_gameplay_lifetime", ...args]);
    return this.consumeResult();
  }

  set_gameplay_score_reward(...args: [number, number, number]): boolean {
    this.calls.push(["set_gameplay_score_reward", ...args]);
    return this.consumeResult();
  }

  clear_gameplay_score_reward(...args: [number, number]): boolean {
    this.calls.push(["clear_gameplay_score_reward", ...args]);
    return this.consumeResult();
  }

  set_gameplay_pickup(...args: [number, number, number, number, boolean]): boolean {
    this.calls.push(["set_gameplay_pickup", ...args]);
    return this.consumeResult();
  }

  clear_gameplay_pickup(...args: [number, number]): boolean {
    this.calls.push(["clear_gameplay_pickup", ...args]);
    return this.consumeResult();
  }

  set_gameplay_interaction(...args: [number, number, number, number, boolean]): boolean {
    this.calls.push(["set_gameplay_interaction", ...args]);
    return this.consumeResult();
  }

  clear_gameplay_interaction(...args: [number, number]): boolean {
    this.calls.push(["clear_gameplay_interaction", ...args]);
    return this.consumeResult();
  }

  set_gameplay_timer_trigger(...args: [number, number, number, number]): boolean {
    this.calls.push(["set_gameplay_timer_trigger", ...args]);
    return this.consumeResult();
  }

  set_gameplay_timer_action_trigger(...args: [number, number, number, number, number]): boolean {
    this.calls.push(["set_gameplay_timer_action_trigger", ...args]);
    return this.consumeResult();
  }

  clear_gameplay_timer_trigger(...args: [number, number]): boolean {
    this.calls.push(["clear_gameplay_timer_trigger", ...args]);
    return this.consumeResult();
  }

  set_gameplay_action_projectile(...args: [number, number, number, number, number, number, number]): boolean {
    this.calls.push(["set_gameplay_action_projectile", ...args]);
    return this.consumeResult();
  }

  set_gameplay_action_projectile_with_target(...args: [number, number, number, number, number, number, number, number, number, number]): boolean {
    this.calls.push(["set_gameplay_action_projectile_with_target", ...args]);
    return this.consumeResult();
  }

  set_gameplay_action_dash(...args: [number, number, number, number, number]): boolean {
    this.calls.push(["set_gameplay_action_dash", ...args]);
    return this.consumeResult();
  }

  set_gameplay_action_dash_with_aim(...args: [number, number, number, number, number, number]): boolean {
    this.calls.push(["set_gameplay_action_dash_with_aim", ...args]);
    return this.consumeResult();
  }

  set_gameplay_action_melee(...args: [number, number, number, number, number, number]): boolean {
    this.calls.push(["set_gameplay_action_melee", ...args]);
    return this.consumeResult();
  }

  set_gameplay_action_melee_with_target(...args: [number, number, number, number, number, number, number]): boolean {
    this.calls.push(["set_gameplay_action_melee_with_target", ...args]);
    return this.consumeResult();
  }

  set_gameplay_action_spawn_prefab(...args: [number, number, number, number, number, number, number, number, number]): boolean {
    this.calls.push(["set_gameplay_action_spawn_prefab", ...args]);
    return this.consumeResult();
  }

  set_gameplay_action_spawn_projectile_prefab(...args: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number]): boolean {
    this.calls.push(["set_gameplay_action_spawn_projectile_prefab", ...args]);
    return this.consumeResult();
  }

  clear_gameplay_actions(...args: [number, number]): boolean {
    this.calls.push(["clear_gameplay_actions", ...args]);
    return this.consumeResult();
  }

  set_gameplay_movement_chase_player(...args: [number, number, number]): boolean {
    this.calls.push(["set_gameplay_movement_chase_player", ...args]);
    return this.consumeResult();
  }

  set_gameplay_movement_chase_primary_actor(...args: [number, number, number]): boolean {
    this.calls.push(["set_gameplay_movement_chase_primary_actor", ...args]);
    return this.consumeResult();
  }

  set_gameplay_movement_chase_nearest_player(...args: [number, number, number]): boolean {
    this.calls.push(["set_gameplay_movement_chase_nearest_player", ...args]);
    return this.consumeResult();
  }

  set_gameplay_movement_chase_nearest_primary_actor(...args: [number, number, number]): boolean {
    this.calls.push(["set_gameplay_movement_chase_nearest_primary_actor", ...args]);
    return this.consumeResult();
  }

  set_gameplay_movement_chase_nearest_enemy(...args: [number, number, number]): boolean {
    this.calls.push(["set_gameplay_movement_chase_nearest_enemy", ...args]);
    return this.consumeResult();
  }

  set_gameplay_movement_chase_nearest_layer(...args: [number, number, number, number]): boolean {
    this.calls.push(["set_gameplay_movement_chase_nearest_layer", ...args]);
    return this.consumeResult();
  }

  set_gameplay_movement_chase_nearest_faction(...args: [number, number, number, number]): boolean {
    this.calls.push(["set_gameplay_movement_chase_nearest_faction", ...args]);
    return this.consumeResult();
  }

  set_gameplay_movement_chase_nearest_tag(...args: [number, number, number, number]): boolean {
    this.calls.push(["set_gameplay_movement_chase_nearest_tag", ...args]);
    return this.consumeResult();
  }

  set_gameplay_movement_chase_entity(...args: [number, number, number, number, number]): boolean {
    this.calls.push(["set_gameplay_movement_chase_entity", ...args]);
    return this.consumeResult();
  }

  set_gameplay_movement_seek_target_player(...args: [number, number, number, number]): boolean {
    this.calls.push(["set_gameplay_movement_seek_target_player", ...args]);
    return this.consumeResult();
  }

  set_gameplay_movement_seek_target_primary_actor(...args: [number, number, number, number]): boolean {
    this.calls.push(["set_gameplay_movement_seek_target_primary_actor", ...args]);
    return this.consumeResult();
  }

  set_gameplay_movement_seek_target_nearest_player(...args: [number, number, number, number]): boolean {
    this.calls.push(["set_gameplay_movement_seek_target_nearest_player", ...args]);
    return this.consumeResult();
  }

  set_gameplay_movement_seek_target_nearest_primary_actor(...args: [number, number, number, number]): boolean {
    this.calls.push(["set_gameplay_movement_seek_target_nearest_primary_actor", ...args]);
    return this.consumeResult();
  }

  set_gameplay_movement_seek_target_nearest_enemy(...args: [number, number, number, number]): boolean {
    this.calls.push(["set_gameplay_movement_seek_target_nearest_enemy", ...args]);
    return this.consumeResult();
  }

  set_gameplay_movement_seek_target_nearest_layer(...args: [number, number, number, number, number]): boolean {
    this.calls.push(["set_gameplay_movement_seek_target_nearest_layer", ...args]);
    return this.consumeResult();
  }

  set_gameplay_movement_seek_target_nearest_faction(...args: [number, number, number, number, number]): boolean {
    this.calls.push(["set_gameplay_movement_seek_target_nearest_faction", ...args]);
    return this.consumeResult();
  }

  set_gameplay_movement_seek_target_nearest_tag(...args: [number, number, number, number, number]): boolean {
    this.calls.push(["set_gameplay_movement_seek_target_nearest_tag", ...args]);
    return this.consumeResult();
  }

  set_gameplay_movement_seek_target_entity(...args: [number, number, number, number, number, number]): boolean {
    this.calls.push(["set_gameplay_movement_seek_target_entity", ...args]);
    return this.consumeResult();
  }

  set_gameplay_movement_accelerate(...args: [number, number, number, number, number]): boolean {
    this.calls.push(["set_gameplay_movement_accelerate", ...args]);
    return this.consumeResult();
  }

  add_gameplay_collision_damage(...args: [number, number, number]): boolean {
    this.calls.push(["add_gameplay_collision_damage", ...args]);
    return this.consumeResult();
  }

  add_gameplay_collision_area_damage(...args: [number, number, number, number]): boolean {
    this.calls.push(["add_gameplay_collision_area_damage", ...args]);
    return this.consumeResult();
  }

  add_gameplay_collision_knockback(...args: [number, number, number, number]): boolean {
    this.calls.push(["add_gameplay_collision_knockback", ...args]);
    return this.consumeResult();
  }

  add_gameplay_collision_emit_effect(...args: [number, number, number, number, number, number, number]): boolean {
    this.calls.push(["add_gameplay_collision_emit_effect", ...args]);
    return this.consumeResult();
  }

  add_gameplay_collision_spawn_prefab(...args: [number, number, number, number, number, number, number, number, number]): boolean {
    this.calls.push(["add_gameplay_collision_spawn_prefab", ...args]);
    return this.consumeResult();
  }

  add_gameplay_collision_pickup(...args: [number, number, number]): boolean {
    this.calls.push(["add_gameplay_collision_pickup", ...args]);
    return this.consumeResult();
  }

  add_gameplay_collision_sound(...args: [number, number, number, number, number]): boolean {
    this.calls.push(["add_gameplay_collision_sound", ...args]);
    return this.consumeResult();
  }

  add_gameplay_collision_sound_with_cooldown(...args: [number, number, number, number, number, number]): boolean {
    this.calls.push(["add_gameplay_collision_sound_with_cooldown", ...args]);
    return this.consumeResult();
  }

  add_gameplay_collision_sound_with_policy(...args: [number, number, number, number, number, number, boolean]): boolean {
    this.calls.push(["add_gameplay_collision_sound_with_policy", ...args]);
    return this.consumeResult();
  }

  add_gameplay_collision_sound_with_trigger(...args: [number, number, number, number, number, number, boolean, number]): boolean {
    this.calls.push(["add_gameplay_collision_sound_with_trigger", ...args]);
    return this.consumeResult();
  }

  add_gameplay_collision_particle(...args: [number, number, number, number]): boolean {
    this.calls.push(["add_gameplay_collision_particle", ...args]);
    return this.consumeResult();
  }

  add_gameplay_collision_particle_with_cooldown(...args: [number, number, number, number, number]): boolean {
    this.calls.push(["add_gameplay_collision_particle_with_cooldown", ...args]);
    return this.consumeResult();
  }

  add_gameplay_collision_particle_with_policy(...args: [number, number, number, number, number, boolean]): boolean {
    this.calls.push(["add_gameplay_collision_particle_with_policy", ...args]);
    return this.consumeResult();
  }

  add_gameplay_collision_particle_with_trigger(...args: [number, number, number, number, number, boolean, number]): boolean {
    this.calls.push(["add_gameplay_collision_particle_with_trigger", ...args]);
    return this.consumeResult();
  }

  add_gameplay_collision_despawn(...args: [number, number, number]): boolean {
    this.calls.push(["add_gameplay_collision_despawn", ...args]);
    return this.consumeResult();
  }

  protected consumeResult(): boolean {
    if (this.failNext) {
      this.failNext = false;
      return false;
    }
    return true;
  }
}

class PayloadMockGameplayEngine extends MockGameplayEngine {
  add_gameplay_collision_emit_effect_with_payload(
    ...args: [number, number, number, number, number, number, number, number, number]
  ): boolean {
    this.calls.push(["add_gameplay_collision_emit_effect_with_payload", ...args]);
    return this.consumeResult();
  }
}

test("resolveGameplayBehaviorRuntimeIds validates named runtime id registries", () => {
  deepEqual(resolveGameplayBehaviorRuntimeIds({
    items: { score: 1 },
    actions: { primary: 1, inspect: 7 },
    prefabs: { enemy: 1 },
    timers: { wake: 6 },
    tags: { hostile: 0, airborne: 7 },
    effects: { impactSpark: 42 },
  }, {
    requiredItems: ["score"],
    requiredActions: ["primary", "inspect"],
    requiredPrefabs: ["enemy"],
    requiredTimers: ["wake"],
    requiredTags: ["hostile", "airborne"],
    requiredEffects: ["impactSpark"],
  }), {
    items: { score: 1 },
    actions: { primary: 1, inspect: 7 },
    prefabs: { enemy: 1 },
    timers: { wake: 6 },
    tags: { hostile: 0, airborne: 7 },
    effects: { impactSpark: 42 },
  });

  expectDiagnostic(
    () => resolveGameplayBehaviorRuntimeIds({ actions: { primary: 0 } }),
    "gameplayRuntimeIds.actions.primary",
  );
  expectDiagnostic(
    () => resolveGameplayBehaviorRuntimeIds({ actions: {} }, { requiredActions: ["primary"] }),
    "gameplayRuntimeIds.actions.primary",
  );
  expectDiagnostic(
    () => resolveGameplayBehaviorRuntimeIds({ prefabs: { enemy: 0 } }),
    "gameplayRuntimeIds.prefabs.enemy",
  );
  expectDiagnostic(
    () => resolveGameplayBehaviorRuntimeIds({ prefabs: {} }, { requiredPrefabs: ["enemy"] }),
    "gameplayRuntimeIds.prefabs.enemy",
  );
  expectDiagnostic(
    () => resolveGameplayBehaviorRuntimeIds({ timers: { wake: 0 } }),
    "gameplayRuntimeIds.timers.wake",
  );
  expectDiagnostic(
    () => resolveGameplayBehaviorRuntimeIds({ timers: {} }, { requiredTimers: ["wake"] }),
    "gameplayRuntimeIds.timers.wake",
  );
  expectDiagnostic(
    () => resolveGameplayBehaviorRuntimeIds({ tags: { hostile: 32 } }),
    "gameplayRuntimeIds.tags.hostile",
  );
  expectDiagnostic(
    () => resolveGameplayBehaviorRuntimeIds({ tags: {} }, { requiredTags: ["hostile"] }),
    "gameplayRuntimeIds.tags.hostile",
  );
  expectDiagnostic(
    () => resolveGameplayBehaviorRuntimeIds({ effects: { impactSpark: 0 } }),
    "gameplayRuntimeIds.effects.impactSpark",
  );
  expectDiagnostic(
    () => resolveGameplayBehaviorRuntimeIds({ effects: {} }, { requiredEffects: ["impactSpark"] }),
    "gameplayRuntimeIds.effects.impactSpark",
  );
});

test("registerGameplayPrefabs applies supported prefab registrations", () => {
  const engine = new MockGameplayEngine();

  const result = registerGameplayPrefabs(engine, [
    { prefab: "eliteEnemy", kind: "enemy" },
    { prefab: "bossEnemy", prefabId: 9, kind: "enemy" },
    { prefab: "rocket", prefabId: 10, kind: "bullet" },
  ], {
    ids: { prefabs: { eliteEnemy: 7 } },
  });

  deepEqual(result.results, [true, true, true]);
  deepEqual(engine.calls, [
    ["register_gameplay_enemy_prefab", 7],
    ["register_gameplay_enemy_prefab", 9],
    ["register_gameplay_bullet_prefab", 10],
  ]);
});

test("registerGameplayPrefabs reports unsupported or missing prefab registrations", () => {
  const engine = new MockGameplayEngine();

  expectDiagnostic(
    () => registerGameplayPrefabs(engine, [{ prefab: "eliteEnemy", kind: "enemy" }]),
    "gameplayPrefabRegistry.registrations.0.prefab",
  );
  expectDiagnostic(
    () => registerGameplayPrefabs(engine, [{ prefab: "eliteEnemy", prefabId: 7, kind: "player" as "enemy" }]),
    "gameplayPrefabRegistry.registrations.0.kind",
  );

  const missingRegistryEngine = new MockGameplayEngine();
  Object.defineProperty(missingRegistryEngine, "register_gameplay_enemy_prefab", { value: undefined });
  expectDiagnostic(
    () => registerGameplayPrefabs(missingRegistryEngine, [{ prefab: "eliteEnemy", prefabId: 7, kind: "enemy" }]),
    "gameplayPrefabRegistry.registrations.0.kind",
  );

  engine.failNext = true;
  expectDiagnostic(
    () => registerGameplayPrefabs(engine, [{ prefab: "eliteEnemy", prefabId: 7, kind: "enemy" }]),
    "gameplayPrefabRegistry.registrations.0",
  );
});

function sampleComposition(): SceneCompositionSpec {
  return {
    initialFragment: "room",
    prefabs: {
      enemy: {
        props: {
          behaviorRecipes: "enemy.runner",
          kind: "enemy",
        },
        variants: {
          elite: {
            props: {
              behaviorRecipes: ["enemy.runner", "enemy.elite"],
              rank: "elite",
            },
          },
        },
      },
      pickup: {
        props: {
          kind: "pickup",
        },
      },
    },
    fragments: {
      room: {
        instances: [
          { id: "runner", prefab: "enemy", x: 4 },
          { id: "elite", prefab: "enemy", variant: "elite", x: 12 },
          { id: "coin", prefab: "pickup" },
        ],
      },
    },
  };
}

function sampleRecipes(): BehaviorRecipeDocumentSpec {
  return {
    recipes: {
      living: { kind: "health", max: 2 },
      contactDamage: { kind: "damage", amount: 1 },
      bulletTtl: { kind: "lifetime", seconds: 0.75 },
      killReward: { kind: "scoreReward", reward: 5 },
    },
    entities: {
      "enemy.runner": {
        recipes: [
          "living",
          "bulletTtl",
          { kind: "chase", target: "primaryActor", speed: 80, stopDistance: 0 },
          { kind: "projectileAction", action: "primary", cooldownSeconds: 0.12, speed: 420, damage: 2, lifetimeSeconds: 1.4 },
          { kind: "meleeAction", action: "slash", cooldownSeconds: 0.35, range: 36, damage: 3 },
        ],
      },
      "enemy.elite": {
        recipes: [
          { use: "contactDamage", id: "eliteDamage", overrides: { amount: 2 } },
          "killReward",
        ],
      },
    },
  };
}

test("bindSceneBehaviorRecipes retargets behavior recipe commands to scene instance ids", () => {
  const plan = bindSceneBehaviorRecipes(sampleComposition(), sampleRecipes());

  deepEqual(plan.instances.map((instance) => instance.id), ["runner", "elite", "coin"]);
  deepEqual(plan.commands.map((command) => `${command.entity}:${command.type}`), [
    "runner:configureHealth",
    "runner:configureLifetime",
    "runner:configureChase",
    "runner:configureProjectileAction",
    "runner:configureMeleeAction",
    "elite:configureHealth",
    "elite:configureLifetime",
    "elite:configureChase",
    "elite:configureProjectileAction",
    "elite:configureMeleeAction",
    "elite:configureDamage",
    "elite:configureScoreReward",
  ]);
  equal(plan.bindings[5].behaviorEntity, "enemy.runner");
  equal(plan.bindings[5].sourceCommand.entity, "enemy.runner");
  equal(plan.bindings[5].command.entity, "elite");
  equal(GAMEPLAY_BEHAVIOR_BINDING_PROP, "behaviorRecipes");
});

test("bindSceneBehaviorRecipes supports kind filters and missing behavior modes", () => {
  const plan = bindSceneBehaviorRecipes(sampleComposition(), sampleRecipes(), {
    kinds: ["damage"],
  });
  deepEqual(plan.commands.map((command) => `${command.entity}:${command.type}`), [
    "elite:configureDamage",
  ]);

  const missing = dryRunSceneBehaviorRecipes(sampleComposition(), sampleRecipes(), {
    missingBehavior: "error",
  });
  equal(missing.ok, false);
  if (!missing.ok) {
    equal(missing.diagnostics[0]?.context?.path, "gameplayAuthoring.instances.2.props.behaviorRecipes");
    equal(missing.diagnostics[0]?.context?.kind, "gameplay-authoring");
  }
});

test("dryRunSceneBehaviorRecipes returns a plan without mutating runtime targets", () => {
  const dryRun = dryRunSceneBehaviorRecipes(sampleComposition(), sampleRecipes());

  equal(dryRun.ok, true);
  if (dryRun.ok) {
    equal(dryRun.plan.fragment, "room");
    equal(dryRun.plan.commands.length, 12);
    deepEqual(dryRun.diagnostics, []);
  }
});

test("classifySceneInstance derives world object and actor authoring roles", () => {
  const plan = bindSceneBehaviorRecipes(sampleComposition(), sampleRecipes());

  deepEqual(plan.instances.map((instance) => classifySceneInstance(instance).kind), [
    "actor",
    "actor",
    "worldObject",
  ]);
  deepEqual(classifySceneInstance(plan.instances[1]!).behaviorProfiles, [
    "enemy.runner",
    "enemy.elite",
  ]);
  equal(classifySceneInstance({
    ...plan.instances[2]!,
    props: {
      components: {
        sprite: { texture: 1, width: 8, height: 8 },
        collider: "none",
        layer: "pickup",
      },
    },
  }).hasDataSceneComponents, true);

  expectDiagnostic(
    () => classifySceneInstance({
      ...plan.instances[2]!,
      props: { behaviorRecipes: [1] },
    }),
    "sceneComposition.instances.coin.props.behaviorRecipes.0",
  );
});

test("agent-attached behavior recipes stay targeted to selected placed instance ids", () => {
  const baseComposition: SceneCompositionSpec = {
    initialFragment: "main",
    prefabs: {
      turret: {
        props: {
          kind: "placement",
        },
      },
      crate: {
        props: {
          kind: "placement",
        },
      },
    },
    fragments: {
      main: {
        instances: [
          { id: "turret_left", prefab: "turret", x: 96, y: 128 },
          { id: "crate_right", prefab: "crate", x: 192, y: 128 },
        ],
      },
    },
  };
  const agentAttachedComposition: SceneCompositionSpec = {
    ...baseComposition,
    prefabs: {
      ...baseComposition.prefabs,
      turret: {
        props: {
          ...baseComposition.prefabs.turret?.props,
          behaviorRecipes: "turret.autofire",
        },
      },
    },
  };
  const agentRecipes: BehaviorRecipeDocumentSpec = {
    entities: {
      "turret.autofire": {
        recipes: [
          { kind: "health", max: 3 },
          {
            kind: "projectileAction",
            action: "primary",
            actionId: 1,
            cooldownSeconds: 0.25,
            speed: 320,
            damage: 1,
            lifetimeSeconds: 1,
          },
        ],
      },
    },
  };

  const dryRun = dryRunSceneBehaviorRecipes(agentAttachedComposition, agentRecipes, {
    missingBehavior: "ignore",
    requireExplicitInstanceIds: true,
  });

  equal(dryRun.ok, true);
  if (dryRun.ok) {
    deepEqual(dryRun.plan.instances.map((instance) => `${instance.id}:${classifySceneInstance(instance).kind}`), [
      "turret_left:actor",
      "crate_right:worldObject",
    ]);
    deepEqual(classifySceneInstance(dryRun.plan.instances[0]!).behaviorProfiles, ["turret.autofire"]);
    deepEqual(dryRun.plan.commands.map((command) => `${command.entity}:${command.type}`), [
      "turret_left:configureHealth",
      "turret_left:configureProjectileAction",
    ]);
  }
  equal(baseComposition.prefabs.turret?.props?.behaviorRecipes, undefined);

  const engine = new MockGameplayEngine();
  const registry = createSceneInstanceHandleRegistry();
  const result = applySceneBehaviorRecipes(engine, {
    spawnSceneInstance(instance) {
      return {
        entityId: instance.id === "turret_left" ? 8 : 9,
        entityGeneration: 0,
      };
    },
  }, agentAttachedComposition, agentRecipes, {
    instanceHandleRegistry: registry,
    missingBehavior: "ignore",
    requireExplicitInstanceIds: true,
  });

  equal(result.entityHandles.turret_left?.entityId, 8);
  equal(result.entityHandles.crate_right?.entityId, 9);
  equal(registry.require("turret_left").entityId, 8);
  equal(registry.require("crate_right").entityId, 9);
  deepEqual(engine.calls, [
    ["set_gameplay_health", 8, 0, 3],
    ["set_gameplay_action_projectile", 8, 0, 1, 0.25, 320, 1, 1],
  ]);
});

test("dryRunSceneBehaviorRecipes returns structured diagnostics for invalid bindings", () => {
  const unknownProfile = dryRunSceneBehaviorRecipes({
    prefabs: {
      enemy: { props: { behaviorRecipes: "missing.profile" } },
    },
    fragments: {
      main: { instances: [{ id: "enemy", prefab: "enemy" }] },
    },
  }, sampleRecipes());
  equal(unknownProfile.ok, false);
  if (!unknownProfile.ok) {
    equal(unknownProfile.diagnostics[0]?.code, "FERRUM_GAMEPLAY_AUTHORING_INVALID");
    equal(unknownProfile.diagnostics[0]?.context?.path, "gameplayAuthoring.instances.0.props.behaviorRecipes");
    equal(unknownProfile.diagnostics[0]?.context?.detail, "references unknown behavior profile 'missing.profile'");
  }

  const invalidBinding = dryRunSceneBehaviorRecipes({
    prefabs: {
      enemy: { props: { behaviorRecipes: [1] } },
    },
    fragments: {
      main: { instances: [{ id: "enemy", prefab: "enemy" }] },
    },
  }, sampleRecipes());
  equal(invalidBinding.ok, false);
  if (!invalidBinding.ok) {
    equal(invalidBinding.diagnostics[0]?.context?.path, "gameplayAuthoring.instances.0.props.behaviorRecipes.0");
    equal(invalidBinding.diagnostics[0]?.context?.detail, "must be a non-empty behavior profile string");
  }
});

test("applyGameplayBehaviorCommands applies supported gameplay component commands to handles", () => {
  const plan = bindSceneBehaviorRecipes(sampleComposition(), sampleRecipes(), {
    kinds: ["health", "damage", "lifetime", "scoreReward", "chase", "projectileAction", "meleeAction"],
  });
  const engine = new MockGameplayEngine();
  const handles: Record<string, GameplayEntityHandle> = {
    runner: { entityId: 1, entityGeneration: 10 },
    elite: { entityId: 2, entityGeneration: 20 },
  };

  const result = applyGameplayBehaviorCommands(engine, plan.commands, handles, {
    ids: { actions: { primary: 1, slash: 3 } },
  });

  deepEqual(result.results, [true, true, true, true, true, true, true, true, true, true, true, true]);
  deepEqual(engine.calls, [
    ["set_gameplay_health", 1, 10, 2],
    ["set_gameplay_lifetime", 1, 10, 0.75],
    ["set_gameplay_movement_chase_primary_actor", 1, 10, 80],
    ["set_gameplay_action_projectile", 1, 10, 1, 0.12, 420, 2, 1.4],
    ["set_gameplay_action_melee", 1, 10, 3, 0.35, 36, 3],
    ["set_gameplay_health", 2, 20, 2],
    ["set_gameplay_lifetime", 2, 20, 0.75],
    ["set_gameplay_movement_chase_primary_actor", 2, 20, 80],
    ["set_gameplay_action_projectile", 2, 20, 1, 0.12, 420, 2, 1.4],
    ["set_gameplay_action_melee", 2, 20, 3, 0.35, 36, 3],
    ["set_gameplay_damage_reaction", 2, 20, 2, 1],
    ["set_gameplay_score_reward", 2, 20, 5],
  ]);
});

test("applySceneBehaviorRecipes spawns scene instances and applies bound behavior commands", () => {
  const engine = new MockGameplayEngine();
  const spawned: string[] = [];
  const result = applySceneBehaviorRecipes(engine, {
    spawnSceneInstance: (instance) => {
      spawned.push(`${instance.id}:${instance.prefab}:${instance.x}`);
      if (instance.id === "runner") {
        return { entityId: 11, entityGeneration: 1 };
      }
      if (instance.id === "elite") {
        return { entityId: 12, entityGeneration: 2 };
      }
      return { entityId: 13, entityGeneration: 3 };
    },
  }, sampleComposition(), sampleRecipes(), {
    kinds: ["health", "damage", "lifetime", "scoreReward"],
  });

  deepEqual(spawned, [
    "runner:enemy:4",
    "elite:enemy:12",
    "coin:pickup:0",
  ]);
  deepEqual(result.spawnResults, [
    { entityId: 11, entityGeneration: 1 },
    { entityId: 12, entityGeneration: 2 },
    { entityId: 13, entityGeneration: 3 },
  ]);
  deepEqual(result.entityHandles, {
    runner: { entityId: 11, entityGeneration: 1 },
    elite: { entityId: 12, entityGeneration: 2 },
    coin: { entityId: 13, entityGeneration: 3 },
  });
  deepEqual(result.behaviorApplyResult.results, [true, true, true, true, true, true]);
  deepEqual(result.plan.commands.map((command) => `${command.entity}:${command.type}`), [
    "runner:configureHealth",
    "runner:configureLifetime",
    "elite:configureHealth",
    "elite:configureLifetime",
    "elite:configureDamage",
    "elite:configureScoreReward",
  ]);
  deepEqual(engine.calls, [
    ["set_gameplay_health", 11, 1, 2],
    ["set_gameplay_lifetime", 11, 1, 0.75],
    ["set_gameplay_health", 12, 2, 2],
    ["set_gameplay_lifetime", 12, 2, 0.75],
    ["set_gameplay_damage_reaction", 12, 2, 2, 1],
    ["set_gameplay_score_reward", 12, 2, 5],
  ]);
});

test("SceneInstanceHandleRegistry tracks instance ids, reverse lookups, and stale handles", () => {
  const liveHandles = new Set(["11:1", "13:3"]);
  const registry = createSceneInstanceHandleRegistry({
    entityExists: (handle) => liveHandles.has(`${handle.entityId}:${handle.entityGeneration}`),
  });

  registry.set("runner", { entityId: 11, entityGeneration: 1 });
  registry.set("elite", { entityId: 12, entityGeneration: 2 });
  registry.set("coin", { entityId: 13, entityGeneration: 3 });

  equal(registry.size, 3);
  deepEqual(registry.get("runner"), { entityId: 11, entityGeneration: 1 });
  equal(registry.instanceIdForHandle({ entityId: 13, entityGeneration: 3 }), "coin");
  deepEqual(registry.pruneStale(), ["elite"]);
  equal(registry.get("elite"), undefined);
  deepEqual(registry.entries(), [
    { instanceId: "runner", handle: { entityId: 11, entityGeneration: 1 } },
    { instanceId: "coin", handle: { entityId: 13, entityGeneration: 3 } },
  ]);
});

test("applySceneBehaviorRecipes syncs instance handle registry on reapply and reorder", () => {
  const registry = createSceneInstanceHandleRegistry();
  const engine = new MockGameplayEngine();
  const firstSpawn = new Map([
    ["runner", { entityId: 11, entityGeneration: 1 }],
    ["elite", { entityId: 12, entityGeneration: 2 }],
    ["coin", { entityId: 13, entityGeneration: 3 }],
  ]);
  const first = applySceneBehaviorRecipes(engine, {
    spawnSceneInstance: (instance) => firstSpawn.get(instance.id)!,
  }, sampleComposition(), sampleRecipes(), {
    instanceHandleRegistry: registry,
    kinds: ["health"],
    requireExplicitInstanceIds: true,
  });

  deepEqual(first.instanceHandleSync?.entries.map((entry) => entry.instanceId), ["runner", "elite", "coin"]);
  equal(registry.instanceIdForHandle({ entityId: 12, entityGeneration: 2 }), "elite");
  deepEqual(registry.get("runner"), { entityId: 11, entityGeneration: 1 });

  const reappliedComposition: SceneCompositionSpec = {
    initialFragment: "room",
    prefabs: sampleComposition().prefabs,
    fragments: {
      room: {
        instances: [
          { id: "coin", prefab: "pickup" },
          { id: "runner", prefab: "enemy", x: 32 },
        ],
      },
    },
  };
  const secondSpawn = new Map([
    ["coin", { entityId: 21, entityGeneration: 1 }],
    ["runner", { entityId: 22, entityGeneration: 1 }],
  ]);
  const second = applySceneBehaviorRecipes(engine, {
    spawnSceneInstance: (instance) => secondSpawn.get(instance.id)!,
  }, reappliedComposition, sampleRecipes(), {
    instanceHandleRegistry: registry,
    kinds: ["health"],
    requireExplicitInstanceIds: true,
  });

  deepEqual(second.instanceHandleSync?.entries.map((entry) => `${entry.instanceId}:${entry.handle.entityId}`), [
    "coin:21",
    "runner:22",
  ]);
  deepEqual(second.instanceHandleSync?.removedInstanceIds, ["elite"]);
  deepEqual(registry.entries().map((entry) => `${entry.instanceId}:${entry.handle.entityId}`), [
    "coin:21",
    "runner:22",
  ]);
  equal(registry.instanceIdForHandle({ entityId: 12, entityGeneration: 2 }), undefined);
});

test("applySceneBehaviorRecipes rejects duplicate instance handles before registry mutation", () => {
  const registry = createSceneInstanceHandleRegistry();
  registry.set("preexisting", { entityId: 99, entityGeneration: 9 });
  const beforeEntries = registry.entries();
  const engine = new MockGameplayEngine();

  expectDiagnostic(
    () => applySceneBehaviorRecipes(engine, {
      spawnSceneInstance: (instance) =>
        instance.id === "coin"
          ? { entityId: 13, entityGeneration: 3 }
          : { entityId: 11, entityGeneration: 1 },
    }, sampleComposition(), sampleRecipes(), {
      instanceHandleRegistry: registry,
      kinds: ["health"],
      requireExplicitInstanceIds: true,
    }),
    "gameplayAuthoring.instanceHandleRegistry.instances.1.handle",
  );

  deepEqual(registry.entries(), beforeEntries);
  deepEqual(engine.calls, []);
});

test("bindSceneBehaviorRecipes can require explicit instance ids for handle registries", () => {
  expectDiagnostic(
    () => bindSceneBehaviorRecipes({
      initialFragment: "room",
      prefabs: {
        enemy: {
          props: { behaviorRecipes: "enemy.runner" },
        },
      },
      fragments: {
        room: {
          instances: [{ prefab: "enemy" }],
        },
      },
    }, sampleRecipes(), {
      requireExplicitInstanceIds: true,
    }),
    "gameplayAuthoring.composition.fragments.room.instances.0.id",
  );
});

test("applySceneBehaviorRecipes validates spawn target handles", () => {
  const engine = new MockGameplayEngine();

  expectDiagnostic(
    () => applySceneBehaviorRecipes(engine, {} as Parameters<typeof applySceneBehaviorRecipes>[1], sampleComposition(), sampleRecipes()),
    "gameplayAuthoring.target",
  );
  expectDiagnostic(
    () => applySceneBehaviorRecipes(engine, {
      spawnSceneInstance: () => ({ entityId: -1, entityGeneration: 0 }),
    }, sampleComposition(), sampleRecipes(), {
      kinds: ["health"],
    }),
    "gameplayAuthoring.instances.0.handle.entityId",
  );
});

test("applyGameplayBehaviorCommands encodes gameplay tags as unsigned masks", () => {
  const engine = new MockGameplayEngine();
  const handles = {
    enemy: { entityId: 1, entityGeneration: 10 },
  };

  const result = applyGameplayBehaviorCommands(engine, [
    {
      entity: "enemy",
      recipe: "entity.tags",
      tags: ["hostile", "boss", "hostile"],
      type: "configureTags",
    },
  ], handles, {
    ids: { tags: { hostile: 5, boss: 31 } },
  });

  deepEqual(result.results, [true]);
  deepEqual(engine.calls, [
    ["set_gameplay_tags", 1, 10, 2 ** 5 + 2 ** 31],
  ]);
});

test("applyGameplayBehaviorCommands accepts max u32-backed faction and tag ids", () => {
  const engine = new MockGameplayEngine();
  const handles = {
    enemy: { entityId: 1, entityGeneration: 10 },
  };

  const result = applyGameplayBehaviorCommands(engine, [
    {
      entity: "enemy",
      recipe: "max.faction",
      tags: [],
      type: "configureFaction",
      faction: 31,
      damages: [31],
    },
    {
      entity: "enemy",
      recipe: "max.tags",
      tags: ["31"],
      type: "configureTags",
    },
    {
      entity: "enemy",
      recipe: "max.chase.faction",
      tags: [],
      type: "configureChase",
      target: "nearestFaction:31",
      speed: 64,
      stopDistance: 0,
    },
    {
      entity: "enemy",
      recipe: "max.chase.tag",
      tags: [],
      type: "configureChase",
      target: "nearestTag:31",
      speed: 62,
      stopDistance: 0,
    },
    {
      entity: "enemy",
      recipe: "max.seek.faction",
      tags: [],
      type: "configureSeekTarget",
      target: "nearestFaction:31",
      speed: 160,
      turnRate: 1.5,
    },
    {
      entity: "enemy",
      recipe: "max.seek.tag",
      tags: [],
      type: "configureSeekTarget",
      target: "nearestTag:31",
      speed: 150,
      turnRate: 1.25,
    },
  ], handles);

  deepEqual(result.results, [true, true, true, true, true, true]);
  deepEqual(engine.calls, [
    ["set_gameplay_faction", 1, 10, 31, 2 ** 31],
    ["set_gameplay_tags", 1, 10, 2 ** 31],
    ["set_gameplay_movement_chase_nearest_faction", 1, 10, 31, 64],
    ["set_gameplay_movement_chase_nearest_tag", 1, 10, 31, 62],
    ["set_gameplay_movement_seek_target_nearest_faction", 1, 10, 31, 160, 1.5],
    ["set_gameplay_movement_seek_target_nearest_tag", 1, 10, 31, 150, 1.25],
  ]);
});

test("applyGameplayBehaviorCommands supports chase entity targets and self damage reactions", () => {
  const engine = new MockGameplayEngine();
  const handles = {
    enemy: { entityId: 1, entityGeneration: 10 },
    target: { entityId: 2, entityGeneration: 20 },
  };

  const result = applyGameplayBehaviorCommands(engine, [
    {
      entity: "enemy",
      recipe: "followPrimaryActor",
      tags: [],
      type: "configureChase",
      target: "primaryActor",
      speed: 76,
      stopDistance: 0,
    },
    {
      entity: "enemy",
      recipe: "followNearestPlayer",
      tags: [],
      type: "configureChase",
      target: "nearestPlayer",
      speed: 72,
      stopDistance: 0,
    },
    {
      entity: "enemy",
      recipe: "followNearestPrimaryActor",
      tags: [],
      type: "configureChase",
      target: "nearestPrimaryActor",
      speed: 68,
      stopDistance: 0,
    },
    {
      entity: "enemy",
      recipe: "followNearestEnemy",
      tags: [],
      type: "configureChase",
      target: "nearestEnemy",
      speed: 48,
      stopDistance: 0,
    },
    {
      entity: "enemy",
      recipe: "followNearestBullet",
      tags: [],
      type: "configureChase",
      target: "nearestLayer:bullet",
      speed: 44,
      stopDistance: 0,
    },
    {
      entity: "enemy",
      recipe: "followNearestEnemyFaction",
      tags: [],
      type: "configureChase",
      target: "nearestFaction:enemy",
      speed: 40,
      stopDistance: 0,
    },
    {
      entity: "enemy",
      recipe: "followNearestHostileTag",
      tags: [],
      type: "configureChase",
      target: "nearestTag:hostile",
      speed: 38,
      stopDistance: 0,
    },
    {
      entity: "enemy",
      recipe: "follow",
      tags: [],
      type: "configureChase",
      target: "target",
      speed: 64,
      stopDistance: 0,
    },
    {
      entity: "enemy",
      recipe: "thorns",
      tags: [],
      type: "configureDamage",
      amount: 3,
      target: "self",
      cooldownSeconds: 0,
    },
  ], handles, {
    ids: { tags: { hostile: 5 } },
  });

  deepEqual(result.results, [true, true, true, true, true, true, true, true, true]);
  deepEqual(engine.calls, [
    ["set_gameplay_movement_chase_primary_actor", 1, 10, 76],
    ["set_gameplay_movement_chase_nearest_player", 1, 10, 72],
    ["set_gameplay_movement_chase_nearest_primary_actor", 1, 10, 68],
    ["set_gameplay_movement_chase_nearest_enemy", 1, 10, 48],
    ["set_gameplay_movement_chase_nearest_layer", 1, 10, 2, 44],
    ["set_gameplay_movement_chase_nearest_faction", 1, 10, 2, 40],
    ["set_gameplay_movement_chase_nearest_tag", 1, 10, 5, 38],
    ["set_gameplay_movement_chase_entity", 1, 10, 2, 20, 64],
    ["set_gameplay_damage_reaction", 1, 10, 3, 0],
  ]);
});

test("applyGameplayBehaviorCommands supports seekTarget and accelerate movement commands", () => {
  const engine = new MockGameplayEngine();
  const handles = {
    enemy: { entityId: 1, entityGeneration: 10 },
    target: { entityId: 2, entityGeneration: 20 },
  };

  const result = applyGameplayBehaviorCommands(engine, [
    {
      entity: "enemy",
      recipe: "seekPlayer",
      tags: [],
      type: "configureSeekTarget",
      target: "player",
      speed: 220,
      turnRate: 4,
    },
    {
      entity: "enemy",
      recipe: "seekEntity",
      tags: [],
      type: "configureSeekTarget",
      target: "target",
      speed: 220,
      turnRate: 4,
    },
    {
      entity: "enemy",
      recipe: "seekPrimaryActor",
      tags: [],
      type: "configureSeekTarget",
      target: "primaryActor",
      speed: 210,
      turnRate: 3.5,
    },
    {
      entity: "enemy",
      recipe: "seekNearestPlayer",
      tags: [],
      type: "configureSeekTarget",
      target: "nearestPlayer",
      speed: 200,
      turnRate: 3,
    },
    {
      entity: "enemy",
      recipe: "seekNearestPrimaryActor",
      tags: [],
      type: "configureSeekTarget",
      target: "nearestPrimaryActor",
      speed: 190,
      turnRate: 2.5,
    },
    {
      entity: "enemy",
      recipe: "seekNearestEnemy",
      tags: [],
      type: "configureSeekTarget",
      target: "nearestEnemy",
      speed: 180,
      turnRate: 2,
    },
    {
      entity: "enemy",
      recipe: "seekNearestPickup",
      tags: [],
      type: "configureSeekTarget",
      target: "nearestLayer:pickup",
      speed: 160,
      turnRate: 1.5,
    },
    {
      entity: "enemy",
      recipe: "seekNearestCustomFaction",
      tags: [],
      type: "configureSeekTarget",
      target: "nearestFaction:7",
      speed: 150,
      turnRate: 1.25,
    },
    {
      entity: "enemy",
      recipe: "seekNearestHostileTag",
      tags: [],
      type: "configureSeekTarget",
      target: "nearestTag:hostile",
      speed: 140,
      turnRate: 1,
    },
    {
      entity: "enemy",
      recipe: "accelerate",
      tags: [],
      type: "configureAccelerate",
      accelerationX: 2,
      accelerationY: -1,
      maxSpeed: 12,
    },
  ], handles, {
    ids: { tags: { hostile: 5 } },
  });

  deepEqual(result.results, [true, true, true, true, true, true, true, true, true, true]);
  deepEqual(engine.calls, [
    ["set_gameplay_movement_seek_target_player", 1, 10, 220, 4],
    ["set_gameplay_movement_seek_target_entity", 1, 10, 2, 20, 220, 4],
    ["set_gameplay_movement_seek_target_primary_actor", 1, 10, 210, 3.5],
    ["set_gameplay_movement_seek_target_nearest_player", 1, 10, 200, 3],
    ["set_gameplay_movement_seek_target_nearest_primary_actor", 1, 10, 190, 2.5],
    ["set_gameplay_movement_seek_target_nearest_enemy", 1, 10, 180, 2],
    ["set_gameplay_movement_seek_target_nearest_layer", 1, 10, 4, 160, 1.5],
    ["set_gameplay_movement_seek_target_nearest_faction", 1, 10, 7, 150, 1.25],
    ["set_gameplay_movement_seek_target_nearest_tag", 1, 10, 5, 140, 1],
    ["set_gameplay_movement_accelerate", 1, 10, 2, -1, 12],
  ]);
});

test("homing missile behavior fixture binds movement damage effect and despawn commands", () => {
  const engine = new MockGameplayEngine();
  const composition: SceneCompositionSpec = {
    initialFragment: "arena",
    prefabs: {
      missile: {
        props: {
          behaviorRecipes: "projectile.homingMissile",
        },
      },
      enemy: {
        props: {
          behaviorRecipes: "enemy.hostile",
        },
      },
    },
    fragments: {
      arena: {
        instances: [
          { id: "missile-1", prefab: "missile" },
          { id: "enemy-1", prefab: "enemy" },
        ],
      },
    },
  };
  const recipes: BehaviorRecipeDocumentSpec = {
    entities: {
      "enemy.hostile": {
        tags: ["hostile"],
        recipes: [],
      },
      "projectile.homingMissile": {
        recipes: [
          { kind: "faction", faction: "player", damages: ["enemy"] },
          { kind: "damage", amount: 1, target: "other", cooldownSeconds: 0 },
          { kind: "collisionParticle", presetId: 5, target: "self" },
          { kind: "collisionDespawn", target: "self" },
          { kind: "seekTarget", target: "nearestTag:hostile", speed: 260, turnRate: 1 },
          { kind: "lifetime", seconds: 2 },
        ],
      },
    },
  };

  const plan = bindSceneBehaviorRecipes(composition, recipes);
  const result = applyGameplayBehaviorCommands(engine, plan.commands, {
    "missile-1": { entityId: 7, entityGeneration: 8 },
    "enemy-1": { entityId: 9, entityGeneration: 10 },
  }, {
    ids: { tags: { hostile: 5 } },
  });

  deepEqual(result.results, [true, true, true, true, true, true, true]);
  deepEqual(engine.calls, [
    ["set_gameplay_faction", 7, 8, 1, 4],
    ["set_gameplay_damage_reaction", 7, 8, 1, 1],
    ["add_gameplay_collision_particle", 7, 8, 5, 0],
    ["add_gameplay_collision_despawn", 7, 8, 0],
    ["set_gameplay_movement_seek_target_nearest_tag", 7, 8, 5, 260, 1],
    ["set_gameplay_lifetime", 7, 8, 2],
    ["set_gameplay_tags", 9, 10, 32],
  ]);
});

test("applyGameplayBehaviorCommands applies faction damage masks", () => {
  const engine = new MockGameplayEngine();
  const handles = {
    enemy: { entityId: 1, entityGeneration: 10 },
    prop: { entityId: 2, entityGeneration: 20 },
    ally: { entityId: 3, entityGeneration: 30 },
  };

  const result = applyGameplayBehaviorCommands(engine, [
    {
      entity: "enemy",
      recipe: "enemyFaction",
      tags: [],
      type: "configureFaction",
      faction: "enemy",
      damages: ["player"],
    },
    {
      entity: "prop",
      recipe: "neutralFaction",
      tags: [],
      type: "configureFaction",
      faction: "neutral",
      damages: [],
    },
    {
      entity: "ally",
      recipe: "customFaction",
      tags: [],
      type: "configureFaction",
      faction: 7,
      damages: [2, 31],
    },
  ], handles);

  deepEqual(result.results, [true, true, true]);
  deepEqual(engine.calls, [
    ["set_gameplay_faction", 1, 10, 2, 2],
    ["set_gameplay_faction", 2, 20, 0, 0],
    ["set_gameplay_faction", 3, 30, 7, 2147483652],
  ]);
});

test("applyGameplayBehaviorCommands applies collision sound reactions", () => {
  const engine = new MockGameplayEngine();
  const handles = {
    enemy: { entityId: 1, entityGeneration: 10 },
  };

  const result = applyGameplayBehaviorCommands(engine, [
    {
      entity: "enemy",
      recipe: "hitSound",
      tags: [],
      type: "configureCollisionSound",
      soundId: 9,
      volume: 0.6,
      pitch: 1.2,
    },
  ], handles);

  deepEqual(result.results, [true]);
  deepEqual(engine.calls, [
    ["add_gameplay_collision_sound", 1, 10, 9, 0.6, 1.2],
  ]);
});

test("applyGameplayBehaviorCommands applies collision sound reaction cooldowns", () => {
  const engine = new MockGameplayEngine();
  const handles = {
    enemy: { entityId: 1, entityGeneration: 10 },
  };

  const result = applyGameplayBehaviorCommands(engine, [
    {
      entity: "enemy",
      recipe: "hitSound",
      tags: [],
      type: "configureCollisionSound",
      soundId: 9,
      volume: 0.6,
      pitch: 1.2,
      cooldownSeconds: 0.25,
    },
  ], handles);

  deepEqual(result.results, [true]);
  deepEqual(engine.calls, [
    ["add_gameplay_collision_sound_with_cooldown", 1, 10, 9, 0.6, 1.2, 0.25],
  ]);
});

test("applyGameplayBehaviorCommands applies collision sound replacement policy", () => {
  const engine = new MockGameplayEngine();
  const handles = {
    enemy: { entityId: 1, entityGeneration: 10 },
  };

  const result = applyGameplayBehaviorCommands(engine, [
    {
      entity: "enemy",
      recipe: "hitSound",
      tags: [],
      type: "configureCollisionSound",
      soundId: 9,
      volume: 0.6,
      pitch: 1.2,
      cooldownSeconds: 0.25,
      replaceDefault: true,
    },
  ], handles);

  deepEqual(result.results, [true]);
  deepEqual(engine.calls, [
    ["add_gameplay_collision_sound_with_policy", 1, 10, 9, 0.6, 1.2, 0.25, true],
  ]);
});

test("applyGameplayBehaviorCommands applies collision sound enter triggers", () => {
  const engine = new MockGameplayEngine();
  const handles = {
    enemy: { entityId: 1, entityGeneration: 10 },
  };

  const result = applyGameplayBehaviorCommands(engine, [
    {
      entity: "enemy",
      recipe: "hitSound",
      tags: [],
      type: "configureCollisionSound",
      soundId: 9,
      volume: 0.6,
      pitch: 1.2,
      cooldownSeconds: 0.25,
      replaceDefault: true,
      trigger: "enter",
    },
  ], handles);

  deepEqual(result.results, [true]);
  deepEqual(engine.calls, [
    ["add_gameplay_collision_sound_with_trigger", 1, 10, 9, 0.6, 1.2, 0.25, true, 1],
  ]);
});

test("applyGameplayBehaviorCommands applies collision pickup reactions", () => {
  const engine = new MockGameplayEngine();
  const handles = {
    pickup: { entityId: 1, entityGeneration: 10 },
  };

  const result = applyGameplayBehaviorCommands(engine, [
    {
      entity: "pickup",
      recipe: "collect",
      tags: [],
      type: "configureCollisionPickup",
      target: "self",
    },
  ], handles);

  deepEqual(result.results, [true]);
  deepEqual(engine.calls, [
    ["add_gameplay_collision_pickup", 1, 10, 0],
  ]);
});

test("applyGameplayBehaviorCommands applies collision area damage reactions", () => {
  const engine = new MockGameplayEngine();
  const handles = {
    rocket: { entityId: 1, entityGeneration: 10 },
  };

  const result = applyGameplayBehaviorCommands(engine, [
    {
      entity: "rocket",
      recipe: "explosion",
      tags: [],
      type: "configureCollisionAreaDamage",
      amount: 4,
      radius: 72,
      targetLayer: "enemy",
    },
  ], handles);

  deepEqual(result.results, [true]);
  deepEqual(engine.calls, [
    ["set_gameplay_area_damage_reaction", 1, 10, 4, 72, 1],
  ]);
});

test("applyGameplayBehaviorCommands applies collision knockback reactions", () => {
  const engine = new MockGameplayEngine();
  const handles = {
    bumper: { entityId: 1, entityGeneration: 10 },
  };

  const result = applyGameplayBehaviorCommands(engine, [
    {
      entity: "bumper",
      recipe: "push",
      tags: [],
      type: "configureCollisionKnockback",
      target: "other",
      impulse: 180,
    },
  ], handles);

  deepEqual(result.results, [true]);
  deepEqual(engine.calls, [
    ["add_gameplay_collision_knockback", 1, 10, 1, 180],
  ]);
});

test("applyGameplayBehaviorCommands applies collision emit effect reactions", () => {
  const engine = new MockGameplayEngine();
  const handles = {
    spark: { entityId: 1, entityGeneration: 10 },
  };

  const result = applyGameplayBehaviorCommands(engine, [
    {
      entity: "spark",
      recipe: "impactEffect",
      tags: [],
      type: "configureCollisionEmitEffect",
      effectId: 99,
      effectKind: "custom",
      effectType: 4,
      target: "self",
      cooldownSeconds: 0.25,
      trigger: "enter",
    },
  ], handles);

  deepEqual(result.results, [true]);
  deepEqual(engine.calls, [
    ["add_gameplay_collision_emit_effect", 1, 10, 99, 4, 0, 0.25, 1],
  ]);
});

test("applyGameplayBehaviorCommands applies collision emit effect payload overrides", () => {
  const engine = new PayloadMockGameplayEngine();
  const handles = {
    spark: { entityId: 1, entityGeneration: 10 },
  };

  const result = applyGameplayBehaviorCommands(engine, [
    {
      entity: "spark",
      recipe: "impactEffect",
      tags: [],
      type: "configureCollisionEmitEffect",
      effectId: 99,
      effectKind: "custom",
      effectType: 4,
      target: "self",
      intensity: 0.65,
      radius: 48,
      cooldownSeconds: 0.25,
      trigger: "enter",
    },
  ], handles);

  deepEqual(result.results, [true]);
  deepEqual(engine.calls, [
    ["add_gameplay_collision_emit_effect_with_payload", 1, 10, 99, 4, 0, 0.25, 1, 0.65, 48],
  ]);
});

test("applyGameplayBehaviorCommands resolves named collision emit effects", () => {
  const engine = new MockGameplayEngine();
  const handles = {
    spark: { entityId: 1, entityGeneration: 10 },
  };

  const result = applyGameplayBehaviorCommands(engine, [
    {
      entity: "spark",
      recipe: "impactEffect",
      tags: [],
      type: "configureCollisionEmitEffect",
      effect: "impactSpark",
      effectKind: "custom",
      effectType: 4,
      target: "self",
      cooldownSeconds: 0.25,
      trigger: "enter",
    },
  ], handles, {
    ids: { effects: { impactSpark: 42 } },
  });

  deepEqual(result.results, [true]);
  deepEqual(engine.calls, [
    ["add_gameplay_collision_emit_effect", 1, 10, 42, 4, 0, 0.25, 1],
  ]);
});

test("applyGameplayBehaviorCommands applies collision spawn prefab reactions", () => {
  const engine = new MockGameplayEngine();
  const handles = {
    spawner: { entityId: 1, entityGeneration: 10 },
  };

  const result = applyGameplayBehaviorCommands(engine, [
    {
      entity: "spawner",
      recipe: "splitOnHit",
      tags: [],
      type: "configureCollisionSpawnPrefab",
      action: "split",
      prefab: "enemy",
      target: "other",
      cooldownSeconds: 0.5,
      trigger: "enter",
      offsetX: 12,
      offsetY: -6,
    },
  ], handles, { ids: { actions: { split: 17 }, prefabs: { enemy: 3 } } });

  deepEqual(result.results, [true]);
  deepEqual(engine.calls, [
    ["add_gameplay_collision_spawn_prefab", 1, 10, 17, 3, 1, 0.5, 1, 12, -6],
  ]);
});

test("applyGameplayBehaviorCommands applies collision particle reactions", () => {
  const engine = new MockGameplayEngine();
  const handles = {
    enemy: { entityId: 1, entityGeneration: 10 },
  };

  const result = applyGameplayBehaviorCommands(engine, [
    {
      entity: "enemy",
      recipe: "hitParticle",
      tags: [],
      type: "configureCollisionParticle",
      presetId: 3,
      target: "other",
    },
  ], handles);

  deepEqual(result.results, [true]);
  deepEqual(engine.calls, [
    ["add_gameplay_collision_particle", 1, 10, 3, 1],
  ]);
});

test("applyGameplayBehaviorCommands applies collision particle reaction cooldowns", () => {
  const engine = new MockGameplayEngine();
  const handles = {
    enemy: { entityId: 1, entityGeneration: 10 },
  };

  const result = applyGameplayBehaviorCommands(engine, [
    {
      entity: "enemy",
      recipe: "hitParticle",
      tags: [],
      type: "configureCollisionParticle",
      presetId: 3,
      target: "other",
      cooldownSeconds: 0.5,
    },
  ], handles);

  deepEqual(result.results, [true]);
  deepEqual(engine.calls, [
    ["add_gameplay_collision_particle_with_cooldown", 1, 10, 3, 1, 0.5],
  ]);
});

test("applyGameplayBehaviorCommands applies collision particle replacement policy", () => {
  const engine = new MockGameplayEngine();
  const handles = {
    enemy: { entityId: 1, entityGeneration: 10 },
  };

  const result = applyGameplayBehaviorCommands(engine, [
    {
      entity: "enemy",
      recipe: "hitParticle",
      tags: [],
      type: "configureCollisionParticle",
      presetId: 3,
      target: "other",
      cooldownSeconds: 0.5,
      replaceDefault: true,
    },
  ], handles);

  deepEqual(result.results, [true]);
  deepEqual(engine.calls, [
    ["add_gameplay_collision_particle_with_policy", 1, 10, 3, 1, 0.5, true],
  ]);
});

test("applyGameplayBehaviorCommands applies collision particle enter triggers", () => {
  const engine = new MockGameplayEngine();
  const handles = {
    enemy: { entityId: 1, entityGeneration: 10 },
  };

  const result = applyGameplayBehaviorCommands(engine, [
    {
      entity: "enemy",
      recipe: "hitParticle",
      tags: [],
      type: "configureCollisionParticle",
      presetId: 3,
      target: "other",
      cooldownSeconds: 0.5,
      replaceDefault: true,
      trigger: "enter",
    },
  ], handles);

  deepEqual(result.results, [true]);
  deepEqual(engine.calls, [
    ["add_gameplay_collision_particle_with_trigger", 1, 10, 3, 1, 0.5, true, 1],
  ]);
});

test("applyGameplayBehaviorCommands applies collision despawn reactions", () => {
  const engine = new MockGameplayEngine();
  const handles = {
    projectile: { entityId: 1, entityGeneration: 10 },
  };

  const result = applyGameplayBehaviorCommands(engine, [
    {
      entity: "projectile",
      recipe: "tileDespawn",
      tags: [],
      type: "configureCollisionDespawn",
      target: "self",
    },
  ], handles);

  deepEqual(result.results, [true]);
  deepEqual(engine.calls, [
    ["add_gameplay_collision_despawn", 1, 10, 0],
  ]);
});

test("applyGameplayBehaviorCommands applies supported score pickup commands", () => {
  const engine = new MockGameplayEngine();
  const handles = {
    scorePickup: { entityId: 7, entityGeneration: 2 },
    mappedPickup: { entityId: 8, entityGeneration: 3 },
  };

  const result = applyGameplayBehaviorCommands(engine, [
    {
      entity: "scorePickup",
      recipe: "score",
      tags: [],
      type: "configurePickup",
      item: "score",
      count: 3,
      despawn: true,
    },
    {
      entity: "mappedPickup",
      recipe: "mapped",
      tags: [],
      type: "configurePickup",
      item: "coin",
      itemId: 1,
      count: 2,
      despawn: true,
    },
  ], handles);

  deepEqual(result.results, [true, true]);
  deepEqual(engine.calls, [
    ["set_gameplay_pickup", 7, 2, 1, 3, true],
    ["set_gameplay_pickup", 8, 3, 1, 2, true],
  ]);
});

test("applyGameplayBehaviorCommands applies supported interaction commands", () => {
  const engine = new MockGameplayEngine();
  const handles = {
    door: { entityId: 12, entityGeneration: 4 },
    terminal: { entityId: 13, entityGeneration: 5 },
  };

  const result = applyGameplayBehaviorCommands(engine, [
    {
      entity: "door",
      recipe: "openDoor",
      tags: [],
      type: "configureInteraction",
      action: "open",
      actionId: 7,
      radius: 24,
      once: true,
    },
    {
      entity: "terminal",
      recipe: "hack",
      tags: [],
      type: "configureInteraction",
      action: "useTerminal",
      radius: 18,
      once: false,
    },
  ], handles, {
    ids: {
      actions: {
        useTerminal: 9,
      },
    },
  });

  deepEqual(result.results, [true, true]);
  deepEqual(engine.calls, [
    ["set_gameplay_interaction", 12, 4, 7, 24, true],
    ["set_gameplay_interaction", 13, 5, 9, 18, false],
  ]);
});

test("applyGameplayBehaviorCommands applies supported timer trigger commands", () => {
  const engine = new MockGameplayEngine();
  const handles = {
    sleeper: { entityId: 21, entityGeneration: 2 },
    alarm: { entityId: 22, entityGeneration: 3 },
  };

  const result = applyGameplayBehaviorCommands(engine, [
    {
      entity: "sleeper",
      recipe: "wakeTimer",
      tags: [],
      type: "configureTimerTrigger",
      timer: "wake",
      timerId: 6,
      seconds: 0.5,
    },
    {
      entity: "alarm",
      recipe: "alarmTimer",
      tags: [],
      type: "configureTimerTrigger",
      timer: "alarm",
      seconds: 1.25,
    },
  ], handles, {
    ids: {
      timers: {
        alarm: 7,
      },
    },
  });

  deepEqual(result.results, [true, true]);
  deepEqual(engine.calls, [
    ["set_gameplay_timer_trigger", 21, 2, 6, 0.5],
    ["set_gameplay_timer_trigger", 22, 3, 7, 1.25],
  ]);
});

test("applyGameplayBehaviorCommands applies explicit timer action trigger commands", () => {
  const engine = new MockGameplayEngine();
  const handles = {
    spawner: { entityId: 23, entityGeneration: 4 },
    alarm: { entityId: 24, entityGeneration: 5 },
  };

  const result = applyGameplayBehaviorCommands(engine, [
    {
      entity: "spawner",
      recipe: "spawnTimer",
      tags: [],
      type: "configureTimerTrigger",
      timer: "wake",
      timerId: 6,
      action: "summon",
      actionId: 11,
      seconds: 0.5,
    },
    {
      entity: "alarm",
      recipe: "alarmTimer",
      tags: [],
      type: "configureTimerTrigger",
      timer: "alarm",
      action: "spawn",
      seconds: 1.25,
    },
  ], handles, {
    ids: {
      actions: {
        spawn: 12,
      },
      timers: {
        alarm: 7,
      },
    },
  });

  deepEqual(result.results, [true, true]);
  deepEqual(engine.calls, [
    ["set_gameplay_timer_action_trigger", 23, 4, 6, 0.5, 11],
    ["set_gameplay_timer_action_trigger", 24, 5, 7, 1.25, 12],
  ]);
});


test("applyGameplayBehaviorCommands applies supported projectile action commands", () => {
  const engine = new MockGameplayEngine();
  const handles = {
    player: { entityId: 3, entityGeneration: 4 },
    turret: { entityId: 5, entityGeneration: 6 },
    ghost: { entityId: 7, entityGeneration: 8 },
  };

  const result = applyGameplayBehaviorCommands(engine, [
    {
      entity: "player",
      recipe: "primary",
      tags: [],
      type: "configureProjectileAction",
      action: "primary",
      actionId: 1,
      cooldownSeconds: 0.12,
      speed: 420,
      damage: 2,
      lifetimeSeconds: 1.4,
    },
    {
      entity: "turret",
      recipe: "burst",
      tags: [],
      type: "configureProjectileAction",
      action: "turretFire",
      cooldownSeconds: 0.5,
      speed: 320,
      damage: 1,
      lifetimeSeconds: 2,
    },
    {
      entity: "turret",
      recipe: "hostileBurst",
      tags: [],
      type: "configureProjectileAction",
      action: "hostileFire",
      cooldownSeconds: 0.8,
      speed: 260,
      damage: 1,
      lifetimeSeconds: 1.5,
      aim: "targetPlayer",
      collisionTarget: "player",
    },
    {
      entity: "ghost",
      recipe: "piercing",
      tags: [],
      type: "configureProjectileAction",
      action: "ghostFire",
      cooldownSeconds: 0.25,
      speed: 380,
      damage: 1,
      lifetimeSeconds: 1.2,
      tileImpact: "passThrough",
    },
    {
      entity: "ghost",
      recipe: "bouncer",
      tags: [],
      type: "configureProjectileAction",
      action: "bounceFire",
      cooldownSeconds: 0.35,
      speed: 300,
      damage: 1,
      lifetimeSeconds: 1.2,
      tileImpact: "bounce",
    },
  ], handles, {
    ids: { actions: { turretFire: 8, hostileFire: 12, ghostFire: 13, bounceFire: 14 } },
  });

  deepEqual(result.results, [true, true, true, true, true]);
  deepEqual(engine.calls, [
    ["set_gameplay_action_projectile", 3, 4, 1, 0.12, 420, 2, 1.4],
    ["set_gameplay_action_projectile", 5, 6, 8, 0.5, 320, 1, 2],
    ["set_gameplay_action_projectile_with_target", 5, 6, 12, 0.8, 260, 1, 1.5, 1, 1, 0],
    ["set_gameplay_action_projectile_with_target", 7, 8, 13, 0.25, 380, 1, 1.2, 0, 0, 1],
    ["set_gameplay_action_projectile_with_target", 7, 8, 14, 0.35, 300, 1, 1.2, 0, 0, 2],
  ]);
});

test("applyGameplayBehaviorCommands applies supported dash action commands", () => {
  const engine = new MockGameplayEngine();
  const handles = {
    player: { entityId: 3, entityGeneration: 4 },
    runner: { entityId: 5, entityGeneration: 6 },
  };

  const result = applyGameplayBehaviorCommands(engine, [
    {
      entity: "player",
      recipe: "dash",
      tags: [],
      type: "configureDashAction",
      action: "dash",
      actionId: 2,
      cooldownSeconds: 0.75,
      distance: 96,
      aim: "input",
    },
    {
      entity: "runner",
      recipe: "dash",
      tags: [],
      type: "configureDashAction",
      action: "evade",
      cooldownSeconds: 1,
      distance: 64,
      aim: "targetPlayer",
    },
  ], handles, {
    ids: { actions: { evade: 9 } },
  });

  deepEqual(result.results, [true, true]);
  deepEqual(engine.calls, [
    ["set_gameplay_action_dash", 3, 4, 2, 0.75, 96],
    ["set_gameplay_action_dash_with_aim", 5, 6, 9, 1, 64, 1],
  ]);
});

test("applyGameplayBehaviorCommands applies supported melee action commands", () => {
  const engine = new MockGameplayEngine();
  const handles = {
    player: { entityId: 3, entityGeneration: 4 },
    guard: { entityId: 5, entityGeneration: 6 },
  };

  const result = applyGameplayBehaviorCommands(engine, [
    {
      entity: "player",
      recipe: "slash",
      tags: [],
      type: "configureMeleeAction",
      action: "slash",
      actionId: 3,
      cooldownSeconds: 0.35,
      range: 36,
      damage: 3,
    },
    {
      entity: "guard",
      recipe: "cleave",
      tags: [],
      type: "configureMeleeAction",
      action: "cleave",
      cooldownSeconds: 0.8,
      range: 48,
      damage: 5,
      target: "player",
    },
  ], handles, {
    ids: { actions: { cleave: 10 } },
  });

  deepEqual(result.results, [true, true]);
  deepEqual(engine.calls, [
    ["set_gameplay_action_melee", 3, 4, 3, 0.35, 36, 3],
    ["set_gameplay_action_melee_with_target", 5, 6, 10, 0.8, 48, 5, 1],
  ]);
});

test("applyGameplayBehaviorCommands applies supported spawn prefab action commands", () => {
  const engine = new MockGameplayEngine();
  const handles = {
    summoner: { entityId: 7, entityGeneration: 8 },
    spawner: { entityId: 9, entityGeneration: 10 },
    turret: { entityId: 11, entityGeneration: 12 },
  };

  const result = applyGameplayBehaviorCommands(engine, [
    {
      entity: "summoner",
      recipe: "summon",
      tags: [],
      type: "configureSpawnPrefabAction",
      action: "summon",
      actionId: 11,
      prefab: "enemy",
      prefabId: 1,
      cooldownSeconds: 1.2,
      anchor: "self",
      phase: "prePhysics",
      offsetX: 12,
      offsetY: -6,
    },
    {
      entity: "spawner",
      recipe: "spawn",
      tags: [],
      type: "configureSpawnPrefabAction",
      action: "spawn",
      prefab: "enemy",
      cooldownSeconds: 0.5,
      anchor: "self",
      phase: "prePhysics",
      offsetX: 0,
      offsetY: 4,
    },
    {
      entity: "turret",
      recipe: "rocket",
      tags: [],
      type: "configureSpawnPrefabAction",
      action: "fireRocket",
      actionId: 13,
      prefab: "rocket",
      prefabId: 9,
      cooldownSeconds: 0.75,
      anchor: "self",
      phase: "prePhysics",
      offsetX: 6,
      offsetY: 2,
      projectile: {
        speed: 240,
        damage: 4,
        lifetimeSeconds: 1.6,
        aim: "targetPlayer",
        collisionTarget: "player",
        tileImpact: "bounce",
      },
    },
  ], handles, {
    ids: {
      actions: { spawn: 12 },
      prefabs: { enemy: 1 },
    },
  });

  deepEqual(result.results, [true, true, true]);
  deepEqual(engine.calls, [
    ["set_gameplay_action_spawn_prefab", 7, 8, 11, 1.2, 1, 0, 0, 12, -6],
    ["set_gameplay_action_spawn_prefab", 9, 10, 12, 0.5, 1, 0, 0, 0, 4],
    ["set_gameplay_action_spawn_projectile_prefab", 11, 12, 13, 0.75, 9, 0, 0, 6, 2, 240, 4, 1.6, 1, 1, 2],
  ]);
});

test("createGameplayBehaviorRuntimeTarget adapts one command at a time", () => {
  const engine = new MockGameplayEngine();
  const target = createGameplayBehaviorRuntimeTarget(engine, new Map([
    ["enemy", { entityId: 9, entityGeneration: 3 }],
  ]));

  equal(target.applyBehaviorRecipeCommand({
    entity: "enemy",
    recipe: "living",
    tags: [],
    type: "configureHealth",
    max: 1,
    current: 1,
    onZero: "despawn",
  }), true);
  deepEqual(engine.calls, [["set_gameplay_health", 9, 3, 1]]);
});

test("applyGameplayBehaviorCommands rejects unsupported command semantics", () => {
  const engine = new MockGameplayEngine();
  const handles = { enemy: { entityId: 1, entityGeneration: 1 } };

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "living",
    tags: [],
    type: "configureHealth",
    max: 3,
    current: 1,
    onZero: "despawn",
  }], handles), "gameplayAuthoring.commands.0.current");

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "damage",
    tags: [],
    type: "configureDamage",
    amount: 1,
    target: "other",
    cooldownSeconds: 0.25,
  }], handles), "gameplayAuthoring.commands.0.cooldownSeconds");

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "faction",
    tags: [],
    type: "configureFaction",
    faction: "ally" as "enemy",
    damages: ["player"],
  }], handles), "gameplayAuthoring.commands.0.faction");

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "faction",
    tags: [],
    type: "configureFaction",
    faction: 32,
    damages: ["player"],
  }], handles), "gameplayAuthoring.commands.0.faction");

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "faction",
    tags: [],
    type: "configureFaction",
    faction: "enemy",
    damages: [32],
  }], handles), "gameplayAuthoring.commands.0.damages.0");

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "chase",
    tags: [],
    type: "configureChase",
    target: "player",
    speed: 80,
    stopDistance: 12,
  }], handles), "gameplayAuthoring.commands.0.stopDistance");

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "ttl",
    tags: [],
    type: "configureLifetime",
    seconds: 0,
  }], handles), "gameplayAuthoring.commands.0.seconds");

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "reward",
    tags: [],
    type: "configureScoreReward",
    reward: 1.5,
  }], handles), "gameplayAuthoring.commands.0.reward");

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "pickup",
    tags: [],
    type: "configurePickup",
    item: "coin",
    count: 1,
    despawn: true,
  }], handles), "gameplayAuthoring.commands.0.item");

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "pickup",
    tags: [],
    type: "configurePickup",
    item: "score",
    count: 1,
    despawn: false,
  }], handles), "gameplayAuthoring.commands.0.despawn");

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "pickup",
    tags: [],
    type: "configurePickup",
    item: "coin",
    itemId: 2,
    count: 1,
    despawn: true,
  }], handles), "gameplayAuthoring.commands.0.itemId");

  const missingCollisionPickupSetterEngine = new MockGameplayEngine();
  Object.defineProperty(missingCollisionPickupSetterEngine, "add_gameplay_collision_pickup", { value: undefined });
  expectDiagnostic(() => applyGameplayBehaviorCommands(missingCollisionPickupSetterEngine, [{
    entity: "enemy",
    recipe: "collect",
    tags: [],
    type: "configureCollisionPickup",
    target: "self",
  }], handles), "gameplayAuthoring.commands.0.type");

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "impactEffect",
    tags: [],
    type: "configureCollisionEmitEffect",
    effectId: 99,
    effectKind: "custom",
    effectType: 0,
    target: "self",
    cooldownSeconds: 0,
    trigger: "contact",
  }], handles), "gameplayAuthoring.commands.0.effectType");

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "impactEffect",
    tags: [],
    type: "configureCollisionEmitEffect",
    effectId: 0x1_0000_0000,
    effectKind: "custom",
    effectType: 4,
    target: "self",
    cooldownSeconds: 0,
    trigger: "contact",
  }], handles), "gameplayAuthoring.commands.0.effectId");

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "impactEffect",
    tags: [],
    type: "configureCollisionEmitEffect",
    effectId: 99,
    effectKind: "custom",
    effectType: 4,
    target: "self",
    intensity: -0.1,
    cooldownSeconds: 0,
    trigger: "contact",
  }], handles), "gameplayAuthoring.commands.0.intensity");

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "impactEffect",
    tags: [],
    type: "configureCollisionEmitEffect",
    effectId: 99,
    effectKind: "custom",
    effectType: 4,
    target: "self",
    radius: Number.POSITIVE_INFINITY,
    cooldownSeconds: 0,
    trigger: "contact",
  }], handles), "gameplayAuthoring.commands.0.radius");

  const missingCollisionEmitEffectSetterEngine = new MockGameplayEngine();
  Object.defineProperty(missingCollisionEmitEffectSetterEngine, "add_gameplay_collision_emit_effect", { value: undefined });
  expectDiagnostic(() => applyGameplayBehaviorCommands(missingCollisionEmitEffectSetterEngine, [{
    entity: "enemy",
    recipe: "impactEffect",
    tags: [],
    type: "configureCollisionEmitEffect",
    effectId: 99,
    effectKind: "custom",
    effectType: 4,
    target: "self",
    cooldownSeconds: 0,
    trigger: "contact",
  }], handles), "gameplayAuthoring.commands.0.type");

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "impactEffect",
    tags: [],
    type: "configureCollisionEmitEffect",
    effectId: 99,
    effectKind: "custom",
    effectType: 4,
    target: "self",
    intensity: 0.5,
    cooldownSeconds: 0,
    trigger: "contact",
  }], handles), "gameplayAuthoring.commands.0.type");

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "splitOnHit",
    tags: [],
    type: "configureCollisionSpawnPrefab",
    action: "split",
    prefab: "enemy",
    target: "self",
    cooldownSeconds: 0,
    trigger: "contact",
    offsetX: Number.NaN,
    offsetY: 0,
  }], handles, { ids: { actions: { split: 17 }, prefabs: { enemy: 3 } } }), "gameplayAuthoring.commands.0.offsetX");

  const missingCollisionSpawnPrefabSetterEngine = new MockGameplayEngine();
  Object.defineProperty(missingCollisionSpawnPrefabSetterEngine, "add_gameplay_collision_spawn_prefab", { value: undefined });
  expectDiagnostic(() => applyGameplayBehaviorCommands(missingCollisionSpawnPrefabSetterEngine, [{
    entity: "enemy",
    recipe: "splitOnHit",
    tags: [],
    type: "configureCollisionSpawnPrefab",
    action: "split",
    prefab: "enemy",
    target: "self",
    cooldownSeconds: 0,
    trigger: "contact",
    offsetX: 0,
    offsetY: 0,
  }], handles, { ids: { actions: { split: 17 }, prefabs: { enemy: 3 } } }), "gameplayAuthoring.commands.0.type");

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "primary",
    tags: [],
    type: "configureProjectileAction",
    action: "primary",
    cooldownSeconds: 0.12,
    speed: 420,
    damage: 2,
    lifetimeSeconds: 1,
  }], handles), "gameplayAuthoring.commands.0.action");

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "primary",
    tags: [],
    type: "configureProjectileAction",
    action: "primary",
    actionId: 1,
    cooldownSeconds: 0.12,
    speed: 0,
    damage: 2,
    lifetimeSeconds: 1,
  }], handles), "gameplayAuthoring.commands.0.speed");

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "primary",
    tags: [],
    type: "configureProjectileAction",
    action: "primary",
    actionId: 1,
    cooldownSeconds: 0.12,
    speed: 420,
    damage: 2,
    lifetimeSeconds: 1,
    aim: "targetPlayer",
  }], handles), "gameplayAuthoring.commands.0.collisionTarget");

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "primary",
    tags: [],
    type: "configureProjectileAction",
    action: "primary",
    actionId: 1,
    cooldownSeconds: 0.12,
    speed: 420,
    damage: 2,
    lifetimeSeconds: 1,
    collisionTarget: "player",
  }], handles), "gameplayAuthoring.commands.0.collisionTarget");

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "primary",
    tags: [],
    type: "configureProjectileAction",
    action: "primary",
    actionId: 1,
    cooldownSeconds: 0.12,
    speed: 420,
    damage: 2,
    lifetimeSeconds: 1,
    tileImpact: "stick" as "despawn",
  }], handles), "gameplayAuthoring.commands.0.tileImpact");

  const missingProjectileSetterEngine = new MockGameplayEngine();
  Object.defineProperty(missingProjectileSetterEngine, "set_gameplay_action_projectile", { value: undefined });
  expectDiagnostic(() => applyGameplayBehaviorCommands(missingProjectileSetterEngine, [{
    entity: "enemy",
    recipe: "primary",
    tags: [],
    type: "configureProjectileAction",
    action: "primary",
    actionId: 1,
    cooldownSeconds: 0.12,
    speed: 420,
    damage: 2,
    lifetimeSeconds: 1,
  }], handles), "gameplayAuthoring.commands.0.type");

  const missingTargetedProjectileSetterEngine = new MockGameplayEngine();
  Object.defineProperty(missingTargetedProjectileSetterEngine, "set_gameplay_action_projectile_with_target", { value: undefined });
  expectDiagnostic(() => applyGameplayBehaviorCommands(missingTargetedProjectileSetterEngine, [{
    entity: "enemy",
    recipe: "primary",
    tags: [],
    type: "configureProjectileAction",
    action: "primary",
    actionId: 1,
    cooldownSeconds: 0.12,
    speed: 420,
    damage: 2,
    lifetimeSeconds: 1,
    aim: "targetPlayer",
    collisionTarget: "player",
  }], handles), "gameplayAuthoring.commands.0.type");

  const missingSeekTargetPlayerSetterEngine = new MockGameplayEngine();
  Object.defineProperty(missingSeekTargetPlayerSetterEngine, "set_gameplay_movement_seek_target_player", { value: undefined });
  expectDiagnostic(() => applyGameplayBehaviorCommands(missingSeekTargetPlayerSetterEngine, [{
    entity: "enemy",
    recipe: "seekPlayer",
    tags: [],
    type: "configureSeekTarget",
    target: "player",
    speed: 220,
    turnRate: 4,
  }], handles), "gameplayAuthoring.commands.0.type");

  const missingSeekTargetEntitySetterEngine = new MockGameplayEngine();
  Object.defineProperty(missingSeekTargetEntitySetterEngine, "set_gameplay_movement_seek_target_entity", { value: undefined });
  expectDiagnostic(() => applyGameplayBehaviorCommands(missingSeekTargetEntitySetterEngine, [{
    entity: "enemy",
    recipe: "seekEntity",
    tags: [],
    type: "configureSeekTarget",
    target: "target",
    speed: 220,
    turnRate: 4,
  }], { enemy: { entityId: 1, entityGeneration: 10 }, target: { entityId: 2, entityGeneration: 20 } }), "gameplayAuthoring.commands.0.type");

  const missingChaseNearestLayerSetterEngine = new MockGameplayEngine();
  Object.defineProperty(missingChaseNearestLayerSetterEngine, "set_gameplay_movement_chase_nearest_layer", { value: undefined });
  expectDiagnostic(() => applyGameplayBehaviorCommands(missingChaseNearestLayerSetterEngine, [{
    entity: "enemy",
    recipe: "followBullet",
    tags: [],
    type: "configureChase",
    target: "nearestLayer:bullet",
    speed: 44,
    stopDistance: 0,
  }], handles), "gameplayAuthoring.commands.0.type");

  const missingSeekTargetNearestFactionSetterEngine = new MockGameplayEngine();
  Object.defineProperty(missingSeekTargetNearestFactionSetterEngine, "set_gameplay_movement_seek_target_nearest_faction", { value: undefined });
  expectDiagnostic(() => applyGameplayBehaviorCommands(missingSeekTargetNearestFactionSetterEngine, [{
    entity: "enemy",
    recipe: "seekFaction",
    tags: [],
    type: "configureSeekTarget",
    target: "nearestFaction:enemy",
    speed: 160,
    turnRate: 1,
  }], handles), "gameplayAuthoring.commands.0.type");

  const missingSeekTargetNearestTagSetterEngine = new MockGameplayEngine();
  Object.defineProperty(missingSeekTargetNearestTagSetterEngine, "set_gameplay_movement_seek_target_nearest_tag", { value: undefined });
  expectDiagnostic(() => applyGameplayBehaviorCommands(missingSeekTargetNearestTagSetterEngine, [{
    entity: "enemy",
    recipe: "seekTag",
    tags: [],
    type: "configureSeekTarget",
    target: "nearestTag:hostile",
    speed: 160,
    turnRate: 1,
  }], handles, {
    ids: { tags: { hostile: 5 } },
  }), "gameplayAuthoring.commands.0.type");

  const missingTagsSetterEngine = new MockGameplayEngine();
  Object.defineProperty(missingTagsSetterEngine, "set_gameplay_tags", { value: undefined });
  expectDiagnostic(() => applyGameplayBehaviorCommands(missingTagsSetterEngine, [{
    entity: "enemy",
    recipe: "entity.tags",
    tags: ["hostile"],
    type: "configureTags",
  }], handles, {
    ids: { tags: { hostile: 5 } },
  }), "gameplayAuthoring.commands.0.type");

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "seekTerrain",
    tags: [],
    type: "configureSeekTarget",
    target: "nearestLayer:terrain",
    speed: 160,
    turnRate: 1,
  }], handles), "gameplayAuthoring.commands.0.target");

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "seekTag",
    tags: [],
    type: "configureSeekTarget",
    target: "nearestTag:hostile",
    speed: 160,
    turnRate: 1,
  }], handles), "gameplayAuthoring.commands.0.target");

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "seekTag",
    tags: [],
    type: "configureSeekTarget",
    target: "nearestTag:32",
    speed: 160,
    turnRate: 1,
  }], handles), "gameplayAuthoring.commands.0.target");

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "seekFaction",
    tags: [],
    type: "configureSeekTarget",
    target: "nearestFaction:32",
    speed: 160,
    turnRate: 1,
  }], handles), "gameplayAuthoring.commands.0.target");

  const missingAccelerateSetterEngine = new MockGameplayEngine();
  Object.defineProperty(missingAccelerateSetterEngine, "set_gameplay_movement_accelerate", { value: undefined });
  expectDiagnostic(() => applyGameplayBehaviorCommands(missingAccelerateSetterEngine, [{
    entity: "enemy",
    recipe: "accelerate",
    tags: [],
    type: "configureAccelerate",
    accelerationX: 2,
    accelerationY: -1,
    maxSpeed: 12,
  }], handles), "gameplayAuthoring.commands.0.type");

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "seekPlayer",
    tags: [],
    type: "configureSeekTarget",
    target: "player",
    speed: 0,
    turnRate: 4,
  }], handles), "gameplayAuthoring.commands.0.speed");

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "seekPlayer",
    tags: [],
    type: "configureSeekTarget",
    target: "player",
    speed: 220,
    turnRate: -1,
  }], handles), "gameplayAuthoring.commands.0.turnRate");

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "accelerate",
    tags: [],
    type: "configureAccelerate",
    accelerationX: 0,
    accelerationY: 0,
    maxSpeed: 12,
  }], handles), "gameplayAuthoring.commands.0.accelerationX");

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "accelerate",
    tags: [],
    type: "configureAccelerate",
    accelerationX: 2,
    accelerationY: -1,
    maxSpeed: 0,
  }], handles), "gameplayAuthoring.commands.0.maxSpeed");

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "dash",
    tags: [],
    type: "configureDashAction",
    action: "dash",
    cooldownSeconds: 0.5,
    distance: 96,
    aim: "input",
  }], handles), "gameplayAuthoring.commands.0.action");

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "dash",
    tags: [],
    type: "configureDashAction",
    action: "dash",
    actionId: 2,
    cooldownSeconds: 0.5,
    distance: 0,
    aim: "input",
  }], handles), "gameplayAuthoring.commands.0.distance");

  const missingDashSetterEngine = new MockGameplayEngine();
  Object.defineProperty(missingDashSetterEngine, "set_gameplay_action_dash", { value: undefined });
  Object.defineProperty(missingDashSetterEngine, "set_gameplay_action_dash_with_aim", { value: undefined });
  expectDiagnostic(() => applyGameplayBehaviorCommands(missingDashSetterEngine, [{
    entity: "enemy",
    recipe: "dash",
    tags: [],
    type: "configureDashAction",
    action: "dash",
    actionId: 2,
    cooldownSeconds: 0.5,
    distance: 96,
    aim: "targetPlayer",
  }], handles), "gameplayAuthoring.commands.0.type");

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "slash",
    tags: [],
    type: "configureMeleeAction",
    action: "slash",
    cooldownSeconds: 0.35,
    range: 36,
    damage: 3,
  }], handles), "gameplayAuthoring.commands.0.action");

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "slash",
    tags: [],
    type: "configureMeleeAction",
    action: "slash",
    actionId: 3,
    cooldownSeconds: 0.35,
    range: 0,
    damage: 3,
  }], handles), "gameplayAuthoring.commands.0.range");

  const missingMeleeSetterEngine = new MockGameplayEngine();
  Object.defineProperty(missingMeleeSetterEngine, "set_gameplay_action_melee", { value: undefined });
  expectDiagnostic(() => applyGameplayBehaviorCommands(missingMeleeSetterEngine, [{
    entity: "enemy",
    recipe: "slash",
    tags: [],
    type: "configureMeleeAction",
    action: "slash",
    actionId: 3,
    cooldownSeconds: 0.35,
    range: 36,
    damage: 3,
  }], handles), "gameplayAuthoring.commands.0.type");

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "summon",
    tags: [],
    type: "configureSpawnPrefabAction",
    action: "summon",
    prefab: "enemy",
    cooldownSeconds: 0.5,
    anchor: "self",
    phase: "prePhysics",
    offsetX: 0,
    offsetY: 0,
  }], handles), "gameplayAuthoring.commands.0.action");

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "summon",
    tags: [],
    type: "configureSpawnPrefabAction",
    action: "summon",
    actionId: 4,
    prefab: "enemy",
    cooldownSeconds: 0.5,
    anchor: "self",
    phase: "prePhysics",
    offsetX: 0,
    offsetY: 0,
  }], handles), "gameplayAuthoring.commands.0.prefab");

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "summon",
    tags: [],
    type: "configureSpawnPrefabAction",
    action: "summon",
    actionId: 4,
    prefab: "enemy",
    prefabId: 1,
    cooldownSeconds: 0.5,
    anchor: "self",
    phase: "prePhysics",
    offsetX: Number.NaN,
    offsetY: 0,
  }], handles), "gameplayAuthoring.commands.0.offsetX");

  const missingSpawnPrefabSetterEngine = new MockGameplayEngine();
  Object.defineProperty(missingSpawnPrefabSetterEngine, "set_gameplay_action_spawn_prefab", { value: undefined });
  expectDiagnostic(() => applyGameplayBehaviorCommands(missingSpawnPrefabSetterEngine, [{
    entity: "enemy",
    recipe: "summon",
    tags: [],
    type: "configureSpawnPrefabAction",
    action: "summon",
    actionId: 4,
    prefab: "enemy",
    prefabId: 1,
    cooldownSeconds: 0.5,
    anchor: "self",
    phase: "prePhysics",
    offsetX: 0,
    offsetY: 0,
  }], handles), "gameplayAuthoring.commands.0.type");

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "wake",
    tags: [],
    type: "configureTimerTrigger",
    timer: "wake",
    seconds: 0,
  }], handles), "gameplayAuthoring.commands.0.seconds");

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [{
    entity: "enemy",
    recipe: "wake",
    tags: [],
    type: "configureTimerTrigger",
    timer: "wake",
    seconds: 0.5,
  }], handles), "gameplayAuthoring.commands.0.timer");

  const missingTimerSetterEngine = new MockGameplayEngine();
  Object.defineProperty(missingTimerSetterEngine, "set_gameplay_timer_trigger", { value: undefined });
  expectDiagnostic(() => applyGameplayBehaviorCommands(missingTimerSetterEngine, [{
    entity: "enemy",
    recipe: "wake",
    tags: [],
    type: "configureTimerTrigger",
    timer: "wake",
    timerId: 6,
    seconds: 0.5,
  }], handles), "gameplayAuthoring.commands.0.type");
});

test("applyGameplayBehaviorCommands requires atomic damage reaction setter", () => {
  const handles = { enemy: { entityId: 1, entityGeneration: 10 } };
  const command: BehaviorRecipeCommand = {
    entity: "enemy",
    recipe: "damage",
    tags: [],
    type: "configureDamage",
    amount: 3,
    target: "other",
    cooldownSeconds: 0,
  };

  const missingSetterEngine = new MockGameplayEngine();
  Object.defineProperty(missingSetterEngine, "set_gameplay_damage_reaction", { value: undefined });
  expectDiagnostic(
    () => applyGameplayBehaviorCommands(missingSetterEngine, [command], handles),
    "gameplayAuthoring.commands.0.type",
  );
  deepEqual(missingSetterEngine.calls, []);

  const failingEngine = new MockGameplayEngine();
  failingEngine.failNext = true;
  expectDiagnostic(
    () => applyGameplayBehaviorCommands(failingEngine, [command], handles),
    "gameplayAuthoring.commands.0",
  );
  deepEqual(failingEngine.calls, [["set_gameplay_damage_reaction", 1, 10, 3, 1]]);
});

test("applyGameplayBehaviorCommands reports missing handles and failed rust applies", () => {
  const engine = new MockGameplayEngine();
  const command: BehaviorRecipeCommand = {
    entity: "enemy",
    recipe: "living",
    tags: [],
    type: "configureHealth",
    max: 1,
    current: 1,
    onZero: "despawn",
  };

  expectDiagnostic(() => applyGameplayBehaviorCommands(engine, [command], {}), "gameplayAuthoring.commands.0.entity");

  engine.failNext = true;
  const diagnostic = expectDiagnostic(
    () => applyGameplayBehaviorCommands(engine, [command], { enemy: { entityId: 1, entityGeneration: 1 } }),
    "gameplayAuthoring.commands.0",
  );
  const detail =
    (diagnostic as Error & { context?: { detail?: string } }).context?.detail ?? diagnostic.message;
  ok(/runtime rejected 'configureHealth' for entity 'enemy'/.test(detail));
  ok(/stale handles/.test(detail));
  ok(/capacity limits/.test(detail));
});

test("applyFactionRelationTable validates and applies directed relations", () => {
  const engine = new MockGameplayEngine();

  const result = applyFactionRelationTable(engine, {
    defaultRelation: "friendly",
    relations: [
      { source: "player", target: "enemy", relation: "hostile" },
      { source: 2, target: "player", relation: "neutral" },
    ],
  });

  deepEqual(result, {
    applied: true,
    defaultRelation: "friendly",
    relationCount: 2,
  });
  deepEqual(engine.calls, [
    ["clear_gameplay_faction_relations"],
    ["set_gameplay_faction_default_relation", 1],
    ["set_gameplay_faction_relation", 1, 2, 2],
    ["set_gameplay_faction_relation", 2, 1, 0],
  ]);
});

test("applyFactionRelationTable reports invalid entries and runtime rejection", () => {
  const engine = new MockGameplayEngine();

  expectDiagnostic(() => applyFactionRelationTable(engine, {
    relations: [
      { source: "ally" as "player", target: "enemy", relation: "hostile" },
    ],
  }), "factionRelationTable.relations.0.source");
  deepEqual(engine.calls, []);

  expectDiagnostic(() => applyFactionRelationTable(engine, {
    relations: [
      { source: "player", target: "enemy", relation: "ally" as "hostile" },
    ],
  }), "factionRelationTable.relations.0.relation");
  deepEqual(engine.calls, []);

  expectDiagnostic(() => applyFactionRelationTable(engine, {
    relations: [
      { source: "player", target: "enemy", relation: "hostile" },
      { source: "player", target: "ally" as "enemy", relation: "friendly" },
    ],
  }), "factionRelationTable.relations.1.target");
  deepEqual(engine.calls, []);

  const failingEngine = new MockGameplayEngine();
  failingEngine.failNext = true;
  expectDiagnostic(() => applyFactionRelationTable(failingEngine, {
    defaultRelation: "hostile",
    relations: [],
  }), "factionRelationTable.defaultRelation");
  deepEqual(failingEngine.calls, [
    ["clear_gameplay_faction_relations"],
    ["set_gameplay_faction_default_relation", 2],
  ]);
});

function expectDiagnostic(fn: () => void, path: string): Error {
  try {
    fn();
  } catch (error) {
    equal(error instanceof Error, true);
    const diagnostic = error as Error & { context?: { path?: string } };
    equal(diagnostic.context?.path, path);
    return diagnostic;
  }
  throw new Error("Expected function to throw.");
}
