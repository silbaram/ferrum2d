import {
  createFerrumRuntime,
  type FerrumEngine,
  type FerrumRuntime,
  type InputSnapshot,
} from "@ferrum2d/ferrum-web/core";
import {
  diagnosticReport,
} from "@ferrum2d/ferrum-web/quality";

import "./styles.css";

function gameStateLabel(code: number): string {
  if (code === 0) return "Title";
  if (code === 1) return "Playing";
  if (code === 2) return "GameOver";
  return `State ${code}`;
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
  debugRoot: HTMLElement;
  stateValue: HTMLElement;
  scoreValue: HTMLElement;
  entityValue: HTMLElement;
  commandValue: HTMLElement;
  fpsValue: HTMLElement;
  setEngine(engine: FerrumEngine): void;
  queueStart(): void;
  inputSnapshot(snapshot: InputSnapshot): InputSnapshot;
} {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) throw new Error("Missing #app root element.");

  let engine: FerrumEngine | undefined;
  let startQueued = false;
  const shell = document.createElement("main");
  const toolbar = document.createElement("section");
  const title = document.createElement("h1");
  const actions = document.createElement("div");
  const stage = document.createElement("section");
  const canvas = document.createElement("canvas");
  const metrics = document.createElement("dl");
  const debugRoot = document.createElement("div");
  const stateValue = document.createElement("dd");
  const scoreValue = document.createElement("dd");
  const entityValue = document.createElement("dd");
  const commandValue = document.createElement("dd");
  const fpsValue = document.createElement("dd");

  shell.className = "app-shell";
  toolbar.className = "toolbar";
  actions.className = "actions";
  stage.className = "stage";
  canvas.className = "game-canvas";
  metrics.className = "metrics";
  debugRoot.className = "debug-root";

  title.textContent = "__PROJECT_TITLE__";
  canvas.width = 800;
  canvas.height = 480;

  actions.append(
    createButton("Start", () => {
      startQueued = true;
    }),
    createButton("Reset", () => {
      engine?.resetGame();
      startQueued = true;
    }),
  );

  appendMetric("State", stateValue);
  appendMetric("Score", scoreValue);
  appendMetric("Entities", entityValue);
  appendMetric("Commands", commandValue);
  appendMetric("FPS", fpsValue);

  toolbar.append(title, actions);
  stage.append(canvas, metrics);
  shell.append(toolbar, stage, debugRoot);
  app.replaceChildren(shell);

  return {
    canvas,
    debugRoot,
    stateValue,
    scoreValue,
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
      if (!startQueued) return snapshot;
      startQueued = false;
      return { ...snapshot, enter: true };
    },
  };

  function appendMetric(label: string, value: HTMLElement): void {
    const term = document.createElement("dt");
    term.textContent = label;
    value.textContent = "-";
    metrics.append(term, value);
  }
}

function renderBootstrapError(error: unknown): void {
  console.error("Ferrum2D Breakout startup failed", error);
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) return;
  const report = diagnosticReport(error);
  const shell = document.createElement("main");
  const title = document.createElement("h1");
  const details = document.createElement("pre");
  shell.className = "error-shell";
  title.textContent = "__PROJECT_TITLE__";
  details.textContent = `${report.code}\n${report.message}`;
  shell.append(title, details);
  app.replaceChildren(shell);
}

async function bootstrap(): Promise<void> {
  const shell = createShell();
  const runtime = await createFerrumRuntime({
    canvas: shell.canvas,
    debugParent: shell.debugRoot,
    environment: "development",
    webgl2: {
      clearColor: [0.05, 0.06, 0.08, 1],
    },
    inputTransform: (snapshot) => shell.inputSnapshot(snapshot),
    gameStateLabel,
    onFrame: ({ frame, rendererStats, fps }) => {
      shell.stateValue.textContent = gameStateLabel(frame.gameState);
      shell.scoreValue.textContent = String(frame.score);
      shell.entityValue.textContent = String(frame.entityCount);
      shell.commandValue.textContent = String(rendererStats.renderCommandCount);
      shell.fpsValue.textContent = fps.toFixed(1);
    },
  });

  runtime.engine.useBreakoutGame();
  shell.setEngine(runtime.engine);
  runtime.start();
  shell.queueStart();

  const runtimeWindow = window as Window & { ferrumRuntime?: FerrumRuntime };
  runtimeWindow.ferrumRuntime = runtime;
  window.addEventListener("beforeunload", () => runtime.destroy(), { once: true });
}

void bootstrap().catch(renderBootstrapError);
