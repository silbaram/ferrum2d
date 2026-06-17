import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";

import {
  SCENE_AUTHORING_DOCUMENT_FORMAT,
  SCENE_AUTHORING_DOCUMENT_VERSION,
  SCENE_PLACEMENT_PATCH_FORMAT,
  SCENE_PLACEMENT_PATCH_VERSION,
  mergeScenePlacementPatch,
  previewScenePlacementBindingMigration,
  saveScenePlacementPatch,
} from "../src/authoring.js";
import type {
  SceneAuthoringDocumentSpec,
  ScenePlacementPatch,
  ScenePlacementTransform,
  ScenePlacementSaveAdapter,
} from "../src/authoring.js";

test("mergeScenePlacementPatch updates transform keys without mutating source document", () => {
  const document = scenePlacementDocument();
  const patch = scenePlacementTransformPatch("crate_a", { x: 64, y: 72, scale: 2 });

  const result = mergeScenePlacementPatch(document, patch, {
    allowedFragments: ["main"],
  });
  const instance = result.document.sceneComposition.fragments?.main?.instances?.[0];

  equal(result.operationCount, 1);
  deepEqual(result.changedInstanceIds, ["crate_a"]);
  equal(instance?.x, 64);
  equal(instance?.y, 72);
  equal(instance?.scale, 2);
  equal(instance?.prefab, "crate");
  deepEqual(result.document.behaviorRecipes, document.behaviorRecipes);
  equal(document.sceneComposition.fragments?.main?.instances?.[0]?.x, 10);
});

test("mergeScenePlacementPatch applies rename, add, and remove operations in patch order", () => {
  const document = scenePlacementDocument();
  const result = mergeScenePlacementPatch(document, {
    format: SCENE_PLACEMENT_PATCH_FORMAT,
    version: SCENE_PLACEMENT_PATCH_VERSION,
    operations: [
      {
        kind: "renameInstance",
        instanceId: "crate_a",
        nextInstanceId: "crate_b",
      },
      {
        kind: "updateTransform",
        instanceId: "crate_b",
        transform: { x: 24, y: 28 },
      },
      {
        kind: "addInstance",
        fragment: "main",
        instance: { id: "crate_c", prefab: "crate", x: 40, y: 48 },
      },
      {
        kind: "removeInstance",
        instanceId: "crate_b",
      },
    ],
  });

  deepEqual(result.changedInstanceIds, ["crate_a", "crate_b", "crate_c"]);
  deepEqual(result.document.sceneComposition.fragments?.main?.instances, [
    { id: "crate_c", prefab: "crate", x: 40, y: 48 },
  ]);
  deepEqual(result.document.behaviorRecipes, document.behaviorRecipes);
  equal(document.sceneComposition.fragments?.main?.instances?.[0]?.id, "crate_a");
});

test("previewScenePlacementBindingMigration reports agent-owned references for rename and remove", () => {
  const document = scenePlacementDocumentWithAgentTargets();
  const preview = previewScenePlacementBindingMigration(document, {
    format: SCENE_PLACEMENT_PATCH_FORMAT,
    version: SCENE_PLACEMENT_PATCH_VERSION,
    operations: [
      {
        kind: "renameInstance",
        instanceId: "crate_a",
        nextInstanceId: "crate_b",
      },
      {
        kind: "removeInstance",
        instanceId: "turret_left",
      },
    ],
  });

  deepEqual(preview.renamedInstanceIds, [{
    operationIndex: 0,
    instanceId: "crate_a",
    nextInstanceId: "crate_b",
  }]);
  deepEqual(preview.removedInstanceIds, ["turret_left"]);
  deepEqual(preview.references.map((reference) => ({
    operationIndex: reference.operationIndex,
    operationKind: reference.operationKind,
    path: reference.path,
    value: reference.value,
    suggestedValue: reference.suggestedValue,
  })), [
    {
      operationIndex: 0,
      operationKind: "renameInstance",
      path: "scenePlacementBindingMigration.document.behaviorRecipes.entities.crate_a",
      value: "crate_a",
      suggestedValue: "crate_b",
    },
    {
      operationIndex: 0,
      operationKind: "renameInstance",
      path: "scenePlacementBindingMigration.document.behaviorRecipes.entities.sentry.recipes.0.target",
      value: "crate_a",
      suggestedValue: "crate_b",
    },
    {
      operationIndex: 1,
      operationKind: "removeInstance",
      path: "scenePlacementBindingMigration.document.behaviorRecipes.entities.guard.recipes.0.target",
      value: "turret_left",
      suggestedValue: undefined,
    },
  ]);
});

test("mergeScenePlacementPatch rejects unsafe targets", () => {
  expectThrows(
    () => mergeScenePlacementPatch(scenePlacementDocument(), scenePlacementTransformPatch("crate_a", { x: 1 }), {
      allowedFragments: ["other"],
    }),
    /fragment.*main.*not allowed/u,
  );
  expectThrows(
    () => mergeScenePlacementPatch(duplicateInstanceDocument(), scenePlacementTransformPatch("crate_a", { x: 1 })),
    /ambiguous scene instance.*crate_a/u,
  );
  expectThrows(
    () => mergeScenePlacementPatch(scenePlacementDocument(), {
      format: SCENE_PLACEMENT_PATCH_FORMAT,
      version: SCENE_PLACEMENT_PATCH_VERSION,
      operations: [{
        kind: "addInstance",
        fragment: "main",
        instance: { id: "crate_a", prefab: "crate" },
      }],
    }),
    /already exists/u,
  );
});

