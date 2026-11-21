import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { createUnifiedPhysicsApi, queryUnifiedPhysicsBodyStates } from "../src/unifiedPhysics.js";

function nativeFixture() {
  return {
    unified_physics_bridge_version: () => 1,
    unified_physics_body_state_stride_words: () => 16,
    unified_physics_body_state_count: () => 1,
    unified_physics_body_state_ptr: () => 256,
    query_unified_physics_body_states: (_handles: Uint32Array) => {},
    set_unified_physics_velocities: (_handles: Uint32Array, _values: Float32Array) => {},
    configure_unified_physics_world: (_metadata: Uint32Array, _values: Float32Array) => {},
  };
}

test("state views reacquire grown memory and copy aliased input before growth", () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const handles = new Uint32Array(memory.buffer, 0, 2);
  handles.set([0xf1234567, 9]);
  const native = nativeFixture();
  let calls = 0;
  native.query_unified_physics_body_states = input => {
    calls++;
    memory.grow(1);
    deepEqual([...input], [0xf1234567, 9]);
    new Uint32Array(memory.buffer, 256, 3).set([input[0], input[1], 1]);
    new Float32Array(memory.buffer, 268, 3).set([1, 2, 3]);
  };
  const result = queryUnifiedPhysicsBodyStates(native, memory, handles);
  equal(calls, 1); equal(result.count, 1); equal(result.stride, 16);
  equal(result.words[0], 0xf1234567); equal(result.words[2], 1);
  deepEqual([...result.floats.slice(3, 6)], [1, 2, 3]);
  equal(result.words.buffer, memory.buffer);
});

test("query rejects mismatched ABI and invalid native output bounds", () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const native = nativeFixture();
  const h = new Uint32Array([1, 1]);
  for (const ptr of [-4, 1, NaN, 65536]) {
    native.unified_physics_body_state_ptr = () => ptr;
    throws(() => queryUnifiedPhysicsBodyStates(native, memory, h), /buffer/);
  }
  native.unified_physics_body_state_ptr = () => 256;
  native.unified_physics_body_state_count = () => 2;
  throws(() => queryUnifiedPhysicsBodyStates(native, memory, h), /buffer/);
  native.unified_physics_body_state_stride_words = () => 17;
  throws(() => queryUnifiedPhysicsBodyStates(native, memory, h), /version 1/);
});

test("configuration validates numeric conversion; batches cross once and respect lifecycle", () => {
  const native = nativeFixture();
  let configCalls = 0, velocityCalls = 0, published = 0, alive = true;
  native.configure_unified_physics_world = (m, v) => {
    configCalls++; equal(m[0], 0); equal(m[4], 8192); equal(v[4], 100);
  };
  native.set_unified_physics_velocities = (h, v) => {
    velocityCalls++; equal(h.length, 400); equal(v.length, 1200);
  };
  const api = createUnifiedPhysicsApi(native, {
    queryUnifiedPhysicsBodyStates: h => queryUnifiedPhysicsBodyStates(native, new WebAssembly.Memory({initial: 1}), h),
    copyUnifiedPhysicsInputAliases: (handles, values) => ({ handles, values }),
  }, () => { if (!alive) throw new Error("destroyed"); }, config => {
    published++; equal(config.stepSeconds, Math.fround(1 / 60));
    deepEqual(config.gravity, [0, 980, 0]);
  });
  const config = {space: "planar-xy" as const, gravity: [0, 980, 0] as const, lengthUnit: 100};
  api.configureUnifiedPhysics(config);
  throws(() => api.configureUnifiedPhysics({...config, maxBodies: 2 ** 32}), /integer/);
  throws(() => api.configureUnifiedPhysics({...config, lengthUnit: 1e100}), /finite/);
  equal(configCalls, 1);
  equal(published, 1);
  native.configure_unified_physics_world = () => { throw new Error("native rejected"); };
  throws(() => api.configureUnifiedPhysics(config), /native rejected/);
  equal(published, 1);
  api.setUnifiedPhysicsVelocities(new Uint32Array(400), new Float32Array(1200));
  equal(velocityCalls, 1);
  throws(() => api.setUnifiedPhysicsVelocities(new Uint32Array(1), new Float32Array()), /pairs/);
  throws(() => api.setUnifiedPhysicsVelocities(new Uint32Array(2), new Float32Array(5)), /six/);
  equal(velocityCalls, 1);
  alive = false;
  throws(() => api.configureUnifiedPhysics(config), /destroyed/);
  throws(() => api.setUnifiedPhysicsVelocities(new Uint32Array(), new Float32Array()), /destroyed/);
  throws(() => api.queryUnifiedPhysicsBodyStates(new Uint32Array()), /destroyed/);
});
