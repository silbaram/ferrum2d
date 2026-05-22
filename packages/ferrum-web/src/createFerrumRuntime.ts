import { BrowserPlatformHost } from "./browserPlatformHost.js";
import { createEngine } from "./createEngine.js";
import type { AssetHost, CreateEngineOptions, FerrumEngine, FrameState, InputProvider } from "./createEngine.js";
import { DebugOverlay } from "./debugOverlay.js";
import type { DebugOverlayMetrics, DebugOverlayOptions } from "./debugOverlay.js";
import { InputManager } from "./inputManager.js";
import type { InputManagerOptions, InputSnapshot } from "./inputManager.js";
import type { RendererStats } from "./renderer.js";
import { UiOverlay } from "./uiOverlay.js";
import type { UiOverlayOptions, UiOverlayState } from "./uiOverlay.js";
import { WebGL2Renderer } from "./webgl2Renderer.js";
import type { WebGL2RendererOptions } from "./webgl2Renderer.js";

export type FerrumRuntimeEnvironment = "development" | "production";

export interface FerrumRuntimeFrame {
  frame: FrameState;
  rendererStats: RendererStats;
  debugMetrics: DebugOverlayMetrics;
  fps: number;
  renderTimeMs: number;
}

export type UiOverlayStateProvider = (frame: FerrumRuntimeFrame) => UiOverlayState;

export interface FerrumRuntimeOptions {
  canvas: HTMLCanvasElement;
  webgl2?: WebGL2RendererOptions;
  renderer?: WebGL2Renderer;
  input?: InputManager;
  inputOptions?: InputManagerOptions;
  assetHost?: AssetHost;
  debugParent?: HTMLElement;
  debug?: boolean | DebugOverlayOptions;
  uiParent?: HTMLElement;
  ui?: boolean | UiOverlayOptions;
  uiOverlay?: UiOverlay;
  uiState?: UiOverlayStateProvider;
  physicsDebugLines?: boolean;
  environment?: FerrumRuntimeEnvironment;
  engine?: CreateEngineOptions;
  autostart?: boolean;
  inputTransform?: (snapshot: InputSnapshot) => InputSnapshot;
  gameStateLabel?: (code: number) => string;
  onFrame?: (frame: FerrumRuntimeFrame) => void;
}

