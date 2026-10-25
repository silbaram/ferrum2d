import {
  mergeScenePlacementPatch,
  assertSceneSpatialMigrationAllowed,
} from "./scenePlacementPatch.js";
import {
  applySceneSpatialPatch,
  diffSceneSpatialPatch,
  sceneSpatialReferencesInstance,
  type SceneSpatialPatch,
  type SceneSpatialPatchOperation,
} from "./sceneSpatialPatch.js";
import {
  resolveDataSceneSpatialSpec,
  type DataSceneSpatialSpec,
} from "./dataSceneSpatial.js";
import {
  ScenePlacementHistory,
  type ScenePlacementHistoryState,
} from "./scenePlacementHistory.js";
import { gameplayAuthoringDiagnosticError } from "./diagnostics.js";
import {
  DATA_SCENE_COMPONENTS_PROP,
  resolveDataSceneComponentsSpec,
  resolveDataSceneInstanceComponents,
  type DataSceneBodySpec,
  type ResolvedDataSceneColliderComponent,
  type ResolvedDataSceneCollisionLayer,
  type ResolvedDataSceneComponents,
  type ResolvedDataSceneObjectVisual,
} from "./dataSceneComponents.js";
import {
  scenePlacementVisualGeometry,
  type ScenePlacementVisualGeometry,
} from "./scenePlacementGeometry.js";
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
import {
  resolveSceneAuthoringDocument,
  type SceneAuthoringDocumentSpec,
} from "./sceneAuthoringDocument.js";
import {
  instantiateSceneFragmentPlacements,
  resolveSceneCompositionSpec,
  type InstantiateSceneFragmentOptions,
} from "./sceneComposition.js";
import type { ResolvedSceneAuthoringDocument } from "./sceneAuthoringDocument.js";
import type {
  ResolvedSceneCompositionInstance,
  ResolvedSceneCompositionSpec,
  ResolvedSceneCompositionPrefab,
  SceneCompositionInstancePlacement,
  SceneCompositionFragmentInstanceSpec,
  SceneCompositionJsonValue,
  SceneCompositionPrefabSpec,
  SceneCompositionPrefabVariantSpec,
  SceneCompositionProps,
  SceneCompositionSpec,
} from "./sceneComposition.js";

export const SCENE_PLACEMENT_PATCH_FORMAT =
  "ferrum2d.scene-placement.patch" as const;
export const SCENE_PLACEMENT_PATCH_LEGACY_VERSION = 1 as const;
export const SCENE_PLACEMENT_PATCH_VERSION = 2 as const;

export type ScenePlacementViewerDocument =
  | SceneAuthoringDocumentSpec
  | ResolvedSceneAuthoringDocument;

export type ScenePlacementViewerComposition =
  | SceneCompositionSpec
  | ResolvedSceneCompositionSpec;

export interface CreateScenePlacementViewerOptions
  extends InstantiateSceneFragmentOptions {
  document?: ScenePlacementViewerDocument;
  sceneComposition?: ScenePlacementViewerComposition;
  viewport: ScenePlacementViewport | ScenePlacementViewportOptions;
  instanceHandleRegistry?: SceneInstanceHandleRegistry;
  validateLiveHandles?: boolean;
  behaviorProp?: string;
  selectedInstanceId?: string;
  hoveredInstanceId?: string;
  pointerScreen?: ScenePlacementPoint;
  /** Cold host validation before edits/history restoration commit. Throw to reject; do not reenter edits/history. */
  validateDraft?(state: ScenePlacementViewerState): void;
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
  body?: DataSceneBodySpec;
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
  body?: DataSceneBodySpec;
  behaviorProfiles: readonly string[];
}

export interface ScenePlacementViewerState {
  fragment: string;
  viewport: ScenePlacementViewport;
  objectDefinitions: readonly ScenePlacementObjectDefinitionSummary[];
  instances: readonly ScenePlacementViewerInstance[];
  /** Ordered selection; the last member is the legacy primary selectedInstanceId. */
  selectedInstanceIds: readonly string[];
  /** Transient edit locks; never serialized into the document or patch. */
  lockedInstanceIds: readonly string[];
  selectedInstanceId?: string;
  hoveredInstanceId?: string;
  pointerWorld?: ScenePlacementPoint;
  selected?: ScenePlacementViewerInstance;
  draftPatch?: ScenePlacementPatch;
  spatial?: DataSceneSpatialSpec;
}

export type ScenePlacementPatchOperation =
  | ScenePlacementUpdateTransformOperation
  | ScenePlacementUpdateResolvedTransformOperation
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

export type ScenePlacementResolvedTransformTarget =
  | ScenePlacementFragmentInstanceTransformTarget
  | ScenePlacementFragmentIncludeInstanceTransformTarget;

export interface ScenePlacementFragmentInstanceTransformTarget {
  kind: "fragmentInstance";
  fragment: string;
  instanceId: string;
}

export interface ScenePlacementFragmentIncludeInstanceTransformTarget {
  kind: "fragmentIncludeInstance";
  fragment: string;
  includeIndex: number;
  includedFragment: string;
  instanceId: string;
}

export interface ScenePlacementUpdateResolvedTransformOperation {
  kind: "updateResolvedTransform";
  instanceId: string;
  target: ScenePlacementResolvedTransformTarget;
  transform: ScenePlacementTransform;
}

export interface ScenePlacementUpdateComponentsOperation {
  kind: "updateComponents";
  instanceId: string;
  components: SceneCompositionJsonValue;
}

export type ScenePlacementBehaviorBindingPatch =
  GameplayBehaviorBindingSpec | null;

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
  version:
    | typeof SCENE_PLACEMENT_PATCH_LEGACY_VERSION
    | typeof SCENE_PLACEMENT_PATCH_VERSION
    | 3;
  /** Version 3 only. Older readers reject this version before saving. */
  spatial?: SceneSpatialPatch;
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

type ScenePlacementSpatialAddition =
  | Omit<Extract<SceneSpatialPatchOperation, { kind: "addBillboard" }>, "id">
  | Omit<Extract<SceneSpatialPatchOperation, { kind: "addModel" }>, "id">;

export interface ScenePlacementViewer {
  historyState(): ScenePlacementHistoryState;
  beginEdit(label: string): void;
  commitEdit(): ScenePlacementViewerState;
  cancelEdit(): ScenePlacementViewerState;
  undo(): ScenePlacementViewerState;
  redo(): ScenePlacementViewerState;
  state(): ScenePlacementViewerState;
  selectInstance(instanceId?: string): ScenePlacementViewerState;
  selectInstances(instanceIds: readonly string[]): ScenePlacementViewerState;
  setInstancesLocked(
    instanceIds: readonly string[],
    locked: boolean,
  ): ScenePlacementViewerState;
  selectInstanceAtScreen(point: ScenePlacementPoint): ScenePlacementViewerState;
  hoverInstance(instanceId?: string): ScenePlacementViewerState;
  hoverInstanceAtScreen(point?: ScenePlacementPoint): ScenePlacementViewerState;
  pointerAtScreen(point?: ScenePlacementPoint): ScenePlacementViewerState;
  pickInstanceAtScreen(
    point: ScenePlacementPoint,
  ): ScenePlacementViewerInstance | undefined;
  updateInstanceTransform(
    instanceId: string,
    transform: Partial<ScenePlacementTransform>,
  ): ScenePlacementViewerState;
  updateInstanceTransforms(
    updates: readonly {
      instanceId: string;
      transform: Partial<ScenePlacementTransform>;
    }[],
  ): ScenePlacementViewerState;
  updateSpatial(
    operations: readonly SceneSpatialPatchOperation[],
  ): ScenePlacementViewerState;
  updateInstanceComponents(
    instanceId: string,
    components: SceneCompositionJsonValue,
  ): ScenePlacementViewerState;
  updateBehaviorBinding(
    target: ScenePlacementBehaviorBindingTarget,
    behaviorRecipes: ScenePlacementBehaviorBindingPatch,
  ): ScenePlacementViewerState;
  renameInstance(
    instanceId: string,
    nextInstanceId: string,
  ): ScenePlacementViewerState;
  addObjectDefinition(
    id: string,
    definition: SceneCompositionPrefabSpec,
  ): ScenePlacementViewerState;
  addInstance(
    fragment: string,
    instance: SceneCompositionFragmentInstanceSpec,
    spatial?: ScenePlacementSpatialAddition,
  ): ScenePlacementViewerState;
  removeInstance(instanceId: string): ScenePlacementViewerState;
  removeInstances(instanceIds: readonly string[]): ScenePlacementViewerState;
  duplicateInstances(
    instanceIds: readonly string[],
    offset?: ScenePlacementPoint,
  ): ScenePlacementViewerState;
  clearDraftPatch(): ScenePlacementViewerState;
  updateViewport(
    viewport: ScenePlacementViewport | ScenePlacementViewportOptions,
  ): ScenePlacementViewerState;
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
  private readonly history = new ScenePlacementHistory(
    () => this.captureDraft(),
    (snapshot) => this.restoreDraft(snapshot),
    (snapshot) => snapshot.signature,
  );

