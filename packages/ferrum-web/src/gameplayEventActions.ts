import type { GameplayEventView } from "./gameplayEventDecoder";
import type { BehaviorRecipeCommand } from "./behaviorRecipes";
import type { GameplayBehaviorRuntimeIds, GameplayEntityHandle } from "./gameplayAuthoring";
import { gameplayAuthoringDiagnosticError } from "./diagnostics.js";
import {
  GAMEPLAY_ACTION_FAILURE_BLOCKED_PLACEMENT,
  GAMEPLAY_ACTION_FAILURE_COOLING_DOWN,
  GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_BINDING,
  GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_TARGET,
  GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM,
  GAMEPLAY_ACTION_FAILURE_PATTERN_MISMATCH,
  GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL,
  GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_AIM_SOURCE,
  GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_ANCHOR,
  GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_COLLISION_TARGET,
  GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PHASE,
  GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PREFAB,
  GAMEPLAY_EVENT_FLAG_TILE_IMPACT_BOUNCED,
  GAMEPLAY_EVENT_FLAG_TILE_IMPACT_IDENTITY_TRUNCATED,
  GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_MASK,
  GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_NEGATIVE_X,
  GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_NEGATIVE_Y,
  GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_POSITIVE_X,
  GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_POSITIVE_Y,
  GAMEPLAY_EVENT_TILE_IMPACT_LAYER_SHIFT,
  GAMEPLAY_EVENT_TILE_IMPACT_TILE_MASK,
  GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_SHIFT,
  gameplayPresentationEffectKind,
  type GameplayPresentationEffectKind,
} from "./gameplayEventDecoder.js";

const FLOAT32_BITS_VIEW = new DataView(new ArrayBuffer(4));

export type UnknownGameplayEventPolicy = "error" | "ignore";

export type GameplayActionFailureReason =
  | "unsupportedPrefab"
  | "unsupportedAnchor"
  | "unsupportedPhase"
  | "missingSourceTransform"
  | "spawnQueueFull"
  | "patternMismatch"
  | "blockedPlacement"
  | "missingActionBinding"
  | "coolingDown"
  | "unsupportedAimSource"
  | "missingActionTarget"
  | "unsupportedCollisionTarget"
  | "unknown";

export type GameplayTileImpactPolicy = "despawn" | "passThrough" | "bounce" | "unknown";
export type GameplayTileImpactNormal = "none" | "positiveX" | "negativeX" | "positiveY" | "negativeY" | "unknown";

export type GameplayEventActionNameMap =
  | Readonly<Record<number, string>>
  | ReadonlyMap<number, string>;

export interface GameplayInteractionActionMetadata {
  actionId: number;
  action: string;
  prompt?: string;
}

export type GameplayEventActionMetadataMap =
  | Readonly<Record<number, GameplayInteractionActionMetadata>>
  | ReadonlyMap<number, GameplayInteractionActionMetadata>;

export interface GameplayEventActionMetadataOptions {
  path?: string;
  ids?: GameplayBehaviorRuntimeIds;
}

export interface GameplayInteractionEventAction {
  type: "interaction";
  actionId: number;
  action?: string;
  prompt?: string;
  actor: GameplayEntityHandle;
  source: GameplayEntityHandle;
  once: boolean;
  consumedThisFrame: boolean;
  flags: number;
  payloadBits: number;
  event: GameplayEventView;
}

export interface GameplayCollisionDamageEventAction {
  type: "collisionDamage";
  actor: GameplayEntityHandle;
  source: GameplayEntityHandle;
  damage: number;
  targetRemoved: boolean;
  flags: number;
  payloadBits: number;
  event: GameplayEventView;
}

export interface GameplayCollisionDespawnEventAction {
  type: "collisionDespawn";
  actor: GameplayEntityHandle;
  source: GameplayEntityHandle;
  targetRemoved: boolean;
  flags: number;
  payloadBits: number;
  event: GameplayEventView;
}

