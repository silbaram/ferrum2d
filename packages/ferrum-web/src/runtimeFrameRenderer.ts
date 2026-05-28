import type { DebugOverlay } from "./debugOverlay.js";
import type { DebugOverlayMetrics } from "./debugOverlay.js";
import type { FrameState } from "./engineTypes.js";
import type { RenderFrameState } from "./engineFramePipeline.js";
import type { RuntimeProfiler } from "./runtimeProfiler.js";
import type { UiOverlay } from "./uiOverlay.js";
import type {
  FerrumRuntimeFrame,
  FerrumRuntimeOptions,
  FerrumRuntimeRenderer,
  UiOverlayStateProvider,
} from "./createFerrumRuntime.js";
import type { RendererStats } from "./renderer.js";

export interface RuntimeFrameRendererOptions {
  renderer: FerrumRuntimeRenderer;
  lighting?: FerrumRuntimeOptions["lighting"];
  postProcess?: FerrumRuntimeOptions["postProcess"];
  spriteMaterial?: FerrumRuntimeOptions["spriteMaterial"];
  shouldRenderPhysicsDebugLines: boolean;
  needsRuntimeFrame: boolean;
  debugOverlay?: DebugOverlay;
  uiOverlay?: UiOverlay;
  uiState?: UiOverlayStateProvider;
  profiler?: RuntimeProfiler;
  gameStateLabel?: (code: number) => string;
  onFrame?: (frame: FerrumRuntimeFrame) => void;
  now?: () => number;
}

export class RuntimeFrameRenderer {
  private readonly now: () => number;
  private audioEventRateWindowStartMs: number;
  private audioEventRateCount = 0;
  private audioEventsPerSecond = 0;

  constructor(private readonly options: RuntimeFrameRendererOptions) {
    this.now = options.now ?? (() => performance.now());
    this.audioEventRateWindowStartMs = this.now();
  }

  renderFrame(renderFrame: RenderFrameState): void {
    const renderStartMs = this.options.needsRuntimeFrame ? this.now() : 0;
    let frame = this.applyDynamicFrameProviders(renderFrame);

    this.options.renderer.render();
    let rendererStats = this.options.renderer.renderCommands(renderFrame.renderCommandBuffer);
    if (this.options.shouldRenderPhysicsDebugLines && renderFrame.physicsDebugLineBuffer !== undefined) {
      rendererStats = this.options.renderer.renderPhysicsDebugLines(renderFrame.physicsDebugLineBuffer, {
        x: renderFrame.cameraX,
        y: renderFrame.cameraY,
      });
    }
    rendererStats = this.options.renderer.renderPostProcess?.() ?? rendererStats;
    if (!this.options.needsRuntimeFrame) {
      return;
    }

    if (frame === undefined) {
      frame = requireFrameState(renderFrame);
    }
    this.publishRuntimeFrame(frame, rendererStats, this.now() - renderStartMs);
  }

  private applyDynamicFrameProviders(renderFrame: RenderFrameState): FrameState | undefined {
    if (!hasDynamicFrameProviders(this.options)) {
      return undefined;
    }

    const frame = requireFrameState(renderFrame);
    if (typeof this.options.lighting === "function") {
      this.options.renderer.setLighting?.(this.options.lighting(frame));
    }
    if (typeof this.options.spriteMaterial === "function") {
      this.options.renderer.setSpriteMaterial?.(this.options.spriteMaterial(frame));
    }
    if (typeof this.options.postProcess === "function") {
      this.options.renderer.setPostProcess?.(this.options.postProcess(frame));
    }
    return frame;
  }

