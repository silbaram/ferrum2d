/** Options for one manifest load. Limits apply to this batch, not all loaders globally. */
export interface AssetLoadOptions {
  /** Number of simultaneous items, an integer in [1, 16]. Default: 1. */
  concurrency?: number;
  /** Cancels queued items and signals in-flight work. Completed resources remain loaded. */
  signal?: AbortSignal;
}

export function throwIfAssetLoadAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Asset loading was aborted.", "AbortError");
}

/** Explicit listener cleanup also supports browsers without AbortSignal.any(). */
export function createAssetLoadScope(...signals: (AbortSignal | undefined)[]): {
  controller: AbortController;
  dispose: () => void;
} {
  for (const signal of signals) {
    if (signal !== undefined && (!signal || typeof signal.aborted !== "boolean"
      || typeof signal.addEventListener !== "function" || typeof signal.removeEventListener !== "function")) {
      throw new Error("Asset load signal must be an AbortSignal.");
    }
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of signals) {
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  }
  return {
    controller,
    dispose: () => {
      for (const signal of signals) signal?.removeEventListener("abort", abort);
    },
  };
}

/** Drain started tasks before rejecting; never leave a worker mutating after settlement. */
export async function runAssetLoadTasks<T>(
  entries: readonly T[],
  options: AssetLoadOptions,
  task: (entry: T, signal: AbortSignal) => Promise<void>,
  onStart: () => void,
): Promise<void> {
  const concurrency = options.concurrency === undefined ? 1 : options.concurrency;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
    throw new Error("Asset load concurrency must be an integer in [1, 16].");
  }
  const scope = createAssetLoadScope(options.signal);
  const signal = scope.controller.signal;
  let next = 0;
  let failure: { error: unknown } | undefined;
  const worker = async (): Promise<void> => {
    while (!signal.aborted && next < entries.length) {
      const entry = entries[next++];
      try {
        await task(entry, signal);
      } catch (error) {
        if (failure === undefined) {
          // Explicit cancellation takes precedence over a later decode/fetch failure.
          failure = { error: signal.aborted ? new DOMException("Asset loading was aborted.", "AbortError") : error };
        }
        scope.controller.abort();
      }
    }
  };
  try {
    throwIfAssetLoadAborted(signal);
    onStart();
    await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, worker));
    if (failure !== undefined) throw failure.error;
    throwIfAssetLoadAborted(signal);
  } finally {
    scope.dispose();
  }
}