export interface GameplayBehaviorStateChangedEventAction {
  type: "behaviorStateChanged";
  actor: GameplayEntityHandle;
  source: GameplayEntityHandle;
  previousStateId: number;
  nextStateId: number;
  flags: number;
  payloadBits: number;
  event: GameplayEventView;
}

export interface GameplayPrefabSpawnedEventAction {
  type: "prefabSpawned";
  actor: GameplayEntityHandle;
  source: GameplayEntityHandle;
  prefabId: number;
  actionId: number;
  flags: number;
  payloadBits: number;
  event: GameplayEventView;
}

export interface GameplayActionFailedEventAction {
  type: "actionFailed";
  actor: GameplayEntityHandle;
  source: GameplayEntityHandle;
  actionId: number;
  reasonCode: number;
  reason: GameplayActionFailureReason;
  flags: number;
  payloadBits: number;
  event: GameplayEventView;
}

export interface GameplayTimerEventAction {
  type: "timer";
  actor: GameplayEntityHandle;
  source: GameplayEntityHandle;
  timerId: number;
  durationSeconds: number;
  flags: number;
  payloadBits: number;
  event: GameplayEventView;
}

export interface GameplayPickupCollectedEventAction {
  type: "pickupCollected";
  actor: GameplayEntityHandle;
  source: GameplayEntityHandle;
  itemId: number;
  count: number;
  targetRemoved: boolean;
  flags: number;
  payloadBits: number;
  event: GameplayEventView;
}

export interface GameplayTileImpactEventAction {
  type: "tileImpact";
  actor: GameplayEntityHandle;
  source: GameplayEntityHandle;
  projectile: GameplayEntityHandle;
  tileImpactCode: number;
  tileImpact: GameplayTileImpactPolicy;
  layerIndex: number;
  tileIndex: number;
  normal: GameplayTileImpactNormal;
  bounced: boolean;
  identityTruncated: boolean;
  targetRemoved: boolean;
  flags: number;
  payloadBits: number;
  event: GameplayEventView;
}

export interface GameplayFactionDamageDeniedEventAction {
  type: "factionDamageDenied";
  actor: GameplayEntityHandle;
  source: GameplayEntityHandle;
  sourceFactionId: number;
  targetFactionId: number;
  flags: number;
  payloadBits: number;
  event: GameplayEventView;
}

export interface GameplayPresentationEffectEventAction {
  type: "presentationEffect";
  actor: GameplayEntityHandle;
  source: GameplayEntityHandle;
  effectId: number;
  effectType: number;
  effectKind: GameplayPresentationEffectKind;
  flags: number;
  payloadBits: number;
  event: GameplayEventView;
}

export type GameplayEventAction =
  | GameplayInteractionEventAction
  | GameplayCollisionDamageEventAction
  | GameplayCollisionDespawnEventAction
  | GameplayBehaviorStateChangedEventAction
  | GameplayPrefabSpawnedEventAction
  | GameplayActionFailedEventAction
  | GameplayTimerEventAction
  | GameplayPickupCollectedEventAction
  | GameplayTileImpactEventAction
  | GameplayFactionDamageDeniedEventAction
  | GameplayPresentationEffectEventAction;

export interface GameplayEventActionTarget {
  applyGameplayEventAction(action: GameplayEventAction): unknown;
}

export interface GameplayEventActionOptions {
  path?: string;
  actionNames?: GameplayEventActionNameMap;
  actionMetadata?: GameplayEventActionMetadataMap;
  requireActionNames?: boolean;
  unknownEvent?: UnknownGameplayEventPolicy;
}

export interface GameplayEventActionApplyResult {
  events: readonly GameplayEventView[];
  actions: readonly GameplayEventAction[];
  results: readonly unknown[];
}