  private publishRuntimeFrame(frame: FrameState, rendererStats: RendererStats, renderTimeMs: number): void {
    this.audioEventRateCount += frame.audioEventCount;
    const nowMs = this.now();
    const audioEventRateElapsedMs = nowMs - this.audioEventRateWindowStartMs;
    if (audioEventRateElapsedMs >= 1000) {
      this.audioEventsPerSecond = this.audioEventRateCount / (audioEventRateElapsedMs / 1000);
      this.audioEventRateWindowStartMs = nowMs;
      this.audioEventRateCount = 0;
    }

    const fps = frame.frameTimeMs > 0 ? 1000 / frame.frameTimeMs : 0;
    const debugMetrics = buildDebugMetrics(
      frame,
      rendererStats,
      fps,
      renderTimeMs,
      this.audioEventsPerSecond,
      this.options.gameStateLabel ?? defaultGameStateLabel,
    );
    this.options.debugOverlay?.update(debugMetrics);
    const runtimeFrame: FerrumRuntimeFrame = {
      frame,
      rendererStats,
      debugMetrics,
      fps,
      renderTimeMs,
    };
    if (this.options.uiOverlay && this.options.uiState) {
      this.options.uiOverlay.update(this.options.uiState(runtimeFrame));
    }
    this.options.profiler?.recordFrame(debugMetrics);
    this.options.onFrame?.(runtimeFrame);
  }
}

function hasDynamicFrameProviders(options: RuntimeFrameRendererOptions): boolean {
  return typeof options.lighting === "function"
    || typeof options.spriteMaterial === "function"
    || typeof options.postProcess === "function";
}

function requireFrameState(renderFrame: RenderFrameState): FrameState {
  if (renderFrame.frameState === undefined) {
    throw new Error("FerrumRuntime frame state was not requested for this runtime frame.");
  }
  return renderFrame.frameState;
}

function buildDebugMetrics(
  frame: FrameState,
  rendererStats: RendererStats,
  fps: number,
  renderTimeMs: number,
  audioEventsPerSecond: number,
  gameStateLabel: (code: number) => string,
): DebugOverlayMetrics {
  return {
    fps,
    frameTimeMs: frame.frameTimeMs,
    entityCount: frame.entityCount,
    spriteCount: frame.spriteCount,
    drawCalls: rendererStats.drawCalls,
    batchCount: rendererStats.batchCount,
    renderCommandCount: rendererStats.renderCommandCount,
    textureBindCount: rendererStats.textureBindCount,
    textureSwitchCount: rendererStats.textureSwitchCount,
    lightingDrawCalls: rendererStats.lightingDrawCalls,
    pointLightCount: rendererStats.pointLightCount,
    tileOccluderCount: rendererStats.tileOccluderCount,
    shadowDrawCalls: rendererStats.shadowDrawCalls,
    shadowCasterCount: rendererStats.shadowCasterCount,
    postProcessDrawCalls: rendererStats.postProcessDrawCalls,
    postProcessPassCount: rendererStats.postProcessPassCount,
    physicsDebugLineCount: rendererStats.physicsDebugLineCount,
    audioEventsPerSecond,
    physicsMode: frame.physics.mode,
    physicsFixedSteps: frame.physics.fixedSteps,
    physicsKinematicHits: frame.physics.kinematicHits,
    physicsTileCandidateChecks: frame.physics.tileCandidateChecks,
    collisionPairCount: frame.physics.collisionPairs,
    collisionEventCount: frame.physics.collisionEventCount,
    physicsCcdChecks: frame.physics.ccdChecks,
    physicsCcdHits: frame.physics.ccdHits,
    physicsSleepingBodies: frame.physics.sleepingBodies,
    physicsBrokenJoints: frame.physics.brokenJoints,
    rustUpdateTimeMs: frame.rustUpdateTimeMs,
    renderTimeMs,
    mouseX: frame.mouseX,
    mouseY: frame.mouseY,
    cameraX: frame.cameraX,
    cameraY: frame.cameraY,
    gameState: gameStateLabel(frame.gameState),
    score: frame.score,
  };
}

function defaultGameStateLabel(code: number): string {
  if (code === 0) return "Title";
  if (code === 1) return "Playing";
  if (code === 2) return "GameOver";
  return `State ${code}`;
}
