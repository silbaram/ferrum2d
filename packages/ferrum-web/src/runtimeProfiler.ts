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
  maxPhysicsCcdChecks?: number;
  maxPhysicsDebugLineCount?: number;
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
  maxPhysicsCcdChecks: number;
  maxPhysicsDebugLineCount: number;
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
    };
    if (progress.elapsedMs !== undefined) {
      sample.elapsedMs = finiteNumber(progress.elapsedMs, "asset elapsedMs");
    }
    if (progress.kind !== undefined) {
      sample.kind = progress.kind;
    }
    if (progress.name !== undefined) {
      sample.name = progress.name;
    }
    if (progress.url !== undefined) {
      sample.url = progress.url;
    }
    pushBounded(this.assets, sample, this.maxAssetSamples);
    return sample;
  }

  snapshot(): RuntimeProfilerSnapshot {
    const snapshot = summarizeRuntimeProfiler(this.frames, this.assets);
    if (this.budget !== undefined) {
      snapshot.budgetReport = evaluateRuntimeProfilerBudget(snapshot, this.budget);
    }
    return snapshot;
  }

  reset(): void {
    this.frames.length = 0;
    this.assets.length = 0;
  }
}

export function runtimeDiagnosticsFrameSample(
  metrics: DebugOverlayMetrics | RuntimeDiagnosticsFrameSample,
): RuntimeDiagnosticsFrameSample {
  const sample: RuntimeDiagnosticsFrameSample = {
    fps: finiteNumber(metrics.fps, "fps"),
    frameTimeMs: finiteNumber(metrics.frameTimeMs, "frameTimeMs"),
    rustUpdateTimeMs: finiteNumber(metrics.rustUpdateTimeMs, "rustUpdateTimeMs"),
    renderTimeMs: finiteNumber(metrics.renderTimeMs, "renderTimeMs"),
    entityCount: nonNegativeInteger(metrics.entityCount, "entityCount"),
    spriteCount: nonNegativeInteger(metrics.spriteCount, "spriteCount"),
    drawCalls: nonNegativeInteger(metrics.drawCalls, "drawCalls"),
    batchCount: nonNegativeInteger(metrics.batchCount, "batchCount"),
  };
  if (metrics.renderCommandCount !== undefined) {
    sample.renderCommandCount = nonNegativeInteger(metrics.renderCommandCount, "renderCommandCount");
  }
  if (metrics.textureBindCount !== undefined) {
    sample.textureBindCount = nonNegativeInteger(metrics.textureBindCount, "textureBindCount");
  }
  if (metrics.textureSwitchCount !== undefined) {
    sample.textureSwitchCount = nonNegativeInteger(metrics.textureSwitchCount, "textureSwitchCount");
  }
  if (metrics.audioEventsPerSecond !== undefined) {
    sample.audioEventsPerSecond = finiteNumber(metrics.audioEventsPerSecond, "audioEventsPerSecond");
  }
  if (metrics.physicsFixedSteps !== undefined) {
    sample.physicsFixedSteps = nonNegativeInteger(metrics.physicsFixedSteps, "physicsFixedSteps");
  }
  if (metrics.physicsKinematicHits !== undefined) {
    sample.physicsKinematicHits = nonNegativeInteger(metrics.physicsKinematicHits, "physicsKinematicHits");
  }
  if (metrics.physicsTileCandidateChecks !== undefined) {
    sample.physicsTileCandidateChecks = nonNegativeInteger(
      metrics.physicsTileCandidateChecks,
      "physicsTileCandidateChecks",
    );
  }
  if (metrics.collisionPairCount !== undefined) {
    sample.collisionPairCount = nonNegativeInteger(metrics.collisionPairCount, "collisionPairCount");
  }
  if (metrics.collisionEventCount !== undefined) {
    sample.collisionEventCount = nonNegativeInteger(metrics.collisionEventCount, "collisionEventCount");
  }
  if (metrics.physicsDebugLineCount !== undefined) {
    sample.physicsDebugLineCount = nonNegativeInteger(metrics.physicsDebugLineCount, "physicsDebugLineCount");
  }
  if (metrics.physicsCcdChecks !== undefined) {
    sample.physicsCcdChecks = nonNegativeInteger(metrics.physicsCcdChecks, "physicsCcdChecks");
  }
  if (metrics.physicsCcdHits !== undefined) {
    sample.physicsCcdHits = nonNegativeInteger(metrics.physicsCcdHits, "physicsCcdHits");
  }
  if (metrics.physicsSleepingBodies !== undefined) {
    sample.physicsSleepingBodies = nonNegativeInteger(metrics.physicsSleepingBodies, "physicsSleepingBodies");
  }
  if (metrics.physicsBrokenJoints !== undefined) {
    sample.physicsBrokenJoints = nonNegativeInteger(metrics.physicsBrokenJoints, "physicsBrokenJoints");
  }
  return sample;
}

