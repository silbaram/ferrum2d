export type FrameCallback = (deltaSeconds: number) => void;

/** The native variable clock rejects positive intervals below 0.1 ms (Rust MIN_INTERVAL). */
const MIN_FRAME_DELTA_SECONDS = 0.0001;

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
    // A frame callback may pause/stop or restart the loop itself. Do not revive
    // a stopped loop or overwrite the RAF already scheduled by that restart.
    if (!this.running || this.paused || this.rafId !== null) return;
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

    // Browsers occasionally deliver frame timestamps microseconds apart. Keep the
    // previous timestamp so the gap accumulates into the next usable interval.
    if (rawDeltaSeconds > 0 && rawDeltaSeconds < MIN_FRAME_DELTA_SECONDS) {
      this.scheduleNextFrame();
      return;
    }

    const deltaSeconds = Math.min(rawDeltaSeconds, this.maxDeltaSeconds);

    this.lastTimestampMs = timestampMs;
    try {
      this.onFrame(deltaSeconds);
    } catch (error) {
      this.stop();
      throw error;
    }
    this.scheduleNextFrame();
  }
}
