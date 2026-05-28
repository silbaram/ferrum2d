import {
  GAME_STATE_SNAPSHOT_FORMAT,
  GAME_STATE_SNAPSHOT_VERSION,
  RuntimeProfiler,
  ScreenFadeTransition,
  captureGameStateSnapshot,
  decodeCollisionEvents,
  decodePhysicsDebugLines,
  deriveTileOccludersFromTilemapGrid,
  equal,
  evaluateRuntimeProfilerBudget,
  f32Bits,
  loadGameStateSnapshotFromStorage,
  parseGameStateSnapshot,
  restoreGameStateSnapshot,
  runtimeDiagnosticsFrameSample,
  saveGameStateSnapshotToStorage,
  stringifyGameStateSnapshot,
  test,
} from "./publicApiTypes.shared.js";

import type {
  AssetHost,
  BloomPostProcessPassInput,
  BuiltInShooterStateSnapshot,
  CollisionEventBufferView,
  CollisionEventView,
  CreateEngineOptions,
  CreateRendererOptions,
  CreatedRenderer,
  CrtPostProcessPassInput,
  EngineLifecycleHooks,
  EngineLifecycleSnapshot,
  FadePostProcessPassInput,
  FerrumEngine,
  FerrumRuntime,
  FerrumRuntimeEnvironment,
  FerrumRuntimeFrame,
  FerrumRuntimeOptions,
  FerrumRuntimeRenderer,
  FixedTimestepOptions,
  FrameHandler,
  FrameState,
  GameStateSceneSnapshot,
  GameStateSnapshot,
  GameStateSnapshotJsonValue,
  GameStateSnapshotRestoreResult,
  GameStateSnapshotStorage,
  GlitchPostProcessPassInput,
  HudThemePresetName,
  InputManagerOptions,
  LightingScene2D,
  LightingSceneProvider,
  LightingShadowOptions,
  PhysicsDebugLineBufferView,
  PhysicsDebugLineCamera,
  PhysicsDebugLineView,
  PhysicsFrameStats,
  PointLight2D,
  PostProcessColor,
  PostProcessPassInput,
  PostProcessPassKind,
  PostProcessProvider,
  PostProcessStackInput,
  PublicApi,
  RendererFallbackInfo,
  RuntimeDiagnosticsBudget,
  RuntimeDiagnosticsFrameSample,
  RuntimeDiagnosticsReport,
  RuntimeDiagnosticsViolation,
  RuntimeProfilerOptions,
  RuntimeProfilerSnapshot,
  ScreenFadeTransitionSpec,
  TileOccluder2D,
  TileOccluderGridInput,
  UiAction,
  UiDialog,
  UiMeter,
  UiOverlayActionEvent,
  UiOverlayActionTone,
  UiOverlayOptions,
  UiOverlayRegion,
  UiOverlayState,
  UiOverlayStateProvider,
  UiOverlayTone,
  UiPanel,
  UiTextLine,
  VignettePostProcessPassInput,
  WebGL2RendererOptions,
  WebGPURenderer,
  WebGPURendererOptions,
  createFerrumRuntime,
} from "./publicApiTypes.shared.js";

