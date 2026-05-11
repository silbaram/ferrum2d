import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { applyShooterGameSpec, resolveShooterGameSpec } from "../src/gameSpec.js";

class FakeEngine {
  resolvedConfig?: number[];
  animationConfig?: number[];

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
  ): void {
    this.resolvedConfig = [
      worldWidth,
      worldHeight,
      playerSpeed,
      enemySpeed,
      enemySpawnInterval,
      bulletSpeed,
      fireCooldown,
      bulletLifetime,
      playerWidth,
      playerHeight,
      enemyWidth,
      enemyHeight,
      bulletWidth,
      bulletHeight,
      playerAnimationFrames,
      playerAnimationFps,
      enemyAnimationFrames,
      enemyAnimationFps,
      bulletAnimationFrames,
      bulletAnimationFps,
      enemyBehavior,
      enemySpawnPattern,
      enemyHealth,
      bulletDamage,
      scoreReward,
    ];
  }

  set_shooter_animations(
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
  ): void {
    this.animationConfig = [
      playerColumns,
      playerRows,
      playerIdleRow,
      playerIdleFrames,
      playerIdleFps,
      playerMoveRow,
      playerMoveFrames,
      playerMoveFps,
      enemyColumns,
      enemyRows,
      enemyIdleRow,
      enemyIdleFrames,
      enemyIdleFps,
      enemyMoveRow,
      enemyMoveFrames,
      enemyMoveFps,
      bulletColumns,
      bulletRows,
      bulletIdleRow,
      bulletIdleFrames,
      bulletIdleFps,
      bulletMoveRow,
      bulletMoveFrames,
      bulletMoveFps,
    ];
  }
}

test("resolveShooterGameSpec fills defaults and accepts overrides", () => {
  deepEqual(resolveShooterGameSpec({
    world: { width: 2400 },
    player: { speed: 220 },
    enemies: { spawnInterval: 0.5, behavior: "drift", spawnPattern: "corners", health: 3, scoreReward: 5 },
    weapons: { bulletSpeed: 500, lifetime: 1.1, damage: 2 },
    prefabs: { enemy: { width: 32, height: 28 } },
  }), {
    worldWidth: 2400,
    worldHeight: 960,
    playerSpeed: 220,
    enemySpeed: 72,
    enemySpawnInterval: 0.5,
    bulletSpeed: 500,
    fireCooldown: 0.12,
    bulletLifetime: 1.1,
    playerWidth: 36,
    playerHeight: 36,
    enemyWidth: 32,
    enemyHeight: 28,
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
    enemyBehavior: "drift",
    enemyBehaviorCode: 1,
    enemySpawnPattern: "corners",
    enemySpawnPatternCode: 1,
    enemyHealth: 3,
    bulletDamage: 2,
    scoreReward: 5,
  });
});

test("resolveShooterGameSpec rejects invalid numbers with path context", () => {
  try {
    resolveShooterGameSpec({ weapons: { cooldown: -1 } });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: 'weapons.cooldown' must be a positive finite number.",
    );
    return;
  }
  throw new Error("Expected invalid spec to throw.");
});

test("resolveShooterGameSpec rejects invalid score reward with path context", () => {
  try {
    resolveShooterGameSpec({ enemies: { scoreReward: 1.5 } });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: 'enemies.scoreReward' must be a positive integer.",
    );
    return;
  }
  throw new Error("Expected invalid score reward to throw.");
});

test("resolveShooterGameSpec rejects invalid prefab dimensions with path context", () => {
  try {
    resolveShooterGameSpec({ prefabs: { enemy: { width: 0 } } });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: 'prefabs.enemy.width' must be a positive finite number.",
    );
    return;
  }
  throw new Error("Expected invalid prefab spec to throw.");
});

test("resolveShooterGameSpec rejects invalid sprite animation with path context", () => {
  try {
    resolveShooterGameSpec({ prefabs: { enemy: { animation: { frames: 1.5 } } } });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: 'prefabs.enemy.animation.frames' must be a positive integer.",
    );
    return;
  }
  throw new Error("Expected invalid animation spec to throw.");
});

test("resolveShooterGameSpec rejects unknown enemy behavior with path context", () => {
  try {
    resolveShooterGameSpec({ enemies: { behavior: "circle" } });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: 'enemies.behavior' must be one of chase, drift, static.",
    );
    return;
  }
  throw new Error("Expected invalid behavior spec to throw.");
});

test("resolveShooterGameSpec rejects unknown spawn pattern with path context", () => {
  try {
    resolveShooterGameSpec({ enemies: { spawnPattern: "spiral" } });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: 'enemies.spawnPattern' must be one of edge, corners, center.",
    );
    return;
  }
  throw new Error("Expected invalid spawn pattern spec to throw.");
});

test("applyShooterGameSpec forwards resolved config to engine", () => {
  const engine = new FakeEngine();

  const spec = applyShooterGameSpec(engine, {
    world: { width: 3200, height: 1800 },
    player: { speed: 240 },
    enemies: {
      speed: 120,
      spawnInterval: 0.75,
      behavior: "static",
      spawnPattern: "center",
      health: 4,
      scoreReward: 9,
    },
    weapons: { bulletSpeed: 640, cooldown: 0.08, lifetime: 2.4, damage: 2 },
    prefabs: {
      player: { width: 40, height: 44 },
      enemy: {
        width: 30,
        height: 34,
        animation: {
          columns: 4,
          rows: 2,
          states: {
            idle: { row: 0, frames: 1, fps: 1 },
            move: { row: 1, frames: 4, fps: 12 },
          },
        },
      },
      bullet: { width: 10, height: 12 },
    },
  });

  deepEqual(spec, {
    worldWidth: 3200,
    worldHeight: 1800,
    playerSpeed: 240,
    enemySpeed: 120,
    enemySpawnInterval: 0.75,
    bulletSpeed: 640,
    fireCooldown: 0.08,
    bulletLifetime: 2.4,
    playerWidth: 40,
    playerHeight: 44,
    enemyWidth: 30,
    enemyHeight: 34,
    bulletWidth: 10,
    bulletHeight: 12,
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
    enemyAnimationFps: 1,
    enemyAnimationColumns: 4,
    enemyAnimationRows: 2,
    enemyAnimationIdleRow: 0,
    enemyAnimationIdleFrames: 1,
    enemyAnimationIdleFps: 1,
    enemyAnimationMoveRow: 1,
    enemyAnimationMoveFrames: 4,
    enemyAnimationMoveFps: 12,
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
    enemyBehavior: "static",
    enemyBehaviorCode: 2,
    enemySpawnPattern: "center",
    enemySpawnPatternCode: 2,
    enemyHealth: 4,
    bulletDamage: 2,
    scoreReward: 9,
  });
  deepEqual(engine.resolvedConfig, [
    3200,
    1800,
    240,
    120,
    0.75,
    640,
    0.08,
    2.4,
    40,
    44,
    30,
    34,
    10,
    12,
    1,
    0,
    1,
    1,
    1,
    0,
    2,
    2,
    4,
    2,
    9,
  ]);
  deepEqual(engine.animationConfig, [
    1,
    1,
    0,
    1,
    1,
    0,
    1,
    1,
    4,
    2,
    0,
    1,
    1,
    1,
    4,
    12,
    1,
    1,
    0,
    1,
    1,
    0,
    1,
    1,
  ]);
});
