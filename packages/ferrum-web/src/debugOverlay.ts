export interface DebugOverlayMetrics {
  fps: number;
  frameTimeMs: number;
  entityCount: number;
  spriteCount: number;
  drawCalls: number;
  batchCount: number;
  rustUpdateTimeMs: number;
  renderTimeMs: number;
  mouseX: number;
  mouseY: number;
  gameState: string;
  score: number;
}

export interface DebugOverlayOptions {
  enabled?: boolean;
}

export class DebugOverlay {
  private readonly root?: HTMLDivElement;
  private lastUpdateMs = 0;

  constructor(parent: HTMLElement = document.body, options: DebugOverlayOptions = {}) {
    if (options.enabled === false) {
      return;
    }

    const root = document.createElement("div");
    root.style.position = "fixed";
    root.style.left = "12px";
    root.style.top = "12px";
    root.style.zIndex = "1000";
    root.style.minWidth = "220px";
    root.style.padding = "8px 10px";
    root.style.border = "1px solid rgba(148, 163, 184, 0.35)";
    root.style.background = "rgba(15, 23, 42, 0.82)";
    root.style.color = "#e5e7eb";
    root.style.font = "12px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    root.style.whiteSpace = "pre";
    root.style.pointerEvents = "none";
    root.style.borderRadius = "6px";
    root.textContent = "debug: waiting";
    parent.appendChild(root);
    this.root = root;
  }

  update(metrics: DebugOverlayMetrics): void {
    if (!this.root) {
      return;
    }

    const now = performance.now();
    if (now - this.lastUpdateMs < 100) {
      return;
    }
    this.lastUpdateMs = now;

    this.root.textContent = [
      `fps: ${metrics.fps.toFixed(1)}`,
      `frame: ${metrics.frameTimeMs.toFixed(2)}ms`,
      `rust update: ${metrics.rustUpdateTimeMs.toFixed(2)}ms`,
      `render: ${metrics.renderTimeMs.toFixed(2)}ms`,
      `entities: ${metrics.entityCount}`,
      `sprites: ${metrics.spriteCount}`,
      `draw calls: ${metrics.drawCalls}`,
      `batches: ${metrics.batchCount}`,
      `mouse: ${metrics.mouseX.toFixed(1)}, ${metrics.mouseY.toFixed(1)}`,
      `state: ${metrics.gameState}`,
      `score: ${metrics.score}`,
    ].join("\n");
  }

  destroy(): void {
    this.root?.remove();
  }
}