export function evaluateRuntimeDiagnosticsSample(
  sample: RuntimeDiagnosticsFrameSample,
  budget: RuntimeDiagnosticsBudget,
): RuntimeDiagnosticsReport {
  const violations: RuntimeDiagnosticsViolation[] = [];
  addViolation(violations, "maxFrameTimeMs", "frame time", sample.frameTimeMs, budget.maxFrameTimeMs, "ms");
  addViolation(
    violations,
    "maxRustUpdateTimeMs",
    "rust update",
    sample.rustUpdateTimeMs,
    budget.maxRustUpdateTimeMs,
    "ms",
  );
  addViolation(violations, "maxRenderTimeMs", "render", sample.renderTimeMs, budget.maxRenderTimeMs, "ms");
  addViolation(violations, "maxDrawCalls", "draw calls", sample.drawCalls, budget.maxDrawCalls, "count");
  addViolation(
    violations,
      "maxRenderCommandCount",
      "render commands",
      sample.renderCommandCount,
      budget.maxRenderCommandCount,
      "count",
  );
  addViolation(
    violations,
    "maxTextureSwitchCount",
    "texture switches",
    sample.textureSwitchCount,
    budget.maxTextureSwitchCount,
    "count",
  );
  addViolation(
    violations,
    "maxAudioEventsPerSecond",
    "audio events",
    sample.audioEventsPerSecond,
    budget.maxAudioEventsPerSecond,
    "events/s",
  );
  addViolation(
    violations,
    "maxPhysicsFixedSteps",
    "fixed steps",
    sample.physicsFixedSteps,
    budget.maxPhysicsFixedSteps,
    "count",
  );
  addViolation(
    violations,
    "maxPhysicsTileCandidateChecks",
    "tile checks",
    sample.physicsTileCandidateChecks,
    budget.maxPhysicsTileCandidateChecks,
    "count",
  );
  addViolation(
    violations,
    "maxPhysicsCcdChecks",
    "ccd checks",
    sample.physicsCcdChecks,
    budget.maxPhysicsCcdChecks,
    "count",
  );
  addViolation(
    violations,
    "maxPhysicsDebugLineCount",
    "physics debug lines",
    sample.physicsDebugLineCount,
    budget.maxPhysicsDebugLineCount,
    "count",
  );
  addViolation(
    violations,
    "maxCollisionPairCount",
    "collision pairs",
    sample.collisionPairCount,
    budget.maxCollisionPairCount,
    "count",
  );
  return budgetReport(violations);
}

