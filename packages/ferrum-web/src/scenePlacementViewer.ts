import { gameplayAuthoringDiagnosticError } from "./diagnostics.js";
import {
  DATA_SCENE_COMPONENTS_PROP,
  dataSceneObjectVisualBounds,
  resolveDataSceneComponentsSpec,
  resolveDataSceneInstanceComponents,
  type ResolvedDataSceneColliderComponent,
  type ResolvedDataSceneCollisionLayer,
  type ResolvedDataSceneComponents,
  type ResolvedDataSceneObjectVisual,
} from "./dataSceneComponents.js";
import {
  GAMEPLAY_BEHAVIOR_BINDING_PROP,
  classifySceneInstance,
  type GameplayEntityHandle,
  type GameplayBehaviorBindingSpec,
  type SceneInstanceAuthoringKind,
  type SceneInstanceHandleRegistry,
} from "./gameplayAuthoring.js";
import {
  createScenePlacementViewport,
  screenToSceneWorld,
  type ScenePlacementPoint,
  type ScenePlacementViewport,
  type ScenePlacementViewportOptions,
} from "./scenePlacementViewport.js";
import { resolveSceneAuthoringDocument, type SceneAuthoringDocumentSpec } from "./sceneAuthoringDocument.js";
import {
  instantiateSceneFragment,
  resolveSceneCompositionSpec,
  type InstantiateSceneFragmentOptions,
} from "./sceneComposition.js";
import type { ResolvedSceneAuthoringDocument } from "./sceneAuthoringDocument.js";
import type {
  ResolvedSceneCompositionInstance,
  ResolvedSceneCompositionSpec,
  ResolvedSceneCompositionPrefab,
  SceneCompositionFragmentInstanceSpec,
  SceneCompositionJsonValue,
  SceneCompositionPrefabSpec,
  SceneCompositionPrefabVariantSpec,
  SceneCompositionProps,
  SceneCompositionSpec,
} from "./sceneComposition.js";

export const SCENE_PLACEMENT_PATCH_FORMAT = "ferrum2d.scene-placement.patch" as const;
export const SCENE_PLACEMENT_PATCH_VERSION = 1 as const;

export type ScenePlacementViewerDocument =
  | SceneAuthoringDocumentSpec
  | ResolvedSceneAuthoringDocument;

export type ScenePlacementViewerComposition =
  | SceneCompositionSpec
  | ResolvedSceneCompositionSpec;

export interface CreateScenePlacementViewerOptions extends InstantiateSceneFragmentOptions {
  document?: ScenePlacementViewerDocument;
  sceneComposition?: ScenePlacementViewerComposition;
  viewport: ScenePlacementViewport | ScenePlacementViewportOptions;
  instanceHandleRegistry?: SceneInstanceHandleRegistry;
  validateLiveHandles?: boolean;
  behaviorProp?: string;
  selectedInstanceId?: string;
  hoveredInstanceId?: string;
  pointerScreen?: ScenePlacementPoint;
}

export interface ScenePlacementTransform {
  x: number;
  y: number;
  rotationRadians: number;
  scale: number;
  layer: number;
}

export interface ScenePlacementViewerInstance {
  instanceId: string;
  sourceId: string;
  prefab: string;
  variant?: string;
  role: SceneInstanceAuthoringKind;
  hasDataSceneComponents: boolean;
  visual?: ResolvedDataSceneObjectVisual;
  collider?: ResolvedDataSceneColliderComponent;
  componentLayer?: ResolvedDataSceneCollisionLayer;
  behaviorProfiles: readonly string[];
  entity?: GameplayEntityHandle;
  transform: ScenePlacementTransform;
}

export interface ScenePlacementObjectDefinitionSummary {
  id: string;
  variants: readonly string[];
  hasDataSceneComponents: boolean;
  visual?: ResolvedDataSceneObjectVisual;
  collider?: ResolvedDataSceneColliderComponent;
  componentLayer?: ResolvedDataSceneCollisionLayer;
  behaviorProfiles: readonly string[];
}

export interface ScenePlacementViewerState {
  fragment: string;
  viewport: ScenePlacementViewport;
  objectDefinitions: readonly ScenePlacementObjectDefinitionSummary[];
  instances: readonly ScenePlacementViewerInstance[];
  selectedInstanceId?: string;
  hoveredInstanceId?: string;
  pointerWorld?: ScenePlacementPoint;
  selected?: ScenePlacementViewerInstance;
  draftPatch?: ScenePlacementPatch;
}

export type ScenePlacementPatchOperation =
  | ScenePlacementUpdateTransformOperation
  | ScenePlacementUpdateComponentsOperation
  | ScenePlacementUpdateBehaviorBindingOperation
  | ScenePlacementRenameInstanceOperation
  | ScenePlacementAddObjectDefinitionOperation
  | ScenePlacementAddInstanceOperation
  | ScenePlacementRemoveInstanceOperation;

export interface ScenePlacementUpdateTransformOperation {
  kind: "updateTransform";
  instanceId: string;
  transform: Partial<ScenePlacementTransform>;
}

export interface ScenePlacementUpdateComponentsOperation {
  kind: "updateComponents";
  instanceId: string;
  components: SceneCompositionJsonValue;
}

export type ScenePlacementBehaviorBindingPatch = GameplayBehaviorBindingSpec | null;

export type ScenePlacementBehaviorBindingTarget =
  | { kind: "instance"; instanceId: string }
  | { kind: "objectDefinition"; id: string };

export interface ScenePlacementUpdateBehaviorBindingOperation {
  kind: "updateBehaviorBinding";
  target: ScenePlacementBehaviorBindingTarget;
  behaviorRecipes: ScenePlacementBehaviorBindingPatch;
}

export interface ScenePlacementRenameInstanceOperation {
  kind: "renameInstance";
  instanceId: string;
  nextInstanceId: string;
}

export interface ScenePlacementAddObjectDefinitionOperation {
  kind: "addObjectDefinition";
  id: string;
  definition: SceneCompositionPrefabSpec;
}

export interface ScenePlacementAddInstanceOperation {
  kind: "addInstance";
  fragment: string;
  instance: SceneCompositionFragmentInstanceSpec;
}

export interface ScenePlacementRemoveInstanceOperation {
  kind: "removeInstance";
  instanceId: string;
}

export interface ScenePlacementPatch {
  format: typeof SCENE_PLACEMENT_PATCH_FORMAT;
  version: typeof SCENE_PLACEMENT_PATCH_VERSION;
  operations: readonly ScenePlacementPatchOperation[];
}

export interface CreateScenePlacementPatchStoreOptions {
  patch?: ScenePlacementPatch;
}

export interface ScenePlacementPatchStoreState {
  dirty: boolean;
  operationCount: number;
  patch?: ScenePlacementPatch;
}

export interface ScenePlacementPatchStore {
  state(): ScenePlacementPatchStoreState;
  replacePatch(patch?: ScenePlacementPatch): ScenePlacementPatchStoreState;
  exportPatch(): ScenePlacementPatch | undefined;
  clear(): ScenePlacementPatchStoreState;
}

