import {
  validateBuiltInShooterStateSnapshot,
  type BuiltInShooterStateSnapshot,
} from "./builtInShooterStateSnapshot.js";
import { applyDataSceneAuthoringDocument } from "./dataSceneRuntimeTarget.js";
import type { ApplyDataSceneAuthoringDocumentOptions } from "./dataSceneRuntimeTarget.js";
import {
  DATA_SCENE_VARIABLES_SNAPSHOT_KEY,
  dataSceneVariableStoreForEngine,
  resolveDataSceneVariableDeclarations,
  validateDataSceneVariableValues,
  type DataSceneVariableScope,
  type DataSceneVariableStore,
  type DataSceneVariableValue,
  type DataSceneVariableValues,
} from "./dataSceneVariables.js";
import type { FerrumEngine } from "./engineTypes.js";
import {
  GAME_STATE_CODE,
  resolveGameStateCode,
  type DataSceneGameState,
  type GameStateCode,
} from "./gameState.js";
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
export const GAME_STATE_SNAPSHOT_VERSION = 2;
export const DATA_SCENE_STATE_FORMAT = "ferrum2d.data-scene-state";
export const DATA_SCENE_STATE_VERSION = 2;

export type GameStateSnapshotJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly GameStateSnapshotJsonValue[]
  | { readonly [key: string]: GameStateSnapshotJsonValue };

export interface GameStateSceneSnapshot {
  readonly score: number;
  readonly gameState: GameStateCode;
  readonly entityCount: number;
  readonly spriteCount: number;
  readonly cameraX: number;
  readonly cameraY: number;
}

export interface DataSceneStateSnapshot {
  readonly format: typeof DATA_SCENE_STATE_FORMAT;
  readonly version: typeof DATA_SCENE_STATE_VERSION;
  readonly scene: GameStateSceneSnapshot;
  readonly authoringDocument?: GameStateSnapshotJsonValue;
  readonly custom?: GameStateSnapshotJsonValue;
}

export interface GameStateSnapshot {
  readonly format: typeof GAME_STATE_SNAPSHOT_FORMAT;
  readonly version: typeof GAME_STATE_SNAPSHOT_VERSION;
  readonly frame: number;
  readonly source: "ferrum-runtime";
  readonly scene: GameStateSceneSnapshot;
  readonly dataScene?: DataSceneStateSnapshot;
  readonly builtInShooter?: BuiltInShooterStateSnapshot;
  readonly physics?: PhysicsWorldSnapshot;
  readonly custom?: GameStateSnapshotJsonValue;
  readonly snapshotHash: string;
}

export interface CaptureGameStateSnapshotOptions {
  frame?: number;
  includeBuiltInShooterState?: boolean;
  includeDataSceneState?: boolean;
  physicsWorld?: PhysicsWorldApplyResult;
  dataSceneAuthoringDocument?: GameStateSnapshotJsonValue;
  dataSceneCustomState?: GameStateSnapshotJsonValue;
  customState?: GameStateSnapshotJsonValue;
}

export interface RestoreGameStateSnapshotOptions
  extends Pick<RestorePhysicsWorldSnapshotOptions, "path" | "unsafeUnitScaleThreshold" | "onWarning"> {
  physicsReplace?: PhysicsWorldApplyResult;
  restoreBuiltInShooterState?: boolean;
  restoreDataSceneState?: boolean;
  restoreDataSceneAuthoringDocument?: boolean;
  dataSceneAuthoringApplyOptions?: ApplyDataSceneAuthoringDocumentOptions;
  applyDataSceneCustomState?: (customState: GameStateSnapshotJsonValue) => void;
  applyCustomState?: (customState: GameStateSnapshotJsonValue) => void;
}

