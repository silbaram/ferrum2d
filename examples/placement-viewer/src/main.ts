import {
  createFerrumRuntime,
  diagnosticReport,
  type FerrumRuntime,
  type FerrumRuntimeFrame,
} from "@ferrum2d/ferrum-web";
import {
  FERRUM_AUTHORING_VIEWER_TITLE,
  appendAuthoringViewerCheckboxControl,
  appendAuthoringViewerKeyValueRow as appendRow,
  appendAuthoringViewerNumberControl,
  appendAuthoringViewerSelectControl,
  appendAuthoringViewerTextControl,
  appendAuthoringViewerTextareaControl,
  formatAuthoringViewerNumber as formatNumber,
  formatAuthoringViewerBehaviorProfiles,
  readAuthoringViewerNumberInput as numberInputValue,
  setAuthoringViewerNumberInputValue as setNumberInputValue,
} from "@ferrum2d/authoring-viewer";
import {
  DATA_SCENE_MAX_CONVEX_POLYGON_VERTICES,
  DATA_SCENE_PRIMITIVE_TEXTURES,
  applySceneBehaviorRecipes,
  createDataSceneRuntimeTarget,
  createScenePlacementAgentHandoff,
  createScenePlacementAssetProviderFromProjectAssets,
  createSceneInstanceHandleRegistry,
  createScenePlacementViewer,
  dataSceneObjectVisualBounds,
  previewScenePlacementBindingMigration,
  resolveDataSceneInstanceComponents,
  resolveSceneAuthoringDocument,
  saveScenePlacementPatch,
  snapSceneWorldPoint,
  worldToSceneScreen,
  type DataSceneCollisionLayerName,
  type DataScenePrimitiveVisualShape,
  type ResolvedDataSceneColliderComponent,
  type ResolvedDataSceneObjectVisual,
  type ResolvedDataSceneSpriteFrame,
  type ResolvedSceneAuthoringDocument,
  type SceneAuthoringDocumentSpec,
  type SceneCompositionFragmentInstanceSpec,
  type ScenePlacementBehaviorBindingPatch,
  type ScenePlacementBehaviorBindingTarget,
  type ScenePlacementBindingMigrationPreview,
  type ScenePlacementAgentHandoff,
  type ScenePlacementAssetDiagnostic,
  type ScenePlacementPatch,
  type ScenePlacementPatchSaveResult,
  type ScenePlacementSaveAdapter,
  type ScenePlacementAssetProvider,
  type ScenePlacementPoint,
  type ScenePlacementSpriteFrameAsset,
  type ScenePlacementTransform,
  type ScenePlacementViewer,
  type ScenePlacementViewerInstance,
  type ScenePlacementViewerState,
} from "@ferrum2d/ferrum-web/authoring";

import {
  createRuntimeDemoShell,
  renderRuntimeDemoError,
} from "../../shared/runtimeDemoShell";
import "../../shared/runtimeDemoShell.css";
import "./styles.css";

const SCENE_DOCUMENT_URL = "./placement.scene-authoring.json";
const SCENE_DOCUMENT_SAVE_ENDPOINT = "/__ferrum-placement-save";
const DEFAULT_SNAP_GRID_SIZE = 16;
const KEYBOARD_NUDGE_STEP = 1;
const KEYBOARD_FAST_MULTIPLIER = 10;
const PLACEMENT_RESIZE_MIN_SIZE = 4;
const MASS_AUTHORING_INSTANCE_COUNT = 1024;
const MASS_AUTHORING_COLUMNS = 32;
const MASS_AUTHORING_START_X = 500;
const MASS_AUTHORING_START_Y = 304;
const MASS_AUTHORING_STEP_X = 19;
const MASS_AUTHORING_STEP_Y = 11;
const DEFAULT_PRIMITIVE_COLOR = "#7ddc9d";
const DEFAULT_POINT_COLOR = "#f2c14e";
const PLACEMENT_COLLISION_LAYERS = ["player", "enemy", "bullet", "wall", "pickup"] as const satisfies readonly DataSceneCollisionLayerName[];
const PLACEMENT_TEXTURES = {
  floor: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPwCgv6DwAD0gHyPaP/ZQAAAABJRU5ErkJggg==",
  crate: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGM4MsHjPwAGVAKcjTneKQAAAABJRU5ErkJggg==",
  turret: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOI2FL3HwAFfAKKSdpdewAAAABJRU5ErkJggg==",
  agent: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNIWHbnPwAGLgLidJoamwAAAABJRU5ErkJggg==",
} as const;
const VIEWER_TEXTURES = {
  ...PLACEMENT_TEXTURES,
  [DATA_SCENE_PRIMITIVE_TEXTURES.rect]: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNIWHbnPwAGLgLidJoamwAAAABJRU5ErkJggg==",
  [DATA_SCENE_PRIMITIVE_TEXTURES.circle]: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOI2FL3HwAFfAKKSdpdewAAAABJRU5ErkJggg==",
  [DATA_SCENE_PRIMITIVE_TEXTURES.point]: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGM4MsHjPwAGVAKcjTneKQAAAABJRU5ErkJggg==",
} as const;
const PLACEMENT_ASSET_PROVIDER = createScenePlacementAssetProviderFromProjectAssets({
  textures: PLACEMENT_TEXTURES,
  atlas: {
    frames: {
      full: {
        texture: "crate",
        uv: { u0: 0, v0: 0, u1: 1, v1: 1 },
        size: { width: 40, height: 40 },
      },
      base: {
        texture: "turret",
        uv: { u0: 0, v0: 0, u1: 0.5, v1: 1 },
        size: { width: 34, height: 42 },
      },
      barrel: {
        texture: "turret",
        uv: { u0: 0.5, v0: 0, u1: 1, v1: 1 },
        size: { width: 34, height: 42 },
      },
    },
  },
  textureMetadata: {
    crate: { label: "Crate", width: 40, height: 40 },
    turret: { label: "Turret", width: 34, height: 42 },
    agent: { label: "Agent", width: 28, height: 28 },
    floor: { label: "Floor", width: 96, height: 64 },
  },
  frameLabel: ({ frameName }) => ({
    full: "Full",
    base: "Base",
    barrel: "Barrel",
  })[frameName],
  path: "placementViewer.spriteAssets",
});

interface PlacementViewerWindow extends Window {
  __ferrumPlacementViewer?: ScenePlacementViewer;
  ferrumPlacementViewerState?: ScenePlacementViewerState;
  ferrumPlacementViewerAgentHandoff?: PlacementViewerAgentHandoff;
  ferrumPlacementViewerSelect?: (instanceId?: string) => ScenePlacementViewerState;
  ferrumPlacementViewerUpdateTransform?: (
    instanceId: string,
    transform: Partial<ScenePlacementTransform>,
  ) => ScenePlacementViewerState;
  ferrumPlacementViewerUpdateComponents?: (
    instanceId: string,
    components: Parameters<ScenePlacementViewer["updateInstanceComponents"]>[1],
  ) => ScenePlacementViewerState;
  ferrumPlacementViewerUpdateBehaviorBinding?: (
    target: ScenePlacementBehaviorBindingTarget,
    behaviorRecipes: ScenePlacementBehaviorBindingPatch,
  ) => ScenePlacementViewerState;
  ferrumPlacementViewerRenameInstance?: (instanceId: string, nextInstanceId: string) => ScenePlacementViewerState;
  ferrumPlacementViewerAddInstance?: (
    fragment: string,
    instance: SceneCompositionFragmentInstanceSpec,
  ) => ScenePlacementViewerState;
  ferrumPlacementViewerAddObjectDefinition?: (
    definitionId: string,
    definition: Parameters<ScenePlacementViewer["addObjectDefinition"]>[1],
  ) => ScenePlacementViewerState;
  ferrumPlacementViewerRemoveInstance?: (instanceId: string) => ScenePlacementViewerState;
  ferrumPlacementViewerClearDraft?: () => ScenePlacementViewerState;
  ferrumPlacementViewerExportPatch?: () => ScenePlacementPatch | undefined;
  ferrumPlacementViewerMigrationPreview?: ScenePlacementBindingMigrationPreview;
  ferrumPlacementViewerSaveDraft?: () => Promise<ScenePlacementPatchSaveResult | undefined>;
  ferrumPlacementViewerSaveEnabled?: boolean;
  ferrumPlacementViewerSavedDocument?: SceneAuthoringDocumentSpec;
  ferrumPlacementViewerLastSave?: ScenePlacementPatchSaveResult;
  ferrumPlacementViewerNudgeSelected?: (delta: Partial<ScenePlacementPoint>) => ScenePlacementViewerState | undefined;
  ferrumPlacementViewerSetSnap?: (options: Partial<PlacementSnapOptions>) => PlacementInteractionSnapshot;
  ferrumPlacementViewerInteraction?: PlacementInteractionSnapshot;
}

interface PlacementInstanceBounds {
  width: number;
  height: number;
}

interface PlacementSnapOptions {
  enabled: boolean;
  gridSize: number;
}

interface PlacementInteractionSnapshot extends PlacementSnapOptions {
  dragging: boolean;
  pendingAdd?: PlacementAddAction;
}

interface PlacementInteractionState extends PlacementSnapOptions {
  dragging: boolean;
  pendingAdd?: PlacementAddAction;
}

type PlacementViewerAgentHandoff = ScenePlacementAgentHandoff;

interface PlacementInspector {
  element: HTMLElement;
  setState(state: ScenePlacementViewerState, migrationPreview?: ScenePlacementBindingMigrationPreview): void;
}

interface PlacementOverlay {
  element: HTMLElement;
  setState(state: ScenePlacementViewerState, interaction: PlacementInteractionState): void;
}

interface PlacementSaveControls {
  saveDraft(): Promise<void>;
}

interface PlacementInspectorOptions {
  saveEnabled: boolean;
  assetProvider: ScenePlacementAssetProvider;
}

type PlacementAddAction =
  | "add-rect"
  | "add-circle"
  | "add-point"
  | "add-sprite"
  | "add-prefab";

type PlacementComponentVisualKind = "primitive" | "sprite";
type PlacementComponentColliderType =
  | "none"
  | "aabb"
  | "circle"
  | "capsule"
  | "orientedBox"
  | "convexPolygon";
type PlacementJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly PlacementJsonValue[]
  | { readonly [key: string]: PlacementJsonValue };
type PlacementJsonObject = { readonly [key: string]: PlacementJsonValue };

async function bootstrap(): Promise<void> {
  const shell = createRuntimeDemoShell({
    title: FERRUM_AUTHORING_VIEWER_TITLE,
    frameProperty: "ferrumPlacementViewerFrame",
    gameStateLabel: placementGameStateLabel,
  });
  let runtime: FerrumRuntime | undefined;
  try {
    const sceneDocumentUrl = placementSceneDocumentUrl();
    const loadedDocument = await loadSceneAuthoringDocument(sceneDocumentUrl);
    const document = placementMassAuthoringEnabled()
      ? createPlacementMassAuthoringDocument(loadedDocument)
      : loadedDocument;
    const sourceDocument = placementMassAuthoringEnabled()
      ? `${sceneDocumentUrl}?massAuthoring=true`
      : sceneDocumentUrl;
    const resolved = resolveSceneAuthoringDocument(document, {
      path: "placementViewer.document",
      validateBindings: true,
      validateComponents: true,
      missingBehavior: "ignore",
    });
    const boundsById = placementBoundsById(resolved);
    const selectedInstanceId = firstActorInstance(resolved) ?? resolved.bindingPlan?.instances[0]?.id;
    const saveEnabled = placementViewerSaveEnabled();
    const overlay = createPlacementOverlay(shell.stage, boundsById);
    const inspector = createPlacementInspector(resolved, {
      saveEnabled,
      assetProvider: PLACEMENT_ASSET_PROVIDER,
    });
    const interaction = createPlacementInteractionState();
    let savedDocument = document;
    const saveAdapter: ScenePlacementSaveAdapter = {
      id: "placement-viewer-memory",
      async saveScenePlacementPatch(request) {
        const result = await savePlacementSceneDocument(request.mergedDocument);
        if (result.document !== undefined) {
          savedDocument = result.document;
          publishPlacementSavedDocument(savedDocument);
        }
        return result;
      },
    };

    shell.debugRoot.before(inspector.element);
    runtime = await createFerrumRuntime({
      canvas: shell.canvas,
      debugParent: shell.debugRoot,
      debug: new URLSearchParams(window.location.search).get("debug") === "true",
      environment: "development",
      inputTransform: shell.inputTransform,
      onFrame: (frame) => {
        shell.updateFrame(frame);
        publishFrameStats(frame);
      },
      webgl2: {
        clearColor: [0.06, 0.08, 0.075, 1],
        preserveDrawingBuffer: true,
      },
    });
    shell.attachRuntime(runtime);
    await runtime.engine.loadAssets({ textures: VIEWER_TEXTURES });

    const instanceHandleRegistry = createSceneInstanceHandleRegistry({
      entityExists: (handle) => runtime?.engine.gameplayEntityExists(handle) ?? false,
    });
    const target = createDataSceneRuntimeTarget(runtime.engine);
    applySceneBehaviorRecipes(
      runtime.engine,
      target,
      resolved.sceneComposition,
      resolved.behaviorRecipes,
      {
        instanceHandleRegistry,
        requireExplicitInstanceIds: true,
        missingBehavior: "ignore",
        path: "placementViewer.apply",
      },
    );

    const viewer = createScenePlacementViewer({
      sceneComposition: resolved.sceneComposition,
      viewport: viewportForCanvas(shell.canvas, runtime.engine),
      selectedInstanceId,
      instanceHandleRegistry,
    });
    const setState = (state: ScenePlacementViewerState): ScenePlacementViewerState => {
      const migrationPreview = placementMigrationPreview(savedDocument, state.draftPatch);
      overlay.setState(state, interaction);
      inspector.setState(state, migrationPreview);
      publishPlacementState(state);
      publishPlacementMigrationPreview(migrationPreview);
      publishPlacementInteraction(interaction);
      publishPlacementAgentHandoff(savedDocument, state, migrationPreview, PLACEMENT_ASSET_PROVIDER, sourceDocument);
      return state;
    };
    installPlacementHooks(viewer, interaction, setState, {
      saveEnabled,
      saveDraft: async () => {
        const patch = viewer.exportPatch();
        if (patch === undefined || !saveEnabled) {
          return undefined;
        }
        const migrationPreview = placementMigrationPreview(savedDocument, patch);
        if ((migrationPreview?.references.length ?? 0) > 0) {
          publishPlacementMigrationPreview(migrationPreview);
          publishPlacementAgentHandoff(savedDocument, viewer.state(), migrationPreview, PLACEMENT_ASSET_PROVIDER, sourceDocument);
          return undefined;
        }
        const result = await saveScenePlacementPatch(savedDocument, patch, {
          allowSave: saveEnabled,
          adapter: saveAdapter,
          allowedAdapterIds: ["placement-viewer-memory"],
          path: "placementViewer.save",
        });
        publishPlacementSaveResult(result);
        if (result.saved) {
          window.setTimeout(() => window.location.reload(), 0);
        }
        return result;
      },
    });
    installPlacementSelection(inspector.element, viewer, setState);
    installPlacementTransformControls(inspector.element, viewer, interaction, setState, {
      saveDraft: async () => {
        await (window as PlacementViewerWindow).ferrumPlacementViewerSaveDraft?.();
      },
    });
    installPlacementEditControls(inspector.element, viewer, interaction, setState);
    installPlacementComponentControls(inspector.element, viewer, setState);
    installPlacementPointer(shell.canvas, inspector.element, viewer, interaction, setState);
    installPlacementResizeHandle(overlay.element, shell.canvas, viewer, interaction, setState);
    installPlacementColliderOffsetHandle(overlay.element, shell.canvas, viewer, interaction, setState);
    installPlacementKeyboard(shell.canvas, viewer, interaction, setState);
    installPlacementResize(shell.canvas, runtime.engine, viewer, setState);
    setState(viewer.state());

    runtime.start();
  } catch (error) {
    runtime?.destroy();
    renderRuntimeDemoError(error, {
      title: FERRUM_AUTHORING_VIEWER_TITLE,
      diagnosticReport,
    });
  }
}

