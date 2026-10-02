export interface ShaderPreparationProgress {
  phase: "compiling" | "ready";
  completedPrograms: number;
  totalPrograms: number;
  parallelCompile: boolean;
  elapsedMs: number;
}

/** Opt-in WebGL2 preparation. Unsupported devices can still block on link status. */
export interface ShaderPreparationOptions {
  signal?: AbortSignal;
  /** Wall-time limit, including event-loop waits; default 30 seconds. */
  timeoutMs?: number;
  onProgress?: (progress: ShaderPreparationProgress) => void;
}
