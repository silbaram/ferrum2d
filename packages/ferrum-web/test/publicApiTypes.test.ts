import { equal } from "node:assert/strict";
import { test } from "node:test";
import type {
  AssetManifest,
  AudioAssetLoader,
  AudioBusConfig,
  AudioManagerConfig,
  BrowserPlatformHost,
  CreateEngineOptions,
  AssetHost,
  FerrumEngine,
  FrameHandler,
  FrameState,
  InputProvider,
  Renderer,
  RendererStats,
  ShooterAtlasFrameSpec,
  ShooterAtlasSpec,
  ShooterCameraPreset,
  ShooterCameraSpec,
  ShooterEnemyPresetSpec,
  ShooterGameSpec,
  ShooterTileLayerSpec,
  ShooterTilemapSpec,
  ShooterTileSpec,
  ShooterWaveSpec,
  ResolvedShooterTilemap,
  ViewportProvider,
} from "../src/index.js";

test("public API types are importable from entrypoint source", () => {
  const manifest: AssetManifest = {
    textures: { player: "/assets/player.png" },
    sounds: { shoot: "/assets/shoot.wav" },
    json: { game: "/game.json" },
  };
  const options: CreateEngineOptions = { includeDeprecatedRenderCommands: false };
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
  const waveSpec: ShooterWaveSpec = gameSpec.enemies?.waves?.[0] ?? {};
  const tilemapSpec: ShooterTilemapSpec = gameSpec.tilemap ?? {};
  const tileSpec: ShooterTileSpec = tilemapSpec.tiles?.["1"] ?? {};
  const tileLayerSpec: ShooterTileLayerSpec = tilemapSpec.layers?.[0] ?? {};
  const audioBusConfig: AudioBusConfig = { masterVolume: 0.9, sfxVolume: 0.7 };
  const audioManagerConfig: AudioManagerConfig = { masterVolume: 0.9 };
  const resolvedTilemap: ResolvedShooterTilemap = { tiles: [], layers: [] };

  const onFrame: FrameHandler = (frame: FrameState) => {
    const commandCount = frame.renderCommandBuffer.commandCount;
    equal(commandCount >= 0, true);
  };
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
  const engine: Pick<FerrumEngine, "setGameSpec"> = {
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
  };

  equal(manifest.textures?.player, "/assets/player.png");
  equal(options.includeDeprecatedRenderCommands, false);
  equal(gameSpec.world?.width, 1600);
  equal(cameraSpec.preset, "look-ahead");
  equal(atlasFrameSpec.texture, "bullet");
  equal(enemyPresetSpec.health, 4);
  equal(waveSpec.enemyCount, 6);
  equal(tileSpec.frame, "bullet");
  equal(tileLayerSpec.columns, 1);
  equal(tileLayerSpec.collision, true);
  equal(resolvedTilemap.layers.length, 0);
  equal(audioBusConfig.sfxVolume, 0.7);
  equal(audioManagerConfig.masterVolume, 0.9);
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
    audioEvents: [],
    renderCommands: [],
    renderCommandBuffer: {
      buffer: new Float32Array(0),
      commandCount: 0,
      floatsPerCommand: 13,
    },
  });
});