function placementSceneDocumentUrl(): string {
  const scene = new URLSearchParams(window.location.search).get("scene");
  if (scene === null || scene === "" || scene === "default") {
    return SCENE_DOCUMENT_URL;
  }
  throw new Error(`Unsupported placement scene fixture '${scene}'.`);
}

function placementMassAuthoringEnabled(): boolean {
  return new URLSearchParams(window.location.search).get("massAuthoring") === "true";
}

function createPlacementMassAuthoringDocument(
  document: SceneAuthoringDocumentSpec,
): SceneAuthoringDocumentSpec {
  const composition = document.sceneComposition;
  const fragments = composition.fragments ?? {};
  const mainFragment = fragments.main ?? {};
  const instances = [...(mainFragment.instances ?? [])];
  const existingIds = new Set(instances.map((instance) => instance.id));
  for (let index = 0; index < MASS_AUTHORING_INSTANCE_COUNT; index += 1) {
    const id = `mass_crate_${index.toString().padStart(4, "0")}`;
    if (existingIds.has(id)) {
      continue;
    }
    const column = index % MASS_AUTHORING_COLUMNS;
    const row = Math.floor(index / MASS_AUTHORING_COLUMNS);
    instances.push({
      id,
      prefab: "crate",
      x: MASS_AUTHORING_START_X + column * MASS_AUTHORING_STEP_X,
      y: MASS_AUTHORING_START_Y + row * MASS_AUTHORING_STEP_Y,
    });
  }
  return {
    ...document,
    sceneComposition: {
      ...composition,
      fragments: {
        ...fragments,
        main: {
          ...mainFragment,
          instances,
        },
      },
    },
  };
}

function createPlacementOverlay(
  stage: HTMLElement,
  boundsById: ReadonlyMap<string, PlacementInstanceBounds>,
): PlacementOverlay {
  const element = document.createElement("div");
  const draftLayer = document.createElement("div");
  const selection = document.createElement("div");
  const colliderOverlay = document.createElement("div");
  const label = document.createElement("div");
  const resizeHandle = document.createElement("button");
  const colliderOffsetHandle = document.createElement("button");
  element.className = "placement-overlay";
  draftLayer.className = "placement-draft-layer";
  selection.className = "placement-selection";
  colliderOverlay.className = "placement-collider-overlay";
  label.className = "placement-label";
  resizeHandle.type = "button";
  resizeHandle.className = "placement-resize-handle";
  resizeHandle.dataset.placementResizeHandle = "se";
  resizeHandle.setAttribute("aria-label", "Resize selected object");
  colliderOffsetHandle.type = "button";
  colliderOffsetHandle.className = "placement-collider-offset-handle";
  colliderOffsetHandle.dataset.placementColliderOffsetHandle = "true";
  colliderOffsetHandle.setAttribute("aria-label", "Move collider offset");
  colliderOverlay.append(colliderOffsetHandle);
  selection.append(label, resizeHandle);
  element.append(draftLayer, colliderOverlay, selection);
  stage.append(element);

  return {
    element,
    setState(state, interaction) {
      renderPlacementDraftMarkers(draftLayer, state, boundsById, interaction);
      const selected = state.selected;
      if (selected === undefined) {
        selection.dataset.visible = "false";
        selection.dataset.resizable = "false";
        colliderOverlay.dataset.visible = "false";
        return;
      }
      const bounds = placementBoundsForInstance(selected, boundsById);
      if (bounds === undefined) {
        selection.dataset.visible = "false";
        selection.dataset.resizable = "false";
        colliderOverlay.dataset.visible = "false";
        return;
      }
      const topLeft = worldToSceneScreen(state.viewport, {
        x: selected.transform.x - bounds.width * selected.transform.scale * 0.5,
        y: selected.transform.y - bounds.height * selected.transform.scale * 0.5,
      });
      selection.dataset.visible = "true";
      selection.style.transform = `translate(${topLeft.x.toFixed(2)}px, ${topLeft.y.toFixed(2)}px)`;
      selection.style.width = `${(bounds.width * selected.transform.scale * state.viewport.zoom).toFixed(2)}px`;
      selection.style.height = `${(bounds.height * selected.transform.scale * state.viewport.zoom).toFixed(2)}px`;
      label.textContent = selected.instanceId;
      const resizeKind = placementResizeKindForInstance(selected);
      selection.dataset.resizable = String(resizeKind !== undefined);
      if (resizeKind === undefined) {
        delete selection.dataset.resizeKind;
      } else {
        selection.dataset.resizeKind = resizeKind;
      }
      updatePlacementColliderOverlay(colliderOverlay, state, selected);
    },
  };
}

function placementResizeKindForInstance(
  selected: ScenePlacementViewerInstance | undefined,
): "rect" | "circle" | undefined {
  const visual = selected?.visual;
  if (visual?.kind !== "primitive") {
    return undefined;
  }
  return visual.shape === "rect" || visual.shape === "circle" ? visual.shape : undefined;
}

function updatePlacementColliderOverlay(
  element: HTMLElement,
  state: ScenePlacementViewerState,
  selected: ScenePlacementViewerInstance,
): void {
  const collider = selected.collider;
  if (collider === undefined || collider.type === "none") {
    element.dataset.visible = "false";
    element.dataset.offsetDraggable = "false";
    return;
  }
  const bounds = placementColliderOverlayBounds(selected);
  if (bounds === undefined) {
    element.dataset.visible = "false";
    element.dataset.offsetDraggable = "false";
    return;
  }
  const topLeft = worldToSceneScreen(state.viewport, {
    x: bounds.x - bounds.width * 0.5,
    y: bounds.y - bounds.height * 0.5,
  });
  element.dataset.visible = "true";
  element.dataset.colliderType = collider.type;
  element.dataset.offsetDraggable = String(collider.type !== "none");
  element.style.transform = `translate(${topLeft.x.toFixed(2)}px, ${topLeft.y.toFixed(2)}px)`;
  element.style.width = `${(bounds.width * state.viewport.zoom).toFixed(2)}px`;
  element.style.height = `${(bounds.height * state.viewport.zoom).toFixed(2)}px`;
}

function placementColliderOverlayBounds(
  selected: ScenePlacementViewerInstance,
): { x: number; y: number; width: number; height: number } | undefined {
  const collider = selected.collider;
  if (collider === undefined || collider.type === "none") {
    return undefined;
  }
  const offsetX = collider.offsetX * selected.transform.scale;
  const offsetY = collider.offsetY * selected.transform.scale;
  const x = selected.transform.x + offsetX;
  const y = selected.transform.y + offsetY;
  switch (collider.type) {
    case "aabb":
    case "orientedBox":
      return {
        x,
        y,
        width: collider.halfWidth * 2 * selected.transform.scale,
        height: collider.halfHeight * 2 * selected.transform.scale,
      };
    case "circle":
      return {
        x,
        y,
        width: collider.radius * 2 * selected.transform.scale,
        height: collider.radius * 2 * selected.transform.scale,
      };
    case "capsule": {
      const minX = Math.min(collider.startX, collider.endX) - collider.radius;
      const maxX = Math.max(collider.startX, collider.endX) + collider.radius;
      const minY = Math.min(collider.startY, collider.endY) - collider.radius;
      const maxY = Math.max(collider.startY, collider.endY) + collider.radius;
      return {
        x,
        y,
        width: Math.max(1, maxX - minX) * selected.transform.scale,
        height: Math.max(1, maxY - minY) * selected.transform.scale,
      };
    }
    case "convexPolygon": {
      const xs = collider.vertices.map((vertex) => vertex.x);
      const ys = collider.vertices.map((vertex) => vertex.y);
      return {
        x,
        y,
        width: Math.max(1, Math.max(...xs) - Math.min(...xs)) * selected.transform.scale,
        height: Math.max(1, Math.max(...ys) - Math.min(...ys)) * selected.transform.scale,
      };
    }
  }
}

function renderPlacementDraftMarkers(
  layer: HTMLElement,
  state: ScenePlacementViewerState,
  boundsById: ReadonlyMap<string, PlacementInstanceBounds>,
  interaction: PlacementInteractionState,
): void {
  const draftIds = placementDraftVisibleInstanceIds(state);
  const pendingMarker = createPlacementPendingAddMarker(state, interaction);
  if (draftIds.size === 0 && pendingMarker === undefined) {
    layer.replaceChildren();
    return;
  }
  const markers: HTMLElement[] = [];
  for (const instance of state.instances) {
    if (!draftIds.has(instance.instanceId)) {
      continue;
    }
    const marker = createPlacementDraftMarker(instance, state, boundsById);
    if (marker !== undefined) {
      markers.push(marker);
    }
  }
  if (pendingMarker !== undefined) {
    markers.push(pendingMarker);
  }
  layer.replaceChildren(...markers);
}

function placementDraftVisibleInstanceIds(state: ScenePlacementViewerState): Set<string> {
  const result = new Set<string>();
  for (const operation of state.draftPatch?.operations ?? []) {
    switch (operation.kind) {
      case "updateTransform":
        result.add(operation.instanceId);
        break;
      case "renameInstance":
        result.add(operation.nextInstanceId);
        break;
      case "addInstance":
        result.add(operation.instance.id ?? "");
        break;
      case "updateComponents":
        result.add(operation.instanceId);
        break;
      case "removeInstance":
        break;
    }
  }
  result.delete("");
  return result;
}

function createPlacementDraftMarker(
  instance: ScenePlacementViewerInstance,
  state: ScenePlacementViewerState,
  boundsById: ReadonlyMap<string, PlacementInstanceBounds>,
): HTMLElement | undefined {
  const bounds = placementBoundsForInstance(instance, boundsById);
  if (bounds === undefined) {
    return undefined;
  }
  const topLeft = worldToSceneScreen(state.viewport, {
    x: instance.transform.x - bounds.width * instance.transform.scale * 0.5,
    y: instance.transform.y - bounds.height * instance.transform.scale * 0.5,
  });
  const marker = document.createElement("div");
  const label = document.createElement("div");
  marker.className = "placement-draft-marker";
  label.className = "placement-draft-label";
  label.textContent = `${instance.instanceId} draft`;
  marker.style.transform = `translate(${topLeft.x.toFixed(2)}px, ${topLeft.y.toFixed(2)}px)`;
  marker.style.width = `${(bounds.width * instance.transform.scale * state.viewport.zoom).toFixed(2)}px`;
  marker.style.height = `${(bounds.height * instance.transform.scale * state.viewport.zoom).toFixed(2)}px`;
  marker.append(label);
  return marker;
}

function createPlacementPendingAddMarker(
  state: ScenePlacementViewerState,
  interaction: PlacementInteractionState,
): HTMLElement | undefined {
  if (interaction.pendingAdd === undefined || state.pointerWorld === undefined) {
    return undefined;
  }
  const bounds = pendingPlacementBounds(interaction.pendingAdd);
  const topLeft = worldToSceneScreen(state.viewport, {
    x: state.pointerWorld.x - bounds.width * 0.5,
    y: state.pointerWorld.y - bounds.height * 0.5,
  });
  const marker = document.createElement("div");
  const label = document.createElement("div");
  marker.className = "placement-draft-marker placement-pending-add-marker";
  marker.dataset.placementPendingAdd = interaction.pendingAdd;
  label.className = "placement-draft-label";
  label.textContent = `${placementAddLabel(interaction.pendingAdd)} preview`;
  marker.style.transform = `translate(${topLeft.x.toFixed(2)}px, ${topLeft.y.toFixed(2)}px)`;
  marker.style.width = `${(bounds.width * state.viewport.zoom).toFixed(2)}px`;
  marker.style.height = `${(bounds.height * state.viewport.zoom).toFixed(2)}px`;
  marker.append(label);
  return marker;
}

function createPlacementInspector(
  resolved: ResolvedSceneAuthoringDocument,
  options: PlacementInspectorOptions,
): PlacementInspector {
  const element = document.createElement("section");
  const title = document.createElement("h2");
  const list = document.createElement("div");
  const details = document.createElement("dl");
  const controls = createPlacementTransformControls({ saveEnabled: options.saveEnabled });
  const editControls = createPlacementEditControls(resolved, options.assetProvider);
  const behaviorControls = createPlacementBehaviorBindingControls(resolved);
  const componentControls = createPlacementComponentControls();
  const migrationReport = createPlacementMigrationReport();
  const rows = {
    selected: appendRow(details, "selected"),
    hovered: appendRow(details, "hovered"),
    identity: appendRow(details, "identity"),
    visual: appendRow(details, "visual"),
    collider: appendRow(details, "collider"),
    behavior: appendRow(details, "behavior"),
    role: appendRow(details, "role"),
    entity: appendRow(details, "entity"),
    prefab: appendRow(details, "prefab"),
    transform: appendRow(details, "transform"),
    pointer: appendRow(details, "pointer"),
    draft: appendRow(details, "draft"),
    migration: appendRow(details, "migration"),
  };

  element.className = "placement-panel";
  list.className = "placement-list";
  details.className = "placement-details";
  title.textContent = "Inspector";

  for (const instance of resolved.bindingPlan?.instances ?? []) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = instance.id;
    button.dataset.instanceId = instance.id;
    list.append(button);
  }

  const detailPanel = document.createElement("section");
  detailPanel.className = "placement-inspector";
  detailPanel.append(
    title,
    details,
    migrationReport.element,
    controls.element,
    editControls.element,
    behaviorControls.element,
    componentControls.element,
  );
  element.append(list, detailPanel);

  return {
    element,
    setState(state, migrationPreview) {
      syncPlacementInstanceList(list, state);
      for (const button of list.querySelectorAll<HTMLButtonElement>("button[data-instance-id]")) {
        button.dataset.selected = String(button.dataset.instanceId === state.selectedInstanceId);
      }
      const selected = state.selected;
      rows.selected.textContent = selected?.instanceId ?? "-";
      rows.hovered.textContent = state.hoveredInstanceId ?? "-";
      rows.identity.textContent = selected === undefined
        ? "-"
        : `${selected.instanceId} / ${selected.prefab}`;
      rows.visual.textContent = placementVisualLabel(selected);
      rows.collider.textContent = placementColliderLabel(selected);
      rows.behavior.textContent = formatAuthoringViewerBehaviorProfiles(selected?.behaviorProfiles);
      rows.role.textContent = selected?.role ?? "-";
      rows.entity.textContent = selected?.entity === undefined
        ? "-"
        : `${selected.entity.entityId}:${selected.entity.entityGeneration}`;
      rows.prefab.textContent = selected === undefined
        ? "-"
        : selected.variant === undefined
          ? selected.prefab
          : `${selected.prefab}/${selected.variant}`;
      rows.transform.textContent = selected === undefined
        ? "-"
        : `${formatNumber(selected.transform.x)}, ${formatNumber(selected.transform.y)}`;
      rows.pointer.textContent = state.pointerWorld === undefined
        ? "-"
        : `${formatNumber(state.pointerWorld.x)}, ${formatNumber(state.pointerWorld.y)}`;
      rows.draft.textContent = state.draftPatch === undefined
        ? "-"
        : `${state.draftPatch.operations.length}`;
      rows.migration.textContent = migrationPreview === undefined
        ? "-"
        : `${migrationPreview.references.length}`;
      migrationReport.setPreview(migrationPreview);
      controls.setState(state, migrationPreview);
      editControls.setState(state);
      behaviorControls.setState(state);
      componentControls.setState(state);
    },
  };
}

