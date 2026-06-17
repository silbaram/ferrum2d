import {
  diagnosticReport,
  type DiagnosticContext,
  type DiagnosticReport,
} from "@ferrum2d/ferrum-web/quality";
import {
  createScenePlacementViewer,
  createScenePlacementViewport,
  previewScenePlacementBindingMigration,
  resolveDataSceneInstanceComponents,
  resolveSceneAuthoringDocument,
  saveScenePlacementPatch,
  snapSceneWorldPoint,
  worldToSceneScreen,
  type ResolvedSceneAuthoringDocument,
  type ResolvedSceneCompositionInstance,
  type SceneAuthoringDocumentSpec,
  type ScenePlacementPatch,
  type ScenePlacementPatchSaveResult,
  type ScenePlacementPoint,
  type ScenePlacementTransform,
  type ScenePlacementViewer,
  type ScenePlacementViewerInstance,
  type ScenePlacementViewerState,
} from "@ferrum2d/ferrum-web/authoring";

import "./ferrum-placement-viewer.css";

const SCENE_AUTHORING_URL = "./scene-authoring.json";
const DEFAULT_OBJECT_SIZE = 48;
const DEFAULT_STAGE_WIDTH = 860;
const DEFAULT_STAGE_HEIGHT = 540;
const SNAP_GRID_SIZE = 16;
const MEMORY_SAVE_ADAPTER_ID = "consumer-placement-viewer-memory";

interface ConsumerPlacementViewerWindow extends Window {
  __ferrumConsumerPlacementViewer?: {
    state(): ScenePlacementViewerState;
    exportPatch(): ScenePlacementPatch | undefined;
    selectInstance(instanceId?: string): ScenePlacementViewerState;
  };
  ferrumConsumerPlacementViewerState?: ScenePlacementViewerState;
  ferrumConsumerPlacementViewerPatch?: ScenePlacementPatch;
  ferrumConsumerPlacementViewerSaveResult?: ScenePlacementPatchSaveResult;
}

interface PlacementShell {
  status: HTMLElement;
  stage: HTMLElement;
  list: HTMLElement;
  details: HTMLElement;
  controls: HTMLElement;
  handoff: HTMLTextAreaElement;
  patch: HTMLTextAreaElement;
}

interface PlacementBounds {
  width: number;
  height: number;
}

interface PlacementSession {
  document: SceneAuthoringDocumentSpec;
  resolved: ResolvedSceneAuthoringDocument;
  viewer: ScenePlacementViewer;
  boundsBySourceId: Map<string, PlacementBounds>;
}

type PlacementViewportInstance =
  | { x: number; y: number }
  | { transform: Pick<ScenePlacementTransform, "x" | "y"> };

async function bootstrap(): Promise<void> {
  const root = document.querySelector<HTMLElement>("#placement-viewer");
  if (root === null) {
    throw new Error("Missing #placement-viewer root element.");
  }

  try {
    const shell = createShell(root);
    let session = createPlacementSession(
      await loadSceneAuthoringDocument(SCENE_AUTHORING_URL),
      shell.stage,
    );

    const setSession = (nextSession: PlacementSession): void => {
      session = nextSession;
      publishPlacementViewer(session.viewer);
    };
    const render = (): void => {
      renderPlacement(shell, session, setSession, render);
      publishPlacementState(session.viewer.state());
    };

    shell.stage.addEventListener("pointerdown", (event) => {
      if (event.target !== shell.stage) {
        return;
      }
      const point = pointerPoint(shell.stage, event);
      session.viewer.selectInstanceAtScreen(point);
      render();
    });

    new ResizeObserver(() => {
      session.viewer.updateViewport(viewportForStage(shell.stage, session.viewer.state().instances));
      render();
    }).observe(shell.stage);

    publishPlacementViewer(session.viewer);
    render();
  } catch (error) {
    renderStartupError(root, error);
  }
}

