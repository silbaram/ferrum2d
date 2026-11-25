import type { ShaderPreparationOptions } from "./shaderPreparation";
import type { AssetLoadOptions, AssetLoadProgressCallback, AssetManifest, LoadedAssets } from "./assetLoader.js";
import { BrowserPlatformHost } from "./browserPlatformHost.js";
import { createEngineWithFramePipeline } from "./createEngine.js";
import { initializeFerrumWasm } from "./initializeFerrumWasm.js";
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
  FerrumRuntimeLevelStreamingTarget,
} from "./levelStreamingRuntime.js";
import { LevelChunkStreamer } from "./levelStreamingStreamer.js";
import { createRuntimeRenderer, resolveRendererColorManagement, resolveRendererPixelPerfect } from "./createRenderer.js";
import type { RendererFallbackInfo } from "./createRenderer.js";
import { pixelPerfectPointToViewport, type PixelPerfectOptions } from "./pixelPerfect.js";
import { resolveSceneDisplay, resolveSceneFit, type SceneFitSpec } from "./sceneDisplay.js";
import { bindDataSceneView, fitDataSceneZoom, type DataSceneView } from "./dataSceneView.js";
import { sceneCompositionDiagnosticError } from "./diagnostics.js";
import type { RendererStats } from "./renderer.js";
import type { FerrumRuntimeRenderer } from "./runtimeRenderer.js";
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
import { WebGL2Renderer, type WebGL2RendererOptions } from "./webgl2Renderer.js";
import type { ColorManagementMode } from "./colorManagement.js";
import { WebGPURenderer, type WebGPURendererOptions } from "./webgpuRenderer.js";
import type { PhysicsDebugLineBufferView } from "./wasmBridge.js";
import { RuntimeFrameRenderer } from "./runtimeFrameRenderer.js";
import { playRuntimeCutsceneAudio } from "./runtimeCutsceneAudio.js";
import {
  applyDataSceneAuthoringDocument,
  applyDataSceneAuthoringDocumentWithCommit,
  type ApplyDataSceneAuthoringDocumentOptions,
  type ApplyDataSceneAuthoringDocumentResult,
} from "./dataSceneRuntimeTarget.js";
import type {
  ResolvedSceneAuthoringDocument,
  SceneAuthoringDocumentSpec,
} from "./sceneAuthoringDocument.js";
import type { DataSceneVariableStore } from "./dataSceneVariables.js";
import type { DataSceneGameState, GameStateCode } from "./gameState.js";

export type { FerrumRuntimeRenderer } from "./runtimeRenderer.js";

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
/** Debug pass가 활성화된 프레임에서 Rust line buffer와 추가 gizmo line을 합성합니다. */
export type PhysicsDebugLineComposer = (
  lines: PhysicsDebugLineBufferView,
) => PhysicsDebugLineBufferView;
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

export interface FerrumRuntimeDataSceneOptions extends ApplyDataSceneAuthoringDocumentOptions {
  document: SceneAuthoringDocumentSpec | ResolvedSceneAuthoringDocument;
}

export interface FerrumRuntimeDataScene {
  readonly result: ApplyDataSceneAuthoringDocumentResult;
  readonly variables: DataSceneVariableStore;
  /** View bound to this runtime, including after a scene reapply or transition. */
  readonly view: DataSceneView;
  document(): ApplyDataSceneAuthoringDocumentResult["document"];
  state(): DataSceneGameState | undefined;
  pause(): boolean;
  resume(): boolean;
  complete(): boolean;
  transition(
    document: SceneAuthoringDocumentSpec | ResolvedSceneAuthoringDocument,
    options?: Omit<ApplyDataSceneAuthoringDocumentOptions, "activateDataScene">,
  ): ApplyDataSceneAuthoringDocumentResult;
  reapply(
    document?: SceneAuthoringDocumentSpec | ResolvedSceneAuthoringDocument,
    options?: ApplyDataSceneAuthoringDocumentOptions,
  ): ApplyDataSceneAuthoringDocumentResult;
}

