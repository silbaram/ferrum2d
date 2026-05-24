import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { applyShooterGameSpec, resolveShooterGameSpec } from "../src/gameSpec.js";

class FakeEngine {
  resolvedConfig?: number[];
  animationConfig?: number[];
  cameraConfig?: number[];
  audioConfig?: number[];
  wavesCleared = false;
  waves: number[][] = [];
  atlasFrames: number[][] = [];
  atlasAnimations: Array<{
    prefab: number;
    textureId: number;
    width: number;
    height: number;
    idleFps: number;
    idleFrames: number[];
    moveFps: number;
    moveFrames: number[];
  }> = [];
  prefabColliders: Array<[
    number,
    number,
    number,
    number,
    number,
    boolean,
    boolean,
    boolean,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ]> = [];
  circlePrefabColliders: Array<[number, number, number, number, boolean, boolean, boolean, number, number, number, number, number, number, number, number, number]> = [];
  capsulePrefabColliders: Array<[
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    boolean,
    boolean,
    boolean,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ]> = [];
  orientedBoxPrefabColliders: Array<[
    number,
    number,
    number,
    number,
    number,
    number,
    boolean,
    boolean,
    boolean,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ]> = [];
  convexPolygonPrefabColliders: Array<{
    prefab: number;
    vertices: number[];
    rotationRadians: number;
    offsetX: number;
    offsetY: number;
    enabled: boolean;
    trigger: boolean;
    hasMaterial: boolean;
  }> = [];
  tilemapCleared = false;
  tiles: number[][] = [];
  tileSlopes: number[][] = [];
  tileOneWayPlatforms: number[] = [];
  tileLayers: Array<[number, number, number, number, number, number, number, boolean, number[]]> = [];

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
      orbitRadius,
      orbitRadialBand,
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

  set_shooter_atlas_animation(
    prefab: number,
    textureId: number,
    width: number,
    height: number,
    idleFps: number,
    idleFrames: Float32Array,
    moveFps: number,
    moveFrames: Float32Array,
  ): void {
    this.atlasAnimations.push({
      prefab,
      textureId,
      width,
      height,
      idleFps,
      idleFrames: Array.from(idleFrames),
      moveFps,
      moveFrames: Array.from(moveFrames),
    });
  }

  set_shooter_prefab_collider(
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
  ): boolean {
    this.prefabColliders.push([
      prefab,
      halfWidth,
      halfHeight,
      offsetX,
      offsetY,
      enabled,
      trigger,
      hasMaterial,
      restitution,
      friction,
      surfaceVelocityX,
      surfaceVelocityY,
      density,
      contactBaumgarteBiasScale,
      maxContactBaumgarteBiasVelocityScale,
      contactPositionCorrectionScale,
      contactPositionCorrectionSlopScale,
    ]);
    return true;
  }

  set_shooter_prefab_circle_collider(
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
  ): boolean {
    this.circlePrefabColliders.push([
      prefab,
      radius,
      offsetX,
      offsetY,
      enabled,
      trigger,
      hasMaterial,
      restitution,
      friction,
      surfaceVelocityX,
      surfaceVelocityY,
      density,
      contactBaumgarteBiasScale,
      maxContactBaumgarteBiasVelocityScale,
      contactPositionCorrectionScale,
      contactPositionCorrectionSlopScale,
    ]);
    return true;
  }

  set_shooter_prefab_capsule_collider(
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
  ): boolean {
    this.capsulePrefabColliders.push([
      prefab,
      startX,
      startY,
      endX,
      endY,
      radius,
      offsetX,
      offsetY,
      enabled,
      trigger,
      hasMaterial,
      restitution,
      friction,
      surfaceVelocityX,
      surfaceVelocityY,
      density,
      contactBaumgarteBiasScale,
      maxContactBaumgarteBiasVelocityScale,
      contactPositionCorrectionScale,
      contactPositionCorrectionSlopScale,
    ]);
    return true;
  }

