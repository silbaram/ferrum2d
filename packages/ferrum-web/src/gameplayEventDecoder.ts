export type GameplayEventKind =
  | "interaction"
  | "collisionDamage"
  | "collisionDespawn"
  | "behaviorStateChanged"
  | "prefabSpawned"
  | "actionFailed"
  | "timer"
  | "pickupCollected"
  | "tileImpact"
  | "factionDamageDenied"
  | "presentationEffect"
  | "animationFrame"
  | "unknown";

export interface GameplayEventView {
  kind: GameplayEventKind;
  kindCode: number;
  actorId: number;
  actorGeneration: number;
  sourceId: number;
  sourceGeneration: number;
  tokenId: number;
  flags: number;
  payloadBits: number;
  once: boolean;
  consumedThisFrame: boolean;
  targetRemoved: boolean;
}

export interface GameplayEventBufferView {
  buffer: Uint32Array;
  eventCount: number;
  u32sPerEvent: number;
}

export const U32S_PER_GAMEPLAY_EVENT = 8;
export const GAMEPLAY_EVENT_KIND_INTERACTION = 1;
export const GAMEPLAY_EVENT_KIND_COLLISION_DAMAGE = 2;
export const GAMEPLAY_EVENT_KIND_COLLISION_DESPAWN = 3;
export const GAMEPLAY_EVENT_KIND_BEHAVIOR_STATE_CHANGED = 4;
export const GAMEPLAY_EVENT_KIND_PREFAB_SPAWNED = 5;
export const GAMEPLAY_EVENT_KIND_ACTION_FAILED = 6;
export const GAMEPLAY_EVENT_KIND_TIMER = 7;
export const GAMEPLAY_EVENT_KIND_PICKUP_COLLECTED = 8;
export const GAMEPLAY_EVENT_KIND_TILE_IMPACT = 9;
export const GAMEPLAY_EVENT_KIND_FACTION_DAMAGE_DENIED = 10;
export const GAMEPLAY_EVENT_KIND_PRESENTATION_EFFECT = 11;
export const GAMEPLAY_EVENT_KIND_ANIMATION_FRAME = 12;
export const GAMEPLAY_PRESENTATION_EFFECT_TYPE_SOUND = 1;
export const GAMEPLAY_PRESENTATION_EFFECT_TYPE_PARTICLE = 2;
export const GAMEPLAY_PRESENTATION_EFFECT_TYPE_CAMERA_SHAKE = 3;
export const GAMEPLAY_PRESENTATION_EFFECT_TYPE_CUSTOM = 4;
export const GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PREFAB = 1;
export const GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_ANCHOR = 2;
export const GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PHASE = 3;
export const GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM = 4;
export const GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL = 5;
export const GAMEPLAY_ACTION_FAILURE_PATTERN_MISMATCH = 6;
export const GAMEPLAY_ACTION_FAILURE_BLOCKED_PLACEMENT = 7;
export const GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_BINDING = 8;
export const GAMEPLAY_ACTION_FAILURE_COOLING_DOWN = 9;
export const GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_AIM_SOURCE = 10;
export const GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_TARGET = 11;
export const GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_COLLISION_TARGET = 12;
export const GAMEPLAY_ACTION_FAILURE_MAX_REASON_CODE =
  GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_COLLISION_TARGET;
export const GAMEPLAY_EVENT_FLAG_ONCE = 1 << 0;
export const GAMEPLAY_EVENT_FLAG_CONSUMED_THIS_FRAME = 1 << 1;
export const GAMEPLAY_EVENT_FLAG_TARGET_REMOVED = 1 << 2;
export const GAMEPLAY_EVENT_FLAG_TILE_IMPACT_BOUNCED = 1 << 3;
export const GAMEPLAY_EVENT_FLAG_TILE_IMPACT_IDENTITY_TRUNCATED = 1 << 4;
export const GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_SHIFT = 8;
export const GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_MASK = 0b111 << GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_SHIFT;
export const GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_NONE = 0;
export const GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_POSITIVE_X = 1;
export const GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_NEGATIVE_X = 2;
export const GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_POSITIVE_Y = 3;
export const GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_NEGATIVE_Y = 4;
export const GAMEPLAY_EVENT_TILE_IMPACT_LAYER_SHIFT = 24;
export const GAMEPLAY_EVENT_TILE_IMPACT_LAYER_MASK = 0xff << GAMEPLAY_EVENT_TILE_IMPACT_LAYER_SHIFT;
export const GAMEPLAY_EVENT_TILE_IMPACT_TILE_MASK = 0x00ff_ffff;

