import { sceneCompositionDiagnosticError } from "./diagnostics.js";
import type { SpatialEnvironmentSpec, SpatialRgb } from "./spatialEnvironment.js";

/** Bounded single-scattering approximation using the existing directional shadow map. */
export interface SpatialLightShaftSpec {
  /** 0..4, default 0.5. Zero releases the effect's render targets. */
  intensity?: number;
  /** Linear RGB tint multiplying the sun color, each 0..1; default white. */
  color?: SpatialRgb;
  /** Extinction per world unit, 0..1; default 0.01. */
  density?: number;
  /** World-space ray distance from the camera, 0.1..10000; default 200. */
  maxDistance?: number;
  /** Forward scattering concentration, 0..0.9; default 0 (isotropic). */
  anisotropy?: number;
  /** Low: quarter/16, balanced: half/32, high: half/48 resolution/samples. */
  quality?: "low" | "balanced" | "high";
}
export function requestsSpatialLightShafts(spec?: SpatialEnvironmentSpec | null): boolean {
  return spec?.lightShafts !== undefined;
}
export function supportsSpatialLightShafts(engine: unknown): boolean {
  const native = engine as { spatial_light_shafts_abi_version?: () => number } | undefined;
  return typeof native?.spatial_light_shafts_abi_version === "function" && native.spatial_light_shafts_abi_version() === 1;
}
export function resolveSpatialLightShafts(value: unknown, path: string): SpatialLightShaftSpec {
  const fail = (at: string, message: string): never => { throw sceneCompositionDiagnosticError(at, message); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail(path, "must be a light shafts object");
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) if (!["intensity", "color", "density", "maxDistance", "anisotropy", "quality"].includes(key)) fail(`${path}.${key}`, "is not supported");
  const scalar = (key: string, fallback: number, min: number, max: number): number => {
    const n = input[key] === undefined ? fallback : input[key];
    if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max) return fail(`${path}.${key}`, `must be finite in ${min}..${max}`);
    return n;
  };
  const color = input.color === undefined ? [1, 1, 1] : input.color;
  if (!Array.isArray(color) || color.length !== 3 || ![0, 1, 2].every(i => typeof color[i] === "number" && Number.isFinite(color[i]) && color[i] >= 0 && color[i] <= 1)) fail(`${path}.color`, "must contain three finite channels in 0..1");
  const quality = input.quality === undefined ? "balanced" : input.quality;
  if (!["low", "balanced", "high"].includes(quality as string)) fail(`${path}.quality`, "must be low, balanced or high");
  return { intensity: scalar("intensity", .5, 0, 4), color: [...color as number[]] as [number, number, number], density: scalar("density", .01, 0, 1),
    maxDistance: scalar("maxDistance", 200, .1, 10000), anisotropy: scalar("anisotropy", 0, 0, .9), quality: quality as SpatialLightShaftSpec["quality"] };
}
/** Validated finite native values, including inactive authored settings. */
export function validSpatialLightShafts(v: Float32Array): boolean {
  if (v[616] === 0) return v.subarray(617, 632).every(x => x === 0);
  return v[616] === 1 && v[528] === 1 && v[83] === 1 && v[92] > 0
    && v[617] >= 0 && v[617] <= 4 && v[618] >= 0 && v[618] <= 1 && v[619] >= Math.fround(.1) && v[619] <= 10000
    && v.subarray(620, 623).every(x => x >= 0 && x <= 1) && v[623] >= 0 && v[623] <= Math.fround(.9)
    && (v[624] === 4 && v[625] === 16 || v[624] === 2 && [32, 48].includes(v[625])) && v.subarray(626, 632).every(x => x === 0);
}
export function spatialLightShaftsActive(v: Float32Array | undefined): boolean {
  return !!v && v.length >= 632 && v[616] === 1 && v[617] > 0 && v[618] > 0 && (v[0] & 1) !== 0 && v[83] === 1 && v[87] > 0 && v[92] > 0;
}
