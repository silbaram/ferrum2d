import "./webgpuTypes.js";
import type { RendererGpuTimingStats } from "./gpuTiming.js";
import { webGpuResources } from "./webgpuResources.js";

const MAX_PASSES = 128, MAX_SLOTS = 4, QUERY_BYTES = MAX_PASSES * 2 * 8;
const timers = new WeakMap<GPUDevice, WebGpuTimer>();
interface Slot { queries: GPUQuerySet; resolve: GPUBuffer; read: GPUBuffer; busy: boolean; }

/** All renderer passes opt in through this helper; external device work is excluded. */
export function beginWebGpuRenderPass(device: GPUDevice, encoder: GPUCommandEncoder, descriptor: GPURenderPassDescriptor): GPURenderPassEncoder {
  const timestampWrites = timers.get(device)?.pass();
  return encoder.beginRenderPass(timestampWrites ? { ...descriptor, timestampWrites } : descriptor);
}

/** Nonblocking sum of render-pass intervals. Readbacks and query storage are bounded. */
export class WebGpuTimer {
  private readonly slots: Slot[] = [];
  private active?: { slot: Slot; frameId: number; count: number; overflow: boolean };
  private completed?: { frameId: number; elapsedMs: number };
  private frameId = 0;
  private latestCompletedFrame = 0;
  private destroyed = false;
  private current: RendererGpuTimingStats;
  constructor(private readonly device: GPUDevice, enabled: boolean) {
    this.current = { status: enabled ? (device.features?.has("timestamp-query") ? "pending" : "unsupported") : "disabled", pendingQueryCount: 0 };
    timers.set(device, this);
  }
  beginFrame(): void {
    if (this.destroyed || this.active) return;
    this.frameId++;
    if (this.current.status === "disabled" || this.current.status === "unsupported") return;
    this.current = { status: this.completed ? "ready" : "pending", pendingQueryCount: this.slots.filter(s => s.busy).length, ...this.completed };
    this.completed = undefined;
    let slot = this.slots.find(s => !s.busy);
    if (!slot && this.slots.length < MAX_SLOTS) {
      const resources = webGpuResources(this.device);
      let queries: GPUQuerySet | undefined;
      let resolve: GPUBuffer | undefined;
      try {
        queries = this.device.createQuerySet({ type: "timestamp", count: MAX_PASSES * 2 });
        resolve = resources.createBuffer({ size: QUERY_BYTES, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
        const read = resources.createBuffer({ size: QUERY_BYTES, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
        slot = { queries, resolve, read, busy: false }; this.slots.push(slot);
      } catch {
        queries?.destroy(); resources.destroy(resolve);
        // Profiling is optional. Failed allocation leaves this frame unmeasured.
      }
    }
    if (slot) { slot.busy = true; this.active = { slot, frameId: this.frameId, count: 0, overflow: false }; }
  }
  pass(): GPURenderPassTimestampWrites | undefined {
    const active = this.active;
    if (!active) return;
    if (active.count >= MAX_PASSES * 2) { active.overflow = true; return; }
    const index = active.count; active.count += 2;
    return { querySet: active.slot.queries, beginningOfPassWriteIndex: index, endOfPassWriteIndex: index + 1 };
  }
  endFrame(discard = false): void {
    const active = this.active; this.active = undefined;
    if (!active || this.destroyed) return;
    const { slot, frameId, count, overflow } = active;
    if (!count || overflow || discard) { slot.busy = false; return; }
    try {
      const encoder = this.device.createCommandEncoder();
      encoder.resolveQuerySet(slot.queries, 0, count, slot.resolve, 0);
      encoder.copyBufferToBuffer(slot.resolve, 0, slot.read, 0, count * 8);
      this.device.queue.submit([encoder.finish()]);
      void slot.read.mapAsync(GPUMapMode.READ, 0, count * 8).then(() => {
        if (this.destroyed) return;
        try {
          const values = new BigUint64Array(slot.read.getMappedRange(0, count * 8));
          let nanos = BigInt(0);
          for (let i = 0; i < count; i += 2) {
            if (values[i + 1] < values[i]) return;
            nanos += values[i + 1] - values[i];
          }
          if (frameId > this.latestCompletedFrame) {
            this.latestCompletedFrame = frameId;
            this.completed = { frameId, elapsedMs: Number(nanos) / 1_000_000 };
          }
        } finally { slot.read.unmap(); }
      }).catch(() => { /* Loss/destroy rejects mapping. Missing results remain unmeasured. */ }).finally(() => { slot.busy = false; });
    } catch {
      // Synchronous encoder/submit/map failure must not leak a busy query slot.
      slot.busy = false;
    }
  }
  stats(): RendererGpuTimingStats {
    return { ...this.current, currentFrameId: this.frameId, pendingQueryCount: this.slots.filter(s => s.busy).length };
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true; this.active = undefined; this.completed = undefined;
    for (const slot of this.slots) {
      slot.queries.destroy(); webGpuResources(this.device).destroy(slot.resolve); webGpuResources(this.device).destroy(slot.read);
    }
    this.slots.length = 0; timers.delete(this.device);
    this.current = { status: "disabled", pendingQueryCount: 0 };
  }
}
