import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import { applyBuiltInSceneAuthoringDocument } from "../src/authoring.js";
import type { FerrumEngine } from "../src/core.js";
import type { BehaviorRecipeCommand } from "../src/behaviorRecipes.js";
import type { GameplayEntityHandle, GameplayEntityHandleMap } from "../src/gameplayAuthoring.js";

test("built-in scene authoring positions an active shooter entity and applies its behavior recipe", () => {
  const runtime = createMockEngine({
    builtinShooterPlayer: { entityId: 7, entityGeneration: 2 },
  });
  const result = applyBuiltInSceneAuthoringDocument(
    runtime.engine,
    "shooter",
    sceneDocument([
      sceneInstance("player", "playerPrefab", 480, 270),
    ], {
      playerPrefab: {
        runtimeEntity: "builtinShooterPlayer",
          behaviorRecipes: "player.faction",
      },
    }, {
      "player.faction": {
        recipes: [{ kind: "faction", faction: "player" }],
      },
    }),
  );

  equal(result.scene, "shooter");
  equal(result.appliedPositionCount, 1);
  deepEqual(runtime.positionCalls, [
    [{ entityId: 7, entityGeneration: 2 }, 480, 270],
  ]);
  equal(runtime.behaviorCalls.length, 1);
  deepEqual(runtime.behaviorCalls[0]?.handles, {
    player: { entityId: 7, entityGeneration: 2 },
  });
  equal(runtime.behaviorCalls[0]?.commands[0]?.type, "configureFaction");
});

test("built-in scene authoring maps breakout paddle and ball without spawning replacement entities", () => {
  const runtime = createMockEngine({
    builtinBreakoutPaddle: { entityId: 11, entityGeneration: 4 },
    builtinBreakoutBall: { entityId: 12, entityGeneration: 4 },
  });
  const result = applyBuiltInSceneAuthoringDocument(
    runtime.engine,
    "breakout",
    sceneDocument([
      sceneInstance("paddle", "paddlePrefab", 400, 430),
      sceneInstance("ball", "ballPrefab", 400, 402),
    ], {
      paddlePrefab: { runtimeEntity: "builtinBreakoutPaddle" },
      ballPrefab: { runtimeEntity: "builtinBreakoutBall" },
    }),
  );

  equal(result.appliedPositionCount, 2);
  deepEqual(result.entityHandles, {
    paddle: { entityId: 11, entityGeneration: 4 },
    ball: { entityId: 12, entityGeneration: 4 },
  });
  deepEqual(runtime.positionCalls, [
    [{ entityId: 11, entityGeneration: 4 }, 400, 430],
    [{ entityId: 12, entityGeneration: 4 }, 400, 402],
  ]);
});

test("built-in scene authoring fails preflight for mismatched, duplicate, or unsupported placement input", () => {
  const runtime = createMockEngine({
    builtinShooterPlayer: { entityId: 7, entityGeneration: 2 },
  });

  throws(
    () => applyBuiltInSceneAuthoringDocument(
      runtime.engine,
      "shooter",
      sceneDocument([sceneInstance("player", "playerPrefab", 0, 0)], {
        playerPrefab: { runtimeEntity: "builtinPlatformerPlayer" },
      }),
    ),
    /builtinShooterPlayer.*shooter/,
  );
  throws(
    () => applyBuiltInSceneAuthoringDocument(
      runtime.engine,
      "shooter",
      sceneDocument([
        sceneInstance("player-a", "playerPrefab", 0, 0),
        sceneInstance("player-b", "playerPrefab", 10, 10),
      ], {
        playerPrefab: { runtimeEntity: "builtinShooterPlayer" },
      }),
    ),
    /duplicates built-in runtime entity.*builtinShooterPlayer/,
  );
  throws(
    () => applyBuiltInSceneAuthoringDocument(
      runtime.engine,
      "shooter",
      sceneDocument([{
        ...sceneInstance("player", "playerPrefab", 0, 0),
        rotationRadians: 0.5,
      }], {
        playerPrefab: { runtimeEntity: "builtinShooterPlayer" },
      }),
    ),
    /rotation must be 0/,
  );
  equal(runtime.positionCalls.length, 0);

  throws(
    () => applyBuiltInSceneAuthoringDocument(
      runtime.engine,
      "breakout",
      sceneDocument([
        sceneInstance("ball", "ballPrefab", 400, 402),
      ], {
        ballPrefab: {
          runtimeEntity: "builtinBreakoutBall",
          behaviorRecipes: "ball.collisionDespawn",
        },
      }, {
        "ball.collisionDespawn": {
          recipes: [{ kind: "collisionDespawn", target: "other" }],
        },
      }),
    ),
    /configureCollisionDespawn.*built-in scene-owned runtime entity/,
  );
  equal(runtime.positionCalls.length, 0);
});