function createPlacementSession(
  documentSpec: SceneAuthoringDocumentSpec,
  stage: HTMLElement,
): PlacementSession {
  const resolved = resolveSceneAuthoringDocument(documentSpec, {
    path: "placementViewer.document",
    validateBindings: true,
    missingBehavior: "ignore",
  });
  const instances = resolved.bindingPlan?.instances ?? [];
  const boundsBySourceId = boundsByInstanceId(instances);
  const selectedInstanceId = instances[0]?.id;
  const viewer = createScenePlacementViewer({
    sceneComposition: resolved.sceneComposition,
    viewport: viewportForStage(stage, instances),
    ...(selectedInstanceId === undefined ? {} : { selectedInstanceId }),
    path: "placementViewer.viewer",
  });
  return {
    document: documentSpec,
    resolved,
    viewer,
    boundsBySourceId,
  };
}

async function loadSceneAuthoringDocument(url: string): Promise<SceneAuthoringDocumentSpec> {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status} ${response.statusText}`);
  }
  const json = await response.json();
  return json as SceneAuthoringDocumentSpec;
}

function createShell(root: HTMLElement): PlacementShell {
  const shell = document.createElement("main");
  const toolbar = document.createElement("header");
  const title = document.createElement("h1");
  const status = document.createElement("div");
  const layout = document.createElement("section");
  const stage = document.createElement("section");
  const panel = document.createElement("aside");
  const listSection = createSection("Instances");
  const detailsSection = createSection("Selected");
  const controlsSection = createSection("Transform");
  const handoffSection = createSection("Agent Handoff");
  const patchSection = createSection("Patch");
  const list = document.createElement("div");
  const details = document.createElement("div");
  const controls = document.createElement("div");
  const handoff = document.createElement("textarea");
  const patch = document.createElement("textarea");

  shell.className = "placement-shell";
  toolbar.className = "placement-toolbar";
  status.className = "placement-status";
  layout.className = "placement-layout";
  stage.className = "placement-stage";
  panel.className = "placement-panel";
  list.className = "placement-list";
  handoff.readOnly = true;
  patch.readOnly = true;
  title.textContent = "__PROJECT_TITLE__ Placement Viewer";

  toolbar.append(title, status);
  listSection.append(list);
  detailsSection.append(details);
  controlsSection.append(controls);
  handoffSection.append(handoff);
  patchSection.append(patch);
  panel.append(listSection, detailsSection, controlsSection, handoffSection, patchSection);
  layout.append(stage, panel);
  shell.append(toolbar, layout);
  root.replaceChildren(shell);

  return {
    status,
    stage,
    list,
    details,
    controls,
    handoff,
    patch,
  };
}

function createSection(titleText: string): HTMLElement {
  const section = document.createElement("section");
  const title = document.createElement("h2");
  section.className = "placement-section";
  title.textContent = titleText;
  section.append(title);
  return section;
}

function renderPlacement(
  shell: PlacementShell,
  session: PlacementSession,
  setSession: (session: PlacementSession) => void,
  render: () => void,
): void {
  const state = session.viewer.state();
  const patch = session.viewer.exportPatch();
  shell.status.textContent = `${state.instances.length} instances | ${patch?.operations.length ?? 0} draft operations`;
  renderStage(shell.stage, session, state, render);
  renderInstanceList(shell.list, session, state, render);
  renderDetails(shell.details, state);
  renderControls(shell.controls, shell.stage, session, state, setSession, render);
  shell.handoff.value = JSON.stringify(agentHandoff(session, state, patch), null, 2);
  shell.patch.value = patch === undefined ? "" : JSON.stringify(patch, null, 2);
}

function renderStage(
  stage: HTMLElement,
  session: PlacementSession,
  state: ScenePlacementViewerState,
  render: () => void,
): void {
  const fragment = document.createDocumentFragment();
  if (state.instances.length === 0) {
    const empty = document.createElement("div");
    empty.className = "placement-empty";
    empty.textContent = "No scene instances.";
    fragment.append(empty);
  }

  for (const instance of state.instances) {
    const bounds = boundsForInstance(session, instance);
    const point = worldToSceneScreen(state.viewport, instance.transform);
    const width = Math.max(26, bounds.width * state.viewport.zoom);
    const height = Math.max(26, bounds.height * state.viewport.zoom);
    const button = document.createElement("button");
    const label = document.createElement("span");
    button.type = "button";
    button.className = "placement-object";
    button.dataset.role = instance.role;
    button.dataset.selected = String(instance.instanceId === state.selectedInstanceId);
    button.style.left = `${point.x - width * 0.5}px`;
    button.style.top = `${point.y - height * 0.5}px`;
    button.style.width = `${width}px`;
    button.style.height = `${height}px`;
    label.textContent = instance.instanceId;
    button.append(label);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      session.viewer.selectInstance(instance.instanceId);
      render();
    });
    fragment.append(button);
  }
  stage.replaceChildren(fragment);
}

function renderInstanceList(
  container: HTMLElement,
  session: PlacementSession,
  state: ScenePlacementViewerState,
  render: () => void,
): void {
  const fragment = document.createDocumentFragment();
  for (const instance of state.instances) {
    const button = document.createElement("button");
    const name = document.createElement("span");
    const role = document.createElement("span");
    button.type = "button";
    button.dataset.selected = String(instance.instanceId === state.selectedInstanceId);
    name.textContent = instance.instanceId;
    role.className = "placement-muted";
    role.textContent = instance.role;
    button.append(name, role);
    button.addEventListener("click", () => {
      session.viewer.selectInstance(instance.instanceId);
      render();
    });
    fragment.append(button);
  }
  container.replaceChildren(fragment);
}

function renderDetails(container: HTMLElement, state: ScenePlacementViewerState): void {
  const selected = state.selected;
  if (selected === undefined) {
    const empty = document.createElement("p");
    empty.className = "placement-muted";
    empty.textContent = "Select an instance.";
    container.replaceChildren(empty);
    return;
  }

  const list = document.createElement("dl");
  list.className = "placement-kv";
  appendRow(list, "id", selected.instanceId);
  appendRow(list, "prefab", selected.prefab);
  appendRow(list, "role", selected.role);
  appendRow(list, "profiles", selected.behaviorProfiles.join(", ") || "none");
  appendRow(list, "entity", selected.entity === undefined
    ? "not resolved"
    : `${selected.entity.entityId}:${selected.entity.entityGeneration}`);
  container.replaceChildren(list);
}

function renderControls(
  container: HTMLElement,
  stage: HTMLElement,
  session: PlacementSession,
  state: ScenePlacementViewerState,
  setSession: (session: PlacementSession) => void,
  render: () => void,
): void {
  const selected = state.selected;
  if (selected === undefined) {
    const empty = document.createElement("p");
    empty.className = "placement-muted";
    empty.textContent = "No selection.";
    container.replaceChildren(empty);
    return;
  }

  const grid = document.createElement("div");
  const actions = document.createElement("div");
  const renameInput = document.createElement("input");
  const renameButton = document.createElement("button");
  const duplicateButton = document.createElement("button");
  const removeButton = document.createElement("button");
  const saveButton = document.createElement("button");
  const clearButton = document.createElement("button");
  const transformInputs = {
    x: numberField("x", selected.transform.x),
    y: numberField("y", selected.transform.y),
    scale: numberField("scale", selected.transform.scale),
    rotationRadians: numberField("rotation", selected.transform.rotationRadians),
    layer: numberField("layer", selected.transform.layer),
  };

  grid.className = "placement-grid";
  actions.className = "placement-actions";
  renameInput.value = selected.instanceId;
  renameButton.type = "button";
  renameButton.textContent = "Rename";
  duplicateButton.type = "button";
  duplicateButton.textContent = "Duplicate";
  removeButton.type = "button";
  removeButton.textContent = "Remove";
  saveButton.type = "button";
  saveButton.textContent = "Apply Memory";
  clearButton.type = "button";
  clearButton.textContent = "Clear Draft";

  for (const [key, field] of Object.entries(transformInputs)) {
    field.input.addEventListener("change", () => {
      const value = Number(field.input.value);
      if (!Number.isFinite(value)) return;
      session.viewer.updateInstanceTransform(selected.instanceId, {
        [key]: key === "layer" ? Math.trunc(value) : value,
      } as Partial<ScenePlacementTransform>);
      render();
    });
    grid.append(field.label);
  }

  actions.append(renameInput, renameButton, duplicateButton, removeButton, saveButton, clearButton);
  renameButton.addEventListener("click", () => {
    session.viewer.renameInstance(selected.instanceId, renameInput.value.trim());
    render();
  });
  duplicateButton.addEventListener("click", () => {
    const point = snapSceneWorldPoint({
      x: selected.transform.x + SNAP_GRID_SIZE,
      y: selected.transform.y + SNAP_GRID_SIZE,
    }, { gridSize: SNAP_GRID_SIZE });
    session.viewer.addInstance(state.fragment, {
      id: nextDuplicateId(state.instances, selected.instanceId),
      prefab: selected.prefab,
      ...(selected.variant === undefined ? {} : { variant: selected.variant }),
      x: point.x,
      y: point.y,
      scale: selected.transform.scale,
      rotationRadians: selected.transform.rotationRadians,
      layer: selected.transform.layer,
    });
    render();
  });
  removeButton.addEventListener("click", () => {
    session.viewer.removeInstance(selected.instanceId);
    render();
  });
  saveButton.addEventListener("click", async () => {
    const patch = session.viewer.exportPatch();
    if (patch === undefined) return;
    const result = await saveScenePlacementPatch(session.document, patch, {
      allowSave: true,
      adapter: {
        id: MEMORY_SAVE_ADAPTER_ID,
        saveScenePlacementPatch: (request) => ({
          saved: true,
          document: request.mergedDocument,
        }),
      },
      allowedAdapterIds: [MEMORY_SAVE_ADAPTER_ID],
      path: "placementViewer.memorySave",
    });
    publishPlacementSaveResult(result);
    setSession(createPlacementSession(result.document, stage));
    render();
  });
  clearButton.addEventListener("click", () => {
    session.viewer.clearDraftPatch();
    render();
  });

  container.replaceChildren(grid, actions);
}

function numberField(labelText: string, value: number): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = document.createElement("label");
  const input = document.createElement("input");
  label.className = "placement-field";
  label.textContent = labelText;
  input.type = "number";
  input.value = String(value);
  input.step = labelText === "layer" ? "1" : "0.1";
  label.append(input);
  return { label, input };
}

function appendRow(list: HTMLDListElement, label: string, value: string): void {
  const term = document.createElement("dt");
  const description = document.createElement("dd");
  term.textContent = label;
  description.textContent = value;
  list.append(term, description);
}

function boundsByInstanceId(instances: readonly ResolvedSceneCompositionInstance[]): Map<string, PlacementBounds> {
  const bounds = new Map<string, PlacementBounds>();
  for (const instance of instances) {
    bounds.set(instance.id, boundsForResolvedInstance(instance));
  }
  return bounds;
}

function boundsForResolvedInstance(instance: ResolvedSceneCompositionInstance): PlacementBounds {
  if (!("components" in instance.props)) {
    return { width: DEFAULT_OBJECT_SIZE, height: DEFAULT_OBJECT_SIZE };
  }
  try {
    const components = resolveDataSceneInstanceComponents(instance, {
      allowTemplate: false,
      path: `placementViewer.instances.${instance.id}`,
    });
    if (components.mode === "inline") {
      return {
        width: Math.max(1, components.sprite.width * instance.scale),
        height: Math.max(1, components.sprite.height * instance.scale),
      };
    }
  } catch {
    return { width: DEFAULT_OBJECT_SIZE, height: DEFAULT_OBJECT_SIZE };
  }
  return { width: DEFAULT_OBJECT_SIZE, height: DEFAULT_OBJECT_SIZE };
}

function boundsForInstance(session: PlacementSession, instance: ScenePlacementViewerInstance): PlacementBounds {
  return session.boundsBySourceId.get(instance.sourceId) ?? { width: DEFAULT_OBJECT_SIZE, height: DEFAULT_OBJECT_SIZE };
}

function viewportForStage(
  stage: HTMLElement,
  instances: readonly PlacementViewportInstance[],
) {
  const rect = stage.getBoundingClientRect();
  const cssWidth = Math.max(320, rect.width || DEFAULT_STAGE_WIDTH);
  const cssHeight = Math.max(320, rect.height || DEFAULT_STAGE_HEIGHT);
  const center = sceneCenter(instances);
  return createScenePlacementViewport({
    cssWidth,
    cssHeight,
    cameraX: center.x,
    cameraY: center.y,
    zoom: 1,
  });
}

function sceneCenter(
  instances: readonly PlacementViewportInstance[],
): ScenePlacementPoint {
  if (instances.length === 0) {
    return { x: 0, y: 0 };
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const instance of instances) {
    const point = "transform" in instance ? instance.transform : instance;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return {
    x: (minX + maxX) * 0.5,
    y: (minY + maxY) * 0.5,
  };
}

function pointerPoint(stage: HTMLElement, event: PointerEvent): ScenePlacementPoint {
  const rect = stage.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function nextDuplicateId(instances: readonly ScenePlacementViewerInstance[], selectedId: string): string {
  const ids = new Set(instances.map((instance) => instance.instanceId));
  for (let index = 1; index < 1000; index += 1) {
    const id = `${selectedId}-copy-${index}`;
    if (!ids.has(id)) {
      return id;
    }
  }
  throw new Error(`Could not allocate a duplicate id for ${selectedId}.`);
}

function agentHandoff(
  session: PlacementSession,
  state: ScenePlacementViewerState,
  patch?: ScenePlacementPatch,
): object {
  const migrationPreview = patch === undefined
    ? undefined
    : previewScenePlacementBindingMigration(session.document, patch, {
        path: "placementViewer.bindingMigration",
      });
  return {
    workflow: "human-placement-agent-behavior",
    placementOwner: "sceneComposition.fragments[].instances[]",
    behaviorOwner: "sceneComposition.prefabs[].props.behaviorRecipes + behaviorRecipes.entities",
    selectedInstanceId: state.selectedInstanceId ?? null,
    selected: state.selected ?? null,
    patch: patch ?? null,
    bindingMigration: migrationPreview ?? null,
  };
}

function publishPlacementViewer(viewer: ScenePlacementViewer): void {
  const target = window as ConsumerPlacementViewerWindow;
  target.__ferrumConsumerPlacementViewer = {
    state: () => viewer.state(),
    exportPatch: () => viewer.exportPatch(),
    selectInstance: (instanceId) => viewer.selectInstance(instanceId),
  };
}

function publishPlacementState(state: ScenePlacementViewerState): void {
  const target = window as ConsumerPlacementViewerWindow;
  target.ferrumConsumerPlacementViewerState = state;
  target.ferrumConsumerPlacementViewerPatch = state.draftPatch;
}

function publishPlacementSaveResult(result: ScenePlacementPatchSaveResult): void {
  (window as ConsumerPlacementViewerWindow).ferrumConsumerPlacementViewerSaveResult = result;
}

function renderStartupError(root: HTMLElement, error: unknown): void {
  console.error("Ferrum2D placement viewer failed", error);
  const report = diagnosticReport(error);
  const container = document.createElement("main");
  const title = document.createElement("h1");
  const summary = document.createElement("p");
  const list = document.createElement("dl");
  container.className = "placement-error";
  title.textContent = "__PROJECT_TITLE__ Placement Viewer";
  summary.textContent = "Startup failed.";
  for (const [label, value] of diagnosticRows(report)) {
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;
    description.textContent = value;
    list.append(term, description);
  }
  container.append(title, summary, list);
  root.replaceChildren(container);
}

function diagnosticRows(report: DiagnosticReport): Array<[string, string]> {
  const rows: Array<[string, string]> = [["code", report.code], ["message", report.message]];
  if (report.context !== undefined) appendDiagnosticContext(rows, report.context);
  return rows;
}

function appendDiagnosticContext(rows: Array<[string, string]>, context: DiagnosticContext): void {
  rows.push(["kind", context.kind]);
  if (context.name !== undefined) rows.push(["name", context.name]);
  if (context.id !== undefined) rows.push(["id", String(context.id)]);
  if (context.url !== undefined) rows.push(["url", context.url]);
  if (context.path !== undefined) rows.push(["path", context.path]);
  rows.push(["detail", context.detail]);
}

void bootstrap();