test("public API runtime profiler, snapshots, renderer options, and frame types", () => {
  const pointLight: PointLight2D = { x: 24, y: 32, radius: 96, color: [1, 0.9, 0.65], intensity: 1 };
  const tileOccluderGrid: TileOccluderGridInput = { width: 1, height: 1, tileSize: 16, data: [1] };
  const tileOccluder: TileOccluder2D = deriveTileOccludersFromTilemapGrid(tileOccluderGrid)[0];
  const lightingShadows: LightingShadowOptions = { enabled: true, projectionLength: 128 };
  const lightingScene: LightingScene2D = {
    ambient: [0, 0, 0, 0.4],
    pointLights: [pointLight],
    tileOccluders: [tileOccluder],
    shadows: lightingShadows,
    debug: { tileOccluders: true },
  };
  const lightingSceneProvider: LightingSceneProvider = (frame) => ({
    ...lightingScene,
    pointLights: [{ ...pointLight, x: frame.mouseX }],
  });
  const postProcessKind: PostProcessPassKind = "fade";
  const postProcessColor: PostProcessColor = [0, 0, 0, 0.25];
  const fadePassInput: FadePostProcessPassInput = { kind: postProcessKind, color: postProcessColor };
  const bloomPassInput: BloomPostProcessPassInput = { kind: "bloom", threshold: 0.8, intensity: 0.4 };
  const crtPassInput: CrtPostProcessPassInput = { kind: "crt", scanlineIntensity: 0.2 };
  const vignettePassInput: VignettePostProcessPassInput = { kind: "vignette", intensity: 0.25 };
  const glitchPassInput: GlitchPostProcessPassInput = { kind: "glitch", intensity: 0.02 };
  const postProcessPassInput: PostProcessPassInput = fadePassInput;
  const postProcessStackInput: PostProcessStackInput = [
    postProcessPassInput,
    bloomPassInput,
    crtPassInput,
    vignettePassInput,
    glitchPassInput,
  ];
  const fadeTransitionSpec: ScreenFadeTransitionSpec = { durationSeconds: 1, fromOpacity: 1, toOpacity: 0 };
  const publicScreenFadeTransition: PublicApi["ScreenFadeTransition"] = ScreenFadeTransition;
  const fadeTransition = publicScreenFadeTransition.create(fadeTransitionSpec);
  const postProcessProvider: PostProcessProvider = () => fadeTransition.postProcessPasses();
  const runtimeProfilerOptions: RuntimeProfilerOptions = {
    budget: {
      maxFrameTimeMs: 16.7,
      maxDrawCalls: 2,
    },
  };
  const runtimeProfiler = new RuntimeProfiler(runtimeProfilerOptions);
  const runtimeBudget: RuntimeDiagnosticsBudget = { maxFrameTimeMs: 16.7, maxAssetLoadElapsedMs: 250 };
  const runtimeFrameSample: RuntimeDiagnosticsFrameSample = runtimeDiagnosticsFrameSample({
    fps: 60,
    frameTimeMs: 16,
    rustUpdateTimeMs: 1,
    renderTimeMs: 2,
    entityCount: 1,
    spriteCount: 1,
    drawCalls: 1,
    batchCount: 1,
  });
  const runtimeReport: RuntimeDiagnosticsReport = runtimeProfiler.recordFrame(runtimeFrameSample);
  const runtimeSnapshot: RuntimeProfilerSnapshot = runtimeProfiler.snapshot();
  const runtimeViolation: RuntimeDiagnosticsViolation | undefined =
    evaluateRuntimeProfilerBudget(runtimeSnapshot, runtimeBudget).violations[0];
  const publicRuntimeProfiler: PublicApi["RuntimeProfiler"] = RuntimeProfiler;
  const publicRuntimeDiagnosticsFrameSample: PublicApi["runtimeDiagnosticsFrameSample"] =
    runtimeDiagnosticsFrameSample;
  const publicEvaluateRuntimeProfilerBudget: PublicApi["evaluateRuntimeProfilerBudget"] =
    evaluateRuntimeProfilerBudget;
  const snapshotEngine: Pick<
    FerrumEngine,
    "score" | "gameState" | "entityCount" | "spriteCount" | "cameraX" | "cameraY"
  > = {
    score: () => 3,
    gameState: () => 1,
    entityCount: () => 4,
    spriteCount: () => 5,
    cameraX: () => 6,
    cameraY: () => 7,
  };
  const gameStateCustom: GameStateSnapshotJsonValue = { checkpoint: "alpha" };
  const builtInShooterState: BuiltInShooterStateSnapshot = {
    format: "ferrum2d.builtin-shooter-state",
    version: 1,
    headerFloats: [0, 1, 0, 0, 400, 240],
    headerU32s: [1, 1, 3, 0, 0, 0, 0, 0],
    entityFloats: [400, 240, 0, 0, 0, 0, 0],
    entityU32s: [0, 0],
    entityCount: 1,
    floatsPerEntity: 7,
    u32sPerEntity: 2,
  };
  const publicCaptureGameStateSnapshot: PublicApi["captureGameStateSnapshot"] = captureGameStateSnapshot;
  const publicGameStateSnapshotFormat: PublicApi["GAME_STATE_SNAPSHOT_FORMAT"] = GAME_STATE_SNAPSHOT_FORMAT;
  const publicGameStateSnapshotVersion: PublicApi["GAME_STATE_SNAPSHOT_VERSION"] = GAME_STATE_SNAPSHOT_VERSION;
  const publicStringifyGameStateSnapshot: PublicApi["stringifyGameStateSnapshot"] = stringifyGameStateSnapshot;
  const publicParseGameStateSnapshot: PublicApi["parseGameStateSnapshot"] = parseGameStateSnapshot;
  const publicRestoreGameStateSnapshot: PublicApi["restoreGameStateSnapshot"] = restoreGameStateSnapshot;
  const publicSaveGameStateSnapshotToStorage: PublicApi["saveGameStateSnapshotToStorage"] =
    saveGameStateSnapshotToStorage;
  const publicLoadGameStateSnapshotFromStorage: PublicApi["loadGameStateSnapshotFromStorage"] =
    loadGameStateSnapshotFromStorage;
  const gameStateSnapshot: GameStateSnapshot = publicCaptureGameStateSnapshot(
    snapshotEngine as FerrumEngine,
    { customState: gameStateCustom },
  );
  const gameStateScene: GameStateSceneSnapshot = gameStateSnapshot.scene;
  const gameStateStorage: GameStateSnapshotStorage = {
    getItem: () => publicStringifyGameStateSnapshot(gameStateSnapshot),
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  const gameStateRestore: GameStateSnapshotRestoreResult = publicRestoreGameStateSnapshot(
    snapshotEngine as FerrumEngine,
    gameStateSnapshot,
  );
  equal(typeof publicRuntimeProfiler, "function");
  equal(publicRuntimeDiagnosticsFrameSample(runtimeFrameSample).drawCalls, 1);
  equal(publicEvaluateRuntimeProfilerBudget(runtimeSnapshot, runtimeBudget).passed, true);
  equal(runtimeReport.passed, true);
  equal(runtimeViolation, undefined);
  equal(publicGameStateSnapshotFormat, "ferrum2d.game-state.snapshot");
  equal(publicGameStateSnapshotVersion, 1);
  equal(gameStateSnapshot.format, GAME_STATE_SNAPSHOT_FORMAT);
  equal(gameStateScene.score, 3);
  equal(publicParseGameStateSnapshot(publicStringifyGameStateSnapshot(gameStateSnapshot)).version, 1);
  publicSaveGameStateSnapshotToStorage(gameStateStorage, "slot", gameStateSnapshot);
  equal(publicLoadGameStateSnapshotFromStorage(gameStateStorage, "slot")?.snapshotHash, gameStateSnapshot.snapshotHash);
  equal(gameStateRestore.customStateApplied, false);
  equal(gameStateRestore.builtInShooterStateApplied, false);
  const lifecycleHooks: EngineLifecycleHooks = {
    onStart: (snapshot: EngineLifecycleSnapshot) => {
      equal(snapshot.gameState >= 0, true);
    },
    onDestroy: (snapshot) => {
      equal(snapshot.entityCount >= 0, true);
    },
  };
  const options: CreateEngineOptions = {
    includeDeprecatedRenderCommands: false,
    useWorkerClock: true,
    includeAudioEvents: true,
    includeCollisionEvents: true,
    enablePhysicsDebugLines: true,
    includePhysicsDebugLines: true,
    physicsDebugOptions: { colliders: true, contacts: true },
    fixedTimestep: { stepSeconds: 1 / 60, maxFrameSeconds: 0.25, maxStepsPerUpdate: 8 },
    physicsMode: "rigid",
    lifecycle: lifecycleHooks,
  };
  const fixedTimestepOptions: FixedTimestepOptions = { enabled: true, stepSeconds: 1 / 120 };
  const rendererOptions: CreateRendererOptions = {
    preferred: "webgpu",
    fallbackBehavior: "silent",
    webgpu: { powerPreference: "high-performance" },
    onFallback: (info: RendererFallbackInfo) => {
      equal(info.fallback, "webgl2");
    },
  };
  const webgpuOptions: WebGPURendererOptions = {
    clearColor: [0, 0, 0, 1],
    fallbackAdapter: false,
    lighting: lightingScene,
    postProcess: postProcessStackInput,
  };
  const webgl2Options: WebGL2RendererOptions = {
    clearColor: [0, 0, 0, 1],
    preserveDrawingBuffer: true,
    lighting: lightingScene,
    postProcess: postProcessStackInput,
  };
  const physicsDebugLineCamera: PhysicsDebugLineCamera = { x: 0, y: 0 };
  const inputManagerOptions: InputManagerOptions = {
    gamepad: true,
    gamepadDeadzone: 0.3,
    gamepadMapping: {
      moveXAxis: 0,
      moveYAxis: 1,
      actionButtons: [0, 2],
      menuButtons: [9],
      pointerButtons: [5, 7],
    },
    pointerGestures: true,
    pointerGestureThreshold: 16,
  };
  const hudThemeName: HudThemePresetName = "high-contrast";
  const uiOverlayTone: UiOverlayTone = "accent";
  const uiOverlayActionTone: UiOverlayActionTone = "primary";
  const uiOverlayRegion: UiOverlayRegion = "top-right";
  const uiMeter: UiMeter = { value: 3, max: 5 };
  const uiTextLine: UiTextLine = {
    id: "hp",
    label: "HP",
    value: "60%",
    tone: uiOverlayTone,
    meter: uiMeter,
  };
  const uiAction: UiAction = {
    id: "pause",
    label: "Pause",
    ariaLabel: "Pause game",
    tone: uiOverlayActionTone,
  };
  const uiPanel: UiPanel = {
    id: "hud",
    title: "HUD",
    region: uiOverlayRegion,
    ariaLive: "polite",
    lines: [uiTextLine],
    actions: [uiAction],
  };
  const uiDialog: UiDialog = {
    id: "pause",
    title: "Paused",
    actions: [uiAction],
  };
  const uiOptions: UiOverlayOptions = {
    theme: hudThemeName,
    onAction: (event: UiOverlayActionEvent) => {
      equal(event.id.length > 0, true);
    },
  };
  const uiState: UiOverlayState = {
    panels: [uiPanel],
    dialog: uiDialog,
  };
  const uiStateProvider: UiOverlayStateProvider = () => uiState;
  const runtimeEnvironment: FerrumRuntimeEnvironment = "production";
  const runtimeOptions: FerrumRuntimeOptions = {
    canvas: {} as HTMLCanvasElement,
    rendererPreference: "webgpu",
    webgl2: webgl2Options,
    webgpu: webgpuOptions,
    inputOptions: inputManagerOptions,
    ui: uiOptions,
    uiState: uiStateProvider,
    environment: runtimeEnvironment,
    debug: false,
    profiler: runtimeProfilerOptions,
    lighting: lightingSceneProvider,
    postProcess: postProcessProvider,
    physicsDebugLines: true,
    physicsMode: "arcade",
    onFrame: (runtimeFrame: FerrumRuntimeFrame) => {
      equal(runtimeFrame.rendererStats.drawCalls >= 0, true);
      equal(runtimeFrame.rendererStats.physicsDebugLineCount >= 0, true);
      equal(runtimeFrame.rendererStats.pointLightCount >= 0, true);
    },
  };
  const webGpuCreate: typeof WebGPURenderer.create = async () => {
    throw new Error("WebGPU compatibility shim");
  };
  const nullableCreatedRenderer: CreatedRenderer | undefined = undefined;
  const nullableRuntimeRenderer: FerrumRuntimeRenderer | undefined = undefined;
  const runtimeCreate: typeof createFerrumRuntime = async () => ({
    engine: {} as FerrumEngine,
    renderer: {} as FerrumRuntime["renderer"],
    input: {} as FerrumRuntime["input"],
    assetHost: {} as AssetHost,
    start: () => undefined,
    pause: () => undefined,
    resume: () => undefined,
    stop: () => undefined,
    destroy: () => undefined,
  });

  const onFrame: FrameHandler = (frame: FrameState) => {
    const commandCount = frame.renderCommandBuffer.commandCount;
    equal(commandCount >= 0, true);
    equal(frame.physics.fixedSteps >= 0, true);
    equal(frame.collisionEventBuffer.eventCount >= 0, true);
    equal(frame.physicsDebugLineBuffer.lineCount >= 0, true);
  };
  const physicsStats: PhysicsFrameStats = {
    mode: "arcade",
    gravityX: 0,
    gravityY: 0,
    continuous: false,
    fixedTimestepEnabled: true,
    fixedStepSeconds: 1 / 60,
    fixedSteps: 1,
    fixedAlpha: 0.25,
    fixedConsumedSeconds: 1 / 60,
    fixedDroppedSeconds: 0,
    kinematicMoves: 0,
    kinematicHits: 0,
    kinematicEntityHits: 0,
    kinematicTileHits: 0,
    solidCandidateChecks: 0,
    tileCandidateChecks: 0,
    collisionPairs: 1,
    collisionSolidPairs: 1,
    collisionTriggerPairs: 0,
    collisionEnterEvents: 1,
    collisionStayEvents: 0,
    collisionExitEvents: 0,
    collisionHitEvents: 0,
    collisionTriggerEnterEvents: 0,
    collisionTriggerStayEvents: 0,
    collisionTriggerExitEvents: 0,
    collisionEventCount: 1,
    ccdChecks: 0,
    ccdHits: 0,
    sleepingBodies: 0,
    brokenJoints: 0,
  };
  const collisionEventBuffer: CollisionEventBufferView = {
    buffer: new Uint32Array([4, 0, 0, 1, 0, f32Bits(2)]),
    eventCount: 1,
    u32sPerEvent: 6,
  };
  const publicDecodeCollisionEvents: PublicApi["decodeCollisionEvents"] = decodeCollisionEvents;
  const collisionEvent: CollisionEventView = publicDecodeCollisionEvents(collisionEventBuffer)[0];
  const physicsDebugLineBuffer: PhysicsDebugLineBufferView = {
    buffer: new Float32Array([0, 0, 16, 0, 1, 0.2, 0.1, 1]),
    lineCount: 1,
    floatsPerLine: 8,
  };
  const publicDecodePhysicsDebugLines: PublicApi["decodePhysicsDebugLines"] = decodePhysicsDebugLines;
  const physicsDebugLine: PhysicsDebugLineView = publicDecodePhysicsDebugLines(physicsDebugLineBuffer)[0];
  equal(options.includeDeprecatedRenderCommands, false);
  equal(options.useWorkerClock, true);
  equal(fixedTimestepOptions.enabled, true);
  options.lifecycle?.onStart?.({
    timeSeconds: 0,
    score: 0,
    entityCount: 1,
    gameState: 0,
    spriteCount: 1,
  });
  equal(rendererOptions.preferred, "webgpu");
  equal(runtimeOptions.rendererPreference, "webgpu");
  equal(runtimeOptions.debug, false);
  equal(runtimeOptions.uiState?.({} as FerrumRuntimeFrame).panels?.[0]?.id, "hud");
  equal(typeof webGpuCreate, "function");
  equal(nullableCreatedRenderer, undefined);
  equal(nullableRuntimeRenderer, undefined);
  equal(typeof runtimeCreate, "function");
  onFrame({
    timeSeconds: 0,
    frameTimeMs: 16,
    rustUpdateTimeMs: 1,
    score: 0,
    entityCount: 1,
    gameState: 0,
    spriteCount: 1,
    mouseX: 0,
    mouseY: 0,
    cameraX: 0,
    cameraY: 0,
    audioEventCount: 0,
    audioEvents: [],
    physics: physicsStats,
    collisionEventBuffer,
    collisionEvents: [collisionEvent],
    physicsDebugLineBuffer,
    physicsDebugLines: [physicsDebugLine],
    renderCommands: [],
    renderCommandBuffer: {
      buffer: new Float32Array(0),
      commandCount: 0,
      floatsPerCommand: 14,
    },
  });
});
