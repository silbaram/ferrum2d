import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { applyShooterGameSpec } from "../src/gameSpec.js";
import { resolvePhysicsSpec } from "../src/physicsSpec.js";
import { FakeEngine } from "./gameSpec.shared.js";

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

test("applyShooterGameSpec forwards tilemap definitions and layers to engine", () => {
  const engine = new FakeEngine();

  applyShooterGameSpec(engine, {
    atlas: {
      frames: {
        "terrain.floor": {
          texture: "terrain",
          uv: { u0: 0, v0: 0, u1: 0.5, v1: 0.5 },
          size: { width: 16, height: 16 },
        },
        "terrain.edge": {
          texture: 0,
          uv: { u0: 0.5, v0: 0, u1: 1, v1: 0.5 },
          size: { width: 16, height: 16 },
        },
        "terrain.bridge": {
          texture: 0,
          uv: { u0: 0, v0: 0.5, u1: 0.5, v1: 1 },
          size: { width: 16, height: 16 },
        },
      },
    },
    physics: {
      hd2d: {
        enabled: true,
        defaultHeight: 6,
      },
    },
    tilemap: {
      tileWidth: 32,
      tileHeight: 24,
      origin: { x: 4, y: 8 },
      tiles: {
        "1": {
          frame: "terrain.floor",
          color: [0.6, 0.7, 0.8, 1],
          floor: "ground",
          elevation: 4,
          height: 12,
          oneWayPlatform: true,
        },
        "2": {
          frame: "terrain.edge",
          kind: "ramp",
          ramp: { axis: "y", startElevation: 0, endElevation: 6 },
          slope: { x0: 0, y0: 1, x1: 1, y1: 0 },
        },
        "3": {
          frame: "terrain.bridge",
          kind: "bridge",
          floor: "ground",
          height: 8,
          blocksMovement: false,
          bridgePortal: {
            lowerFloor: "ground",
            upperFloor: "bridge",
            upperElevation: 12,
            navigationCost: 2,
          },
        },
      },
      layers: [
        { name: "floor", columns: 2, rows: 2, collision: true, data: [1, 3, 2, 1] },
      ],
    },
  }, { textureId: (name) => (name === "terrain" ? 12 : 0) });

  equal(engine.tilemapCleared, true);
  deepEqual(engine.tiles, [
    [1, 12, 0, 0, 0.5, 0.5, 0.6, 0.7, 0.8, 1],
    [2, 0, 0.5, 0, 1, 0.5, 1, 1, 1, 1],
    [3, 0, 0, 0.5, 0.5, 1, 1, 1, 1, 1],
  ]);
  deepEqual(engine.tileSlopes, [
    [2, 0, 1, 1, 0],
  ]);
  deepEqual(engine.tileOneWayPlatforms, [1]);
  deepEqual(engine.tileHeightSpans, [
    [1, 2, 4, 12],
    [2, 0, 0, 6],
    [3, 2, 0, 8],
  ]);
  deepEqual(engine.tileHd2dMetadata, [
    [2, 2, true, true, true, 6, true, 1, 0, 6],
    [3, 4, false, false, false, 8, false, 0, 0, 0],
  ]);
  deepEqual(engine.tileBridgePortals, [
    [3, 2, 1, 0, 12, 2],
  ]);
  deepEqual(engine.tileLayers, [
    [0, 2, 2, 32, 24, 4, 8, true, [1, 3, 2, 1]],
  ]);
});

