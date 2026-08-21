import {
  resolveBehaviorRecipeDocument,
  type ResolvedBehaviorRecipe,
  type ResolvedBehaviorRecipeVariableComparison,
} from "./behaviorRecipes.js";
import { gameplayAuthoringDiagnosticError } from "./diagnostics.js";
import {
  bindSceneBehaviorRecipes,
  resolveGameplayBehaviorRuntimeIds,
  type GameplayBehaviorRuntimeIds,
  type SceneBehaviorBindingOptions,
  type SceneBehaviorBindingPlan,
} from "./gameplayAuthoring.js";
import { resolveDataSceneInstanceComponents } from "./dataSceneComponents.js";
import { instantiateSceneFragment, resolveSceneCompositionSpec } from "./sceneComposition.js";
import type {
  BehaviorRecipeDocumentSpec,
  ResolvedBehaviorRecipeDocument,
} from "./behaviorRecipes.js";
import type {
  ResolvedSceneCompositionSpec,
  SceneCompositionSpec,
} from "./sceneComposition.js";
import {
  compileDataSceneVariableRuntimeIds,
  resolveDataSceneVariableDeclarations,
  type DataSceneVariableDeclarationSpec,
  type ResolvedDataSceneVariableDeclaration,
} from "./dataSceneVariables.js";

export const SCENE_AUTHORING_DOCUMENT_FORMAT = "ferrum2d.consumer.scene-authoring" as const;
export const SCENE_AUTHORING_DOCUMENT_VERSION = 1 as const;

export interface SceneAuthoringDocumentSpec {
  format: typeof SCENE_AUTHORING_DOCUMENT_FORMAT;
  version: typeof SCENE_AUTHORING_DOCUMENT_VERSION;
  sceneComposition: SceneCompositionSpec;
  behaviorRecipes: BehaviorRecipeDocumentSpec;
  ids?: GameplayBehaviorRuntimeIds;
  variables?: readonly DataSceneVariableDeclarationSpec[];
}

export interface ResolvedSceneAuthoringDocument {
  format: typeof SCENE_AUTHORING_DOCUMENT_FORMAT;
  version: typeof SCENE_AUTHORING_DOCUMENT_VERSION;
  sceneComposition: ResolvedSceneCompositionSpec;
  behaviorRecipes: ResolvedBehaviorRecipeDocument;
  ids?: GameplayBehaviorRuntimeIds;
  variables?: readonly ResolvedDataSceneVariableDeclaration[];
  bindingPlan?: SceneBehaviorBindingPlan;
}

export interface ResolveSceneAuthoringDocumentOptions extends SceneBehaviorBindingOptions {
  validateBindings?: boolean;
  validateComponents?: boolean;
  allowComponentTemplates?: boolean;
}

export function resolveSceneAuthoringDocument(
  document: unknown,
  options: ResolveSceneAuthoringDocumentOptions = {},
): ResolvedSceneAuthoringDocument {
  const {
    validateBindings = false,
    validateComponents = false,
    allowComponentTemplates = false,
    path = "sceneAuthoring",
    ...bindingOptions
  } = options;
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
  const declaredIds = document.ids === undefined
    ? undefined
    : resolveGameplayBehaviorRuntimeIds(document.ids, { path: `${path}.ids` });
  const variables = resolveDataSceneVariableDeclarations(document.variables, {
    path: `${path}.variables`,
  });
  const variableIds = compileDataSceneVariableRuntimeIds(
    variables,
    declaredIds?.variables,
    `${path}.ids.variables`,
  );
  const ids = declaredIds === undefined && variables.length === 0
    ? undefined
    : {
        ...declaredIds,
        ...(variables.length === 0 ? {} : { variables: variableIds }),
      };
  validateBehaviorVariableContracts(behaviorRecipes, variables, variableIds, `${path}.behaviorRecipes`);
  const bindingPlan = validateBindings
    ? bindSceneBehaviorRecipes(sceneComposition, behaviorRecipes, {
        ...bindingOptions,
        path,
      })
    : undefined;
  if (validateComponents) {
    instantiateSceneFragment(sceneComposition).forEach((instance, index) => {
      resolveDataSceneInstanceComponents(instance, {
        allowTemplate: allowComponentTemplates,
        path: `${path}.sceneComposition.instances.${index}`,
      });
    });
  }

  return {
    format: SCENE_AUTHORING_DOCUMENT_FORMAT,
    version: SCENE_AUTHORING_DOCUMENT_VERSION,
    sceneComposition,
    behaviorRecipes,
    ...(ids === undefined ? {} : { ids }),
    ...(document.variables === undefined ? {} : { variables }),
    ...(bindingPlan === undefined ? {} : { bindingPlan }),
  };
}