export function gameplayEventActionMetadataForCommands(
  commands: readonly BehaviorRecipeCommand[],
  options: GameplayEventActionMetadataOptions = {},
): Readonly<Record<number, GameplayInteractionActionMetadata>> {
  const path = options.path ?? "gameplayEventActions";
  const metadata: Record<number, GameplayInteractionActionMetadata> = {};

  commands.forEach((command, index) => {
    if (command.type !== "configureInteraction") {
      return;
    }
    const commandPath = `${path}.commands.${index}`;
    const actionId = interactionCommandActionId(command, options.ids, commandPath);
    const action = nonEmptyString(command.action, `${commandPath}.action`);
    const entry: GameplayInteractionActionMetadata = {
      actionId,
      action,
      ...(command.prompt === undefined ? {} : { prompt: nonEmptyString(command.prompt, `${commandPath}.prompt`) }),
    };
    const existing = metadata[actionId];
    if (existing !== undefined && !sameInteractionMetadata(existing, entry)) {
      throw gameplayAuthoringDiagnosticError(
        `${commandPath}.actionId`,
        `conflicts with existing interaction action metadata for runtime action id ${actionId}`,
      );
    }
    metadata[actionId] = entry;
  });

  return metadata;
}

export function gameplayActionsForEvents(
  events: readonly GameplayEventView[],
  options: GameplayEventActionOptions = {},
): readonly GameplayEventAction[] {
  const path = options.path ?? "gameplayEvents";
  const unknownEvent = unknownGameplayEventPolicy(options.unknownEvent ?? "error", `${path}.unknownEvent`);
  const actions: GameplayEventAction[] = [];

  events.forEach((event, index) => {
    const eventPath = `${path}.events.${index}`;
    if (event.kind === "interaction") {
      actions.push(interactionActionForEvent(event, eventPath, options));
      return;
    }
    if (event.kind === "collisionDamage") {
      actions.push(collisionDamageActionForEvent(event, eventPath));
      return;
    }
    if (event.kind === "collisionDespawn") {
      actions.push(collisionDespawnActionForEvent(event, eventPath));
      return;
    }
    if (event.kind === "behaviorStateChanged") {
      actions.push(behaviorStateChangedActionForEvent(event, eventPath));
      return;
    }
    if (event.kind === "prefabSpawned") {
      actions.push(prefabSpawnedActionForEvent(event, eventPath));
      return;
    }
    if (event.kind === "actionFailed") {
      actions.push(actionFailedActionForEvent(event, eventPath));
      return;
    }
    if (event.kind === "timer") {
      actions.push(timerActionForEvent(event, eventPath));
      return;
    }
    if (event.kind === "pickupCollected") {
      actions.push(pickupCollectedActionForEvent(event, eventPath));
      return;
    }
    if (event.kind === "tileImpact") {
      actions.push(tileImpactActionForEvent(event, eventPath));
      return;
    }
    if (event.kind === "factionDamageDenied") {
      actions.push(factionDamageDeniedActionForEvent(event, eventPath));
      return;
    }
    if (event.kind === "presentationEffect") {
      actions.push(presentationEffectActionForEvent(event, eventPath));
      return;
    }
    if (unknownEvent === "error") {
      throw gameplayAuthoringDiagnosticError(`${eventPath}.kind`, `unsupported gameplay event kind '${event.kind}'`);
    }
  });

  return actions;
}

function collisionDamageActionForEvent(
  event: GameplayEventView,
  path: string,
): GameplayCollisionDamageEventAction {
  return {
    type: "collisionDamage",
    actor: entityHandleForEvent(event.actorId, event.actorGeneration, `${path}.actor`),
    source: entityHandleForEvent(event.sourceId, event.sourceGeneration, `${path}.source`),
    damage: float32FromBits(nonNegativeInteger(event.payloadBits, `${path}.payloadBits`)),
    targetRemoved: event.targetRemoved,
    flags: nonNegativeInteger(event.flags, `${path}.flags`),
    payloadBits: nonNegativeInteger(event.payloadBits, `${path}.payloadBits`),
    event,
  };
}

