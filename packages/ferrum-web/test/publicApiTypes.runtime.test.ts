import {
  BUILT_IN_SHOOTER_STATE_FLOATS_PER_ENTITY,
  BUILT_IN_SHOOTER_STATE_HEADER_U32S,
  BUILT_IN_SHOOTER_STATE_U32S_PER_ENTITY,
  BUILT_IN_SHOOTER_STATE_VERSION,
  DATA_SCENE_STATE_FORMAT,
  DATA_SCENE_STATE_VERSION,
  GAME_STATE_SNAPSHOT_FORMAT,
  GAME_STATE_SNAPSHOT_VERSION,
  GAMEPLAY_EVENT_FLAG_TILE_IMPACT_BOUNCED,
  GAMEPLAY_EVENT_FLAG_TILE_IMPACT_IDENTITY_TRUNCATED,
  GAMEPLAY_EVENT_KIND_FACTION_DAMAGE_DENIED,
  GAMEPLAY_EVENT_KIND_TILE_IMPACT,
  GAMEPLAY_EVENT_TILE_IMPACT_LAYER_MASK,
  GAMEPLAY_EVENT_TILE_IMPACT_LAYER_SHIFT,
  GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_MASK,
  GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_NEGATIVE_X,
  GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_NEGATIVE_Y,
  GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_NONE,
  GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_POSITIVE_X,
  GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_POSITIVE_Y,
  GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_SHIFT,
  GAMEPLAY_EVENT_TILE_IMPACT_TILE_MASK,
  RuntimeProfiler,
  ScreenFadeTransition,
  captureGameStateSnapshot,
  createRuntimeLevelStreaming,
  createLevelStreamingPixelMaskTerrainPhysicsOptions,
  decodeCollisionEvents,
  decodePhysicsDebugLines,
  deriveHd2dTileOccludersFromTilemapGrid,
  deriveTileOccludersFromTilemapGrid,
  equal,
  evaluateRuntimeProfilerBudget,
  extractLevelStreamingTilemapChunkBoundaryChains,
  f32Bits,
  loadGameStateSnapshotFromStorage,
  parseGameStateSnapshot,
  restoreGameStateSnapshot,
  runtimeDiagnosticsFrameSample,
  saveGameStateSnapshotToStorage,
  stringifyGameStateSnapshot,
  tilemapLayerForLevelStreamingChunk,
  test,
  validateDataSceneStateSnapshot,
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
  FerrumGameplayAuthoringApi,
  FerrumInputActionApi,
  FerrumRuntime,
  FerrumRuntimeAccessibility,
  FerrumRuntimeAccessibilityOptions,
  FerrumRuntimeAnimationTimeline,
  FerrumRuntimeAnimationTimelineOptions,
  FerrumRuntimeAnimationTimelineSignalProvider,
  FerrumRuntimeCutscene,
  FerrumRuntimeCutsceneDialogueOptions,
  FerrumRuntimeCutsceneDialogueValues,
  FerrumRuntimeCutsceneOptions,
  FerrumRuntimeCutsceneTextMode,
  FerrumRuntimeEnvironment,
  FerrumRuntimeFrame,
  FerrumRuntimeHud,
  FerrumRuntimeHudComponentProvider,
  FerrumRuntimeHudOptions,
  FerrumRuntimeLevelStreaming,
  FerrumRuntimeLevelStreamingChunkContext,
  FerrumRuntimeLevelStreamingOptions,
  FerrumRuntimeLevelStreamingPreloadOptions,
  FerrumRuntimeLevelStreamingReleasedAsset,
  FerrumRuntimeLevelStreamingReleasedAssetKind,
  FerrumRuntimeLevelStreamingReleasedAssets,
  FerrumRuntimeLevelStreamingTarget,
  FerrumRuntimeLevelStreamingUpdateResult,
  FerrumRuntimeLevelStreamingViewportProvider,
  FerrumRuntimeLocalization,
  FerrumRuntimeLocalizationOptions,
  FerrumRuntimeOptions,
  FerrumRuntimeRenderer,
  FerrumRuntimeSubtitleProvider,
  FixedTimestepOptions,
  FrameHandler,
  FrameState,
  DataSceneStateSnapshot,
  GameStateSceneSnapshot,
  GameStateSnapshot,
  GameStateSnapshotJsonValue,
  GameStateSnapshotRestoreResult,
  GameStateSnapshotStorage,
  GlitchPostProcessPassInput,
  HudComponentSpec,
  HudThemePresetName,
  Hd2dTileOccluderDefinition,
  Hd2dTileOccluderGridInput,
  InputActionRuntimeBinding,
  InputActionRuntimeControl,
  InputManagerOptions,
  LightingScene2D,
  LightingSceneProvider,
  LevelStreamingPixelMaskTerrainPhysicsOptions,
  LevelStreamingTilemapChunkBoundaryOptions,
  LevelStreamingViewport,
  LightingShadowOptions,
  PhysicsDebugLineBufferView,
  PhysicsDebugLineCamera,
  PhysicsDebugLineView,
  PhysicsFrameStats,
  PhysicsHd2dKinematicMoveOptions,
  PhysicsHd2dKinematicMoveResult,
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
  const hd2dTileOccluderDefinition: Hd2dTileOccluderDefinition = { blocksVision: true, occluderHeight: 12 };
  const hd2dTileOccluderGrid: Hd2dTileOccluderGridInput = {
    ...tileOccluderGrid,
    tiles: { 1: hd2dTileOccluderDefinition },
  };
  const hd2dTileOccluder: TileOccluder2D = deriveHd2dTileOccludersFromTilemapGrid(hd2dTileOccluderGrid)[0];
  const publicDeriveHd2dTileOccluders: PublicApi["deriveHd2dTileOccludersFromTilemapGrid"] =
    deriveHd2dTileOccludersFromTilemapGrid;
  const lightingShadows: LightingShadowOptions = { enabled: true, projectionLength: 128 };
  const lightingScene: LightingScene2D = {
    ambient: [0, 0, 0, 0.4],
    pointLights: [pointLight],
    tileOccluders: [tileOccluder, hd2dTileOccluder],
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
  const hd2dKinematicOptions: PhysicsHd2dKinematicMoveOptions = {
    displacementX: 8,
    displacementY: 0,
    maxStepHeight: 4,
    maxDropHeight: 4,
    allowLedgeDrop: false,
  };
  const hd2dKinematicResult: PhysicsHd2dKinematicMoveResult = {
    body: {
      entityId: 1,
      entityGeneration: 1,
      x: 8,
      y: 0,
      velocityX: 0,
      velocityY: 0,
      rotationRadians: 0,
      angularVelocityRadiansPerSecond: 0,
      bodyType: "kinematic",
      bodyEnabled: true,
      isSleeping: false,
      colliderType: "aabb",
      colliderEnabled: true,
      colliderIsTrigger: false,
      colliderOffsetX: 0,
      colliderOffsetY: 0,
      colliderMaterialOverride: false,
      colliderMaterial: {
        restitution: 0,
        friction: 0.4,
        surfaceVelocityX: 0,
        surfaceVelocityY: 0,
        density: 1,
        contactBaumgarteBiasScale: 1,
        maxContactBaumgarteBiasVelocityScale: 1,
        contactPositionCorrectionScale: 1,
        contactPositionCorrectionSlopScale: 1,
      },
      mass: 1,
      inverseMass: 1,
      inertia: 1,
      inverseInertia: 1,
      gravityScale: 1,
      linearDamping: 0,
      angularDamping: 0,
      restitution: 0,
      friction: 0.4,
      surfaceVelocityX: 0,
      surfaceVelocityY: 0,
      density: 1,
      contactBaumgarteBiasScale: 1,
      maxContactBaumgarteBiasVelocityScale: 1,
      contactPositionCorrectionScale: 1,
      contactPositionCorrectionSlopScale: 1,
      heightSpan: { floorId: 1, elevation: 0, height: 8 },
    },
    elevationDelta: 0,
    hitCount: 0,
    steppedUp: false,
    steppedDown: false,
    changedFloor: false,
    passedUnderBridge: false,
    blockedByStep: false,
    blockedByDrop: false,
    blockedX: false,
    blockedY: false,
  };
  const runtimeProfilerOptions: RuntimeProfilerOptions = {
    budget: {
      maxFrameTimeMs: 16.7,
      maxDrawCalls: 2,
    },
  };
  const runtimeProfiler = new RuntimeProfiler(runtimeProfilerOptions);
  equal(GAMEPLAY_EVENT_KIND_TILE_IMPACT, 9);
  equal(GAMEPLAY_EVENT_KIND_FACTION_DAMAGE_DENIED, 10);
  equal(GAMEPLAY_EVENT_FLAG_TILE_IMPACT_BOUNCED, 8);
  equal(GAMEPLAY_EVENT_FLAG_TILE_IMPACT_IDENTITY_TRUNCATED, 16);
  equal(GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_SHIFT, 8);
  equal(GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_MASK, 0b111 << 8);
  equal(GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_NONE, 0);
  equal(GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_POSITIVE_X, 1);
  equal(GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_NEGATIVE_X, 2);
  equal(GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_POSITIVE_Y, 3);
  equal(GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_NEGATIVE_Y, 4);
  equal(GAMEPLAY_EVENT_TILE_IMPACT_LAYER_SHIFT, 24);
  equal(GAMEPLAY_EVENT_TILE_IMPACT_LAYER_MASK, 0xff << 24);
  equal(GAMEPLAY_EVENT_TILE_IMPACT_TILE_MASK, 0x00ff_ffff);
  const gameplayAuthoringApi: FerrumGameplayAuthoringApi = {
    gameplayEntityExists: () => true,
    registerGameplayPrefabs: (registrations) => ({
      registrations,
      results: registrations.map(() => true),
    }),
    applyGameplayBehaviorCommands: (commands) => ({ commands, results: [] }),
    applyFactionRelationTable: (table) => ({
      applied: true,
      defaultRelation: table.defaultRelation ?? "neutral",
      relationCount: table.relations.length,
    }),
    installBehaviorStateMachineRuntime: () => ({
      plan: {
        machine: "enemyAi",
        initial: "idle",
        initialStateId: 1,
        states: [],
        transitions: [],
      },
      applied: true,
    }),
    gameplayBehaviorState: () => 1,
    createBehaviorStateMachineCurrentStateCommandPlan: () => ({
      machine: "enemyAi",
      state: "idle",
      stateId: 1,
      behaviorProfiles: [],
      sourceCommands: [],
      commands: [],
    }),
    applyBehaviorStateMachineStateCommands: (plan) => ({
      plan,
      commands: plan.commands,
      results: [],
    }),
    preflightBehaviorStateMachineStateCommands: (plan) => ({
      plan,
      commands: plan.commands,
      results: [],
      mode: "overlay",
      clearOperations: [],
    }),
  };
  const inputActionControl: InputActionRuntimeControl = "enter";
  const inputActionBinding: InputActionRuntimeBinding = {
    control: inputActionControl,
    activation: "pressed",
  };
  const inputActionApi: FerrumInputActionApi = {
    setInputActionBinding: (actionId, bindingIndex, binding) =>
      actionId === 3 && bindingIndex === 0 && binding.control === "enter" && binding.activation === "pressed",
    clearInputActionBindings: (actionId) => actionId === 3,
    resetInputActionBindings: () => undefined,
  };
  const runtimeBudget: RuntimeDiagnosticsBudget = { maxFrameTimeMs: 16.7, maxAssetLoadElapsedMs: 250 };
  const physicsRuntimeBudget: RuntimeDiagnosticsBudget = {
    maxPhysicsCcdChecks: 0,
    maxPhysicsDebugLineCount: 0,
  };
  const runtimeFrameSample: RuntimeDiagnosticsFrameSample = runtimeDiagnosticsFrameSample({
    fps: 60,
    frameTimeMs: 16,
    rustUpdateTimeMs: 1,
    renderTimeMs: 2,
    entityCount: 1,
    spriteCount: 1,
    drawCalls: 1,
    batchCount: 1,
    physicsCcdChecks: 0,
    physicsDebugLineCount: 0,
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
  equal(publicDeriveHd2dTileOccluders(hd2dTileOccluderGrid)[0]?.height, 28);
  equal(hd2dKinematicOptions.displacementX, 8);
  equal(hd2dKinematicResult.body.bodyType, "kinematic");
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
  const dataSceneState: DataSceneStateSnapshot = {
    format: DATA_SCENE_STATE_FORMAT,
    version: DATA_SCENE_STATE_VERSION,
    scene: {
      score: 0,
      gameState: 1,
      entityCount: 0,
      spriteCount: 0,
      cameraX: 0,
      cameraY: 0,
    },
    custom: gameStateCustom,
  };
  const builtInShooterState: BuiltInShooterStateSnapshot = {
    format: "ferrum2d.builtin-shooter-state",
    version: BUILT_IN_SHOOTER_STATE_VERSION,
    headerFloats: [0, 1, 0, 0, 400, 240, 0, 0],
    headerU32s: [
      BUILT_IN_SHOOTER_STATE_VERSION,
      1,
      3,
      0,
      0,
      0,
      0,
      0,
      0,
      ...Array(BUILT_IN_SHOOTER_STATE_HEADER_U32S - 9).fill(0),
    ],
    entityFloats: [400, 240, 0, 0, ...Array(BUILT_IN_SHOOTER_STATE_FLOATS_PER_ENTITY - 4).fill(0)],
    entityU32s: [0, ...Array(BUILT_IN_SHOOTER_STATE_U32S_PER_ENTITY - 1).fill(0)],
    entityCount: 1,
    floatsPerEntity: BUILT_IN_SHOOTER_STATE_FLOATS_PER_ENTITY,
    u32sPerEntity: BUILT_IN_SHOOTER_STATE_U32S_PER_ENTITY,
  };
  const publicCaptureGameStateSnapshot: PublicApi["captureGameStateSnapshot"] = captureGameStateSnapshot;
  const publicDataSceneStateFormat: PublicApi["DATA_SCENE_STATE_FORMAT"] = DATA_SCENE_STATE_FORMAT;
  const publicDataSceneStateVersion: PublicApi["DATA_SCENE_STATE_VERSION"] = DATA_SCENE_STATE_VERSION;
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
  const dataSceneGameStateSnapshot: GameStateSnapshot = publicCaptureGameStateSnapshot(
    snapshotEngine as FerrumEngine,
    { includeDataSceneState: true, dataSceneCustomState: gameStateCustom },
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
  equal(publicEvaluateRuntimeProfilerBudget(runtimeSnapshot, physicsRuntimeBudget).passed, true);
  equal(runtimeReport.passed, true);
  validateDataSceneStateSnapshot(dataSceneState);
  equal(gameplayAuthoringApi.gameplayEntityExists({ entityId: 1, entityGeneration: 1 }), true);
  equal(gameplayAuthoringApi.gameplayBehaviorState({ entityId: 1, entityGeneration: 1 }), 1);
  equal(inputActionApi.setInputActionBinding(3, 0, inputActionBinding), true);
  equal(inputActionApi.clearInputActionBindings(3), true);
  inputActionApi.resetInputActionBindings();
  equal(runtimeViolation, undefined);
  equal(publicDataSceneStateFormat, "ferrum2d.data-scene-state");
  equal(publicDataSceneStateVersion, 1);
  equal(publicGameStateSnapshotFormat, "ferrum2d.game-state.snapshot");
  equal(publicGameStateSnapshotVersion, 1);
  equal(gameStateSnapshot.format, GAME_STATE_SNAPSHOT_FORMAT);
  equal(dataSceneGameStateSnapshot.dataScene?.format, DATA_SCENE_STATE_FORMAT);
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
    includeEffectEvents: true,
    includeGameplayEvents: true,
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
  const runtimeHudComponents: readonly HudComponentSpec[] = [
    { type: "counter", id: "score", label: "Score", value: 100 },
    { type: "message", id: "hint", text: "Runtime HUD" },
  ];
  const runtimeHudComponentProvider: FerrumRuntimeHudComponentProvider = (runtimeFrame) => [
    ...runtimeHudComponents,
    {
      type: "counter",
      id: "commands",
      label: "Commands",
      value: runtimeFrame.rendererStats.renderCommandCount,
    },
  ];
  const runtimeHudOptions: FerrumRuntimeHudOptions = {
    panelId: "runtime-hud",
    title: "Runtime HUD",
    region: "top-right",
    components: runtimeHudComponentProvider,
  };
  const runtimeSubtitleProvider: FerrumRuntimeSubtitleProvider = (runtimeFrame) => ({
    id: "runtime-subtitles",
    speaker: "Guide",
    text: `Score ${runtimeFrame.frame.score}`,
    region: "bottom-left",
  });
  const runtimeAccessibilityOptions: FerrumRuntimeAccessibilityOptions = {
    spec: {
      subtitles: true,
      contrastPalette: "high-contrast",
      reducedMotion: false,
    },
    subtitle: runtimeSubtitleProvider,
    title: "Subtitles",
    applyUiTheme: true,
  };
  const runtimeAnimationTimelineSignals: FerrumRuntimeAnimationTimelineSignalProvider = (runtimeFrame) =>
    runtimeFrame.frame.score > 0 ? ["move"] : [];
  const runtimeAnimationTimelineOptions: FerrumRuntimeAnimationTimelineOptions = {
    timeline: {
      initialState: "idle",
      states: {
        idle: {
          frames: ["idle.0", "idle.1"],
          fps: 2,
          transitions: [{ on: "move", to: "move" }],
        },
        move: {
          frames: ["move.0", "move.1"],
          fps: 4,
          events: [{ frame: 1, id: "step" }],
        },
      },
    },
    signals: runtimeAnimationTimelineSignals,
    maxEvents: 4,
    onUpdate: (result, runtimeFrame, animationTimeline) => {
      equal(result.snapshot.state, animationTimeline.snapshot().state);
      equal(runtimeFrame.frame.frameTimeMs >= 0, true);
    },
  };
  const runtimeLocalizationOptions: FerrumRuntimeLocalizationOptions = {
    locale: "ko",
    document: {
      defaultLocale: "en",
      fallbackLocale: "en",
      locales: {
        en: { strings: { "intro.ready": "Ready, {name}?" } },
        ko: { strings: { "intro.ready": "준비됐나요, {name}?" } },
      },
    },
  };
  const cutsceneTextMode: FerrumRuntimeCutsceneTextMode = "localizationKey";
  const cutsceneDialogueValues: FerrumRuntimeCutsceneDialogueValues = (_command, frame) => ({
    name: frame.frame.score > 0 ? "Agent" : "Player",
  });
  const cutsceneDialogueOptions: FerrumRuntimeCutsceneDialogueOptions = {
    title: "Intro",
    textMode: cutsceneTextMode,
    values: cutsceneDialogueValues,
  };
  const runtimeCutsceneOptions: FerrumRuntimeCutsceneOptions = {
    sequence: {
      id: "intro",
      commands: [
        { kind: "dialogue", speaker: "Guide", text: "intro.ready", durationSeconds: 1 },
      ],
    },
    dialogue: cutsceneDialogueOptions,
    onUpdate: (result, runtimeFrame, cutscene) => {
      equal(result.snapshot.sequenceId, cutscene.snapshot().sequenceId);
      equal(runtimeFrame.frame.frameTimeMs >= 0, true);
    },
  };
  const runtimeLevelStreamingViewport: LevelStreamingViewport = { x: 0, y: 0, width: 128, height: 128 };
  const runtimeLevelStreamingViewportProvider: FerrumRuntimeLevelStreamingViewportProvider = () =>
    runtimeLevelStreamingViewport;
  const runtimeLevelStreamingPreloadOptions: FerrumRuntimeLevelStreamingPreloadOptions = {
    fetch: globalThis.fetch,
  };
  const levelStreamingPixelMaskPhysicsOptions: LevelStreamingPixelMaskTerrainPhysicsOptions = {
    engine: {} as FerrumEngine,
  };
  const levelStreamingTilemapBoundaryOptions: LevelStreamingTilemapChunkBoundaryOptions = {
    physicsLayer: "world",
  };
  const runtimeReleasedAssetKind: FerrumRuntimeLevelStreamingReleasedAssetKind = "texture";
  const runtimeReleasedAsset: FerrumRuntimeLevelStreamingReleasedAsset = {
    kind: runtimeReleasedAssetKind,
    name: "terrain",
    url: "/terrain.png",
  };
  const runtimeReleasedAssets: FerrumRuntimeLevelStreamingReleasedAssets = {
    entries: [runtimeReleasedAsset],
    textures: [runtimeReleasedAsset],
    sounds: [],
    json: [],
    total: 1,
  };
  const runtimeLevelStreamingTarget: FerrumRuntimeLevelStreamingTarget = {
    applyChunk: (chunk, context: FerrumRuntimeLevelStreamingChunkContext) => {
      equal(context.result.loadChunkIds.includes(chunk.id), true);
    },
    unloadChunk: (chunk, context) => {
      equal(context.result.unloadChunkIds.includes(chunk.id), true);
    },
    releaseAssets: (assets) => {
      equal(assets.total, runtimeReleasedAssets.total);
    },
    rebuildColliders: (context) => {
      equal(context.levelStreaming.snapshot().manifestId, context.result.snapshot.manifestId);
    },
  };
  const runtimeLevelStreamingOptions: FerrumRuntimeLevelStreamingOptions = {
    manifest: {
      id: "runtime-level",
      chunks: [{ id: "0,0", chunkX: 0, chunkY: 0 }],
    },
    viewport: runtimeLevelStreamingViewportProvider,
    preload: runtimeLevelStreamingPreloadOptions,
    target: runtimeLevelStreamingTarget,
    onPlan: (result: FerrumRuntimeLevelStreamingUpdateResult, runtimeFrame, levelStreaming) => {
      equal(result.snapshot.manifestId, levelStreaming.snapshot().manifestId);
      equal(runtimeFrame.frame.frameTimeMs >= 0, true);
    },
  };
  const publicCreateRuntimeLevelStreaming: PublicApi["createRuntimeLevelStreaming"] = createRuntimeLevelStreaming;
  const publicCreateLevelStreamingPixelMaskPhysics:
    PublicApi["createLevelStreamingPixelMaskTerrainPhysicsOptions"] =
      createLevelStreamingPixelMaskTerrainPhysicsOptions;
  const publicExtractLevelStreamingTilemapBoundary:
    PublicApi["extractLevelStreamingTilemapChunkBoundaryChains"] =
      extractLevelStreamingTilemapChunkBoundaryChains;
  const publicTilemapLayerForLevelStreamingChunk:
    PublicApi["tilemapLayerForLevelStreamingChunk"] =
      tilemapLayerForLevelStreamingChunk;
  const runtimeEnvironment: FerrumRuntimeEnvironment = "production";
  const runtimeEngineInstance = {} as FerrumEngine;
  const runtimeOptions: FerrumRuntimeOptions = {
    canvas: {} as HTMLCanvasElement,
    rendererPreference: "webgpu",
    webgl2: webgl2Options,
    webgpu: webgpuOptions,
    inputOptions: inputManagerOptions,
    ui: uiOptions,
    uiState: uiStateProvider,
    hud: runtimeHudOptions,
    accessibility: runtimeAccessibilityOptions,
    animationTimeline: runtimeAnimationTimelineOptions,
    localization: runtimeLocalizationOptions,
    cutscene: runtimeCutsceneOptions,
    levelStreaming: runtimeLevelStreamingOptions,
    environment: runtimeEnvironment,
    debug: false,
    profiler: runtimeProfilerOptions,
    lighting: lightingSceneProvider,
    postProcess: postProcessProvider,
    physicsDebugLines: true,
    physicsMode: "arcade",
    engine: options,
    onFrame: (runtimeFrame: FerrumRuntimeFrame) => {
      equal(runtimeFrame.rendererStats.drawCalls >= 0, true);
      equal(runtimeFrame.rendererStats.physicsDebugLineCount >= 0, true);
      equal(runtimeFrame.rendererStats.pointLightCount >= 0, true);
    },
  };
  const runtimeInjectedEngineOptions: FerrumRuntimeOptions = {
    canvas: {} as HTMLCanvasElement,
    engineInstance: runtimeEngineInstance,
  };
  const webGpuCreate: typeof WebGPURenderer.create = async () => {
    throw new Error("WebGPU compatibility shim");
  };
  const nullableCreatedRenderer: CreatedRenderer | undefined = undefined;
  const nullableRuntimeRenderer: FerrumRuntimeRenderer | undefined = undefined;
  const nullableRuntimeHud: FerrumRuntimeHud | undefined = undefined;
  const nullableRuntimeAccessibility: FerrumRuntimeAccessibility | undefined = undefined;
  const nullableRuntimeAnimationTimeline: FerrumRuntimeAnimationTimeline | undefined = undefined;
  const nullableRuntimeLocalization: FerrumRuntimeLocalization | undefined = undefined;
  const nullableRuntimeCutscene: FerrumRuntimeCutscene | undefined = undefined;
  const nullableRuntimeLevelStreaming: FerrumRuntimeLevelStreaming | undefined = undefined;
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
    hd2dFilteredEntityCandidates: 0,
    hd2dFilteredTileCandidates: 0,
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
  equal(runtimeOptions.hud, runtimeHudOptions);
  equal(runtimeOptions.accessibility, runtimeAccessibilityOptions);
  equal(runtimeOptions.animationTimeline, runtimeAnimationTimelineOptions);
  equal(runtimeOptions.localization, runtimeLocalizationOptions);
  equal(runtimeOptions.cutscene, runtimeCutsceneOptions);
  equal(runtimeOptions.levelStreaming, runtimeLevelStreamingOptions);
  equal(runtimeOptions.debug, false);
  equal(runtimeOptions.engine, options);
  equal(runtimeInjectedEngineOptions.engineInstance, runtimeEngineInstance);
  equal(runtimeOptions.uiState?.({} as FerrumRuntimeFrame).panels?.[0]?.id, "hud");
  equal(typeof webGpuCreate, "function");
  equal(nullableCreatedRenderer, undefined);
  equal(nullableRuntimeRenderer, undefined);
  equal(typeof publicCreateLevelStreamingPixelMaskPhysics, "function");
  equal(typeof publicExtractLevelStreamingTilemapBoundary, "function");
  equal(typeof publicTilemapLayerForLevelStreamingChunk, "function");
  equal(levelStreamingPixelMaskPhysicsOptions.engine, levelStreamingPixelMaskPhysicsOptions.engine);
  equal(levelStreamingTilemapBoundaryOptions.physicsLayer, "world");
  equal(nullableRuntimeHud, undefined);
  equal(nullableRuntimeAccessibility, undefined);
  equal(nullableRuntimeAnimationTimeline, undefined);
  equal(nullableRuntimeLocalization, undefined);
  equal(nullableRuntimeCutscene, undefined);
  equal(nullableRuntimeLevelStreaming, undefined);
  equal(typeof publicCreateRuntimeLevelStreaming, "function");
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
    actionDiagnostics: {
      triggerAttempts: 0,
      triggerFailures: 0,
      triggerFailureEventsPushed: 0,
      triggerCommitSkips: 0,
      failureReasonCounts: [],
    },
    spawnDiagnostics: {
      commandsDrained: 0,
      projectileSpawns: 0,
      projectileArcsApplied: 0,
      projectileShootAudioEventsPushed: 0,
      prefabSpawns: 0,
      prefabSpawnedPayloads: 0,
      prefabSpawnedEventsPushed: 0,
    },
    audioEventCount: 0,
    audioEvents: [],
    physics: physicsStats,
    collisionEventBuffer,
    collisionEvents: [collisionEvent],
    gameplayEventBuffer: {
      buffer: new Uint32Array(0),
      eventCount: 0,
      u32sPerEvent: 8,
    },
    gameplayEvents: [],
    effectEventBuffer: {
      buffer: new DataView(new ArrayBuffer(0)),
      eventCount: 0,
      bytesPerEvent: 40,
    },
    effectEvents: [],
    physicsDebugLineBuffer,
    physicsDebugLines: [physicsDebugLine],
    renderCommands: [],
    renderCommandBuffer: {
      buffer: new Float32Array(0),
      commandCount: 0,
      floatsPerCommand: 15,
    },
  });
});
