import { createWebGL2Program } from "./webgl2ShaderPrograms";
import type { RenderCommandBufferView } from "./wasmBridge";
import { setSpriteBlend } from "./webgl2Blend";
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

export interface SpriteTextureSource {
  texture(textureId: number): WebGLTexture;
  /** Framebuffer textures need bottom-left storage mapped to top-left sprite UVs. */
  textureFlipY?(textureId: number): boolean;
}

const FLOATS_PER_COMMAND = SPRITE_RENDER_COMMAND_FLOATS;
const BYTES_PER_F32 = Float32Array.BYTES_PER_ELEMENT;
const COMMAND_STRIDE_BYTES = FLOATS_PER_COMMAND * BYTES_PER_F32;
const QUAD_CORNER_STRIDE_BYTES = 2 * BYTES_PER_F32;
const QUAD_VERTEX_DATA = new Float32Array([
  0, 0,
  1, 0,
  0, 1,
  1, 1,
]);
const QUAD_INDEX_DATA = new Uint16Array([
  0, 1, 2,
  2, 1, 3,
]);
const QUAD_INDEX_COUNT = QUAD_INDEX_DATA.length;
const DEFAULT_SPRITE_MATERIAL_PASSES = spriteMaterialPasses(DEFAULT_SPRITE_MATERIAL_PRESET);
const ZERO_SCREEN_OFFSET: readonly [number, number] = [0, 0];

export class SpriteBatch {
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly quadVbo: WebGLBuffer;
  private readonly instanceVbo: WebGLBuffer;
  private readonly indexBuffer: WebGLBuffer;
  private readonly resolutionLocation: WebGLUniformLocation;
  private readonly screenOffsetLocation: WebGLUniformLocation;
  private readonly textureLocation: WebGLUniformLocation;
  groundYScale = 1;
  private readonly groundYScaleLocation: WebGLUniformLocation;
  private readonly textureFlipYLocation: WebGLUniformLocation;
  private instanceCapacityFloats = 0;
  private materialStaging = new Float32Array(0);
  private cachedMaterial: ResolvedSpriteMaterialPreset = DEFAULT_SPRITE_MATERIAL_PRESET;
  private cachedMaterialPasses: readonly SpriteMaterialPass[] = DEFAULT_SPRITE_MATERIAL_PASSES;
  private readonly textureRangeScratch: Array<{ textureId: number; start: number; end: number }> = [];
  private destroyed = false;

