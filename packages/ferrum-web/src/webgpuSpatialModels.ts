import { beginWebGpuRenderPass } from "./webgpuGpuTimer.js";
import { webGpuResources } from "./webgpuResources.js";
import { SPATIAL_MODEL_MATERIAL_BYTES, spatialModelMaterialValues } from "./webgpuSpatialMaterial.js";
import { spatialShadowModelWGSL } from "./webgpuSpatialShadows.js";
import { spatialModelWGSL } from "./webgpuSpatialShaders.js";
import {
  spatialModelResource,
  type SpatialModelAsset,
  type SpatialModelPreparation,
  type SpatialModelPrimitive,
  type SpatialModelResource,
} from "./spatialModel.js";
import { validateSpatialModelFrame, type SpatialModelFrame } from "./spatialModelPacket.js";
import type { SpatialRendererStats } from "./renderer.js";
const CAPACITY = 1024;
const mipShader = `
@group(0) @binding(0) var s: sampler;
@group(0) @binding(1) var t: texture_2d<f32>;
struct F { @builtin(position) p: vec4f, @location(0) uv: vec2f };
@vertex fn vs_main(@builtin(vertex_index) i:u32)->F {
 let uv=vec2f(f32((i<<1u)&2u),f32(i&2u));var f:F;
 f.p=vec4f(uv*2.-1.,0.,1.);f.uv=vec2f(uv.x,1.-uv.y);return f;
}
@fragment fn fs_main(f:F)->@location(0) vec4f {return textureSampleLevel(t,s,f.uv,0.);}`;
interface Primitive {
  source: SpatialModelPrimitive;
  vertex: GPUBuffer;
  index: GPUBuffer;
  uniform: GPUBuffer;
  group: GPUBindGroup;
}
interface Asset {
  primitives: Primitive[];
  textures: Map<number, GPUTexture>;
  bytes: number;
  textureBytes: number;
  uploadBytes: number;
}
/** GPU resources only. Native matrices, LOD and camera visibility remain authoritative. */
export class WebGpuSpatialModels {
  private readonly assets = new Map<SpatialModelResource, Asset>();
  private active = new Set<SpatialModelResource>();
  private pending?: Map<SpatialModelResource, Asset>;
  private warmed = new Set<SpatialModelResource>();
  private loading = false;
  private loadingSources?: ReadonlySet<SpatialModelResource>;
  private readonly materialLayout: GPUBindGroupLayout;
  private readonly pipelines: GPURenderPipeline[] = [];
  private readonly shadowPipelines: GPURenderPipeline[] = [];
  private readonly mipLayout: GPUBindGroupLayout;
  private readonly mipPipelines: GPURenderPipeline[];
  private readonly mipSampler: GPUSampler;
  private readonly white: GPUTexture;
  private readonly instances: GPUBuffer;
  private readonly matrices = new Float32Array(CAPACITY * 16 * 8);
  private readonly counts = new Uint32Array(CAPACITY * 8);
  private readonly ends = new Uint32Array(CAPACITY * 8);
  private readonly offsets = new Uint32Array(CAPACITY * 8);
  private destroyed = false;
  constructor(
    private readonly device: GPUDevice,
    format: GPUTextureFormat,
    cameraLayout: GPUBindGroupLayout,
    environmentLayout: GPUBindGroupLayout = {},
  ) {
    this.materialLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        ...[1, 3, 5].flatMap((binding) => [
          { binding, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" as const } },
          {
            binding: binding + 1,
            visibility: GPUShaderStage.FRAGMENT,
            texture: { sampleType: "float" as const },
          },
        ]),
      ],
    });
    const modules = [false, true].map((mapped) =>
      device.createShaderModule({
        label: "Spatial model materials",
        code: spatialModelWGSL(mapped),
      }),
    );
    const layout = device.createPipelineLayout({
      bindGroupLayouts: [cameraLayout, this.materialLayout, environmentLayout],
    });
    for (const outputFormat of [format, "rgba16float"])
      for (const mapped of [false, true])
        for (const doubleSided of [false, true])
          this.pipelines.push(
            webGpuResources(device).createRenderPipeline({
              label: "Spatial indexed/instanced model",
              layout,
              vertex: {
                module: modules[Number(mapped)],
                entryPoint: "vs_main",
                buffers: [
                  {
                    arrayStride: mapped ? 48 : 32,
                    attributes: [
                      { shaderLocation: 0, offset: 0, format: "float32x3" },
                      { shaderLocation: 1, offset: 12, format: "float32x2" },
                      { shaderLocation: 2, offset: 20, format: "float32x3" },
                      ...(mapped
                        ? [{ shaderLocation: 7, offset: 32, format: "float32x4" as const }]
                        : []),
                    ],
                  },
                  {
                    arrayStride: 64,
                    stepMode: "instance",
                    attributes: [0, 1, 2, 3].map((i) => ({
                      shaderLocation: 3 + i,
                      offset: i * 16,
                      format: "float32x4" as const,
                    })),
                  },
                ],
              },
              fragment: {
                module: modules[Number(mapped)],
                entryPoint: "fs_main",
                targets: [{ format: outputFormat }],
              },
              primitive: {
                topology: "triangle-list",
                frontFace: "ccw",
                cullMode: doubleSided ? "none" : "back",
              },
              depthStencil: {
                format: "depth24plus",
                depthWriteEnabled: true,
                depthCompare: "less-equal",
              },
            }),
          );
    const shadowModule = device.createShaderModule({
      label: "Spatial model shadows",
      code: spatialShadowModelWGSL,
    });
    const shadowLayout = device.createPipelineLayout({
      bindGroupLayouts: [cameraLayout, this.materialLayout],
    });
    for (const mapped of [false, true])
      for (const doubleSided of [false, true])
        this.shadowPipelines.push(
          webGpuResources(device).createRenderPipeline({
            label: "Spatial model shadow cutout",
            layout: shadowLayout,
            vertex: {
              module: shadowModule,
              entryPoint: "vs_main",
              buffers: [
                {
                  arrayStride: mapped ? 48 : 32,
                  attributes: [
                    { shaderLocation: 0, offset: 0, format: "float32x3" },
                    { shaderLocation: 1, offset: 12, format: "float32x2" },
                  ],
                },
                {
                  arrayStride: 64,
                  stepMode: "instance",
                  attributes: [0, 1, 2, 3].map((i) => ({
                    shaderLocation: 3 + i,
                    offset: i * 16,
                    format: "float32x4" as const,
                  })),
                },
              ],
            },
            fragment: { module: shadowModule, entryPoint: "fs_main", targets: [] },
            primitive: {
              topology: "triangle-list",
              frontFace: "ccw",
              cullMode: doubleSided ? "none" : "back",
            },
            depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "less" },
          }),
        );
    this.instances = webGpuResources(device).createBuffer({
      label: "Spatial model matrices",
      size: CAPACITY * 64 * 8,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.white = webGpuResources(device).createTexture({
      label: "Model fallback white",
      size: [1, 1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
    });
    device.queue.writeTexture(
      { texture: this.white },
      new Uint8Array([255, 255, 255, 255]),
      { bytesPerRow: 4 },
      [1, 1, 1],
    );
    this.mipLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      ],
    });
    const mipModule = device.createShaderModule({
      label: "Spatial model mipmaps",
      code: mipShader,
    });
    const mipLayout = device.createPipelineLayout({ bindGroupLayouts: [this.mipLayout] });
    this.mipPipelines = ["rgba8unorm", "rgba8unorm-srgb"].map((format) =>
      webGpuResources(device).createRenderPipeline({
        layout: mipLayout,
        vertex: { module: mipModule, entryPoint: "vs_main" },
        fragment: { module: mipModule, entryPoint: "fs_main", targets: [{ format }] },
        primitive: { topology: "triangle-list" },
      }),
    );
    this.mipSampler = device.createSampler({ minFilter: "linear", magFilter: "linear" });
  }
  validate(frame?: SpatialModelFrame): void {
    this.assertAlive();
    validateSpatialModelFrame(frame);
    const sources = new Set<SpatialModelResource>();
    if (frame)
      for (let i = 0; i < frame.words.length; i += 20)
        sources.add(spatialModelResource(frame.assets.get(frame.words[i])!)!);
    this.validateLimits(sources);
    for (const source of sources)
      if (!this.assets.has(source))
        throw Error("WebGPU spatial models must be preloaded before scene activation");
  }
  /** Verify asynchronous WebGPU errors before exposing a synchronous authoring lease. */
  async preload(handles: readonly SpatialModelAsset[]): Promise<number> {
    this.assertAlive();
    if (this.loading || this.pending) throw Error("Spatial model preparation already pending");
    const sources = this.resolveSources(handles);
    this.validateLimits(new Set([...this.assets.keys(), ...sources]));
    this.loading = true;
    this.loadingSources = sources;
    let prepared: ReturnType<WebGpuSpatialModels["uploadMissing"]> | undefined, failure: unknown;
    this.device.pushErrorScope("validation");
    this.device.pushErrorScope("out-of-memory");
    try {
      prepared = this.uploadMissing(sources);
      await this.device.queue.onSubmittedWorkDone();
    } catch (error) {
      failure = error;
    }
    try {
      const allocation = await this.device.popErrorScope(),
        validation = await this.device.popErrorScope();
      if (allocation || validation) failure ??= Error((allocation ?? validation)!.message);
    } catch (error) {
      failure ??= error;
    }
    this.loading = false;
    this.loadingSources = undefined;
    if (failure || this.destroyed) {
      for (const a of prepared?.created ?? []) this.release(a);
      this.prune();
      throw failure ?? Error("Spatial model cache destroyed during preload");
    }
    for (const [s, a] of prepared!.assets) this.assets.set(s, a);
    this.warmed = sources;
    this.prune();
    return prepared!.uploadBytes;
  }
  stage(handles: readonly SpatialModelAsset[]): SpatialModelPreparation {
    this.assertAlive();
    if (this.loading || this.pending) throw Error("Spatial model preparation already pending");
    const sources = this.resolveSources(handles),
      assets = new Map<SpatialModelResource, Asset>();
    for (const source of sources) {
      const a = this.assets.get(source);
      if (!a) throw Error("WebGPU spatial models must be preloaded before scene activation");
      assets.set(source, a);
    }
    this.pending = assets;
    let settled = false;
    return Object.freeze({
      uploadBytes: 0,
      commit: () => {
        this.assertAlive();
        if (settled || this.pending !== assets)
          throw Error("Spatial model preparation is no longer pending");
        this.pending = undefined;
        for (const [s, a] of assets) this.assets.set(s, a);
        this.active = new Set(assets.keys());
        settled = true;
        this.prune();
        assets.clear();
      },
      dispose: () => {
        if (settled || this.pending !== assets) return;
        this.pending = undefined;
        settled = true;
        this.prune();
        assets.clear();
      },
    });
  }
  prepare(frame: SpatialModelFrame | undefined): void {
    this.assertAlive();
    const sources = new Set<SpatialModelResource>();
    if (frame)
      for (let i = 0; i < frame.words.length; i += 20)
        sources.add(spatialModelResource(frame.assets.get(frame.words[i])!)!);
    // No allocation/upload can escape the asynchronous preload verification.
    for (const source of sources)
      if (!this.assets.has(source))
        throw Error("WebGPU spatial models must be preloaded before scene activation");
    this.active = sources;
    this.prune();
  }
  private resolveSources(handles: readonly SpatialModelAsset[]): Set<SpatialModelResource> {
    if (!Array.isArray(handles) || handles.length > 16)
      throw Error("Spatial model preparation asset budget exceeded");
    const sources = new Set(
      handles.map((h) => {
        const s = spatialModelResource(h);
        if (!s) throw Error("Spatial model preparation requires a loaded GLB asset");
        return s;
      }),
    );
    if (handles.reduce((n, h) => n + h.byteLength, 0) > 128 * 1024 * 1024)
      throw Error("Spatial model preparation byte budget exceeded");
    this.validateLimits(sources);
    return sources;
  }
  /** Pack all requested passes once before encoding; queue writes cannot vary between encoded draws. */
  uploadInstances(
    frame: SpatialModelFrame | undefined,
    shadows: boolean,
    stats: SpatialRendererStats,
  ): void {
    this.counts.fill(0);
    if (!frame) return;
    let floats = 0;
    for (let bit = 0; bit < (shadows ? 8 : 1); bit++)
      for (let i = 0; i < frame.words.length; ) {
        if (!(frame.words[i + 2] & (1 << bit))) {
          i += 20;
          continue;
        }
        const first = i,
          source = spatialModelResource(frame.assets.get(frame.words[i])!)!,
          flags = frame.words[i + 1] & 2;
        let count = 0;
        while (i < frame.words.length) {
          if (!(frame.words[i + 2] & (1 << bit))) {
            i += 20;
            continue;
          }
          if (
            spatialModelResource(frame.assets.get(frame.words[i])!) !== source ||
            (bit === 0 && (frame.words[i + 1] & 2) !== flags)
          )
            break;
          this.matrices.set(frame.values.subarray(i + 4, i + 20), floats + count * 16);
          count++;
          i += 20;
        }
        const batch = bit * CAPACITY + first / 20;
        this.counts[batch] = count;
        this.ends[batch] = i;
        this.offsets[batch] = floats * 4;
        floats += count * 16;
      }
    if (floats) {
      this.device.queue.writeBuffer(this.instances, 0, this.matrices.subarray(0, floats));
      stats.modelInstanceUploadBytes += floats * 4;
      stats.uploadBytes += floats * 4;
    }
  }
  draw(
    frame: SpatialModelFrame | undefined,
    pass: GPURenderPassEncoder,
    camera: GPUBindGroup,
    stats: SpatialRendererStats,
    environmentGroup: GPUBindGroup = {},
    hdr = false,
    bit = 0,
    noReceiveGroup = environmentGroup,
  ): void {
    if (!frame) return;
    for (let i = 0; i < frame.words.length; ) {
      const batch = bit * CAPACITY + i / 20,
        count = this.counts[batch];
      if (!count) {
        i += 20;
        continue;
      }
      const asset = this.assets.get(spatialModelResource(frame.assets.get(frame.words[i])!)!)!,
        receive = !!(frame.words[i + 1] & 2);
      i = this.ends[batch];
      if (bit === 0) stats.visibleModelCount += count;
      for (const p of asset.primitives) {
        const variant = (p.source.normal ? 2 : 0) + Number(p.source.doubleSided);
        pass.setPipeline(
          bit === 0 ? this.pipelines[(hdr ? 4 : 0) + variant] : this.shadowPipelines[variant],
        );
        pass.setBindGroup(0, camera);
        pass.setBindGroup(1, p.group);
        if (bit === 0) pass.setBindGroup(2, receive ? environmentGroup : noReceiveGroup);
        pass.setVertexBuffer(0, p.vertex);
        pass.setVertexBuffer(1, this.instances, this.offsets[batch], count * 64);
        pass.setIndexBuffer(p.index, "uint32");
        pass.drawIndexed(p.source.indices.length, count);
        stats.drawCalls++;
        stats.textureBindCount +=
          bit === 0 ? 1 + Number(!!p.source.normal) + Number(!!p.source.emissive) : 1;
        if (bit === 0) {
          stats.modelDrawCalls++;
          if (count > 1) stats.modelInstancedDrawCalls++;
          stats.modelTriangleCount += (p.source.indices.length / 3) * count;
          stats.triangleCount += (p.source.indices.length / 3) * count;
        } else stats.shadowTriangleCount += (p.source.indices.length / 3) * count;
      }
    }
  }
  private validateLimits(sources: Set<SpatialModelResource>): void {
    let bytes = 0;
    for (const s of sources) {
      for (const p of s.primitives) {
        for (const buffer of [p.vertices, p.indices]) {
          if (buffer.byteLength > this.device.limits.maxBufferSize)
            throw Error("Spatial model exceeds device buffer limit");
          bytes += buffer.byteLength;
        }
      }
      for (const key of imageUses(s)) {
        const image = s.images[Math.floor(key / 2)];
        if (
          image.width > this.device.limits.maxTextureDimension2D ||
          image.height > this.device.limits.maxTextureDimension2D
        )
          throw Error("Spatial model exceeds device texture limit");
        let w = image.width,
          h = image.height;
        for (;;) {
          bytes += w * h * 4;
          if (w === 1 && h === 1) break;
          w = Math.max(1, w >> 1);
          h = Math.max(1, h >> 1);
        }
      }
    }
    if (bytes > 256 * 1024 * 1024) throw Error("Spatial model GPU resource budget exceeded");
  }
  private uploadMissing(sources: Set<SpatialModelResource>) {
    const assets = new Map<SpatialModelResource, Asset>(),
      created: Asset[] = [];
    let uploadBytes = 0;
    try {
      for (const s of sources) {
        let a = this.assets.get(s);
        if (!a) {
          a = this.upload(s);
          created.push(a);
          uploadBytes += a.uploadBytes;
        }
        assets.set(s, a);
      }
      return { assets, created, uploadBytes };
    } catch (error) {
      for (const a of created) this.release(a);
      throw error;
    }
  }
  private upload(source: SpatialModelResource): Asset {
    const a: Asset = {
      primitives: [],
      textures: new Map(),
      bytes: 0,
      textureBytes: 0,
      uploadBytes: 0,
    };
    try {
      for (const key of imageUses(source)) {
        const image = source.images[Math.floor(key / 2)],
          color = key % 2 === 1,
          levels = 1 + Math.floor(Math.log2(Math.max(image.width, image.height)));
        const t = webGpuResources(this.device).createTexture({
          label: "Spatial model image",
          size: [image.width, image.height, 1],
          format: color ? "rgba8unorm-srgb" : "rgba8unorm",
          mipLevelCount: levels,
          usage:
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.RENDER_ATTACHMENT,
        });
        a.textures.set(key, t);
        this.device.queue.writeTexture(
          { texture: t },
          image.pixels,
          { bytesPerRow: image.width * 4 },
          [image.width, image.height, 1],
        );
        a.uploadBytes += image.pixels.byteLength;
        let w = image.width,
          h = image.height;
        for (let i = 0; i < levels; i++) {
          a.textureBytes += w * h * 4;
          w = Math.max(1, w >> 1);
          h = Math.max(1, h >> 1);
        }
        if (levels > 1) {
          const encoder = this.device.createCommandEncoder();
          for (let level = 1; level < levels; level++) {
            const group = this.device.createBindGroup({
              layout: this.mipLayout,
              entries: [
                { binding: 0, resource: this.mipSampler },
                {
                  binding: 1,
                  resource: t.createView({ baseMipLevel: level - 1, mipLevelCount: 1 }),
                },
              ],
            });
            const pass = beginWebGpuRenderPass(this.device, encoder, {
              colorAttachments: [
                {
                  view: t.createView({ baseMipLevel: level, mipLevelCount: 1 }),
                  loadOp: "clear",
                  storeOp: "store",
                },
              ],
            });
            pass.setPipeline(this.mipPipelines[Number(color)]);
            pass.setBindGroup(0, group);
            pass.draw(3);
            pass.end();
          }
          this.device.queue.submit([encoder.finish()]);
        }
      }
      for (const p of source.primitives) {
        const owned: GPUBuffer[] = [];
        try {
          const vertex = webGpuResources(this.device).createBuffer({
            size: p.vertices.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
          });
          owned.push(vertex);
          const index = webGpuResources(this.device).createBuffer({
            size: p.indices.byteLength,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
          });
          owned.push(index);
          const uniform = webGpuResources(this.device).createBuffer({
            size: SPATIAL_MODEL_MATERIAL_BYTES,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          });
          owned.push(uniform);
          this.device.queue.writeBuffer(vertex, 0, p.vertices);
          this.device.queue.writeBuffer(index, 0, p.indices);
          this.device.queue.writeBuffer(
            uniform,
            0,
            spatialModelMaterialValues(p),
          );
          const refs = [
            p.image === undefined ? undefined : { image: p.image, sampler: p.sampler },
            p.normal,
            p.emissive,
          ];
          const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: { buffer: uniform } }];
          refs.forEach((r, i) => {
            entries.push(
              {
                binding: 1 + i * 2,
                resource: this.device.createSampler(sampler(r?.sampler ?? p.sampler)),
              },
              {
                binding: 2 + i * 2,
                resource: (r
                  ? a.textures.get(r.image * 2 + Number(i !== 1))!
                  : this.white
                ).createView(),
              },
            );
          });
          const group = this.device.createBindGroup({ layout: this.materialLayout, entries });
          a.primitives.push({ source: p, vertex, index, uniform, group });
          a.bytes += p.vertices.byteLength + p.indices.byteLength + SPATIAL_MODEL_MATERIAL_BYTES;
          a.uploadBytes += p.vertices.byteLength + p.indices.byteLength + SPATIAL_MODEL_MATERIAL_BYTES;
        } catch (error) {
          for (const b of owned) webGpuResources(this.device).destroy(b);
          throw error;
        }
      }
      return a;
    } catch (error) {
      this.release(a);
      throw error;
    }
  }
  private prune(): void {
    for (const [s, a] of this.assets)
      if (
        !this.active.has(s) &&
        !this.warmed.has(s) &&
        !this.loadingSources?.has(s) &&
        !this.pending?.has(s)
      ) {
        this.release(a);
        this.assets.delete(s);
      }
  }
  private release(a: Asset): void {
    for (const p of a.primitives) {
      webGpuResources(this.device).destroy(p.vertex);
      webGpuResources(this.device).destroy(p.index);
      webGpuResources(this.device).destroy(p.uniform);
    }
    for (const t of a.textures.values()) webGpuResources(this.device).destroy(t);
  }
  private assertAlive(): void {
    if (this.destroyed) throw Error("Spatial model cache destroyed");
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const a of new Set([...this.assets.values(), ...(this.pending?.values() ?? [])]))
      this.release(a);
    this.assets.clear();
    this.active.clear();
    this.warmed.clear();
    this.loadingSources = undefined;
    this.pending?.clear();
    this.pending = undefined;
    webGpuResources(this.device).destroy(this.white);
    webGpuResources(this.device).destroy(this.instances);
  }
}
function imageUses(s: SpatialModelResource): Set<number> {
  const result = new Set<number>();
  for (const p of s.primitives) {
    if (p.image !== undefined) result.add(p.image * 2 + 1);
    if (p.normal) result.add(p.normal.image * 2);
    if (p.emissive) result.add(p.emissive.image * 2 + 1);
  }
  return result;
}
function sampler(s: readonly number[]): GPUSamplerDescriptor {
  const wrap = (n: number) =>
    n === 33071
      ? ("clamp-to-edge" as const)
      : n === 33648
        ? ("mirror-repeat" as const)
        : ("repeat" as const);
  return {
    minFilter: [9729, 9985, 9987].includes(s[0]) ? "linear" : "nearest",
    magFilter: s[1] === 9729 ? "linear" : "nearest",
    mipmapFilter: s[0] >= 9986 ? "linear" : "nearest",
    lodMaxClamp: s[0] < 9984 ? 0 : 32,
    addressModeU: wrap(s[2]),
    addressModeV: wrap(s[3]),
  };
}
