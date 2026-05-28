import { equal, ok } from "node:assert/strict";
import { test } from "node:test";
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

  createBindGroupLayout(): GPUBindGroupLayout {
    return {} as GPUBindGroupLayout;
  }

  createPipelineLayout(): GPUPipelineLayout {
    return {} as GPUPipelineLayout;
  }

  createBuffer(): GPUBuffer {
    const buffer = new FakeGpuBuffer();
    this.buffers.push(buffer);
    return buffer as unknown as GPUBuffer;
  }

  createBindGroup(): GPUBindGroup {
    return {} as GPUBindGroup;
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
  const pass = new WebGpuPostProcessPass(
    device as unknown as GPUDevice,
    new FakeGpuCanvasContext() as unknown as GPUCanvasContext,
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
}

function throwsWithMessage(run: () => void, expected: RegExp): void {
  try {
    run();
  } catch (error) {
    ok(expected.test(error instanceof Error ? error.message : String(error)));
    return;
  }
  throw new Error(`Expected callback to throw ${expected}.`);
}
