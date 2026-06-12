import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateRuntimeDiagnosticsSample,
  evaluateRuntimeProfilerBudget,
  RuntimeProfiler,
  runtimeDiagnosticsFrameSample,
} from "../src/runtimeProfiler.js";
import type { DebugOverlayMetrics } from "../src/debugOverlay.js";

test("RuntimeProfiler records frame samples and aggregate budget violations", () => {
  const profiler = new RuntimeProfiler({
    budget: {
      maxFrameTimeMs: 16.7,
      maxRenderTimeMs: 4,
      maxDrawCalls: 2,
      maxPhysicsCcdChecks: 4,
      maxPhysicsDebugLineCount: 2,
      maxAssetLoadElapsedMs: 50,
    },
  });

  equal(profiler.recordFrame(metrics({
    frameTimeMs: 15,
    drawCalls: 2,
    physicsCcdChecks: 4,
    physicsDebugLineCount: 2,
  })).passed, true);
  const report = profiler.recordFrame(metrics({
    frameTimeMs: 20,
    renderTimeMs: 5,
    drawCalls: 3,
    physicsCcdChecks: 5,
    physicsDebugLineCount: 3,
  }));
  equal(report.passed, false);
  deepEqual(report.violations.map((violation) => violation.id), [
    "maxFrameTimeMs",
    "maxRenderTimeMs",
    "maxDrawCalls",
    "maxPhysicsCcdChecks",
    "maxPhysicsDebugLineCount",
  ]);

  profiler.recordAssetProgress({ loaded: 1, total: 2, elapsedMs: 20, kind: "texture", name: "player" });
  profiler.recordAssetProgress({ loaded: 2, total: 2, elapsedMs: 75, kind: "json", name: "game" });
  const snapshot = profiler.snapshot();
  equal(snapshot.frameSampleCount, 2);
  equal(snapshot.assetSampleCount, 2);
  equal(snapshot.averageFrameTimeMs, 17.5);
  equal(snapshot.maxFrameTimeMs, 20);
  equal(snapshot.maxPhysicsCcdChecks, 5);
  equal(snapshot.maxPhysicsDebugLineCount, 3);
  equal(snapshot.maxAssetLoadElapsedMs, 75);
  equal(snapshot.budgetReport?.passed, false);
  equal(snapshot.budgetReport?.violations.some((violation) => violation.id === "maxAssetLoadElapsedMs"), true);
});

test("RuntimeProfiler keeps bounded sample windows", () => {
  const profiler = new RuntimeProfiler({ maxFrameSamples: 2, maxAssetSamples: 1 });
  profiler.recordFrame(metrics({ frameTimeMs: 10 }));
  profiler.recordFrame(metrics({ frameTimeMs: 11 }));
  profiler.recordFrame(metrics({ frameTimeMs: 12 }));
  profiler.recordAssetProgress({ loaded: 0, total: 1, elapsedMs: 1 });
  profiler.recordAssetProgress({ loaded: 1, total: 1, elapsedMs: 2 });

  const snapshot = profiler.snapshot();
  equal(snapshot.frameSampleCount, 2);
  equal(snapshot.assetSampleCount, 1);
  equal(snapshot.averageFrameTimeMs, 11.5);
  equal(snapshot.latestFrame?.frameTimeMs, 12);
  equal(snapshot.latestAsset?.elapsedMs, 2);
  deepEqual(Object.keys(snapshot).slice(0, 4), [
    "frameSampleCount",
    "assetSampleCount",
    "latestFrame",
    "latestAsset",
  ]);
});

