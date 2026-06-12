import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { SpriteBatch } from "../src/spriteBatch.js";
import { SPRITE_RENDER_COMMAND_FLOATS } from "../src/spriteMaterial.js";
import type { TextureManager } from "../src/textureManager.js";
import type { RenderCommandBufferView } from "../src/renderCommandDecoder.js";

class FakeWebGL2Context {
  readonly BLEND = 0x0be2;
  readonly SRC_ALPHA = 0x0302;
  readonly ONE_MINUS_SRC_ALPHA = 0x0303;
  readonly ONE = 1;
  readonly ARRAY_BUFFER = 0x8892;
  readonly ELEMENT_ARRAY_BUFFER = 0x8893;
  readonly STATIC_DRAW = 0x88e4;
  readonly DYNAMIC_DRAW = 0x88e8;
  readonly FLOAT = 0x1406;
  readonly UNSIGNED_SHORT = 0x1403;
  readonly TRIANGLES = 0x0004;
  readonly TEXTURE0 = 0x84c0;
  readonly TEXTURE_2D = 0x0de1;
  readonly VERTEX_SHADER = 0x8b31;
  readonly FRAGMENT_SHADER = 0x8b30;
  readonly LINK_STATUS = 0x8b82;
  readonly COMPILE_STATUS = 0x8b81;

  readonly bufferDataCalls: Array<{
    target: number;
    usage: number;
    byteLength: number;
    values: number[];
  }> = [];
  readonly bufferSubDataCalls: Array<{ length: number; values: number[] }> = [];
  readonly drawElementsInstancedCalls: Array<{
    mode: number;
    count: number;
    type: number;
    offset: number;
    instanceCount: number;
  }> = [];
  readonly drawArraysInstancedCalls: Array<unknown[]> = [];
  readonly vertexAttribDivisorCalls: Array<{ index: number; divisor: number }> = [];

  private nextId = 1;

  createProgram(): WebGLProgram {
    return { id: this.nextId++ } as unknown as WebGLProgram;
  }

  createShader(): WebGLShader {
    return { id: this.nextId++ } as unknown as WebGLShader;
  }

  shaderSource(): void {}

  compileShader(): void {}

  getShaderParameter(): boolean {
    return true;
  }

  getShaderInfoLog(): string | null {
    return null;
  }

  attachShader(): void {}

  linkProgram(): void {}

  getProgramParameter(): boolean {
    return true;
  }

  getProgramInfoLog(): string | null {
    return null;
  }

  deleteShader(): void {}

  createVertexArray(): WebGLVertexArrayObject {
    return { id: this.nextId++ } as unknown as WebGLVertexArrayObject;
  }

  createBuffer(): WebGLBuffer {
    return { id: this.nextId++ } as unknown as WebGLBuffer;
  }

  getUniformLocation(_program: WebGLProgram, name: string): WebGLUniformLocation {
    return { name } as unknown as WebGLUniformLocation;
  }

  bindVertexArray(): void {}

  bindBuffer(): void {}

  bufferData(target: number, sizeOrData: number | ArrayBufferView, usage: number): void {
    const byteLength = typeof sizeOrData === "number" ? sizeOrData : sizeOrData.byteLength;
    const values = typeof sizeOrData === "number" ? [] : Array.from(sizeOrData as Float32Array | Uint16Array);
    this.bufferDataCalls.push({ target, usage, byteLength, values });
  }

  enableVertexAttribArray(): void {}

  vertexAttribPointer(): void {}

  vertexAttribDivisor(index: number, divisor: number): void {
    this.vertexAttribDivisorCalls.push({ index, divisor });
  }

  enable(): void {}

  blendFunc(): void {}

  useProgram(): void {}

  uniform2f(): void {}

  activeTexture(): void {}

  uniform1i(): void {}

  bindTexture(): void {}

  bufferSubData(
    _target: number,
    _dstByteOffset: number,
    srcData: Float32Array,
    srcOffset = 0,
    length?: number,
  ): void {
    const floatCount = length ?? srcData.length - srcOffset;
    this.bufferSubDataCalls.push({
      length: floatCount,
      values: Array.from(srcData.slice(srcOffset, srcOffset + floatCount)),
    });
  }

