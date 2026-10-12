/** GPU query results arrive in a later frame; absent time means unmeasured. */
export interface RendererGpuTimingStats {
  status: "disabled" | "unsupported" | "pending" | "ready" | "disjoint" | "context-lost";
  /** Renderer frame that issued the completed query, not the current frame. */
  frameId?: number;
  elapsedMs?: number;
  pendingQueryCount: number;
}
