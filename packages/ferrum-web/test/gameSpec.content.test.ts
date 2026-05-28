import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { resolveShooterGameSpec } from "../src/gameSpec.js";

test("resolveShooterGameSpec resolves enemy presets, waves, and audio policy", () => {
  const spec = resolveShooterGameSpec({
    enemies: {
      speed: 70,
      spawnInterval: 1,
      behavior: "chase",
      spawnPattern: "edge",
      health: 1,
      scoreReward: 1,
      presets: {
        bruiser: {
          speed: 55,
          behavior: "static",
          spawnPattern: "center",
          health: 4,
          scoreReward: 8,
        },
      },
      waves: [
        { enemy: "bruiser", duration: 12, spawnInterval: 1.5, enemyCount: 6 },
        { duration: 8, enemyCount: 4, spawnPattern: "corners" },
      ],
    },
    audio: {
      masterVolume: 0.9,
      sfxVolume: 0.7,
      events: {
        shoot: { volume: 0.25, pitch: 1.1 },
        hit: { volume: 0.5, pitch: 0.95 },
        gameOver: { volume: 0.8, pitch: 0.75 },
      },
    },
  });

  deepEqual(spec.waves, [
    {
      index: 0,
      enemy: "bruiser",
      duration: 12,
      spawnInterval: 1.5,
      enemyCount: 6,
      enemySpeed: 55,
      enemyBehavior: "static",
      enemyBehaviorCode: 2,
      enemySpawnPattern: "center",
      enemySpawnPatternCode: 2,
      enemyHealth: 4,
      scoreReward: 8,
    },
    {
      index: 1,
      enemy: "default",
      duration: 8,
      spawnInterval: 1,
      enemyCount: 4,
      enemySpeed: 70,
      enemyBehavior: "chase",
      enemyBehaviorCode: 0,
      enemySpawnPattern: "corners",
      enemySpawnPatternCode: 1,
      enemyHealth: 1,
      scoreReward: 1,
    },
  ]);
  equal(spec.audioMasterVolume, 0.9);
  equal(spec.audioSfxVolume, 0.7);
  equal(spec.shootVolume, 0.25);
  equal(spec.shootPitch, 1.1);
  equal(spec.hitVolume, 0.5);
  equal(spec.hitPitch, 0.95);
  equal(spec.gameOverVolume, 0.8);
  equal(spec.gameOverPitch, 0.75);
});

test("resolveShooterGameSpec rejects unknown wave enemy preset with path context", () => {
  try {
    resolveShooterGameSpec({ enemies: { waves: [{ enemy: "missing" }] } });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='enemies.waves.0.enemy' detail='must reference an enemy preset'.",
    );
    return;
  }
  throw new Error("Expected invalid wave preset spec to throw.");
});

test("resolveShooterGameSpec rejects invalid audio policy with path context", () => {
  try {
    resolveShooterGameSpec({ audio: { events: { shoot: { pitch: 0 } } } });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='audio.events.shoot.pitch' detail='must be a positive finite number'.",
    );
    return;
  }
  throw new Error("Expected invalid audio policy spec to throw.");
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

test("resolveShooterGameSpec resolves atlas animation bindings", () => {
  const spec = resolveShooterGameSpec({
    atlas: {
      frames: {
        "player.idle.0": {
          texture: "sprites",
          uv: { u0: 0, v0: 0, u1: 0.25, v1: 0.5 },
          size: { width: 16, height: 24 },
        },
        "player.move.0": {
          texture: "sprites",
          uv: { u0: 0, v0: 0.5, u1: 0.25, v1: 1 },
          size: { width: 16, height: 24 },
        },
        "player.move.1": {
          texture: "sprites",
          uv: { u0: 0.25, v0: 0.5, u1: 0.5, v1: 1 },
          size: { width: 16, height: 24 },
        },
      },
    },
    prefabs: {
      player: {
        animation: {
          atlas: {
            idle: { frames: ["player.idle.0"], fps: 1 },
            move: { frames: ["player.move.0", "player.move.1"], fps: 8 },
          },
        },
      },
    },
  });

  equal(spec.playerWidth, 16);
  equal(spec.playerHeight, 24);
  equal(spec.playerAnimationFrames, 1);
  deepEqual(spec.playerAtlasAnimation, {
    texture: "sprites",
    width: 16,
    height: 24,
    idle: {
      fps: 1,
      frames: [spec.atlasFrames["player.idle.0"]],
    },
    move: {
      fps: 8,
      frames: [spec.atlasFrames["player.move.0"], spec.atlasFrames["player.move.1"]],
    },
  });
});

test("resolveShooterGameSpec rejects atlas animation frames with mixed texture", () => {
  try {
    resolveShooterGameSpec({
      atlas: {
        frames: {
          idle: {
            texture: "sprites-a",
            uv: { u0: 0, v0: 0, u1: 0.5, v1: 1 },
            size: { width: 16, height: 16 },
          },
          move: {
            texture: "sprites-b",
            uv: { u0: 0.5, v0: 0, u1: 1, v1: 1 },
            size: { width: 16, height: 16 },
          },
        },
      },
      prefabs: {
        player: {
          animation: {
            atlas: {
              idle: { frames: ["idle"], fps: 1 },
              move: { frames: ["move"], fps: 8 },
            },
          },
        },
      },
    });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='prefabs.player.animation.atlas.frames.1' detail='all atlas animation frames must use the same texture'.",
    );
    return;
  }
  throw new Error("Expected mixed atlas animation textures to throw.");
});
