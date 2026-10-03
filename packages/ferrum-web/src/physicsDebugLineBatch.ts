import { createWebGL2Program } from "./webgl2ShaderPrograms";
import type { PhysicsDebugLineBufferView } from "./physicsDebugLineDecoder";
import { setSpriteBlend } from "./webgl2Blend";

export interface PhysicsDebugLineCamera {
  x: number;
  y: number;
}

const FLOATS_PER_VERTEX = 6;
const BYTES_PER_F32 = Float32Array.BYTES_PER_ELEMENT;
const VERTEX_STRIDE_BYTES = FLOATS_PER_VERTEX * BYTES_PER_F32;

export class PhysicsDebugLineBatch {
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly vbo: WebGLBuffer;
  private readonly resolutionLocation: WebGLUniformLocation;
  private staging = new Float32Array(0);
  private vertexCapacityFloats = 0;
  private destroyed = false;

  constructor(private readonly gl: WebGL2RenderingContext, private readonly linearTarget = false) {
    const programs: WebGLProgram[] = [];
    const vaos: WebGLVertexArrayObject[] = [];
    const buffers: WebGLBuffer[] = [];
    try {
      this.program = createWebGL2Program(this.gl, "debug");
      programs.push(this.program);
      const vao = this.gl.createVertexArray();
      if (vao) vaos.push(vao);
      const vbo = this.gl.createBuffer();
      if (vbo) buffers.push(vbo);
      if (!vao || !vbo) {
        throw new Error("PhysicsDebugLineBatch 버퍼 생성 실패");
      }
      this.vao = vao;
      this.vbo = vbo;

      this.gl.bindVertexArray(this.vao);
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vbo);
      this.gl.enableVertexAttribArray(0);
      this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, VERTEX_STRIDE_BYTES, 0);
      this.gl.enableVertexAttribArray(1);
      this.gl.vertexAttribPointer(1, 4, this.gl.FLOAT, false, VERTEX_STRIDE_BYTES, 2 * BYTES_PER_F32);
      this.gl.bindVertexArray(null);

      this.gl.enable(this.gl.BLEND);
      setSpriteBlend(this.gl, this.linearTarget);

      const resolutionLocation = this.gl.getUniformLocation(this.program, "u_resolution");
      if (!resolutionLocation) {
        throw new Error("Physics debug line shader uniform location 조회 실패");
      }
      this.resolutionLocation = resolutionLocation;
    } catch (error) {
      for (const buffer of buffers) gl.deleteBuffer(buffer);
      for (const vao of vaos) gl.deleteVertexArray(vao);
      for (const program of programs) gl.deleteProgram(program);
      throw error;
    }
  }

  draw(
    lines: PhysicsDebugLineBufferView,
    resolution: [number, number],
    camera: PhysicsDebugLineCamera,
  ): number {
    this.assertAlive();
    if (lines.lineCount === 0) {
      return 0;
    }

    const vertexCount = lines.lineCount * 2;
    const floatCount = vertexCount * FLOATS_PER_VERTEX;
    this.ensureStaging(floatCount);
    this.writeStaging(lines, resolution, camera);

    this.gl.useProgram(this.program);
    this.gl.bindVertexArray(this.vao);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vbo);
    if (this.vertexCapacityFloats < floatCount) {
      this.vertexCapacityFloats = this.nextPowerOfTwo(floatCount);
      this.gl.bufferData(
        this.gl.ARRAY_BUFFER,
        this.vertexCapacityFloats * BYTES_PER_F32,
        this.gl.DYNAMIC_DRAW,
      );
    }
    this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, this.staging, 0, floatCount);
    this.gl.uniform2f(this.resolutionLocation, resolution[0], resolution[1]);
    this.gl.drawArrays(this.gl.LINES, 0, vertexCount);
    this.gl.bindVertexArray(null);
    return 1;
  }

  /** Internal allocation summary; no GPU queries or per-command work. */
  resourceStats(): { bufferCount: number; programCount: number; bufferBytes: number } {
    return {
      bufferCount: this.destroyed ? 0 : 1,
      programCount: this.destroyed ? 0 : 1,
      bufferBytes: this.destroyed ? 0 : this.vertexCapacityFloats * BYTES_PER_F32,
    };
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.gl.deleteBuffer(this.vbo);
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteProgram(this.program);
    this.staging = new Float32Array(0);
    this.vertexCapacityFloats = 0;
  }

  private writeStaging(
    lines: PhysicsDebugLineBufferView,
    resolution: [number, number],
    camera: PhysicsDebugLineCamera,
  ): void {
    const originX = resolution[0] * 0.5 - camera.x;
    const originY = resolution[1] * 0.5 - camera.y;
    let vertexOffset = 0;
    for (let lineIndex = 0; lineIndex < lines.lineCount; lineIndex += 1) {
      const lineOffset = lineIndex * lines.floatsPerLine;
      const x0 = lines.buffer[lineOffset] + originX;
      const y0 = lines.buffer[lineOffset + 1] + originY;
      const x1 = lines.buffer[lineOffset + 2] + originX;
      const y1 = lines.buffer[lineOffset + 3] + originY;
      const r = lines.buffer[lineOffset + 4];
      const g = lines.buffer[lineOffset + 5];
      const b = lines.buffer[lineOffset + 6];
      const a = lines.buffer[lineOffset + 7];
      vertexOffset = this.writeVertex(vertexOffset, x0, y0, r, g, b, a);
      vertexOffset = this.writeVertex(vertexOffset, x1, y1, r, g, b, a);
    }
  }

  private writeVertex(
    offset: number,
    x: number,
    y: number,
    r: number,
    g: number,
    b: number,
    a: number,
  ): number {
    this.staging[offset] = x;
    this.staging[offset + 1] = y;
    this.staging[offset + 2] = r;
    this.staging[offset + 3] = g;
    this.staging[offset + 4] = b;
    this.staging[offset + 5] = a;
    return offset + FLOATS_PER_VERTEX;
  }

  private ensureStaging(floatCount: number): void {
    if (this.staging.length >= floatCount) {
      return;
    }
    this.staging = new Float32Array(this.nextPowerOfTwo(floatCount));
  }

  private nextPowerOfTwo(value: number): number {
    return 2 ** Math.ceil(Math.log2(Math.max(value, 1)));
  }


  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error("PhysicsDebugLineBatch has been destroyed.");
    }
  }
}
