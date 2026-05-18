import { gameSpecDiagnosticError } from "./diagnostics.js";

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
    presets?: Record<string, ShooterEnemyPresetSpec>;
    waves?: ShooterWaveSpec[];
  };
  weapons?: {
    bulletSpeed?: number;
    cooldown?: number;
    lifetime?: number;
    damage?: number;
  };
  prefabs?: {
    player?: ShooterPrefabSpec;
    enemy?: ShooterPrefabSpec;
    bullet?: ShooterPrefabSpec;
  };
  atlas?: ShooterAtlasSpec;
  tilemap?: ShooterTilemapSpec;
  camera?: ShooterCameraSpec;
  audio?: ShooterAudioSpec;
}

export interface ShooterEnemyPresetSpec {
  speed?: number;
  behavior?: ShooterEnemyBehaviorPreset;
  spawnPattern?: ShooterEnemySpawnPatternPreset;
  health?: number;
  scoreReward?: number;
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

export interface ShooterTileSpec {
  frame?: string;
  color?: [number, number, number, number];
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
  data: number[];
}

export interface ResolvedShooterTilemap {
  tiles: ResolvedShooterTileDefinition[];
  layers: ResolvedShooterTileLayer[];
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

export type ShooterEnemyBehaviorPreset = "chase" | "drift" | "static";
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
  scoreReward: number;
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
}

const DEFAULT_SHOOTER_GAME_SPEC: ResolvedShooterGameSpec = {
  worldWidth: 1600,
  worldHeight: 960,
  playerSpeed: 180,
  enemySpeed: 72,
  enemySpawnInterval: 1.0,
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
  cameraPreset: "follow",
  cameraPresetCode: 0,
  cameraDeadZoneWidth: 160,
  cameraDeadZoneHeight: 96,
  cameraLookAheadDistance: 96,
  cameraShakeAmplitude: 6,
  cameraShakeFrequency: 8,
  atlasFrames: {},
  waves: [],
  audioMasterVolume: 1,
  audioSfxVolume: 1,
  shootVolume: 0.35,
  shootPitch: 1,
  hitVolume: 0.45,
  hitPitch: 1,
  gameOverVolume: 0.65,
  gameOverPitch: 0.9,
};

export function resolveShooterGameSpec(input: unknown): ResolvedShooterGameSpec {
  const spec = optionalObject(input, "game spec");
  const world = optionalObject(spec.world, "world");
  const player = optionalObject(spec.player, "player");
  const enemies = optionalObject(spec.enemies, "enemies");
  const weapons = optionalObject(spec.weapons, "weapons");
  const prefabs = optionalObject(spec.prefabs, "prefabs");
  const atlasFrames = atlasFrameMap(spec.atlas, "atlas");
  const tilemap = shooterTilemap(spec.tilemap, "tilemap", atlasFrames);
  const camera = optionalObject(spec.camera, "camera");
  const audio = optionalObject(spec.audio, "audio");
  const audioEvents = optionalObject(audio.events, "audio.events");
  const cameraDeadZone = optionalObject(camera.deadZone, "camera.deadZone");
  const cameraLookAhead = optionalObject(camera.lookAhead, "camera.lookAhead");
  const cameraShake = optionalObject(camera.shake, "camera.shake");
  const playerPrefab = optionalObject(prefabs.player, "prefabs.player");
  const enemyPrefab = optionalObject(prefabs.enemy, "prefabs.enemy");
  const bulletPrefab = optionalObject(prefabs.bullet, "prefabs.bullet");
  const playerAtlasFrame = prefabAtlasFrame(
    playerPrefab.frame,
    playerPrefab.animation,
    "prefabs.player",
    atlasFrames,
  );
  const enemyAtlasFrame = prefabAtlasFrame(
    enemyPrefab.frame,
    enemyPrefab.animation,
    "prefabs.enemy",
    atlasFrames,
  );
  const bulletAtlasFrame = prefabAtlasFrame(
    bulletPrefab.frame,
    bulletPrefab.animation,
    "prefabs.bullet",
    atlasFrames,
  );

  const playerAnimation = spriteAnimation(playerPrefab.animation, "prefabs.player.animation");
  const enemyAnimation = spriteAnimation(enemyPrefab.animation, "prefabs.enemy.animation");
  const bulletAnimation = spriteAnimation(bulletPrefab.animation, "prefabs.bullet.animation");
  const shootAudio = audioEventPolicy(audioEvents.shoot, "audio.events.shoot", {
    volume: DEFAULT_SHOOTER_GAME_SPEC.shootVolume,
    pitch: DEFAULT_SHOOTER_GAME_SPEC.shootPitch,
  });
  const hitAudio = audioEventPolicy(audioEvents.hit, "audio.events.hit", {
    volume: DEFAULT_SHOOTER_GAME_SPEC.hitVolume,
    pitch: DEFAULT_SHOOTER_GAME_SPEC.hitPitch,
  });
  const gameOverAudio = audioEventPolicy(audioEvents.gameOver, "audio.events.gameOver", {
    volume: DEFAULT_SHOOTER_GAME_SPEC.gameOverVolume,
    pitch: DEFAULT_SHOOTER_GAME_SPEC.gameOverPitch,
  });
  const resolvedEnemyBehavior = enemyBehavior(enemies.behavior, "enemies.behavior");
  const resolvedEnemySpawnPattern = enemySpawnPattern(enemies.spawnPattern, "enemies.spawnPattern");
  const enemySpeed = positiveNumber(enemies.speed, "enemies.speed", DEFAULT_SHOOTER_GAME_SPEC.enemySpeed);
  const enemySpawnInterval = positiveNumber(
    enemies.spawnInterval,
    "enemies.spawnInterval",
    DEFAULT_SHOOTER_GAME_SPEC.enemySpawnInterval,
  );
  const enemyHealth = positiveNumber(enemies.health, "enemies.health", DEFAULT_SHOOTER_GAME_SPEC.enemyHealth);
  const scoreReward = positiveInteger(enemies.scoreReward, "enemies.scoreReward", DEFAULT_SHOOTER_GAME_SPEC.scoreReward);
  const waves = shooterWaves(enemies, {
    speed: enemySpeed,
    spawnInterval: enemySpawnInterval,
    behavior: resolvedEnemyBehavior.enemyBehavior,
    behaviorCode: resolvedEnemyBehavior.enemyBehaviorCode,
    spawnPattern: resolvedEnemySpawnPattern.enemySpawnPattern,
    spawnPatternCode: resolvedEnemySpawnPattern.enemySpawnPatternCode,
    health: enemyHealth,
    scoreReward,
  });

  return {
    worldWidth: positiveNumber(world.width, "world.width", DEFAULT_SHOOTER_GAME_SPEC.worldWidth),
    worldHeight: positiveNumber(world.height, "world.height", DEFAULT_SHOOTER_GAME_SPEC.worldHeight),
    playerSpeed: positiveNumber(player.speed, "player.speed", DEFAULT_SHOOTER_GAME_SPEC.playerSpeed),
    enemySpeed,
    enemySpawnInterval,
    bulletSpeed: positiveNumber(
      weapons.bulletSpeed,
      "weapons.bulletSpeed",
      DEFAULT_SHOOTER_GAME_SPEC.bulletSpeed,
    ),
    fireCooldown: positiveNumber(weapons.cooldown, "weapons.cooldown", DEFAULT_SHOOTER_GAME_SPEC.fireCooldown),
    bulletLifetime: positiveNumber(weapons.lifetime, "weapons.lifetime", DEFAULT_SHOOTER_GAME_SPEC.bulletLifetime),
    playerWidth: positiveNumber(
      playerPrefab.width,
      "prefabs.player.width",
      playerAtlasFrame?.width ?? DEFAULT_SHOOTER_GAME_SPEC.playerWidth,
    ),
    playerHeight: positiveNumber(
      playerPrefab.height,
      "prefabs.player.height",
      playerAtlasFrame?.height ?? DEFAULT_SHOOTER_GAME_SPEC.playerHeight,
    ),
    enemyWidth: positiveNumber(
      enemyPrefab.width,
      "prefabs.enemy.width",
      enemyAtlasFrame?.width ?? DEFAULT_SHOOTER_GAME_SPEC.enemyWidth,
    ),
    enemyHeight: positiveNumber(
      enemyPrefab.height,
      "prefabs.enemy.height",
      enemyAtlasFrame?.height ?? DEFAULT_SHOOTER_GAME_SPEC.enemyHeight,
    ),
    bulletWidth: positiveNumber(
      bulletPrefab.width,
      "prefabs.bullet.width",
      bulletAtlasFrame?.width ?? DEFAULT_SHOOTER_GAME_SPEC.bulletWidth,
    ),
    bulletHeight: positiveNumber(
      bulletPrefab.height,
      "prefabs.bullet.height",
      bulletAtlasFrame?.height ?? DEFAULT_SHOOTER_GAME_SPEC.bulletHeight,
    ),
    playerAnimationFrames: playerAnimation.frames,
    playerAnimationFps: playerAnimation.fps,
    playerAnimationColumns: playerAnimation.columns,
    playerAnimationRows: playerAnimation.rows,
    playerAnimationIdleRow: playerAnimation.idleRow,
    playerAnimationIdleFrames: playerAnimation.idleFrames,
    playerAnimationIdleFps: playerAnimation.idleFps,
    playerAnimationMoveRow: playerAnimation.moveRow,
    playerAnimationMoveFrames: playerAnimation.moveFrames,
    playerAnimationMoveFps: playerAnimation.moveFps,
    enemyAnimationFrames: enemyAnimation.frames,
    enemyAnimationFps: enemyAnimation.fps,
    enemyAnimationColumns: enemyAnimation.columns,
    enemyAnimationRows: enemyAnimation.rows,
    enemyAnimationIdleRow: enemyAnimation.idleRow,
    enemyAnimationIdleFrames: enemyAnimation.idleFrames,
    enemyAnimationIdleFps: enemyAnimation.idleFps,
    enemyAnimationMoveRow: enemyAnimation.moveRow,
    enemyAnimationMoveFrames: enemyAnimation.moveFrames,
    enemyAnimationMoveFps: enemyAnimation.moveFps,
    bulletAnimationFrames: bulletAnimation.frames,
    bulletAnimationFps: bulletAnimation.fps,
    bulletAnimationColumns: bulletAnimation.columns,
    bulletAnimationRows: bulletAnimation.rows,
    bulletAnimationIdleRow: bulletAnimation.idleRow,
    bulletAnimationIdleFrames: bulletAnimation.idleFrames,
    bulletAnimationIdleFps: bulletAnimation.idleFps,
    bulletAnimationMoveRow: bulletAnimation.moveRow,
    bulletAnimationMoveFrames: bulletAnimation.moveFrames,
    bulletAnimationMoveFps: bulletAnimation.moveFps,
    ...resolvedEnemyBehavior,
    ...resolvedEnemySpawnPattern,
    enemyHealth,
    bulletDamage: positiveNumber(weapons.damage, "weapons.damage", DEFAULT_SHOOTER_GAME_SPEC.bulletDamage),
    scoreReward,
    ...cameraPreset(camera.preset, "camera.preset"),
    cameraDeadZoneWidth: nonNegativeNumber(
      cameraDeadZone.width,
      "camera.deadZone.width",
      DEFAULT_SHOOTER_GAME_SPEC.cameraDeadZoneWidth,
    ),
    cameraDeadZoneHeight: nonNegativeNumber(
      cameraDeadZone.height,
      "camera.deadZone.height",
      DEFAULT_SHOOTER_GAME_SPEC.cameraDeadZoneHeight,
    ),
    cameraLookAheadDistance: nonNegativeNumber(
      cameraLookAhead.distance,
      "camera.lookAhead.distance",
      DEFAULT_SHOOTER_GAME_SPEC.cameraLookAheadDistance,
    ),
    cameraShakeAmplitude: nonNegativeNumber(
      cameraShake.amplitude,
      "camera.shake.amplitude",
      DEFAULT_SHOOTER_GAME_SPEC.cameraShakeAmplitude,
    ),
    cameraShakeFrequency: positiveNumber(
      cameraShake.frequency,
      "camera.shake.frequency",
      DEFAULT_SHOOTER_GAME_SPEC.cameraShakeFrequency,
    ),
    atlasFrames,
    ...(playerAtlasFrame ? { playerAtlasFrame } : {}),
    ...(enemyAtlasFrame ? { enemyAtlasFrame } : {}),
    ...(bulletAtlasFrame ? { bulletAtlasFrame } : {}),
    ...(tilemap ? { tilemap } : {}),
    waves,
    audioMasterVolume: nonNegativeNumber(
      audio.masterVolume,
      "audio.masterVolume",
      DEFAULT_SHOOTER_GAME_SPEC.audioMasterVolume,
    ),
    audioSfxVolume: nonNegativeNumber(audio.sfxVolume, "audio.sfxVolume", DEFAULT_SHOOTER_GAME_SPEC.audioSfxVolume),
    shootVolume: shootAudio.volume,
    shootPitch: shootAudio.pitch,
    hitVolume: hitAudio.volume,
    hitPitch: hitAudio.pitch,
    gameOverVolume: gameOverAudio.volume,
    gameOverPitch: gameOverAudio.pitch,
  };
}

export function applyShooterGameSpec(
  engine: ShooterGameSpecTarget,
  input: unknown,
  options: ApplyShooterGameSpecOptions = {},
): ResolvedShooterGameSpec {
  const spec = resolveShooterGameSpec(input);
  const atlasFrames = [
    atlasFrameApplication(0, spec.playerAtlasFrame, options, "prefabs.player.frame"),
    atlasFrameApplication(1, spec.enemyAtlasFrame, options, "prefabs.enemy.frame"),
    atlasFrameApplication(2, spec.bulletAtlasFrame, options, "prefabs.bullet.frame"),
  ].filter((frame): frame is ResolvedAtlasFrameApplication => frame !== undefined);
  const tilemap = tilemapApplication(spec.tilemap, options);
  engine.set_shooter_resolved_config(
    spec.worldWidth,
    spec.worldHeight,
    spec.playerSpeed,
    spec.enemySpeed,
    spec.enemySpawnInterval,
    spec.bulletSpeed,
    spec.fireCooldown,
    spec.bulletLifetime,
    spec.playerWidth,
    spec.playerHeight,
    spec.enemyWidth,
    spec.enemyHeight,
    spec.bulletWidth,
    spec.bulletHeight,
    spec.playerAnimationFrames,
    spec.playerAnimationFps,
    spec.enemyAnimationFrames,
    spec.enemyAnimationFps,
    spec.bulletAnimationFrames,
    spec.bulletAnimationFps,
    spec.enemyBehaviorCode,
    spec.enemySpawnPatternCode,
    spec.enemyHealth,
    spec.bulletDamage,
    spec.scoreReward,
  );
  engine.set_shooter_animations?.(
    spec.playerAnimationColumns,
    spec.playerAnimationRows,
    spec.playerAnimationIdleRow,
    spec.playerAnimationIdleFrames,
    spec.playerAnimationIdleFps,
    spec.playerAnimationMoveRow,
    spec.playerAnimationMoveFrames,
    spec.playerAnimationMoveFps,
    spec.enemyAnimationColumns,
    spec.enemyAnimationRows,
    spec.enemyAnimationIdleRow,
    spec.enemyAnimationIdleFrames,
    spec.enemyAnimationIdleFps,
    spec.enemyAnimationMoveRow,
    spec.enemyAnimationMoveFrames,
    spec.enemyAnimationMoveFps,
    spec.bulletAnimationColumns,
    spec.bulletAnimationRows,
    spec.bulletAnimationIdleRow,
    spec.bulletAnimationIdleFrames,
    spec.bulletAnimationIdleFps,
    spec.bulletAnimationMoveRow,
    spec.bulletAnimationMoveFrames,
    spec.bulletAnimationMoveFps,
  );
  engine.set_shooter_camera_preset?.(
    spec.cameraPresetCode,
    spec.cameraDeadZoneWidth,
    spec.cameraDeadZoneHeight,
    spec.cameraLookAheadDistance,
    spec.cameraShakeAmplitude,
    spec.cameraShakeFrequency,
  );
  engine.set_shooter_audio_policy?.(
    spec.shootVolume,
    spec.shootPitch,
    spec.hitVolume,
    spec.hitPitch,
    spec.gameOverVolume,
    spec.gameOverPitch,
  );
  engine.clear_shooter_tilemap?.();
  for (const tile of tilemap.tiles) {
    applyTileDefinition(engine, tile);
  }
  for (const layer of tilemap.layers) {
    engine.set_shooter_tilemap_layer?.(
      layer.index,
      layer.columns,
      layer.rows,
      layer.tileWidth,
      layer.tileHeight,
      layer.originX,
      layer.originY,
      layer.collision,
      Uint32Array.from(layer.data),
    );
  }
  engine.clear_shooter_waves?.();
  for (const wave of spec.waves) {
    engine.set_shooter_wave?.(
      wave.index,
      wave.duration,
      wave.spawnInterval,
      wave.enemyCount,
      wave.enemySpeed,
      wave.enemyBehaviorCode,
      wave.enemySpawnPatternCode,
      wave.enemyHealth,
      wave.scoreReward,
    );
  }
  for (const frame of atlasFrames) {
    applyAtlasFrame(engine, frame);
  }
  return spec;
}

function optionalObject(value: unknown, path: string): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  if (isObject(value)) {
    return value;
  }
  throw gameSpecError(path, "must be an object");
}

