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
