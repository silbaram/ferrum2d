import { equal } from "node:assert/strict";
import { test } from "node:test";

import {
  SCENE_AUTHORING_DOCUMENT_FORMAT,
  SCENE_AUTHORING_DOCUMENT_VERSION,
  createScenePlacementAgentHandoff,
  createScenePlacementViewer,
} from "../src/authoring.js";
import type { SceneAuthoringDocumentSpec } from "../src/authoring.js";

test("createScenePlacementAgentHandoff exposes selected object, draft patch, migration, and asset diagnostics", () => {
  const document = scenePlacementDocument();
  const viewer = createScenePlacementViewer({
    document,
    viewport: { cssWidth: 320, cssHeight: 240 },
    selectedInstanceId: "crate_a",
  });
  const state = viewer.renameInstance("crate_a", "crate_renamed");
  const handoff = createScenePlacementAgentHandoff({
    document,
    state,
    sourceDocument: "scene-authoring.json",
    assetDiagnostics: [{
      severity: "error",
      code: "missingSpriteAsset",
      path: "scene.instances.crate_a.visual",
      assetId: "missing",
      message: "missing",
    }],
  });

  equal(handoff.format, "ferrum2d.placement-viewer.agent-handoff");
  equal(handoff.version, 1);
  equal(handoff.sourceDocument, "scene-authoring.json");
  equal(handoff.selectedInstanceId, "crate_renamed");
  equal(handoff.selected?.instanceId, "crate_renamed");
  equal(handoff.draftPatch?.operations[0]?.kind, "renameInstance");
  equal(handoff.migrationPreview?.references[0]?.suggestedValue, "crate_renamed");
  equal(handoff.assetDiagnostics[0]?.code, "missingSpriteAsset");
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
          instances: [{ id: "crate_a", prefab: "crate", x: 10, y: 20 }],
        },
      },
    },
    behaviorRecipes: {
      entities: {
        guard: {
          recipes: [{ kind: "chase", target: "crate_a", speed: 2 }],
        },
      },
    },
  };
}
