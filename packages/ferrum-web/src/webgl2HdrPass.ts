import { WebGL2RenderTarget } from "./webgl2RenderTarget.js";
import { createWebGL2Program } from "./webgl2ShaderPrograms.js";
import { flatHdrToneMapping, type ResolvedFlatHdrOptions } from "./flatHdr.js";

/** One float world target; output is resolved once before the SDR/HUD boundary. */
export class WebGL2HdrPass {
  private target?: WebGL2RenderTarget;
  private width = 0; private height = 0;
  private program?: WebGLProgram;
  private vao?: WebGLVertexArrayObject;
  private source?: WebGLUniformLocation;
  private output?: WebGLUniformLocation;
  constructor(private readonly gl: WebGL2RenderingContext) {}

  prepare(width: number, height: number): void {
    if (!this.program) {
      const gl = this.gl, program = createWebGL2Program(gl, "flatHdr"), vao = gl.createVertexArray();
      try {
        const source = gl.getUniformLocation(program, "u_source"), output = gl.getUniformLocation(program, "u_output");
        if (!vao || !source || !output) throw Error("Flat HDR output allocation failed");
        this.program = program; this.vao = vao; this.source = source; this.output = output;
      } catch (error) { gl.deleteProgram(program); if (vao) gl.deleteVertexArray(vao); throw error; }
    }
    if (this.target && width === this.width && height === this.height) return;
    const next = new WebGL2RenderTarget(this.gl, width, height, "nearest", false, true);
    this.target?.destroy(); this.target = next; this.width = width; this.height = height;
  }
  bind(): void {
    if (!this.target) throw Error("Flat HDR target is not prepared");
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.target.framebuffer); this.gl.viewport(0, 0, this.width, this.height);
  }
  resolve(options: ResolvedFlatHdrOptions, encodeSrgb: boolean): void {
    const gl = this.gl, mask = gl.getParameter(gl.COLOR_WRITEMASK) as boolean[];
    const caps = [gl.BLEND, gl.DEPTH_TEST, gl.CULL_FACE, gl.SCISSOR_TEST], enabled = caps.map(cap => gl.isEnabled(cap));
    try {
      caps.forEach(cap => gl.disable(cap)); gl.colorMask(true, true, true, true);
      gl.useProgram(this.program!); gl.bindVertexArray(this.vao!);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.target!.texture);
      gl.uniform1i(this.source!, 0); gl.uniform3f(this.output!, options.exposure, flatHdrToneMapping(options), encodeSrgb ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } finally {
      gl.colorMask(mask[0]!, mask[1]!, mask[2]!, mask[3]!); caps.forEach((cap, i) => enabled[i] ? gl.enable(cap) : gl.disable(cap));
      gl.bindVertexArray(null);
    }
  }
  release(): void { this.target?.destroy(); this.target = undefined; this.width = this.height = 0; }
  destroy(): void {
    this.release(); if (this.program) this.gl.deleteProgram(this.program); if (this.vao) this.gl.deleteVertexArray(this.vao);
    this.program = undefined; this.vao = undefined;
  }
  resourceStats() {
    return { renderTargetCount: this.target ? 1 : 0, textureBytes: this.target?.allocatedTextureBytes ?? 0,
      bufferCount: 0, bufferBytes: 0, programCount: this.program ? 1 : 0 };
  }
}