function createPlacementMigrationReport(): {
  element: HTMLElement;
  setPreview(preview?: ScenePlacementBindingMigrationPreview): void;
} {
  const element = document.createElement("section");
  const title = document.createElement("h3");
  const list = document.createElement("ul");
  element.className = "placement-migration-report";
  element.dataset.placementMigrationReport = "true";
  title.textContent = "Binding references";
  list.className = "placement-migration-list";
  element.append(title, list);
  return {
    element,
    setPreview(preview) {
      const references = preview?.references ?? [];
      element.dataset.referenceCount = String(references.length);
      element.dataset.blocking = String(references.length > 0);
      if (references.length === 0) {
        const item = document.createElement("li");
        item.textContent = "No pending binding references";
        list.replaceChildren(item);
        return;
      }
      list.replaceChildren(...references.map((reference) => {
        const item = document.createElement("li");
        item.dataset.referenceKind = reference.referenceKind;
        item.dataset.operationKind = reference.operationKind;
        item.textContent = placementMigrationReferenceLabel(reference);
        return item;
      }));
    },
  };
}

function placementMigrationReferenceLabel(
  reference: ScenePlacementBindingMigrationPreview["references"][number],
): string {
  const next = reference.nextInstanceId === undefined ? "" : ` -> ${reference.nextInstanceId}`;
  return `${reference.operationKind}: ${reference.instanceId}${next} (${reference.referenceKind}) ${reference.path}`;
}

function syncPlacementInstanceList(list: HTMLElement, state: ScenePlacementViewerState): void {
  const currentIds = Array.from(list.querySelectorAll<HTMLButtonElement>("button[data-instance-id]"))
    .map((button) => button.dataset.instanceId ?? "");
  const nextIds = state.instances.map((instance) => instance.instanceId);
  if (
    currentIds.length === nextIds.length
    && currentIds.every((id, index) => id === nextIds[index])
  ) {
    return;
  }
  list.replaceChildren(...nextIds.map((instanceId) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = instanceId;
    button.dataset.instanceId = instanceId;
    return button;
  }));
}

function createPlacementTransformControls(options: PlacementInspectorOptions): {
  element: HTMLFormElement;
  setState(state: ScenePlacementViewerState, migrationPreview?: ScenePlacementBindingMigrationPreview): void;
} {
  const form = document.createElement("form");
  const row = document.createElement("div");
  const snapRow = document.createElement("div");
  const fields = {
    x: appendNumberControl(row, "x", "x", "1"),
    y: appendNumberControl(row, "y", "y", "1"),
    scale: appendNumberControl(row, "scale", "scale", "0.05", "0.01"),
    rotationRadians: appendNumberControl(row, "rot", "rotationRadians", "0.01"),
    layer: appendNumberControl(row, "layer", "layer", "1"),
  };
  appendCheckboxControl(snapRow, "snap", "snap");
  const grid = appendNumberControl(snapRow, "grid", "snapGrid", "1", "1");
  const save = document.createElement("button");
  const clear = document.createElement("button");

  form.className = "placement-controls";
  row.className = "placement-control-grid";
  snapRow.className = "placement-control-grid placement-control-grid-secondary";
  save.type = "button";
  save.textContent = "Save";
  save.dataset.placementAction = "save-draft";
  clear.type = "button";
  clear.textContent = "Revert";
  clear.dataset.placementAction = "clear-draft";
  grid.value = String(DEFAULT_SNAP_GRID_SIZE);
  grid.dataset.placementSnapGrid = "true";
  snapRow.append(save, clear);
  form.append(row, snapRow);
  form.addEventListener("submit", (event) => event.preventDefault());

  return {
    element: form,
    setState(state, migrationPreview) {
      const selected = state.selected;
      const disabled = selected === undefined;
      for (const input of Object.values(fields)) {
        input.disabled = disabled;
      }
      const clean = state.draftPatch === undefined;
      const blockedByReferences = (migrationPreview?.references.length ?? 0) > 0;
      save.disabled = clean || !options.saveEnabled || blockedByReferences;
      save.dataset.blockedByReferences = String(blockedByReferences);
      clear.disabled = clean;
      if (selected === undefined) {
        for (const input of Object.values(fields)) {
          input.value = "";
        }
        return;
      }
      setNumberInputValue(fields.x, selected.transform.x);
      setNumberInputValue(fields.y, selected.transform.y);
      setNumberInputValue(fields.scale, selected.transform.scale);
      setNumberInputValue(fields.rotationRadians, selected.transform.rotationRadians);
      setNumberInputValue(fields.layer, selected.transform.layer);
    },
  };
}

function createPlacementEditControls(
  resolved: ResolvedSceneAuthoringDocument,
  assetProvider: ScenePlacementAssetProvider,
): {
  element: HTMLFormElement;
  setState(state: ScenePlacementViewerState): void;
} {
  const form = document.createElement("form");
  const row = document.createElement("div");
  const definitionRow = document.createElement("div");
  const addOptions = document.createElement("div");
  const palette = document.createElement("div");
  const rename = appendTextControl(row, "id", "rename");
  const definitionId = appendTextControl(definitionRow, "definition id", "definitionId");
  const addId = appendTextControl(addOptions, "new id", "addId");
  const sprite = appendSelectControl(addOptions, "sprite", "addSprite", placementSpriteAssetOptions(assetProvider));
  const spriteFrame = appendSelectControl(addOptions, "frame", "addSpriteFrame", []);
  const prefab = appendSelectControl(addOptions, "prefab", "addPrefab", placementPrefabOptions(resolved));
  const spritePreview = createPlacementSpriteAssetPreview();
  const renameButton = document.createElement("button");
  const definitionButton = document.createElement("button");
  const removeButton = document.createElement("button");
  form.className = "placement-controls placement-edit-controls";
  row.className = "placement-control-grid placement-control-grid-edit";
  definitionRow.className = "placement-control-grid placement-control-grid-definition";
  addOptions.className = "placement-control-grid placement-add-options";
  palette.className = "placement-add-palette";
  renameButton.type = "button";
  renameButton.textContent = "Rename";
  renameButton.dataset.placementAction = "rename-selected";
  definitionButton.type = "button";
  definitionButton.textContent = "Create Definition";
  definitionButton.dataset.placementAction = "create-object-definition";
  removeButton.type = "button";
  removeButton.textContent = "Remove";
  removeButton.dataset.placementAction = "remove-selected";
  addId.placeholder = "auto";
  sprite.value = "crate";
  syncPlacementSpriteFrameOptions(spriteFrame, assetProvider, sprite.value);
  updatePlacementSpriteAssetPreview(spritePreview, assetProvider, sprite.value, spriteFrame.value);
  prefab.value = prefab.querySelector<HTMLOptionElement>("option[value='crate']") === null
    ? prefab.value
    : "crate";
  for (const [label, action] of [
    ["Rect", "add-rect"],
    ["Circle", "add-circle"],
    ["Point", "add-point"],
    ["Sprite", "add-sprite"],
    ["Prefab", "add-prefab"],
  ] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.placementAction = action;
    palette.append(button);
  }
  row.append(renameButton, removeButton);
  definitionRow.append(definitionButton);
  addOptions.append(spritePreview);
  form.append(row, definitionRow, addOptions, palette);
  form.addEventListener("submit", (event) => event.preventDefault());
  sprite.addEventListener("change", () => {
    syncPlacementSpriteFrameOptions(spriteFrame, assetProvider, sprite.value);
    updatePlacementSpriteAssetPreview(spritePreview, assetProvider, sprite.value, spriteFrame.value);
  });
  spriteFrame.addEventListener("change", () => {
    updatePlacementSpriteAssetPreview(spritePreview, assetProvider, sprite.value, spriteFrame.value);
  });

  return {
    element: form,
    setState(state) {
      const selected = state.selected;
      const disabled = selected === undefined;
      syncPlacementPrefabOptions(prefab, state);
      rename.disabled = disabled;
      definitionId.disabled = disabled;
      renameButton.disabled = disabled;
      definitionButton.disabled = disabled || selected?.visual === undefined;
      removeButton.disabled = disabled;
      addId.disabled = false;
      sprite.disabled = false;
      spriteFrame.disabled = false;
      prefab.disabled = false;
      if (document.activeElement !== rename) {
        rename.value = selected?.instanceId ?? "";
      }
      if (document.activeElement !== definitionId) {
        definitionId.value = selected === undefined
          ? ""
          : nextPlacementObjectDefinitionId(state, selected.instanceId);
      }
    },
  };
}

function createPlacementBehaviorBindingControls(
  resolved: ResolvedSceneAuthoringDocument,
): {
  element: HTMLFormElement;
  setState(state: ScenePlacementViewerState): void;
} {
  const form = document.createElement("form");
  const row = document.createElement("div");
  const recipes = Object.keys(resolved.behaviorRecipes.entities);
  const recipe = appendSelectControl(row, "recipe", "behaviorRecipe", recipes.length === 0 ? [""] : recipes);
  const attach = document.createElement("button");
  const detach = document.createElement("button");

  form.className = "placement-controls placement-behavior-controls";
  row.className = "placement-control-grid placement-behavior-grid";
  attach.type = "button";
  attach.textContent = "Attach";
  attach.dataset.placementAction = "attach-behavior-binding";
  detach.type = "button";
  detach.textContent = "Detach";
  detach.dataset.placementAction = "detach-behavior-binding";
  row.append(attach, detach);
  form.append(row);
  form.addEventListener("submit", (event) => event.preventDefault());

  return {
    element: form,
    setState(state) {
      const selected = state.selected;
      const disabled = selected === undefined || recipes.length === 0;
      recipe.disabled = disabled;
      attach.disabled = disabled;
      detach.disabled = selected === undefined || selected.behaviorProfiles.length === 0;
      if (selected === undefined) {
        recipe.value = recipes[0] ?? "";
        return;
      }
      const currentRecipe = selected.behaviorProfiles[0];
      if (currentRecipe !== undefined && recipes.includes(currentRecipe)) {
        recipe.value = currentRecipe;
      } else if (!recipes.includes(recipe.value)) {
        recipe.value = recipes[0] ?? "";
      }
    },
  };
}

function createPlacementSpriteAssetPreview(): HTMLElement {
  const preview = document.createElement("div");
  const image = document.createElement("div");
  const label = document.createElement("span");
  preview.className = "placement-asset-preview";
  preview.dataset.placementSpritePreview = "true";
  image.className = "placement-asset-preview-image";
  label.className = "placement-asset-preview-label";
  preview.append(image, label);
  return preview;
}

function updatePlacementSpriteAssetPreview(
  preview: HTMLElement,
  assetProvider: ScenePlacementAssetProvider,
  assetId: string,
  frameId?: string,
): void {
  const asset = assetProvider.resolveSpriteAsset(assetId);
  const frame = frameId === undefined || frameId.length === 0
    ? undefined
    : assetProvider.resolveSpriteFrame(assetId, frameId);
  const image = preview.querySelector<HTMLElement>(".placement-asset-preview-image");
  const label = preview.querySelector<HTMLElement>(".placement-asset-preview-label");
  preview.dataset.assetId = asset?.id ?? "";
  preview.dataset.frameId = frame?.id ?? "";
  if (image !== null) {
    const thumbnailUrl = frame?.thumbnailUrl ?? asset?.thumbnailUrl;
    image.style.backgroundImage = thumbnailUrl === undefined ? "" : `url("${thumbnailUrl}")`;
  }
  if (label !== null) {
    const width = frame?.width ?? asset?.width;
    const height = frame?.height ?? asset?.height;
    const size = width === undefined || height === undefined
      ? ""
      : ` ${width}x${height}`;
    const frameLabel = frame === undefined ? "" : ` / ${frame.label ?? frame.id}`;
    label.textContent = asset === undefined ? "Missing asset" : `${asset.label ?? asset.id}${frameLabel}${size}`;
  }
}

function syncPlacementSpriteFrameOptions(
  select: HTMLSelectElement,
  assetProvider: ScenePlacementAssetProvider,
  assetId: string,
): void {
  const frames = assetProvider.listSpriteFrames(assetId);
  const options: HTMLOptionElement[] = [];
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "default";
  options.push(defaultOption);
  for (const frame of frames) {
    const option = document.createElement("option");
    option.value = frame.id;
    option.textContent = frame.label ?? frame.id;
    options.push(option);
  }
  select.replaceChildren(...options);
  select.value = frames[0]?.id ?? "";
}