export interface ScenePlacementViewer {
  state(): ScenePlacementViewerState;
  selectInstance(instanceId?: string): ScenePlacementViewerState;
  selectInstanceAtScreen(point: ScenePlacementPoint): ScenePlacementViewerState;
  hoverInstance(instanceId?: string): ScenePlacementViewerState;
  hoverInstanceAtScreen(point?: ScenePlacementPoint): ScenePlacementViewerState;
  pointerAtScreen(point?: ScenePlacementPoint): ScenePlacementViewerState;
  pickInstanceAtScreen(point: ScenePlacementPoint): ScenePlacementViewerInstance | undefined;
  updateInstanceTransform(
    instanceId: string,
    transform: Partial<ScenePlacementTransform>,
  ): ScenePlacementViewerState;
  updateInstanceComponents(
    instanceId: string,
    components: SceneCompositionJsonValue,
  ): ScenePlacementViewerState;
  updateBehaviorBinding(
    target: ScenePlacementBehaviorBindingTarget,
    behaviorRecipes: ScenePlacementBehaviorBindingPatch,
  ): ScenePlacementViewerState;
  renameInstance(instanceId: string, nextInstanceId: string): ScenePlacementViewerState;
  addObjectDefinition(id: string, definition: SceneCompositionPrefabSpec): ScenePlacementViewerState;
  addInstance(fragment: string, instance: SceneCompositionFragmentInstanceSpec): ScenePlacementViewerState;
  removeInstance(instanceId: string): ScenePlacementViewerState;
  clearDraftPatch(): ScenePlacementViewerState;
  updateViewport(viewport: ScenePlacementViewport | ScenePlacementViewportOptions): ScenePlacementViewerState;
  exportPatch(): ScenePlacementPatch | undefined;
}

export function createScenePlacementViewer(
  options: CreateScenePlacementViewerOptions,
): ScenePlacementViewer {
  return new ScenePlacementViewerController(options);
}

export function createScenePlacementPatchStore(
  options: CreateScenePlacementPatchStoreOptions = {},
): ScenePlacementPatchStore {
  return new ScenePlacementPatchStoreController(options);
}

class ScenePlacementViewerController implements ScenePlacementViewer {
  private readonly path: string;
  private readonly fragment: string;
  private readonly composition: ResolvedSceneCompositionSpec;
  private readonly sourceInstances: readonly ResolvedSceneCompositionInstance[];
  private readonly instancesById = new Map<string, ResolvedSceneCompositionInstance>();
  private readonly draftTransforms = new Map<string, ScenePlacementTransform>();
  private readonly draftComponents = new Map<string, SceneCompositionJsonValue>();
  private readonly draftInstanceBehaviorBindings = new Map<string, ScenePlacementBehaviorBindingPatch>();
  private readonly draftObjectDefinitionBehaviorBindings = new Map<string, ScenePlacementBehaviorBindingPatch>();
  private readonly draftRenames = new Map<string, string>();
  private readonly draftRemovedInstanceIds = new Set<string>();
  private readonly draftObjectDefinitions = new Map<string, SceneCompositionPrefabSpec>();
  private readonly draftAddedInstances: ScenePlacementDraftAddedInstance[] = [];
  private readonly instanceHandleRegistry?: SceneInstanceHandleRegistry;
  private readonly validateLiveHandles: boolean;
  private readonly behaviorProp?: string;
  private pickBounds: readonly ScenePlacementPickBounds[];
  private viewport: ScenePlacementViewport;
  private selectedInstanceId?: string;
  private hoveredInstanceId?: string;
  private pointerWorld?: ScenePlacementPoint;

  constructor(options: CreateScenePlacementViewerOptions) {
    const path = options.path ?? "scenePlacementViewer";
    this.path = path;
    const composition = viewerComposition(options, path);
    this.composition = composition;
    this.fragment = options.fragment ?? composition.initialFragment;
    this.sourceInstances = instantiateSceneFragment(composition, {
      ...options,
      fragment: this.fragment,
      path: `${path}.sceneComposition`,
    });
    for (const instance of this.sourceInstances) {
      this.instancesById.set(instance.id, instance);
    }
    this.pickBounds = this.createPickBounds(path);
    this.instanceHandleRegistry = options.instanceHandleRegistry;
    this.validateLiveHandles = options.validateLiveHandles ?? false;
    this.behaviorProp = options.behaviorProp;
    this.viewport = scenePlacementViewport(options.viewport, `${path}.viewport`);
    this.selectedInstanceId = this.optionalKnownInstanceId(
      options.selectedInstanceId,
      `${path}.selectedInstanceId`,
    );
    this.hoveredInstanceId = this.optionalKnownInstanceId(
      options.hoveredInstanceId,
      `${path}.hoveredInstanceId`,
    );
    if (options.pointerScreen !== undefined) {
      this.pointerWorld = screenToSceneWorld(this.viewport, options.pointerScreen);
    }
  }

  state(): ScenePlacementViewerState {
    const instances = this.visibleInstanceRefs().map((ref) => this.viewerInstance(ref));
    const selected = this.selectedInstanceId === undefined
      ? undefined
      : instances.find((instance) => instance.instanceId === this.selectedInstanceId);
    const draftPatch = this.exportPatch();
    return {
      fragment: this.fragment,
      viewport: { ...this.viewport },
      objectDefinitions: this.objectDefinitions(),
      instances,
      ...(this.selectedInstanceId === undefined ? {} : { selectedInstanceId: this.selectedInstanceId }),
      ...(this.hoveredInstanceId === undefined ? {} : { hoveredInstanceId: this.hoveredInstanceId }),
      ...(this.pointerWorld === undefined ? {} : { pointerWorld: { ...this.pointerWorld } }),
      ...(selected === undefined ? {} : { selected }),
      ...(draftPatch === undefined ? {} : { draftPatch }),
    };
  }

  selectInstance(instanceId?: string): ScenePlacementViewerState {
    this.selectedInstanceId = this.optionalKnownInstanceId(instanceId, "scenePlacementViewer.selectedInstanceId");
    return this.state();
  }

  selectInstanceAtScreen(point: ScenePlacementPoint): ScenePlacementViewerState {
    this.pointerWorld = screenToSceneWorld(this.viewport, point);
    this.selectedInstanceId = this.pickInstanceIdAtWorld(this.pointerWorld);
    return this.state();
  }

  hoverInstance(instanceId?: string): ScenePlacementViewerState {
    this.hoveredInstanceId = this.optionalKnownInstanceId(instanceId, "scenePlacementViewer.hoveredInstanceId");
    return this.state();
  }

  hoverInstanceAtScreen(point?: ScenePlacementPoint): ScenePlacementViewerState {
    if (point === undefined) {
      this.pointerWorld = undefined;
      this.hoveredInstanceId = undefined;
      return this.state();
    }
    this.pointerWorld = screenToSceneWorld(this.viewport, point);
    this.hoveredInstanceId = this.pickInstanceIdAtWorld(this.pointerWorld);
    return this.state();
  }

  pointerAtScreen(point?: ScenePlacementPoint): ScenePlacementViewerState {
    this.pointerWorld = point === undefined ? undefined : screenToSceneWorld(this.viewport, point);
    return this.state();
  }

  pickInstanceAtScreen(point: ScenePlacementPoint): ScenePlacementViewerInstance | undefined {
    const instanceId = this.pickInstanceIdAtWorld(screenToSceneWorld(this.viewport, point));
    const ref = instanceId === undefined ? undefined : this.instanceRefForId(instanceId);
    return ref === undefined ? undefined : this.viewerInstance(ref);
  }

  updateInstanceTransform(
    instanceId: string,
    transform: Partial<ScenePlacementTransform>,
  ): ScenePlacementViewerState {
    const ref = this.knownInstanceRef(instanceId, "scenePlacementViewer.updateInstanceTransform.instanceId");
    const patch = validatedTransformPatch(transform, "scenePlacementViewer.updateInstanceTransform.transform");
    if (ref.kind === "added") {
      ref.draft.instance = {
        ...ref.draft.instance,
        ...patch,
      };
    } else {
      const base = sourceTransform(ref.instance);
      const previous = this.draftTransforms.get(ref.instance.id) ?? base;
      const next = { ...previous, ...patch };
      if (sameTransform(base, next)) {
        this.draftTransforms.delete(ref.instance.id);
      } else {
        this.draftTransforms.set(ref.instance.id, next);
      }
    }
    this.pickBounds = this.createPickBounds(this.path);
    return this.state();
  }

