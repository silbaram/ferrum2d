import {
  validateBuiltInShooterStateSnapshot,
  type BuiltInShooterStateSnapshot,
} from "./builtInShooterStateSnapshot.js";
import type { FerrumEngine } from "./engineTypes.js";
import type { PhysicsWorldApplyResult } from "./physicsAuthoring.js";
import {
  capturePhysicsWorldSnapshot,
  hashPhysicsWorldSnapshot,
  restorePhysicsWorldSnapshot,
  type PhysicsWorldRestoreResult,
  type PhysicsWorldSnapshot,
  type RestorePhysicsWorldSnapshotOptions,
} from "./physicsSnapshot.js";

export const GAME_STATE_SNAPSHOT_FORMAT = "ferrum2d.game-state.snapshot";
export const GAME_STATE_SNAPSHOT_VERSION = 1;

export type GameStateSnapshotJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly GameStateSnapshotJsonValue[]
  | { readonly [key: string]: GameStateSnapshotJsonValue };

export interface GameStateSceneSnapshot {
  readonly score: number;
  readonly gameState: number;
  readonly entityCount: number;
  readonly spriteCount: number;
  readonly cameraX: number;
  readonly cameraY: number;
}

export interface GameStateSnapshot {
  readonly format: typeof GAME_STATE_SNAPSHOT_FORMAT;
  readonly version: typeof GAME_STATE_SNAPSHOT_VERSION;
  readonly frame: number;
  readonly source: "ferrum-runtime";
  readonly scene: GameStateSceneSnapshot;
  readonly builtInShooter?: BuiltInShooterStateSnapshot;
  readonly physics?: PhysicsWorldSnapshot;
  readonly custom?: GameStateSnapshotJsonValue;
  readonly snapshotHash: string;
}

export interface CaptureGameStateSnapshotOptions {
  frame?: number;
  includeBuiltInShooterState?: boolean;
  physicsWorld?: PhysicsWorldApplyResult;
  customState?: GameStateSnapshotJsonValue;
}

export interface RestoreGameStateSnapshotOptions
  extends Pick<RestorePhysicsWorldSnapshotOptions, "path" | "unsafeUnitScaleThreshold" | "onWarning"> {
  physicsReplace?: PhysicsWorldApplyResult;
  restoreBuiltInShooterState?: boolean;
  applyCustomState?: (customState: GameStateSnapshotJsonValue) => void;
}

export interface GameStateSnapshotRestoreResult {
  readonly sourceSnapshot: GameStateSnapshot;
  readonly sceneBefore: GameStateSceneSnapshot;
  readonly sceneAfter: GameStateSceneSnapshot;
  readonly builtInShooterStateApplied: boolean;
  readonly physicsWorld?: PhysicsWorldRestoreResult;
  readonly customStateApplied: boolean;
}

export interface GameStateSnapshotStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function captureGameStateSnapshot(
  engine: FerrumEngine,
  options: CaptureGameStateSnapshotOptions = {},
): GameStateSnapshot {
  const frame = nonNegativeInteger(options.frame ?? 0, "game state snapshot frame");
  const builtInShooter = options.includeBuiltInShooterState === true
    ? captureBuiltInShooterState(engine)
    : undefined;
  const snapshot: Omit<GameStateSnapshot, "snapshotHash"> = {
    format: GAME_STATE_SNAPSHOT_FORMAT,
    version: GAME_STATE_SNAPSHOT_VERSION,
    frame,
    source: "ferrum-runtime",
    scene: captureGameStateSceneSnapshot(engine),
    ...(builtInShooter === undefined ? {} : { builtInShooter }),
    ...(options.physicsWorld === undefined
      ? {}
      : { physics: capturePhysicsWorldSnapshot(engine, options.physicsWorld, { frame }) }),
    ...(options.customState === undefined
      ? {}
      : { custom: cloneJsonValue(options.customState, "game state snapshot customState") }),
  };
  return {
    ...snapshot,
    snapshotHash: hashGameStateSnapshot(snapshot),
  };
}