test("saveScenePlacementPatch requires explicit opt-in and adapter allowlist", async () => {
  const document = scenePlacementDocument();
  const patch = scenePlacementTransformPatch("crate_a", { x: 80 });
  const adapter: ScenePlacementSaveAdapter = {
    id: "memory",
    saveScenePlacementPatch(request) {
      equal(request.operationCount, 1);
      equal(request.changedInstanceIds[0], "crate_a");
      equal(request.mergedDocument.sceneComposition.fragments?.main?.instances?.[0]?.x, 80);
      return {
        saved: true,
        document: request.mergedDocument,
      };
    },
  };

  await expectRejects(
    saveScenePlacementPatch(document, patch, { adapter }),
    /allowSave.*must be true/u,
  );
  await expectRejects(
    saveScenePlacementPatch(document, patch, {
      allowSave: true,
      adapter,
      allowedAdapterIds: ["other"],
    }),
    /adapter.*memory.*not allowed/u,
  );

  const result = await saveScenePlacementPatch(document, patch, {
    allowSave: true,
    adapter,
    allowedAdapterIds: ["memory"],
  });

  equal(result.saved, true);
  equal(result.adapterId, "memory");
  equal(result.document.sceneComposition.fragments?.main?.instances?.[0]?.x, 80);
  equal(document.sceneComposition.fragments?.main?.instances?.[0]?.x, 10);
});

function scenePlacementDocument(): SceneAuthoringDocumentSpec {
  return {
    format: SCENE_AUTHORING_DOCUMENT_FORMAT,
    version: SCENE_AUTHORING_DOCUMENT_VERSION,
    sceneComposition: {
      initialFragment: "main",
      prefabs: {
        crate: {
          props: {
            components: {
              sprite: { texture: "crate", width: 16, height: 16 },
              collider: { type: "aabb", halfWidth: 8, halfHeight: 8 },
              layer: "wall",
            },
          },
        },
      },
      fragments: {
        main: {
          instances: [
            { id: "crate_a", prefab: "crate", x: 10, y: 20 },
          ],
        },
      },
    },
    behaviorRecipes: {
      entities: {
        crateBehavior: {
          recipes: [{ kind: "health", max: 3 }],
        },
      },
    },
  };
}

function duplicateInstanceDocument(): SceneAuthoringDocumentSpec {
  const document = scenePlacementDocument();
  return {
    ...document,
    sceneComposition: {
      ...document.sceneComposition,
      fragments: {
        main: {
          instances: [{ id: "crate_a", prefab: "crate", x: 10, y: 20 }],
        },
        side: {
          instances: [{ id: "crate_a", prefab: "crate", x: 30, y: 40 }],
        },
      },
    },
  };
}

function scenePlacementDocumentWithAgentTargets(): SceneAuthoringDocumentSpec {
  const document = scenePlacementDocument();
  return {
    ...document,
    sceneComposition: {
      ...document.sceneComposition,
      prefabs: {
        ...document.sceneComposition.prefabs,
        turret: {
          props: {
            components: {
              sprite: { texture: "turret", width: 16, height: 16 },
              collider: "none",
              layer: "enemy",
            },
          },
        },
      },
      fragments: {
        main: {
          instances: [
            { id: "crate_a", prefab: "crate", x: 10, y: 20 },
            { id: "turret_left", prefab: "turret", x: 30, y: 40 },
          ],
        },
      },
    },
    behaviorRecipes: {
      entities: {
        crate_a: {
          recipes: [{ kind: "health", max: 1 }],
        },
        sentry: {
          recipes: [{ kind: "chase", target: "crate_a", speed: 2 }],
        },
        guard: {
          recipes: [{ kind: "seekTarget", target: "turret_left", speed: 3, turnRate: 4 }],
        },
      },
    },
  };
}

function scenePlacementTransformPatch(
  instanceId: string,
  transform: Partial<ScenePlacementTransform>,
): ScenePlacementPatch {
  return {
    format: SCENE_PLACEMENT_PATCH_FORMAT,
    version: SCENE_PLACEMENT_PATCH_VERSION,
    operations: [{
      kind: "updateTransform",
      instanceId,
      transform,
    }],
  };
}

function expectThrows(fn: () => unknown, pattern: RegExp): void {
  try {
    fn();
  } catch (error) {
    ok(pattern.test(errorMessage(error)), errorMessage(error));
    return;
  }
  ok(false, "expected function to throw");
}

async function expectRejects(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await promise;
  } catch (error) {
    ok(pattern.test(errorMessage(error)), errorMessage(error));
    return;
  }
  ok(false, "expected promise to reject");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
