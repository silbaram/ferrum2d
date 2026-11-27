import {
  createFerrumRuntime,
  createDataSceneView,
  type DataSceneView,
  createPhysicsWorldFromSpec,
  resolvePhysicsSpec,
  type BitmapFontAtlasSpec,
  type FerrumEngine,
  type FerrumRuntime,
  type FerrumRuntimeOptions,
  type PhysicsBodyContactHit,
  type PhysicsBodyManifoldHit,
  type PhysicsDebugLineBufferView,
  type PhysicsDebugOptions,
  type PhysicsEntityHandle,
  type PhysicsEntitySnapshot,
  type PhysicsRaycastBodyHit,
  type PhysicsRigidContactImpulseHit,
  type PhysicsSpec,
  type PhysicsWorldApplyResult,
  type PhysicsWorldApplyWarning,
  type ResolvedPhysicsBodySpec,
  type ResolvedPhysicsMaterialSpec,
  type ResolvedPhysicsSpec,
} from "@ferrum2d/ferrum-web/core";
import {
  DebugGizmoLineBufferWriter,
  diagnosticReport,
} from "@ferrum2d/ferrum-web/quality";
import {
  createRuntimeDemoButton,
  renderRuntimeDemoError,
  runtimeDemoDiagnosticRows,
} from "../../shared/runtimeDemoShell";
import {
  createTrySection, createWatchSection, fold, hint, iconButton, moreBlock, mountStageColumn,
} from "../../shared/exampleFrame";

import "./styles.css";
import { createExampleHeader } from "../../shared/exampleHeader";
import { createExampleLifetime } from "../../shared/exampleLifetime";
import sharedScenarios from "../../shared/physicsExamples.json";
import { createScenarioDetail } from "./scenarioDetail";

// Gallery thumbnails, so the scenario list matches the example gallery and the feature lab.
const scenarioThumbnails = import.meta.glob<string>("../../shared/thumbnails/physics-*.jpg", { eager: true, query: "?url", import: "default" });

interface PhysicsShowcaseCatalog {
  version: 1;
  scenarios: readonly PhysicsScenarioEntry[];
}

interface PhysicsScenarioEntry {
  id: string;
  title: string;
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
  pointerWorld?: Point2;
  bodyCount: number;
  jointCount: number;
  warningCount: number;
  entityCount: number;
  renderCommandCount: number;
  physicsDebugLineCount: number;
  customDebugLineCount: number;
  worldTextCount: number;
  fixedStepSeconds: number;
  frameCount: number;
  visibleBodyCount: number;
  contactCount: number;
  manifoldCount: number;
  impulseCount: number;
  queryHitCount: number;
  /** Message of the native step error that stopped the current world, if any. */
  physicsStepError?: string;
}

type SandboxStatus = "loading" | "running" | "paused" | "step" | "error";

interface SandboxRuntimeMetrics {
  bodyCount: number;
  jointCount: number;
  debugLineCount: number;
  customDebugLineCount: number;
  worldTextCount: number;
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
  destroy(): void;
  ready(): void;
  canvas: HTMLCanvasElement;
  debugRoot: HTMLElement;
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

interface Point2 {
  x: number;
  y: number;
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
const DEBUG_FONT_ID = 33;
const BODY_LABEL_TEXT_ID_BASE = 1_000;
const SLEEP_LABEL_TEXT_ID_BASE = 10_000;
const DEBUG_FONT_CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_./:>?";
const DEBUG_FONT_COLUMNS = 16;
const DEBUG_FONT_CELL_WIDTH = 12;
const DEBUG_FONT_CELL_HEIGHT = 16;
const DEBUG_FONT_ATLAS = createDebugFontAtlas();
const QUERY_COLOR = [0.47, 0.66, 1, 0.96] as const;
const QUERY_HIT_COLOR = [1, 1, 1, 1] as const;
const VELOCITY_COLOR = [0.45, 0.86, 0.62, 1] as const;
const SELECTION_COLOR = [0.94, 0.72, 0.37, 1] as const;
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

function createDebugFontAtlas(): BitmapFontAtlasSpec {
  const glyphs: Record<string, BitmapFontAtlasSpec["glyphs"][string]> = {};
  for (const [index, character] of [...DEBUG_FONT_CHARACTERS].entries()) {
    const column = index % DEBUG_FONT_COLUMNS;
    const row = Math.floor(index / DEBUG_FONT_COLUMNS);
    const isSpace = character === " ";
    glyphs[character] = {
      uv: {
        u0: column / DEBUG_FONT_COLUMNS,
        v0: row / 3,
        u1: (column + 1) / DEBUG_FONT_COLUMNS,
        v1: (row + 1) / 3,
      },
      size: {
        width: isSpace ? 0 : DEBUG_FONT_CELL_WIDTH,
        height: isSpace ? 0 : DEBUG_FONT_CELL_HEIGHT,
      },
      advance: DEBUG_FONT_CELL_WIDTH,
    };
  }
  return {
    format: "ferrum-bitmap-font",
    version: 1,
    lineHeight: DEBUG_FONT_CELL_HEIGHT,
    fallback: "?",
    glyphs,
  };
}

function publicAssetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

function createShell(
  scenarios: readonly PhysicsScenarioEntry[],
  initialScenario: string,
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
  // Physics Sandbox keeps a specialized shell for scenario, material, query, and frame-step controls.
  // Common buttons and diagnostics still come from the shared demo harness.
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) {
    throw new Error("Missing #app root element.");
  }