function positiveNumber(value: unknown, path: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  throw gameSpecError(path, "must be a positive finite number");
}

function requiredPositiveNumber(value: unknown, path: string): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  throw gameSpecError(path, "must be a positive finite number");
}

function positiveInteger(value: unknown, path: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  throw gameSpecError(path, "must be a positive integer");
}

function requiredPositiveInteger(value: unknown, path: string): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  throw gameSpecError(path, "must be a positive integer");
}

function nonNegativeNumber(value: unknown, path: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  throw gameSpecError(path, "must be a non-negative finite number");
}

function nonNegativeInteger(value: unknown, path: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  throw gameSpecError(path, "must be a non-negative integer");
}

function finiteNumber(value: unknown, path: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  throw gameSpecError(path, "must be a finite number");
}

function atlasFrameMap(value: unknown, path: string): Record<string, ResolvedShooterAtlasFrame> {
  const atlas = optionalObject(value, path);
  const frames = optionalObject(atlas.frames, `${path}.frames`);
  const resolved: Record<string, ResolvedShooterAtlasFrame> = {};

  for (const [name, frameValue] of Object.entries(frames)) {
    const framePath = `${path}.frames.${name}`;
    if (name.trim().length === 0) {
      throw gameSpecError(framePath, "frame name must be a non-empty string");
    }
    const frame = optionalObject(frameValue, framePath);
    const uv = optionalObject(frame.uv, `${framePath}.uv`);
    const size = optionalObject(frame.size, `${framePath}.size`);
    const u0 = normalizedNumber(uv.u0, `${framePath}.uv.u0`);
    const v0 = normalizedNumber(uv.v0, `${framePath}.uv.v0`);
    const u1 = normalizedNumber(uv.u1, `${framePath}.uv.u1`);
    const v1 = normalizedNumber(uv.v1, `${framePath}.uv.v1`);
    if (u1 <= u0) {
      throw gameSpecError(`${framePath}.uv.u1`, "must be greater than uv.u0");
    }
    if (v1 <= v0) {
      throw gameSpecError(`${framePath}.uv.v1`, "must be greater than uv.v0");
    }

    resolved[name] = {
      name,
      texture: atlasTexture(frame.texture, `${framePath}.texture`),
      width: requiredPositiveNumber(size.width, `${framePath}.size.width`),
      height: requiredPositiveNumber(size.height, `${framePath}.size.height`),
      u0,
      v0,
      u1,
      v1,
    };
  }

  return resolved;
}

