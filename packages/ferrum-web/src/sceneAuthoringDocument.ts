import { validateDataSceneSpawnPrefabs } from "./dataSceneSpawnPrefabs.js";
import { validateCombatNavigationBindings } from "./dataSceneCombatNavigation.js";
import { resolveDataSceneSpatialSpec, type DataSceneSpatialSpec } from "./dataSceneSpatial.js";
import {
  resolveBehaviorRecipeDocument,
  type ResolvedBehaviorRecipe,
  type ResolvedBehaviorRecipeVariableComparison,
} from "./behaviorRecipes.js";
import { gameplayAuthoringDiagnosticError, sceneCompositionDiagnosticError } from "./diagnostics.js";
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
import { resolveDataSceneGameplaySpec, type DataSceneGameplaySpec } from "./dataSceneGameplay.js";
import { resolveDataSceneNavigationSpec, type DataSceneNavigationSpec } from "./dataSceneNavigation.js";
import { resolveSceneLighting } from "./sceneLighting.js";
import type { LightingScene2D } from "./lightingTypes.js";

export const SCENE_AUTHORING_DOCUMENT_FORMAT = "ferrum2d.consumer.scene-authoring" as const;
export const SCENE_AUTHORING_DOCUMENT_VERSION = 1 as const;

export interface SceneAuthoringDocumentSpec {
  format: typeof SCENE_AUTHORING_DOCUMENT_FORMAT;
  version: typeof SCENE_AUTHORING_DOCUMENT_VERSION;
  sceneComposition: SceneCompositionSpec;
  behaviorRecipes: BehaviorRecipeDocumentSpec;
  ids?: GameplayBehaviorRuntimeIds;
  variables?: readonly DataSceneVariableDeclarationSpec[];
  gameplay?: DataSceneGameplaySpec;
  navigation?: DataSceneNavigationSpec;
  spatial?: DataSceneSpatialSpec;
  /** World-space flat lighting. Spatial scenes use spatial.environment.lighting. */
  lighting?: LightingScene2D;
}

export interface ResolvedSceneAuthoringDocument {
  format: typeof SCENE_AUTHORING_DOCUMENT_FORMAT;
  version: typeof SCENE_AUTHORING_DOCUMENT_VERSION;
  sceneComposition: ResolvedSceneCompositionSpec;
  behaviorRecipes: ResolvedBehaviorRecipeDocument;
  ids?: GameplayBehaviorRuntimeIds;
  variables?: readonly ResolvedDataSceneVariableDeclaration[];
  gameplay?: DataSceneGameplaySpec;
  navigation?: DataSceneNavigationSpec;
  spatial?: DataSceneSpatialSpec;
  lighting?: LightingScene2D;
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
  const gameplay = document.gameplay === undefined ? undefined : resolveDataSceneGameplaySpec(document.gameplay, `${path}.gameplay`);
  const bindingPlan = validateBindings || gameplay?.spawnPrefabs !== undefined
    ? bindSceneBehaviorRecipes(sceneComposition, behaviorRecipes, {
        ...bindingOptions,
        path,
      })
    : undefined;
  const navigation = document.navigation === undefined ? undefined : resolveDataSceneNavigationSpec(document.navigation, `${path}.navigation`);
  const spatial = document.spatial === undefined ? undefined : resolveDataSceneSpatialSpec(document.spatial, `${path}.spatial`);
  const lighting = document.lighting === undefined ? undefined : resolveSceneLighting(document.lighting, `${path}.lighting`);
  if (spatial && lighting) throw sceneCompositionDiagnosticError(`${path}.lighting`, "flat lighting cannot be combined with spatial; use spatial.environment.lighting");
  const instances = validateComponents || spatial !== undefined || navigation?.obstacles !== undefined
    ? bindingPlan?.instances ?? instantiateSceneFragment(sceneComposition, { ...bindingOptions, path: `${path}.composition` })
    : [];
  if (validateComponents) {
    instances.forEach((instance, index) => {
      resolveDataSceneInstanceComponents(instance, {
        allowTemplate: allowComponentTemplates,
        path: `${path}.sceneComposition.instances.${index}`,
      });
    });
  }

  if (navigation?.obstacles !== undefined) {
    const instancesById = new Map(instances.map(instance => [instance.id, instance]));
    for (const obstacle of navigation.obstacles) {
      const instance = instancesById.get(obstacle.instanceId);
      if (instance === undefined) throw sceneCompositionDiagnosticError(`${path}.navigation.obstacles`, "must reference an instance in the applied fragment");
      const components = resolveDataSceneInstanceComponents(instance, { allowTemplate: allowComponentTemplates, path: `${path}.navigation.obstacles.${obstacle.instanceId}` });
      if (components.mode !== "inline" || components.collider.type === "none") {
        throw sceneCompositionDiagnosticError(`${path}.navigation.obstacles`, "requires an inline collider");
      }
    }
  }

