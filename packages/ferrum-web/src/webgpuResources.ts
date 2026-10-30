import "./webgpuTypes.js";
import type { RendererResourceStats } from "./rendererResources.js";

const owners = new WeakMap<GPUDevice, WebGpuResources>();
/** One allocation ledger per native device. Native objects are never wrapped or patched. */
export function webGpuResources(device: GPUDevice): WebGpuResources {
  let owner = owners.get(device);
  if (!owner) { owner = new WebGpuResources(device); owners.set(device, owner); }
  return owner;
}

class WebGpuResources {
  private readonly buffers = new Map<GPUBuffer | GPUTexture, number>();
  private readonly textures = new Map<GPUBuffer | GPUTexture, { bytes?: number; target: boolean }>();
  private readonly pipelines = new Set<GPURenderPipeline>();
  constructor(private readonly device: GPUDevice) {}

  createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer {
    const buffer = this.device.createBuffer(descriptor);
    this.buffers.set(buffer, descriptor.size);
    return buffer;
  }
  createTexture(descriptor: GPUTextureDescriptor): GPUTexture {
    const texture = this.device.createTexture(descriptor);
    const size = descriptor.size;
    const width = "width" in size ? size.width : size[0];
    const height = "width" in size ? (size.height ?? 1) : (size[1] ?? 1);
    const layers = "width" in size ? (size.depthOrArrayLayers ?? 1) : (size[2] ?? 1);
    const bytesPerPixel = textureFormatBytes(descriptor.format);
    let bytes: number | undefined;
    if (bytesPerPixel !== undefined) {
      bytes = 0;
      for (let mip = 0; mip < (descriptor.mipLevelCount ?? 1); mip++) {
        bytes += Math.max(1, Math.floor(width / 2 ** mip)) * Math.max(1, Math.floor(height / 2 ** mip)) * layers * bytesPerPixel;
      }
    }
    this.textures.set(texture, { bytes, target: (descriptor.usage & GPUTextureUsage.RENDER_ATTACHMENT) !== 0 });
    return texture;
  }
  createRenderPipeline(descriptor: GPURenderPipelineDescriptor): GPURenderPipeline {
    const pipeline = this.device.createRenderPipeline(descriptor);
    this.pipelines.add(pipeline);
    return pipeline;
  }
  destroy(resource: GPUBuffer | GPUTexture | undefined): void {
    if (!resource) return;
    resource.destroy();
    this.buffers.delete(resource);
    this.textures.delete(resource);
  }
  stats(): RendererResourceStats {
    let textureBytes = 0, unmeasuredTextureCount = 0, renderTargetCount = 0, bufferBytes = 0;
    for (const value of this.textures.values()) {
      if (value.bytes === undefined) unmeasuredTextureCount++; else textureBytes += value.bytes;
      if (value.target) renderTargetCount++;
    }
    for (const bytes of this.buffers.values()) bufferBytes += bytes;
    return { textureCount: this.textures.size, bufferCount: this.buffers.size, programCount: this.pipelines.size,
      renderTargetCount, unmeasuredTextureCount, bufferBytes,
      ...(unmeasuredTextureCount ? {} : { textureBytes, estimatedBytes: textureBytes + bufferBytes }) };
  }
  /** Also cleans up allocations from a constructor that threw before returning its pass. */
  destroyAll(): void {
    for (const resource of this.buffers.keys()) resource.destroy();
    for (const resource of this.textures.keys()) resource.destroy();
    this.buffers.clear(); this.textures.clear(); this.pipelines.clear();
  }
}

function textureFormatBytes(format: string): number | undefined {
  if (["rgba8unorm", "rgba8unorm-srgb", "bgra8unorm", "bgra8unorm-srgb", "depth32float", "r32float"].includes(format)) return 4;
  if (format === "rgba16float") return 8;
  // depth24plus storage is implementation dependent; never invent a byte count.
  return undefined;
}