function prefabAtlasFrame(
  value: unknown,
  animation: unknown,
  path: string,
  atlasFrames: Record<string, ResolvedShooterAtlasFrame>,
): ResolvedShooterAtlasFrame | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (animation !== undefined) {
    throw gameSpecError(`${path}.frame`, "cannot be combined with animation");
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw gameSpecError(`${path}.frame`, "must be a non-empty atlas frame name");
  }

  const frameName = value.trim();
  const frame = atlasFrames[frameName];
  if (!frame) {
    throw gameSpecError(`${path}.frame`, "must reference a frame in atlas.frames");
  }
  return frame;
}

function normalizedNumber(value: unknown, path: string): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1) {
    return value;
  }
  throw gameSpecError(path, "must be a finite number between 0 and 1");
}

function atlasTexture(value: unknown, path: string): string | number {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  throw gameSpecError(path, "must be a non-empty texture name or non-negative integer texture id");
}

interface ResolvedAtlasFrameApplication {
  prefab: number;
  textureId: number;
  frame: ResolvedShooterAtlasFrame;
}

function atlasFrameApplication(
  prefab: number,
  frame: ResolvedShooterAtlasFrame | undefined,
  options: ApplyShooterGameSpecOptions,
  path: string,
): ResolvedAtlasFrameApplication | undefined {
  if (!frame) {
    return undefined;
  }
  return {
    prefab,
    textureId: atlasTextureId(frame.texture, options, path),
    frame,
  };
}

