import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  applyBehaviorRecipes,
  behaviorRecipeCommandsForEntity,
  resolveBehaviorRecipeDocument,
} from "../src/behaviorRecipes.js";
import type { BehaviorRecipeDocumentSpec } from "../src/behaviorRecipes.js";

function sampleRecipes(): BehaviorRecipeDocumentSpec {
  return {
    recipes: {
      living: { kind: "health", max: 5, start: 3, onZero: "event", event: "enemy.defeated" },
      contactDamage: { kind: "damage", amount: 2, cooldownSeconds: 0.25 },
      enemyFaction: { kind: "faction", faction: "enemy", damages: ["player"] },
      shortLived: { kind: "lifetime", seconds: 1.5 },
      killReward: { kind: "scoreReward", reward: 4 },
    },
    entities: {
      enemy: {
        tags: ["hostile"],
        recipes: [
          "living",
          { use: "contactDamage", id: "enemyDamage", overrides: { amount: 3 } },
          "enemyFaction",
          "shortLived",
          "killReward",
          { kind: "chase", target: "player", speed: 96, stopDistance: 18 },
        ],
      },
      coin: {
        recipes: [
          { kind: "pickup", item: "coin", itemId: 1, count: 2 },
          { kind: "interaction", action: "inspect", actionId: 2, prompt: "Inspect", radius: 20 },
          { kind: "projectileAction", action: "primary", actionId: 1, cooldownSeconds: 0.12, speed: 420, damage: 2, lifetimeSeconds: 1.4, tileImpact: "despawn" },
          { kind: "dashAction", action: "dash", actionId: 3, cooldownSeconds: 0.75, distance: 96 },
          { kind: "meleeAction", action: "slash", actionId: 4, cooldownSeconds: 0.4, range: 36, damage: 3 },
          { kind: "collisionPickup", target: "self" },
          { kind: "collisionSound", soundId: 9, volume: 0.6, pitch: 1.2, cooldownSeconds: 0.25, replaceDefault: true, trigger: "enter" },
          { kind: "collisionParticle", presetId: 3, target: "other", cooldownSeconds: 0.5, replaceDefault: true, trigger: "enter" },
          { kind: "collisionDespawn", target: "self" },
          { kind: "spawnPrefabAction", action: "summon", actionId: 5, prefab: "enemy", prefabId: 1, cooldownSeconds: 1.2, offsetX: 12, offsetY: -6 },
          { kind: "timerTrigger", timer: "wake", timerId: 6, seconds: 0.5 },
        ],
      },
    },
  };
}

test("resolveBehaviorRecipeDocument resolves reusable recipes and entity overrides", () => {
  const document = resolveBehaviorRecipeDocument(sampleRecipes());
  equal(document.entities.enemy.tags[0], "hostile");
  equal(document.entities.enemy.recipes[1].id, "enemyDamage");
  equal(document.entities.enemy.recipes[1].kind, "damage");
  if (document.entities.enemy.recipes[1].kind === "damage") {
    equal(document.entities.enemy.recipes[1].amount, 3);
  }
  equal(document.entities.coin.recipes[0].kind, "pickup");
});