  set_shooter_prefab_oriented_box_collider(
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
  ): boolean {
    this.orientedBoxPrefabColliders.push([
      prefab,
      halfWidth,
      halfHeight,
      rotationRadians,
      offsetX,
      offsetY,
      enabled,
      trigger,
      hasMaterial,
      restitution,
      friction,
      surfaceVelocityX,
      surfaceVelocityY,
      density,
      contactBaumgarteBiasScale,
      maxContactBaumgarteBiasVelocityScale,
      contactPositionCorrectionScale,
      contactPositionCorrectionSlopScale,
    ]);
    return true;
  }

  set_shooter_prefab_convex_polygon_collider(
    prefab: number,
    vertices: Float32Array,
    rotationRadians: number,
    offsetX: number,
    offsetY: number,
    enabled: boolean,
    trigger: boolean,
    hasMaterial: boolean,
  ): boolean {
    this.convexPolygonPrefabColliders.push({
      prefab,
      vertices: Array.from(vertices),
      rotationRadians,
      offsetX,
      offsetY,
      enabled,
      trigger,
      hasMaterial,
    });
    return true;
  }

  clear_shooter_tilemap(): void {
    this.tilemapCleared = true;
    this.tiles = [];
    this.tileSlopes = [];
    this.tileOneWayPlatforms = [];
    this.tileLayers = [];
  }

  set_shooter_tile(
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
  ): void {
    this.tiles.push([tileId, textureId, u0, v0, u1, v1, r, g, b, a]);
  }

  set_shooter_tile_slope(
    tileId: number,
    localX0: number,
    localY0: number,
    localX1: number,
    localY1: number,
  ): void {
    this.tileSlopes.push([tileId, localX0, localY0, localX1, localY1]);
  }

  set_shooter_tile_one_way_platform(tileId: number): void {
    this.tileOneWayPlatforms.push(tileId);
  }

  set_shooter_tilemap_layer(
    index: number,
    columns: number,
    rows: number,
    tileWidth: number,
    tileHeight: number,
    originX: number,
    originY: number,
    collision: boolean,
    tiles: Uint32Array,
  ): void {
    this.tileLayers.push([index, columns, rows, tileWidth, tileHeight, originX, originY, collision, Array.from(tiles)]);
  }

  clear_shooter_waves(): void {
    this.wavesCleared = true;
    this.waves = [];
  }

  set_shooter_wave(
    index: number,
    duration: number,
    spawnInterval: number,
    enemyCount: number,
    enemySpeed: number,
    enemyBehavior: number,
    enemySpawnPattern: number,
    enemyHealth: number,
    scoreReward: number,
  ): void {
    this.waves.push([
      index,
      duration,
      spawnInterval,
      enemyCount,
      enemySpeed,
      enemyBehavior,
      enemySpawnPattern,
      enemyHealth,
      scoreReward,
    ]);
  }

  set_shooter_audio_policy(
    shootVolume: number,
    shootPitch: number,
    hitVolume: number,
    hitPitch: number,
    gameOverVolume: number,
    gameOverPitch: number,
  ): void {
    this.audioConfig = [shootVolume, shootPitch, hitVolume, hitPitch, gameOverVolume, gameOverPitch];
  }
}

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
  });
});