function collisionDespawnActionForEvent(
  event: GameplayEventView,
  path: string,
): GameplayCollisionDespawnEventAction {
  return {
    type: "collisionDespawn",
    actor: entityHandleForEvent(event.actorId, event.actorGeneration, `${path}.actor`),
    source: entityHandleForEvent(event.sourceId, event.sourceGeneration, `${path}.source`),
    targetRemoved: event.targetRemoved,
    flags: nonNegativeInteger(event.flags, `${path}.flags`),
    payloadBits: nonNegativeInteger(event.payloadBits, `${path}.payloadBits`),
    event,
  };
}

function behaviorStateChangedActionForEvent(
  event: GameplayEventView,
  path: string,
): GameplayBehaviorStateChangedEventAction {
  return {
    type: "behaviorStateChanged",
    actor: entityHandleForEvent(event.actorId, event.actorGeneration, `${path}.actor`),
    source: entityHandleForEvent(event.sourceId, event.sourceGeneration, `${path}.source`),
    previousStateId: positiveInteger(event.payloadBits, `${path}.previousStateId`),
    nextStateId: positiveInteger(event.tokenId, `${path}.nextStateId`),
    flags: nonNegativeInteger(event.flags, `${path}.flags`),
    payloadBits: nonNegativeInteger(event.payloadBits, `${path}.payloadBits`),
    event,
  };
}

function prefabSpawnedActionForEvent(
  event: GameplayEventView,
  path: string,
): GameplayPrefabSpawnedEventAction {
  return {
    type: "prefabSpawned",
    actor: entityHandleForEvent(event.actorId, event.actorGeneration, `${path}.actor`),
    source: entityHandleForEvent(event.sourceId, event.sourceGeneration, `${path}.source`),
    prefabId: positiveInteger(event.tokenId, `${path}.prefabId`),
    actionId: positiveInteger(event.payloadBits, `${path}.actionId`),
    flags: nonNegativeInteger(event.flags, `${path}.flags`),
    payloadBits: nonNegativeInteger(event.payloadBits, `${path}.payloadBits`),
    event,
  };
}

function actionFailedActionForEvent(
  event: GameplayEventView,
  path: string,
): GameplayActionFailedEventAction {
  const reasonCode = positiveInteger(event.payloadBits, `${path}.reasonCode`);
  return {
    type: "actionFailed",
    actor: entityHandleForEvent(event.actorId, event.actorGeneration, `${path}.actor`),
    source: entityHandleForEvent(event.sourceId, event.sourceGeneration, `${path}.source`),
    actionId: positiveInteger(event.tokenId, `${path}.actionId`),
    reasonCode,
    reason: gameplayActionFailureReasonForCode(reasonCode),
    flags: nonNegativeInteger(event.flags, `${path}.flags`),
    payloadBits: nonNegativeInteger(event.payloadBits, `${path}.payloadBits`),
    event,
  };
}

function timerActionForEvent(
  event: GameplayEventView,
  path: string,
): GameplayTimerEventAction {
  return {
    type: "timer",
    actor: entityHandleForEvent(event.actorId, event.actorGeneration, `${path}.actor`),
    source: entityHandleForEvent(event.sourceId, event.sourceGeneration, `${path}.source`),
    timerId: positiveInteger(event.tokenId, `${path}.timerId`),
    durationSeconds: float32FromBits(nonNegativeInteger(event.payloadBits, `${path}.payloadBits`)),
    flags: nonNegativeInteger(event.flags, `${path}.flags`),
    payloadBits: nonNegativeInteger(event.payloadBits, `${path}.payloadBits`),
    event,
  };
}

function pickupCollectedActionForEvent(
  event: GameplayEventView,
  path: string,
): GameplayPickupCollectedEventAction {
  return {
    type: "pickupCollected",
    actor: entityHandleForEvent(event.actorId, event.actorGeneration, `${path}.actor`),
    source: entityHandleForEvent(event.sourceId, event.sourceGeneration, `${path}.source`),
    itemId: positiveInteger(event.tokenId, `${path}.itemId`),
    count: positiveInteger(event.payloadBits, `${path}.count`),
    targetRemoved: event.targetRemoved,
    flags: nonNegativeInteger(event.flags, `${path}.flags`),
    payloadBits: nonNegativeInteger(event.payloadBits, `${path}.payloadBits`),
    event,
  };
}

