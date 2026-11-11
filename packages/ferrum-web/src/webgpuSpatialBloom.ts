import { beginWebGpuRenderPass } from "./webgpuGpuTimer.js";
import { webGpuResources } from "./webgpuResources.js";
import { spatialBloomWGSL, type SpatialBloomPlan } from "./spatialBloomKernel.js";

export class WebGpuSpatialBloom {
  private readonly layout: GPUBindGroupLayout;
  private readonly pipeline: GPURenderPipeline;
  private readonly uniform: GPUBuffer;
  private readonly values = new Float32Array(1024);
  private targets?: GPUTexture[];
  private key = "";
  private views?: GPUTextureView[];
  private groups?: GPUBindGroup[];
  private source?: GPUTextureView;
  private width = 0;
  private height = 0;
  private failure?: Error;
  private destroyed = false;
  constructor(private readonly device: GPUDevice) {
    device.pushErrorScope("validation"); device.pushErrorScope("out-of-memory");
    try {
    this.layout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float" } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform", minBindingSize: 32 } },
    ] });
    const module = device.createShaderModule({ code: spatialBloomWGSL });
    this.pipeline = webGpuResources(device).createRenderPipeline({ label: "Spatial wide Bloom",
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.layout] }),
      vertex: { module, entryPoint: "vs_main" }, fragment: { module, entryPoint: "fs_main", targets: [{ format: "rgba16float" }] },
      primitive: { topology: "triangle-list" } });
    try {
      this.uniform = webGpuResources(device).createBuffer({ label: "Spatial Bloom stages", size: 4096, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    } catch (error) { webGpuResources(device).releasePipeline(this.pipeline); throw error; }
    } finally {
      const allocation = device.popErrorScope(), validation = device.popErrorScope();
      void Promise.all([allocation, validation]).then(errors => {
        const error = errors.find(Boolean);
        if (error && !this.destroyed) { this.clearTargets(); this.failure = Error(`Spatial Bloom pipeline allocation failed: ${error.message}`); }
      }, error => {
        if (!this.destroyed) { this.clearTargets(); this.failure = Error(`Spatial Bloom pipeline validation failed: ${String(error)}`); }
      });
    }
  }
  prepare(plan?: SpatialBloomPlan): GPUTextureView | undefined {
    if (this.destroyed) throw Error("Spatial Bloom destroyed");
    if (this.failure) throw this.failure;
    if (!plan) { this.clearTargets(); return undefined; }
    const key = plan.levels.map(l => `${l.width}x${l.height}`).join("/");
    if (this.views && this.key === key) return this.views[this.views.length - 2];
    const next: GPUTexture[] = [];
    let replacement: GPUTexture[] | undefined;
    this.device.pushErrorScope("validation"); this.device.pushErrorScope("out-of-memory");
    try {
      for (const size of [...plan.levels, { width: plan.width, height: plan.height }]) next.push(webGpuResources(this.device).createTexture({ label: "Spatial Bloom HDR",
        size: [size.width, size.height, 1], format: "rgba16float", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT }));
      const views = next.map(t => t.createView());
      replacement = next;
      this.clearTargets(); this.targets = replacement; this.views = views; this.key = key;
      this.width = plan.width; this.height = plan.height;
      return views[views.length - 2];
    } catch (error) { next.forEach(t => webGpuResources(this.device).destroy(t)); throw error; }
    finally {
      const allocation = this.device.popErrorScope(), validation = this.device.popErrorScope();
      void Promise.all([allocation, validation]).then(errors => {
        const error = errors.find(Boolean);
        if (error && replacement && replacement === this.targets && !this.destroyed) {
          this.clearTargets(); this.failure = Error(`Spatial Bloom GPU allocation failed: ${error.message}`);
        }
      }, error => {
        if (replacement && replacement === this.targets && !this.destroyed) {
          this.clearTargets(); this.failure = Error(`Spatial Bloom GPU validation failed: ${String(error)}`);
        }
      });
    }
  }
  draw(encoder: GPUCommandEncoder, source: GPUTextureView, plan: SpatialBloomPlan, threshold: number): void {
    if (this.failure) throw this.failure;
    if (!this.views) throw Error("Spatial Bloom target is not prepared");
    if (plan.drawCalls > 16) throw Error("Spatial Bloom stage budget exceeded");
    for (let i = 0; i < plan.drawCalls; i++) {
      const stage = i < plan.levels.length ? i === 0 ? 0 : 3 : i === plan.levels.length ? 1 : 2;
      this.values.set([i === 0 ? plan.scale : 2, plan.kernel, stage, plan.step, threshold, 0, 0, 0], i * 64);
    }
    // Immutable stage slots: later queue writes cannot overwrite earlier pass parameters.
    this.device.queue.writeBuffer(this.uniform, 0, this.values);
    if (source !== this.source || !this.groups) {
      this.device.pushErrorScope("validation"); this.device.pushErrorScope("out-of-memory");
      let replacement: GPUBindGroup[] | undefined;
      try {
      const inputs = [source, ...this.views];
      const group = (stage: number) => this.device.createBindGroup({ layout: this.layout, entries: [
        { binding: 0, resource: inputs[stage] }, { binding: 1, resource: { buffer: this.uniform, offset: stage * 256, size: 32 } },
      ] });
      const groups = Array.from({ length: plan.drawCalls }, (_, i) => group(i));
      this.groups = groups; this.source = source; replacement = groups;
      } finally {
        const allocation = this.device.popErrorScope(), validation = this.device.popErrorScope();
        void Promise.all([allocation, validation]).then(errors => {
          const error = errors.find(Boolean);
          if (error && replacement && replacement === this.groups && !this.destroyed) {
            this.clearTargets(); this.failure = Error(`Spatial Bloom binding allocation failed: ${error.message}`);
          }
        }, error => {
          if (replacement && replacement === this.groups && !this.destroyed) {
            this.clearTargets(); this.failure = Error(`Spatial Bloom binding validation failed: ${String(error)}`);
          }
        });
      }
    }
    for (let stage = 0; stage < plan.drawCalls; stage++) {
      const pass = beginWebGpuRenderPass(this.device, encoder, { label: `Spatial Bloom stage${stage}`,
        colorAttachments: [{ view: this.views[stage < plan.levels.length ? stage : stage === plan.levels.length ? this.views.length - 1 : this.views.length - 2], loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } }] });
      try { pass.setPipeline(this.pipeline); pass.setBindGroup(0, this.groups[stage]); pass.draw(3); }
      finally { pass.end(); }
    }
  }
  clearTargets(): void {
    for (const t of this.targets ?? []) webGpuResources(this.device).destroy(t);
    this.targets = this.views = this.groups = undefined; this.source = undefined; this.width = this.height = 0; this.key = "";
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true; this.clearTargets(); webGpuResources(this.device).destroy(this.uniform);
    webGpuResources(this.device).releasePipeline(this.pipeline);
  }
}
