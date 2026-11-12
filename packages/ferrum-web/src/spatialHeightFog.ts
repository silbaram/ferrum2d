import { sceneCompositionDiagnosticError } from "./diagnostics.js";
import type { SpatialEnvironmentSpec } from "./spatialEnvironment.js";

/** Analytic ground fog. Density is constant below baseHeight and decays above it. */
export interface SpatialHeightFogSpec {
  /** World elevation, -1e6..1e6 (default 0). */
  baseHeight?: number;
  /** Extinction per world unit, 0..10 (default 0.01). Zero disables fogging. */
  density?: number;
  /** Exponential decay per world unit above the base, 0..10 (default 0.02). */
  falloff?: number;
}

export function requestsSpatialHeightFog(spec?: SpatialEnvironmentSpec | null): boolean {
  return spec?.fog?.height !== undefined;
}
export function supportsSpatialHeightFog(engine: unknown): boolean {
  const native = engine as { spatial_height_fog_abi_version?: () => number } | undefined;
  return typeof native?.spatial_height_fog_abi_version === "function" && native.spatial_height_fog_abi_version() === 1;
}
export function resolveSpatialHeightFog(value: unknown, path: string): SpatialHeightFogSpec {
  const fail = (at: string, message: string): never => { throw sceneCompositionDiagnosticError(at, message); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail(path, "must be a height fog object");
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) if (!["baseHeight", "density", "falloff"].includes(key)) fail(`${path}.${key}`, "is not supported");
  const scalar = (key: string, fallback: number, min: number, max: number): number => {
    const n = input[key] === undefined ? fallback : input[key];
    if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max) return fail(`${path}.${key}`, `must be finite in ${min}..${max}`);
    return n;
  };
  return { baseHeight: scalar("baseHeight", 0, -1e6, 1e6), density: scalar("density", .01, 0, 10), falloff: scalar("falloff", .02, 0, 10) };
}
/** Called only after environment length and finite-value validation. */
export function validSpatialHeightFog(v: Float32Array): boolean {
  if (v[608] === 0) return v.subarray(609, 616).every(x => x === 0);
  return v[608] === 1 && (v[0] & 2) !== 0 && Math.abs(v[609]) <= 1e6
    && v[610] >= 0 && v[610] <= 10 && v[611] >= 0 && v[611] <= 10 && v.subarray(612, 616).every(x => x === 0);
}
