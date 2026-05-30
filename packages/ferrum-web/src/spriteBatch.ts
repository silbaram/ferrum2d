import type { TextureManager } from "./textureManager";
import type { RenderCommandBufferView } from "./wasmBridge";
import {
  DEFAULT_SPRITE_MATERIAL_PRESET,
  SPRITE_RENDER_COMMAND_FLOATS,
  spriteMaterialPasses,
  spriteMaterialPassRequiresCommandCopy,
  writeSpriteMaterialPassCommandsInto,
} from "./spriteMaterial";
import type {
  ResolvedSpriteMaterialPreset,
  SpriteMaterialBlendMode,
  SpriteMaterialPass,
} from "./spriteMaterial";

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

const FLOATS_PER_COMMAND = SPRITE_RENDER_COMMAND_FLOATS;
const BYTES_PER_F32 = Float32Array.BYTES_PER_ELEMENT;
const COMMAND_STRIDE_BYTES = FLOATS_PER_COMMAND * BYTES_PER_F32;
const DEFAULT_SPRITE_MATERIAL_PASSES = spriteMaterialPasses(DEFAULT_SPRITE_MATERIAL_PRESET);

export class SpriteBatch {
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly vbo: WebGLBuffer;
  private readonly resolutionLocation: WebGLUniformLocation;
  private readonly textureLocation: WebGLUniformLocation;
  private instanceCapacityFloats = 0;
  private materialStaging = new Float32Array(0);
  private cachedMaterial: ResolvedSpriteMaterialPreset = DEFAULT_SPRITE_MATERIAL_PRESET;
  private cachedMaterialPasses: readonly SpriteMaterialPass[] = DEFAULT_SPRITE_MATERIAL_PASSES;
  private readonly textureRangeScratch: Array<{ textureId: number; start: number; end: number }> = [];
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

  drawBatches(
    textureManager: TextureManager,
    commands: RenderCommandBufferView,
    resolution: [number, number],
    material?: ResolvedSpriteMaterialPreset,
  ): SpriteBatchStats;
  drawBatches(
    textureManager: TextureManager,
    commands: RenderCommandBufferView,
    resolution: [number, number],
    material: ResolvedSpriteMaterialPreset = DEFAULT_SPRITE_MATERIAL_PRESET,
  ): SpriteBatchStats {
    this.assertAlive();
    if (commands.commandCount === 0) return { drawCalls: 0, textureSwitchCount: 0 };
    const ranges = this.textureRanges(commands);
    const materialPasses = this.materialPassesFor(material);
    let drawCalls = 0;
    this.bindForDraw(resolution);
    try {
      for (const pass of materialPasses) {
        this.applyBlendMode(pass.blendMode);
        for (const range of ranges) {
          const texture = textureManager.texture(range.textureId);
          drawCalls += this.drawRange(texture, commands, range.start, range.end, pass);
        }
      }
    } finally {
      this.gl.bindVertexArray(null);
      this.applyBlendMode("alpha");
    }
    return { drawCalls, textureSwitchCount: ranges.length - 1 };
  }

  drawBatch(
    texture: WebGLTexture,
    commands: RenderCommandBufferView,
    resolution: [number, number],
    material?: ResolvedSpriteMaterialPreset,
  ): SpriteBatchStats;
  drawBatch(
    texture: WebGLTexture,
    commands: RenderCommandBufferView,
    resolution: [number, number],
    material: ResolvedSpriteMaterialPreset = DEFAULT_SPRITE_MATERIAL_PRESET,
  ): SpriteBatchStats {
    this.assertAlive();
    const materialPasses = this.materialPassesFor(material);
    let drawCalls = 0;
    this.bindForDraw(resolution);
    try {
      for (const pass of materialPasses) {
        this.applyBlendMode(pass.blendMode);
        drawCalls += this.drawRange(texture, commands, 0, commands.commandCount, pass);
      }
    } finally {
      this.gl.bindVertexArray(null);
      this.applyBlendMode("alpha");
    }
    return { drawCalls, textureSwitchCount: 0 };
  }

