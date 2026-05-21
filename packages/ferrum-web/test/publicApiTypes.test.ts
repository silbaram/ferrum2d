import { equal } from "node:assert/strict";
import { test } from "node:test";
import { decodeCollisionEvents } from "../src/index.js";
import type {
  AssetManifest,
  AudioAssetLoader,
  AudioBusConfig,
  AudioManagerConfig,
  AtlasSpriteInput,
  AtlasSpritePlacement,
  CreateRendererOptions,
  DiagnosticCode,
  DiagnosticContext,
  DiagnosticReport,
  RendererFallbackInfo,
  BrowserPlatformHost,
  CreateEngineOptions,
  FerrumRuntime,
  FerrumRuntimeEnvironment,
  FerrumRuntimeFrame,
  FerrumRuntimeOptions,
  EngineLifecycleHooks,
  EngineLifecycleSnapshot,
  AssetHost,
  FerrumEngine,
  FixedTimestepOptions,
  FrameHandler,
  FrameState,
  InputProvider,
  PhysicsFrameStats,
  Renderer,
  RendererStats,
  ShooterAtlasFrameSpec,
  ShooterAtlasSpec,
  ShooterCameraPreset,
  ShooterCameraSpec,
  ShooterEnemyOrbitSpec,
  ShooterEnemyPresetSpec,
  ShooterGameSpec,
  ShooterTileLayerSpec,
  ShooterTilemapSpec,
  ShooterTileSpec,
  ShooterWaveSpec,
  ResolvedShooterTilemap,
  ViewportProvider,
  WebGPURenderer,
  WebGL2RendererOptions,
  CollisionEventBufferView,
  CollisionEventView,
  createFerrumRuntime,
  generateTextureAtlasLayout,
} from "../src/index.js";

