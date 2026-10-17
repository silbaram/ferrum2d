/** GPU query results arrive in a later frame; absent time means unmeasured. */
export interface RendererGpuTimingStats {
  status: "disabled" | "unsupported" | "pending" | "ready" | "disjoint" | "context-lost";
  /** Most recent begun renderer frame, including frames without an available query slot. */
  currentFrameId?: number;
  /** Renderer frame that issued the completed query, not the current frame. */
  frameId?: number;
  elapsedMs?: number;
  pendingQueryCount: number;
}
