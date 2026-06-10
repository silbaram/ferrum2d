import { BrowserPlatformHost } from "./browserPlatformHost.js";
import { createEngineWithFramePipeline } from "./createEngine.js";
import type {
  AssetHost,
  CreateEngineOptions,
  FerrumEngine,
  FrameState,
  InputProvider,
  PhysicsDebugOptions,
} from "./engineTypes.js";
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
import { createRuntimeLevelStreaming } from "./levelStreamingRuntime.js";
import type {
  FerrumRuntimeLevelStreaming,
  FerrumRuntimeLevelStreamingOptions,
} from "./levelStreamingRuntime.js";
import type { LevelChunkStreamer } from "./levelStreamingStreamer.js";
import { createRenderer } from "./createRenderer.js";
import type { CreatedRenderer } from "./createRenderer.js";
import type { RendererStats } from "./renderer.js";
import type { TextureAssetManager } from "./assetLoader.js";
import { AnimationTimelinePlayer } from "./animationTimeline.js";
import type {
  AnimationTimelinePlayerSnapshot,
  AnimationTimelineSpec,
  AnimationTimelineUpdateResult,
  ResolvedAnimationTimelineSpec,
} from "./animationTimeline.js";
import {
  accessibilitySubtitlePanel,
  readAccessibilityEnvironment,
  resolveAccessibilityOptions,
} from "./accessibilityOptions.js";
import type {
  AccessibilityOptionsSpec,
  AccessibilitySubtitleSpec,
  ResolveAccessibilityOptionsOptions,
  ResolvedAccessibilityOptions,
} from "./accessibilityOptions.js";
import { CutsceneSequencePlayer } from "./cutsceneSequence.js";
import type {
  CutsceneSequencePlayerSnapshot,
  CutsceneSequenceSpec,
  CutsceneSequenceTarget,
  CutsceneSequenceUpdateResult,
  ResolvedCutsceneDialogueCommand,
  ResolvedCutsceneSequenceSpec,
} from "./cutsceneSequence.js";
import { DialogueSession, dialogueNodeToUiOverlayState } from "./dialogueQuest.js";
import type {
  DialogueChoiceResult,
  DialogueGraphSpec,
  DialogueSessionSnapshot,
  DialogueUiOptions,
  ResolvedDialogueGraph,
} from "./dialogueQuest.js";
import { LocalizationBundle } from "./localization.js";
import type {
  LocalizeOptions,
  LocalizationDocumentSpec,
  LocalizationPlaceholderValue,
  MissingLocalizationBehavior,
  ResolvedLocalizationDocument,
} from "./localization.js";
import { createHudOverlayState } from "./hudToolkit.js";
import type { CreateHudOverlayStateOptions, HudComponentSpec } from "./hudToolkit.js";
import { UiOverlay } from "./uiOverlay.js";
import type { UiOverlayActionEvent, UiOverlayOptions, UiOverlayState } from "./uiOverlay.js";
import type { WebGL2RendererOptions } from "./webgl2Renderer.js";
import type { WebGPURendererOptions } from "./webgpuRenderer.js";
import type { PhysicsDebugLineCamera } from "./physicsDebugLineBatch.js";
import type { PhysicsDebugLineBufferView, RenderCommandBufferView } from "./wasmBridge.js";
import { RuntimeFrameRenderer } from "./runtimeFrameRenderer.js";
import { playRuntimeCutsceneAudio } from "./runtimeCutsceneAudio.js";

export type FerrumRuntimeRenderer = CreatedRenderer & TextureAssetManager & {
  renderCommands(commands: RenderCommandBufferView): RendererStats;
  renderPhysicsDebugLines(lines: PhysicsDebugLineBufferView, camera: PhysicsDebugLineCamera): RendererStats;
  viewportSize(): { width: number; height: number };
  setLighting?(scene: LightingScene2D | false | undefined): void;
  setPostProcess?(postProcess: PostProcessStackInput): void;
  renderPostProcess?(postProcess?: PostProcessStackInput): RendererStats;
  setSpriteMaterial?(material: SpriteMaterialPresetInput): void;
};

