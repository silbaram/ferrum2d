import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { createUnifiedPhysicsBindingApi } from "../src/unifiedPhysicsBindings.js";
test("binding validates capability and identity, and owns mesh input before Wasm allocation", () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const vertices = new Float32Array(memory.buffer, 0, 9);
  vertices.set([-1, 0, -1, 1, 0, -1, 0, 0, 1]);
  let version = 1, calls = 0;
  const native = {
    unified_physics_binding_version: () => version,
    bind_unified_physics_body: (h: Uint32Array, meta: Uint32Array, v: Float32Array, sm: Uint32Array, sv: Float32Array) => {
      memory.grow(1); calls++;
      deepEqual([...h], [4, 5]); equal(v.length, 37); equal(meta[0], 0);
      equal(sm[0], 4); deepEqual([...sv], [-1, 0, -1, 1, 0, -1, 0, 0, 1]);
    },
    unbind_unified_physics_body: (id: number, generation: number) => { deepEqual([id, generation], [4, 5]); calls++; },
  };
  const api = createUnifiedPhysicsBindingApi(native, () => {});
  const h = { entityId: 4, entityGeneration: 5 };
  const options = { kind: "fixed" as const, collider: { shape: { type: "triangleMesh" as const, vertices, triangles: [0, 1, 2] } } };
  throws(() => api.bindUnifiedPhysicsBody({ ...h, entityId: -1 }, options));
  version = 2; throws(() => api.bindUnifiedPhysicsBody(h, options), /version 1/); equal(calls, 0);
  version = 1; api.bindUnifiedPhysicsBody(h, options); equal(vertices.length, 0); api.unbindUnifiedPhysicsBody(h); equal(calls, 2);
  const dead = createUnifiedPhysicsBindingApi(native, () => { throw new Error("destroyed"); });
  throws(() => dead.unbindUnifiedPhysicsBody(h), /destroyed/);
});
