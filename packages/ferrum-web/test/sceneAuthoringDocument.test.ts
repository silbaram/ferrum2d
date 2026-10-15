import { equal } from "node:assert/strict";
import { test } from "node:test";

import {
  SCENE_AUTHORING_DOCUMENT_FORMAT,
  SCENE_AUTHORING_DOCUMENT_VERSION,
  resolveSceneAuthoringDocument,
} from "../src/sceneAuthoringDocument.js";
import type { SceneAuthoringDocumentSpec } from "../src/sceneAuthoringDocument.js";

function sampleDocument(): SceneAuthoringDocumentSpec {
  return {
    format: SCENE_AUTHORING_DOCUMENT_FORMAT,
    version: SCENE_AUTHORING_DOCUMENT_VERSION,
    ids: {
      actions: {
        shoot: 1,
      },
    },
    sceneComposition: {
      initialFragment: "main",
      prefabs: {
        player: {
          props: {
            behaviorRecipes: "player.weapon",
            components: {
              sprite: { texture: "player", width: 24, height: 24 },
              collider: { type: "aabb", halfWidth: 12, halfHeight: 12 },
              layer: "player",
            },
          },
        },
      },
      fragments: {
        main: {
          instances: [{
            id: "player",
            prefab: "player",
          }],
        },
      },
    },
    behaviorRecipes: {
      entities: {
        "player.weapon": {
          recipes: [{
            kind: "projectileAction",
            action: "shoot",
            actionId: 1,
          }],
        },
      },
    },
  };
}

test("resolveSceneAuthoringDocument validates the envelope and optional binding plan", () => {
  const resolved = resolveSceneAuthoringDocument(sampleDocument(), {
    validateBindings: true,
    validateComponents: true,
    missingBehavior: "error",
  });

  equal(resolved.format, SCENE_AUTHORING_DOCUMENT_FORMAT);
  equal(resolved.version, SCENE_AUTHORING_DOCUMENT_VERSION);
  equal(resolved.sceneComposition.initialFragment, "main");
  equal(resolved.behaviorRecipes.entities["player.weapon"].recipes.length, 1);
  equal(resolved.ids?.actions?.shoot, 1);
  equal(resolved.bindingPlan?.instances[0]?.id, "player");
  equal(resolved.bindingPlan?.commands.length, 1);
  equal(resolved.variables, undefined);
});

test("resolveSceneAuthoringDocument validates optional variable declarations", () => {
  const resolved = resolveSceneAuthoringDocument({
    ...sampleDocument(),
    variables: [
      { name: "campaign.coins", scope: "global", type: "integer", default: 0 },
      { name: "wave.complete", scope: "scene", type: "bool", default: false },
    ],
  });

  equal(resolved.variables?.[0]?.name, "campaign.coins");
  equal(resolved.variables?.[0]?.scope, "global");
  equal(resolved.variables?.[1]?.default, false);
  equal(resolved.ids?.variables?.["campaign.coins"], 1);
  equal(resolved.ids?.variables?.["wave.complete"], 2);

  expectMessage(() => resolveSceneAuthoringDocument({
    ...sampleDocument(),
    variables: [
      { name: "campaign.coins", scope: "global", type: "integer", default: 0 },
      { name: "campaign.coins", scope: "scene", type: "integer", default: 0 },
    ],
  }), /variables\.1\.name.*duplicates variable/);
});

test("resolveSceneAuthoringDocument validates recipe variable types and references at load", () => {
  const base = sampleDocument();
  const resolved = resolveSceneAuthoringDocument({
    ...base,
    variables: [
      { name: "boss.hits", scope: "scene", type: "integer", default: 0 },
      { name: "door.open", scope: "scene", type: "bool", default: false },
    ],
    behaviorRecipes: {
      entities: {
        boss: {
          recipes: [{
            kind: "incrementVariable",
            variable: "boss.hits",
            when: { type: "gameplayEvent", event: "collisionDamage" },
          }],
        },
      },
    },
  });
  equal(resolved.ids?.variables?.["boss.hits"], 1);

  expectMessage(() => resolveSceneAuthoringDocument({
    ...base,
    variables: [{ name: "door.open", scope: "scene", type: "bool", default: false }],
    behaviorRecipes: {
      entities: {
        door: {
          recipes: [{
            kind: "incrementVariable",
            variable: "door.open",
            when: { type: "gameplayEvent", event: "interaction", actionId: 1 },
          }],
        },
      },
    },
  }), /cannot target a bool variable/);

  expectMessage(() => resolveSceneAuthoringDocument({
    ...base,
    variables: [{ name: "boss.hits", scope: "scene", type: "integer", default: 0 }],
    behaviorRecipes: {
      entities: {
        boss: {
          recipes: [{
            kind: "damage",
            guard: { variable: "boss.missing", op: ">=", value: 3 },
          }],
        },
      },
    },
  }), /undeclared variable/);
});

test("resolveSceneAuthoringDocument keeps component validation opt-in", () => {
  const document: SceneAuthoringDocumentSpec = {
    ...sampleDocument(),
    sceneComposition: {
      ...sampleDocument().sceneComposition,
      prefabs: {
        player: {
          props: {
            behaviorRecipes: "player.weapon",
            components: {
              sprite: { texture: "player", width: 24, height: 24 },
              collider: { type: "circle" },
              layer: "player",
            },
          },
        },
      },
    },
  };

  const resolved = resolveSceneAuthoringDocument(document);
  equal(resolved.bindingPlan, undefined);

  expectMessage(() =>
    resolveSceneAuthoringDocument(document, {
      validateComponents: true,
    }), /props\.components\.collider\.radius/,
  );
});

