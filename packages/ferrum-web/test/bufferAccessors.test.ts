import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import {
  createBuiltInShooterStateAccessor,
  createRenderCommandAccessor,
} from "../src/bufferAccessors.js";
import type {
  BuiltInShooterStateAccessor,
  FerrumBufferAccessorApi,
  RenderCommandAccessor,
} from "../src/core.js";
import type { BuiltInShooterStateLayout, RenderCommandFieldOffsets } from "../src/wasmBridgeAbi.js";

const renderOffsets: RenderCommandFieldOffsets = {
  x: 0,
  y: 1,
  width: 2,
  height: 3,
  u0: 4,
  v0: 5,
  u1: 6,
  v1: 7,
  r: 8,
  g: 9,
  b: 10,
  a: 11,
  textureId: 12,
  effectFlags: 13,
  rotationRadians: 14,
};

const shooterLayout: BuiltInShooterStateLayout = {
  headerFloats: 8,
  headerU32s: 6,
  floatsPerEntity: 19,
  u32sPerEntity: 5,
  fieldOffsets: {
    headerFloats: {
      fireCooldownSeconds: 0,
      enemySpawnTimer: 1,
      waveElapsedSeconds: 2,
      cameraElapsedSeconds: 3,
      cameraX: 4,
      cameraY: 5,
      previousMouseX: 6,
      previousMouseY: 7,
    },
    headerU32s: {
      version: 0,
      gameState: 1,
      score: 2,
      spawnIndex: 3,
      activeWaveIndex: 4,
      waveSpawnedCount: 5,
    },
    entityFloats: {
      x: 0,
      y: 1,
      velocityX: 2,
      velocityY: 3,
      health: 4,
      damage: 5,
      lifetimeSeconds: 6,
      primaryActionCooldownDuration: 7,
      primaryActionCooldownRemaining: 8,
      primaryActionProjectileSpeed: 9,
      primaryActionProjectileDamage: 10,
      primaryActionProjectileLifetime: 11,
      dashCooldownDuration: 12,
      dashCooldownRemaining: 13,
      dashDistance: 14,
      meleeCooldownDuration: 15,
      meleeCooldownRemaining: 16,
      meleeRange: 17,
      meleeDamage: 18,
    },
    entityU32s: {
      kind: 0,
      scoreRewardOrProjectilePolicy: 1,
      primaryActionId: 2,
      dashActionId: 3,
      meleeActionId: 4,
    },
  },
};

const publicBufferAccessorApi: FerrumBufferAccessorApi = {
  createRenderCommandAccessor: (): RenderCommandAccessor =>
    createRenderCommandAccessor(renderOffsets, 15),
  createBuiltInShooterStateAccessor: (): BuiltInShooterStateAccessor =>
    createBuiltInShooterStateAccessor(shooterLayout),
};

test("render command accessor binds and selects without creating field objects", () => {
  const accessor = publicBufferAccessorApi.createRenderCommandAccessor();
  const first = Float32Array.from({ length: 30 }, (_, index) => index);
  first[27] = 42;

  accessor.bind({ buffer: first, commandCount: 2, floatsPerCommand: 15 });
  accessor.select(1);

  equal(accessor.commandIndex, 1);
  deepEqual(
    [
      accessor.x,
      accessor.y,
      accessor.width,
      accessor.height,
      accessor.u0,
      accessor.v0,
      accessor.u1,
      accessor.v1,
      accessor.r,
      accessor.g,
      accessor.b,
      accessor.a,
      accessor.textureId,
      accessor.effectFlags,
      accessor.rotationRadians,
    ],
    [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 42, 28, 29],
  );

  const second = new Float32Array(15);
  second[renderOffsets.x] = 7;
  accessor.bind({ buffer: second, commandCount: 1, floatsPerCommand: 15 });
  accessor.select(0);
  equal(accessor.x, 7);
});

test("render command accessor clears stale bindings and selections after errors", () => {
  const accessor = publicBufferAccessorApi.createRenderCommandAccessor();
  const buffer = Float32Array.from({ length: 15 }, (_, index) => index);

  throws(() => accessor.x, /bind a render command buffer/);
  accessor.bind({ buffer, commandCount: 1, floatsPerCommand: 15 });
  accessor.select(0);
  equal(accessor.x, 0);

  throws(() => accessor.select(1), /outside/);
  equal(accessor.commandIndex, -1);
  throws(() => accessor.x, /select a render command/);

  accessor.select(0);
  throws(
    () => accessor.bind({ buffer, commandCount: 0.5, floatsPerCommand: 15 }),
    /non-negative safe integer/,
  );
  equal(accessor.commandIndex, -1);
  throws(() => accessor.x, /bind a render command buffer/);
});