test("public API types are importable from entrypoint source", () => {
  const manifest: AssetManifest = {
    textures: { player: "/assets/player.png" },
    sounds: { shoot: "/assets/shoot.wav" },
    json: { game: "/game.json" },
  };
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
    fixedTimestep: { stepSeconds: 1 / 60, maxFrameSeconds: 0.25, maxStepsPerUpdate: 8 },
    lifecycle: lifecycleHooks,
  };
  const fixedTimestepOptions: FixedTimestepOptions = { enabled: true, stepSeconds: 1 / 120 };
  const rendererOptions: CreateRendererOptions = {
    preferred: "webgpu",
    fallbackBehavior: "silent",
    onFallback: (info: RendererFallbackInfo) => {
      equal(info.fallback, "webgl2");
    },
  };
  const webgl2Options: WebGL2RendererOptions = { clearColor: [0, 0, 0, 1], preserveDrawingBuffer: true };
  const runtimeEnvironment: FerrumRuntimeEnvironment = "production";
  const runtimeOptions: FerrumRuntimeOptions = {
    canvas: {} as HTMLCanvasElement,
    webgl2: webgl2Options,
    environment: runtimeEnvironment,
    debug: false,
    onFrame: (runtimeFrame: FerrumRuntimeFrame) => {
      equal(runtimeFrame.rendererStats.drawCalls >= 0, true);
    },
  };
  const gameSpec: ShooterGameSpec = {
    world: { width: 1600, height: 960 },
    player: { speed: 180 },
    atlas: {
      frames: {
        bullet: {
          texture: "bullet",
          uv: { u0: 0, v0: 0, u1: 1, v1: 1 },
          size: { width: 8, height: 8 },
        },
      },
    },
    prefabs: { bullet: { frame: "bullet" } },
    tilemap: {
      tileWidth: 32,
      tileHeight: 32,
      tiles: { "1": { frame: "bullet", color: [1, 1, 1, 1] } },
      layers: [{ columns: 1, rows: 1, collision: true, data: [1] }],
    },
    camera: { preset: "look-ahead", lookAhead: { distance: 96 } },
    enemies: {
      orbit: { radius: 180, radialBand: 24 },
      presets: { bruiser: { health: 4, scoreReward: 8 } },
      waves: [{ enemy: "bruiser", duration: 12, spawnInterval: 1, enemyCount: 6 }],
    },
    audio: { masterVolume: 0.9, sfxVolume: 0.7, events: { shoot: { volume: 0.3, pitch: 1.1 } } },
  };
  const cameraPreset: ShooterCameraPreset = "look-ahead";
  const cameraSpec: ShooterCameraSpec = { preset: cameraPreset };
  const atlasSpec: ShooterAtlasSpec = gameSpec.atlas ?? {};
  const atlasFrameSpec: ShooterAtlasFrameSpec = atlasSpec.frames?.bullet ?? {};
  const enemyPresetSpec: ShooterEnemyPresetSpec = gameSpec.enemies?.presets?.bruiser ?? {};
  const enemyOrbitSpec: ShooterEnemyOrbitSpec = gameSpec.enemies?.orbit ?? {};
  const orbitEnemyPresetSpec: ShooterEnemyPresetSpec = { behavior: "orbit", speed: 84 };
  const waveSpec: ShooterWaveSpec = gameSpec.enemies?.waves?.[0] ?? {};
  const tilemapSpec: ShooterTilemapSpec = gameSpec.tilemap ?? {};
  const tileSpec: ShooterTileSpec = tilemapSpec.tiles?.["1"] ?? {};
  const tileLayerSpec: ShooterTileLayerSpec = tilemapSpec.layers?.[0] ?? {};
  const audioBusConfig: AudioBusConfig = { masterVolume: 0.9, sfxVolume: 0.7 };
  const audioManagerConfig: AudioManagerConfig = { masterVolume: 0.9, bgmVolume: 0.2 };
  const diagnosticCode: DiagnosticCode = "FERRUM_ASSET_LOAD";
  const diagnosticContext: DiagnosticContext = {
    kind: "texture",
    name: "player",
    url: "/assets/player.png",
    detail: "HTTP 404 Not Found",
  };
  const diagnosticReport: DiagnosticReport = {
    code: diagnosticCode,
    message: "Asset load error",
    context: diagnosticContext,
  };
  const resolvedTilemap: ResolvedShooterTilemap = { tiles: [], layers: [] };
  const atlasSprite: AtlasSpriteInput = { name: "compat", width: 8, height: 8 };
  const atlasPlacement: AtlasSpritePlacement = {
    name: atlasSprite.name,
    x: 0,
    y: 0,
    width: atlasSprite.width,
    height: atlasSprite.height,
    u0: 0,
    v0: 0,
    u1: 1,
    v1: 1,
  };
  const atlasLayoutFn: typeof generateTextureAtlasLayout = (() => ({
    width: 8,
    height: 8,
    sprites: [atlasPlacement],
  })) as typeof generateTextureAtlasLayout;
  const webGpuCreate: typeof WebGPURenderer.create = async () => {
    throw new Error("WebGPU compatibility shim");
  };
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
  };
  const physicsStats: PhysicsFrameStats = {
    fixedTimestepEnabled: true,
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
    collisionEnterEvents: 1,
    collisionStayEvents: 0,
    collisionExitEvents: 0,
    collisionHitEvents: 0,
    collisionEventCount: 1,
  };
  const collisionEventBuffer: CollisionEventBufferView = {
    buffer: new Uint32Array([1, 0, 0, 1, 0]),
    eventCount: 1,
    u32sPerEvent: 5,
  };
  const collisionEvent: CollisionEventView = decodeCollisionEvents(collisionEventBuffer)[0];
  const inputProvider: InputProvider = () => ({
    w: false,
    a: false,
    s: false,
    d: false,
    space: false,
    enter: false,
    mouseLeft: false,
    mouseX: 0,
    mouseY: 0,
  });
  const viewportProvider: ViewportProvider = () => ({ width: 800, height: 480 });
  const stats: RendererStats = {
    drawCalls: 0,
    batchCount: 0,
    spriteCount: 0,
    renderCommandCount: 0,
    textureBindCount: 0,
    textureSwitchCount: 0,
  };
  const renderer: Pick<Renderer, "stats"> = { stats: () => stats };
  const assetHost: Pick<AssetHost, "textureId"> = { textureId: () => 1 };
  const browserPlatformHost: Pick<BrowserPlatformHost, "textureId" | "destroy"> = {
    textureId: () => 1,
    destroy: () => undefined,
  };
  const audioAssetLoader: Pick<AudioAssetLoader, "load"> = {
    load: async () => ({}) as AudioBuffer,
  };
  const engine: Pick<FerrumEngine, "setGameSpec" | "configureFixedTimestep"> = {
    setGameSpec: () => ({
      worldWidth: 1600,
      worldHeight: 960,
      playerSpeed: 180,
      enemySpeed: 72,
      enemySpawnInterval: 1,
      bulletSpeed: 360,
      fireCooldown: 0.12,
      bulletLifetime: 1.8,
      playerWidth: 36,
      playerHeight: 36,
      enemyWidth: 24,
      enemyHeight: 24,
      bulletWidth: 8,
      bulletHeight: 8,
      playerAnimationFrames: 1,
      playerAnimationFps: 0,
      playerAnimationColumns: 1,
      playerAnimationRows: 1,
      playerAnimationIdleRow: 0,
      playerAnimationIdleFrames: 1,
      playerAnimationIdleFps: 1,
      playerAnimationMoveRow: 0,
      playerAnimationMoveFrames: 1,
      playerAnimationMoveFps: 1,
      enemyAnimationFrames: 1,
      enemyAnimationFps: 0,
      enemyAnimationColumns: 1,
      enemyAnimationRows: 1,
      enemyAnimationIdleRow: 0,
      enemyAnimationIdleFrames: 1,
      enemyAnimationIdleFps: 1,
      enemyAnimationMoveRow: 0,
      enemyAnimationMoveFrames: 1,
      enemyAnimationMoveFps: 1,
      bulletAnimationFrames: 1,
      bulletAnimationFps: 0,
      bulletAnimationColumns: 1,
      bulletAnimationRows: 1,
      bulletAnimationIdleRow: 0,
      bulletAnimationIdleFrames: 1,
      bulletAnimationIdleFps: 1,
      bulletAnimationMoveRow: 0,
      bulletAnimationMoveFrames: 1,
      bulletAnimationMoveFps: 1,
      enemyBehavior: "chase",
      enemyBehaviorCode: 0,
      enemySpawnPattern: "edge",
      enemySpawnPatternCode: 0,
      enemyHealth: 1,
      bulletDamage: 1,
      scoreReward: 1,
      orbitRadius: 180,
      orbitRadialBand: 24,
      cameraPreset: "look-ahead",
      cameraPresetCode: 2,
      cameraDeadZoneWidth: 160,
      cameraDeadZoneHeight: 96,
      cameraLookAheadDistance: 96,
      cameraShakeAmplitude: 6,
      cameraShakeFrequency: 8,
      atlasFrames: {},
      tilemap: resolvedTilemap,
      waves: [],
      audioMasterVolume: 0.9,
      audioSfxVolume: 0.7,
      shootVolume: 0.3,
      shootPitch: 1.1,
      hitVolume: 0.45,
      hitPitch: 1,
      gameOverVolume: 0.65,
      gameOverPitch: 0.9,
    }),
    configureFixedTimestep: () => undefined,
  };

  equal(manifest.textures?.player, "/assets/player.png");
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
  equal(runtimeOptions.debug, false);
  equal(gameSpec.world?.width, 1600);
  equal(cameraSpec.preset, "look-ahead");
  equal(atlasFrameSpec.texture, "bullet");
  equal(enemyPresetSpec.health, 4);
  equal(enemyOrbitSpec.radius, 180);
  equal(orbitEnemyPresetSpec.behavior, "orbit");
  equal(waveSpec.enemyCount, 6);
  equal(tileSpec.frame, "bullet");
  equal(tileLayerSpec.columns, 1);
  equal(tileLayerSpec.collision, true);
  equal(resolvedTilemap.layers.length, 0);
  equal(audioBusConfig.sfxVolume, 0.7);
  equal(audioManagerConfig.bgmVolume, 0.2);
  equal(diagnosticReport.context?.kind, "texture");
  equal(atlasPlacement.name, "compat");
  equal(atlasLayoutFn([atlasSprite]).sprites[0].name, "compat");
  equal(typeof webGpuCreate, "function");
  equal(typeof runtimeCreate, "function");
  equal(physicsStats.collisionEventCount, 1);
  equal(collisionEvent.kind, "enter");
  equal(inputProvider().mouseX, 0);
  equal(viewportProvider().height, 480);
  equal(renderer.stats().drawCalls, 0);
  equal(assetHost.textureId("player"), 1);
  equal(browserPlatformHost.textureId("player"), 1);
  equal(typeof audioAssetLoader.load, "function");
  equal(engine.setGameSpec(gameSpec).enemyBehavior, "chase");
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
    renderCommands: [],
    renderCommandBuffer: {
      buffer: new Float32Array(0),
      commandCount: 0,
      floatsPerCommand: 13,
    },
  });
});