function validateBehaviorVariableContracts(
  behaviorRecipes: ResolvedBehaviorRecipeDocument,
  declarations: readonly ResolvedDataSceneVariableDeclaration[],
  variableIds: Readonly<Record<string, number>>,
  path: string,
): void {
  const declarationsByName = new Map(declarations.map((declaration) => [declaration.name, declaration]));
  const declarationsBySlot = new Map(
    declarations.map((declaration) => [variableIds[declaration.name], declaration]),
  );
  for (const [entityId, entity] of Object.entries(behaviorRecipes.entities)) {
    entity.recipes.forEach((recipe, index) => {
      const recipePath = `${path}.entities.${entityId}.recipes.${index}`;
      if (recipe.guard !== undefined) {
        validateVariableComparison(
          recipe.guard,
          declarationsByName,
          declarationsBySlot,
          `${recipePath}.guard`,
        );
      }
      if (recipe.kind === "setVariable" || recipe.kind === "incrementVariable") {
        validateVariableMutationRecipe(
          recipe,
          declarationsByName,
          declarationsBySlot,
          recipePath,
        );
      }
    });
  }
}

function validateVariableMutationRecipe(
  recipe: Extract<ResolvedBehaviorRecipe, { kind: "setVariable" | "incrementVariable" }>,
  declarationsByName: ReadonlyMap<string, ResolvedDataSceneVariableDeclaration>,
  declarationsBySlot: ReadonlyMap<number | undefined, ResolvedDataSceneVariableDeclaration>,
  path: string,
): void {
  const declaration = variableDeclaration(
    recipe.variable,
    recipe.variableId,
    declarationsByName,
    declarationsBySlot,
    `${path}.variable`,
  );
  if (recipe.kind === "incrementVariable") {
    if (declaration.type === "bool") {
      throw gameplayAuthoringDiagnosticError(path, "incrementVariable cannot target a bool variable");
    }
    if (declaration.type === "integer" && !Number.isSafeInteger(recipe.amount)) {
      throw gameplayAuthoringDiagnosticError(`${path}.amount`, "must be a safe integer for an integer variable");
    }
    return;
  }
  validateVariableLiteral(recipe.value, declaration, `${path}.value`);
}

function validateVariableComparison(
  comparison: ResolvedBehaviorRecipeVariableComparison,
  declarationsByName: ReadonlyMap<string, ResolvedDataSceneVariableDeclaration>,
  declarationsBySlot: ReadonlyMap<number | undefined, ResolvedDataSceneVariableDeclaration>,
  path: string,
): void {
  const left = variableDeclaration(
    comparison.variable,
    comparison.variableId,
    declarationsByName,
    declarationsBySlot,
    `${path}.variable`,
  );
  if (left.type === "bool" && comparison.op !== "==" && comparison.op !== "!=") {
    throw gameplayAuthoringDiagnosticError(`${path}.op`, "bool variables support only == or != comparisons");
  }
  if (comparison.value !== undefined) {
    validateVariableLiteral(comparison.value, left, `${path}.value`);
    return;
  }
  const right = variableDeclaration(
    comparison.otherVariable,
    comparison.otherVariableId,
    declarationsByName,
    declarationsBySlot,
    `${path}.otherVariable`,
  );
  if ((left.type === "bool") !== (right.type === "bool")) {
    throw gameplayAuthoringDiagnosticError(path, "must compare bool variables only with bool variables");
  }
}

function variableDeclaration(
  name: string | undefined,
  explicitId: number | undefined,
  declarationsByName: ReadonlyMap<string, ResolvedDataSceneVariableDeclaration>,
  declarationsBySlot: ReadonlyMap<number | undefined, ResolvedDataSceneVariableDeclaration>,
  path: string,
): ResolvedDataSceneVariableDeclaration {
  const named = name === undefined ? undefined : declarationsByName.get(name);
  const bySlot = explicitId === undefined ? undefined : declarationsBySlot.get(explicitId);
  if (name !== undefined && named === undefined) {
    throw gameplayAuthoringDiagnosticError(path, `references undeclared variable '${name}'`);
  }
  if (explicitId !== undefined && bySlot === undefined) {
    throw gameplayAuthoringDiagnosticError(path, `references undeclared variable slot '${explicitId}'`);
  }
  if (named !== undefined && bySlot !== undefined && named.name !== bySlot.name) {
    throw gameplayAuthoringDiagnosticError(path, "variable and variableId must reference the same declaration");
  }
  const declaration = named ?? bySlot;
  if (declaration === undefined) {
    throw gameplayAuthoringDiagnosticError(path, "must reference a declared variable");
  }
  return declaration;
}

function validateVariableLiteral(
  value: number | boolean,
  declaration: ResolvedDataSceneVariableDeclaration,
  path: string,
): void {
  if (declaration.type === "bool") {
    if (typeof value !== "boolean") {
      throw gameplayAuthoringDiagnosticError(path, "must be a boolean for a bool variable");
    }
    return;
  }
  if (typeof value !== "number") {
    throw gameplayAuthoringDiagnosticError(path, `must be a number for a ${declaration.type} variable`);
  }
  if (declaration.type === "integer" && !Number.isSafeInteger(value)) {
    throw gameplayAuthoringDiagnosticError(path, "must be a safe integer for an integer variable");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
