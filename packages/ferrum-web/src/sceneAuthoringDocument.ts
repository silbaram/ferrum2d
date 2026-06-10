import { resolveBehaviorRecipeDocument } from "./behaviorRecipes.js";
import { gameplayAuthoringDiagnosticError } from "./diagnostics.js";
import {
  bindSceneBehaviorRecipes,
  resolveGameplayBehaviorRuntimeIds,
  type GameplayBehaviorRuntimeIds,
  type SceneBehaviorBindingOptions,
  type SceneBehaviorBindingPlan,
} from "./gameplayAuthoring.js";
import { resolveSceneCompositionSpec } from "./sceneComposition.js";
import type {
  BehaviorRecipeDocumentSpec,
  ResolvedBehaviorRecipeDocument,
} from "./behaviorRecipes.js";
import type {
  ResolvedSceneCompositionSpec,
  SceneCompositionSpec,
} from "./sceneComposition.js";

export const SCENE_AUTHORING_DOCUMENT_FORMAT = "ferrum2d.consumer.scene-authoring" as const;
export const SCENE_AUTHORING_DOCUMENT_VERSION = 1 as const;

export interface SceneAuthoringDocumentSpec {
  format: typeof SCENE_AUTHORING_DOCUMENT_FORMAT;
  version: typeof SCENE_AUTHORING_DOCUMENT_VERSION;
  sceneComposition: SceneCompositionSpec;
  behaviorRecipes: BehaviorRecipeDocumentSpec;
  ids?: GameplayBehaviorRuntimeIds;
}

export interface ResolvedSceneAuthoringDocument {
  format: typeof SCENE_AUTHORING_DOCUMENT_FORMAT;
  version: typeof SCENE_AUTHORING_DOCUMENT_VERSION;
  sceneComposition: ResolvedSceneCompositionSpec;
  behaviorRecipes: ResolvedBehaviorRecipeDocument;
  ids?: GameplayBehaviorRuntimeIds;
  bindingPlan?: SceneBehaviorBindingPlan;
}

export interface ResolveSceneAuthoringDocumentOptions extends SceneBehaviorBindingOptions {
  validateBindings?: boolean;
}

export function resolveSceneAuthoringDocument(
  document: unknown,
  options: ResolveSceneAuthoringDocumentOptions = {},
): ResolvedSceneAuthoringDocument {
  const { validateBindings = false, path = "sceneAuthoring", ...bindingOptions } = options;
  if (!isRecord(document)) {
    throw gameplayAuthoringDiagnosticError(path, "must be an object");
  }
  if (document.format !== SCENE_AUTHORING_DOCUMENT_FORMAT) {
    throw gameplayAuthoringDiagnosticError(
      `${path}.format`,
      `must be ${SCENE_AUTHORING_DOCUMENT_FORMAT}`,
    );
  }
  if (document.version !== SCENE_AUTHORING_DOCUMENT_VERSION) {
    throw gameplayAuthoringDiagnosticError(
      `${path}.version`,
      `must be ${SCENE_AUTHORING_DOCUMENT_VERSION}`,
    );
  }

  const sceneComposition = resolveSceneCompositionSpec(
    document.sceneComposition as SceneCompositionSpec,
    { path: `${path}.sceneComposition` },
  );
  const behaviorRecipes = resolveBehaviorRecipeDocument(
    document.behaviorRecipes as BehaviorRecipeDocumentSpec,
    { path: `${path}.behaviorRecipes` },
  );
  const ids = document.ids === undefined
    ? undefined
    : resolveGameplayBehaviorRuntimeIds(document.ids, { path: `${path}.ids` });
  const bindingPlan = validateBindings
    ? bindSceneBehaviorRecipes(sceneComposition, behaviorRecipes, {
        ...bindingOptions,
        path,
      })
    : undefined;

  return {
    format: SCENE_AUTHORING_DOCUMENT_FORMAT,
    version: SCENE_AUTHORING_DOCUMENT_VERSION,
    sceneComposition,
    behaviorRecipes,
    ...(ids === undefined ? {} : { ids }),
    ...(bindingPlan === undefined ? {} : { bindingPlan }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
