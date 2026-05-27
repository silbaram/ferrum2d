import type { AssetLoadProgress } from "./assetLoader.js";
import type { DebugOverlayMetrics } from "./debugOverlay.js";

export type RuntimeDiagnosticsUnit = "ms" | "count" | "events/s";

export interface RuntimeDiagnosticsBudget {
  maxFrameTimeMs?: number;
  maxRustUpdateTimeMs?: number;
  maxRenderTimeMs?: number;
  maxDrawCalls?: number;
  maxRenderCommandCount?: number;
  maxTextureSwitchCount?: number;
  maxAudioEventsPerSecond?: number;
  maxPhysicsFixedSteps?: number;
  maxPhysicsTileCandidateChecks?: number;
  maxCollisionPairCount?: number;
  maxAssetLoadElapsedMs?: number;
}

export interface RuntimeDiagnosticsViolation {
  id: keyof RuntimeDiagnosticsBudget;
  label: string;
  actual: number;
  limit: number;
  unit: RuntimeDiagnosticsUnit;
}

export interface RuntimeDiagnosticsReport {
  passed: boolean;
  violations: readonly RuntimeDiagnosticsViolation[];
}

export interface RuntimeDiagnosticsFrameSample {
  fps: number;
  frameTimeMs: number;
  rustUpdateTimeMs: number;
  renderTimeMs: number;
  entityCount: number;
  spriteCount: number;
  drawCalls: number;
  batchCount: number;
  renderCommandCount?: number;
  textureBindCount?: number;
  textureSwitchCount?: number;
  audioEventsPerSecond?: number;
  physicsFixedSteps?: number;
  physicsKinematicHits?: number;
  physicsTileCandidateChecks?: number;
  collisionPairCount?: number;
  collisionEventCount?: number;
  physicsDebugLineCount?: number;
  physicsCcdChecks?: number;
  physicsCcdHits?: number;
  physicsSleepingBodies?: number;
  physicsBrokenJoints?: number;
}

export interface RuntimeAssetLoadSample {
  loaded: number;
  total: number;
  progress: number;
  elapsedMs?: number;
  kind?: AssetLoadProgress["kind"];
  name?: string;
  url?: string;
}

export interface RuntimeProfilerOptions {
  budget?: RuntimeDiagnosticsBudget;
  maxFrameSamples?: number;
  maxAssetSamples?: number;
}

export interface RuntimeProfilerSnapshot {
  frameSampleCount: number;
  assetSampleCount: number;
  latestFrame?: RuntimeDiagnosticsFrameSample;
  latestAsset?: RuntimeAssetLoadSample;
  averageFrameTimeMs: number;
  maxFrameTimeMs: number;
  averageRustUpdateTimeMs: number;
  maxRustUpdateTimeMs: number;
  averageRenderTimeMs: number;
  maxRenderTimeMs: number;
  maxDrawCalls: number;
  maxRenderCommandCount: number;
  maxTextureSwitchCount: number;
  maxAudioEventsPerSecond: number;
  maxPhysicsFixedSteps: number;
  maxPhysicsTileCandidateChecks: number;
  maxCollisionPairCount: number;
  maxAssetLoadElapsedMs: number;
  budgetReport?: RuntimeDiagnosticsReport;
}

const DEFAULT_MAX_FRAME_SAMPLES = 300;
const DEFAULT_MAX_ASSET_SAMPLES = 200;

export class RuntimeProfiler {
  private readonly budget?: RuntimeDiagnosticsBudget;
  private readonly maxFrameSamples: number;
  private readonly maxAssetSamples: number;
  private readonly frames: RuntimeDiagnosticsFrameSample[] = [];
  private readonly assets: RuntimeAssetLoadSample[] = [];

  constructor(options: RuntimeProfilerOptions = {}) {
    this.budget = options.budget;
    this.maxFrameSamples = positiveInteger(options.maxFrameSamples ?? DEFAULT_MAX_FRAME_SAMPLES, "maxFrameSamples");
    this.maxAssetSamples = positiveInteger(options.maxAssetSamples ?? DEFAULT_MAX_ASSET_SAMPLES, "maxAssetSamples");
  }

