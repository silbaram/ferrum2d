import { compileSpatialEnvironment } from "../src/spatialEnvironment.js";
import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { WebGpuSpatialPass } from "../src/webgpuSpatialPass.js";
import type { SpatialRenderBufferView } from "../src/dataSceneSpatial.js";
import type { WebGpuTextureStore } from "../src/webgpuTextureStore.js";
class Resource {
  destroyed = 0;
  constructor(readonly descriptor: object) {}
  destroy() {
    this.destroyed++;
  }
  createView() {
    return { owner: this };
  }
}
class Device {
  readonly limits = { maxTextureDimension2D: 8192, maxBufferSize: 268435456 };
  buffers: Resource[] = [];
  textures: Resource[] = [];
  writes: {
    buffer: unknown;
    bytes: number;
  }[] = [];
  pipelines: GPURenderPipelineDescriptor[] = [];
  queue = {
    writeTexture() {},
    writeBuffer: (buffer: unknown, _offset: number, values: ArrayBufferView) => {
      this.writes.push({ buffer, bytes: values.byteLength });
    },
  };
  createBuffer(descriptor: object) {
    const r = new Resource(descriptor);
    this.buffers.push(r);
    return r;
  }
  createTexture(descriptor: object) {
    const r = new Resource(descriptor);
    this.textures.push(r);
    return r;
  }
  pushErrorScope() {}
  async popErrorScope() {
    return null;
  }
  createSampler() {
    return {};
  }
  createBindGroupLayout() {
    return {};
  }
  createPipelineLayout() {
    return {};
  }
  createShaderModule() {
    return {};
  }
  createBindGroup(descriptor: object) {
    return descriptor;
  }
  createRenderPipeline(descriptor: GPURenderPipelineDescriptor) {
    this.pipelines.push(descriptor);
    return {};
  }
}
class Pass {
  draws: number[][] = [];
  groups: [number, unknown][] = [];
  ended = false;
  setPipeline() {}
  setVertexBuffer() {}
  setViewport() {}
  setScissorRect() {}
  setBindGroup(index: number, group: unknown) {
    this.groups.push([index, group]);
  }
  draw(...values: number[]) {
    this.draws.push(values);
  }
  end() {
    this.ended = true;
  }
}
function setup() {
  Object.assign(globalThis, {
    GPUBufferUsage: { UNIFORM: 1, COPY_DST: 2, VERTEX: 4 },
    GPUTextureUsage: { RENDER_ATTACHMENT: 1, COPY_DST: 2, TEXTURE_BINDING: 4 },
    GPUShaderStage: { VERTEX: 1, FRAGMENT: 2 },
  });
  const device = new Device(),
    textures = new Map(
      [0, 1, 2].map((id) => [
        id,
        { bindGroup: { textureId: id }, width: 8, height: 8, colorSpace: "srgb", revision: 1 },
      ]),
    );
  textures.set(3, {
    bindGroup: { textureId: 3 },
    width: 8,
    height: 8,
    colorSpace: "none",
    revision: 1,
  });
  const store = {
    textureRevision(id: number) {
      return textures.get(id)?.revision;
    },
    resource(id: number) {
      const r = textures.get(id);
      if (!r) throw Error("missing texture");
      return r;
    },
  };
  const pass = new WebGpuSpatialPass(
    device as unknown as GPUDevice,
    "rgba8unorm",
    {},
    store as unknown as WebGpuTextureStore,
  );
  const draw = (frame: SpatialRenderBufferView) => {
    const gpu = new Pass(),
      encoder = { beginRenderPass: () => gpu };
    const stats = pass.draw(frame, encoder as unknown as GPUCommandEncoder, {}, 320, 240);
    pass.commitSubmission(frame);
    return { gpu, stats };
  };
  return { device, pass, draw, textures };
}
function vertices(count: number, id = 0xffffff) {
  const data = new Float32Array(count * 11);
  for (let i = 0; i < count; i++) data.set([i % 2, i % 3, 0, 0, 0, 1, 1, 1, 1, id, 0.2], i * 11);
  return data;
}
function frame(): Extract<
  SpatialRenderBufferView,
  {
    version: 2;
  }
