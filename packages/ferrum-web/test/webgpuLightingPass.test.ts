import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { normalizeLightingScene } from "../src/lighting.js";
import { WebGpuLightingPass } from "../src/webgpuLightingPass.js";

interface CapturedWriteBufferCall {
  buffer: GPUBuffer;
  bufferOffset: number;
  dataWasView: boolean;
  values: number[];
  dataOffset: number;
  size: number | undefined;
}

class FakeGpuBuffer {
  destroyed = false;

  constructor(readonly size: number) {}

  destroy(): void {
    this.destroyed = true;
  }
}

class FakeGpuQueue {
  readonly writeBufferCalls: CapturedWriteBufferCall[] = [];
  submitCount = 0;

  writeBuffer(
    buffer: GPUBuffer,
    bufferOffset: number,
    data: ArrayBufferLike | ArrayBufferView<ArrayBufferLike>,
    dataOffset = 0,
    size?: number,
  ): void {
    const sourceBuffer = ArrayBuffer.isView(data) ? data.buffer : data;
    const sourceByteOffset = ArrayBuffer.isView(data) ? data.byteOffset + dataOffset : dataOffset;
    const byteLength = size ?? sourceBuffer.byteLength - sourceByteOffset;
    this.writeBufferCalls.push({
      buffer,
      bufferOffset,
      dataWasView: ArrayBuffer.isView(data),
      dataOffset,
      size,
      values: Array.from(new Float32Array(sourceBuffer as ArrayBuffer, sourceByteOffset, byteLength / 4)),
    });
  }

  submit(): void {
    this.submitCount += 1;
  }
}

class FakeGpuDevice {
  readonly queue = new FakeGpuQueue();
  readonly buffers: FakeGpuBuffer[] = [];
  readonly renderPipelines: GPURenderPipeline[] = [];
  commandEncoderCreated = false;

  createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer {
    const buffer = new FakeGpuBuffer(descriptor.size);
    this.buffers.push(buffer);
    return buffer as unknown as GPUBuffer;
  }

  createShaderModule(): GPUShaderModule {
    return {} as GPUShaderModule;
  }

  createRenderPipeline(): GPURenderPipeline {
    const pipeline = { id: this.renderPipelines.length };
    this.renderPipelines.push(pipeline as unknown as GPURenderPipeline);
    return pipeline as unknown as GPURenderPipeline;
  }

  createCommandEncoder(): GPUCommandEncoder {
    this.commandEncoderCreated = true;
    throw new Error("WebGpuLightingPass must draw into the caller-owned render pass.");
  }
}

class FakeRenderPass {
  readonly drawCalls: Array<{
    vertexCount: number;
    instanceCount: number;
    firstVertex: number;
    firstInstance: number;
  }> = [];
  readonly vertexBuffers: GPUBuffer[] = [];

  setPipeline(): void {}

  setBindGroup(): void {}

  setVertexBuffer(_slot: number, buffer: GPUBuffer): void {
    this.vertexBuffers.push(buffer);
  }

  draw(vertexCount: number, instanceCount: number, firstVertex = 0, firstInstance = 0): void {
    this.drawCalls.push({ vertexCount, instanceCount, firstVertex, firstInstance });
  }
}