test("built-in scene authoring rejects behavior that can despawn a scene-owned entity", () => {
  const runtime = createMockEngine({
    builtinBreakoutBall: { entityId: 12, entityGeneration: 4 },
  });

  throws(
    () => applyBuiltInSceneAuthoringDocument(
      runtime.engine,
      "breakout",
      sceneDocument([
        sceneInstance("ball", "ballPrefab", 400, 402),
      ], {
        ballPrefab: {
          runtimeEntity: "builtinBreakoutBall",
          behaviorRecipes: "ball.expiring",
        },
      }, {
        "ball.expiring": {
          recipes: [{ kind: "lifetime", seconds: 60 }],
        },
      }),
    ),
    /configureLifetime.*built-in scene-owned runtime entity.*ball/,
  );
  equal(runtime.positionCalls.length, 0);

  throws(
    () => applyBuiltInSceneAuthoringDocument(
      runtime.engine,
      "breakout",
      sceneDocument([
        sceneInstance("ball", "ballPrefab", 400, 402),
      ], {
        ballPrefab: {
          runtimeEntity: "builtinBreakoutBall",
          behaviorRecipes: "ball.health",
        },
      }, {
        "ball.health": {
          recipes: [{ kind: "health", max: 3, start: 3, onZero: "none" }],
        },
      }),
    ),
    /configureHealth requires onZero=.*cannot be applied safely/,
  );
  equal(runtime.positionCalls.length, 0);
});

type RuntimeEntityHandles = Partial<Record<
  "builtinShooterPlayer" | "builtinPlatformerPlayer" | "builtinBreakoutPaddle" | "builtinBreakoutBall",
  GameplayEntityHandle
>>;

function createMockEngine(handles: RuntimeEntityHandles): {
  engine: FerrumEngine;
  positionCalls: Array<[GameplayEntityHandle, number, number]>;
  behaviorCalls: Array<{ commands: readonly BehaviorRecipeCommand[]; handles: GameplayEntityHandleMap }>;
} {
  const positionCalls: Array<[GameplayEntityHandle, number, number]> = [];
  const behaviorCalls: Array<{ commands: readonly BehaviorRecipeCommand[]; handles: GameplayEntityHandleMap }> = [];
  const engine = {
    builtInShooterPlayerHandle: () => handles.builtinShooterPlayer,
    builtInPlatformerPlayerHandle: () => handles.builtinPlatformerPlayer,
    builtInBreakoutPaddleHandle: () => handles.builtinBreakoutPaddle,
    builtInBreakoutBallHandle: () => handles.builtinBreakoutBall,
    setBuiltInSceneEntityPosition: (handle: GameplayEntityHandle, x: number, y: number) => {
      positionCalls.push([handle, x, y]);
      return true;
    },
    applyGameplayBehaviorCommands: (
      commands: readonly BehaviorRecipeCommand[],
      entityHandles: GameplayEntityHandleMap,
    ) => {
      behaviorCalls.push({ commands, handles: entityHandles });
      return { commands, results: commands.map(() => true) };
    },
  } as unknown as FerrumEngine;
  return { engine, positionCalls, behaviorCalls };
}

function sceneDocument(
  instances: readonly Record<string, unknown>[],
  prefabs: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  entities: Readonly<Record<string, unknown>> = {},
): unknown {
  return {
    format: "ferrum2d.consumer.scene-authoring",
    version: 1,
    sceneComposition: {
      initialFragment: "runtime",
      prefabs: Object.fromEntries(
        Object.entries(prefabs).map(([id, props]) => [id, { props }]),
      ),
      fragments: { runtime: { instances } },
    },
    behaviorRecipes: { entities },
  };
}

function sceneInstance(id: string, prefab: string, x: number, y: number): Record<string, unknown> {
  return { id, prefab, x, y };
}
