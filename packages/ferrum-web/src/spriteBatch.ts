import type { TextureManager } from "./textureManager";
import type { RenderCommandBufferView } from "./wasmBridge";

export interface SpriteDrawOptions {
  position: [number, number];
  size: [number, number];
  uv: [number, number, number, number];
  color: [number, number, number, number];
}

export interface SpriteBatchStats {
  drawCalls: number;
  textureSwitchCount: number;
}

const FLOATS_PER_COMMAND = 13;
const BYTES_PER_F32 = Float32Array.BYTES_PER_ELEMENT;
const COMMAND_STRIDE_BYTES = FLOATS_PER_COMMAND * BYTES_PER_F32;

export class SpriteBatch {
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly vbo: WebGLBuffer;
  private readonly resolutionLocation: WebGLUniformLocation;
  private readonly textureLocation: WebGLUniformLocation;
  private instanceCapacityFloats = 0;
  private destroyed = false;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.program = this.createProgram();
    const vao = this.gl.createVertexArray();
    const vbo = this.gl.createBuffer();
    if (!vao || !vbo) throw new Error("SpriteBatch 버퍼 생성 실패");
    this.vao = vao;
    this.vbo = vbo;

    this.gl.bindVertexArray(this.vao);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vbo);
    this.gl.enableVertexAttribArray(0);
    this.gl.vertexAttribPointer(0, 4, this.gl.FLOAT, false, COMMAND_STRIDE_BYTES, 0);
    this.gl.vertexAttribDivisor(0, 1);
    this.gl.enableVertexAttribArray(1);
    this.gl.vertexAttribPointer(1, 4, this.gl.FLOAT, false, COMMAND_STRIDE_BYTES, 4 * BYTES_PER_F32);
    this.gl.vertexAttribDivisor(1, 1);
    this.gl.enableVertexAttribArray(2);
    this.gl.vertexAttribPointer(2, 4, this.gl.FLOAT, false, COMMAND_STRIDE_BYTES, 8 * BYTES_PER_F32);
    this.gl.vertexAttribDivisor(2, 1);
    this.gl.bindVertexArray(null);

    this.gl.enable(this.gl.BLEND);
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);

    const resolutionLocation = this.gl.getUniformLocation(this.program, "u_resolution");
    const textureLocation = this.gl.getUniformLocation(this.program, "u_texture");
    if (!resolutionLocation || !textureLocation) throw new Error("Sprite shader uniform location 조회 실패");
    this.resolutionLocation = resolutionLocation;
    this.textureLocation = textureLocation;
  }

  drawBatches(textureManager: TextureManager, commands: RenderCommandBufferView, resolution: [number, number]): SpriteBatchStats {
    this.assertAlive();
    if (commands.commandCount === 0) return { drawCalls: 0, textureSwitchCount: 0 };
    let drawCalls = 0;
    let textureSwitchCount = 0;
    let batchStart = 0;
    let currentTextureId = this.textureIdAt(commands, 0);

    for (let i = 1; i < commands.commandCount; i += 1) {
      const nextTextureId = this.textureIdAt(commands, i);
      if (nextTextureId === currentTextureId) {
        continue;
      }

      const texture = textureManager.texture(currentTextureId);
      drawCalls += this.drawRange(texture, commands, resolution, batchStart, i);
      textureSwitchCount += 1;
      batchStart = i;
      currentTextureId = nextTextureId;
    }

    const texture = textureManager.texture(currentTextureId);
    drawCalls += this.drawRange(texture, commands, resolution, batchStart, commands.commandCount);
    return { drawCalls, textureSwitchCount };
  }

  drawBatch(texture: WebGLTexture, commands: RenderCommandBufferView, resolution: [number, number]): SpriteBatchStats {
    this.assertAlive();
    return {
      drawCalls: this.drawRange(texture, commands, resolution, 0, commands.commandCount),
      textureSwitchCount: 0,
    };
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

    const commandFloatOffset = startCommand * commands.floatsPerCommand;
    const floatCount = commandCount * commands.floatsPerCommand;
    this.gl.useProgram(this.program);
    this.gl.bindVertexArray(this.vao);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vbo);
    if (this.instanceCapacityFloats < floatCount) {
      this.instanceCapacityFloats = this.nextPowerOfTwo(floatCount);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, this.instanceCapacityFloats * BYTES_PER_F32, this.gl.DYNAMIC_DRAW);
    }
    this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, commands.buffer, commandFloatOffset, floatCount);

    this.gl.uniform2f(this.resolutionLocation, resolution[0], resolution[1]);
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.uniform1i(this.textureLocation, 0);
    this.gl.drawArraysInstanced(this.gl.TRIANGLES, 0, 6, commandCount);
    this.gl.bindVertexArray(null);
    return 1;
  }

  private textureIdAt(commands: RenderCommandBufferView, commandIndex: number): number {
    const offset = commandIndex * commands.floatsPerCommand;
    return Math.trunc(commands.buffer[offset + 12]);
  }

  private nextPowerOfTwo(value: number): number {
    return 2 ** Math.ceil(Math.log2(Math.max(value, 1)));
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.gl.deleteBuffer(this.vbo);
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteProgram(this.program);
    this.instanceCapacityFloats = 0;
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error("SpriteBatch has been destroyed.");
    }
  }

  private createProgram(): WebGLProgram { /* unchanged */
    const vert = this.compile(this.gl.VERTEX_SHADER, `#version 300 es
      layout(location=0) in vec4 a_rect;layout(location=1) in vec4 a_uv_rect;layout(location=2) in vec4 a_color;
      uniform vec2 u_resolution;out vec2 v_uv;out vec4 v_color;
      vec2 cornerForVertex(int v){if(v==0)return vec2(0.0,0.0);if(v==1)return vec2(1.0,0.0);if(v==2)return vec2(0.0,1.0);if(v==3)return vec2(0.0,1.0);if(v==4)return vec2(1.0,0.0);return vec2(1.0,1.0);}
      void main(){vec2 corner=cornerForVertex(gl_VertexID%6);vec2 position=a_rect.xy+(corner*a_rect.zw);vec2 z=position/u_resolution;vec2 c=(z*2.0)-1.0;gl_Position=vec4(c*vec2(1.0,-1.0),0.0,1.0);v_uv=mix(a_uv_rect.xy,a_uv_rect.zw,corner);v_color=a_color;}`);
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
