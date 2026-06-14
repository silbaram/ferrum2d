import {
  BUILT_IN_SHOOTER_STATE_FLOATS_PER_ENTITY,
  BUILT_IN_SHOOTER_STATE_HEADER_U32S,
  BUILT_IN_SHOOTER_STATE_U32S_PER_ENTITY,
  BUILT_IN_SHOOTER_STATE_VERSION,
  createShooterContentRuntimeOptions,
  createPhysicsBodyStateBufferSnapshot,
  equal,
  physicsMaterial,
  resolveShooterContentRuntimeSelection,
  resolvePhysicsSpec,
  resolvePostProcessPasses,
  test,
} from "./publicApiTypes.shared.js";

import type {
  AudioBus,
  AudioBusConfig,
  AudioManagerConfig,
  AudioManagerState,
  BloomPostProcessPassInput,
  BuiltInShooterStateSnapshot,
  CrtPostProcessPassInput,
  DiagnosticCode,
  DiagnosticContext,
  DiagnosticReport,
  FadePostProcessPassInput,
  FerrumEngine,
  GlitchPostProcessPassInput,
  PhysicsBodyColliderSnapshot,
  PhysicsBodyContactHit,
  PhysicsBodyManifoldHit,
  PhysicsBodyQueryHit,
  PhysicsBodyStateBufferSnapshot,
  PhysicsColliderType,
  PhysicsDebugLineCamera,
  PhysicsDebugOptions,
  PhysicsDebugSpec,
  PhysicsEntityHandle,
  PhysicsEntitySnapshot,
  PhysicsJointBaseOptions,
  PhysicsJointHandle,
  PhysicsJointSnapshot,
  PhysicsJointType,
  PhysicsLayerSpec,
  PhysicsMaterialPresetName,
  PhysicsMaterialSnapshot,
  PhysicsMode,
  PhysicsNearestBodyHit,
  PhysicsNearestTileObstacleHit,
  PhysicsRaycastBodyHit,
  PhysicsRigidBodyMaterial,
  PhysicsRigidBodyStepStats,
  PhysicsRigidBodyType,
  PhysicsRigidContactImpulseHit,
  PhysicsShapeCastBodyHit,
  PhysicsSpec,
  PhysicsTileContactHit,
  PhysicsTileManifoldHit,
  PhysicsTileRaycastHit,
  PhysicsTileShapeCastHit,
  PlayBgmOptions,
  PostProcessColor,
  PostProcessPassInput,
  PostProcessPassKind,
  PostProcessStackInput,
  PostProcessingConfigInput,
  PublicApi,
  ResolvePostProcessOptions,
  ResolvedPostProcessPass,
  ResolvedShooterAtlasAnimation,
  ResolvedShooterAtlasAnimationState,
  ResolvedShooterContentSpec,
  ResolvedShooterPhysicsMaterial,
  ResolvedShooterPrefabCollider,
  ResolvedShooterPrefabColliderBase,
  ResolvedShooterPrefabColliderVertex,
  ResolvedShooterTileDefinition,
  ResolvedShooterTileRampDefinition,
  ResolvedShooterTileSlopeDefinition,
  ResolvedShooterTilemap,
  ShooterRuntimeAtlasFrame,
  ShooterRuntimePrefab,
  ShooterAtlasAnimationSpec,
  ShooterAtlasAnimationStateSpec,
  ShooterAtlasFrameSpec,
  ShooterAtlasSpec,
  ShooterCameraPreset,
  ShooterCameraSpec,
  ShooterContentSpec,
  ShooterContentRuntimeOptions,
  ShooterContentRuntimeOptionSet,
  ShooterContentRuntimeSelection,
  ShooterDialogueContentSpec,
  ShooterEnemyOrbitSpec,
  ShooterEnemyPresetSpec,
  ShooterGameSpec,
  ShooterPhysicsMaterialSpec,
  ShooterProjectileArcSpec,
  ShooterPrefabColliderSpec,
  ShooterPrefabColliderType,
  ShooterTileBridgePortalSpec,
  ShooterTileKind,
  ShooterTileLayerSpec,
  ShooterTileRampAxis,
  ShooterTileRampSpec,
  ShooterTileSlopeSpec,
  ShooterTileSpec,
  ResolvedShooterProjectileArcSpec,
  ResolvedShooterTileBridgePortalDefinition,
  ShooterTilemapSpec,
  ShooterWaveSpec,
  SpatialAudioOptions,
  StopBgmOptions,
  TilemapNavigationPath,
  TilemapNavigationPathPoint,
  TilemapNavigationWaypoint,
  VignettePostProcessPassInput,
} from "./publicApiTypes.shared.js";

