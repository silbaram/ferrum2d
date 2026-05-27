import {
  createFerrumRuntime,
  createHudOverlayState,
  resolveAccessibilityHudTheme,
  resolveAccessibilityOptions,
  resolveShooterGameSpec,
  type FerrumRuntime,
  type ShooterGameSpec,
  type UiOverlayState,
} from "@ferrum2d/ferrum-web";

import "./styles.css";

const accessibility = resolveAccessibilityOptions({
  reducedMotion: "system",
  contrastPalette: "default",
});

function stateLabel(state: number): string {
  if (state === 0) return "Title";
  if (state === 1) return "Playing";
  return "Game Over";
}

function createShell(): { canvas: HTMLCanvasElement; frame: HTMLElement; queueStart(): void; consumeStart(): boolean } {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) throw new Error("Missing #app root element.");

  let startQueued = false;
  const shell = document.createElement("main");
  const header = document.createElement("header");
  const title = document.createElement("h1");
  const button = document.createElement("button");
  const frame = document.createElement("section");
  const canvas = document.createElement("canvas");

  shell.className = "app-shell";
  header.className = "toolbar";
  frame.className = "stage";
  canvas.className = "game-canvas";
  canvas.width = 960;
  canvas.height = 540;
  title.textContent = "__PROJECT_TITLE__";
  button.type = "button";
  button.textContent = "Start";
  button.addEventListener("click", () => {
    startQueued = true;
  });

  header.append(title, button);
  frame.append(canvas);
  shell.append(header, frame);
  app.replaceChildren(shell);

  return {
    canvas,
    frame,
    queueStart() {
      startQueued = true;
    },
    consumeStart() {
      const queued = startQueued;
      startQueued = false;
      return queued;
    },
  };
}

function hud(frame: { gameState: number; score: number; entityCount: number }, fps: number): UiOverlayState {
  return createHudOverlayState([
    { id: "state", type: "counter", label: "State", value: stateLabel(frame.gameState) },
    { id: "score", type: "counter", label: "Score", value: frame.score },
    { id: "entities", type: "counter", label: "Entities", value: frame.entityCount },
    { id: "fps", type: "counter", label: "FPS", value: fps.toFixed(1), tone: "accent" },
    { id: "hint", type: "message", text: "WASD to move, Space or mouse to fire." },
  ], { title: "Shooter HUD", region: "top-left" });
}

async function loadGameSpec(): Promise<ShooterGameSpec> {
  const response = await fetch("./game.json", { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Failed to load public/game.json: ${response.status} ${response.statusText}`);
  }
  return resolveShooterGameSpec(await response.json());
}

async function bootstrap(): Promise<void> {
  const shell = createShell();
  const gameSpec = await loadGameSpec();
  const runtime = await createFerrumRuntime({
    canvas: shell.canvas,
    environment: "development",
    uiParent: shell.frame,
    ui: { theme: resolveAccessibilityHudTheme(accessibility) },
    uiState: ({ frame, fps }) => hud(frame, fps),
    inputTransform: (snapshot) => shell.consumeStart() ? { ...snapshot, enter: true } : snapshot,
    webgl2: { clearColor: [0.06, 0.08, 0.09, 1] },
  });

  runtime.engine.setGameSpec(gameSpec);
  runtime.engine.setTextureIds({ player: 0, enemy: 0, bullet: 0 });
  runtime.start();
  shell.queueStart();

  const runtimeWindow = window as Window & { ferrumRuntime?: FerrumRuntime };
  runtimeWindow.ferrumRuntime = runtime;
  window.addEventListener("beforeunload", () => runtime.destroy(), { once: true });
}

void bootstrap();