  recordFrame(metrics: DebugOverlayMetrics | RuntimeDiagnosticsFrameSample): RuntimeDiagnosticsReport {
    const sample = runtimeDiagnosticsFrameSample(metrics);
    pushBounded(this.frames, sample, this.maxFrameSamples);
    return this.budget === undefined
      ? { passed: true, violations: [] }
      : evaluateRuntimeDiagnosticsSample(sample, this.budget);
  }

  recordAssetProgress(progress: AssetLoadProgress): RuntimeAssetLoadSample {
    const sample: RuntimeAssetLoadSample = {
      loaded: nonNegativeInteger(progress.loaded, "asset loaded"),
      total: nonNegativeInteger(progress.total, "asset total"),
      progress: progress.total <= 0 ? 1 : clamp(progress.loaded / progress.total, 0, 1),
      ...(progress.elapsedMs === undefined ? {} : { elapsedMs: finiteNumber(progress.elapsedMs, "asset elapsedMs") }),
      ...(progress.kind === undefined ? {} : { kind: progress.kind }),
      ...(progress.name === undefined ? {} : { name: progress.name }),
      ...(progress.url === undefined ? {} : { url: progress.url }),
    };
    pushBounded(this.assets, sample, this.maxAssetSamples);
    return sample;
  }

  snapshot(): RuntimeProfilerSnapshot {
    const summary = summarizeRuntimeProfiler(this.frames, this.assets);
    return {
      ...summary,
      ...(this.budget === undefined ? {} : { budgetReport: evaluateRuntimeProfilerBudget(summary, this.budget) }),
    };
  }

  reset(): void {
    this.frames.length = 0;
    this.assets.length = 0;
  }
}

export function runtimeDiagnosticsFrameSample(
  metrics: DebugOverlayMetrics | RuntimeDiagnosticsFrameSample,
): RuntimeDiagnosticsFrameSample {
  return {
    fps: finiteNumber(metrics.fps, "fps"),
    frameTimeMs: finiteNumber(metrics.frameTimeMs, "frameTimeMs"),
    rustUpdateTimeMs: finiteNumber(metrics.rustUpdateTimeMs, "rustUpdateTimeMs"),
    renderTimeMs: finiteNumber(metrics.renderTimeMs, "renderTimeMs"),
    entityCount: nonNegativeInteger(metrics.entityCount, "entityCount"),
    spriteCount: nonNegativeInteger(metrics.spriteCount, "spriteCount"),
    drawCalls: nonNegativeInteger(metrics.drawCalls, "drawCalls"),
    batchCount: nonNegativeInteger(metrics.batchCount, "batchCount"),
    ...(metrics.renderCommandCount === undefined
      ? {}
      : { renderCommandCount: nonNegativeInteger(metrics.renderCommandCount, "renderCommandCount") }),
    ...(metrics.textureBindCount === undefined
      ? {}
      : { textureBindCount: nonNegativeInteger(metrics.textureBindCount, "textureBindCount") }),
    ...(metrics.textureSwitchCount === undefined
      ? {}
      : { textureSwitchCount: nonNegativeInteger(metrics.textureSwitchCount, "textureSwitchCount") }),
    ...(metrics.audioEventsPerSecond === undefined
      ? {}
      : { audioEventsPerSecond: finiteNumber(metrics.audioEventsPerSecond, "audioEventsPerSecond") }),
    ...(metrics.physicsFixedSteps === undefined
      ? {}
      : { physicsFixedSteps: nonNegativeInteger(metrics.physicsFixedSteps, "physicsFixedSteps") }),
    ...(metrics.physicsKinematicHits === undefined
      ? {}
      : { physicsKinematicHits: nonNegativeInteger(metrics.physicsKinematicHits, "physicsKinematicHits") }),
    ...(metrics.physicsTileCandidateChecks === undefined
      ? {}
      : {
          physicsTileCandidateChecks: nonNegativeInteger(
            metrics.physicsTileCandidateChecks,
            "physicsTileCandidateChecks",
          ),
        }),
    ...(metrics.collisionPairCount === undefined
      ? {}
      : { collisionPairCount: nonNegativeInteger(metrics.collisionPairCount, "collisionPairCount") }),
    ...(metrics.collisionEventCount === undefined
      ? {}
      : { collisionEventCount: nonNegativeInteger(metrics.collisionEventCount, "collisionEventCount") }),
    ...(metrics.physicsDebugLineCount === undefined
      ? {}
      : { physicsDebugLineCount: nonNegativeInteger(metrics.physicsDebugLineCount, "physicsDebugLineCount") }),
    ...(metrics.physicsCcdChecks === undefined
      ? {}
      : { physicsCcdChecks: nonNegativeInteger(metrics.physicsCcdChecks, "physicsCcdChecks") }),
    ...(metrics.physicsCcdHits === undefined
      ? {}
      : { physicsCcdHits: nonNegativeInteger(metrics.physicsCcdHits, "physicsCcdHits") }),
    ...(metrics.physicsSleepingBodies === undefined
      ? {}
      : { physicsSleepingBodies: nonNegativeInteger(metrics.physicsSleepingBodies, "physicsSleepingBodies") }),
    ...(metrics.physicsBrokenJoints === undefined
      ? {}
      : { physicsBrokenJoints: nonNegativeInteger(metrics.physicsBrokenJoints, "physicsBrokenJoints") }),
  };
}

