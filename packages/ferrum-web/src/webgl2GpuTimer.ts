import type { RendererGpuTimingStats } from "./gpuTiming.js";

interface TimerExtension {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

interface FrameQuery {
  query: WebGLQuery;
  frameId: number;
}

/** Internal, bounded, nonblocking timer. Never reads unavailable query results. */
export class WebGL2GpuTimer {
  private extension: TimerExtension | null;
  private readonly pending: FrameQuery[] = [];
  private readonly idle: WebGLQuery[] = [];
  private active?: FrameQuery;
  private frameId = 0;
  private lost = false;
  private destroyed = false;
  private current: RendererGpuTimingStats;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.extension = gl.getExtension("EXT_disjoint_timer_query_webgl2");
    this.current = { status: this.extension ? "pending" : "unsupported", pendingQueryCount: 0 };
  }

  beginFrame(): void {
    if (this.destroyed || this.active) return;
    this.frameId += 1;
    if (this.gl.isContextLost()) {
      this.lost = true;
      this.clearQueries(false);
      this.current = { status: "context-lost", pendingQueryCount: 0 };
      return;
    }
    if (this.lost) {
      this.extension = this.gl.getExtension("EXT_disjoint_timer_query_webgl2");
      this.lost = false;
    }
    const ext = this.extension;
    this.current = { status: ext ? "pending" : "unsupported", pendingQueryCount: this.pending.length };
    if (!ext) return;
    if (this.gl.getParameter(ext.GPU_DISJOINT_EXT)) {
      this.clearQueries(true);
      this.current = { status: "disjoint", pendingQueryCount: 0 };
      return;
    }
    const oldest = this.pending[0];
    if (oldest && this.gl.getQueryParameter(oldest.query, this.gl.QUERY_RESULT_AVAILABLE)) {
      const nanos: unknown = this.gl.getQueryParameter(oldest.query, this.gl.QUERY_RESULT);
      this.pending.shift();
      this.idle.push(oldest.query);
      if (typeof nanos === "number" && Number.isFinite(nanos) && nanos >= 0) {
        this.current = { status: "ready", frameId: oldest.frameId, elapsedMs: nanos / 1_000_000,
          pendingQueryCount: this.pending.length };
      }
    }
    // A slow GPU or an external timer must not cause unbounded allocation or nested queries.
    if (this.pending.length >= 4 || this.gl.getQuery(ext.TIME_ELAPSED_EXT, this.gl.CURRENT_QUERY)) return;
    const query = this.idle.pop() ?? this.gl.createQuery();
    if (!query) return;
    this.active = { query, frameId: this.frameId };
    this.gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
  }

  endFrame(): void {
    if (this.destroyed || !this.active || !this.extension) return;
    if (this.gl.isContextLost()) {
      this.lost = true;
      this.clearQueries(false);
      this.current = { status: "context-lost", pendingQueryCount: 0 };
      return;
    }
    this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = undefined;
    this.current.pendingQueryCount = this.pending.length;
    // A disjoint event also invalidates a result polled earlier in this frame.
    if (this.gl.getParameter(this.extension.GPU_DISJOINT_EXT)) {
      this.clearQueries(true);
      this.current = { status: "disjoint", pendingQueryCount: 0 };
    }
  }

  stats(): RendererGpuTimingStats {
    return { ...this.current, ...(this.frameId>0&&!this.destroyed?{currentFrameId:this.frameId}:{}) };
  }

  destroy(): void {
    if (this.destroyed) return;
    if (this.active && this.extension && !this.gl.isContextLost()) this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
    this.clearQueries(!this.gl.isContextLost());
    this.destroyed = true;
    this.current = { status: "disabled", pendingQueryCount: 0 };
  }

  private clearQueries(deleteQueries: boolean): void {
    if (deleteQueries) {
      for (const { query } of this.pending) this.gl.deleteQuery(query);
      for (const query of this.idle) this.gl.deleteQuery(query);
      if (this.active) this.gl.deleteQuery(this.active.query);
    }
    this.pending.length = 0;
    this.idle.length = 0;
    this.active = undefined;
  }
}