function applyAtlasFrame(
  engine: ShooterGameSpecTarget,
  application: ResolvedAtlasFrameApplication,
): void {
  const { frame } = application;
  engine.set_shooter_atlas_frame?.(
    application.prefab,
    application.textureId,
    frame.width,
    frame.height,
    frame.u0,
    frame.v0,
    frame.u1,
    frame.v1,
  );
}

function atlasTextureId(
  texture: string | number,
  options: ApplyShooterGameSpecOptions,
  path: string,
): number {
  if (typeof texture === "number") {
    return texture;
  }
  if (!options.textureId) {
    throw gameSpecError(path, "requires a textureId resolver when atlas frame texture is a name");
  }
  const textureId = options.textureId(texture);
  if (Number.isInteger(textureId) && textureId >= 0) {
    return textureId;
  }
  throw gameSpecError(path, "textureId resolver must return a non-negative integer");
}

function shooterTilemap(
  value: unknown,
  path: string,
  atlasFrames: Record<string, ResolvedShooterAtlasFrame>,
): ResolvedShooterTilemap | undefined {
  if (value === undefined) {
    return undefined;
  }

  const tilemap = optionalObject(value, path);
  const origin = optionalObject(tilemap.origin, `${path}.origin`);
  const tileWidth = positiveNumber(tilemap.tileWidth, `${path}.tileWidth`, 32);
  const tileHeight = positiveNumber(tilemap.tileHeight, `${path}.tileHeight`, 32);
  const originX = finiteNumber(origin.x, `${path}.origin.x`, 0);
  const originY = finiteNumber(origin.y, `${path}.origin.y`, 0);
  const tiles = tileDefinitions(tilemap.tiles, `${path}.tiles`, atlasFrames);
  const tileIds = new Set(tiles.map((tile) => tile.id));
  const layers = tilemapLayers(tilemap.layers, `${path}.layers`, {
    tileWidth,
    tileHeight,
    originX,
    originY,
    tileIds,
  });

  return { tiles, layers };
}

