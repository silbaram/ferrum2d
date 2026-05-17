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
  camera?: ShooterCameraSpec;
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
};

export function resolveShooterGameSpec(input: unknown): ResolvedShooterGameSpec {
  const spec = optionalObject(input, "game spec");
  const world = optionalObject(spec.world, "world");
  const player = optionalObject(spec.player, "player");
  const enemies = optionalObject(spec.enemies, "enemies");
  const weapons = optionalObject(spec.weapons, "weapons");
  const prefabs = optionalObject(spec.prefabs, "prefabs");
  const atlasFrames = atlasFrameMap(spec.atlas, "atlas");
  const camera = optionalObject(spec.camera, "camera");
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

  return {
    worldWidth: positiveNumber(world.width, "world.width", DEFAULT_SHOOTER_GAME_SPEC.worldWidth),
    worldHeight: positiveNumber(world.height, "world.height", DEFAULT_SHOOTER_GAME_SPEC.worldHeight),
    playerSpeed: positiveNumber(player.speed, "player.speed", DEFAULT_SHOOTER_GAME_SPEC.playerSpeed),
    enemySpeed: positiveNumber(enemies.speed, "enemies.speed", DEFAULT_SHOOTER_GAME_SPEC.enemySpeed),
    enemySpawnInterval: positiveNumber(
      enemies.spawnInterval,
      "enemies.spawnInterval",
      DEFAULT_SHOOTER_GAME_SPEC.enemySpawnInterval,
    ),
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
    ...enemyBehavior(enemies.behavior, "enemies.behavior"),
    ...enemySpawnPattern(enemies.spawnPattern, "enemies.spawnPattern"),
    enemyHealth: positiveNumber(enemies.health, "enemies.health", DEFAULT_SHOOTER_GAME_SPEC.enemyHealth),
    bulletDamage: positiveNumber(weapons.damage, "weapons.damage", DEFAULT_SHOOTER_GAME_SPEC.bulletDamage),
    scoreReward: positiveInteger(enemies.scoreReward, "enemies.scoreReward", DEFAULT_SHOOTER_GAME_SPEC.scoreReward),
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function gameSpecError(path: string, detail: string): Error {
  return gameSpecDiagnosticError(path, detail);
}
