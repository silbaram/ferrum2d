import type { ResolvedPostProcessPass } from "./cameraPostProcessing.js";
import { TEXTURE_POST_PROCESS_WGSL } from "./webgpuPostProcessShaders.js";
import { beginWebGpuRenderPass } from "./webgpuGpuTimer.js";
import { webGpuResources } from "./webgpuResources.js";

/** Optional pass: one reusable copy target; pixelArt stays unfiltered, other effects use linear sampling. */
export class WebGpuTexturePostProcess {
  private readonly pipeline: GPURenderPipeline;
  private readonly uniform: GPUBuffer;
  private readonly sampler: GPUSampler;
  private readonly staging = new Float32Array(12);
  private source?: GPUTexture;
  private group?: GPUBindGroup;

  constructor(private readonly device: GPUDevice, private readonly format: GPUTextureFormat) {
    const owner = webGpuResources(device);
    let pipeline: GPURenderPipeline | undefined;
    let uniform: GPUBuffer | undefined;
    try {
      const module = device.createShaderModule({ code: TEXTURE_POST_PROCESS_WGSL });
      pipeline = owner.createRenderPipeline({
        layout: "auto",
        vertex: { module, entryPoint: "vertex" },
        fragment: { module, entryPoint: "fragment", targets: [{ format }] },
        primitive: { topology: "triangle-list" },
      });
      this.sampler = device.createSampler({
        minFilter: "linear", magFilter: "linear",
        addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge",
      });
      uniform = owner.createBuffer({
        size: 48,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.pipeline = pipeline;
      this.uniform = uniform;
    } catch (error) {
      owner.destroy(uniform);
      if (pipeline) owner.releasePipeline(pipeline);
      throw error;
    }
  }

  draw(target: GPUTexture, settings: Exclude<ResolvedPostProcessPass, { kind: "fade" }>): void {
    this.resize(target.width, target.height);
    this.staging.fill(0);
    switch (settings.kind) {
      case "bloom":
        this.staging.set([settings.threshold, settings.intensity, settings.radius]);
        this.staging[8] = 2;
        break;
      case "crt":
        this.staging.set([settings.curvature, settings.scanlineIntensity, settings.chromaticAberration]);
        this.staging[8] = 3;
        break;
      case "vignette":
        this.staging.set([settings.intensity, settings.radius, settings.softness]);
        this.staging.set(settings.color, 4);
        this.staging[8] = 4;
        break;
      case "glitch":
        this.staging.set([settings.intensity, settings.chromaticAberration, settings.seed]);
        this.staging[8] = 5;
        break;
      case "pixelArt":
        this.staging.set([settings.levels, settings.dither, settings.scanlineIntensity]);
        this.staging[8] = 6;
        break;
    }
    this.device.queue.writeBuffer(this.uniform, 0, this.staging);
    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToTexture(
      { texture: target }, { texture: this.source! },
      { width: target.width, height: target.height },
    );
    const pass = beginWebGpuRenderPass(this.device, encoder, {
      colorAttachments: [{ view: target.createView(), loadOp: "load", storeOp: "store" }],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.group!);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  destroy(): void {
    const owner = webGpuResources(this.device);
    owner.destroy(this.source);
    owner.destroy(this.uniform);
    owner.releasePipeline(this.pipeline);
    this.source = undefined;
    this.group = undefined;
  }

  private resize(width: number, height: number): void {
    if (this.source?.width === width && this.source.height === height) return;
    const owner = webGpuResources(this.device);
    const source = owner.createTexture({
      size: { width, height }, format: this.format,
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
    });
    let group: GPUBindGroup;
    try {
      group = this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: source.createView() },
          { binding: 1, resource: { buffer: this.uniform } },
          { binding: 2, resource: this.sampler },
        ],
      });
    } catch (error) {
      owner.destroy(source);
      throw error;
    }
    owner.destroy(this.source);
    this.source = source;
    this.group = group;
  }
}
