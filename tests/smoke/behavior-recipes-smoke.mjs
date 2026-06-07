#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  applyBehaviorRecipes,
  behaviorRecipeCommandsForEntity,
  resolveBehaviorRecipeDocument,
} from "../../packages/ferrum-web/dist/index.js";

const document = resolveBehaviorRecipeDocument({
  recipes: {
    living: { kind: "health", max: 5, start: 4, onZero: "event", event: "enemy.defeated" },
    contactDamage: { kind: "damage", amount: 1 },
  },
  entities: {
    enemy: {
      recipes: [
        "living",
        { use: "contactDamage", id: "eliteDamage", overrides: { amount: 3 } },
        { kind: "chase", target: "player", speed: 92 },
      ],
    },
    coin: {
      recipes: [{ kind: "pickup", item: "coin", count: 2 }],
    },
  },
});

const enemyCommands = behaviorRecipeCommandsForEntity(document, "enemy");
assert.deepEqual(enemyCommands.map((command) => command.type), [
  "configureHealth",
  "configureDamage",
  "configureChase",
]);
assert.equal(enemyCommands[1].type, "configureDamage");
assert.equal(enemyCommands[1].amount, 3);

const applied = [];
const result = applyBehaviorRecipes({
  applyBehaviorRecipeCommand: (command) => {
    applied.push(`${command.entity}:${command.type}`);
    return command.recipe;
  },
}, document, { entity: "coin" });
assert.deepEqual(applied, ["coin:configurePickup"]);
assert.deepEqual(result.results, ["coin.0"]);

console.log(JSON.stringify({
  behaviorRecipesSmoke: {
    enemyCommandCount: enemyCommands.length,
    damageAmount: enemyCommands[1].amount,
    coinResult: result.results[0],
  },
}, null, 2));
