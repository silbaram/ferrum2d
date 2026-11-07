import type { RendererResourceStats } from "./rendererResources";
import type { DebugOverlay } from "./debugOverlay.js";
import type { DebugOverlayMetrics } from "./debugOverlay.js";
import type { FrameState } from "./engineTypes.js";
import { GAME_STATE_CODE, type GameStateCode } from "./gameState.js";
import type { RenderFrameState } from "./engineFramePipeline.js";
import type { RuntimeProfiler } from "./runtimeProfiler.js";
import type { RendererGpuTimingStats } from "./gpuTiming.js";
import type { UiOverlay } from "./uiOverlay.js";
import type {
  FerrumRuntimeFrame,
  FerrumRuntimeOptions,
  FerrumRuntimeAnimationTimeline,
  FerrumRuntimeCutscene,
  FerrumRuntimeLevelStreaming,
  UiOverlayStateProvider,
} from "./createFerrumRuntime.js";
import { emptyRendererStats, type RendererStats } from "./renderer.js";
import type { RuntimeFrameRenderTarget } from "./runtimeRenderer.js";
import { snapshotFrameBuffers, snapshotRenderFrameBuffers } from "./frameBufferSnapshot.js";

export interface RuntimeFrameRendererOptions {
  renderer: RuntimeFrameRenderTarget;
  /** Internal opt-in for built-in GPU consumers that never mutate native state. */
  borrowNativeBuffers?: boolean;
  isAlive?: () => boolean;
  lighting?: FerrumRuntimeOptions["lighting"];
  postProcess?: FerrumRuntimeOptions["postProcess"];
  spriteMaterial?: FerrumRuntimeOptions["spriteMaterial"];
  shouldRenderPhysicsDebugLines: boolean;
  physicsDebugLineComposer?: FerrumRuntimeOptions["physicsDebugLineComposer"];
  needsRuntimeFrame: boolean;
  debugOverlay?: DebugOverlay;
  uiOverlay?: UiOverlay;
  uiState?: UiOverlayStateProvider;
  animationTimeline?: FerrumRuntimeAnimationTimeline;
  cutscene?: FerrumRuntimeCutscene;
  levelStreaming?: FerrumRuntimeLevelStreaming;
  profiler?: RuntimeProfiler;
  gameStateLabel?: (code: GameStateCode) => string;
  onFrame?: (frame: FerrumRuntimeFrame) => void;
  now?: () => number;
}

export class RuntimeFrameRenderer {
  private readonly now: () => number;
  private rendererFrameId = 0;
  private previousRenderAtMs?: number;
  private audioEventRateWindowStartMs: number;
  private audioEventRateCount = 0;
  private audioEventsPerSecond = 0;
  private lastPrimitiveSpriteMaterialProviderValue: PrimitiveDynamicProviderValue | typeof UNSET_PROVIDER_VALUE =
    UNSET_PROVIDER_VALUE;
  private lastPrimitivePostProcessProviderValue: PrimitiveDynamicProviderValue | typeof UNSET_PROVIDER_VALUE =
    UNSET_PROVIDER_VALUE;

  constructor(private readonly options: RuntimeFrameRendererOptions) {
    this.now = options.now ?? (() => performance.now());
    this.audioEventRateWindowStartMs = this.now();
  }