export function evaluateRuntimeProfilerBudget(
  snapshot: RuntimeProfilerSnapshot,
  budget: RuntimeDiagnosticsBudget,
): RuntimeDiagnosticsReport {
  const violations: RuntimeDiagnosticsViolation[] = [];
  addViolation(violations, "maxFrameTimeMs", "frame time", snapshot.maxFrameTimeMs, budget.maxFrameTimeMs, "ms");
  addViolation(
    violations,
    "maxRustUpdateTimeMs",
    "rust update",
    snapshot.maxRustUpdateTimeMs,
    budget.maxRustUpdateTimeMs,
    "ms",
  );
  addViolation(violations, "maxRenderTimeMs", "render", snapshot.maxRenderTimeMs, budget.maxRenderTimeMs, "ms");
  addViolation(violations, "maxDrawCalls", "draw calls", snapshot.maxDrawCalls, budget.maxDrawCalls, "count");
  addViolation(
    violations,
      "maxRenderCommandCount",
      "render commands",
      snapshot.maxRenderCommandCount,
      budget.maxRenderCommandCount,
      "count",
  );
  addViolation(
    violations,
    "maxTextureSwitchCount",
    "texture switches",
    snapshot.maxTextureSwitchCount,
    budget.maxTextureSwitchCount,
    "count",
  );
  addViolation(
    violations,
    "maxAudioEventsPerSecond",
    "audio events",
    snapshot.maxAudioEventsPerSecond,
    budget.maxAudioEventsPerSecond,
    "events/s",
  );
  addViolation(
    violations,
    "maxPhysicsFixedSteps",
    "fixed steps",
    snapshot.maxPhysicsFixedSteps,
    budget.maxPhysicsFixedSteps,
    "count",
  );
  addViolation(
    violations,
    "maxPhysicsTileCandidateChecks",
    "tile checks",
    snapshot.maxPhysicsTileCandidateChecks,
    budget.maxPhysicsTileCandidateChecks,
    "count",
  );
  addViolation(
    violations,
    "maxPhysicsCcdChecks",
    "ccd checks",
    snapshot.maxPhysicsCcdChecks,
    budget.maxPhysicsCcdChecks,
    "count",
  );
  addViolation(
    violations,
    "maxPhysicsDebugLineCount",
    "physics debug lines",
    snapshot.maxPhysicsDebugLineCount,
    budget.maxPhysicsDebugLineCount,
    "count",
  );
  addViolation(
    violations,
    "maxCollisionPairCount",
    "collision pairs",
    snapshot.maxCollisionPairCount,
    budget.maxCollisionPairCount,
    "count",
  );
  addViolation(
    violations,
    "maxAssetLoadElapsedMs",
    "asset load",
    snapshot.maxAssetLoadElapsedMs,
    budget.maxAssetLoadElapsedMs,
    "ms",
  );
  return budgetReport(violations);
}

