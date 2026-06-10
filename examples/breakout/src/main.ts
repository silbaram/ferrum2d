import {
  createFerrumRuntime,
  diagnosticReport,
  type DiagnosticContext,
  type DiagnosticReport,
  type FerrumEngine,
  type FerrumRuntime,
  type FerrumRuntimeEnvironment,
  type InputSnapshot,
} from "@ferrum2d/ferrum-web";

import "./styles.css";

function gameStateLabel(code: number): string {
  if (code === 0) return "Title";
  if (code === 1) return "Playing";
  if (code === 2) return "GameOver";
  return `State ${code}`;
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

function cleanupResources(cleanups: Array<() => void>): void {
  for (const cleanup of cleanups.splice(0).reverse()) {
    try {
      cleanup();
    } catch (error) {
      console.warn("Ferrum2D cleanup failed", error);
    }
  }
}

function renderBootstrapError(error: unknown): void {
  console.error("Ferrum2D Breakout failed", error);
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) return;

  const report = diagnosticReport(error);
  const container = document.createElement("main");
  const title = document.createElement("h1");
  const summary = document.createElement("p");
  const list = document.createElement("dl");
  container.className = "error-shell";
  title.textContent = "Ferrum2D Breakout";
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
  debugRoot: HTMLElement;
  stateValue: HTMLElement;
  scoreValue: HTMLElement;
  entityValue: HTMLElement;
  commandValue: HTMLElement;
  particleValue: HTMLElement;
  hitValue: HTMLElement;
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
  const particleValue = document.createElement("dd");
  const hitValue = document.createElement("dd");
  const fpsValue = document.createElement("dd");

  shell.className = "app-shell";
  toolbar.className = "toolbar";
  actions.className = "actions";
  stage.className = "stage";
  canvas.className = "game-canvas";
  metrics.className = "metrics";
  debugRoot.className = "debug-root";

  title.textContent = "Ferrum2D Breakout";
  canvas.width = 800;
  canvas.height = 480;

  actions.append(
    createButton("Start", () => {
      startQueued = true;
    }),
    createButton("Reset", () => {
      engine?.resetGame();
    }),
    createButton("Pause", () => {
      engine?.pause();
    }),
    createButton("Resume", () => {
      engine?.resume();
    }),
  );

  appendMetric(metrics, "state", stateValue);
  appendMetric(metrics, "score", scoreValue);
  appendMetric(metrics, "entities", entityValue);
  appendMetric(metrics, "commands", commandValue);
  appendMetric(metrics, "particles", particleValue);
  appendMetric(metrics, "hits", hitValue);
  appendMetric(metrics, "fps", fpsValue);

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
    particleValue,
    hitValue,
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

async function bootstrap(): Promise<void> {
  const cleanups: Array<() => void> = [];
  const shell = createShell();

  try {
    const searchParams = new URLSearchParams(window.location.search);
    const debugParam = searchParams.get("debug");
    const environment: FerrumRuntimeEnvironment = searchParams.get("environment") === "production"
      ? "production"
      : "development";
    const preserveDrawingBuffer = searchParams.get("preserveDrawingBuffer") === "true";
    const physicsDebugLines = searchParams.get("physicsDebugLines") === "true";
    const profilerSmokeEnabled = searchParams.get("profilerSmoke") === "true";
    let runtimeEngine: FerrumEngine | undefined;
    const runtime = await createFerrumRuntime({
      canvas: shell.canvas,
      debugParent: shell.debugRoot,
      debug: debugParam === null ? undefined : { enabled: debugParam !== "false" },
      physicsDebugLines,
      environment,
      profiler: profilerSmokeEnabled,
      webgl2: { clearColor: [0.05, 0.06, 0.08, 1], preserveDrawingBuffer },
      inputTransform: (snapshot) => shell.inputSnapshot(snapshot),
      gameStateLabel,
      onFrame: ({ frame, rendererStats, fps }) => {
        shell.stateValue.textContent = gameStateLabel(frame.gameState);
        shell.scoreValue.textContent = String(frame.score);
        shell.entityValue.textContent = String(frame.entityCount);
        shell.commandValue.textContent = String(rendererStats.renderCommandCount);
        shell.particleValue.textContent = String(runtimeEngine?.particleCount() ?? 0);
        shell.hitValue.textContent = String(frame.physics.collisionHitEvents);
        shell.fpsValue.textContent = fps.toFixed(1);
      },
    });

    runtime.engine.useBreakoutGame();
    runtimeEngine = runtime.engine;
    shell.setEngine(runtime.engine);
    cleanups.push(() => runtime.destroy());

    const onBeforeUnload = (): void => cleanupResources(cleanups);
    window.addEventListener("beforeunload", onBeforeUnload);
    cleanups.push(() => window.removeEventListener("beforeunload", onBeforeUnload));

    runtime.start();
    shell.queueStart();
    (window as Window & { ferrumEngine?: FerrumEngine; ferrumRuntime?: FerrumRuntime }).ferrumEngine = runtime.engine;
    (window as Window & { ferrumRuntime?: FerrumRuntime }).ferrumRuntime = runtime;
  } catch (error) {
    cleanupResources(cleanups);
    throw error;
  }
}

void bootstrap().catch(renderBootstrapError);