  historyState(): ScenePlacementHistoryState {
    return this.history.state();
  }

  beginEdit(label: string): void {
    this.assertNotValidating();
    this.history.begin(label);
  }

  commitEdit(): ScenePlacementViewerState {
    this.assertNotValidating();
    this.history.commit();
    this.pruneSelectionAndLocks();
    return this.state();
  }

  cancelEdit(): ScenePlacementViewerState {
    return this.restoreHistory(() => this.history.cancel());
  }

  undo(): ScenePlacementViewerState {
    return this.restoreHistory(() => this.history.undo());
  }

  redo(): ScenePlacementViewerState {
    return this.restoreHistory(() => this.history.redo());
  }

  private restoreHistory(restore: () => void): ScenePlacementViewerState {
    this.assertNotValidating();
    this.editingDraft = true;
    try {
      restore();
      return this.state();
    } finally {
      this.editingDraft = false;
      this.pruneSelectionAndLocks();
    }
  }

  private captureDraft() {
    return structuredClone({
      signature: JSON.stringify(this.exportPatch() ?? null),
      transforms: [...this.draftTransforms],
      components: [...this.draftComponents],
      instanceBindings: [...this.draftInstanceBehaviorBindings],
      definitionBindings: [...this.draftObjectDefinitionBehaviorBindings],
      renames: [...this.draftRenames],
      copySources: [...this.spatialCopySources],
      removed: [...this.draftRemovedInstanceIds],
      definitions: [...this.draftObjectDefinitions],
      added: this.draftAddedInstances,
      selected: [...this.selectedInstanceIds],
      hovered: this.hoveredInstanceId,
      spatial: this.spatial,
    });
  }

  private restoreDraft(
    snapshot: ReturnType<ScenePlacementViewerController["captureDraft"]>,
  ): void {
    const copy = structuredClone(snapshot);
    replaceDraftMap(this.draftTransforms, copy.transforms);
    replaceDraftMap(this.draftComponents, copy.components);
    replaceDraftMap(this.draftInstanceBehaviorBindings, copy.instanceBindings);
    replaceDraftMap(
      this.draftObjectDefinitionBehaviorBindings,
      copy.definitionBindings,
    );
    replaceDraftMap(this.draftRenames, copy.renames);
    replaceDraftMap(this.spatialCopySources, copy.copySources);
    replaceDraftMap(this.draftObjectDefinitions, copy.definitions);
    this.draftRemovedInstanceIds.clear();
    for (const id of copy.removed) this.draftRemovedInstanceIds.add(id);
    this.draftAddedInstances.splice(
      0,
      this.draftAddedInstances.length,
      ...copy.added,
    );
    this.selectedInstanceIds = copy.selected;
    this.hoveredInstanceId = copy.hovered;
    this.spatial = copy.spatial;
    this.pickBounds = this.createPickBounds(this.path);
    this.pruneSelectionAndLocks();
    this.runDraftValidation(this.state());
  }

  private readonly sourceDocument?: SceneAuthoringDocumentSpec;
  private readonly sourceSpatial?: DataSceneSpatialSpec;
  private spatial?: DataSceneSpatialSpec;
  private editingDraft = false;
  private validatingDraft = false;

  private assertNotValidating(): void {
    if (this.validatingDraft)
      throw new Error("Draft validation cannot reenter edits or history");
  }

  private runDraftValidation(state: ScenePlacementViewerState): void {
    if (!this.validateDraft) return;
    this.validatingDraft = true;
    try {
      this.validateDraft(state);
    } finally {
      this.validatingDraft = false;
    }
  }

  private edit(
    label: string,
    run: () => ScenePlacementViewerState,
  ): ScenePlacementViewerState {
    this.assertNotValidating();
    this.editingDraft = true;
    try {
      return this.history.edit(label, () => {
        const state = run();
        const patch = this.exportPatch();
        if (this.sourceDocument?.spatial && patch)
          mergeScenePlacementPatch(this.sourceDocument, patch);
        this.runDraftValidation(state);
        return this.validateDraft ? this.state() : state;
      });
    } finally {
      this.editingDraft = false;
      this.pruneSelectionAndLocks();
    }
  }

  updateSpatial(
    operations: readonly SceneSpatialPatchOperation[],
  ): ScenePlacementViewerState {
    return this.edit("Spatial Placement", () => {
      const locked = new Set(this.state().lockedInstanceIds);
      if (
        operations.some(
          (operation) =>
            operation.kind !== "updateTerrainSurface" &&
            locked.has(operation.id),
        )
      )
        throw new Error("Cannot edit a locked spatial instance");
      for (const op of operations)
        if (op.kind === "copyReference") {
          const source =
            [...this.draftRenames].find(
              ([, current]) => current === op.changes.sourceId,
            )?.[0] ??
            this.spatialCopySources.get(op.changes.sourceId) ??
            op.changes.sourceId;
          this.spatialCopySources.set(op.id, source);
        }
      this.spatial = applySceneSpatialPatch(this.spatial, {
        format: "ferrum2d.scene-spatial.patch",
        version: operations.some(
          (op) => op.kind === "setBillboardNormalTexture",
        )
          ? 4
          : operations.some((op) =>
                [
                  "renameReference",
                  "removeReference",
                  "copyReference",
                  "replaceModelAsset",
                ].includes(op.kind),
              )
            ? 3
            : operations.some(
                  (operation) =>
                    operation.kind === "addBillboard" ||
                    operation.kind === "addModel",
                )
              ? 2
              : 1,
        operations,
      });
      return this.state();
    });
  }

  private assertSpatialReferenceEditable(id: string): void {
    if (this.sourceDocument)
      assertSceneSpatialMigrationAllowed(this.sourceDocument, id, false);
    if (!this.spatial || !sceneSpatialReferencesInstance(this.spatial, id))
      return;
    if (this.sourceDocument)
      assertSceneSpatialMigrationAllowed(this.sourceDocument, id);
    if (
      this.spatial?.actor?.instanceId === id ||
      this.spatial?.attachments?.[id] ||
      Object.values(this.spatial?.attachments ?? {}).some(
        (link) => link.parent === id,
      )
    )
      throw new Error(
        `spatial.${id}: agent-owned reference requires explicit reference migration`,
      );
  }

