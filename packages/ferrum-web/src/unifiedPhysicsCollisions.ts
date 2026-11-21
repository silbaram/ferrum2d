import type { Engine } from "../pkg/ferrum_core.js";

/** Word offsets shared by transition and active-pair records. Participant offsets are relative. */
export const UNIFIED_PHYSICS_COLLISION_LAYOUT = {
  stride: 22, phase: 0, flags: 1, first: 2, second: 12,
  enter: 0, exit: 1, active: 2, sensorFlag: 1, removedFlag: 2,
  participantFlags: 0, entity: 1, body: 3, collider: 5,
  terrainKind: 7, terrainId: 8, terrainTileIndex: 9,
  entityPresentFlag: 1, participantSensorFlag: 2, tileTerrain: 1, spatialSurfaceTerrain: 2,
} as const;

/** Borrowed until the next collision read, Wasm memory growth or engine destruction. */
export interface UnifiedPhysicsCollisionBufferView {
  readonly count: number;
  readonly stride: 22;
  readonly words: Uint32Array;
  /** Lost native transitions before the public queue. Nonzero requires active-pair recovery. */
  readonly droppedTransitions: number;
  /** Lost events in the bounded public queue since the previous drain. */
  readonly droppedEvents: number;
}

export interface FerrumUnifiedPhysicsCollisionApi {
  /** Disabled initially and on world replacement. Changing state clears this stream's queue. */
  setUnifiedPhysicsCollisionEventsEnabled(enabled: boolean): void;
  /** Drains collider enter/exit transitions, independently of entity lifecycle frame events. */
  drainUnifiedPhysicsCollisionEvents(): UnifiedPhysicsCollisionBufferView;
  /** Last stepped contact state plus explicit removals; full snapshot even if streaming is off. */
  queryUnifiedPhysicsCollisionPairs(): UnifiedPhysicsCollisionBufferView;
}

type Native = Pick<Engine,
  "unified_physics_collision_version" | "unified_physics_collision_stride_words"
  | "set_unified_physics_collision_events_enabled" | "drain_unified_physics_collision_events"
  | "query_unified_physics_collision_pairs" | "unified_physics_collision_count"
  | "unified_physics_collision_ptr" | "unified_physics_collision_dropped_transitions"
  | "unified_physics_collision_dropped_events"
>;

function requireCapability(native: Native): void {
  const methods = ["unified_physics_collision_version", "unified_physics_collision_stride_words",
    "set_unified_physics_collision_events_enabled", "drain_unified_physics_collision_events",
    "query_unified_physics_collision_pairs", "unified_physics_collision_count",
    "unified_physics_collision_ptr", "unified_physics_collision_dropped_transitions",
    "unified_physics_collision_dropped_events"] as const;
  if (methods.some(name => typeof native[name] !== "function")
    || native.unified_physics_collision_version() !== 1
    || native.unified_physics_collision_stride_words() !== 22) {
    throw new Error("This Wasm core does not support unified physics collision version 1.");
  }
}

export function setUnifiedPhysicsCollisionEventsEnabled(native: Native, enabled: boolean): void {
  requireCapability(native);
  if (typeof enabled !== "boolean") throw new Error("Collision streaming enabled must be boolean.");
  native.set_unified_physics_collision_events_enabled(enabled);
}

export function readUnifiedPhysicsCollisions(
  native: Native, memory: WebAssembly.Memory, drain: boolean,
): UnifiedPhysicsCollisionBufferView {
  requireCapability(native);
  if (drain) native.drain_unified_physics_collision_events();
  else native.query_unified_physics_collision_pairs();
  const count = native.unified_physics_collision_count();
  const pointer = native.unified_physics_collision_ptr();
  const droppedTransitions = native.unified_physics_collision_dropped_transitions();
  const droppedEvents = native.unified_physics_collision_dropped_events();
  const buffer = memory.buffer;
  const uint = (value: number) => Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff;
  if (!uint(count) || !uint(pointer) || pointer % 4 !== 0 || pointer + count * 88 > buffer.byteLength
    || !uint(droppedTransitions) || !uint(droppedEvents)
    || (!drain && (droppedTransitions !== 0 || droppedEvents !== 0))) {
    throw new Error("Invalid unified physics collision buffer.");
  }
  return {count, stride: 22, words: new Uint32Array(buffer, pointer, count * 22), droppedTransitions, droppedEvents};
}
