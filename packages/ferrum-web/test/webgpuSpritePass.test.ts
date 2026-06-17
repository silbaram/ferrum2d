import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  resolveSpriteMaterialPreset,
  SPRITE_RENDER_COMMAND_FLOATS,
  spriteMaterialPasses,
} from "../src/spriteMaterial.js";
import { WebGpuSpritePass, webGpuSpriteStagingCapacity } from "../src/webgpuSpritePass.js";
import type { RenderCommandBufferView } from "../src/wasmBridge.js";

test("webGpuSpriteStagingCapacity grows material staging buffers by powers of two", () => {
  equal(webGpuSpriteStagingCapacity(0), 1);
  equal(webGpuSpriteStagingCapacity(1), 1);
  equal(webGpuSpriteStagingCapacity(15), 16);
  equal(webGpuSpriteStagingCapacity(16), 16);
  equal(webGpuSpriteStagingCapacity(17), 32);
});

test("WebGpuSpritePass uploads one command segment and draws texture ranges from distinct offsets", () => {
  installWebGpuGlobals();
  const device = new FakeGpuDevice();
  const textureStore = new FakeTextureStore();
  const spritePass = new WebGpuSpritePass(
    device as unknown as GPUDevice,
    "rgba8unorm",
    {} as GPUBindGroupLayout,
    {} as GPUBindGroupLayout,
    textureStore as unknown as ConstructorParameters<typeof WebGpuSpritePass>[4],
    {} as GPUBindGroup,
  );
  const renderPass = new FakeRenderPass();
  const commands = commandBuffer([1, 2, 1]);

  const stats = spritePass.draw(
    renderPass as unknown as GPURenderPassEncoder,
    commands,
    spriteMaterialPasses(resolveSpriteMaterialPreset("unlit")),
  );

  deepEqual(stats, { drawCalls: 3, textureSwitchCount: 2 });
  equal(device.queue.writeBufferCalls.length, 1);
  equal(device.queue.writeBufferCalls[0]?.bufferOffset, 0);
  equal(device.queue.writeBufferCalls[0]?.size, commands.commandCount * spriteCommandBytes());
  deepEqual(
    [
      device.queue.writeBufferCalls[0]?.values[14],
      device.queue.writeBufferCalls[0]?.values[29],
      device.queue.writeBufferCalls[0]?.values[44],
    ],
    [0.25, 0.5, 0.75],
  );
  deepEqual(renderPass.textureBindGroupIds(), [1, 2, 1]);
  deepEqual(renderPass.vertexBufferOffsets(), [
    0,
    spriteCommandBytes(),
    spriteCommandBytes() * 2,
  ]);
  deepEqual(renderPass.drawInstanceCounts(), [1, 1, 1]);
});

test("WebGpuSpritePass stores material passes in separate buffer segments", () => {
  installWebGpuGlobals();
  const device = new FakeGpuDevice();
  const spritePass = new WebGpuSpritePass(
    device as unknown as GPUDevice,
    "rgba8unorm",
    {} as GPUBindGroupLayout,
    {} as GPUBindGroupLayout,
    new FakeTextureStore() as unknown as ConstructorParameters<typeof WebGpuSpritePass>[4],
    {} as GPUBindGroup,
  );
  const renderPass = new FakeRenderPass();
  const commands = commandBuffer([3]);
  const passes = spriteMaterialPasses(resolveSpriteMaterialPreset("outline"));

  const stats = spritePass.draw(renderPass as unknown as GPURenderPassEncoder, commands, passes);

  deepEqual(stats, { drawCalls: passes.length, textureSwitchCount: 0 });
  deepEqual(device.queue.writeBufferCalls.map((call) => call.bufferOffset), [
    0,
    spriteCommandBytes(),
    spriteCommandBytes() * 2,
    spriteCommandBytes() * 3,
    spriteCommandBytes() * 4,
  ]);
  deepEqual(renderPass.vertexBufferOffsets(), [
    0,
    spriteCommandBytes(),
    spriteCommandBytes() * 2,
    spriteCommandBytes() * 3,
    spriteCommandBytes() * 4,
  ]);
  equal(device.queue.writeBufferCalls[0]?.values[0], 8);
  equal(device.queue.writeBufferCalls[1]?.values[0], 12);
  equal(device.queue.writeBufferCalls[0]?.values[14], 0.25);
});

test("WebGpuSpritePass canonicalizes legacy command buffers before range draws", () => {
  installWebGpuGlobals();
  const device = new FakeGpuDevice();
  const spritePass = new WebGpuSpritePass(
    device as unknown as GPUDevice,
    "rgba8unorm",
    {} as GPUBindGroupLayout,
    {} as GPUBindGroupLayout,
    new FakeTextureStore() as unknown as ConstructorParameters<typeof WebGpuSpritePass>[4],
    {} as GPUBindGroup,
  );
  const renderPass = new FakeRenderPass();
  const commands = legacyCommandBuffer([4, 5]);

  const stats = spritePass.draw(
    renderPass as unknown as GPURenderPassEncoder,
    commands,
    spriteMaterialPasses(resolveSpriteMaterialPreset("unlit")),
  );

  deepEqual(stats, { drawCalls: 2, textureSwitchCount: 1 });
  equal(device.queue.writeBufferCalls.length, 1);
  equal(device.queue.writeBufferCalls[0]?.size, commands.commandCount * spriteCommandBytes());
  equal(device.queue.writeBufferCalls[0]?.values.length, commands.commandCount * SPRITE_RENDER_COMMAND_FLOATS);
  equal(device.queue.writeBufferCalls[0]?.values[13], 0);
  equal(device.queue.writeBufferCalls[0]?.values[14], 0);
  equal(device.queue.writeBufferCalls[0]?.values[28], 0);
  equal(device.queue.writeBufferCalls[0]?.values[29], 0);
  deepEqual(renderPass.vertexBufferOffsets(), [0, spriteCommandBytes()]);
});