function createPlacementComponentControls(): {
  element: HTMLFormElement;
  setState(state: ScenePlacementViewerState): void;
} {
  const form = document.createElement("form");
  const visualRow = document.createElement("div");
  const colliderRow = document.createElement("div");
  const actionRow = document.createElement("div");
  const fields = {
    visualKind: appendComponentSelectControl(visualRow, "visual", "visualKind", ["primitive", "sprite"]),
    primitiveShape: appendComponentSelectControl(visualRow, "shape", "primitiveShape", ["rect", "circle", "point"]),
    visualWidth: appendComponentNumberControl(visualRow, "width", "visualWidth", "1", "1"),
    visualHeight: appendComponentNumberControl(visualRow, "height", "visualHeight", "1", "1"),
    visualRadius: appendComponentNumberControl(visualRow, "radius", "visualRadius", "1", "1"),
    visualColor: appendComponentColorControl(visualRow, "color", "visualColor"),
    colliderType: appendComponentSelectControl(
      colliderRow,
      "collider",
      "colliderType",
      ["none", "aabb", "circle", "capsule", "orientedBox", "convexPolygon"],
    ),
    colliderWidth: appendComponentNumberControl(colliderRow, "collider w", "colliderWidth", "1", "1"),
    colliderHeight: appendComponentNumberControl(colliderRow, "collider h", "colliderHeight", "1", "1"),
    colliderRadius: appendComponentNumberControl(colliderRow, "collider r", "colliderRadius", "1", "1"),
    colliderStartX: appendComponentNumberControl(colliderRow, "start x", "colliderStartX", "1"),
    colliderStartY: appendComponentNumberControl(colliderRow, "start y", "colliderStartY", "1"),
    colliderEndX: appendComponentNumberControl(colliderRow, "end x", "colliderEndX", "1"),
    colliderEndY: appendComponentNumberControl(colliderRow, "end y", "colliderEndY", "1"),
    colliderRotation: appendComponentNumberControl(colliderRow, "rotation", "colliderRotation", "0.01"),
    colliderVertices: appendComponentTextareaControl(colliderRow, "vertices", "colliderVertices"),
    colliderOffsetX: appendComponentNumberControl(colliderRow, "offset x", "colliderOffsetX", "1"),
    colliderOffsetY: appendComponentNumberControl(colliderRow, "offset y", "colliderOffsetY", "1"),
    colliderEnabled: appendComponentCheckboxControl(colliderRow, "enabled", "colliderEnabled"),
    colliderTrigger: appendComponentCheckboxControl(colliderRow, "trigger", "colliderTrigger"),
    layer: appendComponentSelectControl(colliderRow, "layer", "layer", PLACEMENT_COLLISION_LAYERS),
  };
  const apply = document.createElement("button");
  let syncedInstanceId: string | undefined;

  form.className = "placement-controls placement-component-controls";
  visualRow.className = "placement-control-grid placement-component-grid";
  colliderRow.className = "placement-control-grid placement-component-grid";
  actionRow.className = "placement-component-actions";
  apply.type = "button";
  apply.textContent = "Apply Components";
  apply.dataset.placementAction = "apply-components";
  actionRow.append(apply);
  form.append(visualRow, colliderRow, actionRow);
  form.addEventListener("submit", (event) => event.preventDefault());
  form.addEventListener("input", () => syncPlacementComponentFieldState(fields));
  form.addEventListener("change", () => syncPlacementComponentFieldState(fields));

  return {
    element: form,
    setState(state) {
      const selected = state.selected;
      const disabled = selected === undefined;
      apply.disabled = disabled;
      for (const field of Object.values(fields)) {
        field.disabled = disabled;
      }
      if (selected === undefined) {
        syncedInstanceId = undefined;
        clearPlacementComponentFields(fields);
        return;
      }
      if (syncedInstanceId !== selected.instanceId || !form.contains(document.activeElement)) {
        syncedInstanceId = selected.instanceId;
        populatePlacementComponentFields(fields, selected);
      }
      syncPlacementComponentFieldState(fields);
    },
  };
}

interface PlacementComponentControlFields {
  visualKind: HTMLSelectElement;
  primitiveShape: HTMLSelectElement;
  visualWidth: HTMLInputElement;
  visualHeight: HTMLInputElement;
  visualRadius: HTMLInputElement;
  visualColor: HTMLInputElement;
  colliderType: HTMLSelectElement;
  colliderWidth: HTMLInputElement;
  colliderHeight: HTMLInputElement;
  colliderRadius: HTMLInputElement;
  colliderStartX: HTMLInputElement;
  colliderStartY: HTMLInputElement;
  colliderEndX: HTMLInputElement;
  colliderEndY: HTMLInputElement;
  colliderRotation: HTMLInputElement;
  colliderVertices: HTMLTextAreaElement;
  colliderOffsetX: HTMLInputElement;
  colliderOffsetY: HTMLInputElement;
  colliderEnabled: HTMLInputElement;
  colliderTrigger: HTMLInputElement;
  layer: HTMLSelectElement;
}

function populatePlacementComponentFields(
  fields: PlacementComponentControlFields,
  selected: ScenePlacementViewerInstance,
): void {
  const visual = selected.visual;
  if (visual?.kind === "sprite") {
    fields.visualKind.value = "sprite";
    fields.primitiveShape.value = "rect";
    setNumberInputValue(fields.visualWidth, visual.width);
    setNumberInputValue(fields.visualHeight, visual.height);
    setNumberInputValue(fields.visualRadius, Math.max(1, Math.min(visual.width, visual.height) * 0.5));
    fields.visualColor.value = normalizedPlacementColor(visual.tint ?? visual.color ?? DEFAULT_PRIMITIVE_COLOR);
  } else {
    const primitive = visual?.kind === "primitive" ? visual : undefined;
    const shape = primitive?.shape ?? "rect";
    fields.visualKind.value = "primitive";
    fields.primitiveShape.value = shape;
    setNumberInputValue(fields.visualWidth, primitive?.width ?? 48);
    setNumberInputValue(fields.visualHeight, primitive?.height ?? (shape === "rect" ? 32 : primitive?.width ?? 48));
    setNumberInputValue(fields.visualRadius, primitive?.radius ?? Math.max(1, (primitive?.width ?? 36) * 0.5));
    fields.visualColor.value = normalizedPlacementColor(primitive?.color ?? (shape === "point" ? DEFAULT_POINT_COLOR : DEFAULT_PRIMITIVE_COLOR));
  }

  const collider = selected.collider;
  fields.colliderType.value = placementComponentColliderType(collider);
  populatePlacementDefaultColliderFields(fields, visual);
  if (collider?.type === "aabb") {
    setNumberInputValue(fields.colliderWidth, collider.halfWidth * 2);
    setNumberInputValue(fields.colliderHeight, collider.halfHeight * 2);
    setNumberInputValue(fields.colliderRadius, Math.max(1, Math.min(collider.halfWidth, collider.halfHeight)));
  } else if (collider?.type === "circle") {
    setNumberInputValue(fields.colliderWidth, collider.radius * 2);
    setNumberInputValue(fields.colliderHeight, collider.radius * 2);
    setNumberInputValue(fields.colliderRadius, collider.radius);
  } else if (collider?.type === "capsule") {
    setNumberInputValue(fields.colliderRadius, collider.radius);
    setNumberInputValue(fields.colliderStartX, collider.startX);
    setNumberInputValue(fields.colliderStartY, collider.startY);
    setNumberInputValue(fields.colliderEndX, collider.endX);
    setNumberInputValue(fields.colliderEndY, collider.endY);
  } else if (collider?.type === "orientedBox") {
    setNumberInputValue(fields.colliderWidth, collider.halfWidth * 2);
    setNumberInputValue(fields.colliderHeight, collider.halfHeight * 2);
    setNumberInputValue(fields.colliderRadius, Math.max(1, Math.min(collider.halfWidth, collider.halfHeight)));
    setNumberInputValue(fields.colliderRotation, collider.rotationRadians);
  } else if (collider?.type === "convexPolygon") {
    setNumberInputValue(fields.colliderRotation, collider.rotationRadians);
    fields.colliderVertices.value = formatPlacementColliderVertices(collider.vertices);
  }
  if (collider !== undefined && collider.type !== "none") {
    setNumberInputValue(fields.colliderOffsetX, collider.offsetX);
    setNumberInputValue(fields.colliderOffsetY, collider.offsetY);
    fields.colliderEnabled.checked = collider.enabled;
    fields.colliderTrigger.checked = collider.isTrigger;
  } else {
    setNumberInputValue(fields.colliderOffsetX, 0);
    setNumberInputValue(fields.colliderOffsetY, 0);
    fields.colliderEnabled.checked = true;
    fields.colliderTrigger.checked = false;
  }
  fields.layer.value = selected.componentLayer?.name ?? "wall";
}

function placementComponentColliderType(
  collider: ResolvedDataSceneColliderComponent | undefined,
): PlacementComponentColliderType {
  if (collider === undefined) {
    return "none";
  }
  return collider.type;
}

function populatePlacementDefaultColliderFields(
  fields: PlacementComponentControlFields,
  visual: ResolvedDataSceneObjectVisual | undefined,
): void {
  const width = visual?.bounds.width ?? 32;
  const height = visual?.bounds.height ?? width;
  const halfWidth = width * 0.5;
  const halfHeight = height * 0.5;
  const radius = Math.max(1, Math.min(width, height) * 0.5);
  setNumberInputValue(fields.colliderWidth, width);
  setNumberInputValue(fields.colliderHeight, height);
  setNumberInputValue(fields.colliderRadius, radius);
  setNumberInputValue(fields.colliderStartX, 0);
  setNumberInputValue(fields.colliderStartY, -Math.max(1, height * 0.25));
  setNumberInputValue(fields.colliderEndX, 0);
  setNumberInputValue(fields.colliderEndY, Math.max(1, height * 0.25));
  setNumberInputValue(fields.colliderRotation, 0);
  fields.colliderVertices.value = formatPlacementColliderVertices([
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ]);
}

function formatPlacementColliderVertices(
  vertices: readonly { readonly x: number; readonly y: number }[],
): string {
  return JSON.stringify(vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })));
}

function clearPlacementComponentFields(fields: PlacementComponentControlFields): void {
  fields.visualKind.value = "primitive";
  fields.primitiveShape.value = "rect";
  fields.visualWidth.value = "";
  fields.visualHeight.value = "";
  fields.visualRadius.value = "";
  fields.visualColor.value = DEFAULT_PRIMITIVE_COLOR;
  fields.colliderType.value = "none";
  fields.colliderWidth.value = "";
  fields.colliderHeight.value = "";
  fields.colliderRadius.value = "";
  fields.colliderStartX.value = "";
  fields.colliderStartY.value = "";
  fields.colliderEndX.value = "";
  fields.colliderEndY.value = "";
  fields.colliderRotation.value = "";
  fields.colliderVertices.value = "";
  fields.colliderOffsetX.value = "";
  fields.colliderOffsetY.value = "";
  fields.colliderEnabled.checked = true;
  fields.colliderTrigger.checked = false;
  fields.layer.value = "wall";
}

function syncPlacementComponentFieldState(fields: PlacementComponentControlFields): void {
  const visualKind = fields.visualKind.value as PlacementComponentVisualKind;
  const primitiveShape = fields.primitiveShape.value as DataScenePrimitiveVisualShape;
  const colliderType = fields.colliderType.value as PlacementComponentColliderType;
  fields.primitiveShape.disabled = fields.visualKind.disabled || visualKind !== "primitive";
  fields.visualWidth.disabled = fields.visualKind.disabled || (visualKind === "primitive" && primitiveShape === "circle");
  fields.visualHeight.disabled = fields.visualKind.disabled || (visualKind === "primitive" && primitiveShape !== "rect");
  fields.visualRadius.disabled = fields.visualKind.disabled || visualKind !== "primitive" || primitiveShape !== "circle";
  fields.colliderWidth.disabled = fields.colliderType.disabled || (colliderType !== "aabb" && colliderType !== "orientedBox");
  fields.colliderHeight.disabled = fields.colliderType.disabled || (colliderType !== "aabb" && colliderType !== "orientedBox");
  fields.colliderRadius.disabled = fields.colliderType.disabled || (colliderType !== "circle" && colliderType !== "capsule");
  fields.colliderStartX.disabled = fields.colliderType.disabled || colliderType !== "capsule";
  fields.colliderStartY.disabled = fields.colliderType.disabled || colliderType !== "capsule";
  fields.colliderEndX.disabled = fields.colliderType.disabled || colliderType !== "capsule";
  fields.colliderEndY.disabled = fields.colliderType.disabled || colliderType !== "capsule";
  fields.colliderRotation.disabled = fields.colliderType.disabled || (colliderType !== "orientedBox" && colliderType !== "convexPolygon");
  fields.colliderVertices.disabled = fields.colliderType.disabled || colliderType !== "convexPolygon";
  fields.colliderOffsetX.disabled = fields.colliderType.disabled || colliderType === "none";
  fields.colliderOffsetY.disabled = fields.colliderType.disabled || colliderType === "none";
  fields.colliderEnabled.disabled = fields.colliderType.disabled || colliderType === "none";
  fields.colliderTrigger.disabled = fields.colliderType.disabled || colliderType === "none";
}

function installPlacementSelection(
  root: HTMLElement,
  viewer: ScenePlacementViewer,
  setState: (state: ScenePlacementViewerState) => ScenePlacementViewerState,
): void {
  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) {
      return;
    }
    const instanceId = target.dataset.instanceId;
    if (instanceId === undefined) {
      return;
    }
    setState(viewer.selectInstance(instanceId));
  });
}

function installPlacementTransformControls(
  root: HTMLElement,
  viewer: ScenePlacementViewer,
  interaction: PlacementInteractionState,
  setState: (state: ScenePlacementViewerState) => ScenePlacementViewerState,
  save: PlacementSaveControls,
): void {
  root.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    if (target.dataset.placementSnapToggle === "true") {
      interaction.enabled = target.checked;
      publishPlacementInteraction(interaction);
      if (interaction.enabled) {
        snapSelectedInstance(viewer, interaction, setState);
      }
      return;
    }
    if (target.dataset.placementSnapGrid === "true") {
      const value = numberInputValue(target);
      if (value !== undefined && value > 0) {
        interaction.gridSize = value;
        publishPlacementInteraction(interaction);
        if (interaction.enabled) {
          snapSelectedInstance(viewer, interaction, setState);
        }
      }
      return;
    }
    const field = target.dataset.placementTransformField;
    if (field !== undefined) {
      applyTransformInput(viewer, interaction, field, target, setState);
    }
  });

  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) {
      return;
    }
    if (target.dataset.placementAction === "clear-draft") {
      setState(viewer.clearDraftPatch());
      return;
    }
    if (target.dataset.placementAction === "save-draft") {
      void save.saveDraft();
    }
  });
}

function installPlacementEditControls(
  root: HTMLElement,
  viewer: ScenePlacementViewer,
  interaction: PlacementInteractionState,
  setState: (state: ScenePlacementViewerState) => ScenePlacementViewerState,
): void {
  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) {
      return;
    }
    if (target.dataset.placementAction === "rename-selected") {
      const selected = viewer.state().selected;
      const input = root.querySelector<HTMLInputElement>("input[data-placement-rename-id='true']");
      const nextInstanceId = input?.value.trim();
      if (selected !== undefined && nextInstanceId !== undefined && nextInstanceId.length > 0) {
        setState(viewer.renameInstance(selected.instanceId, nextInstanceId));
      }
      return;
    }
    if (target.dataset.placementAction === "create-object-definition") {
      const selected = viewer.state().selected;
      const input = root.querySelector<HTMLInputElement>("input[data-placement-definition-id='true']");
      const definitionId = input?.value.trim();
      if (selected === undefined || definitionId === undefined || definitionId.length === 0) {
        return;
      }
      try {
        clearPlacementDefinitionError(root);
        const state = viewer.addObjectDefinition(definitionId, placementObjectDefinitionFromSelected(selected));
        setState(state);
      } catch (error) {
        reportPlacementDefinitionError(root, error);
      }
      return;
    }
    if (target.dataset.placementAction === "remove-selected") {
      const selected = viewer.state().selected;
      if (selected !== undefined) {
        setState(viewer.removeInstance(selected.instanceId));
      }
      return;
    }
    if (target.dataset.placementAction === "attach-behavior-binding") {
      const selected = viewer.state().selected;
      const recipe = root.querySelector<HTMLSelectElement>("select[data-placement-behavior-recipe='true']")
        ?.value.trim();
      if (selected !== undefined && recipe !== undefined && recipe.length > 0) {
        setState(viewer.updateBehaviorBinding(
          { kind: "instance", instanceId: selected.instanceId },
          recipe,
        ));
      }
      return;
    }
    if (target.dataset.placementAction === "detach-behavior-binding") {
      const selected = viewer.state().selected;
      if (selected !== undefined) {
        setState(viewer.updateBehaviorBinding(
          { kind: "instance", instanceId: selected.instanceId },
          null,
        ));
      }
      return;
    }
    const addAction = target.dataset.placementAction;
    if (
      addAction === "add-rect"
      || addAction === "add-circle"
      || addAction === "add-point"
      || addAction === "add-sprite"
      || addAction === "add-prefab"
    ) {
      interaction.pendingAdd = addAction;
      publishPlacementInteraction(interaction);
      setState(viewer.state());
    }
  });
}