test("runtime diagnostics helpers evaluate frame samples directly", () => {
  const sample = runtimeDiagnosticsFrameSample(metrics({
    renderCommandCount: 12,
    textureSwitchCount: 4,
    physicsFixedSteps: 3,
    physicsCcdChecks: 9,
    physicsDebugLineCount: 6,
    collisionPairCount: 8,
  }));
  const report = evaluateRuntimeDiagnosticsSample(sample, {
    maxRenderCommandCount: 10,
    maxTextureSwitchCount: 4,
    maxPhysicsFixedSteps: 2,
    maxPhysicsCcdChecks: 8,
    maxPhysicsDebugLineCount: 5,
    maxCollisionPairCount: 8,
  });

  equal(report.passed, false);
  deepEqual(report.violations.map((violation) => violation.id), [
    "maxRenderCommandCount",
    "maxPhysicsFixedSteps",
    "maxPhysicsCcdChecks",
    "maxPhysicsDebugLineCount",
  ]);
  equal(evaluateRuntimeProfilerBudget(new RuntimeProfiler().snapshot(), { maxFrameTimeMs: 1 }).passed, true);
});

test("runtime diagnostics fail budgeted optional metrics when samples omit them", () => {
  const profiler = new RuntimeProfiler({ budget: { maxPhysicsCcdChecks: 0 } });

  const report = profiler.recordFrame(metrics());
  const snapshot = profiler.snapshot();

  equal(report.passed, false);
  deepEqual(report.violations.map((violation) => [violation.id, violation.reason]), [
    ["maxPhysicsCcdChecks", "missingMetric"],
  ]);
  equal(hasOwn(snapshot, "maxPhysicsCcdChecks"), false);
  equal(snapshot.budgetReport?.passed, false);
  deepEqual(snapshot.budgetReport?.violations.map((violation) => [violation.id, violation.reason]), [
    ["maxPhysicsCcdChecks", "missingMetric"],
  ]);
});

test("runtime diagnostics preserve optional field omission and zero values", () => {
  const minimalFrame = runtimeDiagnosticsFrameSample(metrics());
  equal(hasOwn(minimalFrame, "renderCommandCount"), false);
  equal(hasOwn(minimalFrame, "physicsFixedSteps"), false);

  const zeroFrame = runtimeDiagnosticsFrameSample(metrics({
    renderCommandCount: 0,
    textureBindCount: 0,
    textureSwitchCount: 0,
    audioEventsPerSecond: 0,
    physicsFixedSteps: 0,
    physicsKinematicHits: 0,
    physicsTileCandidateChecks: 0,
    collisionPairCount: 0,
    collisionEventCount: 0,
    physicsDebugLineCount: 0,
    physicsCcdChecks: 0,
    physicsCcdHits: 0,
    physicsSleepingBodies: 0,
    physicsBrokenJoints: 0,
  }));
  equal(hasOwn(zeroFrame, "renderCommandCount"), true);
  equal(zeroFrame.physicsCcdChecks, 0);
  equal(zeroFrame.physicsDebugLineCount, 0);
  equal(zeroFrame.physicsBrokenJoints, 0);

  const profiler = new RuntimeProfiler();
  const minimalAsset = profiler.recordAssetProgress({ loaded: 0, total: 1 });
  equal(hasOwn(minimalAsset, "elapsedMs"), false);
  const zeroAsset = profiler.recordAssetProgress({ loaded: 1, total: 1, elapsedMs: 0 });
  equal(hasOwn(zeroAsset, "elapsedMs"), true);
  equal(zeroAsset.elapsedMs, 0);
  equal(hasOwn(profiler.snapshot(), "budgetReport"), false);
  equal(hasOwn(new RuntimeProfiler({ budget: { maxFrameTimeMs: 1 } }).snapshot(), "budgetReport"), true);
});

function metrics(overrides: Partial<DebugOverlayMetrics> = {}): DebugOverlayMetrics {
  return {
    fps: 60,
    frameTimeMs: 16,
    rustUpdateTimeMs: 1,
    renderTimeMs: 2,
    entityCount: 3,
    spriteCount: 3,
    drawCalls: 1,
    batchCount: 1,
    mouseX: 0,
    mouseY: 0,
    cameraX: 0,
    cameraY: 0,
    gameState: "Playing",
    score: 0,
    ...overrides,
  };
}

function hasOwn(object: object, property: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(object, property);
}
