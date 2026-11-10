import { FLAT_HDR_WGSL } from "./flatHdrShaders.js";
import { flatHdrToneMapping, type ResolvedFlatHdrOptions } from "./flatHdr.js";
import { webGpuResources } from "./webgpuResources.js";
import { beginWebGpuRenderPass } from "./webgpuGpuTimer.js";

export class WebGpuHdrPass {
  private readonly layout: GPUBindGroupLayout;
  private readonly pipeline: GPURenderPipeline;
  private readonly uniform: GPUBuffer;
  private readonly staging = new Float32Array(4);
  private textureValue?: GPUTexture;
  private binding?: GPUBindGroup;
  private width = 0; private height = 0;
  constructor(private readonly device: GPUDevice, format: GPUTextureFormat) {
    this.layout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float" } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
    ] });
    const module = device.createShaderModule({ code: FLAT_HDR_WGSL });
    this.pipeline = webGpuResources(device).createRenderPipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [this.layout] }),
      vertex: { module, entryPoint: "vs_main" }, fragment: { module, entryPoint: "fs_main", targets: [{ format }] }, primitive: { topology: "triangle-list" } });
    try { this.uniform = webGpuResources(device).createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); }
    catch (error) { webGpuResources(device).releasePipeline(this.pipeline); throw error; }
  }
  prepare(width: number, height: number): void {
    if (this.textureValue && this.width === width && this.height === height) return;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > this.device.limits.maxTextureDimension2D || height > this.device.limits.maxTextureDimension2D) throw Error("Invalid Flat HDR target dimensions");
    const texture = webGpuResources(this.device).createTexture({ size: { width, height }, format: "rgba16float", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    let binding: GPUBindGroup;
    try { binding = this.device.createBindGroup({ layout: this.layout, entries: [{ binding: 0, resource: texture.createView() }, { binding: 1, resource: { buffer: this.uniform } }] }); }
    catch (error) { webGpuResources(this.device).destroy(texture); throw error; }
    this.release(); this.textureValue = texture; this.binding = binding; this.width = width; this.height = height;
  }
  texture(): GPUTexture { if (!this.textureValue) throw Error("Flat HDR target is not prepared"); return this.textureValue; }
  resolve(target: GPUTexture, options: ResolvedFlatHdrOptions, encodeSrgb: boolean): void {
    this.staging[0] = options.exposure; this.staging[1] = flatHdrToneMapping(options); this.staging[2] = encodeSrgb ? 1 : 0;
    this.device.queue.writeBuffer(this.uniform, 0, this.staging);
    const encoder = this.device.createCommandEncoder(), pass = beginWebGpuRenderPass(this.device, encoder, {
      colorAttachments: [{ view: target.createView(), loadOp: "load", storeOp: "store" }],
    });
    pass.setPipeline(this.pipeline); pass.setBindGroup(0, this.binding!); pass.draw(3); pass.end(); this.device.queue.submit([encoder.finish()]);
  }
  release(): void { if (this.textureValue) webGpuResources(this.device).destroy(this.textureValue); this.textureValue = undefined; this.binding = undefined; this.width = this.height = 0; }
  destroy(): void { this.release(); webGpuResources(this.device).destroy(this.uniform); webGpuResources(this.device).releasePipeline(this.pipeline); }
}