export function evaluateRuntimeDiagnosticsSample(
  sample: RuntimeDiagnosticsFrameSample,
  budget: RuntimeDiagnosticsBudget,
): RuntimeDiagnosticsReport {
  return budgetReport([
    violation("maxFrameTimeMs", "frame time", sample.frameTimeMs, budget.maxFrameTimeMs, "ms"),
    violation("maxRustUpdateTimeMs", "rust update", sample.rustUpdateTimeMs, budget.maxRustUpdateTimeMs, "ms"),
    violation("maxRenderTimeMs", "render", sample.renderTimeMs, budget.maxRenderTimeMs, "ms"),
    violation("maxDrawCalls", "draw calls", sample.drawCalls, budget.maxDrawCalls, "count"),
    violation(
      "maxRenderCommandCount",
      "render commands",
      sample.renderCommandCount,
      budget.maxRenderCommandCount,
      "count",
    ),
    violation(
      "maxTextureSwitchCount",
      "texture switches",
      sample.textureSwitchCount,
      budget.maxTextureSwitchCount,
      "count",
    ),
    violation(
      "maxAudioEventsPerSecond",
      "audio events",
      sample.audioEventsPerSecond,
      budget.maxAudioEventsPerSecond,
      "events/s",
    ),
    violation(
      "maxPhysicsFixedSteps",
      "fixed steps",
      sample.physicsFixedSteps,
      budget.maxPhysicsFixedSteps,
      "count",
    ),
    violation(
      "maxPhysicsTileCandidateChecks",
      "tile checks",
      sample.physicsTileCandidateChecks,
      budget.maxPhysicsTileCandidateChecks,
      "count",
    ),
    violation(
      "maxCollisionPairCount",
      "collision pairs",
      sample.collisionPairCount,
      budget.maxCollisionPairCount,
      "count",
    ),
  ]);
}

export function evaluateRuntimeProfilerBudget(
  snapshot: RuntimeProfilerSnapshot,
  budget: RuntimeDiagnosticsBudget,
): RuntimeDiagnosticsReport {
  return budgetReport([
    violation("maxFrameTimeMs", "frame time", snapshot.maxFrameTimeMs, budget.maxFrameTimeMs, "ms"),
    violation("maxRustUpdateTimeMs", "rust update", snapshot.maxRustUpdateTimeMs, budget.maxRustUpdateTimeMs, "ms"),
    violation("maxRenderTimeMs", "render", snapshot.maxRenderTimeMs, budget.maxRenderTimeMs, "ms"),
    violation("maxDrawCalls", "draw calls", snapshot.maxDrawCalls, budget.maxDrawCalls, "count"),
    violation(
      "maxRenderCommandCount",
      "render commands",
      snapshot.maxRenderCommandCount,
      budget.maxRenderCommandCount,
      "count",
    ),
    violation(
      "maxTextureSwitchCount",
      "texture switches",
      snapshot.maxTextureSwitchCount,
      budget.maxTextureSwitchCount,
      "count",
    ),
    violation(
      "maxAudioEventsPerSecond",
      "audio events",
      snapshot.maxAudioEventsPerSecond,
      budget.maxAudioEventsPerSecond,
      "events/s",
    ),
    violation(
      "maxPhysicsFixedSteps",
      "fixed steps",
      snapshot.maxPhysicsFixedSteps,
      budget.maxPhysicsFixedSteps,
      "count",
    ),
    violation(
      "maxPhysicsTileCandidateChecks",
      "tile checks",
      snapshot.maxPhysicsTileCandidateChecks,
      budget.maxPhysicsTileCandidateChecks,
      "count",
    ),
    violation(
      "maxCollisionPairCount",
      "collision pairs",
      snapshot.maxCollisionPairCount,
      budget.maxCollisionPairCount,
      "count",
    ),
    violation(
      "maxAssetLoadElapsedMs",
      "asset load",
      snapshot.maxAssetLoadElapsedMs,
      budget.maxAssetLoadElapsedMs,
      "ms",
    ),
  ]);
}

