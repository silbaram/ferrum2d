import { pointLightCookieTextureId } from "./lightingCookie.js";
import type { ResolvedPointLight2D } from "./lightingTypes.js";
import type { WebGpuTextureResource } from "./webgpuTextureStore.js";
import { webGpuResources } from "./webgpuResources.js";

export interface WebGpuLightingCookieSource { resource(id: number): WebGpuTextureResource; }
/** At most 32 independent light rows, uploaded before encoding any cookie draw. */
export class WebGpuLightingCookies {
  readonly layout: GPUBindGroupLayout;
  private uniform?: GPUBuffer;
  private readonly values = new Float32Array(32 * 64);
  private readonly previous = new Float32Array(32 * 64);
  private initialized = false;
  private readonly groups = new Map<GPUTextureView, GPUBindGroup>();
  private readonly rows: (GPUBindGroup | undefined)[] = [];
  private destroyed = false;
  private failure?: Error;
  constructor(private readonly device: GPUDevice) {
    if (device.limits.maxBufferSize < this.values.byteLength) throw Error("Cookie uniforms exceed the device buffer budget");
    this.beginScope();
    try {
      this.layout = device.createBindGroupLayout({ entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: 32 } },
      ] });
      this.uniform = webGpuResources(device).createBuffer({ label: "Flat cookie light parameters", size: this.values.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    } finally { this.endScope(); }
  }
  prepare(lights: readonly ResolvedPointLight2D[], source: WebGpuLightingCookieSource): void {
    this.assertAlive();
    if (lights.length > 32) throw Error("Cookie lighting supports at most 32 active lights");
    this.values.fill(0); this.rows.length = lights.length;
    const live = new Set<GPUTextureView>();
    let scoped = false;
    const scope = () => { if (!scoped) { this.beginScope(); scoped = true; } };
    try {
      lights.forEach((light, i) => {
        this.rows[i] = undefined;
        if (!light.cookie) return;
        const cookie = light.cookie, view = source.resource(pointLightCookieTextureId(cookie)).view;
        live.add(view);
        let group = this.groups.get(view);
        if (!group) {
          scope();
          group = this.device.createBindGroup({ layout: this.layout, entries: [
            { binding: 0, resource: view }, { binding: 1, resource: { buffer: this.uniform!, offset: 0, size: 32 } },
          ] });
          this.groups.set(view, group);
        }
        this.rows[i] = group;
        const at = i * 64, angle = cookie.rotationRadians % (2 * Math.PI);
        this.values.set(cookie.uv, at); this.values[at + 4] = Math.cos(angle); this.values[at + 5] = Math.sin(angle);
      });
      for (const view of this.groups.keys()) if (!live.has(view)) this.groups.delete(view);
      if (!this.initialized || this.values.some((v, i) => v !== this.previous[i])) {
        scope();
        this.device.queue.writeBuffer(this.uniform!, 0, this.values);
        this.previous.set(this.values); this.initialized = true;
      }
    } catch (error) {
      // A partial preparation must never become a warm cache hit on retry.
      this.groups.clear(); this.rows.length = 0; this.initialized = false;
      throw error;
    } finally { if (scoped) this.endScope(); }
  }
  binding(index: number): { group: GPUBindGroup; offset: number } {
    this.assertAlive();
    const group = this.rows[index];
    if (!group) throw Error("Cookie light row is not prepared");
    return { group, offset: index * 256 };
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true; webGpuResources(this.device).destroy(this.uniform);
    this.uniform = undefined;
    this.groups.clear(); this.rows.length = 0;
  }
  private assertAlive(): void {
    if (this.destroyed) throw Error("Cookie bindings destroyed");
    if (this.failure) throw this.failure;
  }
  private beginScope(): void {
    this.device.pushErrorScope("validation"); this.device.pushErrorScope("out-of-memory");
  }
  private endScope(): void {
    const allocation = this.device.popErrorScope(), validation = this.device.popErrorScope();
    void Promise.all([allocation, validation]).then(errors => {
      const error = errors.find(Boolean);
      if (error) this.fail(`Cookie GPU allocation failed: ${error.message}`);
    }, error => this.fail(`Cookie GPU validation failed: ${String(error)}`));
  }
  private fail(message: string): void {
    if (this.destroyed || this.failure) return;
    this.failure = Error(message);
    webGpuResources(this.device).destroy(this.uniform); this.uniform = undefined;
    this.groups.clear(); this.rows.length = 0;
  }
}
