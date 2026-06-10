import type { PostProcessStackInput, ResolvedPostProcessPass } from "./cameraPostProcessing.js";
import type { CutsceneSequenceSpec, ResolvedCutsceneSequenceSpec } from "./cutsceneSequence.js";
import type { DialogueGraphSpec, ResolvedDialogueGraph } from "./dialogueQuest.js";
import type { LocalizationDocumentSpec, ResolvedLocalizationDocument } from "./localization.js";
import type { PhysicsFloorId, PhysicsMode, PhysicsSpec, ResolvedPhysicsSpec } from "./physicsSpec.js";

export interface ShooterGameSpec {
  world?: {
    width?: number;
    height?: number;
  };
  player?: {
    speed?: number;
  };
  enemies?: {
    speed?: number;
    spawnInterval?: number;
    behavior?: ShooterEnemyBehaviorPreset;
    spawnPattern?: ShooterEnemySpawnPatternPreset;
    health?: number;
    scoreReward?: number;
    orbit?: ShooterEnemyOrbitSpec;
    presets?: Record<string, ShooterEnemyPresetSpec>;
    waves?: ShooterWaveSpec[];
  };
  weapons?: {
    bulletSpeed?: number;
    cooldown?: number;
    lifetime?: number;
    damage?: number;
    projectileArc?: ShooterProjectileArcSpec;
  };
  prefabs?: {
    player?: ShooterPrefabSpec;
    enemy?: ShooterPrefabSpec;
    bullet?: ShooterPrefabSpec;
  };
  atlas?: ShooterAtlasSpec;
  tilemap?: ShooterTilemapSpec;
  camera?: ShooterCameraSpec;
  postProcessing?: PostProcessStackInput;
  audio?: ShooterAudioSpec;
  physics?: PhysicsSpec;
  content?: ShooterContentSpec;
}

export interface ShooterEnemyPresetSpec {
  speed?: number;
  behavior?: ShooterEnemyBehaviorPreset;
  spawnPattern?: ShooterEnemySpawnPatternPreset;
  health?: number;
  scoreReward?: number;
}

export interface ShooterProjectileArcSpec {
  enabled?: boolean;
  launchHeight?: number;
  zVelocity?: number;
  gravity?: number;
  hitHeight?: number;
}

export interface ShooterEnemyOrbitSpec {
  radius?: number;
  radialBand?: number;
}

export interface ShooterWaveSpec {
  enemy?: string;
  duration?: number;
  spawnInterval?: number;
  enemyCount?: number;
  spawnPattern?: ShooterEnemySpawnPatternPreset;
}

export interface ShooterAudioSpec {
  masterVolume?: number;
  sfxVolume?: number;
  events?: {
    shoot?: ShooterAudioEventPolicySpec;
    hit?: ShooterAudioEventPolicySpec;
    gameOver?: ShooterAudioEventPolicySpec;
  };
}

export interface ShooterAudioEventPolicySpec {
  volume?: number;
  pitch?: number;
}

export interface ShooterContentSpec {
  localization?: LocalizationDocumentSpec;
  dialogue?: ShooterDialogueContentSpec;
  cutscenes?: Record<string, CutsceneSequenceSpec>;
}

export interface ShooterDialogueContentSpec {
  graphs?: Record<string, DialogueGraphSpec>;
}

export interface ResolvedShooterContentSpec {
  localization?: ResolvedLocalizationDocument;
  dialogueGraphs: Readonly<Record<string, ResolvedDialogueGraph>>;
  cutscenes: Readonly<Record<string, ResolvedCutsceneSequenceSpec>>;
}

export interface ShooterCameraSpec {
  preset?: ShooterCameraPreset;
  deadZone?: {
    width?: number;
    height?: number;
  };
  lookAhead?: {
    distance?: number;
  };
  shake?: {
    amplitude?: number;
    frequency?: number;
  };
}

export interface ShooterPrefabSpec {
  width?: number;
  height?: number;
  frame?: string;
  animation?: ShooterSpriteAnimationSpec;
  collider?: ShooterPrefabColliderSpec;
}

