import {
  createFerrumRuntime,
  diagnosticReport,
  type FerrumRuntime,
  type FerrumRuntimeFrame,
} from "@ferrum2d/ferrum-web";
import {
  applySceneBehaviorRecipes,
  createDataSceneRuntimeTarget,
  createSceneInstanceHandleRegistry,
  createScenePlacementViewer,
  previewScenePlacementBindingMigration,
  resolveDataSceneInstanceComponents,
  resolveSceneAuthoringDocument,
  saveScenePlacementPatch,
  snapSceneWorldPoint,
  worldToSceneScreen,
  type ResolvedSceneAuthoringDocument,
  type SceneAuthoringDocumentSpec,
  type SceneCompositionFragmentInstanceSpec,
  type ScenePlacementBindingMigrationPreview,
  type ScenePlacementPatch,
  type ScenePlacementPatchSaveResult,
  type ScenePlacementSaveAdapter,
  type ScenePlacementPoint,
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
const VIEWER_TEXTURES = {
  floor: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPwCgv6DwAD0gHyPaP/ZQAAAABJRU5ErkJggg==",
  crate: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGM4MsHjPwAGVAKcjTneKQAAAABJRU5ErkJggg==",
  turret: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOI2FL3HwAFfAKKSdpdewAAAABJRU5ErkJggg==",
  agent: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNIWHbnPwAGLgLidJoamwAAAABJRU5ErkJggg==",
} as const;

interface PlacementViewerWindow extends Window {
  __ferrumPlacementViewer?: ScenePlacementViewer;
  ferrumPlacementViewerState?: ScenePlacementViewerState;
  ferrumPlacementViewerAgentHandoff?: PlacementViewerAgentHandoff;
  ferrumPlacementViewerSelect?: (instanceId?: string) => ScenePlacementViewerState;
  ferrumPlacementViewerUpdateTransform?: (
    instanceId: string,
    transform: Partial<ScenePlacementTransform>,
  ) => ScenePlacementViewerState;
  ferrumPlacementViewerRenameInstance?: (instanceId: string, nextInstanceId: string) => ScenePlacementViewerState;
  ferrumPlacementViewerAddInstance?: (
    fragment: string,
    instance: SceneCompositionFragmentInstanceSpec,
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
}

interface PlacementInteractionState extends PlacementSnapOptions {
  dragging: boolean;
}

interface PlacementViewerAgentHandoff {
  format: "ferrum2d.placement-viewer.agent-handoff";
  version: 1;
  sourceDocument: string;
  selectedInstanceId?: string;
  hoveredInstanceId?: string;
  selected?: ScenePlacementViewerState["selected"];
  pointerWorld?: ScenePlacementViewerState["pointerWorld"];
  draftPatch?: ScenePlacementPatch;
  migrationPreview?: ScenePlacementBindingMigrationPreview;
}

interface PlacementInspector {
  element: HTMLElement;
  setState(state: ScenePlacementViewerState, migrationPreview?: ScenePlacementBindingMigrationPreview): void;
}

interface PlacementOverlay {
  element: HTMLElement;
  setState(state: ScenePlacementViewerState): void;
}

interface PlacementSaveControls {
  saveDraft(): Promise<void>;
}

interface PlacementInspectorOptions {
  saveEnabled: boolean;
}

async function bootstrap(): Promise<void> {
  const shell = createRuntimeDemoShell({
    title: "Scene Placement Viewer",
    frameProperty: "ferrumPlacementViewerFrame",
    gameStateLabel: placementGameStateLabel,
  });
  let runtime: FerrumRuntime | undefined;
  try {
    const document = await loadSceneAuthoringDocument(SCENE_DOCUMENT_URL);
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
    const inspector = createPlacementInspector(resolved, { saveEnabled });
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
      overlay.setState(state);
      inspector.setState(state, migrationPreview);
      publishPlacementState(state);
      publishPlacementMigrationPreview(migrationPreview);
      publishPlacementInteraction(interaction);
      publishPlacementAgentHandoff(state, migrationPreview);
      return state;
    };
    installPlacementHooks(viewer, interaction, setState, {
      saveEnabled,
      saveDraft: async () => {
        const patch = viewer.exportPatch();
        if (patch === undefined || !saveEnabled) {
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
    installPlacementEditControls(inspector.element, viewer, setState);
    installPlacementPointer(shell.canvas, viewer, interaction, setState);
    installPlacementKeyboard(shell.canvas, viewer, interaction, setState);
    installPlacementResize(shell.canvas, runtime.engine, viewer, setState);
    setState(viewer.state());

    runtime.start();
  } catch (error) {
    runtime?.destroy();
    renderRuntimeDemoError(error, {
      title: "Scene Placement Viewer",
      diagnosticReport,
    });
  }
}

function createPlacementOverlay(
  stage: HTMLElement,
  boundsById: ReadonlyMap<string, PlacementInstanceBounds>,
): PlacementOverlay {
  const element = document.createElement("div");
  const draftLayer = document.createElement("div");
  const selection = document.createElement("div");
  const label = document.createElement("div");
  element.className = "placement-overlay";
  draftLayer.className = "placement-draft-layer";
  selection.className = "placement-selection";
  label.className = "placement-label";
  selection.append(label);
  element.append(draftLayer, selection);
  stage.append(element);

  return {
    element,
    setState(state) {
      renderPlacementDraftMarkers(draftLayer, state, boundsById);
      const selected = state.selected;
      if (selected === undefined) {
        selection.dataset.visible = "false";
        return;
      }
      const bounds = boundsById.get(selected.instanceId);
      if (bounds === undefined) {
        selection.dataset.visible = "false";
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
    },
  };
}

function renderPlacementDraftMarkers(
  layer: HTMLElement,
  state: ScenePlacementViewerState,
  boundsById: ReadonlyMap<string, PlacementInstanceBounds>,
): void {
  const draftIds = placementDraftVisibleInstanceIds(state);
  if (draftIds.size === 0) {
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
  const bounds = boundsById.get(instance.sourceId ?? instance.instanceId)
    ?? boundsById.get(instance.instanceId);
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

function createPlacementInspector(
  resolved: ResolvedSceneAuthoringDocument,
  options: PlacementInspectorOptions,
): PlacementInspector {
  const element = document.createElement("section");
  const title = document.createElement("h2");
  const list = document.createElement("div");
  const details = document.createElement("dl");
  const controls = createPlacementTransformControls({ saveEnabled: options.saveEnabled });
  const editControls = createPlacementEditControls();
  const rows = {
    selected: appendRow(details, "selected"),
    hovered: appendRow(details, "hovered"),
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
  detailPanel.append(title, details, controls.element, editControls.element);
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
      controls.setState(state);
      editControls.setState(state);
    },
  };
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
  setState(state: ScenePlacementViewerState): void;
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
    setState(state) {
      const selected = state.selected;
      const disabled = selected === undefined;
      for (const input of Object.values(fields)) {
        input.disabled = disabled;
      }
      const clean = state.draftPatch === undefined;
      save.disabled = clean || !options.saveEnabled;
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

function createPlacementEditControls(): {
  element: HTMLFormElement;
  setState(state: ScenePlacementViewerState): void;
} {
  const form = document.createElement("form");
  const row = document.createElement("div");
  const rename = appendTextControl(row, "id", "rename");
  const renameButton = document.createElement("button");
  const addButton = document.createElement("button");
  const removeButton = document.createElement("button");
  form.className = "placement-controls placement-edit-controls";
  row.className = "placement-control-grid placement-control-grid-edit";
  renameButton.type = "button";
  renameButton.textContent = "Rename";
  renameButton.dataset.placementAction = "rename-selected";
  addButton.type = "button";
  addButton.textContent = "Add crate";
  addButton.dataset.placementAction = "add-crate";
  removeButton.type = "button";
  removeButton.textContent = "Remove";
  removeButton.dataset.placementAction = "remove-selected";
  row.append(renameButton, addButton, removeButton);
  form.append(row);
  form.addEventListener("submit", (event) => event.preventDefault());

  return {
    element: form,
    setState(state) {
      const selected = state.selected;
      const disabled = selected === undefined;
      rename.disabled = disabled;
      renameButton.disabled = disabled;
      removeButton.disabled = disabled;
      if (document.activeElement !== rename) {
        rename.value = selected?.instanceId ?? "";
      }
    },
  };
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
    if (target.dataset.placementAction === "remove-selected") {
      const selected = viewer.state().selected;
      if (selected !== undefined) {
        setState(viewer.removeInstance(selected.instanceId));
      }
      return;
    }
    if (target.dataset.placementAction === "add-crate") {
      const state = viewer.state();
      setState(viewer.addInstance(state.fragment, createDraftCrateInstance(state)));
    }
  });
}

function installPlacementPointer(
  canvas: HTMLCanvasElement,
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

function createDraftCrateInstance(state: ScenePlacementViewerState): SceneCompositionFragmentInstanceSpec {
  const anchor = state.selected?.transform ?? state.pointerWorld ?? {
    x: (state.viewport.worldMinX + state.viewport.worldMaxX) * 0.5,
    y: (state.viewport.worldMinY + state.viewport.worldMaxY) * 0.5,
  };
  return {
    id: nextPlacementInstanceId(state, "crate"),
    prefab: "crate",
    x: Math.round(anchor.x + DEFAULT_SNAP_GRID_SIZE),
    y: Math.round(anchor.y + DEFAULT_SNAP_GRID_SIZE),
  };
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
  target.ferrumPlacementViewerRenameInstance = (instanceId: string, nextInstanceId: string) => {
    return setState(viewer.renameInstance(instanceId, nextInstanceId));
  };
  target.ferrumPlacementViewerAddInstance = (
    fragment: string,
    instance: SceneCompositionFragmentInstanceSpec,
  ) => {
    return setState(viewer.addInstance(fragment, instance));
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
  state: ScenePlacementViewerState,
  migrationPreview: ScenePlacementBindingMigrationPreview | undefined,
): void {
  const handoff = placementAgentHandoff(state, migrationPreview);
  (window as PlacementViewerWindow).ferrumPlacementViewerAgentHandoff = handoff;
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
      body: JSON.stringify(handoff),
    }).catch(() => {
      // The handoff endpoint exists only in the official dev host.
    });
  }, 120);
}

function placementAgentHandoff(
  state: ScenePlacementViewerState,
  migrationPreview: ScenePlacementBindingMigrationPreview | undefined,
): PlacementViewerAgentHandoff {
  return {
    format: "ferrum2d.placement-viewer.agent-handoff",
    version: 1,
    sourceDocument: SCENE_DOCUMENT_URL,
    ...(state.selectedInstanceId === undefined ? {} : { selectedInstanceId: state.selectedInstanceId }),
    ...(state.hoveredInstanceId === undefined ? {} : { hoveredInstanceId: state.hoveredInstanceId }),
    ...(state.selected === undefined ? {} : { selected: state.selected }),
    ...(state.pointerWorld === undefined ? {} : { pointerWorld: state.pointerWorld }),
    ...(state.draftPatch === undefined ? {} : { draftPatch: state.draftPatch }),
    ...(migrationPreview === undefined ? {} : { migrationPreview }),
  };
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
  const meta = import.meta as ImportMeta & {
    env?: Readonly<Record<string, string | boolean | undefined>>;
  };
  return import.meta.env.DEV || meta.env?.VITE_FERRUM_PLACEMENT_VIEWER_SAVE === "true";
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
    bounds.set(instance.id, {
      width: components.sprite.width,
      height: components.sprite.height,
    });
  }
  return bounds;
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

function appendRow(parent: HTMLElement, label: string): HTMLElement {
  const term = document.createElement("dt");
  const description = document.createElement("dd");
  term.textContent = label;
  description.textContent = "-";
  parent.append(term, description);
  return description;
}

function appendNumberControl(
  parent: HTMLElement,
  label: string,
  field: string,
  step: string,
  min?: string,
): HTMLInputElement {
  const wrapper = document.createElement("label");
  const labelText = document.createElement("span");
  const input = document.createElement("input");
  wrapper.className = "placement-control";
  labelText.textContent = label;
  input.type = "number";
  input.step = step;
  if (min !== undefined) {
    input.min = min;
  }
  if (field === "snapGrid") {
    input.dataset.placementSnapGrid = "true";
  } else {
    input.dataset.placementTransformField = field;
  }
  wrapper.append(labelText, input);
  parent.append(wrapper);
  return input;
}

function appendTextControl(parent: HTMLElement, label: string, field: string): HTMLInputElement {
  const wrapper = document.createElement("label");
  const labelText = document.createElement("span");
  const input = document.createElement("input");
  wrapper.className = "placement-control";
  labelText.textContent = label;
  input.type = "text";
  input.spellcheck = false;
  if (field === "rename") {
    input.dataset.placementRenameId = "true";
  }
  wrapper.append(labelText, input);
  parent.append(wrapper);
  return input;
}

function appendCheckboxControl(parent: HTMLElement, label: string, field: string): HTMLInputElement {
  const wrapper = document.createElement("label");
  const labelText = document.createElement("span");
  const input = document.createElement("input");
  wrapper.className = "placement-control placement-control-checkbox";
  labelText.textContent = label;
  input.type = "checkbox";
  if (field === "snap") {
    input.dataset.placementSnapToggle = "true";
  }
  wrapper.append(input, labelText);
  parent.append(wrapper);
  return input;
}

function numberInputValue(input: HTMLInputElement): number | undefined {
  const value = input.value.trim();
  if (value === "") {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function setNumberInputValue(input: HTMLInputElement, value: number): void {
  const next = formatNumber(value);
  if (input.value !== next) {
    input.value = next;
  }
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function placementGameStateLabel(code: number): string {
  if (code === 0) return "Ready";
  if (code === 1) return "Preview";
  if (code === 2) return "Stopped";
  return `State ${code}`;
}

void bootstrap();
