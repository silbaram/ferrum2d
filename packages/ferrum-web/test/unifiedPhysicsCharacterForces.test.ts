import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import type { Engine } from "../pkg/ferrum_core.js";
import { createUnifiedPhysicsCharacterApi, encodeUnifiedPhysicsCharacter } from "../src/unifiedPhysicsCharacters.js";

test("virtual character mass accepts stable f32 bounds and rejects tiny nonzero values", () => {
  for (const pushMass of [0, 0.0001, Math.fround(0.0001), 10000])
    equal(encodeUnifiedPhysicsCharacter({ pushMass })[10], Math.fround(pushMass));
  for (const pushMass of [-1, 1e-50, 1e-45, 0.00001, 10001, NaN, Infinity])
    throws(() => encodeUnifiedPhysicsCharacter({ pushMass }));
});

test("character forces copy both aliased input views before native allocation can grow memory", () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const handles = new Uint32Array(memory.buffer, 0, 4), values = new Float32Array(memory.buffer, 32, 6);
  handles.set([3, 9, 7, 11]); values.set([1, 2, 0, 4, 5, 0]);
  const calls: { code: number; handles: number[]; values: number[] }[] = [];
  let copies = 0;
  const native = {
    unified_physics_character_force_version: () => 1,
    command_unified_physics_character_forces: (code: number, h: Uint32Array, v: Float32Array) => {
      memory.grow(1);
      calls.push({ code, handles: [...h], values: [...v] });
    },
  } as unknown as Engine;
  const api = createUnifiedPhysicsCharacterApi(native, {
    queryUnifiedPhysicsCharacterStates: () => { throw new Error("forces must not query character state"); },
    copyUnifiedPhysicsInputAliases: (h, v) => {
      copies++;
      return { handles: h.buffer === memory.buffer ? h.slice() : h,
        values: v.buffer === memory.buffer ? v.slice() : v };
    },
  }, () => {});
  api.applyUnifiedPhysicsCharacterImpulses(handles, values);
  equal(copies, 1);
  deepEqual(calls, [{ code: 2, handles: [3, 9, 7, 11], values: [1, 2, 0, 4, 5, 0] }]);
  api.clearUnifiedPhysicsCharacterForces(new Uint32Array([3, 9]));
  deepEqual(calls[1], { code: 1, handles: [3, 9], values: [] });
});

test("unsupported character force capabilities and malformed batches never invoke native mutation", () => {
  let version = 0, calls = 0;
  const native = { unified_physics_character_force_version: () => version,
    command_unified_physics_character_forces: () => { calls++; } } as unknown as Engine;
  const api = createUnifiedPhysicsCharacterApi(native, {
    queryUnifiedPhysicsCharacterStates: () => { throw new Error("unexpected query"); },
    copyUnifiedPhysicsInputAliases: (handles, values) => ({ handles, values }),
  }, () => {});
  throws(() => api.addUnifiedPhysicsCharacterForces(new Uint32Array([1, 0]), new Float32Array(3)), /character force version 1/);
  version = 2;
  throws(() => api.applyUnifiedPhysicsCharacterImpulses(new Uint32Array([1, 0]), new Float32Array(3)), /version 1/);
  version = 1;
  throws(() => api.addUnifiedPhysicsCharacterForces(new Uint32Array([1]), new Float32Array(3)), /pairs/);
  throws(() => api.applyUnifiedPhysicsCharacterImpulses(new Uint32Array([1, 0]), new Float32Array(6)), /3 f32/);
  throws(() => api.clearUnifiedPhysicsCharacterForces(new Uint32Array(131074)), /65536/);
  equal(calls, 0);
});

test("positive virtual mass never falls back to older controller impulse semantics", () => {
  let version: number | undefined, calls = 0;
  const native = {
    unified_physics_character_version: () => 1,
    unified_physics_character_force_version: () => version,
    configure_unified_physics_character: () => { calls++; },
    set_unified_physics_character_inputs: () => {}, query_unified_physics_character_states: () => {},
    unified_physics_character_state_stride_words: () => 28,
    unified_physics_character_state_count: () => 0, unified_physics_character_state_ptr: () => 0,
  } as unknown as Engine;
  const api = createUnifiedPhysicsCharacterApi(native, {
    queryUnifiedPhysicsCharacterStates: () => { throw new Error("unexpected state query"); },
    copyUnifiedPhysicsInputAliases: (handles, values) => ({ handles, values }),
  }, () => {});
  const actor = { entityId: 1, entityGeneration: 0 };
  for (version of [undefined, 0, 2])
    throws(() => api.configureUnifiedPhysicsCharacter(actor, { pushMass: 2 }), /finite-mass coupling/);
  equal(calls, 0);
  api.configureUnifiedPhysicsCharacter(actor, {});
  api.configureUnifiedPhysicsCharacter(actor, false);
  equal(calls, 2);
  version = 1;
  api.configureUnifiedPhysicsCharacter(actor, { pushMass: 2 });
  equal(calls, 3);
});