  updateInstanceComponents(
    instanceId: string,
    components: SceneCompositionJsonValue,
  ): ScenePlacementViewerState {
    const ref = this.knownInstanceRef(instanceId, "scenePlacementViewer.updateInstanceComponents.instanceId");
    const patch = validatedComponentsPatch(components, "scenePlacementViewer.updateInstanceComponents.components");
    if (ref.kind === "added") {
      ref.draft.instance = {
        ...ref.draft.instance,
        props: {
          ...(ref.draft.instance.props ?? {}),
          [DATA_SCENE_COMPONENTS_PROP]: patch,
        },
      };
    } else if (sameSceneCompositionJsonValue(ref.instance.props[DATA_SCENE_COMPONENTS_PROP], patch)) {
      this.draftComponents.delete(ref.instance.id);
    } else {
      this.draftComponents.set(ref.instance.id, patch);
    }
    this.pickBounds = this.createPickBounds(this.path);
    return this.state();
  }

  updateBehaviorBinding(
    target: ScenePlacementBehaviorBindingTarget,
    behaviorRecipes: ScenePlacementBehaviorBindingPatch,
  ): ScenePlacementViewerState {
    const patch = validatedBehaviorBindingPatch(
      behaviorRecipes,
      "scenePlacementViewer.updateBehaviorBinding.behaviorRecipes",
    );
    const behaviorProp = this.behaviorBindingProp();
    if (target.kind === "instance") {
      const ref = this.knownInstanceRef(target.instanceId, "scenePlacementViewer.updateBehaviorBinding.target.instanceId");
      if (ref.kind === "added") {
        ref.draft.instance = instanceWithBehaviorBinding(
          ref.draft.instance,
          patch,
          behaviorProp,
        );
      } else if (sameBehaviorBindingPatch(ref.instance.props[behaviorProp], patch)) {
        this.draftInstanceBehaviorBindings.delete(ref.instance.id);
      } else {
        this.draftInstanceBehaviorBindings.set(ref.instance.id, patch);
      }
      this.pickBounds = this.createPickBounds(this.path);
      return this.state();
    }

    const id = requiredPlacementInstanceId(target.id, "scenePlacementViewer.updateBehaviorBinding.target.id");
    const draftDefinition = this.draftObjectDefinitions.get(id);
    if (draftDefinition !== undefined) {
      this.draftObjectDefinitions.set(id, objectDefinitionWithBehaviorBinding(draftDefinition, patch, behaviorProp));
      return this.state();
    }
    const prefab = this.composition.prefabs[id];
    if (prefab === undefined) {
      throw gameplayAuthoringDiagnosticError(
        "scenePlacementViewer.updateBehaviorBinding.target.id",
        `references unknown object definition '${id}'`,
      );
    }
    if (sameBehaviorBindingPatch(prefab.props[behaviorProp], patch)) {
      this.draftObjectDefinitionBehaviorBindings.delete(id);
    } else {
      this.draftObjectDefinitionBehaviorBindings.set(id, patch);
    }
    this.pickBounds = this.createPickBounds(this.path);
    return this.state();
  }

  renameInstance(instanceId: string, nextInstanceId: string): ScenePlacementViewerState {
    const ref = this.knownInstanceRef(instanceId, "scenePlacementViewer.renameInstance.instanceId");
    const next = requiredPlacementInstanceId(nextInstanceId, "scenePlacementViewer.renameInstance.nextInstanceId");
    if (this.instanceRefForId(next, ref) !== undefined) {
      throw gameplayAuthoringDiagnosticError(
        "scenePlacementViewer.renameInstance.nextInstanceId",
        `scene instance '${next}' already exists`,
      );
    }
    if (ref.kind === "added") {
      ref.draft.instance = {
        ...ref.draft.instance,
        id: next,
      };
    } else if (next === ref.instance.id) {
      this.draftRenames.delete(ref.instance.id);
    } else {
      this.draftRenames.set(ref.instance.id, next);
    }
    this.retargetSelectedAndHovered(instanceId, next);
    this.pickBounds = this.createPickBounds(this.path);
    return this.state();
  }

  addInstance(fragment: string, instance: SceneCompositionFragmentInstanceSpec): ScenePlacementViewerState {
    const checkedFragment = requiredPlacementInstanceId(fragment, "scenePlacementViewer.addInstance.fragment");
    if (checkedFragment !== this.fragment) {
      throw gameplayAuthoringDiagnosticError(
        "scenePlacementViewer.addInstance.fragment",
        `fragment '${checkedFragment}' is not visible in this viewer`,
      );
    }
    if (this.composition.fragments[checkedFragment] === undefined) {
      throw gameplayAuthoringDiagnosticError(
        "scenePlacementViewer.addInstance.fragment",
        `references unknown fragment '${checkedFragment}'`,
      );
    }
    const checkedInstance = copySceneCompositionFragmentInstance(instance);
    const instanceId = requiredPlacementInstanceId(checkedInstance.id, "scenePlacementViewer.addInstance.instance.id");
    validateDraftInstancePrefab(
      (prefabId) => this.prefabForId(prefabId),
      checkedInstance,
      "scenePlacementViewer.addInstance.instance",
    );
    if (this.instanceRefForId(instanceId) !== undefined) {
      throw gameplayAuthoringDiagnosticError(
        "scenePlacementViewer.addInstance.instance.id",
        `scene instance '${instanceId}' already exists`,
      );
    }
    this.draftAddedInstances.push({
      fragment: checkedFragment,
      instance: checkedInstance,
    });
    this.selectedInstanceId = instanceId;
    this.pickBounds = this.createPickBounds(this.path);
    return this.state();
  }

  addObjectDefinition(id: string, definition: SceneCompositionPrefabSpec): ScenePlacementViewerState {
    const checkedId = requiredPlacementInstanceId(id, "scenePlacementViewer.addObjectDefinition.id");
    if (this.prefabForId(checkedId) !== undefined || this.draftObjectDefinitions.has(checkedId)) {
      throw gameplayAuthoringDiagnosticError(
        "scenePlacementViewer.addObjectDefinition.id",
        `object definition '${checkedId}' already exists`,
      );
    }
    this.draftObjectDefinitions.set(
      checkedId,
      validatedObjectDefinitionPatch(definition, "scenePlacementViewer.addObjectDefinition.definition"),
    );
    return this.state();
  }

  removeInstance(instanceId: string): ScenePlacementViewerState {
    const ref = this.knownInstanceRef(instanceId, "scenePlacementViewer.removeInstance.instanceId");
    if (ref.kind === "added") {
      this.draftAddedInstances.splice(ref.index, 1);
    } else {
      this.draftRemovedInstanceIds.add(ref.instance.id);
      this.draftTransforms.delete(ref.instance.id);
      this.draftComponents.delete(ref.instance.id);
      this.draftInstanceBehaviorBindings.delete(ref.instance.id);
      this.draftRenames.delete(ref.instance.id);
    }
    this.clearSelectedAndHovered(instanceId);
    this.pickBounds = this.createPickBounds(this.path);
    return this.state();
  }

  clearDraftPatch(): ScenePlacementViewerState {
    this.draftTransforms.clear();
    this.draftComponents.clear();
    this.draftInstanceBehaviorBindings.clear();
    this.draftObjectDefinitionBehaviorBindings.clear();
    this.draftRenames.clear();
    this.draftRemovedInstanceIds.clear();
    this.draftObjectDefinitions.clear();
    this.draftAddedInstances.splice(0);
    this.selectedInstanceId = this.retainedKnownInstanceId(this.selectedInstanceId);
    this.hoveredInstanceId = this.retainedKnownInstanceId(this.hoveredInstanceId);
    this.pickBounds = this.createPickBounds(this.path);
    return this.state();
  }

