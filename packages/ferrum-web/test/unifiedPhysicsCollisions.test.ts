import {equal, throws} from "node:assert/strict";
import {test} from "node:test";
import {readUnifiedPhysicsCollisions, setUnifiedPhysicsCollisionEventsEnabled} from "../src/unifiedPhysicsCollisions.js";

test("collision bridge rejects unsupported ABI and malformed pointers before returning fresh grown-memory views", () => {
  const memory = new WebAssembly.Memory({initial: 1});
  let calls = 0, enabled = false;
  const native = {
    unified_physics_collision_version: () => 1,
    unified_physics_collision_stride_words: () => 22,
    set_unified_physics_collision_events_enabled: (value: boolean) => { enabled = value; },
    drain_unified_physics_collision_events: () => {
      calls++; memory.grow(1); new Uint32Array(memory.buffer, 128, 22)[0] = 1;
    },
    query_unified_physics_collision_pairs: () => { calls++; },
    unified_physics_collision_count: () => 1,
    unified_physics_collision_ptr: () => 128,
    unified_physics_collision_dropped_transitions: () => 2,
    unified_physics_collision_dropped_events: () => 3,
  };
  setUnifiedPhysicsCollisionEventsEnabled(native, true); equal(enabled, true);
  // @ts-expect-error boolean must not accept a truthy string from untyped JS.
  throws(() => setUnifiedPhysicsCollisionEventsEnabled(native, "true"), /boolean/);
  let result = readUnifiedPhysicsCollisions(native, memory, true);
  equal(result.words.buffer, memory.buffer); equal(result.words[0], 1);
  equal(result.droppedTransitions, 2); equal(result.droppedEvents, 3); equal(result.stride, 22);
  throws(() => readUnifiedPhysicsCollisions(native, memory, false), /buffer/);
  native.unified_physics_collision_dropped_transitions = () => 0;
  native.unified_physics_collision_dropped_events = () => 0;
  result = readUnifiedPhysicsCollisions(native, memory, false); equal(result.count, 1);
  native.unified_physics_collision_ptr = () => 1;
  throws(() => readUnifiedPhysicsCollisions(native, memory, false), /buffer/);
  native.unified_physics_collision_ptr = () => 128;
  native.unified_physics_collision_count = () => 0xffffffff;
  throws(() => readUnifiedPhysicsCollisions(native, memory, false), /buffer/);
  native.unified_physics_collision_count = () => -1;
  throws(() => readUnifiedPhysicsCollisions(native, memory, false), /buffer/);
  native.unified_physics_collision_stride_words = () => 21;
  const before = calls;
  throws(() => readUnifiedPhysicsCollisions(native, memory, true), /version 1/);
  equal(calls, before);
  throws(() => setUnifiedPhysicsCollisionEventsEnabled(native, false), /version 1/);
  equal(enabled, true);
});
