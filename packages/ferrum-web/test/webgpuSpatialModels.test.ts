import { deepEqual, equal, throws, rejects } from "node:assert/strict";
import { test } from "node:test";
import { WebGpuSpatialModels } from "../src/webgpuSpatialModels.js";
import { createSpatialModelAsset, type SpatialModelResource } from "../src/spatialModel.js";
import type { SpatialModelFrame } from "../src/spatialModelPacket.js";
import type { SpatialRendererStats } from "../src/webgl2SpatialPass.js";
class Resource {
  destroyed = 0;
  constructor(readonly descriptor: GPUBufferDescriptor | GPUTextureDescriptor) {}
  destroy() {
    this.destroyed++;
  }
  createView(descriptor?: GPUTextureViewDescriptor) {
    return { owner: this, descriptor };
  }
}
class Pass {
  draws: number[][] = [];
  offsets: number[] = [];
  setPipeline() {}
  setBindGroup() {}
  setIndexBuffer() {}
  setVertexBuffer(slot: number, _buffer: unknown, offset = 0) {
    if (slot === 1) this.offsets.push(offset);
  }
  drawIndexed(...args: number[]) {
    this.draws.push(args);
  }
  draw() {}
  end() {}
}
class Device {
  limits = { maxBufferSize: 268435456, maxTextureDimension2D: 8192 };
  buffers: Resource[] = [];
  textures: Resource[] = [];
  writes: {
    buffer: unknown;
    values: Float32Array;
  }[] = [];
  pipelines: GPURenderPipelineDescriptor[] = [];
  samplers: GPUSamplerDescriptor[] = [];
  mips = 0;
  failBuffer = -1;
  reportError = "";
  scopes = 0;
  wait?: Promise<void>;
  pushErrorScope() {
    this.scopes++;
  }
  async popErrorScope() {
    this.scopes--;
    const message = this.reportError;
    this.reportError = "";
    return message ? { message } : null;
  }
  queue = {
    onSubmittedWorkDone: async () => {
      await this.wait;
    },
    writeTexture() {},
    writeBuffer: (buffer: unknown, _offset: number, data: Float32Array) =>
      this.writes.push({ buffer, values: data.slice() }),
    submit() {},
  };
  createBuffer(d: GPUBufferDescriptor) {
    if (this.buffers.length === this.failBuffer) throw Error("allocation failed");
    const r = new Resource(d);
    this.buffers.push(r);
    return r;
  }
  createTexture(d: GPUTextureDescriptor) {
    const r = new Resource(d);
    this.textures.push(r);
    return r;
  }
  createShaderModule() {
    return {};
  }
  createBindGroupLayout() {
    return {};
  }
  createPipelineLayout() {
    return {};
  }
  createRenderPipeline(d: GPURenderPipelineDescriptor) {
    this.pipelines.push(d);
    return {};
  }
  createBindGroup(d: GPUBindGroupDescriptor) {
    return d;
  }
  createSampler(d: GPUSamplerDescriptor) {
    this.samplers.push(d);
    return {};
  }
  createCommandEncoder() {
    return {
      beginRenderPass: () => {
        this.mips++;
        return new Pass();
      },
      finish() {
        return {};
      },
    };
  }
}
function source(mapped = false): SpatialModelResource {
  return {
    contentId: "a".repeat(64),
    bounds: [0, 0, 0, 1, 1, 0],
    diagnostics: [],
    images: [{ width: 2, height: 2, pixels: new Uint8ClampedArray(16).fill(255) }],
    primitives: [
      {
        vertices: new Float32Array(3 * (mapped ? 12 : 8)),
        indices: new Uint32Array([0, 1, 2]),
        color: [0.5, 1, 1, 1],
        image: 0,
        sampler: [9987, 9728, 33648, 33071],
        alphaCutoff: 0.5,
        doubleSided: mapped,
        emissiveFactor: [1, 0, 0],
        ...(mapped
          ? {
              normal: { image: 0, sampler: [9728, 9728, 10497, 10497] as const, scale: 0.7 },
              emissive: { image: 0, sampler: [9729, 9729, 10497, 10497] as const },
            }
          : {}),
      },
    ],
  };
}
function frame(s = source(), count = 1): SpatialModelFrame {
  const values = new Float32Array(count * 20),
    words = new Uint32Array(values.buffer);
  for (let i = 0; i < count; i++) {
    words.set([1, 3, 1, 0], i * 20);
    values.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, i * 10, 0, 0, 1], i * 20 + 4);
  }
  return {
    version: 1,
    stride: 20,
    words,
    values,
    assets: new Map([[1, createSpatialModelAsset(s)]]),
  };
}
function stats(): SpatialRendererStats {
  // The model pass only changes these documented counters.
  return {
    drawCalls: 0,
    textureBindCount: 0,
    triangleCount: 0,
    visibleModelCount: 0,
    modelDrawCalls: 0,
    modelInstancedDrawCalls: 0,
    modelTriangleCount: 0,
    modelUploadBytes: 0,
    modelInstanceUploadBytes: 0,
    uploadBytes: 0,
  } as SpatialRendererStats;
}
function setup() {
  Object.assign(globalThis, {
    GPUBufferUsage: { VERTEX: 1, INDEX: 2, UNIFORM: 4, COPY_DST: 8 },
    GPUTextureUsage: { COPY_DST: 1, TEXTURE_BINDING: 2, RENDER_ATTACHMENT: 4 },
    GPUShaderStage: { VERTEX: 1, FRAGMENT: 2 },
  });
  const device = new Device(),
    models = new WebGpuSpatialModels(device as unknown as GPUDevice, "rgba8unorm", {});
  const draw = (f: SpatialModelFrame) => {
    models.validate(f);
    const s = stats(),
      pass = new Pass();
    models.prepare(f);
    models.uploadInstances(f, false, s);
    models.draw(f, pass as unknown as GPURenderPassEncoder, {}, s);
    return { s, pass };
  };
  return { device, models, draw };
}
test("WebGPU indexed model batches preserve native culling gaps, matrix order and receive flags", async () => {
  const { device, models, draw } = setup(),
    f = frame(source(), 4);
  f.words[22] = 0;
  f.words[61] = 1;
  await models.preload([...f.assets.values()]);
  const { s, pass } = draw(f);
  deepEqual(pass.draws, [
    [3, 2],
    [3, 1],
  ]);
  deepEqual(pass.offsets, [0, 128]);
  equal(s.visibleModelCount, 3);
  equal(s.modelDrawCalls, 2);
  equal(s.modelInstancedDrawCalls, 1);
  equal(s.modelTriangleCount, 3);
  equal(s.modelInstanceUploadBytes, 192);
  const matrices = device.writes.filter(
    (w) => (w.buffer as Resource).descriptor.label === "Spatial model matrices",
  );
  equal(matrices.length, 1);
  deepEqual([matrices[0].values[12], matrices[0].values[28], matrices[0].values[44]], [0, 20, 30]);
  equal(draw(f).s.modelUploadBytes, 0);
  models.destroy();
  models.destroy();
  equal(
    device.buffers.every((b) => b.destroyed === 1),
    true,
  );
  equal(
    device.textures.every((t) => t.destroyed === 1),
    true,
  );
});
test("WebGPU model packet/resource limits reject before any GPU upload or allocation", () => {
  const { device, models } = setup(),
    f = frame(),
    before = [device.buffers.length, device.textures.length, device.writes.length];
  for (const invalid of [
    { ...f, stride: 19 },
    { ...f, words: new Uint32Array(19) },
    { ...f, assets: new Map() },
  ])
    throws(() => models.validate(invalid as SpatialModelFrame));
  f.words[2] = 256;
  throws(() => models.validate(f));
  f.words[2] = 1;
  f.values[4] = NaN;
  throws(() => models.validate(f));
  f.values[4] = 1;
  device.limits.maxTextureDimension2D = 1;
  throws(() => models.validate(f), /texture limit/);
  deepEqual([device.buffers.length, device.textures.length, device.writes.length], before);
  models.destroy();
});
test("WebGPU model preparation rollback preserves active resources and commits reusable assets", async () => {
  const { device, models, draw } = setup(),
    old = frame();
  await models.preload([...old.assets.values()]);
  draw(old);
  const next = frame(source(true)),
    before = device.buffers.length;
  device.failBuffer = before + 1;
  await rejects(models.preload([...next.assets.values()]), /allocation failed/);
  equal(device.buffers[before].destroyed, 1);
  device.failBuffer = -1;
  equal(draw(old).s.modelUploadBytes, 0);
  equal((await models.preload([...next.assets.values()])) > 0, true);
  const staged = models.stage([...next.assets.values()]);
  equal(staged.uploadBytes, 0);
  throws(() => models.stage([]), /already pending/);
  staged.dispose();
  staged.dispose();
  equal(draw(old).s.modelUploadBytes, 0);
  const committed = models.stage([...next.assets.values()]);
  committed.commit();
  committed.dispose();
  throws(() => committed.commit(), /no longer pending/);
  equal(draw(next).s.modelUploadBytes, 0);
  models.destroy();
  equal(
    device.buffers.every((b) => b.destroyed === 1),
    true,
  );
  equal(
    device.textures.every((t) => t.destroyed === 1),
    true,
  );
});
test("WebGPU model material keeps color/data texture identities, mipmaps, MASK and sampler modes", async () => {
  const { device, models, draw } = setup(),
    f = frame(source(true));
  await models.preload([...f.assets.values()]);
  draw(f);
  const images = device.textures
    .filter((t) => t.descriptor.label === "Spatial model image")
    .map((t) => t.descriptor as GPUTextureDescriptor);
  deepEqual(
    images.map((t) => t.format),
    ["rgba8unorm-srgb", "rgba8unorm"],
  );
  equal(
    images.every((t) => t.mipLevelCount === 2),
    true,
  );
  equal(device.mips, 2);
  equal(
    device.samplers.some(
      (s) =>
        s.minFilter === "linear" &&
        s.mipmapFilter === "linear" &&
        s.addressModeU === "mirror-repeat" &&
        s.addressModeV === "clamp-to-edge",
    ),
    true,
  );
  equal(
    device.samplers.some((s) => s.minFilter === "nearest" && s.lodMaxClamp === 0),
    true,
  );
  const material = device.writes.find((w) => {
    const descriptor = (w.buffer as Resource).descriptor as GPUBufferDescriptor;
    return descriptor.size === 144 && (descriptor.usage & GPUBufferUsage.UNIFORM) !== 0;
  })!.values;
  equal(material[8], 0.5);
  equal(material[11], 1);
  equal(device.pipelines[3].vertex.buffers![0].arrayStride, 48);
  equal(device.pipelines[3].primitive!.cullMode, "none");
  models.destroy();
});
test("asynchronous WebGPU allocation errors preserve the previous scene and release invalid staging", async () => {
  const { device, models, draw } = setup(),
    old = frame();
  await models.preload([...old.assets.values()]);
  draw(old);
  const next = frame(source(true)),
    before = device.buffers.length;
  device.reportError = "GPU out of memory";
  await rejects(models.preload([...next.assets.values()]), /GPU out of memory/);
  equal(device.scopes, 0);
  equal(
    device.buffers.slice(before).every((b) => b.destroyed === 1),
    true,
  );
  equal(draw(old).s.modelUploadBytes, 0);
  throws(() => models.stage([...next.assets.values()]), /preloaded/);
  await models.preload([...next.assets.values()]);
  const lease = models.stage([...next.assets.values()]);
  lease.commit();
  draw(next);
  models.destroy();
  equal(
    device.buffers.every((b) => b.destroyed === 1),
    true,
  );
  equal(
    device.textures.every((t) => t.destroyed === 1),
    true,
  );
});
test("unprepared WebGPU models fail synchronously and pending preload cannot activate a lease", async () => {
  const { device, models } = setup(),
    f = frame();
  throws(() => models.validate(f), /preloaded/);
  throws(() => models.stage([...f.assets.values()]), /preloaded/);
  let finish = () => {};
  device.wait = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const loading = models.preload([...f.assets.values()]);
  throws(() => models.stage([...f.assets.values()]), /already pending/);
  await rejects(models.preload([]), /already pending/);
  models.destroy();
  finish();
  await rejects(loading, /destroyed during preload/);
  equal(device.scopes, 0);
  equal(
    device.buffers.every((b) => b.destroyed === 1),
    true,
  );
  equal(
    device.textures.every((t) => t.destroyed === 1),
    true,
  );
});
test("a preload pins reused GPU assets while an existing scene keeps rendering", async () => {
  const { device, models, draw } = setup(),
    a = frame(),
    b = frame(source(true)),
    c = frame();
  await models.preload([...a.assets.values()]);
  draw(a);
  await models.preload([...b.assets.values()]);
  const aBuffers = device.buffers.slice(1, 4);
  let finish = () => {};
  device.wait = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const loading = models.preload([...a.assets.values(), ...c.assets.values()]);
  draw(b);
  equal(
    aBuffers.every((r) => r.destroyed === 0),
    true,
  );
  finish();
  await loading;
  draw(a);
  equal(
    aBuffers.every((r) => r.destroyed === 0),
    true,
  );
  models.destroy();
  equal(
    device.buffers.every((r) => r.destroyed === 1),
    true,
  );
  equal(
    device.textures.every((r) => r.destroyed === 1),
    true,
  );
});
test("all native shadow masks pack into disjoint instance ranges before any pass and receiver groups remain per batch", async () => {
  const { models, device } = setup(),
    f = frame(source(), 3);
  f.words[2] = 3;
  f.words[22] = 6;
  f.words[42] = 129;
  f.words[41] = 1;
  await models.preload([...f.assets.values()]);
  models.prepare(f);
  const s = stats();
  s.shadowTriangleCount = 0;
  models.uploadInstances(f, true, s);
  const writes = device.writes.filter(
    (w) => (w.buffer as Resource).descriptor.label === "Spatial model matrices",
  );
  equal(writes.length, 1);
  equal(writes[0].values.length, 6 * 16);
  // Camera rows0/2, face0 rows0/1, face1 row1 and sun row2: no overwrite or camera-only culling.
  deepEqual(
    [12, 28, 44, 60, 76, 92].map((i) => writes[0].values[i]),
    [0, 20, 0, 10, 10, 20],
  );
  const offsets: number[] = [];
  for (const bit of [1, 2, 7, 0]) {
    const p = new Pass();
    models.draw(f, p as unknown as GPURenderPassEncoder, {}, s, {}, false, bit, {});
    offsets.push(...p.offsets);
  }
  deepEqual(offsets, [128, 256, 320, 0, 64]);
  equal(
    device.writes.filter(
      (w) => (w.buffer as Resource).descriptor.label === "Spatial model matrices",
    ).length,
    1,
  );
  equal(s.visibleModelCount, 2);
  equal(s.shadowTriangleCount, 4);
  models.destroy();
});
test("shadow instancing ignores receive-only differences while camera draws preserve receiver batches", async () => {
  const { models } = setup(),
    f = frame(source(), 3);
  for (let i = 0; i < 60; i += 20) f.words[i + 2] = 3;
  f.words[21] = 1;
  await models.preload([...f.assets.values()]);
  models.prepare(f);
  const s = stats();
  s.shadowTriangleCount = 0;
  models.uploadInstances(f, true, s);
  const shadow = new Pass();
  models.draw(f, shadow as unknown as GPURenderPassEncoder, {}, s, {}, false, 1);
  deepEqual(shadow.draws, [[3, 3]]);
  const camera = new Pass();
  models.draw(f, camera as unknown as GPURenderPassEncoder, {}, s);
  deepEqual(camera.draws, [
    [3, 1],
    [3, 1],
    [3, 1],
  ]);
  models.destroy();
});