export type {
  FerrumRuntimeLevelStreaming,
  FerrumRuntimeLevelStreamingChunkContext,
  FerrumRuntimeLevelStreamingOptions,
  FerrumRuntimeLevelStreamingPreloadOptions,
  FerrumRuntimeLevelStreamingTarget,
  FerrumRuntimeLevelStreamingUpdateResult,
  FerrumRuntimeLevelStreamingViewportProvider,
} from "./levelStreamingRuntime.js";

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
export type FerrumRuntimeHudComponentProvider =
  (frame: FerrumRuntimeFrame) => readonly HudComponentSpec[] | false | undefined;
export type FerrumRuntimeSubtitleProvider =
  (frame: FerrumRuntimeFrame) => AccessibilitySubtitleSpec | false | undefined;
export type FerrumRuntimeAnimationTimelineSignalProvider =
  (frame: FerrumRuntimeFrame) => readonly string[] | false | undefined;

export interface FerrumRuntimeDialogueOptions {
  graph: DialogueGraphSpec | ResolvedDialogueGraph;
  session?: DialogueSession;
  ui?: DialogueUiOptions;
  onChoice?: (result: DialogueChoiceResult, session: DialogueSession) => void;
}

export interface FerrumRuntimeDialogue {
  session: DialogueSession;
  choose(choiceId: string): DialogueChoiceResult;
  snapshot(): DialogueSessionSnapshot;
  uiState(): UiOverlayState;
}

export interface FerrumRuntimeLocalizationOptions {
  document?: LocalizationDocumentSpec | ResolvedLocalizationDocument;
  bundle?: LocalizationBundle;
  locale?: string;
}

export interface FerrumRuntimeLocalization {
  bundle: LocalizationBundle;
  locale(): string;
  setLocale(locale: string): void;
  t(key: string, options?: LocalizeOptions): string;
}

export type FerrumRuntimeCutsceneTextMode = "literal" | "localizationKey";

export type FerrumRuntimeCutsceneDialogueValues =
  | Readonly<Record<string, LocalizationPlaceholderValue>>
  | ((command: ResolvedCutsceneDialogueCommand, frame: FerrumRuntimeFrame) =>
    Readonly<Record<string, LocalizationPlaceholderValue>> | undefined);

export interface FerrumRuntimeCutsceneDialogueOptions {
  dialogId?: string;
  title?: string;
  textMode?: FerrumRuntimeCutsceneTextMode;
  values?: FerrumRuntimeCutsceneDialogueValues;
  missing?: MissingLocalizationBehavior;
}

export interface FerrumRuntimeCutsceneOptions {
  sequence: CutsceneSequenceSpec | ResolvedCutsceneSequenceSpec;
  player?: CutsceneSequencePlayer;
  target?: CutsceneSequenceTarget;
  maxCommandsPerFrame?: number;
  dialogue?: false | FerrumRuntimeCutsceneDialogueOptions;
  audio?: boolean;
  paused?: boolean;
  onUpdate?: (
    result: CutsceneSequenceUpdateResult,
    frame: FerrumRuntimeFrame,
    cutscene: FerrumRuntimeCutscene,
  ) => void;
}

export interface FerrumRuntimeCutscene {
  player: CutsceneSequencePlayer;
  update(frame: FerrumRuntimeFrame): CutsceneSequenceUpdateResult | undefined;
  snapshot(): CutsceneSequencePlayerSnapshot;
  reset(): CutsceneSequencePlayerSnapshot;
  skip(): CutsceneSequencePlayerSnapshot;
  pause(): void;
  resume(): void;
  paused(): boolean;
  uiState(): UiOverlayState | undefined;
}

export interface FerrumRuntimeHudOptions extends CreateHudOverlayStateOptions {
  components: readonly HudComponentSpec[] | FerrumRuntimeHudComponentProvider;
}

export interface FerrumRuntimeHud {
  uiState(frame: FerrumRuntimeFrame): UiOverlayState | undefined;
}

