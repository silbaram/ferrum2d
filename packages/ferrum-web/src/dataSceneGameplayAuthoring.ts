import { projectileVisualsRequired } from "./dataSceneProjectilePrefabs.js";
import { validateDataSceneSpawnPrefabs } from "./dataSceneSpawnPrefabs.js";
import { combatCrowdRequired } from "./dataSceneCombatCrowd.js";
import {
  combatActionsRequired,
  combatActionUsesInput,
  finalCombatActions,
} from "./dataSceneCombatActions.js";
import { resolveDataSceneInstanceComponents } from "./dataSceneComponents.js";
import { validateCombatNavigationBindings } from "./dataSceneCombatNavigation.js";
import { gameplayAuthoringDiagnosticError } from "./diagnostics.js";
import type { FerrumEngine } from "./engineTypes.js";
import {
  validateDataSceneGameplayCommand,
  type GameplayBehaviorRuntimeIds,
  type SceneBehaviorBindingPlan,
} from "./gameplayAuthoring.js";
import {
  validateBehaviorVariableContracts,
  type ResolvedSceneAuthoringDocument,
} from "./sceneAuthoringDocument.js";

// Matches Rust MAX_GAMEPLAY_VARIABLE_MUTATION_TRIGGERS_PER_ENTITY.
const MAX_VARIABLE_MUTATION_TRIGGERS = 16;