function installPlacementComponentControls(
  root: HTMLElement,
  viewer: ScenePlacementViewer,
  setState: (state: ScenePlacementViewerState) => ScenePlacementViewerState,
): void {
  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || target.dataset.placementAction !== "apply-components") {
      return;
    }
    const selected = viewer.state().selected;
    if (selected === undefined) {
      return;
    }
    try {
      const components = placementComponentsPatchFromControls(root, selected);
      setState(viewer.updateInstanceComponents(selected.instanceId, components));
    } catch (error) {
      reportPlacementComponentError(root, error);
    }
  });
}

function placementComponentsPatchFromControls(
  root: HTMLElement,
  selected: ScenePlacementViewerInstance,
): Parameters<ScenePlacementViewer["updateInstanceComponents"]>[1] {
  const visual = placementVisualPatchFromControls(root, selected);
  const collider = placementColliderPatchFromControls(root, selected.collider);
  const layer = selectedPlacementComponentLayer(root);
  return {
    visual,
    collider,
    layer,
  };
}

function placementVisualPatchFromControls(
  root: HTMLElement,
  selected: ScenePlacementViewerInstance,
): PlacementJsonObject {
  const visualKind = selectedPlacementComponentValue(root, "visualKind") as PlacementComponentVisualKind | undefined;
  const width = positivePlacementComponentNumber(root, "visualWidth", "visual width");
  const height = positivePlacementComponentNumber(root, "visualHeight", "visual height");
  const radius = positivePlacementComponentNumber(root, "visualRadius", "visual radius");
  const color = selectedPlacementComponentValue(root, "visualColor") ?? DEFAULT_PRIMITIVE_COLOR;
  if (visualKind === "sprite") {
    return spriteVisualPatch(selected.visual, width, height, color);
  }
  const shape = selectedPlacementComponentValue(root, "primitiveShape") as DataScenePrimitiveVisualShape | undefined;
  const primitiveShape = shape ?? "rect";
  if (primitiveShape === "circle") {
    return {
      kind: "primitive",
      shape: primitiveShape,
      radius,
      color,
    };
  }
  if (primitiveShape === "point") {
    return {
      kind: "primitive",
      shape: primitiveShape,
      width,
      color,
    };
  }
  return {
    kind: "primitive",
    shape: "rect",
    width,
    height,
    color,
  };
}

function spriteVisualPatch(
  currentVisual: ResolvedDataSceneObjectVisual | undefined,
  width: number,
  height: number,
  color: string,
): PlacementJsonObject {
  if (currentVisual?.kind === "sprite") {
    const texture = currentVisual.texture.kind === "asset"
      ? { asset: currentVisual.texture.name ?? String(currentVisual.texture.value) }
      : { texture: currentVisual.texture.id ?? currentVisual.texture.value };
    return {
      kind: "sprite",
      ...texture,
      width,
      height,
      frame: spriteFramePatch(currentVisual.frame),
      ...(currentVisual.animation === undefined ? {} : {
        animation: {
          frameCount: currentVisual.animation.frameCount,
          fps: currentVisual.animation.fps,
        },
      }),
      originX: currentVisual.originX,
      originY: currentVisual.originY,
      ...(currentVisual.layer === undefined ? {} : { layer: currentVisual.layer }),
      ...(currentVisual.sortOrder === undefined ? {} : { sortOrder: currentVisual.sortOrder }),
      color,
    };
  }
  return {
    kind: "sprite",
    asset: "crate",
    width,
    height,
    originX: 0.5,
    originY: 0.5,
    color,
  };
}

function spriteFramePatch(frame: ResolvedDataSceneSpriteFrame): PlacementJsonObject {
  return {
    u0: frame.u0,
    v0: frame.v0,
    u1: frame.u1,
    v1: frame.v1,
  };
}

function placementColliderPatchFromControls(
  root: HTMLElement,
  currentCollider: ResolvedDataSceneColliderComponent | undefined,
): PlacementJsonValue {
  const type = selectedPlacementComponentValue(root, "colliderType") as PlacementComponentColliderType | undefined;
  if (type === "none" || type === undefined) {
    return "none";
  }
  const base = placementColliderBasePatch(root, currentCollider);
  if (type === "circle") {
    return {
      type,
      ...base,
      radius: positivePlacementComponentNumber(root, "colliderRadius", "collider radius"),
    };
  }
  switch (type) {
    case "aabb":
      return {
        type,
        ...base,
        halfWidth: positivePlacementComponentNumber(root, "colliderWidth", "collider width") * 0.5,
        halfHeight: positivePlacementComponentNumber(root, "colliderHeight", "collider height") * 0.5,
      };
    case "capsule":
      return {
        type,
        ...base,
        startX: finitePlacementComponentNumber(root, "colliderStartX", "capsule start x", 0),
        startY: finitePlacementComponentNumber(root, "colliderStartY", "capsule start y", -8),
        endX: finitePlacementComponentNumber(root, "colliderEndX", "capsule end x", 0),
        endY: finitePlacementComponentNumber(root, "colliderEndY", "capsule end y", 8),
        radius: positivePlacementComponentNumber(root, "colliderRadius", "capsule radius"),
      };
    case "orientedBox":
      return {
        type,
        ...base,
        halfWidth: positivePlacementComponentNumber(root, "colliderWidth", "oriented box width") * 0.5,
        halfHeight: positivePlacementComponentNumber(root, "colliderHeight", "oriented box height") * 0.5,
        rotationRadians: finitePlacementComponentNumber(root, "colliderRotation", "oriented box rotation", 0),
      };
    case "convexPolygon":
      return {
        type,
        ...base,
        vertices: placementColliderVerticesPatchFromControls(root),
        rotationRadians: finitePlacementComponentNumber(root, "colliderRotation", "convex polygon rotation", 0),
      };
  }
}

function placementColliderBasePatch(
  root: HTMLElement,
  currentCollider: ResolvedDataSceneColliderComponent | undefined,
): PlacementJsonObject {
  const enabled = checkedPlacementComponentValue(root, "colliderEnabled", true);
  const isTrigger = checkedPlacementComponentValue(root, "colliderTrigger", false);
  return {
    offsetX: finitePlacementComponentNumber(
      root,
      "colliderOffsetX",
      "collider offset x",
      currentCollider !== undefined && currentCollider.type !== "none" ? currentCollider.offsetX : 0,
    ),
    offsetY: finitePlacementComponentNumber(
      root,
      "colliderOffsetY",
      "collider offset y",
      currentCollider !== undefined && currentCollider.type !== "none" ? currentCollider.offsetY : 0,
    ),
    enabled,
    isTrigger,
  };
}

function selectedPlacementComponentLayer(root: HTMLElement): DataSceneCollisionLayerName {
  const layer = selectedPlacementComponentValue(root, "layer");
  return PLACEMENT_COLLISION_LAYERS.includes(layer as DataSceneCollisionLayerName)
    ? layer as DataSceneCollisionLayerName
    : "wall";
}

function positivePlacementComponentNumber(root: HTMLElement, field: string, label: string): number {
  const input = root.querySelector<HTMLInputElement>(`input[data-placement-component-field='${field}']`);
  const value = input === null ? undefined : numberInputValue(input);
  if (value !== undefined && value > 0) {
    input?.setCustomValidity("");
    return value;
  }
  const message = `${label} must be a positive number.`;
  input?.setCustomValidity(message);
  input?.reportValidity();
  throw new Error(message);
}

function finitePlacementComponentNumber(
  root: HTMLElement,
  field: string,
  label: string,
  fallback: number,
): number {
  const input = root.querySelector<HTMLInputElement>(`input[data-placement-component-field='${field}']`);
  const rawValue = input?.value.trim();
  if (rawValue === undefined || rawValue === "") {
    input?.setCustomValidity("");
    return fallback;
  }
  const value = Number(rawValue);
  if (Number.isFinite(value)) {
    input?.setCustomValidity("");
    return value;
  }
  const message = `${label} must be a finite number.`;
  input?.setCustomValidity(message);
  input?.reportValidity();
  throw new Error(message);
}

function placementColliderVerticesPatchFromControls(root: HTMLElement): readonly PlacementJsonObject[] {
  const input = root.querySelector<HTMLTextAreaElement>("textarea[data-placement-component-field='colliderVertices']");
  const rawValue = input?.value.trim();
  if (rawValue === undefined || rawValue === "") {
    const message = "convex polygon vertices must be a JSON array.";
    input?.setCustomValidity(message);
    input?.reportValidity();
    throw new Error(message);
  }
  let value: unknown;
  try {
    value = JSON.parse(rawValue);
  } catch {
    const message = "convex polygon vertices must be valid JSON.";
    input?.setCustomValidity(message);
    input?.reportValidity();
    throw new Error(message);
  }
  if (!Array.isArray(value) || value.length < 3 || value.length > DATA_SCENE_MAX_CONVEX_POLYGON_VERTICES) {
    const message = `convex polygon vertices must contain 3-${DATA_SCENE_MAX_CONVEX_POLYGON_VERTICES} points.`;
    input?.setCustomValidity(message);
    input?.reportValidity();
    throw new Error(message);
  }
  const vertices = value.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`convex polygon vertex ${index} must be an object.`);
    }
    const object = entry as Record<string, unknown>;
    const x = Number(object.x);
    const y = Number(object.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`convex polygon vertex ${index} must have finite x/y.`);
    }
    return { x, y };
  });
  input?.setCustomValidity("");
  return vertices;
}

function selectedPlacementComponentValue(root: HTMLElement, field: string): string | undefined {
  const control = root.querySelector<HTMLInputElement | HTMLSelectElement>(
    `[data-placement-component-field='${field}']`,
  );
  const value = control?.value.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function checkedPlacementComponentValue(root: HTMLElement, field: string, fallback: boolean): boolean {
  const input = root.querySelector<HTMLInputElement>(`input[data-placement-component-field='${field}']`);
  return input?.checked ?? fallback;
}

function reportPlacementComponentError(root: HTMLElement, error: unknown): void {
  const button = root.querySelector<HTMLButtonElement>("button[data-placement-action='apply-components']");
  button?.setCustomValidity(error instanceof Error ? error.message : String(error));
  button?.reportValidity();
  window.setTimeout(() => button?.setCustomValidity(""), 0);
}

function installPlacementPointer(
  canvas: HTMLCanvasElement,
  controlsRoot: HTMLElement,
  viewer: ScenePlacementViewer,
  interaction: PlacementInteractionState,
  setState: (state: ScenePlacementViewerState) => ScenePlacementViewerState,
): void {
  let hoverQueued = false;
  let latestPoint: { x: number; y: number } | undefined;
  let drag: {
    pointerId: number;
    instanceId: string;
    offsetX: number;
    offsetY: number;
    latestPoint: ScenePlacementPoint;
    queued: boolean;
  } | undefined;

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    canvas.focus({ preventScroll: true });
    const point = pointerScreenPoint(canvas, event);
    if (interaction.pendingAdd !== undefined) {
      const pointerState = viewer.pointerAtScreen(point);
      if (pointerState.pointerWorld !== undefined) {
        const placementPoint = snappedPlacementPoint(pointerState.pointerWorld, interaction);
        try {
          const draft = createDraftPlacementInstance(pointerState, interaction.pendingAdd, {
            ...placementDraftOptionsFromControls(controlsRoot, interaction.pendingAdd),
            point: placementPoint,
          });
          interaction.pendingAdd = undefined;
          clearPlacementAddError(controlsRoot);
          publishPlacementInteraction(interaction);
          setState(viewer.addInstance(pointerState.fragment, draft));
        } catch (error) {
          reportPlacementAddError(controlsRoot, error);
          setState(viewer.state());
        }
      }
      event.preventDefault();
      return;
    }
    const picked = viewer.pickInstanceAtScreen(point);
    const state = setState(viewer.selectInstanceAtScreen(point));
    if (picked === undefined || state.selected === undefined || state.pointerWorld === undefined) {
      return;
    }
    drag = {
      pointerId: event.pointerId,
      instanceId: state.selected.instanceId,
      offsetX: state.selected.transform.x - state.pointerWorld.x,
      offsetY: state.selected.transform.y - state.pointerWorld.y,
      latestPoint: point,
      queued: false,
    };
    interaction.dragging = true;
    publishPlacementInteraction(interaction);
    canvas.dataset.dragging = "true";
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  canvas.addEventListener("pointermove", (event) => {
    latestPoint = pointerScreenPoint(canvas, event);
    if (drag !== undefined) {
      if ((event.buttons & 1) === 0) {
        finishPlacementDrag(canvas, event.pointerId, interaction);
        drag = undefined;
        return;
      }
      drag.latestPoint = latestPoint;
      queuePlacementDragUpdate(viewer, interaction, drag, setState);
      return;
    }
    if (interaction.pendingAdd !== undefined) {
      setState(viewer.pointerAtScreen(latestPoint));
      return;
    }
    if (hoverQueued) {
      return;
    }
    hoverQueued = true;
    requestAnimationFrame(() => {
      hoverQueued = false;
      if (latestPoint !== undefined) {
        setState(viewer.hoverInstanceAtScreen(latestPoint));
      }
    });
  });

  canvas.addEventListener("pointerup", (event) => {
    if (drag?.pointerId !== event.pointerId) {
      return;
    }
    const point = pointerScreenPoint(canvas, event);
    finishPlacementDrag(canvas, event.pointerId, interaction);
    drag = undefined;
    setState(viewer.hoverInstanceAtScreen(point));
  });

  canvas.addEventListener("pointercancel", (event) => {
    if (drag?.pointerId === event.pointerId) {
      finishPlacementDrag(canvas, event.pointerId, interaction);
      drag = undefined;
    }
  });

  canvas.addEventListener("pointerleave", () => {
    if (drag !== undefined) {
      return;
    }
    latestPoint = undefined;
    setState(viewer.hoverInstanceAtScreen());
  });
}

interface PlacementResizeDrag {
  pointerId: number;
  handle: HTMLElement;
  instance: ScenePlacementViewerInstance;
  latestPoint: ScenePlacementPoint;
  queued: boolean;
}

function installPlacementResizeHandle(
  root: HTMLElement,
  canvas: HTMLCanvasElement,
  viewer: ScenePlacementViewer,
  interaction: PlacementInteractionState,
  setState: (state: ScenePlacementViewerState) => ScenePlacementViewerState,
): void {
  let drag: PlacementResizeDrag | undefined;

  root.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (
      !(target instanceof HTMLElement)
      || target.dataset.placementResizeHandle !== "se"
      || event.button !== 0
    ) {
      return;
    }
    const selected = viewer.state().selected;
    if (placementResizeKindForInstance(selected) === undefined) {
      return;
    }
    canvas.focus({ preventScroll: true });
    drag = {
      pointerId: event.pointerId,
      handle: target,
      instance: selected,
      latestPoint: pointerScreenPoint(canvas, event),
      queued: false,
    };
    interaction.dragging = true;
    publishPlacementInteraction(interaction);
    root.dataset.resizing = "true";
    target.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  });

  root.addEventListener("pointermove", (event) => {
    if (drag === undefined || drag.pointerId !== event.pointerId) {
      return;
    }
    if ((event.buttons & 1) === 0) {
      finishPlacementResizeDrag(root, drag, interaction);
      drag = undefined;
      return;
    }
    drag.latestPoint = pointerScreenPoint(canvas, event);
    queuePlacementResizeUpdate(viewer, drag, setState);
    event.preventDefault();
    event.stopPropagation();
  });

  root.addEventListener("pointerup", (event) => {
    if (drag === undefined || drag.pointerId !== event.pointerId) {
      return;
    }
    drag.latestPoint = pointerScreenPoint(canvas, event);
    queuePlacementResizeUpdate(viewer, drag, setState);
    finishPlacementResizeDrag(root, drag, interaction);
    drag = undefined;
    event.preventDefault();
    event.stopPropagation();
  });

  root.addEventListener("pointercancel", (event) => {
    if (drag === undefined || drag.pointerId !== event.pointerId) {
      return;
    }
    finishPlacementResizeDrag(root, drag, interaction);
    drag = undefined;
  });
}

