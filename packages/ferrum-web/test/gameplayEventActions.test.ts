import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  applyGameplayEventActions,
  gameplayActionFailureReasonForCode,
  gameplayEventActionMetadataForCommands,
  gameplayActionsForEvents,
  gameplayTileImpactForCode,
  gameplayTileImpactNormalForFlags,
  unpackTileImpactLayerIndex,
  unpackTileImpactTileIndex,
} from "../src/gameplayEventActions.js";
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
  GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_NEGATIVE_X,
  GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_SHIFT,
  type GameplayEventView,
} from "../src/gameplayEventDecoder.js";

const interactionEvent: GameplayEventView = {
  kind: "interaction",
  kindCode: 1,
  actorId: 3,
  actorGeneration: 0,
  sourceId: 9,
  sourceGeneration: 2,
  tokenId: 7,
  flags: 3,
  payloadBits: 0,
  once: true,
  consumedThisFrame: true,
  targetRemoved: false,
};

const collisionDamageEvent: GameplayEventView = {
  kind: "collisionDamage",
  kindCode: 2,
  actorId: 4,
  actorGeneration: 1,
  sourceId: 12,
  sourceGeneration: 3,
  tokenId: 0,
  flags: 4,
  payloadBits: 0x3f800000,
  once: false,
  consumedThisFrame: false,
  targetRemoved: true,
};

const collisionDespawnEvent: GameplayEventView = {
  kind: "collisionDespawn",
  kindCode: 3,
  actorId: 12,
  actorGeneration: 3,
  sourceId: 12,
  sourceGeneration: 3,
  tokenId: 0,
  flags: 4,
  payloadBits: 0,
  once: false,
  consumedThisFrame: false,
  targetRemoved: true,
};

const behaviorStateChangedEvent: GameplayEventView = {
  kind: "behaviorStateChanged",
  kindCode: 4,
  actorId: 12,
  actorGeneration: 3,
  sourceId: 12,
  sourceGeneration: 3,
  tokenId: 2,
  flags: 0,
  payloadBits: 1,
  once: false,
  consumedThisFrame: false,
  targetRemoved: false,
};

const prefabSpawnedEvent: GameplayEventView = {
  kind: "prefabSpawned",
  kindCode: 5,
  actorId: 20,
  actorGeneration: 1,
  sourceId: 7,
  sourceGeneration: 0,
  tokenId: 1,
  flags: 0,
  payloadBits: 11,
  once: false,
  consumedThisFrame: false,
  targetRemoved: false,
};

const actionFailedEvent: GameplayEventView = {
  kind: "actionFailed",
  kindCode: 6,
  actorId: 7,
  actorGeneration: 0,
  sourceId: 7,
  sourceGeneration: 0,
  tokenId: 11,
  flags: 0,
  payloadBits: 5,
  once: false,
  consumedThisFrame: false,
  targetRemoved: false,
};

const patternMismatchActionFailedEvent: GameplayEventView = {
  ...actionFailedEvent,
  payloadBits: 6,
};

const blockedPlacementActionFailedEvent: GameplayEventView = {
  ...actionFailedEvent,
  payloadBits: 7,
};

const missingBindingActionFailedEvent: GameplayEventView = {
  ...actionFailedEvent,
  payloadBits: 8,
};

const coolingDownActionFailedEvent: GameplayEventView = {
  ...actionFailedEvent,
  payloadBits: 9,
};

const unsupportedAimSourceActionFailedEvent: GameplayEventView = {
  ...actionFailedEvent,
  payloadBits: 10,
};

const missingActionTargetActionFailedEvent: GameplayEventView = {
  ...actionFailedEvent,
  payloadBits: 11,
};

const unsupportedCollisionTargetActionFailedEvent: GameplayEventView = {
  ...actionFailedEvent,
  payloadBits: 12,
};

const timerEvent: GameplayEventView = {
  kind: "timer",
  kindCode: 7,
  actorId: 8,
  actorGeneration: 0,
  sourceId: 8,
  sourceGeneration: 0,
  tokenId: 9,
  flags: 0,
  payloadBits: 0x3e800000,
  once: false,
  consumedThisFrame: false,
  targetRemoved: false,
};

const pickupCollectedEvent: GameplayEventView = {
  kind: "pickupCollected",
  kindCode: 8,
  actorId: 10,
  actorGeneration: 1,
  sourceId: 0,
  sourceGeneration: 0,
  tokenId: 1,
  flags: 4,
  payloadBits: 3,
  once: false,
  consumedThisFrame: false,
  targetRemoved: true,
};

