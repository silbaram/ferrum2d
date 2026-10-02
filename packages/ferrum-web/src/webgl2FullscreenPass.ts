import { createWebGL2Program } from "./webgl2ShaderPrograms";
import type { ResolvedPostProcessPass } from "./cameraPostProcessing";

export interface WebGL2FullscreenRenderTarget {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
}

export interface WebGL2FullscreenPassStats {
  drawCalls: number;
  passCount: number;
}

export interface WebGL2FullscreenPassOptions {
  /** Encode only the final canvas write; intermediate samples/math stay linear. */
  encodeSrgb?: boolean;
  sourceTexture: WebGLTexture;
  passes: readonly ResolvedPostProcessPass[];
  resolution: [number, number];
  scratchTargets?: readonly [WebGL2FullscreenRenderTarget, WebGL2FullscreenRenderTarget];
}

const POST_PROCESS_KIND = {
  fade: 1,
  bloom: 2,
  crt: 3,
  vignette: 4,
  glitch: 5,
} as const;

export class WebGL2FullscreenPass {
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly sceneLocation: WebGLUniformLocation;
  private readonly texelSizeLocation: WebGLUniformLocation;
  private readonly kindLocation: WebGLUniformLocation;
  private readonly colorLocation: WebGLUniformLocation;
  private readonly paramsLocation: WebGLUniformLocation;
  private readonly encodeSrgbLocation: WebGLUniformLocation;
  private readonly linearWorkingSpaceLocation: WebGLUniformLocation;
  private destroyed = false;

  constructor(private readonly gl: WebGL2RenderingContext) {
    const programs: WebGLProgram[] = [];
    const vaos: WebGLVertexArrayObject[] = [];
    const buffers: WebGLBuffer[] = [];
    try {
      this.program = createWebGL2Program(this.gl, "fullscreen");
      programs.push(this.program);
      const vao = this.gl.createVertexArray();
      if (vao) vaos.push(vao);
      if (!vao) {
        throw new Error("Fullscreen pass VAO 생성 실패");
      }
      this.vao = vao;
      this.sceneLocation = this.requireUniform("u_scene");
      this.texelSizeLocation = this.requireUniform("u_texelSize");
      this.kindLocation = this.requireUniform("u_kind");
      this.colorLocation = this.requireUniform("u_color");
      this.paramsLocation = this.requireUniform("u_params");
      this.encodeSrgbLocation = this.requireUniform("u_encode_srgb");
      this.linearWorkingSpaceLocation = this.requireUniform("u_linear_working_space");
    } catch (error) {
      for (const buffer of buffers) gl.deleteBuffer(buffer);
      for (const vao of vaos) gl.deleteVertexArray(vao);
      for (const program of programs) gl.deleteProgram(program);
      throw error;
    }
  }

  draw(options: WebGL2FullscreenPassOptions): WebGL2FullscreenPassStats {
    this.assertAlive();
    const passes = options.passes;
    if (passes.length === 0) {
      return { drawCalls: 0, passCount: 0 };
    }
    if (passes.length > 1 && options.scratchTargets === undefined) {
      throw new Error("Multiple fullscreen passes require scratch targets.");
    }

    const wasDepthTestEnabled = this.gl.isEnabled(this.gl.DEPTH_TEST);
    const wasCullFaceEnabled = this.gl.isEnabled(this.gl.CULL_FACE);
    const wasBlendEnabled = this.gl.isEnabled(this.gl.BLEND);
    this.gl.disable(this.gl.DEPTH_TEST);
    this.gl.disable(this.gl.CULL_FACE);
    this.gl.disable(this.gl.BLEND);
    this.gl.useProgram(this.program);
    this.gl.bindVertexArray(this.vao);
    this.gl.uniform1i(this.sceneLocation, 0);
    this.gl.uniform1i(this.linearWorkingSpaceLocation, options.encodeSrgb ? 1 : 0);
    this.gl.uniform2f(
      this.texelSizeLocation,
      1 / Math.max(1, options.resolution[0]),
      1 / Math.max(1, options.resolution[1]),
    );

    let sourceTexture = options.sourceTexture;
    let drawCalls = 0;
    let passCount = 0;
    try {
      for (const pass of passes) {
        const isLastPass = passCount === passes.length - 1;
        const destination = isLastPass ? undefined : options.scratchTargets?.[passCount % 2];
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, destination?.framebuffer ?? null);
        this.gl.viewport(0, 0, options.resolution[0], options.resolution[1]);
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, sourceTexture);
        this.writePassUniforms(pass);
        this.gl.uniform1i(this.encodeSrgbLocation, isLastPass && options.encodeSrgb ? 1 : 0);
        this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
        sourceTexture = destination?.texture ?? sourceTexture;
        drawCalls += 1;
        passCount += 1;
      }
    } finally {
      this.gl.bindTexture(this.gl.TEXTURE_2D, null);
      this.gl.bindVertexArray(null);
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
      this.restoreCapability(this.gl.DEPTH_TEST, wasDepthTestEnabled);
      this.restoreCapability(this.gl.CULL_FACE, wasCullFaceEnabled);
      this.restoreCapability(this.gl.BLEND, wasBlendEnabled);
    }

    return { drawCalls, passCount };
  }

  /** Internal allocation summary; no GPU queries or per-command work. */
  resourceStats(): { bufferCount: number; programCount: number; bufferBytes: number } {
    return {
      bufferCount: this.destroyed ? 0 : 0,
      programCount: this.destroyed ? 0 : 1,
      bufferBytes: this.destroyed ? 0 : 0,
    };
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteProgram(this.program);
  }

  private writePassUniforms(pass: ResolvedPostProcessPass): void {
    this.gl.uniform1i(this.kindLocation, POST_PROCESS_KIND[pass.kind]);
    if (pass.kind === "fade") {
      this.gl.uniform4f(this.colorLocation, pass.color[0], pass.color[1], pass.color[2], pass.color[3]);
      this.gl.uniform4f(this.paramsLocation, 0, 0, 0, 0);
      return;
    }
    if (pass.kind === "bloom") {
      this.gl.uniform4f(this.colorLocation, 0, 0, 0, 0);
      this.gl.uniform4f(this.paramsLocation, pass.threshold, pass.intensity, pass.radius, 0);
      return;
    }
    if (pass.kind === "crt") {
      this.gl.uniform4f(this.colorLocation, 0, 0, 0, 0);
      this.gl.uniform4f(this.paramsLocation, pass.curvature, pass.scanlineIntensity, pass.chromaticAberration, 0);
      return;
    }
    if (pass.kind === "vignette") {
      this.gl.uniform4f(this.colorLocation, pass.color[0], pass.color[1], pass.color[2], pass.color[3]);
      this.gl.uniform4f(this.paramsLocation, pass.intensity, pass.radius, pass.softness, 0);
      return;
    }
    this.gl.uniform4f(this.colorLocation, 0, 0, 0, 0);
    this.gl.uniform4f(this.paramsLocation, pass.intensity, pass.chromaticAberration, pass.seed, 0);
  }


  private requireUniform(name: string): WebGLUniformLocation {
    const location = this.gl.getUniformLocation(this.program, name);
    if (location === null) {
      throw new Error(`Fullscreen pass uniform location 조회 실패: ${name}`);
    }
    return location;
  }

  private restoreCapability(capability: number, enabled: boolean): void {
    if (enabled) {
      this.gl.enable(capability);
      return;
    }
    this.gl.disable(capability);
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error("WebGL2FullscreenPass has been destroyed.");
    }
  }
}
