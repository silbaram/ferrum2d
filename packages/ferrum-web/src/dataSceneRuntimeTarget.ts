import { combatChaseCommands, combatCrowdRequired } from "./dataSceneCombatCrowd.js";
import { MAX_SPRITE_NORMAL_UPDATES } from "./spriteNormals.js";
import { MAX_DATA_SCENE_PROJECTILE_BINDINGS, compileDataSceneProjectilePrefabs, resolveDataSceneProjectileTextures } from "./dataSceneProjectilePrefabs.js";
import type { SpatialModelAsset, SpatialModelPreparation, SpatialModelPreparer } from "./spatialModel.js";
import { forgetDataSceneProgressContext, rememberDataSceneProgressContext } from "./dataSceneProgress.js";
import { resolveDataSceneGroundShadow, type ResolvedDataSceneGroundShadow } from "./dataSceneSun.js";
import type { DataSceneSpriteAnimationSetSpec } from "./dataSceneSpriteAnimation.js";
import { dataSceneVisualColor } from "./dataSceneVisualColor.js";
import { resolveColorManagementMode, type ColorManagementMode } from "./colorManagement.js";
import { sceneCompositionDiagnosticError } from "./diagnostics.js";
import type { FerrumEngine } from "./engineTypes.js";
import {
  resolveDataSceneComponentsSpec,
  resolveDataSceneInstanceComponents,
  type DataSceneComponentsSpec,
  type DataSceneBodySpec,
  type ResolvedDataSceneColliderComponent,
  type ResolvedDataSceneComponents,
  type ResolvedDataSceneSpriteComponent,
} from "./dataSceneComponents.js";
import { applySceneBehaviorRecipes, bindSceneBehaviorRecipes } from "./gameplayAuthoring.js";
import { preflightDataSceneGameplay } from "./dataSceneGameplayAuthoring.js";
import { resolveSceneAuthoringDocument } from "./sceneAuthoringDocument.js";
import {
  captureDataSceneVariableRuntimeSnapshot,
  compileDataSceneVariableRuntimeIds,
  preflightDataSceneVariableRuntime,
  restoreDataSceneVariableRuntimeSnapshot,
  synchronizeDataSceneVariableStore,
} from "./dataSceneVariables.js";
import type {
  ApplySceneBehaviorRecipesOptions,
  GameplayEntityHandle,
  SceneBehaviorApplyResult,
  SceneBehaviorRuntimeTarget,
} from "./gameplayAuthoring.js";
import type { ResolvedSceneAuthoringDocument } from "./sceneAuthoringDocument.js";
import type { ResolvedSceneCompositionInstance } from "./sceneComposition.js";
import type { DataSceneSpatialSpec, SpatialCameraSpec } from "./dataSceneSpatial.js";
import { resolveSpatialNormalTextures } from "./dataSceneSpatial.js";
import type { SpatialEnvironmentSpec } from "./spatialEnvironment.js";
import type { DataSceneVariableStore } from "./dataSceneVariables.js";

const DATA_SCENE_RUNTIME_ENGINE_ADAPTER = Symbol("ferrum2d.dataSceneRuntimeEngineAdapter");

const DATA_SCENE_COLLIDER_TYPE_NONE = 0;
const DATA_SCENE_COLLIDER_TYPE_AABB = 1;
const DATA_SCENE_COLLIDER_TYPE_CIRCLE = 2;
const DATA_SCENE_COLLIDER_TYPE_CAPSULE = 3;
const DATA_SCENE_COLLIDER_TYPE_ORIENTED_BOX = 4;
const DATA_SCENE_COLLIDER_TYPE_CONVEX_POLYGON = 5;

export type DataSceneRuntimeTextureIdResolver = (name: string) => number;
export type DataSceneRuntimeComponentTemplateCatalog = Readonly<Record<string, DataSceneComponentsSpec>>;
export type DataSceneRuntimeComponentTemplateResolver = (template: string) => DataSceneComponentsSpec | undefined;
export type DataSceneRuntimeComponentTemplates =
  | DataSceneRuntimeComponentTemplateCatalog
  | DataSceneRuntimeComponentTemplateResolver;

export interface CreateDataSceneRuntimeTargetOptions {
  path?: string;
  activateDataScene?: boolean;
  /** Match the renderer working space when compiling sRGB authoring colors. */
  colorManagement?: ColorManagementMode;
  textureId?: DataSceneRuntimeTextureIdResolver;
  componentTemplates?: DataSceneRuntimeComponentTemplates;
}