function summarizeRuntimeProfiler(
  frames: readonly RuntimeDiagnosticsFrameSample[],
  assets: readonly RuntimeAssetLoadSample[],
): Omit<RuntimeProfilerSnapshot, "budgetReport"> {
  return {
    frameSampleCount: frames.length,
    assetSampleCount: assets.length,
    ...(frames.length === 0 ? {} : { latestFrame: frames[frames.length - 1] }),
    ...(assets.length === 0 ? {} : { latestAsset: assets[assets.length - 1] }),
    averageFrameTimeMs: average(frames.map((sample) => sample.frameTimeMs)),
    maxFrameTimeMs: max(frames.map((sample) => sample.frameTimeMs)),
    averageRustUpdateTimeMs: average(frames.map((sample) => sample.rustUpdateTimeMs)),
    maxRustUpdateTimeMs: max(frames.map((sample) => sample.rustUpdateTimeMs)),
    averageRenderTimeMs: average(frames.map((sample) => sample.renderTimeMs)),
    maxRenderTimeMs: max(frames.map((sample) => sample.renderTimeMs)),
    maxDrawCalls: max(frames.map((sample) => sample.drawCalls)),
    maxRenderCommandCount: max(frames.map((sample) => sample.renderCommandCount ?? 0)),
    maxTextureSwitchCount: max(frames.map((sample) => sample.textureSwitchCount ?? 0)),
    maxAudioEventsPerSecond: max(frames.map((sample) => sample.audioEventsPerSecond ?? 0)),
    maxPhysicsFixedSteps: max(frames.map((sample) => sample.physicsFixedSteps ?? 0)),
    maxPhysicsTileCandidateChecks: max(frames.map((sample) => sample.physicsTileCandidateChecks ?? 0)),
    maxCollisionPairCount: max(frames.map((sample) => sample.collisionPairCount ?? 0)),
    maxAssetLoadElapsedMs: max(assets.map((sample) => sample.elapsedMs ?? 0)),
  };
}

function budgetReport(entries: Array<RuntimeDiagnosticsViolation | undefined>): RuntimeDiagnosticsReport {
  const violations = entries.filter((entry): entry is RuntimeDiagnosticsViolation => entry !== undefined);
  return {
    passed: violations.length === 0,
    violations,
  };
}

function violation(
  id: keyof RuntimeDiagnosticsBudget,
  label: string,
  actual: number | undefined,
  limit: number | undefined,
  unit: RuntimeDiagnosticsUnit,
): RuntimeDiagnosticsViolation | undefined {
  if (actual === undefined || limit === undefined || actual <= limit) {
    return undefined;
  }
  return {
    id,
    label,
    actual,
    limit,
    unit,
  };
}

function pushBounded<T>(samples: T[], sample: T, maxSamples: number): void {
  samples.push(sample);
  const overflow = samples.length - maxSamples;
  if (overflow > 0) {
    samples.splice(0, overflow);
  }
}

function average(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function max(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

function clamp(value: number, min: number, maxValue: number): number {
  return Math.max(min, Math.min(maxValue, value));
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return Number(value);
}

function nonNegativeInteger(value: unknown, name: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return Number(value);
}

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number.`);
  }
  return value;
}
