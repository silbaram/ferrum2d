import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import { webGpuResources } from "../src/webgpuResources.js";
import {
  WebGpuPostProcessPass,
  resolveWebGpuPostProcessPasses,
} from "../src/webgpuPostProcessPass.js";

class FakeGpuBuffer {
  destroyed = false;

  destroy(): void {
    this.destroyed = true;
  }
}

class FakeGpuTexture {
  destroyed = false;
  constructor(readonly width = 16, readonly height = 8) {}
  destroy(): void { this.destroyed = true; }
  createView(): GPUTextureView {
    return { texture: this } as unknown as GPUTextureView;
  }
}

class FakeGpuQueue {
  writeBufferCount = 0;
  submitCount = 0;

  writeBuffer(): void {
    this.writeBufferCount += 1;
  }

  submit(): void {
    this.submitCount += 1;
  }
}

class FakeRenderPass {
  drawCount = 0;
  ended = false;

  setPipeline(): void {}

  setBindGroup(): void {}

  draw(): void {
    this.drawCount += 1;
  }

  end(): void {
    this.ended = true;
  }
}

class FakeCommandEncoder {
  readonly passes: FakeRenderPass[] = [];
  copies = 0;
  copyTextureToTexture(): void { this.copies++; }

  beginRenderPass(): GPURenderPassEncoder {
    const pass = new FakeRenderPass();
    this.passes.push(pass);
    return pass as unknown as GPURenderPassEncoder;
  }

  finish(): GPUCommandBuffer {
    return {} as GPUCommandBuffer;
  }
}

class FakeGpuDevice {
  readonly queue = new FakeGpuQueue();
  readonly buffers: FakeGpuBuffer[] = [];
  readonly encoders: FakeCommandEncoder[] = [];
  readonly textures: FakeGpuTexture[] = [];
  failGroup = false;
  failBuffer = false;
  createTexture(descriptor: GPUTextureDescriptor): GPUTexture {
    const size = descriptor.size as GPUExtent3DDict;
    const texture = new FakeGpuTexture(size.width, size.height);
    this.textures.push(texture);
    return texture as unknown as GPUTexture;
  }

  createBindGroupLayout(): GPUBindGroupLayout {
    return {} as GPUBindGroupLayout;
  }

  createPipelineLayout(): GPUPipelineLayout {
    return {} as GPUPipelineLayout;
  }

  createBuffer(): GPUBuffer {
    if (this.failBuffer) throw Error("buffer failure");
    const buffer = new FakeGpuBuffer();
    this.buffers.push(buffer);
    return buffer as unknown as GPUBuffer;
  }

  createBindGroup(): GPUBindGroup {
    if (this.failGroup) throw Error("group failure");
    return {} as GPUBindGroup;
  }

  createShaderModule(): GPUShaderModule {
    return {} as GPUShaderModule;
  }

  createRenderPipeline(): GPURenderPipeline {
    return { getBindGroupLayout: () => ({}) } as GPURenderPipeline;
  }

  createCommandEncoder(): GPUCommandEncoder {
    const encoder = new FakeCommandEncoder();
    this.encoders.push(encoder);
    return encoder as unknown as GPUCommandEncoder;
  }
}

class FakeGpuCanvasContext {
  getCurrentTexture(): GPUTexture {
    return new FakeGpuTexture() as unknown as GPUTexture;
  }
}

test("resolveWebGpuPostProcessPasses accepts fade passes and rejects unsupported WebGPU passes", () => {
  const fade = resolveWebGpuPostProcessPasses({ opacity: 0.5 });
  equal(fade.length, 1);
  equal(fade[0]?.kind, "fade");

  throwsWithMessage(
    () => resolveWebGpuPostProcessPasses({ bloom: { intensity: 1 } }),
    /requires the WebGL2 renderer/,
  );
});

test("WebGpuPostProcessPass draws only visible fade passes", () => {
  installWebGpuGlobals();
  const device = new FakeGpuDevice();
  const context = new FakeGpuCanvasContext();
  const pass = new WebGpuPostProcessPass(
    device as unknown as GPUDevice,
    () => (context as unknown as GPUCanvasContext).getCurrentTexture(),
    "rgba8unorm",
  );

  pass.setPostProcess([
    { kind: "fade", color: [0, 0, 0, 0] },
    { kind: "fade", color: [0.1, 0.2, 0.3, 0.4] },
  ]);
  const stats = pass.drawPasses();

  equal(stats.drawCalls, 1);
  equal(stats.passCount, 1);
  equal(device.queue.writeBufferCount, 1);
  equal(device.queue.submitCount, 1);
  equal(device.encoders.length, 1);
  equal(device.encoders[0]?.passes[0]?.drawCount, 1);
  equal(device.encoders[0]?.passes[0]?.ended, true);
  pass.destroy();
  equal(device.buffers[0]?.destroyed, true);
});

