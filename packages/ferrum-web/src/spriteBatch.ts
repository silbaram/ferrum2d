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

    const vertices = new Float32Array(commandCount * 6 * 8);

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

      const quad = [
        x, y, u0, v0, r, g, b, a,
        x + w, y, u1, v0, r, g, b, a,
        x, y + h, u0, v1, r, g, b, a,
        x, y + h, u0, v1, r, g, b, a,
        x + w, y, u1, v0, r, g, b, a,
        x + w, y + h, u1, v1, r, g, b, a,
      ];
      vertices.set(quad, base);
    }

    this.gl.useProgram(this.program);
    this.gl.bindVertexArray(this.vao);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vbo);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.DYNAMIC_DRAW);

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