function tileDefinitions(
  value: unknown,
  path: string,
  atlasFrames: Record<string, ResolvedShooterAtlasFrame>,
): ResolvedShooterTileDefinition[] {
  const tiles = optionalObject(value, path);
  const resolved: ResolvedShooterTileDefinition[] = [];

  for (const [idText, tileValue] of Object.entries(tiles)) {
    const tilePath = `${path}.${idText}`;
    const id = tileId(idText, tilePath);
    const tile = optionalObject(tileValue, tilePath);
    resolved.push({
      id,
      frame: atlasFrameReference(tile.frame, `${tilePath}.frame`, atlasFrames),
      color: tileColor(tile.color, `${tilePath}.color`),
    });
  }

  return resolved.sort((a, b) => a.id - b.id);
}

function tileId(value: string, path: string): number {
  if (/^[1-9]\d*$/.test(value)) {
    const id = Number(value);
    if (Number.isSafeInteger(id)) {
      return id;
    }
  }
  throw gameSpecError(path, "tile id must be a positive integer string");
}

function atlasFrameReference(
  value: unknown,
  path: string,
  atlasFrames: Record<string, ResolvedShooterAtlasFrame>,
): ResolvedShooterAtlasFrame {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw gameSpecError(path, "must be a non-empty atlas frame name");
  }
  const frameName = value.trim();
  const frame = atlasFrames[frameName];
  if (!frame) {
    throw gameSpecError(path, "must reference a frame in atlas.frames");
  }
  return frame;
}