  updateViewport(viewport: ScenePlacementViewport | ScenePlacementViewportOptions): ScenePlacementViewerState {
    this.viewport = scenePlacementViewport(viewport, "scenePlacementViewer.viewport");
    return this.state();
  }

  exportPatch(): ScenePlacementPatch | undefined {
    const operations: ScenePlacementPatchOperation[] = [];
    for (const instance of this.sourceInstances) {
      if (this.draftRemovedInstanceIds.has(instance.id)) {
        operations.push({
          kind: "removeInstance",
          instanceId: instance.id,
        });
        continue;
      }
      const currentId = this.currentInstanceId(instance.id);
      if (currentId !== instance.id) {
        operations.push({
          kind: "renameInstance",
          instanceId: instance.id,
          nextInstanceId: currentId,
        });
      }
      const draft = this.draftTransforms.get(instance.id);
      if (draft !== undefined) {
        const transform = transformDiff(sourceTransform(instance), draft);
        if (hasTransformPatch(transform)) {
          operations.push({
            kind: "updateTransform",
            instanceId: currentId,
            transform,
          });
        }
      }
      const components = this.draftComponents.get(instance.id);
      if (components !== undefined) {
        operations.push({
          kind: "updateComponents",
          instanceId: currentId,
          components: copySceneCompositionJsonValue(components),
        });
      }
      if (this.draftInstanceBehaviorBindings.has(instance.id)) {
        operations.push({
          kind: "updateBehaviorBinding",
          target: {
            kind: "instance",
            instanceId: currentId,
          },
          behaviorRecipes: copyBehaviorBindingPatch(
            this.draftInstanceBehaviorBindings.get(instance.id) as ScenePlacementBehaviorBindingPatch,
          ),
        });
      }
    }
    for (const [id, behaviorRecipes] of this.draftObjectDefinitionBehaviorBindings) {
      operations.push({
        kind: "updateBehaviorBinding",
        target: {
          kind: "objectDefinition",
          id,
        },
        behaviorRecipes: copyBehaviorBindingPatch(behaviorRecipes),
      });
    }
    for (const [id, definition] of this.draftObjectDefinitions) {
      const behaviorRecipes = behaviorBindingPatchFromProps(definition.props, this.behaviorBindingProp());
      operations.push({
        kind: "addObjectDefinition",
        id,
        definition: copyObjectDefinitionWithoutBehaviorBinding(definition, this.behaviorBindingProp()),
      });
      if (behaviorRecipes !== undefined) {
        operations.push({
          kind: "updateBehaviorBinding",
          target: {
            kind: "objectDefinition",
            id,
          },
          behaviorRecipes,
        });
      }
    }
    for (const draft of this.draftAddedInstances) {
      const behaviorRecipes = behaviorBindingPatchFromProps(draft.instance.props, this.behaviorBindingProp());
      operations.push({
        kind: "addInstance",
        fragment: draft.fragment,
        instance: copyInstanceWithoutBehaviorBinding(draft.instance, this.behaviorBindingProp()),
      });
      if (behaviorRecipes !== undefined) {
        operations.push({
          kind: "updateBehaviorBinding",
          target: {
            kind: "instance",
            instanceId: requiredPlacementInstanceId(draft.instance.id, "scenePlacementViewer.draftAddedInstances.id"),
          },
          behaviorRecipes,
        });
      }
    }
    if (operations.length === 0) {
      return undefined;
    }
    return {
      format: SCENE_PLACEMENT_PATCH_FORMAT,
      version: SCENE_PLACEMENT_PATCH_VERSION,
      operations,
    };
  }

  private viewerInstance(ref: ScenePlacementInstanceRef): ScenePlacementViewerInstance {
    const instance = this.resolvedInstanceForRef(ref);
    const classification = classifySceneInstance(instance, {
      behaviorProp: this.behaviorProp,
      path: `scenePlacementViewer.instances.${instance.id}`,
    });
    const entityInstanceId = ref.kind === "source" ? ref.instance.id : instance.id;
    const entity = this.instanceHandleRegistry?.get(entityInstanceId, {
      validateLive: this.validateLiveHandles,
      path: `scenePlacementViewer.instances.${instance.id}.entity`,
    });
    const transform = this.transformFor(instance);
    const components = this.inlineComponentsForInstance(
      instance,
      `scenePlacementViewer.instances.${instance.id}`,
    );
    return {
      instanceId: instance.id,
      sourceId: instance.sourceId,
      prefab: instance.prefab,
      ...(instance.variant === undefined ? {} : { variant: instance.variant }),
      role: classification.kind,
      hasDataSceneComponents: classification.hasDataSceneComponents,
      ...(components === undefined ? {} : {
        visual: copyResolvedDataSceneObjectVisual(components.visual),
        collider: copyResolvedDataSceneCollider(components.collider),
        componentLayer: { ...components.layer },
      }),
      behaviorProfiles: [...classification.behaviorProfiles],
      ...(entity === undefined ? {} : { entity: copyGameplayEntityHandle(entity) }),
      transform: {
        x: transform.x,
        y: transform.y,
        rotationRadians: transform.rotationRadians,
        scale: transform.scale,
        layer: transform.layer,
      },
    };
  }

  private objectDefinitions(): readonly ScenePlacementObjectDefinitionSummary[] {
    const prefabs = [
      ...Object.values(this.composition.prefabs).map((prefab) =>
        prefabWithBehaviorBindingDraft(
          prefab,
          this.draftObjectDefinitionBehaviorBindings.get(prefab.id),
          this.behaviorBindingProp(),
        )),
      ...Array.from(this.draftObjectDefinitions, ([id, definition]) =>
        resolvedDraftObjectDefinition(id, definition, "scenePlacementViewer.draftObjectDefinitions")),
    ];
    return prefabs.map((prefab) => {
      const components = this.inlineComponentsForProps(
        prefab.props,
        `scenePlacementViewer.objectDefinitions.${prefab.id}`,
      );
      return {
        id: prefab.id,
        variants: Object.keys(prefab.variants),
        hasDataSceneComponents: components !== undefined,
        ...(components === undefined ? {} : {
          visual: copyResolvedDataSceneObjectVisual(components.visual),
          collider: copyResolvedDataSceneCollider(components.collider),
          componentLayer: { ...components.layer },
        }),
        behaviorProfiles: behaviorProfilesForProps(
          prefab.props,
          this.behaviorBindingProp(),
          `scenePlacementViewer.objectDefinitions.${prefab.id}.props`,
        ),
      };
    });
  }

  private transformFor(instance: ResolvedSceneCompositionInstance): ScenePlacementTransform {
    const source = this.instancesById.get(instance.sourceId) ?? this.instancesById.get(instance.id);
    if (source !== undefined) {
      return this.draftTransforms.get(source.id) ?? sourceTransform(instance);
    }
    return sourceTransform(instance);
  }

  private createPickBounds(path: string): readonly ScenePlacementPickBounds[] {
    const bounds: ScenePlacementPickBounds[] = [];
    for (const ref of this.visibleInstanceRefs()) {
      const instance = this.resolvedInstanceForRef(ref);
      const components = this.inlineComponentsForInstance(instance, `${path}.instances.${instance.id}`);
      if (components === undefined) {
        continue;
      }
      const transform = this.transformFor(instance);
      const visualBounds = dataSceneObjectVisualBounds(components);
      const halfWidth = visualBounds.width * transform.scale * 0.5;
      const halfHeight = visualBounds.height * transform.scale * 0.5;
      bounds.push({
        instanceId: instance.id,
        minX: transform.x - halfWidth,
        minY: transform.y - halfHeight,
        maxX: transform.x + halfWidth,
        maxY: transform.y + halfHeight,
      });
    }
    return bounds;
  }