export interface FerrumRuntimeOptions {
  /** Flat 2D default; per-scene display.pixelPerfect overrides it (including false). */
  pixelPerfect?: PixelPerfectOptions | false;
  /** Flat Data Scene fit default; each document can override or disable it. */
  fit?: SceneFitSpec | false;
  canvas: HTMLCanvasElement;
  webgl2?: WebGL2RendererOptions;
  /** Applied when this runtime creates its renderer. */
  colorManagement?: ColorManagementMode;
  webgpu?: WebGPURendererOptions;
  shaderPreparation?: ShaderPreparationOptions;
  rendererPreference?: "webgl2" | "webgpu";
  /** Reports WebGPU fallback when the runtime creates its renderer. */
  onRendererFallback?: (info: RendererFallbackInfo) => void;
  renderer?: FerrumRuntimeRenderer;
  /** Release the dedicated canvas context on destroy or failed startup. Defaults to false. */
  releaseCanvasContext?: boolean;
  input?: InputManager;
  inputOptions?: InputManagerOptions;
  assetHost?: AssetHost;
  /** Loaded into this runtime's asset host before the initial Data Scene is applied. */
  assets?: AssetManifest;
  /** Options for the startup manifest. Cancellation uses the startup signal. */
  assetLoadOptions?: Omit<AssetLoadOptions, "signal">;
  /** Reports progress for the startup manifest. */
  onAssetProgress?: AssetLoadProgressCallback;
  /** Cancels startup only. A successfully created runtime is destroyed by its caller. */
  signal?: AbortSignal;
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
  dataScene?: false | SceneAuthoringDocumentSpec | ResolvedSceneAuthoringDocument | FerrumRuntimeDataSceneOptions;
  levelStreaming?: false | FerrumRuntimeLevelStreamingOptions | LevelChunkStreamer;
  physicsDebugLines?: boolean | PhysicsDebugOptions;
  /** `physicsDebugLines`가 활성화된 경우에만 호출되는 debug line buffer composer입니다. */
  physicsDebugLineComposer?: PhysicsDebugLineComposer;
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
  gameStateLabel?: (code: GameStateCode) => string;
  onFrame?: (frame: FerrumRuntimeFrame) => void;
}

export interface FerrumRuntime {
  engine: FerrumEngine;
  renderer: FerrumRuntimeRenderer;
  /** The active renderer backend, or "custom" for an unrecognized injected renderer. */
  readonly rendererBackend: "webgl2" | "webgpu" | "custom";
  input: InputManager;
  assetHost: AssetHost;
  /** The loaded startup manifest, present when assets were requested. */
  readonly assets?: LoadedAssets;
  profiler?: RuntimeProfiler;
  physicsScene?: PhysicsSceneProfileApplyResult;
  hud?: FerrumRuntimeHud;
  accessibility?: FerrumRuntimeAccessibility;
  animationTimeline?: FerrumRuntimeAnimationTimeline;
  localization?: FerrumRuntimeLocalization;
  dialogue?: FerrumRuntimeDialogue;
  cutscene?: FerrumRuntimeCutscene;
  dataScene?: FerrumRuntimeDataScene;
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
  const { signal } = options;
  throwIfRuntimeStartupAborted(signal);
  const ownsRenderer = options.renderer === undefined;
  const releaseCanvasContext = options.releaseCanvasContext === true;
  if (releaseCanvasContext && !ownsRenderer)
    throw new Error("releaseCanvasContext requires a runtime-owned renderer.");
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
  let levelStreaming: FerrumRuntimeLevelStreaming | undefined;
  let dialogue: FerrumRuntimeDialogue | undefined;
  const requestedDialogue = options.dialogue;
  const dialogueOptions = requestedDialogue && { ...requestedDialogue };
  let ownedDialogueSession: DialogueSession | undefined;
  let physicsScene: PhysicsSceneProfileApplyResult | undefined;
  let restoreExternalDisplay: (() => void) | undefined;
  let restoreExternalFit: (() => void) | undefined;
  let displayViewportCommitted = false;