export interface FerrumRuntime {
  engine: FerrumEngine;
  renderer: WebGL2Renderer;
  input: InputManager;
  assetHost: AssetHost;
  uiOverlay?: UiOverlay;
  debugOverlay?: DebugOverlay;
  start(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  destroy(): void;
}

export async function createFerrumRuntime(options: FerrumRuntimeOptions): Promise<FerrumRuntime> {
  const ownsRenderer = options.renderer === undefined;
  const ownsInput = options.input === undefined;
  const ownsAssetHost = options.assetHost === undefined;
  const ownsUiOverlay = options.uiOverlay === undefined;
  let renderer: WebGL2Renderer | undefined = options.renderer;
  let input: InputManager | undefined = options.input;
  let assetHost: AssetHost | undefined = options.assetHost;
  let uiOverlay: UiOverlay | undefined = options.uiOverlay;
  let debugOverlay: DebugOverlay | undefined;
  let detachRendererResize: (() => void) | undefined;

  let audioEventRateWindowStartMs = performance.now();
  let audioEventRateCount = 0;
  let audioEventsPerSecond = 0;
  let destroyed = false;

  try {
    renderer ??= new WebGL2Renderer(options.canvas, options.webgl2);
    input ??= new InputManager(options.canvas, options.inputOptions);
    assetHost ??= new BrowserPlatformHost(renderer);
    uiOverlay ??= createUiOverlay(options);
    debugOverlay = createDebugOverlay(options);
    const needsRuntimeFrame = debugOverlay !== undefined || uiOverlay !== undefined || options.onFrame !== undefined;
    const shouldRenderPhysicsDebugLines = options.physicsDebugLines === true;
    const engineOptions: CreateEngineOptions = {
      ...options.engine,
      includeAudioEvents: options.engine?.includeAudioEvents ?? needsRuntimeFrame,
      enablePhysicsDebugLines:
        options.engine?.enablePhysicsDebugLines === true ||
        options.engine?.includePhysicsDebugLines === true ||
        shouldRenderPhysicsDebugLines,
    };

    const runtimeRenderer = renderer;
    const runtimeInput = input;
    const runtimeAssetHost = assetHost;
    runtimeRenderer.resize();
    detachRendererResize = observeRendererResize(options.canvas, runtimeRenderer);

    const inputProvider: InputProvider = () => {
      const snapshot = runtimeInput.snapshot();
      return options.inputTransform?.(snapshot) ?? snapshot;
    };

    const engine = await createEngine((frame) => {
      const renderStartMs = needsRuntimeFrame ? performance.now() : 0;
      runtimeRenderer.render();
      let rendererStats = runtimeRenderer.renderCommands(frame.renderCommandBuffer);
      if (shouldRenderPhysicsDebugLines) {
        rendererStats = runtimeRenderer.renderPhysicsDebugLines(frame.physicsDebugLineBuffer, {
          x: frame.cameraX,
          y: frame.cameraY,
        });
      }
      if (!needsRuntimeFrame) {
        return;
      }

      const renderTimeMs = performance.now() - renderStartMs;
      audioEventRateCount += frame.audioEventCount;
      const audioEventRateElapsedMs = performance.now() - audioEventRateWindowStartMs;
      if (audioEventRateElapsedMs >= 1000) {
        audioEventsPerSecond = audioEventRateCount / (audioEventRateElapsedMs / 1000);
        audioEventRateWindowStartMs = performance.now();
        audioEventRateCount = 0;
      }

      const fps = frame.frameTimeMs > 0 ? 1000 / frame.frameTimeMs : 0;
      const debugMetrics = buildDebugMetrics(
        frame,
        rendererStats,
        fps,
        renderTimeMs,
        audioEventsPerSecond,
        options.gameStateLabel ?? defaultGameStateLabel,
      );
      debugOverlay?.update(debugMetrics);
      const runtimeFrame: FerrumRuntimeFrame = {
        frame,
        rendererStats,
        debugMetrics,
        fps,
        renderTimeMs,
      };
      if (uiOverlay && options.uiState) {
        uiOverlay.update(options.uiState(runtimeFrame));
      }
      options.onFrame?.(runtimeFrame);
    }, inputProvider, runtimeAssetHost, () => runtimeRenderer.viewportSize(), engineOptions);

    const runtime: FerrumRuntime = {
      engine,
      renderer: runtimeRenderer,
      input: runtimeInput,
      assetHost: runtimeAssetHost,
      uiOverlay,
      debugOverlay,
      start: () => engine.start(),
      pause: () => engine.pause(),
      resume: () => engine.resume(),
      stop: () => engine.stop(),
      destroy: () => {
        if (destroyed) {
          return;
        }
        destroyed = true;
        detachRendererResize?.();
        detachRendererResize = undefined;
        engine.destroy();
        if (ownsUiOverlay) uiOverlay?.destroy();
        debugOverlay?.destroy();
        if (ownsInput) runtimeInput.destroy();
        if (ownsAssetHost) destroyAssetHost(runtimeAssetHost);
        if (ownsRenderer) runtimeRenderer.destroy();
      },
    };

    if (options.autostart) {
      runtime.start();
    }

    return runtime;
  } catch (error) {
    detachRendererResize?.();
    if (ownsUiOverlay) uiOverlay?.destroy();
    debugOverlay?.destroy();
    if (ownsInput && input) input.destroy();
    if (ownsAssetHost && assetHost) destroyAssetHost(assetHost);
    if (ownsRenderer && renderer) renderer.destroy();
    throw error;
  }
}

function createUiOverlay(options: FerrumRuntimeOptions): UiOverlay | undefined {
  if (options.ui === false) {
    return undefined;
  }
  if (options.ui === undefined && options.uiState === undefined) {
    return undefined;
  }
  const uiOptions: UiOverlayOptions = options.ui === true || options.ui === undefined
    ? { enabled: true }
    : options.ui;
  if (uiOptions.enabled === false) {
    return undefined;
  }
  return new UiOverlay(
    options.uiParent ?? options.canvas.parentElement ?? document.body,
    uiOptions,
  );
}

function createDebugOverlay(options: FerrumRuntimeOptions): DebugOverlay | undefined {
  const debugOptions = resolveDebugOptions(options);
  if (!debugOptions) {
    return undefined;
  }

  return new DebugOverlay(options.debugParent ?? document.body, debugOptions);
}

function resolveDebugOptions(options: FerrumRuntimeOptions): DebugOverlayOptions | undefined {
  if (options.debug === false) {
    return undefined;
  }
  if (options.debug === true) {
    return { enabled: true };
  }
  if (typeof options.debug === "object") {
    return options.debug.enabled === false ? undefined : options.debug;
  }
  return options.environment === "development" ? { enabled: true } : undefined;
}

function observeRendererResize(canvas: HTMLCanvasElement, renderer: WebGL2Renderer): () => void {
  const resize = (): void => {
    renderer.resize();
  };
  const cleanup: Array<() => void> = [];

  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    cleanup.push(() => observer.disconnect());
  }

  if (typeof window !== "undefined") {
    window.addEventListener("resize", resize);
    cleanup.push(() => window.removeEventListener("resize", resize));
  }

  return () => {
    for (const dispose of cleanup.splice(0).reverse()) {
      dispose();
    }
  };
}

function buildDebugMetrics(
  frame: FrameState,
  rendererStats: RendererStats,
  fps: number,
  renderTimeMs: number,
  audioEventsPerSecond: number,
  gameStateLabel: (code: number) => string,
): DebugOverlayMetrics {
  return {
    fps,
    frameTimeMs: frame.frameTimeMs,
    entityCount: frame.entityCount,
    spriteCount: frame.spriteCount,
    drawCalls: rendererStats.drawCalls,
    batchCount: rendererStats.batchCount,
    renderCommandCount: rendererStats.renderCommandCount,
    textureBindCount: rendererStats.textureBindCount,
    textureSwitchCount: rendererStats.textureSwitchCount,
    physicsDebugLineCount: rendererStats.physicsDebugLineCount,
    audioEventsPerSecond,
    physicsFixedSteps: frame.physics.fixedSteps,
    physicsKinematicHits: frame.physics.kinematicHits,
    physicsTileCandidateChecks: frame.physics.tileCandidateChecks,
    collisionEventCount: frame.physics.collisionEventCount,
    rustUpdateTimeMs: frame.rustUpdateTimeMs,
    renderTimeMs,
    mouseX: frame.mouseX,
    mouseY: frame.mouseY,
    cameraX: frame.cameraX,
    cameraY: frame.cameraY,
    gameState: gameStateLabel(frame.gameState),
    score: frame.score,
  };
}

function defaultGameStateLabel(code: number): string {
  if (code === 0) return "Title";
  if (code === 1) return "Playing";
  if (code === 2) return "GameOver";
  return `State ${code}`;
}

function destroyAssetHost(assetHost: AssetHost): void {
  const maybeDestroyable = assetHost as AssetHost & { destroy?: () => void };
  maybeDestroyable.destroy?.();
}