function tileImpactActionForEvent(
  event: GameplayEventView,
  path: string,
): GameplayTileImpactEventAction {
  const actor = entityHandleForEvent(event.actorId, event.actorGeneration, `${path}.actor`);
  const source = entityHandleForEvent(event.sourceId, event.sourceGeneration, `${path}.source`);
  const payloadBits = nonNegativeInteger(event.payloadBits, `${path}.payloadBits`);
  const tileImpactCode = nonNegativeInteger(event.tokenId, `${path}.tileImpactCode`);
  return {
    type: "tileImpact",
    actor,
    source,
    projectile: actor,
    tileImpactCode,
    tileImpact: gameplayTileImpactForCode(tileImpactCode),
    layerIndex: unpackTileImpactLayerIndex(payloadBits),
    tileIndex: unpackTileImpactTileIndex(payloadBits),
    normal: gameplayTileImpactNormalForFlags(nonNegativeInteger(event.flags, `${path}.flags`)),
    bounced: (event.flags & GAMEPLAY_EVENT_FLAG_TILE_IMPACT_BOUNCED) !== 0,
    identityTruncated: (event.flags & GAMEPLAY_EVENT_FLAG_TILE_IMPACT_IDENTITY_TRUNCATED) !== 0,
    targetRemoved: event.targetRemoved,
    flags: nonNegativeInteger(event.flags, `${path}.flags`),
    payloadBits,
    event,
  };
}

function factionDamageDeniedActionForEvent(
  event: GameplayEventView,
  path: string,
): GameplayFactionDamageDeniedEventAction {
  return {
    type: "factionDamageDenied",
    actor: entityHandleForEvent(event.actorId, event.actorGeneration, `${path}.actor`),
    source: entityHandleForEvent(event.sourceId, event.sourceGeneration, `${path}.source`),
    sourceFactionId: nonNegativeInteger(event.tokenId, `${path}.sourceFactionId`),
    targetFactionId: nonNegativeInteger(event.payloadBits, `${path}.targetFactionId`),
    flags: nonNegativeInteger(event.flags, `${path}.flags`),
    payloadBits: nonNegativeInteger(event.payloadBits, `${path}.payloadBits`),
    event,
  };
}

function presentationEffectActionForEvent(
  event: GameplayEventView,
  path: string,
): GameplayPresentationEffectEventAction {
  return {
    type: "presentationEffect",
    actor: entityHandleForEvent(event.actorId, event.actorGeneration, `${path}.actor`),
    source: entityHandleForEvent(event.sourceId, event.sourceGeneration, `${path}.source`),
    effectId: nonNegativeInteger(event.tokenId, `${path}.tokenId`),
    effectType: nonNegativeInteger(event.payloadBits, `${path}.payloadBits`),
    effectKind: gameplayPresentationEffectKind(event.payloadBits),
    flags: nonNegativeInteger(event.flags, `${path}.flags`),
    payloadBits: nonNegativeInteger(event.payloadBits, `${path}.payloadBits`),
    event,
  };
}

export function gameplayTileImpactForCode(tileImpactCode: number): GameplayTileImpactPolicy {
  if (tileImpactCode === 0) return "despawn";
  if (tileImpactCode === 1) return "passThrough";
  if (tileImpactCode === 2) return "bounce";
  return "unknown";
}

export function gameplayTileImpactNormalForFlags(flags: number): GameplayTileImpactNormal {
  const code = (flags & GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_MASK) >>> GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_SHIFT;
  if (code === 0) return "none";
  if (code === GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_POSITIVE_X) return "positiveX";
  if (code === GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_NEGATIVE_X) return "negativeX";
  if (code === GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_POSITIVE_Y) return "positiveY";
  if (code === GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_NEGATIVE_Y) return "negativeY";
  return "unknown";
}