  let destroyed = false;

  try {
    const colorManagement = ownsRenderer ? resolveRendererColorManagement(options) : options.colorManagement;
    const explicitPixelDefault = [options.pixelPerfect,options.webgl2?.pixelPerfect,options.webgpu?.pixelPerfect].some(value=>value!==undefined);
    const pixelDefault = explicitPixelDefault ? resolveRendererPixelPerfect(options) : renderer?.pixelPerfectPresentation?.()?.settings;
    const fitDefault = resolveSceneFit(options.fit, "runtime.fit");
    const initialScene = options.dataScene ? normalizeRuntimeDataSceneOptions(options.dataScene) : undefined;
    const initialDocument = initialScene?.document;
    const sceneDisplay = (doc: SceneAuthoringDocumentSpec | ResolvedSceneAuthoringDocument | undefined, path: string) => {
      const display = resolveSceneDisplay(doc?.display);
      const pixelPerfect = display?.pixelPerfect === false ? undefined : display?.pixelPerfect ?? pixelDefault;
      const fit = display?.fit ?? fitDefault;
      if (fit && pixelPerfect) throw sceneCompositionDiagnosticError(`${path}.fit`, "cannot be combined with pixelPerfect");
      if (fit && doc?.spatial) throw sceneCompositionDiagnosticError(`${path}.fit`, "cannot be combined with spatial");
      if (pixelPerfect && doc?.spatial) throw Error("Flat pixelPerfect cannot be combined with spatial; use spatial.environment.pixelArt");
      return { pixelPerfect, fit: fit || undefined };
    };
    const initialPath = initialScene?.path ?? "dataScene";
    const initialDisplay = sceneDisplay(initialDocument, `${initialPath}.display`);
    const initialPixel = initialDisplay.pixelPerfect;
    renderer ??= await createRuntimeRenderer(options.canvas, {
      preferred: options.rendererPreference ?? "webgl2",
      onFallback: options.onRendererFallback,
      colorManagement: options.colorManagement,
      pixelPerfect: initialPixel,
      webgl2: {...options.webgl2,pixelPerfect:initialPixel},
      shaderPreparation: options.shaderPreparation,
      webgpu: {...webGpuOptionsWithStaticPostProcess(options),pixelPerfect:initialPixel},
      spatial: initialDocument?.spatial,
    }, releaseCanvasContext);
    throwIfRuntimeStartupAborted(signal);
    const runtimeRenderer = renderer;
    const rendererBackend = runtimeRenderer instanceof WebGPURenderer ? "webgpu"
      : ownsRenderer || runtimeRenderer instanceof WebGL2Renderer ? "webgl2" : "custom";
    if (initialDocument && initialDisplay.fit && !runtimeRenderer.setViewportZoom)
      throw sceneCompositionDiagnosticError(`${initialPath}.display.fit`, "renderer does not support viewport zoom");
    if(initialPixel || explicitPixelDefault || initialDocument?.display?.pixelPerfect!==undefined) {
      if(!runtimeRenderer.setPixelPerfect || !runtimeRenderer.pixelPerfectPresentation)throw Error("Renderer does not support pixelPerfect presentation");
      if(!ownsRenderer) {
        const previous=runtimeRenderer.pixelPerfectPresentation()?.settings;
        restoreExternalDisplay=()=>{
          runtimeRenderer.setPixelPerfect!(previous??false);
          if(displayViewportCommitted && engine?.setViewportSize) { const size=runtimeRenderer.viewportSize();engine.setViewportSize(size.width,size.height); }
        };
      }
      runtimeRenderer.setPixelPerfect(initialPixel??false);
    }
    input ??= new InputManager(options.canvas, options.inputOptions);
    assetHost ??= new BrowserPlatformHost(runtimeRenderer);
    const profiler = createRuntimeProfiler(options.profiler);
    const accessibility = createRuntimeAccessibility(options.accessibility);
    const hud = createRuntimeHud(options.hud);
    const animationTimeline = createRuntimeAnimationTimeline(options.animationTimeline);
    const localization = createRuntimeLocalization(options.localization);
    if (dialogueOptions) {
      await initializeFerrumWasm();
      throwIfRuntimeStartupAborted(signal);
    }
    dialogue = createRuntimeDialogue(dialogueOptions);
    if (dialogueOptions && dialogueOptions.session === undefined) ownedDialogueSession = dialogue?.session;
    const cutscene = createRuntimeCutscene(options.cutscene, localization, assetHost);
    levelStreaming = createRuntimeLevelStreamingOption(
      options.levelStreaming,
      () => runtimeRenderer.viewportSize(),
      (progress) => profiler?.recordAssetProgress(progress),
      assetHost,
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
    const { canvas } = options;
    const initialWidth = canvas.clientWidth;
    const initialHeight = canvas.clientHeight;
    const initialDpr = globalThis.devicePixelRatio;
    runtimeRenderer.resize();
    configureStaticLighting(runtimeRenderer, options.lighting);
    configureStaticPostProcess(runtimeRenderer, options.postProcess);
    configureStaticSpriteMaterial(runtimeRenderer, options.spriteMaterial);

    const inputProvider: InputProvider = () => {
      let snapshot = runtimeInput.snapshot();
      const presentation=runtimeRenderer.pixelPerfectPresentation?.();
      if(presentation) {
        const rect=options.canvas.getBoundingClientRect();
        if(rect.width>0 && rect.height>0) {
          const point=pixelPerfectPointToViewport(presentation,snapshot.mouseX,snapshot.mouseY,rect.width,rect.height);
          const viewport=runtimeRenderer.viewportSize();
          if(!point.inside)snapshot=runtimeInput.snapshot({pointerPrimaryEnabled:false});
          snapshot={...snapshot,mouseX:point.x*viewport.width/presentation.sourceWidth,mouseY:point.y*viewport.height/presentation.sourceHeight};
        } else snapshot=runtimeInput.snapshot({pointerPrimaryEnabled:false});
      }
      return options.inputTransform?.(snapshot) ?? snapshot;
    };
    const runtimeFrameRenderer = new RuntimeFrameRenderer({
      renderer: runtimeRenderer,
      borrowNativeBuffers: ownsRenderer,
      isAlive: () => !destroyed,
      lighting: options.lighting,
      postProcess: options.postProcess,
      spriteMaterial: options.spriteMaterial,
      shouldRenderPhysicsDebugLines,
      physicsDebugLineComposer: options.physicsDebugLineComposer,
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

    const createRuntimeEngine = () => createEngineWithFramePipeline({
      needsFrameState: needsFullFrame,
      needsPhysicsDebugLineBuffer: shouldRenderPhysicsDebugLines,
      onRenderFrame: (renderFrame) => runtimeFrameRenderer.renderFrame(renderFrame),
    }, inputProvider, runtimeAssetHost, () => runtimeRenderer.viewportSize(), engineOptions);
    throwIfRuntimeStartupAborted(signal);
    const manifest = options.assets;
    let assets: LoadedAssets | undefined;
    if (manifest === undefined) {
      engine ??= await createRuntimeEngine();
    } else {
      const loadStartupAssets = async () => {
        const loaded = await runtimeAssetHost.loadAssets(manifest, (progress) => {
          if (destroyed || signal?.aborted) return;
          profiler?.recordAssetProgress(progress);
          options.onAssetProgress?.(progress);
        }, { ...options.assetLoadOptions, signal });
        throwIfRuntimeStartupAborted(signal);
        return loaded;
      };
      const startEngine = async () => {
        if (engine !== undefined) return engine;
        const created = await createRuntimeEngine();
        // An asset failure can settle startup before Wasm finishes initializing.
        if (destroyed) {
          disposeRuntimeResources([() => created.destroy()], false);
        } else {
          engine = created;
          throwIfRuntimeStartupAborted(signal);
        }
        return created;
      };
      [assets, engine] = await Promise.all([loadStartupAssets(), startEngine()]);
    }
    throwIfRuntimeStartupAborted(signal);
    // Startup does not observe resize events. Catch up if the canvas changed while awaiting work.
    if (canvas.clientWidth !== initialWidth || canvas.clientHeight !== initialHeight || globalThis.devicePixelRatio !== initialDpr) {
      runtimeRenderer.resize();
      throwIfRuntimeStartupAborted(signal);
    }
    const runtimeEngine = engine;
    const viewBinding = bindDataSceneView(runtimeEngine, runtimeRenderer, canvas, true);
    let activeFit: SceneFitSpec | undefined;
    let applyingInitialScene = true;
    const configureDisplay = (doc: SceneAuthoringDocumentSpec | ResolvedSceneAuthoringDocument, path: string): RuntimeDisplayChange | undefined => {
      const { pixelPerfect: nextPixel, fit: nextFit } = sceneDisplay(doc, `${path}.display`);
      const previousPresentation = runtimeRenderer.pixelPerfectPresentation?.();
      const previousPixel = previousPresentation?.settings;
      const previousFit = activeFit;
      const fitChanges = previousFit !== undefined || nextFit !== undefined;
      const pixelChanges = previousPixel !== undefined || nextPixel !== undefined;
      if (!fitChanges && !pixelChanges) return undefined;
      if (fitChanges && !runtimeRenderer.setViewportZoom)
        throw sceneCompositionDiagnosticError(`${path}.display.fit`, "renderer does not support viewport zoom");
      if (pixelChanges && (!runtimeRenderer.setPixelPerfect || !runtimeRenderer.pixelPerfectPresentation))
        throw Error("Renderer does not support pixelPerfect presentation");
      const previousViewport = fitChanges ? undefined : runtimeRenderer.viewportSize();
      const previousZoom = fitChanges ? viewBinding.currentZoom(previousPresentation) : undefined;
      const previousViewportCommitted = displayViewportCommitted;
      let zoomAttempted = false;
      let viewportAttempted = false;
      if (pixelChanges) runtimeRenderer.setPixelPerfect!(nextPixel ?? false);

      const syncViewport = () => {
        const viewport = runtimeRenderer.viewportSize();
        viewportAttempted = true;
        displayViewportCommitted = true;
        runtimeEngine.setViewportSize(viewport.width, viewport.height);
      };
      return {
        transactional: fitChanges,
        commit() {
          if (!fitChanges) {
            syncViewport();
            return;
          }
          const zoom = nextFit ? fitDataSceneZoom(canvas, nextFit) : 1;
          if (zoom !== undefined) {
            zoomAttempted = true;
            viewBinding.setRendererZoom(zoom);
          }
          if (zoom !== undefined || pixelChanges) syncViewport();
          if (nextFit) viewBinding.view.setCamera({
            x: (nextFit.x ?? 0) + nextFit.width / 2,
            y: (nextFit.y ?? 0) + nextFit.height / 2,
          });
          activeFit = nextFit;
          if (applyingInitialScene && !ownsRenderer && previousZoom !== undefined && zoomAttempted) {
            restoreExternalFit = () => {
              viewBinding.setRendererZoom(previousZoom);
              if (!ownsEngine && !restoreExternalDisplay) syncViewport();
            };
          }
        },
        rollback() {
          if (fitChanges) {
            // The native checkpoint already restored the viewport and camera, including follow/bounds.
            activeFit = previousFit;
            displayViewportCommitted = previousViewportCommitted;
            if (applyingInitialScene) restoreExternalFit = undefined;
            disposeRuntimeResources([
              () => { if (zoomAttempted && previousZoom !== undefined) viewBinding.setRendererZoom(previousZoom); },
              () => { if (pixelChanges) runtimeRenderer.setPixelPerfect!(previousPixel ?? false); },
            ]);
          } else {
            runtimeRenderer.setPixelPerfect!(previousPixel ?? false);
            if (viewportAttempted && previousViewport) runtimeEngine.setViewportSize(previousViewport.width, previousViewport.height);
          }
        },
      };
    };
    const dataScene = initialScene
      ? createRuntimeDataScene(runtimeEngine, initialScene, viewBinding.view, colorManagement, configureDisplay)
      : undefined;
    applyingInitialScene = false;
    if (!dataScene && (initialPixel || explicitPixelDefault)) {
      const viewport = runtimeRenderer.viewportSize();
      displayViewportCommitted = true;
      engine.setViewportSize(viewport.width, viewport.height);
    }
    if (options.physicsScene !== undefined && options.physicsScene !== false) {
      physicsScene = applyPhysicsSceneProfile(engine, options.physicsScene);
    }

    const runtime: FerrumRuntime = {
      engine: runtimeEngine,
      renderer: runtimeRenderer,
      rendererBackend,
      input: runtimeInput,
      assetHost: runtimeAssetHost,
      ...(assets === undefined ? {} : { assets }),
      ...(profiler === undefined ? {} : { profiler }),
      ...(physicsScene === undefined ? {} : { physicsScene }),
      ...(hud === undefined ? {} : { hud }),
      ...(accessibility === undefined ? {} : { accessibility }),
      ...(animationTimeline === undefined ? {} : { animationTimeline }),
      ...(localization === undefined ? {} : { localization }),
      ...(dialogue === undefined ? {} : { dialogue }),
      ...(cutscene === undefined ? {} : { cutscene }),
      ...(dataScene === undefined ? {} : { dataScene }),
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
        const detach = detachRendererResize;
        detachRendererResize = undefined;
        disposeRuntimeResources([
          () => detach?.(),
          () => levelStreaming?.destroy(),
          () => ownedDialogueSession?.destroy(),
          () => physicsScene?.clear(),
          () => { if (ownsEngine) runtimeEngine.destroy(); },
          () => { if (ownsUiOverlay) uiOverlay?.destroy(); },
          () => debugOverlay?.destroy(),
          () => { if (ownsInput) runtimeInput.destroy(); },
          () => { if (ownsAssetHost) destroyAssetHost(runtimeAssetHost); },
          () => { if (ownsRenderer) runtimeRenderer.destroy(); },
          () => { if (releaseCanvasContext) runtimeRenderer.releaseContext?.(); },
        ]);
      },
    };

    throwIfRuntimeStartupAborted(signal);
    if (options.autostart) {
      runtime.start();
    }

    throwIfRuntimeStartupAborted(signal);
    detachRendererResize = observeRendererResize(canvas, () => {
      if (!activeFit) {
        runtimeRenderer.resize();
        return;
      }
      const zoom = fitDataSceneZoom(canvas, activeFit);
      if (zoom !== undefined) viewBinding.view.setZoom(zoom);
    });
    return runtime;
  } catch (error) {
    const startupError = signal?.aborted && !(error instanceof DOMException && error.name === "AbortError")
      ? runtimeStartupAbortError()
      : error;
    destroyed = true;
    // Preserve the startup error after attempting every owned resource cleanup.
    disposeRuntimeResources([
      () => detachRendererResize?.(),
      () => restoreExternalFit?.(),
      () => restoreExternalDisplay?.(),
      () => levelStreaming?.destroy(),
      () => ownedDialogueSession?.destroy(),
      () => physicsScene?.clear(),
      () => { if (ownsUiOverlay) uiOverlay?.destroy(); },
      () => debugOverlay?.destroy(),
      () => { if (ownsInput) input?.destroy(); },
      () => { if (ownsAssetHost && assetHost) destroyAssetHost(assetHost); },
      () => { if (ownsRenderer) renderer?.destroy(); },
      () => { if (releaseCanvasContext) renderer?.releaseContext?.(); },
      () => { if (ownsEngine) engine?.destroy(); },
    ], false);
    throw startupError;
  }
}

function runtimeStartupAbortError(): DOMException {
  return new DOMException("Runtime startup was aborted.", "AbortError");
}

function throwIfRuntimeStartupAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw runtimeStartupAbortError();
}

function disposeRuntimeResources(disposers: readonly (() => void)[], rethrow = true): void {
  let firstFailure: { error: unknown } | undefined;
  for (const dispose of disposers) {
    try {
      dispose();
    } catch (error) {
      firstFailure ??= { error };
    }
  }
  if (rethrow && firstFailure) throw firstFailure.error;
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

interface RuntimeDisplayChange {
  transactional: boolean;
  commit(): void;
  rollback(): void;
}

function failRuntimeDisplayChange(change: RuntimeDisplayChange | undefined, error: unknown): never {
  try { change?.rollback(); } catch (rollbackError) {
    const message = (value: unknown) => value instanceof Error ? value.message : String(value);
    // Preserve both failures without requiring newer Error/AggregateError APIs.
    throw Object.assign(new Error(`Data Scene apply failed: ${message(error)}; display rollback also failed: ${message(rollbackError)}`), {
      cause: error,
      displayRollbackError: rollbackError,
    });
  }
  throw error;
}

function createRuntimeDataScene(
  engine: FerrumEngine,
  runtimeOptions: FerrumRuntimeDataSceneOptions,
  view: DataSceneView,
  colorManagement: ColorManagementMode | undefined,
  configureDisplay: (document: SceneAuthoringDocumentSpec | ResolvedSceneAuthoringDocument, path: string) => RuntimeDisplayChange | undefined,
): FerrumRuntimeDataScene {
  const {
    document,
    ...applyOptions
  } = runtimeOptions;
  const checkColorManagement = (requested: ColorManagementMode | undefined): void => {
    if (colorManagement !== undefined && requested !== undefined && requested !== colorManagement) {
      throw new Error("Data Scene colorManagement must match the runtime renderer colorManagement.");
    }
  };
  checkColorManagement(applyOptions.colorManagement);
  applyOptions.colorManagement = colorManagement ?? applyOptions.colorManagement;
  const basePath = applyOptions.path ?? "dataScene";
  let currentDocument: SceneAuthoringDocumentSpec | ResolvedSceneAuthoringDocument = document;
  const applyDocument = (
    nextDocument: SceneAuthoringDocumentSpec | ResolvedSceneAuthoringDocument,
    options: ApplyDataSceneAuthoringDocumentOptions & { path: string },
  ) => {
    const display = configureDisplay(nextDocument, options.path);
    try {
      if (display?.transactional)
        return applyDataSceneAuthoringDocumentWithCommit(engine, nextDocument, options, display.commit);
      const applied = applyDataSceneAuthoringDocument(engine, nextDocument, options);
      display?.commit();
      return applied;
    } catch (error) {
      failRuntimeDisplayChange(display, error);
    }
  };
  let result = applyDocument(currentDocument, { ...applyOptions, path: basePath });
  const applyNextDocument = (
    nextDocument: SceneAuthoringDocumentSpec | ResolvedSceneAuthoringDocument,
    nextOptions: ApplyDataSceneAuthoringDocumentOptions,
  ): ApplyDataSceneAuthoringDocumentResult => {
    checkColorManagement(nextOptions.colorManagement);
    const nextResult = applyDocument(nextDocument, {
      ...applyOptions,
      ...nextOptions,
      colorManagement: colorManagement ?? nextOptions.colorManagement ?? applyOptions.colorManagement,
      path: nextOptions.path ?? basePath,
    });
    currentDocument = nextDocument;
    result = nextResult;
    return result;
  };

  return {
    view,
    get result() {
      return result;
    },
    variables: result.variables,
    document: () => result.document,
    state: () => engine.dataSceneState(),
    pause: () => engine.pauseDataScene(),
    resume: () => engine.resumeDataScene(),
    complete: () => engine.completeDataScene(),
    transition: (nextDocument, nextOptions = {}) => {
      if ((nextOptions as ApplyDataSceneAuthoringDocumentOptions).activateDataScene === false) {
        throw new Error("runtime.dataScene.transition cannot disable Data Scene activation.");
      }
      return applyNextDocument(nextDocument, {
        ...nextOptions,
        activateDataScene: true,
      });
    },
    reapply: (nextDocument = currentDocument, nextOptions = {}) =>
      applyNextDocument(nextDocument, nextOptions),
  };
}

function normalizeRuntimeDataSceneOptions(
  option: Exclude<FerrumRuntimeOptions["dataScene"], false | undefined>,
): FerrumRuntimeDataSceneOptions {
  if (isRuntimeDataSceneOptions(option)) {
    return option;
  }
  return { document: option };
}

function isRuntimeDataSceneOptions(value: unknown): value is FerrumRuntimeDataSceneOptions {
  return isObject(value) && "document" in value;
}

function createRuntimeLevelStreamingOption(
  options: FerrumRuntimeOptions["levelStreaming"],
  viewportSize: () => { width: number; height: number },
  onAssetProgress: Parameters<typeof createRuntimeLevelStreaming>[2],
  assetHost: AssetHost,
): FerrumRuntimeLevelStreaming | undefined {
  if (options === undefined || options === false) {
    return undefined;
  }
  if (options instanceof LevelChunkStreamer) {
    return createRuntimeLevelStreaming({
      streamer: options,
      target: levelStreamingTargetWithAssetRelease(undefined, assetHost),
    }, viewportSize, onAssetProgress);
  }
  return createRuntimeLevelStreaming({
    ...options,
    target: levelStreamingTargetWithAssetRelease(options.target, assetHost),
  }, viewportSize, onAssetProgress);
}

function levelStreamingTargetWithAssetRelease(
  target: FerrumRuntimeLevelStreamingTarget | undefined,
  assetHost: AssetHost,
): FerrumRuntimeLevelStreamingTarget | undefined {
  if (assetHost.releaseAssets === undefined) {
    return target;
  }
  return {
    ...target,
    releaseAssets: (assets, context) => {
      target?.releaseAssets?.(assets, context);
      assetHost.releaseAssets?.(assets);
    },
  };
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

function observeRendererResize(canvas: HTMLCanvasElement, resizeRenderer: () => void): () => void {
  let active = true;
  const resize = (): void => {
    if (active) resizeRenderer();
  };
  const cleanup: Array<() => void> = [];
  const detach = (rethrow = true) => {
    active = false;
    disposeRuntimeResources(cleanup.splice(0).reverse(), rethrow);
  };
  try {
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(resize);
      cleanup.push(() => observer.disconnect());
      observer.observe(canvas);
    }
    if (typeof window !== "undefined") {
      const eventTarget = window;
      cleanup.push(() => eventTarget.removeEventListener("resize", resize));
      eventTarget.addEventListener("resize", resize);
    }
  } catch (error) {
    detach(false);
    throw error;
  }
  return detach;
}

function destroyAssetHost(assetHost: AssetHost): void {
  const maybeDestroyable = assetHost as AssetHost & { destroy?: () => void };
  maybeDestroyable.destroy?.();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