export interface FerrumRuntimeAccessibilityOptions extends ResolveAccessibilityOptionsOptions {
  spec?: AccessibilityOptionsSpec | ResolvedAccessibilityOptions;
  subtitle?: false | AccessibilitySubtitleSpec | FerrumRuntimeSubtitleProvider;
  title?: string;
  applyUiTheme?: boolean;
}

export interface FerrumRuntimeAccessibility {
  options: ResolvedAccessibilityOptions;
  applyUiTheme: boolean;
  uiState(frame: FerrumRuntimeFrame): UiOverlayState | undefined;
}

export interface FerrumRuntimeAnimationTimelineOptions {
  timeline?: AnimationTimelineSpec | ResolvedAnimationTimelineSpec;
  player?: AnimationTimelinePlayer;
  signals?: readonly string[] | FerrumRuntimeAnimationTimelineSignalProvider;
  maxEvents?: number;
  paused?: boolean;
  onUpdate?: (
    result: AnimationTimelineUpdateResult,
    frame: FerrumRuntimeFrame,
    animationTimeline: FerrumRuntimeAnimationTimeline,
  ) => void;
}

export interface FerrumRuntimeAnimationTimeline {
  player: AnimationTimelinePlayer;
  update(frame: FerrumRuntimeFrame): AnimationTimelineUpdateResult | undefined;
  signal(signal: string): AnimationTimelineUpdateResult;
  snapshot(): AnimationTimelinePlayerSnapshot;
  pause(): void;
  resume(): void;
  paused(): boolean;
}

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
  hud?: false | FerrumRuntimeHudOptions | readonly HudComponentSpec[] | FerrumRuntimeHudComponentProvider;
  accessibility?: false | AccessibilityOptionsSpec | ResolvedAccessibilityOptions | FerrumRuntimeAccessibilityOptions;
  animationTimeline?:
    | false
    | AnimationTimelinePlayer
    | AnimationTimelineSpec
    | ResolvedAnimationTimelineSpec
    | FerrumRuntimeAnimationTimelineOptions;
  localization?: false | FerrumRuntimeLocalizationOptions | LocalizationBundle;
  dialogue?: false | FerrumRuntimeDialogueOptions;
  cutscene?: false | FerrumRuntimeCutsceneOptions;
  levelStreaming?: false | FerrumRuntimeLevelStreamingOptions | LevelChunkStreamer;
  physicsDebugLines?: boolean | PhysicsDebugOptions;
  physicsMode?: PhysicsMode;
  physicsScene?: PhysicsSceneProfileSpec | false;
  environment?: FerrumRuntimeEnvironment;
  engine?: CreateEngineOptions;
  engineInstance?: FerrumEngine;
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
  hud?: FerrumRuntimeHud;
  accessibility?: FerrumRuntimeAccessibility;
  animationTimeline?: FerrumRuntimeAnimationTimeline;
  localization?: FerrumRuntimeLocalization;
  dialogue?: FerrumRuntimeDialogue;
  cutscene?: FerrumRuntimeCutscene;
  levelStreaming?: FerrumRuntimeLevelStreaming;
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
  const ownsEngine = options.engineInstance === undefined;
  let renderer: FerrumRuntimeRenderer | undefined = options.renderer;
  let input: InputManager | undefined = options.input;
  let assetHost: AssetHost | undefined = options.assetHost;
  let uiOverlay: UiOverlay | undefined = options.uiOverlay;
  let debugOverlay: DebugOverlay | undefined;
  let detachRendererResize: (() => void) | undefined;
  let engine: FerrumEngine | undefined = options.engineInstance;

  let destroyed = false;

  try {
    renderer ??= await createRenderer(options.canvas, {
      preferred: options.rendererPreference ?? "webgl2",
      webgl2: options.webgl2,
      webgpu: webGpuOptionsWithStaticPostProcess(options),
    });
    const runtimeRenderer = renderer;
    input ??= new InputManager(options.canvas, options.inputOptions);
    assetHost ??= new BrowserPlatformHost(runtimeRenderer);
    const profiler = createRuntimeProfiler(options.profiler);
    const accessibility = createRuntimeAccessibility(options.accessibility);
    const hud = createRuntimeHud(options.hud);
    const animationTimeline = createRuntimeAnimationTimeline(options.animationTimeline);
    const localization = createRuntimeLocalization(options.localization);
    const dialogue = createRuntimeDialogue(options.dialogue);
    const cutscene = createRuntimeCutscene(options.cutscene, localization, assetHost);
    const levelStreaming = createRuntimeLevelStreamingOption(
      options.levelStreaming,
      () => runtimeRenderer.viewportSize(),
      (progress) => profiler?.recordAssetProgress(progress),
    );
    const uiCutscene = runtimeCutsceneUsesUi(options.cutscene) ? cutscene : undefined;
    const runtimeUiState = createRuntimeUiStateProvider(options.uiState, hud, accessibility, dialogue, uiCutscene);
    uiOverlay ??= createUiOverlay(options, hud, accessibility, dialogue, uiCutscene);
    debugOverlay = createDebugOverlay(options);
    const needsRuntimeFrame =
      debugOverlay !== undefined
      || uiOverlay !== undefined
      || options.onFrame !== undefined
      || profiler !== undefined
      || hud !== undefined
      || accessibility !== undefined
      || animationTimeline !== undefined
      || cutscene !== undefined
      || levelStreaming !== undefined;
    const hasDynamicFrameProviders =
      typeof options.lighting === "function"
      || typeof options.spriteMaterial === "function"
      || typeof options.postProcess === "function";
    const needsFullFrame = needsRuntimeFrame || hasDynamicFrameProviders;
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
    const runtimeFrameRenderer = new RuntimeFrameRenderer({
      renderer: runtimeRenderer,
      lighting: options.lighting,
      postProcess: options.postProcess,
      spriteMaterial: options.spriteMaterial,
      shouldRenderPhysicsDebugLines,
      needsRuntimeFrame,
      debugOverlay,
      uiOverlay,
      uiState: runtimeUiState,
      animationTimeline,
      cutscene,
      levelStreaming,
      profiler,
      gameStateLabel: options.gameStateLabel,
      onFrame: options.onFrame,
    });

    engine ??= await createEngineWithFramePipeline({
      needsFrameState: needsFullFrame,
      needsPhysicsDebugLineBuffer: shouldRenderPhysicsDebugLines,
      onRenderFrame: (renderFrame) => runtimeFrameRenderer.renderFrame(renderFrame),
    }, inputProvider, runtimeAssetHost, () => runtimeRenderer.viewportSize(), engineOptions);
    let physicsScene: PhysicsSceneProfileApplyResult | undefined;
    if (options.physicsScene !== undefined && options.physicsScene !== false) {
      physicsScene = applyPhysicsSceneProfile(engine, options.physicsScene);
    }

    const runtimeEngine = engine;
    const runtime: FerrumRuntime = {
      engine: runtimeEngine,
      renderer: runtimeRenderer,
      input: runtimeInput,
      assetHost: runtimeAssetHost,
      ...(profiler === undefined ? {} : { profiler }),
      ...(physicsScene === undefined ? {} : { physicsScene }),
      ...(hud === undefined ? {} : { hud }),
      ...(accessibility === undefined ? {} : { accessibility }),
      ...(animationTimeline === undefined ? {} : { animationTimeline }),
      ...(localization === undefined ? {} : { localization }),
      ...(dialogue === undefined ? {} : { dialogue }),
      ...(cutscene === undefined ? {} : { cutscene }),
      ...(levelStreaming === undefined ? {} : { levelStreaming }),
      uiOverlay,
      debugOverlay,
      start: () => runtimeEngine.start(),
      pause: () => runtimeEngine.pause(),
      resume: () => runtimeEngine.resume(),
      stop: () => runtimeEngine.stop(),
      destroy: () => {
        if (destroyed) {
          return;
        }
        destroyed = true;
        detachRendererResize?.();
        detachRendererResize = undefined;
        levelStreaming?.destroy();
        physicsScene?.clear();
        if (ownsEngine) runtimeEngine.destroy();
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
    if (ownsEngine) engine?.destroy();
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

function createUiOverlay(
  options: FerrumRuntimeOptions,
  hud: FerrumRuntimeHud | undefined,
  accessibility: FerrumRuntimeAccessibility | undefined,
  dialogue: FerrumRuntimeDialogue | undefined,
  cutscene: FerrumRuntimeCutscene | undefined,
): UiOverlay | undefined {
  if (options.ui === false) {
    return undefined;
  }
  if (
    options.ui === undefined
    && options.uiState === undefined
    && hud === undefined
    && accessibility === undefined
    && dialogue === undefined
    && cutscene === undefined
  ) {
    return undefined;
  }
  const uiOptions = createUiOverlayOptions(options.ui, accessibility, dialogue);
  if (uiOptions.enabled === false) {
    return undefined;
  }
  return new UiOverlay(
    options.uiParent ?? options.canvas.parentElement ?? document.body,
    uiOptions,
  );
}

function createUiOverlayOptions(
  ui: true | UiOverlayOptions | undefined,
  accessibility: FerrumRuntimeAccessibility | undefined,
  dialogue: FerrumRuntimeDialogue | undefined,
): UiOverlayOptions {
  const uiOptions: UiOverlayOptions = ui === true || ui === undefined
    ? { enabled: true }
    : ui;
  const themedUiOptions = accessibility !== undefined
    && runtimeAccessibilityAppliesUiTheme(accessibility)
    && uiOptions.theme === undefined
    ? { ...uiOptions, theme: accessibility.options.contrastPalette.hudTheme }
    : uiOptions;
  if (dialogue === undefined) {
    return themedUiOptions;
  }

  return {
    ...themedUiOptions,
    onAction: (event) => {
      if (isDialogueChoiceAction(dialogue, event)) {
        dialogue.choose(event.id);
        return;
      }
      themedUiOptions.onAction?.(event);
    },
  };
}

function createRuntimeHud(
  option: FerrumRuntimeOptions["hud"],
): FerrumRuntimeHud | undefined {
  if (option === undefined || option === false) {
    return undefined;
  }
  const hudOptions: FerrumRuntimeHudOptions = typeof option === "function" || isHudComponentArray(option)
    ? { components: option }
    : option;
  return {
    uiState: (frame) => {
      const components = typeof hudOptions.components === "function"
        ? hudOptions.components(frame)
        : hudOptions.components;
      if (components === false || components === undefined) {
        return undefined;
      }
      return createHudOverlayState(components, hudOptions);
    },
  };
}

function createRuntimeAccessibility(
  option: FerrumRuntimeOptions["accessibility"],
): FerrumRuntimeAccessibility | undefined {
  if (option === undefined || option === false) {
    return undefined;
  }
  const runtimeOptions = normalizeRuntimeAccessibilityOptions(option);
  const options = isResolvedAccessibilityOptions(runtimeOptions.spec)
    ? runtimeOptions.spec
    : resolveAccessibilityOptions(runtimeOptions.spec ?? {}, {
        environment: runtimeOptions.environment ?? readAccessibilityEnvironment(),
        path: runtimeOptions.path,
      });
  return {
    options,
    applyUiTheme: runtimeOptions.applyUiTheme !== false,
    uiState: (frame) => {
      const subtitle = typeof runtimeOptions.subtitle === "function"
        ? runtimeOptions.subtitle(frame)
        : runtimeOptions.subtitle;
      if (subtitle === undefined || subtitle === false) {
        return undefined;
      }
      const panel = accessibilitySubtitlePanel(subtitle, {
        accessibility: options,
        title: runtimeOptions.title,
        path: runtimeOptions.path === undefined ? undefined : `${runtimeOptions.path}.subtitle`,
      });
      return panel === undefined ? undefined : { panels: [panel] };
    },
  };
}

function createRuntimeAnimationTimeline(
  option: FerrumRuntimeOptions["animationTimeline"],
): FerrumRuntimeAnimationTimeline | undefined {
  if (option === undefined || option === false) {
    return undefined;
  }
  const runtimeOptions = normalizeRuntimeAnimationTimelineOptions(option);
  const player = runtimeOptions.player ?? (runtimeOptions.timeline === undefined
    ? undefined
    : AnimationTimelinePlayer.create(runtimeOptions.timeline));
  if (player === undefined) {
    throw new Error("FerrumRuntime animationTimeline requires a player or timeline.");
  }
  let isPaused = runtimeOptions.paused ?? false;
  let animationTimeline: FerrumRuntimeAnimationTimeline;
  animationTimeline = {
    player,
    update: (frame) => {
      if (isPaused) {
        return undefined;
      }
      const signals = typeof runtimeOptions.signals === "function"
        ? runtimeOptions.signals(frame)
        : runtimeOptions.signals;
      const result = player.update(frame.frame.frameTimeMs / 1000, {
        signals: signals === false ? undefined : signals,
        maxEvents: runtimeOptions.maxEvents,
      });
      runtimeOptions.onUpdate?.(result, frame, animationTimeline);
      return result;
    },
    signal: (signal) => player.signal(signal),
    snapshot: () => player.snapshot(),
    pause: () => {
      isPaused = true;
    },
    resume: () => {
      isPaused = false;
    },
    paused: () => isPaused,
  };
  return animationTimeline;
}

function normalizeRuntimeAccessibilityOptions(
  option: Exclude<FerrumRuntimeOptions["accessibility"], false | undefined>,
): FerrumRuntimeAccessibilityOptions {
  if (isRuntimeAccessibilityOptions(option)) {
    return option;
  }
  return { spec: option };
}

function normalizeRuntimeAnimationTimelineOptions(
  option: Exclude<FerrumRuntimeOptions["animationTimeline"], false | undefined>,
): FerrumRuntimeAnimationTimelineOptions {
  if (option instanceof AnimationTimelinePlayer) {
    return { player: option };
  }
  if (isRuntimeAnimationTimelineOptions(option)) {
    return option;
  }
  return { timeline: option };
}

function isRuntimeAccessibilityOptions(value: unknown): value is FerrumRuntimeAccessibilityOptions {
  return isObject(value)
    && (
      "spec" in value
      || "subtitle" in value
      || "title" in value
      || "environment" in value
      || "path" in value
      || "applyUiTheme" in value
    );
}

function isRuntimeAnimationTimelineOptions(value: unknown): value is FerrumRuntimeAnimationTimelineOptions {
  return isObject(value)
    && (
      "timeline" in value
      || "player" in value
      || "signals" in value
      || "maxEvents" in value
      || "paused" in value
      || "onUpdate" in value
    );
}

function isHudComponentArray(value: unknown): value is readonly HudComponentSpec[] {
  return Array.isArray(value);
}

function runtimeAccessibilityAppliesUiTheme(accessibility: FerrumRuntimeAccessibility): boolean {
  return accessibility.applyUiTheme;
}

function isResolvedAccessibilityOptions(value: unknown): value is ResolvedAccessibilityOptions {
  return isObject(value)
    && typeof value.reducedMotion === "boolean"
    && typeof value.subtitles === "boolean"
    && isObject(value.contrastPalette)
    && isObject(value.inputAssist);
}

function createRuntimeLocalization(
  options: FerrumRuntimeOptions["localization"],
): FerrumRuntimeLocalization | undefined {
  if (options === undefined || options === false) {
    return undefined;
  }
  const bundle = options instanceof LocalizationBundle
    ? options
    : options.bundle ?? (options.document === undefined
      ? undefined
      : new LocalizationBundle(options.document, options.locale));
  if (bundle === undefined) {
    throw new Error("FerrumRuntime localization requires a bundle or document.");
  }
  if (!(options instanceof LocalizationBundle) && options.locale !== undefined) {
    bundle.setLocale(options.locale);
  }
  return {
    bundle,
    locale: () => bundle.locale(),
    setLocale: (locale) => bundle.setLocale(locale),
    t: (key, localizeOptions) => bundle.t(key, localizeOptions),
  };
}

function createRuntimeDialogue(
  options: FerrumRuntimeOptions["dialogue"],
): FerrumRuntimeDialogue | undefined {
  if (options === undefined || options === false) {
    return undefined;
  }

  const session = options.session ?? new DialogueSession(options.graph);
  const uiOptions = options.ui;
  return {
    session,
    choose: (choiceId) => {
      const result = session.choose(choiceId);
      options.onChoice?.(result, session);
      return result;
    },
    snapshot: () => session.snapshot(),
    uiState: () => dialogueNodeToUiOverlayState(session, uiOptions),
  };
}

function createRuntimeCutscene(
  options: FerrumRuntimeOptions["cutscene"],
  localization: FerrumRuntimeLocalization | undefined,
  assetHost: AssetHost,
): FerrumRuntimeCutscene | undefined {
  if (options === undefined || options === false) {
    return undefined;
  }

  const player = options.player ?? CutsceneSequencePlayer.create(options.sequence);
  const target = createRuntimeCutsceneTarget(options, assetHost);
  let isPaused = options.paused ?? false;
  let lastUiState: UiOverlayState | undefined;
  let cutscene: FerrumRuntimeCutscene;

  cutscene = {
    player,
    update: (frame) => {
      if (isPaused || player.snapshot().completed) {
        lastUiState = undefined;
        return undefined;
      }
      const result = player.update(frame.frame.frameTimeMs / 1000, {
        maxCommands: options.maxCommandsPerFrame,
        target,
      });
      lastUiState = cutsceneUiStateForUpdateResult(result, options.dialogue, localization, frame);
      options.onUpdate?.(result, frame, cutscene);
      return result;
    },
    snapshot: () => player.snapshot(),
    reset: () => {
      lastUiState = undefined;
      return player.reset();
    },
    skip: () => {
      const snapshot = player.skip();
      lastUiState = undefined;
      return snapshot;
    },
    pause: () => {
      isPaused = true;
    },
    resume: () => {
      isPaused = false;
    },
    paused: () => isPaused,
    uiState: () => lastUiState,
  };
  return cutscene;
}

function createRuntimeLevelStreamingOption(
  options: FerrumRuntimeOptions["levelStreaming"],
  viewportSize: () => { width: number; height: number },
  onAssetProgress: Parameters<typeof createRuntimeLevelStreaming>[2],
): FerrumRuntimeLevelStreaming | undefined {
  if (options === undefined || options === false) {
    return undefined;
  }
  return createRuntimeLevelStreaming(options, viewportSize, onAssetProgress);
}

function runtimeCutsceneUsesUi(options: FerrumRuntimeOptions["cutscene"]): boolean {
  return options !== undefined && options !== false && options.dialogue !== false;
}

function createRuntimeCutsceneTarget(
  options: FerrumRuntimeCutsceneOptions,
  assetHost: AssetHost,
): CutsceneSequenceTarget {
  const userTarget = options.target;
  const playHostAudio = options.audio !== false;
  return {
    onCutsceneCommand: (event) => userTarget?.onCutsceneCommand?.(event),
    moveCamera: (command, event) => userTarget?.moveCamera?.(command, event),
    playCutsceneAudio: (command, event) => {
      if (playHostAudio) {
        playRuntimeCutsceneAudio(command, assetHost);
      }
      userTarget?.playCutsceneAudio?.(command, event);
    },
    showCutsceneDialogue: (command, event) => userTarget?.showCutsceneDialogue?.(command, event),
  };
}

function cutsceneUiStateForSnapshot(
  snapshot: CutsceneSequencePlayerSnapshot,
  dialogue: FerrumRuntimeCutsceneOptions["dialogue"],
  localization: FerrumRuntimeLocalization | undefined,
  frame: FerrumRuntimeFrame,
): UiOverlayState | undefined {
  if (dialogue === false || snapshot.currentCommand?.kind !== "dialogue") {
    return undefined;
  }
  return cutsceneUiStateForDialogueCommand(snapshot.sequenceId, snapshot.currentCommand, dialogue ?? {}, localization, frame);
}

function cutsceneUiStateForUpdateResult(
  result: CutsceneSequenceUpdateResult,
  dialogue: FerrumRuntimeCutsceneOptions["dialogue"],
  localization: FerrumRuntimeLocalization | undefined,
  frame: FerrumRuntimeFrame,
): UiOverlayState | undefined {
  const snapshotState = cutsceneUiStateForSnapshot(result.snapshot, dialogue, localization, frame);
  if (snapshotState !== undefined || dialogue === false) {
    return snapshotState;
  }
  const zeroDurationDialogueEvent = [...result.events]
    .reverse()
    .find((event) => event.command.kind === "dialogue" && event.command.durationSeconds === 0);
  if (zeroDurationDialogueEvent?.command.kind !== "dialogue") {
    return undefined;
  }
  return cutsceneUiStateForDialogueCommand(
    zeroDurationDialogueEvent.sequenceId,
    zeroDurationDialogueEvent.command,
    dialogue ?? {},
    localization,
    frame,
  );
}

function cutsceneUiStateForDialogueCommand(
  sequenceId: string,
  command: ResolvedCutsceneDialogueCommand,
  options: FerrumRuntimeCutsceneDialogueOptions,
  localization: FerrumRuntimeLocalization | undefined,
  frame: FerrumRuntimeFrame,
): UiOverlayState {
  return {
    dialog: {
      id: options.dialogId ?? `${sequenceId}:${command.id}`,
      title: options.title ?? command.speaker ?? "Cutscene",
      body: cutsceneDialogueBody(command, options, localization, frame),
    },
  };
}

function cutsceneDialogueBody(
  command: ResolvedCutsceneDialogueCommand,
  options: FerrumRuntimeCutsceneDialogueOptions,
  localization: FerrumRuntimeLocalization | undefined,
  frame: FerrumRuntimeFrame,
): string {
  if (command.text === undefined) {
    return command.nodeId ?? "";
  }
  if (options.textMode !== "localizationKey") {
    return command.text;
  }
  const values = typeof options.values === "function"
    ? options.values(command, frame)
    : options.values;
  return localization?.t(command.text, {
    values,
    fallback: command.text,
    missing: options.missing ?? "fallback",
  }) ?? command.text;
}

function createRuntimeUiStateProvider(
  baseProvider: UiOverlayStateProvider | undefined,
  hud: FerrumRuntimeHud | undefined,
  accessibility: FerrumRuntimeAccessibility | undefined,
  dialogue: FerrumRuntimeDialogue | undefined,
  cutscene: FerrumRuntimeCutscene | undefined,
): UiOverlayStateProvider | undefined {
  if (hud === undefined && accessibility === undefined && dialogue === undefined && cutscene === undefined) {
    return baseProvider;
  }
  return (frame) => mergeUiOverlayStates(
    baseProvider?.(frame),
    hud?.uiState(frame),
    accessibility?.uiState(frame),
    dialogue?.uiState(),
    cutscene?.uiState(),
  );
}

function mergeUiOverlayStates(
  ...states: readonly (UiOverlayState | undefined)[]
): UiOverlayState {
  const visibleStates = states.filter((state): state is UiOverlayState => state !== undefined);
  return {
    panels: visibleStates.flatMap((state) => [...(state.panels ?? [])]),
    dialog: visibleStates.find((state) => state.dialog !== undefined)?.dialog,
  };
}

function isDialogueChoiceAction(dialogue: FerrumRuntimeDialogue, event: UiOverlayActionEvent): boolean {
  const dialogId = dialogue.uiState().dialog?.id;
  if (dialogId === undefined || event.dialogId !== dialogId) {
    return false;
  }
  return dialogue.session.availableChoices().some((choice) => choice.id === event.id);
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

function destroyAssetHost(assetHost: AssetHost): void {
  const maybeDestroyable = assetHost as AssetHost & { destroy?: () => void };
  maybeDestroyable.destroy?.();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
