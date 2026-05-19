export type FrameCallback = (deltaSeconds: number) => void;

export class GameLoop {
  private rafId: number | null = null;
  private running = false;
  private paused = false;
  private lastTimestampMs: number | null = null;

  constructor(
    private readonly onFrame: FrameCallback,
    private readonly maxDeltaSeconds = 0.05,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.lastTimestampMs = null;

    this.scheduleNextFrame();
  }

  pause(): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    this.clearRaf();
  }

  resume(): void {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this.lastTimestampMs = null;

    this.scheduleNextFrame();
  }

  stop(): void {
    this.running = false;
    this.paused = false;
    this.lastTimestampMs = null;
    this.clearRaf();
  }

  isRunning(): boolean {
    return this.running && !this.paused;
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
      this.scheduleNextFrame();
      return;
    }

    const rawDeltaSeconds = (timestampMs - this.lastTimestampMs) / 1000;
    if (!Number.isFinite(rawDeltaSeconds) || rawDeltaSeconds < 0) {
      this.lastTimestampMs = timestampMs;
      this.scheduleNextFrame();
      return;
    }

    const deltaSeconds = Math.min(rawDeltaSeconds, this.maxDeltaSeconds);

    this.lastTimestampMs = timestampMs;
    this.onFrame(deltaSeconds);
    this.scheduleNextFrame();
  }
}
