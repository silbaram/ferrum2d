import {
  previewScenePlacementBindingMigration,
  type ScenePlacementBindingMigrationPreview,
} from "./scenePlacementPatch.js";
import type { ScenePlacementAssetDiagnostic } from "./scenePlacementAssets.js";
import type { SceneAuthoringDocumentSpec } from "./sceneAuthoringDocument.js";
import type {
  ScenePlacementPatch,
  ScenePlacementViewerState,
} from "./scenePlacementViewer.js";
import { mergeScenePlacementPatch } from "./scenePlacementPatch.js";
import {
  resolveSceneSpriteNormalBindingEvidence,
  type SceneSpriteNormalBindingEvidence,
  type SpriteNormalBindingDiagnostic,
} from "./spriteNormalBinding.js";

export const SCENE_PLACEMENT_AGENT_HANDOFF_FORMAT =
  "ferrum2d.placement-viewer.agent-handoff" as const;
export const SCENE_PLACEMENT_AGENT_HANDOFF_VERSION = 1 as const;

export interface CreateScenePlacementAgentHandoffOptions {
  readonly document: SceneAuthoringDocumentSpec;
  readonly state: ScenePlacementViewerState;
  readonly patch?: ScenePlacementPatch;
  readonly sourceDocument?: string;
  readonly assetFolder?: ScenePlacementAgentHandoffAssetFolder;
  readonly assetDiagnostics?: readonly ScenePlacementAssetDiagnostic[];
  readonly path?: string;
  readonly authoringEvidence?: ScenePlacementAgentHandoff["authoringEvidence"];
  readonly normalBindings?: readonly SceneSpriteNormalBindingEvidence[];
  readonly normalAssetDiagnostics?: readonly SpriteNormalBindingDiagnostic[];
}

export interface ScenePlacementAgentHandoffAssetFolder {
  readonly path: string;
  readonly status: "ready" | "missing" | "error";
  readonly imageCount: number;
  readonly textureAtlasInputPath?: string;
  readonly images?: readonly ScenePlacementAgentHandoffAssetFile[];
  readonly diagnostics: readonly ScenePlacementAgentHandoffAssetFolderDiagnostic[];
}

export interface ScenePlacementAgentHandoffAssetFile {
  readonly id: string;
  readonly fileName: string;
  readonly path: string;
  readonly runtimeUrl?: string;
  /** Host session cache fingerprint, not a security digest or model contentId. */
  readonly contentRevision?: string;
  readonly width?: number;
  readonly height?: number;
}

export interface ScenePlacementAgentHandoffAssetFolderDiagnostic {
  readonly severity: "error";
  readonly code:
    | "missingAssetFolder"
    | "notDirectoryAssetFolder"
    | "runtimeTextureLoadFailed";
  readonly path: string;
  readonly message: string;
}

export interface ScenePlacementAgentHandoff {
  readonly format: typeof SCENE_PLACEMENT_AGENT_HANDOFF_FORMAT;
  readonly version: typeof SCENE_PLACEMENT_AGENT_HANDOFF_VERSION;
  readonly workflow: "human-placement-agent-behavior";
  readonly placementOwner: "sceneComposition.fragments[].instances[]";
  readonly behaviorOwner: "sceneComposition.prefabs[].props.behaviorRecipes + behaviorRecipes.entities";
  readonly sourceDocument?: string;
  readonly selectedInstanceId?: string;
  readonly hoveredInstanceId?: string;
  readonly selected?: ScenePlacementViewerState["selected"];
  readonly pointerWorld?: ScenePlacementViewerState["pointerWorld"];
  readonly draftPatch?: ScenePlacementPatch;
  readonly migrationPreview?: ScenePlacementBindingMigrationPreview;
  readonly assetFolder?: ScenePlacementAgentHandoffAssetFolder;
  readonly assetDiagnostics: readonly ScenePlacementAssetDiagnostic[];
  readonly normalBindings?: readonly SceneSpriteNormalBindingEvidence[];
  readonly normalAssetDiagnostics?: readonly SpriteNormalBindingDiagnostic[];
  readonly authoringEvidence?: {
    readonly selectedSourcePaths: readonly string[];
    readonly changes: readonly {
      readonly path: string;
      readonly before?: unknown;
      readonly after?: unknown;
    }[];
    readonly changeCount: number;
    readonly truncated: boolean;
  };
}

export function createScenePlacementAgentHandoff(
  options: CreateScenePlacementAgentHandoffOptions,
): ScenePlacementAgentHandoff {
  const patch = options.patch ?? options.state.draftPatch;
  const migrationPreview =
    patch === undefined
      ? undefined
      : previewScenePlacementBindingMigration(options.document, patch, {
          path: options.path ?? "scenePlacementAgentHandoff.bindingMigration",
        });
  const normalDocument =
    options.normalBindings?.length && patch
      ? mergeScenePlacementPatch(options.document, patch).document
      : options.document;
  const normalBindings = options.normalBindings?.map((binding) =>
    resolveSceneSpriteNormalBindingEvidence(normalDocument, binding),
  );
  return {
    format: SCENE_PLACEMENT_AGENT_HANDOFF_FORMAT,
    version: SCENE_PLACEMENT_AGENT_HANDOFF_VERSION,
    workflow: "human-placement-agent-behavior",
    placementOwner: "sceneComposition.fragments[].instances[]",
    behaviorOwner:
      "sceneComposition.prefabs[].props.behaviorRecipes + behaviorRecipes.entities",
    ...(normalBindings === undefined ? {} : { normalBindings }),
    ...(options.normalAssetDiagnostics === undefined
      ? {}
      : {
          normalAssetDiagnostics: structuredClone(
            options.normalAssetDiagnostics,
          ),
        }),
    ...(options.authoringEvidence
      ? { authoringEvidence: structuredClone(options.authoringEvidence) }
      : {}),
    ...(options.sourceDocument === undefined
      ? {}
      : { sourceDocument: options.sourceDocument }),
    ...(options.state.selectedInstanceId === undefined
      ? {}
      : { selectedInstanceId: options.state.selectedInstanceId }),
    ...(options.state.hoveredInstanceId === undefined
      ? {}
      : { hoveredInstanceId: options.state.hoveredInstanceId }),
    ...(options.state.selected === undefined
      ? {}
      : { selected: options.state.selected }),
    ...(options.state.pointerWorld === undefined
      ? {}
      : { pointerWorld: options.state.pointerWorld }),
    ...(patch === undefined ? {} : { draftPatch: patch }),
    ...(migrationPreview === undefined ? {} : { migrationPreview }),
    ...(options.assetFolder === undefined
      ? {}
      : { assetFolder: options.assetFolder }),
    assetDiagnostics: [...(options.assetDiagnostics ?? [])],
  };
}