const tileImpactEvent: GameplayEventView = {
  kind: "tileImpact",
  kindCode: 9,
  actorId: 11,
  actorGeneration: 2,
  sourceId: 11,
  sourceGeneration: 2,
  tokenId: 2,
  flags: GAMEPLAY_EVENT_FLAG_TILE_IMPACT_BOUNCED | (GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_NEGATIVE_X << GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_SHIFT),
  payloadBits: (1 << 24) | 4,
  once: false,
  consumedThisFrame: false,
  targetRemoved: false,
};

const factionDamageDeniedEvent: GameplayEventView = {
  kind: "factionDamageDenied",
  kindCode: 10,
  actorId: 4,
  actorGeneration: 1,
  sourceId: 12,
  sourceGeneration: 3,
  tokenId: 2,
  flags: 0,
  payloadBits: 1,
  once: false,
  consumedThisFrame: false,
  targetRemoved: false,
};

const animationFrameEvent: GameplayEventView = {
  kind: "animationFrame",
  kindCode: 12,
  actorId: 15,
  actorGeneration: 1,
  sourceId: 15,
  sourceGeneration: 1,
  tokenId: 77,
  flags: 1,
  payloadBits: (2 << 16) | 3,
  once: false,
  consumedThisFrame: false,
  targetRemoved: false,
};

test("gameplayActionsForEvents converts decoded interaction events to game-specific actions", () => {
  const actions = gameplayActionsForEvents([interactionEvent], {
    actionNames: {
      7: "inspect",
    },
    requireActionNames: true,
  });

  deepEqual(actions, [
    {
      type: "interaction",
      actionId: 7,
      action: "inspect",
      actor: { entityId: 3, entityGeneration: 0 },
      source: { entityId: 9, entityGeneration: 2 },
      once: true,
      consumedThisFrame: true,
      flags: 3,
      payloadBits: 0,
      event: interactionEvent,
    },
  ]);
});

test("gameplayActionsForEvents converts collision reaction events to frame-end actions", () => {
  const actions = gameplayActionsForEvents([collisionDamageEvent, collisionDespawnEvent]);

  deepEqual(actions, [
    {
      type: "collisionDamage",
      actor: { entityId: 4, entityGeneration: 1 },
      source: { entityId: 12, entityGeneration: 3 },
      damage: 1,
      targetRemoved: true,
      flags: 4,
      payloadBits: 0x3f800000,
      event: collisionDamageEvent,
    },
    {
      type: "collisionDespawn",
      actor: { entityId: 12, entityGeneration: 3 },
      source: { entityId: 12, entityGeneration: 3 },
      targetRemoved: true,
      flags: 4,
      payloadBits: 0,
      event: collisionDespawnEvent,
    },
  ]);
});

test("gameplayActionsForEvents converts behavior state changes to telemetry actions", () => {
  const actions = gameplayActionsForEvents([behaviorStateChangedEvent]);

  deepEqual(actions, [{
    type: "behaviorStateChanged",
    actor: { entityId: 12, entityGeneration: 3 },
    source: { entityId: 12, entityGeneration: 3 },
    previousStateId: 1,
    nextStateId: 2,
    flags: 0,
    payloadBits: 1,
    event: behaviorStateChangedEvent,
  }]);
});

test("gameplayActionsForEvents converts prefab spawned events to telemetry actions", () => {
  const actions = gameplayActionsForEvents([prefabSpawnedEvent]);

  deepEqual(actions, [{
    type: "prefabSpawned",
    actor: { entityId: 20, entityGeneration: 1 },
    source: { entityId: 7, entityGeneration: 0 },
    prefabId: 1,
    actionId: 11,
    flags: 0,
    payloadBits: 11,
    event: prefabSpawnedEvent,
  }]);
});

