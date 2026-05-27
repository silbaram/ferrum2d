import { BrowserPlatformHost } from "./browserPlatformHost.js";
import { createEngine } from "./createEngine.js";
import type {
  AssetHost,
  CreateEngineOptions,
  FerrumEngine,
  FrameState,
  InputProvider,
  PhysicsDebugOptions,
} from "./createEngine.js";
import { DebugOverlay } from "./debugOverlay.js";
import type { DebugOverlayMetrics, DebugOverlayOptions } from "./debugOverlay.js";
import type { PhysicsMode } from "./physicsSpec.js";
import { applyPhysicsSceneProfile } from "./physicsSceneIntegration.js";
import type { PhysicsSceneProfileApplyResult, PhysicsSceneProfileSpec } from "./physicsSceneIntegration.js";
import { InputManager } from "./inputManager.js";
import type { InputManagerOptions, InputSnapshot } from "./inputManager.js";
import type { LightingScene2D } from "./lighting.js";
import type { PostProcessStackInput } from "./cameraPostProcessing.js";
import type { SpriteMaterialPresetInput } from "./spriteMaterial.js";
import { RuntimeProfiler } from "./runtimeProfiler.js";
import type { RuntimeProfilerOptions } from "./runtimeProfiler.js";
import { createRenderer } from "./createRenderer.js";
import type { CreatedRenderer } from "./createRenderer.js";
import type { RendererStats } from "./renderer.js";
import type { TextureAssetManager } from "./assetLoader.js";
import { UiOverlay } from "./uiOverlay.js";
import type { UiOverlayOptions, UiOverlayState } from "./uiOverlay.js";
import type { WebGL2RendererOptions } from "./webgl2Renderer.js";
import type { WebGPURendererOptions } from "./webgpuRenderer.js";
import type { PhysicsDebugLineCamera } from "./physicsDebugLineBatch.js";
import type { PhysicsDebugLineBufferView, RenderCommandBufferView } from "./wasmBridge.js";

export type FerrumRuntimeRenderer = CreatedRenderer & TextureAssetManager & {
  renderCommands(commands: RenderCommandBufferView): RendererStats;
  renderPhysicsDebugLines(lines: PhysicsDebugLineBufferView, camera: PhysicsDebugLineCamera): RendererStats;
  viewportSize(): { width: number; height: number };
  setLighting?(scene: LightingScene2D | false | undefined): void;
  setPostProcess?(postProcess: PostProcessStackInput): void;
  renderPostProcess?(postProcess?: PostProcessStackInput): RendererStats;
  setSpriteMaterial?(material: SpriteMaterialPresetInput): void;
};

export type FerrumRuntimeEnvironment = "development" | "production";

export interface FerrumRuntimeFrame {
  frame: FrameState;
  rendererStats: RendererStats;
  debugMetrics: DebugOverlayMetrics;
  fps: number;
  renderTimeMs: number;
}

export type UiOverlayStateProvider = (frame: FerrumRuntimeFrame) => UiOverlayState;
export type LightingSceneProvider = (frame: FrameState) => LightingScene2D | false | undefined;
export type PostProcessProvider = (frame: FrameState) => PostProcessStackInput;
export type SpriteMaterialProvider = (frame: FrameState) => SpriteMaterialPresetInput;