export interface ApplyDataSceneAuthoringDocumentOptions
  extends Omit<CreateDataSceneRuntimeTargetOptions, "path">,
    Omit<ApplySceneBehaviorRecipesOptions, "path"> {
  path?: string;
  validateBindings?: boolean;
  validateComponents?: boolean;
  allowComponentTemplates?: boolean;
  /** Opt-in model GPU preparation before replacing the active scene; not serialized. */
  spatialModelPreparer?: SpatialModelPreparer;
}

export interface ApplyDataSceneAuthoringDocumentResult extends SceneBehaviorApplyResult {
  document: ResolvedSceneAuthoringDocument;
  variables: DataSceneVariableStore;
}

export interface DataSceneRuntimeSpawnRequest {
  x: number;
  y: number;
  rotationRadians: number;
  renderLayer: number;
  body?: DataSceneBodySpec;
  originX: number;
  originY: number;
  sortOrder: number;
  depthSort: boolean;
  projectGround?: boolean;
  groundShadow?: ResolvedDataSceneGroundShadow;
  color: readonly [number, number, number, number];
  textureId: number;
  normalTextureId?: number;
  spriteWidth: number;
  spriteHeight: number;
  frameU0: number;
  frameV0: number;
  frameU1: number;
  frameV1: number;
  animationFrameCount: number;
  animationFps: number;
  animationSet?: DataSceneSpriteAnimationSetSpec;
  layer: number;
  colliderType: number;
  colliderOffsetX: number;
  colliderOffsetY: number;
  colliderEnabled: boolean;
  colliderIsTrigger: boolean;
  colliderHalfWidth: number;
  colliderHalfHeight: number;
  colliderRadius: number;
  colliderStartX: number;
  colliderStartY: number;
  colliderEndX: number;
  colliderEndY: number;
  colliderRotationRadians: number;
  colliderVertices: Float32Array;
}

export interface DataSceneRuntimeEngineAdapter {
  supportsSpriteNormalMaterials?(): boolean;
  useDataScene(): void;
  /** Optional cold capability; absence rejects render:false before scene activation. */
  supportsSpatialSurfaceProxies?(): boolean;
  /** Optional cold capability; absence rejects X ramps before activation. */
  supportsSpatialRampAxis?(): boolean;
  /** Opaque registered handles only; available after model/content preflight. */
  spatialModelAssets?(spec: DataSceneSpatialSpec): readonly SpatialModelAsset[];
  textureId(name: string): number;
  spawnDataSceneEntity(request: DataSceneRuntimeSpawnRequest): GameplayEntityHandle | undefined;
  /** Cold native camera/environment validation before destructive authoring activation. */
  preflightSpatialEnvironment?(camera: SpatialCameraSpec, environment: SpatialEnvironmentSpec): boolean;
}

interface DataSceneRuntimeEngine {
  [DATA_SCENE_RUNTIME_ENGINE_ADAPTER]?: DataSceneRuntimeEngineAdapter;
}

export function attachDataSceneRuntimeEngineAdapter(
  engine: FerrumEngine,
  adapter: DataSceneRuntimeEngineAdapter,
): FerrumEngine {
  Object.defineProperty(engine, DATA_SCENE_RUNTIME_ENGINE_ADAPTER, {
    configurable: false,
    enumerable: false,
    value: adapter,
  });
  return engine;
}

export function createDataSceneRuntimeTarget(
  engine: FerrumEngine,
  options: CreateDataSceneRuntimeTargetOptions = {},
): SceneBehaviorRuntimeTarget {
  return createRuntimeTarget(engine, options, false);
}
function createRuntimeTarget(engine:FerrumEngine, options:CreateDataSceneRuntimeTargetOptions, deferNormals:boolean):SceneBehaviorRuntimeTarget {
  const path = options.path ?? "dataSceneRuntimeTarget";
  const adapter = dataSceneRuntimeEngineAdapter(engine, `${path}.engine`);
  const textureId = options.textureId ?? ((name: string) => adapter.textureId(name));
  const colorManagement = resolveColorManagementMode(options.colorManagement);
  let dataSceneActivated = false;

  const activateDataScene = (): void => {
    if (options.activateDataScene === false || dataSceneActivated) {
      return;
    }
    adapter.useDataScene();
    dataSceneActivated = true;
  };

  return {
    spawnSceneInstance: (instance) => {
      const request = dataSceneRuntimeSpawnRequest(
        instance,
        textureId,
        options.componentTemplates,
        `${path}.instances.${instance.id}`,
        colorManagement,
      );
      if(request.normalTextureId!==undefined&&!adapter.supportsSpriteNormalMaterials?.())throw sceneCompositionDiagnosticError(`${path}.instances.${instance.id}`,"sprite normal materials require native v1 support");
      activateDataScene();
      const {normalTextureId:_normal,...unmapped}=request;
      const handle = adapter.spawnDataSceneEntity(deferNormals?unmapped:request);
      if (handle === undefined) {
        throw sceneCompositionDiagnosticError(`${path}.instances.${instance.id}`, "failed to spawn data-scene entity");
      }
      return handle;
    },
  };
}