test("gameplayActionsForEvents converts action failures to telemetry actions", () => {
  const actions = gameplayActionsForEvents([
    actionFailedEvent,
    patternMismatchActionFailedEvent,
    blockedPlacementActionFailedEvent,
    missingBindingActionFailedEvent,
    coolingDownActionFailedEvent,
    unsupportedAimSourceActionFailedEvent,
    missingActionTargetActionFailedEvent,
    unsupportedCollisionTargetActionFailedEvent,
  ]);

  deepEqual(actions, [
    {
      type: "actionFailed",
      actor: { entityId: 7, entityGeneration: 0 },
      source: { entityId: 7, entityGeneration: 0 },
      actionId: 11,
      reasonCode: 5,
      reason: "spawnQueueFull",
      flags: 0,
      payloadBits: 5,
      event: actionFailedEvent,
    },
    {
      type: "actionFailed",
      actor: { entityId: 7, entityGeneration: 0 },
      source: { entityId: 7, entityGeneration: 0 },
      actionId: 11,
      reasonCode: 6,
      reason: "patternMismatch",
      flags: 0,
      payloadBits: 6,
      event: patternMismatchActionFailedEvent,
    },
    {
      type: "actionFailed",
      actor: { entityId: 7, entityGeneration: 0 },
      source: { entityId: 7, entityGeneration: 0 },
      actionId: 11,
      reasonCode: 7,
      reason: "blockedPlacement",
      flags: 0,
      payloadBits: 7,
      event: blockedPlacementActionFailedEvent,
    },
    {
      type: "actionFailed",
      actor: { entityId: 7, entityGeneration: 0 },
      source: { entityId: 7, entityGeneration: 0 },
      actionId: 11,
      reasonCode: 8,
      reason: "missingActionBinding",
      flags: 0,
      payloadBits: 8,
      event: missingBindingActionFailedEvent,
    },
    {
      type: "actionFailed",
      actor: { entityId: 7, entityGeneration: 0 },
      source: { entityId: 7, entityGeneration: 0 },
      actionId: 11,
      reasonCode: 9,
      reason: "coolingDown",
      flags: 0,
      payloadBits: 9,
      event: coolingDownActionFailedEvent,
    },
    {
      type: "actionFailed",
      actor: { entityId: 7, entityGeneration: 0 },
      source: { entityId: 7, entityGeneration: 0 },
      actionId: 11,
      reasonCode: 10,
      reason: "unsupportedAimSource",
      flags: 0,
      payloadBits: 10,
      event: unsupportedAimSourceActionFailedEvent,
    },
    {
      type: "actionFailed",
      actor: { entityId: 7, entityGeneration: 0 },
      source: { entityId: 7, entityGeneration: 0 },
      actionId: 11,
      reasonCode: 11,
      reason: "missingActionTarget",
      flags: 0,
      payloadBits: 11,
      event: missingActionTargetActionFailedEvent,
    },
    {
      type: "actionFailed",
      actor: { entityId: 7, entityGeneration: 0 },
      source: { entityId: 7, entityGeneration: 0 },
      actionId: 11,
      reasonCode: 12,
      reason: "unsupportedCollisionTarget",
      flags: 0,
      payloadBits: 12,
      event: unsupportedCollisionTargetActionFailedEvent,
    },
  ]);
});

test("gameplayActionFailureReasonForCode maps the public reason vocabulary", () => {
  deepEqual([
    [GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PREFAB, gameplayActionFailureReasonForCode(GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PREFAB)],
    [GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_ANCHOR, gameplayActionFailureReasonForCode(GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_ANCHOR)],
    [GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PHASE, gameplayActionFailureReasonForCode(GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PHASE)],
    [GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM, gameplayActionFailureReasonForCode(GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM)],
    [GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL, gameplayActionFailureReasonForCode(GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL)],
    [GAMEPLAY_ACTION_FAILURE_PATTERN_MISMATCH, gameplayActionFailureReasonForCode(GAMEPLAY_ACTION_FAILURE_PATTERN_MISMATCH)],
    [GAMEPLAY_ACTION_FAILURE_BLOCKED_PLACEMENT, gameplayActionFailureReasonForCode(GAMEPLAY_ACTION_FAILURE_BLOCKED_PLACEMENT)],
    [GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_BINDING, gameplayActionFailureReasonForCode(GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_BINDING)],
    [GAMEPLAY_ACTION_FAILURE_COOLING_DOWN, gameplayActionFailureReasonForCode(GAMEPLAY_ACTION_FAILURE_COOLING_DOWN)],
    [GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_AIM_SOURCE, gameplayActionFailureReasonForCode(GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_AIM_SOURCE)],
    [GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_TARGET, gameplayActionFailureReasonForCode(GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_TARGET)],
    [GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_COLLISION_TARGET, gameplayActionFailureReasonForCode(GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_COLLISION_TARGET)],
    [99, gameplayActionFailureReasonForCode(99)],
  ], [
    [1, "unsupportedPrefab"],
    [2, "unsupportedAnchor"],
    [3, "unsupportedPhase"],
    [4, "missingSourceTransform"],
    [5, "spawnQueueFull"],
    [6, "patternMismatch"],
    [7, "blockedPlacement"],
    [8, "missingActionBinding"],
    [9, "coolingDown"],
    [10, "unsupportedAimSource"],
    [11, "missingActionTarget"],
    [12, "unsupportedCollisionTarget"],
    [99, "unknown"],
  ]);
});

