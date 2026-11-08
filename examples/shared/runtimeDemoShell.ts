import { createExampleHeader } from "./exampleHeader";
export { cleanupRuntimeDemoResources } from "./exampleLifetime";

export interface RuntimeDemoFrameReport {
  state: string;
  entityCount: number;
  renderCommandCount: number;
  drawCalls: number;
  fps: number;
}

export interface RuntimeDemoFrame {
  frame: {
    gameState: number;
    entityCount: number;
  };
  rendererStats: {
    renderCommandCount: number;
    drawCalls: number;
  };
  fps: number;
}

export interface RuntimeDemoInputSnapshot {
  enter?: boolean;
  space?: boolean;
}

export interface RuntimeDemoRuntime {
  input?: { clear(): void };
  engine: {
    gameState(): number;
    resetGame(): void;
  };
  pause(): void;
  resume(): void;
  destroy(): void;
}

export type RuntimeDemoUiOverlayRegion = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
export type RuntimeDemoUiOverlayTone = "default" | "muted" | "accent" | "danger";
export type RuntimeDemoUiOverlayActionTone = "default" | "primary" | "danger";

export interface RuntimeDemoUiOverlayState {
  panels?: readonly RuntimeDemoUiPanel[];
  dialog?: RuntimeDemoUiDialog;
}

export interface RuntimeDemoUiPanel {
  id: string;
  title?: string;
  region?: RuntimeDemoUiOverlayRegion;
  lines?: readonly RuntimeDemoUiTextLine[];
  actions?: readonly RuntimeDemoUiAction[];
}

export interface RuntimeDemoUiTextLine {
  id?: string;
  label?: string;
  value?: string | number;
  text?: string;
  tone?: RuntimeDemoUiOverlayTone;
}

export interface RuntimeDemoUiDialog {
  id: string;
  title: string;
  body?: string;
  actions?: readonly RuntimeDemoUiAction[];
}

export interface RuntimeDemoUiAction {
  id: string;
  label: string;
  tone?: RuntimeDemoUiOverlayActionTone;
}

export interface RuntimeDemoShellOptions {
  title: string;
  exampleId?: string;
  locale?: "en" | "ko";
  /** Reapply example-specific bindings once the native reset reaches Playing. */
  afterReset?: () => void;
  root?: string | HTMLElement;
  canvasWidth?: number;
  canvasHeight?: number;
  frameProperty?: string;
  gameStateLabel?: (code: number) => string;
  metrics?: readonly RuntimeDemoMetric[];
  controls?: false | RuntimeDemoControls;
}

export interface RuntimeDemoMetric {
  key: string;
  label: string;
  initialValue?: string;
}

export interface RuntimeDemoControls {
  start?: boolean;
  reset?: boolean;
  pause?: boolean;
  resume?: boolean;
}

export interface RuntimeDemoShell {
  canvas: HTMLCanvasElement;
  stage: HTMLElement;
  debugRoot: HTMLElement;
  attachRuntime(runtime: RuntimeDemoRuntime): void;
  queueStart(): void;
  inputTransform<T extends RuntimeDemoInputSnapshot>(snapshot: T): T;
  updateFrame(frame: RuntimeDemoFrame): RuntimeDemoFrameReport;
  setMetric(key: string, value: string | number): void;
  uiState(): RuntimeDemoUiOverlayState;
  destroy(): void;
}

export interface RuntimeDemoDiagnosticContext {
  kind: string;
  name?: string;
  id?: string | number;
  url?: string;
  path?: string;
  detail: string;
}

export interface RuntimeDemoDiagnosticReport {
  code: string;
  message: string;
  context?: RuntimeDemoDiagnosticContext;
}

export interface RuntimeDemoErrorOptions {
  title: string;
  root?: string | HTMLElement;
  summary?: string;
  className?: string;
  diagnosticReport?: (error: unknown) => RuntimeDemoDiagnosticReport;
}

const DEFAULT_REPORT: RuntimeDemoFrameReport = {
  state: "Title",
  entityCount: 0,
  renderCommandCount: 0,
  drawCalls: 0,
  fps: 0,
};

const DEFAULT_METRICS: readonly RuntimeDemoMetric[] = [
  { key: "state", label: "state" },
  { key: "entityCount", label: "entities" },
  { key: "renderCommandCount", label: "commands" },
  { key: "drawCalls", label: "draw calls" },
  { key: "fps", label: "fps" },
];