  private readonly path: string;
  private readonly fragment: string;
  private readonly composition: ResolvedSceneCompositionSpec;
  private readonly sourceInstances: readonly ResolvedSceneCompositionInstance[];
  private readonly instancesById = new Map<
    string,
    ResolvedSceneCompositionInstance
  >();
  private readonly placementsById = new Map<
    string,
    SceneCompositionInstancePlacement
  >();
  private readonly draftTransforms = new Map<string, ScenePlacementTransform>();
  private readonly draftComponents = new Map<
    string,
    SceneCompositionJsonValue
  >();
  private readonly draftInstanceBehaviorBindings = new Map<
    string,
    ScenePlacementBehaviorBindingPatch
  >();
  private readonly draftObjectDefinitionBehaviorBindings = new Map<
    string,
    ScenePlacementBehaviorBindingPatch
  >();
  private readonly spatialCopySources = new Map<string, string>();
  private readonly draftRenames = new Map<string, string>();
  private readonly draftRemovedInstanceIds = new Set<string>();
  private readonly draftObjectDefinitions = new Map<
    string,
    SceneCompositionPrefabSpec
  >();
  private readonly draftAddedInstances: ScenePlacementDraftAddedInstance[] = [];
  private readonly instanceHandleRegistry?: SceneInstanceHandleRegistry;
  private readonly validateLiveHandles: boolean;
  private readonly validateDraft?: CreateScenePlacementViewerOptions["validateDraft"];
  private readonly behaviorProp?: string;
  private pickBounds: readonly ScenePlacementPickBounds[];
  private viewport: ScenePlacementViewport;
  private selectedInstanceIds: string[] = [];
  private readonly lockedKeys = new Set<string>();
  private nextDraftKey = 0;
  private get selectedInstanceId(): string | undefined {
    return this.selectedInstanceIds[this.selectedInstanceIds.length - 1];
  }
  private hoveredInstanceId?: string;
  private pointerWorld?: ScenePlacementPoint;

  constructor(options: CreateScenePlacementViewerOptions) {
    const path = options.path ?? "scenePlacementViewer";
    if (options.document)
      this.sourceDocument = structuredClone(
        options.document,
      ) as SceneAuthoringDocumentSpec;
    if (options.document?.spatial) {
      this.sourceSpatial = resolveDataSceneSpatialSpec(
        options.document.spatial,
        `${path}.spatial`,
      );
      this.spatial = structuredClone(this.sourceSpatial);
    }
    this.path = path;
    const composition = viewerComposition(options, path);
    this.composition = composition;
    this.fragment = options.fragment ?? composition.initialFragment;
    const placements = instantiateSceneFragmentPlacements(composition, {
      ...options,
      fragment: this.fragment,
      path: `${path}.sceneComposition`,
    });
    this.sourceInstances = placements.map((placement) => placement.instance);
    for (const placement of placements) {
      this.placementsById.set(placement.instance.id, placement.placement);
    }
    for (const instance of this.sourceInstances) {
      this.instancesById.set(instance.id, instance);
    }
    this.pickBounds = this.createPickBounds(path);
    this.instanceHandleRegistry = options.instanceHandleRegistry;
    this.validateLiveHandles = options.validateLiveHandles ?? false;
    this.validateDraft = options.validateDraft;
    this.behaviorProp = options.behaviorProp;
    this.viewport = scenePlacementViewport(
      options.viewport,
      `${path}.viewport`,
    );
    const selectedInstanceId = this.optionalKnownInstanceId(
      options.selectedInstanceId,
      `${path}.selectedInstanceId`,
    );
    this.selectedInstanceIds =
      selectedInstanceId === undefined ? [] : [selectedInstanceId];
    this.hoveredInstanceId = this.optionalKnownInstanceId(
      options.hoveredInstanceId,
      `${path}.hoveredInstanceId`,
    );
    if (options.pointerScreen !== undefined) {
      this.pointerWorld = screenToSceneWorld(
        this.viewport,
        options.pointerScreen,
      );
    }
  }

  state(): ScenePlacementViewerState {
    const refs = this.visibleInstanceRefs();
    const instances = refs.map((ref) => this.viewerInstance(ref));
    const selected =
      this.selectedInstanceId === undefined
        ? undefined
        : instances.find(
            (instance) => instance.instanceId === this.selectedInstanceId,
          );
    const draftPatch = this.exportPatch();
    return {
      fragment: this.fragment,
      ...(this.spatial ? { spatial: structuredClone(this.spatial) } : {}),
      viewport: { ...this.viewport },
      objectDefinitions: this.objectDefinitions(),
      instances,
      selectedInstanceIds: [...this.selectedInstanceIds],
      lockedInstanceIds: refs
        .filter((ref) => this.lockedKeys.has(this.refKey(ref)))
        .map((ref) => this.refId(ref)),
      ...(this.selectedInstanceId === undefined
        ? {}
        : { selectedInstanceId: this.selectedInstanceId }),
      ...(this.hoveredInstanceId === undefined
        ? {}
        : { hoveredInstanceId: this.hoveredInstanceId }),
      ...(this.pointerWorld === undefined
        ? {}
        : { pointerWorld: { ...this.pointerWorld } }),
      ...(selected === undefined ? {} : { selected }),
      ...(draftPatch === undefined ? {} : { draftPatch }),
    };
  }

  selectInstance(instanceId?: string): ScenePlacementViewerState {
    return this.selectInstances(instanceId === undefined ? [] : [instanceId]);
  }

  selectInstances(instanceIds: readonly string[]): ScenePlacementViewerState {
    const unique = [...new Set(instanceIds)];
    this.checkedRefs(unique, "scenePlacementViewer.selectInstances", false);
    this.selectedInstanceIds = unique;
    return this.state();
  }

  setInstancesLocked(
    instanceIds: readonly string[],
    locked: boolean,
  ): ScenePlacementViewerState {
    if (this.historyState().transactionLabel !== undefined)
      throw new Error("Finish the current edit before changing locks.");
    const refs = this.checkedRefs(
      [...new Set(instanceIds)],
      "scenePlacementViewer.setInstancesLocked",
      false,
    );
    for (const ref of refs) {
      if (locked) this.lockedKeys.add(this.refKey(ref));
      else this.lockedKeys.delete(this.refKey(ref));
    }
    if (
      this.hoveredInstanceId &&
      refs.some((ref) => this.refId(ref) === this.hoveredInstanceId)
    )
      this.hoveredInstanceId = undefined;
    return this.state();
  }

  selectInstanceAtScreen(
    point: ScenePlacementPoint,
  ): ScenePlacementViewerState {
    this.pointerWorld = screenToSceneWorld(this.viewport, point);
    const id = this.pickInstanceIdAtWorld(this.pointerWorld);
    this.selectedInstanceIds = id === undefined ? [] : [id];
    return this.state();
  }

  hoverInstance(instanceId?: string): ScenePlacementViewerState {
    this.hoveredInstanceId = this.optionalKnownInstanceId(
      instanceId,
      "scenePlacementViewer.hoveredInstanceId",
    );
    return this.state();
  }

  hoverInstanceAtScreen(
    point?: ScenePlacementPoint,
  ): ScenePlacementViewerState {
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
    this.pointerWorld =
      point === undefined
        ? undefined
        : screenToSceneWorld(this.viewport, point);
    return this.state();
  }

  pickInstanceAtScreen(
    point: ScenePlacementPoint,
  ): ScenePlacementViewerInstance | undefined {
    const instanceId = this.pickInstanceIdAtWorld(
      screenToSceneWorld(this.viewport, point),
    );
    const ref =
      instanceId === undefined ? undefined : this.instanceRefForId(instanceId);
    return ref === undefined ? undefined : this.viewerInstance(ref);
  }

  updateInstanceTransform(
    instanceId: string,
    transform: Partial<ScenePlacementTransform>,
  ): ScenePlacementViewerState {
    return this.updateInstanceTransforms([{ instanceId, transform }]);
  }