test("applyShooterGameSpec forwards atlas animation frame buffers to engine", () => {
  const engine = new FakeEngine();

  applyShooterGameSpec(engine, {
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
  }, { textureId: (name) => (name === "sprites" ? 7 : 0) });

  deepEqual(engine.atlasAnimations, [{
    prefab: 0,
    textureId: 7,
    width: 16,
    height: 24,
    idleFps: 1,
    idleFrames: [0, 0, 0.25, 0.5],
    moveFps: 8,
    moveFrames: [0, 0.5, 0.25, 1, 0.25, 0.5, 0.5, 1],
  }]);
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
      orbit: { radius: 200, radialBand: 12 },
      presets: {
        elite: { speed: 96, behavior: "drift", spawnPattern: "corners", health: 6, scoreReward: 12 },
      },
      waves: [
        { enemy: "elite", duration: 14, spawnInterval: 0.6, enemyCount: 5 },
      ],
    },
    weapons: {
      bulletSpeed: 640,
      cooldown: 0.08,
      lifetime: 2.4,
      damage: 2,
      projectileArc: { enabled: true, launchHeight: 6, zVelocity: 120, gravity: 240, hitHeight: 2 },
    },
    prefabs: {
      player: {
        width: 40,
        height: 44,
        collider: { halfWidth: 16, halfHeight: 18, offset: { x: 1, y: 2 } },
      },
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
      bullet: {
        frame: "bullet.core",
        collider: {
          halfWidth: 4,
          halfHeight: 5,
          material: {
            restitution: 0.2,
            friction: 0.1,
            surfaceVelocity: { x: -2, y: 1 },
            density: 2,
            contactBaumgarteBiasScale: 0.8,
            maxContactBaumgarteBiasVelocityScale: 0.7,
            contactPositionCorrectionScale: 0.6,
            contactPositionCorrectionSlopScale: 0.5,
          },
        },
      },
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
    audio: {
      masterVolume: 0.85,
      sfxVolume: 0.65,
      events: {
        shoot: { volume: 0.2, pitch: 1.2 },
        hit: { volume: 0.55, pitch: 0.9 },
        gameOver: { volume: 0.75, pitch: 0.8 },
      },
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
    projectileArc: {
      enabled: true,
      launchHeight: 6,
      zVelocity: 120,
      gravity: 240,
      hitHeight: 2,
    },
    scoreReward: 9,
    orbitRadius: 200,
    orbitRadialBand: 12,
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
	    playerCollider: {
	      type: "aabb",
	      halfWidth: 16,
      halfHeight: 18,
      offsetX: 1,
      offsetY: 2,
      enabled: true,
      trigger: true,
    },
	    enemyCollider: {
	      type: "aabb",
	      halfWidth: 15,
      halfHeight: 17,
      offsetX: 0,
      offsetY: 0,
      enabled: true,
      trigger: true,
    },
	    bulletCollider: {
	      type: "aabb",
	      halfWidth: 4,
      halfHeight: 5,
      offsetX: 0,
      offsetY: 0,
      enabled: true,
      trigger: true,
      material: {
        restitution: 0.2,
        friction: 0.1,
        surfaceVelocityX: -2,
        surfaceVelocityY: 1,
        density: 2,
        contactBaumgarteBiasScale: 0.8,
        maxContactBaumgarteBiasVelocityScale: 0.7,
        contactPositionCorrectionScale: 0.6,
        contactPositionCorrectionSlopScale: 0.5,
      },
    },
    waves: [
      {
        index: 0,
        enemy: "elite",
        duration: 14,
        spawnInterval: 0.6,
        enemyCount: 5,
        enemySpeed: 96,
        enemyBehavior: "drift",
        enemyBehaviorCode: 1,
        enemySpawnPattern: "corners",
        enemySpawnPatternCode: 1,
        enemyHealth: 6,
        scoreReward: 12,
      },
    ],
    audioMasterVolume: 0.85,
    audioSfxVolume: 0.65,
    shootVolume: 0.2,
    shootPitch: 1.2,
    hitVolume: 0.55,
    hitPitch: 0.9,
    gameOverVolume: 0.75,
    gameOverPitch: 0.8,
    postProcessing: [],
    physics: resolvePhysicsSpec(undefined),
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
    200,
    12,
  ]);
  deepEqual(engine.projectileArcConfig, [true, 6, 120, 240, 2]);
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
  deepEqual(engine.audioConfig, [0.2, 1.2, 0.55, 0.9, 0.75, 0.8]);
  equal(engine.wavesCleared, true);
  deepEqual(engine.waves, [
    [0, 14, 0.6, 5, 96, 1, 1, 6, 12],
  ]);
  deepEqual(engine.atlasFrames, [
    [2, 7, 14, 16, 0.125, 0.25, 0.25, 0.5],
  ]);
  deepEqual(engine.prefabColliders, [
    [0, 16, 18, 1, 2, true, true, false, 0, 0.4, 0, 0, 1, 1, 1, 1, 1],
    [1, 15, 17, 0, 0, true, true, false, 0, 0.4, 0, 0, 1, 1, 1, 1, 1],
    [2, 4, 5, 0, 0, true, true, true, 0.2, 0.1, -2, 1, 2, 0.8, 0.7, 0.6, 0.5],
  ]);
});