function queuePlacementResizeUpdate(
  viewer: ScenePlacementViewer,
  drag: PlacementResizeDrag,
  setState: (state: ScenePlacementViewerState) => ScenePlacementViewerState,
): void {
  if (drag.queued) {
    return;
  }
  drag.queued = true;
  requestAnimationFrame(() => {
    drag.queued = false;
    const pointerState = viewer.pointerAtScreen(drag.latestPoint);
    if (pointerState.pointerWorld === undefined) {
      return;
    }
    const components = placementComponentsPatchFromResize(drag.instance, pointerState.pointerWorld);
    setState(viewer.updateInstanceComponents(drag.instance.instanceId, components));
  });
}

function finishPlacementResizeDrag(
  root: HTMLElement,
  drag: PlacementResizeDrag,
  interaction: PlacementInteractionState,
): void {
  if (drag.handle.hasPointerCapture(drag.pointerId)) {
    drag.handle.releasePointerCapture(drag.pointerId);
  }
  interaction.dragging = false;
  publishPlacementInteraction(interaction);
  delete root.dataset.resizing;
}

interface PlacementColliderOffsetDrag {
  pointerId: number;
  handle: HTMLElement;
  instance: ScenePlacementViewerInstance;
  startPointerWorld: ScenePlacementPoint;
  latestPoint: ScenePlacementPoint;
  queued: boolean;
}

function installPlacementColliderOffsetHandle(
  root: HTMLElement,
  canvas: HTMLCanvasElement,
  viewer: ScenePlacementViewer,
  interaction: PlacementInteractionState,
  setState: (state: ScenePlacementViewerState) => ScenePlacementViewerState,
): void {
  let drag: PlacementColliderOffsetDrag | undefined;

  root.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (
      !(target instanceof HTMLElement)
      || target.dataset.placementColliderOffsetHandle !== "true"
      || event.button !== 0
    ) {
      return;
    }
    const selected = viewer.state().selected;
    if (!placementColliderOffsetDraggable(selected)) {
      return;
    }
    const point = pointerScreenPoint(canvas, event);
    const pointerState = viewer.pointerAtScreen(point);
    if (pointerState.pointerWorld === undefined) {
      return;
    }
    canvas.focus({ preventScroll: true });
    drag = {
      pointerId: event.pointerId,
      handle: target,
      instance: selected,
      startPointerWorld: pointerState.pointerWorld,
      latestPoint: point,
      queued: false,
    };
    interaction.dragging = true;
    publishPlacementInteraction(interaction);
    root.dataset.movingColliderOffset = "true";
    target.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  });

  root.addEventListener("pointermove", (event) => {
    if (drag === undefined || drag.pointerId !== event.pointerId) {
      return;
    }
    if ((event.buttons & 1) === 0) {
      finishPlacementColliderOffsetDrag(root, drag, interaction);
      drag = undefined;
      return;
    }
    drag.latestPoint = pointerScreenPoint(canvas, event);
    queuePlacementColliderOffsetUpdate(viewer, drag, setState);
    event.preventDefault();
    event.stopPropagation();
  });

  root.addEventListener("pointerup", (event) => {
    if (drag === undefined || drag.pointerId !== event.pointerId) {
      return;
    }
    drag.latestPoint = pointerScreenPoint(canvas, event);
    queuePlacementColliderOffsetUpdate(viewer, drag, setState);
    finishPlacementColliderOffsetDrag(root, drag, interaction);
    drag = undefined;
    event.preventDefault();
    event.stopPropagation();
  });

  root.addEventListener("pointercancel", (event) => {
    if (drag === undefined || drag.pointerId !== event.pointerId) {
      return;
    }
    finishPlacementColliderOffsetDrag(root, drag, interaction);
    drag = undefined;
  });
}

function placementColliderOffsetDraggable(
  selected: ScenePlacementViewerInstance | undefined,
): selected is ScenePlacementViewerInstance & {
  visual: ResolvedDataSceneObjectVisual;
  collider: Exclude<ResolvedDataSceneColliderComponent, { type: "none" }>;
} {
  return selected?.visual !== undefined
    && selected.collider !== undefined
    && selected.collider.type !== "none";
}

function queuePlacementColliderOffsetUpdate(
  viewer: ScenePlacementViewer,
  drag: PlacementColliderOffsetDrag,
  setState: (state: ScenePlacementViewerState) => ScenePlacementViewerState,
): void {
  if (drag.queued) {
    return;
  }
  drag.queued = true;
  requestAnimationFrame(() => {
    drag.queued = false;
    const pointerState = viewer.pointerAtScreen(drag.latestPoint);
    if (pointerState.pointerWorld === undefined) {
      return;
    }
    const components = placementComponentsPatchFromColliderOffset(
      drag.instance,
      drag.startPointerWorld,
      pointerState.pointerWorld,
    );
    setState(viewer.updateInstanceComponents(drag.instance.instanceId, components));
  });
}

function finishPlacementColliderOffsetDrag(
  root: HTMLElement,
  drag: PlacementColliderOffsetDrag,
  interaction: PlacementInteractionState,
): void {
  if (drag.handle.hasPointerCapture(drag.pointerId)) {
    drag.handle.releasePointerCapture(drag.pointerId);
  }
  interaction.dragging = false;
  publishPlacementInteraction(interaction);
  delete root.dataset.movingColliderOffset;
}

function placementComponentsPatchFromColliderOffset(
  selected: ScenePlacementViewerInstance,
  startPointerWorld: ScenePlacementPoint,
  pointerWorld: ScenePlacementPoint,
): Parameters<ScenePlacementViewer["updateInstanceComponents"]>[1] {
  if (!placementColliderOffsetDraggable(selected)) {
    throw new Error("placement collider offset handle requires a selected visual and collider.");
  }
  const scale = Math.abs(selected.transform.scale) < 0.0001
    ? 0.0001
    : selected.transform.scale;
  const offset = {
    offsetX: roundPlacementResizeValue(
      selected.collider.offsetX + ((pointerWorld.x - startPointerWorld.x) / scale),
    ),
    offsetY: roundPlacementResizeValue(
      selected.collider.offsetY + ((pointerWorld.y - startPointerWorld.y) / scale),
    ),
  };
  return {
    visual: placementVisualPatchFromResolved(selected.visual),
    collider: placementColliderPatchFromResolved(selected.collider, offset),
    layer: selected.componentLayer?.name ?? "wall",
  };
}

function placementComponentsPatchFromResize(
  selected: ScenePlacementViewerInstance,
  pointerWorld: ScenePlacementPoint,
): Parameters<ScenePlacementViewer["updateInstanceComponents"]>[1] {
  const visual = selected.visual;
  if (visual?.kind !== "primitive" || (visual.shape !== "rect" && visual.shape !== "circle")) {
    throw new Error("placement resize handle only supports primitive rect and circle visuals.");
  }
  const scale = Math.max(0.0001, Math.abs(selected.transform.scale));
  if (visual.shape === "circle") {
    const radius = roundPlacementResizeValue(
      Math.max(
        PLACEMENT_RESIZE_MIN_SIZE * 0.5,
        Math.max(
          Math.abs(pointerWorld.x - selected.transform.x),
          Math.abs(pointerWorld.y - selected.transform.y),
        ) / scale,
      ),
    );
    return {
      visual: {
        kind: "primitive",
        shape: "circle",
        radius,
        color: visual.color ?? DEFAULT_PRIMITIVE_COLOR,
      },
      collider: placementColliderPatchForResize(selected.collider, { shape: "circle", radius }),
      layer: selected.componentLayer?.name ?? "wall",
    };
  }
  const width = roundPlacementResizeValue(
    Math.max(PLACEMENT_RESIZE_MIN_SIZE, Math.abs(pointerWorld.x - selected.transform.x) * 2 / scale),
  );
  const height = roundPlacementResizeValue(
    Math.max(PLACEMENT_RESIZE_MIN_SIZE, Math.abs(pointerWorld.y - selected.transform.y) * 2 / scale),
  );
  return {
    visual: {
      kind: "primitive",
      shape: "rect",
      width,
      height,
      color: visual.color ?? DEFAULT_PRIMITIVE_COLOR,
    },
    collider: placementColliderPatchForResize(selected.collider, { shape: "rect", width, height }),
    layer: selected.componentLayer?.name ?? "wall",
  };
}

function placementColliderPatchForResize(
  collider: ResolvedDataSceneColliderComponent | undefined,
  resize:
    | { shape: "rect"; width: number; height: number }
    | { shape: "circle"; radius: number },
): PlacementJsonValue {
  if (collider === undefined || collider.type === "none") {
    return "none";
  }
  const base = placementColliderBasePatchFromResolved(collider);
  if (resize.shape === "rect" && collider.type === "aabb") {
    return {
      type: "aabb",
      ...base,
      halfWidth: resize.width * 0.5,
      halfHeight: resize.height * 0.5,
    };
  }
  if (resize.shape === "circle" && collider.type === "circle") {
    return {
      type: "circle",
      ...base,
      radius: resize.radius,
    };
  }
  return placementColliderPatchFromResolved(collider);
}

function placementColliderPatchFromResolved(
  collider: ResolvedDataSceneColliderComponent,
  offset?: { offsetX: number; offsetY: number },
): PlacementJsonValue {
  if (collider.type === "none") {
    return "none";
  }
  const base = placementColliderBasePatchFromResolved(collider, offset);
  switch (collider.type) {
    case "aabb":
      return {
        type: "aabb",
        ...base,
        halfWidth: collider.halfWidth,
        halfHeight: collider.halfHeight,
      };
    case "circle":
      return {
        type: "circle",
        ...base,
        radius: collider.radius,
      };
    case "capsule":
      return {
        type: "capsule",
        ...base,
        startX: collider.startX,
        startY: collider.startY,
        endX: collider.endX,
        endY: collider.endY,
        radius: collider.radius,
      };
    case "orientedBox":
      return {
        type: "orientedBox",
        ...base,
        halfWidth: collider.halfWidth,
        halfHeight: collider.halfHeight,
        rotationRadians: collider.rotationRadians,
      };
    case "convexPolygon":
      return {
        type: "convexPolygon",
        ...base,
        vertices: collider.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
        rotationRadians: collider.rotationRadians,
      };
  }
}

function placementColliderBasePatchFromResolved(
  collider: Exclude<ResolvedDataSceneColliderComponent, { type: "none" }>,
  offset?: { offsetX: number; offsetY: number },
): PlacementJsonObject {
  return {
    offsetX: offset?.offsetX ?? collider.offsetX,
    offsetY: offset?.offsetY ?? collider.offsetY,
    enabled: collider.enabled,
    isTrigger: collider.isTrigger,
  };
}

function placementVisualPatchFromResolved(
  visual: ResolvedDataSceneObjectVisual,
): PlacementJsonObject {
  if (visual.kind === "primitive") {
    const base = {
      kind: "primitive",
      shape: visual.shape,
      ...(visual.color === undefined ? {} : { color: visual.color }),
    };
    if (visual.shape === "circle") {
      return {
        ...base,
        radius: visual.radius ?? visual.width * 0.5,
      };
    }
    if (visual.shape === "point") {
      return {
        ...base,
        width: visual.width,
      };
    }
    return {
      ...base,
      width: visual.width,
      height: visual.height,
    };
  }
  const texture = visual.texture.kind === "asset"
    ? { asset: visual.texture.name ?? String(visual.texture.value) }
    : { texture: visual.texture.id ?? visual.texture.value };
  return {
    kind: "sprite",
    ...texture,
    width: visual.width,
    height: visual.height,
    frame: spriteFramePatch(visual.frame),
    ...(visual.animation === undefined ? {} : {
      animation: {
        frameCount: visual.animation.frameCount,
        fps: visual.animation.fps,
      },
    }),
    originX: visual.originX,
    originY: visual.originY,
    ...(visual.layer === undefined ? {} : { layer: visual.layer }),
    ...(visual.sortOrder === undefined ? {} : { sortOrder: visual.sortOrder }),
    ...(visual.tint === undefined ? {} : { tint: visual.tint }),
    ...(visual.color === undefined ? {} : { color: visual.color }),
  };
}

function roundPlacementResizeValue(value: number): number {
  return Math.round(value * 10) / 10;
}

function installPlacementKeyboard(
  canvas: HTMLCanvasElement,
  viewer: ScenePlacementViewer,
  interaction: PlacementInteractionState,
  setState: (state: ScenePlacementViewerState) => ScenePlacementViewerState,
): void {
  canvas.tabIndex = 0;
  canvas.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    const delta = keyboardNudgeDelta(event.code);
    if (delta === undefined) {
      return;
    }
    event.preventDefault();
    const base = interaction.enabled ? interaction.gridSize : KEYBOARD_NUDGE_STEP;
    const multiplier = event.shiftKey ? KEYBOARD_FAST_MULTIPLIER : 1;
    nudgeSelectedInstance(viewer, interaction, {
      x: delta.x * base * multiplier,
      y: delta.y * base * multiplier,
    }, setState);
  });
}

function applyTransformInput(
  viewer: ScenePlacementViewer,
  interaction: PlacementInteractionState,
  field: string,
  input: HTMLInputElement,
  setState: (state: ScenePlacementViewerState) => ScenePlacementViewerState,
): void {
  const selected = viewer.state().selected;
  const value = numberInputValue(input);
  if (selected === undefined || value === undefined) {
    return;
  }
  if (field === "x" || field === "y") {
    const point = snappedPlacementPoint({
      x: field === "x" ? value : selected.transform.x,
      y: field === "y" ? value : selected.transform.y,
    }, interaction);
    setState(viewer.updateInstanceTransform(selected.instanceId, point));
    return;
  }
  if (field === "scale") {
    setState(viewer.updateInstanceTransform(selected.instanceId, { scale: value }));
    return;
  }
  if (field === "rotationRadians") {
    setState(viewer.updateInstanceTransform(selected.instanceId, { rotationRadians: value }));
    return;
  }
  if (field === "layer") {
    setState(viewer.updateInstanceTransform(selected.instanceId, { layer: value }));
  }
}

