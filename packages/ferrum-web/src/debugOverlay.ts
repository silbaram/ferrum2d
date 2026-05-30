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
  lightingDrawCalls?: number;
  pointLightCount?: number;
  tileOccluderCount?: number;
  shadowDrawCalls?: number;
  shadowCasterCount?: number;
  postProcessDrawCalls?: number;
  postProcessPassCount?: number;
  audioEventsPerSecond?: number;
  physicsMode?: string;
  physicsFixedSteps?: number;
  physicsKinematicHits?: number;
  physicsTileCandidateChecks?: number;
  physicsHd2dFilteredEntityCandidates?: number;
  physicsHd2dFilteredTileCandidates?: number;
  playerFloorId?: number;
  playerElevation?: number;
  playerHeight?: number;
  collisionPairCount?: number;
  collisionEventCount?: number;
  physicsDebugLineCount?: number;
  physicsCcdChecks?: number;
  physicsCcdHits?: number;
  physicsSleepingBodies?: number;
  physicsBrokenJoints?: number;
  rustUpdateTimeMs: number;
  renderTimeMs: number;
  mouseX: number;
  mouseY: number;
  cameraX: number;
  cameraY: number;
  gameState: string;
  score: number;
}

export type DebugOverlayMetricUnit = "fps" | "ms" | "count" | "events/s" | "px" | "world" | "state" | "score" | "mode";

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
  { id: "lightingDrawCalls", label: "lighting draws", unit: "count", optional: true },
  { id: "pointLightCount", label: "point lights", unit: "count", optional: true },
  { id: "tileOccluderCount", label: "tile occluders", unit: "count", optional: true },
  { id: "shadowDrawCalls", label: "shadow draws", unit: "count", optional: true },
  { id: "shadowCasterCount", label: "shadow casters", unit: "count", optional: true },
  { id: "postProcessDrawCalls", label: "post-process draws", unit: "count", optional: true },
  { id: "postProcessPassCount", label: "post-process passes", unit: "count", optional: true },
  { id: "audioEventsPerSecond", label: "audio events", unit: "events/s", optional: true },
  { id: "physicsMode", label: "physics mode", unit: "mode", optional: true },
  { id: "physicsFixedSteps", label: "fixed steps", unit: "count", optional: true },
  { id: "physicsKinematicHits", label: "kinematic hits", unit: "count", optional: true },
  { id: "physicsTileCandidateChecks", label: "tile checks", unit: "count", optional: true },
  { id: "physicsHd2dFilteredEntityCandidates", label: "hd2d entity filters", unit: "count", optional: true },
  { id: "physicsHd2dFilteredTileCandidates", label: "hd2d tile filters", unit: "count", optional: true },
  { id: "playerHd2dFloor", label: "player floor", unit: "count", optional: true },
  { id: "playerHd2dElevation", label: "player elevation", unit: "world", optional: true },
  { id: "playerHd2dHeight", label: "player height", unit: "world", optional: true },
  { id: "collisionPairCount", label: "collision pairs", unit: "count", optional: true },
  { id: "collisionEventCount", label: "collision events", unit: "count", optional: true },
  { id: "physicsDebugLineCount", label: "physics debug lines", unit: "count", optional: true },
  { id: "physicsCcdChecks", label: "ccd checks", unit: "count", optional: true },
  { id: "physicsCcdHits", label: "ccd hits", unit: "count", optional: true },
  { id: "physicsSleepingBodies", label: "sleeping bodies", unit: "count", optional: true },
  { id: "physicsBrokenJoints", label: "broken joints", unit: "count", optional: true },
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
  if (metrics.lightingDrawCalls !== undefined) {
    lines.push(row("lightingDrawCalls", metrics.lightingDrawCalls));
  }
  if (metrics.pointLightCount !== undefined) {
    lines.push(row("pointLightCount", metrics.pointLightCount));
  }
  if (metrics.tileOccluderCount !== undefined) {
    lines.push(row("tileOccluderCount", metrics.tileOccluderCount));
  }
  if (metrics.shadowDrawCalls !== undefined) {
    lines.push(row("shadowDrawCalls", metrics.shadowDrawCalls));
  }
  if (metrics.shadowCasterCount !== undefined) {
    lines.push(row("shadowCasterCount", metrics.shadowCasterCount));
  }
  if (metrics.postProcessDrawCalls !== undefined) {
    lines.push(row("postProcessDrawCalls", metrics.postProcessDrawCalls));
  }
  if (metrics.postProcessPassCount !== undefined) {
    lines.push(row("postProcessPassCount", metrics.postProcessPassCount));
  }
  if (metrics.audioEventsPerSecond !== undefined) {
    lines.push(row("audioEventsPerSecond", `${metrics.audioEventsPerSecond.toFixed(1)} events/s`));
  }
  if (metrics.physicsMode !== undefined) {
    lines.push(row("physicsMode", metrics.physicsMode));
  }
  if (metrics.physicsFixedSteps !== undefined) {
    lines.push(row("physicsFixedSteps", metrics.physicsFixedSteps));
  }
  if (metrics.physicsKinematicHits !== undefined) {
    lines.push(row("physicsKinematicHits", metrics.physicsKinematicHits));
  }
  if (metrics.physicsTileCandidateChecks !== undefined) {
    lines.push(row("physicsTileCandidateChecks", metrics.physicsTileCandidateChecks));
  }
  if (metrics.physicsHd2dFilteredEntityCandidates !== undefined) {
    lines.push(row("physicsHd2dFilteredEntityCandidates", metrics.physicsHd2dFilteredEntityCandidates));
  }
  if (metrics.physicsHd2dFilteredTileCandidates !== undefined) {
    lines.push(row("physicsHd2dFilteredTileCandidates", metrics.physicsHd2dFilteredTileCandidates));
  }
  if (metrics.playerFloorId !== undefined) {
    lines.push(row("playerHd2dFloor", metrics.playerFloorId));
  }
  if (metrics.playerElevation !== undefined) {
    lines.push(row("playerHd2dElevation", `${metrics.playerElevation.toFixed(2)} world`));
  }
  if (metrics.playerHeight !== undefined) {
    lines.push(row("playerHd2dHeight", `${metrics.playerHeight.toFixed(2)} world`));
  }
  if (metrics.collisionPairCount !== undefined) {
    lines.push(row("collisionPairCount", metrics.collisionPairCount));
  }
  if (metrics.collisionEventCount !== undefined) {
    lines.push(row("collisionEventCount", metrics.collisionEventCount));
  }
  if (metrics.physicsDebugLineCount !== undefined) {
    lines.push(row("physicsDebugLineCount", metrics.physicsDebugLineCount));
  }
  if (metrics.physicsCcdChecks !== undefined) {
    lines.push(row("physicsCcdChecks", metrics.physicsCcdChecks));
  }
  if (metrics.physicsCcdHits !== undefined) {
    lines.push(row("physicsCcdHits", metrics.physicsCcdHits));
  }
  if (metrics.physicsSleepingBodies !== undefined) {
    lines.push(row("physicsSleepingBodies", metrics.physicsSleepingBodies));
  }
  if (metrics.physicsBrokenJoints !== undefined) {
    lines.push(row("physicsBrokenJoints", metrics.physicsBrokenJoints));
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