export function applyDataSceneAuthoringDocument(
  engine: FerrumEngine,
  document: unknown,
  options: ApplyDataSceneAuthoringDocumentOptions = {},
): ApplyDataSceneAuthoringDocumentResult {
  const {
    path: optionPath,
    activateDataScene,
    colorManagement,
    componentTemplates,
    textureId,
    spatialModelPreparer,
    validateBindings = true,
    validateComponents = true,
    allowComponentTemplates = componentTemplates !== undefined,
    ...applyOptions
  } = options;
  const {
    ids,
    instanceHandleRegistry,
    ...bindingOptions
  } = applyOptions;
  const path = optionPath ?? "dataSceneAuthoring";
  resolveColorManagementMode(colorManagement);
  const resolved = resolveSceneAuthoringDocument(document, {
    ...bindingOptions,
    path,
    validateBindings,
    validateComponents,
    allowComponentTemplates,
  });
  const resolvedVariables = resolved.variables ?? [];
  const baseRuntimeIds = ids ?? resolved.ids;
  const runtimeVariableIds = compileDataSceneVariableRuntimeIds(
    resolvedVariables,
    baseRuntimeIds?.variables,
    `${path}.ids.variables`,
  );
  const runtimeIds = baseRuntimeIds === undefined && resolvedVariables.length === 0
    ? undefined
    : {
        ...baseRuntimeIds,
        ...(resolvedVariables.length === 0 ? {} : { variables: runtimeVariableIds }),
      };
  const runtimeAdapter = dataSceneRuntimeEngineAdapter(engine, `${path}.runtimeTarget.engine`);
  // Resolve every normal reference before activation/spawn can replace the previous scene.
  const runtimeSpatial = resolved.spatial === undefined ? undefined : resolveSpatialNormalTextures(resolved.spatial, textureId ?? (name => runtimeAdapter.textureId(name)));
  if (
    resolved.spatial?.terrain.some(s => s.render === false) &&
    !runtimeAdapter.supportsSpatialSurfaceProxies?.()
  )
    throw sceneCompositionDiagnosticError(
      `${path}.spatial.terrain`,
      "render:false surfaces require native spatial surface proxy v1 support",
    );
  if (resolved.spatial?.terrain.some(s => s.rampAxis === "x") && !runtimeAdapter.supportsSpatialRampAxis?.())
    throw sceneCompositionDiagnosticError(`${path}.spatial.terrain`, "X ramps require native spatial ramp axis v1 support");
  const bindingPlan = bindSceneBehaviorRecipes(resolved.sceneComposition, resolved.behaviorRecipes, { ...bindingOptions, path });
  // Resolve all optional normal refs/capabilities before replacing the current scene.
  const normalMaterials=bindingPlan.instances.flatMap(instance=>{
    const raw=instance.props.components;
    if(!raw||typeof raw!=="object"||Array.isArray(raw))return [];
    const component=raw as Record<string,unknown>;
    const hasNormal=[component.visual,component.sprite].some(value=>value&&typeof value==="object"&&!Array.isArray(value)&&"normalTexture" in value);
    if(!hasNormal&&!(component.template!==undefined&&componentTemplates!==undefined))return [];
    const components=dataSceneRuntimeInlineComponents(resolveDataSceneInstanceComponents(instance,{allowTemplate:true,path}),componentTemplates,path);
    return components.sprite.normalTexture===undefined?[]:[{id:instance.id,normalTextureId:normalTextureId(components.sprite.normalTexture,textureId??(name=>runtimeAdapter.textureId(name)))}];
  });
  if(normalMaterials.length>MAX_SPRITE_NORMAL_UPDATES)
    throw sceneCompositionDiagnosticError(`${path}.components.normalTexture`, `supports at most ${MAX_SPRITE_NORMAL_UPDATES} sprite normal materials`);
  if(normalMaterials.length&&(!runtimeAdapter.supportsSpriteNormalMaterials?.()||typeof engine.configureSpriteNormalMaterials!=="function"))
    throw sceneCompositionDiagnosticError(`${path}.components.normalTexture`,"sprite normal materials require native v1 support");
  preflightDataSceneGameplay(engine, resolved, bindingPlan, runtimeIds, path);
  const crowd = combatCrowdRequired(resolved.gameplay?.combatNavigation, bindingPlan.commands);
  const chaseCommands = combatChaseCommands(bindingPlan);
  const projectileActions = finalCombatActions(bindingPlan.commands, runtimeIds).filter(command => command.type === "configureProjectileAction");
  if (projectileActions.filter(command => command.projectilePrefab !== undefined).length > MAX_DATA_SCENE_PROJECTILE_BINDINGS) throw sceneCompositionDiagnosticError(`${path}.gameplay.projectilePrefabs`, "supports at most 8192 source/action bindings");
  const projectilePrefabs = resolved.gameplay?.projectilePrefabs === undefined ? undefined : resolveDataSceneProjectileTextures(resolved.gameplay.projectilePrefabs, textureId ?? (name => runtimeAdapter.textureId(name)));
  if (projectilePrefabs !== undefined) compileDataSceneProjectilePrefabs(projectilePrefabs, [], colorManagement);

  if (resolved.spatial) preflightDataSceneSpatialEnvironment(engine, resolved.spatial, bindingPlan.instances, options, resolved.spatial.environment);
  if(resolved.spatial?.models) {
    const origins=Object.fromEntries(bindingPlan.instances.map(i=>{
      const c=resolveDataSceneInstanceComponents(i,{allowTemplate:false,path:`${path}.spatial.models.${i.id}`});
      return [i.id,{x:i.x,y:i.y,elevation:c.mode==="inline" ? c.body?.heightSpan?.elevation ?? 0 : 0}];
    }));
    const derived=new Map<string,{x:number;y:number;elevation:number;yaw:number}>();
    const derive=(id:string):{x:number;y:number;elevation:number;yaw:number}=>{const existing=derived.get(id);if(existing)return existing;const a=resolved.spatial!.attachments?.[id],origin=origins[id];let pose={...origin,yaw:0};if(a){const p=derive(a.parent),s=Math.fround(Math.sin(p.yaw)),c=Math.fround(Math.cos(p.yaw));pose={x:Math.fround(p.x+Math.fround(c*Math.fround(a.x??0))-Math.fround(s*Math.fround(a.y??0))),y:Math.fround(p.y+Math.fround(s*Math.fround(a.x??0))+Math.fround(c*Math.fround(a.y??0))),elevation:Math.fround(p.elevation+Math.fround(a.elevation??0)),yaw:Math.fround(p.yaw+Math.fround((a.yawDegrees??0)*Math.PI/180))};}derived.set(id,pose);return pose;};
    for(const id of Object.keys(resolved.spatial.models))origins[id]=derive(id);
    if(!engine.preflightDataSceneSpatialModels(resolved.spatial,origins))
      throw sceneCompositionDiagnosticError(`${path}.spatial.models`,"model resource/content/transform or submission budget preflight failed");
  }
  preflightDataSceneVariableRuntime(engine, resolvedVariables, `${path}.variables`);
  const previousVariables = captureDataSceneVariableRuntimeSnapshot(engine);
  let preparation: SpatialModelPreparation | undefined;
  if (spatialModelPreparer !== undefined) {
    if (!spatialModelPreparer || typeof spatialModelPreparer.prepareSpatialModels !== "function")
      throw sceneCompositionDiagnosticError(`${path}.spatialModelPreparer`, "requires prepareSpatialModels");
    if (resolved.spatial && Object.keys(resolved.spatial.models ?? {}).length) {
      if (!runtimeAdapter.spatialModelAssets)
        throw sceneCompositionDiagnosticError(`${path}.spatialModelPreparer`, "runtime cannot resolve registered model assets");
      preparation = spatialModelPreparer.prepareSpatialModels(runtimeAdapter.spatialModelAssets(resolved.spatial));
      if (!preparation || typeof preparation.commit !== "function" || typeof preparation.dispose !== "function" ||
          !Number.isSafeInteger(preparation.uploadBytes) || preparation.uploadBytes < 0) {
        if (preparation && typeof preparation.dispose === "function") preparation.dispose();
        throw sceneCompositionDiagnosticError(`${path}.spatialModelPreparer`, "invalid model preparation lease");
      }
    }
  }
  try {
    forgetDataSceneProgressContext(engine);
    if (activateDataScene !== false) {
      runtimeAdapter.useDataScene();
    }
    const variables = synchronizeDataSceneVariableStore(
      engine,
      resolvedVariables,
      `${path}.variables`,
      runtimeVariableIds,
    );
    const target = createRuntimeTarget(engine, {
      path: `${path}.runtimeTarget`,
      activateDataScene: false,
      colorManagement,
      textureId,
      componentTemplates,
    }, true);
    // Full authoring consumes prefab references in one configuration batch after action storage.
    // Standalone gameplay command application rejects these references instead of silently ignoring them.
    const recipeEngine: Pick<FerrumEngine, "applyGameplayBehaviorCommands"> = {
      applyGameplayBehaviorCommands: (commands, handles, options) => engine.applyGameplayBehaviorCommands(commands.map(command => {
        if (resolved.gameplay?.combatNavigation && command.type === "configureChase") return { ...command, stopDistance: 0 };
        if (command.type !== "configureProjectileAction") return command;
        const { projectilePrefab: _prefab, ...runtimeCommand } = command;
        return runtimeCommand;
      }), handles, options),
    };
    const result = applySceneBehaviorRecipes(
      projectilePrefabs === undefined && !resolved.gameplay?.combatNavigation && !bindingPlan.commands.some(command => command.type === "configureProjectileAction" && command.projectilePrefab !== undefined) ? engine : recipeEngine,
      target,
      resolved.sceneComposition,
      resolved.behaviorRecipes,
      {
        ...bindingOptions,
        path,
        ids: runtimeIds,
        instanceHandleRegistry,
      },
    );
    if(normalMaterials.length&&!engine.configureSpriteNormalMaterials(normalMaterials.map(({id,normalTextureId})=>({entity:result.entityHandles[id],normalTextureId}))))
      throw sceneCompositionDiagnosticError(`${path}.components.normalTexture`,"runtime rejected sprite normal material batch");
    // Spawn definitions capture authored billboard styles; configure space before native v7.
    const spawnCatalog = resolved.gameplay?.spawnPrefabs;
    if (spawnCatalog !== undefined && runtimeSpatial !== undefined && !engine.configureDataSceneSpatial(runtimeSpatial, result.entityHandles)) throw sceneCompositionDiagnosticError(`${path}.spatial`, "runtime rejected spatial scene configuration");
    if (resolved.gameplay !== undefined && !engine.configureDataSceneGameplay({
      ...(spawnCatalog === undefined ? {} : { spawnPrefabs: Object.entries(spawnCatalog).map(([name, prefab]) => ({ prefabId: runtimeIds!.prefabs![name], prototype: result.entityHandles[prefab.prototypeInstanceId] })) }),
      ...(crowd ? { chaseBindings: chaseCommands.filter(command => command.entity !== resolved.gameplay?.primaryActor && (resolved.gameplay?.combatNavigation?.crowdAvoidance !== undefined || command.stopDistance > 0)).map(command => ({ source: result.entityHandles[command.entity], stopDistance: command.stopDistance })) } : {}),
      ...(resolved.gameplay.combatNavigation === undefined ? {} : { combatNavigation: resolved.gameplay.combatNavigation }),
      ...(projectilePrefabs === undefined ? {} : { projectilePrefabs, colorManagement, projectileBindings: projectileActions.filter(command => command.projectilePrefab !== undefined).map(command => ({ source: result.entityHandles[command.entity], actionId: command.actionId ?? runtimeIds!.actions![command.action], prefab: command.projectilePrefab! })) }),
      ...(resolved.gameplay.combat === undefined ? {} : { combat: resolved.gameplay.combat }),
      ...(resolved.gameplay.primaryActor === undefined ? {} : { primaryActor: result.entityHandles[resolved.gameplay.primaryActor] }),
      ...(resolved.gameplay.interactionInputActionId === undefined ? {} : { interactionInputActionId: resolved.gameplay.interactionInputActionId }),
    })) throw sceneCompositionDiagnosticError(`${path}.gameplay`, "runtime rejected Data Scene gameplay configuration");
    if (resolved.navigation !== undefined && !engine.configureDataSceneNavigation(resolved.navigation, result.entityHandles)) {
      throw sceneCompositionDiagnosticError(`${path}.navigation`, "runtime rejected Data Scene navigation configuration");
    }
    if (spawnCatalog === undefined && runtimeSpatial !== undefined && !engine.configureDataSceneSpatial(runtimeSpatial,result.entityHandles)) throw sceneCompositionDiagnosticError(`${path}.spatial`, "runtime rejected spatial scene configuration");
    preparation?.commit();
    rememberDataSceneProgressContext(engine, document, result.entityHandles, options);
    return {
      document: resolved,
      variables,
      ...result,
    };
  } catch (error) {
    restoreDataSceneVariableRuntimeSnapshot(
      engine,
      previousVariables,
      `${path}.variables`,
    );
    throw error;
  } finally {
    preparation?.dispose();
  }
}