  const shell = document.createElement("main");
  const header = document.createElement("section");
  const title = document.createElement("h1");
  const statusBadge = document.createElement("span");
  const toolbar = document.createElement("div");
  const button = (icon: string, label: string, action: () => void) => {
    const element = iconButton(icon, label);
    element.addEventListener("click", action);
    return element;
  };
  const runButton = button("play", "실행", onRun);
  const pauseButton = button("pause", "일시정지", onPause);
  const stepButton = button("step-forward", "한 프레임", onStep);
  const resetButton = button("rotate-ccw", "리셋", onReset);
  const layout = document.createElement("section");
  const debugControls = document.createElement("div");
  const canvasPanel = document.createElement("section");
  const canvasFrame = document.createElement("div");
  const canvasStack = document.createElement("div");
  const canvas = document.createElement("canvas");
  const canvasHud = document.createElement("div");
  const canvasTitle = document.createElement("span");
  const canvasSignal = document.createElement("span");
  const sidePanel = document.createElement("aside");
  const trySection = createTrySection();
  const actionButtons = document.createElement("div");
  const watch = createWatchSection();
  const metrics = document.createElement("dl");
  const specPanel = document.createElement("dl");
  const materialControls = document.createElement("div");
  const selectedPanel = document.createElement("section");
  const selectedTitle = document.createElement("h3");
  const selectedBody = document.createElement("dl");
  const eventList = document.createElement("ol");
  const warningList = document.createElement("div");
  const diagnostics = document.createElement("dl");
  const debugRoot = document.createElement("div");
  const errorBox = document.createElement("div");
  const errorMessage = document.createElement("span");
  const errorMore = document.createElement("button");

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

  shell.className = "app-shell physics-lab example-detail";
  shell.append(createExampleHeader("physics-sandbox"));
  header.className = "demo-toolbar";
  statusBadge.className = "status-badge";
  statusBadge.setAttribute("role", "status");
  toolbar.className = "toolbar example-run";
  layout.className = "demo-stage-layout";
  debugControls.className = "debug-controls";
  debugControls.setAttribute("aria-label", "디버그 표시");
  canvasPanel.className = "canvas-panel";
  canvasFrame.className = "canvas-frame";
  canvasStack.className = "canvas-stack";
  canvas.className = "physics-canvas";
  canvasHud.className = "canvas-hud";
  canvasTitle.className = "canvas-hud-label";
  canvasSignal.className = "canvas-hud-label";
  sidePanel.className = "side-panel example-panel";
  sidePanel.setAttribute("aria-label", "해 보기와 볼 것");
  actionButtons.className = "example-guide-actions action-buttons";
  metrics.className = "metrics";
  specPanel.className = "spec-panel";
  materialControls.className = "material-controls";
  selectedPanel.className = "selected-panel";
  selectedBody.className = "selected-body";
  eventList.className = "event-list";
  warningList.className = "warning-list";
  diagnostics.className = "metrics";
  debugRoot.className = "debug-root";
  errorBox.className = "error-box";
  errorMessage.className = "error-message";
  errorMore.type = "button";
  errorMore.className = "error-more";