test("WebGpuLightingPass records lighting draws into the caller render pass with one lighting upload", () => {
  installWebGpuGlobals();
  const device = new FakeGpuDevice();
  const pass = new WebGpuLightingPass(
    device as unknown as GPUDevice,
    "rgba8unorm",
    {} as GPUPipelineLayout,
    {} as GPUBindGroup,
  );
  const renderPass = new FakeRenderPass();
  const scene = normalizeLightingScene({
    ambient: [0.1, 0.2, 0.3, 0.4],
    pointLights: [{
      x: 64,
      y: 64,
      radius: 80,
      color: [1, 0.5, 0.25, 1],
      intensity: 0.5,
      falloff: 2,
    }],
    tileOccluders: [{ x: 100, y: 60, width: 16, height: 16 }],
    shadows: { enabled: true, color: [0, 0, 0, 0.5], projectionLength: 128 },
    debug: { tileOccluders: true, color: [1, 0, 0, 0.25] },
  });

  const stats = pass.draw(renderPass as unknown as GPURenderPassEncoder, scene, 200, 120);

  deepEqual(stats, {
    drawCalls: 4,
    pointLightCount: 1,
    tileOccluderCount: 1,
    shadowDrawCalls: 1,
    shadowCasterCount: 1,
  });
  equal(device.commandEncoderCreated, false);
  equal(device.queue.submitCount, 0);
  equal(renderPass.drawCalls.length, 4);
  deepEqual(renderPass.drawCalls.map(({ instanceCount, firstInstance }) => ({ instanceCount, firstInstance })), [
    { instanceCount: 1, firstInstance: 0 },
    { instanceCount: 1, firstInstance: 1 },
    { instanceCount: 1, firstInstance: 0 },
    { instanceCount: 1, firstInstance: 2 },
  ]);
  equal(renderPass.vertexBuffers[0], renderPass.vertexBuffers[1]);
  equal(renderPass.vertexBuffers[0], renderPass.vertexBuffers[3]);
  equal(device.queue.writeBufferCalls.length, 2);
  equal(device.queue.writeBufferCalls.every((call) => !call.dataWasView), true);
  deepEqual(device.queue.writeBufferCalls[0]?.values, Array.from(new Float32Array([
    0, 0, 200, 120, 0.1, 0.2, 0.3, 0.4, 0, 0, 1, 1, 0,
    -16, -16, 160, 160, 0.5, 0.25, 0.125, 1, 64, 64, 80, 2, 1,
    100, 60, 16, 16, 1, 0, 0, 0.25, 0, 0, 1, 1, 0,
  ])));
});

test("WebGpuLightingPass skips disabled scenes without GPU writes", () => {
  installWebGpuGlobals();
  const device = new FakeGpuDevice();
  const pass = new WebGpuLightingPass(
    device as unknown as GPUDevice,
    "rgba8unorm",
    {} as GPUPipelineLayout,
    {} as GPUBindGroup,
  );
  const renderPass = new FakeRenderPass();

  const stats = pass.draw(renderPass as unknown as GPURenderPassEncoder, normalizeLightingScene(false), 200, 120);

  deepEqual(stats, {
    drawCalls: 0,
    pointLightCount: 0,
    tileOccluderCount: 0,
    shadowDrawCalls: 0,
    shadowCasterCount: 0,
  });
  equal(device.queue.writeBufferCalls.length, 0);
  equal(renderPass.drawCalls.length, 0);
});

test("WebGpuLightingPass grows owned buffers and destroys them idempotently", () => {
  installWebGpuGlobals();
  const device = new FakeGpuDevice();
  const pass = new WebGpuLightingPass(
    device as unknown as GPUDevice,
    "rgba8unorm",
    {} as GPUPipelineLayout,
    {} as GPUBindGroup,
  );
  const firstLightingBuffer = device.buffers[0];
  const firstShadowBuffer = device.buffers[1];
  const scene = normalizeLightingScene({
    ambient: [0, 0, 0, 0],
    pointLights: [
      { x: 0, y: 0, radius: 16 },
      { x: 32, y: 0, radius: 16 },
    ],
  });

  const stats = pass.draw(new FakeRenderPass() as unknown as GPURenderPassEncoder, scene, 200, 120);

  equal(stats.drawCalls, 1);
  equal(stats.pointLightCount, 2);
  equal(firstLightingBuffer?.destroyed, true);
  equal(firstShadowBuffer?.destroyed, false);
  equal(device.buffers.length, 3);
  pass.destroy();
  pass.destroy();
  equal(firstShadowBuffer?.destroyed, true);
  equal(device.buffers[2]?.destroyed, true);
});

function installWebGpuGlobals(): void {
  const globals = globalThis as typeof globalThis & {
    GPUBufferUsage?: typeof GPUBufferUsage;
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
}
