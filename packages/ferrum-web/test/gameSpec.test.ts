import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { applyShooterGameSpec, resolveShooterGameSpec } from "../src/gameSpec.js";

class FakeEngine {
  resolvedConfig?: number[];
  animationConfig?: number[];
  cameraConfig?: number[];
  atlasFrames: number[][] = [];

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

  set_shooter_camera_preset(
    preset: number,
    deadZoneWidth: number,
    deadZoneHeight: number,
    lookAheadDistance: number,
    shakeAmplitude: number,
    shakeFrequency: number,
  ): void {
    this.cameraConfig = [
      preset,
      deadZoneWidth,
      deadZoneHeight,
      lookAheadDistance,
      shakeAmplitude,
      shakeFrequency,
    ];
  }

  set_shooter_atlas_frame(
    prefab: number,
    textureId: number,
    width: number,
    height: number,
    u0: number,
    v0: number,
    u1: number,
    v1: number,
  ): void {
    this.atlasFrames.push([prefab, textureId, width, height, u0, v0, u1, v1]);
  }
}

test("resolveShooterGameSpec fills defaults and accepts overrides", () => {
  deepEqual(resolveShooterGameSpec({
    world: { width: 2400 },
    player: { speed: 220 },
    enemies: { spawnInterval: 0.5, behavior: "drift", spawnPattern: "corners", health: 3, scoreReward: 5 },
    weapons: { bulletSpeed: 500, lifetime: 1.1, damage: 2 },
    camera: {
      preset: "look-ahead",
      lookAhead: { distance: 120 },
      deadZone: { width: 200, height: 120 },
      shake: { amplitude: 4, frequency: 6 },
    },
    atlas: {
      frames: {
        "bullet.core": {
          texture: "bullet",
          uv: { u0: 0.25, v0: 0.5, u1: 0.5, v1: 0.75 },
          size: { width: 12, height: 10 },
        },
      },
    },
    prefabs: {
      enemy: { width: 32, height: 28 },
      bullet: { frame: "bullet.core" },
    },
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
    bulletWidth: 12,
    bulletHeight: 10,
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
    cameraPreset: "look-ahead",
    cameraPresetCode: 2,
    cameraDeadZoneWidth: 200,
    cameraDeadZoneHeight: 120,
    cameraLookAheadDistance: 120,
    cameraShakeAmplitude: 4,
    cameraShakeFrequency: 6,
    atlasFrames: {
      "bullet.core": {
        name: "bullet.core",
        texture: "bullet",
        width: 12,
        height: 10,
        u0: 0.25,
        v0: 0.5,
        u1: 0.5,
        v1: 0.75,
      },
    },
    bulletAtlasFrame: {
      name: "bullet.core",
      texture: "bullet",
      width: 12,
      height: 10,
      u0: 0.25,
      v0: 0.5,
      u1: 0.5,
      v1: 0.75,
    },
  });
});

test("resolveShooterGameSpec rejects invalid numbers with path context", () => {
  try {
    resolveShooterGameSpec({ weapons: { cooldown: -1 } });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='weapons.cooldown' detail='must be a positive finite number'.",
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
      "Invalid shooter game spec: kind=game-spec path='enemies.scoreReward' detail='must be a positive integer'.",
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
      "Invalid shooter game spec: kind=game-spec path='prefabs.enemy.width' detail='must be a positive finite number'.",
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
      "Invalid shooter game spec: kind=game-spec path='prefabs.enemy.animation.frames' detail='must be a positive integer'.",
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
      "Invalid shooter game spec: kind=game-spec path='enemies.behavior' detail='must be one of chase, drift, static'.",
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
      "Invalid shooter game spec: kind=game-spec path='enemies.spawnPattern' detail='must be one of edge, corners, center'.",
    );
    return;
  }
  throw new Error("Expected invalid spawn pattern spec to throw.");
});

test("resolveShooterGameSpec rejects unknown camera preset with path context", () => {
  try {
    resolveShooterGameSpec({ camera: { preset: "orbit" } });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='camera.preset' detail='must be one of follow, dead-zone, look-ahead, shake'.",
    );
    return;
  }
  throw new Error("Expected invalid camera preset spec to throw.");
});

