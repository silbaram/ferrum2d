import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { WebGpuTimer, beginWebGpuRenderPass } from "../src/webgpuGpuTimer.js";
import { webGpuResources } from "../src/webgpuResources.js";

class Buffer {
  destroyed = false;
  values = new BigUint64Array(256);
  complete?: () => void;
  reject?: (error: Error) => void;
  mapAsync() { return new Promise<void>((resolve, reject) => { this.complete = resolve; this.reject = reject; }); }
  getMappedRange() { return this.values.buffer; }
  unmap() {}
  destroy() { this.destroyed = true; this.reject?.(Error("destroyed")); }
}
class Device {
  failEncoder = false;
  failQueries = false;
  features = new Set(["timestamp-query"]);
  buffers: Buffer[] = [];
  queries: { destroyed: boolean; destroy(): void }[] = [];
  queue = { submit() {} };
  createBuffer() { const buffer = new Buffer(); this.buffers.push(buffer); return buffer; }
  createTexture() { return { createView() { return {}; }, destroy() {} }; }
  createRenderPipeline() { return {}; }
  createQuerySet() { if (this.failQueries) throw Error("query allocation failed"); const query = { destroyed: false, destroy() { this.destroyed = true; } }; this.queries.push(query); return query; }
  createCommandEncoder() { if (this.failEncoder) throw Error("encoding failed"); return { resolveQuerySet() {}, copyBufferToBuffer() {}, finish() { return {}; } }; }
  native() { return this as unknown as GPUDevice; }
}
function constants() {
  Object.assign(globalThis, { GPUBufferUsage: { QUERY_RESOLVE: 1, COPY_SRC: 2, MAP_READ: 4, COPY_DST: 8 },
    GPUTextureUsage: { RENDER_ATTACHMENT: 16 }, GPUMapMode: { READ: 1 } });
}
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

test("optional timing allocation and readback encoding failures do not break rendering or exhaust slots", () => {
  constants(); const fake = new Device(), timer = new WebGpuTimer(fake.native(), true);
  fake.failQueries = true; timer.beginFrame();
  equal(timer.stats().elapsedMs, undefined); fake.failQueries = false;
  for (let i = 0; i < 8; i++) {
    timer.beginFrame(); timer.pass(); fake.failEncoder = true;
    timer.endFrame();
    equal(timer.stats().pendingQueryCount, 0);
    fake.failEncoder = false;
  }
  equal(fake.queries.length, 1); timer.destroy();
});

test("WebGPU timing measures all passes, emits a result once, and bounds pending readbacks", async () => {
  constants(); const fake = new Device(), device = fake.native(), timer = new WebGpuTimer(device, true);
  const descriptors: GPURenderPassDescriptor[] = [];
  const encoder = { beginRenderPass(d: GPURenderPassDescriptor) { descriptors.push(d); return {}; } } as GPUCommandEncoder;
  timer.beginFrame();
  beginWebGpuRenderPass(device, encoder, { colorAttachments: [] });
  beginWebGpuRenderPass(device, encoder, { colorAttachments: [] });
  timer.endFrame();
  deepEqual(descriptors.map(d => d.timestampWrites?.beginningOfPassWriteIndex), [0, 2]);
  fake.buffers[1].values.set([BigInt(10), BigInt(1_000_010), BigInt(100), BigInt(2_000_100)]);
  fake.buffers[1].complete!(); await settle();
  timer.beginFrame(); equal(timer.stats().elapsedMs, 3); equal(timer.stats().frameId, 1); timer.pass(); timer.endFrame();
  for (let i = 0; i < 20; i++) { timer.beginFrame(); timer.pass(); timer.endFrame(); }
  equal(timer.stats().elapsedMs, undefined); equal(fake.queries.length, 4); equal(timer.stats().pendingQueryCount, 4);
  timer.destroy(); timer.destroy(); await settle();
  ok(fake.queries.every(q => q.destroyed)); ok(fake.buffers.every(b => b.destroyed));
  equal(webGpuResources(device).stats().bufferCount, 0);
});

test("unsupported, disabled, overflowing and rejected GPU queries never fabricate a time", async () => {
  constants(); const fake = new Device(); fake.features.clear();
  const unsupported = new WebGpuTimer(fake.native(), true); unsupported.beginFrame(); unsupported.endFrame();
  equal(unsupported.stats().status, "unsupported"); equal(fake.buffers.length, 0); unsupported.destroy();
  const disabled = new WebGpuTimer(fake.native(), false); disabled.beginFrame(); equal(disabled.stats().status, "disabled"); disabled.destroy();
  fake.features.add("timestamp-query"); const timer = new WebGpuTimer(fake.native(), true);
  timer.beginFrame(); for (let i = 0; i < 129; i++) timer.pass(); timer.endFrame();
  equal(fake.buffers[1].complete, undefined);
  timer.beginFrame(); timer.pass(); timer.endFrame(); fake.buffers[1].reject!(Error("device loss")); await settle();
  timer.beginFrame(); equal(timer.stats().elapsedMs, undefined); timer.endFrame(); timer.destroy();
});

test("WebGPU allocation ledger counts mip chains and array layers, releases once, and leaves unknown storage absent", () => {
  constants(); const fake = new Device(), resources = webGpuResources(fake.native());
  const texture = resources.createTexture({ size: [8, 4, 6], format: "rgba8unorm", mipLevelCount: 3, usage: 16 });
  const buffer = resources.createBuffer({ size: 100, usage: 1 });
  resources.createRenderPipeline({} as GPURenderPipelineDescriptor);
  equal(resources.stats().textureBytes, (32 + 8 + 2) * 6 * 4);
  equal(resources.stats().estimatedBytes, 1108); equal(resources.stats().renderTargetCount, 1); equal(resources.stats().programCount, 1);
  const unknown = resources.createTexture({ size: { width: 2, height: 2 }, format: "depth24plus", usage: 16 });
  equal(resources.stats().estimatedBytes, undefined); equal(resources.stats().unmeasuredTextureCount, 1);
  resources.destroy(unknown); resources.destroy(texture); resources.destroy(buffer); resources.destroy(buffer);
  resources.destroyAll(); equal(resources.stats().estimatedBytes, 0); equal(resources.stats().programCount, 0);
});

test("late readback completion cannot move GPU timing backwards", async () => {
  constants(); const fake = new Device(), timer = new WebGpuTimer(fake.native(), true);
  timer.beginFrame(); timer.pass(); timer.endFrame();
  timer.beginFrame(); timer.pass(); timer.endFrame();
  fake.buffers[3].values.set([BigInt(0), BigInt(2_000_000)]); fake.buffers[3].complete!(); await settle();
  timer.beginFrame(); equal(timer.stats().frameId, 2); timer.endFrame();
  fake.buffers[1].values.set([BigInt(0), BigInt(1_000_000)]); fake.buffers[1].complete!(); await settle();
  timer.beginFrame(); equal(timer.stats().elapsedMs, undefined); timer.endFrame(); timer.destroy();
});

test("discarded failed frames never resolve partial timestamps and release their slots", () => {
  constants(); const fake = new Device(), timer = new WebGpuTimer(fake.native(), true);
  timer.beginFrame(); timer.pass(); timer.endFrame(true);
  equal(fake.buffers[1].complete, undefined); equal(timer.stats().pendingQueryCount, 0);
  timer.beginFrame(); timer.pass(); timer.endFrame();
  equal(fake.queries.length, 1); ok(fake.buffers[1].complete); timer.destroy();
});