export function restoreGameStateSnapshot(
  engine: FerrumEngine,
  snapshot: GameStateSnapshot,
  options: RestoreGameStateSnapshotOptions = {},
): GameStateSnapshotRestoreResult {
  validateGameStateSnapshot(snapshot);
  const sceneBefore = captureGameStateSceneSnapshot(engine);
  let builtInShooterStateApplied = false;
  if (
    snapshot.builtInShooter !== undefined
    && options.restoreBuiltInShooterState !== false
  ) {
    builtInShooterStateApplied = engine.restoreShooterStateSnapshot(snapshot.builtInShooter);
    if (!builtInShooterStateApplied) {
      return {
        sourceSnapshot: snapshot,
        sceneBefore,
        sceneAfter: captureGameStateSceneSnapshot(engine),
        builtInShooterStateApplied,
        customStateApplied: false,
      };
    }
  }
  const physicsWorld = snapshot.physics === undefined
    ? undefined
    : restorePhysicsWorldSnapshot(engine, snapshot.physics, {
        path: options.path,
        replace: options.physicsReplace,
        unsafeUnitScaleThreshold: options.unsafeUnitScaleThreshold,
        onWarning: options.onWarning,
      });
  let customStateApplied = false;
  if (snapshot.custom !== undefined && options.applyCustomState !== undefined) {
    options.applyCustomState(cloneJsonValue(snapshot.custom, "game state snapshot custom"));
    customStateApplied = true;
  }
  return {
    sourceSnapshot: snapshot,
    sceneBefore,
    sceneAfter: captureGameStateSceneSnapshot(engine),
    builtInShooterStateApplied,
    ...(physicsWorld === undefined ? {} : { physicsWorld }),
    customStateApplied,
  };
}

export function hashGameStateSnapshot(
  snapshot: Omit<GameStateSnapshot, "snapshotHash"> | GameStateSnapshot,
): string {
  const snapshotWithOptionalHash = snapshot as Partial<GameStateSnapshot>;
  const canonical = {
    format: snapshot.format,
    version: snapshot.version,
    frame: snapshot.frame,
    source: snapshot.source,
    scene: snapshot.scene,
    ...(snapshotWithOptionalHash.builtInShooter === undefined
      ? {}
      : { builtInShooter: snapshotWithOptionalHash.builtInShooter }),
    ...(snapshotWithOptionalHash.physics === undefined
      ? {}
      : {
          physicsReplayHash: snapshotWithOptionalHash.physics.replayHash,
          physics: snapshotWithOptionalHash.physics,
        }),
    ...(snapshotWithOptionalHash.custom === undefined ? {} : { custom: snapshotWithOptionalHash.custom }),
  };
  return fnv1a32(stableStringify(canonical));
}

export function stringifyGameStateSnapshot(snapshot: GameStateSnapshot): string {
  validateGameStateSnapshot(snapshot);
  return JSON.stringify(snapshot);
}

