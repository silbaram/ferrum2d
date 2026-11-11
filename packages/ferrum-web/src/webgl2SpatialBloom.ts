import { createSpatialProgram, spatialCompositeVertexSource, spatialUniform } from "./webgl2SpatialShaders.js";
import { spatialBloomFragmentGLSL, type SpatialBloomPlan } from "./spatialBloomKernel.js";

type Target = { texture: WebGLTexture; framebuffer: WebGLFramebuffer };
/** Low-resolution HDR chain and coarse blur target; no simulation state or per-frame GPU allocation. */
export class WebGL2SpatialBloom {
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly uniforms: Record<string, WebGLUniformLocation> = {};
  private targets?: Target[];
  private key = "";
  private bytes = 0;
  private width = 0;
  private height = 0;
  constructor(private readonly gl: WebGL2RenderingContext) {
    this.program = createSpatialProgram(gl, spatialCompositeVertexSource, spatialBloomFragmentGLSL);
    const vao = gl.createVertexArray();
    if (!vao) { gl.deleteProgram(this.program); throw Error("Spatial Bloom VAO allocation failed"); }
    this.vao = vao;
    try {
      for (const name of ["source", "scale", "kernel", "stage", "step", "threshold", "targetHeight"])
        this.uniforms[name] = spatialUniform(gl, this.program, `u_${name}`);
    } catch (error) { this.destroy(); throw error; }
  }
  prepare(plan?: SpatialBloomPlan): void {
    if (!plan) { this.clearTargets(); return; }
    const key = plan.levels.map(l => `${l.width}x${l.height}`).join("/");
    if (this.targets && this.key === key) return;
    const gl = this.gl, next: Target[] = [];
    try {
      for (const size of [...plan.levels, { width: plan.width, height: plan.height }]) {
        const texture = gl.createTexture(), framebuffer = gl.createFramebuffer();
        if (!texture || !framebuffer) {
          if (texture) gl.deleteTexture(texture); if (framebuffer) gl.deleteFramebuffer(framebuffer);
          throw Error("Spatial Bloom target allocation failed");
        }
        next.push({ texture, framebuffer });
        gl.bindTexture(gl.TEXTURE_2D, texture);
        for (const key of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, key, gl.NEAREST);
        for (const key of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, key, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, size.width, size.height, 0, gl.RGBA, gl.HALF_FLOAT, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw Error("Spatial Bloom target incomplete");
      }
    } catch (error) {
      for (const t of next) { gl.deleteTexture(t.texture); gl.deleteFramebuffer(t.framebuffer); }
      throw error;
    }
    this.clearTargets(); this.targets = next; this.key = key;
    this.width = plan.width; this.height = plan.height; this.bytes = plan.textureBytes;
  }
  draw(source: WebGLTexture, plan: SpatialBloomPlan, threshold: number): WebGLTexture {
    if (!this.targets) throw Error("Spatial Bloom target is not prepared");
    const gl = this.gl, u = this.uniforms;
    gl.useProgram(this.program); gl.bindVertexArray(this.vao); gl.viewport(0, 0, this.width, this.height);
    gl.activeTexture(gl.TEXTURE0); gl.bindSampler(0, null); gl.uniform1i(u.source, 0);
    gl.uniform1i(u.kernel, plan.kernel);
    gl.uniform1f(u.step, plan.step); gl.uniform1f(u.threshold, threshold);
    for (let i = 0; i < plan.drawCalls; i++) {
      const downsample = i < plan.levels.length;
      const index = downsample ? i : i === plan.levels.length ? this.targets.length - 1 : this.targets.length - 2;
      const destination = this.targets[index], size = downsample ? plan.levels[i] : plan;
      gl.viewport(0, 0, size.width, size.height); gl.uniform1i(u.targetHeight, size.height);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, destination.framebuffer); gl.bindTexture(gl.TEXTURE_2D, source);
      gl.uniform1i(u.scale, i === 0 ? plan.scale : 2);
      gl.uniform1i(u.stage, downsample ? i === 0 ? 0 : 3 : i === plan.levels.length ? 1 : 2);
      gl.drawArrays(gl.TRIANGLES, 0, 3); source = destination.texture;
    }
    return source;
  }
  textureBytes(): number { return this.targets ? this.bytes : 0; }
  targetCount(): number { return this.targets?.length ?? 0; }
  clearTargets(): void {
    for (const t of this.targets ?? []) { this.gl.deleteTexture(t.texture); this.gl.deleteFramebuffer(t.framebuffer); }
    this.targets = undefined; this.width = this.height = this.bytes = 0; this.key = "";
  }
  destroy(): void { this.clearTargets(); this.gl.deleteProgram(this.program); this.gl.deleteVertexArray(this.vao); }
}
