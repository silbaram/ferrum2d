import { spatialModelResource, type SpatialModelAsset, type SpatialModelPreparation } from "./spatialModel.js";
import { MODEL_INSTANCE_BUFFER_BYTES, WebGL2SpatialModels, type ModelMaterialUniforms } from "./webgl2SpatialModels.js";
import type { SpatialRenderBufferView } from "./dataSceneSpatial.js";
import type { SpriteTextureSource } from "./spriteBatch.js";
import { WebGL2SpatialEnvironmentPass } from "./webgl2SpatialEnvironmentPass.js";
import {
  createSpatialProgram,
  spatialVertexSource,
  spatialFragmentSource,
  type SpatialGeometryUniforms,
} from "./webgl2SpatialShaders.js";
import { SpatialShadowCache } from "./spatialShadowCache.js";
import { validSpatialEnvironmentValues } from "./spatialEnvironment.js";
export interface SpatialRendererStats {
  triangleCount: number;
  modelCount: number;
  visibleModelCount: number;
  modelDrawCalls: number;
  modelInstancedDrawCalls: number;
  /** Dynamic instance matrices, including shadow passes; immutable assets use modelUploadBytes. */
  modelInstanceUploadBytes: number;
  modelTriangleCount: number;
  modelUploadBytes: number;
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
  directionalLightCount: number;
  shadowPassCount: number;
  shadowDrawCalls: number;
  shadowTriangleCount: number;
  shadowUploadBytes: number;
  shadowCacheHit: boolean;
  shadowCulledTriangleCount: number;
  effectDrawCalls: number;
  effectTextureBytes: number;
  dofSampleBudget: number;
}
export class WebGL2SpatialPass {
  private readonly program: WebGLProgram;
  private readonly terrainBuffer: WebGLBuffer;
  private readonly spriteBuffer: WebGLBuffer;
  private readonly modelInstanceBuffer: WebGLBuffer;
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
  private shadowCache = new SpatialShadowCache();
  private destroyed = false;
  private readonly models: WebGL2SpatialModels;
  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly linearInput = false,
  ) {
    this.models = new WebGL2SpatialModels(gl);
    this.program = createSpatialProgram(
      gl,
      spatialVertexSource,
      spatialFragmentSource,
    );
    const a = gl.createBuffer(),
      b = gl.createBuffer(),
      instances = gl.createBuffer(),
      vao = gl.createVertexArray(),
      sampler = gl.createSampler();
    if (!a || !b || !instances || !vao || !sampler) {
      if (a) gl.deleteBuffer(a);
      if (b) gl.deleteBuffer(b);
      if (instances) gl.deleteBuffer(instances);
      if (vao) gl.deleteVertexArray(vao);
      if (sampler) gl.deleteSampler(sampler);
      gl.deleteProgram(this.program);
      throw new Error("Spatial GPU allocation failed");
    }
    this.terrainBuffer = a;
    this.spriteBuffer = b;
    this.modelInstanceBuffer = instances;
    this.vao = vao;
    this.sampler = sampler;
    const uniform = (name: string) => {
      const u = gl.getUniformLocation(this.program, name);
      if (u === null) throw new Error(`Spatial uniform missing: ${name}`);
      return u;
    };
    try {
      // Fixed capacity is allocated before authoring activation, never in a frame loop.
      const previous = gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
      try {
        gl.bindBuffer(gl.ARRAY_BUFFER, instances);
        gl.bufferData(gl.ARRAY_BUFFER, MODEL_INSTANCE_BUFFER_BYTES, gl.DYNAMIC_DRAW);
        if (gl.getError() !== gl.NO_ERROR || gl.isContextLost())
          throw Error("Spatial instance buffer allocation failed");
      } finally { gl.bindBuffer(gl.ARRAY_BUFFER, previous); }
      this.uniforms = {
        camera: uniform("u_camera"),
        model: uniform("u_model"),mesh:uniform("u_mesh"),instanced:uniform("u_instanced"),
        modelColor: uniform("u_modelColor"),modelCutoff:uniform("u_modelCutoff"),
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
        "normalMap",
        "hasNormal", "modelNormalScale", "emissiveMap", "hasEmissive", "emissiveFactor", "modelUnlit",
        "receiveShadow",
        "shadowFilter", "sunDirection", "sunColor", "sunShadow", "sunParams", "sunMatrix", "sunMap",
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
  prepareModels(assets: readonly SpatialModelAsset[]): SpatialModelPreparation {
    if (this.destroyed) throw Error("Spatial pass destroyed");
    if (!Array.isArray(assets) || assets.length > 16)
      throw Error("Spatial model preparation asset budget exceeded");
    const sources = assets.map(asset => {
      const source = spatialModelResource(asset);
      if (!source) throw Error("Spatial model preparation requires a loaded GLB asset");
      return source;
    });
    if (assets.reduce((n, a) => n + a.byteLength, 0) > 128 * 1024 * 1024)
      throw Error("Spatial model preparation byte budget exceeded");
    if (this.gl.isContextLost()) throw Error("WebGL2 context lost during model preparation");
    return this.models.stage(sources);
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
    this.models.validate(frame.models);
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
    const presentation = frame.presentation;
    if (presentation && (!(presentation instanceof Float32Array) || presentation.length !== 6 || presentation.some(x => !Number.isFinite(x)) ||
      presentation[0] < 0 || presentation[1] < 0 || presentation[2] <= 0 || presentation[3] <= 0 || presentation[0] + presentation[2] > 1.00001 || presentation[1] + presentation[3] > 1.00001)) throw new Error("Invalid spatial presentation viewport");
    const materials = frame.materials;
    if (materials) {
      if (materials.version !== 1) throw new Error("Invalid spatial material version");
      for (const [data, vertices, stride] of [[materials.terrain, frame.terrain, 36], [materials.billboards, frame.billboards, 6]] as const) {
        if (!(data instanceof Uint32Array) || data.length % 2 || data.length > vertices.length / 11 / stride * 2) throw new Error("Invalid spatial material buffer");
        for (let i = 0; i < data.length; i += 2) {
          const id = data[i];
          if (id > 16777215 || data[i + 1] > 3) throw new Error("Invalid spatial material reference");
          if (id !== 16777215) {
            const colorId = vertices[(i / 2 * stride) * 11 + 9], normal = textures.textureInfo?.(id), color = textures.textureInfo?.(colorId);
            if (!normal || !color || normal.colorSpace === "srgb" || normal.width !== color.width || normal.height !== color.height) throw new Error("Spatial normal atlas must be loaded with colorSpace: none or linear and match the color atlas dimensions");
            textures.texture(id);
          }
        }
      }
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
        (environment.version !== 1 && environment.version !== 2) ||
        !(environment.values instanceof Float32Array) ||
        environment.values.length !== (environment.version === 1 ? 80 : 112) ||
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
          ((environment.values[2] >= 0 ? 96 : 0) + (environment.values.length > 80 && environment.values[92] > 0 ? 16 : 0)) ||
        (environment.values[2] < 0 && !(environment.values[92] > 0) &&
          environment.shadowCasterVertexCount !== 0))
    )
      throw new Error("Invalid spatial environment buffer");
    const submission = environment?.shadowSubmission;
    if (submission) {
      if (submission.version !== 1 || !Number.isInteger(submission.revision) || submission.revision < 0 || submission.revision > 0xffffffff ||
          !(submission.ranges instanceof Uint32Array) || submission.ranges.length % 4 || submission.ranges.length > 35840)
        throw new Error("Invalid shadow submission buffer");
      let previousFace = -1, previousSource = -1, previousEnd = 0;
      const batches = new Uint32Array(7);
      for (let i = 0; i < submission.ranges.length; i += 4) {
        const [face, source, first, count] = submission.ranges.subarray(i, i + 4);
        const stride = source === 0 ? 36 : 6;
        const vertices = source === 0 ? frame.terrain : environment!.shadowCasters;
        if (face > 6 || (face === 6 && !(environment!.values[92] > 0)) || source > 1 || count === 0 || first % stride || count % stride ||
            first + count > vertices.length / 11 || face < previousFace ||
            (face === previousFace && (source < previousSource || (source === previousSource && first < previousEnd))))
          throw new Error("Invalid shadow submission range");
        let last = -1;
        for (let v = first * 11; v < (first + count) * 11; v += 33) if (vertices[v + 9] !== last) {
          batches[face]++; last = vertices[v + 9];
        }
        if (batches[face] > 64) throw new Error("Shadow face batch budget exceeded");
        previousFace = face; previousSource = source; previousEnd = first + count;
      }
    }
    const activeEnvironment =
      environment !== undefined && environment.values[0] !== 0;
    if (environment && (environment.values[2] >= 0 || environment.values[92] > 0)) {
      if (frame.terrainVertexCount > 256 * 36)
        throw new Error("Spatial shadow terrain budget exceeded");
      let batches = 0;
      for (const vertices of [frame.terrain, environment.shadowCasters]) {
        let last = -1;
        for (let i = 0; i < vertices.length; i += 33) {
          const flags = vertices === frame.terrain ? frame.materials?.terrain[Math.floor(i / 396) * 2 + 1] ?? 3 : 3;
          if (!(flags & 1)) { last = -1; continue; }
          if (vertices[i + 9] !== last) { batches++; last = vertices[i + 9]; }
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
    const displayViewport = presentation && presentation[4] > 0 ? Int32Array.from([
      viewport[0] + Math.round(viewport[2] * presentation[0]), viewport[1] + Math.round(viewport[3] * (1 - presentation[1] - presentation[3])),
      Math.max(1, Math.round(viewport[2] * presentation[2])), Math.max(1, Math.round(viewport[3] * presentation[3])),
    ]) : viewport;
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
      front: gl.getParameter(gl.FRONT_FACE) as number,
      cullMode:gl.getParameter(gl.CULL_FACE_MODE) as number,
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
    gl.activeTexture(gl.TEXTURE2);
    const texture2 = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
    const sampler2 = gl.getParameter(gl.SAMPLER_BINDING) as WebGLSampler | null;
    gl.activeTexture(gl.TEXTURE3);
    const texture3 = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
    const sampler3 = gl.getParameter(gl.SAMPLER_BINDING) as WebGLSampler | null;
    gl.activeTexture(gl.TEXTURE4);
    const texture4 = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
    const sampler4 = gl.getParameter(gl.SAMPLER_BINDING) as WebGLSampler | null;
    gl.activeTexture(gl.TEXTURE0);
    const stats: SpatialRendererStats = {
      modelCount:(frame.models?.words.length ?? 0)/20,visibleModelCount:0,modelDrawCalls:0,modelInstancedDrawCalls:0,modelInstanceUploadBytes:0,modelTriangleCount:0,modelUploadBytes:0,
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
      directionalLightCount: environment?.values[83] === 1 ? 1 : 0,
      shadowPassCount: 0,
      shadowDrawCalls: 0,
      shadowTriangleCount: 0,
      shadowUploadBytes: 0,
      shadowCacheHit: false,
      shadowCulledTriangleCount: 0,
      effectDrawCalls: 0,
      effectTextureBytes: 0,
      dofSampleBudget: environment?.values[0]! & 4 ? (environment!.values[96] === 1 ? 25 : 13) : 0,
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
      this.models.prepare(frame.models,stats);
      gl.uniform1i(this.uniforms.mesh,0);
      gl.bindSampler(0, this.sampler);
      gl.uniformMatrix4fv(
        this.uniforms.camera,
        false,
        frame.camera.subarray(0, 16),
      );
      gl.uniform1i(this.uniforms.texture, 0);
      gl.uniform1i(this.uniforms.shadowMap, 1);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindSampler(2, this.sampler);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(this.uniforms.emissiveMap, 4);
      gl.uniform1i(this.uniforms.normalMap, 2);
      gl.uniform1i(this.uniforms.hasNormal, 0);
      gl.uniform1i(this.uniforms.receiveShadow, 1);
      gl.uniform1i(this.uniforms.environment, 0);
      gl.uniform1i(this.uniforms.linearInput,Number(this.linearInput));
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
        const shadowReady = effects.shadowReady(environment!.values);
        effects.prepare(frame, presentation && presentation[4] > 0 ? presentation[4] : viewport[2], presentation && presentation[5] > 0 ? presentation[5] : viewport[3]);
        const casters = environment!.shadowCasters;
        const hasShadows = environment!.values[2] >= 0 || environment!.values[92] > 0;
        // Collect texture revisions even for a new target so its first successful render can be cached.
        const cacheMatches = hasShadows && this.shadowCache.matches(frame, textures);
        const cacheHit = shadowReady && cacheMatches;
        stats.shadowCacheHit = cacheHit;
        const modelPasses = 1 | (cacheHit ? 0 : (environment!.values[2] >= 0 ? 126 : 0) | (environment!.values[92] > 0 ? 128 : 0));
        this.models.prepareDraws(frame.models, modelPasses, this.modelInstanceBuffer, stats);
        if (!cacheHit && hasShadows && casters.length) {
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
        } else if (this.shadowBuffer && !hasShadows) {
          gl.deleteBuffer(this.shadowBuffer);
          this.shadowBuffer = undefined;
          this.shadowBytes = 0;
        }
        const before = stats.drawCalls;
        if (!cacheHit) {
          const submit = (u: SpatialGeometryUniforms, face: number) => {
            const ranges = environment!.shadowSubmission?.ranges;
            gl.activeTexture(gl.TEXTURE0);
            gl.bindSampler(0, this.sampler);
            gl.bindVertexArray(this.vao);
            const draw = (source: number, first: number, count: number) => {
              this.drawBuffer(source === 0 ? this.terrainBuffer : this.shadowBuffer!, source === 0 ? frame.terrain : casters,
                textures, stats, undefined, first, count, u);
              stats.shadowTriangleCount += count / 3;
            };
            if (ranges) {
              for (let i = 0; i < ranges.length; i += 4) if (ranges[i] === face) draw(ranges[i + 1], ranges[i + 2], ranges[i + 3]);
            } else {
              const meta = frame.materials?.terrain;
              if (!meta) draw(0, 0, frame.terrainVertexCount);
              else {
                let first = 0, count = 0;
                for (let object = 0; object < frame.terrainVertexCount / 36; object++) {
                  if ((meta[object * 2 + 1] ?? 3) & 1) { if (!count) first = object * 36; count += 36; }
                  else if (count) { draw(0, first, count); count = 0; }
                }
                if (count) draw(0, first, count);
              }
              if (casters.length) draw(1, 0, environment!.shadowCasterVertexCount);
            }
            this.models.draw(frame.models,face===6?7:face+1,u,stats,this.modelInstanceBuffer);
          };
          stats.shadowPassCount = effects.drawShadows(frame, submit) + effects.drawSunShadow(frame, submit);
          if (stats.shadowPassCount) this.shadowCache.commit(frame);
        }
        stats.shadowDrawCalls = stats.drawCalls - before;
        if (environment!.shadowSubmission && !cacheHit) {
          const modelTriangles=frame.models ? Array.from(frame.models.words).reduce((n,_,i)=>i%20===0 ? n+frame.models!.assets.get(frame.models!.words[i])!.triangleCount : n,0) : 0;
          stats.shadowCulledTriangleCount = stats.shadowPassCount * ((frame.terrainVertexCount + environment!.shadowCasterVertexCount) / 3 + modelTriangles) - stats.shadowTriangleCount;
        }
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
      if (!activeEnvironment) this.models.prepareDraws(frame.models, 1, this.modelInstanceBuffer, stats);
      let lastTexture: number | undefined;
      const drawTerrain = (first: number, count: number) => {
        lastTexture = this.drawBuffer(this.terrainBuffer, frame.terrain, textures, stats, lastTexture, first, count, this.uniforms, materials?.terrain, 36);
      };
      if (ranges === undefined) drawTerrain(0, frame.terrainVertexCount);
      else for (let i = 0; i < ranges.length; i += 2) drawTerrain(ranges[i], ranges[i + 1]);
      gl.uniform1i(this.uniforms.hasNormal,0);
      this.models.draw(frame.models,0,this.uniforms,stats,this.modelInstanceBuffer,this.uniforms.receiveShadow,this.uniforms as typeof this.uniforms & ModelMaterialUniforms);
      gl.bindSampler(0,this.sampler);
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
          lastTexture, 0, frame.billboardVertexCount, this.uniforms, materials?.billboards, 6,
        );
        stats.billboardDrawCalls = stats.drawCalls - terrainDrawCalls;
      }
      if (debug?.vertexCount) {
        gl.uniform1i(this.uniforms.hasNormal, 0);
        gl.uniform1i(this.uniforms.receiveShadow, 1);
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
        this.environmentPass!.compositeScene(frame, target, displayViewport);
        stats.effectDrawCalls = 1;
        stats.drawCalls++;
        stats.triangleCount++;
        stats.textureBindCount += 2;
      }
    } finally {
      this.models.finishDraws();
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
      gl.activeTexture(gl.TEXTURE4);
      gl.bindSampler(4, sampler4);
      gl.bindTexture(gl.TEXTURE_2D, texture4);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindSampler(3, sampler3);
      gl.bindTexture(gl.TEXTURE_2D, texture3);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindSampler(2, sampler2);
      gl.bindTexture(gl.TEXTURE_2D, texture2);
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
      gl.frontFace(previous.front);gl.cullFace(previous.cullMode);
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
    materials?: Uint32Array,
    materialStride = 6,
  ): number | undefined {
    const gl = this.gl;
    gl.uniform1i(uniforms.mesh,0);
    this.bindVertexBuffer(gpu);
    const vertices = first + vertexCount;
    while (first < vertices) {
      const id = buffer[first * 11 + 9];
      if (lastTexture !== undefined && lastTexture !== id)
        stats.textureSwitchCount++;
      lastTexture = id;
      const material = (vertex: number, field: number) => materials?.[Math.floor(vertex / materialStride) * 2 + field] ?? (field === 0 ? 16777215 : 3);
      const normal = material(first, 0), flags = material(first, 1);
      let end = first + 3;
      while (end < vertices && buffer[end * 11 + 9] === id && material(end, 0) === normal && material(end, 1) === flags) end += 3;
      if (uniforms === this.uniforms) {
        gl.uniform1i(this.uniforms.hasNormal, normal === 16777215 ? 0 : 1);
        gl.uniform1i(this.uniforms.receiveShadow, flags & 2 ? 1 : 0);
        if (normal !== 16777215) {
          gl.activeTexture(gl.TEXTURE2);
          gl.bindSampler(2, this.sampler);
          gl.bindTexture(gl.TEXTURE_2D, textures.texture(normal));
          stats.textureBindCount++;
          gl.activeTexture(gl.TEXTURE0);
        }
      }
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
    gl.disableVertexAttribArray(4);
    gl.disableVertexAttribArray(5);
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
        : 3 + this.models.resources().buffers +
          (this.debugBuffer ? 1 : 0) +
          (this.shadowBuffer ? 1 : 0) +
          this.targets.size,
      programCount: this.destroyed
        ? 0
        : 1 + (this.environmentPass?.programCount() ?? 0),
      bufferBytes: this.destroyed
        ? 0
        : MODEL_INSTANCE_BUFFER_BYTES + this.models.resources().bytes + this.terrainBytes +
          this.spriteBytes +
          this.debugBytes +
          this.shadowBytes +
          this.depthBytes(),
    };
  }
  releaseEnvironment(): void {
    this.shadowCache = new SpatialShadowCache();
    this.environmentPass?.destroy();
    this.environmentPass = undefined;
    if (this.shadowBuffer) this.gl.deleteBuffer(this.shadowBuffer);
    this.shadowBuffer = undefined;
    this.shadowBytes = 0;
  }
  environmentResourceStats() {
    const resources = (
      this.environmentPass?.resourceStats() ?? {
        textureCount: 0,
        renderTargetCount: 0,
        textureBytes: 0,
      }
    );
    const models=this.models.resources();
    return {...resources,textureCount:resources.textureCount+models.textures,textureBytes:resources.textureBytes+models.textureBytes};
  }
  releaseModels(): void { this.models.clear(); }
  destroy(): void {
    this.models.destroy();
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
    gl.deleteBuffer(this.modelInstanceBuffer);
    if (this.debugBuffer) gl.deleteBuffer(this.debugBuffer);
    if (this.shadowBuffer) gl.deleteBuffer(this.shadowBuffer);
    gl.deleteProgram(this.program);
  }
}
