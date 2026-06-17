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
          { kind: "chase", target: "primaryActor", speed: 96, stopDistance: 18 },
          { kind: "chase", target: "nearestPrimaryActor", speed: 84, stopDistance: 0 },
          { kind: "chase", target: "nearestEnemy", speed: 72, stopDistance: 0 },
          { kind: "chase", target: "nearestLayer:bullet", speed: 60, stopDistance: 0 },
          { kind: "chase", target: "nearestFaction:enemy", speed: 54, stopDistance: 0 },
          { kind: "chase", target: "nearestTag:hostile", speed: 52, stopDistance: 0 },
          { kind: "seekTarget", target: "primaryActor", speed: 220, turnRate: 4 },
          { kind: "seekTarget", target: "nearestPrimaryActor", speed: 200, turnRate: 3 },
          { kind: "seekTarget", target: "nearestEnemy", speed: 180, turnRate: 2 },
          { kind: "seekTarget", target: "nearestLayer:pickup", speed: 160, turnRate: 1.5 },
          { kind: "seekTarget", target: "nearestFaction:7", speed: 150, turnRate: 1.25 },
          { kind: "seekTarget", target: "nearestTag:3", speed: 140, turnRate: 1 },
          { kind: "accelerate", accelerationX: 2, accelerationY: -1, maxSpeed: 12 },
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
          { kind: "collisionAreaDamage", amount: 4, radius: 72, targetLayer: "enemy" },
          { kind: "collisionKnockback", target: "other", impulse: 180 },
          { kind: "collisionEmitEffect", effectId: 99, effectKind: "custom", target: "self", intensity: 0.65, radius: 48, cooldownSeconds: 0.25, trigger: "enter" },
          { kind: "collisionSpawnPrefab", action: "split", actionId: 7, prefab: "enemy", prefabId: 1, target: "other", cooldownSeconds: 0.5, trigger: "enter", offsetX: 6, offsetY: -3 },
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
    "configureChase",
    "configureChase",
    "configureChase",
    "configureChase",
    "configureChase",
    "configureSeekTarget",
    "configureSeekTarget",
    "configureSeekTarget",
    "configureSeekTarget",
    "configureSeekTarget",
    "configureSeekTarget",
    "configureAccelerate",
  ]);
  const health = commands[0];
  equal(health.type, "configureHealth");
  if (health.type === "configureHealth") {
    equal(health.current, 3);
    equal(health.event, "enemy.defeated");
  }
  const chase = behaviorRecipeCommandsForEntity(sampleRecipes(), "enemy", { kinds: ["chase"] })[0];
  equal(chase.type, "configureChase");
  if (chase.type === "configureChase") {
    equal(chase.target, "primaryActor");
    equal(chase.speed, 96);
    equal(chase.stopDistance, 18);
  }
  const chaseNearestPrimaryActor = behaviorRecipeCommandsForEntity(sampleRecipes(), "enemy", { kinds: ["chase"] })[1];
  equal(chaseNearestPrimaryActor.type, "configureChase");
  if (chaseNearestPrimaryActor.type === "configureChase") {
    equal(chaseNearestPrimaryActor.target, "nearestPrimaryActor");
    equal(chaseNearestPrimaryActor.speed, 84);
    equal(chaseNearestPrimaryActor.stopDistance, 0);
  }
  const chaseQueryPreset = behaviorRecipeCommandsForEntity(sampleRecipes(), "enemy", { kinds: ["chase"] })[2];
  equal(chaseQueryPreset.type, "configureChase");
  if (chaseQueryPreset.type === "configureChase") {
    equal(chaseQueryPreset.target, "nearestEnemy");
    equal(chaseQueryPreset.speed, 72);
    equal(chaseQueryPreset.stopDistance, 0);
  }
  const chaseLayerQueryPreset = behaviorRecipeCommandsForEntity(sampleRecipes(), "enemy", { kinds: ["chase"] })[3];
  equal(chaseLayerQueryPreset.type, "configureChase");
  if (chaseLayerQueryPreset.type === "configureChase") {
    equal(chaseLayerQueryPreset.target, "nearestLayer:bullet");
    equal(chaseLayerQueryPreset.speed, 60);
    equal(chaseLayerQueryPreset.stopDistance, 0);
  }
  const chaseFactionQueryPreset = behaviorRecipeCommandsForEntity(sampleRecipes(), "enemy", { kinds: ["chase"] })[4];
  equal(chaseFactionQueryPreset.type, "configureChase");
  if (chaseFactionQueryPreset.type === "configureChase") {
    equal(chaseFactionQueryPreset.target, "nearestFaction:enemy");
    equal(chaseFactionQueryPreset.speed, 54);
    equal(chaseFactionQueryPreset.stopDistance, 0);
  }
  const chaseTagQueryPreset = behaviorRecipeCommandsForEntity(sampleRecipes(), "enemy", { kinds: ["chase"] })[5];
  equal(chaseTagQueryPreset.type, "configureChase");
  if (chaseTagQueryPreset.type === "configureChase") {
    equal(chaseTagQueryPreset.target, "nearestTag:hostile");
    equal(chaseTagQueryPreset.speed, 52);
    equal(chaseTagQueryPreset.stopDistance, 0);
  }
  const seekTarget = behaviorRecipeCommandsForEntity(sampleRecipes(), "enemy", { kinds: ["seekTarget"] })[0];
  equal(seekTarget.type, "configureSeekTarget");
  if (seekTarget.type === "configureSeekTarget") {
    equal(seekTarget.target, "primaryActor");
    equal(seekTarget.speed, 220);
    equal(seekTarget.turnRate, 4);
  }
  const seekTargetNearestPrimaryActor = behaviorRecipeCommandsForEntity(sampleRecipes(), "enemy", { kinds: ["seekTarget"] })[1];
  equal(seekTargetNearestPrimaryActor.type, "configureSeekTarget");
  if (seekTargetNearestPrimaryActor.type === "configureSeekTarget") {
    equal(seekTargetNearestPrimaryActor.target, "nearestPrimaryActor");
    equal(seekTargetNearestPrimaryActor.speed, 200);
    equal(seekTargetNearestPrimaryActor.turnRate, 3);
  }
  const seekTargetQueryPreset = behaviorRecipeCommandsForEntity(sampleRecipes(), "enemy", { kinds: ["seekTarget"] })[2];
  equal(seekTargetQueryPreset.type, "configureSeekTarget");
  if (seekTargetQueryPreset.type === "configureSeekTarget") {
    equal(seekTargetQueryPreset.target, "nearestEnemy");
    equal(seekTargetQueryPreset.speed, 180);
    equal(seekTargetQueryPreset.turnRate, 2);
  }
  const seekTargetLayerQueryPreset = behaviorRecipeCommandsForEntity(sampleRecipes(), "enemy", { kinds: ["seekTarget"] })[3];
  equal(seekTargetLayerQueryPreset.type, "configureSeekTarget");
  if (seekTargetLayerQueryPreset.type === "configureSeekTarget") {
    equal(seekTargetLayerQueryPreset.target, "nearestLayer:pickup");
    equal(seekTargetLayerQueryPreset.speed, 160);
    equal(seekTargetLayerQueryPreset.turnRate, 1.5);
  }
  const seekTargetFactionQueryPreset = behaviorRecipeCommandsForEntity(sampleRecipes(), "enemy", { kinds: ["seekTarget"] })[4];
  equal(seekTargetFactionQueryPreset.type, "configureSeekTarget");
  if (seekTargetFactionQueryPreset.type === "configureSeekTarget") {
    equal(seekTargetFactionQueryPreset.target, "nearestFaction:7");
    equal(seekTargetFactionQueryPreset.speed, 150);
    equal(seekTargetFactionQueryPreset.turnRate, 1.25);
  }
  const seekTargetTagQueryPreset = behaviorRecipeCommandsForEntity(sampleRecipes(), "enemy", { kinds: ["seekTarget"] })[5];
  equal(seekTargetTagQueryPreset.type, "configureSeekTarget");
  if (seekTargetTagQueryPreset.type === "configureSeekTarget") {
    equal(seekTargetTagQueryPreset.target, "nearestTag:3");
    equal(seekTargetTagQueryPreset.speed, 140);
    equal(seekTargetTagQueryPreset.turnRate, 1);
  }

  const taggedCommands = behaviorRecipeCommandsForEntity(sampleRecipes(), "enemy", {
    includeEntityTags: true,
    kinds: ["chase"],
  });
  equal(taggedCommands[0]?.type, "configureTags");
  if (taggedCommands[0]?.type === "configureTags") {
    deepEqual(taggedCommands[0].tags, ["hostile"]);
  }
  const accelerate = behaviorRecipeCommandsForEntity(sampleRecipes(), "enemy", { kinds: ["accelerate"] })[0];
  equal(accelerate.type, "configureAccelerate");
  if (accelerate.type === "configureAccelerate") {
    equal(accelerate.accelerationX, 2);
    equal(accelerate.accelerationY, -1);
    equal(accelerate.maxSpeed, 12);
  }
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
  const collisionAreaDamage = behaviorRecipeCommandsForEntity(sampleRecipes(), "coin", { kinds: ["collisionAreaDamage"] })[0];
  equal(collisionAreaDamage.type, "configureCollisionAreaDamage");
  if (collisionAreaDamage.type === "configureCollisionAreaDamage") {
    equal(collisionAreaDamage.amount, 4);
    equal(collisionAreaDamage.radius, 72);
    equal(collisionAreaDamage.targetLayer, "enemy");
  }
  const collisionKnockback = behaviorRecipeCommandsForEntity(sampleRecipes(), "coin", { kinds: ["collisionKnockback"] })[0];
  equal(collisionKnockback.type, "configureCollisionKnockback");
  if (collisionKnockback.type === "configureCollisionKnockback") {
    equal(collisionKnockback.target, "other");
    equal(collisionKnockback.impulse, 180);
  }
  const collisionEmitEffect = behaviorRecipeCommandsForEntity(sampleRecipes(), "coin", { kinds: ["collisionEmitEffect"] })[0];
  equal(collisionEmitEffect.type, "configureCollisionEmitEffect");
  if (collisionEmitEffect.type === "configureCollisionEmitEffect") {
    equal(collisionEmitEffect.effectId, 99);
    equal(collisionEmitEffect.effectKind, "custom");
    equal(collisionEmitEffect.effectType, 4);
    equal(collisionEmitEffect.target, "self");
    equal(collisionEmitEffect.intensity, 0.65);
    equal(collisionEmitEffect.radius, 48);
    equal(collisionEmitEffect.cooldownSeconds, 0.25);
    equal(collisionEmitEffect.trigger, "enter");
  }
  const collisionSpawnPrefab = behaviorRecipeCommandsForEntity(sampleRecipes(), "coin", { kinds: ["collisionSpawnPrefab"] })[0];
  equal(collisionSpawnPrefab.type, "configureCollisionSpawnPrefab");
  if (collisionSpawnPrefab.type === "configureCollisionSpawnPrefab") {
    equal(collisionSpawnPrefab.actionId, 7);
    equal(collisionSpawnPrefab.prefabId, 1);
    equal(collisionSpawnPrefab.target, "other");
    equal(collisionSpawnPrefab.cooldownSeconds, 0.5);
    equal(collisionSpawnPrefab.trigger, "enter");
    equal(collisionSpawnPrefab.offsetX, 6);
    equal(collisionSpawnPrefab.offsetY, -3);
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

test("movement recipes default to the primary actor target", () => {
  const commands = behaviorRecipeCommandsForEntity({
    entities: {
      enemy: {
        recipes: [
          { kind: "chase" },
          { kind: "seekTarget" },
        ],
      },
    },
  }, "enemy");

  equal(commands[0]?.type, "configureChase");
  if (commands[0]?.type === "configureChase") {
    equal(commands[0].target, "primaryActor");
  }
  equal(commands[1]?.type, "configureSeekTarget");
  if (commands[1]?.type === "configureSeekTarget") {
    equal(commands[1].target, "primaryActor");
  }
});

test("movement recipes keep legacy player target aliases", () => {
  const commands = behaviorRecipeCommandsForEntity({
    entities: {
      enemy: {
        recipes: [
          { kind: "chase", target: "player" },
          { kind: "chase", target: "nearestPlayer" },
          { kind: "seekTarget", target: "player" },
          { kind: "seekTarget", target: "nearestPlayer" },
        ],
      },
    },
  }, "enemy");

  equal(commands[0]?.type, "configureChase");
  if (commands[0]?.type === "configureChase") {
    equal(commands[0].target, "player");
  }
  equal(commands[1]?.type, "configureChase");
  if (commands[1]?.type === "configureChase") {
    equal(commands[1].target, "nearestPlayer");
  }
  equal(commands[2]?.type, "configureSeekTarget");
  if (commands[2]?.type === "configureSeekTarget") {
    equal(commands[2].target, "player");
  }
  equal(commands[3]?.type, "configureSeekTarget");
  if (commands[3]?.type === "configureSeekTarget") {
    equal(commands[3].target, "nearestPlayer");
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
    "coin:configureCollisionAreaDamage",
    "coin:configureCollisionKnockback",
    "coin:configureCollisionEmitEffect",
    "coin:configureCollisionSpawnPrefab",
    "coin:configureCollisionSound",
    "coin:configureCollisionParticle",
    "coin:configureCollisionDespawn",
    "coin:configureSpawnPrefabAction",
    "coin:configureTimerTrigger",
  ]);
  deepEqual(result.results, ["coin.0", "coin.1", "coin.2", "coin.3", "coin.4", "coin.5", "coin.6", "coin.7", "coin.8", "coin.9", "coin.10", "coin.11", "coin.12", "coin.13", "coin.14"]);
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
      enemy: { recipes: [{ kind: "collisionEmitEffect", effectKind: "flash" }] },
    },
  } as unknown as BehaviorRecipeDocumentSpec), /sound, particle, cameraShake, or custom/);

  expectMessage(() => resolveBehaviorRecipeDocument({
    entities: {
      enemy: { recipes: [{ kind: "collisionEmitEffect", cooldownSeconds: -0.1 }] },
    },
  }), /greater than or equal to 0/);

  expectMessage(() => resolveBehaviorRecipeDocument({
    entities: {
      enemy: { recipes: [{ kind: "collisionEmitEffect", effectId: 0x1_0000_0000 }] },
    },
  }), /safe u32/);

  expectMessage(() => resolveBehaviorRecipeDocument({
    entities: {
      enemy: { recipes: [{ kind: "collisionEmitEffect", intensity: -0.1 }] },
    },
  }), /greater than or equal to 0/);

  expectMessage(() => resolveBehaviorRecipeDocument({
    entities: {
      enemy: { recipes: [{ kind: "collisionEmitEffect", radius: Number.POSITIVE_INFINITY }] },
    },
  }), /finite number/);

  expectMessage(() => resolveBehaviorRecipeDocument({
    entities: {
      enemy: { recipes: [{ kind: "seekTarget", target: "nearestLayer:terrain" }] },
    },
  }), /nearestLayer target must be one of/);

  expectMessage(() => resolveBehaviorRecipeDocument({
    entities: {
      enemy: { recipes: [{ kind: "seekTarget", target: "nearestFaction:32" }] },
    },
  }), /nearestFaction target must be/);

  expectMessage(() => resolveBehaviorRecipeDocument({
    entities: {
      enemy: { recipes: [{ kind: "seekTarget", target: "nearestTag:32" }] },
    },
  }), /nearestTag target must be/);

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

  expectMessage(() => resolveBehaviorRecipeDocument({
    entities: {
      enemy: {
        recipes: [{
          kind: "seekTarget",
          target: "player",
          speed: 0,
        }],
      },
    },
  }), /speed/);

  expectMessage(() => resolveBehaviorRecipeDocument({
    entities: {
      enemy: {
        recipes: [{
          kind: "seekTarget",
          target: "player",
          turnRate: -0.25,
        }],
      },
    },
  }), /turnRate/);

  expectMessage(() => resolveBehaviorRecipeDocument({
    entities: {
      enemy: {
        recipes: [{
          kind: "accelerate",
          accelerationX: 0,
          accelerationY: 0,
          maxSpeed: 4,
        }],
      },
    },
  }), /accelerationX/);

  expectMessage(() => resolveBehaviorRecipeDocument({
    entities: {
      enemy: {
        recipes: [{
          kind: "accelerate",
          accelerationX: 2,
          accelerationY: -1,
          maxSpeed: 0,
        }],
      },
    },
  }), /maxSpeed/);
});

test("collisionEmitEffect recipes can reference named presentation effects", () => {
  const document = resolveBehaviorRecipeDocument({
    entities: {
      projectile: {
        recipes: [{
          kind: "collisionEmitEffect",
          effect: "impactSpark",
          effectKind: "custom",
          target: "self",
          intensity: 0.75,
          radius: 16,
          trigger: "enter",
        }],
      },
    },
  });
  const command = behaviorRecipeCommandsForEntity(document, "projectile")[0];

  deepEqual(command, {
    entity: "projectile",
    recipe: "projectile.0",
    tags: [],
    type: "configureCollisionEmitEffect",
    effect: "impactSpark",
    effectKind: "custom",
    effectType: 4,
    target: "self",
    intensity: 0.75,
    radius: 16,
    cooldownSeconds: 0,
    trigger: "enter",
  });
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