test("public API shooter spec, audio, diagnostics, and shooter asset types", () => {
  const publicPhysicsMaterial: PublicApi["physicsMaterial"] = physicsMaterial;
  const materialPreset: PhysicsMaterialPresetName = "wood";
  const material = publicPhysicsMaterial(materialPreset);
  const postProcessKind: PostProcessPassKind = "fade";
  const postProcessColor: PostProcessColor = [0, 0, 0, 0.25];
  const fadePassInput: FadePostProcessPassInput = { kind: postProcessKind, color: postProcessColor };
  const bloomPassInput: BloomPostProcessPassInput = { kind: "bloom", threshold: 0.8, intensity: 0.4 };
  const crtPassInput: CrtPostProcessPassInput = { kind: "crt", scanlineIntensity: 0.2 };
  const vignettePassInput: VignettePostProcessPassInput = { kind: "vignette", intensity: 0.25 };
  const glitchPassInput: GlitchPostProcessPassInput = { kind: "glitch", intensity: 0.02 };
  const postProcessConfigInput: PostProcessingConfigInput = { bloom: { intensity: 0.3 }, vignette: { intensity: 0.2 } };
  const postProcessPassInput: PostProcessPassInput = fadePassInput;
  const postProcessStackInput: PostProcessStackInput = [
    postProcessPassInput,
    bloomPassInput,
    crtPassInput,
    vignettePassInput,
    glitchPassInput,
  ];
  const postProcessOptions: ResolvePostProcessOptions = { path: "screen" };
  const publicResolvePostProcessPasses: PublicApi["resolvePostProcessPasses"] = resolvePostProcessPasses;
  const resolvedPostProcessPasses: readonly ResolvedPostProcessPass[] =
    publicResolvePostProcessPasses(postProcessStackInput, postProcessOptions);
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
  const physicsDebugLineCamera: PhysicsDebugLineCamera = { x: 0, y: 0 };
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
    postProcessing: postProcessConfigInput,
    enemies: {
      orbit: { radius: 180, radialBand: 24 },
      presets: { bruiser: { health: 4, scoreReward: 8 } },
      waves: [{ enemy: "bruiser", duration: 12, spawnInterval: 1, enemyCount: 6 }],
    },
    audio: { masterVolume: 0.9, sfxVolume: 0.7, events: { shoot: { volume: 0.3, pitch: 1.1 } } },
    content: {
      localization: {
        defaultLocale: "en",
        locales: {
          en: { strings: { "intro.ready": "Ready" } },
        },
      },
      dialogue: {
        graphs: {
          intro: {
            initialNode: "start",
            nodes: { start: { text: "intro.ready", end: true } },
          },
        },
      },
      cutscenes: {
        intro: {
          id: "intro",
          commands: [{ kind: "dialogue", text: "intro.ready", durationSeconds: 1 }],
        },
      },
    },
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
  const shooterRuntimePrefab: ShooterRuntimePrefab = "bullet";
  const shooterRuntimeAtlasFrame: ShooterRuntimeAtlasFrame = { texture: 23, width: 18, height: 18 };
  const cameraPreset: ShooterCameraPreset = "look-ahead";
  const cameraSpec: ShooterCameraSpec = { preset: cameraPreset };
  const contentSpec: ShooterContentSpec = gameSpec.content ?? {};
  const dialogueContentSpec: ShooterDialogueContentSpec = contentSpec.dialogue ?? {};
  const contentRuntimeOptionsInput: ShooterContentRuntimeOptions = {
    dialogueGraphId: false,
    cutsceneId: false,
    locale: "en",
  };
  const atlasSpec: ShooterAtlasSpec = gameSpec.atlas ?? {};
  const atlasFrameSpec: ShooterAtlasFrameSpec = atlasSpec.frames?.bullet ?? {};
  const atlasAnimationStateSpec: ShooterAtlasAnimationStateSpec = { frames: ["bullet"], fps: 1 };
  const atlasAnimationSpec: ShooterAtlasAnimationSpec = { idle: atlasAnimationStateSpec };
  const prefabColliderSpec: ShooterPrefabColliderSpec = gameSpec.prefabs?.bullet?.collider ?? {};
  const prefabColliderType: ShooterPrefabColliderType = prefabColliderSpec.type ?? "aabb";
  const physicsMaterialSpec: ShooterPhysicsMaterialSpec = prefabColliderSpec.material ?? {};
  const projectileArcSpec: ShooterProjectileArcSpec = gameSpec.weapons?.projectileArc ?? {};
  const enemyPresetSpec: ShooterEnemyPresetSpec = gameSpec.enemies?.presets?.bruiser ?? {};
  const enemyOrbitSpec: ShooterEnemyOrbitSpec = gameSpec.enemies?.orbit ?? {};
  const orbitEnemyPresetSpec: ShooterEnemyPresetSpec = { behavior: "orbit", speed: 84 };
  const waveSpec: ShooterWaveSpec = gameSpec.enemies?.waves?.[0] ?? {};
  const tilemapSpec: ShooterTilemapSpec = gameSpec.tilemap ?? {};
  const tileSpec: ShooterTileSpec = tilemapSpec.tiles?.["1"] ?? {};
  const tileKind: ShooterTileKind = tileSpec.kind ?? "flat";
  const tileRampAxis: ShooterTileRampAxis = tileSpec.ramp?.axis ?? "x";
  const tileRampSpec: ShooterTileRampSpec = tileSpec.ramp ?? { axis: tileRampAxis };
  const tileBridgePortalSpec: ShooterTileBridgePortalSpec = tileSpec.bridgePortal ?? {
    lowerFloor: "default",
    upperFloor: "bridge",
  };
  const tileSlopeSpec: ShooterTileSlopeSpec = tileSpec.slope ?? { x0: 0, y0: 1, x1: 1, y1: 0 };
  const tileFloorSpec = tileSpec.floor ?? "default";
  const tileLayerSpec: ShooterTileLayerSpec = tilemapSpec.layers?.[0] ?? {};
  const audioBusConfig: AudioBusConfig = { masterVolume: 0.9, sfxVolume: 0.7 };
  const audioBus: AudioBus = "bgm";
  const audioManagerConfig: AudioManagerConfig = { masterVolume: 0.9, bgmVolume: 0.2, uiVolume: 0.4 };
  const playBgmOptions: PlayBgmOptions = { volume: 0.8, loop: true, fadeInSeconds: 0.5, fadeMs: 500 };
  const stopBgmOptions: StopBgmOptions = { fadeOutSeconds: 0.25, fadeMs: 250 };
  const spatialAudioOptions: SpatialAudioOptions = { x: 1, y: 2, z: 0 };
  const audioManagerState: AudioManagerState = {
    masterVolume: 0.9,
    bgmVolume: 0.2,
    sfxVolume: 0.7,
    uiVolume: 0.4,
    bgmPlaying: false,
    bgmLoop: false,
  };
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
    floor: "default",
    elevation: 0,
    height: 0,
    kind: tileKind,
    blocksMovement: true,
    blocksProjectile: true,
    blocksVision: true,
    occluderHeight: 0,
    slope: { x0: 0, y0: 1, x1: 1, y1: 0 },
  };
  const resolvedTileRamp: ResolvedShooterTileRampDefinition = {
    axis: tileRampSpec.axis ?? "x",
    startElevation: tileRampSpec.startElevation ?? 0,
    endElevation: tileRampSpec.endElevation ?? 8,
  };
  const resolvedTileBridgePortal: ResolvedShooterTileBridgePortalDefinition = {
    lowerFloor: tileBridgePortalSpec.lowerFloor ?? "default",
    upperFloor: tileBridgePortalSpec.upperFloor ?? "bridge",
    lowerElevation: tileBridgePortalSpec.lowerElevation ?? 0,
    upperElevation: tileBridgePortalSpec.upperElevation ?? 8,
    navigationCost: tileBridgePortalSpec.navigationCost ?? 1,
  };
  const resolvedProjectileArc: ResolvedShooterProjectileArcSpec = {
    enabled: projectileArcSpec.enabled ?? false,
    launchHeight: projectileArcSpec.launchHeight ?? 0,
    zVelocity: projectileArcSpec.zVelocity ?? 0,
    gravity: projectileArcSpec.gravity ?? 0,
    hitHeight: projectileArcSpec.hitHeight ?? 0,
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
  const resolvedContentSpec: ResolvedShooterContentSpec = {
    dialogueGraphs: {},
    cutscenes: {},
  };
  const contentRuntimeSelection: ShooterContentRuntimeSelection =
    resolveShooterContentRuntimeSelection(resolvedContentSpec, contentRuntimeOptionsInput);
  const contentRuntimeOptionSet: ShooterContentRuntimeOptionSet =
    createShooterContentRuntimeOptions(resolvedContentSpec, contentRuntimeOptionsInput);
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
    positionContactRebuilds: 1,
    positionCorrections: 1,
    splitPositionCorrections: 0,
    constraintVelocityCorrections: 0,
    constraintPositionCorrections: 0,
    brokenJoints: 0,
  };
  const rigidBodyType: PhysicsRigidBodyType = "dynamic";
  const colliderType: PhysicsColliderType = "aabb";
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
  const publicCreatePhysicsBodyStateBufferSnapshot: PublicApi["createPhysicsBodyStateBufferSnapshot"] =
    createPhysicsBodyStateBufferSnapshot;
  const physicsBodyStateBuffer: PhysicsBodyStateBufferSnapshot =
    publicCreatePhysicsBodyStateBufferSnapshot([physicsEntitySnapshot]);
  const jointType: PhysicsJointType = "distance";
  const jointBaseOptions: PhysicsJointBaseOptions = {
    entityA: physicsEntityHandle,
    entityB: { entityId: 10, entityGeneration: 0 },
    stiffness: 1,
    damping: 0.25,
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
    groundAnchorAX: 0,
    groundAnchorAY: 0,
    groundAnchorBX: 0,
    groundAnchorBY: 0,
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
  const nearestBodyHit: PhysicsNearestBodyHit = {
    entityId: 1,
    entityGeneration: 0,
    pointX: 8,
    pointY: 0,
    distance: 8,
  };
  const nearestTileHit: PhysicsNearestTileObstacleHit = {
    layerIndex: 0,
    tileIndex: 1,
    pointX: 16,
    pointY: 0,
    distance: 16,
  };
  const navigationWaypoint: TilemapNavigationWaypoint = { x: 16, y: 0, distance: 16 };
  const navigationPathPoint: TilemapNavigationPathPoint = { x: 16, y: 0 };
  const navigationPath: TilemapNavigationPath = {
    pointBuffer: new Float32Array([16, 0, 32, 0]),
    pointCount: 2,
    points: [navigationPathPoint, { x: 32, y: 0 }],
    distance: 32,
    debugLineBuffer: {
      buffer: new Float32Array([0, 0, 16, 0, 0.1, 0.75, 1, 1]),
      lineCount: 1,
      floatsPerLine: 8,
    },
    debugLines: [{ x0: 0, y0: 0, x1: 16, y1: 0, color: [0.1, 0.75, 1, 1] }],
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
  const engine: Pick<
    FerrumEngine,
    "setGameSpec" | "setShooterAtlasFrame" | "builtInShooterPlayerHandle" | "captureShooterStateSnapshot" | "restoreShooterStateSnapshot" |
      "useDataScene" | "useBreakoutGame" | "configurePhysicsRuntime" | "configureFixedTimestep" |
      "configureAutoRigidBodyStep" | "stepRigidBodies" |
      "spawnRigidBody" | "addPhysicsBodyCollider" | "getPhysicsBodyColliderCount" |
      "getPhysicsBodyCollider" | "getPhysicsEntity" | "despawnPhysicsEntity" |
      "capturePhysicsBodyStateBuffer" | "restorePhysicsBodyStateBuffer" |
      "setPhysicsBodyVelocity" | "setPhysicsBodyRotation" | "setPhysicsBodyAngularVelocity" |
      "setPhysicsBodyHeightSpan" | "clearPhysicsBodyHeightSpan" | "getPhysicsBodyHeightSpan" |
      "moveHd2dKinematicBodyWithTilemap" |
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
      "setShooterTileHeightSpan" | "clearShooterTileHeightSpan" |
      "setShooterTileHd2dMetadata" | "clearShooterTileHd2dMetadata" |
      "setShooterTileBridgePortal" | "clearShooterTileBridgePortal" |
      "setShooterTilemapNavigationCost" | "queryTilemapNavigationWaypoint" | "queryTilemapNavigationPath" |
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
      projectileArc: resolvedProjectileArc,
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
      postProcessing: resolvedPostProcessPasses,
      physics: resolvePhysicsSpec(gameSpec.physics),
      content: resolvedContentSpec,
    }),
    setShooterAtlasFrame: () => true,
    builtInShooterPlayerHandle: () => physicsEntityHandle,
    captureShooterStateSnapshot: () => builtInShooterState,
    restoreShooterStateSnapshot: () => true,
    useDataScene: () => undefined,
    useBreakoutGame: () => undefined,
    configurePhysicsRuntime: (spec) => spec,
    configureFixedTimestep: () => undefined,
    configureAutoRigidBodyStep: () => undefined,
    stepRigidBodies: () => rigidBodyStepStats,
    spawnRigidBody: () => physicsEntityHandle,
    addPhysicsBodyCollider: () => true,
    getPhysicsBodyColliderCount: () => 2,
    getPhysicsBodyCollider: () => bodyColliderSnapshot,
    getPhysicsEntity: () => physicsEntitySnapshot,
    despawnPhysicsEntity: () => true,
    capturePhysicsBodyStateBuffer: () => physicsBodyStateBuffer,
    restorePhysicsBodyStateBuffer: () => true,
    setPhysicsBodyVelocity: () => true,
    setPhysicsBodyRotation: () => true,
    setPhysicsBodyAngularVelocity: () => true,
    setPhysicsBodyHeightSpan: () => true,
    clearPhysicsBodyHeightSpan: () => true,
    getPhysicsBodyHeightSpan: () => ({ floorId: 0, elevation: 0, height: 16 }),
    moveHd2dKinematicBodyWithTilemap: () => undefined,
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
    setShooterTileHeightSpan: () => true,
    clearShooterTileHeightSpan: () => true,
    setShooterTileHd2dMetadata: () => true,
    clearShooterTileHd2dMetadata: () => true,
    setShooterTileBridgePortal: () => true,
    clearShooterTileBridgePortal: () => true,
    setShooterTilemapNavigationCost: () => true,
    queryTilemapNavigationWaypoint: () => navigationWaypoint,
    queryTilemapNavigationPath: () => navigationPath,
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
  equal(physicsDebugLineCamera.x, 0);
  equal(physicsDebugOptions.colliders, true);
  equal(gameSpec.world?.width, 1600);
  equal(dialogueContentSpec.graphs?.intro?.initialNode, "start");
  equal(contentRuntimeSelection.localization, false);
  equal(contentRuntimeOptionSet.dialogue, undefined);
  equal(cameraSpec.preset, "look-ahead");
  equal(atlasFrameSpec.texture, "bullet");
  equal(atlasAnimationSpec.idle?.frames?.[0], "bullet");
  equal(resolvedAtlasAnimation.idle.fps, 1);
  equal(prefabColliderType, "aabb");
  equal(prefabColliderSpec.offset?.x, 1);
  equal(physicsMaterialSpec.friction, 0.8);
  equal(projectileArcSpec.launchHeight, undefined);
  equal(resolvedProjectileArc.enabled, false);
  equal(resolvedPrefabCollider.material?.surfaceVelocityX, 2);
  equal(resolvedPrefabColliderVertex.x, -2);
  equal(tileSlopeSpec.y0, 1);
  equal(tileKind, "flat");
  equal(tileRampAxis, "x");
  equal(tileRampSpec.axis, "x");
  equal(tileBridgePortalSpec.upperFloor, "bridge");
  equal(tileFloorSpec, "default");
  equal(resolvedTileSlope.x1, 1);
  equal(resolvedTileRamp.endElevation, 8);
  equal(resolvedTileBridgePortal.navigationCost, 1);
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
  equal(audioManagerConfig.uiVolume, 0.4);
  equal(audioBus, "bgm");
  equal(playBgmOptions.loop, true);
  equal(playBgmOptions.fadeMs, 500);
  equal(stopBgmOptions.fadeOutSeconds, 0.25);
  equal(stopBgmOptions.fadeMs, 250);
  equal(spatialAudioOptions.x, 1);
  equal(audioManagerState.bgmPlaying, false);
  equal(audioManagerState.uiVolume, 0.4);
  equal(diagnosticReport.context?.kind, "texture");
  equal(physicsMode, "rigid");
  equal(shooterRuntimePrefab, "bullet");
  equal(shooterRuntimeAtlasFrame.texture, 23);
  equal(physicsLayerSpec.mask?.[0], "world");
  equal(physicsDebugSpec.colliders, true);
  equal(engine.setGameSpec(gameSpec).enemyBehavior, "chase");
  equal(engine.setShooterAtlasFrame(shooterRuntimePrefab, shooterRuntimeAtlasFrame), true);
  equal(engine.builtInShooterPlayerHandle()?.entityId, physicsEntityHandle.entityId);
  engine.useDataScene();
  engine.useBreakoutGame();
});