const DEFAULT_CONTROLS: Required<RuntimeDemoControls> = {
  start: true,
  reset: true,
  pause: true,
  resume: true,
};

export function createRuntimeDemoShell(options: RuntimeDemoShellOptions): RuntimeDemoShell {
  const app = resolveRoot(options.root);
  const report: RuntimeDemoFrameReport = { ...DEFAULT_REPORT };
  const metricValues: Record<string, HTMLElement> = {};
  const controls = options.controls === false
    ? { start: false, reset: false, pause: false, resume: false }
    : { ...DEFAULT_CONTROLS, ...options.controls };
  let runtime: RuntimeDemoRuntime | undefined;
  let startQueued = false;
  let restartQueued = false;
  let resetPending = false;
  let frameProperty = options.frameProperty;
  let removePageHide: (() => void) | undefined;
  let paused = false;
  let nativeState = 0;
  const lifetime = new AbortController();
  const buttons = new Map<keyof RuntimeDemoControls, HTMLButtonElement>();
  const text = options.locale === "ko"
    ? { start: "시작", retry: "다시 시작", reset: "처음부터", pause: "일시정지", resume: "계속하기", ready: "준비", playing: "실행 중", paused: "일시정지", ended: "실험 종료", loading: "준비 중" }
    : { start: "Start", retry: "Try again", reset: "Reset", pause: "Pause", resume: "Resume", ready: "Ready", playing: "Running", paused: "Paused", ended: "Finished", loading: "Loading" };

  const shell = document.createElement("main");
  const toolbar = document.createElement("section");
  const title = document.createElement("h1");
  const actions = document.createElement("div");
  const playbackStatus = document.createElement("span");
  const stageLayout = document.createElement("section");
  const stage = document.createElement("div");
  const canvas = document.createElement("canvas");
  const metrics = document.createElement("dl");
  const debugRoot = document.createElement("div");

  shell.className = "demo-shell";
  if (options.exampleId) shell.append(createExampleHeader(options.exampleId));
  toolbar.className = "demo-toolbar";
  actions.className = "demo-actions";
  actions.setAttribute("role", "group");
  actions.setAttribute("aria-label", options.locale === "ko" ? "실험 재생 조작" : "Playback controls");
  playbackStatus.className = "demo-playback-status";
  playbackStatus.setAttribute("role", "status");
  playbackStatus.setAttribute("aria-live", "polite");
  stageLayout.className = "demo-stage-layout";
  stage.className = "demo-stage";
  canvas.className = "demo-canvas";
  metrics.className = "demo-metrics";
  debugRoot.className = "demo-debug-root";

  title.textContent = options.title;
  canvas.tabIndex = 0;
  canvas.width = options.canvasWidth ?? 800;
  canvas.height = options.canvasHeight ?? 480;

  const addControl = (key: keyof RuntimeDemoControls, label: string, action: () => void): void => {
    if (!controls[key]) return;
    const button = createRuntimeDemoButton(label, action);
    button.dataset.demoControl = key;
    buttons.set(key, button);
    actions.append(button);
  };
  addControl("start", text.start, requestStart);
  addControl("reset", text.reset, () => {
    if (!runtime) return;
    runtime.input?.clear();
    startQueued = restartQueued = false;
    runtime.engine.resetGame();
    nativeState = runtime.engine.gameState();
    resetPending = nativeState !== 1;
    if (!resetPending) options.afterReset?.();
    // Built-in reset preserves phase: GameOver needs a Space edge; Title needs Enter.
    if (nativeState !== 1) requestStart();
    setPaused(false);
    canvas.focus({ preventScroll: true });
  });
  addControl("pause", text.pause, () => setPaused(true));
  addControl("resume", text.resume, () => setPaused(false));
  updatePlayback();
  if (controls.pause && controls.resume) {
    window.addEventListener("keydown", event => {
      if (event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.target instanceof HTMLElement && event.target.closest("input,select,textarea,[contenteditable=true]")) return;
      if (nativeState === 1 && (event.code === "KeyP" || event.code === "Escape")) {
        event.preventDefault(); setPaused(!paused);
      }
    }, { signal: lifetime.signal });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && nativeState === 1) setPaused(true);
    }, { signal: lifetime.signal });
  }

  for (const metric of options.metrics ?? DEFAULT_METRICS) {
    appendMetric(metrics, metric);
  }
  writeMetricValues(report);

  toolbar.append(title);
  if (buttons.size > 0) toolbar.append(playbackStatus);
  // Specialized hosts mount history/file/playback controls here even when the
  // built-in controls are disabled. Preserve this extension point.
  toolbar.append(actions);
  stage.append(canvas);
  stageLayout.append(stage, metrics);
  shell.append(toolbar, stageLayout, debugRoot);
  app.replaceChildren(shell);

  return {
    canvas,
    stage,
    debugRoot,
    attachRuntime(nextRuntime) {
      removePageHide?.();
      removePageHide = undefined;
      if (runtime !== undefined && runtime !== nextRuntime) {
        destroyRuntime();
      }
      runtime = nextRuntime;
      paused = false;
      nativeState = runtime.engine.gameState();
      updatePlayback();
      const onPageHide = (event: PageTransitionEvent): void => {
        if (!event.persisted) destroyRuntime();
      };
      window.addEventListener("pagehide", onPageHide);
      removePageHide = () => window.removeEventListener("pagehide", onPageHide);
      exposeSmokeHooks(nextRuntime);
    },
    queueStart: requestStart,
    inputTransform(snapshot) {
      if (startQueued) {
        startQueued = false;
        return { ...snapshot, enter: true };
      }
      if (restartQueued) {
        restartQueued = false;
        return { ...snapshot, space: true };
      }
      return snapshot;
    },
    updateFrame(frame) {
      const previousNativeState = nativeState;
      nativeState = frame.frame.gameState;
      if (nativeState === 1 && (resetPending || previousNativeState === 2)) {
        resetPending = false;
        options.afterReset?.();
      }
      updatePlayback();
      report.state = gameStateLabel(frame.frame.gameState, options.gameStateLabel);
      report.entityCount = frame.frame.entityCount;
      report.renderCommandCount = frame.rendererStats.renderCommandCount;
      report.drawCalls = frame.rendererStats.drawCalls;
      report.fps = frame.fps;
      writeMetricValues(report);
      publishFrameReport();
      return { ...report };
    },
    setMetric(key, value) {
      writeMetric(key, String(value));
    },
    uiState() {
      return {
        panels: [{
          id: "runtime",
          title: "Runtime",
          region: "top-left",
          lines: [
            { id: "state", label: "State", value: report.state },
            { id: "entities", label: "Entities", value: report.entityCount },
            { id: "commands", label: "Commands", value: report.renderCommandCount },
            { id: "drawCalls", label: "Draws", value: report.drawCalls },
            { id: "fps", label: "FPS", value: report.fps.toFixed(1), tone: "accent" },
          ],
        }],
        dialog: nativeState === 0
          ? {
            id: "title",
            title: "Ready",
            body: "Ready.",
            actions: [{ id: "start", label: "Start", tone: "primary" }],
          }
          : undefined,
      };
    },
    destroy() {
      lifetime.abort();
      removePageHide?.();
      removePageHide = undefined;
      destroyRuntime();
    },
  };

  function requestStart(): void {
    if (!runtime) { startQueued = true; return; }
    nativeState = runtime.engine.gameState();
    if (paused) setPaused(false);
    startQueued = nativeState === 0;
    restartQueued = nativeState === 2;
    if (restartQueued) resetPending = true;
    runtime.input?.clear();
    canvas.focus({ preventScroll: true });
  }

  function setPaused(value: boolean): void {
    if (!runtime) return;
    runtime.input?.clear();
    paused = value;
    if (value) runtime.pause(); else runtime.resume();
    updatePlayback();
    if (!value) canvas.focus({ preventScroll: true });
  }

  function updatePlayback(): void {
    if (buttons.size === 0) return;
    const phase = !runtime ? "loading" : paused ? "paused" : nativeState === 1 ? "playing" : nativeState === 2 ? "ended" : "ready";
    shell.dataset.playback = phase;
    if (playbackStatus.textContent !== text[phase]) playbackStatus.textContent = text[phase];
    writeMetric("state", paused ? text.paused : report.state);
    for (const [key, button] of buttons) {
      button.disabled = runtime === undefined;
      button.hidden = key === "start" ? nativeState === 1 : key === "pause" ? paused || nativeState !== 1 : key === "resume" ? !paused : false;
      if (key === "start") button.textContent = nativeState === 2 ? text.retry : text.start;
    }
  }

  function appendMetric(parent: HTMLElement, metric: RuntimeDemoMetric): void {
    const item = document.createElement("div");
    const term = document.createElement("dt");
    const value = document.createElement("dd");
    item.className = "demo-metric";
    term.textContent = metric.label;
    value.textContent = metric.initialValue ?? "-";
    item.append(term, value);
    parent.append(item);
    metricValues[metric.key] = value;
  }

  function writeMetricValues(nextReport: RuntimeDemoFrameReport): void {
    writeMetric("state", paused ? text.paused : nextReport.state);
    writeMetric("entityCount", String(nextReport.entityCount));
    writeMetric("renderCommandCount", String(nextReport.renderCommandCount));
    writeMetric("drawCalls", String(nextReport.drawCalls));
    writeMetric("fps", nextReport.fps.toFixed(1));
  }

  function writeMetric(key: string, value: string): void {
    const element = metricValues[key];
    if (element) element.textContent = value;
  }

  function publishFrameReport(): void {
    if (!frameProperty) return;
    runtimeDemoGlobals()[frameProperty] = { ...report };
  }

  function exposeSmokeHooks(nextRuntime: RuntimeDemoRuntime): void {
    const target = runtimeDemoGlobals();
    target.ferrumRuntime = nextRuntime;
    target.ferrumEngine = nextRuntime.engine;
    frameProperty = frameProperty ?? "ferrumDemoFrame";
    publishFrameReport();
  }

  function destroyRuntime(): void {
    const currentRuntime = runtime;
    runtime = undefined;
    updatePlayback();
    if (currentRuntime === undefined) return;
    const target = runtimeDemoGlobals();
    if (target.ferrumRuntime === currentRuntime) {
      delete target.ferrumRuntime;
      if (target.ferrumEngine === currentRuntime.engine) delete target.ferrumEngine;
      if (frameProperty) delete target[frameProperty];
    }
    currentRuntime.destroy();
  }
}