  updateInstanceTransforms(
    updates: readonly {
      instanceId: string;
      transform: Partial<ScenePlacementTransform>;
    }[],
  ): ScenePlacementViewerState {
    return this.edit("Transform", () => {
      const refs = this.checkedRefs(
        updates.map((update) => update.instanceId),
        "scenePlacementViewer.updateInstanceTransform",
      );
      const patches = updates.map((update) =>
        validatedTransformPatch(
          update.transform,
          "scenePlacementViewer.updateInstanceTransform.transform",
        ),
      );
      refs.forEach((ref, index) =>
        this.applyTransformDraft(ref, patches[index]),
      );
      this.pickBounds = this.createPickBounds(this.path);
      return this.state();
    });
  }

  private applyTransformDraft(
    ref: ScenePlacementInstanceRef,
    patch: Partial<ScenePlacementTransform>,
  ): void {
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
  }

  updateInstanceComponents(
    instanceId: string,
    components: SceneCompositionJsonValue,
  ): ScenePlacementViewerState {
    return this.edit("Components", () =>
      this.updateInstanceComponentsDraft(instanceId, components),
    );
  }

  private updateInstanceComponentsDraft(
    instanceId: string,
    components: SceneCompositionJsonValue,
  ): ScenePlacementViewerState {
    const ref = this.knownInstanceRef(
      instanceId,
      "scenePlacementViewer.updateInstanceComponents.instanceId",
    );
    this.assertUnlocked(ref);
    const patch = validatedComponentsPatch(
      components,
      "scenePlacementViewer.updateInstanceComponents.components",
    );
    if (ref.kind === "added") {
      ref.draft.instance = {
        ...ref.draft.instance,
        props: {
          ...(ref.draft.instance.props ?? {}),
          [DATA_SCENE_COMPONENTS_PROP]: patch,
        },
      };
    } else if (
      sameSceneCompositionJsonValue(
        ref.instance.props[DATA_SCENE_COMPONENTS_PROP],
        patch,
      )
    ) {
      this.assertFlatInstancePatch(
        ref.instance,
        "scenePlacementViewer.updateInstanceComponents.instanceId",
      );
      this.draftComponents.delete(ref.instance.id);
    } else {
      this.assertFlatInstancePatch(
        ref.instance,
        "scenePlacementViewer.updateInstanceComponents.instanceId",
      );
      this.draftComponents.set(ref.instance.id, patch);
    }
    this.pickBounds = this.createPickBounds(this.path);
    return this.state();
  }

  updateBehaviorBinding(
    target: ScenePlacementBehaviorBindingTarget,
    behaviorRecipes: ScenePlacementBehaviorBindingPatch,
  ): ScenePlacementViewerState {
    return this.edit("Behavior Binding", () =>
      this.updateBehaviorBindingDraft(target, behaviorRecipes),
    );
  }

