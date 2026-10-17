import type { RuntimeDiagnosticsFrameSample } from "./runtimeProfiler.js";

export interface RuntimeFrameTraceOptions {
  /** Frame interval or CPU work above this threshold triggers a capture. Default 1000/60. */
  frameBudgetMs?: number;
  /** Delayed, valid GPU results can also trigger a capture. Default frameBudgetMs. */
  gpuBudgetMs?: number;
  /** Before/after the trigger, each 0..240. Default 15. */
  beforeFrames?: number;
  afterFrames?: number;
  /** 1..32 bounded windows. Default 8; older windows are dropped. */
  maxCaptures?: number;
}
export interface RuntimeFrameTraceSample extends Omit<RuntimeDiagnosticsFrameSample, "gpuFrameId"> {
  rendererFrameId: number;
}
export interface RuntimeFrameTraceCapture {
  triggerFrameId: number;
  causes: readonly ("interval" | "cpu" | "gpu")[];
  complete: boolean;
  frames: readonly RuntimeFrameTraceSample[];
}
export interface RuntimeFrameTraceSnapshot {
  captures: readonly RuntimeFrameTraceCapture[];
  droppedCaptureCount: number;
  droppedGpuResultCount: number;
  duplicateGpuResultCount: number;
  missingFrameIdCount: number;
  measuredGpuFrameCount: number;
  unmeasuredGpuFrameCount: number;
}
interface Entry { sequence: number; sample: RuntimeFrameTraceSample; }
interface Capture { trigger: Entry; causes: ("interval" | "cpu" | "gpu")[]; end: number; rows: Entry[]; }

/** Bounded diagnostic copies only; no Wasm views, simulation or driver waits. */
export class RuntimeFrameTraceRecorder {
  private readonly before: number;
  private readonly after: number;
  private readonly capacity: number;
  private readonly historyLimit: number;
  private readonly frameBudget: number;
  private readonly gpuBudget: number;
  private readonly history = new Map<number, Entry>();
  private readonly captures: Capture[] = [];
  private sequence = 0;
  private droppedCaptures = 0;
  private droppedGpuResults = 0;
  private duplicateGpuResults = 0;
  private missingIds = 0;
  private lastFrameId = -1;
  constructor(options: RuntimeFrameTraceOptions) {
    const count = (v: number | undefined, fallback: number, min: number, max: number) => {
      const n = v ?? fallback;
      if (!Number.isSafeInteger(n) || n < min || n > max) throw Error("Invalid frame trace capacity");
      return n;
    };
    const budget = (v: number) => {
      if (!Number.isFinite(v) || v <= 0) throw Error("Invalid frame trace time budget");
      return v;
    };
    this.before = count(options.beforeFrames, 15, 0, 240);
    this.after = count(options.afterFrames, 15, 0, 240);
    this.capacity = count(options.maxCaptures, 8, 1, 32);
    this.frameBudget = budget(options.frameBudgetMs ?? 1000 / 60);
    this.gpuBudget = budget(options.gpuBudgetMs ?? this.frameBudget);
    // Keep enough frames for the configured windows and late queries independently of profiler's rolling window.
    this.historyLimit = Math.max(120, this.before + this.after + 1);
  }
  record(sample: RuntimeDiagnosticsFrameSample): void {
    const id = sample.rendererFrameId;
    if (id === undefined) this.missingIds++;
    else {
      if (id <= this.lastFrameId) throw Error("Frame trace renderer IDs must strictly increase; reset after restarting a renderer");
      this.lastFrameId = id;
      const {gpuFrameId: _gpuId, gpuFrameTimeMs: _gpuMs, ...current} = sample;
      const entry: Entry = {sequence: ++this.sequence, sample: {...current, rendererFrameId: id}};
      this.history.set(id, entry);
      for (const capture of this.captures) if (entry.sequence <= capture.end) capture.rows.push(entry);
      while (this.history.size > this.historyLimit) this.history.delete(this.history.keys().next().value!);
      const causes: Capture["causes"] = [];
      if ((sample.frameIntervalMs ?? sample.frameTimeMs) > this.frameBudget) causes.push("interval");
      if (sample.rustUpdateTimeMs + sample.renderTimeMs > this.frameBudget) causes.push("cpu");
      if (causes.length) this.capture(entry, causes);
    }
    // A result belongs to the issuing frame, never to the row just recorded.
    if (sample.gpuFrameId !== undefined && sample.gpuFrameTimeMs !== undefined) {
      let entry = this.history.get(sample.gpuFrameId);
      if (!entry) for (const capture of this.captures) {
        entry = capture.rows.find(row => row.sample.rendererFrameId === sample.gpuFrameId);
        if (entry) break;
      }
      if (!entry) this.droppedGpuResults++;
      else if (entry.sample.gpuFrameTimeMs !== undefined) this.duplicateGpuResults++;
      else {
        entry.sample.gpuFrameTimeMs = sample.gpuFrameTimeMs;
        if (sample.gpuFrameTimeMs > this.gpuBudget) this.capture(entry, ["gpu"]);
      }
    }
  }
  private capture(trigger: Entry, causes: Capture["causes"]): void {
    const existing = this.captures.find(c => c.rows.some(row => row === trigger));
    if (existing) {
      if (existing.trigger === trigger) for (const cause of causes) if (!existing.causes.includes(cause)) existing.causes.push(cause);
      return;
    }
    const end = trigger.sequence + this.after;
    const rows = [...this.history.values()].filter(row => row.sequence >= trigger.sequence - this.before && row.sequence <= end);
    // A very late result may refer to a retained capture, handled above; otherwise it is in history.
    if (!rows.includes(trigger)) return;
    this.captures.push({trigger, causes: [...causes], end, rows});
    if (this.captures.length > this.capacity) { this.captures.shift(); this.droppedCaptures++; }
  }
  snapshot(): RuntimeFrameTraceSnapshot {
    const unique = new Map<number, RuntimeFrameTraceSample>();
    const captures = this.captures.map(c => ({
      triggerFrameId: c.trigger.sample.rendererFrameId, causes: [...c.causes], complete: this.sequence >= c.end,
      frames: c.rows.map(row => {
        const sample = {...row.sample}; unique.set(sample.rendererFrameId, sample); return sample;
      }),
    }));
    const measured = [...unique.values()].filter(s => s.gpuFrameTimeMs !== undefined).length;
    return {captures, droppedCaptureCount: this.droppedCaptures, droppedGpuResultCount: this.droppedGpuResults,
      duplicateGpuResultCount: this.duplicateGpuResults, missingFrameIdCount: this.missingIds,
      measuredGpuFrameCount: measured, unmeasuredGpuFrameCount: unique.size - measured};
  }
  reset(): void {
    this.history.clear(); this.captures.length = 0; this.sequence = 0; this.lastFrameId = -1;
    this.droppedCaptures = this.droppedGpuResults = this.duplicateGpuResults = this.missingIds = 0;
  }
}