  renderFrame(renderFrame: RenderFrameState): void {
    if (this.options.isAlive?.() === false) return;
    // Providers/composers are application code and can call allocating native
    // APIs. Capture the presented frame before invoking them, not after growth.
    if (this.options.borrowNativeBuffers !== true || hasDynamicFrameProviders(this.options)
      || this.options.physicsDebugLineComposer !== undefined) {
      renderFrame = snapshotRenderFrameBuffers(renderFrame);
    }
    const renderer = this.options.renderer;
    if (renderFrame.renderCommandBuffer.spatial && !renderer.supportsSpatialScene)
      throw new Error("Renderer does not support spatial scene geometry");
    if((renderFrame.renderCommandBuffer.groundShadowVolumes?.vertexCount??0)>0&&!renderer.supportsGroundShadowVolumes)
      throw new Error("Renderer does not support ground shadow volume geometry");
    const debugLines = this.options.shouldRenderPhysicsDebugLines ? renderFrame.physicsDebugLineBuffer : undefined;
    const renderDebugLines = renderer.renderPhysicsDebugLines;
    if (debugLines !== undefined && renderDebugLines === undefined)
      throw new Error("Renderer does not support physics debug lines");
    const renderStartMs = this.options.needsRuntimeFrame ? this.now() : 0;
    this.rendererFrameId++;
    const ready = renderer.isRenderReady?.() !== false;
    if (this.options.isAlive?.() === false) return;
    let frame = ready ? this.applyDynamicFrameProviders(renderFrame) : undefined;
    if (this.options.isAlive?.() === false) return;

    let rendererStats: RendererStats;
    if (ready) {
      let frameSucceeded = false;
      renderer.beginGpuTiming?.();
      try {
        if (this.options.isAlive?.() === false) return;
        renderer.render();
        if (this.options.isAlive?.() === false) return;
        rendererStats = renderer.renderCommands(renderFrame.renderCommandBuffer);
        if (this.options.isAlive?.() === false) return;
        if (debugLines !== undefined && renderDebugLines !== undefined) {
          const physicsDebugLines = this.options.physicsDebugLineComposer?.(debugLines) ?? debugLines;
          if (this.options.isAlive?.() === false) return;
          rendererStats = renderDebugLines.call(renderer, physicsDebugLines, {
            x: renderFrame.cameraX,
            y: renderFrame.cameraY,
          });
        }
        if (this.options.isAlive?.() === false) return;
        rendererStats = renderer.renderPostProcess?.() ?? rendererStats;
        frameSucceeded = true;
      } finally {
        if (this.options.isAlive?.() !== false) renderer.endGpuTiming?.(!frameSucceeded);
      }
    } else {
      rendererStats = emptyRendererStats();
    }
    if (!this.options.needsRuntimeFrame || this.options.isAlive?.() === false) {
      return;
    }

    if (frame === undefined) {
      frame = requireFrameState(renderFrame);
    }
    this.publishRuntimeFrame(frame, rendererStats, this.now() - renderStartMs, renderStartMs);
  }

  private applyDynamicFrameProviders(renderFrame: RenderFrameState): FrameState | undefined {
    if (!hasDynamicFrameProviders(this.options)) {
      return undefined;
    }

    const frame = requireFrameState(renderFrame);
    if (typeof this.options.lighting === "function") {
      const lighting = this.options.lighting(frame);
      if (this.options.isAlive?.() === false) return frame;
      this.options.renderer.setLighting?.(lighting);
    }
    if (this.options.isAlive?.() === false) return frame;
    if (typeof this.options.spriteMaterial === "function") {
      const spriteMaterial = this.options.spriteMaterial(frame);
      if (this.options.isAlive?.() === false) return frame;
      if (!isPrimitiveDynamicProviderValue(spriteMaterial) || this.lastPrimitiveSpriteMaterialProviderValue !== spriteMaterial) {
        this.options.renderer.setSpriteMaterial?.(spriteMaterial);
        this.lastPrimitiveSpriteMaterialProviderValue = isPrimitiveDynamicProviderValue(spriteMaterial) ? spriteMaterial : UNSET_PROVIDER_VALUE;
      }
    }
    if (this.options.isAlive?.() === false) return frame;
    if (typeof this.options.postProcess === "function") {
      const postProcess = this.options.postProcess(frame);
      if (this.options.isAlive?.() === false) return frame;
      if (!isPrimitiveDynamicProviderValue(postProcess) || this.lastPrimitivePostProcessProviderValue !== postProcess) {
        this.options.renderer.setPostProcess?.(postProcess);
        this.lastPrimitivePostProcessProviderValue = isPrimitiveDynamicProviderValue(postProcess) ? postProcess : UNSET_PROVIDER_VALUE;
      }
    }
    return frame;
  }

