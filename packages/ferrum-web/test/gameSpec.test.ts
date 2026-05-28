import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { resolveShooterGameSpec } from "../src/gameSpec.js";
import { resolvePhysicsSpec } from "../src/physicsSpec.js";

test("resolveShooterGameSpec fills defaults and accepts overrides", () => {
  deepEqual(resolveShooterGameSpec({
    world: { width: 2400 },
    player: { speed: 220 },
    enemies: {
      spawnInterval: 0.5,
      behavior: "drift",
      spawnPattern: "corners",
      health: 3,
      scoreReward: 5,
      orbit: { radius: 220, radialBand: 18 },
    },
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
      enemy: {
        width: 32,
        height: 28,
        collider: {
          halfWidth: 10,
          halfHeight: 12,
          offset: { x: 2, y: -1 },
          trigger: false,
          material: {
            friction: 0.8,
            surfaceVelocity: { x: 3 },
            density: 1.4,
          },
        },
      },
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
    orbitRadius: 220,
    orbitRadialBand: 18,
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
	    playerCollider: {
	      type: "aabb",
	      halfWidth: 18,
      halfHeight: 18,
      offsetX: 0,
      offsetY: 0,
      enabled: true,
      trigger: true,
    },
	    enemyCollider: {
	      type: "aabb",
	      halfWidth: 10,
      halfHeight: 12,
      offsetX: 2,
      offsetY: -1,
      enabled: true,
      trigger: false,
      material: {
        restitution: 0,
        friction: 0.8,
        surfaceVelocityX: 3,
        surfaceVelocityY: 0,
        density: 1.4,
        contactBaumgarteBiasScale: 1,
        maxContactBaumgarteBiasVelocityScale: 1,
        contactPositionCorrectionScale: 1,
        contactPositionCorrectionSlopScale: 1,
      },
    },
	    bulletCollider: {
	      type: "aabb",
	      halfWidth: 6,
      halfHeight: 5,
      offsetX: 0,
      offsetY: 0,
      enabled: true,
      trigger: true,
    },
    waves: [],
    audioMasterVolume: 1,
    audioSfxVolume: 1,
    shootVolume: 0.35,
    shootPitch: 1,
    hitVolume: 0.45,
    hitPitch: 1,
    gameOverVolume: 0.65,
    gameOverPitch: 0.9,
    postProcessing: [],
    physics: resolvePhysicsSpec(undefined),
  });
});

test("resolveShooterGameSpec resolves post-processing passes", () => {
  const spec = resolveShooterGameSpec({
    postProcessing: {
      bloom: { threshold: 0.75, intensity: 0.5 },
      vignette: { intensity: 0.25, color: [0, 0, 0, 0.7] },
    },
  });

  equal(spec.postProcessing.length, 2);
  equal(spec.postProcessing[0]?.kind, "bloom");
  equal(spec.postProcessing[1]?.kind, "vignette");
});

test("resolveShooterGameSpec resolves generic physics spec metadata", () => {
  const spec = resolveShooterGameSpec({
    physics: {
      mode: "rigid",
      gravity: [0, 980],
      solver: {
        stepSeconds: 1 / 120,
        velocityIterations: 10,
        positionIterations: 6,
      },
      materials: {
        wood: { friction: 0.6, restitution: 0.2, density: 0.8 },
      },
      layers: {
        player: { mask: ["world"] },
        world: { mask: ["player"] },
      },
      bodies: {
        crate: {
          type: "dynamic",
          position: [320, 120],
          material: "wood",
          layer: "world",
          colliders: [
            { shape: "box", size: [32, 32] },
            { shape: "edge", start: [-16, 16], end: [16, 16] },
          ],
        },
      },
      joints: {
        hinge: {
          type: "revolute",
          bodyA: "world",
          bodyB: "crate",
          anchor: [320, 120],
          limit: { enabled: true, lower: -1, upper: 1 },
        },
      },
      debug: { colliders: true, contacts: true },
    },
  });

  equal(spec.physics.mode, "rigid");
  equal(spec.physics.gravityY, 980);
  equal(spec.physics.solver.stepSeconds, 1 / 120);
  equal(spec.physics.materials.wood.friction, 0.6);
  equal(spec.physics.layers.player.maskBits, 2);
  equal(spec.physics.bodies.crate.colliders[0].shape, "box");
  equal(spec.physics.bodies.crate.colliders[1].shape, "edge");
  equal(spec.physics.joints.hinge.bodyA, "world");
  equal(spec.physics.debug.colliders, true);
});

test("resolveShooterGameSpec lets runtime physics mode override spec mode", () => {
  const spec = resolveShooterGameSpec({
    physics: { mode: "rigid" },
  }, {
    physicsModeOverride: "none",
  });

  equal(spec.physics.mode, "none");
  equal(spec.physics.continuous, false);
  equal(spec.physics.solver.fixedTimestep, false);
});
