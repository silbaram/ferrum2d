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
  type GameStateSnapshotJsonValue,
} from "../src/gameStateSnapshot.js";
import {
  DATA_SCENE_VARIABLES_SNAPSHOT_KEY,
} from "../src/dataSceneVariables.js";
import {
  dataSceneGameStateFromCode,
  GAME_STATE_CODE,
  type GameStateCode,
} from "../src/gameState.js";
import {
  applyDataSceneAuthoringDocument,
  attachDataSceneRuntimeEngineAdapter,
  type DataSceneRuntimeSpawnRequest,
} from "../src/dataSceneRuntimeTarget.js";
import { attachMemoryDataSceneVariableRuntime } from "./dataSceneVariableRuntimeTestAdapter.js";

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
  const engine = fakeEngine({
    score: 0,
    gameState: 1,
    entityCount: 0,
    spriteCount: 0,
    cameraX: 24,
    cameraY: 12,
    dataSceneActive: true,
  });
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

test("game state snapshot hashes and restores Data Scene lifecycle state", () => {
  const source = fakeEngine({
    gameState: GAME_STATE_CODE.playing,
    entityCount: 1,
    spriteCount: 1,
    dataSceneActive: true,
  });
  const playing = captureGameStateSnapshot(source, {
    frame: 5,
    includeDataSceneState: true,
  });
  source.setScene({ gameState: GAME_STATE_CODE.paused });
  const paused = captureGameStateSnapshot(source, {
    frame: 5,
    includeDataSceneState: true,
  });
  source.setScene({ gameState: GAME_STATE_CODE.levelComplete });
  const levelComplete = captureGameStateSnapshot(source, {
    frame: 5,
    includeDataSceneState: true,
  });

  equal(playing.version, 2);
  equal(playing.dataScene?.version, 2);
  equal(playing.snapshotHash === paused.snapshotHash, false);
  equal(paused.snapshotHash === levelComplete.snapshotHash, false);

  const restored = fakeEngine({ gameState: GAME_STATE_CODE.gameOver });
  const result = restoreGameStateSnapshot(restored, paused);
  equal(restored.dataSceneState(), "paused");
  equal(result.sceneAfter.gameState, GAME_STATE_CODE.paused);

  const restoredComplete = fakeEngine({ gameState: GAME_STATE_CODE.gameOver });
  const completeResult = restoreGameStateSnapshot(restoredComplete, levelComplete);
  equal(restoredComplete.dataSceneState(), "levelComplete");
  equal(completeResult.sceneAfter.gameState, GAME_STATE_CODE.levelComplete);
});

test("game state snapshot rejects Data Scene capture outside active Data Scene mode", () => {
  assertThrows(
    () => captureGameStateSnapshot(fakeEngine({ gameState: GAME_STATE_CODE.playing }), {
      includeDataSceneState: true,
    }),
    /requires an active Data Scene/,
  );
});