export interface FerrumRuntimeOptions {
  canvas: HTMLCanvasElement;
  webgl2?: WebGL2RendererOptions;
  webgpu?: WebGPURendererOptions;
  rendererPreference?: "webgl2" | "webgpu";
  renderer?: FerrumRuntimeRenderer;
  input?: InputManager;
  inputOptions?: InputManagerOptions;
  assetHost?: AssetHost;
  debugParent?: HTMLElement;
  debug?: boolean | DebugOverlayOptions;
  uiParent?: HTMLElement;
  ui?: boolean | UiOverlayOptions;
  uiOverlay?: UiOverlay;
  uiState?: UiOverlayStateProvider;
  physicsDebugLines?: boolean | PhysicsDebugOptions;
  physicsMode?: PhysicsMode;
  physicsScene?: PhysicsSceneProfileSpec | false;
  environment?: FerrumRuntimeEnvironment;
  engine?: CreateEngineOptions;
  lighting?: LightingScene2D | false | LightingSceneProvider;
  postProcess?: PostProcessStackInput | PostProcessProvider;
  spriteMaterial?: SpriteMaterialPresetInput | SpriteMaterialProvider;
  profiler?: boolean | RuntimeProfiler | RuntimeProfilerOptions;
  autostart?: boolean;
  inputTransform?: (snapshot: InputSnapshot) => InputSnapshot;
  gameStateLabel?: (code: number) => string;
  onFrame?: (frame: FerrumRuntimeFrame) => void;
}

export interface FerrumRuntime {
  engine: FerrumEngine;
  renderer: FerrumRuntimeRenderer;
  input: InputManager;
  assetHost: AssetHost;
  profiler?: RuntimeProfiler;
  physicsScene?: PhysicsSceneProfileApplyResult;
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
  let renderer: FerrumRuntimeRenderer | undefined = options.renderer;
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
    renderer ??= await createRenderer(options.canvas, {
      preferred: options.rendererPreference ?? "webgl2",
      webgl2: options.webgl2,
      webgpu: webGpuOptionsWithStaticPostProcess(options),
    });
    input ??= new InputManager(options.canvas, options.inputOptions);
    assetHost ??= new BrowserPlatformHost(renderer);
    uiOverlay ??= createUiOverlay(options);
    debugOverlay = createDebugOverlay(options);
    const profiler = createRuntimeProfiler(options.profiler);
    const needsRuntimeFrame =
      debugOverlay !== undefined || uiOverlay !== undefined || options.onFrame !== undefined || profiler !== undefined;
    const shouldRenderPhysicsDebugLines =
      options.physicsDebugLines !== undefined && options.physicsDebugLines !== false;
    const runtimePhysicsDebugLines =
      typeof options.physicsDebugLines === "object" ? options.physicsDebugLines : shouldRenderPhysicsDebugLines;
    const engineOptions: CreateEngineOptions = {
      ...options.engine,
      physicsMode: options.physicsMode ?? options.engine?.physicsMode,
      includeAudioEvents: options.engine?.includeAudioEvents ?? needsRuntimeFrame,
      enablePhysicsDebugLines:
        options.engine?.enablePhysicsDebugLines ??
        (options.engine?.includePhysicsDebugLines === true || runtimePhysicsDebugLines),
    };

    const runtimeRenderer = renderer;
    const runtimeInput = input;
    const runtimeAssetHost = assetHost;
    runtimeRenderer.resize();
    configureStaticLighting(runtimeRenderer, options.lighting);
    configureStaticPostProcess(runtimeRenderer, options.postProcess);
    configureStaticSpriteMaterial(runtimeRenderer, options.spriteMaterial);
    detachRendererResize = observeRendererResize(options.canvas, runtimeRenderer);

    const inputProvider: InputProvider = () => {
      const snapshot = runtimeInput.snapshot();
      return options.inputTransform?.(snapshot) ?? snapshot;
    };

    const engine = await createEngine((frame) => {
      const renderStartMs = needsRuntimeFrame ? performance.now() : 0;
      if (typeof options.lighting === "function") {
        runtimeRenderer.setLighting?.(options.lighting(frame));
      }
      if (typeof options.spriteMaterial === "function") {
        runtimeRenderer.setSpriteMaterial?.(options.spriteMaterial(frame));
      }
      if (typeof options.postProcess === "function") {
        runtimeRenderer.setPostProcess?.(options.postProcess(frame));
      }
      runtimeRenderer.render();
      let rendererStats = runtimeRenderer.renderCommands(frame.renderCommandBuffer);
      if (shouldRenderPhysicsDebugLines) {
        rendererStats = runtimeRenderer.renderPhysicsDebugLines(frame.physicsDebugLineBuffer, {
          x: frame.cameraX,
          y: frame.cameraY,
        });
      }
      rendererStats = runtimeRenderer.renderPostProcess?.() ?? rendererStats;
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
      profiler?.recordFrame(debugMetrics);
      options.onFrame?.(runtimeFrame);
    }, inputProvider, runtimeAssetHost, () => runtimeRenderer.viewportSize(), engineOptions);
    let physicsScene: PhysicsSceneProfileApplyResult | undefined;
    if (options.physicsScene !== undefined && options.physicsScene !== false) {
      try {
        physicsScene = applyPhysicsSceneProfile(engine, options.physicsScene);
      } catch (error) {
        engine.destroy();
        throw error;
      }
    }

