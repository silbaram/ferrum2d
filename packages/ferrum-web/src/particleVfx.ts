import type { ParticlePresetConfig, ParticleTextureRef } from "./particlePreset";

export type ParticleVfxPresetName = "hit-spark" | "dust-loop" | "motion-trail";
export type ParticleVfxEmitterMode = "burst" | "loop" | "trail";

export interface ParticleVfxEmitterConfig {
  mode?: ParticleVfxEmitterMode;
  intervalSeconds?: number;
  distance?: number;
  maxBursts?: number;
  maxBurstsPerUpdate?: number;
  autostart?: boolean;
}

export interface ParticleVfxPresetConfig {
  particle: ParticlePresetConfig;
  emitter?: ParticleVfxEmitterConfig;
}

export interface ResolvedParticleVfxEmitterConfig {
  mode: ParticleVfxEmitterMode;
  intervalSeconds: number;
  distance: number;
  maxBursts?: number;
  maxBurstsPerUpdate: number;
  autostart: boolean;
}

export interface ResolvedParticleVfxPresetConfig {
  particle: ParticlePresetConfig;
  emitter: ResolvedParticleVfxEmitterConfig;
}

export interface ParticleVfxEmitterTarget {
  setParticlePreset(presetId: number, preset: ParticlePresetConfig): void;
  spawnParticleBurst(presetId: number, x: number, y: number): number;
}

export interface ParticleVfxEmitterOptions {
  target: ParticleVfxEmitterTarget;
  presetId: number;
  preset: ParticleVfxPresetConfig | ParticleVfxPresetName;
  texture?: ParticleTextureRef;
}

export interface ParticleVfxEmitterSnapshot {
  presetId: number;
  mode: ParticleVfxEmitterMode;
  active: boolean;
  emittedBurstCount: number;
  spawnedParticleCount: number;
  elapsedSeconds: number;
  distanceSinceLastBurst: number;
}

export const PARTICLE_VFX_PRESETS: Readonly<Record<ParticleVfxPresetName, ParticleVfxPresetConfig>> = Object.freeze({
  "hit-spark": Object.freeze({
    particle: Object.freeze({
      texture: 0,
      burstCount: 12,
      lifetime: [0.12, 0.26] as const,
      speed: [100, 260] as const,
      startSize: [5, 9] as const,
      endSize: [1, 2] as const,
      startColor: [1, 0.92, 0.45, 1] as const,
      endColor: [1, 0.2, 0.05, 0] as const,
      damping: 1.8,
    }),
    emitter: Object.freeze({ mode: "burst" }),
  }),
  "dust-loop": Object.freeze({
    particle: Object.freeze({
      texture: 0,
      burstCount: 3,
      lifetime: [0.18, 0.34] as const,
      speed: [20, 90] as const,
      startSize: [5, 8] as const,
      endSize: [1, 2] as const,
      startColor: [0.78, 0.72, 0.62, 0.7] as const,
      endColor: [0.78, 0.72, 0.62, 0] as const,
      accelerationY: -12,
      damping: 2.4,
    }),
    emitter: Object.freeze({ mode: "loop", intervalSeconds: 0.08, autostart: true }),
  }),
  "motion-trail": Object.freeze({
    particle: Object.freeze({
      texture: 0,
      burstCount: 2,
      lifetime: [0.14, 0.28] as const,
      speed: [0, 35] as const,
      startSize: [6, 10] as const,
      endSize: [1, 2] as const,
      startColor: [0.45, 0.75, 1, 0.65] as const,
      endColor: [0.2, 0.25, 1, 0] as const,
      damping: 1.2,
    }),
    emitter: Object.freeze({
      mode: "trail",
      intervalSeconds: 0.04,
      distance: 12,
      autostart: true,
    }),
  }),
});

export function particleVfxPreset(
  name: ParticleVfxPresetName,
  texture: ParticleTextureRef = 0,
): ParticleVfxPresetConfig {
  const preset = PARTICLE_VFX_PRESETS[name];
  if (preset === undefined) {
    throw new Error(`Unknown particle VFX preset '${name}'.`);
  }
  return {
    particle: { ...preset.particle, texture },
    emitter: preset.emitter === undefined ? undefined : { ...preset.emitter },
  };
}

export function resolveParticleVfxPresetConfig(
  preset: ParticleVfxPresetConfig | ParticleVfxPresetName,
  texture: ParticleTextureRef = 0,
): ResolvedParticleVfxPresetConfig {
  const config = typeof preset === "string" ? particleVfxPreset(preset, texture) : preset;
  return {
    particle: { ...config.particle },
    emitter: resolveParticleVfxEmitterConfig(config.emitter),
  };
}

export class ParticleVfxEmitter {
  private readonly presetId: number;
  private readonly preset: ResolvedParticleVfxPresetConfig;
  private active: boolean;
  private emittedBurstCount = 0;
  private spawnedParticleCount = 0;
  private elapsedSeconds = 0;
  private distanceSinceLastBurst = 0;
  private lastX: number | undefined;
  private lastY: number | undefined;

  constructor(private readonly target: ParticleVfxEmitterTarget, options: Omit<ParticleVfxEmitterOptions, "target">) {
    this.presetId = particlePresetId(options.presetId);
    this.preset = resolveParticleVfxPresetConfig(options.preset, options.texture);
    this.active = this.preset.emitter.autostart;
    this.target.setParticlePreset(this.presetId, this.preset.particle);
  }

  static create(options: ParticleVfxEmitterOptions): ParticleVfxEmitter {
    return new ParticleVfxEmitter(options.target, options);
  }

