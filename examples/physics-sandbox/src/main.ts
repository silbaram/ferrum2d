import {
  createFerrumRuntime,
  createPhysicsWorldFromSpec,
  resolvePhysicsSpec,
  type FerrumEngine,
  type FerrumRuntime,
  type FerrumRuntimeEnvironment,
  type PhysicsBodyContactHit,
  type PhysicsBodyManifoldHit,
  type PhysicsDebugOptions,
  type PhysicsEntityHandle,
  type PhysicsEntitySnapshot,
  type PhysicsRigidBodyMaterial,
  type PhysicsRaycastBodyHit,
  type PhysicsRigidContactImpulseHit,
  type PhysicsSpec,
  type PhysicsWorldApplyResult,
  type PhysicsWorldApplyWarning,
  type ResolvedPhysicsBodySpec,
  type ResolvedPhysicsColliderSpec,
  type ResolvedPhysicsJointSpec,
  type ResolvedPhysicsMaterialSpec,
  type ResolvedPhysicsSpec,
} from "@ferrum2d/ferrum-web/core";
import {
  diagnosticReport,
  type DiagnosticContext,
  type DiagnosticReport,
} from "@ferrum2d/ferrum-web/quality";

import "./styles.css";

interface PhysicsShowcaseCatalog {
  version: 1;
  scenarios: readonly PhysicsScenarioEntry[];
}

interface PhysicsScenarioEntry {
  id: string;
  title: string;
  titleKo?: string;
  category: string;
  categoryKo?: string;
  summary: string;
  summaryKo?: string;
  physicsSpec: string;
  focus: readonly string[];
  focusKo?: readonly string[];
  focusBodies?: readonly string[];
  camera?: PhysicsScenarioCamera;
  defaultDebug?: PhysicsDebugOptions;
  bodyStyles?: Record<string, PhysicsBodyStyle>;
  controls?: PhysicsScenarioControls;
  query?: PhysicsScenarioQuery;
  smokeThresholds?: PhysicsScenarioSmokeThresholds;
}

