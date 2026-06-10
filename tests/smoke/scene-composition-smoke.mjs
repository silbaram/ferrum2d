#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  applySceneBehaviorRecipes,
  applySceneCompositionFragment,
  instantiateSceneFragment,
  resolveSceneCompositionSpec,
} from "../../packages/ferrum-web/dist/index.js";

const composition = resolveSceneCompositionSpec({
  initialFragment: "room",
  prefabs: {
    enemy: {
      props: { kind: "enemy", stats: { hp: 1 } },
      variants: {
        elite: {
          props: { stats: { hp: 3 }, reward: 5 },
        },
      },
    },
  },
  fragments: {
    room: {
      include: [{ fragment: "spawn", idPrefix: "left.", x: 10, props: { room: "alpha" } }],
    },
    spawn: {
      instances: [{
        id: "enemy",
        prefab: "enemy",
        variant: "elite",
        x: 2,
        props: { stats: { shield: 1 } },
      }],
    },
  },
});

const instances = instantiateSceneFragment(composition);
assert.equal(instances.length, 1);
assert.equal(instances[0].id, "left.enemy");
assert.equal(instances[0].x, 12);
assert.deepEqual(instances[0].props, {
  kind: "enemy",
  stats: { hp: 3, shield: 1 },
  reward: 5,
  room: "alpha",
});

const spawned = [];
const applied = applySceneCompositionFragment({
  spawnSceneInstance: (instance) => {
    spawned.push(instance.id);
    return instance.prefab;
  },
}, composition);
assert.deepEqual(spawned, ["left.enemy"]);
assert.deepEqual(applied.spawnResults, ["enemy"]);

const calls = [];
const behaviorApplied = applySceneBehaviorRecipes({
  set_gameplay_health: (entityId, entityGeneration, current) => {
    calls.push(["set_gameplay_health", entityId, entityGeneration, current]);
    return true;
  },
}, {
  spawnSceneInstance: (instance) => {
    assert.equal(instance.id, "left.enemy");
    return { entityId: 7, entityGeneration: 1 };
  },
}, composition, {
  entities: {
    "enemy.basic": {
      recipes: [{ kind: "health", max: 3 }],
    },
  },
}, {
  kinds: ["health"],
  behaviorProp: "behaviorRecipes",
  props: { behaviorRecipes: "enemy.basic" },
});

assert.deepEqual(calls, [["set_gameplay_health", 7, 1, 3]]);
assert.equal(behaviorApplied.plan.commands.length, 1);
assert.equal(behaviorApplied.spawnResults[0].entityId, 7);

console.log(JSON.stringify({
  sceneCompositionSmoke: {
    fragment: applied.fragment,
    instanceCount: instances.length,
    firstInstance: instances[0].id,
    behaviorCommandCount: behaviorApplied.plan.commands.length,
  },
}, null, 2));
