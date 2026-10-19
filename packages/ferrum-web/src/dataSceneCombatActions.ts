import type { BehaviorRecipeCommand } from "./behaviorRecipes.js";
import type { GameplayBehaviorRuntimeIds } from "./gameplayAuthoring.js";

type ActionCommand = Extract<
  BehaviorRecipeCommand,
  {
    type:
      | "configureProjectileAction"
      | "configureMeleeAction"
      | "configureDashAction"
      | "configureSpawnPrefabAction";
  }
>;

/** Mirror the native action-id upsert across action kinds; authoring metadata only. */
export function finalCombatActions(
  commands: readonly BehaviorRecipeCommand[],
  ids: GameplayBehaviorRuntimeIds | undefined,
): ActionCommand[] {
  const actions = new Map<string, ActionCommand>();
  for (const command of commands) {
    if (
      command.type === "configureProjectileAction" ||
      command.type === "configureMeleeAction" ||
      command.type === "configureDashAction" ||
      command.type === "configureSpawnPrefabAction"
    ) {
      actions.set(
        `${command.entity}:${command.actionId ?? ids?.actions?.[command.action]}`,
        command,
      );
    }
  }
  return [...actions.values()];
}

export function combatActionsRequired(commands: readonly BehaviorRecipeCommand[]): boolean {
  return commands.some(
    (command) => command.type === "configureMeleeAction" || command.type === "configureDashAction",
  );
}

export function combatActionUsesInput(command: ActionCommand): boolean {
  return command.type === "configureMeleeAction"
    ? (command.target ?? "enemies") === "enemies"
    : command.type === "configureSpawnPrefabAction"
      ? false
      : (command.aim ?? "input") === "input";
}
