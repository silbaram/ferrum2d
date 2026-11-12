import { beginWebGpuRenderPass } from "./webgpuGpuTimer.js";
import { webGpuResources } from "./webgpuResources.js";
import { LIGHT_SHAFT_WGSL, writeLightShaftUniforms, type SpatialLightShaftPlan } from "./spatialLightShaftKernel.js";
import type { SpatialRenderBufferView } from "./dataSceneSpatial.js";

export class WebGpuSpatialLightShafts {
  private readonly layout: GPUBindGroupLayout;
  private readonly pipeline: GPURenderPipeline;
  private readonly uniform: GPUBuffer;
  private readonly values = new Float32Array(52);
  private texture?: GPUTexture;
  private view?: GPUTextureView;
  private group?: GPUBindGroup;
  private depth?: GPUTextureView;
  private shadow?: GPUTextureView;
  private width = 0;
  private height = 0;
  private failure?: Error;
  private destroyed = false;
  constructor(private readonly device: GPUDevice) {
    const resources = this.checked(() => {
      const layout = device.createBindGroupLayout({ entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "depth" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "depth" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform", minBindingSize: 208 } },
      ] });
      const module = device.createShaderModule({ code: LIGHT_SHAFT_WGSL });
      const pipeline = webGpuResources(device).createRenderPipeline({ label: "Spatial sun light shafts", layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        vertex: { module, entryPoint: "vs_main" }, fragment: { module, entryPoint: "fs_main", targets: [{ format: "rgba16float" }] }, primitive: { topology: "triangle-list" } });
      try {
        const uniform = webGpuResources(device).createBuffer({ label: "Spatial light shafts parameters", size: 208, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        return { layout, pipeline, uniform };
      } catch (error) { webGpuResources(device).releasePipeline(pipeline); throw error; }
    });
    this.layout = resources.layout; this.pipeline = resources.pipeline; this.uniform = resources.uniform;
  }
  private checked<T>(work: () => T, current: (resource: T) => boolean = () => true): T {
    this.device.pushErrorScope("validation"); this.device.pushErrorScope("out-of-memory");
    let resource: T;
    let completed = false;
    const fail = (message: string): void => {
      // An error scope may resolve after resize, OFF, or a replacement binding.
      // Synchronous failures already rolled back their allocation in work().
      if (completed && !this.destroyed && current(resource)) {
        this.clearTarget(); this.failure = Error(message);
      }
    };
    try { resource = work(); completed = true; return resource; }
    finally {
      const allocation = this.device.popErrorScope(), validation = this.device.popErrorScope();
      void Promise.all([allocation, validation]).then(errors => {
        const error = errors.find(Boolean);
        if (error) fail(`Light shafts GPU allocation failed: ${error.message}`);
      }, error => { fail(`Light shafts GPU validation failed: ${String(error)}`); });
    }
  }
  prepare(plan?: SpatialLightShaftPlan): GPUTextureView | undefined {
    if (this.destroyed) throw Error("Light shafts destroyed"); if (this.failure) throw this.failure;
    if (!plan) { this.clearTarget(); return; }
    if (this.view && this.width === plan.width && this.height === plan.height) return this.view;
    return this.checked(() => {
      const texture = webGpuResources(this.device).createTexture({ label: "Spatial light shafts HDR", size: [plan.width, plan.height, 1], format: "rgba16float", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
      try {
        const view = texture.createView(); this.clearTarget(); this.texture = texture; this.view = view;
        this.width = plan.width; this.height = plan.height; return view;
      } catch (error) { webGpuResources(this.device).destroy(texture); throw error; }
    }, view => view === this.view);
  }
  draw(encoder: GPUCommandEncoder, frame: SpatialRenderBufferView, plan: SpatialLightShaftPlan, depth: GPUTextureView, shadow: GPUTextureView, width: number, height: number): void {
    if (this.failure) throw this.failure; if (!this.view) throw Error("Light shafts target is not prepared");
    writeLightShaftUniforms(this.values, frame, plan, width, height); this.device.queue.writeBuffer(this.uniform, 0, this.values);
    if (!this.group || this.depth !== depth || this.shadow !== shadow) {
      this.group = this.checked(() => this.device.createBindGroup({ layout: this.layout, entries: [
        { binding: 0, resource: depth }, { binding: 1, resource: shadow }, { binding: 2, resource: { buffer: this.uniform } },
      ] }), group => group === this.group); this.depth = depth; this.shadow = shadow;
    }
    const pass = beginWebGpuRenderPass(this.device, encoder, { label: "Spatial sun light shafts", colorAttachments: [{ view: this.view, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } }] });
    try { pass.setPipeline(this.pipeline); pass.setBindGroup(0, this.group); pass.draw(3); } finally { pass.end(); }
  }
  textureBytes(): number { return this.width * this.height * 8; }
  clearTarget(): void {
    webGpuResources(this.device).destroy(this.texture); this.texture = undefined; this.view = this.group = this.depth = this.shadow = undefined; this.width = this.height = 0;
  }
  destroy(): void {
    if (this.destroyed) return; this.destroyed = true; this.clearTarget();
    webGpuResources(this.device).destroy(this.uniform); webGpuResources(this.device).releasePipeline(this.pipeline);
  }
}