export function unpackTileImpactLayerIndex(payloadBits: number): number {
  return nonNegativeInteger(payloadBits, "payloadBits") >>> GAMEPLAY_EVENT_TILE_IMPACT_LAYER_SHIFT;
}

export function unpackTileImpactTileIndex(payloadBits: number): number {
  return nonNegativeInteger(payloadBits, "payloadBits") & GAMEPLAY_EVENT_TILE_IMPACT_TILE_MASK;
}

export function gameplayActionFailureReasonForCode(reasonCode: number): GameplayActionFailureReason {
  if (reasonCode === GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PREFAB) return "unsupportedPrefab";
  if (reasonCode === GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_ANCHOR) return "unsupportedAnchor";
  if (reasonCode === GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PHASE) return "unsupportedPhase";
  if (reasonCode === GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM) return "missingSourceTransform";
  if (reasonCode === GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL) return "spawnQueueFull";
  if (reasonCode === GAMEPLAY_ACTION_FAILURE_PATTERN_MISMATCH) return "patternMismatch";
  if (reasonCode === GAMEPLAY_ACTION_FAILURE_BLOCKED_PLACEMENT) return "blockedPlacement";
  if (reasonCode === GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_BINDING) return "missingActionBinding";
  if (reasonCode === GAMEPLAY_ACTION_FAILURE_COOLING_DOWN) return "coolingDown";
  if (reasonCode === GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_AIM_SOURCE) return "unsupportedAimSource";
  if (reasonCode === GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_TARGET) return "missingActionTarget";
  if (reasonCode === GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_COLLISION_TARGET) return "unsupportedCollisionTarget";
  return "unknown";
}

export function applyGameplayEventActions(
  target: GameplayEventActionTarget,
  events: readonly GameplayEventView[],
  options: GameplayEventActionOptions = {},
): GameplayEventActionApplyResult {
  const path = options.path ?? "gameplayEvents";
  if (!isObjectRecord(target) || typeof target.applyGameplayEventAction !== "function") {
    throw gameplayAuthoringDiagnosticError(`${path}.target`, "must expose applyGameplayEventAction(action)");
  }
  const actions = gameplayActionsForEvents(events, options);
  return {
    events,
    actions,
    results: actions.map((action) => target.applyGameplayEventAction(action)),
  };
}

function interactionActionForEvent(
  event: GameplayEventView,
  path: string,
  options: GameplayEventActionOptions,
): GameplayInteractionEventAction {
  const actionId = positiveInteger(event.tokenId, `${path}.tokenId`);
  const metadata = actionMetadataForId(actionId, options.actionMetadata, `${path}.metadata`);
  const action = metadata?.action
    ?? actionNameForId(actionId, options.actionNames, `${path}.action`, options.requireActionNames === true);
  return {
    type: "interaction",
    actionId,
    ...(action === undefined ? {} : { action }),
    ...(metadata?.prompt === undefined ? {} : { prompt: metadata.prompt }),
    actor: {
      entityId: nonNegativeInteger(event.actorId, `${path}.actorId`),
      entityGeneration: nonNegativeInteger(event.actorGeneration, `${path}.actorGeneration`),
    },
    source: {
      entityId: nonNegativeInteger(event.sourceId, `${path}.sourceId`),
      entityGeneration: nonNegativeInteger(event.sourceGeneration, `${path}.sourceGeneration`),
    },
    once: event.once,
    consumedThisFrame: event.consumedThisFrame,
    flags: nonNegativeInteger(event.flags, `${path}.flags`),
    payloadBits: nonNegativeInteger(event.payloadBits, `${path}.payloadBits`),
    event,
  };
}