test("resolveShooterGameSpec rejects invalid camera numbers with path context", () => {
  try {
    resolveShooterGameSpec({ camera: { deadZone: { width: -1 } } });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='camera.deadZone.width' detail='must be a non-negative finite number'.",
    );
    return;
  }
  throw new Error("Expected invalid camera number spec to throw.");
});

test("resolveShooterGameSpec rejects invalid atlas uv with path context", () => {
  try {
    resolveShooterGameSpec({
      atlas: {
        frames: {
          bad: {
            texture: "bullet",
            uv: { u0: 0.8, v0: 0, u1: 0.2, v1: 1 },
            size: { width: 8, height: 8 },
          },
        },
      },
    });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='atlas.frames.bad.uv.u1' detail='must be greater than uv.u0'.",
    );
    return;
  }
  throw new Error("Expected invalid atlas uv spec to throw.");
});

test("resolveShooterGameSpec rejects unknown atlas frame references with path context", () => {
  try {
    resolveShooterGameSpec({ prefabs: { bullet: { frame: "missing" } } });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='prefabs.bullet.frame' detail='must reference a frame in atlas.frames'.",
    );
    return;
  }
  throw new Error("Expected unknown atlas frame spec to throw.");
});

test("resolveShooterGameSpec rejects prefab frame and animation conflicts", () => {
  try {
    resolveShooterGameSpec({
      atlas: {
        frames: {
          bullet: {
            texture: 1,
            uv: { u0: 0, v0: 0, u1: 1, v1: 1 },
            size: { width: 8, height: 8 },
          },
        },
      },
      prefabs: {
        bullet: {
          frame: "bullet",
          animation: { frames: 2, fps: 8 },
        },
      },
    });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='prefabs.bullet.frame' detail='cannot be combined with animation'.",
    );
    return;
  }
  throw new Error("Expected atlas frame conflict spec to throw.");
});

test("applyShooterGameSpec requires texture resolver for named atlas textures", () => {
  const engine = new FakeEngine();
  try {
    applyShooterGameSpec(engine, {
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
    });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='prefabs.bullet.frame' detail='requires a textureId resolver when atlas frame texture is a name'.",
    );
    equal(engine.resolvedConfig, undefined);
    return;
  }
  throw new Error("Expected named atlas texture without resolver to throw.");
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
      bullet: { frame: "bullet.core" },
    },
    atlas: {
      frames: {
        "bullet.core": {
          texture: "bullet",
          uv: { u0: 0.125, v0: 0.25, u1: 0.25, v1: 0.5 },
          size: { width: 14, height: 16 },
        },
      },
    },
    camera: {
      preset: "dead-zone",
      deadZone: { width: 180, height: 120 },
      lookAhead: { distance: 72 },
      shake: { amplitude: 3, frequency: 5 },
    },
  }, { textureId: (name) => (name === "bullet" ? 7 : 0) });

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
    bulletWidth: 14,
    bulletHeight: 16,
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
    cameraPreset: "dead-zone",
    cameraPresetCode: 1,
    cameraDeadZoneWidth: 180,
    cameraDeadZoneHeight: 120,
    cameraLookAheadDistance: 72,
    cameraShakeAmplitude: 3,
    cameraShakeFrequency: 5,
    atlasFrames: {
      "bullet.core": {
        name: "bullet.core",
        texture: "bullet",
        width: 14,
        height: 16,
        u0: 0.125,
        v0: 0.25,
        u1: 0.25,
        v1: 0.5,
      },
    },
    bulletAtlasFrame: {
      name: "bullet.core",
      texture: "bullet",
      width: 14,
      height: 16,
      u0: 0.125,
      v0: 0.25,
      u1: 0.25,
      v1: 0.5,
    },
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
    14,
    16,
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
  deepEqual(engine.cameraConfig, [
    1,
    180,
    120,
    72,
    3,
    5,
  ]);
  deepEqual(engine.atlasFrames, [
    [2, 7, 14, 16, 0.125, 0.25, 0.25, 0.5],
  ]);
});