test("applyShooterGameSpec forwards non-AABB prefab colliders to engine", () => {
  const engine = new FakeEngine();

  applyShooterGameSpec(engine, {
    prefabs: {
      player: {
        collider: {
          type: "circle",
          radius: 12,
          offset: { x: 1, y: -1 },
        },
      },
      enemy: {
        collider: {
          type: "orientedBox",
          halfWidth: 9,
          halfHeight: 7,
          rotationRadians: 0.3,
          trigger: false,
        },
      },
      bullet: {
        collider: {
          type: "convexPolygon",
          vertices: [
            { x: -2, y: -1 },
            { x: 2, y: -1 },
            { x: 0, y: 2 },
          ],
          rotationRadians: 0.1,
          enabled: false,
          material: {
            restitution: 0.25,
            friction: 0.15,
            surfaceVelocity: { x: 2, y: -3 },
            density: 3,
            contactBaumgarteBiasScale: 0.9,
            maxContactBaumgarteBiasVelocityScale: 0.8,
            contactPositionCorrectionScale: 0.7,
            contactPositionCorrectionSlopScale: 0.6,
          },
        },
      },
    },
  });

  deepEqual(engine.prefabColliders, []);
  deepEqual(engine.circlePrefabColliders, [
    [0, 12, 1, -1, true, true, false, 0, 0.4, 0, 0, 1, 1, 1, 1, 1],
  ]);
  deepEqual(engine.orientedBoxPrefabColliders, [
    [1, 9, 7, 0.3, 0, 0, true, false, false, 0, 0.4, 0, 0, 1, 1, 1, 1, 1],
  ]);
  deepEqual(engine.convexPolygonPrefabColliders, [
    {
      prefab: 2,
      vertices: [-2, -1, 2, -1, 0, 2],
      rotationRadians: 0.1,
      offsetX: 0,
      offsetY: 0,
      enabled: false,
      trigger: true,
      hasMaterial: true,
      restitution: 0.25,
      friction: 0.15,
      surfaceVelocityX: 2,
      surfaceVelocityY: -3,
      density: 3,
      contactBaumgarteBiasScale: 0.9,
      maxContactBaumgarteBiasVelocityScale: 0.8,
      contactPositionCorrectionScale: 0.7,
      contactPositionCorrectionSlopScale: 0.6,
    },
  ]);

  const capsuleEngine = new FakeEngine();
  applyShooterGameSpec(capsuleEngine, {
    prefabs: {
      enemy: {
        collider: {
          type: "capsule",
          start: { x: -4, y: 0 },
          end: { x: 4, y: 0 },
          radius: 3,
          offset: { x: 0, y: 1 },
        },
      },
    },
  });
  deepEqual(capsuleEngine.capsulePrefabColliders, [
    [1, -4, 0, 4, 0, 3, 0, 1, true, true, false, 0, 0.4, 0, 0, 1, 1, 1, 1, 1],
  ]);
});
