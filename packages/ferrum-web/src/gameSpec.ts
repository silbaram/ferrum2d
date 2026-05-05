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
}

export interface ShooterPrefabSpec {
  width?: number;
  height?: number;
}

export type ShooterEnemyBehaviorPreset = "chase" | "drift" | "static";
export type ShooterEnemySpawnPatternPreset = "edge" | "corners" | "center";

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
  enemyBehavior: ShooterEnemyBehaviorPreset;
  enemyBehaviorCode: number;
  enemySpawnPattern: ShooterEnemySpawnPatternPreset;
  enemySpawnPatternCode: number;
  enemyHealth: number;
  bulletDamage: number;
  scoreReward: number;
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
    enemyBehavior: number,
    enemySpawnPattern: number,
    enemyHealth: number,
    bulletDamage: number,
    scoreReward: number,
  ): void;
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
  enemyBehavior: "chase",
  enemyBehaviorCode: 0,
  enemySpawnPattern: "edge",
  enemySpawnPatternCode: 0,
  enemyHealth: 1,
  bulletDamage: 1,
  scoreReward: 1,
};

export function resolveShooterGameSpec(input: unknown): ResolvedShooterGameSpec {
  const spec = optionalObject(input, "game spec");
  const world = optionalObject(spec.world, "world");
  const player = optionalObject(spec.player, "player");
  const enemies = optionalObject(spec.enemies, "enemies");
  const weapons = optionalObject(spec.weapons, "weapons");
  const prefabs = optionalObject(spec.prefabs, "prefabs");
  const playerPrefab = optionalObject(prefabs.player, "prefabs.player");
  const enemyPrefab = optionalObject(prefabs.enemy, "prefabs.enemy");
  const bulletPrefab = optionalObject(prefabs.bullet, "prefabs.bullet");

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
    playerWidth: positiveNumber(playerPrefab.width, "prefabs.player.width", DEFAULT_SHOOTER_GAME_SPEC.playerWidth),
    playerHeight: positiveNumber(playerPrefab.height, "prefabs.player.height", DEFAULT_SHOOTER_GAME_SPEC.playerHeight),
    enemyWidth: positiveNumber(enemyPrefab.width, "prefabs.enemy.width", DEFAULT_SHOOTER_GAME_SPEC.enemyWidth),
    enemyHeight: positiveNumber(enemyPrefab.height, "prefabs.enemy.height", DEFAULT_SHOOTER_GAME_SPEC.enemyHeight),
    bulletWidth: positiveNumber(bulletPrefab.width, "prefabs.bullet.width", DEFAULT_SHOOTER_GAME_SPEC.bulletWidth),
    bulletHeight: positiveNumber(bulletPrefab.height, "prefabs.bullet.height", DEFAULT_SHOOTER_GAME_SPEC.bulletHeight),
    ...enemyBehavior(enemies.behavior, "enemies.behavior"),
    ...enemySpawnPattern(enemies.spawnPattern, "enemies.spawnPattern"),
    enemyHealth: positiveNumber(enemies.health, "enemies.health", DEFAULT_SHOOTER_GAME_SPEC.enemyHealth),
    bulletDamage: positiveNumber(weapons.damage, "weapons.damage", DEFAULT_SHOOTER_GAME_SPEC.bulletDamage),
    scoreReward: positiveInteger(enemies.scoreReward, "enemies.scoreReward", DEFAULT_SHOOTER_GAME_SPEC.scoreReward),
  };
}

export function applyShooterGameSpec(engine: ShooterGameSpecTarget, input: unknown): ResolvedShooterGameSpec {
  const spec = resolveShooterGameSpec(input);
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
    spec.enemyBehaviorCode,
    spec.enemySpawnPatternCode,
    spec.enemyHealth,
    spec.bulletDamage,
    spec.scoreReward,
  );
  return spec;
}

function optionalObject(value: unknown, path: string): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  if (isObject(value)) {
    return value;
  }
  throw new Error(`Invalid shooter game spec: '${path}' must be an object.`);
}

function positiveNumber(value: unknown, path: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  throw new Error(`Invalid shooter game spec: '${path}' must be a positive finite number.`);
}

function positiveInteger(value: unknown, path: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  throw new Error(`Invalid shooter game spec: '${path}' must be a positive integer.`);
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
  throw new Error(`Invalid shooter game spec: '${path}' must be one of chase, drift, static.`);
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
  throw new Error(`Invalid shooter game spec: '${path}' must be one of edge, corners, center.`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
