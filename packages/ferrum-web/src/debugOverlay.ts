export interface DebugOverlayMetrics {
  fps: number;
  frameTimeMs: number;
  entityCount: number;
  spriteCount: number;
  drawCalls: number;
  batchCount: number;
  renderCommandCount?: number;
  textureBindCount?: number;
  textureSwitchCount?: number;
  audioEventsPerSecond?: number;
  rustUpdateTimeMs: number;
  renderTimeMs: number;
  mouseX: number;
  mouseY: number;
  cameraX: number;
  cameraY: number;
  gameState: string;
  score: number;
}

export type DebugOverlayMetricUnit = "fps" | "ms" | "count" | "events/s" | "px" | "world" | "state" | "score";

export interface DebugOverlayRowContract {
  id: string;
  label: string;
  unit: DebugOverlayMetricUnit;
  optional?: boolean;
}

export const DEBUG_OVERLAY_ROW_CONTRACT: readonly DebugOverlayRowContract[] = [
  { id: "fps", label: "fps", unit: "fps" },
  { id: "frameTimeMs", label: "frame time", unit: "ms" },
  { id: "rustUpdateTimeMs", label: "rust update", unit: "ms" },
  { id: "renderTimeMs", label: "render", unit: "ms" },
  { id: "entityCount", label: "entities", unit: "count" },
  { id: "spriteCount", label: "sprites", unit: "count" },
  { id: "drawCalls", label: "draw calls", unit: "count" },
  { id: "batchCount", label: "batches", unit: "count" },
  { id: "renderCommandCount", label: "render commands", unit: "count", optional: true },
  { id: "textureBindCount", label: "texture binds", unit: "count", optional: true },
  { id: "textureSwitchCount", label: "texture switches", unit: "count", optional: true },
  { id: "audioEventsPerSecond", label: "audio events", unit: "events/s", optional: true },
  { id: "mousePosition", label: "mouse", unit: "px" },
  { id: "cameraPosition", label: "camera", unit: "world" },
  { id: "gameState", label: "state", unit: "state" },
  { id: "score", label: "score", unit: "score" },
];

export interface DebugOverlayOptions {
  enabled?: boolean;
}

export class DebugOverlay {
  private root?: HTMLDivElement;
  private lastUpdateMs = Number.NEGATIVE_INFINITY;
  private destroyed = false;

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
    if (this.destroyed || !this.root) {
      return;
    }

    const now = performance.now();
    if (now - this.lastUpdateMs < 100) {
      return;
    }
    this.lastUpdateMs = now;

    this.root.textContent = formatDebugOverlayMetrics(metrics).join("\n");
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.root?.remove();
    this.root = undefined;
  }
}

export function formatDebugOverlayMetrics(metrics: DebugOverlayMetrics): string[] {
  const lines = [
    row("fps", `${metrics.fps.toFixed(1)} fps`),
    row("frameTimeMs", `${metrics.frameTimeMs.toFixed(2)} ms`),
    row("rustUpdateTimeMs", `${metrics.rustUpdateTimeMs.toFixed(2)} ms`),
    row("renderTimeMs", `${metrics.renderTimeMs.toFixed(2)} ms`),
    row("entityCount", metrics.entityCount),
    row("spriteCount", metrics.spriteCount),
    row("drawCalls", metrics.drawCalls),
    row("batchCount", metrics.batchCount),
  ];

  if (metrics.renderCommandCount !== undefined) {
    lines.push(row("renderCommandCount", metrics.renderCommandCount));
  }
  if (metrics.textureBindCount !== undefined) {
    lines.push(row("textureBindCount", metrics.textureBindCount));
  }
  if (metrics.textureSwitchCount !== undefined) {
    lines.push(row("textureSwitchCount", metrics.textureSwitchCount));
  }
  if (metrics.audioEventsPerSecond !== undefined) {
    lines.push(row("audioEventsPerSecond", `${metrics.audioEventsPerSecond.toFixed(1)} events/s`));
  }
  lines.push(
    row("mousePosition", `${metrics.mouseX.toFixed(1)}, ${metrics.mouseY.toFixed(1)} px`),
    row("cameraPosition", `${metrics.cameraX.toFixed(1)}, ${metrics.cameraY.toFixed(1)} world`),
    row("gameState", metrics.gameState),
    row("score", metrics.score),
  );
  return lines;
}

function row(id: string, value: string | number): string {
  const contract = DEBUG_OVERLAY_ROW_CONTRACT.find((entry) => entry.id === id);
  if (!contract) {
    throw new Error(`Unknown debug overlay row '${id}'.`);
  }
  return `${contract.label}: ${value}`;
}