export interface GameStateSnapshotRestoreResult {
  readonly sourceSnapshot: GameStateSnapshot;
  readonly sceneBefore: GameStateSceneSnapshot;
  readonly sceneAfter: GameStateSceneSnapshot;
  readonly builtInShooterStateApplied: boolean;
  readonly dataSceneStateApplied?: boolean;
  readonly dataSceneAuthoringDocumentApplied?: boolean;
  readonly physicsWorld?: PhysicsWorldRestoreResult;
  readonly dataSceneVariables?: DataSceneVariableStore;
  readonly globalVariablesApplied?: boolean;
  readonly sceneVariablesApplied?: boolean;
  readonly dataSceneCustomStateApplied?: boolean;
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
  if (options.includeBuiltInShooterState === true && options.includeDataSceneState === true) {
    throw new Error("game state snapshot cannot include both built-in shooter state and data scene state.");
  }
  const frame = nonNegativeInteger(options.frame ?? 0, "game state snapshot frame");
  const scene = captureGameStateSceneSnapshot(engine);
  const dataSceneLifecycleState = options.includeDataSceneState === true
    ? requireActiveDataSceneLifecycleState(engine, scene)
    : undefined;
  const builtInShooter = options.includeBuiltInShooterState === true
    ? captureBuiltInShooterState(engine)
    : undefined;
  const variables = options.includeDataSceneState === true
    ? dataSceneVariableStoreForEngine(engine)
    : undefined;
  const globalVariableValues = variableValuesForSnapshot(variables, "global");
  const sceneVariableValues = options.includeDataSceneState === true
    ? variableValuesForSnapshot(variables, "scene")
    : undefined;
  const customState = customStateWithVariables(
    options.customState,
    globalVariableValues,
    "game state snapshot customState",
  );
  const dataSceneCustomState = options.includeDataSceneState === true
    ? customStateWithVariables(
        options.dataSceneCustomState,
        sceneVariableValues,
        "data scene state customState",
      )
    : undefined;
  const dataScene = dataSceneLifecycleState !== undefined
    ? captureDataSceneState(
        scene,
        dataSceneLifecycleState,
        options.dataSceneAuthoringDocument,
        dataSceneCustomState,
      )
    : undefined;
  const snapshot: Omit<GameStateSnapshot, "snapshotHash"> = {
    format: GAME_STATE_SNAPSHOT_FORMAT,
    version: GAME_STATE_SNAPSHOT_VERSION,
    frame,
    source: "ferrum-runtime",
    scene,
    ...(dataScene === undefined ? {} : { dataScene }),
    ...(builtInShooter === undefined ? {} : { builtInShooter }),
    ...(options.physicsWorld === undefined
      ? {}
      : { physics: capturePhysicsWorldSnapshot(engine, options.physicsWorld, { frame }) }),
    ...(customState === undefined
      ? {}
      : { custom: cloneJsonValue(customState, "game state snapshot customState") }),
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
  const snapshotPath = options.path ?? "gameState.snapshot";
  preflightDataSceneActivation(snapshot, options, snapshotPath);
  const globalVariableValues = snapshotVariableValues(
    snapshot.custom,
    `${snapshotPath}.custom`,
  );
  const sceneVariableValues = snapshotVariableValues(
    snapshot.dataScene?.custom,
    `${snapshotPath}.dataScene.custom`,
  );
  preflightDataSceneVariableRestore(
    engine,
    snapshot,
    options,
    globalVariableValues,
    sceneVariableValues,
    snapshotPath,
  );
  let builtInShooterStateApplied = false;
  let dataSceneStateApplied = false;
  let dataSceneAuthoringDocumentApplied = false;
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
        ...(snapshot.dataScene === undefined
          ? {}
          : { dataSceneStateApplied, dataSceneAuthoringDocumentApplied }),
        customStateApplied: false,
      };
    }
  }
  if (
    snapshot.dataScene !== undefined
    && options.restoreDataSceneState !== false
  ) {
    if (
      snapshot.dataScene.authoringDocument !== undefined
      && options.restoreDataSceneAuthoringDocument !== false
    ) {
      applyDataSceneAuthoringDocument(
        engine,
        snapshot.dataScene.authoringDocument,
        {
          path: `${options.path ?? "gameState.snapshot"}.dataScene.authoringDocument`,
          ...options.dataSceneAuthoringApplyOptions,
        },
      );
      dataSceneAuthoringDocumentApplied = true;
    } else {
      engine.useDataScene();
    }
    dataSceneStateApplied = true;
  }
  const physicsWorld = snapshot.physics === undefined
    ? undefined
    : restorePhysicsWorldSnapshot(engine, snapshot.physics, {
        path: options.path,
        replace: options.physicsReplace,
        unsafeUnitScaleThreshold: options.unsafeUnitScaleThreshold,
        onWarning: options.onWarning,
      });
  const dataSceneVariables = dataSceneVariableStoreForEngine(engine);
  let globalVariablesApplied = false;
  if (globalVariableValues !== undefined) {
    requireDataSceneVariableStore(dataSceneVariables, `${snapshotPath}.custom`)
      .restore("global", globalVariableValues);
    globalVariablesApplied = true;
  }
  let sceneVariablesApplied = false;
  if (sceneVariableValues !== undefined && dataSceneStateApplied) {
    requireDataSceneVariableStore(
      dataSceneVariables,
      `${snapshotPath}.dataScene.custom`,
    ).restore("scene", sceneVariableValues);
    sceneVariablesApplied = true;
  }
  if (dataSceneStateApplied && snapshot.dataScene !== undefined) {
    restoreDataSceneLifecycleState(
      engine,
      snapshot.dataScene.scene.gameState,
      `${snapshotPath}.dataScene.scene.gameState`,
    );
  }
  const dataSceneCustomState = customStateWithoutVariables(snapshot.dataScene?.custom);
  let dataSceneCustomStateApplied = false;
  if (
    dataSceneCustomState !== undefined
    && dataSceneStateApplied
    && options.applyDataSceneCustomState !== undefined
  ) {
    options.applyDataSceneCustomState(cloneJsonValue(
      dataSceneCustomState,
      "game state snapshot dataScene custom",
    ));
    dataSceneCustomStateApplied = true;
  }
  const customState = customStateWithoutVariables(snapshot.custom);
  let customStateApplied = false;
  if (customState !== undefined && options.applyCustomState !== undefined) {
    options.applyCustomState(cloneJsonValue(customState, "game state snapshot custom"));
    customStateApplied = true;
  }
  return {
    sourceSnapshot: snapshot,
    sceneBefore,
    sceneAfter: captureGameStateSceneSnapshot(engine),
    builtInShooterStateApplied,
    ...(snapshot.dataScene === undefined
      ? {}
      : {
          dataSceneStateApplied,
          dataSceneAuthoringDocumentApplied,
          dataSceneCustomStateApplied,
        }),
    ...(dataSceneVariables === undefined
        || (globalVariableValues === undefined && sceneVariableValues === undefined)
      ? {}
      : { dataSceneVariables }),
    ...(globalVariableValues === undefined ? {} : { globalVariablesApplied }),
    ...(sceneVariableValues === undefined ? {} : { sceneVariablesApplied }),
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
    ...(snapshotWithOptionalHash.dataScene === undefined
      ? {}
      : { dataScene: snapshotWithOptionalHash.dataScene }),
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
  if (snapshot.builtInShooter !== undefined && snapshot.dataScene !== undefined) {
    throw new Error(`${path} cannot contain both builtInShooter and dataScene state.`);
  }
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
  if (snapshot.dataScene !== undefined) {
    validateDataSceneStateSnapshot(snapshot.dataScene, `${path}.dataScene`);
    if (!sceneSnapshotsEqual(snapshot.scene as GameStateSceneSnapshot, snapshot.dataScene.scene)) {
      throw new Error(`${path}.dataScene.scene must match ${path}.scene.`);
    }
  }
  if (snapshot.custom !== undefined) {
    cloneJsonValue(snapshot.custom as GameStateSnapshotJsonValue, `${path}.custom`);
    snapshotVariableValues(
      snapshot.custom as GameStateSnapshotJsonValue,
      `${path}.custom`,
    );
  }
  if (typeof snapshot.snapshotHash !== "string" || snapshot.snapshotHash.length === 0) {
    throw new Error(`${path}.snapshotHash must be a non-empty string.`);
  }
  const expectedHash = hashGameStateSnapshot(snapshot as unknown as GameStateSnapshot);
  if (snapshot.snapshotHash !== expectedHash) {
    throw new Error(`${path}.snapshotHash does not match snapshot contents.`);
  }
}

