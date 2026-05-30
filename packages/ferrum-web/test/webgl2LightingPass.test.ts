import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { normalizeLightingScene } from "../src/lighting.js";
import { WebGL2LightingPass } from "../src/webgl2LightingPass.js";

class FakeWebGL2Context {
  readonly DEPTH_TEST = 0x0b71;
  readonly CULL_FACE = 0x0b44;
  readonly BLEND = 0x0be2;
  readonly SRC_ALPHA = 0x0302;
  readonly ONE_MINUS_SRC_ALPHA = 0x0303;
  readonly ONE = 1;
  readonly ARRAY_BUFFER = 0x8892;
  readonly DYNAMIC_DRAW = 0x88e8;
  readonly FLOAT = 0x1406;
  readonly TRIANGLES = 0x0004;
  readonly VERTEX_SHADER = 0x8b31;
  readonly FRAGMENT_SHADER = 0x8b30;
  readonly LINK_STATUS = 0x8b82;
  readonly COMPILE_STATUS = 0x8b81;

  readonly bufferDataCalls: Array<{ byteLength: number }> = [];
  readonly bufferSubDataCalls: Array<{ length: number; values: number[] }> = [];
  readonly drawArraysCalls: Array<{ mode: number; first: number; count: number }> = [];

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

  bufferData(_target: number, sizeOrData: number | ArrayBufferView, _usage: number): void {
    const byteLength = typeof sizeOrData === "number" ? sizeOrData : sizeOrData.byteLength;
    this.bufferDataCalls.push({ byteLength });
  }

  enableVertexAttribArray(): void {}

  vertexAttribPointer(): void {}

  disable(): void {}

  enable(): void {}

  blendFunc(): void {}

  useProgram(): void {}

  uniform2f(): void {}

  uniform4f(): void {}

  uniform1i(): void {}

  uniform1f(): void {}

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

  drawArrays(mode: number, first: number, count: number): void {
    this.drawArraysCalls.push({ mode, first, count });
  }

  deleteBuffer(): void {}

  deleteVertexArray(): void {}

  deleteProgram(): void {}
}

test("WebGL2LightingPass batches tile occluder shadows per light", () => {
  const gl = new FakeWebGL2Context();
  const pass = new WebGL2LightingPass(gl as unknown as WebGL2RenderingContext);
  const scene = normalizeLightingScene({
    ambient: [0, 0, 0, 0],
    pointLights: [{ x: 80, y: 48, radius: 120 }],
    tileOccluders: [
      { x: 24, y: 24, width: 16, height: 16 },
      { x: 112, y: 24, width: 16, height: 16 },
    ],
    shadows: { enabled: true, color: [0, 0, 0, 0.5], projectionLength: 180 },
  });

  const stats = pass.draw(scene, [200, 120]);

  deepEqual(stats, {
    drawCalls: 2,
    pointLightCount: 1,
    tileOccluderCount: 0,
    shadowDrawCalls: 1,
    shadowCasterCount: 2,
  });
  equal(gl.bufferSubDataCalls.length, 1);
  equal(gl.drawArraysCalls.length, 2);
  ok(gl.bufferSubDataCalls[0]!.length > 0);
  equal(gl.bufferSubDataCalls[0]!.length / 2, gl.drawArraysCalls[1]!.count);
});

test("WebGL2LightingPass keeps shadow draw and caster counts distinct across lights", () => {
  const gl = new FakeWebGL2Context();
  const pass = new WebGL2LightingPass(gl as unknown as WebGL2RenderingContext);
  const scene = normalizeLightingScene({
    ambient: [0, 0, 0, 0],
    pointLights: [
      { x: 80, y: 48, radius: 120 },
      { x: 160, y: 48, radius: 120 },
    ],
    tileOccluders: [{ x: 112, y: 24, width: 16, height: 16 }],
    shadows: { enabled: true, color: [0, 0, 0, 0.5], projectionLength: 180 },
  });

  const stats = pass.draw(scene, [240, 120]);

  equal(stats.shadowDrawCalls, 2);
  equal(stats.shadowCasterCount, 2);
  equal(gl.bufferSubDataCalls.length, 2);
});

test("WebGL2LightingPass skips culled shadow casters without uploads", () => {
  const gl = new FakeWebGL2Context();
  const pass = new WebGL2LightingPass(gl as unknown as WebGL2RenderingContext);
  const scene = normalizeLightingScene({
    ambient: [0, 0, 0, 0],
    pointLights: [{ x: 0, y: 0, radius: 40 }],
    tileOccluders: [{ x: 180, y: 80, width: 16, height: 16 }],
    shadows: { enabled: true, color: [0, 0, 0, 0.5], projectionLength: 120, maxDistance: 32 },
  });

  const stats = pass.draw(scene, [240, 120]);

  equal(stats.shadowDrawCalls, 0);
  equal(stats.shadowCasterCount, 0);
  equal(gl.bufferSubDataCalls.length, 0);
  equal(gl.drawArraysCalls.length, 1);
});

test("WebGL2LightingPass grows shadow buffer only when written shadow geometry exceeds capacity", () => {
  const gl = new FakeWebGL2Context();
  const pass = new WebGL2LightingPass(gl as unknown as WebGL2RenderingContext);
  const smallScene = normalizeLightingScene({
    ambient: [0, 0, 0, 0],
    pointLights: [{ x: 80, y: 48, radius: 140 }],
    tileOccluders: [{ x: 24, y: 24, width: 16, height: 16 }],
    shadows: { enabled: true, color: [0, 0, 0, 0.5], projectionLength: 180 },
  });
  const largeScene = normalizeLightingScene({
    ambient: [0, 0, 0, 0],
    pointLights: [{ x: 80, y: 48, radius: 160 }],
    tileOccluders: [
      { x: 16, y: 16, width: 16, height: 16 },
      { x: 48, y: 16, width: 16, height: 16 },
      { x: 112, y: 16, width: 16, height: 16 },
      { x: 144, y: 16, width: 16, height: 16 },
    ],
    shadows: { enabled: true, color: [0, 0, 0, 0.5], projectionLength: 220 },
  });

  equal(gl.bufferDataCalls.length, 1);
  pass.draw(smallScene, [240, 120]);
  equal(gl.bufferDataCalls.length, 1);
  pass.draw(largeScene, [240, 120]);
  equal(gl.bufferDataCalls.length, 2);
  const grownCapacityFloats =
    gl.bufferDataCalls[gl.bufferDataCalls.length - 1]!.byteLength / Float32Array.BYTES_PER_ELEMENT;
  const uploadedFloats = gl.bufferSubDataCalls[gl.bufferSubDataCalls.length - 1]!.length;
  ok(uploadedFloats > 0);
  ok(uploadedFloats < grownCapacityFloats);

  pass.draw(smallScene, [240, 120]);
  equal(gl.bufferDataCalls.length, 2);
});