  private publishRuntimeFrame(frame: FrameState, rendererStats: RendererStats, renderTimeMs: number, renderAtMs: number): void {
    // A single final onFrame callback can borrow. Chained content callbacks must
    // not invalidate the frame that the following consumers receive.
    if (this.options.animationTimeline || this.options.cutscene || this.options.levelStreaming
      || this.options.uiState || this.options.gameStateLabel) frame = snapshotFrameBuffers(frame);
    this.audioEventRateCount += frame.audioEventCount;
    const nowMs = this.now();
    const audioEventRateElapsedMs = nowMs - this.audioEventRateWindowStartMs;
    if (audioEventRateElapsedMs >= 1000) {
      this.audioEventsPerSecond = this.audioEventRateCount / (audioEventRateElapsedMs / 1000);
      this.audioEventRateWindowStartMs = nowMs;
      this.audioEventRateCount = 0;
    }

    const fps = frame.frameTimeMs > 0 ? 1000 / frame.frameTimeMs : 0;
    const gpuTiming=this.options.renderer.gpuTimingStats?.();
    if (this.options.isAlive?.() === false) return;
    const resourceStats = this.options.renderer.resourceStats?.();
    if (this.options.isAlive?.() === false) return;
    const debugMetrics = buildDebugMetrics(
      frame,
      rendererStats,
      fps,
      renderTimeMs,
      this.audioEventsPerSecond,
      this.options.gameStateLabel ?? defaultGameStateLabel,
      resourceStats,
      gpuTiming,
    );
    debugMetrics.rendererFrameId=gpuTiming?.currentFrameId??this.rendererFrameId;
    if (this.options.isAlive?.() === false) return;
    if(this.previousRenderAtMs!==undefined)debugMetrics.frameIntervalMs=Math.max(0,renderAtMs-this.previousRenderAtMs);
    this.previousRenderAtMs=renderAtMs;
    this.options.debugOverlay?.update(debugMetrics);
    const runtimeFrame: FerrumRuntimeFrame = {
      frame,
      rendererStats,
      debugMetrics,
      fps,
      renderTimeMs,
    };
    this.options.animationTimeline?.update(runtimeFrame);
    if (this.options.isAlive?.() === false) return;
    this.options.cutscene?.update(runtimeFrame);
    if (this.options.isAlive?.() === false) return;
    this.options.levelStreaming?.update(runtimeFrame);
    if (this.options.isAlive?.() === false) return;
    if (this.options.uiOverlay && this.options.uiState) {
      const state = this.options.uiState(runtimeFrame);
      if (this.options.isAlive?.() === false) return;
      this.options.uiOverlay.update(state);
    }
    this.options.profiler?.recordFrame(debugMetrics);
    if (this.options.isAlive?.() === false) return;
    this.options.onFrame?.(runtimeFrame);
  }
}

function hasDynamicFrameProviders(options: RuntimeFrameRendererOptions): boolean {
  return typeof options.lighting === "function"
    || typeof options.spriteMaterial === "function"
    || typeof options.postProcess === "function";
}

const UNSET_PROVIDER_VALUE = Symbol("unset dynamic provider value");
type PrimitiveDynamicProviderValue = string | boolean | undefined;