  if (spatial) {
    const byId=new Map(instances.map(instance=>[instance.id,instance]));
    for (const id of Object.keys(spatial.billboards)) {
      const instance=byId.get(id);if (!instance) throw sceneCompositionDiagnosticError(`${path}.spatial.billboards.${id}`,"must reference the applied fragment");
      const c=resolveDataSceneInstanceComponents(instance,{allowTemplate:allowComponentTemplates,path:`${path}.spatial.billboards.${id}`});
      if (c.mode!=="inline") throw sceneCompositionDiagnosticError(`${path}.spatial.billboards.${id}`,"requires inline components");
      if (spatial.actor?.instanceId===id && (c.body?.type!=="kinematic" || !c.body.heightSpan || c.collider.type!=="aabb" || c.collider.isTrigger || !c.collider.enabled)) throw sceneCompositionDiagnosticError(`${path}.spatial.actor`,"requires a kinematic heightSpan body and enabled non-trigger AABB");
    }
    for (const [id,model] of Object.entries(spatial.models ?? {})) {
      const instance=byId.get(id);
      if(!instance) throw sceneCompositionDiagnosticError(`${path}.spatial.models.${id}`,"must reference the applied fragment");
      const c=resolveDataSceneInstanceComponents(instance,{allowTemplate:false,path:`${path}.spatial.models.${id}`});
      if(c.mode!=="inline" || c.body?.type==="dynamic")
        throw sceneCompositionDiagnosticError(`${path}.spatial.models.${id}`,"requires inline static or kinematic model components");
      // These are authored transforms, not a second runtime pose. Reject overflow before activation.
      if(!Number.isFinite(Math.fround(instance.x)) || !Number.isFinite(Math.fround(instance.y)) || !Number.isFinite(Math.fround(model.scale ?? 1)))
        throw sceneCompositionDiagnosticError(`${path}.spatial.models.${id}`,"invalid model transform");
    }
    const initialPoses=new Map<string,{x:number;y:number;elevation:number;yaw:number}>();
    const initialPose=(id:string):{x:number;y:number;elevation:number;yaw:number}=>{
      const existing=initialPoses.get(id);if(existing)return existing;
      const instance=byId.get(id);if(!instance)throw sceneCompositionDiagnosticError(`${path}.spatial.attachments.${id}`,'unknown instance');
      const c=resolveDataSceneInstanceComponents(instance,{allowTemplate:false,path:`${path}.spatial.attachments.${id}`});
      const a=spatial.attachments?.[id];let pose={x:Math.fround(instance.x),y:Math.fround(instance.y),elevation:c.mode==='inline'?Math.fround(c.body?.heightSpan?.elevation??0):0,yaw:0};
      if(a){const p=initialPose(a.parent),r=Math.fround((a.yawDegrees??0)*Math.PI/180),co=Math.cos(p.yaw),si=Math.sin(p.yaw);pose={x:Math.fround(p.x+co*Math.fround(a.x??0)-si*Math.fround(a.y??0)),y:Math.fround(p.y+si*Math.fround(a.x??0)+co*Math.fround(a.y??0)),elevation:Math.fround(p.elevation+Math.fround(a.elevation??0)),yaw:Math.fround(p.yaw+r)};}
      const height=c.mode==='inline'?c.body?.heightSpan?.height??0:0;
      if(!Object.values(pose).every(Number.isFinite)||Math.abs(pose.x)>1e6||Math.abs(pose.y)>1e6||Math.abs(pose.elevation)>1e6||!Number.isFinite(Math.fround(pose.elevation+height)))throw sceneCompositionDiagnosticError(`${path}.spatial.attachments.${id}`,'initial derived pose exceeds native limits');
      initialPoses.set(id,pose);return pose;
    };
    for(const [id,a]of Object.entries(spatial.attachments??{})){
      const child=byId.get(id),parent=byId.get(a.parent);
      if(!child||!parent)throw sceneCompositionDiagnosticError(`${path}.spatial.attachments.${id}`,'must reference applied instances');
      const c=resolveDataSceneInstanceComponents(child,{allowTemplate:false,path:`${path}.spatial.attachments.${id}`}),p=resolveDataSceneInstanceComponents(parent,{allowTemplate:false,path:`${path}.spatial.attachments.${id}.parent`});
      if(c.mode!=='inline'||p.mode!=='inline'||c.body?.type!=='static'||!c.body.heightSpan||!p.body?.heightSpan)throw sceneCompositionDiagnosticError(`${path}.spatial.attachments.${id}`,'requires a static heightSpan child and heightSpan parent');
      initialPose(id);
    }
  }
  if (bindingPlan) validateDataSceneSpawnPrefabs({ gameplay, spatial, ids }, bindingPlan, ids, path);
  if (gameplay?.combatNavigation !== undefined) {
    if (!spatial || spatial.terrain.length === 0) throw gameplayAuthoringDiagnosticError(`${path}.gameplay.combatNavigation`, "requires spatial terrain and camera");
    if (bindingPlan) validateCombatNavigationBindings(gameplay.combatNavigation, gameplay.primaryActor, spatial, bindingPlan, `${path}.gameplay.combatNavigation`);
  }
  for (const command of finalCombatActions(bindingPlan?.commands ?? [], ids)) {
    if (command.type === "configureProjectileAction" && command.projectilePrefab !== undefined &&
        (gameplay?.combat !== true || !Object.prototype.hasOwnProperty.call(gameplay.projectilePrefabs ?? {}, command.projectilePrefab))) {
      throw gameplayAuthoringDiagnosticError(`${path}.behaviorRecipes.projectilePrefab`, "must reference gameplay.projectilePrefabs in a combat document");
    }
  }
  return {
    format: SCENE_AUTHORING_DOCUMENT_FORMAT,
    version: SCENE_AUTHORING_DOCUMENT_VERSION,
    sceneComposition,
    behaviorRecipes,
    ...(ids === undefined ? {} : { ids }),
    ...(document.variables === undefined ? {} : { variables }),
    ...(gameplay === undefined ? {} : { gameplay }),
    ...(navigation === undefined ? {} : { navigation }),
    ...(spatial === undefined ? {} : { spatial }),
    ...(lighting === undefined ? {} : { lighting }),
    ...(bindingPlan === undefined ? {} : { bindingPlan }),
  };
}

/** Internal shared validation for document declarations and effective apply-time slot ids. */
export function validateBehaviorVariableContracts(
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
import { finalCombatActions } from "./dataSceneCombatActions.js";
