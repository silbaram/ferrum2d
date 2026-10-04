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
  engine: FerrumEngine, document: ResolvedSceneAuthoringDocument, plan: SceneBehaviorBindingPlan,
  ids: GameplayBehaviorRuntimeIds | undefined, path: string,
): void {
  if (document.navigation !== undefined && typeof engine.configureDataSceneNavigation !== "function") {
    throw gameplayAuthoringDiagnosticError(`${path}.navigation`, "runtime does not support Data Scene navigation");
  }
  const config = document.gameplay;
  if (config !== undefined) {
    if (typeof engine.configureDataSceneGameplay !== "function") throw gameplayAuthoringDiagnosticError(`${path}.gameplay`, "runtime does not support Data Scene gameplay");
    if (config.primaryActor !== undefined && !plan.instances.some(instance => instance.id === config.primaryActor)) {
      throw gameplayAuthoringDiagnosticError(`${path}.gameplay.primaryActor`, "must reference an instance in the applied fragment");
    }
    validateBehaviorVariableContracts(document.behaviorRecipes, document.variables ?? [], ids?.variables ?? {}, `${path}.behaviorRecipes`);
  }
  const mutationKeys = new Map<string, Set<string>>();
  plan.commands.forEach((command, index) => {
    const commandPath = `${path}.commands.${index}`;
    if (["configureInteraction", "configurePickup", "configureCollisionPickup"].includes(command.type) && config === undefined) {
      throw gameplayAuthoringDiagnosticError(`${path}.gameplay`, "declare gameplay to execute interaction/pickup recipes in Data Scene");
    }
    if (command.type === "configureInteraction") {
      if (config?.primaryActor === undefined) throw gameplayAuthoringDiagnosticError(`${path}.gameplay.primaryActor`, "is required for interaction recipes");
    }
    if (config !== undefined) {
      const key = validateDataSceneGameplayCommand(command, ids, commandPath);
      if (key !== undefined) {
        let keys = mutationKeys.get(command.entity);
        if (keys === undefined) {
          keys = new Set();
          mutationKeys.set(command.entity, keys);
        }
        keys.add(key);
        if (keys.size > MAX_VARIABLE_MUTATION_TRIGGERS) {
          throw gameplayAuthoringDiagnosticError(commandPath, `must use at most ${MAX_VARIABLE_MUTATION_TRIGGERS} distinct variable mutation triggers per entity`);
        }
      }
    }
  });
}