  start(x?: number, y?: number): void {
    this.active = true;
    this.elapsedSeconds = 0;
    if (x !== undefined && y !== undefined) {
      this.lastX = finiteNumber(x, "particle VFX start x");
      this.lastY = finiteNumber(y, "particle VFX start y");
      this.distanceSinceLastBurst = 0;
    }
  }

  stop(): void {
    this.active = false;
  }

  reset(): void {
    this.active = this.preset.emitter.autostart;
    this.emittedBurstCount = 0;
    this.spawnedParticleCount = 0;
    this.elapsedSeconds = 0;
    this.distanceSinceLastBurst = 0;
    this.lastX = undefined;
    this.lastY = undefined;
  }

  trigger(x: number, y: number): number {
    return this.spawn(finiteNumber(x, "particle VFX trigger x"), finiteNumber(y, "particle VFX trigger y"));
  }

  update(deltaSeconds: number, x: number, y: number): number {
    if (!this.active || reachedMaxBursts(this.preset.emitter, this.emittedBurstCount)) {
      return 0;
    }
    const delta = finiteNumber(deltaSeconds, "particle VFX deltaSeconds");
    if (delta <= 0) {
      return 0;
    }
    const nextX = finiteNumber(x, "particle VFX x");
    const nextY = finiteNumber(y, "particle VFX y");
    switch (this.preset.emitter.mode) {
      case "burst":
        this.active = false;
        return this.spawn(nextX, nextY);
      case "loop":
        return this.updateLoop(delta, nextX, nextY);
      case "trail":
        return this.updateTrail(delta, nextX, nextY);
    }
  }

  snapshot(): ParticleVfxEmitterSnapshot {
    return {
      presetId: this.presetId,
      mode: this.preset.emitter.mode,
      active: this.active,
      emittedBurstCount: this.emittedBurstCount,
      spawnedParticleCount: this.spawnedParticleCount,
      elapsedSeconds: this.elapsedSeconds,
      distanceSinceLastBurst: this.distanceSinceLastBurst,
    };
  }

  private updateLoop(deltaSeconds: number, x: number, y: number): number {
    this.elapsedSeconds += deltaSeconds;
    let spawned = 0;
    let burstsThisUpdate = 0;
    while (
      this.elapsedSeconds >= this.preset.emitter.intervalSeconds
      && burstsThisUpdate < this.preset.emitter.maxBurstsPerUpdate
      && !reachedMaxBursts(this.preset.emitter, this.emittedBurstCount)
    ) {
      this.elapsedSeconds -= this.preset.emitter.intervalSeconds;
      spawned += this.spawn(x, y);
      burstsThisUpdate += 1;
    }
    return spawned;
  }

  private updateTrail(deltaSeconds: number, x: number, y: number): number {
    this.elapsedSeconds += deltaSeconds;
    if (this.lastX === undefined || this.lastY === undefined) {
      this.lastX = x;
      this.lastY = y;
      this.elapsedSeconds = 0;
      return this.spawn(x, y);
    }

    this.distanceSinceLastBurst += Math.hypot(x - this.lastX, y - this.lastY);
    this.lastX = x;
    this.lastY = y;
    if (
      this.distanceSinceLastBurst < this.preset.emitter.distance
      || this.elapsedSeconds < this.preset.emitter.intervalSeconds
    ) {
      return 0;
    }

    this.distanceSinceLastBurst = 0;
    this.elapsedSeconds = 0;
    return this.spawn(x, y);
  }

  private spawn(x: number, y: number): number {
    if (reachedMaxBursts(this.preset.emitter, this.emittedBurstCount)) {
      this.active = false;
      return 0;
    }
    const spawned = this.target.spawnParticleBurst(this.presetId, x, y);
    this.emittedBurstCount += 1;
    this.spawnedParticleCount += spawned;
    if (reachedMaxBursts(this.preset.emitter, this.emittedBurstCount)) {
      this.active = false;
    }
    return spawned;
  }
}

function resolveParticleVfxEmitterConfig(
  input: ParticleVfxEmitterConfig | undefined,
): ResolvedParticleVfxEmitterConfig {
  const mode = input?.mode ?? "burst";
  if (mode !== "burst" && mode !== "loop" && mode !== "trail") {
    throw new Error(`particle VFX emitter mode must be 'burst', 'loop', or 'trail', got '${mode}'.`);
  }
  return {
    mode,
    intervalSeconds: positiveNumber(input?.intervalSeconds ?? (mode === "burst" ? 0.01 : 0.08), "particle VFX intervalSeconds"),
    distance: positiveNumber(input?.distance ?? 12, "particle VFX distance"),
    ...(input?.maxBursts === undefined
      ? {}
      : { maxBursts: positiveInteger(input.maxBursts, "particle VFX maxBursts") }),
    maxBurstsPerUpdate: positiveInteger(input?.maxBurstsPerUpdate ?? 8, "particle VFX maxBurstsPerUpdate"),
    autostart: input?.autostart ?? mode !== "burst",
  };
}

function reachedMaxBursts(config: ResolvedParticleVfxEmitterConfig, emittedBurstCount: number): boolean {
  return config.maxBursts !== undefined && emittedBurstCount >= config.maxBursts;
}

function particlePresetId(value: number): number {
  return positiveInteger(value, "particle VFX presetId");
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}

function positiveNumber(value: number, label: string): number {
  const number = finiteNumber(value, label);
  if (number <= 0) {
    throw new Error(`${label} must be greater than 0.`);
  }
  return number;
}

function finiteNumber(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}