  constructor(private readonly gl: WebGL2RenderingContext, private readonly linearTarget = false) {
    const programs: WebGLProgram[] = [];
    const vaos: WebGLVertexArrayObject[] = [];
    const buffers: WebGLBuffer[] = [];
    try {
      this.program = createWebGL2Program(this.gl, "sprite");
      programs.push(this.program);
      const vao = this.gl.createVertexArray();
      if (vao) vaos.push(vao);
      const quadVbo = this.gl.createBuffer();
      if (quadVbo) buffers.push(quadVbo);
      const instanceVbo = this.gl.createBuffer();
      if (instanceVbo) buffers.push(instanceVbo);
      const indexBuffer = this.gl.createBuffer();
      if (indexBuffer) buffers.push(indexBuffer);
      if (!vao || !quadVbo || !instanceVbo || !indexBuffer) throw new Error("SpriteBatch 버퍼 생성 실패");
      this.vao = vao;
      this.quadVbo = quadVbo;
      this.instanceVbo = instanceVbo;
      this.indexBuffer = indexBuffer;

      this.gl.bindVertexArray(this.vao);
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadVbo);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, QUAD_VERTEX_DATA, this.gl.STATIC_DRAW);
      this.gl.enableVertexAttribArray(0);
      this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, QUAD_CORNER_STRIDE_BYTES, 0);

      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceVbo);
      this.gl.enableVertexAttribArray(1);
      this.gl.vertexAttribPointer(1, 4, this.gl.FLOAT, false, COMMAND_STRIDE_BYTES, 0);
      this.gl.vertexAttribDivisor(1, 1);
      this.gl.enableVertexAttribArray(2);
      this.gl.vertexAttribPointer(2, 4, this.gl.FLOAT, false, COMMAND_STRIDE_BYTES, 4 * BYTES_PER_F32);
      this.gl.vertexAttribDivisor(2, 1);
      this.gl.enableVertexAttribArray(3);
      this.gl.vertexAttribPointer(3, 4, this.gl.FLOAT, false, COMMAND_STRIDE_BYTES, 8 * BYTES_PER_F32);
      this.gl.vertexAttribDivisor(3, 1);
      this.gl.enableVertexAttribArray(4);
      this.gl.vertexAttribPointer(4, 1, this.gl.FLOAT, false, COMMAND_STRIDE_BYTES, 14 * BYTES_PER_F32);
      this.gl.vertexAttribDivisor(4, 1);
      this.gl.enableVertexAttribArray(5);
      this.gl.vertexAttribPointer(5, 1, this.gl.FLOAT, false, COMMAND_STRIDE_BYTES, 13 * BYTES_PER_F32);
      this.gl.vertexAttribDivisor(5, 1);

      this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
      this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, QUAD_INDEX_DATA, this.gl.STATIC_DRAW);
      this.gl.bindVertexArray(null);

      this.gl.enable(this.gl.BLEND);
      setSpriteBlend(this.gl, this.linearTarget);

      const resolutionLocation = this.gl.getUniformLocation(this.program, "u_resolution");
      const screenOffsetLocation = this.gl.getUniformLocation(this.program, "u_screen_offset");
      const textureLocation = this.gl.getUniformLocation(this.program, "u_texture");
      const textureFlipYLocation = this.gl.getUniformLocation(this.program, "u_texture_flip_y");
      if (!resolutionLocation || !screenOffsetLocation || !textureLocation || !textureFlipYLocation) throw new Error("Sprite shader uniform location 조회 실패");
      const groundYScaleLocation = this.gl.getUniformLocation(this.program, "u_ground_y_scale");
      if (!groundYScaleLocation) throw new Error("Missing ground projection uniform");
      this.groundYScaleLocation = groundYScaleLocation;
      this.resolutionLocation = resolutionLocation;
      this.screenOffsetLocation = screenOffsetLocation;
      this.textureLocation = textureLocation;
      this.textureFlipYLocation = textureFlipYLocation;
    } catch (error) {
      for (const buffer of buffers) gl.deleteBuffer(buffer);
      for (const vao of vaos) gl.deleteVertexArray(vao);
      for (const program of programs) gl.deleteProgram(program);
      throw error;
    }
  }

  drawBatches(
    textureManager: SpriteTextureSource,
    commands: RenderCommandBufferView,
    resolution: [number, number],
    material?: ResolvedSpriteMaterialPreset,
    screenOffset?: readonly [number, number],
  ): SpriteBatchStats;
  drawBatches(
    textureManager: SpriteTextureSource,
    commands: RenderCommandBufferView,
    resolution: [number, number],
    material: ResolvedSpriteMaterialPreset = DEFAULT_SPRITE_MATERIAL_PRESET,
    screenOffset: readonly [number, number] = ZERO_SCREEN_OFFSET,
  ): SpriteBatchStats {
    this.assertAlive();
    if (commands.commandCount === 0) return { drawCalls: 0, textureSwitchCount: 0 };
    const ranges = this.textureRanges(commands);
    const materialPasses = this.materialPassesFor(material);
    let drawCalls = 0;
    this.bindForDraw(resolution, screenOffset);
    try {
      for (const pass of materialPasses) {
        this.applyBlendMode(pass.blendMode);
        for (const range of ranges) {
          const texture = textureManager.texture(range.textureId);
          drawCalls += this.drawRange(texture, commands, range.start, range.end, pass,
            textureManager.textureFlipY?.(range.textureId) ?? false);
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
    screenOffset?: readonly [number, number],
  ): SpriteBatchStats;
  drawBatch(
    texture: WebGLTexture,
    commands: RenderCommandBufferView,
    resolution: [number, number],
    material: ResolvedSpriteMaterialPreset = DEFAULT_SPRITE_MATERIAL_PRESET,
    screenOffset: readonly [number, number] = ZERO_SCREEN_OFFSET,
  ): SpriteBatchStats {
    this.assertAlive();
    const materialPasses = this.materialPassesFor(material);
    let drawCalls = 0;
    this.bindForDraw(resolution, screenOffset);
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
    textureFlipY = false,
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
    this.gl.uniform1i(this.textureFlipYLocation, textureFlipY ? 1 : 0);
    this.gl.drawElementsInstanced(this.gl.TRIANGLES, QUAD_INDEX_COUNT, this.gl.UNSIGNED_SHORT, 0, commandCount);
    return 1;
  }

  private bindForDraw(resolution: [number, number], screenOffset: readonly [number, number]): void {
    this.gl.useProgram(this.program);
    this.gl.bindVertexArray(this.vao);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceVbo);
    this.gl.uniform1f(this.groundYScaleLocation, this.groundYScale);
    this.gl.uniform2f(this.resolutionLocation, resolution[0], resolution[1]);
    this.gl.uniform2f(this.screenOffsetLocation, screenOffset[0], screenOffset[1]);
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
    setSpriteBlend(this.gl, this.linearTarget, blendMode === "additive");
  }

  /** Internal allocation summary; no GPU queries or per-command work. */
  resourceStats(): { bufferCount: number; programCount: number; bufferBytes: number } {
    return {
      bufferCount: this.destroyed ? 0 : 3,
      programCount: this.destroyed ? 0 : 1,
      bufferBytes: this.destroyed ? 0 : QUAD_VERTEX_DATA.byteLength + QUAD_INDEX_DATA.byteLength + this.instanceCapacityFloats * BYTES_PER_F32,
    };
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.gl.deleteBuffer(this.quadVbo);
    this.gl.deleteBuffer(this.instanceVbo);
    this.gl.deleteBuffer(this.indexBuffer);
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

}
