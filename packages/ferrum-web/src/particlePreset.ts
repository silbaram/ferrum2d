export type ParticleTextureRef = string | number;
export type ParticleRangeInput = number | readonly [number, number];
export type ParticleColor = readonly [number, number, number, number];

export interface ParticleUvRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export interface ParticlePresetConfig {
  texture: ParticleTextureRef;
  uv?: ParticleUvRect;
  burstCount?: number;
  lifetime?: ParticleRangeInput;
  speed?: ParticleRangeInput;
  startSize?: ParticleRangeInput;
  endSize?: ParticleRangeInput;
  startColor?: ParticleColor;
  endColor?: ParticleColor;
  accelerationX?: number;
  accelerationY?: number;
  damping?: number;
}

export interface ResolvedParticlePresetConfig {
  textureId: number;
  uv: ParticleUvRect;
  burstCount: number;
  lifetime: ParticleRangeTuple;
  speed: ParticleRangeTuple;
  startSize: ParticleRangeTuple;
  endSize: ParticleRangeTuple;
  startColor: ParticleColor;
  endColor: ParticleColor;
  accelerationX: number;
  accelerationY: number;
  damping: number;
}

export type ParticleRangeTuple = readonly [number, number];

const UINT32_MAX = 0xffffffff;
const MAX_PARTICLE_PRESETS = 256;
const DEFAULT_PARTICLE_UV: ParticleUvRect = Object.freeze({ u0: 0, v0: 0, u1: 1, v1: 1 });
const DEFAULT_PARTICLE_LIFETIME: ParticleRangeTuple = Object.freeze([0.18, 0.38]);
const DEFAULT_PARTICLE_SPEED: ParticleRangeTuple = Object.freeze([60, 180]);
const DEFAULT_PARTICLE_START_SIZE: ParticleRangeTuple = Object.freeze([8, 8]);
const DEFAULT_PARTICLE_END_SIZE: ParticleRangeTuple = Object.freeze([2, 2]);
const DEFAULT_PARTICLE_START_COLOR: ParticleColor = Object.freeze([1, 1, 1, 1]);
const DEFAULT_PARTICLE_END_COLOR: ParticleColor = Object.freeze([1, 1, 1, 0]);

export function particlePresetId(presetId: number): number {
  return uint32Number(presetId, "particle preset id", MAX_PARTICLE_PRESETS - 1);
}

export function resolveParticlePresetConfigForWasm(
  preset: ParticlePresetConfig,
  textureId: (name: string) => number,
): ResolvedParticlePresetConfig {
  return {
    textureId: resolveParticleTextureId(preset.texture, textureId),
    uv: particleUv(preset.uv),
    burstCount: uint32Number(preset.burstCount ?? 8, "particle burstCount"),
    lifetime: particleRange(preset.lifetime, "particle lifetime", DEFAULT_PARTICLE_LIFETIME, true),
    speed: particleRange(preset.speed, "particle speed", DEFAULT_PARTICLE_SPEED),
    startSize: particleRange(preset.startSize, "particle startSize", DEFAULT_PARTICLE_START_SIZE),
    endSize: particleRange(preset.endSize, "particle endSize", DEFAULT_PARTICLE_END_SIZE),
    startColor: particleColor(preset.startColor, "particle startColor", DEFAULT_PARTICLE_START_COLOR),
    endColor: particleColor(preset.endColor, "particle endColor", DEFAULT_PARTICLE_END_COLOR),
    accelerationX: finiteNumber(preset.accelerationX ?? 0, "particle accelerationX"),
    accelerationY: finiteNumber(preset.accelerationY ?? 0, "particle accelerationY"),
    damping: nonNegativeNumber(preset.damping ?? 0, "particle damping"),
  };
}

export function uint32Number(value: number, label: string, max = UINT32_MAX): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) {
    throw new Error(`${label} must be an integer between 0 and ${max}.`);
  }
  return value;
}

export function finiteNumber(value: number, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function resolveParticleTextureId(
  texture: ParticleTextureRef,
  textureId: (name: string) => number,
): number {
  if (typeof texture === "string") {
    if (texture.length === 0) {
      throw new Error("particle texture name must not be empty.");
    }
    return uint32Number(textureId(texture), `particle texture id for ${texture}`);
  }
  return uint32Number(texture, "particle texture id");
}

function particleUv(uv: ParticleUvRect | undefined): ParticleUvRect {
  const resolved = uv ?? DEFAULT_PARTICLE_UV;
  const u0 = normalizedNumber(resolved.u0, "particle uv.u0");
  const v0 = normalizedNumber(resolved.v0, "particle uv.v0");
  const u1 = normalizedNumber(resolved.u1, "particle uv.u1");
  const v1 = normalizedNumber(resolved.v1, "particle uv.v1");
  if (u1 <= u0 || v1 <= v0) {
    throw new Error("particle uv must satisfy u1 > u0 and v1 > v0.");
  }
  return { u0, v0, u1, v1 };
}

function particleRange(
  input: ParticleRangeInput | undefined,
  label: string,
  fallback: ParticleRangeTuple,
  requirePositive = false,
): ParticleRangeTuple {
  const range = input === undefined
    ? fallback
    : typeof input === "number"
      ? [input, input] as const
      : input;
  if (!Array.isArray(range) || range.length !== 2) {
    throw new Error(`${label} must be a number or a [min, max] tuple.`);
  }
  const min = finiteNumber(range[0], `${label} min`);
  const max = finiteNumber(range[1], `${label} max`);
  if (requirePositive ? min <= 0 || max <= 0 : min < 0 || max < 0) {
    throw new Error(requirePositive
      ? `${label} values must be greater than 0.`
      : `${label} values must be greater than or equal to 0.`);
  }
  return min <= max ? [min, max] : [max, min];
}

function particleColor(
  input: ParticleColor | undefined,
  label: string,
  fallback: ParticleColor,
): ParticleColor {
  const color = input ?? fallback;
  if (!Array.isArray(color) || color.length !== 4) {
    throw new Error(`${label} must be an rgba tuple with four values.`);
  }
  return [
    normalizedNumber(color[0], `${label}.r`),
    normalizedNumber(color[1], `${label}.g`),
    normalizedNumber(color[2], `${label}.b`),
    normalizedNumber(color[3], `${label}.a`),
  ];
}

function normalizedNumber(value: number, label: string): number {
  const resolved = finiteNumber(value, label);
  if (resolved < 0 || resolved > 1) {
    throw new Error(`${label} must be between 0 and 1.`);
  }
  return resolved;
}

function nonNegativeNumber(value: number, label: string): number {
  const resolved = finiteNumber(value, label);
  if (resolved < 0) {
    throw new Error(`${label} must be greater than or equal to 0.`);
  }
  return resolved;
}