function dataSceneRuntimeEngineAdapter(engine: FerrumEngine, path: string): DataSceneRuntimeEngineAdapter {
  const adapter = (engine as DataSceneRuntimeEngine)[DATA_SCENE_RUNTIME_ENGINE_ADAPTER];
  if (adapter === undefined) {
    throw sceneCompositionDiagnosticError(
      path,
      "must be a FerrumEngine created by createEngine() from @ferrum2d/ferrum-web",
    );
  }
  return adapter;
}

function dataSceneRuntimeSpawnRequest(
  instance: ResolvedSceneCompositionInstance,
  textureId: DataSceneRuntimeTextureIdResolver,
  componentTemplates: DataSceneRuntimeComponentTemplates | undefined,
  path: string,
  colorManagement: ColorManagementMode,
): DataSceneRuntimeSpawnRequest {
  const components = resolveDataSceneInstanceComponents(instance, {
    allowTemplate: true,
    path,
  });
  const inlineComponents = dataSceneRuntimeInlineComponents(components, componentTemplates, path);

  return inlineDataSceneRuntimeSpawnRequest(instance, inlineComponents, textureId, colorManagement);
}

function dataSceneRuntimeInlineComponents(
  components: ResolvedDataSceneComponents,
  componentTemplates: DataSceneRuntimeComponentTemplates | undefined,
  path: string,
): Extract<ResolvedDataSceneComponents, { mode: "inline" }> {
  if (components.mode === "inline") {
    return components;
  }
  const templatePath = `${path}.props.components.template`;
  if (componentTemplates === undefined) {
    throw sceneCompositionDiagnosticError(
      templatePath,
      "requires createDataSceneRuntimeTarget(..., { componentTemplates }) to spawn catalog templates",
    );
  }
  const spec = dataSceneRuntimeComponentTemplateSpec(componentTemplates, components.template);
  if (spec === undefined) {
    throw sceneCompositionDiagnosticError(
      templatePath,
      `must resolve to a component template catalog entry: ${components.template}`,
    );
  }
  const resolved = resolveDataSceneComponentsSpec(spec, {
    allowTemplate: false,
    path: `${templatePath}(${components.template})`,
  });
  if (resolved.mode === "template") {
    throw sceneCompositionDiagnosticError(
      templatePath,
      "must resolve to inline sprite, collider, and layer components",
    );
  }
  return resolved;
}