test("behaviorRecipeCommandsForEntity emits runtime adapter commands", () => {
  const commands = behaviorRecipeCommandsForEntity(sampleRecipes(), "enemy");
  deepEqual(commands.map((command) => command.type), [
    "configureHealth",
    "configureDamage",
    "configureFaction",
    "configureLifetime",
    "configureScoreReward",
    "configureChase",
  ]);
  const health = commands[0];
  equal(health.type, "configureHealth");
  if (health.type === "configureHealth") {
    equal(health.current, 3);
    equal(health.event, "enemy.defeated");
  }
  const chase = behaviorRecipeCommandsForEntity(sampleRecipes(), "enemy", { kinds: ["chase"] })[0];
  equal(chase.type, "configureChase");
  const faction = behaviorRecipeCommandsForEntity(sampleRecipes(), "enemy", { kinds: ["faction"] })[0];
  equal(faction.type, "configureFaction");
  if (faction.type === "configureFaction") {
    equal(faction.faction, "enemy");
    deepEqual(faction.damages, ["player"]);
  }
  const neutralFaction = behaviorRecipeCommandsForEntity({
    entities: {
      prop: { recipes: [{ kind: "faction", faction: "neutral" }] },
    },
  }, "prop", { kinds: ["faction"] })[0];
  equal(neutralFaction.type, "configureFaction");
  if (neutralFaction.type === "configureFaction") {
    equal(neutralFaction.faction, "neutral");
    deepEqual(neutralFaction.damages, []);
  }
  const customFaction = behaviorRecipeCommandsForEntity({
    entities: {
      ally: { recipes: [{ kind: "faction", faction: 7, damages: [2, "player"] }] },
      observer: { recipes: [{ kind: "faction", faction: 8 }] },
    },
  }, "ally", { kinds: ["faction"] })[0];
  equal(customFaction.type, "configureFaction");
  if (customFaction.type === "configureFaction") {
    equal(customFaction.faction, 7);
    deepEqual(customFaction.damages, [2, "player"]);
  }
  const customNeutral = behaviorRecipeCommandsForEntity({
    entities: {
      observer: { recipes: [{ kind: "faction", faction: 8 }] },
    },
  }, "observer", { kinds: ["faction"] })[0];
  equal(customNeutral.type, "configureFaction");
  if (customNeutral.type === "configureFaction") {
    equal(customNeutral.faction, 8);
    deepEqual(customNeutral.damages, []);
  }
  const scalarCommands = behaviorRecipeCommandsForEntity(sampleRecipes(), "enemy", { kinds: ["lifetime", "scoreReward"] });
  deepEqual(scalarCommands.map((command) => command.type), ["configureLifetime", "configureScoreReward"]);
  if (scalarCommands[0]?.type === "configureLifetime") {
    equal(scalarCommands[0].seconds, 1.5);
  }
  if (scalarCommands[1]?.type === "configureScoreReward") {
    equal(scalarCommands[1].reward, 4);
  }

  const pickup = behaviorRecipeCommandsForEntity(sampleRecipes(), "coin", { kinds: ["pickup"] })[0];
  equal(pickup.type, "configurePickup");
  if (pickup.type === "configurePickup") {
    equal(pickup.itemId, 1);
  }
  const interaction = behaviorRecipeCommandsForEntity(sampleRecipes(), "coin", { kinds: ["interaction"] })[0];
  equal(interaction.type, "configureInteraction");
  if (interaction.type === "configureInteraction") {
    equal(interaction.actionId, 2);
  }
  const projectile = behaviorRecipeCommandsForEntity(sampleRecipes(), "coin", { kinds: ["projectileAction"] })[0];
  equal(projectile.type, "configureProjectileAction");
  if (projectile.type === "configureProjectileAction") {
    equal(projectile.actionId, 1);
    equal(projectile.speed, 420);
    equal(projectile.lifetimeSeconds, 1.4);
    equal(projectile.aim, "input");
    equal(projectile.collisionTarget, "enemies");
    equal(projectile.tileImpact, "despawn");
  }
  const dash = behaviorRecipeCommandsForEntity(sampleRecipes(), "coin", { kinds: ["dashAction"] })[0];
  equal(dash.type, "configureDashAction");
  if (dash.type === "configureDashAction") {
    equal(dash.actionId, 3);
    equal(dash.cooldownSeconds, 0.75);
    equal(dash.distance, 96);
    equal(dash.aim, "input");
  }
  const melee = behaviorRecipeCommandsForEntity(sampleRecipes(), "coin", { kinds: ["meleeAction"] })[0];
  equal(melee.type, "configureMeleeAction");
  if (melee.type === "configureMeleeAction") {
    equal(melee.actionId, 4);
    equal(melee.range, 36);
    equal(melee.damage, 3);
    equal(melee.target, "enemies");
  }
  const collisionPickup = behaviorRecipeCommandsForEntity(sampleRecipes(), "coin", { kinds: ["collisionPickup"] })[0];
  equal(collisionPickup.type, "configureCollisionPickup");
  if (collisionPickup.type === "configureCollisionPickup") {
    equal(collisionPickup.target, "self");
  }
  const collisionSound = behaviorRecipeCommandsForEntity(sampleRecipes(), "coin", { kinds: ["collisionSound"] })[0];
  equal(collisionSound.type, "configureCollisionSound");
  if (collisionSound.type === "configureCollisionSound") {
    equal(collisionSound.soundId, 9);
    equal(collisionSound.volume, 0.6);
    equal(collisionSound.pitch, 1.2);
    equal(collisionSound.cooldownSeconds, 0.25);
    equal(collisionSound.replaceDefault, true);
    equal(collisionSound.trigger, "enter");
  }
  const collisionParticle = behaviorRecipeCommandsForEntity(sampleRecipes(), "coin", { kinds: ["collisionParticle"] })[0];
  equal(collisionParticle.type, "configureCollisionParticle");
  if (collisionParticle.type === "configureCollisionParticle") {
    equal(collisionParticle.presetId, 3);
    equal(collisionParticle.target, "other");
    equal(collisionParticle.cooldownSeconds, 0.5);
    equal(collisionParticle.replaceDefault, true);
    equal(collisionParticle.trigger, "enter");
  }
  const collisionDespawn = behaviorRecipeCommandsForEntity(sampleRecipes(), "coin", { kinds: ["collisionDespawn"] })[0];
  equal(collisionDespawn.type, "configureCollisionDespawn");
  if (collisionDespawn.type === "configureCollisionDespawn") {
    equal(collisionDespawn.target, "self");
  }
  const spawnPrefab = behaviorRecipeCommandsForEntity(sampleRecipes(), "coin", { kinds: ["spawnPrefabAction"] })[0];
  equal(spawnPrefab.type, "configureSpawnPrefabAction");
  if (spawnPrefab.type === "configureSpawnPrefabAction") {
    equal(spawnPrefab.actionId, 5);
    equal(spawnPrefab.prefabId, 1);
    equal(spawnPrefab.offsetY, -6);
  }
  const timer = behaviorRecipeCommandsForEntity(sampleRecipes(), "coin", { kinds: ["timerTrigger"] })[0];
  equal(timer.type, "configureTimerTrigger");
  if (timer.type === "configureTimerTrigger") {
    equal(timer.timerId, 6);
    equal(timer.seconds, 0.5);
  }
});