  private inlineComponentsForInstance(
    instance: ResolvedSceneCompositionInstance,
    path: string,
  ): Extract<ResolvedDataSceneComponents, { mode: "inline" }> | undefined {
    if (instance.props[DATA_SCENE_COMPONENTS_PROP] === undefined) {
      return undefined;
    }
    const components = resolveDataSceneInstanceComponents(instance, {
      allowTemplate: false,
      path,
    });
    return components.mode === "inline" ? components : undefined;
  }

  private inlineComponentsForProps(
    props: SceneCompositionProps,
    path: string,
  ): Extract<ResolvedDataSceneComponents, { mode: "inline" }> | undefined {
    if (props[DATA_SCENE_COMPONENTS_PROP] === undefined) {
      return undefined;
    }
    const components = resolveDataSceneComponentsSpec(props[DATA_SCENE_COMPONENTS_PROP], {
      allowTemplate: false,
      path: `${path}.props.${DATA_SCENE_COMPONENTS_PROP}`,
    });
    return components.mode === "inline" ? components : undefined;
  }

  private prefabForId(id: string): ResolvedSceneCompositionPrefab | undefined {
    const source = this.composition.prefabs[id];
    if (source !== undefined) {
      return prefabWithBehaviorBindingDraft(
        source,
        this.draftObjectDefinitionBehaviorBindings.get(id),
        this.behaviorBindingProp(),
      );
    }
    const draft = this.draftObjectDefinitions.get(id);
    return draft === undefined
      ? undefined
      : resolvedDraftObjectDefinition(id, draft, "scenePlacementViewer.draftObjectDefinitions");
  }

  private pickInstanceIdAtWorld(point: ScenePlacementPoint): string | undefined {
    for (let index = this.pickBounds.length - 1; index >= 0; index -= 1) {
      const bounds = this.pickBounds[index];
      if (bounds === undefined) {
        continue;
      }
      if (
        point.x >= bounds.minX
        && point.x <= bounds.maxX
        && point.y >= bounds.minY
        && point.y <= bounds.maxY
      ) {
        return bounds.instanceId;
      }
    }
    return undefined;
  }

  private optionalKnownInstanceId(instanceId: string | undefined, path: string): string | undefined {
    if (instanceId === undefined) {
      return undefined;
    }
    if (this.instanceRefForId(instanceId) === undefined) {
      throw gameplayAuthoringDiagnosticError(path, `references unknown scene instance '${instanceId}'`);
    }
    return instanceId;
  }

  private knownInstanceRef(instanceId: string, path: string): ScenePlacementInstanceRef {
    const ref = this.instanceRefForId(instanceId);
    if (ref === undefined) {
      throw gameplayAuthoringDiagnosticError(path, `references unknown scene instance '${instanceId}'`);
    }
    return ref;
  }

  private visibleInstanceRefs(): ScenePlacementInstanceRef[] {
    const refs: ScenePlacementInstanceRef[] = [];
    for (const instance of this.sourceInstances) {
      if (!this.draftRemovedInstanceIds.has(instance.id)) {
        refs.push({ kind: "source", instance });
      }
    }
    this.draftAddedInstances.forEach((draft, index) => refs.push({ kind: "added", draft, index }));
    return refs;
  }

  private instanceRefForId(
    instanceId: string,
    ignore?: ScenePlacementInstanceRef,
  ): ScenePlacementInstanceRef | undefined {
    for (const ref of this.visibleInstanceRefs()) {
      if (sameInstanceRef(ref, ignore)) {
        continue;
      }
      if (this.resolvedInstanceForRef(ref).id === instanceId) {
        return ref;
      }
    }
    return undefined;
  }

  private resolvedInstanceForRef(ref: ScenePlacementInstanceRef): ResolvedSceneCompositionInstance {
    if (ref.kind === "source") {
      const currentId = this.currentInstanceId(ref.instance.id);
      const transform = this.draftTransforms.get(ref.instance.id) ?? sourceTransform(ref.instance);
      const props: Record<string, SceneCompositionJsonValue> = { ...ref.instance.props };
      if (this.draftComponents.has(ref.instance.id)) {
        props[DATA_SCENE_COMPONENTS_PROP] = this.draftComponents.get(ref.instance.id) as SceneCompositionJsonValue;
      }
      if (this.draftInstanceBehaviorBindings.has(ref.instance.id)) {
        props[this.behaviorBindingProp()] = behaviorBindingPropsValue(
          this.draftInstanceBehaviorBindings.get(ref.instance.id) as ScenePlacementBehaviorBindingPatch,
        );
      }
      return {
        ...ref.instance,
        id: currentId,
        ...transform,
        props,
      };
    }
    return resolveDraftAddedInstance(
      (prefabId) => this.prefabForId(prefabId),
      ref.draft.instance,
      "scenePlacementViewer.addedInstances",
    );
  }

  private currentInstanceId(sourceInstanceId: string): string {
    return this.draftRenames.get(sourceInstanceId) ?? sourceInstanceId;
  }

  private retargetSelectedAndHovered(previous: string, next: string): void {
    if (this.selectedInstanceId === previous) {
      this.selectedInstanceId = next;
    }
    if (this.hoveredInstanceId === previous) {
      this.hoveredInstanceId = next;
    }
  }

  private clearSelectedAndHovered(instanceId: string): void {
    if (this.selectedInstanceId === instanceId) {
      this.selectedInstanceId = undefined;
    }
    if (this.hoveredInstanceId === instanceId) {
      this.hoveredInstanceId = undefined;
    }
  }

  private retainedKnownInstanceId(instanceId: string | undefined): string | undefined {
    return instanceId === undefined || this.instanceRefForId(instanceId) === undefined
      ? undefined
      : instanceId;
  }

  private behaviorBindingProp(): string {
    return this.behaviorProp ?? GAMEPLAY_BEHAVIOR_BINDING_PROP;
  }
}

interface ScenePlacementDraftAddedInstance {
  fragment: string;
  instance: SceneCompositionFragmentInstanceSpec;
}

type ScenePlacementInstanceRef =
  | { kind: "source"; instance: ResolvedSceneCompositionInstance }
  | { kind: "added"; draft: ScenePlacementDraftAddedInstance; index: number };

function sameInstanceRef(
  left: ScenePlacementInstanceRef,
  right: ScenePlacementInstanceRef | undefined,
): boolean {
  if (right === undefined || left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "source" && right.kind === "source") {
    return left.instance.id === right.instance.id;
  }
  if (left.kind === "added" && right.kind === "added") {
    return left.index === right.index;
  }
  return false;
}

function resolveDraftAddedInstance(
  prefabForId: (prefabId: string) => ResolvedSceneCompositionPrefab | undefined,
  instance: SceneCompositionFragmentInstanceSpec,
  path: string,
): ResolvedSceneCompositionInstance {
  const id = requiredPlacementInstanceId(instance.id, `${path}.id`);
  const prefabId = requiredPlacementInstanceId(instance.prefab, `${path}.prefab`);
  const prefab = prefabForId(prefabId);
  if (prefab === undefined) {
    throw gameplayAuthoringDiagnosticError(`${path}.prefab`, `references unknown prefab '${prefabId}'`);
  }
  const variantId = instance.variant === undefined
    ? undefined
    : requiredPlacementInstanceId(instance.variant, `${path}.variant`);
  const variant = variantId === undefined ? undefined : prefab.variants[variantId];
  if (variantId !== undefined && variant === undefined) {
    throw gameplayAuthoringDiagnosticError(
      `${path}.variant`,
      `references unknown variant '${variantId}' for prefab '${prefabId}'`,
    );
  }
  return {
    id,
    sourceId: id,
    prefab: prefabId,
    ...(variantId === undefined ? {} : { variant: variantId }),
    ...resolvedDraftTransform(instance, path),
    props: mergeScenePlacementProps(variant?.props ?? prefab.props, instance.props ?? {}),
  };
}