    const runtime: FerrumRuntime = {
      engine,
      renderer: runtimeRenderer,
      input: runtimeInput,
      assetHost: runtimeAssetHost,
      ...(profiler === undefined ? {} : { profiler }),
      ...(physicsScene === undefined ? {} : { physicsScene }),
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
        physicsScene?.clear();
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

function configureStaticLighting(
  renderer: FerrumRuntimeRenderer,
  lighting: FerrumRuntimeOptions["lighting"],
): void {
  if (lighting !== undefined && typeof lighting !== "function") {
    renderer.setLighting?.(lighting);
  }
}

function configureStaticSpriteMaterial(
  renderer: FerrumRuntimeRenderer,
  spriteMaterial: FerrumRuntimeOptions["spriteMaterial"],
): void {
  if (spriteMaterial !== undefined && typeof spriteMaterial !== "function") {
    renderer.setSpriteMaterial?.(spriteMaterial);
  }
}

function configureStaticPostProcess(
  renderer: FerrumRuntimeRenderer,
  postProcess: FerrumRuntimeOptions["postProcess"],
): void {
  if (postProcess !== undefined && typeof postProcess !== "function") {
    renderer.setPostProcess?.(postProcess);
  }
}

function webGpuOptionsWithStaticPostProcess(options: FerrumRuntimeOptions): WebGPURendererOptions | undefined {
  if (options.postProcess === undefined || typeof options.postProcess === "function") {
    return options.webgpu;
  }
  return {
    ...options.webgpu,
    postProcess: options.postProcess,
  };
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

function createRuntimeProfiler(option: FerrumRuntimeOptions["profiler"]): RuntimeProfiler | undefined {
  if (option === undefined || option === false) {
    return undefined;
  }
  if (option === true) {
    return new RuntimeProfiler();
  }
  if (option instanceof RuntimeProfiler) {
    return option;
  }
  return new RuntimeProfiler(option);
}

function observeRendererResize(canvas: HTMLCanvasElement, renderer: FerrumRuntimeRenderer): () => void {
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
    lightingDrawCalls: rendererStats.lightingDrawCalls,
    pointLightCount: rendererStats.pointLightCount,
    tileOccluderCount: rendererStats.tileOccluderCount,
    shadowDrawCalls: rendererStats.shadowDrawCalls,
    shadowCasterCount: rendererStats.shadowCasterCount,
    postProcessDrawCalls: rendererStats.postProcessDrawCalls,
    postProcessPassCount: rendererStats.postProcessPassCount,
    physicsDebugLineCount: rendererStats.physicsDebugLineCount,
    audioEventsPerSecond,
    physicsMode: frame.physics.mode,
    physicsFixedSteps: frame.physics.fixedSteps,
    physicsKinematicHits: frame.physics.kinematicHits,
    physicsTileCandidateChecks: frame.physics.tileCandidateChecks,
    collisionPairCount: frame.physics.collisionPairs,
    collisionEventCount: frame.physics.collisionEventCount,
    physicsCcdChecks: frame.physics.ccdChecks,
    physicsCcdHits: frame.physics.ccdHits,
    physicsSleepingBodies: frame.physics.sleepingBodies,
    physicsBrokenJoints: frame.physics.brokenJoints,
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
