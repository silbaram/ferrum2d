import { equal } from "node:assert/strict";
import { test } from "node:test";
import {
  importAsepriteAtlas,
  importAsepriteAtlasFrames,
  importLDtkGameSpec,
  importLDtkTilemap,
  importTiledGameSpec,
  importTiledTilemap,
} from "../src/assetPipeline.js";
import { decodeCollisionEvents } from "../src/collisionEventDecoder.js";
import { decodePhysicsDebugLines } from "../src/physicsDebugLineDecoder.js";
import {
  decodePhysicsBodyContactHits,
  decodePhysicsBodyManifoldHits,
  decodePhysicsQueryHits,
  decodePhysicsRaycastHits,
  decodePhysicsRigidContactImpulseHits,
  decodePhysicsShapeCastHits,
  decodePhysicsTileContactHits,
  decodePhysicsTileManifoldHits,
  decodePhysicsTileRaycastHits,
  decodePhysicsTileShapeCastHits,
} from "../src/physicsQueryDecoder.js";
import { resolvePhysicsSpec } from "../src/physicsSpec.js";
import {
  createCollider,
  createPhysicsLayerMap,
  createPhysicsLayerSpec,
  createPhysicsWorldFromSpec,
  createRigidBody,
  physicsMaterial,
} from "../src/physicsAuthoring.js";
import { createPhysicsReplayInputStream } from "../src/physicsSnapshot.js";
import type {
  AsepriteAtlasImportOptions,
  AsepriteAtlasImportResult,
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
  UiOverlayStateProvider,
  EngineLifecycleHooks,
  EngineLifecycleSnapshot,
  AssetHost,
  FerrumEngine,
  FixedTimestepOptions,
  FrameHandler,
  FrameState,
  InputManagerOptions,
  InputProvider,
  PhysicsAabbTileObstacleContactQuery,
  PhysicsAabbTileObstacleManifoldQuery,
  PhysicsDebugLineCamera,
  PhysicsDebugOptions,
  PhysicsDebugSpec,
  PhysicsFrameStats,
  PhysicsLayerPattern,
  PhysicsLayerSpec,
  PhysicsMaterialPresetName,
  PhysicsMode,
  PhysicsSpec,
  PhysicsAabbBodyShapeCastQuery,
  PhysicsAabbBodyQuery,
  PhysicsAabbTileObstacleShapeCastQuery,
  PhysicsAuthoringLayer,
  PhysicsBodyColliderOptions,
  PhysicsBodyColliderSnapshot,
  PhysicsBodyContactHit,
  PhysicsBodyContactHitBufferView,
  PhysicsBodyContactQuery,
  PhysicsBodyManifoldHit,
  PhysicsBodyManifoldHitBufferView,
  PhysicsBodyManifoldQuery,
  PhysicsBodyQueryHit,
  PhysicsCapsuleBodyShapeCastQuery,
  PhysicsCapsuleBodyQuery,
  PhysicsCircleBodyShapeCastQuery,
  PhysicsCircleBodyQuery,
  PhysicsConvexPolygonBodyShapeCastQuery,
  PhysicsConvexPolygonBodyQuery,
  PhysicsConvexPolygonVertexBuffer,
  PhysicsColliderAuthoringOptions,
  PhysicsColliderType,
  PhysicsCollisionLayer,
  PhysicsEntityHandle,
  PhysicsEntitySnapshot,
  PhysicsJointBaseOptions,
  PhysicsJointHandle,
  PhysicsJointSnapshot,
  PhysicsJointSpawnOptions,
  PhysicsJointType,
  ParticleColor,
  ParticlePresetConfig,
  ParticleRangeInput,
  ParticleTextureRef,
  ParticleUvRect,
  PhysicsNearestBodyHit,
  PhysicsNearestBodyQuery,
  PhysicsNearestTileObstacleHit,
  PhysicsNearestTileObstacleQuery,
  PhysicsOrientedBoxBodyQuery,
  PhysicsPointBodyQuery,
  PhysicsQueryHitBufferView,
  PhysicsRaycastBodyHit,
  PhysicsRaycastBodyQuery,
  PhysicsRaycastHitBufferView,
  PhysicsRaycastTileObstacleQuery,
  PhysicsRigidContactImpulseHit,
  PhysicsRigidContactImpulseHitBufferView,
  PhysicsRigidBodyAuthoringOptions,
  PhysicsRigidBodyCollider,
  PhysicsRigidBodyMassProperties,
  PhysicsRigidBodyMaterial,
  PhysicsRigidBodySpawnOptions,
  PhysicsRigidBodyStepOptions,
  PhysicsRigidBodyStepStats,
  PhysicsRigidBodyTuning,
  PhysicsRigidBodyType,
  PhysicsMaterialSnapshot,
  PhysicsSegmentCastBodyQuery,
  PhysicsSegmentCastTileObstacleQuery,
  PhysicsShapeCastBodyHit,
  PhysicsShapeCastHitBufferView,
  PhysicsTileContactHit,
  PhysicsTileContactHitBufferView,
  PhysicsTileManifoldHit,
  PhysicsTileManifoldHitBufferView,
  PhysicsTileRaycastHit,
  PhysicsTileRaycastHitBufferView,
  PhysicsTileShapeCastHit,
  PhysicsTileShapeCastHitBufferView,
  PhysicsTileShapeCastMotionQuery,
  PhysicsOrientedBoxBodyShapeCastQuery,
  PhysicsReplayInputEvent,
  PhysicsReplayInputRunResult,
  PhysicsReplayInputStream,
  PhysicsWorldApplyResult,
  Renderer,
  RendererStats,
  LDtkTilemapImportOptions,
  LDtkTilemapImportResult,
  LDtkTilesetFrameContext,
  ResolvedShooterAtlasAnimation,
  ResolvedShooterAtlasAnimationState,
  ResolvedShooterPhysicsMaterial,
  ResolvedShooterPrefabColliderBase,
  ResolvedShooterPrefabCollider,
  ResolvedShooterPrefabColliderVertex,
  ShooterPrefabColliderType,
  ShooterAtlasFrameSpec,
  ShooterAtlasSpec,
  ShooterAtlasAnimationSpec,
  ShooterAtlasAnimationStateSpec,
  ShooterCameraPreset,
  ShooterCameraSpec,
  ShooterEnemyOrbitSpec,
  ShooterEnemyPresetSpec,
  ShooterGameSpec,
  ShooterPhysicsMaterialSpec,
  ShooterPrefabColliderSpec,
  ShooterTileLayerSpec,
  ShooterTilemapSpec,
  ShooterTileSlopeSpec,
  ShooterTileSpec,
  ResolvedShooterTileDefinition,
  ResolvedShooterTileSlopeDefinition,
  ShooterWaveSpec,
  ResolvedShooterTilemap,
  ViewportProvider,
  WebGPURenderer,
  WebGL2RendererOptions,
  CollisionEventBufferView,
  CollisionEventView,
  PhysicsDebugLineBufferView,
  PhysicsDebugLineView,
  TiledTilemapImportOptions,
  TiledTilemapImportResult,
  TiledTilesetFrameContext,
  UiOverlay,
  UiOverlayActionEvent,
  UiOverlayOptions,
  UiOverlayState,
  createFerrumRuntime,
  generateTextureAtlasLayout,
} from "../src/index.js";

type PublicApi = typeof import("../src/index.js");

