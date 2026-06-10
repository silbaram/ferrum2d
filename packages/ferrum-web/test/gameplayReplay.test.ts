import { equal, deepEqual, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  BUILT_IN_SHOOTER_STATE_FLOATS_PER_ENTITY,
  BUILT_IN_SHOOTER_STATE_HEADER_U32S,
  BUILT_IN_SHOOTER_STATE_U32S_PER_ENTITY,
  BUILT_IN_SHOOTER_STATE_VERSION,
  type BuiltInShooterStateSnapshot,
} from "../src/builtInShooterStateSnapshot.js";
import type { FerrumEngine } from "../src/createEngine.js";
import { captureGameStateSnapshot } from "../src/gameStateSnapshot.js";
import {
  compareGameplayReplayRuns,
  createGameplayReplayRun,
  GAMEPLAY_REPLAY_RUN_FORMAT,
  GAMEPLAY_REPLAY_RUN_VERSION,
  hashGameplayReplayRun,
} from "../src/gameplayReplay.js";

test("gameplay replay run hashes canonical game state snapshot frames", () => {
  const run = createGameplayReplayRun([
    snapshotAt(0, { score: 0 }),
    snapshotAt(3, { score: 1 }),
  ]);

  equal(run.format, GAMEPLAY_REPLAY_RUN_FORMAT);
  equal(run.version, GAMEPLAY_REPLAY_RUN_VERSION);
  equal(run.snapshots.length, 2);
  equal(run.replayHash, hashGameplayReplayRun(run));
  equal(run.snapshots[1].replayHash, run.snapshots[1].snapshot.snapshotHash);
});

test("gameplay replay comparison reports machine-actionable first snapshot diff", () => {
  const expected = createGameplayReplayRun([
    snapshotAt(0, { score: 0 }),
    snapshotAt(2, { score: 4 }),
  ]);
  const actual = createGameplayReplayRun([
    snapshotAt(0, { score: 0 }),
    snapshotAt(2, { score: 5 }),
  ]);

  const comparison = compareGameplayReplayRuns(expected, actual);

  equal(comparison.passed, false);
  equal(comparison.firstMismatchFrame, 2);
  deepEqual(comparison.firstMismatch, {
    path: "gameplayReplay.snapshots.1.snapshot.builtInShooter.headerU32s.2",
    expected: 4,
    actual: 5,
  });
});

test("gameplay replay comparison formats bracket paths for non-identifier custom keys", () => {
  const expected = createGameplayReplayRun([
    snapshotAt(0, { customState: { "bad-key": 1 } }),
  ]);
  const actual = createGameplayReplayRun([
    snapshotAt(0, { customState: { "bad-key": 2 } }),
  ]);

  const comparison = compareGameplayReplayRuns(expected, actual);

  equal(comparison.passed, false);
  deepEqual(comparison.firstMismatch, {
    path: "gameplayReplay.snapshots.0.snapshot.custom[\"bad-key\"]",
    expected: 1,
    actual: 2,
  });
});

test("gameplay replay comparison passes for identical golden runs", () => {
  const run = createGameplayReplayRun([
    snapshotAt(0, { score: 0 }),
    snapshotAt(2, { score: 1 }),
  ]);

  const comparison = compareGameplayReplayRuns(run, run);

  equal(comparison.passed, true);
  equal(comparison.expectedHash, run.replayHash);
  equal(comparison.actualHash, run.replayHash);
  ok(comparison.firstMismatch === undefined);
});

test("gameplay replay run rejects missing and non-monotonic frame snapshots", () => {
  assertThrows(
    () => createGameplayReplayRun([]),
    /snapshots must include at least one snapshot/,
  );
  assertThrows(
    () => createGameplayReplayRun([
      snapshotAt(2, { score: 0 }),
      snapshotAt(2, { score: 1 }),
    ]),
    /frame must be strictly increasing/,
  );
});

test("gameplay replay run rejects empty or stale imported run artifacts", () => {
  assertThrows(
    () => hashGameplayReplayRun({
      format: GAMEPLAY_REPLAY_RUN_FORMAT,
      version: GAMEPLAY_REPLAY_RUN_VERSION,
      snapshots: [],
    }),
    /snapshots must include at least one snapshot/,
  );
  const run = createGameplayReplayRun([snapshotAt(0, { score: 0 })]);
  const staleRun = {
    ...run,
    replayHash: "00000000",
  };

  assertThrows(
    () => compareGameplayReplayRuns(staleRun, run),
    /replayHash must match the canonical run hash/,
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

function snapshotAt(frame: number, scene: Partial<FakeScene & { customState: { readonly [key: string]: number } }>) {
  return captureGameStateSnapshot(fakeEngine(scene), {
    frame,
    includeBuiltInShooterState: true,
    ...(scene.customState === undefined ? {} : { customState: scene.customState }),
  });
}

function fakeEngine(initial: Partial<FakeScene> = {}): FerrumEngine {
  const scene: FakeScene = {
    score: initial.score ?? 0,
    gameState: initial.gameState ?? 1,
    entityCount: initial.entityCount ?? 1,
    spriteCount: initial.spriteCount ?? 1,
    cameraX: initial.cameraX ?? 0,
    cameraY: initial.cameraY ?? 0,
  };
  return {
    score: () => scene.score,
    gameState: () => scene.gameState,
    entityCount: () => scene.entityCount,
    spriteCount: () => scene.spriteCount,
    cameraX: () => scene.cameraX,
    cameraY: () => scene.cameraY,
    captureShooterStateSnapshot: () => fakeShooterState(scene.score),
  } as FerrumEngine;
}

interface FakeScene {
  score: number;
  gameState: number;
  entityCount: number;
  spriteCount: number;
  cameraX: number;
  cameraY: number;
}

function fakeShooterState(score: number): BuiltInShooterStateSnapshot {
  return {
    format: "ferrum2d.builtin-shooter-state",
    version: BUILT_IN_SHOOTER_STATE_VERSION,
    headerFloats: [0, 1, 0, 0, 400, 240, 0, 0],
    headerU32s: [
      BUILT_IN_SHOOTER_STATE_VERSION,
      1,
      score,
      0,
      0,
      0,
      0,
      0,
      0,
      ...Array(BUILT_IN_SHOOTER_STATE_HEADER_U32S - 9).fill(0),
    ],
    entityFloats: [400, 240, 0, 0, 5, ...Array(BUILT_IN_SHOOTER_STATE_FLOATS_PER_ENTITY - 5).fill(0)],
    entityU32s: [0, ...Array(BUILT_IN_SHOOTER_STATE_U32S_PER_ENTITY - 1).fill(0)],
    entityCount: 1,
    floatsPerEntity: BUILT_IN_SHOOTER_STATE_FLOATS_PER_ENTITY,
    u32sPerEntity: BUILT_IN_SHOOTER_STATE_U32S_PER_ENTITY,
  };
}
