import type { BehaviorRecipeCommand } from "./behaviorRecipes.js";
import { gameplayAuthoringDiagnosticError } from "./diagnostics.js";
import type {
  GameplayBehaviorRuntimeIds,
  ResolveGameplayBehaviorRuntimeIdsOptions,
} from "./gameplayAuthoringTypes.js";
import { isRecord, positiveU32, recordValue, requiredBehaviorProp } from "./gameplayAuthoringValidation.js";

export const GAMEPLAY_PICKUP_ITEM_SCORE = 1;
const MAX_GAMEPLAY_TAG_ID = 31;
export const GAMEPLAY_TAG_ID_RANGE_LABEL = `0..${MAX_GAMEPLAY_TAG_ID}`;

export function resolveGameplayBehaviorRuntimeIds(
  value: unknown,
  options: ResolveGameplayBehaviorRuntimeIdsOptions = {},
): GameplayBehaviorRuntimeIds {
  const path = options.path ?? "gameplayRuntimeIds";
  if (!isRecord(value)) {
    throw gameplayAuthoringDiagnosticError(path, "must be an object");
  }
  const items = runtimeIdNamespace(value.items, `${path}.items`);
  const actions = runtimeIdNamespace(value.actions, `${path}.actions`);
  const prefabs = runtimeIdNamespace(value.prefabs, `${path}.prefabs`);
  const timers = runtimeIdNamespace(value.timers, `${path}.timers`);
  const tags = runtimeTagIdNamespace(value.tags, `${path}.tags`);
  const effects = runtimeIdNamespace(value.effects, `${path}.effects`);
  const variables = runtimeIdNamespace(value.variables, `${path}.variables`);
  requireRuntimeIdNames(items, options.requiredItems ?? [], `${path}.items`);
  requireRuntimeIdNames(actions, options.requiredActions ?? [], `${path}.actions`);
  requireRuntimeIdNames(prefabs, options.requiredPrefabs ?? [], `${path}.prefabs`);
  requireRuntimeIdNames(timers, options.requiredTimers ?? [], `${path}.timers`);
  requireRuntimeIdNames(tags, options.requiredTags ?? [], `${path}.tags`);
  requireRuntimeIdNames(effects, options.requiredEffects ?? [], `${path}.effects`);
  requireRuntimeIdNames(variables, options.requiredVariables ?? [], `${path}.variables`);
  return {
    ...(Object.keys(items).length === 0 ? {} : { items }),
    ...(Object.keys(actions).length === 0 ? {} : { actions }),
    ...(Object.keys(prefabs).length === 0 ? {} : { prefabs }),
    ...(Object.keys(timers).length === 0 ? {} : { timers }),
    ...(Object.keys(tags).length === 0 ? {} : { tags }),
    ...(Object.keys(effects).length === 0 ? {} : { effects }),
    ...(Object.keys(variables).length === 0 ? {} : { variables }),
  };
}

/** Runtime dictionaries contain declarations, never inherited object properties. */
export function runtimeIdByName(
  ids: Readonly<Record<string, number>> | undefined,
  name: string | undefined,
): number | undefined {
  return ids !== undefined && ids !== null && name !== undefined && Object.prototype.hasOwnProperty.call(ids, name)
    ? ids[name]
    : undefined;
}

function runtimeIdNamespace(value: unknown, path: string): Record<string, number> {
  if (value === undefined) {
    return {};
  }
  const raw = recordValue(value, path);
  const ids: Record<string, number> = {};
  for (const [key, runtimeId] of Object.entries(raw)) {
    const name = requiredBehaviorProp(key, `${path}.${key}`);
    Object.defineProperty(ids, name, { value: positiveU32(runtimeId, `${path}.${key}`), enumerable: true, writable: true, configurable: true });
  }
  return ids;
}

function runtimeTagIdNamespace(value: unknown, path: string): Record<string, number> {
  if (value === undefined) {
    return {};
  }
  const raw = recordValue(value, path);
  const ids: Record<string, number> = {};
  for (const [key, runtimeId] of Object.entries(raw)) {
    const name = requiredBehaviorProp(key, `${path}.${key}`);
    Object.defineProperty(ids, name, { value: gameplayTagIdValue(runtimeId, `${path}.${key}`), enumerable: true, writable: true, configurable: true });
  }
  return ids;
}

