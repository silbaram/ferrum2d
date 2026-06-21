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
}

export interface RuntimeDemoShell {
  canvas: HTMLCanvasElement;
  stage: HTMLElement;
  debugRoot: HTMLElement;
  attachRuntime(runtime: RuntimeDemoRuntime): void;
  queueStart(): void;
  inputTransform<T extends RuntimeDemoInputSnapshot>(snapshot: T): T;
  updateFrame(frame: RuntimeDemoFrame): RuntimeDemoFrameReport;
  uiState(): RuntimeDemoUiOverlayState;
  exposeSmokeHooks(runtime: RuntimeDemoRuntime): void;
  destroy(): void;
}

interface RuntimeDemoDiagnosticContext {
  kind: string;
  name?: string;
  id?: string | number;
  url?: string;
  path?: string;
  detail: string;
}

interface RuntimeDemoDiagnosticReport {
  code: string;
  message: string;
  context?: RuntimeDemoDiagnosticContext;
}

export interface RuntimeDemoErrorOptions {
  title: string;
  root?: string | HTMLElement;
  diagnosticReport?: (error: unknown) => RuntimeDemoDiagnosticReport;
}

type MetricKey = keyof RuntimeDemoFrameReport;

const DEFAULT_REPORT: RuntimeDemoFrameReport = {
  state: "Title",
  entityCount: 0,
  renderCommandCount: 0,
  drawCalls: 0,
  fps: 0,
};

const METRICS: readonly Array<{ key: MetricKey; label: string }> = [
  { key: "state", label: "state" },
  { key: "entityCount", label: "entities" },
  { key: "renderCommandCount", label: "commands" },
  { key: "drawCalls", label: "draw calls" },
  { key: "fps", label: "fps" },
];

export function createRuntimeDemoShell(options: RuntimeDemoShellOptions): RuntimeDemoShell {
  const app = resolveRoot(options.root);
  const report: RuntimeDemoFrameReport = { ...DEFAULT_REPORT };
  const metricValues: Partial<Record<MetricKey, HTMLElement>> = {};
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

  actions.append(
    createButton("Start", () => {
      if (runtime?.engine.gameState() === 2) {
        restartQueued = true;
      } else {
        startQueued = true;
      }
    }),
    createButton("Reset", () => runtime?.engine.resetGame()),
    createButton("Pause", () => runtime?.pause()),
    createButton("Resume", () => runtime?.resume()),
  );

  for (const metric of METRICS) {
    appendMetric(metrics, metric.label, metric.key);
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
      runtime = nextRuntime;
      removeBeforeUnload?.();
      const onBeforeUnload = (): void => nextRuntime.destroy();
      window.addEventListener("beforeunload", onBeforeUnload);
      removeBeforeUnload = () => window.removeEventListener("beforeunload", onBeforeUnload);
      this.exposeSmokeHooks(nextRuntime);
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
    exposeSmokeHooks(nextRuntime) {
      runtime = nextRuntime;
      const target = window as Window & Record<string, unknown>;
      target.ferrumRuntime = nextRuntime;
      target.ferrumEngine = nextRuntime.engine;
      frameProperty = frameProperty ?? "ferrumDemoFrame";
      publishFrameReport();
    },
    destroy() {
      removeBeforeUnload?.();
      removeBeforeUnload = undefined;
      runtime?.destroy();
      runtime = undefined;
    },
  };

  function appendMetric(parent: HTMLElement, label: string, key: MetricKey): void {
    const item = document.createElement("div");
    const term = document.createElement("dt");
    const value = document.createElement("dd");
    item.className = "demo-metric";
    term.textContent = label;
    value.textContent = "-";
    item.append(term, value);
    parent.append(item);
    metricValues[key] = value;
  }

  function writeMetricValues(nextReport: RuntimeDemoFrameReport): void {
    setMetric("state", nextReport.state);
    setMetric("entityCount", String(nextReport.entityCount));
    setMetric("renderCommandCount", String(nextReport.renderCommandCount));
    setMetric("drawCalls", String(nextReport.drawCalls));
    setMetric("fps", nextReport.fps.toFixed(1));
  }

  function setMetric(key: MetricKey, value: string): void {
    const element = metricValues[key];
    if (element) element.textContent = value;
  }

  function publishFrameReport(): void {
    if (!frameProperty) return;
    (window as Window & Record<string, unknown>)[frameProperty] = { ...report };
  }
}

export function renderRuntimeDemoError(error: unknown, options: RuntimeDemoErrorOptions): void {
  console.error(`${options.title} failed`, error);
  const app = resolveRoot(options.root);
  const report = options.diagnosticReport?.(error);
  const container = document.createElement("main");
  const title = document.createElement("h1");
  const list = document.createElement("dl");
  container.className = "demo-error-shell";
  title.textContent = options.title;

  if (report) {
    appendDiagnosticRows(list, report);
  } else {
    appendDescription(list, "error", error instanceof Error ? error.message : String(error));
  }

  container.append(title, list);
  app.replaceChildren(container);
}

function appendDiagnosticRows(list: HTMLElement, report: RuntimeDemoDiagnosticReport): void {
  appendDescription(list, "code", report.code);
  appendDescription(list, "message", report.message);
  if (!report.context) return;
  appendDescription(list, "kind", report.context.kind);
  if (report.context.name !== undefined) appendDescription(list, "name", report.context.name);
  if (report.context.id !== undefined) appendDescription(list, "id", String(report.context.id));
  if (report.context.url !== undefined) appendDescription(list, "url", report.context.url);
  if (report.context.path !== undefined) appendDescription(list, "path", report.context.path);
  appendDescription(list, "detail", report.context.detail);
}

function appendDescription(list: HTMLElement, label: string, value: string): void {
  const term = document.createElement("dt");
  const description = document.createElement("dd");
  term.textContent = label;
  description.textContent = value;
  list.append(term, description);
}

function createButton(label: string, onClick: () => void): HTMLButtonElement {
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