function entityHandleForEvent(
  entityId: number,
  entityGeneration: number,
  path: string,
): GameplayEntityHandle {
  return {
    entityId: nonNegativeInteger(entityId, `${path}.entityId`),
    entityGeneration: nonNegativeInteger(entityGeneration, `${path}.entityGeneration`),
  };
}

function float32FromBits(bits: number): number {
  FLOAT32_BITS_VIEW.setUint32(0, bits, true);
  return FLOAT32_BITS_VIEW.getFloat32(0, true);
}

function actionMetadataForId(
  actionId: number,
  actionMetadata: GameplayEventActionMetadataMap | undefined,
  path: string,
): GameplayInteractionActionMetadata | undefined {
  if (actionMetadata === undefined) {
    return undefined;
  }
  const metadata = isMetadataMap(actionMetadata)
    ? actionMetadata.get(actionId)
    : actionMetadata[actionId];
  if (metadata === undefined) {
    return undefined;
  }
  if (!isObjectRecord(metadata)) {
    throw gameplayAuthoringDiagnosticError(path, "must be an interaction action metadata object");
  }
  const metadataActionId = positiveInteger(metadata.actionId, `${path}.actionId`);
  if (metadataActionId !== actionId) {
    throw gameplayAuthoringDiagnosticError(`${path}.actionId`, `must match runtime action id ${actionId}`);
  }
  return {
    actionId,
    action: nonEmptyString(metadata.action, `${path}.action`),
    ...(metadata.prompt === undefined ? {} : { prompt: nonEmptyString(metadata.prompt, `${path}.prompt`) }),
  };
}

function actionNameForId(
  actionId: number,
  actionNames: GameplayEventActionNameMap | undefined,
  path: string,
  required: boolean,
): string | undefined {
  const action = actionNames === undefined
    ? undefined
    : isNameMap(actionNames)
      ? actionNames.get(actionId)
      : actionNames[actionId];
  if (action === undefined) {
    if (required) {
      throw gameplayAuthoringDiagnosticError(path, `must map runtime action id ${actionId} to an action name`);
    }
    return undefined;
  }
  if (typeof action !== "string" || action.length === 0) {
    throw gameplayAuthoringDiagnosticError(path, "must be a non-empty action name string");
  }
  return action;
}

function interactionCommandActionId(
  command: Extract<BehaviorRecipeCommand, { type: "configureInteraction" }>,
  ids: GameplayBehaviorRuntimeIds | undefined,
  path: string,
): number {
  const actionId = command.actionId ?? ids?.actions?.[command.action];
  if (actionId === undefined) {
    throw gameplayAuthoringDiagnosticError(`${path}.action`, `must resolve interaction action '${command.action}' to a runtime action id`);
  }
  return positiveInteger(actionId, `${path}.actionId`);
}

function sameInteractionMetadata(
  left: GameplayInteractionActionMetadata,
  right: GameplayInteractionActionMetadata,
): boolean {
  return left.actionId === right.actionId
    && left.action === right.action
    && left.prompt === right.prompt;
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw gameplayAuthoringDiagnosticError(path, "must be a non-empty string");
  }
  return value;
}

function unknownGameplayEventPolicy(value: unknown, path: string): UnknownGameplayEventPolicy {
  if (value === "error" || value === "ignore") {
    return value;
  }
  throw gameplayAuthoringDiagnosticError(path, "must be one of error or ignore");
}

function positiveInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw gameplayAuthoringDiagnosticError(path, "must be a positive integer");
  }
  return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw gameplayAuthoringDiagnosticError(path, "must be a non-negative integer");
  }
  return value;
}

function isObjectRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value);
}

function isNameMap(value: GameplayEventActionNameMap): value is ReadonlyMap<number, string> {
  return typeof (value as ReadonlyMap<number, string>).get === "function";
}

function isMetadataMap(value: GameplayEventActionMetadataMap): value is ReadonlyMap<number, GameplayInteractionActionMetadata> {
  return typeof (value as ReadonlyMap<number, GameplayInteractionActionMetadata>).get === "function";
}