export function validateDataSceneStateSnapshot(
  snapshot: unknown,
  path = "dataScene.snapshot",
): asserts snapshot is DataSceneStateSnapshot {
  if (!isRecord(snapshot)) {
    throw new Error(`${path} must be an object.`);
  }
  if (snapshot.format !== DATA_SCENE_STATE_FORMAT) {
    throw new Error(`${path}.format must be '${DATA_SCENE_STATE_FORMAT}'.`);
  }
  if (snapshot.version !== DATA_SCENE_STATE_VERSION) {
    throw new Error(`${path}.version must be ${DATA_SCENE_STATE_VERSION}.`);
  }
  validateSceneSnapshot(snapshot.scene, `${path}.scene`);
  if (!isDataSceneGameStateCode(snapshot.scene.gameState)) {
    throw new Error(`${path}.scene.gameState must be playing (1), paused (3), or levelComplete (4).`);
  }
  if (snapshot.authoringDocument !== undefined) {
    cloneJsonValue(
      snapshot.authoringDocument as GameStateSnapshotJsonValue,
      `${path}.authoringDocument`,
    );
  }
  if (snapshot.custom !== undefined) {
    cloneJsonValue(snapshot.custom as GameStateSnapshotJsonValue, `${path}.custom`);
    snapshotVariableValues(snapshot.custom as GameStateSnapshotJsonValue, `${path}.custom`);
  }
}

