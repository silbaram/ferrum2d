import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  BUILT_IN_SHOOTER_STATE_FLOATS_PER_ENTITY,
  BUILT_IN_SHOOTER_STATE_HEADER_U32S,
  BUILT_IN_SHOOTER_STATE_U32S_PER_ENTITY,
  BUILT_IN_SHOOTER_STATE_VERSION,
  validateBuiltInShooterStateSnapshot,
  type BuiltInShooterStateSnapshot,
} from "../src/builtInShooterStateSnapshot.js";
import type { FerrumEngine } from "../src/createEngine.js";
import {
  captureGameStateSnapshot,
  DATA_SCENE_STATE_FORMAT,
  DATA_SCENE_STATE_VERSION,
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

test("game state snapshot captures data scene state separately from built-in shooter state", () => {
  const engine = fakeEngine({ score: 0, gameState: 1, entityCount: 0, spriteCount: 0, cameraX: 24, cameraY: 12 });
  const snapshot = captureGameStateSnapshot(engine, {
    frame: 3,
    includeDataSceneState: true,
    dataSceneCustomState: { sceneId: "blank-arena" },
  });

  equal(snapshot.dataScene?.format, DATA_SCENE_STATE_FORMAT);
  equal(snapshot.dataScene?.version, DATA_SCENE_STATE_VERSION);
  deepEqual(snapshot.dataScene?.scene, snapshot.scene);
  deepEqual(snapshot.dataScene?.custom, { sceneId: "blank-arena" });
  equal(snapshot.builtInShooter, undefined);
  equal(snapshot.snapshotHash, hashGameStateSnapshot(snapshot));
});

test("game state snapshot rejects mixed built-in shooter and data scene payloads", () => {
  assertThrows(
    () => captureGameStateSnapshot(fakeEngine(), {
      includeBuiltInShooterState: true,
      includeDataSceneState: true,
    }),
    /cannot include both built-in shooter state and data scene state/,
  );
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

test("game state restore aborts side effects when built-in shooter restore fails", () => {
  const shooterState = fakeShooterState({ score: 7 });
  const engine = fakeEngine({ score: 7, shooterState });
  const snapshot = captureGameStateSnapshot(engine, {
    includeBuiltInShooterState: true,
    customState: { checkpoint: "after-boss" },
  });
  let restoredCustom: unknown;

  engine.setScene({
    score: 0,
    shooterState: fakeShooterState({ score: 0 }),
    restoreShooterStateSnapshotResult: false,
  });
  const result = restoreGameStateSnapshot(engine, snapshot, {
    applyCustomState: (customState) => {
      restoredCustom = customState;
    },
  });

  equal(result.builtInShooterStateApplied, false);
  equal(result.customStateApplied, false);
  equal(restoredCustom, undefined);
  equal(result.sceneAfter.score, 0);
  deepEqual(engine.captureShooterStateSnapshot(), fakeShooterState({ score: 0 }));
});

test("game state restore switches to data scene and applies data scene custom state", () => {
  const snapshot = captureGameStateSnapshot(fakeEngine({ score: 0, gameState: 1, entityCount: 0, spriteCount: 0 }), {
    includeDataSceneState: true,
    dataSceneCustomState: { checkpoint: "data-start" },
  });
  const engine = fakeEngine({ score: 30, gameState: 2, entityCount: 4, spriteCount: 4, cameraX: 8, cameraY: 9 });
  let restoredDataCustom: unknown;

  const result = restoreGameStateSnapshot(engine, snapshot, {
    applyDataSceneCustomState: (customState) => {
      restoredDataCustom = customState;
    },
  });

  equal(engine.dataSceneActivations(), 1);
  equal(result.dataSceneStateApplied, true);
  equal(result.dataSceneCustomStateApplied, true);
  equal(result.builtInShooterStateApplied, false);
  deepEqual(restoredDataCustom, { checkpoint: "data-start" });
  equal(result.sceneAfter.gameState, 1);
});

test("built-in shooter state validation rejects header version mismatch", () => {
  const shooterState = fakeShooterState();

  assertThrows(
    () =>
      validateBuiltInShooterStateSnapshot({
        ...shooterState,
        headerU32s: [6, ...shooterState.headerU32s.slice(1)],
      }),
    /headerU32s\.0 must match version/,
  );
});

test("built-in shooter state validation rejects legacy v16 snapshots", () => {
  const shooterState = fakeShooterState();

  assertThrows(
    () =>
      validateBuiltInShooterStateSnapshot({
        ...shooterState,
        version: 16,
        headerU32s: [16, ...shooterState.headerU32s.slice(1)],
        floatsPerEntity: 75,
        u32sPerEntity: 61,
      } as unknown as BuiltInShooterStateSnapshot),
    /version must be 17/,
  );
});

test("built-in shooter state validation rejects legacy v11 layout sizes", () => {
  const shooterState = fakeShooterState();

  assertThrows(
    () =>
      validateBuiltInShooterStateSnapshot({
        ...shooterState,
        headerFloats: shooterState.headerFloats.slice(0, 6),
      }),
    /headerFloats length must be 8/,
  );
  assertThrows(
    () =>
      validateBuiltInShooterStateSnapshot({
        ...shooterState,
        headerU32s: shooterState.headerU32s.slice(0, 9),
      }),
    /headerU32s length must be 151/,
  );
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

function fakeEngine(
  initial: Partial<FakeScene> = {},
): FerrumEngine & { setScene(scene: Partial<FakeScene>): void; dataSceneActivations(): number } {
  const scene: FakeScene = {
    score: initial.score ?? 0,
    gameState: initial.gameState ?? 0,
    entityCount: initial.entityCount ?? 1,
    spriteCount: initial.spriteCount ?? 1,
    cameraX: initial.cameraX ?? 0,
    cameraY: initial.cameraY ?? 0,
    shooterState: initial.shooterState ?? fakeShooterState(),
    restoreShooterStateSnapshotResult: initial.restoreShooterStateSnapshotResult ?? true,
    dataSceneActivations: initial.dataSceneActivations ?? 0,
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
      if (!scene.restoreShooterStateSnapshotResult) {
        return false;
      }
      scene.shooterState = snapshot;
      scene.score = snapshot.headerU32s[2] ?? scene.score;
      return true;
    },
    useDataScene: () => {
      scene.dataSceneActivations += 1;
      scene.score = 0;
      scene.gameState = 1;
      scene.entityCount = 0;
      scene.spriteCount = 0;
      scene.cameraX = 0;
      scene.cameraY = 0;
    },
    setScene: (nextScene) => {
      Object.assign(scene, nextScene);
    },
    dataSceneActivations: () => scene.dataSceneActivations,
  } as FerrumEngine & { setScene(scene: Partial<FakeScene>): void; dataSceneActivations(): number };
}

interface FakeScene {
  score: number;
  gameState: number;
  entityCount: number;
  spriteCount: number;
  cameraX: number;
  cameraY: number;
  shooterState: BuiltInShooterStateSnapshot;
  restoreShooterStateSnapshotResult: boolean;
  dataSceneActivations: number;
}

function fakeShooterState(overrides: { score?: number } = {}): BuiltInShooterStateSnapshot {
  return {
    format: "ferrum2d.builtin-shooter-state",
    version: BUILT_IN_SHOOTER_STATE_VERSION,
    headerFloats: [0, 1, 0, 0, 400, 240, 0, 0],
    headerU32s: [
      BUILT_IN_SHOOTER_STATE_VERSION,
      1,
      overrides.score ?? 0,
      0,
      0,
      0,
      0,
      0,
      0,
      ...Array(BUILT_IN_SHOOTER_STATE_HEADER_U32S - 9).fill(0),
    ],
    entityFloats: [400, 240, 0, 0, ...Array(BUILT_IN_SHOOTER_STATE_FLOATS_PER_ENTITY - 4).fill(0)],
    entityU32s: [0, ...Array(BUILT_IN_SHOOTER_STATE_U32S_PER_ENTITY - 1).fill(0)],
    entityCount: 1,
    floatsPerEntity: BUILT_IN_SHOOTER_STATE_FLOATS_PER_ENTITY,
    u32sPerEntity: BUILT_IN_SHOOTER_STATE_U32S_PER_ENTITY,
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