test("built-in shooter accessor reads named action fields and mutates named fixture fields", () => {
  const accessor = publicBufferAccessorApi.createBuiltInShooterStateAccessor();
  const headerFloats = Array.from({ length: 8 }, (_, index) => index + 0.5);
  const headerU32s = [17, 1, 99, 4, 5, 6];
  const entityFloats = [
    ...Array.from({ length: 19 }, (_, index) => index + 10),
    ...Array.from({ length: 19 }, (_, index) => index + 100),
  ];
  const entityU32s = [0, 77, 11, 12, 13, 1, 88, 21, 22, 23];

  const buffers = {
    headerFloats,
    headerU32s,
    entityFloats,
    entityU32s,
    entityCount: 2,
    floatsPerEntity: 19,
    u32sPerEntity: 5,
  };
  accessor.bind(buffers);
  deepEqual(
    [
      accessor.version,
      accessor.gameState,
      accessor.score,
      accessor.spawnIndex,
      accessor.activeWaveIndex,
      accessor.waveSpawnedCount,
      accessor.fireCooldownSeconds,
      accessor.enemySpawnTimer,
      accessor.waveElapsedSeconds,
      accessor.cameraElapsedSeconds,
      accessor.cameraX,
      accessor.cameraY,
      accessor.previousMouseX,
      accessor.previousMouseY,
    ],
    [17, "playing", 99, 4, 5, 6, 0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5],
  );
  equal(accessor.selectFirst("player"), true);
  deepEqual(
    [
      accessor.kind,
      accessor.x,
      accessor.y,
      accessor.velocityX,
      accessor.velocityY,
      accessor.health,
      accessor.damage,
      accessor.lifetimeSeconds,
      accessor.scoreReward,
      accessor.projectilePolicy,
      accessor.primaryActionId,
      accessor.primaryActionCooldownDuration,
      accessor.primaryActionCooldownRemaining,
      accessor.primaryActionProjectileSpeed,
      accessor.primaryActionProjectileDamage,
      accessor.primaryActionProjectileLifetime,
      accessor.dashActionId,
      accessor.dashCooldownDuration,
      accessor.dashCooldownRemaining,
      accessor.dashDistance,
      accessor.meleeActionId,
      accessor.meleeCooldownDuration,
      accessor.meleeCooldownRemaining,
      accessor.meleeRange,
      accessor.meleeDamage,
    ],
    ["player", 10, 11, 12, 13, 14, 15, 16, 77, 77, 11, 17, 18, 19, 20, 21, 12, 22, 23, 24, 13, 25, 26, 27, 28],
  );
  throws(() => {
    accessor.health = 1;
  }, /bindMutable/);

  accessor.bindMutable(buffers);
  accessor.gameState = "gameOver";
  accessor.enemySpawnTimer = 999;
  equal(accessor.selectFirst("enemy"), true);
  accessor.x = 64;
  accessor.y = 96;
  accessor.health = 3;
  accessor.scoreReward = 5;

  equal(headerU32s[1], 2);
  equal(headerFloats[1], 999);
  equal(entityFloats[19], 64);
  equal(entityFloats[20], 96);
  equal(entityFloats[23], 3);
  equal(entityU32s[6], 5);
});

test("built-in shooter accessor fails closed after invalid bind or select", () => {
  const accessor = publicBufferAccessorApi.createBuiltInShooterStateAccessor();
  const headerFloats = new Array<number>(8).fill(0);
  const headerU32s = [17, 1, 0, 0, 0, 0];
  const entityFloats = new Array<number>(19).fill(0);
  const entityU32s = [0, 0, 0, 0, 0];
  const buffers = {
    headerFloats,
    headerU32s,
    entityFloats,
    entityU32s,
    entityCount: 1,
    floatsPerEntity: 19,
    u32sPerEntity: 5,
  };

  throws(() => accessor.score, /bind a shooter snapshot/);
  accessor.bindMutable(buffers);
  accessor.select(0);
  accessor.health = 9;

  throws(() => accessor.select(1), /outside/);
  equal(accessor.entityIndex, -1);
  throws(() => accessor.health, /select a shooter snapshot entity/);

  accessor.select(0);
  throws(
    () => accessor.bind({ ...buffers, headerFloats: headerFloats.slice(1) }),
    /header float length/,
  );
  equal(accessor.entityIndex, -1);
  throws(() => accessor.score, /bind a shooter snapshot/);
  throws(() => {
    accessor.health = 3;
  }, /bind a shooter snapshot/);
  equal(entityFloats[shooterLayout.fieldOffsets.entityFloats.health], 9);
});