test("resolveSceneAuthoringDocument rejects component templates by default during component validation", () => {
  const document: SceneAuthoringDocumentSpec = {
    ...sampleDocument(),
    sceneComposition: {
      ...sampleDocument().sceneComposition,
      prefabs: {
        player: {
          props: {
            behaviorRecipes: "player.weapon",
            components: {
              template: "player.base",
            },
          },
        },
      },
    },
  };

  expectMessage(() =>
    resolveSceneAuthoringDocument(document, {
      validateComponents: true,
    }), /props\.components\.template/,
  );

  const resolved = resolveSceneAuthoringDocument(document, {
    allowComponentTemplates: true,
    validateComponents: true,
  });
  equal(resolved.format, SCENE_AUTHORING_DOCUMENT_FORMAT);
});

test("resolveSceneAuthoringDocument keeps binding validation opt-in", () => {
  const document: SceneAuthoringDocumentSpec = {
    ...sampleDocument(),
    sceneComposition: {
      ...sampleDocument().sceneComposition,
      prefabs: {
        player: {},
      },
    },
  };

  const resolved = resolveSceneAuthoringDocument(document);
  equal(resolved.bindingPlan, undefined);

  expectMessage(() =>
    resolveSceneAuthoringDocument(document, {
      validateBindings: true,
      missingBehavior: "error",
    }), /props\.behaviorRecipes/,
  );
});

test("resolveSceneAuthoringDocument rejects invalid format and version", () => {
  expectMessage(() =>
    resolveSceneAuthoringDocument({
      ...sampleDocument(),
      format: "ferrum2d.shooter.game-spec",
    }), /sceneAuthoring\.format/,
  );

  expectMessage(() =>
    resolveSceneAuthoringDocument({
      ...sampleDocument(),
      version: 2,
    }), /sceneAuthoring\.version/,
  );
});

function expectMessage(fn: () => void, pattern: RegExp): void {
  try {
    fn();
  } catch (error) {
    equal(error instanceof Error, true);
    equal(pattern.test(error instanceof Error ? error.message : String(error)), true);
    return;
  }
  throw new Error("Expected function to throw");
}

test("navigation obstacles reference applied inline collider instances", () => {
  const navigation = { columns: 1, rows: 1, cellWidth: 20, cellHeight: 20, costs: [1], obstacles: [{ instanceId: "player", cells: [{ column: 0, row: 0 }] }] };
  equal(resolveSceneAuthoringDocument({ ...sampleDocument(), navigation }).navigation?.obstacles?.[0]?.instanceId, "player");
  expectMessage(() => resolveSceneAuthoringDocument({ ...sampleDocument(), navigation: { ...navigation, obstacles: [{ ...navigation.obstacles[0], instanceId: "missing" }] } }), /applied fragment/);
});

test("navigation obstacle validation uses the selected fragment with or without a binding plan", () => {
  const base = sampleDocument();
  const document = {
    ...base,
    sceneComposition: {
      ...base.sceneComposition,
      initialFragment: "empty",
      fragments: { ...base.sceneComposition.fragments, empty: { instances: [] } },
    },
    navigation: { columns: 1, rows: 1, cellWidth: 20, cellHeight: 20, costs: [1], obstacles: [{ instanceId: "player", cells: [{ column: 0, row: 0 }] }] },
  };
  for (const validateBindings of [false, true]) {
    equal(resolveSceneAuthoringDocument(document, { fragment: "main", validateBindings, validateComponents: true }).navigation?.obstacles?.[0]?.instanceId, "player");
    expectMessage(() => resolveSceneAuthoringDocument(document, { validateBindings }), /applied fragment/);
  }
  equal(resolveSceneAuthoringDocument({ ...document, navigation: { ...document.navigation, obstacles: [{ ...document.navigation.obstacles[0], instanceId: "room/player" }] } }, {
    fragment: "main", idPrefix: "room/", validateBindings: true,
  }).bindingPlan?.instances[0]?.id, "room/player");
});

test("navigation checks collider overrides in the selected fragment and root props", () => {
  const base = sampleDocument();
  const visualOnly = { sprite: { texture: "player", width: 24, height: 24 }, collider: { type: "none" }, layer: "player" };
  const document = {
    ...base,
    sceneComposition: {
      ...base.sceneComposition,
      fragments: { ...base.sceneComposition.fragments, visual: { instances: [{ id: "player", prefab: "player", props: { components: visualOnly } }] } },
    },
    navigation: { columns: 1, rows: 1, cellWidth: 20, cellHeight: 20, costs: [1], obstacles: [{ instanceId: "player", cells: [{ column: 0, row: 0 }] }] },
  };
  for (const validateBindings of [false, true]) {
    equal(resolveSceneAuthoringDocument(document, { validateBindings }).navigation?.obstacles?.length, 1);
    expectMessage(() => resolveSceneAuthoringDocument(document, { fragment: "visual", validateBindings }), /requires an inline collider/);
    expectMessage(() => resolveSceneAuthoringDocument(document, { props: { components: visualOnly }, validateBindings }), /requires an inline collider/);
  }
});
