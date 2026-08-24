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
  let frameProperty = options.frameProperty;
  let removeBeforeUnload: (() => void) | undefined;

  const shell = document.createElement("main");
  const toolbar = document.createElement("section");
  const title = document.createElement("h1");
  const actions = document.createElement("div");
  const stageLayout = document.createElement("section");
  const stage = document.createElement("div");
  const canvas = document.createElement("canvas");
  const metrics = document.createElement("dl");
  const debugRoot = document.createElement("div");

  shell.className = "demo-shell";
  toolbar.className = "demo-toolbar";
  actions.className = "demo-actions";
  stageLayout.className = "demo-stage-layout";
  stage.className = "demo-stage";
  canvas.className = "demo-canvas";
  metrics.className = "demo-metrics";
  debugRoot.className = "demo-debug-root";

  title.textContent = options.title;
  canvas.width = options.canvasWidth ?? 800;
  canvas.height = options.canvasHeight ?? 480;

  if (controls.start) {
    actions.append(createRuntimeDemoButton("Start", () => {
      if (runtime?.engine.gameState() === 2) {
        restartQueued = true;
      } else {
        startQueued = true;
      }
    }));
  }
  if (controls.reset) {
    actions.append(createRuntimeDemoButton("Reset", () => runtime?.engine.resetGame()));
  }
  if (controls.pause) {
    actions.append(createRuntimeDemoButton("Pause", () => runtime?.pause()));
  }
  if (controls.resume) {
    actions.append(createRuntimeDemoButton("Resume", () => runtime?.resume()));
  }

  for (const metric of options.metrics ?? DEFAULT_METRICS) {
    appendMetric(metrics, metric);
  }
  writeMetricValues(report);

  toolbar.append(title, actions);
  stage.append(canvas);
  stageLayout.append(stage, metrics);
  shell.append(toolbar, stageLayout, debugRoot);
  app.replaceChildren(shell);

  return {
    canvas,
    stage,
    debugRoot,
    attachRuntime(nextRuntime) {
      removeBeforeUnload?.();
      removeBeforeUnload = undefined;
      if (runtime !== undefined && runtime !== nextRuntime) {
        destroyRuntime();
      }
      runtime = nextRuntime;
      const onBeforeUnload = (): void => destroyRuntime();
      window.addEventListener("beforeunload", onBeforeUnload);
      removeBeforeUnload = () => window.removeEventListener("beforeunload", onBeforeUnload);
      exposeSmokeHooks(nextRuntime);
    },
    queueStart() {
      startQueued = true;
    },
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
        dialog: report.state === "Title"
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
      removeBeforeUnload?.();
      removeBeforeUnload = undefined;
      destroyRuntime();
    },
  };

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
    writeMetric("state", nextReport.state);
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

export function cleanupRuntimeDemoResources(cleanups: Array<() => void>): void {
  for (const cleanup of cleanups.splice(0).reverse()) {
    try {
      cleanup();
    } catch (error) {
      console.warn("Ferrum2D cleanup failed", error);
    }
  }
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