test("applyBehaviorRecipes forwards commands to a target adapter", () => {
  const applied: string[] = [];
  const result = applyBehaviorRecipes({
    applyBehaviorRecipeCommand: (command) => {
      applied.push(`${command.entity}:${command.type}`);
      return command.recipe;
    },
  }, resolveBehaviorRecipeDocument(sampleRecipes()), { entity: "coin" });

  deepEqual(applied, [
    "coin:configurePickup",
    "coin:configureInteraction",
    "coin:configureProjectileAction",
    "coin:configureDashAction",
    "coin:configureMeleeAction",
    "coin:configureCollisionPickup",
    "coin:configureCollisionSound",
    "coin:configureCollisionParticle",
    "coin:configureCollisionDespawn",
    "coin:configureSpawnPrefabAction",
    "coin:configureTimerTrigger",
  ]);
  deepEqual(result.results, ["coin.0", "coin.1", "coin.2", "coin.3", "coin.4", "coin.5", "coin.6", "coin.7", "coin.8", "coin.9", "coin.10"]);
});

test("projectileAction carries aim and collision target authoring metadata", () => {
  const commands = behaviorRecipeCommandsForEntity({
    entities: {
      turret: {
        recipes: [{
          kind: "projectileAction",
          action: "shoot-player",
          cooldownSeconds: 0.4,
          speed: 360,
          damage: 1,
          lifetimeSeconds: 1.2,
          aim: "targetPlayer",
          collisionTarget: "player",
          tileImpact: "despawn",
        }],
      },
    },
  }, "turret");

  const [command] = commands;
  equal(command?.type, "configureProjectileAction");
  if (command?.type === "configureProjectileAction") {
    equal(command.aim, "targetPlayer");
    equal(command.collisionTarget, "player");
    equal(command.tileImpact, "despawn");
  }
});

test("meleeAction carries target authoring metadata", () => {
  const commands = behaviorRecipeCommandsForEntity({
    entities: {
      guard: {
        recipes: [{
          kind: "meleeAction",
          action: "slash-player",
          cooldownSeconds: 0.4,
          range: 40,
          damage: 2,
          target: "player",
        }],
      },
    },
  }, "guard");

  const [command] = commands;
  equal(command?.type, "configureMeleeAction");
  if (command?.type === "configureMeleeAction") {
    equal(command.target, "player");
  }
});

