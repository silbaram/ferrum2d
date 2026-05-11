import type { TextureManager } from "./textureManager";
import type { RenderCommandBufferView } from "./wasmBridge";

export interface SpriteDrawOptions {
  position: [number, number];
  size: [number, number];
  uv: [number, number, number, number];
  color: [number, number, number, number];
}

export class SpriteBatch {
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly vbo: WebGLBuffer;
  private readonly resolutionLocation: WebGLUniformLocation;
  private readonly textureLocation: WebGLUniformLocation;
  private vertexData = new Float32Array(0);
  private vertexCapacityFloats = 0;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.program = this.createProgram();
    const vao = this.gl.createVertexArray();
    const vbo = this.gl.createBuffer();
    if (!vao || !vbo) throw new Error("SpriteBatch 버퍼 생성 실패");
    this.vao = vao;
    this.vbo = vbo;

    this.gl.bindVertexArray(this.vao);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vbo);
    const stride = 8 * 4;
    this.gl.enableVertexAttribArray(0);
    this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, stride, 0);
    this.gl.enableVertexAttribArray(1);
    this.gl.vertexAttribPointer(1, 2, this.gl.FLOAT, false, stride, 2 * 4);
    this.gl.enableVertexAttribArray(2);
    this.gl.vertexAttribPointer(2, 4, this.gl.FLOAT, false, stride, 4 * 4);
    this.gl.bindVertexArray(null);

    this.gl.enable(this.gl.BLEND);
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);

    const resolutionLocation = this.gl.getUniformLocation(this.program, "u_resolution");
    const textureLocation = this.gl.getUniformLocation(this.program, "u_texture");
    if (!resolutionLocation || !textureLocation) throw new Error("Sprite shader uniform location 조회 실패");
    this.resolutionLocation = resolutionLocation;
    this.textureLocation = textureLocation;
  }

  drawBatches(textureManager: TextureManager, commands: RenderCommandBufferView, resolution: [number, number]): number {
    if (commands.commandCount === 0) return 0;
    let drawCalls = 0;
    let batchStart = 0;
    let currentTextureId = this.textureIdAt(commands, 0);

    for (let i = 1; i <= commands.commandCount; i += 1) {
      const nextTextureId = i < commands.commandCount ? this.textureIdAt(commands, i) : currentTextureId;
      if (i < commands.commandCount && nextTextureId === currentTextureId) {
        continue;
      }

      const texture = textureManager.texture(currentTextureId);
      drawCalls += this.drawRange(texture, commands, resolution, batchStart, i);
      batchStart = i;
      currentTextureId = nextTextureId;
    }

    return drawCalls;
  }

  drawBatch(texture: WebGLTexture, commands: RenderCommandBufferView, resolution: [number, number]): number {
    return this.drawRange(texture, commands, resolution, 0, commands.commandCount);
  }

  private drawRange(
    texture: WebGLTexture,
    commands: RenderCommandBufferView,
    resolution: [number, number],
    startCommand: number,
    endCommand: number,
  ): number {
    const commandCount = endCommand - startCommand;
    if (commandCount === 0) return 0;

    const floatCount = commandCount * 6 * 8;
    const vertices = this.ensureVertexCapacity(floatCount);

    for (let i = startCommand; i < endCommand; i += 1) {
      const offset = i * commands.floatsPerCommand;
      const x = commands.buffer[offset];
      const y = commands.buffer[offset + 1];
      const w = commands.buffer[offset + 2];
      const h = commands.buffer[offset + 3];
      const u0 = commands.buffer[offset + 4];
      const v0 = commands.buffer[offset + 5];
      const u1 = commands.buffer[offset + 6];
      const v1 = commands.buffer[offset + 7];
      const r = commands.buffer[offset + 8];
      const g = commands.buffer[offset + 9];
      const b = commands.buffer[offset + 10];
      const a = commands.buffer[offset + 11];
      const batchIndex = i - startCommand;
      const base = batchIndex * 48;

      vertices[base] = x;
      vertices[base + 1] = y;
      vertices[base + 2] = u0;
      vertices[base + 3] = v0;
      vertices[base + 4] = r;
      vertices[base + 5] = g;
      vertices[base + 6] = b;
      vertices[base + 7] = a;
      vertices[base + 8] = x + w;
      vertices[base + 9] = y;
      vertices[base + 10] = u1;
      vertices[base + 11] = v0;
      vertices[base + 12] = r;
      vertices[base + 13] = g;
      vertices[base + 14] = b;
      vertices[base + 15] = a;
      vertices[base + 16] = x;
      vertices[base + 17] = y + h;
      vertices[base + 18] = u0;
      vertices[base + 19] = v1;
      vertices[base + 20] = r;
      vertices[base + 21] = g;
      vertices[base + 22] = b;
      vertices[base + 23] = a;
      vertices[base + 24] = x;
      vertices[base + 25] = y + h;
      vertices[base + 26] = u0;
      vertices[base + 27] = v1;
      vertices[base + 28] = r;
      vertices[base + 29] = g;
      vertices[base + 30] = b;
      vertices[base + 31] = a;
      vertices[base + 32] = x + w;
      vertices[base + 33] = y;
      vertices[base + 34] = u1;
      vertices[base + 35] = v0;
      vertices[base + 36] = r;
      vertices[base + 37] = g;
      vertices[base + 38] = b;
      vertices[base + 39] = a;
      vertices[base + 40] = x + w;
      vertices[base + 41] = y + h;
      vertices[base + 42] = u1;
      vertices[base + 43] = v1;
      vertices[base + 44] = r;
      vertices[base + 45] = g;
      vertices[base + 46] = b;
      vertices[base + 47] = a;
    }

    this.gl.useProgram(this.program);
    this.gl.bindVertexArray(this.vao);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vbo);
    if (this.vertexCapacityFloats < floatCount) {
      this.vertexCapacityFloats = this.nextPowerOfTwo(floatCount);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, this.vertexCapacityFloats * Float32Array.BYTES_PER_ELEMENT, this.gl.DYNAMIC_DRAW);
    }
    this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, vertices, 0, floatCount);

    this.gl.uniform2f(this.resolutionLocation, resolution[0], resolution[1]);
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.uniform1i(this.textureLocation, 0);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, commandCount * 6);
    this.gl.bindVertexArray(null);
    return 1;
  }

  private textureIdAt(commands: RenderCommandBufferView, commandIndex: number): number {
    const offset = commandIndex * commands.floatsPerCommand;
    return Math.trunc(commands.buffer[offset + 12]);
  }

  private ensureVertexCapacity(floatCount: number): Float32Array {
    if (this.vertexData.length < floatCount) {
      this.vertexData = new Float32Array(this.nextPowerOfTwo(floatCount));
    }
    return this.vertexData;
  }

  private nextPowerOfTwo(value: number): number {
    return 2 ** Math.ceil(Math.log2(Math.max(value, 1)));
  }

  destroy(): void { this.gl.deleteBuffer(this.vbo); this.gl.deleteVertexArray(this.vao); this.gl.deleteProgram(this.program); }

  private createProgram(): WebGLProgram { /* unchanged */
    const vert = this.compile(this.gl.VERTEX_SHADER, `#version 300 es
      layout(location=0) in vec2 a_position;layout(location=1) in vec2 a_uv;layout(location=2) in vec4 a_color;
      uniform vec2 u_resolution;out vec2 v_uv;out vec4 v_color;
      void main(){vec2 z=a_position/u_resolution;vec2 c=(z*2.0)-1.0;gl_Position=vec4(c*vec2(1.0,-1.0),0.0,1.0);v_uv=a_uv;v_color=a_color;}`);
    const frag = this.compile(this.gl.FRAGMENT_SHADER, `#version 300 es
      precision mediump float;in vec2 v_uv;in vec4 v_color;uniform sampler2D u_texture;out vec4 outColor;
      void main(){outColor=texture(u_texture,v_uv)*v_color;}`);
    const p = this.gl.createProgram(); if (!p) throw new Error("Sprite shader program 생성 실패");
    this.gl.attachShader(p, vert); this.gl.attachShader(p, frag); this.gl.linkProgram(p);
    if (!this.gl.getProgramParameter(p, this.gl.LINK_STATUS)) throw new Error(this.gl.getProgramInfoLog(p) ?? "Sprite shader 링크 실패");
    this.gl.deleteShader(vert); this.gl.deleteShader(frag); return p;
  }
  private compile(type:number,source:string):WebGLShader{const s=this.gl.createShader(type);if(!s) throw new Error("Shader 생성 실패");this.gl.shaderSource(s,source);this.gl.compileShader(s);if(!this.gl.getShaderParameter(s,this.gl.COMPILE_STATUS)) throw new Error(this.gl.getShaderInfoLog(s)??"Shader 컴파일 실패");return s;}
}