export function parseGameStateSnapshot(json: string, path = "gameState.snapshot"): GameStateSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(`${path} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  validateGameStateSnapshot(parsed, path);
  return parsed;
}

export function saveGameStateSnapshotToStorage(
  storage: GameStateSnapshotStorage,
  key: string,
  snapshot: GameStateSnapshot,
): void {
  storage.setItem(storageKey(key), stringifyGameStateSnapshot(snapshot));
}

export function loadGameStateSnapshotFromStorage(
  storage: GameStateSnapshotStorage,
  key: string,
): GameStateSnapshot | undefined {
  const json = storage.getItem(storageKey(key));
  if (json === null) {
    return undefined;
  }
  return parseGameStateSnapshot(json, `localStorage.${key}`);
}

export function removeGameStateSnapshotFromStorage(
  storage: GameStateSnapshotStorage,
  key: string,
): void {
  storage.removeItem(storageKey(key));
}

export function validateGameStateSnapshot(
  snapshot: unknown,
  path = "gameState.snapshot",
): asserts snapshot is GameStateSnapshot {
  if (!isRecord(snapshot)) {
    throw new Error(`${path} must be an object.`);
  }
  if (snapshot.format !== GAME_STATE_SNAPSHOT_FORMAT) {
    throw new Error(`${path}.format must be '${GAME_STATE_SNAPSHOT_FORMAT}'.`);
  }
  if (snapshot.version !== GAME_STATE_SNAPSHOT_VERSION) {
    throw new Error(`${path}.version must be ${GAME_STATE_SNAPSHOT_VERSION}.`);
  }
  nonNegativeInteger(snapshot.frame, `${path}.frame`);
  if (snapshot.source !== "ferrum-runtime") {
    throw new Error(`${path}.source must be 'ferrum-runtime'.`);
  }
  validateSceneSnapshot(snapshot.scene, `${path}.scene`);
  if (snapshot.physics !== undefined) {
    if (!isRecord(snapshot.physics)) {
      throw new Error(`${path}.physics must be an object.`);
    }
    const physics = snapshot.physics as unknown as PhysicsWorldSnapshot;
    const replayHash = hashPhysicsWorldSnapshot(physics);
    if (snapshot.physics.replayHash !== replayHash) {
      throw new Error(`${path}.physics.replayHash does not match snapshot contents.`);
    }
  }
  if (snapshot.builtInShooter !== undefined) {
    validateBuiltInShooterStateSnapshot(snapshot.builtInShooter as BuiltInShooterStateSnapshot);
  }
  if (snapshot.custom !== undefined) {
    cloneJsonValue(snapshot.custom as GameStateSnapshotJsonValue, `${path}.custom`);
  }
  if (typeof snapshot.snapshotHash !== "string" || snapshot.snapshotHash.length === 0) {
    throw new Error(`${path}.snapshotHash must be a non-empty string.`);
  }
  const expectedHash = hashGameStateSnapshot(snapshot as unknown as GameStateSnapshot);
  if (snapshot.snapshotHash !== expectedHash) {
    throw new Error(`${path}.snapshotHash does not match snapshot contents.`);
  }
}

function captureGameStateSceneSnapshot(engine: FerrumEngine): GameStateSceneSnapshot {
  return {
    score: finiteNumber(engine.score(), "game state scene score"),
    gameState: nonNegativeInteger(engine.gameState(), "game state scene gameState"),
    entityCount: nonNegativeInteger(engine.entityCount(), "game state scene entityCount"),
    spriteCount: nonNegativeInteger(engine.spriteCount(), "game state scene spriteCount"),
    cameraX: finiteNumber(engine.cameraX(), "game state scene cameraX"),
    cameraY: finiteNumber(engine.cameraY(), "game state scene cameraY"),
  };
}

function captureBuiltInShooterState(engine: FerrumEngine): BuiltInShooterStateSnapshot | undefined {
  const snapshot = engine.captureShooterStateSnapshot();
  if (snapshot !== undefined) {
    validateBuiltInShooterStateSnapshot(snapshot);
  }
  return snapshot;
}

function validateSceneSnapshot(value: unknown, path: string): void {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object.`);
  }
  finiteNumber(value.score, `${path}.score`);
  nonNegativeInteger(value.gameState, `${path}.gameState`);
  nonNegativeInteger(value.entityCount, `${path}.entityCount`);
  nonNegativeInteger(value.spriteCount, `${path}.spriteCount`);
  finiteNumber(value.cameraX, `${path}.cameraX`);
  finiteNumber(value.cameraY, `${path}.cameraY`);
}

function cloneJsonValue(value: GameStateSnapshotJsonValue, path: string): GameStateSnapshotJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return finiteNumber(value, path);
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => cloneJsonValue(entry, `${path}.${index}`));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneJsonValue(
        entry as GameStateSnapshotJsonValue,
        `${path}.${key}`,
      )]),
    );
  }
  throw new Error(`${path} must be JSON-compatible.`);
}

function storageKey(key: string): string {
  if (key.trim().length === 0) {
    throw new Error("game state storage key must be non-empty.");
  }
  return key;
}

function nonNegativeInteger(value: unknown, name: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return Number(value);
}

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