function validateDraftInstancePrefab(
  prefabForId: (prefabId: string) => ResolvedSceneCompositionPrefab | undefined,
  instance: SceneCompositionFragmentInstanceSpec,
  path: string,
): void {
  validatePlacementInstanceProps(instance.props, `${path}.props`);
  resolveDraftAddedInstance(prefabForId, instance, path);
}

function resolvedDraftTransform(
  instance: SceneCompositionFragmentInstanceSpec,
  path: string,
): ScenePlacementTransform {
  return {
    x: finiteTransformNumber(instance.x ?? 0, `${path}.x`),
    y: finiteTransformNumber(instance.y ?? 0, `${path}.y`),
    rotationRadians: finiteTransformNumber(instance.rotationRadians ?? 0, `${path}.rotationRadians`),
    scale: positiveTransformNumber(instance.scale ?? 1, `${path}.scale`),
    layer: finiteTransformNumber(instance.layer ?? 0, `${path}.layer`),
  };
}

function requiredPlacementInstanceId(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw gameplayAuthoringDiagnosticError(path, "must be a non-empty string");
  }
  return value;
}

function validatePlacementInstanceProps(
  props: SceneCompositionProps | undefined,
  path: string,
): void {
  if (props === undefined) {
    return;
  }
  for (const key of Object.keys(props)) {
    if (key !== DATA_SCENE_COMPONENTS_PROP) {
      throw gameplayAuthoringDiagnosticError(
        `${path}.${key}`,
        "placement patches may only write UI-owned props.components",
      );
    }
  }
}

function mergeScenePlacementProps(
  base: SceneCompositionProps,
  override: SceneCompositionProps,
): SceneCompositionProps {
  const result: Record<string, SceneCompositionJsonValue> = {};
  for (const [key, value] of Object.entries(base)) {
    result[key] = copySceneCompositionJsonValue(value);
  }
  for (const [key, value] of Object.entries(override)) {
    const previous = result[key];
    result[key] = key !== DATA_SCENE_COMPONENTS_PROP
      && isScenePlacementJsonObject(previous)
      && isScenePlacementJsonObject(value)
      ? mergeScenePlacementProps(previous, value)
      : copySceneCompositionJsonValue(value);
  }
  return result;
}

function isScenePlacementJsonObject(
  value: SceneCompositionJsonValue | undefined,
): value is Readonly<Record<string, SceneCompositionJsonValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class ScenePlacementPatchStoreController implements ScenePlacementPatchStore {
  private patch?: ScenePlacementPatch;

  constructor(options: CreateScenePlacementPatchStoreOptions) {
    this.patch = copyScenePlacementPatch(options.patch);
  }

  state(): ScenePlacementPatchStoreState {
    const patch = this.exportPatch();
    return {
      dirty: patch !== undefined,
      operationCount: patch?.operations.length ?? 0,
      ...(patch === undefined ? {} : { patch }),
    };
  }

  replacePatch(patch?: ScenePlacementPatch): ScenePlacementPatchStoreState {
    this.patch = copyScenePlacementPatch(patch);
    return this.state();
  }

  exportPatch(): ScenePlacementPatch | undefined {
    return copyScenePlacementPatch(this.patch);
  }

  clear(): ScenePlacementPatchStoreState {
    this.patch = undefined;
    return this.state();
  }
}

interface ScenePlacementPickBounds {
  instanceId: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function viewerComposition(
  options: CreateScenePlacementViewerOptions,
  path: string,
): ResolvedSceneCompositionSpec {
  if (options.document !== undefined && options.sceneComposition !== undefined) {
    throw gameplayAuthoringDiagnosticError(path, "must provide either document or sceneComposition, not both");
  }
  if (options.document !== undefined) {
    return resolveSceneAuthoringDocument(options.document, {
      path: `${path}.document`,
    }).sceneComposition;
  }
  if (options.sceneComposition !== undefined) {
    return resolveSceneCompositionSpec(options.sceneComposition, { path: `${path}.sceneComposition` });
  }
  throw gameplayAuthoringDiagnosticError(path, "must provide document or sceneComposition");
}

function scenePlacementViewport(
  viewport: ScenePlacementViewport | ScenePlacementViewportOptions,
  path: string,
): ScenePlacementViewport {
  if (isScenePlacementViewport(viewport)) {
    return { ...viewport };
  }
  try {
    return createScenePlacementViewport(viewport);
  } catch (error) {
    throw gameplayAuthoringDiagnosticError(path, error instanceof Error ? error.message : String(error));
  }
}

function isScenePlacementViewport(
  viewport: ScenePlacementViewport | ScenePlacementViewportOptions,
): viewport is ScenePlacementViewport {
  return typeof (viewport as Partial<ScenePlacementViewport>).worldMinX === "number"
    && typeof (viewport as Partial<ScenePlacementViewport>).worldMaxX === "number"
    && typeof (viewport as Partial<ScenePlacementViewport>).worldWidth === "number"
    && typeof (viewport as Partial<ScenePlacementViewport>).worldHeight === "number";
}

function copyGameplayEntityHandle(handle: GameplayEntityHandle): GameplayEntityHandle {
  return {
    entityId: handle.entityId,
    entityGeneration: handle.entityGeneration,
  };
}

function copyResolvedDataSceneObjectVisual(
  visual: ResolvedDataSceneObjectVisual,
): ResolvedDataSceneObjectVisual {
  if (visual.kind === "primitive") {
    return {
      kind: "primitive",
      shape: visual.shape,
      ...(visual.color === undefined ? {} : { color: visual.color }),
      width: visual.width,
      height: visual.height,
      ...(visual.radius === undefined ? {} : { radius: visual.radius }),
      bounds: { ...visual.bounds },
    };
  }
  return {
    kind: "sprite",
    texture: { ...visual.texture },
    width: visual.width,
    height: visual.height,
    frame: { ...visual.frame },
    ...(visual.animation === undefined ? {} : { animation: { ...visual.animation } }),
    originX: visual.originX,
    originY: visual.originY,
    ...(visual.layer === undefined ? {} : { layer: visual.layer }),
    ...(visual.sortOrder === undefined ? {} : { sortOrder: visual.sortOrder }),
    ...(visual.tint === undefined ? {} : { tint: visual.tint }),
    ...(visual.color === undefined ? {} : { color: visual.color }),
    bounds: { ...visual.bounds },
  };
}

function copyResolvedDataSceneCollider(
  collider: ResolvedDataSceneColliderComponent,
): ResolvedDataSceneColliderComponent {
  switch (collider.type) {
    case "none":
      return { type: "none" };
    case "aabb":
    case "circle":
    case "capsule":
    case "orientedBox":
      return { ...collider };
    case "convexPolygon":
      return {
        ...collider,
        vertices: collider.vertices.map((vertex) => ({ ...vertex })),
      };
  }
}

function sourceTransform(instance: ResolvedSceneCompositionInstance): ScenePlacementTransform {
  return {
    x: instance.x,
    y: instance.y,
    rotationRadians: instance.rotationRadians,
    scale: instance.scale,
    layer: instance.layer,
  };
}

function validatedTransformPatch(
  transform: Partial<ScenePlacementTransform>,
  path: string,
): Partial<ScenePlacementTransform> {
  const patch: Partial<ScenePlacementTransform> = {};
  if (transform.x !== undefined) {
    patch.x = finiteTransformNumber(transform.x, `${path}.x`);
  }
  if (transform.y !== undefined) {
    patch.y = finiteTransformNumber(transform.y, `${path}.y`);
  }
  if (transform.rotationRadians !== undefined) {
    patch.rotationRadians = finiteTransformNumber(transform.rotationRadians, `${path}.rotationRadians`);
  }
  if (transform.scale !== undefined) {
    patch.scale = positiveTransformNumber(transform.scale, `${path}.scale`);
  }
  if (transform.layer !== undefined) {
    patch.layer = finiteTransformNumber(transform.layer, `${path}.layer`);
  }
  return patch;
}

function finiteTransformNumber(value: number, path: string): number {
  if (!Number.isFinite(value)) {
    throw gameplayAuthoringDiagnosticError(path, "must be a finite number");
  }
  return value;
}

function positiveTransformNumber(value: number, path: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw gameplayAuthoringDiagnosticError(path, "must be a positive finite number");
  }
  return value;
}