function dataSceneRuntimeComponentTemplateSpec(
  componentTemplates: DataSceneRuntimeComponentTemplates,
  template: string,
): DataSceneComponentsSpec | undefined {
  if (typeof componentTemplates === "function") {
    return componentTemplates(template);
  }
  if (!Object.prototype.hasOwnProperty.call(componentTemplates, template)) {
    return undefined;
  }
  return componentTemplates[template];
}

function inlineDataSceneRuntimeSpawnRequest(
  instance: ResolvedSceneCompositionInstance,
  components: Extract<ResolvedDataSceneComponents, { mode: "inline" }>,
  textureId: DataSceneRuntimeTextureIdResolver,
  colorManagement: ColorManagementMode,
): DataSceneRuntimeSpawnRequest {
  const scale = instance.scale;
  const sprite = components.sprite;
  const visual = components.visual;
  const spriteVisual = visual.kind === "sprite" ? visual : undefined;
  const groundShadow = visual.shadow === undefined ? undefined : resolveDataSceneGroundShadow({
    ...visual.shadow, width: visual.shadow.width * scale, height: visual.shadow.height * scale,
  }, visual.width * scale, visual.height * scale);
  const collider = components.collider;
  const colliderShape = colliderRuntimeShape(collider, scale, instance.rotationRadians);
  return {
    ...(components.body === undefined ? {} : { body: components.body }),
    x: instance.x,
    y: instance.y,
    rotationRadians: instance.rotationRadians,
    renderLayer: spriteVisual?.layer ?? instance.layer,
    originX: spriteVisual?.originX ?? 0.5,
    originY: spriteVisual?.originY ?? 0.5,
    sortOrder: spriteVisual?.sortOrder ?? 0,
    depthSort: spriteVisual?.depthSort === "hd2d",
    projectGround: visual.projection === "ground",
    ...(groundShadow === undefined ? {} : { groundShadow }),
    color: dataSceneVisualColor(spriteVisual?.tint ?? visual.color, "visual.color", colorManagement),
    textureId: dataSceneTextureId(sprite, textureId),
    ...(sprite.normalTexture===undefined?{}:{normalTextureId:normalTextureId(sprite.normalTexture,textureId)}),
    spriteWidth: sprite.width * scale,
    spriteHeight: sprite.height * scale,
    frameU0: sprite.frame.u0,
    frameV0: sprite.frame.v0,
    frameU1: sprite.frame.u1,
    frameV1: sprite.frame.v1,
    animationFrameCount: sprite.animation?.frameCount ?? 0,
    animationFps: sprite.animation?.fps ?? 0,
    ...(sprite.animationSet === undefined ? {} : { animationSet: sprite.animationSet }),
    layer: components.layer.code,
    colliderType: colliderShape.type,
    colliderOffsetX: colliderShape.offsetX,
    colliderOffsetY: colliderShape.offsetY,
    colliderEnabled: colliderShape.enabled,
    colliderIsTrigger: colliderShape.isTrigger,
    colliderHalfWidth: colliderShape.halfWidth,
    colliderHalfHeight: colliderShape.halfHeight,
    colliderRadius: colliderShape.radius,
    colliderStartX: colliderShape.startX,
    colliderStartY: colliderShape.startY,
    colliderEndX: colliderShape.endX,
    colliderEndY: colliderShape.endY,
    colliderRotationRadians: colliderShape.rotationRadians,
    colliderVertices: colliderShape.vertices,
  };
}

