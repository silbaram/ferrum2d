import { equal, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  CameraRigController,
  ScreenFadeTransition,
  clampCameraToBounds,
  fadePostProcessPass,
  resolveCameraRigSpec,
  resolvePostProcessPasses,
} from "../src/cameraPostProcessing.js";

test("CameraRigController applies dead-zone movement and viewport bounds", () => {
  const camera = new CameraRigController({
    x: 50,
    y: 50,
    deadZone: { width: 40, height: 20 },
    bounds: { minX: 0, minY: 0, maxX: 200, maxY: 120 },
  });

  const unchanged = camera.step({ x: 55, y: 54 }, 1, { viewport: { width: 100, height: 80 } });
  equal(unchanged.x, 50);
  equal(unchanged.y, 50);
  equal(unchanged.desiredX, 50);
  equal(unchanged.desiredY, 50);

  const clamped = camera.step({ x: 180, y: 100 }, 1, { viewport: { width: 100, height: 80 } });
  equal(clamped.x, 150);
  equal(clamped.y, 80);
  equal(clamped.desiredX, 150);
  equal(clamped.desiredY, 80);
});

test("CameraRigController smooths camera motion with frame delta", () => {
  const camera = new CameraRigController({ smoothTimeSeconds: 0.5 });
  const next = camera.step({ x: 100, y: 0 }, 0.5);
  ok(next.x > 63 && next.x < 64);
  equal(next.y, 0);
});

test("clampCameraToBounds handles worlds smaller than the viewport", () => {
  const clamped = clampCameraToBounds(
    { x: 1000, y: -1000 },
    { minX: 0, minY: 0, maxX: 80, maxY: 40 },
    { width: 160, height: 80 },
  );
  equal(clamped.x, 40);
  equal(clamped.y, 20);
});

test("camera rig validation reports path context", () => {
  expectThrows(
    () => resolveCameraRigSpec({ bounds: { minX: 10, minY: 0, maxX: 0, maxY: 1 } }),
    /Invalid camera\/post-processing config: kind=camera-postprocessing path='cameraRig\.bounds'/,
  );
});

test("resolveCameraRigSpec does not share mutable default dead-zone objects", () => {
  const first = resolveCameraRigSpec();
  first.deadZone.width = 99;

  const second = resolveCameraRigSpec();
  equal(second.deadZone.width, 0);
});

test("ScreenFadeTransition exposes fade passes while active", () => {
  const transition = new ScreenFadeTransition({
    durationSeconds: 2,
    fromOpacity: 1,
    toOpacity: 0,
    color: [0.1, 0.2, 0.3],
  });

  const halfway = transition.update(1);
  equal(halfway.active, true);
  equal(halfway.progress, 0.5);
  equal(halfway.opacity, 0.5);
  const halfwayPass = transition.postProcessPasses()[0];
  equal(halfwayPass?.kind, "fade");
  if (halfwayPass?.kind === "fade") equal(halfwayPass.color[3], 0.5);

  const done = transition.update(1);
  equal(done.active, false);
  equal(done.opacity, 0);
  equal(transition.postProcessPasses().length, 0);
});

test("resolvePostProcessPasses resolves fade opacity and rejects invalid colors", () => {
  equal(resolvePostProcessPasses(false).length, 0);
  equal(resolvePostProcessPasses({ opacity: 0 }).length, 0);
  const fadePass = resolvePostProcessPasses({ opacity: 0.25 })[0];
  equal(fadePass?.kind, "fade");
  if (fadePass?.kind === "fade") equal(fadePass.color[3], 0.25);
  equal(fadePostProcessPass(0.5, [1, 0, 0, 0.5]).color[3], 0.25);
  expectThrows(
    () => resolvePostProcessPasses({ color: [1, 2] as unknown as [number, number, number] }),
    /Invalid camera\/post-processing config: kind=camera-postprocessing path='postProcess\[0\]\.color'/,
  );
});

test("resolvePostProcessPasses resolves configured bloom crt vignette and glitch passes", () => {
  const passes = resolvePostProcessPasses({
    bloom: { threshold: 0.8, intensity: 0.6, radius: 2 },
    crt: { curvature: 0.05, scanlineIntensity: 0.25, chromaticAberration: 0.002 },
    vignette: { color: [0, 0, 0, 0.8], intensity: 0.4, radius: 0.7, softness: 0.2 },
    glitch: { intensity: 0.03, chromaticAberration: 0.004, seed: 7 },
  });
  equal(passes.length, 4);
  equal(passes[0]?.kind, "bloom");
  equal(passes[1]?.kind, "crt");
  equal(passes[2]?.kind, "vignette");
  equal(passes[3]?.kind, "glitch");
  if (passes[0]?.kind === "bloom") equal(passes[0].threshold, 0.8);
  if (passes[2]?.kind === "vignette") equal(passes[2].color[3], 0.8);
});

test("resolvePostProcessPasses reports diagnostics for invalid shorthand pass configs", () => {
  expectThrows(
    () => resolvePostProcessPasses({ fade: null } as unknown as Parameters<typeof resolvePostProcessPasses>[0]),
    /Invalid camera\/post-processing config: kind=camera-postprocessing path='postProcess\[0\]'/,
  );
});

test("resolvePostProcessPasses accepts ordered pass arrays and disabled configs", () => {
  equal(resolvePostProcessPasses({ enabled: false, bloom: { intensity: 1 } }).length, 0);
  const passes = resolvePostProcessPasses([
    { kind: "bloom", intensity: 0 },
    { kind: "crt", scanlineIntensity: 0.1 },
    { kind: "vignette", intensity: 0.2 },
  ]);
  equal(passes.length, 2);
  equal(passes[0]?.kind, "crt");
  equal(passes[1]?.kind, "vignette");
});

test("resolvePostProcessPasses ignores inherited config marker keys", () => {
  const input = Object.create({ enabled: false }) as { opacity: number };
  input.opacity = 0.25;

  const passes = resolvePostProcessPasses(input);

  equal(passes.length, 1);
  equal(passes[0]?.kind, "fade");
  if (passes[0]?.kind === "fade") equal(passes[0].color[3], 0.25);
});

function expectThrows(callback: () => void, pattern: RegExp): void {
  try {
    callback();
  } catch (error) {
    ok(pattern.test(error instanceof Error ? error.message : String(error)));
    return;
  }
  throw new Error("Expected callback to throw.");
}