test("gameplayActionsForEvents converts timer events to deterministic trigger actions", () => {
  const actions = gameplayActionsForEvents([timerEvent]);

  deepEqual(actions, [{
    type: "timer",
    actor: { entityId: 8, entityGeneration: 0 },
    source: { entityId: 8, entityGeneration: 0 },
    timerId: 9,
    durationSeconds: 0.25,
    flags: 0,
    payloadBits: 0x3e800000,
    event: timerEvent,
  }]);
});

test("gameplayActionsForEvents converts pickup collected events to telemetry actions", () => {
  const actions = gameplayActionsForEvents([pickupCollectedEvent]);

  deepEqual(actions, [{
    type: "pickupCollected",
    actor: { entityId: 10, entityGeneration: 1 },
    source: { entityId: 0, entityGeneration: 0 },
    itemId: 1,
    count: 3,
    targetRemoved: true,
    flags: 4,
    payloadBits: 3,
    event: pickupCollectedEvent,
  }]);
});

test("gameplayActionsForEvents converts tile impact events to telemetry actions", () => {
  const actions = gameplayActionsForEvents([tileImpactEvent]);

  deepEqual(actions, [{
    type: "tileImpact",
    actor: { entityId: 11, entityGeneration: 2 },
    source: { entityId: 11, entityGeneration: 2 },
    projectile: { entityId: 11, entityGeneration: 2 },
    tileImpactCode: 2,
    tileImpact: "bounce",
    layerIndex: 1,
    tileIndex: 4,
    normal: "negativeX",
    bounced: true,
    identityTruncated: false,
    targetRemoved: false,
    flags: GAMEPLAY_EVENT_FLAG_TILE_IMPACT_BOUNCED | (GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_NEGATIVE_X << GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_SHIFT),
    payloadBits: (1 << 24) | 4,
    event: tileImpactEvent,
  }]);

  equal(gameplayTileImpactForCode(0), "despawn");
  equal(gameplayTileImpactForCode(1), "passThrough");
  equal(gameplayTileImpactForCode(2), "bounce");
  equal(gameplayTileImpactForCode(99), "unknown");
  equal(gameplayTileImpactNormalForFlags(tileImpactEvent.flags), "negativeX");
  equal(unpackTileImpactLayerIndex(tileImpactEvent.payloadBits), 1);
  equal(unpackTileImpactTileIndex(tileImpactEvent.payloadBits), 4);
});

test("gameplayActionsForEvents converts animation frame events to timeline actions", () => {
  const actions = gameplayActionsForEvents([animationFrameEvent]);

  deepEqual(actions, [{
    type: "animationFrame",
    actor: { entityId: 15, entityGeneration: 1 },
    source: { entityId: 15, entityGeneration: 1 },
    tokenId: 77,
    eventKind: 1,
    clipId: 2,
    frame: 3,
    flags: 1,
    payloadBits: (2 << 16) | 3,
    event: animationFrameEvent,
  }]);
});

test("gameplayActionsForEvents converts faction damage denials to telemetry actions", () => {
  const actions = gameplayActionsForEvents([factionDamageDeniedEvent]);

  deepEqual(actions, [{
    type: "factionDamageDenied",
    actor: { entityId: 4, entityGeneration: 1 },
    source: { entityId: 12, entityGeneration: 3 },
    sourceFactionId: 2,
    targetFactionId: 1,
    flags: 0,
    payloadBits: 1,
    event: factionDamageDeniedEvent,
  }]);
});

test("gameplayActionsForEvents preserves terminal tile impact flags", () => {
  const actions = gameplayActionsForEvents([{
    ...tileImpactEvent,
    tokenId: 0,
    flags: 4,
    payloadBits: 2,
    targetRemoved: true,
  }]);

  deepEqual(actions[0], {
    type: "tileImpact",
    actor: { entityId: 11, entityGeneration: 2 },
    source: { entityId: 11, entityGeneration: 2 },
    projectile: { entityId: 11, entityGeneration: 2 },
    tileImpactCode: 0,
    tileImpact: "despawn",
    layerIndex: 0,
    tileIndex: 2,
    normal: "none",
    bounced: false,
    identityTruncated: false,
    targetRemoved: true,
    flags: 4,
    payloadBits: 2,
    event: {
      ...tileImpactEvent,
      tokenId: 0,
      flags: 4,
      payloadBits: 2,
      targetRemoved: true,
    },
  });
});