export function renderRuntimeDemoError(error: unknown, options: RuntimeDemoErrorOptions): void {
  console.error(`${options.title} failed`, error);
  const app = resolveRoot(options.root);
  const report = options.diagnosticReport?.(error);
  const container = document.createElement("main");
  const title = document.createElement("h1");
  const summary = options.summary === undefined ? undefined : document.createElement("p");
  const list = document.createElement("dl");
  container.className = options.className ?? "demo-error-shell";
  title.textContent = options.title;
  if (summary) summary.textContent = options.summary ?? "";

  if (report) {
    appendDiagnosticRows(list, report);
  } else {
    appendDescription(list, "error", error instanceof Error ? error.message : String(error));
  }

  container.append(title);
  if (summary) container.append(summary);
  container.append(list);
  app.replaceChildren(container);
}

function appendDiagnosticRows(list: HTMLElement, report: RuntimeDemoDiagnosticReport): void {
  for (const [label, value] of runtimeDemoDiagnosticRows(report)) {
    appendDescription(list, label, value);
  }
}

export function runtimeDemoDiagnosticRows(report: RuntimeDemoDiagnosticReport): Array<[string, string]> {
  const rows: Array<[string, string]> = [["code", report.code], ["message", report.message]];
  if (!report.context) return rows;
  rows.push(["kind", report.context.kind]);
  if (report.context.name !== undefined) rows.push(["name", report.context.name]);
  if (report.context.id !== undefined) rows.push(["id", String(report.context.id)]);
  if (report.context.url !== undefined) rows.push(["url", report.context.url]);
  if (report.context.path !== undefined) rows.push(["path", report.context.path]);
  rows.push(["detail", report.context.detail]);
  return rows;
}

function appendDescription(list: HTMLElement, label: string, value: string): void {
  const term = document.createElement("dt");
  const description = document.createElement("dd");
  term.textContent = label;
  description.textContent = value;
  list.append(term, description);
}

export function createRuntimeDemoButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function resolveRoot(root: string | HTMLElement | undefined): HTMLElement {
  if (root instanceof HTMLElement) return root;
  const selector = root ?? "#app";
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`Missing demo root element: ${selector}`);
  }
  return element;
}

function gameStateLabel(code: number, customLabel?: (code: number) => string): string {
  if (customLabel) return customLabel(code);
  if (code === 0) return "Title";
  if (code === 1) return "Playing";
  if (code === 2) return "GameOver";
  return `State ${code}`;
}

function runtimeDemoGlobals(): Window & Record<string, unknown> {
  return window as unknown as Window & Record<string, unknown>;
}