export type GameplayPresentationEffectKind = "sound" | "particle" | "cameraShake" | "custom" | "unknown";
export const EMPTY_GAMEPLAY_EVENTS: readonly GameplayEventView[] = Object.freeze([]);

export function decodeGameplayEvents(view: GameplayEventBufferView): readonly GameplayEventView[] {
  if (view.eventCount === 0) {
    return EMPTY_GAMEPLAY_EVENTS;
  }

  const events: GameplayEventView[] = [];
  for (let i = 0; i < view.eventCount; i += 1) {
    const offset = i * view.u32sPerEvent;
    const kindCode = view.buffer[offset];
    const flags = view.u32sPerEvent > 6 ? view.buffer[offset + 6] : 0;
    events.push({
      kind: gameplayEventKind(kindCode),
      kindCode,
      actorId: view.buffer[offset + 1],
      actorGeneration: view.buffer[offset + 2],
      sourceId: view.buffer[offset + 3],
      sourceGeneration: view.buffer[offset + 4],
      tokenId: view.buffer[offset + 5],
      flags,
      payloadBits: view.u32sPerEvent > 7 ? view.buffer[offset + 7] : 0,
      once: (flags & GAMEPLAY_EVENT_FLAG_ONCE) !== 0,
      consumedThisFrame: (flags & GAMEPLAY_EVENT_FLAG_CONSUMED_THIS_FRAME) !== 0,
      targetRemoved: (flags & GAMEPLAY_EVENT_FLAG_TARGET_REMOVED) !== 0,
    });
  }
  return events;
}

export function gameplayEventKind(kindCode: number): GameplayEventKind {
  if (kindCode === GAMEPLAY_EVENT_KIND_INTERACTION) return "interaction";
  if (kindCode === GAMEPLAY_EVENT_KIND_COLLISION_DAMAGE) return "collisionDamage";
  if (kindCode === GAMEPLAY_EVENT_KIND_COLLISION_DESPAWN) return "collisionDespawn";
  if (kindCode === GAMEPLAY_EVENT_KIND_BEHAVIOR_STATE_CHANGED) return "behaviorStateChanged";
  if (kindCode === GAMEPLAY_EVENT_KIND_PREFAB_SPAWNED) return "prefabSpawned";
  if (kindCode === GAMEPLAY_EVENT_KIND_ACTION_FAILED) return "actionFailed";
  if (kindCode === GAMEPLAY_EVENT_KIND_TIMER) return "timer";
  if (kindCode === GAMEPLAY_EVENT_KIND_PICKUP_COLLECTED) return "pickupCollected";
  if (kindCode === GAMEPLAY_EVENT_KIND_TILE_IMPACT) return "tileImpact";
  if (kindCode === GAMEPLAY_EVENT_KIND_FACTION_DAMAGE_DENIED) return "factionDamageDenied";
  if (kindCode === GAMEPLAY_EVENT_KIND_PRESENTATION_EFFECT) return "presentationEffect";
  if (kindCode === GAMEPLAY_EVENT_KIND_ANIMATION_FRAME) return "animationFrame";
  return "unknown";
}

export function gameplayPresentationEffectKind(typeCode: number): GameplayPresentationEffectKind {
  if (typeCode === GAMEPLAY_PRESENTATION_EFFECT_TYPE_SOUND) return "sound";
  if (typeCode === GAMEPLAY_PRESENTATION_EFFECT_TYPE_PARTICLE) return "particle";
  if (typeCode === GAMEPLAY_PRESENTATION_EFFECT_TYPE_CAMERA_SHAKE) return "cameraShake";
  if (typeCode === GAMEPLAY_PRESENTATION_EFFECT_TYPE_CUSTOM) return "custom";
  return "unknown";
}