/** Internal cold preflight shared by authoring activation and prospective saved progress. */
export function preflightDataSceneSpatialEnvironment(
  engine: FerrumEngine,
  spec: DataSceneSpatialSpec,
  instances: readonly ResolvedSceneCompositionInstance[],
  options: CreateDataSceneRuntimeTargetOptions,
  environment: SpatialEnvironmentSpec | null | undefined,
  removed: ReadonlySet<string> = new Set(),
  camera: SpatialCameraSpec = spec.camera,
  spawnedPrototypeIds: readonly string[] = [],
): void {
  if (!environment) return;
  const environmentPath = `${options.path ?? "dataScene"}.spatial.environment`;
  const adapter = dataSceneRuntimeEngineAdapter(engine, `${environmentPath}.engine`);
  if (adapter.preflightSpatialEnvironment) {
    if (!adapter.preflightSpatialEnvironment(camera, environment))
      throw sceneCompositionDiagnosticError(environmentPath, "native camera/environment preflight rejected configuration");
  } else if (environment.pixelArt || environment.lighting?.directional) {
    throw sceneCompositionDiagnosticError(environmentPath, "native camera/environment preflight is unavailable");
  }
  if (!environment.lighting?.shadows && !environment.lighting?.directional?.shadows) return;
  const path = `${environmentPath}.lighting.shadows`;
  if (Object.keys(spec.billboards).length > 1024) {
    throw sceneCompositionDiagnosticError(path, "shadow caster budget exceeds 1024 authored billboards");
  }
  let previous = -1, batches = 0;
  for (const surface of spec.terrain) {
    if (surface.castShadow === false) { previous = -1; continue; }
    const texture = surface.textureId ?? 16777215;
    if (texture !== previous) batches++;
    previous = texture;
  }
  const byId = new Map(instances.map(instance => [instance.id, instance]));
  const textureId = options.textureId ?? ((name: string) => adapter.textureId(name));
  const textures = new Set<number>();
  let casters = 0;
  const casting = [...Object.keys(spec.billboards).filter(id => !removed.has(id)), ...spawnedPrototypeIds];
  for (const id of casting) {
    if (!spec.billboards[id] || spec.billboards[id].castShadow === false) continue;
    if (++casters > 1024) throw sceneCompositionDiagnosticError(path, "shadow caster budget exceeds 1024 authored and spawned billboards");
    const instance = byId.get(id);
    if (!instance) throw sceneCompositionDiagnosticError(path, `unknown billboard '${id}'`);
    const components = resolveDataSceneInstanceComponents(instance, { allowTemplate: false, path });
    if (components.mode !== "inline") throw sceneCompositionDiagnosticError(path, "requires inline billboard components");
    textures.add(dataSceneTextureId(components.sprite, textureId));
  }
  if (batches + textures.size > 64) {
    throw sceneCompositionDiagnosticError(path, "shadow texture batch budget exceeds 64 per shadow face");
  }
}

