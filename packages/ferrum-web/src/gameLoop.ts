import { createWorkerFrameClock, type FrameClock } from "./workerFrameClock";

export type FrameCallback = (deltaSeconds: number) => void;

export interface GameLoopOptions {
  useWorkerClock?: boolean;
  frameClockFactory?: () => FrameClock | null;
}

export class GameLoop {
  private rafId: number | null = null;
  private running = false;
  private paused = false;
  private lastTimestampMs: number | null = null;
  private frameClock: FrameClock | null = null;

  constructor(
    private readonly onFrame: FrameCallback,
    private readonly maxDeltaSeconds = 0.05,
    private readonly options: GameLoopOptions = {},
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.lastTimestampMs = null;

    if (this.tryStartWorkerClock()) return;
    this.scheduleNextFrame();
  }

  pause(): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    this.clearRaf();
    this.stopWorkerClock();
  }

  resume(): void {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this.lastTimestampMs = null;

    if (this.tryStartWorkerClock()) return;
    this.scheduleNextFrame();
  }

  stop(): void {
    this.running = false;
    this.paused = false;
    this.lastTimestampMs = null;
    this.clearRaf();
    this.stopWorkerClock();
  }

  isRunning(): boolean {
    return this.running && !this.paused;
  }

  private tryStartWorkerClock(): boolean {
    if (!this.options.useWorkerClock) return false;

    const workerClock = this.options.frameClockFactory?.() ?? createWorkerFrameClock();
    if (!workerClock) {
      console.warn("[Ferrum2D] Worker clock를 사용할 수 없어 requestAnimationFrame으로 fallback합니다.");
      return false;
    }
    this.frameClock = workerClock;
    workerClock.start((timestampMs) => this.tick(timestampMs), () => this.handleWorkerClockError());
    return true;
  }

  private stopWorkerClock(): void {
    this.frameClock?.stop();
    this.frameClock = null;
  }

  private handleWorkerClockError(): void {
    this.frameClock = null;
    if (!this.running || this.paused) return;
    this.lastTimestampMs = null;
    this.scheduleNextFrame();
  }

  private clearRaf(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private scheduleNextFrame(): void {
    this.rafId = requestAnimationFrame((timestampMs) => {
      this.rafId = null;
      this.tick(timestampMs);
    });
  }

  private tick(timestampMs: number): void {
    if (!this.running || this.paused) return;

    if (this.lastTimestampMs === null) {
      this.lastTimestampMs = timestampMs;
      if (!this.frameClock) this.scheduleNextFrame();
      return;
    }

    const rawDeltaSeconds = (timestampMs - this.lastTimestampMs) / 1000;
    if (!Number.isFinite(rawDeltaSeconds) || rawDeltaSeconds < 0) {
      this.lastTimestampMs = timestampMs;
      if (!this.frameClock) this.scheduleNextFrame();
      return;
    }

    const deltaSeconds = Math.min(rawDeltaSeconds, this.maxDeltaSeconds);

    this.lastTimestampMs = timestampMs;
    this.onFrame(deltaSeconds);
    if (!this.frameClock) this.scheduleNextFrame();
  }
}
