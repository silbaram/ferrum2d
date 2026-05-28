import { resolvePostProcessPasses } from "./cameraPostProcessing.js";
import type { PostProcessStackInput } from "./cameraPostProcessing.js";
import { resolvePhysicsSpec } from "./physicsSpec.js";
import { DEFAULT_SHOOTER_GAME_SPEC } from "./gameSpecDefaults.js";
import {
  atlasFrameMap,
  prefabAtlasAnimation,
  prefabAtlasFrame,
} from "./gameSpecAtlas.js";
import { prefabCollider } from "./gameSpecPrefab.js";
import { shooterTilemap } from "./gameSpecTilemap.js";
import {
  gameSpecError,
  nonNegativeInteger,
  nonNegativeNumber,
  optionalObject,
  positiveInteger,
  positiveNumber,
} from "./gameSpecValidation.js";
import type {
  ResolveShooterGameSpecOptions,
  ResolvedShooterGameSpec,
  ResolvedShooterWave,
  ShooterEnemyBehaviorPreset,
  ShooterEnemySpawnPatternPreset,
} from "./gameSpecTypes.js";

export function resolveShooterGameSpec(
  input: unknown,
  options: ResolveShooterGameSpecOptions = {},
): ResolvedShooterGameSpec {
  const spec = optionalObject(input, "game spec");
  const world = optionalObject(spec.world, "world");
  const player = optionalObject(spec.player, "player");
  const enemies = optionalObject(spec.enemies, "enemies");
  const enemyOrbit = optionalObject(enemies.orbit, "enemies.orbit");
  const weapons = optionalObject(spec.weapons, "weapons");
  const prefabs = optionalObject(spec.prefabs, "prefabs");
  const atlasFrames = atlasFrameMap(spec.atlas, "atlas");
  const tilemap = shooterTilemap(spec.tilemap, "tilemap", atlasFrames);
  const camera = optionalObject(spec.camera, "camera");
  const postProcessing = resolvePostProcessPasses(
    spec.postProcessing as PostProcessStackInput,
    { path: "postProcessing" },
  );
  const audio = optionalObject(spec.audio, "audio");
  const physics = resolvePhysicsSpec(spec.physics, {
    path: "physics",
    modeOverride: options.physicsModeOverride,
  });
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
  const playerAtlasAnimation = prefabAtlasAnimation(
    playerPrefab.animation,
    "prefabs.player.animation",
    atlasFrames,
  );
  const enemyAtlasAnimation = prefabAtlasAnimation(
    enemyPrefab.animation,
    "prefabs.enemy.animation",
    atlasFrames,
  );
  const bulletAtlasAnimation = prefabAtlasAnimation(
    bulletPrefab.animation,
    "prefabs.bullet.animation",
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
  const orbitRadius = positiveNumber(
    enemyOrbit.radius,
    "enemies.orbit.radius",
    DEFAULT_SHOOTER_GAME_SPEC.orbitRadius,
  );
  const orbitRadialBand = nonNegativeNumber(
    enemyOrbit.radialBand,
    "enemies.orbit.radialBand",
    DEFAULT_SHOOTER_GAME_SPEC.orbitRadialBand,
  );
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
  const playerWidth = positiveNumber(
    playerPrefab.width,
    "prefabs.player.width",
    playerAtlasFrame?.width ?? playerAtlasAnimation?.width ?? DEFAULT_SHOOTER_GAME_SPEC.playerWidth,
  );
  const playerHeight = positiveNumber(
    playerPrefab.height,
    "prefabs.player.height",
    playerAtlasFrame?.height ?? playerAtlasAnimation?.height ?? DEFAULT_SHOOTER_GAME_SPEC.playerHeight,
  );
  const enemyWidth = positiveNumber(
    enemyPrefab.width,
    "prefabs.enemy.width",
    enemyAtlasFrame?.width ?? enemyAtlasAnimation?.width ?? DEFAULT_SHOOTER_GAME_SPEC.enemyWidth,
  );
  const enemyHeight = positiveNumber(
    enemyPrefab.height,
    "prefabs.enemy.height",
    enemyAtlasFrame?.height ?? enemyAtlasAnimation?.height ?? DEFAULT_SHOOTER_GAME_SPEC.enemyHeight,
  );
  const bulletWidth = positiveNumber(
    bulletPrefab.width,
    "prefabs.bullet.width",
    bulletAtlasFrame?.width ?? bulletAtlasAnimation?.width ?? DEFAULT_SHOOTER_GAME_SPEC.bulletWidth,
  );
  const bulletHeight = positiveNumber(
    bulletPrefab.height,
    "prefabs.bullet.height",
    bulletAtlasFrame?.height ?? bulletAtlasAnimation?.height ?? DEFAULT_SHOOTER_GAME_SPEC.bulletHeight,
  );
  const playerCollider = prefabCollider(
    playerPrefab.collider,
    "prefabs.player.collider",
    playerWidth,
    playerHeight,
  );
  const enemyCollider = prefabCollider(
    enemyPrefab.collider,
    "prefabs.enemy.collider",
    enemyWidth,
    enemyHeight,
  );
  const bulletCollider = prefabCollider(
    bulletPrefab.collider,
    "prefabs.bullet.collider",
    bulletWidth,
    bulletHeight,
  );

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
    playerWidth,
    playerHeight,
    enemyWidth,
    enemyHeight,
    bulletWidth,
    bulletHeight,
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
    orbitRadius,
    orbitRadialBand,
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
    ...(playerAtlasAnimation ? { playerAtlasAnimation } : {}),
    ...(enemyAtlasAnimation ? { enemyAtlasAnimation } : {}),
    ...(bulletAtlasAnimation ? { bulletAtlasAnimation } : {}),
    playerCollider,
    enemyCollider,
    bulletCollider,
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
    postProcessing,
    physics,
  };
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
  if (value === "orbit") {
    return { enemyBehavior: value, enemyBehaviorCode: 3 };
  }
  throw gameSpecError(path, "must be one of chase, drift, static, orbit");
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