test("resolveShooterGameSpec accepts non-AABB prefab colliders", () => {
  const spec = resolveShooterGameSpec({
    prefabs: {
      player: {
        collider: {
          type: "circle",
          radius: 14,
          offset: { x: 1, y: -2 },
        },
      },
      enemy: {
        collider: {
          type: "capsule",
          start: { x: -5, y: 0 },
          end: { x: 5, y: 0 },
          radius: 3,
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
          rotationRadians: 0.2,
          enabled: false,
        },
      },
    },
  });

  deepEqual(spec.playerCollider, {
    type: "circle",
    radius: 14,
    offsetX: 1,
    offsetY: -2,
    enabled: true,
    trigger: true,
  });
  deepEqual(spec.enemyCollider, {
    type: "capsule",
    startX: -5,
    startY: 0,
    endX: 5,
    endY: 0,
    radius: 3,
    offsetX: 0,
    offsetY: 0,
    enabled: true,
    trigger: false,
  });
  deepEqual(spec.bulletCollider, {
    type: "convexPolygon",
    vertices: [
      { x: -2, y: -1 },
      { x: 2, y: -1 },
      { x: 0, y: 2 },
    ],
    rotationRadians: 0.2,
    offsetX: 0,
    offsetY: 0,
    enabled: false,
    trigger: true,
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

test("resolveShooterGameSpec rejects invalid orbit config with path context", () => {
  try {
    resolveShooterGameSpec({ enemies: { orbit: { radius: 0 } } });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='enemies.orbit.radius' detail='must be a positive finite number'.",
    );
    return;
  }
  throw new Error("Expected invalid orbit spec to throw.");
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

test("resolveShooterGameSpec rejects invalid prefab collider metadata with path context", () => {
  try {
    resolveShooterGameSpec({ prefabs: { enemy: { collider: { halfWidth: 0 } } } });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='prefabs.enemy.collider.halfWidth' detail='must be a positive finite number'.",
    );
    return;
  }
  throw new Error("Expected invalid prefab collider spec to throw.");
});

test("resolveShooterGameSpec rejects invalid prefab collider shape metadata with path context", () => {
  try {
    resolveShooterGameSpec({
      prefabs: { bullet: { collider: { type: "convexPolygon", vertices: [{ x: 0, y: 0 }] } } },
    });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='prefabs.bullet.collider.vertices' detail='must contain 3 to 16 vertices'.",
    );
    return;
  }
  throw new Error("Expected invalid prefab collider shape spec to throw.");
});

test("resolveShooterGameSpec rejects invalid prefab collider material with path context", () => {
  try {
    resolveShooterGameSpec({
      prefabs: { bullet: { collider: { material: { density: 0 } } } },
    });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='prefabs.bullet.collider.material.density' detail='must be a positive finite number'.",
    );
    return;
  }
  throw new Error("Expected invalid prefab collider material spec to throw.");
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
      "Invalid shooter game spec: kind=game-spec path='enemies.behavior' detail='must be one of chase, drift, static, orbit'.",
    );
    return;
  }
  throw new Error("Expected invalid behavior spec to throw.");
});

