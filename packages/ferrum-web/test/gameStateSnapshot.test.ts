import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import type { BuiltInShooterStateSnapshot } from "../src/builtInShooterStateSnapshot.js";
import type { FerrumEngine } from "../src/createEngine.js";
import {
  captureGameStateSnapshot,
  GAME_STATE_SNAPSHOT_FORMAT,
  GAME_STATE_SNAPSHOT_VERSION,
  hashGameStateSnapshot,
  loadGameStateSnapshotFromStorage,
  parseGameStateSnapshot,
  removeGameStateSnapshotFromStorage,
  restoreGameStateSnapshot,
  saveGameStateSnapshotToStorage,
  stringifyGameStateSnapshot,
  type GameStateSnapshotStorage,
} from "../src/gameStateSnapshot.js";

test("game state snapshot captures runtime scene metrics and custom JSON", () => {
  const engine = fakeEngine({ score: 42, gameState: 1, entityCount: 8, spriteCount: 7, cameraX: 12, cameraY: -4 });
  const snapshot = captureGameStateSnapshot(engine, {
    frame: 12,
    customState: { checkpoint: "arena-2", flags: ["boss-open"] },
  });

  equal(snapshot.format, GAME_STATE_SNAPSHOT_FORMAT);
  equal(snapshot.version, GAME_STATE_SNAPSHOT_VERSION);
  equal(snapshot.frame, 12);
  equal(snapshot.scene.score, 42);
  deepEqual(snapshot.custom, { checkpoint: "arena-2", flags: ["boss-open"] });
  equal(snapshot.snapshotHash, hashGameStateSnapshot(snapshot));
});

test("game state snapshot stringify and parse validate deterministic hash", () => {
  const snapshot = captureGameStateSnapshot(fakeEngine(), { customState: { coins: 3 } });
  const parsed = parseGameStateSnapshot(stringifyGameStateSnapshot(snapshot));
  equal(parsed.snapshotHash, snapshot.snapshotHash);
  deepEqual(parsed.scene, snapshot.scene);

  const tampered = { ...snapshot, scene: { ...snapshot.scene, score: 99 } };
  assertThrows(
    () => parseGameStateSnapshot(JSON.stringify(tampered)),
    /snapshotHash does not match snapshot contents/,
  );
});

test("game state snapshot storage helpers round-trip through localStorage compatible API", () => {
  const storage = memoryStorage();
  const snapshot = captureGameStateSnapshot(fakeEngine(), { frame: 4 });

  saveGameStateSnapshotToStorage(storage, "slot-1", snapshot);
  equal(loadGameStateSnapshotFromStorage(storage, "slot-1")?.snapshotHash, snapshot.snapshotHash);
  removeGameStateSnapshotFromStorage(storage, "slot-1");
  equal(loadGameStateSnapshotFromStorage(storage, "slot-1"), undefined);
});

test("game state restore applies custom state callback and reports scene snapshots", () => {
  const engine = fakeEngine({ score: 5, gameState: 1, entityCount: 2, spriteCount: 2, cameraX: 1, cameraY: 2 });
  const snapshot = captureGameStateSnapshot(engine, { customState: { checkpoint: "start" } });
  let restoredCustom: unknown;

  engine.setScene({ score: 10, cameraX: 20 });
  const result = restoreGameStateSnapshot(engine, snapshot, {
    applyCustomState: (customState) => {
      restoredCustom = customState;
    },
  });

  deepEqual(restoredCustom, { checkpoint: "start" });
  equal(result.customStateApplied, true);
  equal(result.builtInShooterStateApplied, false);
  equal(result.sceneBefore.score, 10);
  equal(result.sceneAfter.cameraX, 20);
});

test("game state snapshot captures and restores built-in shooter state", () => {
  const shooterState = fakeShooterState({ score: 7 });
  const engine = fakeEngine({ score: 7, shooterState });
  const snapshot = captureGameStateSnapshot(engine, {
    includeBuiltInShooterState: true,
  });

  deepEqual(snapshot.builtInShooter, shooterState);
  engine.setScene({ score: 0, shooterState: fakeShooterState({ score: 0 }) });
  const result = restoreGameStateSnapshot(engine, snapshot);

  equal(result.builtInShooterStateApplied, true);
  deepEqual(engine.captureShooterStateSnapshot(), shooterState);
});

test("game state snapshot rejects non-JSON custom state", () => {
  assertThrows(
    () => captureGameStateSnapshot(fakeEngine(), {
      customState: { invalid: Number.NaN } as never,
    }),
    /customState.invalid must be a finite number/,
  );
});

function assertThrows(fn: () => unknown, pattern: RegExp): void {
  try {
    fn();
  } catch (error) {
    ok(pattern.test(error instanceof Error ? error.message : String(error)));
    return;
  }
  throw new Error("expected function to throw");
}

function fakeEngine(initial: Partial<FakeScene> = {}): FerrumEngine & { setScene(scene: Partial<FakeScene>): void } {
  const scene: FakeScene = {
    score: initial.score ?? 0,
    gameState: initial.gameState ?? 0,
    entityCount: initial.entityCount ?? 1,
    spriteCount: initial.spriteCount ?? 1,
    cameraX: initial.cameraX ?? 0,
    cameraY: initial.cameraY ?? 0,
    shooterState: initial.shooterState ?? fakeShooterState(),
  };
  return {
    score: () => scene.score,
    gameState: () => scene.gameState,
    entityCount: () => scene.entityCount,
    spriteCount: () => scene.spriteCount,
    cameraX: () => scene.cameraX,
    cameraY: () => scene.cameraY,
    captureShooterStateSnapshot: () => scene.shooterState,
    restoreShooterStateSnapshot: (snapshot) => {
      scene.shooterState = snapshot;
      scene.score = snapshot.headerU32s[2] ?? scene.score;
      return true;
    },
    setScene: (nextScene) => {
      Object.assign(scene, nextScene);
    },
  } as FerrumEngine & { setScene(scene: Partial<FakeScene>): void };
}

interface FakeScene {
  score: number;
  gameState: number;
  entityCount: number;
  spriteCount: number;
  cameraX: number;
  cameraY: number;
  shooterState: BuiltInShooterStateSnapshot;
}

function fakeShooterState(overrides: { score?: number } = {}): BuiltInShooterStateSnapshot {
  return {
    format: "ferrum2d.builtin-shooter-state",
    version: 1,
    headerFloats: [0, 1, 0, 0, 400, 240],
    headerU32s: [1, 1, overrides.score ?? 0, 0, 0, 0, 0, 0],
    entityFloats: [400, 240, 0, 0, 0, 0, 0],
    entityU32s: [0, 0],
    entityCount: 1,
    floatsPerEntity: 7,
    u32sPerEntity: 2,
  };
}

function memoryStorage(): GameStateSnapshotStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}
