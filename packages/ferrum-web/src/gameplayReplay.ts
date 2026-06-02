import {
  hashGameStateSnapshot,
  validateGameStateSnapshot,
  type GameStateSnapshot,
} from "./gameStateSnapshot.js";

export const GAMEPLAY_REPLAY_RUN_FORMAT = "ferrum2d.gameplay-replay.run";
export const GAMEPLAY_REPLAY_RUN_VERSION = 1;

export interface GameplayReplayFrameSnapshot {
  readonly frame: number;
  readonly snapshot: GameStateSnapshot;
  readonly replayHash: string;
}

export interface GameplayReplayRun {
  readonly format: typeof GAMEPLAY_REPLAY_RUN_FORMAT;
  readonly version: typeof GAMEPLAY_REPLAY_RUN_VERSION;
  readonly snapshots: readonly GameplayReplayFrameSnapshot[];
  readonly replayHash: string;
}

export interface CreateGameplayReplayRunOptions {
  path?: string;
}

export interface GameplayReplaySnapshotDiff {
  readonly path: string;
  readonly expected: unknown;
  readonly actual: unknown;
}

export interface GameplayReplayComparison {
  readonly passed: boolean;
  readonly expectedHash: string;
  readonly actualHash: string;
  readonly firstMismatchFrame?: number;
  readonly firstMismatch?: GameplayReplaySnapshotDiff;
}

export function createGameplayReplayRun(
  snapshots: readonly GameStateSnapshot[],
  options: CreateGameplayReplayRunOptions = {},
): GameplayReplayRun {
  const path = options.path ?? "gameplayReplay";
  if (!Array.isArray(snapshots)) {
    throw new Error(`${path}.snapshots must be an array.`);
  }
  if (snapshots.length === 0) {
    throw new Error(`${path}.snapshots must include at least one snapshot.`);
  }
  let previousFrame = -1;
  const frameSnapshots = snapshots.map((snapshot, index) => {
    const snapshotPath = `${path}.snapshots.${index}`;
    validateGameStateSnapshot(snapshot, snapshotPath);
    const frame = nonNegativeInteger(snapshot.frame, `${snapshotPath}.frame`);
    if (frame <= previousFrame) {
      throw new Error(`${snapshotPath}.frame must be strictly increasing.`);
    }
    previousFrame = frame;
    return {
      frame,
      snapshot,
      replayHash: hashGameStateSnapshot(snapshot),
    };
  });
  const run: Omit<GameplayReplayRun, "replayHash"> = {
    format: GAMEPLAY_REPLAY_RUN_FORMAT,
    version: GAMEPLAY_REPLAY_RUN_VERSION,
    snapshots: frameSnapshots,
  };
  return {
    ...run,
    replayHash: hashGameplayReplayRun(run),
  };
}

export function hashGameplayReplayRun(
  run: Omit<GameplayReplayRun, "replayHash"> | GameplayReplayRun,
): string {
  validateGameplayReplayRunShape(run);
  return gameplayReplayRunHashValue(run);
}

export function compareGameplayReplayRuns(
  expected: GameplayReplayRun,
  actual: GameplayReplayRun,
): GameplayReplayComparison {
  const expectedHash = hashGameplayReplayRun(expected);
  const actualHash = hashGameplayReplayRun(actual);
  if (expectedHash === actualHash) {
    return {
      passed: true,
      expectedHash,
      actualHash,
    };
  }
  const mismatch = firstReplayMismatch(expected, actual);
  return {
    passed: false,
    expectedHash,
    actualHash,
    ...(mismatch?.frame === undefined ? {} : { firstMismatchFrame: mismatch.frame }),
    ...(mismatch?.diff === undefined ? {} : { firstMismatch: mismatch.diff }),
  };
}