function tileColor(value: unknown, path: string): [number, number, number, number] {
  if (value === undefined) {
    return [1, 1, 1, 1];
  }
  if (!Array.isArray(value) || value.length !== 4) {
    throw gameSpecError(path, "must be an array of four normalized numbers");
  }
  return [
    normalizedNumber(value[0], `${path}.0`),
    normalizedNumber(value[1], `${path}.1`),
    normalizedNumber(value[2], `${path}.2`),
    normalizedNumber(value[3], `${path}.3`),
  ];
}

interface TilemapLayerDefaults {
  tileWidth: number;
  tileHeight: number;
  originX: number;
  originY: number;
  tileIds: Set<number>;
}

function tilemapLayers(
  value: unknown,
  path: string,
  defaults: TilemapLayerDefaults,
): ResolvedShooterTileLayer[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw gameSpecError(path, "must be an array");
  }

  return value.map((layerValue, index) => {
    const layerPath = `${path}.${index}`;
    const layer = optionalObject(layerValue, layerPath);
    const origin = optionalObject(layer.origin, `${layerPath}.origin`);
    const columns = requiredPositiveInteger(layer.columns, `${layerPath}.columns`);
    const rows = requiredPositiveInteger(layer.rows, `${layerPath}.rows`);
    return {
      index,
      name: layerName(layer.name, `${layerPath}.name`, `layer-${index}`),
      columns,
      rows,
      tileWidth: positiveNumber(layer.tileWidth, `${layerPath}.tileWidth`, defaults.tileWidth),
      tileHeight: positiveNumber(layer.tileHeight, `${layerPath}.tileHeight`, defaults.tileHeight),
      originX: finiteNumber(origin.x, `${layerPath}.origin.x`, defaults.originX),
      originY: finiteNumber(origin.y, `${layerPath}.origin.y`, defaults.originY),
      collision: booleanValue(layer.collision, `${layerPath}.collision`, false),
      data: tilemapLayerData(layer.data, `${layerPath}.data`, columns * rows, defaults.tileIds),
    };
  });
}

function booleanValue(value: unknown, path: string, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  throw gameSpecError(path, "must be a boolean");
}

function layerName(value: unknown, path: string, fallback: string): string {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  throw gameSpecError(path, "must be a non-empty string");
}

function tilemapLayerData(value: unknown, path: string, expectedLength: number, tileIds: Set<number>): number[] {
  if (!Array.isArray(value)) {
    throw gameSpecError(path, "must be an array");
  }
  if (value.length !== expectedLength) {
    throw gameSpecError(path, `must contain exactly ${expectedLength} tile ids`);
  }
  return value.map((tileValue, index) => {
    const tile = nonNegativeInteger(tileValue, `${path}.${index}`, 0);
    if (tile !== 0 && !tileIds.has(tile)) {
      throw gameSpecError(`${path}.${index}`, "must reference a tile id in tilemap.tiles or be 0");
    }
    return tile;
  });
}

interface ResolvedTileDefinitionApplication {
  id: number;
  textureId: number;
  frame: ResolvedShooterAtlasFrame;
  color: [number, number, number, number];
}

interface ResolvedTilemapApplication {
  tiles: ResolvedTileDefinitionApplication[];
  layers: ResolvedShooterTileLayer[];
}

function tilemapApplication(
  tilemap: ResolvedShooterTilemap | undefined,
  options: ApplyShooterGameSpecOptions,
): ResolvedTilemapApplication {
  if (!tilemap) {
    return { tiles: [], layers: [] };
  }
  return {
    tiles: tilemap.tiles.map((tile) => ({
      id: tile.id,
      textureId: atlasTextureId(tile.frame.texture, options, `tilemap.tiles.${tile.id}.frame`),
      frame: tile.frame,
      color: tile.color,
    })),
    layers: tilemap.layers,
  };
}

function applyTileDefinition(engine: ShooterGameSpecTarget, application: ResolvedTileDefinitionApplication): void {
  const { frame, color } = application;
  engine.set_shooter_tile?.(
    application.id,
    application.textureId,
    frame.u0,
    frame.v0,
    frame.u1,
    frame.v1,
    color[0],
    color[1],
    color[2],
    color[3],
  );
}

interface ResolvedSpriteAnimation {
  frames: number;
  fps: number;
  columns: number;
  rows: number;
  idleRow: number;
  idleFrames: number;
  idleFps: number;
  moveRow: number;
  moveFrames: number;
  moveFps: number;
}