function validatedComponentsPatch(
  components: SceneCompositionJsonValue,
  path: string,
): SceneCompositionJsonValue {
  const copy = copySceneCompositionJsonValue(components);
  try {
    resolveDataSceneComponentsSpec(copy, {
      allowTemplate: false,
      path,
    });
  } catch (error) {
    throw gameplayAuthoringDiagnosticError(path, error instanceof Error ? error.message : String(error));
  }
  return copy;
}

function sameTransform(left: ScenePlacementTransform, right: ScenePlacementTransform): boolean {
  return left.x === right.x
    && left.y === right.y
    && left.rotationRadians === right.rotationRadians
    && left.scale === right.scale
    && left.layer === right.layer;
}

function transformDiff(
  source: ScenePlacementTransform,
  next: ScenePlacementTransform,
): Partial<ScenePlacementTransform> {
  const patch: Partial<ScenePlacementTransform> = {};
  if (source.x !== next.x) patch.x = next.x;
  if (source.y !== next.y) patch.y = next.y;
  if (source.rotationRadians !== next.rotationRadians) patch.rotationRadians = next.rotationRadians;
  if (source.scale !== next.scale) patch.scale = next.scale;
  if (source.layer !== next.layer) patch.layer = next.layer;
  return patch;
}

function hasTransformPatch(transform: Partial<ScenePlacementTransform>): boolean {
  return transform.x !== undefined
    || transform.y !== undefined
    || transform.rotationRadians !== undefined
    || transform.scale !== undefined
    || transform.layer !== undefined;
}

function copyScenePlacementPatch(patch: ScenePlacementPatch | undefined): ScenePlacementPatch | undefined {
  if (patch === undefined) {
    return undefined;
  }
  return {
    format: patch.format,
    version: patch.version,
    operations: patch.operations.map(copyScenePlacementPatchOperation),
  };
}

function copyScenePlacementPatchOperation(
  operation: ScenePlacementPatchOperation,
): ScenePlacementPatchOperation {
  switch (operation.kind) {
    case "updateTransform":
      return {
        kind: "updateTransform",
        instanceId: operation.instanceId,
        transform: copyTransformPatch(operation.transform),
      };
    case "updateComponents":
      return {
        kind: "updateComponents",
        instanceId: operation.instanceId,
        components: copySceneCompositionJsonValue(operation.components),
      };
    case "updateBehaviorBinding":
      return {
        kind: "updateBehaviorBinding",
        target: copyBehaviorBindingTarget(operation.target),
        behaviorRecipes: copyBehaviorBindingPatch(operation.behaviorRecipes),
      };
    case "renameInstance":
      return {
        kind: "renameInstance",
        instanceId: operation.instanceId,
        nextInstanceId: operation.nextInstanceId,
      };
    case "addObjectDefinition":
      return {
        kind: "addObjectDefinition",
        id: operation.id,
        definition: copySceneCompositionPrefabSpec(operation.definition),
      };
    case "addInstance":
      return {
        kind: "addInstance",
        fragment: operation.fragment,
        instance: copySceneCompositionFragmentInstance(operation.instance),
      };
    case "removeInstance":
      return {
        kind: "removeInstance",
        instanceId: operation.instanceId,
      };
  }
}

function copySceneCompositionPrefabSpec(
  definition: SceneCompositionPrefabSpec,
): SceneCompositionPrefabSpec {
  const variants = definition.variants ?? {};
  const copiedVariants: Record<string, SceneCompositionPrefabVariantSpec> = {};
  for (const [variantId, variant] of Object.entries(variants)) {
    copiedVariants[variantId] = {
      ...(variant.extends === undefined ? {} : { extends: variant.extends }),
      ...(variant.props === undefined ? {} : { props: copySceneCompositionProps(variant.props) }),
    };
  }
  return {
    ...(definition.props === undefined ? {} : { props: copySceneCompositionProps(definition.props) }),
    ...(Object.keys(copiedVariants).length === 0 ? {} : { variants: copiedVariants }),
  };
}

function copySceneCompositionFragmentInstance(
  instance: SceneCompositionFragmentInstanceSpec,
): SceneCompositionFragmentInstanceSpec {
  return {
    ...(instance.id === undefined ? {} : { id: instance.id }),
    prefab: instance.prefab,
    ...(instance.variant === undefined ? {} : { variant: instance.variant }),
    ...(instance.x === undefined ? {} : { x: instance.x }),
    ...(instance.y === undefined ? {} : { y: instance.y }),
    ...(instance.rotationRadians === undefined ? {} : { rotationRadians: instance.rotationRadians }),
    ...(instance.scale === undefined ? {} : { scale: instance.scale }),
    ...(instance.layer === undefined ? {} : { layer: instance.layer }),
    ...(instance.props === undefined ? {} : { props: copySceneCompositionProps(instance.props) }),
  };
}

function copySceneCompositionProps(
  props: Readonly<Record<string, SceneCompositionJsonValue>>,
): Readonly<Record<string, SceneCompositionJsonValue>> {
  const copy: Record<string, SceneCompositionJsonValue> = {};
  for (const [key, value] of Object.entries(props)) {
    copy[key] = copySceneCompositionJsonValue(value);
  }
  return copy;
}

function copySceneCompositionJsonValue(value: SceneCompositionJsonValue): SceneCompositionJsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return (value as readonly SceneCompositionJsonValue[]).map(copySceneCompositionJsonValue);
  }
  return copySceneCompositionProps(value as Readonly<Record<string, SceneCompositionJsonValue>>);
}

function validatedBehaviorBindingPatch(
  behaviorRecipes: ScenePlacementBehaviorBindingPatch,
  path: string,
): ScenePlacementBehaviorBindingPatch {
  if (behaviorRecipes === null) {
    return null;
  }
  if (typeof behaviorRecipes === "string") {
    if (behaviorRecipes.length === 0) {
      throw gameplayAuthoringDiagnosticError(path, "must be a non-empty behavior profile string");
    }
    return behaviorRecipes;
  }
  if (Array.isArray(behaviorRecipes)) {
    return behaviorRecipes.map((entry, index) => {
      if (typeof entry !== "string" || entry.length === 0) {
        throw gameplayAuthoringDiagnosticError(`${path}.${index}`, "must be a non-empty behavior profile string");
      }
      return entry;
    });
  }
  throw gameplayAuthoringDiagnosticError(path, "must be null, a behavior profile string, or a string array");
}