function captureGameStateSceneSnapshot(engine: FerrumEngine): GameStateSceneSnapshot {
  return {
    score: finiteNumber(engine.score(), "game state scene score"),
    gameState: resolveGameStateCode(engine.gameState(), "game state scene gameState"),
    entityCount: nonNegativeInteger(engine.entityCount(), "game state scene entityCount"),
    spriteCount: nonNegativeInteger(engine.spriteCount(), "game state scene spriteCount"),
    cameraX: finiteNumber(engine.cameraX(), "game state scene cameraX"),
    cameraY: finiteNumber(engine.cameraY(), "game state scene cameraY"),
  };
}

function captureDataSceneState(
  scene: GameStateSceneSnapshot,
  lifecycleState: DataSceneGameState,
  authoringDocument: GameStateSnapshotJsonValue | undefined,
  customState: GameStateSnapshotJsonValue | undefined,
): DataSceneStateSnapshot {
  if (scene.gameState !== GAME_STATE_CODE[lifecycleState]) {
    throw new Error("data scene lifecycle state must match the captured scene gameState.");
  }
  return {
    format: DATA_SCENE_STATE_FORMAT,
    version: DATA_SCENE_STATE_VERSION,
    scene: { ...scene },
    ...(authoringDocument === undefined
      ? {}
      : {
          authoringDocument: cloneJsonValue(
            authoringDocument,
            "data scene state authoringDocument",
          ),
        }),
    ...(customState === undefined
      ? {}
      : { custom: cloneJsonValue(customState, "data scene state customState") }),
  };
}

function requireActiveDataSceneLifecycleState(
  engine: FerrumEngine,
  scene: GameStateSceneSnapshot,
): DataSceneGameState {
  const lifecycleState = engine.dataSceneState();
  if (lifecycleState === undefined) {
    throw new Error("includeDataSceneState requires an active Data Scene.");
  }
  if (scene.gameState !== GAME_STATE_CODE[lifecycleState]) {
    throw new Error("active Data Scene lifecycle state must match scene.gameState.");
  }
  return lifecycleState;
}

function preflightDataSceneActivation(
  snapshot: GameStateSnapshot,
  options: RestoreGameStateSnapshotOptions,
  path: string,
): void {
  if (
    snapshot.dataScene !== undefined
    && snapshot.dataScene.authoringDocument !== undefined
    && options.restoreDataSceneState !== false
    && options.restoreDataSceneAuthoringDocument !== false
    && options.dataSceneAuthoringApplyOptions?.activateDataScene === false
  ) {
    throw new Error(
      `${path}.dataScene restore cannot disable Data Scene activation.`,
    );
  }
}

