import { DATA_SCENE_COMPONENTS_PROP } from "./dataSceneComponents.js";
import { gameplayAuthoringDiagnosticError } from "./diagnostics.js";
import type { FerrumEngine } from "./engineTypes.js";
import {
  applySceneBehaviorRecipes,
  bindSceneBehaviorRecipes,
  type ApplySceneBehaviorRecipesOptions,
  type BoundBehaviorRecipeCommand,
  type GameplayEntityHandle,
  type SceneBehaviorApplyResult,
} from "./gameplayAuthoring.js";
import {
  resolveSceneAuthoringDocument,
  type ResolvedSceneAuthoringDocument,
} from "./sceneAuthoringDocument.js";
import type { ResolvedSceneCompositionInstance } from "./sceneComposition.js";

export type BuiltInSceneAuthoringKind = "shooter" | "platformer" | "breakout";

export type BuiltInSceneRuntimeEntity =
  | "builtinShooterPlayer"
  | "builtinPlatformerPlayer"
  | "builtinBreakoutPaddle"
  | "builtinBreakoutBall";

export interface ApplyBuiltInSceneAuthoringDocumentOptions extends ApplySceneBehaviorRecipesOptions {
  path?: string;
}

export interface ApplyBuiltInSceneAuthoringDocumentResult extends SceneBehaviorApplyResult {
  scene: BuiltInSceneAuthoringKind;
  document: ResolvedSceneAuthoringDocument;
  appliedPositionCount: number;
}

interface PreparedBuiltInSceneInstance {
  instance: ResolvedSceneCompositionInstance;
  runtimeEntity: BuiltInSceneRuntimeEntity;
  handle: GameplayEntityHandle;
}

/**
 * Applies a Scene Authoring document to entities already owned by a built-in scene.
 * This is a low-frequency load/reload adapter and must not be called per frame.
 */
export function applyBuiltInSceneAuthoringDocument(
  engine: FerrumEngine,
  scene: BuiltInSceneAuthoringKind,
  document: unknown,
  options: ApplyBuiltInSceneAuthoringDocumentOptions = {},
): ApplyBuiltInSceneAuthoringDocumentResult {
  const path = options.path ?? "builtInSceneAuthoring";
  const resolved = resolveSceneAuthoringDocument(document, {
    ...options,
    path,
    validateBindings: true,
    validateComponents: false,
  });
  if (resolved.gameplay !== undefined || resolved.navigation !== undefined) {
    throw gameplayAuthoringDiagnosticError(path, "gameplay/navigation configuration is supported only by Data Scene");
  }
  if ((resolved.variables?.length ?? 0) > 0) {
    throw gameplayAuthoringDiagnosticError(
      `${path}.variables`,
      "built-in scene authoring does not synchronize Data Scene variable declarations",
    );
  }

  const plan = bindSceneBehaviorRecipes(
    resolved.sceneComposition,
    resolved.behaviorRecipes,
    { ...options, path },
  );
  plan.bindings.forEach((binding, index) => {
    assertSceneOwnedEntityLifecycle(binding, `${path}.bindings.${index}`);
  });
  const usedRuntimeEntities = new Set<BuiltInSceneRuntimeEntity>();
  const preparedByInstanceId = new Map<string, PreparedBuiltInSceneInstance>();
  plan.instances.forEach((instance, index) => {
    const instancePath = `${path}.instances.${index}`;
    const runtimeEntity = builtInRuntimeEntity(instance.props.runtimeEntity, scene, `${instancePath}.props.runtimeEntity`);
    if (usedRuntimeEntities.has(runtimeEntity)) {
      throw gameplayAuthoringDiagnosticError(
        `${instancePath}.props.runtimeEntity`,
        `duplicates built-in runtime entity '${runtimeEntity}'`,
      );
    }
    assertSupportedBuiltInPlacement(instance, instancePath);
    const handle = builtInRuntimeEntityHandle(engine, runtimeEntity);
    if (handle === undefined) {
      throw gameplayAuthoringDiagnosticError(
        `${instancePath}.props.runtimeEntity`,
        `runtime entity '${runtimeEntity}' is unavailable; activate the '${scene}' built-in scene before applying authoring`,
      );
    }
    usedRuntimeEntities.add(runtimeEntity);
    preparedByInstanceId.set(instance.id, { instance, runtimeEntity, handle });
  });

  let appliedPositionCount = 0;
  const result = applySceneBehaviorRecipes(
    engine,
    {
      spawnSceneInstance: (instance) => {
        const prepared = preparedByInstanceId.get(instance.id);
        if (prepared === undefined) {
          throw gameplayAuthoringDiagnosticError(
            `${path}.instances.${instance.id}`,
            "was not included in the built-in scene authoring preflight",
          );
        }
        if (!engine.setBuiltInSceneEntityPosition(prepared.handle, instance.x, instance.y)) {
          throw gameplayAuthoringDiagnosticError(
            `${path}.instances.${instance.id}`,
            `failed to position runtime entity '${prepared.runtimeEntity}'`,
          );
        }
        appliedPositionCount += 1;
        return prepared.handle;
      },
    },
    resolved.sceneComposition,
    resolved.behaviorRecipes,
    { ...options, path, ids: options.ids ?? resolved.ids },
  );

  return {
    scene,
    document: resolved,
    appliedPositionCount,
    ...result,
  };
}