  private drawRange(
    texture: WebGLTexture,
    commands: RenderCommandBufferView,
    startCommand: number,
    endCommand: number,
    pass: SpriteMaterialPass,
  ): number {
    const commandCount = endCommand - startCommand;
    if (commandCount === 0) return 0;

    const commandFloatOffset = startCommand * commands.floatsPerCommand;
    const uploadFloatCount = commandCount * FLOATS_PER_COMMAND;
    if (this.instanceCapacityFloats < uploadFloatCount) {
      this.instanceCapacityFloats = this.nextPowerOfTwo(uploadFloatCount);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, this.instanceCapacityFloats * BYTES_PER_F32, this.gl.DYNAMIC_DRAW);
    }
    if (commands.floatsPerCommand !== FLOATS_PER_COMMAND || spriteMaterialPassRequiresCommandCopy(pass)) {
      this.ensureMaterialStaging(uploadFloatCount);
      const materialFloatCount = writeSpriteMaterialPassCommandsInto(
        commands,
        startCommand,
        endCommand,
        pass,
        this.materialStaging,
      );
      this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, this.materialStaging, 0, materialFloatCount);
    } else {
      this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, commands.buffer, commandFloatOffset, uploadFloatCount);
    }

    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.drawArraysInstanced(this.gl.TRIANGLES, 0, 6, commandCount);
    return 1;
  }

  private bindForDraw(resolution: [number, number]): void {
    this.gl.useProgram(this.program);
    this.gl.bindVertexArray(this.vao);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vbo);
    this.gl.uniform2f(this.resolutionLocation, resolution[0], resolution[1]);
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.uniform1i(this.textureLocation, 0);
  }

  private textureRanges(commands: RenderCommandBufferView): Array<{ textureId: number; start: number; end: number }> {
    const ranges = this.textureRangeScratch;
    let rangeCount = 0;
    let start = 0;
    let currentTextureId = this.textureIdAt(commands, 0);

    for (let index = 1; index < commands.commandCount; index += 1) {
      const nextTextureId = this.textureIdAt(commands, index);
      if (nextTextureId === currentTextureId) {
        continue;
      }
      this.writeTextureRange(rangeCount, currentTextureId, start, index);
      rangeCount += 1;
      start = index;
      currentTextureId = nextTextureId;
    }
    this.writeTextureRange(rangeCount, currentTextureId, start, commands.commandCount);
    rangeCount += 1;
    ranges.length = rangeCount;
    return ranges;
  }

  private writeTextureRange(index: number, textureId: number, start: number, end: number): void {
    const range = this.textureRangeScratch[index];
    if (range === undefined) {
      this.textureRangeScratch.push({ textureId, start, end });
      return;
    }
    range.textureId = textureId;
    range.start = start;
    range.end = end;
  }

  private textureIdAt(commands: RenderCommandBufferView, commandIndex: number): number {
    const offset = commandIndex * commands.floatsPerCommand;
    return Math.trunc(commands.buffer[offset + 12]);
  }

  private nextPowerOfTwo(value: number): number {
    return 2 ** Math.ceil(Math.log2(Math.max(value, 1)));
  }

  private ensureMaterialStaging(floatCount: number): void {
    if (this.materialStaging.length < floatCount) {
      this.materialStaging = new Float32Array(this.nextPowerOfTwo(floatCount));
    }
  }

  private materialPassesFor(material: ResolvedSpriteMaterialPreset): readonly SpriteMaterialPass[] {
    if (material !== this.cachedMaterial) {
      this.cachedMaterial = material;
      this.cachedMaterialPasses = spriteMaterialPasses(material);
    }
    return this.cachedMaterialPasses;
  }

  private applyBlendMode(blendMode: SpriteMaterialBlendMode): void {
    this.gl.enable(this.gl.BLEND);
    if (blendMode === "additive") {
      this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE);
      return;
    }
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
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
    this.materialStaging = new Float32Array(0);
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
