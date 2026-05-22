import type { PhysicsDebugLineBufferView } from "./physicsDebugLineDecoder";

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

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.program = this.createProgram();
    const vao = this.gl.createVertexArray();
    const vbo = this.gl.createBuffer();
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
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);

    const resolutionLocation = this.gl.getUniformLocation(this.program, "u_resolution");
    if (!resolutionLocation) {
      throw new Error("Physics debug line shader uniform location 조회 실패");
    }
    this.resolutionLocation = resolutionLocation;
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

  private createProgram(): WebGLProgram {
    const vert = this.compile(this.gl.VERTEX_SHADER, `#version 300 es
      layout(location=0) in vec2 a_position;
      layout(location=1) in vec4 a_color;
      uniform vec2 u_resolution;
      out vec4 v_color;
      void main() {
        vec2 zeroToOne = a_position / u_resolution;
        vec2 clip = (zeroToOne * 2.0) - 1.0;
        gl_Position = vec4(clip * vec2(1.0, -1.0), 0.0, 1.0);
        v_color = a_color;
      }`);
    const frag = this.compile(this.gl.FRAGMENT_SHADER, `#version 300 es
      precision mediump float;
      in vec4 v_color;
      out vec4 outColor;
      void main() {
        outColor = v_color;
      }`);
    const program = this.gl.createProgram();
    if (!program) {
      throw new Error("Physics debug line shader program 생성 실패");
    }
    this.gl.attachShader(program, vert);
    this.gl.attachShader(program, frag);
    this.gl.linkProgram(program);
    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      throw new Error(this.gl.getProgramInfoLog(program) ?? "Physics debug line shader 링크 실패");
    }
    this.gl.deleteShader(vert);
    this.gl.deleteShader(frag);
    return program;
  }

  private compile(type: number, source: string): WebGLShader {
    const shader = this.gl.createShader(type);
    if (!shader) {
      throw new Error("Shader 생성 실패");
    }
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      throw new Error(this.gl.getShaderInfoLog(shader) ?? "Shader 컴파일 실패");
    }
    return shader;
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error("PhysicsDebugLineBatch has been destroyed.");
    }
  }
}