test("resolveBehaviorRecipeDocument rejects invalid recipe references and duplicate ids", () => {
  expectMessage(() => resolveBehaviorRecipeDocument({
    entities: {
      enemy: { recipes: ["missing"] },
    },
  }), /unknown recipe/);

  expectMessage(() => resolveBehaviorRecipeDocument({
    recipes: {
      base: { kind: "health" },
    },
    entities: {
      enemy: {
        recipes: [
          { use: "base", id: "same" },
          { kind: "damage", id: "same" },
        ],
      },
    },
  }), /recipe id must be unique/);

  expectMessage(() => resolveBehaviorRecipeDocument({
    entities: {
      enemy: { recipes: [{ kind: "pickup", item: "" }] },
    },
  }), /non-empty string/);

  expectMessage(() => resolveBehaviorRecipeDocument({
    entities: {
      enemy: { recipes: [{ kind: "lifetime", seconds: 0 }] },
    },
  }), /greater than 0/);

  expectMessage(() => resolveBehaviorRecipeDocument({
    entities: {
      enemy: { recipes: [{ kind: "scoreReward", reward: 1.5 }] },
    },
  }), /non-negative integer/);

  expectMessage(() => resolveBehaviorRecipeDocument({
    entities: {
      enemy: { recipes: [{ kind: "faction", faction: "ally" as "enemy" }] },
    },
  }), /integer faction id between 0 and 31/);

  expectMessage(() => resolveBehaviorRecipeDocument({
    entities: {
      enemy: { recipes: [{ kind: "faction", faction: 32 }] },
    },
  }), /integer faction id between 0 and 31/);

  expectMessage(() => resolveBehaviorRecipeDocument({
    entities: {
      enemy: { recipes: [{ kind: "pickup", item: "coin", itemId: 0 }] },
    },
  }), /positive integer/);

  expectMessage(() => resolveBehaviorRecipeDocument({
    entities: {
      enemy: { recipes: [{ kind: "interaction", action: "inspect", actionId: 1.5 }] },
    },
  }), /positive integer/);

  expectMessage(() => resolveBehaviorRecipeDocument({
    entities: {
      enemy: { recipes: [{ kind: "projectileAction", action: "primary", speed: 0 }] },
    },
  }), /greater than 0/);

  expectMessage(() => resolveBehaviorRecipeDocument({
    entities: {
      enemy: {
        recipes: [{
          kind: "projectileAction",
          action: "primary",
          collisionTarget: "walls",
        }],
      },
    },
  } as unknown as BehaviorRecipeDocumentSpec), /one of enemies or player/);

  expectMessage(() => resolveBehaviorRecipeDocument({
    entities: {
      enemy: {
        recipes: [{
          kind: "projectileAction",
          action: "primary",
          tileImpact: "stick",
        }],
      },
    },
  } as unknown as BehaviorRecipeDocumentSpec), /one of despawn, passThrough, or bounce/);

  expectMessage(() => resolveBehaviorRecipeDocument({
    entities: {
      enemy: { recipes: [{ kind: "dashAction", action: "dash", distance: 0 }] },
    },
  }), /greater than 0/);

  expectMessage(() => resolveBehaviorRecipeDocument({
    entities: {
      enemy: { recipes: [{ kind: "meleeAction", action: "slash", range: 0 }] },
    },
  }), /greater than 0/);

  expectMessage(() => resolveBehaviorRecipeDocument({
    entities: {
      enemy: {
        recipes: [{
          kind: "meleeAction",
          action: "slash",
          target: "walls",
        }],
      },
    },
  } as unknown as BehaviorRecipeDocumentSpec), /one of enemies or player/);

  expectMessage(() => resolveBehaviorRecipeDocument({
    entities: {
      enemy: { recipes: [{ kind: "timerTrigger", timer: "wake", seconds: 0 }] },
    },
  }), /greater than 0/);
});

function expectMessage(fn: () => void, pattern: RegExp): void {
  try {
    fn();
  } catch (error) {
    equal(error instanceof Error, true);
    equal(pattern.test(error instanceof Error ? error.message : String(error)), true);
    return;
  }
  throw new Error("Expected function to throw.");
}
