import type { SpatialRenderBufferView } from "./dataSceneSpatial.js";
import type { SpriteTextureSource } from "./spriteBatch.js";
import { WebGL2SpatialEnvironmentPass } from "./webgl2SpatialEnvironmentPass.js";
import {
  createSpatialProgram,
  spatialVertexSource,
  spatialFragmentSource,
  type SpatialGeometryUniforms,
} from "./webgl2SpatialShaders.js";
import { validSpatialEnvironmentValues } from "./spatialEnvironment.js";
export interface SpatialRendererStats {
  triangleCount: number;
  /** Full static terrain and the chunks actually submitted this frame (v2 packets only). */
  terrainChunkCount: number;
  visibleTerrainChunkCount: number;
  culledTerrainChunkCount: number;
  terrainTriangleCount: number;
  billboardCount: number;
  drawCalls: number;
  billboardDrawCalls: number;
  textureBindCount: number;
  textureSwitchCount: number;
  uploadBytes: number;
  terrainUploadBytes: number;
  depthBufferBytes: number;
  debugLineCount: number;
  debugDrawCalls: number;
  debugUploadBytes: number;
  debugTruncated: boolean;
  lightCount: number;
  shadowPassCount: number;
  shadowDrawCalls: number;
  shadowTriangleCount: number;
  shadowUploadBytes: number;
  effectDrawCalls: number;
  effectTextureBytes: number;
  dofSampleBudget: number;
}
export class WebGL2SpatialPass {
  private readonly program: WebGLProgram;
  private readonly terrainBuffer: WebGLBuffer;
  private readonly spriteBuffer: WebGLBuffer;
  private readonly vao: WebGLVertexArrayObject;
  private readonly sampler: WebGLSampler;
  private readonly uniforms: SpatialGeometryUniforms &
    Record<string, WebGLUniformLocation>;
  private revision = -1;
  private memory?: ArrayBufferLike;
  private terrainBytes = 0;
  private spriteBytes = 0;
  private debugBuffer?: WebGLBuffer;
  private debugBytes = 0;
  private readonly targets = new Map<
    WebGLFramebuffer,
    { buffer: WebGLRenderbuffer; width: number; height: number }
  >();
  private environmentPass?: WebGL2SpatialEnvironmentPass;
  private shadowBuffer?: WebGLBuffer;
  private shadowBytes = 0;
  private destroyed = false;
  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly linearInput = false,
  ) {
    this.program = createSpatialProgram(
      gl,
      spatialVertexSource,
      spatialFragmentSource,
    );
    const a = gl.createBuffer(),
      b = gl.createBuffer(),
      vao = gl.createVertexArray(),
      sampler = gl.createSampler();
    if (!a || !b || !vao || !sampler) {
      if (a) gl.deleteBuffer(a);
      if (b) gl.deleteBuffer(b);
      if (vao) gl.deleteVertexArray(vao);
      if (sampler) gl.deleteSampler(sampler);
      gl.deleteProgram(this.program);
      throw new Error("Spatial GPU allocation failed");
    }
    this.terrainBuffer = a;
    this.spriteBuffer = b;
    this.vao = vao;
    this.sampler = sampler;
    const uniform = (name: string) => {
      const u = gl.getUniformLocation(this.program, name);
      if (u === null) throw new Error(`Spatial uniform missing: ${name}`);
      return u;
    };
    try {
      this.uniforms = {
        camera: uniform("u_camera"),
        texture: uniform("u_texture"),
        textured: uniform("u_textured"),
        flip: uniform("u_flip_y"),
      };
      for (const name of [
        "environment",
        "linearInput",
        "lighting",
        "fog",
        "ambient",
        "eye",
        "forward",
        "fogColor",
        "fogRange",
        "lightPosition",
        "lightColor",
        "lightCount",
        "shadowIndex",
        "shadowBias",
        "shadowMap",
      ])
        this.uniforms[name] = uniform(`u_${name}`);
      for (const name of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER])
        gl.samplerParameteri(sampler, name, gl.NEAREST);
      for (const name of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T])
        gl.samplerParameteri(sampler, name, gl.CLAMP_TO_EDGE);
    } catch (e) {
      this.destroy();
      throw e;
    }
  }
  draw(
    frame: SpatialRenderBufferView,
    textures: SpriteTextureSource,
  ): SpatialRendererStats {
    if (this.destroyed) throw new Error("Spatial pass destroyed");
    if (
      (frame.version !== 1 && frame.version !== 2) ||
      frame.vertexStride !== 11 ||
      frame.camera.length !== 28 ||
      frame.terrain.length !== frame.terrainVertexCount * 11 ||
      frame.billboards.length !== frame.billboardVertexCount * 11 ||
      frame.terrainVertexCount % 3 ||
      frame.billboardVertexCount % 6
    )
      throw new Error("Invalid spatial render buffer");
    const ranges = frame.terrainDrawRanges;
    let terrainVertices = frame.terrainVertexCount;
    if (frame.version === 2) {
      if (
        !(ranges instanceof Uint32Array) ||
        ranges.length % 2 ||
        ranges.length > 512 ||
        frame.terrainVertexCount % 36 ||
        frame.terrainVertexCount > 256 * 36
      )
        throw new Error("Invalid spatial terrain draw ranges");
      let previousEnd = 0;
      terrainVertices = 0;
      for (let i = 0; i < ranges.length; i += 2) {
        const first = ranges[i],
          count = ranges[i + 1];
        if (
          first % 36 ||
          count === 0 ||
          count % 36 ||
          first < previousEnd ||
          first + count > frame.terrainVertexCount
        )
          throw new Error("Invalid spatial terrain draw range bounds");
        previousEnd = first + count;
        terrainVertices += count;
      }
    } else if (ranges !== undefined) {
      throw new Error("Spatial v1 packets cannot contain terrain draw ranges");
    }
    const debug = frame.debug;
    if (
      debug !== undefined &&
      (!debug ||
        debug.version !== 1 ||
        debug.vertexStride !== 11 ||
        !(debug.vertices instanceof Float32Array) ||
        !Number.isInteger(debug.vertexCount) ||
        debug.vertexCount < 0 ||
        debug.vertexCount > 32768 ||
        debug.vertexCount % 2 !== 0 ||
        debug.vertices.length !== debug.vertexCount * 11 ||
        typeof debug.depthTest !== "boolean" ||
        typeof debug.truncated !== "boolean" ||
        debug.vertices.some((v) => !Number.isFinite(v)))
    )
      throw new Error("Invalid spatial debug buffer");
    const environment = frame.environment;
    if (
      environment !== undefined &&
      (!environment ||
        environment.version !== 1 ||
        !(environment.values instanceof Float32Array) ||
        !validSpatialEnvironmentValues(environment.values) ||
        !(environment.shadowMatrices instanceof Float32Array) ||
        !(environment.shadowCasters instanceof Float32Array) ||
        !Number.isInteger(environment.shadowCasterVertexCount) ||
        environment.shadowCasterVertexCount < 0 ||
        environment.shadowCasterVertexCount % 6 !== 0 ||
        environment.shadowCasterVertexCount > 1024 * 6 ||
        environment.shadowCasters.length !==
          environment.shadowCasterVertexCount * 11 ||
        environment.shadowCasters.some((x) => !Number.isFinite(x)) ||
        environment.shadowMatrices.some((x) => !Number.isFinite(x)) ||
        environment.shadowMatrices.length !==
          (environment.values[2] >= 0 ? 96 : 0) ||
        (environment.values[2] < 0 &&
          environment.shadowCasterVertexCount !== 0))
    )
      throw new Error("Invalid spatial environment buffer");
    const activeEnvironment =
      environment !== undefined && environment.values[0] !== 0;
    if (environment && environment.values[2] >= 0) {
      if (frame.terrainVertexCount > 256 * 36)
        throw new Error("Spatial shadow terrain budget exceeded");
      let batches = 0;
      for (const vertices of [frame.terrain, environment.shadowCasters]) {
        let last = -1;
        for (let i = 0; i < vertices.length; i += 33)
          if (vertices[i + 9] !== last) {
            batches++;
            last = vertices[i + 9];
          }
      }
      if (batches > 64)
        throw new Error("Spatial shadow texture batch budget exceeded");
    }
    if (
      [frame.camera, frame.terrain, frame.billboards].some((buffer) =>
        buffer.some((v) => !Number.isFinite(v)),
      )
    )
      throw new Error("Spatial buffer values must be finite");
    const gl = this.gl,
      target = gl.getParameter(
        gl.DRAW_FRAMEBUFFER_BINDING,
      ) as WebGLFramebuffer | null;
    const viewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
    if (!activeEnvironment) this.ensureDepth(target, viewport[2], viewport[3]);
    // Validate all textures before uploading or submitting any geometry.
    for (const buffer of [
      frame.terrain,
      frame.billboards,
      ...(environment ? [environment.shadowCasters] : []),
    ])
      for (let i = 0; i < buffer.length; i += 33) {
        const id = buffer[i + 9];
        if (id !== 16777215 && !textures.texture(id))
          throw new Error(`Spatial texture ${id} is missing`);
      }
    const previous = {
      depth: gl.isEnabled(gl.DEPTH_TEST),
      blend: gl.isEnabled(gl.BLEND),
      cull: gl.isEnabled(gl.CULL_FACE),
      depthMask: gl.getParameter(gl.DEPTH_WRITEMASK) as boolean,
      func: gl.getParameter(gl.DEPTH_FUNC) as number,
      clear: gl.getParameter(gl.DEPTH_CLEAR_VALUE) as number,
      program: gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null,
      vao: gl.getParameter(
        gl.VERTEX_ARRAY_BINDING,
      ) as WebGLVertexArrayObject | null,
      buffer: gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null,
      active: gl.getParameter(gl.ACTIVE_TEXTURE) as number,
      readFramebuffer: gl.getParameter(
        gl.READ_FRAMEBUFFER_BINDING,
      ) as WebGLFramebuffer | null,
      clearColor: gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array,
      scissor: gl.isEnabled(gl.SCISSOR_TEST),
      scissorBox: gl.getParameter(gl.SCISSOR_BOX) as Int32Array,
      colorMask: gl.getParameter(gl.COLOR_WRITEMASK) as boolean[],
    };
    gl.activeTexture(gl.TEXTURE0);
    const texture = gl.getParameter(
      gl.TEXTURE_BINDING_2D,
    ) as WebGLTexture | null;
    const sampler = gl.getParameter(gl.SAMPLER_BINDING) as WebGLSampler | null;
    gl.activeTexture(gl.TEXTURE1);
    const texture1 = gl.getParameter(
      gl.TEXTURE_BINDING_2D,
    ) as WebGLTexture | null;
    const cube1 = gl.getParameter(
      gl.TEXTURE_BINDING_CUBE_MAP,
    ) as WebGLTexture | null;
    const sampler1 = gl.getParameter(gl.SAMPLER_BINDING) as WebGLSampler | null;
    gl.activeTexture(gl.TEXTURE0);
    const stats: SpatialRendererStats = {
      triangleCount: (terrainVertices + frame.billboardVertexCount) / 3,
      terrainChunkCount:
        frame.version === 2 ? frame.terrainVertexCount / 36 : 0,
      visibleTerrainChunkCount: frame.version === 2 ? terrainVertices / 36 : 0,
      culledTerrainChunkCount:
        frame.version === 2
          ? (frame.terrainVertexCount - terrainVertices) / 36
          : 0,
      terrainTriangleCount: terrainVertices / 3,
      billboardCount: frame.billboardVertexCount / 6,
      drawCalls: 0,
      billboardDrawCalls: 0,
      textureBindCount: 0,
      textureSwitchCount: 0,
      uploadBytes: 0,
      terrainUploadBytes: 0,
      depthBufferBytes: this.depthBytes(),
      debugLineCount: 0,
      debugDrawCalls: 0,
      debugUploadBytes: 0,
      debugTruncated: debug?.truncated ?? false,
      lightCount: environment?.values[0]! & 1 ? environment!.values[1] : 0,
      shadowPassCount: 0,
      shadowDrawCalls: 0,
      shadowTriangleCount: 0,
      shadowUploadBytes: 0,
      effectDrawCalls: 0,
      effectTextureBytes: 0,
      dofSampleBudget: environment?.values[0]! & 4 ? 13 : 0,
    };
    try {
      if (activeEnvironment) {
        gl.disable(gl.SCISSOR_TEST);
        gl.colorMask(true, true, true, true);
      }
      if (!activeEnvironment) {
        this.releaseEnvironment();
      }
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.disable(gl.CULL_FACE);
      gl.clearDepth(1);
      if (!activeEnvironment) gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this.program);
      gl.bindVertexArray(this.vao);
      gl.bindSampler(0, this.sampler);
      gl.uniformMatrix4fv(
        this.uniforms.camera,
        false,
        frame.camera.subarray(0, 16),
      );
      gl.uniform1i(this.uniforms.texture, 0);
      gl.uniform1i(this.uniforms.shadowMap, 1);
      gl.uniform1i(this.uniforms.environment, 0);
      if (
        this.revision !== frame.terrainRevision ||
        this.memory !== frame.terrain.buffer
      ) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.terrainBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, frame.terrain, gl.STATIC_DRAW);
        this.terrainBytes = frame.terrain.byteLength;
        this.revision = frame.terrainRevision;
        this.memory = frame.terrain.buffer;
        stats.terrainUploadBytes = this.terrainBytes;
        stats.uploadBytes += this.terrainBytes;
      }
      if (activeEnvironment) {
        const effects = (this.environmentPass ??=
          new WebGL2SpatialEnvironmentPass(gl, this.linearInput));
        effects.prepare(frame, viewport[2], viewport[3]);
        const casters = environment!.shadowCasters;
        if (environment!.values[2] >= 0 && casters.length) {
          if (!this.shadowBuffer) {
            const b = gl.createBuffer();
            if (!b)
              throw new Error("Spatial shadow caster buffer allocation failed");
            this.shadowBuffer = b;
          }
          gl.bindBuffer(gl.ARRAY_BUFFER, this.shadowBuffer);
          if (casters.byteLength > this.shadowBytes) {
            this.shadowBytes = Math.max(
              casters.byteLength,
              this.shadowBytes * 2,
            );
            gl.bufferData(gl.ARRAY_BUFFER, this.shadowBytes, gl.DYNAMIC_DRAW);
          }
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, casters);
          stats.shadowUploadBytes = casters.byteLength;
          stats.uploadBytes += casters.byteLength;
        } else if (this.shadowBuffer && environment!.values[2] < 0) {
          gl.deleteBuffer(this.shadowBuffer);
          this.shadowBuffer = undefined;
          this.shadowBytes = 0;
        }
        const before = stats.drawCalls;
        stats.shadowPassCount = effects.drawShadows(frame, (u) => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindSampler(0, this.sampler);
          gl.bindVertexArray(this.vao);
          this.drawBuffer(
            this.terrainBuffer,
            frame.terrain,
            textures,
            stats,
            undefined,
            0,
            frame.terrainVertexCount,
            u,
          );
          if (casters.length)
            this.drawBuffer(
              this.shadowBuffer!,
              casters,
              textures,
              stats,
              undefined,
              0,
              environment!.shadowCasterVertexCount,
              u,
            );
        });
        stats.shadowDrawCalls = stats.drawCalls - before;
        stats.shadowTriangleCount =
          (stats.shadowPassCount *
            (frame.terrainVertexCount + environment!.shadowCasterVertexCount)) /
          3;
        stats.triangleCount += stats.shadowTriangleCount;
        effects.beginScene();
        // A resized HDR target can leave its own depth texture on unit 0.
        // Even an untextured debug draw must not sample an attached image.
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.useProgram(this.program);
        gl.bindVertexArray(this.vao);
        gl.bindSampler(0, this.sampler);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
        gl.disable(gl.CULL_FACE);
        effects.bindGeometry(frame, this.uniforms);
        stats.depthBufferBytes = this.depthBytes() + effects.depthBytes();
        stats.effectTextureBytes = effects.resourceStats().textureBytes;
      }
      let lastTexture: number | undefined;
      if (ranges === undefined) {
        lastTexture = this.drawBuffer(
          this.terrainBuffer,
          frame.terrain,
          textures,
          stats,
        );
      } else {
        for (let i = 0; i < ranges.length; i += 2)
          lastTexture = this.drawBuffer(
            this.terrainBuffer,
            frame.terrain,
            textures,
            stats,
            lastTexture,
            ranges[i],
            ranges[i + 1],
          );
      }
      if (frame.billboards.length) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteBuffer);
        if (frame.billboards.byteLength > this.spriteBytes) {
          this.spriteBytes = Math.max(
            frame.billboards.byteLength,
            this.spriteBytes * 2,
            1024,
          );
          gl.bufferData(gl.ARRAY_BUFFER, this.spriteBytes, gl.DYNAMIC_DRAW);
        }
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, frame.billboards);
        stats.uploadBytes += frame.billboards.byteLength;
        const terrainDrawCalls = stats.drawCalls;
        this.drawBuffer(
          this.spriteBuffer,
          frame.billboards,
          textures,
          stats,
          lastTexture,
        );
        stats.billboardDrawCalls = stats.drawCalls - terrainDrawCalls;
      }
      if (debug?.vertexCount) {
        if (!this.debugBuffer) {
          const buffer = gl.createBuffer();
          if (!buffer)
            throw new Error("Spatial debug buffer allocation failed");
          this.debugBuffer = buffer;
        }
        this.bindVertexBuffer(this.debugBuffer);
        if (debug.vertices.byteLength > this.debugBytes) {
          this.debugBytes = Math.min(
            32768 * 44,
            Math.max(debug.vertices.byteLength, this.debugBytes * 2, 1024),
          );
          gl.bufferData(gl.ARRAY_BUFFER, this.debugBytes, gl.DYNAMIC_DRAW);
        }
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, debug.vertices);
        debug.depthTest ? gl.enable(gl.DEPTH_TEST) : gl.disable(gl.DEPTH_TEST);
        gl.depthMask(false);
        gl.uniform1i(this.uniforms.textured, 0);
        gl.uniform1i(this.uniforms.flip, 0);
        gl.uniform1i(this.uniforms.lighting, 0);
        gl.uniform1i(this.uniforms.fog, 0);
        gl.drawArrays(gl.LINES, 0, debug.vertexCount);
        stats.debugLineCount = debug.vertexCount / 2;
        stats.debugDrawCalls = 1;
        stats.debugUploadBytes = debug.vertices.byteLength;
        stats.uploadBytes += stats.debugUploadBytes;
        stats.drawCalls++;
      }
      if (activeEnvironment) {
        gl.scissor(
          previous.scissorBox[0],
          previous.scissorBox[1],
          previous.scissorBox[2],
          previous.scissorBox[3],
        );
        previous.scissor
          ? gl.enable(gl.SCISSOR_TEST)
          : gl.disable(gl.SCISSOR_TEST);
        gl.colorMask(
          previous.colorMask[0],
          previous.colorMask[1],
          previous.colorMask[2],
          previous.colorMask[3],
        );
        this.environmentPass!.compositeScene(frame, target, viewport);
        stats.effectDrawCalls = 1;
        stats.drawCalls++;
        stats.triangleCount++;
        stats.textureBindCount += 2;
      }
    } finally {
      gl.scissor(
        previous.scissorBox[0],
        previous.scissorBox[1],
        previous.scissorBox[2],
        previous.scissorBox[3],
      );
      previous.scissor
        ? gl.enable(gl.SCISSOR_TEST)
        : gl.disable(gl.SCISSOR_TEST);
      gl.colorMask(
        previous.colorMask[0],
        previous.colorMask[1],
        previous.colorMask[2],
        previous.colorMask[3],
      );
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previous.readFramebuffer);
      gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);
      gl.clearColor(
        previous.clearColor[0],
        previous.clearColor[1],
        previous.clearColor[2],
        previous.clearColor[3],
      );
      gl.activeTexture(gl.TEXTURE1);
      gl.bindSampler(1, sampler1);
      gl.bindTexture(gl.TEXTURE_2D, texture1);
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, cube1);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindSampler(0, sampler);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.activeTexture(previous.active);
      gl.bindVertexArray(previous.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, previous.buffer);
      gl.useProgram(previous.program);
      gl.depthFunc(previous.func);
      gl.depthMask(previous.depthMask);
      gl.clearDepth(previous.clear);
      for (const [cap, on] of [
        [gl.DEPTH_TEST, previous.depth],
        [gl.BLEND, previous.blend],
        [gl.CULL_FACE, previous.cull],
      ] as const)
        on ? gl.enable(cap) : gl.disable(cap);
    }
    return stats;
  }
  private drawBuffer(
    gpu: WebGLBuffer,
    buffer: Float32Array,
    textures: SpriteTextureSource,
    stats: SpatialRendererStats,
    lastTexture?: number,
    first = 0,
    vertexCount = buffer.length / 11 - first,
    uniforms: SpatialGeometryUniforms = this.uniforms,
  ): number | undefined {
    const gl = this.gl;
    this.bindVertexBuffer(gpu);
    const vertices = first + vertexCount;
    while (first < vertices) {
      const id = buffer[first * 11 + 9];
      if (lastTexture !== undefined && lastTexture !== id)
        stats.textureSwitchCount++;
      lastTexture = id;
      let end = first + 3;
      while (end < vertices && buffer[end * 11 + 9] === id) end += 3;
      const texture = id === 16777215 ? undefined : textures.texture(id);
      gl.bindTexture(gl.TEXTURE_2D, texture ?? null);
      gl.uniform1i(uniforms.textured, texture ? 1 : 0);
      gl.uniform1i(uniforms.flip, textures.textureFlipY?.(id) ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, first, end - first);
      stats.drawCalls++;
      stats.textureBindCount++;
      first = end;
    }
    return lastTexture;
  }
  private bindVertexBuffer(gpu: WebGLBuffer): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu);
    for (const [location, size, offset] of [
      [0, 3, 0],
      [1, 2, 12],
      [2, 4, 20],
      [3, 1, 40],
    ]) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 44, offset);
    }
  }
  private ensureDepth(
    target: WebGLFramebuffer | null,
    width: number,
    height: number,
  ): void {
    const gl = this.gl;
    if (!target) {
      if (gl.getContextAttributes()?.depth === false)
        throw new Error("Spatial rendering requires a depth attachment");
      return;
    }
    const previous = gl.getParameter(
      gl.RENDERBUFFER_BINDING,
    ) as WebGLRenderbuffer | null;
    let item = this.targets.get(target);
    if (!item) {
      const buffer = gl.createRenderbuffer();
      if (!buffer) throw new Error("Spatial depth allocation failed");
      item = { buffer, width: 0, height: 0 };
      this.targets.set(target, item);
    }
    try {
      gl.bindRenderbuffer(gl.RENDERBUFFER, item.buffer);
      if (item.width !== width || item.height !== height) {
        gl.renderbufferStorage(
          gl.RENDERBUFFER,
          gl.DEPTH_COMPONENT24,
          width,
          height,
        );
        gl.framebufferRenderbuffer(
          gl.DRAW_FRAMEBUFFER,
          gl.DEPTH_ATTACHMENT,
          gl.RENDERBUFFER,
          item.buffer,
        );
        if (
          gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) !==
          gl.FRAMEBUFFER_COMPLETE
        )
          throw new Error("Spatial depth target incomplete");
        item.width = width;
        item.height = height;
      }
    } finally {
      gl.bindRenderbuffer(gl.RENDERBUFFER, previous);
    }
  }
  private depthBytes(): number {
    let n = 0;
    for (const t of this.targets.values()) n += t.width * t.height * 4;
    return n;
  }
  resourceStats() {
    return {
      bufferCount: this.destroyed
        ? 0
        : 2 +
          (this.debugBuffer ? 1 : 0) +
          (this.shadowBuffer ? 1 : 0) +
          this.targets.size,
      programCount: this.destroyed
        ? 0
        : 1 + (this.environmentPass?.programCount() ?? 0),
      bufferBytes: this.destroyed
        ? 0
        : this.terrainBytes +
          this.spriteBytes +
          this.debugBytes +
          this.shadowBytes +
          this.depthBytes(),
    };
  }
  releaseEnvironment(): void {
    this.environmentPass?.destroy();
    this.environmentPass = undefined;
    if (this.shadowBuffer) this.gl.deleteBuffer(this.shadowBuffer);
    this.shadowBuffer = undefined;
    this.shadowBytes = 0;
  }
  environmentResourceStats() {
    return (
      this.environmentPass?.resourceStats() ?? {
        textureCount: 0,
        renderTargetCount: 0,
        textureBytes: 0,
      }
    );
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.environmentPass?.destroy();
    this.environmentPass = undefined;
    const gl = this.gl;
    for (const t of this.targets.values()) gl.deleteRenderbuffer(t.buffer);
    this.targets.clear();
    gl.deleteSampler(this.sampler);
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.terrainBuffer);
    gl.deleteBuffer(this.spriteBuffer);
    if (this.debugBuffer) gl.deleteBuffer(this.debugBuffer);
    if (this.shadowBuffer) gl.deleteBuffer(this.shadowBuffer);
    gl.deleteProgram(this.program);
  }
}