function variableValuesForSnapshot(
  store: DataSceneVariableStore | undefined,
  scope: DataSceneVariableScope,
): DataSceneVariableValues | undefined {
  if (store === undefined) {
    return undefined;
  }
  const values = store.values(scope);
  return Object.keys(values).length === 0 ? undefined : values;
}

function customStateWithVariables(
  customState: GameStateSnapshotJsonValue | undefined,
  variableValues: DataSceneVariableValues | undefined,
  path: string,
): GameStateSnapshotJsonValue | undefined {
  if (isRecord(customState)
    && Object.prototype.hasOwnProperty.call(customState, DATA_SCENE_VARIABLES_SNAPSHOT_KEY)) {
    throw new Error(`${path}.${DATA_SCENE_VARIABLES_SNAPSHOT_KEY} is reserved for declared Data Scene variables.`);
  }
  if (variableValues === undefined) {
    return customState;
  }
  if (customState === undefined) {
    return { [DATA_SCENE_VARIABLES_SNAPSHOT_KEY]: variableValues };
  }
  if (!isRecord(customState)) {
    throw new Error(`${path} must be an object when declared Data Scene variables are captured.`);
  }
  return {
    ...customState,
    [DATA_SCENE_VARIABLES_SNAPSHOT_KEY]: variableValues,
  };
}

function snapshotVariableValues(
  customState: GameStateSnapshotJsonValue | undefined,
  path: string,
): DataSceneVariableValues | undefined {
  if (!isRecord(customState)
    || !Object.prototype.hasOwnProperty.call(customState, DATA_SCENE_VARIABLES_SNAPSHOT_KEY)) {
    return undefined;
  }
  const values = customState[DATA_SCENE_VARIABLES_SNAPSHOT_KEY];
  if (!isRecord(values)) {
    throw new Error(`${path}.${DATA_SCENE_VARIABLES_SNAPSHOT_KEY} must be an object.`);
  }
  const resolved: Array<[string, DataSceneVariableValue]> = [];
  for (const [name, value] of Object.entries(values)) {
    if (name.length === 0 || name.trim() !== name) {
      throw new Error(
        `${path}.${DATA_SCENE_VARIABLES_SNAPSHOT_KEY} variable names must be non-empty without surrounding whitespace.`,
      );
    }
    if (typeof value === "boolean") {
      resolved.push([name, value]);
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`${path}.${DATA_SCENE_VARIABLES_SNAPSHOT_KEY}.${name} must be a finite number or boolean.`);
    }
    resolved.push([name, Object.is(value, -0) ? 0 : value]);
  }
  return Object.fromEntries(resolved);
}

function requireDataSceneVariableStore(
  store: DataSceneVariableStore | undefined,
  path: string,
): DataSceneVariableStore {
  if (store === undefined) {
    throw new Error(`${path}.${DATA_SCENE_VARIABLES_SNAPSHOT_KEY} requires restored Data Scene variable declarations.`);
  }
  return store;
}

