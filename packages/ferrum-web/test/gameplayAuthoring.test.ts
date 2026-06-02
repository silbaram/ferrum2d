import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  GAMEPLAY_BEHAVIOR_BINDING_PROP,
  applyGameplayBehaviorCommands,
  bindSceneBehaviorRecipes,
  createGameplayBehaviorRuntimeTarget,
  dryRunSceneBehaviorRecipes,
  resolveGameplayBehaviorRuntimeIds,
} from "../src/gameplayAuthoring.js";
import type { BehaviorRecipeDocumentSpec, BehaviorRecipeCommand } from "../src/behaviorRecipes.js";
import type { GameplayBehaviorRuntimeEngine, GameplayEntityHandle } from "../src/gameplayAuthoring.js";
import type { SceneCompositionSpec } from "../src/sceneComposition.js";

class MockGameplayEngine implements GameplayBehaviorRuntimeEngine {
  readonly calls: unknown[][] = [];
  failNext = false;

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

  clear_gameplay_actions(...args: [number, number]): boolean {
    this.calls.push(["clear_gameplay_actions", ...args]);
    return this.consumeResult();
  }

  set_gameplay_movement_chase_player(...args: [number, number, number]): boolean {
    this.calls.push(["set_gameplay_movement_chase_player", ...args]);
    return this.consumeResult();
  }

  set_gameplay_movement_chase_entity(...args: [number, number, number, number, number]): boolean {
    this.calls.push(["set_gameplay_movement_chase_entity", ...args]);
    return this.consumeResult();
  }

  add_gameplay_collision_damage(...args: [number, number, number]): boolean {
    this.calls.push(["add_gameplay_collision_damage", ...args]);
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

  private consumeResult(): boolean {
    if (this.failNext) {
      this.failNext = false;
      return false;
    }
    return true;
  }
}

test("resolveGameplayBehaviorRuntimeIds validates named runtime id registries", () => {
  deepEqual(resolveGameplayBehaviorRuntimeIds({
    items: { score: 1 },
    actions: { primary: 1, inspect: 7 },
    prefabs: { enemy: 1 },
    timers: { wake: 6 },
  }, {
    requiredItems: ["score"],
    requiredActions: ["primary", "inspect"],
    requiredPrefabs: ["enemy"],
    requiredTimers: ["wake"],
  }), {
    items: { score: 1 },
    actions: { primary: 1, inspect: 7 },
    prefabs: { enemy: 1 },
    timers: { wake: 6 },
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
          { kind: "chase", target: "player", speed: 80, stopDistance: 0 },
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
    ["set_gameplay_movement_chase_player", 1, 10, 80],
    ["set_gameplay_action_projectile", 1, 10, 1, 0.12, 420, 2, 1.4],
    ["set_gameplay_action_melee", 1, 10, 3, 0.35, 36, 3],
    ["set_gameplay_health", 2, 20, 2],
    ["set_gameplay_lifetime", 2, 20, 0.75],
    ["set_gameplay_movement_chase_player", 2, 20, 80],
    ["set_gameplay_action_projectile", 2, 20, 1, 0.12, 420, 2, 1.4],
    ["set_gameplay_action_melee", 2, 20, 3, 0.35, 36, 3],
    ["set_gameplay_damage_reaction", 2, 20, 2, 1],
    ["set_gameplay_score_reward", 2, 20, 5],
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
  ], handles);

  deepEqual(result.results, [true, true]);
  deepEqual(engine.calls, [
    ["set_gameplay_movement_chase_entity", 1, 10, 2, 20, 64],
    ["set_gameplay_damage_reaction", 1, 10, 3, 0],
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
  ], handles, {
    ids: {
      actions: { spawn: 12 },
      prefabs: { enemy: 1 },
    },
  });

  deepEqual(result.results, [true, true]);
  deepEqual(engine.calls, [
    ["set_gameplay_action_spawn_prefab", 7, 8, 11, 1.2, 1, 0, 0, 12, -6],
    ["set_gameplay_action_spawn_prefab", 9, 10, 12, 0.5, 1, 0, 0, 0, 4],
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
  expectDiagnostic(
    () => applyGameplayBehaviorCommands(engine, [command], { enemy: { entityId: 1, entityGeneration: 1 } }),
    "gameplayAuthoring.commands.0",
  );
});

function expectDiagnostic(fn: () => void, path: string): void {
  try {
    fn();
  } catch (error) {
    equal(error instanceof Error, true);
    const diagnostic = error as Error & { context?: { path?: string } };
    equal(diagnostic.context?.path, path);
    return;
  }
  throw new Error("Expected function to throw.");
}
