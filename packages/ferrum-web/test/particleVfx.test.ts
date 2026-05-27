import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  PARTICLE_VFX_PRESETS,
  ParticleVfxEmitter,
  particleVfxPreset,
  resolveParticleVfxPresetConfig,
} from "../src/particleVfx.js";
import type { ParticlePresetConfig } from "../src/particlePreset.js";

class FakeParticleTarget {
  readonly presets: Array<{ presetId: number; preset: ParticlePresetConfig }> = [];
  readonly bursts: Array<{ presetId: number; x: number; y: number }> = [];

  setParticlePreset(presetId: number, preset: ParticlePresetConfig): void {
    this.presets.push({ presetId, preset });
  }

  spawnParticleBurst(presetId: number, x: number, y: number): number {
    this.bursts.push({ presetId, x, y });
    return 2;
  }
}

test("particleVfxPreset returns built-in burst/loop/trail presets with texture override", () => {
  equal(PARTICLE_VFX_PRESETS["hit-spark"].emitter?.mode, "burst");
  equal(PARTICLE_VFX_PRESETS["dust-loop"].emitter?.mode, "loop");
  equal(PARTICLE_VFX_PRESETS["motion-trail"].emitter?.mode, "trail");
  equal(particleVfxPreset("motion-trail", "dust").particle.texture, "dust");
});

test("resolveParticleVfxPresetConfig validates emitter ranges and defaults", () => {
  const resolved = resolveParticleVfxPresetConfig({
    particle: { texture: 4 },
    emitter: { mode: "loop", intervalSeconds: 0.05, maxBursts: 3 },
  });
  equal(resolved.particle.texture, 4);
  deepEqual(resolved.emitter, {
    mode: "loop",
    intervalSeconds: 0.05,
    distance: 12,
    maxBursts: 3,
    maxBurstsPerUpdate: 8,
    autostart: true,
  });
});

test("ParticleVfxEmitter triggers burst presets once", () => {
  const target = new FakeParticleTarget();
  const emitter = ParticleVfxEmitter.create({
    target,
    presetId: 7,
    preset: "hit-spark",
  });

  equal(target.presets.length, 1);
  equal(emitter.update(0.016, 10, 20), 0);
  emitter.start();
  equal(emitter.update(0.016, 10, 20), 2);
  equal(emitter.update(0.016, 10, 20), 0);
  equal(target.bursts.length, 1);
  deepEqual(emitter.snapshot(), {
    presetId: 7,
    mode: "burst",
    active: false,
    emittedBurstCount: 1,
    spawnedParticleCount: 2,
    elapsedSeconds: 0,
    distanceSinceLastBurst: 0,
  });
});

test("ParticleVfxEmitter loops with interval and max burst guard", () => {
  const target = new FakeParticleTarget();
  const emitter = ParticleVfxEmitter.create({
    target,
    presetId: 2,
    preset: {
      particle: { texture: 0, burstCount: 1 },
      emitter: { mode: "loop", intervalSeconds: 0.1, maxBursts: 2 },
    },
  });

  equal(emitter.update(0.05, 0, 0), 0);
  equal(emitter.update(0.05, 0, 0), 2);
  equal(emitter.update(0.2, 0, 0), 2);
  equal(emitter.update(0.2, 0, 0), 0);
  equal(target.bursts.length, 2);
  equal(emitter.snapshot().active, false);
});

test("ParticleVfxEmitter emits trail bursts by movement distance", () => {
  const target = new FakeParticleTarget();
  const emitter = ParticleVfxEmitter.create({
    target,
    presetId: 3,
    preset: {
      particle: { texture: 0, burstCount: 1 },
      emitter: { mode: "trail", distance: 5, intervalSeconds: 0.01 },
    },
  });

  equal(emitter.update(0.016, 0, 0), 2);
  equal(emitter.update(0.016, 3, 0), 0);
  equal(emitter.update(0.016, 5, 0), 2);
  equal(target.bursts.length, 2);
  equal(emitter.snapshot().distanceSinceLastBurst, 0);
});

test("resolveParticleVfxPresetConfig rejects invalid emitter values", () => {
  expectThrows(() => resolveParticleVfxPresetConfig({
    particle: { texture: 0 },
    emitter: { mode: "loop", intervalSeconds: 0 },
  }), /intervalSeconds/);
  expectThrows(() => resolveParticleVfxPresetConfig({
    particle: { texture: 0 },
    emitter: { mode: "trail", distance: -1 },
  }), /distance/);
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