function preflightDataSceneVariableRestore(
  engine: FerrumEngine,
  snapshot: GameStateSnapshot,
  options: RestoreGameStateSnapshotOptions,
  globalValues: DataSceneVariableValues | undefined,
  sceneValues: DataSceneVariableValues | undefined,
  path: string,
): void {
  const restoreDataScene = snapshot.dataScene !== undefined
    && options.restoreDataSceneState !== false;
  if (globalValues === undefined && (sceneValues === undefined || !restoreDataScene)) {
    return;
  }

  const authoringDocument = snapshot.dataScene?.authoringDocument;
  let declarations: ReturnType<typeof resolveDataSceneVariableDeclarations>;
  if (
    restoreDataScene
    && authoringDocument !== undefined
    && options.restoreDataSceneAuthoringDocument !== false
  ) {
    if (!isRecord(authoringDocument)) {
      return;
    }
    const authoringPath = options.dataSceneAuthoringApplyOptions?.path
      ?? `${path}.dataScene.authoringDocument`;
    declarations = resolveDataSceneVariableDeclarations(authoringDocument.variables, {
      path: `${authoringPath}.variables`,
    });
  } else {
    declarations = requireDataSceneVariableStore(
      dataSceneVariableStoreForEngine(engine),
      path,
    ).declarations();
  }

  if (globalValues !== undefined) {
    validateDataSceneVariableValues(
      declarations,
      "global",
      globalValues,
      `${path}.custom.${DATA_SCENE_VARIABLES_SNAPSHOT_KEY}`,
    );
  }
  if (sceneValues !== undefined && restoreDataScene) {
    validateDataSceneVariableValues(
      declarations,
      "scene",
      sceneValues,
      `${path}.dataScene.custom.${DATA_SCENE_VARIABLES_SNAPSHOT_KEY}`,
    );
  }
}

function customStateWithoutVariables(
  customState: GameStateSnapshotJsonValue | undefined,
): GameStateSnapshotJsonValue | undefined {
  if (!isGameStateSnapshotJsonObject(customState)
    || !Object.prototype.hasOwnProperty.call(customState, DATA_SCENE_VARIABLES_SNAPSHOT_KEY)) {
    return customState;
  }
  const entries = Object.entries(customState)
    .filter(([key]) => key !== DATA_SCENE_VARIABLES_SNAPSHOT_KEY);
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

function captureBuiltInShooterState(engine: FerrumEngine): BuiltInShooterStateSnapshot | undefined {
  const snapshot = engine.captureShooterStateSnapshot();
  if (snapshot !== undefined) {
    validateBuiltInShooterStateSnapshot(snapshot);
  }
  return snapshot;
}

function validateSceneSnapshot(
  value: unknown,
  path: string,
): asserts value is GameStateSceneSnapshot {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object.`);
  }
  finiteNumber(value.score, `${path}.score`);
  resolveGameStateCode(value.gameState, `${path}.gameState`);
  nonNegativeInteger(value.entityCount, `${path}.entityCount`);
  nonNegativeInteger(value.spriteCount, `${path}.spriteCount`);
  finiteNumber(value.cameraX, `${path}.cameraX`);
  finiteNumber(value.cameraY, `${path}.cameraY`);
}

function isDataSceneGameStateCode(value: unknown): boolean {
  return value === GAME_STATE_CODE.playing
    || value === GAME_STATE_CODE.paused
    || value === GAME_STATE_CODE.levelComplete;
}

function restoreDataSceneLifecycleState(
  engine: FerrumEngine,
  state: GameStateCode,
  path: string,
): void {
  switch (state) {
    case GAME_STATE_CODE.playing:
      if (engine.dataSceneState() !== "playing") {
        throw new Error(`${path} could not restore playing Data Scene state.`);
      }
      return;
    case GAME_STATE_CODE.paused:
      if (!engine.pauseDataScene()) {
        throw new Error(`${path} could not restore paused Data Scene state.`);
      }
      return;
    case GAME_STATE_CODE.levelComplete:
      if (!engine.completeDataScene()) {
        throw new Error(`${path} could not restore levelComplete Data Scene state.`);
      }
      return;
    case GAME_STATE_CODE.title:
    case GAME_STATE_CODE.gameOver:
      throw new Error(`${path} is not a Data Scene lifecycle state.`);
  }
}

function sceneSnapshotsEqual(left: GameStateSceneSnapshot, right: GameStateSceneSnapshot): boolean {
  return left.score === right.score
    && left.gameState === right.gameState
    && left.entityCount === right.entityCount
    && left.spriteCount === right.spriteCount
    && left.cameraX === right.cameraX
    && left.cameraY === right.cameraY;
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

function isGameStateSnapshotJsonObject(
  value: GameStateSnapshotJsonValue | undefined,
): value is { readonly [key: string]: GameStateSnapshotJsonValue } {
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
