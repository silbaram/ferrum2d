#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  applySceneCompositionFragment,
  instantiateSceneFragment,
  resolveSceneCompositionSpec,
} from "../packages/ferrum-web/dist/index.js";

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

console.log(JSON.stringify({
  sceneCompositionSmoke: {
    fragment: applied.fragment,
    instanceCount: instances.length,
    firstInstance: instances[0].id,
  },
}, null, 2));