function normalTextureId(ref:ResolvedDataSceneSpriteComponent["texture"],resolve:DataSceneRuntimeTextureIdResolver):number {
  const id=ref.kind==="id"?(ref.id??Number(ref.value)):resolve(ref.name??String(ref.value));
  if(!Number.isInteger(id)||id<0||id>=16777215)throw sceneCompositionDiagnosticError("components.normalTexture","must resolve to a registered texture ID below 16777215");
  return id;
}

function dataSceneTextureId(
  sprite: ResolvedDataSceneSpriteComponent,
  textureId: DataSceneRuntimeTextureIdResolver,
): number {
  if (sprite.texture.kind === "id") {
    return sprite.texture.id ?? Number(sprite.texture.value);
  }
  return textureId(sprite.texture.name ?? String(sprite.texture.value));
}

interface RuntimeColliderShape {
  type: number;
  offsetX: number;
  offsetY: number;
  enabled: boolean;
  isTrigger: boolean;
  halfWidth: number;
  halfHeight: number;
  radius: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  rotationRadians: number;
  vertices: Float32Array;
}

function colliderRuntimeShape(
  collider: ResolvedDataSceneColliderComponent,
  scale: number,
  rotationRadians: number,
): RuntimeColliderShape {
  const base = colliderBase(collider, scale, rotationRadians);
  switch (collider.type) {
    case "none":
      return base;
    case "aabb":
      if (rotationRadians !== 0) {
        return {
          ...base,
          type: DATA_SCENE_COLLIDER_TYPE_ORIENTED_BOX,
          halfWidth: scaleNumber(collider.halfWidth, scale),
          halfHeight: scaleNumber(collider.halfHeight, scale),
          rotationRadians,
        };
      }
      return {
        ...base,
        type: DATA_SCENE_COLLIDER_TYPE_AABB,
        halfWidth: scaleNumber(collider.halfWidth, scale),
        halfHeight: scaleNumber(collider.halfHeight, scale),
      };
    case "circle":
      return {
        ...base,
        type: DATA_SCENE_COLLIDER_TYPE_CIRCLE,
        radius: scaleNumber(collider.radius, scale),
      };
    case "capsule": {
      const start = transformLocalPoint(collider.startX, collider.startY, scale, rotationRadians);
      const end = transformLocalPoint(collider.endX, collider.endY, scale, rotationRadians);
      return {
        ...base,
        type: DATA_SCENE_COLLIDER_TYPE_CAPSULE,
        radius: scaleNumber(collider.radius, scale),
        startX: start.x,
        startY: start.y,
        endX: end.x,
        endY: end.y,
      };
    }
    case "orientedBox":
      return {
        ...base,
        type: DATA_SCENE_COLLIDER_TYPE_ORIENTED_BOX,
        halfWidth: scaleNumber(collider.halfWidth, scale),
        halfHeight: scaleNumber(collider.halfHeight, scale),
        rotationRadians: collider.rotationRadians + rotationRadians,
      };
    case "convexPolygon":
      return {
        ...base,
        type: DATA_SCENE_COLLIDER_TYPE_CONVEX_POLYGON,
        rotationRadians: collider.rotationRadians + rotationRadians,
        vertices: new Float32Array(collider.vertices.flatMap((vertex) => [
          scaleNumber(vertex.x, scale),
          scaleNumber(vertex.y, scale),
        ])),
      };
  }
  const _exhaustive: never = collider;
  return _exhaustive;
}