test("resolveShooterGameSpec accepts orbit enemy behavior", () => {
  const spec = resolveShooterGameSpec({
    enemies: {
      behavior: "orbit",
      presets: {
        orbiter: { behavior: "orbit", speed: 84, health: 2, scoreReward: 3 },
      },
      waves: [{ enemy: "orbiter", duration: 12, spawnInterval: 1, enemyCount: 4 }],
    },
  });

  equal(spec.enemyBehavior, "orbit");
  equal(spec.enemyBehaviorCode, 3);
  equal(spec.orbitRadius, 180);
  equal(spec.orbitRadialBand, 24);
  deepEqual(spec.waves[0], {
    index: 0,
    enemy: "orbiter",
    duration: 12,
    spawnInterval: 1,
    enemyCount: 4,
    enemySpeed: 84,
    enemyBehavior: "orbit",
    enemyBehaviorCode: 3,
    enemySpawnPattern: "edge",
    enemySpawnPatternCode: 0,
    enemyHealth: 2,
    scoreReward: 3,
  });
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

test("resolveShooterGameSpec resolves static tilemap layers", () => {
  const spec = resolveShooterGameSpec({
    atlas: {
      frames: {
        "terrain.floor": {
          texture: "terrain",
          uv: { u0: 0, v0: 0, u1: 0.5, v1: 0.5 },
          size: { width: 16, height: 16 },
        },
        "terrain.trim": {
          texture: 0,
          uv: { u0: 0.5, v0: 0, u1: 1, v1: 0.5 },
          size: { width: 16, height: 16 },
        },
      },
    },
    tilemap: {
      tileWidth: 16,
      tileHeight: 24,
      origin: { x: -8, y: 4 },
      tiles: {
        "2": {
          frame: "terrain.trim",
          color: [0.8, 0.7, 0.6, 0.5],
          slope: { x0: 0, y0: 1, x1: 1, y1: 0 },
        },
        "1": { frame: "terrain.floor", oneWayPlatform: true },
      },
      layers: [
        {
          name: "floor",
          columns: 3,
          rows: 2,
          collision: true,
          data: [1, 0, 2, 2, 1, 0],
        },
      ],
    },
  });

  deepEqual(spec.tilemap, {
    tiles: [
      {
        id: 1,
        frame: {
          name: "terrain.floor",
          texture: "terrain",
          width: 16,
          height: 16,
          u0: 0,
          v0: 0,
          u1: 0.5,
          v1: 0.5,
        },
        color: [1, 1, 1, 1],
        oneWayPlatform: true,
      },
      {
        id: 2,
        frame: {
          name: "terrain.trim",
          texture: 0,
          width: 16,
          height: 16,
          u0: 0.5,
          v0: 0,
          u1: 1,
          v1: 0.5,
        },
        color: [0.8, 0.7, 0.6, 0.5],
        slope: { x0: 0, y0: 1, x1: 1, y1: 0 },
      },
    ],
    layers: [
      {
        index: 0,
        name: "floor",
        columns: 3,
        rows: 2,
        tileWidth: 16,
        tileHeight: 24,
        originX: -8,
        originY: 4,
        collision: true,
        collisionOnly: false,
        data: [1, 0, 2, 2, 1, 0],
      },
    ],
  });
});

test("resolveShooterGameSpec rejects vertical tile slope definitions", () => {
  try {
    resolveShooterGameSpec({
      atlas: {
        frames: {
          "terrain.ramp": {
            texture: 0,
            uv: { u0: 0, v0: 0, u1: 1, v1: 1 },
            size: { width: 16, height: 16 },
          },
        },
      },
      tilemap: {
        tiles: {
          "1": { frame: "terrain.ramp", slope: { x0: 0.5, y0: 1, x1: 0.5, y1: 0 } },
        },
      },
    });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='tilemap.tiles.1.slope.x1' detail='must differ from slope.x0'.",
    );
    return;
  }
  throw new Error("Expected vertical tile slope spec to throw.");
});

test("resolveShooterGameSpec rejects non-boolean one-way tile metadata", () => {
  try {
    resolveShooterGameSpec({
      atlas: {
        frames: {
          "terrain.platform": {
            texture: 0,
            uv: { u0: 0, v0: 0, u1: 1, v1: 1 },
            size: { width: 16, height: 16 },
          },
        },
      },
      tilemap: {
        tiles: {
          "1": { frame: "terrain.platform", oneWayPlatform: "yes" },
        },
      },
    });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='tilemap.tiles.1.oneWayPlatform' detail='must be a boolean'.",
    );
    return;
  }
  throw new Error("Expected non-boolean one-way tile metadata to throw.");
});

test("resolveShooterGameSpec rejects tiles that combine slope and one-way platform metadata", () => {
  try {
    resolveShooterGameSpec({
      atlas: {
        frames: {
          "terrain.ramp": {
            texture: 0,
            uv: { u0: 0, v0: 0, u1: 1, v1: 1 },
            size: { width: 16, height: 16 },
          },
        },
      },
      tilemap: {
        tiles: {
          "1": {
            frame: "terrain.ramp",
            slope: { x0: 0, y0: 1, x1: 1, y1: 0 },
            oneWayPlatform: true,
          },
        },
      },
    });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='tilemap.tiles.1.oneWayPlatform' detail='cannot be combined with slope'.",
    );
    return;
  }
  throw new Error("Expected combined slope and one-way tile metadata to throw.");
});

test("resolveShooterGameSpec rejects tilemap data that references missing tiles", () => {
  try {
    resolveShooterGameSpec({
      tilemap: {
        tiles: {},
        layers: [{ columns: 1, rows: 1, data: [1] }],
      },
    });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='tilemap.layers.0.data.0' detail='must reference a tile id in tilemap.tiles or be 0'.",
    );
    return;
  }
  throw new Error("Expected invalid tilemap data spec to throw.");
});

