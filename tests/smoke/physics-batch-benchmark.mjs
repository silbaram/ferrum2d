import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { initSync } from "../../packages/ferrum-web/pkg/ferrum_core.js";
import { WasmBridge } from "../../packages/ferrum-web/dist/wasmBridge.js";
import { createPhysicsBodyApi } from "../../packages/ferrum-web/dist/physicsBodyApi.js";
import { createPhysicsQueryApi } from "../../packages/ferrum-web/dist/physicsQueryApi.js";

// Observational Node/Wasm measurement, not an absolute CI timing gate.
const wasm = await readFile(new URL("../../packages/ferrum-web/pkg/ferrum_core_bg.wasm", import.meta.url));
initSync({ module: wasm });
const bridge = await WasmBridge.init();
const native = bridge.engine();
native.use_data_scene();
const context = { rustEngine: native, bridge, requireAlive() {} };
const bodies = createPhysicsBodyApi(context);
const queries = createPhysicsQueryApi(context);
const iterations = 1000;
const trialCount = 5;
const report = {
  format: "ferrum2d.physics-batch-benchmark",
  version: 1,
  node: process.version,
  wasmSha256: createHash("sha256").update(wasm).digest("hex"),
  bodies: 128,
  requestsPerBatch: 32,
  iterationsPerTrial: iterations,
  trials: trialCount,
  nativeQueryCallScope: "Measured JS-to-Wasm raycast_bodies / batch_cast_bodies dispatches only; excludes getters and buffer access. Wrappers are removed before timing trials.",
  scenarios: [],
  note: "Local Node/Wasm measurement; not a browser, mobile GPU, or guaranteed speedup. Closest-hit single queries return all hits before the caller selects the first.",
};
try {
  for (let i = 0; i < report.bodies; i++) bodies.spawnRigidBody({
    bodyType: "static", x: (i % 16) * 12, y: Math.floor(i / 16) * 12,
    collider: { type: "aabb", halfWidth: 2, halfHeight: 2 },
  });
  for (const maxHits of [32, 1]) {
    const requests = Array.from({ length: report.requestsPerBatch }, (_, i) => ({
      kind: "ray", originX: -10, originY: (i % 8) * 12,
      directionX: 1, directionY: 0, maxDistance: 250, maxHits,
    }));
    const expected = requests.map(q => queries.raycastBodies(q).slice(0, maxHits));
    assert.deepEqual(queries.batchCastBodies(requests).map(r => r.hits), expected);
    const hitCount = expected.reduce((n, hits) => n + hits.length, 0);
    const single = () => requests.reduce((n, q) => n + Math.min(maxHits, queries.raycastBodies(q).length), 0);
    const batch = () => queries.batchCastBodies(requests).reduce((n, q) => n + q.hits.length, 0);
    const nativeQueryCallsPerIteration = measureNativeQueryCalls(single, batch, hitCount);
    report.nativeQueryCallsPerIteration ??= nativeQueryCallsPerIteration;
    assert.deepEqual(nativeQueryCallsPerIteration, report.nativeQueryCallsPerIteration);
    for (let i = 0; i < 25; i++) { single(); batch(); }
    const runs = [];
    for (let trial = 0; trial < trialCount; trial++) {
      const order = trial % 2 ? [["batch", batch], ["single", single]] : [["single", single], ["batch", batch]];
      for (const [name, run] of order) {
        let checksum = 0;
        const start = performance.now();
        for (let i = 0; i < iterations; i++) checksum += run();
        const ms = performance.now() - start;
        assert.equal(checksum, hitCount * iterations);
        runs.push({ trial, name, ms, checksum });
      }
    }
    const median = name => runs.filter(r => r.name === name).map(r => r.ms).sort((a, b) => a - b)[2];
    report.scenarios.push({
      name: maxHits === 1 ? "closest-hit" : "all-hits", maxHits, hitsPerBatch: hitCount,
      nativeQueryCallsPerIteration,
      medianMilliseconds: { single: median("single"), batch: median("batch") }, runs,
    });
  }
} finally {
  native.free();
}
const output = new URL("../../artifacts/physics-gameplay-expansion/", import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(new URL("batch-benchmark.json", output), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ calls: report.nativeQueryCallsPerIteration,
  scenarios: report.scenarios.map(({ name, medianMilliseconds }) => ({ name, medianMilliseconds })) }));

function measureNativeQueryCalls(single, batch, expectedHits) {
  const originals = ["raycast_bodies", "batch_cast_bodies"].map(name => ({
    name, method: native[name], descriptor: Object.getOwnPropertyDescriptor(native, name),
  }));
  const calls = { raycast_bodies: 0, batch_cast_bodies: 0 };
  try {
    for (const { name, method } of originals) {
      Object.defineProperty(native, name, {
        configurable: true, writable: true,
        value(...args) { calls[name]++; return Reflect.apply(method, this, args); },
      });
    }
    assert.equal(single(), expectedHits);
    assert.deepEqual(calls, { raycast_bodies: 32, batch_cast_bodies: 0 });
    const singleCalls = calls.raycast_bodies;
    calls.raycast_bodies = 0;
    assert.equal(batch(), expectedHits);
    assert.deepEqual(calls, { raycast_bodies: 0, batch_cast_bodies: 1 });
    return { single: singleCalls, batch: calls.batch_cast_bodies };
  } finally {
    // Restore inherited/own methods exactly; timings never include counter wrappers.
    for (const { name, descriptor } of originals) {
      if (descriptor) Object.defineProperty(native, name, descriptor);
      else delete native[name];
    }
  }
}
