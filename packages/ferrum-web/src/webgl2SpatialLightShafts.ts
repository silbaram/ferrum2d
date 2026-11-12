import { createSpatialProgram, spatialCompositeVertexSource, spatialUniform } from "./webgl2SpatialShaders.js";
import { LIGHT_SHAFT_GLSL, writeLightShaftUniforms, type SpatialLightShaftPlan } from "./spatialLightShaftKernel.js";
import type { SpatialRenderBufferView } from "./dataSceneSpatial.js";

export class WebGL2SpatialLightShafts {
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly uniforms: Record<string, WebGLUniformLocation> = {};
  private readonly values = new Float32Array(52);
  private texture?: WebGLTexture;
  private target?: WebGLFramebuffer;
  private width = 0;
  private height = 0;
  constructor(private readonly gl: WebGL2RenderingContext) {
    this.program = createSpatialProgram(gl, spatialCompositeVertexSource, LIGHT_SHAFT_GLSL);
    const vao = gl.createVertexArray();
    if (!vao) { gl.deleteProgram(this.program); throw Error("Light shafts VAO allocation failed"); }
    this.vao = vao;
    try {
      for (const name of ["depth", "shadow", "p[0]"]) this.uniforms[name] = spatialUniform(gl, this.program, `u_${name}`);
    } catch (error) { this.destroy(); throw error; }
  }
  prepare(plan?: SpatialLightShaftPlan): void {
    if (!plan) { this.clearTarget(); return; }
    if (this.texture && this.width === plan.width && this.height === plan.height) return;
    const gl = this.gl, texture = gl.createTexture(), target = gl.createFramebuffer();
    try {
      if (!texture || !target) throw Error("Light shafts target allocation failed");
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
      for (const key of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, key, gl.NEAREST);
      for (const key of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, key, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, plan.width, plan.height, 0, gl.RGBA, gl.HALF_FLOAT, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw Error("Light shafts target incomplete");
    } catch (error) { if (texture) gl.deleteTexture(texture); if (target) gl.deleteFramebuffer(target); throw error; }
    this.clearTarget(); this.texture = texture; this.target = target; this.width = plan.width; this.height = plan.height;
  }
  draw(frame: SpatialRenderBufferView, plan: SpatialLightShaftPlan, depth: WebGLTexture, shadow: WebGLTexture, width: number, height: number): WebGLTexture {
    if (!this.target || !this.texture) throw Error("Light shafts target is not prepared");
    const gl = this.gl;
    writeLightShaftUniforms(this.values, frame, plan, width, height);
    gl.useProgram(this.program); gl.bindVertexArray(this.vao); gl.viewport(0, 0, plan.width, plan.height); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.target);
    gl.activeTexture(gl.TEXTURE0); gl.bindSampler(0, null); gl.bindTexture(gl.TEXTURE_2D, depth); gl.uniform1i(this.uniforms.depth, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindSampler(1, null); gl.bindTexture(gl.TEXTURE_2D, shadow); gl.uniform1i(this.uniforms.shadow, 1);
    gl.uniform4fv(this.uniforms["p[0]"], this.values); gl.drawArrays(gl.TRIANGLES, 0, 3);
    return this.texture;
  }
  targetCount(): number { return Number(!!this.texture); }
  textureBytes(): number { return this.width * this.height * 8; }
  clearTarget(): void {
    if (this.texture) this.gl.deleteTexture(this.texture); if (this.target) this.gl.deleteFramebuffer(this.target);
    this.texture = this.target = undefined; this.width = this.height = 0;
  }
  destroy(): void { this.clearTarget(); this.gl.deleteProgram(this.program); this.gl.deleteVertexArray(this.vao); }
}