function summarizeRuntimeProfiler(
  frames: readonly RuntimeDiagnosticsFrameSample[],
  assets: readonly RuntimeAssetLoadSample[],
): RuntimeProfilerSnapshot {
  let totalFrameTimeMs = 0;
  let totalRustUpdateTimeMs = 0;
  let totalRenderTimeMs = 0;
  let maxFrameTimeMs = 0;
  let maxRustUpdateTimeMs = 0;
  let maxRenderTimeMs = 0;
  let maxDrawCalls = 0;
  let maxRenderCommandCount = 0;
  let maxTextureSwitchCount = 0;
  let maxAudioEventsPerSecond = 0;
  let maxPhysicsFixedSteps = 0;
  let maxPhysicsTileCandidateChecks = 0;
  let maxPhysicsCcdChecks = 0;
  let maxPhysicsDebugLineCount = 0;
  let maxCollisionPairCount = 0;

  for (let i = 0; i < frames.length; i += 1) {
    const sample = frames[i];
    totalFrameTimeMs += sample.frameTimeMs;
    totalRustUpdateTimeMs += sample.rustUpdateTimeMs;
    totalRenderTimeMs += sample.renderTimeMs;

    const renderCommandCount = sample.renderCommandCount ?? 0;
    const textureSwitchCount = sample.textureSwitchCount ?? 0;
    const audioEventsPerSecond = sample.audioEventsPerSecond ?? 0;
    const physicsFixedSteps = sample.physicsFixedSteps ?? 0;
    const physicsTileCandidateChecks = sample.physicsTileCandidateChecks ?? 0;
    const physicsCcdChecks = sample.physicsCcdChecks ?? 0;
    const physicsDebugLineCount = sample.physicsDebugLineCount ?? 0;
    const collisionPairCount = sample.collisionPairCount ?? 0;

    if (i === 0) {
      maxFrameTimeMs = sample.frameTimeMs;
      maxRustUpdateTimeMs = sample.rustUpdateTimeMs;
      maxRenderTimeMs = sample.renderTimeMs;
      maxDrawCalls = sample.drawCalls;
      maxRenderCommandCount = renderCommandCount;
      maxTextureSwitchCount = textureSwitchCount;
      maxAudioEventsPerSecond = audioEventsPerSecond;
      maxPhysicsFixedSteps = physicsFixedSteps;
      maxPhysicsTileCandidateChecks = physicsTileCandidateChecks;
      maxPhysicsCcdChecks = physicsCcdChecks;
      maxPhysicsDebugLineCount = physicsDebugLineCount;
      maxCollisionPairCount = collisionPairCount;
      continue;
    }

    maxFrameTimeMs = Math.max(maxFrameTimeMs, sample.frameTimeMs);
    maxRustUpdateTimeMs = Math.max(maxRustUpdateTimeMs, sample.rustUpdateTimeMs);
    maxRenderTimeMs = Math.max(maxRenderTimeMs, sample.renderTimeMs);
    maxDrawCalls = Math.max(maxDrawCalls, sample.drawCalls);
    maxRenderCommandCount = Math.max(maxRenderCommandCount, renderCommandCount);
    maxTextureSwitchCount = Math.max(maxTextureSwitchCount, textureSwitchCount);
    maxAudioEventsPerSecond = Math.max(maxAudioEventsPerSecond, audioEventsPerSecond);
    maxPhysicsFixedSteps = Math.max(maxPhysicsFixedSteps, physicsFixedSteps);
    maxPhysicsTileCandidateChecks = Math.max(maxPhysicsTileCandidateChecks, physicsTileCandidateChecks);
    maxPhysicsCcdChecks = Math.max(maxPhysicsCcdChecks, physicsCcdChecks);
    maxPhysicsDebugLineCount = Math.max(maxPhysicsDebugLineCount, physicsDebugLineCount);
    maxCollisionPairCount = Math.max(maxCollisionPairCount, collisionPairCount);
  }

  let maxAssetLoadElapsedMs = 0;
  for (let i = 0; i < assets.length; i += 1) {
    const elapsedMs = assets[i].elapsedMs ?? 0;
    if (i === 0 || elapsedMs > maxAssetLoadElapsedMs) {
      maxAssetLoadElapsedMs = elapsedMs;
    }
  }

  const snapshot = {
    frameSampleCount: frames.length,
    assetSampleCount: assets.length,
  } as RuntimeProfilerSnapshot;
  if (frames.length > 0) {
    snapshot.latestFrame = frames[frames.length - 1];
  }
  if (assets.length > 0) {
    snapshot.latestAsset = assets[assets.length - 1];
  }
  snapshot.averageFrameTimeMs = frames.length === 0 ? 0 : totalFrameTimeMs / frames.length;
  snapshot.maxFrameTimeMs = maxFrameTimeMs;
  snapshot.averageRustUpdateTimeMs = frames.length === 0 ? 0 : totalRustUpdateTimeMs / frames.length;
  snapshot.maxRustUpdateTimeMs = maxRustUpdateTimeMs;
  snapshot.averageRenderTimeMs = frames.length === 0 ? 0 : totalRenderTimeMs / frames.length;
  snapshot.maxRenderTimeMs = maxRenderTimeMs;
  snapshot.maxDrawCalls = maxDrawCalls;
  snapshot.maxRenderCommandCount = maxRenderCommandCount;
  snapshot.maxTextureSwitchCount = maxTextureSwitchCount;
  snapshot.maxAudioEventsPerSecond = maxAudioEventsPerSecond;
  snapshot.maxPhysicsFixedSteps = maxPhysicsFixedSteps;
  snapshot.maxPhysicsTileCandidateChecks = maxPhysicsTileCandidateChecks;
  snapshot.maxPhysicsCcdChecks = maxPhysicsCcdChecks;
  snapshot.maxPhysicsDebugLineCount = maxPhysicsDebugLineCount;
  snapshot.maxCollisionPairCount = maxCollisionPairCount;
  snapshot.maxAssetLoadElapsedMs = maxAssetLoadElapsedMs;
  return snapshot;
}

function budgetReport(violations: RuntimeDiagnosticsViolation[]): RuntimeDiagnosticsReport {
  return {
    passed: violations.length === 0,
    violations,
  };
}

function addViolation(
  violations: RuntimeDiagnosticsViolation[],
  id: keyof RuntimeDiagnosticsBudget,
  label: string,
  actual: number | undefined,
  limit: number | undefined,
  unit: RuntimeDiagnosticsUnit,
): void {
  if (actual === undefined || limit === undefined || actual <= limit) {
    return;
  }
  violations.push({
    id,
    label,
    actual,
    limit,
    unit,
  });
}

function pushBounded<T>(samples: T[], sample: T, maxSamples: number): void {
  samples.push(sample);
  const overflow = samples.length - maxSamples;
  if (overflow > 0) {
    samples.copyWithin(0, overflow);
    samples.length = maxSamples;
  }
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