function assertSceneOwnedEntityLifecycle(binding: BoundBehaviorRecipeCommand, path: string): void {
  const command = binding.command;
  if (command.type === "configureHealth") {
    const detail = command.onZero === "despawn"
      ? `configureHealth cannot despawn built-in scene-owned runtime entity '${binding.instance.id}'`
      : "configureHealth requires onZero='despawn' in gameplay storage, so it cannot be applied safely to a built-in scene-owned runtime entity";
    throw gameplayAuthoringDiagnosticError(path, detail);
  }
  if (command.type === "configureCollisionDespawn") {
    throw gameplayAuthoringDiagnosticError(
      path,
      "configureCollisionDespawn can remove a built-in scene-owned runtime entity and is not supported by this adapter",
    );
  }
  const unsafe = command.type === "configureLifetime"
    || (command.type === "configurePickup" && command.despawn);
  if (unsafe) {
    throw gameplayAuthoringDiagnosticError(
      path,
      `${command.type} cannot despawn built-in scene-owned runtime entity '${binding.instance.id}'`,
    );
  }
}

function builtInRuntimeEntity(
  value: unknown,
  scene: BuiltInSceneAuthoringKind,
  path: string,
): BuiltInSceneRuntimeEntity {
  const supported = supportedRuntimeEntities(scene);
  if (typeof value !== "string" || !supported.includes(value as BuiltInSceneRuntimeEntity)) {
    throw gameplayAuthoringDiagnosticError(
      path,
      `must be one of ${supported.map((entry) => `'${entry}'`).join(", ")} for the '${scene}' built-in scene`,
    );
  }
  return value as BuiltInSceneRuntimeEntity;
}

function supportedRuntimeEntities(scene: BuiltInSceneAuthoringKind): readonly BuiltInSceneRuntimeEntity[] {
  switch (scene) {
    case "shooter":
      return ["builtinShooterPlayer"];
    case "platformer":
      return ["builtinPlatformerPlayer"];
    case "breakout":
      return ["builtinBreakoutPaddle", "builtinBreakoutBall"];
  }
}

function builtInRuntimeEntityHandle(
  engine: FerrumEngine,
  runtimeEntity: BuiltInSceneRuntimeEntity,
): GameplayEntityHandle | undefined {
  switch (runtimeEntity) {
    case "builtinShooterPlayer":
      return engine.builtInShooterPlayerHandle();
    case "builtinPlatformerPlayer":
      return engine.builtInPlatformerPlayerHandle();
    case "builtinBreakoutPaddle":
      return engine.builtInBreakoutPaddleHandle();
    case "builtinBreakoutBall":
      return engine.builtInBreakoutBallHandle();
  }
}

function assertSupportedBuiltInPlacement(instance: ResolvedSceneCompositionInstance, path: string): void {
  if (instance.rotationRadians !== 0) {
    throw gameplayAuthoringDiagnosticError(
      `${path}.rotationRadians`,
      "built-in scene authoring currently supports position only; rotation must be 0",
    );
  }
  if (instance.scale !== 1) {
    throw gameplayAuthoringDiagnosticError(
      `${path}.scale`,
      "built-in scene authoring currently supports position only; scale must be 1",
    );
  }
  if (instance.layer !== 0) {
    throw gameplayAuthoringDiagnosticError(
      `${path}.layer`,
      "built-in scene render layers remain scene-owned; layer must be 0",
    );
  }
  if (instance.props[DATA_SCENE_COMPONENTS_PROP] !== undefined) {
    throw gameplayAuthoringDiagnosticError(
      `${path}.props.${DATA_SCENE_COMPONENTS_PROP}`,
      "Data Scene visual/collider components cannot be applied to a built-in scene entity",
    );
  }
}