  drawElementsInstanced(
    mode: number,
    count: number,
    type: number,
    offset: number,
    instanceCount: number,
  ): void {
    this.drawElementsInstancedCalls.push({ mode, count, type, offset, instanceCount });
  }

  drawArraysInstanced(...args: unknown[]): void {
    this.drawArraysInstancedCalls.push(args);
  }

  deleteBuffer(): void {}

  deleteVertexArray(): void {}

  deleteProgram(): void {}
}

class FakeTextureManager {
  texture(textureId: number): WebGLTexture {
    return { textureId } as unknown as WebGLTexture;
  }
}

test("SpriteBatch uses static quad buffers with indexed instancing", () => {
  const gl = new FakeWebGL2Context();
  const batch = new SpriteBatch(gl as unknown as WebGL2RenderingContext);

  const staticUploads = gl.bufferDataCalls.filter((call) => call.usage === gl.STATIC_DRAW);
  equal(staticUploads.length, 2);
  deepEqual(staticUploads.find((call) => call.target === gl.ARRAY_BUFFER)?.values, [
    0, 0,
    1, 0,
    0, 1,
    1, 1,
  ]);
  deepEqual(staticUploads.find((call) => call.target === gl.ELEMENT_ARRAY_BUFFER)?.values, [
    0, 1, 2,
    2, 1, 3,
  ]);
  deepEqual(gl.vertexAttribDivisorCalls, [
    { index: 1, divisor: 1 },
    { index: 2, divisor: 1 },
    { index: 3, divisor: 1 },
  ]);

  const stats = batch.drawBatches(
    new FakeTextureManager() as unknown as TextureManager,
    commandBuffer([7, 7, 7]),
    [320, 180],
  );

  deepEqual(stats, { drawCalls: 1, textureSwitchCount: 0 });
  deepEqual(gl.drawElementsInstancedCalls, [{
    mode: gl.TRIANGLES,
    count: 6,
    type: gl.UNSIGNED_SHORT,
    offset: 0,
    instanceCount: 3,
  }]);
  equal(gl.drawArraysInstancedCalls.length, 0);
});

test("SpriteBatch draws texture ranges as indexed instanced batches", () => {
  const gl = new FakeWebGL2Context();
  const batch = new SpriteBatch(gl as unknown as WebGL2RenderingContext);
  const commands = commandBuffer([1, 2, 1]);

  const stats = batch.drawBatches(
    new FakeTextureManager() as unknown as TextureManager,
    commands,
    [320, 180],
  );

  deepEqual(stats, { drawCalls: 3, textureSwitchCount: 2 });
  deepEqual(
    gl.drawElementsInstancedCalls.map((call) => call.instanceCount),
    [1, 1, 1],
  );
  deepEqual(
    gl.bufferSubDataCalls.map((call) => call.values[0]),
    [10, 20, 30],
  );
});

function commandBuffer(textureIds: number[]): RenderCommandBufferView {
  const buffer = new Float32Array(textureIds.length * SPRITE_RENDER_COMMAND_FLOATS);
  for (let index = 0; index < textureIds.length; index += 1) {
    const offset = index * SPRITE_RENDER_COMMAND_FLOATS;
    buffer[offset] = 10 + index * 10;
    buffer[offset + 1] = 20;
    buffer[offset + 2] = 8;
    buffer[offset + 3] = 8;
    buffer[offset + 4] = 0;
    buffer[offset + 5] = 0;
    buffer[offset + 6] = 1;
    buffer[offset + 7] = 1;
    buffer[offset + 8] = 1;
    buffer[offset + 9] = 1;
    buffer[offset + 10] = 1;
    buffer[offset + 11] = 1;
    buffer[offset + 12] = textureIds[index];
  }
  return {
    buffer,
    commandCount: textureIds.length,
    floatsPerCommand: SPRITE_RENDER_COMMAND_FLOATS,
  };
}
