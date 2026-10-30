import { beginWebGpuRenderPass } from "./webgpuGpuTimer.js";
import { webGpuResources } from "./webgpuResources.js";
import { spatialShadowGeometryWGSL } from "./webgpuSpatialShadows.js";
import { SpatialShadowCache } from "./spatialShadowCache.js";
import { spatialGeometryWGSL } from "./webgpuSpatialShaders.js";
import { WebGpuSpatialEnvironment } from "./webgpuSpatialEnvironment.js";
import type { SpatialRenderBufferView } from "./dataSceneSpatial.js";
import type { SpatialRendererStats } from "./renderer.js";
import type { WebGpuTextureStore } from "./webgpuTextureStore.js";
import { validateSpatialGeometryFrame, validateSpatialExtensions } from "./spatialRenderPacket.js";
import { WebGpuSpatialModels } from "./webgpuSpatialModels.js";
import type { SpatialModelAsset, SpatialModelPreparation } from "./spatialModel.js";
const NO_TEXTURE = 0xffffff,
  STRIDE = 44;
const EMPTY_VERTICES = new Float32Array();
// Covers native authored billboards, glyphs and particles without unbounded GPU allocations.
const MAX_VERTEX_BYTES = 64 * 1024 * 1024;
/** Platform pass for the unchanged native spatial v1/v2 geometry ABI. */
export class WebGpuSpatialPass {
  private readonly pipelines: GPURenderPipeline[] = [];
  private readonly debugPipelines: GPURenderPipeline[] = [];
  private readonly shadowPipeline: GPURenderPipeline;
  private readonly shadowCache = new SpatialShadowCache();
  private readonly cameraGroups: GPUBindGroup[];
  private readonly cameraValues = new Float32Array(8 * 64);
  private shadowCasters?: GPUBuffer;
  private shadowCapacity = 0;
  private pendingShadowCommit = false;
  private readonly environment: WebGpuSpatialEnvironment;
  private readonly flatNormal: GPUTexture;
  private readonly normalGroup: GPUBindGroup;
  private debug?: GPUBuffer;
  private debugCapacity = 0;
  private readonly uniform: GPUBuffer;
  private readonly cameraGroup: GPUBindGroup;
  private readonly white: GPUTexture;
  private readonly whiteGroup: GPUBindGroup;
  private readonly models: WebGpuSpatialModels;
  private terrain?: GPUBuffer;
  private billboards?: GPUBuffer;
  private terrainCapacity = 0;
  private billboardCapacity = 0;
  private revision = -1;
  private terrainMemory?: ArrayBufferLike;
  private terrainOffset = -1;
  private terrainLength = -1;
  private depth?: GPUTexture;
  private depthView?: GPUTextureView;
  private width = 0;
  private height = 0;
  private destroyed = false;
  constructor(
    private readonly device: GPUDevice,
    format: GPUTextureFormat,
    private readonly textureLayout: GPUBindGroupLayout,
    private readonly textures: WebGpuTextureStore,
  ) {
    const cameraLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
      ],
    });
    this.environment = new WebGpuSpatialEnvironment(device, format);
    const module = device.createShaderModule({
      label: "Ferrum spatial geometry/environment",
      code: spatialGeometryWGSL,
    });
    const layout = device.createPipelineLayout({
      bindGroupLayouts: [cameraLayout, textureLayout, this.environment.layout, textureLayout],
    });
    const vertex: GPUVertexState = {
      module,
      entryPoint: "vs_main",
      buffers: [
        {
          arrayStride: STRIDE,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 12, format: "float32x2" },
            { shaderLocation: 2, offset: 20, format: "float32x4" },
            { shaderLocation: 3, offset: 40, format: "float32" },
          ],
        },
      ],
    };
    for (const outputFormat of [format, "rgba16float"]) {
      this.pipelines.push(
        webGpuResources(device).createRenderPipeline({
          label: "Ferrum spatial depth/cutout",
          layout,
          vertex,
          fragment: { module, entryPoint: "fs_main", targets: [{ format: outputFormat }] },
          primitive: { topology: "triangle-list" },
          depthStencil: {
            format: "depth24plus",
            depthWriteEnabled: true,
            depthCompare: "less-equal",
          },
        }),
      );
      for (const depthTest of [true, false])
        this.debugPipelines.push(
          webGpuResources(device).createRenderPipeline({
            label: "Spatial debug lines",
            layout,
            vertex,
            fragment: { module, entryPoint: "fs_debug", targets: [{ format: outputFormat }] },
            primitive: { topology: "line-list" },
            depthStencil: {
              format: "depth24plus",
              depthWriteEnabled: false,
              depthCompare: depthTest ? "less-equal" : "always",
            },
          }),
        );
    }
    const shadowModule = device.createShaderModule({
      label: "Spatial terrain/billboard shadow",
      code: spatialShadowGeometryWGSL,
    });
    this.shadowPipeline = webGpuResources(device).createRenderPipeline({
      label: "Spatial shadow geometry",
      layout: device.createPipelineLayout({ bindGroupLayouts: [cameraLayout, textureLayout] }),
      vertex: { ...vertex, module: shadowModule },
      fragment: { module: shadowModule, entryPoint: "fs_main", targets: [] },
      primitive: { topology: "triangle-list" },
      depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "less" },
    });
    this.uniform = webGpuResources(device).createBuffer({
      label: "Spatial camera",
      size: 8 * 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.cameraGroups = Array.from({ length: 8 }, (_, i) =>
      device.createBindGroup({
        layout: cameraLayout,
        entries: [{ binding: 0, resource: { buffer: this.uniform, offset: i * 256, size: 96 } }],
      }),
    );
    this.cameraGroup = this.cameraGroups[0];
    // Never alias the public texture0: it can be replaced by the consumer.
    this.white = webGpuResources(device).createTexture({
      label: "Spatial untextured white",
      size: [1, 1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
      { texture: this.white },
      new Uint8Array([255, 255, 255, 255]),
      { bytesPerRow: 4 },
      [1, 1, 1],
    );
    this.whiteGroup = device.createBindGroup({
      layout: textureLayout,
      entries: [
        {
          binding: 0,
          resource: device.createSampler({ minFilter: "nearest", magFilter: "nearest" }),
        },
        { binding: 1, resource: this.white.createView() },
      ],
    });
    this.flatNormal = webGpuResources(device).createTexture({
      label: "Spatial neutral normal",
      size: [1, 1, 1],
      format: "rgba16float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
      { texture: this.flatNormal },
      new Uint16Array([0x3800, 0x3800, 0x3c00, 0x3c00]),
      { bytesPerRow: 8 },
      [1, 1, 1],
    );
    this.normalGroup = device.createBindGroup({
      layout: textureLayout,
      entries: [
        {
          binding: 0,
          resource: device.createSampler({ minFilter: "nearest", magFilter: "nearest" }),
        },
        { binding: 1, resource: this.flatNormal.createView() },
      ],
    });
    this.models = new WebGpuSpatialModels(device, format, cameraLayout, this.environment.layout);
  }
  prepareModels(assets: readonly SpatialModelAsset[]): SpatialModelPreparation {
    return this.models.stage(assets);
  }
  preloadModels(assets: readonly SpatialModelAsset[]): Promise<number> {
    return this.models.preload(assets);
  }
  /** Reject the entire packet before resource allocation, queue upload or drawing. */
  validate(frame: SpatialRenderBufferView): number {
    if (this.destroyed) throw Error("Spatial pass destroyed");
    const vertices = validateSpatialGeometryFrame(frame);
    validateSpatialExtensions(frame);
    if (
      frame.terrain.byteLength > MAX_VERTEX_BYTES ||
      frame.billboards.byteLength > MAX_VERTEX_BYTES
    )
      throw Error("WebGPU spatial vertex budget exceeded");
    this.models.validate(frame.models);
    for (const [data, count] of [
      [frame.materials?.terrain, frame.terrainVertexCount / 36],
      [frame.materials?.billboards, frame.billboardVertexCount / 6],
    ] as const)
      if (data) {
        if (
          !(data instanceof Uint32Array) ||
          data.length % 2 ||
          data.length > count * 2 ||
          frame.materials?.version !== 1
        )
          throw Error("Invalid spatial material buffer");
        for (let i = 0; i < data.length; i += 2) {
          if (data[i] > NO_TEXTURE || data[i + 1] > 3)
            throw Error("Invalid spatial material flags");
          if (data[i] !== NO_TEXTURE) {
            const geometry = data === frame.materials?.terrain ? frame.terrain : frame.billboards;
            const stride = data === frame.materials?.terrain ? 36 : 6;
            const normal = this.textures.resource(data[i]),
              color = this.textures.resource(geometry[(i / 2) * stride * 11 + 9]);
            if (
              (normal.colorSpace !== "none" && normal.colorSpace !== "linear") ||
              normal.width !== color.width ||
              normal.height !== color.height
            )
              throw Error(
                "Spatial normal atlas must be non-color and match color atlas dimensions",
              );
          }
        }
      }
    for (const data of [
      frame.terrain,
      frame.billboards,
      frame.environment?.shadowCasters ?? EMPTY_VERTICES,
    ])
      for (let first = 0; first < data.length; first += 33) {
        const id = data[first + 9];
        if (
          !Number.isInteger(id) ||
          id < 0 ||
          id > NO_TEXTURE ||
          data[first + 20] !== id ||
          data[first + 31] !== id
        )
          throw Error("Invalid spatial triangle texture");
        if (id !== NO_TEXTURE) this.textures.resource(id);
      }
    return vertices;
  }
  draw(
    frame: SpatialRenderBufferView,
    encoder: GPUCommandEncoder,
    target: GPUTextureView,
    width: number,
    height: number,
  ): SpatialRendererStats {
    this.pendingShadowCommit = false;
    const terrainVertices = this.validate(frame);
    const [sceneWidth, sceneHeight] = this.environment.validate(frame, width, height);
    const stats = spatialStats(frame, terrainVertices);
    this.models.prepare(frame.models);
    const env = frame.environment,
      hasShadows = !!env && (env.values[2] >= 0 || env.values[92] > 0);
    const matches = hasShadows && this.shadowCache.matches(frame, this.textures);
    const cacheHit = hasShadows && this.environment.shadows.ready(frame) && matches;
    stats.shadowCacheHit = cacheHit;
    this.environment.prepare(frame, sceneWidth, sceneHeight);
    const hdr = this.environment.scene();
    if (!hdr && (width !== this.width || height !== this.height || !this.depth)) {
      const replacement = webGpuResources(this.device).createTexture({
        label: "Spatial depth",
        size: [width, height, 1],
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      const view = replacement.createView();
      webGpuResources(this.device).destroy(this.depth);
      this.depth = replacement;
      this.depthView = view;
      this.width = width;
      this.height = height;
    } else if (hdr) {
      webGpuResources(this.device).destroy(this.depth);
      this.depth = undefined;
      this.depthView = undefined;
      this.width = 0;
      this.height = 0;
    }
    stats.depthBufferBytes = sceneWidth * sceneHeight * 4;
    stats.effectTextureBytes =
      this.environment.textureBytes() + this.environment.shadows.textureBytes();
    stats.lightCount = frame.environment?.values[0]! & 1 ? frame.environment!.values[1] : 0;
    stats.directionalLightCount = frame.environment?.values[83] === 1 ? 1 : 0;
    stats.authoredLightCount=frame.environment?.values[137]??frame.environment?.values[1]??0;
    stats.bloomSampleBudget=frame.environment?.values[128]===1 && frame.environment.values[129]>0 ?32:0;
    stats.ambientOcclusionSampleBudget=frame.environment?.values[132]===1 && frame.environment.values[133]>0 ?16:0;
    stats.dofSampleBudget =
      frame.environment?.values[0]! & 4 ? (frame.environment!.values[96] === 1 ? 25 : 13) : 0;
    this.cameraValues.fill(0);
    this.cameraValues.set(frame.camera.subarray(0, 16));
    if (hasShadows && !cacheHit)
      for (let face = 0; face < 7; face++) {
        if ((face < 6 && env!.values[2] < 0) || (face === 6 && !(env!.values[92] > 0))) continue;
        const offset = (face + 1) * 64,
          matrix = face < 6 ? face * 16 : env!.shadowMatrices.length - 16;
        this.cameraValues.set(env!.shadowMatrices.subarray(matrix, matrix + 16), offset);
        if (face < 6) {
          const light = 12 + env!.values[2] * 12;
          this.cameraValues.set(env!.values.subarray(light, light + 4), offset + 16);
        } else this.cameraValues[offset + 20] = 1;
      }
    this.device.queue.writeBuffer(
      this.uniform,
      0,
      this.cameraValues.subarray(0, hasShadows && !cacheHit ? 512 : 24),
    );
    this.models.uploadInstances(frame.models, hasShadows && !cacheHit, stats);
    if (frame.terrain.byteLength) {
      const stale =
        !this.terrain ||
        this.revision !== frame.terrainRevision ||
        this.terrainMemory !== frame.terrain.buffer ||
        this.terrainOffset !== frame.terrain.byteOffset ||
        this.terrainLength !== frame.terrain.length;
      if (stale) {
        if (frame.terrain.byteLength > this.terrainCapacity || !this.terrain) {
          const capacity = grow(this.terrainCapacity, frame.terrain.byteLength);
          const buffer = webGpuResources(this.device).createBuffer({
            label: "Spatial terrain",
            size: capacity,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
          });
          webGpuResources(this.device).destroy(this.terrain);
          this.terrain = buffer;
          this.terrainCapacity = capacity;
        }
        this.device.queue.writeBuffer(this.terrain, 0, frame.terrain);
        stats.uploadBytes += frame.terrain.byteLength;
        stats.terrainUploadBytes += frame.terrain.byteLength;
        this.revision = frame.terrainRevision;
        this.terrainMemory = frame.terrain.buffer;
        this.terrainOffset = frame.terrain.byteOffset;
        this.terrainLength = frame.terrain.length;
      }
    }
    if (frame.billboards.byteLength) {
      if (frame.billboards.byteLength > this.billboardCapacity || !this.billboards) {
        const capacity = grow(this.billboardCapacity, frame.billboards.byteLength);
        const buffer = webGpuResources(this.device).createBuffer({
          label: "Spatial billboards",
          size: capacity,
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        webGpuResources(this.device).destroy(this.billboards);
        this.billboards = buffer;
        this.billboardCapacity = capacity;
      }
      this.device.queue.writeBuffer(this.billboards, 0, frame.billboards);
      stats.uploadBytes += frame.billboards.byteLength;
    }
    if (hasShadows && !cacheHit) this.submitShadows(frame, encoder, stats);
    else if (!hasShadows) {
      webGpuResources(this.device).destroy(this.shadowCasters);
      this.shadowCasters = undefined;
      this.shadowCapacity = 0;
    }
    const pass = beginWebGpuRenderPass(this.device, encoder, {
      label: "Spatial geometry",
      colorAttachments: [
        {
          view: hdr?.color ?? target,
          loadOp: hdr ? "clear" : "load",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        },
      ],
      depthStencilAttachment: {
        view: hdr?.depth ?? this.depthView!,
        depthLoadOp: "clear",
        depthStoreOp: "store",
        depthClearValue: 1,
      },
    });
    pass.setPipeline(this.pipelines[hdr ? 1 : 0]);
    pass.setBindGroup(0, this.cameraGroup);
    pass.setBindGroup(2, this.environment.group);
    let previous: number | undefined;
    const draw = (
      gpu: GPUBuffer,
      data: Float32Array,
      first: number,
      count: number,
      materials: Uint32Array | undefined,
      objectStride: number,
    ) => {
      pass.setVertexBuffer(0, gpu);
      const limit = first + count;
      while (first < limit) {
        const id = data[first * 11 + 9],
          normalId = materials?.[Math.floor(first / objectStride) * 2] ?? NO_TEXTURE,
          receive = !!((materials?.[Math.floor(first / objectStride) * 2 + 1] ?? 3) & 2);
        let end = first + 3;
        while (
          end < limit &&
          data[end * 11 + 9] === id &&
          (materials?.[Math.floor(end / objectStride) * 2] ?? NO_TEXTURE) === normalId &&
          !!((materials?.[Math.floor(end / objectStride) * 2 + 1] ?? 3) & 2) === receive
        )
          end += 3;
        pass.setBindGroup(
          1,
          id === NO_TEXTURE ? this.whiteGroup : this.textures.resource(id).bindGroup,
        );
        pass.setBindGroup(2, this.environment.receiverGroup(receive));
        pass.setBindGroup(
          3,
          normalId === NO_TEXTURE ? this.normalGroup : this.textures.resource(normalId).bindGroup,
        );
        pass.draw(end - first, 1, first);
        stats.drawCalls++;
        stats.textureBindCount += normalId === NO_TEXTURE ? 1 : 2;
        if (previous !== undefined && previous !== id) stats.textureSwitchCount++;
        previous = id;
        first = end;
      }
    };
    if (this.terrain && frame.terrainVertexCount) {
      if (frame.version === 1)
        draw(
          this.terrain,
          frame.terrain,
          0,
          frame.terrainVertexCount,
          frame.materials?.terrain,
          36,
        );
      else
        for (let i = 0; i < frame.terrainDrawRanges.length; i += 2)
          draw(
            this.terrain,
            frame.terrain,
            frame.terrainDrawRanges[i],
            frame.terrainDrawRanges[i + 1],
            frame.materials?.terrain,
            36,
          );
    }
    const before = stats.drawCalls;
    if (this.billboards && frame.billboardVertexCount)
      draw(
        this.billboards,
        frame.billboards,
        0,
        frame.billboardVertexCount,
        frame.materials?.billboards,
        6,
      );
    stats.billboardDrawCalls = stats.drawCalls - before;
    this.models.draw(
      frame.models,
      pass,
      this.cameraGroup,
      stats,
      this.environment.group,
      !!hdr,
      0,
      this.environment.receiverGroup(false),
    );
    if (frame.debug?.vertexCount) {
      const debug = frame.debug;
      if (!this.debug || debug.vertices.byteLength > this.debugCapacity) {
        const capacity = grow(this.debugCapacity, debug.vertices.byteLength);
        const buffer = webGpuResources(this.device).createBuffer({
          label: "Spatial debug vertices",
          size: capacity,
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        webGpuResources(this.device).destroy(this.debug);
        this.debug = buffer;
        this.debugCapacity = capacity;
      }
      this.device.queue.writeBuffer(this.debug, 0, debug.vertices);
      pass.setPipeline(this.debugPipelines[(hdr ? 2 : 0) + (debug.depthTest ? 0 : 1)]);
      pass.setBindGroup(0, this.cameraGroup);
      pass.setBindGroup(1, this.whiteGroup);
      pass.setBindGroup(2, this.environment.group);
      pass.setBindGroup(3, this.normalGroup);
      pass.setVertexBuffer(0, this.debug);
      pass.draw(debug.vertexCount);
      stats.debugLineCount = debug.vertexCount / 2;
      stats.debugDrawCalls = 1;
      stats.debugUploadBytes = debug.vertices.byteLength;
      stats.debugTruncated = debug.truncated;
      stats.uploadBytes += debug.vertices.byteLength;
      stats.drawCalls++;
    }
    pass.end();
    if (hdr) {
      this.environment.composite(frame, encoder, target, width, height);
      stats.effectDrawCalls = 1;
      stats.drawCalls++;
      stats.triangleCount++;
      stats.textureBindCount += 2;
    }
    return stats;
  }
  private submitShadows(
    frame: SpatialRenderBufferView,
    encoder: GPUCommandEncoder,
    stats: SpatialRendererStats,
  ): void {
    const env = frame.environment!,
      casters = env.shadowCasters;
    if (casters.byteLength) {
      if (!this.shadowCasters || casters.byteLength > this.shadowCapacity) {
        const capacity = grow(this.shadowCapacity, casters.byteLength);
        const buffer = webGpuResources(this.device).createBuffer({
          label: "Spatial shadow casters",
          size: capacity,
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        webGpuResources(this.device).destroy(this.shadowCasters);
        this.shadowCasters = buffer;
        this.shadowCapacity = capacity;
      }
      this.device.queue.writeBuffer(this.shadowCasters, 0, casters);
      stats.shadowUploadBytes = casters.byteLength;
      stats.uploadBytes += casters.byteLength;
    }
    const before = stats.drawCalls;
    stats.shadowPassCount = this.environment.shadows.draw(encoder, (pass, face) => {
      pass.setPipeline(this.shadowPipeline);
      pass.setBindGroup(0, this.cameraGroups[face + 1]);
      const draw = (source: number, first: number, count: number) => {
        const data = source === 0 ? frame.terrain : casters,
          gpu = source === 0 ? this.terrain : this.shadowCasters;
        if (!count) return;
        pass.setVertexBuffer(0, gpu!);
        const limit = first + count;
        while (first < limit) {
          const id = data[first * 11 + 9];
          let end = first + 3;
          while (end < limit && data[end * 11 + 9] === id) end += 3;
          pass.setBindGroup(
            1,
            id === NO_TEXTURE ? this.whiteGroup : this.textures.resource(id).bindGroup,
          );
          pass.draw(end - first, 1, first);
          stats.drawCalls++;
          stats.textureBindCount++;
          stats.shadowTriangleCount += (end - first) / 3;
          first = end;
        }
      };
      const ranges = env.shadowSubmission?.ranges;
      if (ranges) {
        for (let i = 0; i < ranges.length; i += 4)
          if (ranges[i] === face) draw(ranges[i + 1], ranges[i + 2], ranges[i + 3]);
      } else {
        let first = 0,
          count = 0;
        for (let object = 0; object < frame.terrainVertexCount / 36; object++) {
          if ((frame.materials?.terrain[object * 2 + 1] ?? 3) & 1) {
            if (!count) first = object * 36;
            count += 36;
          } else if (count) {
            draw(0, first, count);
            count = 0;
          }
        }
        if (count) draw(0, first, count);
        if (casters.length) draw(1, 0, env.shadowCasterVertexCount);
      }
      this.models.draw(
        frame.models,
        pass,
        this.cameraGroups[face + 1],
        stats,
        undefined,
        false,
        face === 6 ? 7 : face + 1,
      );
    });
    stats.shadowDrawCalls = stats.drawCalls - before;
    stats.triangleCount += stats.shadowTriangleCount;
    if (env.shadowSubmission) {
      let triangles = 0;
      const m = frame.models;
      if (m)
        for (let i = 0; i < m.words.length; i += 20)
          triangles += m.assets.get(m.words[i])!.triangleCount;
      stats.shadowCulledTriangleCount =
        stats.shadowPassCount *
          ((frame.terrainVertexCount + env.shadowCasterVertexCount) / 3 + triangles) -
        stats.shadowTriangleCount;
    }
    this.pendingShadowCommit = stats.shadowPassCount > 0;
  }
  /** A deferred command buffer is a reusable map only after the owning renderer submits it. */
  commitSubmission(frame: SpatialRenderBufferView): void {
    if (!this.pendingShadowCommit) return;
    this.pendingShadowCommit = false;
    this.environment.shadows.commitSubmission();
    this.shadowCache.commit(frame);
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    webGpuResources(this.device).destroy(this.uniform);
    webGpuResources(this.device).destroy(this.white);
    webGpuResources(this.device).destroy(this.terrain);
    webGpuResources(this.device).destroy(this.billboards);
    webGpuResources(this.device).destroy(this.depth);
    this.models.destroy();
    this.environment.destroy();
    webGpuResources(this.device).destroy(this.flatNormal);
    webGpuResources(this.device).destroy(this.debug);
    webGpuResources(this.device).destroy(this.shadowCasters);
    this.terrainMemory = undefined;
  }
}
function grow(current: number, required: number): number {
  let n = Math.max(current, 256);
  while (n < required) n *= 2;
  return n;
}
function spatialStats(
  frame: SpatialRenderBufferView,
  terrainVertices: number,
): SpatialRendererStats {
  return {
    modelCount: (frame.models?.words.length ?? 0) / 20,
    visibleModelCount: 0,
    modelDrawCalls: 0,
    modelInstancedDrawCalls: 0,
    modelInstanceUploadBytes: 0,
    modelTriangleCount: 0,
    modelUploadBytes: 0,
    triangleCount: (terrainVertices + frame.billboardVertexCount) / 3,
    terrainChunkCount: frame.version === 2 ? frame.terrainVertexCount / 36 : 0,
    visibleTerrainChunkCount: frame.version === 2 ? terrainVertices / 36 : 0,
    culledTerrainChunkCount:
      frame.version === 2 ? (frame.terrainVertexCount - terrainVertices) / 36 : 0,
    terrainTriangleCount: terrainVertices / 3,
    billboardCount: frame.billboardVertexCount / 6,
    drawCalls: 0,
    billboardDrawCalls: 0,
    textureBindCount: 0,
    textureSwitchCount: 0,
    uploadBytes: 0,
    terrainUploadBytes: 0,
    depthBufferBytes: 0,
    debugLineCount: 0,
    debugDrawCalls: 0,
    debugUploadBytes: 0,
    debugTruncated: false,
    lightCount: 0,
    directionalLightCount: 0,
    shadowPassCount: 0,
    shadowDrawCalls: 0,
    shadowTriangleCount: 0,
    shadowUploadBytes: 0,
    shadowCacheHit: false,
    shadowCulledTriangleCount: 0,
    effectDrawCalls: 0,
    effectTextureBytes: 0,
    dofSampleBudget: 0,
  };
}