function colliderBase(
  collider: ResolvedDataSceneColliderComponent,
  scale: number,
  rotationRadians: number,
): RuntimeColliderShape {
  if (collider.type === "none") {
    return {
      type: DATA_SCENE_COLLIDER_TYPE_NONE,
      offsetX: 0,
      offsetY: 0,
      enabled: false,
      isTrigger: true,
      halfWidth: 0,
      halfHeight: 0,
      radius: 0,
      startX: 0,
      startY: 0,
      endX: 0,
      endY: 0,
      rotationRadians: 0,
      vertices: new Float32Array(),
    };
  }
  const offset = transformLocalPoint(collider.offsetX, collider.offsetY, scale, rotationRadians);
  return {
    type: DATA_SCENE_COLLIDER_TYPE_NONE,
    offsetX: offset.x,
    offsetY: offset.y,
    enabled: collider.enabled,
    isTrigger: collider.isTrigger,
    halfWidth: 0,
    halfHeight: 0,
    radius: 0,
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    rotationRadians: 0,
    vertices: new Float32Array(),
  };
}

function transformLocalPoint(
  x: number,
  y: number,
  scale: number,
  rotationRadians: number,
): { x: number; y: number } {
  const scaledX = scaleNumber(x, scale);
  const scaledY = scaleNumber(y, scale);
  if (rotationRadians === 0) {
    return { x: scaledX, y: scaledY };
  }
  const cos = Math.cos(rotationRadians);
  const sin = Math.sin(rotationRadians);
  return {
    x: scaledX * cos - scaledY * sin,
    y: scaledX * sin + scaledY * cos,
  };
}

function scaleNumber(value: number, scale: number): number {
  return value * scale;
}
import { finalCombatActions } from "./dataSceneCombatActions.js";
