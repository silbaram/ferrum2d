import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import type { PhysicsDebugLineBufferView } from "../src/physicsDebugLineDecoder.js";
import { WebGpuDebugLinePass } from "../src/webgpuDebugLinePass.js";

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

  destroy(): void {
    this.destroyed = true;
  }
}

class FakeGpuTexture {
  createView(): GPUTextureView {
    return { texture: this } as unknown as GPUTextureView;
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

class FakeRenderPass {
  drawVertexCount = 0;
  ended = false;

  setPipeline(): void {}

  setBindGroup(): void {}

  setVertexBuffer(): void {}

  draw(vertexCount: number): void {
    this.drawVertexCount = vertexCount;
  }

  end(): void {
    this.ended = true;
  }
}

class FakeCommandEncoder {
  readonly passes: FakeRenderPass[] = [];

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

  createBuffer(): GPUBuffer {
    const buffer = new FakeGpuBuffer();
    this.buffers.push(buffer);
    return buffer as unknown as GPUBuffer;
  }

  createShaderModule(): GPUShaderModule {
    return {} as GPUShaderModule;
  }

  createRenderPipeline(): GPURenderPipeline {
    return {} as GPURenderPipeline;
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

test("WebGpuDebugLinePass writes camera-relative line vertices without allocating upload views", () => {
  installWebGpuGlobals();
  const device = new FakeGpuDevice();
  const pass = new WebGpuDebugLinePass(
    device as unknown as GPUDevice,
    new FakeGpuCanvasContext() as unknown as GPUCanvasContext,
    "rgba8unorm",
    {} as GPUPipelineLayout,
    {} as GPUBindGroup,
  );
  const lines: PhysicsDebugLineBufferView = {
    buffer: new Float32Array([
      0, 0, 10, 20, 0.1, 0.2, 0.3, 0.4,
    ]),
    lineCount: 1,
    floatsPerLine: 8,
  };

  const drawCalls = pass.draw(lines, { x: 5, y: 10 }, 100, 50);

  equal(drawCalls, 1);
  equal(device.queue.submitCount, 1);
  equal(device.queue.writeBufferCalls.length, 1);
  equal(device.queue.writeBufferCalls[0]?.bufferOffset, 0);
  equal(device.queue.writeBufferCalls[0]?.dataWasView, false);
  equal(device.queue.writeBufferCalls[0]?.dataOffset, 0);
  equal(device.queue.writeBufferCalls[0]?.size, 12 * Float32Array.BYTES_PER_ELEMENT);
  deepEqual(device.queue.writeBufferCalls[0]?.values, Array.from(new Float32Array([
    45, 15, 0.1, 0.2, 0.3, 0.4,
    55, 35, 0.1, 0.2, 0.3, 0.4,
  ])));
  equal(device.encoders[0]?.passes[0]?.drawVertexCount, 2);
  equal(device.encoders[0]?.passes[0]?.ended, true);
});

test("WebGpuDebugLinePass grows vertex buffers by destroying the previous buffer", () => {
  installWebGpuGlobals();
  const device = new FakeGpuDevice();
  const pass = new WebGpuDebugLinePass(
    device as unknown as GPUDevice,
    new FakeGpuCanvasContext() as unknown as GPUCanvasContext,
    "rgba8unorm",
    {} as GPUPipelineLayout,
    {} as GPUBindGroup,
  );
  const firstBuffer = device.buffers[0];
  const lines: PhysicsDebugLineBufferView = {
    buffer: new Float32Array([
      0, 0, 1, 1, 1, 0, 0, 1,
      1, 1, 2, 2, 0, 1, 0, 1,
    ]),
    lineCount: 2,
    floatsPerLine: 8,
  };

  equal(pass.draw(lines, { x: 0, y: 0 }, 100, 100), 1);

  equal(firstBuffer?.destroyed, true);
  equal(device.buffers.length, 2);
  pass.destroy();
  equal(device.buffers[1]?.destroyed, true);
});

test("WebGpuDebugLinePass skips empty debug buffers and destroys owned buffers", () => {
  installWebGpuGlobals();
  const device = new FakeGpuDevice();
  const pass = new WebGpuDebugLinePass(
    device as unknown as GPUDevice,
    new FakeGpuCanvasContext() as unknown as GPUCanvasContext,
    "rgba8unorm",
    {} as GPUPipelineLayout,
    {} as GPUBindGroup,
  );

  equal(pass.draw({ buffer: new Float32Array(0), lineCount: 0, floatsPerLine: 8 }, { x: 0, y: 0 }, 100, 50), 0);
  equal(device.queue.writeBufferCalls.length, 0);
  pass.destroy();
  pass.destroy();
  equal(device.buffers[0]?.destroyed, true);
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