> {
  const camera = new Float32Array(28);
  for (const i of [0, 5, 10, 15]) camera[i] = 1;
  const billboards = new Float32Array([...vertices(6, 1), ...vertices(6, 2)]);
  return {
    version: 2,
    vertexStride: 11,
    camera,
    terrain: vertices(72),
    terrainVertexCount: 72,
    terrainRevision: 7,
    terrainDrawRanges: new Uint32Array([36, 36]),
    billboards,
    billboardVertexCount: 12,
  };
}
test("WebGPU spatial draws native cull ranges and cutout batches with shared depth and a private white texture", () => {
  const { device, draw } = setup(),
    f = frame(),
    { gpu, stats } = draw(f);
  deepEqual(gpu.draws, [
    [36, 1, 36],
    [6, 1, 0],
    [6, 1, 6],
  ]);
  equal(gpu.ended, true);
  equal(stats.terrainChunkCount, 2);
  equal(stats.visibleTerrainChunkCount, 1);
  equal(stats.culledTerrainChunkCount, 1);
  equal(stats.triangleCount, 16);
  equal(stats.billboardCount, 2);
  equal(stats.billboardDrawCalls, 2);
  equal(stats.terrainUploadBytes, 72 * 44);
  equal(stats.uploadBytes, (72 + 12) * 44);
  equal(stats.depthBufferBytes, 320 * 240 * 4);
  deepEqual(device.pipelines.find((p) => p.label === "Ferrum spatial depth/cutout")!.depthStencil, {
    format: "depth24plus",
    depthWriteEnabled: true,
    depthCompare: "less-equal",
  });
  const groups = gpu.groups
    .filter(([index]) => index === 1)
    .map(
      ([, group]) =>
        group as {
          textureId?: number;
        },
    );
  equal(groups[0].textureId, undefined);
  deepEqual(
    groups.slice(1).map((g) => g.textureId),
    [1, 2],
  );
});
test("WebGPU static terrain uploads only after revision, memory or typed-view relocation changes", () => {
  const { draw, device } = setup(),
    f = frame();
  draw(f);
  const allocations = device.buffers.length;
  equal(draw(f).stats.terrainUploadBytes, 0);
  equal(device.buffers.length, allocations);
  const backing = new Float32Array(f.terrain.length * 2);
  backing.set(f.terrain);
  backing.set(f.terrain, f.terrain.length);
  const first = { ...f, terrain: backing.subarray(0, f.terrain.length) };
  draw(first);
  equal(draw(first).stats.terrainUploadBytes, 0);
  equal(
    draw({ ...f, terrain: backing.subarray(f.terrain.length) }).stats.terrainUploadBytes,
    f.terrain.byteLength,
  );
  equal(draw({ ...f, terrainRevision: 8 }).stats.terrainUploadBytes, f.terrain.byteLength);
  equal(draw({ ...f, terrain: f.terrain.slice() }).stats.terrainUploadBytes, f.terrain.byteLength);
});
test("invalid native geometry, missing textures and unsupported extensions fail before GPU work", () => {
  const { device, pass } = setup(),
    f = frame(),
    nan = f.camera.slice();
  nan[3] = NaN;
  const mixed = f.billboards.slice();
  mixed[20] = 2;
  const invalid = [
    { ...f, camera: nan },
    { ...f, terrainDrawRanges: new Uint32Array([36, 36, 0, 36]) },
    { ...f, terrainVertexCount: -1 },
    { ...f, billboardVertexCount: 1.5 },
    { ...f, billboards: mixed },
    { ...f, billboards: vertices(12, 4) },
    { ...f, environment: { version: 1, values: new Float32Array(1) } },
    {
      ...f,
      materials: {
        version: 1,
        terrain: new Uint32Array([0xffffff, 8]),
        billboards: new Uint32Array(),
      },
    },
  ];
  const before = [device.buffers.length, device.textures.length, device.writes.length];
  for (const bad of invalid) throws(() => pass.validate(bad as SpatialRenderBufferView));
  deepEqual([device.buffers.length, device.textures.length, device.writes.length], before);
});
test("all terrain culled submits only billboards and destroy releases every owned buffer/texture once", () => {
  const { device, pass, draw } = setup(),
    f = frame();
  const { stats, gpu } = draw({ ...f, terrainDrawRanges: new Uint32Array() });
  equal(stats.terrainTriangleCount, 0);
  equal(stats.culledTerrainChunkCount, 2);
  deepEqual(gpu.draws, [
    [6, 1, 0],
    [6, 1, 6],
  ]);
  pass.destroy();
  pass.destroy();
  equal(
    device.buffers.every((r) => r.destroyed === 1),
    true,
  );
  equal(
    device.textures.every((r) => r.destroyed === 1),
    true,
  );
  throws(() => draw(f), /destroyed/);
});
test("oversized spatial depth targets fail before replacing resources or uploading a frame", () => {
  const { device, pass } = setup(),
    f = frame();
  const before = [device.buffers.length, device.textures.length, device.writes.length];
  const encoder = {
    beginRenderPass() {
      throw Error("unexpected draw");
    },
  } as unknown as GPUCommandEncoder;
  for (const [width, height] of [
    [0, 240],
    [8193, 1],
    [4096, 4096],
    [320.5, 240],
  ]) {
    throws(() => pass.draw(f, encoder, {}, width, height), /depth target/);
  }
  deepEqual([device.buffers.length, device.textures.length, device.writes.length], before);
  pass.destroy();
});
test("HDR lighting, normal atlases and debug keep bounded warm resources and validate data textures before writes", () => {
  const { device, draw, pass, textures } = setup(),
    f = frame();
  f.camera.set([0, 120, -160, 240, 0, 40, 24, 0, 0.1, 2000, 320, 240], 16);
  const values = compileSpatialEnvironment({
    lighting: { ambient: [0.1, 0.1, 0.1], lights: [] },
    depthOfField: { quality: "high", focusDistance: 100 },
  });
  f.environment = {
    version: 2,
    values,
    shadowMatrices: new Float32Array(),
    shadowCasters: new Float32Array(),
    shadowCasterVertexCount: 0,
  };
  // Same atlas with different normal bindings must remain separate geometry batches.
  f.billboards = vertices(12, 1);
  f.materials = {
    version: 1,
    terrain: new Uint32Array(),
    billboards: new Uint32Array([0xffffff, 3, 3, 3]),
  };
  f.debug = {
    version: 1,
    vertexStride: 11,
    vertices: vertices(2),
    vertexCount: 2,
    depthTest: false,
    truncated: true,
  };
  const first = draw(f),
    counts = [device.buffers.length, device.textures.length];
  equal(first.stats.billboardDrawCalls, 2);
  equal(first.stats.effectDrawCalls, 1);
  equal(first.stats.effectTextureBytes, 320 * 240 * 12);
  equal(first.stats.dofSampleBudget, 25);
  equal(first.stats.debugLineCount, 1);
  equal(first.stats.debugTruncated, true);
  equal(first.stats.debugUploadBytes, 88);
  equal(
    first.gpu.groups.some(
      ([i, g]) =>
        i === 3 &&
        (
          g as {
            textureId?: number;
          }
        ).textureId === 3,
    ),
    true,
  );
  equal(draw(f).stats.terrainUploadBytes, 0);
  deepEqual([device.buffers.length, device.textures.length], counts);
  const before = [device.buffers.length, device.textures.length, device.writes.length];
  for (const invalid of [
    { width: 8, height: 8, colorSpace: "srgb", revision: 1 },
    { width: 4, height: 8, colorSpace: "none" },
  ]) {
    textures.set(3, { bindGroup: { textureId: 3 }, revision: 1, ...invalid });
    throws(() => draw(f), /normal atlas/);
    deepEqual([device.buffers.length, device.textures.length, device.writes.length], before);
  }
  pass.destroy();
  equal(
    device.buffers.every((r) => r.destroyed === 1),
    true,
  );
  equal(
    device.textures.every((r) => r.destroyed === 1),
    true,
  );
});
test("native shadow face ranges include camera-culled terrain and warm cache tracks atlas and caster revisions", () => {
  const { device, draw, pass, textures } = setup(),
    f = frame();
  f.camera.set([0, 120, -160, 240, 0, 40, 24, 0, 0.1, 2000, 320, 240], 16);
  const values = compileSpatialEnvironment({
    lighting: {
      lights: [{ position: { x: 0, y: 0, elevation: 100 }, radius: 300 }],
      shadows: { lightIndex: 0, resolution: 128 },
      directional: { direction: { x: -1, y: -1, elevation: 2 }, shadows: { resolution: 128 } },
    },
  });
  f.environment = {
    version: 2,
    values,
    shadowMatrices: new Float32Array(112),
    shadowCasters: vertices(6, 1),
    shadowCasterVertexCount: 6,
    shadowSubmission: {
      version: 1,
      revision: 10,
      ranges: new Uint32Array([0, 0, 0, 36, 1, 1, 0, 6, 6, 0, 36, 36]),
    },
  };
  const cold = draw(f);
  equal(cold.stats.shadowPassCount, 7);
  equal(cold.stats.shadowDrawCalls, 3);
  equal(cold.stats.shadowTriangleCount, 26);
  equal(cold.stats.shadowUploadBytes, 6 * 44);
  deepEqual(cold.gpu.draws.slice(0, 3), [
    [36, 1, 0],
    [6, 1, 0],
    [36, 1, 36],
  ]);
  const count = [device.buffers.length, device.textures.length];
  const warm = draw(f);
  equal(warm.stats.shadowCacheHit, true);
  equal(warm.stats.shadowPassCount, 0);
  equal(warm.stats.shadowUploadBytes, 0);
  deepEqual([device.buffers.length, device.textures.length], count);
  f.camera[0] = 2;
  equal(draw(f).stats.shadowCacheHit, true);
  textures.get(1)!.revision++;
  equal(draw(f).stats.shadowCacheHit, false);
  equal(draw(f).stats.shadowCacheHit, true);
  f.environment.shadowSubmission!.revision++;
  equal(draw(f).stats.shadowCacheHit, false);
  f.environment.values[3] = 256;
  equal(draw(f).stats.shadowCacheHit, false);
  equal(draw(f).stats.shadowCacheHit, true);
  pass.destroy();
  equal(
    device.buffers.every((r) => r.destroyed === 1),
    true,
  );
  equal(
    device.textures.every((r) => r.destroyed === 1),
    true,
  );
});
test("debug allocation and growth keep encoded and cached shadow caster buffers alive until pass destruction", () => {
  const { device, draw, pass } = setup(),
    f = frame();
  f.camera.set([0, 120, -160, 240, 0, 40, 24, 0, 0.1, 2000, 320, 240], 16);
  const values = compileSpatialEnvironment({
    lighting: {
      lights: [{ position: { x: 0, y: 0, elevation: 100 }, radius: 300 }],
      shadows: { lightIndex: 0, resolution: 128 },
    },
  });
  f.environment = {
    version: 1,
    values,
    shadowMatrices: new Float32Array(96),
    shadowCasters: vertices(6, 1),
    shadowCasterVertexCount: 6,
    shadowSubmission: { version: 1, revision: 1, ranges: new Uint32Array([0, 1, 0, 6]) },
  };
  f.debug = {
    version: 1,
    vertexStride: 11,
    vertices: vertices(2),
    vertexCount: 2,
    depthTest: false,
    truncated: false,
  };
  equal(draw(f).stats.shadowPassCount, 6);
  const caster = device.buffers.find(
    (r) => (r.descriptor as { label?: string }).label === "Spatial shadow casters",
  )!;
  equal(caster.destroyed, 0);
  f.debug = { ...f.debug, vertices: vertices(16), vertexCount: 16 };
  equal(draw(f).stats.shadowCacheHit, true);
  equal(caster.destroyed, 0);
  f.environment.shadowSubmission!.revision++;
  equal(draw(f).stats.shadowPassCount, 6);
  equal(caster.destroyed, 0);
  equal(draw(f).stats.shadowCacheHit, true);
  pass.destroy();
  equal(
    device.buffers.every((r) => r.destroyed === 1),
    true,
  );
  equal(
    device.textures.every((r) => r.destroyed === 1),
    true,
  );
});
test("abandoned shadow command encoders and failed resize cannot publish an unsubmitted warm map", () => {
  const { pass, draw, device } = setup(),
    f = frame();
  f.camera.set([0, 120, -160, 240, 0, 40, 24, 0, 0.1, 2000, 320, 240], 16);
  const values = compileSpatialEnvironment({
    lighting: {
      lights: [{ position: { x: 0, y: 0, elevation: 100 }, radius: 300 }],
      shadows: { lightIndex: 0, resolution: 128 },
    },
  });
  f.environment = {
    version: 1,
    values,
    shadowMatrices: new Float32Array(96),
    shadowCasters: vertices(6, 1),
    shadowCasterVertexCount: 6,
    shadowSubmission: { version: 1, revision: 1, ranges: new Uint32Array([0, 0, 0, 36]) },
  };
  const encoder = { beginRenderPass: () => new Pass() } as unknown as GPUCommandEncoder;
  const abandoned = pass.draw(f, encoder, {}, 320, 240);
  equal(abandoned.shadowPassCount, 6);
  // No commitSubmission: even unchanged native data cannot reuse work in an abandoned encoder.
  equal(draw(f).stats.shadowCacheHit, false);
  equal(draw(f).stats.shadowCacheHit, true);
  f.environment.values[3] = 256;
  const abortMain = {
    beginRenderPass(d: GPURenderPassDescriptor) {
      if (d.label === "Spatial geometry") throw Error("main encode failed");
      return new Pass();
    },
  } as unknown as GPUCommandEncoder;
  throws(() => pass.draw(f, abortMain, {}, 320, 240), /main encode failed/);
  equal(draw(f).stats.shadowCacheHit, false);
  equal(draw(f).stats.shadowCacheHit, true);
  // A newly allocated map must remain unready even when preparation aborts before shadow recording.
  f.environment.values[3] = 512;
  const original = device.createBindGroup.bind(device);
  let fail = true;
  device.createBindGroup = (d: object) => {
    if (fail) {
      fail = false;
      throw Error("binding failed");
    }
    return original(d);
  };
  throws(() => pass.draw(f, encoder, {}, 320, 240), /binding failed/);
  equal(draw(f).stats.shadowCacheHit, false);
  equal(draw(f).stats.shadowCacheHit, true);
  pass.destroy();
  equal(
    device.buffers.every((r) => r.destroyed === 1),
    true,
  );
  equal(
    device.textures.every((r) => r.destroyed === 1),
    true,
  );
});
