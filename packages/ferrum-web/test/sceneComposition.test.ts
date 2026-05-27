import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  applySceneCompositionFragment,
  instantiateSceneFragment,
  resolveSceneCompositionSpec,
} from "../src/sceneComposition.js";
import type { SceneCompositionSpec } from "../src/sceneComposition.js";

function sampleComposition(): SceneCompositionSpec {
  return {
    initialFragment: "room",
    prefabs: {
      enemy: {
        props: {
          kind: "enemy",
          stats: { hp: 1, speed: 2 },
        },
        variants: {
          bruiser: {
            props: {
              stats: { hp: 3 },
              color: "red",
            },
          },
          elite: {
            extends: "bruiser",
            props: {
              stats: { shield: 2 },
              loot: "rare",
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
        include: [{
          fragment: "spawn",
          idPrefix: "a.",
          x: 10,
          y: 20,
          rotationRadians: Math.PI / 2,
          scale: 2,
          layer: 3,
          props: { room: "alpha" },
        }],
        instances: [{
          id: "crate",
          prefab: "pickup",
          x: 5,
          props: { contents: "coin" },
        }],
      },
      spawn: {
        instances: [{
          id: "enemy",
          prefab: "enemy",
          variant: "elite",
          x: 3,
          y: 1,
          props: {
            stats: { hp: 4 },
          },
        }],
      },
    },
  };
}

test("instantiateSceneFragment resolves variant props, include transforms, and unique ids", () => {
  const instances = instantiateSceneFragment(sampleComposition());
  equal(instances.length, 2);
  const enemy = instances[0];
  equal(enemy.id, "a.enemy");
  equal(enemy.prefab, "enemy");
  equal(enemy.variant, "elite");
  equal(Math.round(enemy.x), 8);
  equal(Math.round(enemy.y), 26);
  equal(enemy.scale, 2);
  equal(enemy.layer, 3);
  deepEqual(enemy.props, {
    kind: "enemy",
    stats: {
      hp: 4,
      speed: 2,
      shield: 2,
    },
    color: "red",
    loot: "rare",
    room: "alpha",
  });

  const crate = instances[1];
  equal(crate.id, "crate");
  deepEqual(crate.props, {
    kind: "pickup",
    contents: "coin",
  });
});

test("applySceneCompositionFragment calls a target adapter with resolved instances", () => {
  const spawned: string[] = [];
  const result = applySceneCompositionFragment({
    spawnSceneInstance: (instance) => {
      spawned.push(`${instance.id}:${instance.prefab}`);
      return instance.id;
    },
  }, resolveSceneCompositionSpec(sampleComposition()));

  deepEqual(spawned, ["a.enemy:enemy", "crate:pickup"]);
  deepEqual(result.spawnResults, ["a.enemy", "crate"]);
  equal(result.fragment, "room");
});

test("resolveSceneCompositionSpec rejects unknown prefab, variant, and fragment references", () => {
  expectMessage(() => resolveSceneCompositionSpec({
    prefabs: {},
    fragments: {
      main: { instances: [{ prefab: "missing" }] },
    },
  }), /unknown prefab/);

  expectMessage(() => resolveSceneCompositionSpec({
    prefabs: { enemy: {} },
    fragments: {
      main: { instances: [{ prefab: "enemy", variant: "missing" }] },
    },
  }), /unknown variant/);

  expectMessage(() => resolveSceneCompositionSpec({
    prefabs: {},
    fragments: {
      main: { include: [{ fragment: "missing" }] },
    },
  }), /unknown fragment/);
});

test("instantiateSceneFragment rejects variant cycles and duplicate resolved ids", () => {
  expectMessage(() => resolveSceneCompositionSpec({
    prefabs: {
      enemy: {
        variants: {
          a: { extends: "b" },
          b: { extends: "a" },
        },
      },
    },
    fragments: { main: {} },
  }), /must not contain cycles/);

  expectMessage(() => instantiateSceneFragment({
    prefabs: { pickup: {} },
    fragments: {
      main: {
        include: [
          { fragment: "set" },
          { fragment: "set" },
        ],
      },
      set: {
        instances: [{ id: "coin", prefab: "pickup" }],
      },
    },
  }), /resolved instance id must be unique/);
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