export type ShooterPrefabColliderType = "aabb" | "circle" | "capsule" | "orientedBox" | "convexPolygon";

export interface ShooterPrefabColliderSpec {
  type?: ShooterPrefabColliderType;
  halfWidth?: number;
  halfHeight?: number;
  radius?: number;
  start?: {
    x?: number;
    y?: number;
  };
  end?: {
    x?: number;
    y?: number;
  };
  rotationRadians?: number;
  vertices?: Array<{
    x?: number;
    y?: number;
  }>;
  offset?: {
    x?: number;
    y?: number;
  };
  enabled?: boolean;
  trigger?: boolean;
  material?: ShooterPhysicsMaterialSpec;
}

export interface ShooterPhysicsMaterialSpec {
  restitution?: number;
  friction?: number;
  surfaceVelocity?: {
    x?: number;
    y?: number;
  };
  density?: number;
  contactBaumgarteBiasScale?: number;
  maxContactBaumgarteBiasVelocityScale?: number;
  contactPositionCorrectionScale?: number;
  contactPositionCorrectionSlopScale?: number;
}

export interface ShooterAtlasSpec {
  frames?: Record<string, ShooterAtlasFrameSpec>;
}

export interface ShooterTilemapSpec {
  tileWidth?: number;
  tileHeight?: number;
  origin?: {
    x?: number;
    y?: number;
  };
  tiles?: Record<string, ShooterTileSpec>;
  layers?: ShooterTileLayerSpec[];
}

export type ShooterTileKind = "flat" | "stair" | "ramp" | "ledge" | "bridge";
export type ShooterTileRampAxis = "x" | "y";

export interface ShooterTileRampSpec {
  axis?: ShooterTileRampAxis;
  startElevation?: number;
  endElevation?: number;
}

export interface ShooterTileBridgePortalSpec {
  lowerFloor?: PhysicsFloorId;
  upperFloor?: PhysicsFloorId;
  lowerElevation?: number;
  upperElevation?: number;
  navigationCost?: number;
}

export interface ShooterTileSpec {
  frame?: string;
  color?: [number, number, number, number];
  floor?: PhysicsFloorId;
  elevation?: number;
  height?: number;
  kind?: ShooterTileKind;
  ramp?: ShooterTileRampSpec;
  bridgePortal?: ShooterTileBridgePortalSpec;
  blocksMovement?: boolean;
  blocksProjectile?: boolean;
  blocksVision?: boolean;
  occluderHeight?: number;
  slope?: ShooterTileSlopeSpec;
  oneWayPlatform?: boolean;
}

export interface ShooterTileSlopeSpec {
  x0?: number;
  y0?: number;
  x1?: number;
  y1?: number;
}

export interface ShooterTileLayerSpec {
  name?: string;
  columns?: number;
  rows?: number;
  tileWidth?: number;
  tileHeight?: number;
  origin?: {
    x?: number;
    y?: number;
  };
  collision?: boolean;
  collisionOnly?: boolean;
  data?: number[];
}

export interface ShooterAtlasFrameSpec {
  texture?: string | number;
  uv?: {
    u0?: number;
    v0?: number;
    u1?: number;
    v1?: number;
  };
  size?: {
    width?: number;
    height?: number;
  };
}

