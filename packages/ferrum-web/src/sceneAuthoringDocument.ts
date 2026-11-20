import { snapshotDataSceneComponentTemplates, registerSceneAuthoringComponentTemplates } from "./dataSceneComponentTemplates.js";
import { resolveDataScenePhysics, type DataScenePhysicsSpec } from "./dataScenePhysics.js";
import { validateDataScenePhysicsJointReferences } from "./dataScenePhysicsJoints.js";
import {requestsSpriteLightMasks} from "./spriteLightMasks.js";
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
import { resolveDataSceneComponentsSpec, resolveDataSceneInstanceComponents, type DataSceneComponentsSpec, type ResolvedDataSceneComponents } from "./dataSceneComponents.js";
import type { DataSceneRuntimeComponentTemplates } from "./dataSceneRuntimeTarget.js";
import { instantiateSceneFragment, resolveSceneCompositionSpec } from "./sceneComposition.js";
import type {
  BehaviorRecipeDocumentSpec,
  ResolvedBehaviorRecipeDocument,
} from "./behaviorRecipes.js";
import type {
  ResolvedSceneCompositionSpec,
  ResolvedSceneCompositionInstance,
  SceneCompositionJsonValue,
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
import { resolveSceneDisplay, type SceneDisplaySpec } from "./sceneDisplay.js";

export const SCENE_AUTHORING_DOCUMENT_FORMAT = "ferrum2d.consumer.scene-authoring" as const;
export const SCENE_AUTHORING_DOCUMENT_VERSION = 1 as const;

export interface SceneAuthoringDocumentSpec {
  /** Self-contained AI-authored inline component catalog; instances retain template references. */
  componentTemplates?: Readonly<Record<string, DataSceneComponentsSpec>>;
  /** One 3D physics world; planar-xy constrains the same backend. */
  physics?: DataScenePhysicsSpec;
  display?: SceneDisplaySpec;
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
  componentTemplates?: Readonly<Record<string, DataSceneComponentsSpec>>;
  physics?: DataScenePhysicsSpec;
  display?: SceneDisplaySpec;
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
  /** Resolve catalog references for the same semantic validation as inline components. */
  componentTemplates?: DataSceneRuntimeComponentTemplates;
}

export function resolveSceneAuthoringDocument(
  document: unknown,
  options: ResolveSceneAuthoringDocumentOptions = {},
): ResolvedSceneAuthoringDocument {
  const {
    validateBindings = false,
    validateComponents = false,
    componentTemplates: externalComponentTemplates,
    allowComponentTemplates: suppliedAllowComponentTemplates,
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

  const catalog = snapshotDataSceneComponentTemplates(document.componentTemplates, externalComponentTemplates, `${path}.componentTemplates`);
  const componentTemplates = catalog.templates;
  const allowComponentTemplates = suppliedAllowComponentTemplates ?? componentTemplates !== undefined;
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
  const physics = document.physics === undefined ? undefined : resolveDataScenePhysics(document.physics, `${path}.physics`);
  const display=resolveSceneDisplay(document.display,`${path}.display`);
  if(spatial && display?.pixelPerfect)throw sceneCompositionDiagnosticError(`${path}.display.pixelPerfect`,"flat pixelPerfect cannot be combined with spatial; use spatial.environment.pixelArt");
  if (spatial && lighting) throw sceneCompositionDiagnosticError(`${path}.lighting`, "flat lighting cannot be combined with spatial; use spatial.environment.lighting");
  const instances = validateComponents || componentTemplates !== undefined || physics !== undefined || spatial !== undefined || navigation?.obstacles !== undefined
    ? bindingPlan?.instances ?? instantiateSceneFragment(sceneComposition, { ...bindingOptions, path: `${path}.composition` })
    : [];
  // Keep the authored template references in the returned composition. Only cold
  // semantic validation sees the resolved catalog entries.
  const templateSpecs = new Map<string, DataSceneComponentsSpec>();
  const templateComponents = new Map<string, ResolvedDataSceneComponents>();
  const componentsFor = (instance: ResolvedSceneCompositionInstance, location: string): ResolvedDataSceneComponents => {
    const components = resolveDataSceneInstanceComponents(instance, { allowTemplate: allowComponentTemplates, path: location });
    if (components.mode === "inline") return components;
    if (componentTemplates === undefined) {
      if (physics) throw sceneCompositionDiagnosticError(`${location}.props.components.template`, "physics authoring requires a componentTemplates catalog");
      return components;
    }
    const previous = templateComponents.get(components.template);
    if (previous) return previous;
    const spec = typeof componentTemplates === "function" ? componentTemplates(components.template)
      : Object.prototype.hasOwnProperty.call(componentTemplates, components.template) ? componentTemplates[components.template] : undefined;
    const templatePath = `${location}.props.components.template(${components.template})`;
    if (spec === undefined) throw sceneCompositionDiagnosticError(templatePath, "must resolve to a component template catalog entry");
    const snapshot = spec;
    const resolved = resolveDataSceneComponentsSpec(snapshot, { allowTemplate: false, path: templatePath });
    templateSpecs.set(components.template, snapshot);
    templateComponents.set(components.template, resolved);
    return resolved;
  };
  const physicsBodyIds = new Set<string>();
  if (validateComponents || componentTemplates !== undefined || physics) {
    instances.forEach((instance, index) => {
      const components=componentsFor(instance, `${path}.sceneComposition.instances.${index}`);
      if (components.mode === "inline") {
        const body = components.body;
        if (body && body.type === undefined) physicsBodyIds.add(instance.id);
        if (body && body.type === undefined && !physics)
          throw sceneCompositionDiagnosticError(`${path}.physics`, "is required for bodies with a shape collider");
        if (physics?.space === "spatial" && (body?.type !== undefined || components.collider.type !== "none"))
          throw sceneCompositionDiagnosticError(`${path}.sceneComposition.instances.${index}.components`, "spatial physics requires body.collider and no older body/type or separate collider");
        if (body && body.type === undefined && components.collider.type !== "none")
          throw sceneCompositionDiagnosticError(`${path}.sceneComposition.instances.${index}.components`, "a shape body cannot also own a separate component collider");
        if (body?.type === "kinematic" && body.kinematicController !== undefined && physics?.space !== "planar-xy")
          throw sceneCompositionDiagnosticError(`${path}.sceneComposition.instances.${index}.components.body.kinematicController`, "requires explicit planar-xy scene physics");
      }
      if(components.mode==="inline"&&requestsSpriteLightMasks(components.sprite.lighting)&&(lighting?.profile!=="lit"||spatial))throw sceneCompositionDiagnosticError(`${path}.components.lighting`,"light masks require a flat lit lighting profile");
      if(components.mode==="inline"&&components.sprite.surface&&(lighting?.profile!=="lit"||spatial))throw sceneCompositionDiagnosticError(`${path}.components.surface`,"requires a flat lit lighting profile");
    });
  }

  validateDataScenePhysicsJointReferences(physics?.joints, physicsBodyIds, `${path}.physics.joints`);

  if (navigation?.obstacles !== undefined) {
    const instancesById = new Map(instances.map(instance => [instance.id, instance]));
    for (const obstacle of navigation.obstacles) {
      const instance = instancesById.get(obstacle.instanceId);
      if (instance === undefined) throw sceneCompositionDiagnosticError(`${path}.navigation.obstacles`, "must reference an instance in the applied fragment");
      const components = componentsFor(instance, `${path}.navigation.obstacles.${obstacle.instanceId}`);
      if (components.mode !== "inline" || components.collider.type === "none") {
        throw sceneCompositionDiagnosticError(`${path}.navigation.obstacles`, "requires an inline collider");
      }
    }
  }

  if (spatial) {
    const byId=new Map(instances.map(instance=>[instance.id,instance]));
    for (const id of Object.keys(spatial.billboards)) {
      const instance=byId.get(id);if (!instance) throw sceneCompositionDiagnosticError(`${path}.spatial.billboards.${id}`,"must reference the applied fragment");
      const c=componentsFor(instance,`${path}.spatial.billboards.${id}`);
      if (c.mode!=="inline") throw sceneCompositionDiagnosticError(`${path}.spatial.billboards.${id}`,"requires inline components");
      if (c.sprite.nineSlice) throw sceneCompositionDiagnosticError(`${path}.spatial.billboards.${id}`,"9-slice supports flat 2D sprites, not spatial billboards");
      if (spatial.actor?.instanceId === id) {
        if (physics) {
          const body = c.body;
          if (physics.space !== "spatial" || !body || body.type !== undefined || body.kind !== "kinematic-position" ||
              !body.character || body.collider.sensor || (body.character.up ?? [0, 1, 0]).some((n, i) => n !== (i === 1 ? 1 : 0)))
            throw sceneCompositionDiagnosticError(`${path}.spatial.actor`, "requires a spatial Y-up position-kinematic capsule controller");
          // The generic spatial resolver has legacy pixel defaults. In a native
          // document, omitted limits inherit the authored controller's world units.
          const rawSpatial = isRecord(document.spatial) ? document.spatial : undefined;
          const rawActor = isRecord(rawSpatial?.actor) ? rawSpatial.actor : undefined;
          const maxStepHeight = rawActor?.maxStepHeight === undefined ? body.character.stepHeight ?? 0.3 : spatial.actor.maxStepHeight!;
          const maxDropHeight = rawActor?.maxDropHeight === undefined ? body.character.snapDistance ?? 0.2 : spatial.actor.maxDropHeight!;
          if (![maxStepHeight, maxDropHeight].every(n => Number.isFinite(Math.fround(n)) && n >= 0 && n <= 10000) || spatial.actor.speed > 1e6)
            throw sceneCompositionDiagnosticError(`${path}.spatial.actor`, "controller limits must be 0–10000 and speed at most 1000000");
          spatial.actor = { ...spatial.actor, maxStepHeight, maxDropHeight };
        } else if (c.body?.type !== "kinematic" || !c.body.heightSpan || c.collider.type !== "aabb" || c.collider.isTrigger || !c.collider.enabled) {
          throw sceneCompositionDiagnosticError(`${path}.spatial.actor`, "requires a kinematic heightSpan body and enabled non-trigger AABB");
        }
      }
    }
    for (const [id,model] of Object.entries(spatial.models ?? {})) {
      const instance=byId.get(id);
      if(!instance) throw sceneCompositionDiagnosticError(`${path}.spatial.models.${id}`,"must reference the applied fragment");
      const c=componentsFor(instance,`${path}.spatial.models.${id}`);
      if(c.mode!=="inline" || c.body?.type==="dynamic" || (c.body && c.body.type===undefined && (c.body.kind??"dynamic")==="dynamic" && physics?.space!=="spatial"))
        throw sceneCompositionDiagnosticError(`${path}.spatial.models.${id}`,"requires inline static/kinematic components or an explicit spatial native body");
      if (c.sprite.nineSlice) throw sceneCompositionDiagnosticError(`${path}.spatial.models.${id}`,"9-slice supports flat 2D sprites, not spatial models");
      // These are authored transforms, not a second runtime pose. Reject overflow before activation.
      if(!Number.isFinite(Math.fround(instance.x)) || !Number.isFinite(Math.fround(instance.y)) || !Number.isFinite(Math.fround(model.scale ?? 1)))
        throw sceneCompositionDiagnosticError(`${path}.spatial.models.${id}`,"invalid model transform");
    }
    const initialPoses=new Map<string,{x:number;y:number;elevation:number;yaw:number}>();
    const initialPose=(id:string):{x:number;y:number;elevation:number;yaw:number}=>{
      const existing=initialPoses.get(id);if(existing)return existing;
      const instance=byId.get(id);if(!instance)throw sceneCompositionDiagnosticError(`${path}.spatial.attachments.${id}`,'unknown instance');
      const c=componentsFor(instance,`${path}.spatial.attachments.${id}`);
      const a=spatial.attachments?.[id];let pose={x:Math.fround(instance.x),y:Math.fround(instance.y),elevation:c.mode==='inline'?Math.fround((c.body?.type===undefined?c.body?.elevation:c.body.heightSpan?.elevation)??0):0,yaw:0};
      if(a){const p=initialPose(a.parent),r=Math.fround((a.yawDegrees??0)*Math.PI/180),co=Math.cos(p.yaw),si=Math.sin(p.yaw);pose={x:Math.fround(p.x+co*Math.fround(a.x??0)-si*Math.fround(a.y??0)),y:Math.fround(p.y+si*Math.fround(a.x??0)+co*Math.fround(a.y??0)),elevation:Math.fround(p.elevation+Math.fround(a.elevation??0)),yaw:Math.fround(p.yaw+r)};}
      const height=c.mode==='inline'?c.body?.heightSpan?.height??0:0;
      if(!Object.values(pose).every(Number.isFinite)||Math.abs(pose.x)>1e6||Math.abs(pose.y)>1e6||Math.abs(pose.elevation)>1e6||!Number.isFinite(Math.fround(pose.elevation+height)))throw sceneCompositionDiagnosticError(`${path}.spatial.attachments.${id}`,'initial derived pose exceeds native limits');
      initialPoses.set(id,pose);return pose;
    };
    for(const id of Object.keys(spatial.lightBindings??{}))if(!byId.has(id))throw sceneCompositionDiagnosticError(`${path}.spatial.lightBindings.${id}`,"unknown instance");
    for(const [id,a]of Object.entries(spatial.attachments??{})){
      const child=byId.get(id),parent=byId.get(a.parent);
      if(!child||!parent)throw sceneCompositionDiagnosticError(`${path}.spatial.attachments.${id}`,'must reference applied instances');
      const c=componentsFor(child,`${path}.spatial.attachments.${id}`),p=componentsFor(parent,`${path}.spatial.attachments.${id}.parent`);
      const renderOnly=c.mode==='inline' && !c.body && c.collider.type==='none' && Object.prototype.hasOwnProperty.call(spatial.models??{},id);
      if(c.mode!=='inline'||p.mode!=='inline'||(!renderOnly&&(c.body?.type!=='static'||!c.body.heightSpan))||(!p.body?.heightSpan&&!Object.prototype.hasOwnProperty.call(spatial.attachments??{},a.parent)))throw sceneCompositionDiagnosticError(`${path}.spatial.attachments.${id}`,'requires a static heightSpan child or visual-only model, and a heightSpan root');
      initialPose(id);
    }
  }
  const semanticBindingPlan = bindingPlan && componentTemplates !== undefined ? {
    ...bindingPlan,
    instances: bindingPlan.instances.map(instance => {
      const raw = resolveDataSceneInstanceComponents(instance, { allowTemplate: allowComponentTemplates, path });
      if (raw.mode === "inline") return instance;
      componentsFor(instance, `${path}.instances.${instance.id}`);
      // Catalog specs passed the same JSON authoring validation as inline props.
      const components = templateSpecs.get(raw.template)! as unknown as SceneCompositionJsonValue;
      return { ...instance, props: { ...instance.props, components } };
    }),
  } : bindingPlan;
  if (semanticBindingPlan) validateDataSceneSpawnPrefabs({ gameplay, spatial, ids, physics }, semanticBindingPlan, ids, path);
  if (gameplay?.combatNavigation !== undefined) {
    if (!spatial || spatial.terrain.length === 0) throw gameplayAuthoringDiagnosticError(`${path}.gameplay.combatNavigation`, "requires spatial terrain and camera");
    if (semanticBindingPlan) validateCombatNavigationBindings(gameplay.combatNavigation, gameplay.primaryActor, spatial, semanticBindingPlan, `${path}.gameplay.combatNavigation`, physics);
  }
  for (const command of finalCombatActions(bindingPlan?.commands ?? [], ids)) {
    if (command.type === "configureProjectileAction" && command.projectilePrefab !== undefined &&
        (gameplay?.combat !== true || !Object.prototype.hasOwnProperty.call(gameplay.projectilePrefabs ?? {}, command.projectilePrefab))) {
      throw gameplayAuthoringDiagnosticError(`${path}.behaviorRecipes.projectilePrefab`, "must reference gameplay.projectilePrefabs in a combat document");
    }
  }
  const result: ResolvedSceneAuthoringDocument = {
    ...(catalog.local === undefined ? {} : { componentTemplates: catalog.local }),
    ...(physics === undefined ? {} : { physics }),
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
    ...(display === undefined ? {} : { display }),
    ...(bindingPlan === undefined ? {} : { bindingPlan }),
  };
  registerSceneAuthoringComponentTemplates(result, componentTemplates);
  return result;
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
