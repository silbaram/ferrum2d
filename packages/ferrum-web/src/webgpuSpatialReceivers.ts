import type { SpatialRenderBufferView } from "./dataSceneSpatial.js";
import { spatialReceiverMaskCode, validateSpatialReceiverMasks } from "./spatialReceiverMasks.js";
import { webGpuResources } from "./webgpuResources.js";

const STRIDE = 256;
/** Private, deduplicated draw uniforms. No native flags, vertices or model matrices are repacked. */
export class WebGpuSpatialReceivers {
  private buffer?: GPUBuffer;
  private capacity = 0;
  private active = false;
  private keys: number[] = [];
  private readonly scratch: number[] = [];
  private readonly seen = new Set<number>();
  private readonly offsets = new Map<number, number>();
  private staging = new Uint32Array();
  private failure?: Error;
  private destroyed = false;
  constructor(private readonly device: GPUDevice) {}

  prepare(frame: SpatialRenderBufferView): void {
    if (this.destroyed) throw Error("Spatial receiver uniforms destroyed");
    if (this.failure) throw this.failure;
    const active = !!(frame.environment?.values[0]! & 1) && validateSpatialReceiverMasks(frame);
    if (!active) { this.active = false; return; }
    const keys = this.scratch;
    keys.length = 0;
    this.seen.clear();
    const add = (code: number) => { if (!this.seen.has(code)) { this.seen.add(code); keys.push(code); } };
    add(65535); // Row0 serves missing streams and debug/composition binds.
    for (const data of [frame.receiverMasks!.terrain, frame.receiverMasks!.billboards, frame.receiverMasks!.models])
      for (let i = 0; i < data.length / 2; i++) add(spatialReceiverMaskCode(data, i));
    if (keys.length === this.keys.length && keys.every((key, i) => key === this.keys[i])) {
      this.active = true;
      return;
    }
    const required = keys.length * STRIDE;
    if (required > Math.min(this.device.limits.maxBufferSize, 65536 * STRIDE))
      throw Error("Spatial receiver uniform table exceeds the device or channel budget");
    let candidate: GPUBuffer | undefined;
    this.device.pushErrorScope("validation");
    this.device.pushErrorScope("out-of-memory");
    try {
      let capacity = this.capacity || STRIDE;
      while (capacity < required) capacity *= 2;
      // Do not grow beyond a device limit when an exact-sized table still fits.
      capacity = Math.min(capacity, this.device.limits.maxBufferSize, 65536 * STRIDE);
      candidate = required > this.capacity ? webGpuResources(this.device).createBuffer({
        label: "Spatial receiver masks", size: capacity,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }) : this.buffer!;
      if (this.staging.length < required / 4) this.staging = new Uint32Array(required / 4);
      for (let i = 0; i < keys.length; i++) {
        this.staging[i * STRIDE / 4] = keys[i] & 255;
        this.staging[i * STRIDE / 4 + 1] = keys[i] >>> 8;
      }
      this.device.queue.writeBuffer(candidate, 0, this.staging.subarray(0, required / 4));
      if (candidate !== this.buffer) {
        webGpuResources(this.device).destroy(this.buffer);
        this.buffer = candidate;
        this.capacity = capacity;
      }
      this.keys = keys.slice();
      this.offsets.clear();
      keys.forEach((key, i) => this.offsets.set(key, i * STRIDE));
      this.active = true;
    } catch (error) {
      if (candidate !== this.buffer) webGpuResources(this.device).destroy(candidate);
      throw error;
    } finally {
      const allocation = this.device.popErrorScope(), validation = this.device.popErrorScope();
      void Promise.all([allocation, validation]).then(errors => {
        const error = errors.find(Boolean);
        if (error && candidate === this.buffer && !this.destroyed)
          this.failure = Error(`Spatial receiver GPU allocation failed: ${error.message}`);
      }, error => {
        if (candidate === this.buffer && !this.destroyed)
          this.failure = Error(`Spatial receiver GPU validation failed: ${String(error)}`);
      });
    }
  }
  binding(fallback: GPUBuffer): GPUBuffer { return this.buffer ?? fallback; }
  enabled(): boolean { return this.active; }
  offset(code: number): number {
    if (!this.active) return 0;
    const offset = this.offsets.get(code);
    if (offset === undefined) throw Error("Spatial receiver mask is not prepared");
    return offset;
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    webGpuResources(this.device).destroy(this.buffer);
    this.buffer = undefined;
    this.keys.length = 0;
    this.scratch.length = 0;
    this.seen.clear(); this.offsets.clear();
    this.staging = new Uint32Array();
  }
}