test("gameplayActionsForEvents surfaces truncated tile impact identity flag", () => {
  const actions = gameplayActionsForEvents([{
    ...tileImpactEvent,
    flags: GAMEPLAY_EVENT_FLAG_TILE_IMPACT_IDENTITY_TRUNCATED,
    payloadBits: 0xffff_ffff,
  }]);

  deepEqual(actions[0], {
    type: "tileImpact",
    actor: { entityId: 11, entityGeneration: 2 },
    source: { entityId: 11, entityGeneration: 2 },
    projectile: { entityId: 11, entityGeneration: 2 },
    tileImpactCode: 2,
    tileImpact: "bounce",
    layerIndex: 255,
    tileIndex: 0x00ff_ffff,
    normal: "none",
    bounced: false,
    identityTruncated: true,
    targetRemoved: false,
    flags: GAMEPLAY_EVENT_FLAG_TILE_IMPACT_IDENTITY_TRUNCATED,
    payloadBits: 0xffff_ffff,
    event: {
      ...tileImpactEvent,
      flags: GAMEPLAY_EVENT_FLAG_TILE_IMPACT_IDENTITY_TRUNCATED,
      payloadBits: 0xffff_ffff,
    },
  });
});


test("gameplayEventActionMetadataForCommands preserves interaction action metadata for frame-end consumers", () => {
  const metadata = gameplayEventActionMetadataForCommands([{
    type: "configureInteraction",
    entity: "door",
    recipe: "door.inspect",
    tags: [],
    action: "inspect",
    actionId: 7,
    radius: 24,
    prompt: "Inspect door",
    once: true,
  }]);

  deepEqual(metadata, {
    7: {
      actionId: 7,
      action: "inspect",
      prompt: "Inspect door",
    },
  });

  const actions = gameplayActionsForEvents([interactionEvent], {
    actionMetadata: metadata,
    requireActionNames: true,
  });

  deepEqual(actions.map((action) => action.type === "interaction" ? {
    action: action.action,
    prompt: action.prompt,
  } : undefined), [{
    action: "inspect",
    prompt: "Inspect door",
  }]);
});

test("gameplayEventActionMetadataForCommands resolves action ids and rejects conflicting metadata", () => {
  const metadata = gameplayEventActionMetadataForCommands([{
    type: "configureInteraction",
    entity: "door",
    recipe: "door.inspect",
    tags: [],
    action: "inspect",
    radius: 24,
    prompt: "Inspect door",
    once: true,
  }], {
    ids: { actions: { inspect: 7 } },
  });

  equal(metadata[7]?.action, "inspect");

  expectMessage(() => gameplayEventActionMetadataForCommands([
    {
      type: "configureInteraction",
      entity: "door",
      recipe: "door.inspect",
      tags: [],
      action: "inspect",
      actionId: 7,
      radius: 24,
      prompt: "Inspect door",
      once: true,
    },
    {
      type: "configureInteraction",
      entity: "terminal",
      recipe: "terminal.inspect",
      tags: [],
      action: "inspect",
      actionId: 7,
      radius: 20,
      prompt: "Inspect terminal",
      once: true,
    },
  ]), /conflicts with existing interaction action metadata/);
});

test("applyGameplayEventActions forwards actions to a target adapter", () => {
  const applied: string[] = [];
  const result = applyGameplayEventActions({
    applyGameplayEventAction: (action) => {
      if (action.type !== "interaction") {
        return action.type;
      }
      applied.push(`${action.type}:${action.actionId}:${action.source.entityId}`);
      return action.action;
    },
  }, [interactionEvent], {
    actionNames: new Map([[7, "inspect"]]),
  });

  deepEqual(applied, ["interaction:7:9"]);
  deepEqual(result.results, ["inspect"]);
  equal(result.events[0], interactionEvent);
  equal(result.actions[0]?.event, interactionEvent);
});

test("gameplayActionsForEvents reports machine-actionable diagnostics", () => {
  expectMessage(() => gameplayActionsForEvents([{
    ...interactionEvent,
    tokenId: 0,
  }]), /path='gameplayEvents\.events\.0\.tokenId'/);

  expectMessage(() => gameplayActionsForEvents([interactionEvent], {
    requireActionNames: true,
  }), /path='gameplayEvents\.events\.0\.action'/);

  expectMessage(() => gameplayActionsForEvents([{
    ...interactionEvent,
    kind: "unknown",
    kindCode: 99,
  }]), /unsupported gameplay event kind/);

  const ignored = gameplayActionsForEvents([{
    ...interactionEvent,
    kind: "unknown",
    kindCode: 99,
  }], {
    unknownEvent: "ignore",
  });
  deepEqual(ignored, []);
});

function expectMessage(fn: () => void, pattern: RegExp): void {
  try {
    fn();
  } catch (error) {
    equal(error instanceof Error, true);
    equal(pattern.test(error instanceof Error ? error.message : String(error)), true);
    return;
  }
  throw new Error("Expected function to throw.");
}
