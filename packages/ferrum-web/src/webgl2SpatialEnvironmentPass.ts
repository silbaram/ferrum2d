import { secondSpatialShadowSlot } from "./spatialPointShadows.js";
import type { SpatialRendererStats } from "./renderer.js";
import { WebGL2SpatialBloom } from "./webgl2SpatialBloom.js";
import { spatialBloomPlan, writeSpatialBloomStats, type SpatialBloomPlan } from "./spatialBloomKernel.js";
import type { SpatialRenderBufferView } from "./dataSceneSpatial.js";
import { spatialDofPass, spatialIndirectPass, spatialSeparated } from "./spatialComposition.js";
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
  private bloomPass?: WebGL2SpatialBloom;
  private bloomPlan?: SpatialBloomPlan;
  private composite?: WebGLProgram;
  private shadow?: WebGLProgram;
  private vao?: WebGLVertexArrayObject;
  private color?: WebGLTexture;
  private depth?: WebGLTexture;
  private target?: WebGLFramebuffer;
  private indirect?: WebGLTexture;
  private resolved?: { texture: WebGLTexture; target: WebGLFramebuffer };
  private dof?: { texture: WebGLTexture; target: WebGLFramebuffer };
  private readonly clearValue = new Float32Array(4);
  private cube?: WebGLTexture;
  private cube2?: WebGLTexture;
  private cubeTarget2?: WebGLFramebuffer;
  private resolution2 = 0;
  private cubeTarget?: WebGLFramebuffer;
  private width = 0;
  private height = 0;
  private resolution = 0;
  private sun?: WebGLTexture;
  private sunTarget?: WebGLFramebuffer;
  private sunResolution = 0;
  private readonly emptyMatrix = new Float32Array(16);
  private readonly positionValues = new Float32Array(16);
  private readonly colorValues = new Float32Array(16);
  private readonly coneValues = new Float32Array(32);
  private compositeUniforms: Record<string, WebGLUniformLocation> = {};
  private shadowUniforms?: SpatialGeometryUniforms & {
    light: WebGLUniformLocation;
    directional: WebGLUniformLocation;
    texel: WebGLUniformLocation;
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
        "highDof",
        "grade",
        "encode",
        "focus",
        "gradeValues",
        "tint", "bloom", "ao", "projectionSize", "indirect", "separated", "dofApplied", "stage", "wideBloom", "bloomImage", "bloomGrid", "bloomSnap", "fog", "fogRange", "fogColor",
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
  shadowReady(v: Float32Array): boolean {
    return (v[2] < 0 || (this.cube !== undefined && this.resolution === v[3])) &&
      (secondSpatialShadowSlot(v) < 0 || (this.cube2 !== undefined && this.resolution2 === v[585])) &&
      (!(v.length > 80 && v[92] > 0) || (this.sun !== undefined && this.sunResolution === v[92]));
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
    this.prepareComposition(values);
    this.bloomPlan = spatialBloomPlan(frame.environment?.values, width, height, frame.camera?.[27] ?? height);
    if (this.bloomPlan) (this.bloomPass ??= new WebGL2SpatialBloom(gl)).prepare(this.bloomPlan);
    else this.bloomPass?.prepare();
    if (values[2] >= 0) this.prepareShadow(values[3]);
    else this.releaseShadow();
    if (values.length > 80 && values[92] > 0) this.prepareSun(values[92]);
    else this.releaseSun();
    if (secondSpatialShadowSlot(values) >= 0) this.prepareShadow(values[585], true);
    else this.releaseShadow(true);
    if (!this.cube && !this.cube2 && !this.sun) this.releaseShadowProgram();
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
  private prepareComposition(values: Float32Array): void {
    const indirect = spatialIndirectPass(values), dof = spatialDofPass(values), gl = this.gl;
    if (!!this.indirect === indirect && !!this.dof === dof) return;
    this.releaseComposition();
    try {
      if (indirect) {
        const target = this.createCompositionTarget();
        this.resolved = target;
        // The independent ambient attachment shares the geometry depth test and ordering.
        this.indirect = this.createHdrTexture();
      }
      if (dof) this.dof = this.createCompositionTarget();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.target!);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.indirect ?? null, 0);
      gl.drawBuffers(this.indirect ? [gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1] : [gl.COLOR_ATTACHMENT0]);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw Error("Spatial indirect MRT incomplete");
    } catch (error) {
      this.releaseComposition();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.target!);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, null, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      throw error;
    }
  }
  private createHdrTexture(): WebGLTexture {
    const gl = this.gl, texture = gl.createTexture();
    if (!texture) throw Error("Spatial composition texture allocation failed");
    try {
      gl.bindTexture(gl.TEXTURE_2D, texture); this.parameters(gl.TEXTURE_2D);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, this.width, this.height, 0, gl.RGBA, gl.HALF_FLOAT, null);
      return texture;
    } catch (error) { gl.deleteTexture(texture); throw error; }
  }
  private createCompositionTarget(): { texture: WebGLTexture; target: WebGLFramebuffer } {
    const gl = this.gl, texture = this.createHdrTexture(), target = gl.createFramebuffer();
    try {
      if (!target) throw Error("Spatial composition framebuffer allocation failed");
      gl.bindFramebuffer(gl.FRAMEBUFFER, target);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw Error("Spatial composition framebuffer incomplete");
      return { texture, target };
    } catch (error) { gl.deleteTexture(texture); if (target) gl.deleteFramebuffer(target); throw error; }
  }
  private releaseComposition(): void {
    if (this.indirect) this.gl.deleteTexture(this.indirect);
    for (const target of [this.resolved, this.dof]) if (target) {
      this.gl.deleteTexture(target.texture); this.gl.deleteFramebuffer(target.target);
    }
    this.indirect = undefined; this.resolved = undefined; this.dof = undefined;
  }
  private prepareShadowProgram(): void {
    if (this.shadow) return;
    const gl = this.gl;
    try {
      this.shadow = createSpatialProgram(
        gl,
        spatialVertexSource,
        spatialShadowFragmentSource,
      );
      this.shadowUniforms = {
        camera: spatialUniform(gl, this.shadow, "u_camera"),
        model: spatialUniform(gl, this.shadow, "u_model"),
        mesh: spatialUniform(gl, this.shadow, "u_mesh"),
        instanced: spatialUniform(gl, this.shadow, "u_instanced"),
        modelColor: spatialUniform(gl, this.shadow, "u_modelColor"),
        modelCutoff: spatialUniform(gl, this.shadow, "u_modelCutoff"),
        modelUvTransform: spatialUniform(gl, this.shadow, "u_modelUvTransform"),
        texture: spatialUniform(gl, this.shadow, "u_texture"),
        textured: spatialUniform(gl, this.shadow, "u_textured"),
        flip: spatialUniform(gl, this.shadow, "u_flip_y"),
        light: spatialUniform(gl, this.shadow, "u_shadowLight"),
        directional: spatialUniform(gl, this.shadow, "u_directionalShadow"),
        texel: spatialUniform(gl, this.shadow, "u_shadowTexel"),
      };
    } catch (error) { this.releaseShadowProgram(); throw error; }
  }
  private prepareSun(resolution: number): void {
    if (this.sunResolution === resolution) return;
    this.releaseSun();
    const gl = this.gl;
    try {
      this.prepareShadowProgram();
      this.sun = gl.createTexture() ?? undefined;
      this.sunTarget = gl.createFramebuffer() ?? undefined;
      if (!this.sun || !this.sunTarget) throw new Error("Directional shadow allocation failed");
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.sun); this.parameters(gl.TEXTURE_2D);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, resolution, resolution, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.sunTarget);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.sun, 0);
      gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("Directional shadow target incomplete");
      this.sunResolution = resolution;
    } catch (error) { this.releaseSun(); throw error; }
  }
  private prepareShadow(resolution: number, second = false): void {
    if ((second ? this.resolution2 : this.resolution) === resolution) return;
    this.releaseShadow(second);
    const gl = this.gl;
    let cube: WebGLTexture | null = null, target: WebGLFramebuffer | null = null;
    try {
      this.prepareShadowProgram();
      cube = gl.createTexture(); target = gl.createFramebuffer();
      if (!cube || !target) throw Error("Spatial shadow cube allocation failed");
      gl.activeTexture(gl.TEXTURE0 + (second ? 8 : 1));
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, cube); this.parameters(gl.TEXTURE_CUBE_MAP);
      for (let face = 0; face < 6; face++)
        gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + face, 0, gl.DEPTH_COMPONENT24,
          resolution, resolution, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target); gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
      for (let face = 0; face < 6; face++) {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_CUBE_MAP_POSITIVE_X + face, cube, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
          throw Error("Spatial shadow cube target incomplete");
      }
      if (second) { this.cube2 = cube; this.cubeTarget2 = target; this.resolution2 = resolution; }
      else { this.cube = cube; this.cubeTarget = target; this.resolution = resolution; }
    } catch (error) {
      if (cube) gl.deleteTexture(cube);
      if (target) gl.deleteFramebuffer(target);
      throw error;
    }
  }
  drawShadows(frame: SpatialRenderBufferView, draw: (u: SpatialGeometryUniforms, face: number) => void): number {
    if (!this.shadow || !this.shadowUniforms) return 0;
    const gl = this.gl, env = frame.environment!, v = env.values, u = this.shadowUniforms;
    let count = 0;
    for (const [cube, target, resolution, slot, faceBase, matrixBase, second] of [
      [this.cube, this.cubeTarget, this.resolution, v[2], 0, 0, false],
      [this.cube2, this.cubeTarget2, this.resolution2, secondSpatialShadowSlot(v), 7, 6, true],
    ] as const) {
      if (!cube || slot < 0) continue;
      gl.bindFramebuffer(gl.FRAMEBUFFER, target!); gl.viewport(0, 0, resolution, resolution);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true); gl.clearDepth(1);
      gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.useProgram(this.shadow);
      gl.uniform1i(u.texture, 0); gl.uniform1i(u.directional, 0); gl.uniform1f(u.texel, 1 / resolution);
      gl.uniform4fv(u.light, v.subarray(12 + slot * 12, 16 + slot * 12));
      for (let face = 0; face < 6; face++) {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_CUBE_MAP_POSITIVE_X + face, cube, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
          this.releaseShadow(second); throw Error("Spatial shadow cube target incomplete");
        }
        gl.clear(gl.DEPTH_BUFFER_BIT);
        const matrix = (matrixBase + face) * 16;
        gl.uniformMatrix4fv(u.camera, false, env.shadowMatrices.subarray(matrix, matrix + 16));
        draw(u, faceBase + face); count++;
      }
    }
    return count;
  }
  drawSunShadow(frame: SpatialRenderBufferView, draw: (u: SpatialGeometryUniforms, face: number) => void): number {
    if (!this.sun || !this.shadow || !this.shadowUniforms) return 0;
    const gl = this.gl, u = this.shadowUniforms, matrices = frame.environment!.shadowMatrices;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sunTarget!); gl.viewport(0, 0, this.sunResolution, this.sunResolution);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true); gl.clearDepth(1);
    gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.shadow); gl.uniform1i(u.texture, 0); gl.uniform1i(u.directional, 1);
    gl.uniformMatrix4fv(u.camera, false, matrices.subarray(matrices.length - 16));
    draw(u, 6); return 1;
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
    gl.uniform1i(u.separated, this.indirect ? 1 : 0);
    gl.uniform1i(u.linearInput, this.linearInput ? 1 : 0);
    gl.uniform1i(u.lighting, flags & 1 ? 1 : 0);
    gl.uniform1i(u.fog, flags & 2 ? 1 : 0);
    gl.uniform3fv(u.ambient, v.subarray(5, 8));
    const hemisphere=v.length>=128 && v[112]===1;
    gl.uniform4f(u.hemisphereDirection,hemisphere?v[113]:0,hemisphere?v[114]:1,hemisphere?v[115]:0,hemisphere?v[119]:0);
    gl.uniform3fv(u.hemisphereSky,hemisphere?v.subarray(116,119):this.emptyMatrix.subarray(0,3));
    gl.uniform3fv(u.hemisphereGround,hemisphere?v.subarray(120,123):this.emptyMatrix.subarray(0,3));
    gl.uniform2f(u.shadowNormalBias,v[123] ?? 0,v[124] ?? 0);
    gl.uniform1i(u.lightCount, v[1]);
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        this.positionValues[i * 4 + j] = v[12 + i * 12 + j];
        this.colorValues[i * 4 + j] = v[16 + i * 12 + j];
      }
    gl.uniform4f(u.lightChannels, v.length >= 576 ? v[545] : 65535, v.length >= 576 ? v[546] : 65535, v.length >= 576 ? v[547] : 65535, v.length >= 576 ? v[548] : 65535);
    gl.uniform1f(u.sunChannels, v.length >= 576 ? v[544] : 65535);
    gl.uniform4fv(u.lightPosition, this.positionValues);
    gl.uniform4fv(u.lightColor, this.colorValues);
    this.coneValues.fill(0);
    if(v.length>=512)this.coneValues.set(v.subarray(144,176));
    gl.uniform4fv(u.lightCone, this.coneValues);
    gl.uniform1i(u.shadowIndex, v[2]);
    gl.uniform1i(u.shadowIndex2, secondSpatialShadowSlot(v));
    gl.uniform2f(u.shadowParams2, v[586] ?? 0, v[587] ?? 0);
    gl.activeTexture(gl.TEXTURE8); gl.bindSampler(8, null); gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.cube2 ?? this.cube ?? null);
    gl.uniform1i(u.shadowMap2, 8);
    gl.uniform1f(u.shadowBias, v[4]);
    gl.uniform1i(u.shadowFilter, v.length > 80 ? v[95] : 0);
    gl.uniform3fv(u.sunDirection, v.length > 80 ? v.subarray(84, 87) : this.emptyMatrix.subarray(0, 3));
    gl.uniform4f(u.sunColor, v[83] ? v[88] : 0, v[83] ? v[89] : 0, v[83] ? v[90] : 0, v[83] ? v[87] : 0);
    gl.uniform1i(u.sunShadow, v.length > 80 && v[92] > 0 ? 1 : 0);
    gl.uniform3f(u.sunParams, v[91] ? v[91] * 2 : 1, v[93] ?? 0, v[94] ?? 1);
    const matrices = frame.environment!.shadowMatrices;
    gl.uniformMatrix4fv(u.sunMatrix, false, v.length > 80 && v[92] > 0 ? matrices.subarray(matrices.length - 16) : this.emptyMatrix);
    gl.activeTexture(gl.TEXTURE3); gl.bindSampler(3, null); gl.bindTexture(gl.TEXTURE_2D, this.sun ?? null); gl.uniform1i(u.sunMap, 3);
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
  ): number {
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
    gl.uniform1i(u.highDof, v[96] === 1 ? 1 : 0);
    gl.uniform1i(u.grade, v[0] & 8 ? 1 : 0);
    gl.uniform1i(u.encode, this.linearInput ? 0 : 1);
    gl.uniform4f(
      u.focus,
      v[97] === 1 && v[99] > 0 ? v[99] : v[60],
      v[61],
      v[62],
      (v[63] * this.height) / frame.camera[27],
    );
    gl.uniform4fv(u.gradeValues, v.subarray(64, 68));
    gl.uniform3fv(u.tint, v.subarray(68, 71));
    gl.uniform1f(u.projectionSize,frame.camera[23]);
    gl.uniform4f(u.bloom,v[128]??0,v[129]??0,(v[130]??0)*this.height/frame.camera[27],v[131]??0);
    gl.uniform4f(u.ao,v[132]??0,v[133]??0,v[134]??0,v[135]??0);
    gl.uniform1i(u.separated, spatialSeparated(v) ? 1 : 0);
    gl.uniform1i(u.dofApplied, this.dof ? 1 : 0);
    gl.uniform1i(u.fog, v[0] & 2 ? 1 : 0);
    gl.uniform2f(u.fogRange, v[71], v[72]); gl.uniform3fv(u.fogColor, v.subarray(73, 76));
    gl.activeTexture(gl.TEXTURE2); gl.bindSampler(2, null);
    gl.bindTexture(gl.TEXTURE_2D, this.indirect ?? this.color!); gl.uniform1i(u.indirect, 2);
    let source = this.color!, passes = 1;
    let bloomImage: WebGLTexture | undefined;
    const mask = gl.getParameter(gl.COLOR_WRITEMASK) as boolean[];
    const scissor = gl.isEnabled(gl.SCISSOR_TEST);
    try {
      gl.colorMask(true, true, true, true); gl.disable(gl.SCISSOR_TEST);
      for (const [stage, destination] of [[1, this.resolved], [2, this.dof]] as const) {
        if (!destination) continue;
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, destination.target); gl.viewport(0, 0, this.width, this.height);
        gl.clearBufferfv(gl.COLOR, 0, this.clearValue);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, source);
        gl.uniform1i(u.stage, stage); gl.drawArrays(gl.TRIANGLES, 0, 3);
        source = destination.texture; passes++;
      }
      if (this.bloomPlan) { bloomImage = this.bloomPass!.draw(source, this.bloomPlan, v[131]); passes += this.bloomPlan.drawCalls; }
    } finally {
      gl.colorMask(mask[0]!, mask[1]!, mask[2]!, mask[3]!);
      if (scissor) gl.enable(gl.SCISSOR_TEST);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target); gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);
    }
    gl.useProgram(this.composite!); gl.bindVertexArray(this.vao!);
    if (bloomImage) { gl.activeTexture(gl.TEXTURE3); gl.bindSampler(3, null); gl.bindTexture(gl.TEXTURE_2D, bloomImage); }
    gl.uniform1i(u.bloomSnap, Number(!!(v[0] & 16)));
    gl.uniform2f(u.bloomGrid, this.bloomPlan?.sampleWidth ?? 1, this.bloomPlan?.sampleHeight ?? 1);
    gl.uniform1i(u.bloomImage, bloomImage ? 3 : 0); gl.uniform1i(u.wideBloom, Number(!!bloomImage));
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, source); gl.uniform1i(u.stage, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return passes;
  }
  resourceStats(): SpatialEnvironmentGpuStats {
    return {
      textureCount: (this.bloomPass?.targetCount() ?? 0) + (this.color ? 2 : 0) + (this.cube ? 1 : 0) + (this.cube2 ? 1 : 0) + (this.sun ? 1 : 0) + Number(!!this.indirect) + Number(!!this.resolved) + Number(!!this.dof),
      renderTargetCount: (this.bloomPass?.targetCount() ?? 0) + (this.target ? 1 : 0) + (this.cubeTarget ? 1 : 0) + (this.cubeTarget2 ? 1 : 0) + (this.sunTarget ? 1 : 0) + Number(!!this.resolved) + Number(!!this.dof),
      textureBytes:
        (this.bloomPass?.textureBytes() ?? 0) + this.width * this.height * (12 + 8 * (Number(!!this.indirect) + Number(!!this.resolved) + Number(!!this.dof))) +
        ((this.resolution ** 2 + this.resolution2 ** 2) * 6 + this.sunResolution * this.sunResolution) * 4,
    };
  }
  programCount(): number {
    return Number(!!this.bloomPass) + (this.composite ? 1 : 0) + (this.shadow ? 1 : 0);
  }
  depthBytes(): number {
    return (
      this.width * this.height * 4 + ((this.resolution ** 2 + this.resolution2 ** 2) * 6 + this.sunResolution * this.sunResolution) * 4
    );
  }
  writeBloomStats(stats: SpatialRendererStats, values: Float32Array | undefined, outputWidth: number, outputHeight: number): void {
    writeSpatialBloomStats(stats, values, this.bloomPlan, outputWidth, outputHeight);
  }
  private releaseTarget(): void {
    this.releaseComposition();
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
  private releaseShadow(second = false): void {
    const gl = this.gl;
    if (second) {
      if (this.cube2) gl.deleteTexture(this.cube2);
      if (this.cubeTarget2) gl.deleteFramebuffer(this.cubeTarget2);
      this.cube2 = undefined; this.cubeTarget2 = undefined; this.resolution2 = 0; return;
    }
    if (this.cube) gl.deleteTexture(this.cube);
    if (this.cubeTarget) gl.deleteFramebuffer(this.cubeTarget);
    this.cube = undefined;
    this.cubeTarget = undefined;
    this.resolution = 0;
  }
  private releaseSun(): void {
    if (this.sun) this.gl.deleteTexture(this.sun);
    if (this.sunTarget) this.gl.deleteFramebuffer(this.sunTarget);
    this.sun = undefined; this.sunTarget = undefined; this.sunResolution = 0;
  }
  private releaseShadowProgram(): void {
    if (this.shadow) this.gl.deleteProgram(this.shadow);
    this.shadow = undefined; this.shadowUniforms = undefined;
  }
  destroy(): void {
    this.bloomPass?.destroy(); this.bloomPass = undefined;
    this.releaseTarget();
    this.releaseShadow();
    this.releaseShadow(true);
    this.releaseSun();
    this.releaseShadowProgram();
    if (this.composite) this.gl.deleteProgram(this.composite);
    if (this.vao) this.gl.deleteVertexArray(this.vao);
    this.composite = undefined;
    this.vao = undefined;
  }
}