export function preflightDataSceneGameplay(
  engine: FerrumEngine,
  document: ResolvedSceneAuthoringDocument,
  plan: SceneBehaviorBindingPlan,
  ids: GameplayBehaviorRuntimeIds | undefined,
  path: string,
): void {
  if (
    document.navigation !== undefined &&
    typeof engine.configureDataSceneNavigation !== "function"
  ) {
    throw gameplayAuthoringDiagnosticError(
      `${path}.navigation`,
      "runtime does not support Data Scene navigation",
    );
  }
  for (const obstacle of document.navigation?.obstacles ?? []) {
    if (!plan.instances.some((instance) => instance.id === obstacle.instanceId))
      throw gameplayAuthoringDiagnosticError(
        `${path}.navigation.obstacles`,
        "must reference an instance in the applied fragment",
      );
  }
  const config = document.gameplay;
  const finalActions = finalCombatActions(plan.commands, ids);
  validateDataSceneSpawnPrefabs(document, plan, ids, path);
  if (
    (config?.spawnPrefabs !== undefined ||
      finalActions.some((command) => command.type === "configureSpawnPrefabAction")) &&
    engine.supportsDataSceneSpawnPrefabs?.() !== true
  )
    throw gameplayAuthoringDiagnosticError(
      `${path}.gameplay.spawnPrefabs`,
      "requires a compatible spawn-prefab Wasm build",
    );
  if (config !== undefined) {
    if (typeof engine.configureDataSceneGameplay !== "function")
      throw gameplayAuthoringDiagnosticError(
        `${path}.gameplay`,
        "runtime does not support Data Scene gameplay",
      );
    if (
      config.primaryActor !== undefined &&
      !plan.instances.some((instance) => instance.id === config.primaryActor)
    ) {
      throw gameplayAuthoringDiagnosticError(
        `${path}.gameplay.primaryActor`,
        "must reference an instance in the applied fragment",
      );
    }
    validateBehaviorVariableContracts(
      document.behaviorRecipes,
      document.variables ?? [],
      ids?.variables ?? {},
      `${path}.behaviorRecipes`,
    );
  }
  if (config?.combat === true && plan.instances.length > 2048) {
    throw gameplayAuthoringDiagnosticError(
      `${path}.gameplay.combat`,
      "supports at most 2048 authored entities including model markers",
    );
  }
  if (
    projectileVisualsRequired(config?.projectilePrefabs) &&
    engine.supportsDataSceneProjectileVisuals?.() !== true
  )
    throw gameplayAuthoringDiagnosticError(
      `${path}.gameplay.projectilePrefabs`,
      "animation/rotation requires a compatible projectile-visual Wasm build",
    );
  if (
    config?.projectilePrefabs !== undefined &&
    engine.supportsDataSceneProjectilePrefabs?.() !== true
  )
    throw gameplayAuthoringDiagnosticError(
      `${path}.gameplay.projectilePrefabs`,
      "requires a compatible projectile-prefab Wasm build",
    );
  for (const command of finalActions) {
    if (
      command.type === "configureProjectileAction" &&
      command.projectilePrefab !== undefined &&
      (config?.combat !== true ||
        !Object.prototype.hasOwnProperty.call(
          config.projectilePrefabs ?? {},
          command.projectilePrefab,
        ))
    ) {
      throw gameplayAuthoringDiagnosticError(
        `${path}.commands.projectilePrefab`,
        "must reference gameplay.projectilePrefabs in a combat document",
      );
    }
  }
  const movingEntities = new Set(
    plan.commands
      .filter((command) =>
        ["configureChase", "configureSeekTarget", "configureAccelerate"].includes(command.type),
      )
      .map((command) => command.entity),
  );
  if (config?.combat === true && movingEntities.size > 512) {
    throw gameplayAuthoringDiagnosticError(
      `${path}.gameplay.combat`,
      "supports at most 512 movement actors",
    );
  }
  if (
    config?.combat === true &&
    (typeof engine.dataSceneCombatStats !== "function" ||
      engine.dataSceneCombatStats() === undefined)
  ) {
    throw gameplayAuthoringDiagnosticError(
      `${path}.gameplay.combat`,
      "requires a compatible combat Wasm build",
    );
  }
  if (
    config?.combatNavigation?.movementPatterns === "all" &&
    engine.supportsDataSceneCombatMovement?.() !== true
  )
    throw gameplayAuthoringDiagnosticError(
      `${path}.gameplay.combatNavigation.movementPatterns`,
      "requires a compatible spatial combat-movement Wasm build",
    );
  if (config?.combatNavigation !== undefined) {
    if (engine.supportsDataSceneCombatNavigation?.() !== true)
      throw gameplayAuthoringDiagnosticError(
        `${path}.gameplay.combatNavigation`,
        "requires a compatible combat-navigation Wasm build",
      );
    validateCombatNavigationBindings(
      config.combatNavigation,
      config.primaryActor,
      document.spatial,
      plan,
      `${path}.gameplay.combatNavigation`,
    );
  }
  if (
    combatCrowdRequired(config?.combatNavigation, plan.commands) &&
    engine.supportsDataSceneCombatCrowd?.() !== true
  )
    throw gameplayAuthoringDiagnosticError(
      `${path}.gameplay.combatNavigation`,
      "requires a compatible combat-crowd Wasm build",
    );
  const mutationKeys = new Map<string, Set<string>>();
  const finalActionSet = new Set<(typeof plan.commands)[number]>(finalActions);
  if (
    config?.combat &&
    combatActionsRequired(finalActions) &&
    engine.supportsDataSceneCombatActions?.() !== true
  ) {
    throw gameplayAuthoringDiagnosticError(
      `${path}.gameplay.combat`,
      "melee/dash require a compatible combat-action Wasm build",
    );
  }
  plan.commands.forEach((command, index) => {
    const commandPath = `${path}.commands.${index}`;
    if (
      ["configureInteraction", "configurePickup", "configureCollisionPickup"].includes(
        command.type,
      ) &&
      config === undefined
    ) {
      throw gameplayAuthoringDiagnosticError(
        `${path}.gameplay`,
        "declare gameplay to execute interaction/pickup recipes in Data Scene",
      );
    }
    if (command.type === "configureInteraction") {
      if (config?.primaryActor === undefined)
        throw gameplayAuthoringDiagnosticError(
          `${path}.gameplay.primaryActor`,
          "is required for interaction recipes",
        );
    }
    if (config !== undefined) {
      const key = validateDataSceneGameplayCommand(
        config.combatNavigation && command.type === "configureChase"
          ? { ...command, stopDistance: 0 }
          : command,
        ids,
        commandPath,
        config.combat ?? false,
      );
      if (
        config.combat &&
        finalActionSet.has(command) &&
        (command.type === "configureProjectileAction" ||
          command.type === "configureDashAction" ||
          command.type === "configureMeleeAction")
      ) {
        if (command.type === "configureMeleeAction") {
          const instance = plan.instances.find((instance) => instance.id === command.entity)!;
          const component = resolveDataSceneInstanceComponents(instance);
          if (
            component.mode !== "inline" ||
            component.collider.type === "none" ||
            component.collider.enabled === false
          )
            throw gameplayAuthoringDiagnosticError(
              commandPath,
              "melee requires an enabled inline collider for its mutual collision filter",
            );
          if (document.spatial !== undefined && component.body?.heightSpan === undefined)
            throw gameplayAuthoringDiagnosticError(
              commandPath,
              "spatial melee requires an authored body heightSpan",
            );
        }
        if (command.type === "configureDashAction") {
          const instance = plan.instances.find((instance) => instance.id === command.entity)!;
          const component = resolveDataSceneInstanceComponents(instance);
          if (
            component.mode !== "inline" ||
            component.body?.type !== "kinematic" ||
            component.collider?.type !== "aabb" ||
            component.collider.enabled === false ||
            instance.rotationRadians !== 0 ||
            document.spatial?.attachments?.[command.entity] !== undefined
          ) {
            throw gameplayAuthoringDiagnosticError(
              commandPath,
              "dash requires an enabled unattached inline kinematic AABB body with zero instance rotation",
            );
          }
          if (document.spatial !== undefined && component.body.heightSpan === undefined)
            throw gameplayAuthoringDiagnosticError(
              commandPath,
              "spatial dash requires an authored body heightSpan",
            );
        }
        if (combatActionUsesInput(command) && command.entity !== config.primaryActor) {
          throw gameplayAuthoringDiagnosticError(
            `${commandPath}.entity`,
            command.type === "configureProjectileAction"
              ? "input projectiles require the gameplay primaryActor"
              : "input melee/dash require the gameplay primaryActor",
          );
        }
      }
      if (
        config.combat &&
        finalActionSet.has(command) &&
        command.type === "configureProjectileAction" &&
        (command.aim ?? "input") === "input"
      ) {
        if (command.entity !== config.primaryActor) {
          throw gameplayAuthoringDiagnosticError(
            `${commandPath}.entity`,
            "input projectiles require the gameplay primaryActor",
          );
        }
        if (engine.supportsDataSceneInputProjectiles?.() !== true) {
          throw gameplayAuthoringDiagnosticError(
            commandPath,
            "input projectiles require a compatible input-projectile Wasm build",
          );
        }
      }
      if (
        config.combat &&
        (command.type === "configureChase" || command.type === "configureSeekTarget") &&
        ![
          "player",
          "primaryActor",
          "nearestPlayer",
          "nearestPrimaryActor",
          "nearestEnemy",
        ].includes(command.target) &&
        !["nearestLayer:", "nearestFaction:", "nearestTag:"].some((prefix) =>
          command.target.startsWith(prefix),
        ) &&
        !plan.instances.some((instance) => instance.id === command.target)
      ) {
        throw gameplayAuthoringDiagnosticError(
          `${commandPath}.target`,
          "must reference a movement query or an instance in the applied fragment",
        );
      }
      if (config.combat && command.type === "configureTimerTrigger") {
        const actionId =
          command.actionId ??
          (command.action === undefined ? undefined : ids?.actions?.[command.action]);
        if (actionId !== undefined) {
          const action = finalActions.find(
            (candidate) =>
              candidate.entity === command.entity &&
              (candidate.actionId ?? ids?.actions?.[candidate.action]) === actionId,
          );
          if (action === undefined) {
            throw gameplayAuthoringDiagnosticError(
              `${commandPath}.action`,
              "must reference a supported combat action configured on the same entity",
            );
          }
          if (combatActionUsesInput(action)) {
            throw gameplayAuthoringDiagnosticError(
              `${commandPath}.action`,
              "timer actions require targetPlayer projectile/dash or player melee; input actions use input bindings",
            );
          }
        }
      }
      if (key !== undefined) {
        let keys = mutationKeys.get(command.entity);
        if (keys === undefined) {
          keys = new Set();
          mutationKeys.set(command.entity, keys);
        }
        keys.add(key);
        if (keys.size > MAX_VARIABLE_MUTATION_TRIGGERS) {
          throw gameplayAuthoringDiagnosticError(
            commandPath,
            `must use at most ${MAX_VARIABLE_MUTATION_TRIGGERS} distinct variable mutation triggers per entity`,
          );
        }
      }
    }
  });
}