interface PhysicsScenarioCamera {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PhysicsBodyStyle {
  fill?: string;
  stroke?: string;
  label?: string;
  labelKo?: string;
}

interface PhysicsScenarioControls {
  actions?: readonly PhysicsScenarioAction[];
}

interface PhysicsScenarioActionBase {
  id: string;
  label: string;
  labelKo?: string;
}

type PhysicsScenarioAction =
  | (PhysicsScenarioActionBase & {
      kind: "impulse";
      body: string;
      impulse: readonly [number, number];
    })
  | (PhysicsScenarioActionBase & {
      kind: "velocity";
      body: string;
      velocity: readonly [number, number];
      position?: readonly [number, number];
    })
  | (PhysicsScenarioActionBase & {
      kind: "teleport";
      body: string;
      position: readonly [number, number];
      velocity?: readonly [number, number];
    })
  | (PhysicsScenarioActionBase & {
      kind: "reset";
    });

interface PhysicsScenarioQuery {
  origin: readonly [number, number];
  target: readonly [number, number];
  maxDistance?: number;
}

interface PhysicsScenarioSmokeThresholds {
  minBodies?: number;
  minDebugLines?: number;
  minContacts?: number;
  minVisibleBodies?: number;
}

interface PhysicsSandboxSmokeFrame {
  demoId: string;
  bodyCount: number;
  jointCount: number;
  warningCount: number;
  entityCount: number;
  renderCommandCount: number;
  physicsDebugLineCount: number;
  fixedStepSeconds: number;
  frameCount: number;
  visibleBodyCount: number;
  contactCount: number;
  manifoldCount: number;
  impulseCount: number;
  queryHitCount: number;
}

type SandboxStatus = "loading" | "running" | "paused" | "step" | "error";

interface SandboxRuntimeMetrics {
  bodyCount: number;
  jointCount: number;
  debugLineCount: number;
  fps: number;
  frameCount: number;
  entityCount: number;
  renderCommandCount: number;
  visibleBodyCount: number;
  contactCount: number;
  manifoldCount: number;
  impulseCount: number;
  queryHitCount: number;
}

interface SelectedBodyReport {
  id: string;
  label: string;
  type: string;
  material: string;
  collider: string;
  position: string;
  velocity: string;
  sleeping: string;
}

type MaterialControlField = "friction" | "restitution";

interface MaterialControlEntry {
  id: string;
  label: string;
  friction: number;
  restitution: number;
  bodyCount: number;
  colliderCount: number;
}

interface SandboxWindow extends Window {
  ferrumEngine?: FerrumEngine;
  ferrumRuntime?: FerrumRuntime;
  ferrumPhysicsSandboxLoadDemo?: (id: string) => Promise<void>;
  ferrumPhysicsSandboxSmokeFrame?: PhysicsSandboxSmokeFrame;
}

interface SandboxShell {
  canvas: HTMLCanvasElement;
  overlayCanvas: HTMLCanvasElement;
  debugRoot: HTMLElement;
  scenarioSelect: HTMLSelectElement;
  setPaused(paused: boolean): void;
  setStatus(status: SandboxStatus): void;
  setScenario(
    scenario: PhysicsScenarioEntry,
    spec: ResolvedPhysicsSpec,
    world: PhysicsWorldApplyResult,
    debugOptions: PhysicsDebugOptions,
  ): void;
  setRuntimeMetrics(metrics: SandboxRuntimeMetrics): void;
  setActions(actions: readonly PhysicsScenarioAction[]): void;
  setMaterialControls(entries: readonly MaterialControlEntry[]): void;
  setEvents(events: readonly string[]): void;
  setSelectedBody(report?: SelectedBodyReport): void;
  setError(error: unknown): void;
  setWarnings(warnings: readonly PhysicsWorldApplyWarning[]): void;
}

interface FramePhysicsState {
  bodyStates: readonly PhysicsEntitySnapshot[];
  bodyStatesById: ReadonlyMap<string, PhysicsEntitySnapshot>;
  bodyIdsByEntityKey: ReadonlyMap<string, string>;
  contacts: readonly PhysicsBodyContactHit[];
  manifolds: readonly PhysicsBodyManifoldHit[];
  impulses: readonly PhysicsRigidContactImpulseHit[];
  rayHits: readonly PhysicsRaycastBodyHit[];
}

interface DrawContext {
  scenario: PhysicsScenarioEntry;
  spec: ResolvedPhysicsSpec;
  debugOptions: PhysicsDebugOptions;
  frameState: FramePhysicsState;
  selectedBodyId?: string;
  queryTarget?: Point2;
}

interface Point2 {
  x: number;
  y: number;
}

interface ScreenMapper {
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  worldToScreen(point: Point2): Point2;
  screenToWorld(point: Point2): Point2;
  worldLength(value: number): number;
}

const CATALOG_PATH = "catalog.json";
const DEFAULT_SCENARIO_ID = "rigid-materials";
const STATUS_LABELS: Record<SandboxStatus, string> = {
  loading: "로딩",
  running: "실행 중",
  paused: "일시정지",
  step: "한 프레임",
  error: "오류",
};
const DEBUG_CATEGORIES = [
  { key: "colliders", label: "충돌체" },
  { key: "contacts", label: "접촉" },
  { key: "joints", label: "조인트" },
  { key: "sleeping", label: "휴면" },
  { key: "broadphase", label: "광역 충돌" },
  { key: "ccd", label: "연속 충돌(CCD)" },
] as const satisfies ReadonlyArray<{ key: keyof PhysicsDebugOptions; label: string }>;
type DebugControlKey = typeof DEBUG_CATEGORIES[number]["key"];
const DEFAULT_DEBUG_OPTIONS: PhysicsDebugOptions = Object.freeze({
  colliders: true,
  contacts: true,
  manifolds: true,
  joints: true,
  sleeping: true,
  broadphase: false,
  layers: false,
  ccd: false,
});
const EMPTY_FRAME_PHYSICS_STATE: FramePhysicsState = Object.freeze({
  bodyStates: Object.freeze([]),
  bodyStatesById: new Map(),
  bodyIdsByEntityKey: new Map(),
  contacts: Object.freeze([]),
  manifolds: Object.freeze([]),
  impulses: Object.freeze([]),
  rayHits: Object.freeze([]),
});
const DEFAULT_CAMERA: PhysicsScenarioCamera = Object.freeze({ x: 0, y: 0, width: 800, height: 480 });
const NUMBER_FORMAT = new Intl.NumberFormat("en-US");
const MATERIAL_LABELS: Record<string, string> = Object.freeze({
  metal: "금속",
  platform: "플랫폼",
  rubber: "고무",
  wood: "나무",
});
const MATERIAL_CONTROL_RANGES: Record<MaterialControlField, { min: number; max: number; step: number }> = Object.freeze({
  friction: { min: 0, max: 1.2, step: 0.02 },
  restitution: { min: 0, max: 1, step: 0.01 },
});

function publicAssetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

function diagnosticRows(report: DiagnosticReport): Array<[string, string]> {
  const rows: Array<[string, string]> = [["code", report.code], ["message", report.message]];
  if (report.context) appendDiagnosticContext(rows, report.context);
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

function createButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function createShell(
  scenarios: readonly PhysicsScenarioEntry[],
  onScenarioChange: (id: string) => void,
  onReset: () => void,
  onRun: () => void,
  onPause: () => void,
  onStep: () => void,
  onAction: (id: string) => void,
  onMaterialChange: (materialId: string, field: MaterialControlField, value: number) => void,
  onDebugChange: (options: PhysicsDebugOptions) => void,
  initialDebugOptions: PhysicsDebugOptions,
): SandboxShell {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) {
    throw new Error("Missing #app root element.");
  }

  const shell = document.createElement("main");
  const header = document.createElement("header");
  const titleBlock = document.createElement("div");
  const titleRow = document.createElement("div");
  const title = document.createElement("h1");
  const statusBadge = document.createElement("span");
  const summary = document.createElement("p");
  const toolbar = document.createElement("div");
  const scenarioSelect = document.createElement("select");
  const runButton = createButton("실행", onRun);
  const pauseButton = createButton("일시정지", onPause);
  const stepButton = createButton("한 프레임", onStep);
  const resetButton = createButton("리셋", onReset);
  const categoryNav = document.createElement("nav");
  const debugControls = document.createElement("div");
  const stage = document.createElement("section");
  const canvasPanel = document.createElement("section");
  const canvasStack = document.createElement("div");
  const canvas = document.createElement("canvas");
  const overlayCanvas = document.createElement("canvas");
  const canvasHud = document.createElement("div");
  const canvasTitle = document.createElement("span");
  const canvasSignal = document.createElement("span");
  const sidePanel = document.createElement("aside");
  const metrics = document.createElement("dl");
  const specPanel = document.createElement("dl");
  const actionPanel = document.createElement("section");
  const actionTitle = document.createElement("h2");
  const actionButtons = document.createElement("div");
  const materialPanel = document.createElement("section");
  const materialTitle = document.createElement("h2");
  const materialControls = document.createElement("div");
  const focusPanel = document.createElement("section");
  const focusTitle = document.createElement("h2");
  const focusList = document.createElement("div");
  const selectedPanel = document.createElement("section");
  const selectedTitle = document.createElement("h2");
  const selectedBody = document.createElement("dl");
  const eventPanel = document.createElement("section");
  const eventTitle = document.createElement("h2");
  const eventList = document.createElement("ol");
  const warningList = document.createElement("div");
  const debugRoot = document.createElement("div");
  const errorBox = document.createElement("div");

  const statusValue = document.createElement("dd");
  const bodyValue = document.createElement("dd");
  const visibleBodyValue = document.createElement("dd");
  const jointValue = document.createElement("dd");
  const contactValue = document.createElement("dd");
  const queryValue = document.createElement("dd");
  const lineValue = document.createElement("dd");
  const fpsValue = document.createElement("dd");
  const frameValue = document.createElement("dd");
  const commandValue = document.createElement("dd");
  const fixtureValue = document.createElement("dd");
  const gravityValue = document.createElement("dd");
  const stepValue = document.createElement("dd");
  const solverValue = document.createElement("dd");
  const materialValue = document.createElement("dd");
  const layerValue = document.createElement("dd");
  const warningValue = document.createElement("dd");

  const debugOptions: PhysicsDebugOptions = { ...initialDebugOptions };
  const debugControlInputs = new Map<DebugControlKey, HTMLInputElement>();
  const debugControlLabels = new Map<DebugControlKey, HTMLLabelElement>();
  const categories = uniqueStrings(scenarios.map((scenario) => scenario.category));

  shell.className = "app-shell";
  header.className = "showcase-header";
  titleBlock.className = "title-block";
  titleRow.className = "title-row";
  statusBadge.className = "status-badge";
  summary.className = "scenario-summary";
  toolbar.className = "toolbar";
  scenarioSelect.className = "scenario-select";
  categoryNav.className = "category-nav";
  debugControls.className = "debug-controls";
  stage.className = "stage";
  canvasPanel.className = "canvas-panel";
  canvasStack.className = "canvas-stack";
  canvas.className = "physics-canvas";
  overlayCanvas.className = "physics-overlay";
  canvasHud.className = "canvas-hud";
  canvasTitle.className = "canvas-hud-label";
  canvasSignal.className = "canvas-hud-label";
  sidePanel.className = "side-panel";
  metrics.className = "metrics";
  specPanel.className = "spec-panel";
  actionPanel.className = "panel-block action-panel";
  actionButtons.className = "action-buttons";
  materialPanel.className = "panel-block material-panel";
  materialControls.className = "material-controls";
  focusPanel.className = "panel-block";
  focusList.className = "focus-list";
  selectedPanel.className = "panel-block selected-panel";
  selectedBody.className = "selected-body";
  eventPanel.className = "panel-block event-panel";
  eventList.className = "event-list";
  warningList.className = "warning-list";
  debugRoot.className = "debug-root";
  errorBox.className = "error-box";

  title.textContent = "Ferrum2D 물리 쇼케이스 Lab";
  statusBadge.textContent = STATUS_LABELS.loading;
  statusBadge.dataset.status = "loading";
  actionTitle.textContent = "조작";
  materialTitle.textContent = "재질 조절";
  focusTitle.textContent = "관찰 포인트";
  selectedTitle.textContent = "선택한 물체";
  eventTitle.textContent = "물리 신호";
  canvas.width = 800;
  canvas.height = 480;
  overlayCanvas.width = 800;
  overlayCanvas.height = 480;
  canvasTitle.textContent = STATUS_LABELS.loading;
  canvasSignal.textContent = "접촉 0";
  errorBox.hidden = true;
  warningList.hidden = true;

  for (const scenario of scenarios) {
    const option = document.createElement("option");
    option.value = scenario.id;
    option.textContent = scenarioOptionLabel(scenario);
    scenarioSelect.append(option);
  }
  scenarioSelect.addEventListener("change", () => onScenarioChange(scenarioSelect.value));

  for (const category of categories) {
    const button = createButton(categoryLabel(category, scenarios), () => {
      const firstScenario = scenarios.find((scenario) => scenario.category === category);
      if (firstScenario) onScenarioChange(firstScenario.id);
    });
    button.className = "category-button";
    button.dataset.category = category;
    categoryNav.append(button);
  }

  for (const { key, label } of DEBUG_CATEGORIES) {
    const item = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(debugOptions[key]);
    checkbox.addEventListener("change", () => {
      debugOptions[key] = checkbox.checked;
      if (key === "contacts") {
        debugOptions.manifolds = checkbox.checked;
      }
      onDebugChange({ ...debugOptions });
    });
    item.className = "debug-toggle";
    item.append(checkbox, label);
    debugControls.append(item);
    debugControlInputs.set(key, checkbox);
    debugControlLabels.set(key, item);
  }

  appendMetric(metrics, "상태", statusValue);
  appendMetric(metrics, "물체", bodyValue);
  appendMetric(metrics, "표시 물체", visibleBodyValue);
  appendMetric(metrics, "조인트", jointValue);
  appendMetric(metrics, "접촉", contactValue);
  appendMetric(metrics, "쿼리 적중", queryValue);
  appendMetric(metrics, "디버그 선", lineValue);
  appendMetric(metrics, "fps", fpsValue);
  appendMetric(metrics, "프레임", frameValue);
  appendMetric(metrics, "렌더 명령", commandValue);
  appendMetric(metrics, "경고", warningValue);

  appendMetric(specPanel, "데이터", fixtureValue);
  appendMetric(specPanel, "중력", gravityValue);
  appendMetric(specPanel, "스텝", stepValue);
  appendMetric(specPanel, "솔버", solverValue);
  appendMetric(specPanel, "재질", materialValue);
  appendMetric(specPanel, "레이어", layerValue);

  toolbar.append(scenarioSelect, runButton, pauseButton, stepButton, resetButton);
  titleRow.append(title, statusBadge);
  titleBlock.append(titleRow, summary);
  header.append(titleBlock, toolbar);
  canvasHud.append(canvasTitle, canvasSignal);
  canvasStack.append(canvas, overlayCanvas, canvasHud);
  canvasPanel.append(canvasStack, debugControls, materialPanel, actionPanel, selectedPanel);
  actionPanel.append(actionTitle, actionButtons);
  materialPanel.append(materialTitle, materialControls);
  focusPanel.append(focusTitle, focusList);
  selectedPanel.append(selectedTitle, selectedBody);
  eventPanel.append(eventTitle, eventList);
  sidePanel.append(debugRoot, metrics, specPanel, focusPanel, eventPanel, warningList);
  stage.append(canvasPanel, sidePanel);
  shell.append(header, categoryNav, stage, errorBox);
  app.replaceChildren(shell);

  return {
    canvas,
    overlayCanvas,
    debugRoot,
    scenarioSelect,
    setPaused(paused) {
      pauseButton.disabled = paused;
      runButton.disabled = !paused;
      pauseButton.classList.toggle("is-active", paused);
      runButton.classList.toggle("is-active", !paused);
    },
    setStatus(status) {
      const label = STATUS_LABELS[status];
      statusValue.textContent = label;
      statusBadge.textContent = label;
      statusBadge.dataset.status = status;
      errorBox.hidden = true;
      errorBox.replaceChildren();
    },
    setScenario(scenario, spec, world, nextDebugOptions) {
      Object.assign(debugOptions, nextDebugOptions);
      scenarioSelect.value = scenario.id;
      summary.textContent = scenarioSummary(scenario);
      canvasTitle.textContent = scenarioTitle(scenario);
      fixtureValue.textContent = scenario.physicsSpec;
      gravityValue.textContent = formatVector(spec.gravityX, spec.gravityY);
      stepValue.textContent = formatStepSeconds(spec.solver.stepSeconds);
      solverValue.textContent = `${spec.solver.velocityIterations}v / ${spec.solver.positionIterations}p`;
      materialValue.textContent = formatCount(Object.keys(spec.materials).length);
      layerValue.textContent = formatCount(Object.keys(spec.layers).length);
      bodyValue.textContent = formatCount(world.bodyCount);
      jointValue.textContent = formatCount(world.jointCount);
      focusList.replaceChildren(...scenarioFocus(scenario).map(createFocusChip));
      for (const button of categoryNav.querySelectorAll<HTMLButtonElement>(".category-button")) {
        button.classList.toggle("is-active", button.dataset.category === scenario.category);
      }
      applyDebugControlAvailability(scenario, spec, debugOptions, debugControlInputs, debugControlLabels);
    },
    setRuntimeMetrics(metrics) {
      bodyValue.textContent = formatCount(metrics.bodyCount);
      visibleBodyValue.textContent = formatCount(metrics.visibleBodyCount);
      jointValue.textContent = formatCount(metrics.jointCount);
      contactValue.textContent = formatCount(metrics.contactCount);
      queryValue.textContent = formatCount(metrics.queryHitCount);
      lineValue.textContent = formatCount(metrics.debugLineCount);
      fpsValue.textContent = metrics.fps.toFixed(1);
      frameValue.textContent = formatCount(metrics.frameCount);
      commandValue.textContent = formatCount(metrics.renderCommandCount);
      canvasSignal.textContent = `접촉 ${formatCount(metrics.contactCount)} / 쿼리 ${formatCount(metrics.queryHitCount)}`;
    },
    setActions(actions) {
      actionButtons.replaceChildren(...actions.map((action) => {
        const button = createButton(actionLabel(action), () => onAction(action.id));
        button.className = "action-button";
        return button;
      }));
    },
    setMaterialControls(entries) {
      materialControls.replaceChildren();
      if (entries.length === 0) {
        const empty = document.createElement("p");
        empty.className = "panel-empty";
        empty.textContent = "이 데모에는 조절 가능한 재질이 없습니다.";
        materialControls.append(empty);
        return;
      }
      materialControls.append(...entries.map((entry) => createMaterialControl(entry, onMaterialChange)));
    },
    setEvents(events) {
      const rows = events.length > 0 ? events : ["접촉, 조인트, 쿼리 신호를 기다리는 중"];
      eventList.replaceChildren(...rows.slice(0, 6).map((event) => {
        const item = document.createElement("li");
        item.textContent = event;
        return item;
      }));
    },
    setSelectedBody(report) {
      selectedBody.replaceChildren();
      if (!report) {
        appendMetric(selectedBody, "물체", createTextValue("선택 없음"));
        return;
      }
      appendMetric(selectedBody, "물체", createTextValue(report.label));
      appendMetric(selectedBody, "타입", createTextValue(report.type));
      appendMetric(selectedBody, "재질", createTextValue(report.material));
      appendMetric(selectedBody, "충돌체", createTextValue(report.collider));
      appendMetric(selectedBody, "위치", createTextValue(report.position));
      appendMetric(selectedBody, "속도", createTextValue(report.velocity));
      appendMetric(selectedBody, "휴면", createTextValue(report.sleeping));
    },
    setError(error) {
      const report = diagnosticReport(error);
      const titleElement = document.createElement("strong");
      const list = document.createElement("dl");
      titleElement.textContent = "오류";
      for (const [label, value] of diagnosticRows(report)) {
        appendMetric(list, label, createTextValue(value));
      }
      errorBox.hidden = false;
      errorBox.replaceChildren(titleElement, list);
      statusValue.textContent = STATUS_LABELS.error;
      statusBadge.textContent = STATUS_LABELS.error;
      statusBadge.dataset.status = "error";
    },
    setWarnings(warnings) {
      warningValue.textContent = formatCount(warnings.length);
      warningList.hidden = warnings.length === 0;
      warningList.replaceChildren(...warnings.slice(0, 4).map(createWarningRow));
    },
  };
}

function appendMetric(parent: HTMLElement, label: string, value: HTMLElement): void {
  const item = document.createElement("div");
  const term = document.createElement("dt");
  item.className = "metric-item";
  term.textContent = label;
  value.textContent ||= "-";
  item.append(term, value);
  parent.append(item);
}

function createTextValue(value: string): HTMLElement {
  const element = document.createElement("dd");
  element.textContent = value;
  return element;
}

function createMaterialControl(
  entry: MaterialControlEntry,
  onChange: (materialId: string, field: MaterialControlField, value: number) => void,
): HTMLElement {
  const card = document.createElement("section");
  const header = document.createElement("div");
  const title = document.createElement("strong");
  const usage = document.createElement("span");

  card.className = "material-control";
  header.className = "material-control-header";
  title.textContent = entry.label;
  usage.textContent = `${formatCount(entry.bodyCount)} body / ${formatCount(entry.colliderCount)} collider`;
  header.append(title, usage);

  card.append(
    header,
    createMaterialSlider(entry, "friction", "마찰", entry.friction, onChange),
    createMaterialSlider(entry, "restitution", "탄성", entry.restitution, onChange),
  );
  return card;
}

function createMaterialSlider(
  entry: MaterialControlEntry,
  field: MaterialControlField,
  label: string,
  value: number,
  onChange: (materialId: string, field: MaterialControlField, value: number) => void,
): HTMLElement {
  const row = document.createElement("label");
  const text = document.createElement("span");
  const rangeInput = document.createElement("input");
  const numberInput = document.createElement("input");
  const range = MATERIAL_CONTROL_RANGES[field];
  const normalizedValue = clampMaterialControlValue(field, value);
  const commit = (rawValue: string) => {
    const nextValue = clampMaterialControlValue(field, Number(rawValue));
    const formatted = formatMaterialControlValue(field, nextValue);
    rangeInput.value = formatted;
    numberInput.value = formatted;
    onChange(entry.id, field, nextValue);
  };

  row.className = "material-slider";
  text.textContent = label;
  rangeInput.type = "range";
  rangeInput.min = String(range.min);
  rangeInput.max = String(range.max);
  rangeInput.step = String(range.step);
  rangeInput.value = normalizedValue.toFixed(2);
  rangeInput.setAttribute("aria-label", `${entry.label} ${label}`);
  rangeInput.addEventListener("input", () => {
    commit(rangeInput.value);
  });

  numberInput.type = "number";
  numberInput.min = rangeInput.min;
  numberInput.max = rangeInput.max;
  numberInput.step = rangeInput.step;
  numberInput.value = formatMaterialControlValue(field, normalizedValue);
  numberInput.setAttribute("aria-label", `${entry.label} ${label} 값`);
  numberInput.addEventListener("input", () => {
    commit(numberInput.value);
  });
  numberInput.addEventListener("change", () => {
    commit(numberInput.value);
  });

  row.append(text, rangeInput, numberInput);
  return row;
}

async function loadJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Asset load failed: ${response.status} ${response.statusText} (${url})`);
  }
  return await response.json() as T;
}

async function loadCatalog(): Promise<PhysicsShowcaseCatalog> {
  const catalog = await loadJson<PhysicsShowcaseCatalog>(publicAssetUrl(CATALOG_PATH));
  if (catalog.version !== 1 || !Array.isArray(catalog.scenarios) || catalog.scenarios.length === 0) {
    throw new Error("Physics showcase catalog must contain version 1 and at least one scenario.");
  }
  return catalog;
}

function materialControlEntries(spec: ResolvedPhysicsSpec): readonly MaterialControlEntry[] {
  return Object.entries(spec.materials).map(([id, material]) => {
    const usage = materialUsageCounts(spec, id);
    return {
      id,
      label: materialDisplayName(id),
      friction: material.friction,
      restitution: material.restitution,
      bodyCount: usage.bodyCount,
      colliderCount: usage.colliderCount,
    };
  });
}

function materialUsageCounts(
  spec: ResolvedPhysicsSpec,
  materialId: string,
): { bodyCount: number; colliderCount: number } {
  let bodyCount = 0;
  let colliderCount = 0;
  for (const body of Object.values(spec.bodies)) {
    if (body.material === materialId) {
      bodyCount += 1;
    }
    for (const collider of body.colliders) {
      if (collider.material === materialId) {
        colliderCount += 1;
      }
    }
  }
  return { bodyCount, colliderCount };
}

function applyMaterialToWorld(
  engine: FerrumEngine,
  world: PhysicsWorldApplyResult,
  spec: ResolvedPhysicsSpec,
  materialId: string,
  material: ResolvedPhysicsMaterialSpec,
): number {
  const runtimeMaterial: PhysicsRigidBodyMaterial = {
    density: material.density,
    friction: material.friction,
    restitution: material.restitution,
  };
  let appliedCount = 0;
  for (const body of Object.values(spec.bodies)) {
    const handle = world.bodies[body.id];
    if (!handle) continue;
    if (body.material === materialId && engine.setPhysicsBodyMaterial(handle, runtimeMaterial)) {
      appliedCount += 1;
    }
    for (const [colliderIndex, collider] of body.colliders.entries()) {
      if (
        collider.material === materialId
        && engine.setPhysicsBodyColliderMaterial(handle, colliderIndex, runtimeMaterial)
      ) {
        appliedCount += 1;
      }
    }
  }
  return appliedCount;
}

function sanitizeDebugOptionsForScenario(
  scenario: PhysicsScenarioEntry,
  spec: ResolvedPhysicsSpec,
  options: PhysicsDebugOptions,
): PhysicsDebugOptions {
  const available = debugControlAvailability(scenario, spec);
  const sanitized: PhysicsDebugOptions = { ...options };
  for (const { key } of DEBUG_CATEGORIES) {
    if (!available.has(key)) {
      sanitized[key] = false;
    }
  }
  if (!available.has("contacts")) {
    sanitized.manifolds = false;
  }
  return sanitized;
}

function applyDebugControlAvailability(
  scenario: PhysicsScenarioEntry,
  spec: ResolvedPhysicsSpec,
  options: PhysicsDebugOptions,
  inputs: ReadonlyMap<DebugControlKey, HTMLInputElement>,
  labels: ReadonlyMap<DebugControlKey, HTMLLabelElement>,
): void {
  const available = debugControlAvailability(scenario, spec);
  for (const { key, label } of DEBUG_CATEGORIES) {
    const input = inputs.get(key);
    const control = labels.get(key);
    if (!input || !control) continue;
    const enabled = available.has(key);
    input.disabled = !enabled;
    input.checked = enabled && Boolean(options[key]);
    control.classList.toggle("is-disabled", !enabled);
    control.title = enabled ? "" : `${label} 표시가 이 데모에서는 관찰 포인트가 아닙니다.`;
  }
}

function debugControlAvailability(
  scenario: PhysicsScenarioEntry,
  spec: ResolvedPhysicsSpec,
): ReadonlySet<DebugControlKey> {
  const available = new Set<DebugControlKey>();
  const bodyCount = Object.keys(spec.bodies).length;
  if (bodyCount > 0) {
    available.add("colliders");
  }
  if (
    scenario.defaultDebug?.contacts === true
    || scenario.defaultDebug?.manifolds === true
    || (scenario.smokeThresholds?.minContacts ?? 0) > 0
  ) {
    available.add("contacts");
  }
  if (Object.keys(spec.joints).length > 0) {
    available.add("joints");
  }
  if (spec.solver.sleep && Object.values(spec.bodies).some((body) => body.canSleep)) {
    available.add("sleeping");
  }
  if (scenario.defaultDebug?.broadphase === true) {
    available.add("broadphase");
  }
  if (scenario.defaultDebug?.ccd === true) {
    available.add("ccd");
  }
  return available;
}

async function bootstrap(): Promise<void> {
  const searchParams = new URLSearchParams(window.location.search);
  const environment: FerrumRuntimeEnvironment = searchParams.get("environment") === "production"
    ? "production"
    : "development";
  const preserveDrawingBuffer = searchParams.get("preserveDrawingBuffer") === "true";
  const profilerSmoke = searchParams.get("profilerSmoke") === "true";
  const catalog = await loadCatalog();
  const initialScenario = scenarioById(catalog, searchParams.get("demo") ?? DEFAULT_SCENARIO_ID);
  let debugOptions: PhysicsDebugOptions = {
    ...DEFAULT_DEBUG_OPTIONS,
    ...initialScenario.defaultDebug,
    broadphase: searchParams.get("broadphase") === "true" || initialScenario.defaultDebug?.broadphase === true,
  };

  let runtime: FerrumRuntime | undefined;
  let currentWorld: PhysicsWorldApplyResult | undefined;
  let currentSpec: ResolvedPhysicsSpec | undefined;
  let currentScenario = initialScenario;
  let currentFramePhysicsState: FramePhysicsState = EMPTY_FRAME_PHYSICS_STATE;
  let paused = false;
  let stepQueued = false;
  let frameCount = 0;
  let selectedBodyId: string | undefined;
  let queryTarget: Point2 | undefined = queryTargetFromScenario(initialScenario);

  const shell = createShell(
    catalog.scenarios,
    (id) => {
      void loadScenario(id);
    },
    () => {
      void loadScenario(currentScenario.id);
    },
    () => {
      paused = false;
      shell.setPaused(false);
      shell.setStatus("running");
    },
    () => {
      paused = true;
      shell.setPaused(true);
      shell.setStatus("paused");
    },
    () => {
      paused = true;
      stepQueued = true;
      shell.setPaused(true);
      shell.setStatus("step");
    },
    (id) => {
      void runScenarioAction(id);
    },
    (materialId, field, value) => {
      updateMaterialValue(materialId, field, value);
    },
    (options) => {
      debugOptions = { ...options };
      runtime?.engine.setPhysicsDebugLinesEnabled(debugOptions);
    },
    debugOptions,
  );

  shell.overlayCanvas.addEventListener("pointermove", (event) => {
    queryTarget = screenEventToWorld(event, shell.overlayCanvas, cameraForScenario(currentScenario));
  });
  shell.overlayCanvas.addEventListener("click", (event) => {
    const point = screenEventToWorld(event, shell.overlayCanvas, cameraForScenario(currentScenario));
    const hit = runtime?.engine.queryNearestBody({ x: point.x, y: point.y, maxDistance: 54 });
    selectedBodyId = hit === undefined ? undefined : currentFramePhysicsState.bodyIdsByEntityKey.get(
      entityKey({ entityId: hit.entityId, entityGeneration: hit.entityGeneration }),
    );
    shell.setSelectedBody(selectedBodyReport(currentScenario, currentSpec, currentFramePhysicsState, selectedBodyId));
  });

  async function loadScenario(id: string): Promise<void> {
    const scenario = scenarioById(catalog, id);
    if (!runtime) {
      throw new Error("Physics runtime is not ready.");
    }
    try {
      shell.setStatus("loading");
      (window as SandboxWindow).ferrumPhysicsSandboxSmokeFrame = undefined;
      const rawSpec = await loadJson<PhysicsSpec>(publicAssetUrl(scenario.physicsSpec));
      const resolved = resolvePhysicsSpec(rawSpec, { path: "physics" });
      currentWorld = createPhysicsWorldFromSpec(runtime.engine, resolved, {
        replace: currentWorld,
        onWarning: (warning) => {
          console.warn(warning.message);
        },
      });
      currentSpec = resolved;
      currentScenario = scenario;
      currentFramePhysicsState = EMPTY_FRAME_PHYSICS_STATE;
      selectedBodyId = scenario.focusBodies?.find((bodyId) => currentWorld?.bodies[bodyId] !== undefined)
        ?? Object.keys(currentWorld.bodies)[0];
      queryTarget = queryTargetFromScenario(scenario);
      frameCount = 0;
      debugOptions = sanitizeDebugOptionsForScenario(
        scenario,
        resolved,
        { ...DEFAULT_DEBUG_OPTIONS, ...scenario.defaultDebug },
      );
      runtime.engine.setPhysicsDebugLinesEnabled(debugOptions);
      shell.setScenario(scenario, resolved, currentWorld, debugOptions);
      shell.setActions(scenario.controls?.actions ?? []);
      shell.setMaterialControls(materialControlEntries(resolved));
      shell.setWarnings(currentWorld.warnings);
      shell.setEvents([]);
      shell.setSelectedBody(undefined);
      paused = false;
      shell.setPaused(false);
      shell.setStatus("running");
    } catch (error) {
      console.error("Ferrum2D physics showcase scenario load failed", error);
      shell.setError(error);
      throw error;
    }
  }

  async function runScenarioAction(id: string): Promise<void> {
    if (!runtime || !currentWorld) return;
    const action = currentScenario.controls?.actions?.find((candidate) => candidate.id === id);
    if (!action) return;
    if (action.kind === "reset") {
      await loadScenario(currentScenario.id);
      return;
    }
    const handle = currentWorld.bodies[action.body];
    if (!handle) return;
    switch (action.kind) {
      case "impulse":
        runtime.engine.applyPhysicsBodyImpulse(handle, action.impulse[0], action.impulse[1]);
        break;
      case "velocity":
        if (action.position) {
          runtime.engine.setPhysicsBodyPosition(handle, action.position[0], action.position[1]);
          resetBodyRotationFromSpec(runtime.engine, handle, currentSpec, action.body);
        }
        runtime.engine.setPhysicsBodyVelocity(handle, action.velocity[0], action.velocity[1]);
        break;
      case "teleport":
        runtime.engine.setPhysicsBodyPosition(handle, action.position[0], action.position[1]);
        resetBodyRotationFromSpec(runtime.engine, handle, currentSpec, action.body);
        if (action.velocity) {
          runtime.engine.setPhysicsBodyVelocity(handle, action.velocity[0], action.velocity[1]);
        }
        break;
    }
    shell.setEvents([`조작: ${actionLabel(action)}`]);
  }

  function updateMaterialValue(materialId: string, field: MaterialControlField, value: number): void {
    if (!runtime || !currentWorld || !currentSpec) return;
    const material = currentSpec.materials[materialId];
    if (!material) return;
    const nextMaterial = { ...material, [field]: value };
    currentSpec.materials[materialId] = nextMaterial;
    const appliedCount = applyMaterialToWorld(runtime.engine, currentWorld, currentSpec, materialId, nextMaterial);
    shell.setEvents([
      `재질 조절: ${materialDisplayName(materialId)} ${materialFieldLabel(field)} ${formatMaterialControlValue(field, value)} (${formatCount(appliedCount)}곳 적용)`,
    ]);
    shell.setSelectedBody(selectedBodyReport(currentScenario, currentSpec, currentFramePhysicsState, selectedBodyId));
  }

  runtime = await createFerrumRuntime({
    canvas: shell.canvas,
    debugParent: shell.debugRoot,
    debug: searchParams.get("debug") === "true"
      ? { enabled: true, layout: "inline" }
      : false,
    physicsDebugLines: debugOptions,
    physicsMode: "rigid",
    profiler: profilerSmoke,
    environment,
    autostart: false,
    webgl2: { clearColor: [0.05, 0.07, 0.06, 1], preserveDrawingBuffer },
    engine: {
      enablePhysicsDebugLines: debugOptions,
      includePhysicsDebugLines: true,
      physicsDebugOptions: debugOptions,
    },
    onFrame: ({ frame, rendererStats, fps }) => {
      frameCount += 1;
      const consumedStep = stepQueued;
      if (currentWorld && (!paused || stepQueued)) {
        runtime?.engine.stepRigidBodies(currentWorld.stepSeconds, currentWorld.stepOptions);
        stepQueued = false;
        if (consumedStep && paused) {
          shell.setStatus("paused");
        }
      }

      currentFramePhysicsState = capturePhysicsFrameState(
        runtime?.engine,
        currentWorld,
        currentScenario,
        queryTarget,
      );
      if (currentSpec) {
        drawPhysicsShowcase(shell.overlayCanvas, {
          scenario: currentScenario,
          spec: currentSpec,
          debugOptions,
          frameState: currentFramePhysicsState,
          selectedBodyId,
          queryTarget,
        });
      }

      const debugLineCount = rendererStats.physicsDebugLineCount || frame.physicsDebugLineBuffer.lineCount;
      const metrics: SandboxRuntimeMetrics = {
        bodyCount: currentWorld?.bodyCount ?? 0,
        jointCount: currentWorld?.jointCount ?? 0,
        debugLineCount,
        fps,
        frameCount,
        entityCount: frame.entityCount,
        renderCommandCount: rendererStats.renderCommandCount,
        visibleBodyCount: currentFramePhysicsState.bodyStates.length,
        contactCount: currentFramePhysicsState.contacts.length,
        manifoldCount: currentFramePhysicsState.manifolds.length,
        impulseCount: currentFramePhysicsState.impulses.length,
        queryHitCount: currentFramePhysicsState.rayHits.length,
      };
      shell.setRuntimeMetrics(metrics);
      shell.setEvents(frameEvents(currentScenario, currentFramePhysicsState));
      shell.setSelectedBody(selectedBodyReport(currentScenario, currentSpec, currentFramePhysicsState, selectedBodyId));
      (window as SandboxWindow).ferrumPhysicsSandboxSmokeFrame = {
        demoId: currentScenario.id,
        bodyCount: metrics.bodyCount,
        jointCount: metrics.jointCount,
        warningCount: currentWorld?.warningCount ?? 0,
        entityCount: frame.entityCount,
        renderCommandCount: rendererStats.renderCommandCount,
        physicsDebugLineCount: debugLineCount,
        fixedStepSeconds: currentSpec?.solver.stepSeconds ?? 0,
        frameCount,
        visibleBodyCount: metrics.visibleBodyCount,
        contactCount: metrics.contactCount,
        manifoldCount: metrics.manifoldCount,
        impulseCount: metrics.impulseCount,
        queryHitCount: metrics.queryHitCount,
      };
    },
  });

  const sandboxWindow = window as SandboxWindow;
  sandboxWindow.ferrumEngine = runtime.engine;
  sandboxWindow.ferrumRuntime = runtime;
  sandboxWindow.ferrumPhysicsSandboxLoadDemo = loadScenario;

  await loadScenario(initialScenario.id);
  runtime.start();

  window.addEventListener("beforeunload", () => {
    runtime?.destroy();
  }, { once: true });
}

function capturePhysicsFrameState(
  engine: FerrumEngine | undefined,
  world: PhysicsWorldApplyResult | undefined,
  scenario: PhysicsScenarioEntry,
  queryTarget: Point2 | undefined,
): FramePhysicsState {
  if (!engine || !world) {
    return EMPTY_FRAME_PHYSICS_STATE;
  }
  const handles = Object.values(world.bodies);
  const bodyIdsByEntityKey = new Map<string, string>();
  for (const [bodyId, handle] of Object.entries(world.bodies)) {
    bodyIdsByEntityKey.set(entityKey(handle), bodyId);
  }
  const bodyStates = engine.capturePhysicsBodyStateBuffer(handles).states;
  const bodyStatesById = new Map<string, PhysicsEntitySnapshot>();
  for (const state of bodyStates) {
    const bodyId = bodyIdsByEntityKey.get(entityKey(state));
    if (bodyId) {
      bodyStatesById.set(bodyId, state);
    }
  }
  const rayHits = scenario.query
    ? engine.raycastBodies(raycastForScenario(scenario, queryTarget))
    : [];
  return {
    bodyStates,
    bodyStatesById,
    bodyIdsByEntityKey,
    contacts: engine.queryBodyContacts(),
    manifolds: engine.queryBodyManifolds(),
    impulses: engine.queryRigidContactImpulses(),
    rayHits,
  };
}

function resetBodyRotationFromSpec(
  engine: FerrumEngine,
  handle: PhysicsEntityHandle,
  spec: ResolvedPhysicsSpec | undefined,
  bodyId: string,
): void {
  const body = spec?.bodies[bodyId];
  if (!body) return;
  engine.setPhysicsBodyRotation(handle, body.rotationRadians);
  engine.setPhysicsBodyAngularVelocity(handle, body.angularVelocityRadiansPerSecond);
}

function drawPhysicsShowcase(canvas: HTMLCanvasElement, context: DrawContext): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const mapper = resizeOverlayCanvas(canvas, cameraForScenario(context.scenario));
  ctx.clearRect(0, 0, mapper.width, mapper.height);
  drawGrid(ctx, mapper);
  drawQuery(ctx, mapper, context);
  if (context.debugOptions.joints) {
    drawJoints(ctx, mapper, context);
  }
  if (context.debugOptions.colliders) {
    drawBodies(ctx, mapper, context);
  }
  if (context.debugOptions.sleeping) {
    drawSleepingMarkers(ctx, mapper, context);
  }
  if (context.debugOptions.contacts || context.debugOptions.manifolds) {
    drawContacts(ctx, mapper, context.frameState);
  }
}

function resizeOverlayCanvas(canvas: HTMLCanvasElement, camera: PhysicsScenarioCamera): ScreenMapper {
  const width = Math.max(1, canvas.clientWidth || 800);
  const height = Math.max(1, canvas.clientHeight || 480);
  const dpr = window.devicePixelRatio || 1;
  const targetWidth = Math.max(1, Math.floor(width * dpr));
  const targetHeight = Math.max(1, Math.floor(height * dpr));
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  const ctx = canvas.getContext("2d");
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  const scaleX = width / camera.width;
  const scaleY = height / camera.height;
  return {
    width,
    height,
    scaleX,
    scaleY,
    worldToScreen(point) {
      return {
        x: (point.x - camera.x) * scaleX,
        y: (point.y - camera.y) * scaleY,
      };
    },
    screenToWorld(point) {
      return {
        x: point.x / scaleX + camera.x,
        y: point.y / scaleY + camera.y,
      };
    },
    worldLength(value) {
      return value * ((scaleX + scaleY) * 0.5);
    },
  };
}

function drawGrid(ctx: CanvasRenderingContext2D, mapper: ScreenMapper): void {
  ctx.save();
  ctx.fillStyle = "#0f1513";
  ctx.fillRect(0, 0, mapper.width, mapper.height);
  ctx.strokeStyle = "rgba(137, 166, 148, 0.12)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= mapper.width; x += Math.max(20, mapper.worldLength(40))) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, mapper.height);
    ctx.stroke();
  }
  for (let y = 0; y <= mapper.height; y += Math.max(20, mapper.worldLength(40))) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(mapper.width, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBodies(ctx: CanvasRenderingContext2D, mapper: ScreenMapper, context: DrawContext): void {
  const sortedBodies = Object.values(context.spec.bodies).sort((a, b) => bodySortWeight(a) - bodySortWeight(b));
  for (const body of sortedBodies) {
    const state = context.frameState.bodyStatesById.get(body.id);
    if (!state) continue;
    const style = bodyStyle(context.scenario, body);
    const selected = context.selectedBodyId === body.id;
    for (const [colliderIndex, collider] of body.colliders.entries()) {
      drawCollider(ctx, mapper, body, collider, state, {
        fill: collider.trigger ? "rgba(120, 169, 255, 0.16)" : style.fill,
        stroke: selected ? "#ffffff" : collider.trigger ? "#78a9ff" : style.stroke,
        lineWidth: selected ? 3 : collider.trigger ? 2 : 1.5,
        dashed: collider.trigger,
      });
      if (selected && colliderIndex === 0) {
        drawVelocity(ctx, mapper, state);
      }
    }
    if (shouldLabelBody(context.scenario, body, selected)) {
      drawBodyLabel(ctx, mapper, body, state, style.label);
    }
  }
}

function drawCollider(
  ctx: CanvasRenderingContext2D,
  mapper: ScreenMapper,
  body: ResolvedPhysicsBodySpec,
  collider: ResolvedPhysicsColliderSpec,
  state: PhysicsEntitySnapshot,
  style: { fill: string; stroke: string; lineWidth: number; dashed?: boolean },
): void {
  ctx.save();
  ctx.fillStyle = style.fill;
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = style.lineWidth;
  ctx.setLineDash(style.dashed ? [6, 4] : []);
  switch (collider.shape) {
    case "aabb":
    case "box":
      drawPolygon(ctx, mapper, boxVertices(state, collider, 0), true);
      break;
    case "orientedBox":
      drawPolygon(ctx, mapper, boxVertices(state, collider, collider.rotationRadians), true);
      break;
    case "circle":
      drawCircle(ctx, mapper, colliderCenter(state, collider), collider.radius);
      break;
    case "capsule":
      drawCapsule(ctx, mapper, state, collider);
      break;
    case "convexPolygon":
      drawPolygon(ctx, mapper, collider.vertices.map((vertex) => colliderLocalPoint(state, collider, vertex.x, vertex.y)), true);
      break;
    case "edge":
      drawPolyline(ctx, mapper, [
        colliderLocalPoint(state, collider, collider.startX, collider.startY),
        colliderLocalPoint(state, collider, collider.endX, collider.endY),
      ], false);
      break;
    case "chain":
      drawPolyline(ctx, mapper, collider.vertices.map((vertex) => colliderLocalPoint(state, collider, vertex.x, vertex.y)), collider.loop);
      break;
  }
  if (body.type === "static") {
    ctx.globalAlpha = 0.5;
  }
  ctx.restore();
}

function drawPolygon(
  ctx: CanvasRenderingContext2D,
  mapper: ScreenMapper,
  points: readonly Point2[],
  close: boolean,
): void {
  if (points.length === 0) return;
  ctx.beginPath();
  const first = mapper.worldToScreen(points[0]);
  ctx.moveTo(first.x, first.y);
  for (const point of points.slice(1)) {
    const screen = mapper.worldToScreen(point);
    ctx.lineTo(screen.x, screen.y);
  }
  if (close) ctx.closePath();
  if (close) ctx.fill();
  ctx.stroke();
}

function drawPolyline(
  ctx: CanvasRenderingContext2D,
  mapper: ScreenMapper,
  points: readonly Point2[],
  close: boolean,
): void {
  ctx.save();
  ctx.lineWidth = Math.max(2, ctx.lineWidth);
  drawPolygon(ctx, mapper, points, close);
  ctx.restore();
}

function drawCircle(ctx: CanvasRenderingContext2D, mapper: ScreenMapper, center: Point2, radius: number): void {
  const screen = mapper.worldToScreen(center);
  ctx.beginPath();
  ctx.arc(screen.x, screen.y, Math.max(2, mapper.worldLength(radius)), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function drawCapsule(
  ctx: CanvasRenderingContext2D,
  mapper: ScreenMapper,
  state: PhysicsEntitySnapshot,
  collider: Extract<ResolvedPhysicsColliderSpec, { shape: "capsule" }>,
): void {
  const start = colliderLocalPoint(state, collider, collider.startX, collider.startY);
  const end = colliderLocalPoint(state, collider, collider.endX, collider.endY);
  const startScreen = mapper.worldToScreen(start);
  const endScreen = mapper.worldToScreen(end);
  const radius = Math.max(2, mapper.worldLength(collider.radius));
  const angle = Math.atan2(endScreen.y - startScreen.y, endScreen.x - startScreen.x);
  const normal = { x: Math.cos(angle + Math.PI * 0.5) * radius, y: Math.sin(angle + Math.PI * 0.5) * radius };
  ctx.beginPath();
  ctx.moveTo(startScreen.x + normal.x, startScreen.y + normal.y);
  ctx.lineTo(endScreen.x + normal.x, endScreen.y + normal.y);
  ctx.arc(endScreen.x, endScreen.y, radius, angle + Math.PI * 0.5, angle - Math.PI * 0.5);
  ctx.lineTo(startScreen.x - normal.x, startScreen.y - normal.y);
  ctx.arc(startScreen.x, startScreen.y, radius, angle - Math.PI * 0.5, angle + Math.PI * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawJoints(ctx: CanvasRenderingContext2D, mapper: ScreenMapper, context: DrawContext): void {
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(240, 183, 95, 0.9)";
  ctx.fillStyle = "#f0b75f";
  for (const joint of Object.values(context.spec.joints)) {
    const endpoints = jointEndpoints(joint, context.frameState);
    if (!endpoints) continue;
    const a = mapper.worldToScreen(endpoints.a);
    const b = mapper.worldToScreen(endpoints.b);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(a.x, a.y, 4, 0, Math.PI * 2);
    ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
    ctx.fill();
    const mid = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
    ctx.fillStyle = "rgba(255, 244, 216, 0.92)";
    ctx.font = "11px system-ui";
    ctx.fillText(joint.type, mid.x + 6, mid.y - 6);
    ctx.fillStyle = "#f0b75f";
  }
  ctx.restore();
}

function drawSleepingMarkers(ctx: CanvasRenderingContext2D, mapper: ScreenMapper, context: DrawContext): void {
  ctx.save();
  ctx.font = "11px system-ui";
  ctx.textBaseline = "middle";
  for (const body of Object.values(context.spec.bodies)) {
    if (body.type === "static" || !body.canSleep) continue;
    const state = context.frameState.bodyStatesById.get(body.id);
    if (!state) continue;
    const center = mapper.worldToScreen({ x: state.x, y: state.y });
    const status = sleepingMarkerStatus(state);
    const text = status.label;
    const width = ctx.measureText(text).width + 16;
    const markerX = center.x + 12;
    const markerY = center.y - 10;
    ctx.fillStyle = status.fill;
    ctx.strokeStyle = status.stroke;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(markerX, markerY, width, 20, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = status.text;
    ctx.textAlign = "center";
    ctx.fillText(text, markerX + width * 0.5, markerY + 10);
  }
  ctx.restore();
}

function sleepingMarkerStatus(state: PhysicsEntitySnapshot): { label: string; fill: string; stroke: string; text: string } {
  if (state.isSleeping) {
    return {
      label: "휴면",
      fill: "rgba(120, 169, 255, 0.9)",
      stroke: "rgba(255, 255, 255, 0.72)",
      text: "#0f1513",
    };
  }
  const sleepReady = Math.hypot(state.velocityX, state.velocityY) <= 0.05
    && Math.abs(state.angularVelocityRadiansPerSecond) <= 0.05;
  if (sleepReady) {
    return {
      label: "휴면 대기",
      fill: "rgba(43, 64, 95, 0.88)",
      stroke: "rgba(120, 169, 255, 0.82)",
      text: "#e7efff",
    };
  }
  return {
    label: "활성",
    fill: "rgba(15, 21, 19, 0.82)",
    stroke: "rgba(240, 183, 95, 0.9)",
    text: "#ffe3ad",
  };
}

function drawContacts(ctx: CanvasRenderingContext2D, mapper: ScreenMapper, frameState: FramePhysicsState): void {
  ctx.save();
  for (const manifold of frameState.manifolds.slice(0, 24)) {
    for (const point of manifold.points) {
      const screen = mapper.worldToScreen({ x: point.pointX, y: point.pointY });
      const normalEnd = {
        x: screen.x + manifold.normalX * 28,
        y: screen.y + manifold.normalY * 28,
      };
      ctx.strokeStyle = "rgba(255, 205, 154, 0.95)";
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(screen.x, screen.y);
      ctx.lineTo(normalEnd.x, normalEnd.y);
      ctx.stroke();
      drawArrowHead(ctx, screen, normalEnd, "#ffcd9a");
      ctx.fillStyle = "#ff9b76";
      ctx.strokeStyle = "rgba(255, 255, 255, 0.82)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawArrowHead(ctx: CanvasRenderingContext2D, start: Point2, end: Point2, color: string): void {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(end.x - Math.cos(angle - 0.45) * 8, end.y - Math.sin(angle - 0.45) * 8);
  ctx.lineTo(end.x - Math.cos(angle + 0.45) * 8, end.y - Math.sin(angle + 0.45) * 8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawQuery(ctx: CanvasRenderingContext2D, mapper: ScreenMapper, context: DrawContext): void {
  const query = context.scenario.query;
  if (!query) return;
  const origin = { x: query.origin[0], y: query.origin[1] };
  const target = context.queryTarget ?? { x: query.target[0], y: query.target[1] };
  const originScreen = mapper.worldToScreen(origin);
  const targetScreen = mapper.worldToScreen(target);
  ctx.save();
  ctx.strokeStyle = "rgba(120, 169, 255, 0.92)";
  ctx.fillStyle = "#78a9ff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(originScreen.x, originScreen.y);
  ctx.lineTo(targetScreen.x, targetScreen.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(originScreen.x, originScreen.y, 5, 0, Math.PI * 2);
  ctx.fill();
  for (const hit of context.frameState.rayHits.slice(0, 4)) {
    const point = mapper.worldToScreen({ x: hit.pointX, y: hit.pointY });
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(point.x + hit.normalX * 24, point.y + hit.normalY * 24);
    ctx.stroke();
  }
  ctx.restore();
}

function drawVelocity(ctx: CanvasRenderingContext2D, mapper: ScreenMapper, state: PhysicsEntitySnapshot): void {
  const speed = Math.hypot(state.velocityX, state.velocityY);
  if (speed < 0.1) return;
  const start = mapper.worldToScreen({ x: state.x, y: state.y });
  const scale = Math.min(0.18, 42 / speed);
  const end = mapper.worldToScreen({
    x: state.x + state.velocityX * scale,
    y: state.y + state.velocityY * scale,
  });
  ctx.save();
  ctx.strokeStyle = "#72dc9d";
  ctx.fillStyle = "#72dc9d";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(end.x - Math.cos(angle - 0.45) * 8, end.y - Math.sin(angle - 0.45) * 8);
  ctx.lineTo(end.x - Math.cos(angle + 0.45) * 8, end.y - Math.sin(angle + 0.45) * 8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawBodyLabel(
  ctx: CanvasRenderingContext2D,
  mapper: ScreenMapper,
  body: ResolvedPhysicsBodySpec,
  state: PhysicsEntitySnapshot,
  label?: string,
): void {
  const screen = mapper.worldToScreen({ x: state.x, y: state.y });
  const text = label ?? body.id;
  ctx.save();
  ctx.font = "12px system-ui";
  const width = ctx.measureText(text).width + 12;
  ctx.fillStyle = "rgba(8, 12, 10, 0.78)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(screen.x - width * 0.5, screen.y - 34, width, 22, 5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#f3f7f2";
  ctx.textAlign = "center";
  ctx.fillText(text, screen.x, screen.y - 19);
  ctx.restore();
}

function selectedBodyReport(
  scenario: PhysicsScenarioEntry,
  spec: ResolvedPhysicsSpec | undefined,
  frameState: FramePhysicsState,
  bodyId: string | undefined,
): SelectedBodyReport | undefined {
  if (!spec || !bodyId) return undefined;
  const body = spec.bodies[bodyId];
  const state = frameState.bodyStatesById.get(bodyId);
  if (!body || !state) return undefined;
  const style = bodyStyle(scenario, body);
  return {
    id: body.id,
    label: style.label ?? body.id,
    type: state.bodyType,
    material: body.material ? materialReportLabel(body.material, spec.materials[body.material]) : "default",
    collider: body.colliders.map((collider) => collider.shape).join(", "),
    position: formatVector(state.x, state.y),
    velocity: formatVector(state.velocityX, state.velocityY),
    sleeping: state.isSleeping ? "예" : "아니오",
  };
}

function frameEvents(scenario: PhysicsScenarioEntry, frameState: FramePhysicsState): readonly string[] {
  const events: string[] = [];
  for (const manifold of frameState.manifolds.slice(0, 3)) {
    const a = bodyDisplayName(scenario, frameState.bodyIdsByEntityKey.get(entityKey({
      entityId: manifold.aEntityId,
      entityGeneration: manifold.aEntityGeneration,
    })));
    const b = bodyDisplayName(scenario, frameState.bodyIdsByEntityKey.get(entityKey({
      entityId: manifold.bEntityId,
      entityGeneration: manifold.bEntityGeneration,
    })));
    events.push(`접촉: ${a} ↔ ${b}, 깊이 ${manifold.penetration.toFixed(2)}`);
  }
  for (const impulse of frameState.impulses.slice(0, 2)) {
    events.push(`충격량: 법선 ${impulse.normalImpulse.toFixed(2)}, 접선 ${impulse.tangentImpulse.toFixed(2)}`);
  }
  if (scenario.query) {
    const hit = frameState.rayHits[0];
    events.push(hit
      ? `레이캐스트: ${formatVector(hit.pointX, hit.pointY)} 위치 적중`
      : "레이캐스트: 맞은 물체 없음");
  }
  return events;
}

function boxVertices(
  state: PhysicsEntitySnapshot,
  collider: Extract<ResolvedPhysicsColliderSpec, { shape: "aabb" | "box" | "orientedBox" }>,
  colliderRotation: number,
): readonly Point2[] {
  return [
    colliderLocalPoint(state, collider, -collider.halfWidth, -collider.halfHeight, colliderRotation),
    colliderLocalPoint(state, collider, collider.halfWidth, -collider.halfHeight, colliderRotation),
    colliderLocalPoint(state, collider, collider.halfWidth, collider.halfHeight, colliderRotation),
    colliderLocalPoint(state, collider, -collider.halfWidth, collider.halfHeight, colliderRotation),
  ];
}

function colliderCenter(state: PhysicsEntitySnapshot, collider: ResolvedPhysicsColliderSpec): Point2 {
  return localToWorld(state, collider.offsetX, collider.offsetY);
}

function colliderLocalPoint(
  state: PhysicsEntitySnapshot,
  collider: ResolvedPhysicsColliderSpec,
  localX: number,
  localY: number,
  colliderRotation = collider.shape === "convexPolygon" ? collider.rotationRadians : 0,
): Point2 {
  const rotatedColliderPoint = rotatePoint(localX, localY, colliderRotation);
  return localToWorld(
    state,
    collider.offsetX + rotatedColliderPoint.x,
    collider.offsetY + rotatedColliderPoint.y,
  );
}

function localToWorld(state: PhysicsEntitySnapshot, localX: number, localY: number): Point2 {
  const rotated = rotatePoint(localX, localY, state.rotationRadians);
  return { x: state.x + rotated.x, y: state.y + rotated.y };
}

function rotatePoint(x: number, y: number, radians: number): Point2 {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

function jointEndpoints(joint: ResolvedPhysicsJointSpec, frameState: FramePhysicsState): { a: Point2; b: Point2 } | undefined {
  const stateA = frameState.bodyStatesById.get(joint.bodyA);
  const stateB = frameState.bodyStatesById.get(joint.bodyB);
  const a = stateA
    ? localToWorld(stateA, joint.localAnchorAX, joint.localAnchorAY)
    : { x: joint.anchorX || joint.groundAnchorAX, y: joint.anchorY || joint.groundAnchorAY };
  const b = stateB
    ? localToWorld(stateB, joint.localAnchorBX, joint.localAnchorBY)
    : { x: joint.anchorX || joint.groundAnchorBX, y: joint.anchorY || joint.groundAnchorBY };
  if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) {
    return undefined;
  }
  return { a, b };
}

function bodyStyle(
  scenario: PhysicsScenarioEntry,
  body: ResolvedPhysicsBodySpec,
): { fill: string; stroke: string; label: string } {
  const configured = scenario.bodyStyles?.[body.id];
  const defaults = body.type === "static"
    ? { fill: "rgba(154, 166, 157, 0.3)", stroke: "rgba(205, 218, 208, 0.76)" }
    : body.type === "kinematic"
      ? { fill: "rgba(120, 169, 255, 0.35)", stroke: "#78a9ff" }
      : { fill: "rgba(114, 220, 157, 0.38)", stroke: "#72dc9d" };
  return {
    fill: configured?.fill ?? defaults.fill,
    stroke: configured?.stroke ?? defaults.stroke,
    label: configured?.labelKo ?? configured?.label ?? body.id,
  };
}

function bodySortWeight(body: ResolvedPhysicsBodySpec): number {
  if (body.type === "static") return 0;
  if (body.type === "kinematic") return 1;
  return 2;
}

function shouldLabelBody(scenario: PhysicsScenarioEntry, body: ResolvedPhysicsBodySpec, selected: boolean): boolean {
  return selected || scenario.focusBodies?.includes(body.id) === true;
}

function raycastForScenario(
  scenario: PhysicsScenarioEntry,
  queryTarget: Point2 | undefined,
): { originX: number; originY: number; directionX: number; directionY: number; maxDistance: number } {
  const query = scenario.query;
  if (!query) {
    return { originX: 0, originY: 0, directionX: 1, directionY: 0, maxDistance: 0 };
  }
  const target = queryTarget ?? { x: query.target[0], y: query.target[1] };
  const origin = { x: query.origin[0], y: query.origin[1] };
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const length = Math.max(0.0001, Math.hypot(dx, dy));
  return {
    originX: origin.x,
    originY: origin.y,
    directionX: dx / length,
    directionY: dy / length,
    maxDistance: query.maxDistance ?? length,
  };
}

function queryTargetFromScenario(scenario: PhysicsScenarioEntry): Point2 | undefined {
  return scenario.query ? { x: scenario.query.target[0], y: scenario.query.target[1] } : undefined;
}

function screenEventToWorld(event: PointerEvent, canvas: HTMLCanvasElement, camera: PhysicsScenarioCamera): Point2 {
  const rect = canvas.getBoundingClientRect();
  const mapper = mapperForRect(rect, camera);
  return mapper.screenToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top });
}

function mapperForRect(rect: DOMRect, camera: PhysicsScenarioCamera): ScreenMapper {
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const scaleX = width / camera.width;
  const scaleY = height / camera.height;
  return {
    width,
    height,
    scaleX,
    scaleY,
    worldToScreen(point) {
      return { x: (point.x - camera.x) * scaleX, y: (point.y - camera.y) * scaleY };
    },
    screenToWorld(point) {
      return { x: point.x / scaleX + camera.x, y: point.y / scaleY + camera.y };
    },
    worldLength(value) {
      return value * ((scaleX + scaleY) * 0.5);
    },
  };
}

function entityKey(handle: Pick<PhysicsEntityHandle, "entityId" | "entityGeneration">): string {
  return `${handle.entityId}:${handle.entityGeneration}`;
}

function scenarioById(catalog: PhysicsShowcaseCatalog, id: string): PhysicsScenarioEntry {
  return catalog.scenarios.find((scenario) => scenario.id === id)
    ?? catalog.scenarios.find((scenario) => scenario.id === DEFAULT_SCENARIO_ID)
    ?? catalog.scenarios[0];
}

function cameraForScenario(scenario: PhysicsScenarioEntry): PhysicsScenarioCamera {
  return scenario.camera ?? DEFAULT_CAMERA;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function scenarioTitle(scenario: PhysicsScenarioEntry): string {
  return scenario.titleKo ? `${scenario.titleKo} (${scenario.title})` : scenario.title;
}

function scenarioSummary(scenario: PhysicsScenarioEntry): string {
  return scenario.summaryKo ?? scenario.summary;
}

function scenarioFocus(scenario: PhysicsScenarioEntry): readonly string[] {
  return scenario.focusKo ?? scenario.focus;
}

function scenarioOptionLabel(scenario: PhysicsScenarioEntry): string {
  const category = scenario.categoryKo ?? scenario.category;
  const title = scenario.titleKo ?? scenario.title;
  return scenario.titleKo ? `${category} / ${title} (${scenario.title})` : `${category} / ${title}`;
}

function categoryLabel(category: string, scenarios: readonly PhysicsScenarioEntry[]): string {
  return scenarios.find((scenario) => scenario.category === category)?.categoryKo ?? category;
}

function actionLabel(action: PhysicsScenarioAction): string {
  return action.labelKo ?? action.label;
}

function bodyDisplayName(scenario: PhysicsScenarioEntry, bodyId: string | undefined): string {
  if (!bodyId) return "물체";
  const style = scenario.bodyStyles?.[bodyId];
  return style?.labelKo ?? style?.label ?? bodyId;
}

function materialDisplayName(materialId: string): string {
  return MATERIAL_LABELS[materialId] ?? materialId;
}

function materialReportLabel(
  materialId: string,
  material: ResolvedPhysicsMaterialSpec | undefined,
): string {
  if (!material) return materialDisplayName(materialId);
  return `${materialDisplayName(materialId)} / 마찰 ${formatMaterialControlValue("friction", material.friction)} / 탄성 ${formatMaterialControlValue("restitution", material.restitution)}`;
}

function materialFieldLabel(field: MaterialControlField): string {
  return field === "friction" ? "마찰" : "탄성";
}

function createFocusChip(label: string): HTMLElement {
  const chip = document.createElement("span");
  chip.className = "focus-chip";
  chip.textContent = label;
  return chip;
}

function createWarningRow(warning: PhysicsWorldApplyWarning): HTMLElement {
  const row = document.createElement("p");
  row.textContent = `${warning.path}: ${warning.detail}`;
  return row;
}

function formatCount(value: number): string {
  return NUMBER_FORMAT.format(value);
}

function formatStepSeconds(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "-";
  }
  return `${(value * 1000).toFixed(2)} ms`;
}

function formatMaterialControlValue(field: MaterialControlField, value: number): string {
  return clampMaterialControlValue(field, value).toFixed(2);
}

function clampMaterialControlValue(field: MaterialControlField, value: number): number {
  if (!Number.isFinite(value)) return MATERIAL_CONTROL_RANGES[field].min;
  const range = MATERIAL_CONTROL_RANGES[field];
  return Math.min(range.max, Math.max(range.min, value));
}

function formatVector(x: number, y: number): string {
  return `${x.toFixed(0)}, ${y.toFixed(0)}`;
}

function renderBootstrapError(error: unknown): void {
  console.error("Ferrum2D physics showcase failed", error);
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) return;

  const report = diagnosticReport(error);
  const container = document.createElement("main");
  const title = document.createElement("h1");
  const list = document.createElement("dl");
  container.className = "error-shell";
  title.textContent = "Ferrum2D 물리 쇼케이스 Lab";
  for (const [label, value] of diagnosticRows(report)) {
    appendMetric(list, label, createTextValue(value));
  }
  container.append(title, list);
  app.replaceChildren(container);
}

void bootstrap().catch(renderBootstrapError);