test("public API types are importable from entrypoint source", () => {
  const manifest: AssetManifest = {
    textures: { player: "/assets/player.png" },
    sounds: { shoot: "/assets/shoot.wav" },
    json: { game: "/game.json" },
  };
  const publicCreateCollider: PublicApi["createCollider"] = createCollider;
  const publicCreateRigidBody: PublicApi["createRigidBody"] = createRigidBody;
  const publicCreatePhysicsWorldFromSpec: PublicApi["createPhysicsWorldFromSpec"] = createPhysicsWorldFromSpec;
  const publicCreatePhysicsLayerSpec: PublicApi["createPhysicsLayerSpec"] = createPhysicsLayerSpec;
  const publicCreatePhysicsLayerMap: PublicApi["createPhysicsLayerMap"] = createPhysicsLayerMap;
  const publicPhysicsMaterial: PublicApi["physicsMaterial"] = physicsMaterial;
  const publicCreatePhysicsReplayInputStream: PublicApi["createPhysicsReplayInputStream"] =
    createPhysicsReplayInputStream;
  const authoringCollider: PhysicsColliderAuthoringOptions = { type: "box", size: [16, 24] };
  const bodyAuthoring: PhysicsRigidBodyAuthoringOptions = {
    collider: authoringCollider,
    material: "wood",
    layer: "player",
  };
  const layerPattern: PhysicsLayerPattern = { player: ["world"], world: ["player"] };
  const authoringLayerSpec = publicCreatePhysicsLayerSpec(layerPattern);
  const physicsLayerMap: Record<string, PhysicsAuthoringLayer> = publicCreatePhysicsLayerMap(layerPattern);
  const materialPreset: PhysicsMaterialPresetName = "wood";
  const bodyCollider = publicCreateCollider(authoringCollider);
  const material = publicPhysicsMaterial(materialPreset);
  const nullableWorld: PhysicsWorldApplyResult | undefined = undefined;
  const replayEvent: PhysicsReplayInputEvent = {
    frame: 0,
    body: "crate",
    type: "setVelocity",
    velocityX: 1,
    velocityY: 0,
  };
  const replayInputStream: PhysicsReplayInputStream = publicCreatePhysicsReplayInputStream({
    frameCount: 1,
    events: [replayEvent],
  });
  const nullableReplayRun: PhysicsReplayInputRunResult | undefined = undefined;
  equal(typeof publicCreateRigidBody, "function");
  equal(typeof publicCreatePhysicsWorldFromSpec, "function");
  equal(replayInputStream.frameCount, 1);
  equal(bodyCollider.type, "aabb");
  equal(material.density, 0.8);
  equal(authoringLayerSpec.player.mask[0], "world");
  equal(physicsLayerMap.player.maskBits, 2);
  equal(bodyAuthoring.material, "wood");
  equal(nullableWorld, undefined);
  equal(nullableReplayRun, undefined);
  const asepriteImportOptions: AsepriteAtlasImportOptions = { texture: "sprites" };
  const publicImportAsepriteAtlas: PublicApi["importAsepriteAtlas"] = importAsepriteAtlas;
  const asepriteImportResult: AsepriteAtlasImportResult = publicImportAsepriteAtlas({
    frames: {
      "player.png": { frame: { x: 0, y: 0, w: 16, h: 16 } },
    },
    meta: { size: { w: 32, h: 32 } },
  }, asepriteImportOptions);
  const publicImportAsepriteAtlasFrames: PublicApi["importAsepriteAtlasFrames"] = importAsepriteAtlasFrames;
  const tiledImportOptions: TiledTilemapImportOptions = {
    frameNameForGid: (context: TiledTilesetFrameContext) => `${context.tilesetName}.${context.localId}`,
  };
  const publicImportTiledTilemap: PublicApi["importTiledTilemap"] = importTiledTilemap;
  const tiledImportResult: TiledTilemapImportResult = publicImportTiledTilemap({
    orientation: "orthogonal",
    width: 1,
    height: 1,
    tilewidth: 8,
    tileheight: 8,
    tilesets: [{
      firstgid: 1,
      name: "terrain",
      imagewidth: 8,
      imageheight: 8,
      tilewidth: 8,
      tileheight: 8,
      columns: 1,
      tilecount: 1,
    }],
    layers: [{ type: "tilelayer", width: 1, height: 1, data: [1] }],
  }, tiledImportOptions);
  const publicImportTiledGameSpec: PublicApi["importTiledGameSpec"] = importTiledGameSpec;
  const ldtkImportOptions: LDtkTilemapImportOptions = {
    externalLevels: {},
    frameNameForTile: (context: LDtkTilesetFrameContext) => `${context.tilesetIdentifier}.${context.ldtkTileId}`,
  };
  const publicImportLDtkTilemap: PublicApi["importLDtkTilemap"] = importLDtkTilemap;
  const ldtkImportResult: LDtkTilemapImportResult = publicImportLDtkTilemap({
    defs: {
      tilesets: [{
        uid: 1,
        identifier: "terrain",
        pxWid: 8,
        pxHei: 8,
        tileGridSize: 8,
      }],
    },
    levels: [{
      identifier: "Level_0",
      pxWid: 8,
      pxHei: 8,
      layerInstances: [{
        __identifier: "ground",
        __type: "Tiles",
        __cWid: 1,
        __cHei: 1,
        __gridSize: 8,
        __tilesetDefUid: 1,
        gridTiles: [{ px: [0, 0], src: [0, 0], t: 0, f: 0 }],
      }],
    }],
  }, ldtkImportOptions);
  const publicImportLDtkGameSpec: PublicApi["importLDtkGameSpec"] = importLDtkGameSpec;
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
    onFallback: (info: RendererFallbackInfo) => {
      equal(info.fallback, "webgl2");
    },
  };
  const webgl2Options: WebGL2RendererOptions = { clearColor: [0, 0, 0, 1], preserveDrawingBuffer: true };
  const physicsDebugLineCamera: PhysicsDebugLineCamera = { x: 0, y: 0 };
  const inputManagerOptions: InputManagerOptions = {
    gamepad: true,
    gamepadDeadzone: 0.3,
    pointerGestures: true,
    pointerGestureThreshold: 16,
  };
  const uiOptions: UiOverlayOptions = {
    onAction: (event: UiOverlayActionEvent) => {
      equal(event.id.length > 0, true);
    },
  };
  const uiState: UiOverlayState = {
    panels: [{
      id: "hud",
      title: "HUD",
      lines: [{ id: "score", label: "Score", value: 0 }],
    }],
  };
  const uiStateProvider: UiOverlayStateProvider = () => uiState;
  const runtimeEnvironment: FerrumRuntimeEnvironment = "production";
  const runtimeOptions: FerrumRuntimeOptions = {
    canvas: {} as HTMLCanvasElement,
    webgl2: webgl2Options,
    inputOptions: inputManagerOptions,
    ui: uiOptions,
    uiState: uiStateProvider,
    environment: runtimeEnvironment,
    debug: false,
    physicsDebugLines: true,
    physicsMode: "arcade",
    onFrame: (runtimeFrame: FerrumRuntimeFrame) => {
      equal(runtimeFrame.rendererStats.drawCalls >= 0, true);
      equal(runtimeFrame.rendererStats.physicsDebugLineCount >= 0, true);
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
    prefabs: {
      bullet: {
        frame: "bullet",
        collider: {
          halfWidth: 4,
          halfHeight: 3,
          offset: { x: 1, y: -1 },
          material: { friction: 0.8, surfaceVelocity: { x: 2 } },
        },
      },
    },
    tilemap: {
      tileWidth: 32,
      tileHeight: 32,
      tiles: {
        "1": { frame: "bullet", color: [1, 1, 1, 1], slope: { x0: 0, y0: 1, x1: 1, y1: 0 } },
      },
      layers: [{ columns: 1, rows: 1, collision: true, collisionOnly: false, data: [1] }],
    },
    camera: { preset: "look-ahead", lookAhead: { distance: 96 } },
    enemies: {
      orbit: { radius: 180, radialBand: 24 },
      presets: { bruiser: { health: 4, scoreReward: 8 } },
      waves: [{ enemy: "bruiser", duration: 12, spawnInterval: 1, enemyCount: 6 }],
    },
    audio: { masterVolume: 0.9, sfxVolume: 0.7, events: { shoot: { volume: 0.3, pitch: 1.1 } } },
    physics: {
      mode: "rigid",
      gravity: [0, 700],
      materials: { wood: { friction: 0.6, restitution: 0.2, density: 0.8 } },
      layers: { player: { mask: ["world"] }, world: { mask: ["player"] } },
      bodies: {
        crate: {
          type: "dynamic",
          position: [320, 120],
          material: "wood",
          layer: "world",
          collider: { shape: "box", size: [32, 32] },
        },
      },
      joints: {
        hinge: { type: "revolute", bodyA: "world", bodyB: "crate", anchor: [320, 120] },
      },
      debug: { colliders: true },
    },
  };
  const physicsMode: PhysicsMode = gameSpec.physics?.mode ?? "arcade";
  const physicsSpec: PhysicsSpec = gameSpec.physics ?? {};
  const physicsLayerSpec: PhysicsLayerSpec = physicsSpec.layers?.player ?? {};
  const physicsDebugSpec: PhysicsDebugSpec = typeof physicsSpec.debug === "object" ? physicsSpec.debug : {};
  const physicsDebugOptions: PhysicsDebugOptions = physicsDebugSpec;
  const cameraPreset: ShooterCameraPreset = "look-ahead";
  const cameraSpec: ShooterCameraSpec = { preset: cameraPreset };
  const atlasSpec: ShooterAtlasSpec = gameSpec.atlas ?? {};
  const atlasFrameSpec: ShooterAtlasFrameSpec = atlasSpec.frames?.bullet ?? {};
  const atlasAnimationStateSpec: ShooterAtlasAnimationStateSpec = { frames: ["bullet"], fps: 1 };
  const atlasAnimationSpec: ShooterAtlasAnimationSpec = { idle: atlasAnimationStateSpec };
  const prefabColliderSpec: ShooterPrefabColliderSpec = gameSpec.prefabs?.bullet?.collider ?? {};
  const prefabColliderType: ShooterPrefabColliderType = prefabColliderSpec.type ?? "aabb";
  const physicsMaterialSpec: ShooterPhysicsMaterialSpec = prefabColliderSpec.material ?? {};
  const enemyPresetSpec: ShooterEnemyPresetSpec = gameSpec.enemies?.presets?.bruiser ?? {};
  const enemyOrbitSpec: ShooterEnemyOrbitSpec = gameSpec.enemies?.orbit ?? {};
  const orbitEnemyPresetSpec: ShooterEnemyPresetSpec = { behavior: "orbit", speed: 84 };
  const waveSpec: ShooterWaveSpec = gameSpec.enemies?.waves?.[0] ?? {};
  const tilemapSpec: ShooterTilemapSpec = gameSpec.tilemap ?? {};
  const tileSpec: ShooterTileSpec = tilemapSpec.tiles?.["1"] ?? {};
  const tileSlopeSpec: ShooterTileSlopeSpec = tileSpec.slope ?? { x0: 0, y0: 1, x1: 1, y1: 0 };
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
  const resolvedTileDefinition: ResolvedShooterTileDefinition = {
    id: 1,
    frame: { name: "bullet", texture: "bullet", width: 8, height: 8, u0: 0, v0: 0, u1: 1, v1: 1 },
    color: [1, 1, 1, 1],
    slope: { x0: 0, y0: 1, x1: 1, y1: 0 },
  };
  const resolvedAtlasAnimationState: ResolvedShooterAtlasAnimationState = {
    frames: [resolvedTileDefinition.frame],
    fps: 1,
  };
  const resolvedAtlasAnimation: ResolvedShooterAtlasAnimation = {
    texture: "bullet",
    width: 8,
    height: 8,
    idle: resolvedAtlasAnimationState,
    move: resolvedAtlasAnimationState,
  };
  const resolvedTileSlope: ResolvedShooterTileSlopeDefinition = resolvedTileDefinition.slope ?? {
    x0: 0,
    y0: 1,
    x1: 1,
    y1: 0,
  };
  const resolvedTilemap: ResolvedShooterTilemap = { tiles: [resolvedTileDefinition], layers: [] };
  const resolvedPhysicsMaterial: ResolvedShooterPhysicsMaterial = {
    restitution: 0,
    friction: 0.8,
    surfaceVelocityX: 2,
    surfaceVelocityY: 0,
    density: 1,
    contactBaumgarteBiasScale: 1,
    maxContactBaumgarteBiasVelocityScale: 1,
    contactPositionCorrectionScale: 1,
    contactPositionCorrectionSlopScale: 1,
  };
  const resolvedPrefabColliderBase: ResolvedShooterPrefabColliderBase = {
    type: "aabb",
    offsetX: 1,
    offsetY: -1,
    enabled: true,
    trigger: true,
    material: resolvedPhysicsMaterial,
  };
  const resolvedPrefabColliderVertex: ResolvedShooterPrefabColliderVertex = { x: -2, y: -1 };
  const resolvedPrefabCollider: ResolvedShooterPrefabCollider = {
    ...resolvedPrefabColliderBase,
    type: "aabb",
    halfWidth: 4,
    halfHeight: 3,
  };
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
  const rigidBodyStepOptions: PhysicsRigidBodyStepOptions = {
    gravityY: 980,
    velocityIterations: 6,
    contactSplitImpulse: true,
  };
  const rigidBodyStepStats: PhysicsRigidBodyStepStats = {
    substeps: 1,
    dynamicBodies: 1,
    angularBodies: 1,
    islandCount: 1,
    islandBodies: 2,
    activeIslands: 1,
    sleepingIslands: 0,
    largestIslandBodies: 2,
    contactChecks: 1,
    velocityImpulses: 2,
    contactBlockSolves: 0,
    baumgarteVelocityBiases: 1,
    splitVelocityImpulses: 0,
    restitutionVelocityThresholdSkips: 0,
    warmStartImpulses: 0,
    contactCacheEntries: 1,
    sleepingBodies: 0,
    bodiesPutToSleep: 0,
    bodiesWoken: 0,
    islandsWoken: 0,
    islandsPutToSleep: 0,
    ccdChecks: 0,
    ccdHits: 0,
    positionCorrections: 1,
    splitPositionCorrections: 0,
    constraintVelocityCorrections: 0,
    constraintPositionCorrections: 0,
    brokenJoints: 0,
  };
  const rigidBodyType: PhysicsRigidBodyType = "dynamic";
  const colliderType: PhysicsColliderType = "aabb";
  const edgeColliderType: PhysicsColliderType = "edge";
  const collisionLayer: PhysicsCollisionLayer = "player";
  const rigidBodyMaterial: PhysicsRigidBodyMaterial = {
    restitution: 0.1,
    friction: 0.6,
    surfaceVelocityX: 0,
    surfaceVelocityY: 0,
    density: 1.2,
  };
  const colliderMaterial: PhysicsRigidBodyMaterial = {
    friction: 0.8,
    surfaceVelocityX: 2,
  };
  const colliderMaterialSnapshot: PhysicsMaterialSnapshot = {
    restitution: 0.1,
    friction: 0.8,
    surfaceVelocityX: 2,
    surfaceVelocityY: 0,
    density: 1.2,
    contactBaumgarteBiasScale: 1,
    maxContactBaumgarteBiasVelocityScale: 1,
    contactPositionCorrectionScale: 1,
    contactPositionCorrectionSlopScale: 1,
  };
  const rigidBodyMassProperties: PhysicsRigidBodyMassProperties = {
    mass: 2,
    inertia: 8,
  };
  const rigidBodyTuning: PhysicsRigidBodyTuning = {
    gravityScale: 0.75,
    linearDamping: 0.1,
  };
  const rigidBodyCollider: PhysicsRigidBodyCollider = {
    type: colliderType,
    halfWidth: 8,
    halfHeight: 6,
    offsetX: 1,
  };
  const edgeRigidBodyCollider: PhysicsRigidBodyCollider = {
    type: "edge",
    startX: -16,
    startY: 0,
    endX: 16,
    endY: 0,
  };
  const rigidBodySpawnOptions: PhysicsRigidBodySpawnOptions = {
    x: 10,
    y: 20,
    bodyType: rigidBodyType,
    collider: rigidBodyCollider,
    layer: collisionLayer,
    velocityX: 4,
    material: rigidBodyMaterial,
    colliderMaterial,
  };
  const bodyColliderOptions: PhysicsBodyColliderOptions = {
    collider: {
      type: "circle",
      radius: 4,
      offsetY: 2,
    },
    layer: collisionLayer,
    isTrigger: true,
  };
  const bodyColliderSnapshot: PhysicsBodyColliderSnapshot = {
    colliderIndex: 1,
    colliderType: "circle",
    colliderEnabled: true,
    colliderIsTrigger: true,
    colliderOffsetX: 0,
    colliderOffsetY: 2,
    colliderMaterialOverride: true,
    colliderMaterial: colliderMaterialSnapshot,
    categoryBits: 1,
    maskBits: 0xffffffff,
  };
  const physicsEntityHandle: PhysicsEntityHandle = {
    entityId: 9,
    entityGeneration: 0,
  };
  const physicsEntitySnapshot: PhysicsEntitySnapshot = {
    ...physicsEntityHandle,
    x: 10,
    y: 20,
    velocityX: 4,
    velocityY: 0,
    rotationRadians: 0,
    angularVelocityRadiansPerSecond: 0,
    bodyType: rigidBodyType,
    bodyEnabled: true,
    isSleeping: false,
    colliderType,
    colliderEnabled: true,
    colliderIsTrigger: false,
    colliderOffsetX: 1,
    colliderOffsetY: 0,
    colliderMaterialOverride: true,
    colliderMaterial: colliderMaterialSnapshot,
    mass: 2,
    inverseMass: 0.5,
    inertia: 8,
    inverseInertia: 0.125,
    gravityScale: 0.75,
    linearDamping: 0.1,
    angularDamping: 0,
    restitution: 0.1,
    friction: 0.6,
    surfaceVelocityX: 0,
    surfaceVelocityY: 0,
    density: 1.2,
    contactBaumgarteBiasScale: 1,
    maxContactBaumgarteBiasVelocityScale: 1,
    contactPositionCorrectionScale: 1,
    contactPositionCorrectionSlopScale: 1,
  };
  const jointType: PhysicsJointType = "distance";
  const jointBaseOptions: PhysicsJointBaseOptions = {
    entityA: physicsEntityHandle,
    entityB: { entityId: 10, entityGeneration: 0 },
    stiffness: 1,
    damping: 0.25,
  };
  const jointSpawnOptions: PhysicsJointSpawnOptions = {
    ...jointBaseOptions,
    type: jointType,
    restLength: 12,
  };
  const weldJointSpawnOptions: PhysicsJointSpawnOptions = {
    ...jointBaseOptions,
    type: "weld",
    localAnchorAX: 0,
    localAnchorAY: 0,
    localAnchorBX: -8,
    localAnchorBY: 0,
    referenceAngle: 0,
    breakDistance: 16,
    breakAngle: 1,
  };
  const physicsJointHandle: PhysicsJointHandle = {
    jointType,
    jointIndex: 2,
    jointGeneration: 0,
  };
  const physicsJointSnapshot: PhysicsJointSnapshot = {
    ...physicsJointHandle,
    entityA: physicsEntityHandle,
    entityB: jointBaseOptions.entityB,
    enabled: true,
    restLength: 12,
    maxLength: 0,
    ratio: 0,
    referenceAngle: 0,
    breakDistance: Number.POSITIVE_INFINITY,
    breakAngle: 0,
    stiffness: 1,
    damping: 0.25,
    angularStiffness: 0,
    angularDamping: 0,
    localAnchorAX: 0,
    localAnchorAY: 0,
    localAnchorBX: 0,
    localAnchorBY: 0,
    localAxisAX: 0,
    localAxisAY: 0,
    limitEnabled: false,
    lowerAngle: 0,
    upperAngle: 0,
    lowerTranslation: 0,
    upperTranslation: 0,
    motorEnabled: false,
    motorSpeed: 0,
    maxMotorForce: 0,
    maxMotorTorque: 0,
  };
  const nearestBodyQuery: PhysicsNearestBodyQuery = { x: 0, y: 0, maxDistance: 64, queryMaskBits: 0xffffffff };
  const nearestBodyHit: PhysicsNearestBodyHit = {
    entityId: 1,
    entityGeneration: 0,
    pointX: 8,
    pointY: 0,
    distance: 8,
  };
  const nearestTileQuery: PhysicsNearestTileObstacleQuery = { x: 0, y: 0, maxDistance: 64 };
  const nearestTileHit: PhysicsNearestTileObstacleHit = {
    layerIndex: 0,
    tileIndex: 1,
    pointX: 16,
    pointY: 0,
    distance: 16,
  };
  const pointBodyQuery: PhysicsPointBodyQuery = { x: 10, y: 20, queryMaskBits: 0xffffffff };
  const bodyContactQuery: PhysicsBodyContactQuery = { categoryABits: 1, categoryBBits: 2 };
  const bodyManifoldQuery: PhysicsBodyManifoldQuery = bodyContactQuery;
  const aabbBodyQuery: PhysicsAabbBodyQuery = { x: 10, y: 20, halfWidth: 4, halfHeight: 5 };
  const circleBodyQuery: PhysicsCircleBodyQuery = { x: 10, y: 20, radius: 6 };
  const orientedBoxBodyQuery: PhysicsOrientedBoxBodyQuery = {
    x: 10,
    y: 20,
    halfWidth: 4,
    halfHeight: 5,
    rotationRadians: 0.25,
  };
  const capsuleBodyQuery: PhysicsCapsuleBodyQuery = {
    startX: 0,
    startY: 0,
    endX: 10,
    endY: 0,
    radius: 2,
  };
  const convexPolygonVertices: PhysicsConvexPolygonVertexBuffer = new Float32Array([
    0, 0, 10, 0, 10, 10, 0, 10,
  ]);
  const convexPolygonBodyQuery: PhysicsConvexPolygonBodyQuery = {
    vertices: convexPolygonVertices,
  };
  const bodyQueryHit: PhysicsBodyQueryHit = {
    entityId: 2,
    entityGeneration: 0,
  };
  const bodyContactHit: PhysicsBodyContactHit = {
    aEntityId: 1,
    aEntityGeneration: 0,
    bEntityId: 2,
    bEntityGeneration: 0,
    normalX: 1,
    normalY: 0,
    penetration: 2,
    pointX: 12,
    pointY: 0,
  };
  const bodyManifoldHit: PhysicsBodyManifoldHit = {
    aEntityId: 1,
    aEntityGeneration: 0,
    bEntityId: 2,
    bEntityGeneration: 0,
    pointCount: 2,
    normalX: 1,
    normalY: 0,
    penetration: 2,
    points: [
      { pointX: 12, pointY: -4, penetration: 2 },
      { pointX: 12, pointY: 4, penetration: 2 },
    ],
  };
  const rigidContactImpulseHit: PhysicsRigidContactImpulseHit = {
    aEntityId: 1,
    aEntityGeneration: 0,
    bEntityId: 2,
    bEntityGeneration: 0,
    pointX: 12,
    pointY: 0,
    normalX: 1,
    normalY: 0,
    normalImpulse: 3,
    tangentImpulse: -0.5,
  };
  const raycastBodyQuery: PhysicsRaycastBodyQuery = {
    originX: 0,
    originY: 0,
    directionX: 1,
    directionY: 0,
    maxDistance: 64,
  };
  const segmentCastBodyQuery: PhysicsSegmentCastBodyQuery = {
    startX: 0,
    startY: 0,
    endX: 64,
    endY: 0,
  };
  const raycastTileObstacleQuery: PhysicsRaycastTileObstacleQuery = {
    originX: 0,
    originY: 5,
    directionX: 1,
    directionY: 0,
    maxDistance: 64,
  };
  const segmentCastTileObstacleQuery: PhysicsSegmentCastTileObstacleQuery = {
    startX: 0,
    startY: 5,
    endX: 10,
    endY: 5,
  };
  const raycastBodyHit: PhysicsRaycastBodyHit = {
    entityId: 2,
    entityGeneration: 0,
    distance: 12,
    pointX: 12,
    pointY: 0,
    normalX: -1,
    normalY: 0,
  };
  const shapeCastBodyHit: PhysicsShapeCastBodyHit = raycastBodyHit;
  const tileShapeCastMotionQuery: PhysicsTileShapeCastMotionQuery = {
    directionX: 1,
    directionY: 0,
    maxDistance: 64,
  };
  const aabbTileShapeCastQuery: PhysicsAabbTileObstacleShapeCastQuery = {
    x: 0,
    y: 0,
    halfWidth: 2,
    halfHeight: 2,
    ...tileShapeCastMotionQuery,
  };
  const aabbTileContactQuery: PhysicsAabbTileObstacleContactQuery = {
    x: 9,
    y: 5,
    halfWidth: 2,
    halfHeight: 2,
  };
  const aabbTileManifoldQuery: PhysicsAabbTileObstacleManifoldQuery = {
    x: 9,
    y: 5,
    halfWidth: 2,
    halfHeight: 2,
  };
  const tileShapeCastHit: PhysicsTileShapeCastHit = {
    layerIndex: 2,
    tileIndex: 1,
    distance: 9,
    pointX: 9,
    pointY: 0,
    normalX: -1,
    normalY: 0,
  };
  const tileRaycastHit: PhysicsTileRaycastHit = tileShapeCastHit;
  const tileContactHit: PhysicsTileContactHit = {
    layerIndex: 2,
    tileIndex: 1,
    normalX: -1,
    normalY: 0,
    penetration: 1,
    pointX: 11,
    pointY: 5,
  };
  const tileManifoldHit: PhysicsTileManifoldHit = {
    layerIndex: 2,
    tileIndex: 1,
    pointCount: 2,
    normalX: -1,
    normalY: 0,
    penetration: 1,
    points: [
      { pointX: 11, pointY: 3, penetration: 1 },
      { pointX: 11, pointY: 7, penetration: 1 },
    ],
  };
  const aabbShapeCastQuery: PhysicsAabbBodyShapeCastQuery = {
    x: 0,
    y: 0,
    halfWidth: 2,
    halfHeight: 2,
    directionX: 1,
    directionY: 0,
    maxDistance: 64,
  };
  const circleShapeCastQuery: PhysicsCircleBodyShapeCastQuery = {
    x: 0,
    y: 0,
    radius: 2,
    directionX: 1,
    directionY: 0,
    maxDistance: 64,
  };
  const orientedBoxShapeCastQuery: PhysicsOrientedBoxBodyShapeCastQuery = {
    x: 0,
    y: 0,
    halfWidth: 2,
    halfHeight: 2,
    rotationRadians: 0,
    directionX: 1,
    directionY: 0,
    maxDistance: 64,
  };
  const capsuleShapeCastQuery: PhysicsCapsuleBodyShapeCastQuery = {
    startX: 0,
    startY: -2,
    endX: 0,
    endY: 2,
    radius: 1,
    directionX: 1,
    directionY: 0,
    maxDistance: 64,
  };
  const convexPolygonShapeCastQuery: PhysicsConvexPolygonBodyShapeCastQuery = {
    vertices: convexPolygonVertices,
    directionX: 1,
    directionY: 0,
    maxDistance: 64,
  };
  const particleTexture: ParticleTextureRef = "hit";
  const particleRange: ParticleRangeInput = [0.1, 0.2];
  const particleColor: ParticleColor = [1, 0.5, 0.25, 1];
  const particleUv: ParticleUvRect = { u0: 0, v0: 0, u1: 0.5, v1: 0.5 };
  const particlePreset: ParticlePresetConfig = {
    texture: particleTexture,
    uv: particleUv,
    burstCount: 6,
    lifetime: particleRange,
    speed: 120,
    startSize: [8, 12],
    endSize: 2,
    startColor: particleColor,
    endColor: [1, 0.5, 0.25, 0],
    accelerationY: 32,
    damping: 0.1,
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
  const physicsQueryHitBuffer: PhysicsQueryHitBufferView = {
    buffer: new Uint32Array([2, 0]),
    hitCount: 1,
    u32sPerHit: 2,
  };
  const publicDecodePhysicsQueryHits: PublicApi["decodePhysicsQueryHits"] = decodePhysicsQueryHits;
  const physicsQueryHit: PhysicsBodyQueryHit = publicDecodePhysicsQueryHits(physicsQueryHitBuffer)[0];
  const physicsBodyContactBufferBytes = 36;
  const physicsBodyContactHitBuffer: PhysicsBodyContactHitBufferView = {
    buffer: new DataView(new ArrayBuffer(physicsBodyContactBufferBytes)),
    hitCount: 1,
    bytesPerHit: physicsBodyContactBufferBytes,
  };
  physicsBodyContactHitBuffer.buffer.setUint32(0, bodyContactHit.aEntityId, true);
  physicsBodyContactHitBuffer.buffer.setUint32(4, bodyContactHit.aEntityGeneration, true);
  physicsBodyContactHitBuffer.buffer.setUint32(8, bodyContactHit.bEntityId, true);
  physicsBodyContactHitBuffer.buffer.setUint32(12, bodyContactHit.bEntityGeneration, true);
  physicsBodyContactHitBuffer.buffer.setFloat32(16, bodyContactHit.normalX, true);
  physicsBodyContactHitBuffer.buffer.setFloat32(20, bodyContactHit.normalY, true);
  physicsBodyContactHitBuffer.buffer.setFloat32(24, bodyContactHit.penetration, true);
  physicsBodyContactHitBuffer.buffer.setFloat32(28, bodyContactHit.pointX, true);
  physicsBodyContactHitBuffer.buffer.setFloat32(32, bodyContactHit.pointY, true);
  const publicDecodePhysicsBodyContactHits: PublicApi["decodePhysicsBodyContactHits"] =
    decodePhysicsBodyContactHits;
  const physicsBodyContactHit: PhysicsBodyContactHit =
    publicDecodePhysicsBodyContactHits(physicsBodyContactHitBuffer)[0];
  const physicsBodyManifoldBufferBytes = 56;
  const physicsBodyManifoldHitBuffer: PhysicsBodyManifoldHitBufferView = {
    buffer: new DataView(new ArrayBuffer(physicsBodyManifoldBufferBytes)),
    hitCount: 1,
    bytesPerHit: physicsBodyManifoldBufferBytes,
  };
  physicsBodyManifoldHitBuffer.buffer.setUint32(0, bodyManifoldHit.aEntityId, true);
  physicsBodyManifoldHitBuffer.buffer.setUint32(4, bodyManifoldHit.aEntityGeneration, true);
  physicsBodyManifoldHitBuffer.buffer.setUint32(8, bodyManifoldHit.bEntityId, true);
  physicsBodyManifoldHitBuffer.buffer.setUint32(12, bodyManifoldHit.bEntityGeneration, true);
  physicsBodyManifoldHitBuffer.buffer.setUint32(16, bodyManifoldHit.pointCount, true);
  physicsBodyManifoldHitBuffer.buffer.setFloat32(20, bodyManifoldHit.normalX, true);
  physicsBodyManifoldHitBuffer.buffer.setFloat32(24, bodyManifoldHit.normalY, true);
  physicsBodyManifoldHitBuffer.buffer.setFloat32(28, bodyManifoldHit.penetration, true);
  physicsBodyManifoldHitBuffer.buffer.setFloat32(32, bodyManifoldHit.points[0]?.pointX ?? 0, true);
  physicsBodyManifoldHitBuffer.buffer.setFloat32(36, bodyManifoldHit.points[0]?.pointY ?? 0, true);
  physicsBodyManifoldHitBuffer.buffer.setFloat32(
    40,
    bodyManifoldHit.points[0]?.penetration ?? 0,
    true,
  );
  physicsBodyManifoldHitBuffer.buffer.setFloat32(44, bodyManifoldHit.points[1]?.pointX ?? 0, true);
  physicsBodyManifoldHitBuffer.buffer.setFloat32(48, bodyManifoldHit.points[1]?.pointY ?? 0, true);
  physicsBodyManifoldHitBuffer.buffer.setFloat32(
    52,
    bodyManifoldHit.points[1]?.penetration ?? 0,
    true,
  );
  const publicDecodePhysicsBodyManifoldHits: PublicApi["decodePhysicsBodyManifoldHits"] =
    decodePhysicsBodyManifoldHits;
  const physicsBodyManifoldHit: PhysicsBodyManifoldHit =
    publicDecodePhysicsBodyManifoldHits(physicsBodyManifoldHitBuffer)[0];
  const physicsRigidContactImpulseBufferBytes = 40;
  const physicsRigidContactImpulseHitBuffer: PhysicsRigidContactImpulseHitBufferView = {
    buffer: new DataView(new ArrayBuffer(physicsRigidContactImpulseBufferBytes)),
    hitCount: 1,
    bytesPerHit: physicsRigidContactImpulseBufferBytes,
  };
  physicsRigidContactImpulseHitBuffer.buffer.setUint32(0, rigidContactImpulseHit.aEntityId, true);
  physicsRigidContactImpulseHitBuffer.buffer.setUint32(
    4,
    rigidContactImpulseHit.aEntityGeneration,
    true,
  );
  physicsRigidContactImpulseHitBuffer.buffer.setUint32(8, rigidContactImpulseHit.bEntityId, true);
  physicsRigidContactImpulseHitBuffer.buffer.setUint32(
    12,
    rigidContactImpulseHit.bEntityGeneration,
    true,
  );
  physicsRigidContactImpulseHitBuffer.buffer.setFloat32(16, rigidContactImpulseHit.pointX, true);
  physicsRigidContactImpulseHitBuffer.buffer.setFloat32(20, rigidContactImpulseHit.pointY, true);
  physicsRigidContactImpulseHitBuffer.buffer.setFloat32(24, rigidContactImpulseHit.normalX, true);
  physicsRigidContactImpulseHitBuffer.buffer.setFloat32(28, rigidContactImpulseHit.normalY, true);
  physicsRigidContactImpulseHitBuffer.buffer.setFloat32(
    32,
    rigidContactImpulseHit.normalImpulse,
    true,
  );
  physicsRigidContactImpulseHitBuffer.buffer.setFloat32(
    36,
    rigidContactImpulseHit.tangentImpulse,
    true,
  );
  const publicDecodePhysicsRigidContactImpulseHits: PublicApi["decodePhysicsRigidContactImpulseHits"] =
    decodePhysicsRigidContactImpulseHits;
  const physicsRigidContactImpulseHit: PhysicsRigidContactImpulseHit =
    publicDecodePhysicsRigidContactImpulseHits(physicsRigidContactImpulseHitBuffer)[0];
  const physicsRaycastBufferBytes = 28;
  const physicsRaycastHitBuffer: PhysicsRaycastHitBufferView = {
    buffer: new DataView(new ArrayBuffer(physicsRaycastBufferBytes)),
    hitCount: 1,
    bytesPerHit: physicsRaycastBufferBytes,
  };
  physicsRaycastHitBuffer.buffer.setUint32(0, raycastBodyHit.entityId, true);
  physicsRaycastHitBuffer.buffer.setUint32(4, raycastBodyHit.entityGeneration, true);
  physicsRaycastHitBuffer.buffer.setFloat32(8, raycastBodyHit.distance, true);
  physicsRaycastHitBuffer.buffer.setFloat32(12, raycastBodyHit.pointX, true);
  physicsRaycastHitBuffer.buffer.setFloat32(16, raycastBodyHit.pointY, true);
  physicsRaycastHitBuffer.buffer.setFloat32(20, raycastBodyHit.normalX, true);
  physicsRaycastHitBuffer.buffer.setFloat32(24, raycastBodyHit.normalY, true);
  const publicDecodePhysicsRaycastHits: PublicApi["decodePhysicsRaycastHits"] =
    decodePhysicsRaycastHits;
  const physicsRaycastHit: PhysicsRaycastBodyHit =
    publicDecodePhysicsRaycastHits(physicsRaycastHitBuffer)[0];
  const physicsShapeCastHitBuffer: PhysicsShapeCastHitBufferView = physicsRaycastHitBuffer;
  const publicDecodePhysicsShapeCastHits: PublicApi["decodePhysicsShapeCastHits"] =
    decodePhysicsShapeCastHits;
  const physicsShapeCastHit: PhysicsShapeCastBodyHit =
    publicDecodePhysicsShapeCastHits(physicsShapeCastHitBuffer)[0];
  const physicsTileShapeCastHitBuffer: PhysicsTileShapeCastHitBufferView = {
    buffer: new DataView(new ArrayBuffer(physicsRaycastBufferBytes)),
    hitCount: 1,
    bytesPerHit: physicsRaycastBufferBytes,
  };
  physicsTileShapeCastHitBuffer.buffer.setUint32(0, tileShapeCastHit.layerIndex, true);
  physicsTileShapeCastHitBuffer.buffer.setUint32(4, tileShapeCastHit.tileIndex, true);
  physicsTileShapeCastHitBuffer.buffer.setFloat32(8, tileShapeCastHit.distance, true);
  physicsTileShapeCastHitBuffer.buffer.setFloat32(12, tileShapeCastHit.pointX, true);
  physicsTileShapeCastHitBuffer.buffer.setFloat32(16, tileShapeCastHit.pointY, true);
  physicsTileShapeCastHitBuffer.buffer.setFloat32(20, tileShapeCastHit.normalX, true);
  physicsTileShapeCastHitBuffer.buffer.setFloat32(24, tileShapeCastHit.normalY, true);
  const publicDecodePhysicsTileShapeCastHits: PublicApi["decodePhysicsTileShapeCastHits"] =
    decodePhysicsTileShapeCastHits;
  const physicsTileShapeCastHit: PhysicsTileShapeCastHit =
    publicDecodePhysicsTileShapeCastHits(physicsTileShapeCastHitBuffer)[0];
  const physicsTileRaycastHitBuffer: PhysicsTileRaycastHitBufferView =
    physicsTileShapeCastHitBuffer;
  const publicDecodePhysicsTileRaycastHits: PublicApi["decodePhysicsTileRaycastHits"] =
    decodePhysicsTileRaycastHits;
  const physicsTileRaycastHit: PhysicsTileRaycastHit =
    publicDecodePhysicsTileRaycastHits(physicsTileRaycastHitBuffer)[0];
  const physicsTileContactHitBuffer: PhysicsTileContactHitBufferView = {
    buffer: new DataView(new ArrayBuffer(physicsRaycastBufferBytes)),
    hitCount: 1,
    bytesPerHit: physicsRaycastBufferBytes,
  };
  physicsTileContactHitBuffer.buffer.setUint32(0, tileContactHit.layerIndex, true);
  physicsTileContactHitBuffer.buffer.setUint32(4, tileContactHit.tileIndex, true);
  physicsTileContactHitBuffer.buffer.setFloat32(8, tileContactHit.normalX, true);
  physicsTileContactHitBuffer.buffer.setFloat32(12, tileContactHit.normalY, true);
  physicsTileContactHitBuffer.buffer.setFloat32(16, tileContactHit.penetration, true);
  physicsTileContactHitBuffer.buffer.setFloat32(20, tileContactHit.pointX, true);
  physicsTileContactHitBuffer.buffer.setFloat32(24, tileContactHit.pointY, true);
  const publicDecodePhysicsTileContactHits: PublicApi["decodePhysicsTileContactHits"] =
    decodePhysicsTileContactHits;
  const physicsTileContactHit: PhysicsTileContactHit =
    publicDecodePhysicsTileContactHits(physicsTileContactHitBuffer)[0];
  const physicsTileManifoldBufferBytes = 48;
  const physicsTileManifoldHitBuffer: PhysicsTileManifoldHitBufferView = {
    buffer: new DataView(new ArrayBuffer(physicsTileManifoldBufferBytes)),
    hitCount: 1,
    bytesPerHit: physicsTileManifoldBufferBytes,
  };
  physicsTileManifoldHitBuffer.buffer.setUint32(0, tileManifoldHit.layerIndex, true);
  physicsTileManifoldHitBuffer.buffer.setUint32(4, tileManifoldHit.tileIndex, true);
  physicsTileManifoldHitBuffer.buffer.setUint32(8, tileManifoldHit.pointCount, true);
  physicsTileManifoldHitBuffer.buffer.setFloat32(12, tileManifoldHit.normalX, true);
  physicsTileManifoldHitBuffer.buffer.setFloat32(16, tileManifoldHit.normalY, true);
  physicsTileManifoldHitBuffer.buffer.setFloat32(20, tileManifoldHit.penetration, true);
  physicsTileManifoldHitBuffer.buffer.setFloat32(24, tileManifoldHit.points[0]?.pointX ?? 0, true);
  physicsTileManifoldHitBuffer.buffer.setFloat32(28, tileManifoldHit.points[0]?.pointY ?? 0, true);
  physicsTileManifoldHitBuffer.buffer.setFloat32(
    32,
    tileManifoldHit.points[0]?.penetration ?? 0,
    true,
  );
  physicsTileManifoldHitBuffer.buffer.setFloat32(36, tileManifoldHit.points[1]?.pointX ?? 0, true);
  physicsTileManifoldHitBuffer.buffer.setFloat32(40, tileManifoldHit.points[1]?.pointY ?? 0, true);
  physicsTileManifoldHitBuffer.buffer.setFloat32(
    44,
    tileManifoldHit.points[1]?.penetration ?? 0,
    true,
  );
  const publicDecodePhysicsTileManifoldHits: PublicApi["decodePhysicsTileManifoldHits"] =
    decodePhysicsTileManifoldHits;
  const physicsTileManifoldHit: PhysicsTileManifoldHit =
    publicDecodePhysicsTileManifoldHits(physicsTileManifoldHitBuffer)[0];
  const uiOverlay: Pick<UiOverlay, "update" | "destroy"> = {
    update: () => undefined,
    destroy: () => undefined,
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
    physicsDebugLineCount: 0,
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
  const engine: Pick<
    FerrumEngine,
    "setGameSpec" | "useBreakoutGame" | "configureFixedTimestep" | "stepRigidBodies" |
      "spawnRigidBody" | "addPhysicsBodyCollider" | "getPhysicsBodyColliderCount" |
      "getPhysicsBodyCollider" | "getPhysicsEntity" | "despawnPhysicsEntity" |
      "setPhysicsBodyVelocity" | "setPhysicsBodyRotation" | "setPhysicsBodyAngularVelocity" |
      "setPhysicsBodyEnabled" | "setPhysicsColliderOffset" | "setPhysicsColliderEnabled" |
      "setPhysicsColliderMaterial" | "setPhysicsBodyColliderMaterial" | "clearPhysicsColliderMaterial" |
      "setPhysicsBodyMassProperties" |
      "setPhysicsBodyTuning" | "setPhysicsBodyMaterial" |
      "applyPhysicsBodyForce" | "applyPhysicsBodyImpulse" |
      "applyPhysicsBodyTorque" | "applyPhysicsBodyAngularImpulse" |
      "spawnPhysicsJoint" | "getPhysicsJoint" | "clearPhysicsJoint" | "setPhysicsJointEnabled" |
      "queryNearestBody" | "queryNearestTileObstacle" |
      "queryBodyContacts" | "queryBodyManifolds" |
      "queryRigidContactImpulses" |
      "queryPointBodies" | "queryAabbBodies" | "queryCircleBodies" | "queryOrientedBoxBodies" |
      "queryCapsuleBodies" | "queryConvexPolygonBodies" | "raycastBodies" | "segmentCastBodies" |
      "raycastTileObstacles" | "segmentCastTileObstacles" |
      "shapeCastAabbBodies" | "shapeCastCircleBodies" | "shapeCastOrientedBoxBodies" |
      "shapeCastCapsuleBodies" | "shapeCastConvexPolygonBodies" | "shapeCastAabbTileObstacles" |
      "queryAabbTileObstacleContacts" | "queryAabbTileObstacleManifolds" |
      "setShooterTilemapTile" | "setShooterTilemapTilesRect" |
      "setParticlePreset" | "clearParticlePresets" | "setShooterHitParticlePreset" |
      "clearShooterHitParticlePreset" | "setParticleSeed" | "spawnParticleBurst" | "clearParticles" |
      "particleCount" | "particleCapacity"
  > = {
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
      bulletAtlasAnimation: resolvedAtlasAnimation,
      playerCollider: { type: "aabb", halfWidth: 18, halfHeight: 18, offsetX: 0, offsetY: 0, enabled: true, trigger: true },
      enemyCollider: { type: "aabb", halfWidth: 12, halfHeight: 12, offsetX: 0, offsetY: 0, enabled: true, trigger: true },
      bulletCollider: resolvedPrefabCollider,
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
      physics: resolvePhysicsSpec(gameSpec.physics),
    }),
    useBreakoutGame: () => undefined,
    configureFixedTimestep: () => undefined,
    stepRigidBodies: () => rigidBodyStepStats,
    spawnRigidBody: () => physicsEntityHandle,
    addPhysicsBodyCollider: () => true,
    getPhysicsBodyColliderCount: () => 2,
    getPhysicsBodyCollider: () => bodyColliderSnapshot,
    getPhysicsEntity: () => physicsEntitySnapshot,
    despawnPhysicsEntity: () => true,
    setPhysicsBodyVelocity: () => true,
    setPhysicsBodyRotation: () => true,
    setPhysicsBodyAngularVelocity: () => true,
    setPhysicsBodyEnabled: () => true,
    setPhysicsColliderOffset: () => true,
    setPhysicsColliderEnabled: () => true,
    setPhysicsColliderMaterial: () => true,
    setPhysicsBodyColliderMaterial: () => true,
    clearPhysicsColliderMaterial: () => true,
    setPhysicsBodyMassProperties: () => true,
    setPhysicsBodyTuning: () => true,
    setPhysicsBodyMaterial: () => true,
    applyPhysicsBodyForce: () => true,
    applyPhysicsBodyImpulse: () => true,
    applyPhysicsBodyTorque: () => true,
    applyPhysicsBodyAngularImpulse: () => true,
    spawnPhysicsJoint: () => physicsJointHandle,
    getPhysicsJoint: () => physicsJointSnapshot,
    clearPhysicsJoint: () => true,
    setPhysicsJointEnabled: () => true,
    queryNearestBody: () => nearestBodyHit,
    queryNearestTileObstacle: () => nearestTileHit,
    queryBodyContacts: () => [bodyContactHit],
    queryBodyManifolds: () => [bodyManifoldHit],
    queryRigidContactImpulses: () => [rigidContactImpulseHit],
    queryPointBodies: () => [bodyQueryHit],
    queryAabbBodies: () => [bodyQueryHit],
    queryCircleBodies: () => [bodyQueryHit],
    queryOrientedBoxBodies: () => [bodyQueryHit],
    queryCapsuleBodies: () => [bodyQueryHit],
    queryConvexPolygonBodies: () => [bodyQueryHit],
    raycastBodies: () => [raycastBodyHit],
    segmentCastBodies: () => [raycastBodyHit],
    raycastTileObstacles: () => [tileRaycastHit],
    segmentCastTileObstacles: () => [tileRaycastHit],
    shapeCastAabbBodies: () => [shapeCastBodyHit],
    shapeCastCircleBodies: () => [shapeCastBodyHit],
    shapeCastOrientedBoxBodies: () => [shapeCastBodyHit],
    shapeCastCapsuleBodies: () => [shapeCastBodyHit],
    shapeCastConvexPolygonBodies: () => [shapeCastBodyHit],
    shapeCastAabbTileObstacles: () => [tileShapeCastHit],
    queryAabbTileObstacleContacts: () => [tileContactHit],
    queryAabbTileObstacleManifolds: () => [tileManifoldHit],
    setShooterTilemapTile: () => true,
    setShooterTilemapTilesRect: () => true,
    setParticlePreset: () => undefined,
    clearParticlePresets: () => undefined,
    setShooterHitParticlePreset: () => undefined,
    clearShooterHitParticlePreset: () => undefined,
    setParticleSeed: () => undefined,
    spawnParticleBurst: () => 1,
    clearParticles: () => undefined,
    particleCount: () => 1,
    particleCapacity: () => 512,
  };

  equal(manifest.textures?.player, "/assets/player.png");
  equal(asepriteImportResult.frameNames[0], "player");
  equal(publicImportAsepriteAtlasFrames({
    frames: {
      "enemy.png": { frame: { x: 0, y: 0, w: 8, h: 8 } },
    },
    meta: { size: { w: 16, h: 16 } },
  }, asepriteImportOptions).enemy.texture, "sprites");
  equal(tiledImportResult.usedGids[0], 1);
  equal(publicImportTiledGameSpec({
    orientation: "orthogonal",
    width: 1,
    height: 1,
    tilewidth: 8,
    tileheight: 8,
    tilesets: [{
      firstgid: 1,
      name: "terrain",
      imagewidth: 8,
      imageheight: 8,
      tilewidth: 8,
      tileheight: 8,
      columns: 1,
      tilecount: 1,
    }],
    layers: [{ type: "tilelayer", width: 1, height: 1, data: [1] }],
  }, tiledImportOptions).tilemap?.layers?.[0]?.data?.[0], 1);
  equal(ldtkImportResult.usedTileIds[0], 1);
  equal(publicImportLDtkGameSpec({
    defs: {
      tilesets: [{
        uid: 1,
        identifier: "terrain",
        pxWid: 8,
        pxHei: 8,
        tileGridSize: 8,
      }],
    },
    levels: [{
      identifier: "Level_0",
      pxWid: 8,
      pxHei: 8,
      layerInstances: [{
        __identifier: "ground",
        __type: "Tiles",
        __cWid: 1,
        __cHei: 1,
        __gridSize: 8,
        __tilesetDefUid: 1,
        gridTiles: [{ px: [0, 0], src: [0, 0], t: 0, f: 0 }],
      }],
    }],
  }, ldtkImportOptions).tilemap?.layers?.[0]?.data?.[0], 1);
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
  equal(runtimeOptions.uiState?.({} as FerrumRuntimeFrame).panels?.[0]?.id, "hud");
  equal(physicsDebugLineCamera.x, 0);
  equal(physicsDebugOptions.colliders, true);
  equal(gameSpec.world?.width, 1600);
  equal(cameraSpec.preset, "look-ahead");
  equal(atlasFrameSpec.texture, "bullet");
  equal(atlasAnimationSpec.idle?.frames?.[0], "bullet");
  equal(resolvedAtlasAnimation.idle.fps, 1);
  equal(prefabColliderType, "aabb");
  equal(prefabColliderSpec.offset?.x, 1);
  equal(physicsMaterialSpec.friction, 0.8);
  equal(resolvedPrefabCollider.material?.surfaceVelocityX, 2);
  equal(resolvedPrefabColliderVertex.x, -2);
  equal(tileSlopeSpec.y0, 1);
  equal(resolvedTileSlope.x1, 1);
  equal(enemyPresetSpec.health, 4);
  equal(enemyOrbitSpec.radius, 180);
  equal(orbitEnemyPresetSpec.behavior, "orbit");
  equal(waveSpec.enemyCount, 6);
  equal(tileSpec.frame, "bullet");
  equal(tileLayerSpec.columns, 1);
  equal(tileLayerSpec.collision, true);
  equal(tileLayerSpec.collisionOnly, false);
  equal(resolvedTilemap.layers.length, 0);
  equal(audioBusConfig.sfxVolume, 0.7);
  equal(audioManagerConfig.bgmVolume, 0.2);
  equal(diagnosticReport.context?.kind, "texture");
  equal(atlasPlacement.name, "compat");
  equal(atlasLayoutFn([atlasSprite]).sprites[0].name, "compat");
  equal(typeof webGpuCreate, "function");
  equal(typeof runtimeCreate, "function");
  equal(physicsStats.collisionPairs, 1);
  equal(physicsStats.collisionSolidPairs, 1);
  equal(physicsStats.collisionTriggerPairs, 0);
  equal(physicsStats.collisionEventCount, 1);
  equal(edgeColliderType, "edge");
  equal(edgeRigidBodyCollider.type, "edge");
  equal(engine.stepRigidBodies(1 / 60, rigidBodyStepOptions).dynamicBodies, 1);
  equal(engine.spawnRigidBody(rigidBodySpawnOptions).entityId, 9);
  equal(engine.addPhysicsBodyCollider(physicsEntityHandle, bodyColliderOptions), true);
  equal(engine.getPhysicsBodyColliderCount(physicsEntityHandle), 2);
  equal(engine.getPhysicsBodyCollider(physicsEntityHandle, 1)?.colliderMaterial.friction, 0.8);
  equal(engine.getPhysicsEntity(physicsEntityHandle)?.bodyType, "dynamic");
  equal(engine.setPhysicsBodyVelocity(physicsEntityHandle, 1, 2), true);
  equal(engine.setPhysicsBodyRotation(physicsEntityHandle, 0.25), true);
  equal(engine.setPhysicsBodyAngularVelocity(physicsEntityHandle, 3), true);
  equal(engine.setPhysicsColliderOffset(physicsEntityHandle, 1, 0), true);
  equal(engine.setPhysicsColliderEnabled(physicsEntityHandle, true), true);
  equal(engine.setPhysicsColliderMaterial(physicsEntityHandle, colliderMaterial), true);
  equal(engine.setPhysicsBodyColliderMaterial(physicsEntityHandle, 1, colliderMaterial), true);
  equal(engine.clearPhysicsColliderMaterial(physicsEntityHandle), true);
  equal(engine.setPhysicsBodyMassProperties(physicsEntityHandle, rigidBodyMassProperties), true);
  equal(engine.setPhysicsBodyTuning(physicsEntityHandle, rigidBodyTuning), true);
  equal(engine.setPhysicsBodyMaterial(physicsEntityHandle, rigidBodyMaterial), true);
  equal(engine.applyPhysicsBodyForce(physicsEntityHandle, 4, 0), true);
  equal(engine.applyPhysicsBodyImpulse(physicsEntityHandle, 4, 0), true);
  equal(engine.applyPhysicsBodyTorque(physicsEntityHandle, 5), true);
  equal(engine.applyPhysicsBodyAngularImpulse(physicsEntityHandle, 6), true);
  equal(engine.setPhysicsBodyEnabled(physicsEntityHandle, false), true);
  equal(engine.despawnPhysicsEntity(physicsEntityHandle), true);
  equal(engine.spawnPhysicsJoint(jointSpawnOptions).jointType, "distance");
  equal(weldJointSpawnOptions.type, "weld");
  equal(engine.getPhysicsJoint(physicsJointHandle)?.restLength, 12);
  equal(engine.setPhysicsJointEnabled(physicsJointHandle, false), true);
  equal(engine.clearPhysicsJoint(physicsJointHandle), true);
  equal(engine.queryNearestBody(nearestBodyQuery)?.distance, 8);
  equal(engine.queryNearestTileObstacle(nearestTileQuery)?.tileIndex, 1);
  equal(engine.queryBodyContacts(bodyContactQuery)[0]?.penetration, 2);
  equal(engine.queryBodyManifolds(bodyManifoldQuery)[0]?.points.length, 2);
  equal(engine.queryRigidContactImpulses()[0]?.normalImpulse, 3);
  equal(engine.queryPointBodies(pointBodyQuery)[0]?.entityId, 2);
  equal(engine.queryAabbBodies(aabbBodyQuery)[0]?.entityGeneration, 0);
  equal(engine.queryCircleBodies(circleBodyQuery)[0]?.entityId, 2);
  equal(engine.queryOrientedBoxBodies(orientedBoxBodyQuery)[0]?.entityId, 2);
  equal(engine.queryCapsuleBodies(capsuleBodyQuery)[0]?.entityId, 2);
  equal(engine.queryConvexPolygonBodies(convexPolygonBodyQuery)[0]?.entityId, 2);
  equal(engine.raycastBodies(raycastBodyQuery)[0]?.normalX, -1);
  equal(engine.segmentCastBodies(segmentCastBodyQuery)[0]?.distance, 12);
  equal(engine.raycastTileObstacles(raycastTileObstacleQuery)[0]?.tileIndex, 1);
  equal(engine.segmentCastTileObstacles(segmentCastTileObstacleQuery)[0]?.distance, 9);
  equal(engine.shapeCastAabbBodies(aabbShapeCastQuery)[0]?.pointX, 12);
  equal(engine.shapeCastCircleBodies(circleShapeCastQuery)[0]?.normalX, -1);
  equal(engine.shapeCastOrientedBoxBodies(orientedBoxShapeCastQuery)[0]?.distance, 12);
  equal(engine.shapeCastCapsuleBodies(capsuleShapeCastQuery)[0]?.entityId, 2);
  equal(engine.shapeCastConvexPolygonBodies(convexPolygonShapeCastQuery)[0]?.normalY, 0);
  equal(engine.shapeCastAabbTileObstacles(aabbTileShapeCastQuery)[0]?.tileIndex, 1);
  equal(engine.queryAabbTileObstacleContacts(aabbTileContactQuery)[0]?.penetration, 1);
  equal(engine.queryAabbTileObstacleManifolds(aabbTileManifoldQuery)[0]?.points[1]?.pointY, 7);
  equal(convexPolygonVertices.length, 8);
  equal(engine.setShooterTilemapTile(0, 1, 2, 3), true);
  equal(engine.setShooterTilemapTilesRect(0, 1, 2, 3, 4, 5), true);
  equal(particlePreset.uv?.u1, 0.5);
  engine.setParticleSeed(123);
  engine.setParticlePreset(0, particlePreset);
  engine.setShooterHitParticlePreset(0);
  equal(engine.spawnParticleBurst(0, 10, 20), 1);
  equal(engine.particleCount(), 1);
  equal(engine.particleCapacity(), 512);
  engine.clearParticles();
  engine.clearShooterHitParticlePreset();
  engine.clearParticlePresets();
  equal(collisionEvent.kind, "hit");
  equal(collisionEvent.damage, 2);
  equal(physicsRigidContactImpulseHit.tangentImpulse, -0.5);
  equal(physicsDebugLine.x1, 16);
  equal(physicsQueryHit.entityId, 2);
  equal(physicsBodyContactHit.pointX, 12);
  equal(physicsBodyManifoldHit.points[1]?.pointY, 4);
  equal(physicsRaycastHit.normalX, -1);
  equal(physicsShapeCastHit.distance, 12);
  equal(physicsTileShapeCastHit.layerIndex, 2);
  equal(physicsTileRaycastHit.normalX, -1);
  equal(physicsTileContactHit.pointX, 11);
  equal(physicsTileManifoldHit.points[1]?.pointY, 7);
  uiOverlay.update(uiState);
  uiOverlay.destroy();
  equal(inputManagerOptions.pointerGestures, true);
  equal(inputProvider().mouseX, 0);
  equal(viewportProvider().height, 480);
  equal(renderer.stats().drawCalls, 0);
  equal(assetHost.textureId("player"), 1);
  equal(browserPlatformHost.textureId("player"), 1);
  equal(typeof audioAssetLoader.load, "function");
  equal(physicsMode, "rigid");
  equal(physicsLayerSpec.mask?.[0], "world");
  equal(physicsDebugSpec.colliders, true);
  equal(engine.setGameSpec(gameSpec).enemyBehavior, "chase");
  engine.useBreakoutGame();
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
      floatsPerCommand: 13,
    },
  });
});

function f32Bits(value: number): number {
  const damage = new Float32Array([value]);
  return new Uint32Array(damage.buffer)[0];
}