interface CapturedWriteBufferCall {
  bufferOffset: number;
  size: number | undefined;
  values: number[];
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

  writeBuffer(
    _buffer: GPUBuffer,
    bufferOffset: number,
    data: ArrayBufferLike | ArrayBufferView<ArrayBufferLike>,
    dataOffset = 0,
    size?: number,
  ): void {
    const sourceBuffer = ArrayBuffer.isView(data) ? data.buffer : data;
    const sourceByteOffset = ArrayBuffer.isView(data) ? data.byteOffset + dataOffset : dataOffset;
    const byteLength = size ?? sourceBuffer.byteLength - sourceByteOffset;
    this.writeBufferCalls.push({
      bufferOffset,
      size,
      values: Array.from(new Float32Array(sourceBuffer as ArrayBuffer, sourceByteOffset, byteLength / 4)),
    });
  }
}

class FakeGpuDevice {
  readonly queue = new FakeGpuQueue();
  readonly renderPipelineDescriptors: GPURenderPipelineDescriptor[] = [];

  createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer {
    return new FakeGpuBuffer(descriptor.size) as unknown as GPUBuffer;
  }

  createPipelineLayout(): GPUPipelineLayout {
    return {} as GPUPipelineLayout;
  }

  createShaderModule(): GPUShaderModule {
    return {} as GPUShaderModule;
  }

  createRenderPipeline(descriptor: GPURenderPipelineDescriptor): GPURenderPipeline {
    this.renderPipelineDescriptors.push(descriptor);
    return {} as GPURenderPipeline;
  }
}

class FakeTextureStore {
  resource(textureId: number): { bindGroup: GPUBindGroup } {
    return { bindGroup: { textureId } as unknown as GPUBindGroup };
  }
}

class FakeRenderPass {
  private readonly textureBindGroups: number[] = [];
  private readonly vertexBuffers: Array<{ offset: number; size?: number }> = [];
  private readonly drawCalls: Array<{ instanceCount: number }> = [];

  setPipeline(): void {}

  setBindGroup(index: number, bindGroup: GPUBindGroup): void {
    if (index === 1) {
      this.textureBindGroups.push((bindGroup as unknown as { textureId: number }).textureId);
    }
  }

  setVertexBuffer(_slot: number, _buffer: GPUBuffer, offset = 0, size?: number): void {
    this.vertexBuffers.push({ offset, size });
  }

  draw(_vertexCount: number, instanceCount: number): void {
    this.drawCalls.push({ instanceCount });
  }

  textureBindGroupIds(): number[] {
    return this.textureBindGroups;
  }

  vertexBufferOffsets(): number[] {
    return this.vertexBuffers.map((call) => call.offset);
  }

  drawInstanceCounts(): number[] {
    return this.drawCalls.map((call) => call.instanceCount);
  }
}

function commandBuffer(textureIds: number[]): RenderCommandBufferView {
  const buffer = new Float32Array(textureIds.length * SPRITE_RENDER_COMMAND_FLOATS);
  for (let index = 0; index < textureIds.length; index += 1) {
    const offset = index * SPRITE_RENDER_COMMAND_FLOATS;
    buffer[offset] = 10 + index * 10;
    buffer[offset + 1] = 20;
    buffer[offset + 2] = 8;
    buffer[offset + 3] = 8;
    buffer[offset + 8] = 0.1;
    buffer[offset + 9] = 0.2;
    buffer[offset + 10] = 0.3;
    buffer[offset + 11] = 0.4;
    buffer[offset + 12] = textureIds[index];
    buffer[offset + 13] = 0;
    buffer[offset + 14] = 0.25 + index * 0.25;
  }
  return {
    buffer,
    commandCount: textureIds.length,
    floatsPerCommand: SPRITE_RENDER_COMMAND_FLOATS,
  };
}

function legacyCommandBuffer(textureIds: number[]): RenderCommandBufferView {
  const floatsPerCommand = SPRITE_RENDER_COMMAND_FLOATS - 1;
  const buffer = new Float32Array(textureIds.length * floatsPerCommand);
  for (let index = 0; index < textureIds.length; index += 1) {
    const offset = index * floatsPerCommand;
    buffer[offset] = 10 + index * 10;
    buffer[offset + 1] = 20;
    buffer[offset + 2] = 8;
    buffer[offset + 3] = 8;
    buffer[offset + 8] = 0.1;
    buffer[offset + 9] = 0.2;
    buffer[offset + 10] = 0.3;
    buffer[offset + 11] = 0.4;
    buffer[offset + 12] = textureIds[index];
  }
  return {
    buffer,
    commandCount: textureIds.length,
    floatsPerCommand,
  };
}

function spriteCommandBytes(): number {
  return SPRITE_RENDER_COMMAND_FLOATS * Float32Array.BYTES_PER_ELEMENT;
}

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