  title.textContent = "물리 심화 실험실";
  statusBadge.textContent = STATUS_LABELS.loading;
  statusBadge.dataset.status = "loading";
  selectedTitle.textContent = "선택한 물체";
  errorMore.textContent = "자세히";
  canvas.width = 800;
  canvas.height = 480;
  canvasTitle.textContent = STATUS_LABELS.loading;
  canvasSignal.textContent = "접촉 0";
  errorBox.hidden = true;
  warningList.hidden = true;
  selectedPanel.hidden = true;

  // "더 보기 › 엔진 수치": run state with warnings, physics settings, signals, and the last error.
  const engine = document.createElement("div");
  engine.className = "example-more-grid physics-engine";
  const errorBlock = moreBlock("오류", diagnostics);
  errorBlock.hidden = true;
  engine.append(moreBlock("실행 상태", metrics, warningList), moreBlock("물리 설정", specPanel), moreBlock("물리 신호", eventList), errorBlock);

  const detail = createScenarioDetail(scenarios.map((scenario) => ({
    id: scenario.id,
    title: scenarioTitle(scenario),
    category: categoryLabel(scenario.category, scenarios),
    summary: scenarioSummary(scenario),
    thumbnail: scenarioThumbnails[`../../shared/thumbnails/physics-${scenario.id}.jpg`],
    physicsSpec: scenario.physicsSpec,
    specUrl: publicAssetUrl(scenario.physicsSpec),
  })), initialScenario, onScenarioChange, engine);
  errorMore.addEventListener("click", () => detail.open("engine"));

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
  appendMetric(metrics, "조회 물체", visibleBodyValue);
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

  toolbar.append(statusBadge, runButton, pauseButton, stepButton, resetButton);
  header.append(title, toolbar);
  canvasHud.append(canvasTitle, canvasSignal);
  canvasStack.append(canvas, canvasHud);
  canvasFrame.append(canvasStack, debugControls);
  errorBox.append(errorMessage, errorMore);
  canvasPanel.append(canvasFrame, errorBox);
  selectedPanel.append(selectedTitle, selectedBody);
  trySection.append(actionButtons, hint("캔버스에서 물체를 누르면 그 물체의 상태가 여기에 나옵니다."), selectedPanel,
    fold("재질 값 바꾸기", materialControls));
  sidePanel.append(trySection, watch.element, debugRoot);
  layout.append(detail.sidebar, canvasPanel, sidePanel);
  shell.append(layout, detail.code);
  mountStageColumn(canvasPanel, header, detail.pager);
  detail.attachHead(header);
  app.replaceChildren(shell);
  shell.inert = true;