function spriteAnimation(value: unknown, path: string): ResolvedSpriteAnimation {
  if (value === undefined) {
    return {
      frames: 1,
      fps: 0,
      columns: 1,
      rows: 1,
      idleRow: 0,
      idleFrames: 1,
      idleFps: 1,
      moveRow: 0,
      moveFrames: 1,
      moveFps: 1,
    };
  }

  const animation = optionalObject(value, path);
  if (animation.states !== undefined) {
    return spriteAnimationStates(animation, path);
  }

  const frames = positiveInteger(animation.frames, `${path}.frames`, 1);
  const fps = positiveNumber(animation.fps, `${path}.fps`, 1);
  if (frames > 1 && animation.fps === undefined) {
    throw gameSpecError(`${path}.fps`, "must be provided when frames is greater than 1");
  }
  return {
    frames,
    fps: frames > 1 ? fps : 0,
    columns: frames,
    rows: 1,
    idleRow: 0,
    idleFrames: frames,
    idleFps: fps,
    moveRow: 0,
    moveFrames: frames,
    moveFps: fps,
  };
}

function spriteAnimationStates(animation: Record<string, unknown>, path: string): ResolvedSpriteAnimation {
  if (animation.columns === undefined) {
    throw gameSpecError(`${path}.columns`, "must be provided when animation states are used");
  }
  if (animation.rows === undefined) {
    throw gameSpecError(`${path}.rows`, "must be provided when animation states are used");
  }
  const columns = positiveInteger(animation.columns, `${path}.columns`, 1);
  const rows = positiveInteger(animation.rows, `${path}.rows`, 1);
  const states = optionalObject(animation.states, `${path}.states`);
  const idle = spriteAnimationState(states.idle, `${path}.states.idle`, columns, rows);
  const move = spriteAnimationState(states.move, `${path}.states.move`, columns, rows, idle);

  return {
    frames: idle.frames,
    fps: idle.fps,
    columns,
    rows,
    idleRow: idle.row,
    idleFrames: idle.frames,
    idleFps: idle.fps,
    moveRow: move.row,
    moveFrames: move.frames,
    moveFps: move.fps,
  };
}

function spriteAnimationState(
  value: unknown,
  path: string,
  columns: number,
  rows: number,
  fallback?: { row: number; frames: number; fps: number },
): { row: number; frames: number; fps: number } {
  if (value === undefined) {
    if (fallback) {
      return fallback;
    }
    throw gameSpecError(path, "must be provided when animation states are used");
  }

  const state = optionalObject(value, path);
  const row = nonNegativeInteger(state.row, `${path}.row`, 0);
  const frames = positiveInteger(state.frames, `${path}.frames`, 1);
  const fps = positiveNumber(state.fps, `${path}.fps`, 1);
  if (row >= rows) {
    throw gameSpecError(`${path}.row`, "must be less than animation rows");
  }
  if (frames > columns) {
    throw gameSpecError(`${path}.frames`, "must be less than or equal to animation columns");
  }
  return { row, frames, fps };
}

interface ResolvedEnemyPreset {
  speed: number;
  spawnInterval: number;
  behavior: ShooterEnemyBehaviorPreset;
  behaviorCode: number;
  spawnPattern: ShooterEnemySpawnPatternPreset;
  spawnPatternCode: number;
  health: number;
  scoreReward: number;
}

function shooterWaves(enemies: Record<string, unknown>, basePreset: ResolvedEnemyPreset): ResolvedShooterWave[] {
  if (enemies.waves === undefined) {
    return [];
  }
  if (!Array.isArray(enemies.waves)) {
    throw gameSpecError("enemies.waves", "must be an array");
  }

  const presets = enemyPresetMap(enemies.presets, basePreset);
  return enemies.waves.map((value, index) => {
    const path = `enemies.waves.${index}`;
    const wave = optionalObject(value, path);
    const enemy = waveEnemyName(wave.enemy, `${path}.enemy`);
    const preset = presets[enemy];
    if (!preset) {
      throw gameSpecError(`${path}.enemy`, "must reference an enemy preset");
    }
    const spawnPattern =
      wave.spawnPattern === undefined
        ? { enemySpawnPattern: preset.spawnPattern, enemySpawnPatternCode: preset.spawnPatternCode }
        : enemySpawnPattern(wave.spawnPattern, `${path}.spawnPattern`);

    return {
      index,
      enemy,
      duration: positiveNumber(wave.duration, `${path}.duration`, 20),
      spawnInterval: positiveNumber(wave.spawnInterval, `${path}.spawnInterval`, preset.spawnInterval),
      enemyCount: positiveInteger(wave.enemyCount, `${path}.enemyCount`, 12),
      enemySpeed: preset.speed,
      enemyBehavior: preset.behavior,
      enemyBehaviorCode: preset.behaviorCode,
      enemySpawnPattern: spawnPattern.enemySpawnPattern,
      enemySpawnPatternCode: spawnPattern.enemySpawnPatternCode,
      enemyHealth: preset.health,
      scoreReward: preset.scoreReward,
    };
  });
}