function behaviorBindingPropsValue(
  behaviorRecipes: ScenePlacementBehaviorBindingPatch,
): SceneCompositionJsonValue {
  if (behaviorRecipes === null) {
    return [];
  }
  return copyBehaviorBindingPatch(behaviorRecipes) as SceneCompositionJsonValue;
}

function behaviorProfilesForProps(
  props: SceneCompositionProps,
  behaviorProp: string,
  path: string,
): readonly string[] {
  const value = props[behaviorProp];
  if (value === undefined) {
    return [];
  }
  const binding = validatedBehaviorBindingPatch(
    value as ScenePlacementBehaviorBindingPatch,
    `${path}.${behaviorProp}`,
  );
  if (binding === null) {
    return [];
  }
  return typeof binding === "string" ? [binding] : [...binding];
}

function behaviorBindingPatchFromProps(
  props: SceneCompositionProps | undefined,
  behaviorProp: string,
): ScenePlacementBehaviorBindingPatch | undefined {
  const value = props?.[behaviorProp];
  if (value === undefined) {
    return undefined;
  }
  return validatedBehaviorBindingPatch(
    value as ScenePlacementBehaviorBindingPatch,
    `scenePlacementViewer.behaviorBindingPatch.${behaviorProp}`,
  );
}

function sameBehaviorBindingPatch(
  source: SceneCompositionJsonValue | undefined,
  patch: ScenePlacementBehaviorBindingPatch,
): boolean {
  if (source === undefined && patch === null) {
    return true;
  }
  if (source === undefined) {
    return false;
  }
  const sourceBinding = validatedBehaviorBindingPatch(
    source as ScenePlacementBehaviorBindingPatch,
    "scenePlacementViewer.behaviorBinding",
  );
  if (sourceBinding === null || patch === null) {
    return sourceBinding === patch;
  }
  return JSON.stringify(sourceBinding) === JSON.stringify(patch);
}

function copyBehaviorBindingPatch(
  behaviorRecipes: ScenePlacementBehaviorBindingPatch,
): ScenePlacementBehaviorBindingPatch {
  if (behaviorRecipes === null || typeof behaviorRecipes === "string") {
    return behaviorRecipes;
  }
  return [...behaviorRecipes];
}

function copyBehaviorBindingTarget(
  target: ScenePlacementBehaviorBindingTarget,
): ScenePlacementBehaviorBindingTarget {
  return target.kind === "instance"
    ? { kind: "instance", instanceId: target.instanceId }
    : { kind: "objectDefinition", id: target.id };
}

function validatedObjectDefinitionPatch(
  definition: SceneCompositionPrefabSpec,
  path: string,
): SceneCompositionPrefabSpec {
  const copy = copySceneCompositionPrefabSpec(definition);
  validatePlacementDefinitionProps(copy.props, `${path}.props`);
  const variants = copy.variants ?? {};
  for (const [variantId, variant] of Object.entries(variants)) {
    requiredPlacementInstanceId(variantId, `${path}.variants.${variantId}`);
    if (variant.extends !== undefined) {
      requiredPlacementInstanceId(variant.extends, `${path}.variants.${variantId}.extends`);
    }
    validatePlacementDefinitionProps(variant.props, `${path}.variants.${variantId}.props`);
  }
  return copy;
}

function validatePlacementDefinitionProps(
  props: SceneCompositionProps | undefined,
  path: string,
): void {
  if (props === undefined) {
    return;
  }
  validatePlacementInstanceProps(props, path);
  const components = props[DATA_SCENE_COMPONENTS_PROP];
  if (components !== undefined) {
    validatedComponentsPatch(components, `${path}.${DATA_SCENE_COMPONENTS_PROP}`);
  }
}

function resolvedDraftObjectDefinition(
  id: string,
  definition: SceneCompositionPrefabSpec,
  path: string,
): ResolvedSceneCompositionPrefab {
  const variants = definition.variants ?? {};
  const resolvedVariants: Record<string, ResolvedSceneCompositionPrefab["variants"][string]> = {};
  for (const [variantId, variant] of Object.entries(variants)) {
    resolvedVariants[variantId] = {
      id: variantId,
      ...(variant.extends === undefined ? {} : { extends: variant.extends }),
      props: copySceneCompositionProps(variant.props ?? {}),
    };
  }
  return {
    id,
    props: copySceneCompositionProps(definition.props ?? {}),
    variants: resolvedVariants,
  };
}

function instanceWithBehaviorBinding(
  instance: SceneCompositionFragmentInstanceSpec,
  behaviorRecipes: ScenePlacementBehaviorBindingPatch,
  behaviorProp: string,
): SceneCompositionFragmentInstanceSpec {
  return {
    ...instance,
    props: {
      ...(instance.props ?? {}),
      [behaviorProp]: behaviorBindingPropsValue(behaviorRecipes),
    },
  };
}

function objectDefinitionWithBehaviorBinding(
  definition: SceneCompositionPrefabSpec,
  behaviorRecipes: ScenePlacementBehaviorBindingPatch,
  behaviorProp: string,
): SceneCompositionPrefabSpec {
  const props = { ...(definition.props ?? {}) };
  if (behaviorRecipes === null) {
    delete props[behaviorProp];
  } else {
    props[behaviorProp] = behaviorBindingPropsValue(behaviorRecipes);
  }
  return {
    ...definition,
    props,
  };
}

function prefabWithBehaviorBindingDraft(
  prefab: ResolvedSceneCompositionPrefab,
  behaviorRecipes: ScenePlacementBehaviorBindingPatch | undefined,
  behaviorProp: string,
): ResolvedSceneCompositionPrefab {
  if (behaviorRecipes === undefined) {
    return prefab;
  }
  const props = { ...prefab.props };
  if (behaviorRecipes === null) {
    delete props[behaviorProp];
  } else {
    props[behaviorProp] = behaviorBindingPropsValue(behaviorRecipes);
  }
  return {
    ...prefab,
    props,
  };
}

function copyObjectDefinitionWithoutBehaviorBinding(
  definition: SceneCompositionPrefabSpec,
  behaviorProp: string,
): SceneCompositionPrefabSpec {
  const copy = copySceneCompositionPrefabSpec(definition);
  if (copy.props !== undefined) {
    const props = { ...copy.props };
    delete props[behaviorProp];
    if (Object.keys(props).length === 0) {
      delete copy.props;
    } else {
      copy.props = props;
    }
  }
  return copy;
}

function copyInstanceWithoutBehaviorBinding(
  instance: SceneCompositionFragmentInstanceSpec,
  behaviorProp: string,
): SceneCompositionFragmentInstanceSpec {
  const copy = copySceneCompositionFragmentInstance(instance);
  if (copy.props !== undefined) {
    const props = { ...copy.props };
    delete props[behaviorProp];
    if (Object.keys(props).length === 0) {
      delete copy.props;
    } else {
      copy.props = props;
    }
  }
  return copy;
}

function sameSceneCompositionJsonValue(
  left: SceneCompositionJsonValue | undefined,
  right: SceneCompositionJsonValue,
): boolean {
  return left !== undefined && JSON.stringify(left) === JSON.stringify(right);
}

function copyTransformPatch(transform: Partial<ScenePlacementTransform>): Partial<ScenePlacementTransform> {
  const copy: Partial<ScenePlacementTransform> = {};
  if (transform.x !== undefined) copy.x = transform.x;
  if (transform.y !== undefined) copy.y = transform.y;
  if (transform.rotationRadians !== undefined) copy.rotationRadians = transform.rotationRadians;
  if (transform.scale !== undefined) copy.scale = transform.scale;
  if (transform.layer !== undefined) copy.layer = transform.layer;
  return copy;
}
