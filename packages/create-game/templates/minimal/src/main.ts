import {
  createFerrumRuntime,
  diagnosticReport,
  type DiagnosticContext,
  type DiagnosticReport,
  type FerrumEngine,
  type FerrumRuntime,
  type InputSnapshot,
  type UiOverlayState,
} from "@ferrum2d/ferrum-web";

import "./styles.css";

function gameStateLabel(code: number): string {
  if (code === 0) return "Title";
  if (code === 1) return "Playing";
  return "GameOver";
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

function renderStartupError(error: unknown): void {
  console.error("Ferrum2D startup failed", error);
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) return;

  const report = diagnosticReport(error);
  const container = document.createElement("main");
  const title = document.createElement("h1");
  const summary = document.createElement("p");
  const list = document.createElement("dl");
  container.className = "error-shell";
  title.textContent = "__PROJECT_TITLE__";
  summary.textContent = "Startup failed.";

  for (const [label, value] of diagnosticRows(report)) {
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;
    description.textContent = value;
    list.append(term, description);
  }

  container.append(title, summary, list);
  app.replaceChildren(container);
}

function createButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function createShell(): {
  canvas: HTMLCanvasElement;
  canvasFrame: HTMLElement;
  debugRoot: HTMLElement;
  stateValue: HTMLElement;
  entityValue: HTMLElement;
  commandValue: HTMLElement;
  fpsValue: HTMLElement;
  setEngine(engine: FerrumEngine): void;
  queueStart(): void;
  inputSnapshot(snapshot: InputSnapshot): InputSnapshot;
} {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) {
    throw new Error("Missing #app root element.");
  }

  let engine: FerrumEngine | undefined;
  let startQueued = false;
  let restartQueued = false;
  const shell = document.createElement("main");
  const toolbar = document.createElement("section");
  const title = document.createElement("h1");
  const actions = document.createElement("div");
  const stage = document.createElement("section");
  const canvasFrame = document.createElement("div");
  const canvas = document.createElement("canvas");
  const metrics = document.createElement("dl");
  const debugRoot = document.createElement("div");
  const stateValue = document.createElement("dd");
  const entityValue = document.createElement("dd");
  const commandValue = document.createElement("dd");
  const fpsValue = document.createElement("dd");

  shell.className = "app-shell";
  toolbar.className = "toolbar";
  actions.className = "actions";
  stage.className = "stage";
  canvasFrame.className = "canvas-frame";
  canvas.className = "game-canvas";
  metrics.className = "metrics";
  debugRoot.className = "debug-root";

  title.textContent = "__PROJECT_TITLE__";
  canvas.width = 800;
  canvas.height = 480;

  actions.append(
    createButton("Start", () => {
      if (engine?.gameState() === 2) {
        restartQueued = true;
      } else {
        startQueued = true;
      }
    }),
    createButton("Pause", () => engine?.pause()),
    createButton("Resume", () => engine?.resume()),
  );

  appendMetric(metrics, "state", stateValue);
  appendMetric(metrics, "entities", entityValue);
  appendMetric(metrics, "commands", commandValue);
  appendMetric(metrics, "fps", fpsValue);

  toolbar.append(title, actions);
  canvasFrame.append(canvas);
  stage.append(canvasFrame, metrics);
  shell.append(toolbar, stage, debugRoot);
  app.replaceChildren(shell);

  return {
    canvas,
    canvasFrame,
    debugRoot,
    stateValue,
    entityValue,
    commandValue,
    fpsValue,
    setEngine(nextEngine) {
      engine = nextEngine;
    },
    queueStart() {
      startQueued = true;
    },
    inputSnapshot(snapshot) {
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
  };

  function appendMetric(parent: HTMLElement, label: string, value: HTMLElement): void {
    const term = document.createElement("dt");
    term.textContent = label;
    value.textContent = "-";
    parent.append(term, value);
  }
}

function runtimeUiState(
  frame: { gameState: number; score: number; entityCount: number },
  renderCommandCount: number,
  fps: number,
): UiOverlayState {
  return {
    panels: [{
      id: "starter-hud",
      title: "Runtime HUD",
      region: "top-left",
      lines: [
        { id: "state", label: "State", value: gameStateLabel(frame.gameState) },
        { id: "score", label: "Score", value: frame.score },
        { id: "entities", label: "Entities", value: frame.entityCount },
        { id: "commands", label: "Commands", value: renderCommandCount },
        { id: "fps", label: "FPS", value: fps.toFixed(1), tone: "accent" },
      ],
    }],
    dialog: frame.gameState === 0
      ? {
        id: "title",
        title: "Ready",
        body: "Start the runtime loop.",
        actions: [{ id: "start", label: "Start", tone: "primary" }],
      }
      : undefined,
  };
}

async function bootstrap(): Promise<void> {
  const shell = createShell();
  const runtime = await createFerrumRuntime({
    canvas: shell.canvas,
    debugParent: shell.debugRoot,
    environment: "development",
    webgl2: { clearColor: [0.07, 0.09, 0.11, 1] },
    uiParent: shell.canvasFrame,
    ui: {
      onAction: (event) => {
        if (event.id === "start") shell.queueStart();
      },
    },
    uiState: ({ frame, rendererStats, fps }) => runtimeUiState(frame, rendererStats.renderCommandCount, fps),
    inputTransform: (snapshot) => shell.inputSnapshot(snapshot),
    onFrame: ({ frame, rendererStats, fps }) => {
      shell.stateValue.textContent = gameStateLabel(frame.gameState);
      shell.entityValue.textContent = String(frame.entityCount);
      shell.commandValue.textContent = String(rendererStats.renderCommandCount);
      shell.fpsValue.textContent = fps.toFixed(1);
    },
  });

  runtime.engine.setTextureIds({ player: 0, enemy: 0, bullet: 0 });
  shell.setEngine(runtime.engine);
  runtime.start();
  shell.queueStart();

  const runtimeWindow = window as Window & { ferrumEngine?: FerrumEngine; ferrumRuntime?: FerrumRuntime };
  runtimeWindow.ferrumEngine = runtime.engine;
  runtimeWindow.ferrumRuntime = runtime;
  window.addEventListener("beforeunload", () => runtime.destroy(), { once: true });
}

void bootstrap().catch(renderStartupError);
