import {
  previewScenePlacementBindingMigration,
  type ScenePlacementBindingMigrationPreview,
} from "./scenePlacementPatch.js";
import type { ScenePlacementAssetDiagnostic } from "./scenePlacementAssets.js";
import type { SceneAuthoringDocumentSpec } from "./sceneAuthoringDocument.js";
import type { ScenePlacementPatch, ScenePlacementViewerState } from "./scenePlacementViewer.js";

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
}

export interface ScenePlacementAgentHandoffAssetFolderDiagnostic {
  readonly severity: "error";
  readonly code: "missingAssetFolder" | "notDirectoryAssetFolder" | "runtimeTextureLoadFailed";
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
}

export function createScenePlacementAgentHandoff(
  options: CreateScenePlacementAgentHandoffOptions,
): ScenePlacementAgentHandoff {
  const patch = options.patch ?? options.state.draftPatch;
  const migrationPreview = patch === undefined
    ? undefined
    : previewScenePlacementBindingMigration(options.document, patch, {
      path: options.path ?? "scenePlacementAgentHandoff.bindingMigration",
    });
  return {
    format: SCENE_PLACEMENT_AGENT_HANDOFF_FORMAT,
    version: SCENE_PLACEMENT_AGENT_HANDOFF_VERSION,
    workflow: "human-placement-agent-behavior",
    placementOwner: "sceneComposition.fragments[].instances[]",
    behaviorOwner: "sceneComposition.prefabs[].props.behaviorRecipes + behaviorRecipes.entities",
    ...(options.sourceDocument === undefined ? {} : { sourceDocument: options.sourceDocument }),
    ...(options.state.selectedInstanceId === undefined ? {} : { selectedInstanceId: options.state.selectedInstanceId }),
    ...(options.state.hoveredInstanceId === undefined ? {} : { hoveredInstanceId: options.state.hoveredInstanceId }),
    ...(options.state.selected === undefined ? {} : { selected: options.state.selected }),
    ...(options.state.pointerWorld === undefined ? {} : { pointerWorld: options.state.pointerWorld }),
    ...(patch === undefined ? {} : { draftPatch: patch }),
    ...(migrationPreview === undefined ? {} : { migrationPreview }),
    ...(options.assetFolder === undefined ? {} : { assetFolder: options.assetFolder }),
    assetDiagnostics: [...(options.assetDiagnostics ?? [])],
  };
}
