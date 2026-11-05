import { equal, throws, deepEqual } from "node:assert/strict";
import { test } from "node:test";
import { createPhysicsQueryApi } from "../src/physicsQueryApi.js";
import type { Engine } from "../pkg/ferrum_core.js";
import type { WasmBridge } from "../src/wasmBridge.js";

test("batch query crosses the native boundary once and guards invalid input and destroyed engine", () => {
  let calls = 0, alive = true;
  const rustEngine = { batch_cast_bodies(values: Float64Array) {
    calls++;
    equal(values.length, 48 * 8);
    return Float64Array.from([8, ...Array.from({ length: 8 }, () => [0, 0]).flat()]);
  } } as unknown as Engine;
  const api = createPhysicsQueryApi({ rustEngine, bridge: {} as WasmBridge, requireAlive() { if (!alive) throw new Error("destroyed"); } });
  const query = { kind: "ray" as const, originX: 0, originY: 0, directionX: 1, directionY: 0, maxDistance: 50 };
  const results = api.batchCastBodies(Array.from({ length: 8 }, () => query));
  equal(calls, 1);
  deepEqual(results.map(r => r.requestIndex), [0,1,2,3,4,5,6,7]);
  throws(() => api.batchCastBodies([{ ...query, maxHits: 33 }]), /1..32/);
  throws(() => api.batchCastBodies([{ ...query, originX: NaN }]), /finite/);
  equal(calls, 1);
  alive = false;
  throws(() => api.batchCastBodies([query]), /destroyed/);
  equal(calls, 1);
});
