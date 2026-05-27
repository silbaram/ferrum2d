import {
  createFerrumRuntime,
  deriveTileOccludersFromTilemapGrid,
  diagnosticReport,
  IndexedDbAssetCache,
  LoadingOverlay,
  ParticleVfxEmitter,
  particleVfxPreset,
  preloadAssetManifest,
  type DiagnosticContext,
  type DiagnosticReport,
  type AssetLoadProgress,
  type FerrumEngine,
  type FerrumRuntime,
  type FerrumRuntimeEnvironment,
  type InputSnapshot,
  type LightingScene2D,
  type PostProcessStackInput,
  type UiOverlayState,
  VirtualControls,
} from "@ferrum2d/ferrum-web";

import "./styles.css";

const PRELOAD_SMOKE_TEXTURE_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const PRELOAD_SMOKE_JSON_URL = "data:application/json,%7B%22ok%22%3Atrue%7D";

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
  console.error("Ferrum2D minimal game failed", error);
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) return;

  const report = diagnosticReport(error);
  const container = document.createElement("main");
  const title = document.createElement("h1");
  const summary = document.createElement("p");
  const list = document.createElement("dl");
  container.className = "error-shell";
  title.textContent = "Ferrum2D Minimal Game";
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

  title.textContent = "Ferrum2D Minimal Game";
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
    createButton("Pause", () => {
      engine?.pause();
    }),
    createButton("Resume", () => {
      engine?.resume();
    }),
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
  const state = gameStateLabel(frame.gameState);
  return {
    panels: [{
      id: "starter-hud",
      title: "Runtime HUD",
      region: "top-left",
      lines: [
        { id: "state", label: "State", value: state },
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
    const lightingSmoke = searchParams.get("lightingSmoke") === "true";
    const materialSmoke = searchParams.get("materialSmoke") === "true";
    const cameraPostProcessSmoke = searchParams.get("cameraPostProcessSmoke") === "true";
    const particleVfxSmoke = searchParams.get("particleVfxSmoke") === "true";
    const rendererPreference = searchParams.get("renderer") === "webgpu" ? "webgpu" : "webgl2";
    const profilerSmoke = searchParams.get("profilerSmoke") === "true";
    const preloadSmoke = searchParams.get("preloadSmoke") === "true";
    const virtualControlsSmoke = searchParams.get("virtualControlsSmoke") === "true";
    const preloadSmokeReport = preloadSmoke
      ? await runPreloadSmoke(shell.canvasFrame, cleanups)
      : undefined;
    const virtualControls = virtualControlsSmoke
      ? new VirtualControls(shell.canvasFrame)
      : undefined;
    if (virtualControls) {
      cleanups.push(() => virtualControls.destroy());
    }
    let particleVfxEmitter: ParticleVfxEmitter | undefined;
    let particleVfxEngine: FerrumEngine | undefined;
    const runtime = await createFerrumRuntime({
      canvas: shell.canvas,
      debugParent: shell.debugRoot,
      debug: debugParam === null ? undefined : { enabled: debugParam !== "false" },
      physicsDebugLines,
      environment,
      profiler: profilerSmoke,
      rendererPreference,
      webgl2: {
        clearColor: [0.07, 0.09, 0.11, 1],
        preserveDrawingBuffer,
        spriteMaterial: materialSmoke ? "outline" : undefined,
      },
      webgpu: {
        lighting: lightingSmoke ? minimalLightingScene() : undefined,
        spriteMaterial: materialSmoke ? "outline" : undefined,
      },
      lighting: lightingSmoke ? minimalLightingScene() : undefined,
      postProcess: cameraPostProcessSmoke ? cameraPostProcessSmokePass : undefined,
      spriteMaterial: materialSmoke ? "outline" : undefined,
      uiParent: shell.canvasFrame,
      ui: {
        onAction: (event) => {
          if (event.id === "start") {
            shell.queueStart();
          }
        },
      },
      uiState: ({ frame, rendererStats, fps }) => runtimeUiState(frame, rendererStats.renderCommandCount, fps),
      inputTransform: (snapshot) => {
        const transformed = virtualControls?.applyToSnapshot(shell.inputSnapshot(snapshot))
          ?? shell.inputSnapshot(snapshot);
        (window as Window & { ferrumVirtualControlsSmokeFrame?: { input: InputSnapshot } })
          .ferrumVirtualControlsSmokeFrame = { input: transformed };
        return transformed;
      },
      onFrame: ({ frame, rendererStats, fps }) => {
        if (particleVfxEmitter) {
          const x = 320 + Math.sin(frame.timeSeconds * 8) * 80;
          const y = 200 + Math.cos(frame.timeSeconds * 5) * 24;
          particleVfxEmitter.update(frame.frameTimeMs / 1000, x, y);
          (window as Window & {
            ferrumParticleVfxSmokeFrame?: {
              emitter: ReturnType<ParticleVfxEmitter["snapshot"]>;
              particleCount: number;
              renderCommandCount: number;
            };
          }).ferrumParticleVfxSmokeFrame = {
            emitter: particleVfxEmitter.snapshot(),
            particleCount: particleVfxEngine?.particleCount() ?? 0,
            renderCommandCount: rendererStats.renderCommandCount,
          };
        }
        if (cameraPostProcessSmoke) {
          (window as Window & {
            ferrumCameraPostProcessSmokeFrame?: {
              postProcessDrawCalls: number;
              postProcessPassCount: number;
              drawCalls: number;
            };
          }).ferrumCameraPostProcessSmokeFrame = {
            postProcessDrawCalls: rendererStats.postProcessDrawCalls,
            postProcessPassCount: rendererStats.postProcessPassCount,
            drawCalls: rendererStats.drawCalls,
          };
        }
        shell.stateValue.textContent = gameStateLabel(frame.gameState);
        shell.entityValue.textContent = String(frame.entityCount);
        shell.commandValue.textContent = String(rendererStats.renderCommandCount);
        shell.fpsValue.textContent = fps.toFixed(1);
      },
    });

    runtime.engine.setTextureIds({ player: 0, enemy: 0, bullet: 0 });
    if (particleVfxSmoke) {
      particleVfxEngine = runtime.engine;
      particleVfxEmitter = ParticleVfxEmitter.create({
        target: runtime.engine,
        presetId: 5,
        preset: particleVfxPreset("motion-trail", 0),
      });
      particleVfxEmitter.start(320, 200);
    }
    shell.setEngine(runtime.engine);
    cleanups.push(() => runtime.destroy());

    const onBeforeUnload = (): void => cleanupResources(cleanups);
    window.addEventListener("beforeunload", onBeforeUnload);
    cleanups.push(() => window.removeEventListener("beforeunload", onBeforeUnload));

    runtime.start();
    shell.queueStart();
    (window as Window & { ferrumEngine?: FerrumEngine; ferrumRuntime?: FerrumRuntime }).ferrumEngine = runtime.engine;
    (window as Window & { ferrumRuntime?: FerrumRuntime }).ferrumRuntime = runtime;
    (window as Window & { ferrumVirtualControls?: VirtualControls }).ferrumVirtualControls = virtualControls;
    (window as Window & { ferrumAssetPreloadSmoke?: Awaited<ReturnType<typeof runPreloadSmoke>> })
      .ferrumAssetPreloadSmoke = preloadSmokeReport;

  } catch (error) {
    cleanupResources(cleanups);
    throw error;
  }
}

void bootstrap().catch(renderBootstrapError);

async function runPreloadSmoke(parent: HTMLElement, cleanups: Array<() => void>): Promise<{
  first: { fetched: number; cached: number; total: number };
  second: { fetched: number; cached: number; total: number };
  progress: AssetLoadProgress[];
  overlay: ReturnType<LoadingOverlay["state"]>;
  cacheSupported: boolean;
}> {
  const overlay = new LoadingOverlay(parent, { title: "Loading", completeTitle: "Ready" });
  cleanups.push(() => overlay.destroy());
  const cacheSupported = typeof indexedDB !== "undefined";
  const cache = new IndexedDbAssetCache({
    databaseName: "ferrum2d-minimal-preload-smoke",
    storeName: "json",
    binaryStoreName: "binary",
  });
  const version = "preload-smoke-v1";
  await cache.invalidateJson(PRELOAD_SMOKE_JSON_URL, { version });
  await cache.invalidateBinary(PRELOAD_SMOKE_TEXTURE_URL, { version });
  const manifest = {
    textures: { pixel: PRELOAD_SMOKE_TEXTURE_URL },
    json: { config: PRELOAD_SMOKE_JSON_URL },
  };
  const progress: AssetLoadProgress[] = [];
  const first = await preloadAssetManifest(manifest, {
    cache,
    cachePolicy: { json: true, textures: true, version, ttlMs: 60_000 },
    onProgress: (nextProgress) => {
      progress.push(nextProgress);
      overlay.update(nextProgress);
    },
  });
  const second = await preloadAssetManifest(manifest, {
    cache,
    cachePolicy: { json: true, textures: true, version, ttlMs: 60_000 },
    onProgress: (nextProgress) => {
      progress.push(nextProgress);
      overlay.update(nextProgress);
    },
  });
  overlay.complete();
  return {
    first: summarizePreload(first),
    second: summarizePreload(second),
    progress,
    overlay: overlay.state(),
    cacheSupported,
  };
}

function summarizePreload(result: Awaited<ReturnType<typeof preloadAssetManifest>>): {
  fetched: number;
  cached: number;
  total: number;
} {
  return {
    fetched: result.fetched,
    cached: result.cached,
    total: result.plan.total,
  };
}

function minimalLightingScene(): LightingScene2D {
  return {
    ambient: [0, 0, 0, 0.38],
    pointLights: [{
      x: 400,
      y: 240,
      radius: 220,
      color: [1, 0.78, 0.35],
      intensity: 1.25,
      falloff: 2.2,
    }],
    tileOccluders: deriveTileOccludersFromTilemapGrid({
      width: 5,
      height: 2,
      tileSize: 48,
      data: [
        0, 1, 1, 0, 0,
        2, 2, 0, 0, 3,
      ],
    }),
    shadows: { enabled: true, color: [0, 0, 0, 0.36], projectionLength: 420 },
    debug: { tileOccluders: true },
  };
}

function cameraPostProcessSmokePass(): PostProcessStackInput {
  return [
    { kind: "bloom", threshold: 0.65, intensity: 0.35, radius: 1.5 },
    { kind: "crt", curvature: 0.04, scanlineIntensity: 0.12, chromaticAberration: 0.001 },
    { kind: "vignette", color: [0.02, 0.04, 0.06, 1], intensity: 0.28, radius: 0.72, softness: 0.28 },
    { kind: "fade", color: [0.02, 0.04, 0.06, 1], opacity: 0.08 },
  ];
}
