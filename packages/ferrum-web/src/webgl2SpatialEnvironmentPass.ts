import type { SpatialRenderBufferView } from "./dataSceneSpatial.js";
import {
  createSpatialProgram,
  spatialUniform,
  spatialVertexSource,
  spatialShadowFragmentSource,
  spatialCompositeVertexSource,
  spatialCompositeFragmentSource,
  type SpatialGeometryUniforms,
} from "./webgl2SpatialShaders.js";

export interface SpatialEnvironmentGpuStats {
  textureCount: number;
  renderTargetCount: number;
  textureBytes: number;
}
export class WebGL2SpatialEnvironmentPass {
  private composite?: WebGLProgram;
  private shadow?: WebGLProgram;
  private vao?: WebGLVertexArrayObject;
  private color?: WebGLTexture;
  private depth?: WebGLTexture;
  private target?: WebGLFramebuffer;
  private cube?: WebGLTexture;
  private cubeTarget?: WebGLFramebuffer;
  private width = 0;
  private height = 0;
  private resolution = 0;
  private readonly positionValues = new Float32Array(16);
  private readonly colorValues = new Float32Array(16);
  private compositeUniforms: Record<string, WebGLUniformLocation> = {};
  private shadowUniforms?: SpatialGeometryUniforms & {
    light: WebGLUniformLocation;
  };
  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly linearInput: boolean,
  ) {
    if (!gl.getExtension("EXT_color_buffer_float"))
      throw new Error(
        "Spatial environment requires EXT_color_buffer_float for HDR rendering",
      );
    try {
      this.composite = createSpatialProgram(
        gl,
        spatialCompositeVertexSource,
        spatialCompositeFragmentSource,
      );
      const vao = gl.createVertexArray();
      if (!vao) throw new Error("Spatial composite VAO allocation failed");
      this.vao = vao;
      for (const name of [
        "color",
        "depth",
        "size",
        "nearFar",
        "perspective",
        "dof",
        "grade",
        "encode",
        "focus",
        "gradeValues",
        "tint",
      ])
        this.compositeUniforms[name] = spatialUniform(
          gl,
          this.composite,
          `u_${name}`,
        );
    } catch (error) {
      this.destroy();
      throw error;
    }
  }
  prepare(frame: SpatialRenderBufferView, width: number, height: number): void {
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > 8192 ||
      height > 8192 ||
      width * height > 8_388_608
    )
      throw new Error("Spatial HDR target exceeds the 8 megapixel budget");
    const gl = this.gl;
    if (this.width !== width || this.height !== height) {
      this.releaseTarget();
      const color = gl.createTexture(),
        depth = gl.createTexture(),
        target = gl.createFramebuffer();
      if (!color || !depth || !target) {
        if (color) gl.deleteTexture(color);
        if (depth) gl.deleteTexture(depth);
        if (target) gl.deleteFramebuffer(target);
        throw new Error("Spatial HDR target allocation failed");
      }
      this.color = color;
      this.depth = depth;
      this.target = target;
      try {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, color);
        this.parameters(gl.TEXTURE_2D);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA16F,
          width,
          height,
          0,
          gl.RGBA,
          gl.HALF_FLOAT,
          null,
        );
        gl.bindTexture(gl.TEXTURE_2D, depth);
        this.parameters(gl.TEXTURE_2D);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.DEPTH_COMPONENT24,
          width,
          height,
          0,
          gl.DEPTH_COMPONENT,
          gl.UNSIGNED_INT,
          null,
        );
        gl.bindFramebuffer(gl.FRAMEBUFFER, target);
        gl.framebufferTexture2D(
          gl.FRAMEBUFFER,
          gl.COLOR_ATTACHMENT0,
          gl.TEXTURE_2D,
          color,
          0,
        );
        gl.framebufferTexture2D(
          gl.FRAMEBUFFER,
          gl.DEPTH_ATTACHMENT,
          gl.TEXTURE_2D,
          depth,
          0,
        );
        gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
        gl.readBuffer(gl.COLOR_ATTACHMENT0);
        if (
          gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE
        )
          throw new Error("Spatial HDR target incomplete");
        this.width = width;
        this.height = height;
      } catch (error) {
        this.releaseTarget();
        throw error;
      }
    }
    const values = frame.environment!.values;
    if (values[2] >= 0) this.prepareShadow(values[3]);
    else this.releaseShadow();
  }
  private parameters(target: number): void {
    const gl = this.gl;
    gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (target === gl.TEXTURE_CUBE_MAP)
      gl.texParameteri(target, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  }
  private prepareShadow(resolution: number): void {
    if (this.resolution === resolution) return;
    this.releaseShadow();
    const gl = this.gl;
    try {
      this.shadow = createSpatialProgram(
        gl,
        spatialVertexSource,
        spatialShadowFragmentSource,
      );
      this.shadowUniforms = {
        camera: spatialUniform(gl, this.shadow, "u_camera"),
        texture: spatialUniform(gl, this.shadow, "u_texture"),
        textured: spatialUniform(gl, this.shadow, "u_textured"),
        flip: spatialUniform(gl, this.shadow, "u_flip_y"),
        light: spatialUniform(gl, this.shadow, "u_shadowLight"),
      };
      const cube = gl.createTexture(),
        target = gl.createFramebuffer();
      if (!cube || !target) {
        if (cube) gl.deleteTexture(cube);
        if (target) gl.deleteFramebuffer(target);
        throw new Error("Spatial shadow cube allocation failed");
      }
      this.cube = cube;
      this.cubeTarget = target;
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, cube);
      this.parameters(gl.TEXTURE_CUBE_MAP);
      for (let face = 0; face < 6; face++)
        gl.texImage2D(
          gl.TEXTURE_CUBE_MAP_POSITIVE_X + face,
          0,
          gl.DEPTH_COMPONENT24,
          resolution,
          resolution,
          0,
          gl.DEPTH_COMPONENT,
          gl.UNSIGNED_INT,
          null,
        );
      gl.bindFramebuffer(gl.FRAMEBUFFER, target);
      gl.drawBuffers([gl.NONE]);
      gl.readBuffer(gl.NONE);
      // Validate every face before caching the resolution; a transient allocation failure must be retryable.
      for (let face = 0; face < 6; face++) {
        gl.framebufferTexture2D(
          gl.FRAMEBUFFER,
          gl.DEPTH_ATTACHMENT,
          gl.TEXTURE_CUBE_MAP_POSITIVE_X + face,
          cube,
          0,
        );
        if (
          gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE
        ) {
          throw new Error("Spatial shadow cube target incomplete");
        }
      }
      this.resolution = resolution;
    } catch (error) {
      this.releaseShadow();
      throw error;
    }
  }
  drawShadows(
    frame: SpatialRenderBufferView,
    draw: (uniforms: SpatialGeometryUniforms) => void,
  ): number {
    if (!this.shadow || !this.shadowUniforms) return 0;
    const gl = this.gl,
      env = frame.environment!,
      v = env.values,
      u = this.shadowUniforms,
      p = 12 + v[2] * 12;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.cubeTarget!);
    gl.viewport(0, 0, this.resolution, this.resolution);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.clearDepth(1);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(this.shadow);
    gl.uniform1i(u.texture, 0);
    gl.uniform4fv(u.light, v.subarray(p, p + 4));
    for (let face = 0; face < 6; face++) {
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.DEPTH_ATTACHMENT,
        gl.TEXTURE_CUBE_MAP_POSITIVE_X + face,
        this.cube!,
        0,
      );
      if (
        gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE
      ) {
        this.releaseShadow();
        throw new Error("Spatial shadow cube target incomplete");
      }
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix4fv(
        u.camera,
        false,
        env.shadowMatrices.subarray(face * 16, face * 16 + 16),
      );
      draw(u);
    }
    return 6;
  }
  beginScene(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.target!);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }
  bindGeometry(
    frame: SpatialRenderBufferView,
    u: Record<string, WebGLUniformLocation>,
  ): void {
    const gl = this.gl,
      v = frame.environment!.values,
      flags = v[0];
    gl.uniform1i(u.environment, 1);
    gl.uniform1i(u.linearInput, this.linearInput ? 1 : 0);
    gl.uniform1i(u.lighting, flags & 1 ? 1 : 0);
    gl.uniform1i(u.fog, flags & 2 ? 1 : 0);
    gl.uniform3fv(u.ambient, v.subarray(5, 8));
    gl.uniform1i(u.lightCount, v[1]);
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        this.positionValues[i * 4 + j] = v[12 + i * 12 + j];
        this.colorValues[i * 4 + j] = v[16 + i * 12 + j];
      }
    gl.uniform4fv(u.lightPosition, this.positionValues);
    gl.uniform4fv(u.lightColor, this.colorValues);
    gl.uniform1i(u.shadowIndex, v[2]);
    gl.uniform1f(u.shadowBias, v[4]);
    gl.uniform3fv(u.eye, frame.camera.subarray(17, 20));
    const x = frame.camera[20] - frame.camera[17],
      y = frame.camera[21] - frame.camera[18],
      z = frame.camera[22] - frame.camera[19],
      length = Math.hypot(x, y, z);
    gl.uniform3f(u.forward, x / length, y / length, z / length);
    gl.uniform2f(u.fogRange, v[71], v[72]);
    gl.uniform3fv(u.fogColor, v.subarray(73, 76));
    gl.activeTexture(gl.TEXTURE1);
    gl.bindSampler(1, null);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.cube ?? null);
    gl.activeTexture(gl.TEXTURE0);
  }
  compositeScene(
    frame: SpatialRenderBufferView,
    target: WebGLFramebuffer | null,
    viewport: Int32Array,
  ): void {
    const gl = this.gl,
      u = this.compositeUniforms,
      v = frame.environment!.values;
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target);
    gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(this.composite!);
    gl.bindVertexArray(this.vao!);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindSampler(0, null);
    gl.bindTexture(gl.TEXTURE_2D, this.color!);
    gl.uniform1i(u.color, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindSampler(1, null);
    gl.bindTexture(gl.TEXTURE_2D, this.depth!);
    gl.uniform1i(u.depth, 1);
    gl.uniform2f(u.size, this.width, this.height);
    gl.uniform2f(u.nearFar, frame.camera[24], frame.camera[25]);
    gl.uniform1i(u.perspective, frame.camera[16] === 1 ? 1 : 0);
    gl.uniform1i(u.dof, v[0] & 4 ? 1 : 0);
    gl.uniform1i(u.grade, v[0] & 8 ? 1 : 0);
    gl.uniform1i(u.encode, this.linearInput ? 0 : 1);
    gl.uniform4f(
      u.focus,
      v[60],
      v[61],
      v[62],
      (v[63] * this.height) / frame.camera[27],
    );
    gl.uniform4fv(u.gradeValues, v.subarray(64, 68));
    gl.uniform3fv(u.tint, v.subarray(68, 71));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  resourceStats(): SpatialEnvironmentGpuStats {
    return {
      textureCount: (this.color ? 2 : 0) + (this.cube ? 1 : 0),
      renderTargetCount: (this.target ? 1 : 0) + (this.cubeTarget ? 1 : 0),
      textureBytes:
        this.width * this.height * 12 +
        this.resolution * this.resolution * 6 * 4,
    };
  }
  programCount(): number {
    return (this.composite ? 1 : 0) + (this.shadow ? 1 : 0);
  }
  depthBytes(): number {
    return (
      this.width * this.height * 4 + this.resolution * this.resolution * 6 * 4
    );
  }
  private releaseTarget(): void {
    const gl = this.gl;
    if (this.color) gl.deleteTexture(this.color);
    if (this.depth) gl.deleteTexture(this.depth);
    if (this.target) gl.deleteFramebuffer(this.target);
    this.color = undefined;
    this.depth = undefined;
    this.target = undefined;
    this.width = 0;
    this.height = 0;
  }
  private releaseShadow(): void {
    const gl = this.gl;
    if (this.cube) gl.deleteTexture(this.cube);
    if (this.cubeTarget) gl.deleteFramebuffer(this.cubeTarget);
    if (this.shadow) gl.deleteProgram(this.shadow);
    this.cube = undefined;
    this.cubeTarget = undefined;
    this.shadow = undefined;
    this.shadowUniforms = undefined;
    this.resolution = 0;
  }
  destroy(): void {
    this.releaseTarget();
    this.releaseShadow();
    if (this.composite) this.gl.deleteProgram(this.composite);
    if (this.vao) this.gl.deleteVertexArray(this.vao);
    this.composite = undefined;
    this.vao = undefined;
  }
}