function requireRuntimeIdNames(
  ids: Readonly<Record<string, number>>,
  names: readonly string[],
  path: string,
): void {
  for (const name of names) {
    const key = requiredBehaviorProp(name, `${path}.required`);
    if (runtimeIdByName(ids, key) === undefined) {
      throw gameplayAuthoringDiagnosticError(`${path}.${key}`, `must declare runtime id for '${key}'`);
    }
  }
}

export function gameplayTagIdValue(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_GAMEPLAY_TAG_ID) {
    throw gameplayAuthoringDiagnosticError(path, `must be an integer gameplay tag id between ${GAMEPLAY_TAG_ID_RANGE_LABEL}`);
  }
  return value;
}

export function resolvedPickupItemId(
  command: Extract<BehaviorRecipeCommand, { type: "configurePickup" }>,
  ids: GameplayBehaviorRuntimeIds | undefined,
  path: string,
): number {
  const itemId = command.itemId ?? runtimeIdByName(ids?.items, command.item) ?? (command.item === "score" ? GAMEPLAY_PICKUP_ITEM_SCORE : undefined);
  if (itemId === undefined) {
    throw gameplayAuthoringDiagnosticError(`${path}.item`, `must resolve pickup item '${command.item}' to a supported runtime item id`);
  }
  if (!Number.isInteger(itemId) || itemId <= 0 || itemId > 0xffffffff) {
    throw gameplayAuthoringDiagnosticError(`${path}.itemId`, "must be a positive uint32 runtime item id");
  }
  return itemId;
}

const ACTION_DESCRIPTIONS = {
  configureInteraction: "interaction action",
  configureProjectileAction: "projectile action",
  configureDashAction: "dash action",
  configureMeleeAction: "melee action",
  configureSpawnPrefabAction: "spawn prefab action",
  configureCollisionSpawnPrefab: "collision spawn prefab action",
  configureTimerTrigger: "timer action",
} as const;
type ActionCommand = Extract<BehaviorRecipeCommand, { type: keyof typeof ACTION_DESCRIPTIONS }>;
type PrefabCommand = Extract<BehaviorRecipeCommand, { type: "configureSpawnPrefabAction" | "configureCollisionSpawnPrefab" }>;

/** Validate before numeric Wasm conversion can wrap a different runtime ID into range. */
function resolveMappedId(
  value: number | undefined,
  name: string | undefined,
  field: "action" | "prefab" | "timer",
  description: string,
  path: string,
): number {
  if (value === undefined) {
    throw gameplayAuthoringDiagnosticError(
      `${path}.${field}`,
      `must resolve ${description} '${name}' to a runtime ${field} id`,
    );
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw gameplayAuthoringDiagnosticError(
      `${path}.${field}Id`,
      `must be a positive integer runtime ${field} id`,
    );
  }
  return positiveU32(value, `${path}.${field}Id`);
}

export function gameplayActionId(command: ActionCommand, ids: GameplayBehaviorRuntimeIds | undefined, path: string): number {
  const id = command.actionId ?? runtimeIdByName(ids?.actions, command.action);
  return resolveMappedId(id, command.action, "action", ACTION_DESCRIPTIONS[command.type], path);
}

export function spawnPrefabId(command: PrefabCommand, ids: GameplayBehaviorRuntimeIds | undefined, path: string): number {
  const label = command.type === "configureCollisionSpawnPrefab" ? "collision spawn prefab" : "spawn prefab";
  return resolveMappedId(command.prefabId ?? runtimeIdByName(ids?.prefabs, command.prefab), command.prefab, "prefab", label, path);
}

export function timerTriggerId(command: Extract<BehaviorRecipeCommand, { type: "configureTimerTrigger" }>, ids: GameplayBehaviorRuntimeIds | undefined, path: string): number {
  return resolveMappedId(command.timerId ?? runtimeIdByName(ids?.timers, command.timer), command.timer, "timer", "timer", path);
}

export function timerTriggerActionId(command: Extract<BehaviorRecipeCommand, { type: "configureTimerTrigger" }>, ids: GameplayBehaviorRuntimeIds | undefined, path: string): number | undefined {
  if (command.action === undefined && command.actionId === undefined) return undefined;
  return gameplayActionId(command, ids, path);
}