function enemyPresetMap(value: unknown, basePreset: ResolvedEnemyPreset): Record<string, ResolvedEnemyPreset> {
  const presets = optionalObject(value, "enemies.presets");
  const resolved: Record<string, ResolvedEnemyPreset> = { default: basePreset };

  for (const [name, presetValue] of Object.entries(presets)) {
    const trimmedName = name.trim();
    const path = `enemies.presets.${name}`;
    if (trimmedName.length === 0) {
      throw gameSpecError(path, "preset name must be a non-empty string");
    }
    const preset = optionalObject(presetValue, path);
    const behavior =
      preset.behavior === undefined
        ? { enemyBehavior: basePreset.behavior, enemyBehaviorCode: basePreset.behaviorCode }
        : enemyBehavior(preset.behavior, `${path}.behavior`);
    const spawnPattern =
      preset.spawnPattern === undefined
        ? { enemySpawnPattern: basePreset.spawnPattern, enemySpawnPatternCode: basePreset.spawnPatternCode }
        : enemySpawnPattern(preset.spawnPattern, `${path}.spawnPattern`);

    resolved[trimmedName] = {
      speed: positiveNumber(preset.speed, `${path}.speed`, basePreset.speed),
      spawnInterval: basePreset.spawnInterval,
      behavior: behavior.enemyBehavior,
      behaviorCode: behavior.enemyBehaviorCode,
      spawnPattern: spawnPattern.enemySpawnPattern,
      spawnPatternCode: spawnPattern.enemySpawnPatternCode,
      health: positiveNumber(preset.health, `${path}.health`, basePreset.health),
      scoreReward: positiveInteger(preset.scoreReward, `${path}.scoreReward`, basePreset.scoreReward),
    };
  }

  return resolved;
}

function waveEnemyName(value: unknown, path: string): string {
  if (value === undefined) {
    return "default";
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  throw gameSpecError(path, "must be a non-empty enemy preset name");
}

function enemyBehavior(
  value: unknown,
  path: string,
): Pick<ResolvedShooterGameSpec, "enemyBehavior" | "enemyBehaviorCode"> {
  if (value === undefined) {
    return {
      enemyBehavior: DEFAULT_SHOOTER_GAME_SPEC.enemyBehavior,
      enemyBehaviorCode: DEFAULT_SHOOTER_GAME_SPEC.enemyBehaviorCode,
    };
  }
  if (value === "chase") {
    return { enemyBehavior: value, enemyBehaviorCode: 0 };
  }
  if (value === "drift") {
    return { enemyBehavior: value, enemyBehaviorCode: 1 };
  }
  if (value === "static") {
    return { enemyBehavior: value, enemyBehaviorCode: 2 };
  }
  throw gameSpecError(path, "must be one of chase, drift, static");
}

function enemySpawnPattern(
  value: unknown,
  path: string,
): Pick<ResolvedShooterGameSpec, "enemySpawnPattern" | "enemySpawnPatternCode"> {
  if (value === undefined) {
    return {
      enemySpawnPattern: DEFAULT_SHOOTER_GAME_SPEC.enemySpawnPattern,
      enemySpawnPatternCode: DEFAULT_SHOOTER_GAME_SPEC.enemySpawnPatternCode,
    };
  }
  if (value === "edge") {
    return { enemySpawnPattern: value, enemySpawnPatternCode: 0 };
  }
  if (value === "corners") {
    return { enemySpawnPattern: value, enemySpawnPatternCode: 1 };
  }
  if (value === "center") {
    return { enemySpawnPattern: value, enemySpawnPatternCode: 2 };
  }
  throw gameSpecError(path, "must be one of edge, corners, center");
}

function cameraPreset(
  value: unknown,
  path: string,
): Pick<ResolvedShooterGameSpec, "cameraPreset" | "cameraPresetCode"> {
  if (value === undefined) {
    return {
      cameraPreset: DEFAULT_SHOOTER_GAME_SPEC.cameraPreset,
      cameraPresetCode: DEFAULT_SHOOTER_GAME_SPEC.cameraPresetCode,
    };
  }
  if (value === "follow") {
    return { cameraPreset: value, cameraPresetCode: 0 };
  }
  if (value === "dead-zone") {
    return { cameraPreset: value, cameraPresetCode: 1 };
  }
  if (value === "look-ahead") {
    return { cameraPreset: value, cameraPresetCode: 2 };
  }
  if (value === "shake") {
    return { cameraPreset: value, cameraPresetCode: 3 };
  }
  throw gameSpecError(path, "must be one of follow, dead-zone, look-ahead, shake");
}

function audioEventPolicy(
  value: unknown,
  path: string,
  fallback: { volume: number; pitch: number },
): { volume: number; pitch: number } {
  const policy = optionalObject(value, path);
  return {
    volume: nonNegativeNumber(policy.volume, `${path}.volume`, fallback.volume),
    pitch: positiveNumber(policy.pitch, `${path}.pitch`, fallback.pitch),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function gameSpecError(path: string, detail: string): Error {
  return gameSpecDiagnosticError(path, detail);
}
