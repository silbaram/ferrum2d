import { SpriteBatch, type SpriteTextureSource, type SpriteBatchStats } from "./spriteBatch.js";
import { WebGL2LightingPass, type WebGL2LightingPassStats } from "./webgl2LightingPass.js";
import { createWebGL2Program } from "./webgl2ShaderPrograms.js";
import type { RenderCommandBufferView } from "./renderCommandDecoder.js";
import type { ResolvedSpriteMaterialPreset } from "./spriteMaterial.js";
import type { ResolvedLightingScene2D } from "./lightingTypes.js";
import { createResolvedLightingScene } from "./lightingNormalize.js";
import { setSpriteBlend } from "./webgl2Blend.js";

export function requireWebGL2FlatLit(gl: WebGL2RenderingContext): void {
  if (!gl.getExtension("EXT_color_buffer_float") || gl.getParameter(gl.MAX_DRAW_BUFFERS) < 3) throw Error("The lit profile requires float color attachments and three draw buffers");
}

/** Optional receiver-only deferred composition. Destination alpha and unlit color are preserved. */
export class WebGL2FlatLitPass {
  private readonly colorBatch: SpriteBatch;
  private dataBatch?: SpriteBatch;
  private lights?: WebGL2LightingPass;
  private program?: WebGLProgram;
  private vao?: WebGLVertexArrayObject;
  private uniforms?: { albedo: WebGLUniformLocation; coverage: WebGLUniformLocation; light: WebGLUniformLocation; subtract: WebGLUniformLocation; srgb: WebGLUniformLocation; hdr: WebGLUniformLocation; surface:WebGLUniformLocation;emission:WebGLUniformLocation };
  private textures: WebGLTexture[] = [];
  private dataFramebuffer?: WebGLFramebuffer;
  private lightFramebuffer?: WebGLFramebuffer;
  private width = 0; private height = 0;
  private readonly effective = createResolvedLightingScene();
  private readonly zero = new Float32Array(4);
  private readonly neutral = new Float32Array([.5, .5, .5, 0]);
  private readonly full = new Float32Array([1, 0, 0, 0]);
  private readonly lightTarget = { width: 0, height: 0, restore: () => { this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.lightFramebuffer!); this.gl.viewport(0, 0, this.width, this.height); } };

  constructor(private readonly gl: WebGL2RenderingContext, private readonly linearWorking: boolean, private readonly hdr = false, private readonly surface=false) {
    this.colorBatch = new SpriteBatch(gl, linearWorking || hdr, false, false, false, "color", hdr, linearWorking);
  }
  prepareFrame(width: number, height: number, enabled: boolean): void {
    if (!enabled) { this.clearTargets(); return; }
    requireWebGL2FlatLit(this.gl);
    if(this.surface && this.gl.getParameter(this.gl.MAX_DRAW_BUFFERS)<4)throw Error("Surface materials require four draw buffers");
    this.dataBatch ??= new SpriteBatch(this.gl, this.linearWorking || this.hdr, false, false, false, "data", this.hdr, this.linearWorking,this.surface);
    this.lights ??= new WebGL2LightingPass(this.gl, true, true,this.surface,!this.linearWorking&&!this.hdr);
    if (!this.program) this.prepareComposite();
    this.resize(width, height);
  }
  drawColor(source: SpriteTextureSource, commands: RenderCommandBufferView, resolution: [number, number], material: ResolvedSpriteMaterialPreset,
    offset: readonly [number, number], snap: number, ground: number, skipShadows: boolean): SpriteBatchStats {
    const batch = this.colorBatch; batch.pixelSnap = snap; batch.groundYScale = ground; batch.skipGroundShadows = skipShadows;
    return batch.drawLitBatches(source, commands, resolution, material, offset);
  }
  drawLighting(source: SpriteTextureSource, commands: RenderCommandBufferView, scene: ResolvedLightingScene2D, resolution: [number, number],
    material: ResolvedSpriteMaterialPreset, offset: readonly [number, number], snap: number, ground: number, skipShadows: boolean,
    restore: () => void, sunMask?: WebGLTexture): { normalDrawCalls: number; normalSwitches: number; lighting: WebGL2LightingPassStats } {
    const gl = this.gl, batch = this.dataBatch!, mask = gl.getParameter(gl.COLOR_WRITEMASK) as boolean[];
    const capabilities = [gl.DEPTH_TEST, gl.CULL_FACE, gl.SCISSOR_TEST], enabled = capabilities.map(v => gl.isEnabled(v));
    try {
      gl.colorMask(true, true, true, true); capabilities.forEach(v => gl.disable(v));
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.dataFramebuffer!); gl.viewport(0, 0, this.width, this.height);
      gl.clearBufferfv(gl.COLOR, 0, this.neutral); gl.clearBufferfv(gl.COLOR, 1, this.full); gl.clearBufferfv(gl.COLOR, 2, this.zero);
      if(this.surface){gl.clearBufferfv(gl.COLOR,1,this.zero);gl.clearBufferfv(gl.COLOR,3,this.zero);}
      batch.pixelSnap = snap; batch.groundYScale = ground; batch.skipGroundShadows = skipShadows;
      const data = batch.drawLitBatches(source, commands, resolution, material, offset);
      this.lightTarget.restore(); gl.clearBufferfv(gl.COLOR, 0, this.zero);
      const effective = this.effective, ambient = effective.ambient as [number, number, number, number];
      ambient[0] = scene.ambientIrradiance![0]; ambient[1] = scene.ambientIrradiance![1]; ambient[2] = scene.ambientIrradiance![2]; ambient[3] = 1;
      effective.enabled = true; effective.pointLights = scene.pointLights; effective.tileOccluders = scene.tileOccluders;
      effective.directionalLight = scene.directionalLight; effective.shadows = scene.shadows;
      this.lightTarget.width = this.width; this.lightTarget.height = this.height;
      const lighting = this.lights!.draw(effective, resolution, { normal: this.textures[0]!, coverage: this.textures[1]!,...(this.surface?{albedo:this.textures[2]!}:{}) }, this.lightTarget, sunMask);
      restore(); gl.colorMask(true, true, true, false); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(this.program!); gl.bindVertexArray(this.vao!);
      const u = this.uniforms!;
      gl.uniform1i(u.albedo, 0); gl.uniform1i(u.coverage, 1); gl.uniform1i(u.light, 2); gl.uniform1i(u.srgb, this.linearWorking || this.hdr ? 0 : 1); gl.uniform1i(u.hdr, this.hdr ? 1 : 0);
      gl.uniform1i(u.surface,Number(this.surface));gl.uniform1i(u.emission,3);
      if(this.surface){gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,this.textures[4]!);}
      for (const [unit, texture] of [[0, this.textures[2]!], [1, this.textures[1]!], [2, this.textures[3]!]] as const) {
        gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture);
      }
      gl.blendEquation(gl.FUNC_REVERSE_SUBTRACT); gl.uniform1i(u.subtract, 1); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.blendEquation(gl.FUNC_ADD); gl.uniform1i(u.subtract, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
      return { normalDrawCalls: data.drawCalls, normalSwitches: data.textureSwitchCount, lighting: { ...lighting, drawCalls: lighting.drawCalls + 2 } };
    } finally {
      gl.colorMask(mask[0]!, mask[1]!, mask[2]!, mask[3]!); gl.blendEquation(gl.FUNC_ADD); setSpriteBlend(gl, this.linearWorking || this.hdr);
      capabilities.forEach((v, i) => enabled[i] ? gl.enable(v) : gl.disable(v)); gl.bindVertexArray(null); gl.activeTexture(gl.TEXTURE0); restore();
    }
  }
  clearTargets(): void {
    for (const texture of this.textures) this.gl.deleteTexture(texture);
    if (this.dataFramebuffer) this.gl.deleteFramebuffer(this.dataFramebuffer);
    if (this.lightFramebuffer) this.gl.deleteFramebuffer(this.lightFramebuffer);
    this.textures = []; this.dataFramebuffer = undefined; this.lightFramebuffer = undefined; this.width = this.height = 0;
    this.lights?.clearTargets();
  }
  destroy(): void {
    this.clearTargets(); this.colorBatch.destroy(); this.dataBatch?.destroy(); this.lights?.destroy();
    if (this.program) this.gl.deleteProgram(this.program); if (this.vao) this.gl.deleteVertexArray(this.vao);
    this.program = undefined; this.vao = undefined;
  }
  resourceStats() {
    const color = this.colorBatch.resourceStats(), data = this.dataBatch?.resourceStats(), light = this.lights?.resourceStats();
    return { bufferCount: color.bufferCount + (data?.bufferCount ?? 0) + (light?.bufferCount ?? 0),
      programCount: color.programCount + (data?.programCount ?? 0) + (light?.programCount ?? 0) + (this.program ? 1 : 0),
      bufferBytes: color.bufferBytes + (data?.bufferBytes ?? 0) + (light?.bufferBytes ?? 0),
      textureCount: this.textures.length + (light?.renderTargetCount ?? 0), renderTargetCount: this.textures.length + (light?.renderTargetCount ?? 0),
      textureBytes: this.width * this.height * ((this.hdr ? 24 : 20)+(this.surface?8:0)) + (light?.textureBytes ?? 0) };
  }
  private prepareComposite(): void {
    const gl = this.gl, program = createWebGL2Program(gl, "flatLitComposite"), vao = gl.createVertexArray();
    try {
      if (!vao) throw Error("Flat lit composite VAO allocation failed");
      const location = (name: string) => { const value = gl.getUniformLocation(program, name); if (!value) throw Error("Missing lit composite uniform " + name); return value; };
      this.uniforms = { albedo: location("u_albedo"), coverage: location("u_coverage"), light: location("u_irradiance"), subtract: location("u_subtract"), srgb: location("u_output_srgb"), hdr: location("u_hdr"),surface:location("u_surface"),emission:location("u_emission") };
      this.program = program; this.vao = vao;
    } catch (error) { gl.deleteProgram(program); if (vao) gl.deleteVertexArray(vao); throw error; }
  }
  private resize(width: number, height: number): void {
    if (this.width === width && this.height === height) return;
    const gl = this.gl, limit = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > limit || height > limit) throw Error("Invalid lit target dimensions");
    const framebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const texture = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
    const restoreTexture = texture && this.textures.includes(texture) ? null : texture;
    const restoreFramebuffer = framebuffer === this.dataFramebuffer || framebuffer === this.lightFramebuffer ? null : framebuffer;
    const textures: WebGLTexture[] = [], buffers: WebGLFramebuffer[] = [];
    try {
      for (let i = 0; i < (this.surface?5:4); i++) {
        const t = gl.createTexture(); if (!t) throw Error("Lit texture allocation failed"); textures.push(t); gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, i >= 3 || i === 2 && this.hdr ? gl.RGBA16F : i === 2 && this.linearWorking && !this.hdr ? gl.SRGB8_ALPHA8 : gl.RGBA8, width, height, 0, gl.RGBA, i >= 3 || i === 2 && this.hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
      }
      for (let i = 0; i < 2; i++) {
        const f = gl.createFramebuffer(); if (!f) throw Error("Lit framebuffer allocation failed"); buffers.push(f); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
        const selected = i === 0 ? (this.surface?[textures[0],textures[1],textures[2],textures[4]]:textures.slice(0, 3)) : [textures[3]!];
        selected.forEach((t, k) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + k, gl.TEXTURE_2D, t, 0));
        gl.drawBuffers(selected.map((_, k) => gl.COLOR_ATTACHMENT0 + k));
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw Error("Incomplete lit framebuffer");
      }
      this.clearTargets(); this.textures = textures; this.dataFramebuffer = buffers[0]; this.lightFramebuffer = buffers[1]; this.width = width; this.height = height;
    } catch (error) { textures.forEach(t => gl.deleteTexture(t)); buffers.forEach(f => gl.deleteFramebuffer(f)); throw error; }
    finally { gl.bindFramebuffer(gl.FRAMEBUFFER, restoreFramebuffer); gl.bindTexture(gl.TEXTURE_2D, restoreTexture); }
  }
}