function snapSelectedInstance(
  viewer: ScenePlacementViewer,
  interaction: PlacementInteractionState,
  setState: (state: ScenePlacementViewerState) => ScenePlacementViewerState,
): ScenePlacementViewerState | undefined {
  const selected = viewer.state().selected;
  if (selected === undefined) {
    return undefined;
  }
  const point = snappedPlacementPoint(selected.transform, interaction);
  return setState(viewer.updateInstanceTransform(selected.instanceId, point));
}

function nudgeSelectedInstance(
  viewer: ScenePlacementViewer,
  interaction: PlacementInteractionState,
  delta: Partial<ScenePlacementPoint>,
  setState: (state: ScenePlacementViewerState) => ScenePlacementViewerState,
): ScenePlacementViewerState | undefined {
  const selected = viewer.state().selected;
  if (selected === undefined) {
    return undefined;
  }
  const point = snappedPlacementPoint({
    x: selected.transform.x + (delta.x ?? 0),
    y: selected.transform.y + (delta.y ?? 0),
  }, interaction);
  return setState(viewer.updateInstanceTransform(selected.instanceId, point));
}

function createDraftPlacementInstance(
  state: ScenePlacementViewerState,
  action: PlacementAddAction,
  options: PlacementDraftOptions = {},
): SceneCompositionFragmentInstanceSpec {
  switch (action) {
    case "add-rect":
      return createDraftPrimitiveInstance(state, "rect", options);
    case "add-circle":
      return createDraftPrimitiveInstance(state, "circle", options);
    case "add-point":
      return createDraftPrimitiveInstance(state, "point", options);
    case "add-sprite":
      return createDraftSpriteInstance(state, options);
    case "add-prefab":
      return createDraftPrefabInstance(state, options);
  }
}

interface PlacementDraftOptions {
  point?: ScenePlacementPoint;
  instanceId?: string;
  spriteAsset?: string;
  spriteFrame?: string;
  prefabId?: string;
}

function createDraftPrefabInstance(
  state: ScenePlacementViewerState,
  options: PlacementDraftOptions,
): SceneCompositionFragmentInstanceSpec {
  const anchor = draftPlacementAnchor(state, options);
  const prefab = options.prefabId ?? "crate";
  return {
    id: options.instanceId ?? nextPlacementInstanceId(state, prefab),
    prefab,
    x: Math.round(anchor.x),
    y: Math.round(anchor.y),
  };
}

function createDraftSpriteInstance(
  state: ScenePlacementViewerState,
  options: PlacementDraftOptions,
): SceneCompositionFragmentInstanceSpec {
  const anchor = draftPlacementAnchor(state, options);
  const asset = options.spriteAsset ?? "crate";
  const frame = selectedPlacementSpriteFrame(PLACEMENT_ASSET_PROVIDER, asset, options.spriteFrame);
  const size = placementSpriteAssetSize(PLACEMENT_ASSET_PROVIDER, asset, frame);
  return {
    id: options.instanceId ?? nextPlacementInstanceId(state, asset),
    prefab: "object",
    x: Math.round(anchor.x),
    y: Math.round(anchor.y),
    props: {
      components: {
        visual: {
          kind: "sprite",
          asset,
          ...size,
          ...(frame?.frame === undefined ? {} : { frame: { ...frame.frame } }),
          originX: 0.5,
          originY: 0.5,
        },
        collider: {
          type: "aabb",
          halfWidth: size.width * 0.5,
          halfHeight: size.height * 0.5,
        },
        layer: "wall",
      },
    },
  };
}

function createDraftPrimitiveInstance(
  state: ScenePlacementViewerState,
  shape: DataScenePrimitiveVisualShape,
  options: PlacementDraftOptions,
): SceneCompositionFragmentInstanceSpec {
  const anchor = draftPlacementAnchor(state, options);
  const base = {
    prefab: "object",
    x: Math.round(anchor.x),
    y: Math.round(anchor.y),
  };
  if (shape === "circle") {
    return {
      ...base,
      id: options.instanceId ?? nextPlacementInstanceId(state, "circle"),
      props: {
        components: {
          visual: {
            kind: "primitive",
            shape,
            radius: 18,
            color: "#7ddc9d",
          },
          collider: {
            type: "circle",
            radius: 18,
          },
          layer: "wall",
        },
      },
    };
  }
  if (shape === "point") {
    return {
      ...base,
      id: options.instanceId ?? nextPlacementInstanceId(state, "point"),
      props: {
        components: {
          visual: {
            kind: "primitive",
            shape,
            width: 12,
            color: "#f2c14e",
          },
          collider: "none",
          layer: "pickup",
        },
      },
    };
  }
  return {
    ...base,
    id: options.instanceId ?? nextPlacementInstanceId(state, "rect"),
    props: {
      components: {
        visual: {
          kind: "primitive",
          shape,
          width: 48,
          height: 32,
          color: "#7ddc9d",
        },
        collider: {
          type: "aabb",
          halfWidth: 24,
          halfHeight: 16,
        },
        layer: "wall",
      },
    },
  };
}

function draftPlacementAnchor(
  state: ScenePlacementViewerState,
  options: PlacementDraftOptions,
): ScenePlacementPoint {
  if (options.point !== undefined) {
    return options.point;
  }
  if (state.pointerWorld !== undefined) {
    return state.pointerWorld;
  }
  const selected = state.selected?.transform;
  if (selected !== undefined) {
    return {
      x: selected.x + DEFAULT_SNAP_GRID_SIZE,
      y: selected.y + DEFAULT_SNAP_GRID_SIZE,
    };
  }
  return {
    x: (state.viewport.worldMinX + state.viewport.worldMaxX) * 0.5,
    y: (state.viewport.worldMinY + state.viewport.worldMaxY) * 0.5,
  };
}

function placementSpriteAssetSize(
  assetProvider: ScenePlacementAssetProvider,
  asset: string,
  frame?: ScenePlacementSpriteFrameAsset,
): PlacementInstanceBounds {
  const sprite = assetProvider.resolveSpriteAsset(asset);
  return {
    width: frame?.width ?? sprite?.width ?? 40,
    height: frame?.height ?? sprite?.height ?? 40,
  };
}

function selectedPlacementSpriteFrame(
  assetProvider: ScenePlacementAssetProvider,
  asset: string,
  frameId: string | undefined,
): ScenePlacementSpriteFrameAsset | undefined {
  return frameId === undefined || frameId.length === 0
    ? undefined
    : assetProvider.resolveSpriteFrame(asset, frameId);
}

function placementSpriteAssetOptions(assetProvider: ScenePlacementAssetProvider): readonly string[] {
  const ids = assetProvider.listSpriteAssets().map((asset) => asset.id);
  return ids.length === 0 ? ["crate"] : ids;
}

function placementPrefabOptions(resolved: ResolvedSceneAuthoringDocument): readonly string[] {
  const ids = Object.keys(resolved.sceneComposition.prefabs).filter((id) => id !== "object");
  return ids.length === 0 ? ["object"] : ids;
}

function syncPlacementPrefabOptions(
  select: HTMLSelectElement,
  state: ScenePlacementViewerState,
): void {
  const ids = placementPrefabOptionsFromState(state);
  const current = select.value;
  const previous = Array.from(select.options).map((option) => option.value);
  if (
    previous.length === ids.length
    && previous.every((id, index) => id === ids[index])
  ) {
    return;
  }
  select.replaceChildren(...ids.map((id) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = id;
    return option;
  }));
  select.value = ids.includes(current)
    ? current
    : ids.includes("crate")
      ? "crate"
      : ids[0] ?? "object";
}

function placementPrefabOptionsFromState(state: ScenePlacementViewerState): readonly string[] {
  const ids = state.objectDefinitions.map((definition) => definition.id).filter((id) => id !== "object");
  return ids.length === 0 ? ["object"] : ids;
}

function nextPlacementObjectDefinitionId(
  state: ScenePlacementViewerState,
  instanceId: string,
): string {
  const existing = new Set(state.objectDefinitions.map((definition) => definition.id));
  const base = `${instanceId.replace(/[^A-Za-z0-9_.-]+/g, "_")}_definition`;
  if (!existing.has(base)) {
    return base;
  }
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${base}_${index}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
  return `${base}_${Date.now()}`;
}

function placementObjectDefinitionFromSelected(
  selected: ScenePlacementViewerInstance,
): Parameters<ScenePlacementViewer["addObjectDefinition"]>[1] {
  if (selected.visual === undefined) {
    throw new Error("object definition creation requires selected visual components.");
  }
  return {
    props: {
      components: {
        visual: placementVisualPatchFromResolved(selected.visual),
        collider: selected.collider === undefined
          ? "none"
          : placementColliderPatchFromResolved(selected.collider),
        layer: selected.componentLayer?.name ?? "wall",
      },
    },
  };
}

function pendingPlacementBounds(action: PlacementAddAction): PlacementInstanceBounds {
  switch (action) {
    case "add-rect":
      return { width: 48, height: 32 };
    case "add-circle":
      return { width: 36, height: 36 };
    case "add-point":
      return { width: 12, height: 12 };
    case "add-sprite":
    case "add-prefab":
      return { width: 40, height: 40 };
  }
}

function placementAddLabel(action: PlacementAddAction): string {
  switch (action) {
    case "add-rect":
      return "Rect";
    case "add-circle":
      return "Circle";
    case "add-point":
      return "Point";
    case "add-sprite":
      return "Sprite";
    case "add-prefab":
      return "Prefab";
  }
}

function placementDraftOptionsFromControls(
  root: HTMLElement,
  action: PlacementAddAction,
): Omit<PlacementDraftOptions, "point"> {
  const options: Omit<PlacementDraftOptions, "point"> = {};
  const id = root.querySelector<HTMLInputElement>("input[data-placement-add-id='true']")?.value.trim();
  if (id !== undefined && id.length > 0) {
    options.instanceId = id;
  }
  if (action === "add-sprite") {
    const spriteAsset = selectedPlacementOption(root, "placementAddSprite");
    if (spriteAsset !== undefined) {
      options.spriteAsset = spriteAsset;
    }
    const spriteFrame = selectedPlacementOption(root, "placementAddSpriteFrame");
    if (spriteFrame !== undefined) {
      options.spriteFrame = spriteFrame;
    }
  }
  if (action === "add-prefab") {
    const prefabId = selectedPlacementOption(root, "placementAddPrefab");
    if (prefabId !== undefined) {
      options.prefabId = prefabId;
    }
  }
  return options;
}

function selectedPlacementOption(
  root: HTMLElement,
  key: "placementAddSprite" | "placementAddSpriteFrame" | "placementAddPrefab",
): string | undefined {
  const selector = key === "placementAddSprite"
    ? "select[data-placement-add-sprite='true']"
    : key === "placementAddSpriteFrame"
      ? "select[data-placement-add-sprite-frame='true']"
      : "select[data-placement-add-prefab='true']";
  const value = root.querySelector<HTMLSelectElement>(selector)?.value.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function reportPlacementAddError(root: HTMLElement, error: unknown): void {
  const input = root.querySelector<HTMLInputElement>("input[data-placement-add-id='true']");
  if (input === null) {
    throw error;
  }
  input.setCustomValidity(error instanceof Error ? error.message : String(error));
  input.reportValidity();
}

function clearPlacementAddError(root: HTMLElement): void {
  const input = root.querySelector<HTMLInputElement>("input[data-placement-add-id='true']");
  input?.setCustomValidity("");
}

function reportPlacementDefinitionError(root: HTMLElement, error: unknown): void {
  const input = root.querySelector<HTMLInputElement>("input[data-placement-definition-id='true']");
  if (input === null) {
    throw error;
  }
  input.setCustomValidity(error instanceof Error ? error.message : String(error));
  input.reportValidity();
}

function clearPlacementDefinitionError(root: HTMLElement): void {
  const input = root.querySelector<HTMLInputElement>("input[data-placement-definition-id='true']");
  input?.setCustomValidity("");
}

function nextPlacementInstanceId(state: ScenePlacementViewerState, prefix: string): string {
  const existing = new Set(state.instances.map((instance) => instance.instanceId));
  for (let index = 1; index < 10_000; index += 1) {
    const candidate = `${prefix}_${index}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Unable to allocate ${prefix} instance id.`);
}

function queuePlacementDragUpdate(
  viewer: ScenePlacementViewer,
  interaction: PlacementInteractionState,
  drag: {
    instanceId: string;
    offsetX: number;
    offsetY: number;
    latestPoint: ScenePlacementPoint;
    queued: boolean;
  },
  setState: (state: ScenePlacementViewerState) => ScenePlacementViewerState,
): void {
  if (drag.queued) {
    return;
  }
  drag.queued = true;
  requestAnimationFrame(() => {
    drag.queued = false;
    const pointerState = viewer.pointerAtScreen(drag.latestPoint);
    if (pointerState.pointerWorld === undefined) {
      return;
    }
    const point = snappedPlacementPoint({
      x: pointerState.pointerWorld.x + drag.offsetX,
      y: pointerState.pointerWorld.y + drag.offsetY,
    }, interaction);
    setState(viewer.updateInstanceTransform(drag.instanceId, point));
  });
}

function finishPlacementDrag(
  canvas: HTMLCanvasElement,
  pointerId: number,
  interaction: PlacementInteractionState,
): void {
  interaction.dragging = false;
  publishPlacementInteraction(interaction);
  delete canvas.dataset.dragging;
  if (canvas.hasPointerCapture(pointerId)) {
    canvas.releasePointerCapture(pointerId);
  }
}

function keyboardNudgeDelta(code: string): ScenePlacementPoint | undefined {
  switch (code) {
    case "ArrowLeft":
      return { x: -1, y: 0 };
    case "ArrowRight":
      return { x: 1, y: 0 };
    case "ArrowUp":
      return { x: 0, y: -1 };
    case "ArrowDown":
      return { x: 0, y: 1 };
    default:
      return undefined;
  }
}

function snappedPlacementPoint(
  point: ScenePlacementPoint,
  interaction: PlacementInteractionState,
): ScenePlacementPoint {
  if (!interaction.enabled) {
    return point;
  }
  return snapSceneWorldPoint(point, {
    gridSize: interaction.gridSize,
  });
}

function installPlacementResize(
  canvas: HTMLCanvasElement,
  engine: FerrumRuntime["engine"],
  viewer: ScenePlacementViewer,
  setState: (state: ScenePlacementViewerState) => ScenePlacementViewerState,
): void {
  const observer = new ResizeObserver(() => {
    setState(viewer.updateViewport(viewportForCanvas(canvas, engine)));
  });
  observer.observe(canvas);
  window.addEventListener("beforeunload", () => observer.disconnect(), { once: true });
}

function installPlacementHooks(
  viewer: ScenePlacementViewer,
  interaction: PlacementInteractionState,
  setState: (state: ScenePlacementViewerState) => ScenePlacementViewerState,
  save: {
    saveEnabled: boolean;
    saveDraft(): Promise<ScenePlacementPatchSaveResult | undefined>;
  },
): void {
  const target = window as PlacementViewerWindow;
  target.__ferrumPlacementViewer = viewer;
  target.ferrumPlacementViewerSelect = (instanceId?: string) => {
    return setState(viewer.selectInstance(instanceId));
  };
  target.ferrumPlacementViewerUpdateTransform = (
    instanceId: string,
    transform: Partial<ScenePlacementTransform>,
  ) => {
    return setState(viewer.updateInstanceTransform(instanceId, transform));
  };
  target.ferrumPlacementViewerUpdateComponents = (
    instanceId: string,
    components: Parameters<ScenePlacementViewer["updateInstanceComponents"]>[1],
  ) => {
    return setState(viewer.updateInstanceComponents(instanceId, components));
  };
  target.ferrumPlacementViewerUpdateBehaviorBinding = (
    behaviorTarget: ScenePlacementBehaviorBindingTarget,
    behaviorRecipes: ScenePlacementBehaviorBindingPatch,
  ) => {
    return setState(viewer.updateBehaviorBinding(behaviorTarget, behaviorRecipes));
  };
  target.ferrumPlacementViewerRenameInstance = (instanceId: string, nextInstanceId: string) => {
    return setState(viewer.renameInstance(instanceId, nextInstanceId));
  };
  target.ferrumPlacementViewerAddInstance = (
    fragment: string,
    instance: SceneCompositionFragmentInstanceSpec,
  ) => {
    return setState(viewer.addInstance(fragment, instance));
  };
  target.ferrumPlacementViewerAddObjectDefinition = (
    definitionId: string,
    definition: Parameters<ScenePlacementViewer["addObjectDefinition"]>[1],
  ) => {
    return setState(viewer.addObjectDefinition(definitionId, definition));
  };
  target.ferrumPlacementViewerRemoveInstance = (instanceId: string) => {
    return setState(viewer.removeInstance(instanceId));
  };
  target.ferrumPlacementViewerClearDraft = () => {
    return setState(viewer.clearDraftPatch());
  };
  target.ferrumPlacementViewerExportPatch = () => viewer.exportPatch();
  target.ferrumPlacementViewerSaveEnabled = save.saveEnabled;
  target.ferrumPlacementViewerSaveDraft = save.saveDraft;
  target.ferrumPlacementViewerNudgeSelected = (delta: Partial<ScenePlacementPoint>) => {
    return nudgeSelectedInstance(viewer, interaction, delta, setState);
  };
  target.ferrumPlacementViewerSetSnap = (options: Partial<PlacementSnapOptions>) => {
    if (options.enabled !== undefined) {
      interaction.enabled = options.enabled;
    }
    if (options.gridSize !== undefined && Number.isFinite(options.gridSize) && options.gridSize > 0) {
      interaction.gridSize = options.gridSize;
    }
    publishPlacementInteraction(interaction);
    return placementInteractionSnapshot(interaction);
  };
  publishPlacementInteraction(interaction);
}

function publishPlacementState(state: ScenePlacementViewerState): void {
  (window as PlacementViewerWindow).ferrumPlacementViewerState = state;
}

let placementAgentHandoffTimer: number | undefined;

function publishPlacementAgentHandoff(
  document: SceneAuthoringDocumentSpec,
  state: ScenePlacementViewerState,
  migrationPreview: ScenePlacementBindingMigrationPreview | undefined,
  assetProvider: ScenePlacementAssetProvider,
  sourceDocument: string,
): void {
  const handoff = createScenePlacementAgentHandoff({
    document,
    state,
    sourceDocument,
    assetDiagnostics: placementAssetDiagnosticsForState(state, assetProvider),
    path: "placementViewer.agentHandoff",
  });
  const published = migrationPreview === undefined
    ? handoff
    : { ...handoff, migrationPreview };
  (window as PlacementViewerWindow).ferrumPlacementViewerAgentHandoff = published;
  if (!import.meta.env.DEV) {
    return;
  }
  if (placementAgentHandoffTimer !== undefined) {
    window.clearTimeout(placementAgentHandoffTimer);
  }
  placementAgentHandoffTimer = window.setTimeout(() => {
    placementAgentHandoffTimer = undefined;
    void fetch("/__ferrum-placement-handoff", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(published),
    }).catch(() => {
      // The handoff endpoint exists only in the official dev host.
    });
  }, 120);
}