  private updateBehaviorBindingDraft(
    target: ScenePlacementBehaviorBindingTarget,
    behaviorRecipes: ScenePlacementBehaviorBindingPatch,
  ): ScenePlacementViewerState {
    const patch = validatedBehaviorBindingPatch(
      behaviorRecipes,
      "scenePlacementViewer.updateBehaviorBinding.behaviorRecipes",
    );
    const behaviorProp = this.behaviorBindingProp();
    if (target.kind === "instance") {
      const ref = this.knownInstanceRef(
        target.instanceId,
        "scenePlacementViewer.updateBehaviorBinding.target.instanceId",
      );
      this.assertUnlocked(ref);
      if (ref.kind === "added") {
        ref.draft.instance = instanceWithBehaviorBinding(
          ref.draft.instance,
          patch,
          behaviorProp,
        );
      } else if (
        sameBehaviorBindingPatch(ref.instance.props[behaviorProp], patch)
      ) {
        this.assertFlatInstancePatch(
          ref.instance,
          "scenePlacementViewer.updateBehaviorBinding.target.instanceId",
        );
        this.draftInstanceBehaviorBindings.delete(ref.instance.id);
      } else {
        this.assertFlatInstancePatch(
          ref.instance,
          "scenePlacementViewer.updateBehaviorBinding.target.instanceId",
        );
        this.draftInstanceBehaviorBindings.set(ref.instance.id, patch);
      }
      this.pickBounds = this.createPickBounds(this.path);
      return this.state();
    }

    const id = requiredPlacementInstanceId(
      target.id,
      "scenePlacementViewer.updateBehaviorBinding.target.id",
    );
    const draftDefinition = this.draftObjectDefinitions.get(id);
    if (draftDefinition !== undefined) {
      this.draftObjectDefinitions.set(
        id,
        objectDefinitionWithBehaviorBinding(
          draftDefinition,
          patch,
          behaviorProp,
        ),
      );
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

  renameInstance(
    instanceId: string,
    nextInstanceId: string,
  ): ScenePlacementViewerState {
    return this.edit("Rename", () =>
      this.renameInstanceDraft(instanceId, nextInstanceId),
    );
  }

  private renameInstanceDraft(
    instanceId: string,
    nextInstanceId: string,
  ): ScenePlacementViewerState {
    this.assertSpatialReferenceEditable(instanceId);
    const ref = this.knownInstanceRef(
      instanceId,
      "scenePlacementViewer.renameInstance.instanceId",
    );
    this.assertUnlocked(ref);
    const next = requiredPlacementInstanceId(
      nextInstanceId,
      "scenePlacementViewer.renameInstance.nextInstanceId",
    );
    if (
      this.instanceRefForId(next, ref) !== undefined ||
      (next !== (ref.kind === "source" ? ref.instance.id : instanceId) &&
        this.instancesById.has(next))
    ) {
      throw gameplayAuthoringDiagnosticError(
        "scenePlacementViewer.renameInstance.nextInstanceId",
        `scene instance '${next}' already exists`,
      );
    }
    if (next !== instanceId && this.spatial) {
      for (const target of ["billboard", "model"] as const) {
        const map =
          target === "billboard"
            ? this.spatial.billboards
            : this.spatial.models;
        if (map && Object.prototype.hasOwnProperty.call(map, instanceId))
          this.spatial = applySceneSpatialPatch(this.spatial, {
            format: "ferrum2d.scene-spatial.patch",
            version: 3,
            operations: [
              {
                kind: "renameReference",
                id: instanceId,
                changes: { target, nextId: next },
              },
            ],
          });
      }
    }
    if (ref.kind === "added") {
      const origin = this.spatialCopySources.get(instanceId);
      this.spatialCopySources.delete(instanceId);
      if (origin) this.spatialCopySources.set(next, origin);

      ref.draft.instance = {
        ...ref.draft.instance,
        id: next,
      };
    } else if (next === ref.instance.id) {
      this.assertFlatInstancePatch(
        ref.instance,
        "scenePlacementViewer.renameInstance.instanceId",
      );
      this.draftRenames.delete(ref.instance.id);
    } else {
      this.assertFlatInstancePatch(
        ref.instance,
        "scenePlacementViewer.renameInstance.instanceId",
      );
      this.draftRenames.set(ref.instance.id, next);
    }
    this.retargetSelectedAndHovered(instanceId, next);
    this.pickBounds = this.createPickBounds(this.path);
    return this.state();
  }

  addInstance(
    fragment: string,
    instance: SceneCompositionFragmentInstanceSpec,
    spatial?: ScenePlacementSpatialAddition,
  ): ScenePlacementViewerState {
    return this.edit("Add Instance", () => {
      const state = this.addInstanceDraft(fragment, instance);
      if (spatial) {
        if (spatial.kind !== "addBillboard" && spatial.kind !== "addModel")
          throw new Error(
            "Instance placement requires an addBillboard or addModel reference",
          );
        this.spatial = applySceneSpatialPatch(this.spatial, {
          format: "ferrum2d.scene-spatial.patch",
          version: 2,
          operations: [{ ...spatial, id: state.selectedInstanceId! }],
        });
      }
      return this.state();
    });
  }

  private addInstanceDraft(
    fragment: string,
    instance: SceneCompositionFragmentInstanceSpec,
  ): ScenePlacementViewerState {
    const checkedFragment = requiredPlacementInstanceId(
      fragment,
      "scenePlacementViewer.addInstance.fragment",
    );
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
    const instanceId = requiredPlacementInstanceId(
      checkedInstance.id,
      "scenePlacementViewer.addInstance.instance.id",
    );
    validateDraftInstancePrefab(
      (prefabId) => this.prefabForId(prefabId),
      checkedInstance,
      "scenePlacementViewer.addInstance.instance",
    );
    if (
      this.instanceRefForId(instanceId) !== undefined ||
      this.instancesById.has(instanceId)
    ) {
      throw gameplayAuthoringDiagnosticError(
        "scenePlacementViewer.addInstance.instance.id",
        `scene instance '${instanceId}' already exists or is reserved until save`,
      );
    }
    this.draftAddedInstances.push({
      key: this.nextDraftKey++,
      fragment: checkedFragment,
      instance: checkedInstance,
    });
    this.selectedInstanceIds = [instanceId];
    this.pickBounds = this.createPickBounds(this.path);
    return this.state();
  }

  addObjectDefinition(
    id: string,
    definition: SceneCompositionPrefabSpec,
  ): ScenePlacementViewerState {
    return this.edit("Add Definition", () =>
      this.addObjectDefinitionDraft(id, definition),
    );
  }

  private addObjectDefinitionDraft(
    id: string,
    definition: SceneCompositionPrefabSpec,
  ): ScenePlacementViewerState {
    const checkedId = requiredPlacementInstanceId(
      id,
      "scenePlacementViewer.addObjectDefinition.id",
    );
    if (
      this.prefabForId(checkedId) !== undefined ||
      this.draftObjectDefinitions.has(checkedId)
    ) {
      throw gameplayAuthoringDiagnosticError(
        "scenePlacementViewer.addObjectDefinition.id",
        `object definition '${checkedId}' already exists`,
      );
    }
    this.draftObjectDefinitions.set(
      checkedId,
      validatedObjectDefinitionPatch(
        definition,
        "scenePlacementViewer.addObjectDefinition.definition",
      ),
    );
    return this.state();
  }

  removeInstance(instanceId: string): ScenePlacementViewerState {
    return this.removeInstances([instanceId]);
  }

  duplicateInstances(
    instanceIds: readonly string[],
    offset: ScenePlacementPoint = { x: 16, y: 16 },
  ): ScenePlacementViewerState {
    return this.edit("Duplicate", () => {
      if (!Number.isFinite(offset.x) || !Number.isFinite(offset.y))
        throw new Error("Duplicate offset must be finite");
      const refs = this.checkedRefs(
        instanceIds,
        "scenePlacementViewer.duplicateInstances",
      );
      const selected: string[] = [];
      for (const ref of refs) {
        const source = this.resolvedInstanceForRef(ref);
        const prefab = this.prefabForId(source.prefab)!;
        const defaults = source.variant
          ? prefab.variants[source.variant].props
          : prefab.props;
        for (const [key, value] of Object.entries(source.props))
          if (
            key !== DATA_SCENE_COMPONENTS_PROP &&
            key !== this.behaviorBindingProp() &&
            JSON.stringify(value) !== JSON.stringify(defaults[key])
          )
            throw new Error(
              "Custom instance props require explicit agent-owned duplication",
            );
        this.assertSpatialReferenceEditable(source.id);
        if (ref.kind === "source")
          this.assertFlatInstancePatch(
            ref.instance,
            "scenePlacementViewer.duplicateInstances",
          );
        let id = "";
        for (let index = 1; index <= 16384; index++)
          if (
            !this.instanceRefForId(source.id + "_copy_" + index) &&
            !this.instancesById.has(source.id + "_copy_" + index)
          ) {
            id = source.id + "_copy_" + index;
            break;
          }
        if (!id) throw new Error("No available duplicate ID");
        this.addInstanceDraft(this.fragment, {
          id,
          prefab: source.prefab,
          ...(source.variant ? { variant: source.variant } : {}),
          ...sourceTransform(source),
          x: source.x + offset.x,
          y: source.y + offset.y,
          ...(source.props.components === undefined
            ? {}
            : {
                props: { components: structuredClone(source.props.components) },
              }),
        });
        const binding = behaviorBindingPatchFromProps(
          source.props,
          this.behaviorBindingProp(),
        );
        if (binding !== undefined)
          this.updateBehaviorBindingDraft(
            { kind: "instance", instanceId: id },
            binding,
          );
        if (this.spatial)
          for (const target of ["billboard", "model"] as const) {
            const map =
              target === "billboard"
                ? this.spatial.billboards
                : this.spatial.models;
            if (map && Object.prototype.hasOwnProperty.call(map, source.id))
              this.spatial = applySceneSpatialPatch(this.spatial, {
                format: "ferrum2d.scene-spatial.patch",
                version: 3,
                operations: [
                  {
                    kind: "copyReference",
                    id,
                    changes: { target, sourceId: source.id },
                  },
                ],
              });
          }
        const origin =
          ref.kind === "source"
            ? ref.instance.id
            : this.spatialCopySources.get(source.id);
        if (origin) this.spatialCopySources.set(id, origin);
        selected.push(id);
      }
      this.selectedInstanceIds = selected;
      this.pickBounds = this.createPickBounds(this.path);
      return this.state();
    });
  }

  removeInstances(instanceIds: readonly string[]): ScenePlacementViewerState {
    return this.edit("Remove Instance", () => {
      const refs = this.checkedRefs(
        instanceIds,
        "scenePlacementViewer.removeInstance.instanceId",
      );
      for (const id of instanceIds) this.assertSpatialReferenceEditable(id);
      for (const ref of refs)
        if (ref.kind === "source")
          this.assertFlatInstancePatch(
            ref.instance,
            "scenePlacementViewer.removeInstance.instanceId",
          );
      if (this.spatial)
        for (const id of instanceIds)
          for (const target of ["billboard", "model"] as const) {
            const map =
              target === "billboard"
                ? this.spatial.billboards
                : this.spatial.models;
            if (map && Object.prototype.hasOwnProperty.call(map, id))
              this.spatial = applySceneSpatialPatch(this.spatial, {
                format: "ferrum2d.scene-spatial.patch",
                version: 3,
                operations: [
                  { kind: "removeReference", id, changes: { target } },
                ],
              });
          }
      const added = new Set(
        refs
          .filter((ref) => ref.kind === "added")
          .map((ref) => this.refKey(ref)),
      );
      for (
        let index = this.draftAddedInstances.length - 1;
        index >= 0;
        index--
      ) {
        if (added.has(`added:${this.draftAddedInstances[index].key}`))
          this.draftAddedInstances.splice(index, 1);
      }
      for (const ref of refs) {
        this.clearSelectedAndHovered(this.refId(ref));
        if (ref.kind === "added") {
          this.spatialCopySources.delete(this.refId(ref));
          continue;
        }
        this.draftRemovedInstanceIds.add(ref.instance.id);
        this.draftTransforms.delete(ref.instance.id);
        this.draftComponents.delete(ref.instance.id);
        this.draftInstanceBehaviorBindings.delete(ref.instance.id);
        this.draftRenames.delete(ref.instance.id);
      }
      this.pruneSelectionAndLocks();
      this.pickBounds = this.createPickBounds(this.path);
      return this.state();
    });
  }

  clearDraftPatch(): ScenePlacementViewerState {
    return this.edit("Revert", () => this.clearDraftPatchDraft());
  }

  private clearDraftPatchDraft(): ScenePlacementViewerState {
    this.spatial = structuredClone(this.sourceSpatial);
    this.draftTransforms.clear();
    this.draftComponents.clear();
    this.draftInstanceBehaviorBindings.clear();
    this.draftObjectDefinitionBehaviorBindings.clear();
    this.draftRenames.clear();
    this.spatialCopySources.clear();
    this.draftRemovedInstanceIds.clear();
    this.draftObjectDefinitions.clear();
    this.draftAddedInstances.splice(0);
    this.pruneSelectionAndLocks();
    this.hoveredInstanceId = this.retainedKnownInstanceId(
      this.hoveredInstanceId,
    );
    this.pickBounds = this.createPickBounds(this.path);
    return this.state();
  }

  updateViewport(
    viewport: ScenePlacementViewport | ScenePlacementViewportOptions,
  ): ScenePlacementViewerState {
    this.viewport = scenePlacementViewport(
      viewport,
      "scenePlacementViewer.viewport",
    );
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
          const placement = this.placementsById.get(instance.id);
          if (placement === undefined || isFlatPlacement(instance, placement)) {
            operations.push({
              kind: "updateTransform",
              instanceId: currentId,
              transform,
            });
          } else {
            operations.push({
              kind: "updateResolvedTransform",
              instanceId: currentId,
              target: placementTransformTarget(placement),
              transform: inversePlacementTransform(
                placement.parentTransform,
                draft,
              ),
            });
          }
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
            this.draftInstanceBehaviorBindings.get(
              instance.id,
            ) as ScenePlacementBehaviorBindingPatch,
          ),
        });
      }
    }
    for (const [id, behaviorRecipes] of this
      .draftObjectDefinitionBehaviorBindings) {
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
      const behaviorRecipes = behaviorBindingPatchFromProps(
        definition.props,
        this.behaviorBindingProp(),
      );
      operations.push({
        kind: "addObjectDefinition",
        id,
        definition: copyObjectDefinitionWithoutBehaviorBinding(
          definition,
          this.behaviorBindingProp(),
        ),
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
      const behaviorRecipes = behaviorBindingPatchFromProps(
        draft.instance.props,
        this.behaviorBindingProp(),
      );
      operations.push({
        kind: "addInstance",
        fragment: draft.fragment,
        instance: copyInstanceWithoutBehaviorBinding(
          draft.instance,
          this.behaviorBindingProp(),
        ),
      });
      if (behaviorRecipes !== undefined) {
        operations.push({
          kind: "updateBehaviorBinding",
          target: {
            kind: "instance",
            instanceId: requiredPlacementInstanceId(
              draft.instance.id,
              "scenePlacementViewer.draftAddedInstances.id",
            ),
          },
          behaviorRecipes,
        });
      }
    }
    const spatial = diffSceneSpatialPatch(
      this.sourceSpatial,
      this.spatial,
      this.draftRenames,
      this.spatialCopySources,
    );
    if (operations.length === 0 && !spatial) {
      return undefined;
    }
    return {
      format: SCENE_PLACEMENT_PATCH_FORMAT,
      version: spatial ? 3 : SCENE_PLACEMENT_PATCH_VERSION,
      ...(spatial ? { spatial } : {}),
      operations,
    };
  }

  private viewerInstance(
    ref: ScenePlacementInstanceRef,
  ): ScenePlacementViewerInstance {
    const instance = this.resolvedInstanceForRef(ref);
    const classification = classifySceneInstance(instance, {
      behaviorProp: this.behaviorProp,
      path: `scenePlacementViewer.instances.${instance.id}`,
    });
    const entityInstanceId =
      ref.kind === "source" ? ref.instance.id : instance.id;
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
      ...(components === undefined
        ? {}
        : {
            visual: copyResolvedDataSceneObjectVisual(components.visual),
            collider: copyResolvedDataSceneCollider(components.collider),
            componentLayer: { ...components.layer },
            ...copyDataSceneBody(components.body),
          }),
      behaviorProfiles: [...classification.behaviorProfiles],
      ...(entity === undefined
        ? {}
        : { entity: copyGameplayEntityHandle(entity) }),
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
        ),
      ),
      ...Array.from(this.draftObjectDefinitions, ([id, definition]) =>
        resolvedDraftObjectDefinition(
          id,
          definition,
          "scenePlacementViewer.draftObjectDefinitions",
        ),
      ),
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
        ...(components === undefined
          ? {}
          : {
              visual: copyResolvedDataSceneObjectVisual(components.visual),
              collider: copyResolvedDataSceneCollider(components.collider),
              componentLayer: { ...components.layer },
              ...copyDataSceneBody(components.body),
            }),
        behaviorProfiles: behaviorProfilesForProps(
          prefab.props,
          this.behaviorBindingProp(),
          `scenePlacementViewer.objectDefinitions.${prefab.id}.props`,
        ),
      };
    });
  }

  private transformFor(
    instance: ResolvedSceneCompositionInstance,
  ): ScenePlacementTransform {
    const source =
      this.instancesById.get(instance.sourceId) ??
      this.instancesById.get(instance.id);
    if (source !== undefined) {
      return this.draftTransforms.get(source.id) ?? sourceTransform(instance);
    }
    return sourceTransform(instance);
  }

  private createPickBounds(path: string): readonly ScenePlacementPickBounds[] {
    const bounds: ScenePlacementPickBounds[] = [];
    for (const ref of this.visibleInstanceRefs()) {
      const instance = this.resolvedInstanceForRef(ref);
      const components = this.inlineComponentsForInstance(
        instance,
        `${path}.instances.${instance.id}`,
      );
      if (components === undefined) {
        continue;
      }
      const transform = this.transformFor(instance);
      const geometry = scenePlacementVisualGeometry(
        components.visual,
        transform,
      );
      bounds.push({
        lockKey: this.refKey(ref),
        instanceId: instance.id,
        ...geometry,
        cos: Math.cos(geometry.rotationRadians),
        sin: Math.sin(geometry.rotationRadians),
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
    const components = resolveDataSceneComponentsSpec(
      props[DATA_SCENE_COMPONENTS_PROP],
      {
        allowTemplate: false,
        path: `${path}.props.${DATA_SCENE_COMPONENTS_PROP}`,
      },
    );
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
      : resolvedDraftObjectDefinition(
          id,
          draft,
          "scenePlacementViewer.draftObjectDefinitions",
        );
  }

  private pickInstanceIdAtWorld(
    point: ScenePlacementPoint,
  ): string | undefined {
    for (let index = this.pickBounds.length - 1; index >= 0; index -= 1) {
      const bounds = this.pickBounds[index];
      if (bounds === undefined || this.lockedKeys.has(bounds.lockKey)) {
        continue;
      }
      const dx = point.x - bounds.x;
      const dy = point.y - bounds.y;
      const localX = dx * bounds.cos + dy * bounds.sin;
      const localY = -dx * bounds.sin + dy * bounds.cos;
      if (
        Math.abs(localX) <= bounds.width * 0.5 &&
        Math.abs(localY) <= bounds.height * 0.5
      ) {
        return bounds.instanceId;
      }
    }
    return undefined;
  }

  private optionalKnownInstanceId(
    instanceId: string | undefined,
    path: string,
  ): string | undefined {
    if (instanceId === undefined) {
      return undefined;
    }
    if (this.instanceRefForId(instanceId) === undefined) {
      throw gameplayAuthoringDiagnosticError(
        path,
        `references unknown scene instance '${instanceId}'`,
      );
    }
    return instanceId;
  }

  private knownInstanceRef(
    instanceId: string,
    path: string,
  ): ScenePlacementInstanceRef {
    const ref = this.instanceRefForId(instanceId);
    if (ref === undefined) {
      throw gameplayAuthoringDiagnosticError(
        path,
        `references unknown scene instance '${instanceId}'`,
      );
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
    this.draftAddedInstances.forEach((draft, index) =>
      refs.push({ kind: "added", draft, index }),
    );
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

  private resolvedInstanceForRef(
    ref: ScenePlacementInstanceRef,
  ): ResolvedSceneCompositionInstance {
    if (ref.kind === "source") {
      const currentId = this.currentInstanceId(ref.instance.id);
      const transform =
        this.draftTransforms.get(ref.instance.id) ??
        sourceTransform(ref.instance);
      const props: Record<string, SceneCompositionJsonValue> = {
        ...ref.instance.props,
      };
      if (this.draftComponents.has(ref.instance.id)) {
        props[DATA_SCENE_COMPONENTS_PROP] = this.draftComponents.get(
          ref.instance.id,
        ) as SceneCompositionJsonValue;
      }
      if (this.draftInstanceBehaviorBindings.has(ref.instance.id)) {
        props[this.behaviorBindingProp()] = behaviorBindingPropsValue(
          this.draftInstanceBehaviorBindings.get(
            ref.instance.id,
          ) as ScenePlacementBehaviorBindingPatch,
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

  private refId(ref: ScenePlacementInstanceRef): string {
    return ref.kind === "source"
      ? this.currentInstanceId(ref.instance.id)
      : String(ref.draft.instance.id);
  }

  private refKey(ref: ScenePlacementInstanceRef): string {
    return ref.kind === "source"
      ? `source:${ref.instance.id}`
      : `added:${ref.draft.key}`;
  }

  private assertUnlocked(ref: ScenePlacementInstanceRef): void {
    if (this.lockedKeys.has(this.refKey(ref)))
      throw new Error(
        `Scene instance '${this.refId(ref)}' is locked. Unlock it before editing.`,
      );
  }

  private checkedRefs(
    ids: readonly string[],
    path: string,
    unlocked = true,
  ): ScenePlacementInstanceRef[] {
    const byId = new Map(
      this.visibleInstanceRefs().map((ref) => [this.refId(ref), ref]),
    );
    const seen = new Set<string>();
    return ids.map((id) => {
      const ref = byId.get(id);
      if (!ref)
        throw gameplayAuthoringDiagnosticError(
          path,
          `references unknown scene instance '${id}'`,
        );
      if (seen.has(id))
        throw gameplayAuthoringDiagnosticError(
          path,
          `duplicate scene instance '${id}'`,
        );
      seen.add(id);
      if (unlocked) this.assertUnlocked(ref);
      return ref;
    });
  }

  private pruneSelectionAndLocks(): void {
    const refs = this.visibleInstanceRefs();
    const ids = new Set(refs.map((ref) => this.refId(ref)));
    const keys = new Set(refs.map((ref) => this.refKey(ref)));
    this.selectedInstanceIds = this.selectedInstanceIds.filter((id) =>
      ids.has(id),
    );
    // Locks are UI state, outside history. Retain hidden identities until a draft
    // edit/gesture succeeds so cancel and failed validation cannot unlock objects.
    if (
      !this.editingDraft &&
      this.history.state().transactionLabel === undefined
    )
      for (const key of this.lockedKeys)
        if (!keys.has(key)) this.lockedKeys.delete(key);
  }

  private retargetSelectedAndHovered(previous: string, next: string): void {
    this.selectedInstanceIds = this.selectedInstanceIds.map((id) =>
      id === previous ? next : id,
    );
    if (this.hoveredInstanceId === previous) {
      this.hoveredInstanceId = next;
    }
  }

  private clearSelectedAndHovered(instanceId: string): void {
    this.selectedInstanceIds = this.selectedInstanceIds.filter(
      (id) => id !== instanceId,
    );
    if (this.hoveredInstanceId === instanceId) {
      this.hoveredInstanceId = undefined;
    }
  }

  private retainedKnownInstanceId(
    instanceId: string | undefined,
  ): string | undefined {
    return instanceId === undefined ||
      this.instanceRefForId(instanceId) === undefined
      ? undefined
      : instanceId;
  }

  private behaviorBindingProp(): string {
    return this.behaviorProp ?? GAMEPLAY_BEHAVIOR_BINDING_PROP;
  }

  private assertFlatInstancePatch(
    instance: ResolvedSceneCompositionInstance,
    path: string,
  ): void {
    const placement = this.placementsById.get(instance.id);
    if (placement !== undefined && !isFlatPlacement(instance, placement)) {
      throw gameplayAuthoringDiagnosticError(
        path,
        "included scene instances currently support transform patches only",
      );
    }
  }
}

interface ScenePlacementDraftAddedInstance {
  key: number;
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
  const prefabId = requiredPlacementInstanceId(
    instance.prefab,
    `${path}.prefab`,
  );
  const prefab = prefabForId(prefabId);
  if (prefab === undefined) {
    throw gameplayAuthoringDiagnosticError(
      `${path}.prefab`,
      `references unknown prefab '${prefabId}'`,
    );
  }
  const variantId =
    instance.variant === undefined
      ? undefined
      : requiredPlacementInstanceId(instance.variant, `${path}.variant`);
  const variant =
    variantId === undefined ? undefined : prefab.variants[variantId];
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
    props: mergeScenePlacementProps(
      variant?.props ?? prefab.props,
      instance.props ?? {},
    ),
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
    rotationRadians: finiteTransformNumber(
      instance.rotationRadians ?? 0,
      `${path}.rotationRadians`,
    ),
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
    result[key] =
      key !== DATA_SCENE_COMPONENTS_PROP &&
      isScenePlacementJsonObject(previous) &&
      isScenePlacementJsonObject(value)
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
      operationCount:
        (patch?.operations.length ?? 0) +
        (patch?.spatial?.operations.length ?? 0),
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

interface ScenePlacementPickBounds extends ScenePlacementVisualGeometry {
  lockKey: string;
  instanceId: string;
  cos: number;
  sin: number;
}

function viewerComposition(
  options: CreateScenePlacementViewerOptions,
  path: string,
): ResolvedSceneCompositionSpec {
  if (
    options.document !== undefined &&
    options.sceneComposition !== undefined
  ) {
    throw gameplayAuthoringDiagnosticError(
      path,
      "must provide either document or sceneComposition, not both",
    );
  }
  if (options.document !== undefined) {
    return resolveSceneAuthoringDocument(options.document, {
      path: `${path}.document`,
    }).sceneComposition;
  }
  if (options.sceneComposition !== undefined) {
    return resolveSceneCompositionSpec(options.sceneComposition, {
      path: `${path}.sceneComposition`,
    });
  }
  throw gameplayAuthoringDiagnosticError(
    path,
    "must provide document or sceneComposition",
  );
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
    throw gameplayAuthoringDiagnosticError(
      path,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function isScenePlacementViewport(
  viewport: ScenePlacementViewport | ScenePlacementViewportOptions,
): viewport is ScenePlacementViewport {
  return (
    typeof (viewport as Partial<ScenePlacementViewport>).worldMinX ===
      "number" &&
    typeof (viewport as Partial<ScenePlacementViewport>).worldMaxX ===
      "number" &&
    typeof (viewport as Partial<ScenePlacementViewport>).worldWidth ===
      "number" &&
    typeof (viewport as Partial<ScenePlacementViewport>).worldHeight ===
      "number"
  );
}

function copyGameplayEntityHandle(
  handle: GameplayEntityHandle,
): GameplayEntityHandle {
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
    ...(visual.animation === undefined
      ? {}
      : { animation: { ...visual.animation } }),
    originX: visual.originX,
    originY: visual.originY,
    ...(visual.layer === undefined ? {} : { layer: visual.layer }),
    ...(visual.sortOrder === undefined ? {} : { sortOrder: visual.sortOrder }),
    ...(visual.depthSort === undefined ? {} : { depthSort: visual.depthSort }),
    ...(visual.tint === undefined ? {} : { tint: visual.tint }),
    ...(visual.color === undefined ? {} : { color: visual.color }),
    bounds: { ...visual.bounds },
  };
}

function copyDataSceneBody(body: DataSceneBodySpec | undefined): {
  body?: DataSceneBodySpec;
} {
  return body === undefined
    ? {}
    : {
        body: {
          ...body,
          ...(body.heightSpan === undefined
            ? {}
            : { heightSpan: { ...body.heightSpan } }),
          ...(body.type !== "dynamic" || body.material === undefined
            ? {}
            : { material: { ...body.material } }),
        },
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

function sourceTransform(
  instance: ResolvedSceneCompositionInstance,
): ScenePlacementTransform {
  return {
    x: instance.x,
    y: instance.y,
    rotationRadians: instance.rotationRadians,
    scale: instance.scale,
    layer: instance.layer,
  };
}

function isFlatPlacement(
  instance: ResolvedSceneCompositionInstance,
  placement: SceneCompositionInstancePlacement,
): boolean {
  return (
    placement.kind === "fragmentInstance" &&
    placement.instanceId === instance.id &&
    placement.parentTransform.x === 0 &&
    placement.parentTransform.y === 0 &&
    placement.parentTransform.rotationRadians === 0 &&
    placement.parentTransform.scale === 1 &&
    placement.parentTransform.layer === 0
  );
}

function placementTransformTarget(
  placement: SceneCompositionInstancePlacement,
): ScenePlacementResolvedTransformTarget {
  if (placement.kind === "fragmentInstance") {
    return {
      kind: placement.kind,
      fragment: placement.fragment,
      instanceId: placement.instanceId,
    };
  }
  return {
    kind: placement.kind,
    fragment: placement.fragment,
    includeIndex: placement.includeIndex,
    includedFragment: placement.includedFragment,
    instanceId: placement.instanceId,
  };
}

function inversePlacementTransform(
  parent: ScenePlacementTransform,
  world: ScenePlacementTransform,
): ScenePlacementTransform {
  const deltaX = world.x - parent.x;
  const deltaY = world.y - parent.y;
  const cos = Math.cos(parent.rotationRadians);
  const sin = Math.sin(parent.rotationRadians);
  return {
    x: (deltaX * cos + deltaY * sin) / parent.scale,
    y: (-deltaX * sin + deltaY * cos) / parent.scale,
    rotationRadians: world.rotationRadians - parent.rotationRadians,
    scale: world.scale / parent.scale,
    layer: world.layer - parent.layer,
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
    patch.rotationRadians = finiteTransformNumber(
      transform.rotationRadians,
      `${path}.rotationRadians`,
    );
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
    throw gameplayAuthoringDiagnosticError(
      path,
      "must be a positive finite number",
    );
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
    throw gameplayAuthoringDiagnosticError(
      path,
      error instanceof Error ? error.message : String(error),
    );
  }
  return copy;
}

function sameTransform(
  left: ScenePlacementTransform,
  right: ScenePlacementTransform,
): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.rotationRadians === right.rotationRadians &&
    left.scale === right.scale &&
    left.layer === right.layer
  );
}

function transformDiff(
  source: ScenePlacementTransform,
  next: ScenePlacementTransform,
): Partial<ScenePlacementTransform> {
  const patch: Partial<ScenePlacementTransform> = {};
  if (source.x !== next.x) patch.x = next.x;
  if (source.y !== next.y) patch.y = next.y;
  if (source.rotationRadians !== next.rotationRadians)
    patch.rotationRadians = next.rotationRadians;
  if (source.scale !== next.scale) patch.scale = next.scale;
  if (source.layer !== next.layer) patch.layer = next.layer;
  return patch;
}

function hasTransformPatch(
  transform: Partial<ScenePlacementTransform>,
): boolean {
  return (
    transform.x !== undefined ||
    transform.y !== undefined ||
    transform.rotationRadians !== undefined ||
    transform.scale !== undefined ||
    transform.layer !== undefined
  );
}

function copyScenePlacementPatch(
  patch: ScenePlacementPatch | undefined,
): ScenePlacementPatch | undefined {
  if (patch === undefined) {
    return undefined;
  }
  return {
    format: patch.format,
    version: patch.version,
    operations: patch.operations.map(copyScenePlacementPatchOperation),
    ...(patch.spatial ? { spatial: structuredClone(patch.spatial) } : {}),
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
    case "updateResolvedTransform":
      return {
        kind: "updateResolvedTransform",
        instanceId: operation.instanceId,
        target: { ...operation.target },
        transform: { ...operation.transform },
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
      ...(variant.props === undefined
        ? {}
        : { props: copySceneCompositionProps(variant.props) }),
    };
  }
  return {
    ...(definition.props === undefined
      ? {}
      : { props: copySceneCompositionProps(definition.props) }),
    ...(Object.keys(copiedVariants).length === 0
      ? {}
      : { variants: copiedVariants }),
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
    ...(instance.rotationRadians === undefined
      ? {}
      : { rotationRadians: instance.rotationRadians }),
    ...(instance.scale === undefined ? {} : { scale: instance.scale }),
    ...(instance.layer === undefined ? {} : { layer: instance.layer }),
    ...(instance.props === undefined
      ? {}
      : { props: copySceneCompositionProps(instance.props) }),
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

function copySceneCompositionJsonValue(
  value: SceneCompositionJsonValue,
): SceneCompositionJsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return (value as readonly SceneCompositionJsonValue[]).map(
      copySceneCompositionJsonValue,
    );
  }
  return copySceneCompositionProps(
    value as Readonly<Record<string, SceneCompositionJsonValue>>,
  );
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
      throw gameplayAuthoringDiagnosticError(
        path,
        "must be a non-empty behavior profile string",
      );
    }
    return behaviorRecipes;
  }
  if (Array.isArray(behaviorRecipes)) {
    return behaviorRecipes.map((entry, index) => {
      if (typeof entry !== "string" || entry.length === 0) {
        throw gameplayAuthoringDiagnosticError(
          `${path}.${index}`,
          "must be a non-empty behavior profile string",
        );
      }
      return entry;
    });
  }
  throw gameplayAuthoringDiagnosticError(
    path,
    "must be null, a behavior profile string, or a string array",
  );
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
      requiredPlacementInstanceId(
        variant.extends,
        `${path}.variants.${variantId}.extends`,
      );
    }
    validatePlacementDefinitionProps(
      variant.props,
      `${path}.variants.${variantId}.props`,
    );
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
    validatedComponentsPatch(
      components,
      `${path}.${DATA_SCENE_COMPONENTS_PROP}`,
    );
  }
}

function resolvedDraftObjectDefinition(
  id: string,
  definition: SceneCompositionPrefabSpec,
  path: string,
): ResolvedSceneCompositionPrefab {
  const variants = definition.variants ?? {};
  const resolvedVariants: Record<
    string,
    ResolvedSceneCompositionPrefab["variants"][string]
  > = {};
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

function copyTransformPatch(
  transform: Partial<ScenePlacementTransform>,
): Partial<ScenePlacementTransform> {
  const copy: Partial<ScenePlacementTransform> = {};
  if (transform.x !== undefined) copy.x = transform.x;
  if (transform.y !== undefined) copy.y = transform.y;
  if (transform.rotationRadians !== undefined)
    copy.rotationRadians = transform.rotationRadians;
  if (transform.scale !== undefined) copy.scale = transform.scale;
  if (transform.layer !== undefined) copy.layer = transform.layer;
  return copy;
}

function replaceDraftMap<T>(
  target: Map<string, T>,
  entries: readonly (readonly [string, T])[],
): void {
  target.clear();
  for (const [key, value] of entries) target.set(key, value);
}