function installWebGpuGlobals(): void {
  const globals = globalThis as typeof globalThis & {
    GPUBufferUsage?: typeof GPUBufferUsage;
    GPUShaderStage?: typeof GPUShaderStage;
    GPUTextureUsage?: typeof GPUTextureUsage;
  };
  globals.GPUBufferUsage = {
    MAP_READ: 1,
    MAP_WRITE: 2,
    COPY_SRC: 4,
    COPY_DST: 8,
    INDEX: 16,
    VERTEX: 32,
    UNIFORM: 64,
    STORAGE: 128,
    INDIRECT: 256,
    QUERY_RESOLVE: 512,
  };
  globals.GPUShaderStage = {
    VERTEX: 1,
    FRAGMENT: 2,
    COMPUTE: 4,
  };
  globals.GPUTextureUsage = { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };
}

test("WebGPU pixelArt preserves pass order, reuses copies, rejects invalid updates and releases on disable", () => {
  installWebGpuGlobals();
  const device = new FakeGpuDevice();
  let texture = new FakeGpuTexture();
  const pass = new WebGpuPostProcessPass(device as unknown as GPUDevice, () => texture as unknown as GPUTexture, "rgba8unorm");
  equal(device.textures.length, 0);
  pass.setPostProcess([{ opacity: 0.5 }, { kind: "pixelArt", levels: 4 }, { opacity: 0.2 }]);
  deepEqual(pass.drawPasses(), { drawCalls: 3, passCount: 3 });
  deepEqual(device.encoders.map(encoder => encoder.copies), [0, 1, 0]);
  for (let i = 0; i < 3; i++) {
    pass.setPostProcess({ kind: "pixelArt", levels: 4 });
    pass.drawPasses();
  }
  equal(device.textures.length, 1);
  equal(device.buffers.length, 2);
  throws(() => pass.setPostProcess([{ kind: "pixelArt" }, { kind: "bloom" }]), /requires the WebGL2 renderer/);
  deepEqual(pass.drawPasses(), { drawCalls: 1, passCount: 1 });
  texture = new FakeGpuTexture(32, 16);
  device.failGroup = true;
  throws(() => pass.drawPasses(), /group failure/);
  equal(device.textures[0]?.destroyed, false);
  equal(device.textures[1]?.destroyed, true);
  device.failGroup = false;
  pass.drawPasses();
  equal(device.textures[0]?.destroyed, true);
  pass.setPostProcess(false);
  deepEqual(pass.drawPasses(), { drawCalls: 0, passCount: 0 });
  ok(device.textures.every(target => target.destroyed));
  equal(device.buffers[1]?.destroyed, true);
  pass.destroy();
  pass.destroy();
  ok(device.buffers.every(buffer => buffer.destroyed));
});

test("failed pixelArt activation releases its pipeline and preserves the active fade", () => {
  installWebGpuGlobals();
  const device = new FakeGpuDevice();
  const nativeDevice = device as unknown as GPUDevice;
  const texture = new FakeGpuTexture() as unknown as GPUTexture;
  const pass = new WebGpuPostProcessPass(nativeDevice, () => texture, "rgba8unorm", { opacity: 0.25 });
  const owner = webGpuResources(nativeDevice);
  const baseline = owner.stats();
  device.failBuffer = true;
  throws(() => pass.setPostProcess({ kind: "pixelArt" }), /buffer failure/);
  deepEqual(owner.stats(), baseline);
  deepEqual(pass.drawPasses(), { drawCalls: 1, passCount: 1 });
  equal(device.encoders[0]?.copies, 0);
  device.failBuffer = false;
  pass.setPostProcess({ kind: "pixelArt" });
  deepEqual(pass.drawPasses(), { drawCalls: 1, passCount: 1 });
  equal(device.encoders[1]?.copies, 1);
  pass.destroy();
  equal(owner.stats().bufferCount, 0);
  equal(owner.stats().textureCount, 0);
  equal(owner.stats().programCount, 0);
});

function throwsWithMessage(run: () => void, expected: RegExp): void {
  try {
    run();
  } catch (error) {
    ok(expected.test(error instanceof Error ? error.message : String(error)));
    return;
  }
  throw new Error(`Expected callback to throw ${expected}.`);
}