test("data scene variables map to custom snapshot namespaces and restore deterministically", () => {
  const authoringDocument = sampleDataSceneAuthoringDocument();
  const sourceEngine = fakeEngine({ score: 0, gameState: 1, entityCount: 0, spriteCount: 0 });
  const sourceAdapter = new SnapshotDataSceneRuntimeAdapter(() => sourceEngine.useDataScene());
  const adaptedSource = attachMemoryDataSceneVariableRuntime(
    attachDataSceneRuntimeEngineAdapter(sourceEngine, sourceAdapter),
  );
  const applied = applyDataSceneAuthoringDocument(adaptedSource, authoringDocument);
  applied.variables.set("campaign.coins", 7);
  applied.variables.set("campaign.unlocked", true);
  applied.variables.set("wave.index", 3);

  const snapshotWithoutDataScene = captureGameStateSnapshot(adaptedSource, { frame: 8 });
  equal(snapshotWithoutDataScene.custom, undefined);
  equal(snapshotWithoutDataScene.dataScene, undefined);

  const snapshot = captureGameStateSnapshot(adaptedSource, {
    frame: 9,
    includeDataSceneState: true,
    dataSceneAuthoringDocument: authoringDocument,
    customState: { checkpoint: "level-1" },
    dataSceneCustomState: { sceneId: "level-1" },
  });
  deepEqual(snapshot.custom, {
    checkpoint: "level-1",
    [DATA_SCENE_VARIABLES_SNAPSHOT_KEY]: {
      "campaign.coins": 7,
      "campaign.unlocked": true,
    },
  });
  deepEqual(snapshot.dataScene?.custom, {
    sceneId: "level-1",
    [DATA_SCENE_VARIABLES_SNAPSHOT_KEY]: { "wave.index": 3 },
  });
  const parsedSnapshot = parseGameStateSnapshot(stringifyGameStateSnapshot(snapshot));
  equal(parsedSnapshot.snapshotHash, snapshot.snapshotHash);

  applied.variables.set("campaign.unlocked", false);
  applied.variables.set("campaign.coins", 0);
  applied.variables.set("campaign.coins", 7);
  applied.variables.set("campaign.unlocked", true);
  equal(captureGameStateSnapshot(adaptedSource, {
    frame: 9,
    includeDataSceneState: true,
    dataSceneAuthoringDocument: authoringDocument,
    customState: { checkpoint: "level-1" },
    dataSceneCustomState: { sceneId: "level-1" },
  }).snapshotHash, snapshot.snapshotHash);

  const restoredEngine = fakeEngine({ score: 10, gameState: 2, entityCount: 4, spriteCount: 4 });
  const restoredAdapter = new SnapshotDataSceneRuntimeAdapter(() => restoredEngine.useDataScene());
  const adaptedRestored = attachMemoryDataSceneVariableRuntime(
    attachDataSceneRuntimeEngineAdapter(restoredEngine, restoredAdapter),
  );
  let restoredCustom: unknown;
  let restoredDataSceneCustom: unknown;
  const result = restoreGameStateSnapshot(
    adaptedRestored,
    parsedSnapshot,
    {
      applyCustomState: (customState) => {
        restoredCustom = customState;
      },
      applyDataSceneCustomState: (customState) => {
        restoredDataSceneCustom = customState;
      },
    },
  );

  equal(result.globalVariablesApplied, true);
  equal(result.sceneVariablesApplied, true);
  equal(result.dataSceneVariables?.get("campaign.coins"), 7);
  equal(result.dataSceneVariables?.get("campaign.unlocked"), true);
  equal(result.dataSceneVariables?.get("wave.index"), 3);
  deepEqual(restoredCustom, { checkpoint: "level-1" });
  deepEqual(restoredDataSceneCustom, { sceneId: "level-1" });

  result.dataSceneVariables?.set("campaign.coins", 0);
  result.dataSceneVariables?.set("wave.index", 9);
  const globalScopeResult = restoreGameStateSnapshot(adaptedRestored, parsedSnapshot, {
    restoreDataSceneState: false,
  });
  equal(globalScopeResult.globalVariablesApplied, true);
  equal(globalScopeResult.sceneVariablesApplied, false);
  equal(globalScopeResult.dataSceneVariables?.get("campaign.coins"), 7);
  equal(globalScopeResult.dataSceneVariables?.get("wave.index"), 9);

  const variablesOnlySnapshot = captureGameStateSnapshot(adaptedSource, {
    frame: 10,
    includeDataSceneState: true,
    dataSceneAuthoringDocument: authoringDocument,
  });
  let consumerCustomCallbackCount = 0;
  const variablesOnlyResult = restoreGameStateSnapshot(adaptedRestored, variablesOnlySnapshot, {
    applyCustomState: () => {
      consumerCustomCallbackCount += 1;
    },
    applyDataSceneCustomState: () => {
      consumerCustomCallbackCount += 1;
    },
  });
  equal(consumerCustomCallbackCount, 0);
  equal(variablesOnlyResult.customStateApplied, false);
  equal(variablesOnlyResult.dataSceneCustomStateApplied, false);

  assertThrows(
    () => captureGameStateSnapshot(adaptedSource, {
      includeDataSceneState: true,
      customState: { [DATA_SCENE_VARIABLES_SNAPSHOT_KEY]: {} },
    }),
    /reserved for declared Data Scene variables/,
  );

  const tamperedWithoutHash = {
    ...snapshot,
    custom: {
      checkpoint: "level-1",
      [DATA_SCENE_VARIABLES_SNAPSHOT_KEY]: {
        "campaign.coins": 7,
        "campaign.unlocked": true,
        "campaign.unknown": 1,
      },
    },
  };
  const tampered = {
    ...tamperedWithoutHash,
    snapshotHash: hashGameStateSnapshot(tamperedWithoutHash),
  };
  const rejectedEngine = fakeEngine();
  const rejectedAdapter = new SnapshotDataSceneRuntimeAdapter(() => rejectedEngine.useDataScene());
  assertThrows(
    () => restoreGameStateSnapshot(
      attachDataSceneRuntimeEngineAdapter(rejectedEngine, rejectedAdapter),
      tampered,
    ),
    /undeclared global variable/,
  );
  equal(rejectedAdapter.useDataSceneCalls, 0);
  equal(rejectedAdapter.requests.length, 0);

  const invalidIntegerWithoutHash = {
    ...snapshot,
    custom: {
      checkpoint: "level-1",
      [DATA_SCENE_VARIABLES_SNAPSHOT_KEY]: {
        "campaign.coins": 7.5,
        "campaign.unlocked": true,
      },
    },
  };
  const invalidIntegerSnapshot = {
    ...invalidIntegerWithoutHash,
    snapshotHash: hashGameStateSnapshot(invalidIntegerWithoutHash),
  };
  const invalidIntegerEngine = fakeEngine();
  const invalidIntegerAdapter = new SnapshotDataSceneRuntimeAdapter(
    () => invalidIntegerEngine.useDataScene(),
  );
  assertThrows(
    () => restoreGameStateSnapshot(
      attachDataSceneRuntimeEngineAdapter(invalidIntegerEngine, invalidIntegerAdapter),
      invalidIntegerSnapshot,
    ),
    /must be a safe integer/,
  );
  equal(invalidIntegerAdapter.useDataSceneCalls, 0);
  equal(invalidIntegerAdapter.requests.length, 0);
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
  assertThrows(
    () => parseGameStateSnapshot(JSON.stringify({ ...snapshot, version: 1 })),
    /version must be 2/,
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
  const snapshot = captureGameStateSnapshot(fakeEngine({
    score: 0,
    gameState: 1,
    entityCount: 0,
    spriteCount: 0,
    dataSceneActive: true,
  }), {
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
  equal(result.dataSceneAuthoringDocumentApplied, false);
  equal(result.dataSceneCustomStateApplied, true);
  equal(result.builtInShooterStateApplied, false);
  deepEqual(restoredDataCustom, { checkpoint: "data-start" });
  equal(result.sceneAfter.gameState, 1);
});

test("game state restore reapplies data scene authoring document before custom state", () => {
  const authoringDocument = sampleDataSceneAuthoringDocument();
  const snapshot = captureGameStateSnapshot(fakeEngine({
    score: 0,
    gameState: 1,
    entityCount: 1,
    spriteCount: 1,
    dataSceneActive: true,
  }), {
    includeDataSceneState: true,
    dataSceneAuthoringDocument: authoringDocument,
    dataSceneCustomState: { checkpoint: "data-start" },
  });
  deepEqual(snapshot.dataScene?.authoringDocument, authoringDocument);

  const engine = fakeEngine({ score: 30, gameState: 2, entityCount: 4, spriteCount: 4, cameraX: 8, cameraY: 9 });
  const adapter = new SnapshotDataSceneRuntimeAdapter(
    () => engine.useDataScene(),
    (_request, count) => {
      engine.setScene({ entityCount: count, spriteCount: count });
    },
  );
  const adaptedEngine = attachMemoryDataSceneVariableRuntime(
    attachDataSceneRuntimeEngineAdapter(engine, adapter),
  );
  let restoredDataCustom: unknown;

  const result = restoreGameStateSnapshot(adaptedEngine, snapshot, {
    dataSceneAuthoringApplyOptions: {
      textureId: (name) => name.length,
    },
    applyDataSceneCustomState: (customState) => {
      restoredDataCustom = customState;
    },
  });

  equal(adapter.useDataSceneCalls, 1);
  equal(engine.dataSceneActivations(), 1);
  equal(adapter.requests.length, 1);
  equal(adapter.requests[0].x, 32);
  equal(adapter.requests[0].y, 48);
  equal(adapter.requests[0].textureId, "crate".length);
  equal(adapter.requests[0].spriteWidth, 16);
  equal(adapter.requests[0].spriteHeight, 12);
  equal(adapter.requests[0].colliderType, 0);
  equal(result.dataSceneStateApplied, true);
  equal(result.dataSceneAuthoringDocumentApplied, true);
  equal(result.dataSceneCustomStateApplied, true);
  equal(result.sceneAfter.entityCount, 1);
  equal(result.sceneAfter.spriteCount, 1);
  deepEqual(restoredDataCustom, { checkpoint: "data-start" });
});

test("game state restore rejects authoring activation opt-out before mutating runtime", () => {
  const authoringDocument = sampleDataSceneAuthoringDocument();
  const snapshot = captureGameStateSnapshot(fakeEngine({
    gameState: GAME_STATE_CODE.playing,
    entityCount: 1,
    spriteCount: 1,
    dataSceneActive: true,
  }), {
    includeDataSceneState: true,
    dataSceneAuthoringDocument: authoringDocument,
  });
  const engine = fakeEngine({ gameState: GAME_STATE_CODE.gameOver });
  const adapter = new SnapshotDataSceneRuntimeAdapter(() => engine.useDataScene());

  assertThrows(
    () => restoreGameStateSnapshot(
      attachDataSceneRuntimeEngineAdapter(engine, adapter),
      snapshot,
      { dataSceneAuthoringApplyOptions: { activateDataScene: false } },
    ),
    /restore cannot disable Data Scene activation/,
  );
  equal(adapter.useDataSceneCalls, 0);
  equal(adapter.requests.length, 0);
  equal(engine.dataSceneActivations(), 0);
  equal(engine.gameState(), GAME_STATE_CODE.gameOver);
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

test("built-in shooter state validation rejects legacy v17 snapshots", () => {
  const shooterState = fakeShooterState();

  assertThrows(
    () =>
      validateBuiltInShooterStateSnapshot({
        ...shooterState,
        version: 17,
        headerU32s: [17, ...shooterState.headerU32s.slice(1)],
        floatsPerEntity: 75,
        u32sPerEntity: 61,
      } as unknown as BuiltInShooterStateSnapshot),
    /version must be 19/,
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
    /headerU32s length must be 471/,
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
    gameState: initial.gameState ?? GAME_STATE_CODE.title,
    entityCount: initial.entityCount ?? 1,
    spriteCount: initial.spriteCount ?? 1,
    cameraX: initial.cameraX ?? 0,
    cameraY: initial.cameraY ?? 0,
    shooterState: initial.shooterState ?? fakeShooterState(),
    restoreShooterStateSnapshotResult: initial.restoreShooterStateSnapshotResult ?? true,
    dataSceneActivations: initial.dataSceneActivations ?? 0,
    dataSceneActive: initial.dataSceneActive ?? false,
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
      scene.dataSceneActive = true;
      scene.score = 0;
      scene.gameState = GAME_STATE_CODE.playing;
      scene.entityCount = 0;
      scene.spriteCount = 0;
      scene.cameraX = 0;
      scene.cameraY = 0;
    },
    dataSceneState: () => scene.dataSceneActive
      ? dataSceneGameStateFromCode(scene.gameState)
      : undefined,
    pauseDataScene: () => {
      if (scene.gameState !== GAME_STATE_CODE.playing) {
        return false;
      }
      scene.gameState = GAME_STATE_CODE.paused;
      return true;
    },
    resumeDataScene: () => {
      if (scene.gameState !== GAME_STATE_CODE.paused) {
        return false;
      }
      scene.gameState = GAME_STATE_CODE.playing;
      return true;
    },
    completeDataScene: () => {
      if (scene.gameState !== GAME_STATE_CODE.playing) {
        return false;
      }
      scene.gameState = GAME_STATE_CODE.levelComplete;
      return true;
    },
    setScene: (nextScene) => {
      Object.assign(scene, nextScene);
    },
    dataSceneActivations: () => scene.dataSceneActivations,
  } as FerrumEngine & { setScene(scene: Partial<FakeScene>): void; dataSceneActivations(): number };
}

interface FakeScene {
  score: number;
  gameState: GameStateCode;
  entityCount: number;
  spriteCount: number;
  cameraX: number;
  cameraY: number;
  shooterState: BuiltInShooterStateSnapshot;
  restoreShooterStateSnapshotResult: boolean;
  dataSceneActivations: number;
  dataSceneActive: boolean;
}

class SnapshotDataSceneRuntimeAdapter {
  readonly requests: DataSceneRuntimeSpawnRequest[] = [];
  useDataSceneCalls = 0;

  constructor(
    private readonly activate: () => void,
    private readonly onSpawn?: (request: DataSceneRuntimeSpawnRequest, count: number) => void,
  ) {}

  useDataScene(): void {
    this.useDataSceneCalls += 1;
    this.activate();
  }

  textureId(name: string): number {
    return name.length;
  }

  spawnDataSceneEntity(request: DataSceneRuntimeSpawnRequest): { entityId: number; entityGeneration: number } {
    this.requests.push(request);
    this.onSpawn?.(request, this.requests.length);
    return {
      entityId: 200 + this.requests.length,
      entityGeneration: 1,
    };
  }
}

function sampleDataSceneAuthoringDocument(): GameStateSnapshotJsonValue {
  return {
    format: "ferrum2d.consumer.scene-authoring",
    version: 1,
    variables: [
      { name: "campaign.coins", scope: "global", type: "integer", default: 0 },
      { name: "campaign.unlocked", scope: "global", type: "bool", default: false },
      { name: "wave.index", scope: "scene", type: "integer", default: 1 },
    ],
    sceneComposition: {
      initialFragment: "main",
      prefabs: {
        crate: {
          props: {
            components: {
              sprite: { texture: "crate", width: 16, height: 12 },
              collider: "none",
              layer: "enemy",
            },
          },
        },
      },
      fragments: {
        main: {
          instances: [{ id: "crate-1", prefab: "crate", x: 32, y: 48 }],
        },
      },
    },
    behaviorRecipes: { entities: {} },
  };
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