function isPrimitiveDynamicProviderValue(value: unknown): value is PrimitiveDynamicProviderValue {
  return value === undefined || typeof value === "string" || typeof value === "boolean";
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
  gameStateLabel: (code: GameStateCode) => string,
  resources?: RendererResourceStats,
  gpuTiming?: RendererGpuTimingStats,
): DebugOverlayMetrics {
  return {
    fps,
    ...(rendererStats.spatial===undefined?{}:{
      modelCount:rendererStats.spatial.modelCount, visibleModelCount:rendererStats.spatial.visibleModelCount,
      modelDrawCalls:rendererStats.spatial.modelDrawCalls,modelInstancedDrawCalls:rendererStats.spatial.modelInstancedDrawCalls,
      modelTriangleCount:rendererStats.spatial.modelTriangleCount,modelUploadBytes:rendererStats.spatial.modelUploadBytes,
      modelInstanceUploadBytes:rendererStats.spatial.modelInstanceUploadBytes,
      spatialShadowDrawCalls:rendererStats.spatial.shadowDrawCalls,spatialShadowPassCount:rendererStats.spatial.shadowPassCount,
      spatialShadowUploadBytes:rendererStats.spatial.shadowUploadBytes,spatialShadowCacheHit:rendererStats.spatial.shadowCacheHit,
      spatialEffectDrawCalls:rendererStats.spatial.effectDrawCalls,
    }),
    wasmLinearMemoryBytes: frame.wasmLinearMemoryBytes,
    ...(gpuTiming?.status === "ready" ? {
      gpuFrameTimeMs: gpuTiming.elapsedMs,
      gpuFrameId: gpuTiming.frameId,
    } : {}),
    ...(resources === undefined ? {} : {
      gpuTextureCount: resources.textureCount,
      gpuBufferCount: resources.bufferCount,
      gpuProgramCount: resources.programCount,
      gpuRenderTargetCount: resources.renderTargetCount,
      gpuEstimatedBytes: resources.estimatedBytes,
    }),
    frameTimeMs: frame.frameTimeMs,
    entityCount: frame.entityCount,
    spriteCount: frame.spriteCount,
    drawCalls: rendererStats.drawCalls,
    batchCount: rendererStats.batchCount,
    renderCommandCount: rendererStats.renderCommandCount,
    textureBindCount: rendererStats.textureBindCount,
    textureSwitchCount: rendererStats.textureSwitchCount,
    lightingDrawCalls: rendererStats.lightingDrawCalls,
    normalDrawCalls: rendererStats.normalDrawCalls,
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
    physicsSolidCandidateChecks: frame.physics.solidCandidateChecks,
    physicsTileCandidateChecks: frame.physics.tileCandidateChecks,
    physicsHd2dFilteredEntityCandidates: frame.physics.hd2dFilteredEntityCandidates,
    physicsHd2dFilteredTileCandidates: frame.physics.hd2dFilteredTileCandidates,
    playerFloorId: frame.playerFloorId,
    playerElevation: frame.playerElevation,
    playerHeight: frame.playerHeight,
    ...collisionDebugMetrics(frame),
    ...(frame.physicsDiagnostics === undefined ? {} : {
      physicsCcdLimits: frame.physicsDiagnostics.ccdLimits.length,
      physicsJointMaxForce: Math.max(0,...frame.physicsDiagnostics.joints.map(j=>j.force)),
      physicsJointMaxError: Math.max(0,...frame.physicsDiagnostics.joints.filter(j=>j.errorUnit==="world").map(j=>j.error)),
      physicsDiagnosticsDropped: frame.physicsDiagnostics.dropped,
    }),
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

function collisionDebugMetrics(
  frame: FrameState,
): Pick<DebugOverlayMetrics, "collisionPairCount" | "collisionEventCount"> {
  const metrics: Pick<DebugOverlayMetrics, "collisionPairCount" | "collisionEventCount"> = {
    collisionPairCount: frame.physics.collisionPairs,
  };
  if (frame.physics.collisionLifecycleEventsEnabled !== true) {
    return metrics;
  }
  metrics.collisionEventCount = frame.physics.collisionEventCount;
  return metrics;
}

function defaultGameStateLabel(code: GameStateCode): string {
  switch (code) {
    case GAME_STATE_CODE.title:
      return "Title";
    case GAME_STATE_CODE.playing:
      return "Playing";
    case GAME_STATE_CODE.gameOver:
      return "GameOver";
    case GAME_STATE_CODE.paused:
      return "Paused";
    case GAME_STATE_CODE.levelComplete:
      return "LevelComplete";
  }
}