export interface ResolvedShooterAtlasFrame {
  name: string;
  texture: string | number;
  width: number;
  height: number;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export interface ResolvedShooterTileDefinition {
  id: number;
  frame: ResolvedShooterAtlasFrame;
  color: [number, number, number, number];
  floor: PhysicsFloorId;
  elevation: number;
  height: number;
  kind: ShooterTileKind;
  blocksMovement: boolean;
  blocksProjectile: boolean;
  blocksVision: boolean;
  occluderHeight: number;
  ramp?: ResolvedShooterTileRampDefinition;
  bridgePortal?: ResolvedShooterTileBridgePortalDefinition;
  slope?: ResolvedShooterTileSlopeDefinition;
  oneWayPlatform?: boolean;
}

export interface ResolvedShooterTileRampDefinition {
  axis: ShooterTileRampAxis;
  startElevation: number;
  endElevation: number;
}

export interface ResolvedShooterTileBridgePortalDefinition {
  lowerFloor: PhysicsFloorId;
  upperFloor: PhysicsFloorId;
  lowerElevation: number;
  upperElevation: number;
  navigationCost: number;
}

export interface ResolvedShooterTileSlopeDefinition {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ResolvedShooterTileLayer {
  index: number;
  name: string;
  columns: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
  originX: number;
  originY: number;
  collision: boolean;
  collisionOnly: boolean;
  data: number[];
}

export interface ResolvedShooterTilemap {
  tiles: ResolvedShooterTileDefinition[];
  layers: ResolvedShooterTileLayer[];
}

export interface ResolvedShooterPhysicsMaterial {
  restitution: number;
  friction: number;
  surfaceVelocityX: number;
  surfaceVelocityY: number;
  density: number;
  contactBaumgarteBiasScale: number;
  maxContactBaumgarteBiasVelocityScale: number;
  contactPositionCorrectionScale: number;
  contactPositionCorrectionSlopScale: number;
}

export interface ResolvedShooterPrefabColliderBase {
  type: ShooterPrefabColliderType;
  offsetX: number;
  offsetY: number;
  enabled: boolean;
  trigger: boolean;
  material?: ResolvedShooterPhysicsMaterial;
}

export type ResolvedShooterPrefabCollider =
  | (ResolvedShooterPrefabColliderBase & {
      type: "aabb";
      halfWidth: number;
      halfHeight: number;
    })
  | (ResolvedShooterPrefabColliderBase & {
      type: "circle";
      radius: number;
    })
  | (ResolvedShooterPrefabColliderBase & {
      type: "capsule";
      startX: number;
      startY: number;
      endX: number;
      endY: number;
      radius: number;
    })
  | (ResolvedShooterPrefabColliderBase & {
      type: "orientedBox";
      halfWidth: number;
      halfHeight: number;
      rotationRadians: number;
    })
  | (ResolvedShooterPrefabColliderBase & {
      type: "convexPolygon";
      vertices: ResolvedShooterPrefabColliderVertex[];
      rotationRadians: number;
    });

export interface ResolvedShooterPrefabColliderVertex {
  x: number;
  y: number;
}

export interface ResolvedShooterPrefabAabbCollider extends ResolvedShooterPrefabColliderBase {
  type: "aabb";
  halfWidth: number;
  halfHeight: number;
}

export interface ResolvedShooterWave {
  index: number;
  enemy: string;
  duration: number;
  spawnInterval: number;
  enemyCount: number;
  enemySpeed: number;
  enemyBehavior: ShooterEnemyBehaviorPreset;
  enemyBehaviorCode: number;
  enemySpawnPattern: ShooterEnemySpawnPatternPreset;
  enemySpawnPatternCode: number;
  enemyHealth: number;
  scoreReward: number;
}

export interface ShooterSpriteAnimationSpec {
  columns?: number;
  rows?: number;
  frames?: number;
  fps?: number;
  atlas?: ShooterAtlasAnimationSpec;
  states?: {
    idle?: ShooterSpriteAnimationStateSpec;
    move?: ShooterSpriteAnimationStateSpec;
  };
}

export interface ShooterSpriteAnimationStateSpec {
  row?: number;
  frames?: number;
  fps?: number;
}

export interface ShooterAtlasAnimationSpec {
  idle?: ShooterAtlasAnimationStateSpec;
  move?: ShooterAtlasAnimationStateSpec;
}

export interface ShooterAtlasAnimationStateSpec {
  frames?: string[];
  fps?: number;
}

export type ShooterEnemyBehaviorPreset = "chase" | "drift" | "static" | "orbit";
export type ShooterEnemySpawnPatternPreset = "edge" | "corners" | "center";
export type ShooterCameraPreset = "follow" | "dead-zone" | "look-ahead" | "shake";

export interface ResolvedShooterGameSpec {
  worldWidth: number;
  worldHeight: number;
  playerSpeed: number;
  enemySpeed: number;
  enemySpawnInterval: number;
  bulletSpeed: number;
  fireCooldown: number;
  bulletLifetime: number;
  playerWidth: number;
  playerHeight: number;
  enemyWidth: number;
  enemyHeight: number;
  bulletWidth: number;
  bulletHeight: number;
  playerAnimationFrames: number;
  playerAnimationFps: number;
  playerAnimationColumns: number;
  playerAnimationRows: number;
  playerAnimationIdleRow: number;
  playerAnimationIdleFrames: number;
  playerAnimationIdleFps: number;
  playerAnimationMoveRow: number;
  playerAnimationMoveFrames: number;
  playerAnimationMoveFps: number;
  enemyAnimationFrames: number;
  enemyAnimationFps: number;
  enemyAnimationColumns: number;
  enemyAnimationRows: number;
  enemyAnimationIdleRow: number;
  enemyAnimationIdleFrames: number;
  enemyAnimationIdleFps: number;
  enemyAnimationMoveRow: number;
  enemyAnimationMoveFrames: number;
  enemyAnimationMoveFps: number;
  bulletAnimationFrames: number;
  bulletAnimationFps: number;
  bulletAnimationColumns: number;
  bulletAnimationRows: number;
  bulletAnimationIdleRow: number;
  bulletAnimationIdleFrames: number;
  bulletAnimationIdleFps: number;
  bulletAnimationMoveRow: number;
  bulletAnimationMoveFrames: number;
  bulletAnimationMoveFps: number;
  enemyBehavior: ShooterEnemyBehaviorPreset;
  enemyBehaviorCode: number;
  enemySpawnPattern: ShooterEnemySpawnPatternPreset;
  enemySpawnPatternCode: number;
  enemyHealth: number;
  bulletDamage: number;
  projectileArc: ResolvedShooterProjectileArcSpec;
  scoreReward: number;
  orbitRadius: number;
  orbitRadialBand: number;
  cameraPreset: ShooterCameraPreset;
  cameraPresetCode: number;
  cameraDeadZoneWidth: number;
  cameraDeadZoneHeight: number;
  cameraLookAheadDistance: number;
  cameraShakeAmplitude: number;
  cameraShakeFrequency: number;
  atlasFrames: Record<string, ResolvedShooterAtlasFrame>;
  playerAtlasFrame?: ResolvedShooterAtlasFrame;
  enemyAtlasFrame?: ResolvedShooterAtlasFrame;
  bulletAtlasFrame?: ResolvedShooterAtlasFrame;
  playerAtlasAnimation?: ResolvedShooterAtlasAnimation;
  enemyAtlasAnimation?: ResolvedShooterAtlasAnimation;
  bulletAtlasAnimation?: ResolvedShooterAtlasAnimation;
  playerCollider: ResolvedShooterPrefabCollider;
  enemyCollider: ResolvedShooterPrefabCollider;
  bulletCollider: ResolvedShooterPrefabCollider;
  tilemap?: ResolvedShooterTilemap;
  waves: ResolvedShooterWave[];
  audioMasterVolume: number;
  audioSfxVolume: number;
  shootVolume: number;
  shootPitch: number;
  hitVolume: number;
  hitPitch: number;
  gameOverVolume: number;
  gameOverPitch: number;
  postProcessing: readonly ResolvedPostProcessPass[];
  physics: ResolvedPhysicsSpec;
  content: ResolvedShooterContentSpec;
}

export interface ResolvedShooterProjectileArcSpec {
  enabled: boolean;
  launchHeight: number;
  zVelocity: number;
  gravity: number;
  hitHeight: number;
}

export interface ResolvedShooterAtlasAnimation {
  texture: string | number;
  width: number;
  height: number;
  idle: ResolvedShooterAtlasAnimationState;
  move: ResolvedShooterAtlasAnimationState;
}

export interface ResolvedShooterAtlasAnimationState {
  frames: ResolvedShooterAtlasFrame[];
  fps: number;
}

export interface ShooterGameSpecTarget {
  set_shooter_resolved_config(
    worldWidth: number,
    worldHeight: number,
    playerSpeed: number,
    enemySpeed: number,
    enemySpawnInterval: number,
    bulletSpeed: number,
    fireCooldown: number,
    bulletLifetime: number,
    playerWidth: number,
    playerHeight: number,
    enemyWidth: number,
    enemyHeight: number,
    bulletWidth: number,
    bulletHeight: number,
    playerAnimationFrames: number,
    playerAnimationFps: number,
    enemyAnimationFrames: number,
    enemyAnimationFps: number,
    bulletAnimationFrames: number,
    bulletAnimationFps: number,
    enemyBehavior: number,
    enemySpawnPattern: number,
    enemyHealth: number,
    bulletDamage: number,
    scoreReward: number,
    orbitRadius: number,
    orbitRadialBand: number,
  ): void;
  set_shooter_projectile_arc?(
    enabled: boolean,
    launchHeight: number,
    zVelocity: number,
    gravity: number,
    hitHeight: number,
  ): void;
  set_shooter_animations?(
    playerColumns: number,
    playerRows: number,
    playerIdleRow: number,
    playerIdleFrames: number,
    playerIdleFps: number,
    playerMoveRow: number,
    playerMoveFrames: number,
    playerMoveFps: number,
    enemyColumns: number,
    enemyRows: number,
    enemyIdleRow: number,
    enemyIdleFrames: number,
    enemyIdleFps: number,
    enemyMoveRow: number,
    enemyMoveFrames: number,
    enemyMoveFps: number,
    bulletColumns: number,
    bulletRows: number,
    bulletIdleRow: number,
    bulletIdleFrames: number,
    bulletIdleFps: number,
    bulletMoveRow: number,
    bulletMoveFrames: number,
    bulletMoveFps: number,
  ): void;
  set_shooter_camera_preset?(
    preset: number,
    deadZoneWidth: number,
    deadZoneHeight: number,
    lookAheadDistance: number,
    shakeAmplitude: number,
    shakeFrequency: number,
  ): void;
  set_shooter_atlas_frame?(
    prefab: number,
    textureId: number,
    width: number,
    height: number,
    u0: number,
    v0: number,
    u1: number,
    v1: number,
  ): void;
  set_shooter_atlas_animation?(
    prefab: number,
    textureId: number,
    width: number,
    height: number,
    idleFps: number,
    idleFrames: Float32Array,
    moveFps: number,
    moveFrames: Float32Array,
  ): void;
  set_shooter_prefab_collider?(
    prefab: number,
    halfWidth: number,
    halfHeight: number,
    offsetX: number,
    offsetY: number,
    enabled: boolean,
    trigger: boolean,
    hasMaterial: boolean,
    restitution: number,
    friction: number,
    surfaceVelocityX: number,
    surfaceVelocityY: number,
    density: number,
    contactBaumgarteBiasScale: number,
    maxContactBaumgarteBiasVelocityScale: number,
    contactPositionCorrectionScale: number,
    contactPositionCorrectionSlopScale: number,
  ): boolean;
  set_shooter_prefab_circle_collider?(
    prefab: number,
    radius: number,
    offsetX: number,
    offsetY: number,
    enabled: boolean,
    trigger: boolean,
    hasMaterial: boolean,
    restitution: number,
    friction: number,
    surfaceVelocityX: number,
    surfaceVelocityY: number,
    density: number,
    contactBaumgarteBiasScale: number,
    maxContactBaumgarteBiasVelocityScale: number,
    contactPositionCorrectionScale: number,
    contactPositionCorrectionSlopScale: number,
  ): boolean;
  set_shooter_prefab_capsule_collider?(
    prefab: number,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    radius: number,
    offsetX: number,
    offsetY: number,
    enabled: boolean,
    trigger: boolean,
    hasMaterial: boolean,
    restitution: number,
    friction: number,
    surfaceVelocityX: number,
    surfaceVelocityY: number,
    density: number,
    contactBaumgarteBiasScale: number,
    maxContactBaumgarteBiasVelocityScale: number,
    contactPositionCorrectionScale: number,
    contactPositionCorrectionSlopScale: number,
  ): boolean;
  set_shooter_prefab_oriented_box_collider?(
    prefab: number,
    halfWidth: number,
    halfHeight: number,
    rotationRadians: number,
    offsetX: number,
    offsetY: number,
    enabled: boolean,
    trigger: boolean,
    hasMaterial: boolean,
    restitution: number,
    friction: number,
    surfaceVelocityX: number,
    surfaceVelocityY: number,
    density: number,
    contactBaumgarteBiasScale: number,
    maxContactBaumgarteBiasVelocityScale: number,
    contactPositionCorrectionScale: number,
    contactPositionCorrectionSlopScale: number,
  ): boolean;
  set_shooter_prefab_convex_polygon_collider?(
    prefab: number,
    vertices: Float32Array,
    rotationRadians: number,
    offsetX: number,
    offsetY: number,
    enabled: boolean,
    trigger: boolean,
    hasMaterial: boolean,
    restitution: number,
    friction: number,
    surfaceVelocityX: number,
    surfaceVelocityY: number,
    density: number,
    contactBaumgarteBiasScale: number,
    maxContactBaumgarteBiasVelocityScale: number,
    contactPositionCorrectionScale: number,
    contactPositionCorrectionSlopScale: number,
  ): boolean;
  clear_shooter_tilemap?(): void;
  set_shooter_tile?(
    tileId: number,
    textureId: number,
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    r: number,
    g: number,
    b: number,
    a: number,
  ): void;
  set_shooter_tile_slope?(
    tileId: number,
    localX0: number,
    localY0: number,
    localX1: number,
    localY1: number,
  ): void;
  set_shooter_tile_one_way_platform?(tileId: number): void;
  set_shooter_tile_height_span?(
    tileId: number,
    floorId: number,
    elevation: number,
    height: number,
  ): boolean;
  set_shooter_tile_hd2d_metadata?(
    tileId: number,
    kind: number,
    blocksMovement: boolean,
    blocksProjectile: boolean,
    blocksVision: boolean,
    occluderHeight: number,
    hasRamp: boolean,
    rampAxis: number,
    rampStartElevation: number,
    rampEndElevation: number,
  ): boolean;
  set_shooter_tile_bridge_portal?(
    tileId: number,
    lowerFloorId: number,
    upperFloorId: number,
    lowerElevation: number,
    upperElevation: number,
    navigationCost: number,
  ): boolean;
  set_shooter_tilemap_layer?(
    index: number,
    columns: number,
    rows: number,
    tileWidth: number,
    tileHeight: number,
    originX: number,
    originY: number,
    collision: boolean,
    tiles: Uint32Array,
  ): void;
  clear_shooter_waves?(): void;
  set_shooter_wave?(
    index: number,
    duration: number,
    spawnInterval: number,
    enemyCount: number,
    enemySpeed: number,
    enemyBehavior: number,
    enemySpawnPattern: number,
    enemyHealth: number,
    scoreReward: number,
  ): void;
  set_shooter_wave_action_trigger?(
    waveIndex: number,
    sourceEntityId: number,
    sourceEntityGeneration: number,
    actionId: number,
  ): boolean;
  set_shooter_audio_policy?(
    shootVolume: number,
    shootPitch: number,
    hitVolume: number,
    hitPitch: number,
    gameOverVolume: number,
    gameOverPitch: number,
  ): void;
}

export interface ApplyShooterGameSpecOptions {
  textureId?: (name: string) => number;
  physicsModeOverride?: PhysicsMode;
}

export interface ResolveShooterGameSpecOptions {
  physicsModeOverride?: PhysicsMode;
}
