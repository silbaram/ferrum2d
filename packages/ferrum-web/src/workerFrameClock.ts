export interface FrameClock {
  start(onTick: (timestampMs: number) => void, onError?: () => void): void;
  stop(): void;
}

class WorkerFrameClock implements FrameClock {
  private worker: Worker | null = null;
  private workerUrl: string | null = null;

  start(onTick: (timestampMs: number) => void, onError?: () => void): void {
    if (this.worker) return;

    const blob = new Blob([WORKER_SOURCE], { type: "text/javascript" });
    this.workerUrl = URL.createObjectURL(blob);

    try {
      const worker = new Worker(this.workerUrl);
      worker.onmessage = (event: MessageEvent<{ type?: string; now?: number }>) => {
        if (event.data?.type === "tick" && typeof event.data.now === "number") {
          onTick(event.data.now);
        }
      };
      worker.onerror = () => {
        this.stop();
        onError?.();
      };

      this.worker = worker;
      worker.postMessage({ type: "start", intervalMs: 1000 / 60 });
    } catch {
      this.stop();
      onError?.();
    }
  }

  stop(): void {
    if (this.worker) {
      this.worker.postMessage({ type: "stop" });
      this.worker.terminate();
      this.worker = null;
    }

    if (this.workerUrl) {
      URL.revokeObjectURL(this.workerUrl);
      this.workerUrl = null;
    }
  }
}

const WORKER_SOURCE = `
let timer = null;
let nextTickAt = 0;

const stop = () => {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
};

const schedule = (intervalMs) => {
  const now = performance.now();
  if (nextTickAt <= 0) nextTickAt = now + intervalMs;
  const delay = Math.max(0, nextTickAt - now);

  timer = setTimeout(() => {
    const tickNow = performance.now();
    postMessage({ type: 'tick', now: tickNow });
    nextTickAt += intervalMs;

    if (tickNow - nextTickAt > intervalMs * 4) {
      nextTickAt = tickNow + intervalMs;
    }
    schedule(intervalMs);
  }, delay);
};

onmessage = (event) => {
  if (event.data?.type === 'start') {
    stop();
    const intervalMs = Math.max(1, Number(event.data.intervalMs) || 16.6667);
    nextTickAt = 0;
    schedule(intervalMs);
    return;
  }

  if (event.data?.type === 'stop') {
    stop();
    nextTickAt = 0;
  }
};
`;

export function createWorkerFrameClock(): FrameClock | null {
  if (
    typeof Worker === "undefined" ||
    typeof Blob === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return null;
  }
  return new WorkerFrameClock();
}