  return {
    destroy: () => { detail.destroy(); shell.remove(); },
    ready: () => { shell.inert = false; },
    canvas,
    debugRoot,
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
      errorMessage.textContent = "";
    },
    setScenario(scenario, spec, world, nextDebugOptions) {
      Object.assign(debugOptions, nextDebugOptions);
      detail.select(scenario.id);
      canvasTitle.textContent = scenarioTitle(scenario);
      fixtureValue.textContent = scenario.physicsSpec;
      gravityValue.textContent = formatVector(spec.gravityX, spec.gravityY);
      stepValue.textContent = formatStepSeconds(spec.solver.stepSeconds);
      solverValue.textContent = `${spec.solver.velocityIterations}v / ${spec.solver.positionIterations}p`;
      materialValue.textContent = formatCount(Object.keys(spec.materials).length);
      layerValue.textContent = formatCount(Object.keys(spec.layers).length);
      bodyValue.textContent = formatCount(world.bodyCount);
      jointValue.textContent = formatCount(world.jointCount);
      watch.set(scenarioFocus(scenario));
      applyDebugControlAvailability(scenario, spec, debugOptions, debugControlInputs, debugControlLabels);
    },
    setRuntimeMetrics(metrics) {
      bodyValue.textContent = formatCount(metrics.bodyCount);
      visibleBodyValue.textContent = formatCount(metrics.visibleBodyCount);
      jointValue.textContent = formatCount(metrics.jointCount);
      contactValue.textContent = formatCount(metrics.contactCount);
      queryValue.textContent = formatCount(metrics.queryHitCount);
      lineValue.textContent = `${formatCount(metrics.debugLineCount)} (+${formatCount(metrics.customDebugLineCount)} gizmo)`;
      fpsValue.textContent = metrics.fps.toFixed(1);
      frameValue.textContent = formatCount(metrics.frameCount);
      commandValue.textContent = `${formatCount(metrics.renderCommandCount)} / text ${formatCount(metrics.worldTextCount)}`;
      canvasSignal.textContent = `접촉 ${formatCount(metrics.contactCount)} / 쿼리 ${formatCount(metrics.queryHitCount)}`;
    },
    setActions(actions) {
      actionButtons.replaceChildren(...actions.map((action) => {
        const button = createRuntimeDemoButton(actionLabel(action), () => onAction(action.id));
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
      selectedPanel.hidden = !report;
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
      // One line under the stage; the code and message are in "더 보기 › 엔진 수치".
      const report = diagnosticReport(error);
      diagnostics.replaceChildren();
      for (const [label, value] of runtimeDemoDiagnosticRows(report)) {
        appendMetric(diagnostics, label, createTextValue(value));
      }
      errorBlock.hidden = false;
      errorMessage.textContent = `실행이 멈췄습니다 · ${report.message}`;
      errorMessage.title = report.message;
      errorBox.hidden = false;
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

async function loadJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-cache", signal });
  if (!response.ok) {
    throw new Error(`Asset load failed: ${response.status} ${response.statusText} (${url})`);
  }
  return await response.json() as T;
}

async function loadCatalog(signal: AbortSignal): Promise<PhysicsShowcaseCatalog> {
  const catalog = await loadJson<PhysicsShowcaseCatalog>(publicAssetUrl(CATALOG_PATH), signal);
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
  const runtimeMaterial: NonNullable<Parameters<FerrumEngine["spawnRigidBody"]>[0]["material"]> = {
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
  const lifetime = createExampleLifetime();
  try {
    await initializeSandbox(lifetime);
  } catch (error) {
    const cancelled = lifetime.disposed;
    lifetime.dispose();
    if (!cancelled) throw error;
  }
}

async function initializeSandbox(lifetime: ReturnType<typeof createExampleLifetime>): Promise<void> {
  const searchParams = new URLSearchParams(window.location.search);
  const environment: FerrumRuntimeOptions["environment"] = searchParams.get("environment") === "production"
    ? "production"
    : "development";
  const preserveDrawingBuffer = searchParams.get("preserveDrawingBuffer") === "true";
  const profilerSmoke = searchParams.get("profilerSmoke") === "true";
  const physicsDebugLinesEnabled = searchParams.get("physicsDebugLines") !== "false";
  const catalog = await loadCatalog(lifetime.signal);
  lifetime.check();
  const initialScenario = scenarioById(catalog, searchParams.get("demo") ?? DEFAULT_SCENARIO_ID);
  let debugOptions: PhysicsDebugOptions = physicsDebugLinesEnabled
    ? {
        ...DEFAULT_DEBUG_OPTIONS,
        ...initialScenario.defaultDebug,
        broadphase: searchParams.get("broadphase") === "true" || initialScenario.defaultDebug?.broadphase === true,
      }
    : {};

  let runtime: FerrumRuntime | undefined;
  let scenarioView: DataSceneView | undefined;
  let currentWorld: PhysicsWorldApplyResult | undefined;
  let currentSpec: ResolvedPhysicsSpec | undefined;
  let currentScenario = initialScenario;
  let currentFramePhysicsState: FramePhysicsState = EMPTY_FRAME_PHYSICS_STATE;
  let paused = false;
  let stepQueued = false;
  let frameCount = 0;
  let physicsStepError: string | undefined;
  let selectedBodyId: string | undefined;
  let queryTarget: Point2 | undefined = queryTargetFromScenario(initialScenario);
  const debugGizmoWriter = new DebugGizmoLineBufferWriter();
  const sleepingLabels = new Map<string, string>();
  let scenarioRequest: AbortController | undefined;
  lifetime.own(() => scenarioRequest?.abort());

  const shell = createShell(
    catalog.scenarios,
    initialScenario.id,
    (id) => {
      // Keep the address shareable: ?demo= follows the chosen scenario.
      const url = new URL(location.href);
      url.searchParams.set("demo", id);
      history.replaceState(history.state, "", url);
      void loadScenario(id).catch(() => {}); // loadScenario presents current-request errors.
    },
    () => {
      void loadScenario(currentScenario.id).catch(() => {});
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
      void runScenarioAction(id).catch(error => {
        if (!lifetime.disposed) shell.setError(error);
      });
    },
    (materialId, field, value) => {
      updateMaterialValue(materialId, field, value);
    },
    (options) => {
      debugOptions = { ...options };
      runtime?.engine.setPhysicsDebugLinesEnabled(debugOptions);
      refreshWorldTextLabels();
    },
    debugOptions,
  );
  lifetime.own(() => shell.destroy());

  shell.canvas.addEventListener("pointermove", (event) => {
    if (scenarioView) queryTarget = scenarioView.pointerToWorld({ x: event.clientX, y: event.clientY });
  }, { signal: lifetime.signal });
  shell.canvas.addEventListener("click", (event) => {
    if (!scenarioView) return;
    const point = scenarioView.pointerToWorld({ x: event.clientX, y: event.clientY });
    const hit = runtime?.engine.queryNearestBody({ x: point.x, y: point.y, maxDistance: 54 });
    selectedBodyId = hit === undefined ? undefined : currentFramePhysicsState.bodyIdsByEntityKey.get(
      entityKey({ entityId: hit.entityId, entityGeneration: hit.entityGeneration }),
    );
    refreshWorldTextLabels();
    shell.setSelectedBody(selectedBodyReport(currentScenario, currentSpec, currentFramePhysicsState, selectedBodyId));
  }, { signal: lifetime.signal });

  function refreshWorldTextLabels(): void {
    if (!runtime || !currentWorld || !currentSpec) return;
    syncScenarioWorldTexts(
      runtime.engine,
      currentScenario,
      currentSpec,
      currentWorld,
      currentFramePhysicsState,
      selectedBodyId,
      debugOptions,
      sleepingLabels,
    );
  }

  async function loadScenario(id: string): Promise<void> {
    lifetime.check();
    const scenario = scenarioById(catalog, id);
    if (!runtime) {
      throw new Error("Physics runtime is not ready.");
    }
    scenarioRequest?.abort();
    const request = new AbortController();
    scenarioRequest = request;
    try {
      shell.setStatus("loading");
      (window as SandboxWindow).ferrumPhysicsSandboxSmokeFrame = undefined;
      const rawSpec = await loadJson<PhysicsSpec>(publicAssetUrl(scenario.physicsSpec), request.signal);
      if (request.signal.aborted || lifetime.disposed) return;
      const resolved = resolvePhysicsSpec(rawSpec, { path: "physics" });
      currentWorld = createPhysicsWorldFromSpec(runtime.engine, resolved, {
        replace: currentWorld,
        onWarning: (warning) => {
          console.warn(warning.message);
        },
      });
      currentSpec = resolved;
      currentScenario = scenario;
      const camera = cameraForScenario(scenario);
      scenarioView = createDataSceneView(runtime.engine, runtime.renderer, shell.canvas, {
        x: camera.x + camera.width / 2,
        y: camera.y + camera.height / 2,
        pixelPerfect: { width: camera.width, height: camera.height, snap: false },
      });
      currentFramePhysicsState = EMPTY_FRAME_PHYSICS_STATE;
      selectedBodyId = scenario.focusBodies?.find((bodyId) => currentWorld?.bodies[bodyId] !== undefined)
        ?? Object.keys(currentWorld.bodies)[0];
      queryTarget = queryTargetFromScenario(scenario);
      frameCount = 0;
      debugOptions = physicsDebugLinesEnabled
        ? sanitizeDebugOptionsForScenario(
            scenario,
            resolved,
            { ...DEFAULT_DEBUG_OPTIONS, ...scenario.defaultDebug },
          )
        : {};
      runtime.engine.setPhysicsDebugLinesEnabled(debugOptions);
      refreshWorldTextLabels();
      shell.setScenario(scenario, resolved, currentWorld, debugOptions);
      shell.setActions(scenario.controls?.actions ?? []);
      shell.setMaterialControls(materialControlEntries(resolved));
      shell.setWarnings(currentWorld.warnings);
      shell.setEvents([]);
      shell.setSelectedBody(undefined);
      physicsStepError = undefined;
      paused = false;
      shell.setPaused(false);
      shell.setStatus("running");
    } catch (error) {
      if (request.signal.aborted || lifetime.disposed) return;
      console.error("Ferrum2D physics showcase scenario load failed", error);
      shell.setError(error);
      throw error;
    } finally {
      if (scenarioRequest === request) scenarioRequest = undefined;
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
    physicsDebugLines: physicsDebugLinesEnabled ? debugOptions : false,
    physicsDebugLineComposer: physicsDebugLinesEnabled
      ? (baseLines) => composePhysicsSandboxDebugLines(
          debugGizmoWriter,
          baseLines,
          currentScenario,
          currentFramePhysicsState,
          selectedBodyId,
          queryTarget,
          debugOptions,
        )
      : undefined,
    physicsMode: "rigid",
    profiler: profilerSmoke,
    environment,
    autostart: false,
    webgl2: { clearColor: [0.05, 0.07, 0.06, 1], preserveDrawingBuffer },
    engine: {
      enablePhysicsDebugLines: physicsDebugLinesEnabled ? debugOptions : false,
      includePhysicsDebugLines: physicsDebugLinesEnabled,
      physicsDebugOptions: debugOptions,
    },
    onFrame: ({ frame, rendererStats, fps }) => {
      frameCount += 1;
      const consumedStep = stepQueued;
      if (currentWorld && (!paused || stepQueued)) {
        try {
          runtime?.engine.stepRigidBodies(currentWorld.stepSeconds, currentWorld.stepOptions);
          stepQueued = false;
          if (consumedStep && paused) {
            shell.setStatus("paused");
          }
        } catch (error) {
          // A rejected native step stops this world. Show the error instead of a stale
          // "running" state; reset or another scenario rebuilds the world.
          paused = true;
          stepQueued = false;
          shell.setPaused(true);
          shell.setError(error);
          physicsStepError = error instanceof Error ? error.message : String(error);
        }
      }

      currentFramePhysicsState = capturePhysicsFrameState(
        runtime?.engine,
        currentWorld,
        currentScenario,
        queryTarget,
      );
      if (runtime && currentWorld && currentSpec) {
        updateSleepingWorldTexts(
          runtime.engine,
          currentScenario,
          currentSpec,
          currentWorld,
          currentFramePhysicsState,
          debugOptions,
          sleepingLabels,
        );
      }

      const debugLineCount = rendererStats.physicsDebugLineCount || frame.physicsDebugLineBuffer.lineCount;
      const customDebugLineCount = Math.max(
        0,
        debugGizmoWriter.bufferView().lineCount - frame.physicsDebugLineBuffer.lineCount,
      );
      const worldTextCount = runtime?.engine.worldTextCount() ?? 0;
      const metrics: SandboxRuntimeMetrics = {
        bodyCount: currentWorld?.bodyCount ?? 0,
        jointCount: currentWorld?.jointCount ?? 0,
        debugLineCount,
        customDebugLineCount,
        worldTextCount,
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
        pointerWorld: queryTarget,
        bodyCount: metrics.bodyCount,
        jointCount: metrics.jointCount,
        warningCount: currentWorld?.warningCount ?? 0,
        entityCount: frame.entityCount,
        renderCommandCount: rendererStats.renderCommandCount,
        physicsDebugLineCount: debugLineCount,
        customDebugLineCount,
        worldTextCount,
        fixedStepSeconds: currentSpec?.solver.stepSeconds ?? 0,
        frameCount,
        visibleBodyCount: metrics.visibleBodyCount,
        contactCount: metrics.contactCount,
        manifoldCount: metrics.manifoldCount,
        impulseCount: metrics.impulseCount,
        queryHitCount: metrics.queryHitCount,
        ...(physicsStepError === undefined ? {} : { physicsStepError }),
      };
    },
  });

  // A manually stepped physics lab uses an empty, paused Data Scene. This removes
  // the unrelated built-in Shooter actor and avoids a second automatic solver step.
  lifetime.own(() => runtime?.destroy());
  runtime.engine.useDataScene();
  runtime.engine.pauseDataScene();
  await runtime.renderer.loadTexture(0, new URL("../../shared/solid-white.png", import.meta.url).href, { signal: lifetime.signal });
  lifetime.check();

  const sandboxWindow = window as SandboxWindow;
  sandboxWindow.ferrumEngine = runtime.engine;
  sandboxWindow.ferrumRuntime = runtime;
  sandboxWindow.ferrumPhysicsSandboxLoadDemo = loadScenario;
  lifetime.own(() => {
    if (sandboxWindow.ferrumRuntime !== runtime) return;
    delete sandboxWindow.ferrumEngine;
    delete sandboxWindow.ferrumRuntime;
    delete sandboxWindow.ferrumPhysicsSandboxLoadDemo;
    delete sandboxWindow.ferrumPhysicsSandboxSmokeFrame;
  });

  await runtime.engine.loadBitmapFont(DEBUG_FONT_ID, {
    image: publicAssetUrl("assets/debug-font.png"),
    data: DEBUG_FONT_ATLAS,
    family: "Ferrum Debug",
  });
  lifetime.check();
  await loadScenario(initialScenario.id);
  lifetime.ready();
  shell.ready();
  runtime.start();
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

function composePhysicsSandboxDebugLines(
  writer: DebugGizmoLineBufferWriter,
  baseLines: PhysicsDebugLineBufferView,
  scenario: PhysicsScenarioEntry,
  frameState: FramePhysicsState,
  selectedBodyId: string | undefined,
  queryTarget: Point2 | undefined,
  debugOptions: PhysicsDebugOptions,
): PhysicsDebugLineBufferView {
  writer.reset().appendBuffer(baseLines);

  if (scenario.query) {
    const origin = { x: scenario.query.origin[0], y: scenario.query.origin[1] };
    const target = queryTarget ?? { x: scenario.query.target[0], y: scenario.query.target[1] };
    writer
      .arrow(origin, target, QUERY_COLOR, { headLength: 14 })
      .circle(origin, 5, QUERY_COLOR, 12);
    for (const hit of frameState.rayHits.slice(0, 4)) {
      const point = { x: hit.pointX, y: hit.pointY };
      writer
        .circle(point, 5, QUERY_HIT_COLOR, 12)
        .arrow(point, {
          x: point.x + hit.normalX * 24,
          y: point.y + hit.normalY * 24,
        }, QUERY_HIT_COLOR, { headLength: 6 });
    }
  }

  if (debugOptions.colliders) {
    for (const [bodyId, state] of frameState.bodyStatesById) {
      const isFocused = scenario.focusBodies?.includes(bodyId) === true;
      const isSelected = bodyId === selectedBodyId;
      if (state.bodyType !== "static" && (isFocused || isSelected)) {
        const speed = Math.hypot(state.velocityX, state.velocityY);
        if (speed >= 0.1) {
          const scale = Math.min(0.18, 42 / speed);
          writer.arrow(
            { x: state.x, y: state.y },
            {
              x: state.x + state.velocityX * scale,
              y: state.y + state.velocityY * scale,
            },
            VELOCITY_COLOR,
          );
        }
      }
      if (isSelected) {
        writer.circle({ x: state.x, y: state.y }, 30, SELECTION_COLOR, 24);
      }
    }
  }

  return writer.bufferView();
}

function syncScenarioWorldTexts(
  engine: FerrumEngine,
  scenario: PhysicsScenarioEntry,
  spec: ResolvedPhysicsSpec,
  world: PhysicsWorldApplyResult,
  frameState: FramePhysicsState,
  selectedBodyId: string | undefined,
  debugOptions: PhysicsDebugOptions,
  sleepingLabels: Map<string, string>,
): void {
  engine.clearWorldTexts();
  sleepingLabels.clear();
  for (const [index, body] of Object.values(spec.bodies).entries()) {
    const handle = world.bodies[body.id];
    if (!handle) continue;
    const isSelected = body.id === selectedBodyId;
    if (shouldLabelBody(scenario, body, isSelected)) {
      engine.setWorldText(BODY_LABEL_TEXT_ID_BASE + index, {
        fontId: DEBUG_FONT_ID,
        text: debugBodyLabel(scenario, body, isSelected),
        x: 0,
        y: debugBodyLabelOffsetY(scenario, body),
        scale: 0.75,
        color: debugBodyLabelColor(body, isSelected),
        alignment: "center",
        renderLayer: 100,
        anchor: handle,
      });
    }
    const state = frameState.bodyStatesById.get(body.id);
    if (debugOptions.sleeping && body.type !== "static" && body.canSleep && state) {
      setSleepingWorldText(engine, SLEEP_LABEL_TEXT_ID_BASE + index, body.id, handle, state, sleepingLabels,
        debugStatusLabelOffsetY(scenario, body));
    }
  }
}

function updateSleepingWorldTexts(
  engine: FerrumEngine,
  scenario: PhysicsScenarioEntry | undefined,
  spec: ResolvedPhysicsSpec,
  world: PhysicsWorldApplyResult,
  frameState: FramePhysicsState,
  debugOptions: PhysicsDebugOptions,
  sleepingLabels: Map<string, string>,
): void {
  if (!debugOptions.sleeping) return;
  for (const [index, body] of Object.values(spec.bodies).entries()) {
    if (body.type === "static" || !body.canSleep) continue;
    const handle = world.bodies[body.id];
    const state = frameState.bodyStatesById.get(body.id);
    if (!handle || !state) continue;
    setSleepingWorldText(engine, SLEEP_LABEL_TEXT_ID_BASE + index, body.id, handle, state, sleepingLabels,
      debugStatusLabelOffsetY(scenario, body));
  }
}

function setSleepingWorldText(
  engine: FerrumEngine,
  textId: number,
  bodyId: string,
  handle: PhysicsEntityHandle,
  state: PhysicsEntitySnapshot,
  sleepingLabels: Map<string, string>,
  offsetY: number,
): void {
  const status = sleepingWorldTextStatus(state);
  if (sleepingLabels.get(bodyId) === status.text) return;
  if (engine.setWorldText(textId, {
    fontId: DEBUG_FONT_ID,
    text: status.text,
    x: 0,
    y: offsetY,
    scale: 0.65,
    color: status.color,
    alignment: "center",
    renderLayer: 101,
    anchor: handle,
  })) {
    sleepingLabels.set(bodyId, status.text);
  }
}

function sleepingWorldTextStatus(
  state: PhysicsEntitySnapshot,
): { text: string; color: readonly [number, number, number, number] } {
  if (state.isSleeping) {
    return { text: "SLEEP", color: [0.59, 0.84, 1, 1] };
  }
  const sleepReady = Math.hypot(state.velocityX, state.velocityY) <= 0.05
    && Math.abs(state.angularVelocityRadiansPerSecond) <= 0.05;
  return sleepReady
    ? { text: "READY", color: [0.47, 0.66, 1, 1] }
    : { text: "ACTIVE", color: [0.94, 0.72, 0.37, 1] };
}

function debugBodyLabel(
  scenario: PhysicsScenarioEntry,
  body: ResolvedPhysicsBodySpec,
  selected: boolean,
): string {
  const label = scenario.bodyStyles?.[body.id]?.label ?? body.id;
  return `${selected ? "> " : ""}${label}`.toUpperCase();
}

function debugBodyLabelColor(
  body: ResolvedPhysicsBodySpec,
  selected: boolean,
): readonly [number, number, number, number] {
  if (selected) return SELECTION_COLOR;
  if (body.type === "static") return [0.8, 0.86, 0.82, 1];
  if (body.type === "kinematic") return [0.47, 0.66, 1, 1];
  return [0.45, 0.86, 0.62, 1];
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

/** Alternate label heights by focus order; neighbouring focus bodies otherwise overlap. */
function staggeredFocus(scenario: PhysicsScenarioEntry | undefined, body: ResolvedPhysicsBodySpec): boolean {
  const order = scenario?.focusBodies?.indexOf(body.id) ?? -1;
  return order % 2 === 1;
}

function debugBodyLabelOffsetY(scenario: PhysicsScenarioEntry, body: ResolvedPhysicsBodySpec): number {
  return staggeredFocus(scenario, body) ? -52 : -36;
}

function debugStatusLabelOffsetY(scenario: PhysicsScenarioEntry | undefined, body: ResolvedPhysicsBodySpec): number {
  return staggeredFocus(scenario, body) ? 26 : 12;
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


// Display names come from the catalog shared with the feature lab's physics topic,
// so a scenario has one name everywhere. The local catalog keeps specs and details.
const SHARED_SCENARIO_TITLES: ReadonlyMap<string, string> = new Map(sharedScenarios.map((entry) => [entry.id, entry.title]));

function scenarioTitle(scenario: PhysicsScenarioEntry): string {
  return SHARED_SCENARIO_TITLES.get(scenario.id) ?? scenario.title;
}

function scenarioSummary(scenario: PhysicsScenarioEntry): string {
  return scenario.summaryKo ?? scenario.summary;
}

function scenarioFocus(scenario: PhysicsScenarioEntry): readonly string[] {
  return scenario.focusKo ?? scenario.focus;
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

void bootstrap().catch((error) => renderRuntimeDemoError(error, {
  title: "Ferrum2D 물리 쇼케이스 Lab",
  className: "error-shell",
  diagnosticReport,
}));