test("resolveShooterGameSpec rejects tilemap layer data length mismatches", () => {
  try {
    resolveShooterGameSpec({
      tilemap: {
        layers: [{ columns: 2, rows: 2, data: [0, 0, 0] }],
      },
    });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='tilemap.layers.0.data' detail='must contain exactly 4 tile ids'.",
    );
    return;
  }
  throw new Error("Expected invalid tilemap layer spec to throw.");
});

test("resolveShooterGameSpec rejects non-boolean tilemap collision flags", () => {
  try {
    resolveShooterGameSpec({
      tilemap: {
        layers: [{ columns: 1, rows: 1, collision: "yes", data: [0] }],
      },
    });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='tilemap.layers.0.collision' detail='must be a boolean'.",
    );
    return;
  }
  throw new Error("Expected invalid tilemap collision spec to throw.");
});

test("resolveShooterGameSpec accepts collision-only tilemap layers with undefined solid ids", () => {
  const spec = resolveShooterGameSpec({
    tilemap: {
      layers: [{
        name: "raw-int-grid",
        columns: 2,
        rows: 2,
        collision: true,
        collisionOnly: true,
        data: [0, 4294967295, 0, 4294967295],
      }],
    },
  });

  deepEqual(spec.tilemap?.layers[0], {
    index: 0,
    name: "raw-int-grid",
    columns: 2,
    rows: 2,
    tileWidth: 32,
    tileHeight: 32,
    originX: 0,
    originY: 0,
    collision: true,
    collisionOnly: true,
    data: [0, 4294967295, 0, 4294967295],
  });
});

test("resolveShooterGameSpec rejects collision-only tilemap layers without collision", () => {
  try {
    resolveShooterGameSpec({
      tilemap: {
        layers: [{ columns: 1, rows: 1, collisionOnly: true, data: [1] }],
      },
    });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='tilemap.layers.0.collisionOnly' detail='requires collision to be true'.",
    );
    return;
  }
  throw new Error("Expected invalid collision-only layer spec to throw.");
});

test("resolveShooterGameSpec rejects tilemap tiles with unknown atlas frames", () => {
  try {
    resolveShooterGameSpec({
      tilemap: {
        tiles: { "1": { frame: "missing" } },
      },
    });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='tilemap.tiles.1.frame' detail='must reference a frame in atlas.frames'.",
    );
    return;
  }
  throw new Error("Expected invalid tilemap frame spec to throw.");
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
      },
    },
    tilemap: {
      tileWidth: 32,
      tileHeight: 24,
      origin: { x: 4, y: 8 },
      tiles: {
        "1": { frame: "terrain.floor", color: [0.6, 0.7, 0.8, 1], oneWayPlatform: true },
        "2": { frame: "terrain.edge", slope: { x0: 0, y0: 1, x1: 1, y1: 0 } },
      },
      layers: [
        { name: "floor", columns: 2, rows: 2, collision: true, data: [1, 0, 2, 1] },
      ],
    },
  }, { textureId: (name) => (name === "terrain" ? 12 : 0) });

  equal(engine.tilemapCleared, true);
  deepEqual(engine.tiles, [
    [1, 12, 0, 0, 0.5, 0.5, 0.6, 0.7, 0.8, 1],
    [2, 0, 0.5, 0, 1, 0.5, 1, 1, 1, 1],
  ]);
  deepEqual(engine.tileSlopes, [
    [2, 0, 1, 1, 0],
  ]);
  deepEqual(engine.tileOneWayPlatforms, [1]);
  deepEqual(engine.tileLayers, [
    [0, 2, 2, 32, 24, 4, 8, true, [1, 0, 2, 1]],
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
    weapons: { bulletSpeed: 640, cooldown: 0.08, lifetime: 2.4, damage: 2 },
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
      hasMaterial: false,
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
