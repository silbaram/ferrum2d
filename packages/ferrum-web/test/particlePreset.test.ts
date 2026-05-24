import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { resolveParticlePresetConfigForWasm } from "../src/particlePreset.js";
import type { ParticlePresetConfig } from "../src/index.js";

test("resolveParticlePresetConfigForWasm validates and normalizes particle preset input", () => {
  const preset: ParticlePresetConfig = {
    texture: "hit",
    uv: { u0: 0.25, v0: 0, u1: 0.5, v1: 0.5 },
    burstCount: 12,
    lifetime: [0.4, 0.2],
    speed: [180, 60],
    startSize: [10, 6],
    endSize: 2,
    startColor: [1, 0.8, 0.2, 1],
    endColor: [1, 0.1, 0, 0],
    accelerationY: 24,
    damping: 0.5,
  };

  const resolved = resolveParticlePresetConfigForWasm(preset, (name) => {
    equal(name, "hit");
    return 42;
  });

  equal(resolved.textureId, 42);
  deepEqual(resolved.uv, { u0: 0.25, v0: 0, u1: 0.5, v1: 0.5 });
  equal(resolved.burstCount, 12);
  deepEqual(resolved.lifetime, [0.2, 0.4]);
  deepEqual(resolved.speed, [60, 180]);
  deepEqual(resolved.startSize, [6, 10]);
  deepEqual(resolved.endSize, [2, 2]);
  deepEqual(resolved.startColor, [1, 0.8, 0.2, 1]);
  deepEqual(resolved.endColor, [1, 0.1, 0, 0]);
  equal(resolved.accelerationX, 0);
  equal(resolved.accelerationY, 24);
  equal(resolved.damping, 0.5);
});

test("resolveParticlePresetConfigForWasm rejects invalid particle preset values", () => {
  expectThrows(
    () => resolveParticlePresetConfigForWasm({ texture: "" }, () => 1),
    /texture name/,
  );
  expectThrows(
    () => resolveParticlePresetConfigForWasm({ texture: 1.5 }, () => 1),
    /texture id/,
  );
  expectThrows(
    () => resolveParticlePresetConfigForWasm({
      texture: 1,
      uv: { u0: 0.5, v0: 0, u1: 0.5, v1: 1 },
    }, () => 1),
    /u1 > u0/,
  );
  expectThrows(
    () => resolveParticlePresetConfigForWasm({ texture: 1, lifetime: 0 }, () => 1),
    /greater than 0/,
  );
  expectThrows(
    () => resolveParticlePresetConfigForWasm({ texture: 1, startColor: [1, 0, 0, 2] }, () => 1),
    /between 0 and 1/,
  );
});

function expectThrows(fn: () => void, pattern: RegExp): void {
  try {
    fn();
  } catch (error) {
    equal(error instanceof Error, true);
    equal(pattern.test(error instanceof Error ? error.message : String(error)), true);
    return;
  }
  throw new Error("Expected function to throw.");
}