function placementAssetDiagnosticsForState(
  state: ScenePlacementViewerState,
  assetProvider: ScenePlacementAssetProvider,
): readonly ScenePlacementAssetDiagnostic[] {
  const diagnostics: ScenePlacementAssetDiagnostic[] = [];
  for (const instance of state.instances) {
    const visual = instance.visual;
    if (visual?.kind !== "sprite" || visual.texture.kind !== "asset") {
      continue;
    }
    diagnostics.push(...assetProvider.diagnoseSpriteAssetReference({
      asset: visual.texture.name ?? String(visual.texture.value),
      path: `placementViewer.instances.${instance.instanceId}.visual.asset`,
    }));
  }
  return diagnostics;
}

function publishPlacementSavedDocument(document: SceneAuthoringDocumentSpec): void {
  (window as PlacementViewerWindow).ferrumPlacementViewerSavedDocument = document;
}

function publishPlacementMigrationPreview(preview: ScenePlacementBindingMigrationPreview | undefined): void {
  const target = window as PlacementViewerWindow;
  if (preview === undefined) {
    delete target.ferrumPlacementViewerMigrationPreview;
    return;
  }
  target.ferrumPlacementViewerMigrationPreview = preview;
}

function publishPlacementSaveResult(result: ScenePlacementPatchSaveResult): void {
  (window as PlacementViewerWindow).ferrumPlacementViewerLastSave = result;
}

async function savePlacementSceneDocument(
  document: SceneAuthoringDocumentSpec,
): Promise<{ saved: true; document: SceneAuthoringDocumentSpec }> {
  const response = await fetch(SCENE_DOCUMENT_SAVE_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(document),
  });
  if (!response.ok) {
    throw new Error(`Failed to save placement scene document: ${response.status} ${response.statusText}`);
  }
  const json = await response.json() as unknown;
  if (!isPlacementSaveResponse(json)) {
    throw new Error("Failed to save placement scene document: invalid save response");
  }
  return json;
}

function isPlacementSaveResponse(value: unknown): value is { saved: true; document: SceneAuthoringDocumentSpec } {
  return typeof value === "object"
    && value !== null
    && (value as { saved?: unknown }).saved === true
    && typeof (value as { document?: { format?: unknown } }).document?.format === "string";
}

function publishPlacementInteraction(interaction: PlacementInteractionState): void {
  (window as PlacementViewerWindow).ferrumPlacementViewerInteraction = placementInteractionSnapshot(interaction);
}

function placementInteractionSnapshot(interaction: PlacementInteractionState): PlacementInteractionSnapshot {
  return {
    enabled: interaction.enabled,
    gridSize: interaction.gridSize,
    dragging: interaction.dragging,
    ...(interaction.pendingAdd === undefined ? {} : { pendingAdd: interaction.pendingAdd }),
  };
}

function placementMigrationPreview(
  document: SceneAuthoringDocumentSpec,
  patch: ScenePlacementPatch | undefined,
): ScenePlacementBindingMigrationPreview | undefined {
  return patch === undefined
    ? undefined
    : previewScenePlacementBindingMigration(document, patch, {
      path: "placementViewer.migration",
    });
}

function publishFrameStats(frame: FerrumRuntimeFrame): void {
  const target = window as Window & Record<string, unknown>;
  target.ferrumPlacementViewerRuntimeFrame = {
    entityCount: frame.frame.entityCount,
    renderCommandCount: frame.rendererStats.renderCommandCount,
    drawCalls: frame.rendererStats.drawCalls,
  };
}

function createPlacementInteractionState(): PlacementInteractionState {
  return {
    enabled: false,
    gridSize: DEFAULT_SNAP_GRID_SIZE,
    dragging: false,
  };
}

function placementViewerSaveEnabled(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_FERRUM_PLACEMENT_VIEWER_SAVE === "true";
}

function placementBoundsById(
  resolved: ResolvedSceneAuthoringDocument,
): Map<string, PlacementInstanceBounds> {
  const bounds = new Map<string, PlacementInstanceBounds>();
  for (const instance of resolved.bindingPlan?.instances ?? []) {
    const components = resolveDataSceneInstanceComponents(instance, {
      allowTemplate: false,
      path: `placementViewer.instances.${instance.id}`,
    });
    if (components.mode !== "inline") {
      continue;
    }
    bounds.set(instance.id, dataSceneObjectVisualBounds(components));
  }
  return bounds;
}

function placementBoundsForInstance(
  instance: ScenePlacementViewerInstance,
  boundsById: ReadonlyMap<string, PlacementInstanceBounds>,
): PlacementInstanceBounds | undefined {
  if (instance.visual !== undefined) {
    return {
      width: instance.visual.bounds.width,
      height: instance.visual.bounds.height,
    };
  }
  return boundsById.get(instance.sourceId) ?? boundsById.get(instance.instanceId);
}

function placementVisualLabel(instance: ScenePlacementViewerInstance | undefined): string {
  const visual = instance?.visual;
  if (visual === undefined) {
    return "-";
  }
  if (visual.kind === "primitive") {
    return `${visual.shape} ${formatNumber(visual.bounds.width)}x${formatNumber(visual.bounds.height)}`;
  }
  const texture = visual.texture.kind === "asset"
    ? visual.texture.name ?? String(visual.texture.value)
    : `#${visual.texture.id ?? visual.texture.value}`;
  return `${texture} ${formatNumber(visual.bounds.width)}x${formatNumber(visual.bounds.height)}`;
}

function placementColliderLabel(instance: ScenePlacementViewerInstance | undefined): string {
  const collider = instance?.collider;
  if (collider === undefined) {
    return "-";
  }
  switch (collider.type) {
    case "none":
      return "none";
    case "aabb":
      return `aabb ${formatNumber(collider.halfWidth * 2)}x${formatNumber(collider.halfHeight * 2)}`;
    case "circle":
      return `circle r${formatNumber(collider.radius)}`;
    case "capsule":
      return `capsule r${formatNumber(collider.radius)}`;
    case "orientedBox":
      return `orientedBox ${formatNumber(collider.halfWidth * 2)}x${formatNumber(collider.halfHeight * 2)}`;
    case "convexPolygon":
      return `convexPolygon ${collider.vertices.length}`;
  }
}

function firstActorInstance(resolved: ResolvedSceneAuthoringDocument): string | undefined {
  for (const binding of resolved.bindingPlan?.bindings ?? []) {
    return binding.instance.id;
  }
  return undefined;
}

function viewportForCanvas(canvas: HTMLCanvasElement, engine?: FerrumRuntime["engine"]) {
  const rect = canvas.getBoundingClientRect();
  const cssWidth = Math.max(1, rect.width || canvas.clientWidth || canvas.width);
  const cssHeight = Math.max(1, rect.height || canvas.clientHeight || canvas.height);
  const viewport = {
    cssWidth,
    cssHeight,
    dpr: window.devicePixelRatio || 1,
    backbufferWidth: Math.max(1, canvas.width),
    backbufferHeight: Math.max(1, canvas.height),
  };
  if (engine === undefined) {
    return viewport;
  }
  return {
    ...viewport,
    cameraX: engine.cameraX(),
    cameraY: engine.cameraY(),
  };
}

function pointerScreenPoint(canvas: HTMLCanvasElement, event: PointerEvent | MouseEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

async function loadSceneAuthoringDocument(url: string): Promise<SceneAuthoringDocumentSpec> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status} ${response.statusText}`.trim());
  }
  return await response.json() as SceneAuthoringDocumentSpec;
}

function appendNumberControl(
  parent: HTMLElement,
  label: string,
  field: string,
  step: string,
  min?: string,
): HTMLInputElement {
  return appendAuthoringViewerNumberControl(parent, {
    label,
    className: "placement-control",
    step,
    min,
    dataset: field === "snapGrid"
      ? { placementSnapGrid: "true" }
      : { placementTransformField: field },
  });
}

function appendTextControl(parent: HTMLElement, label: string, field: string): HTMLInputElement {
  return appendAuthoringViewerTextControl(parent, {
    label,
    className: "placement-control",
    dataset: textControlDataset(field),
  });
}

function appendSelectControl(
  parent: HTMLElement,
  label: string,
  field: string,
  options: readonly string[],
): HTMLSelectElement {
  return appendAuthoringViewerSelectControl(parent, {
    label,
    className: "placement-control",
    options,
    dataset: selectControlDataset(field),
  });
}

function textControlDataset(field: string): Record<string, string> {
  if (field === "rename") {
    return { placementRenameId: "true" };
  }
  if (field === "addId") {
    return { placementAddId: "true" };
  }
  if (field === "definitionId") {
    return { placementDefinitionId: "true" };
  }
  return {};
}

function selectControlDataset(field: string): Record<string, string> {
  if (field === "addSprite") {
    return { placementAddSprite: "true" };
  }
  if (field === "addSpriteFrame") {
    return { placementAddSpriteFrame: "true" };
  }
  if (field === "addPrefab") {
    return { placementAddPrefab: "true" };
  }
  if (field === "behaviorRecipe") {
    return { placementBehaviorRecipe: "true" };
  }
  return {};
}

function appendComponentNumberControl(
  parent: HTMLElement,
  label: string,
  field: string,
  step: string,
  min?: string,
): HTMLInputElement {
  return appendAuthoringViewerNumberControl(parent, {
    label,
    className: "placement-control",
    step,
    min,
    dataset: { placementComponentField: field },
  });
}

function appendComponentColorControl(
  parent: HTMLElement,
  label: string,
  field: string,
): HTMLInputElement {
  const wrapper = document.createElement("label");
  const labelText = document.createElement("span");
  const input = document.createElement("input");
  wrapper.className = "placement-control";
  labelText.textContent = label;
  input.type = "color";
  input.dataset.placementComponentField = field;
  wrapper.append(labelText, input);
  parent.append(wrapper);
  return input;
}

function appendComponentSelectControl<T extends string>(
  parent: HTMLElement,
  label: string,
  field: string,
  options: readonly T[],
): HTMLSelectElement {
  return appendAuthoringViewerSelectControl(parent, {
    label,
    className: "placement-control",
    options,
    dataset: { placementComponentField: field },
  });
}

function appendComponentTextareaControl(
  parent: HTMLElement,
  label: string,
  field: string,
): HTMLTextAreaElement {
  return appendAuthoringViewerTextareaControl(parent, {
    label,
    className: "placement-control placement-control-textarea",
    rows: 3,
    dataset: { placementComponentField: field },
  });
}

function appendComponentCheckboxControl(
  parent: HTMLElement,
  label: string,
  field: string,
): HTMLInputElement {
  return appendAuthoringViewerCheckboxControl(parent, {
    label,
    className: "placement-control placement-control-checkbox",
    dataset: { placementComponentField: field },
  });
}

function appendCheckboxControl(parent: HTMLElement, label: string, field: string): HTMLInputElement {
  return appendAuthoringViewerCheckboxControl(parent, {
    label,
    className: "placement-control placement-control-checkbox",
    dataset: field === "snap" ? { placementSnapToggle: "true" } : {},
  });
}

function normalizedPlacementColor(value: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : DEFAULT_PRIMITIVE_COLOR;
}

function placementGameStateLabel(code: number): string {
  if (code === 0) return "Ready";
  if (code === 1) return "Preview";
  if (code === 2) return "Stopped";
  return `State ${code}`;
}

void bootstrap();