function firstReplayMismatch(
  expected: GameplayReplayRun,
  actual: GameplayReplayRun,
): { frame?: number; diff?: GameplayReplaySnapshotDiff } | undefined {
  const maxLength = Math.max(expected.snapshots.length, actual.snapshots.length);
  for (let index = 0; index < maxLength; index += 1) {
    const expectedEntry = expected.snapshots[index];
    const actualEntry = actual.snapshots[index];
    if (expectedEntry === undefined || actualEntry === undefined) {
      return {
        frame: expectedEntry?.frame ?? actualEntry?.frame,
        diff: {
          path: `gameplayReplay.snapshots.${index}`,
          expected: expectedEntry === undefined ? undefined : { frame: expectedEntry.frame, replayHash: expectedEntry.replayHash },
          actual: actualEntry === undefined ? undefined : { frame: actualEntry.frame, replayHash: actualEntry.replayHash },
        },
      };
    }
    if (expectedEntry.frame !== actualEntry.frame) {
      return {
        frame: expectedEntry.frame,
        diff: {
          path: `gameplayReplay.snapshots.${index}.frame`,
          expected: expectedEntry.frame,
          actual: actualEntry.frame,
        },
      };
    }
    if (expectedEntry.replayHash !== actualEntry.replayHash) {
      return {
        frame: expectedEntry.frame,
        diff: firstValueDiff(
          expectedEntry.snapshot,
          actualEntry.snapshot,
          `gameplayReplay.snapshots.${index}.snapshot`,
        ) ?? {
          path: `gameplayReplay.snapshots.${index}.replayHash`,
          expected: expectedEntry.replayHash,
          actual: actualEntry.replayHash,
        },
      };
    }
  }
  return undefined;
}

function validateGameplayReplayRunShape(
  run: Omit<GameplayReplayRun, "replayHash"> | GameplayReplayRun,
): void {
  if (!isRecord(run)) {
    throw new Error("gameplayReplay must be an object.");
  }
  if (run.format !== GAMEPLAY_REPLAY_RUN_FORMAT) {
    throw new Error(`gameplayReplay.format must be '${GAMEPLAY_REPLAY_RUN_FORMAT}'.`);
  }
  if (run.version !== GAMEPLAY_REPLAY_RUN_VERSION) {
    throw new Error(`gameplayReplay.version must be ${GAMEPLAY_REPLAY_RUN_VERSION}.`);
  }
  if (!Array.isArray(run.snapshots)) {
    throw new Error("gameplayReplay.snapshots must be an array.");
  }
  if (run.snapshots.length === 0) {
    throw new Error("gameplayReplay.snapshots must include at least one snapshot.");
  }
  let previousFrame = -1;
  run.snapshots.forEach((entry, index) => {
    const path = `gameplayReplay.snapshots.${index}`;
    if (!isRecord(entry)) {
      throw new Error(`${path} must be an object.`);
    }
    const frame = nonNegativeInteger(entry.frame, `${path}.frame`);
    if (frame <= previousFrame) {
      throw new Error(`${path}.frame must be strictly increasing.`);
    }
    previousFrame = frame;
    validateGameStateSnapshot(entry.snapshot, `${path}.snapshot`);
    const expectedHash = hashGameStateSnapshot(entry.snapshot);
    if (entry.replayHash !== expectedHash) {
      throw new Error(`${path}.replayHash must match the canonical snapshot hash.`);
    }
  });
  if ("replayHash" in run) {
    if (typeof run.replayHash !== "string" || run.replayHash.length === 0) {
      throw new Error("gameplayReplay.replayHash must be a non-empty string.");
    }
    const expectedHash = gameplayReplayRunHashValue(run);
    if (run.replayHash !== expectedHash) {
      throw new Error("gameplayReplay.replayHash must match the canonical run hash.");
    }
  }
}

function firstValueDiff(expected: unknown, actual: unknown, path: string): GameplayReplaySnapshotDiff | undefined {
  if (Object.is(expected, actual)) {
    return undefined;
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      return { path, expected, actual };
    }
    const maxLength = Math.max(expected.length, actual.length);
    for (let index = 0; index < maxLength; index += 1) {
      const diff = firstValueDiff(expected[index], actual[index], `${path}.${index}`);
      if (diff !== undefined) {
        return diff;
      }
    }
    return undefined;
  }
  if (isRecord(expected) || isRecord(actual)) {
    if (!isRecord(expected) || !isRecord(actual)) {
      return { path, expected, actual };
    }
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
    for (const key of keys) {
      const diff = firstValueDiff(
        expected[key],
        actual[key],
        `${path}${jsonPathSegment(key)}`,
      );
      if (diff !== undefined) {
        return diff;
      }
    }
    return undefined;
  }
  return { path, expected, actual };
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${path} must be a non-negative integer.`);
  }
  return value as number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function jsonPathSegment(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `.${key}`
    : `[${JSON.stringify(key)}]`;
}

function gameplayReplayRunHashValue(
  run: Omit<GameplayReplayRun, "replayHash"> | GameplayReplayRun,
): string {
  return fnv1a32(stableStringify({
    format: run.format,
    version: run.version,
    snapshots: run.snapshots.map((entry) => ({
      frame: entry.frame,
      replayHash: entry.replayHash,
    })),
  }));
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
