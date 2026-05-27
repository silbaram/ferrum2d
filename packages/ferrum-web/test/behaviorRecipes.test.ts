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
    },
    entities: {
      enemy: {
        tags: ["hostile"],
        recipes: [
          "living",
          { use: "contactDamage", id: "enemyDamage", overrides: { amount: 3 } },
          { kind: "chase", target: "player", speed: 96, stopDistance: 18 },
        ],
      },
      coin: {
        recipes: [
          { kind: "pickup", item: "coin", count: 2 },
          { kind: "interaction", action: "inspect", prompt: "Inspect", radius: 20 },
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
});

test("applyBehaviorRecipes forwards commands to a target adapter", () => {
  const applied: string[] = [];
  const result = applyBehaviorRecipes({
    applyBehaviorRecipeCommand: (command) => {
      applied.push(`${command.entity}:${command.type}`);
      return command.recipe;
    },
  }, resolveBehaviorRecipeDocument(sampleRecipes()), { entity: "coin" });

  deepEqual(applied, ["coin:configurePickup", "coin:configureInteraction"]);
  deepEqual(result.results, ["coin.0", "coin.1"]);
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
