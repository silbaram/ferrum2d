import { sceneCompositionDiagnosticError } from "./diagnostics.js";
import type { SpatialEnvironmentSpec } from "./spatialEnvironment.js";

/** Bounded point-light contact hardening, independent for each shadow owner. */
export interface SpatialPointPcssSpec {
  /** Emitter radius in world units, 0..1000 (default 1). Zero gives a hard shadow. */
  sourceRadius?: number;
  /** Tangent-disk radius in face-center texel units, 1..32 (default 16). */
  maxRadiusTexels?: number;
}
export function requestsSpatialPointPcss(spec?: SpatialEnvironmentSpec | null): boolean {
  const owners = spec?.lighting?.pointShadows;
  return spec?.lighting?.shadows?.pcss !== undefined
    || Array.isArray(owners) && owners.some(shadow => shadow?.pcss !== undefined);
}
export function supportsSpatialPointPcss(engine: unknown): boolean {
  const native = engine as { spatial_point_pcss_abi_version?: () => number } | undefined;
  return typeof native?.spatial_point_pcss_abi_version === "function" && native.spatial_point_pcss_abi_version() === 1;
}
export function resolveSpatialPointPcss(value: unknown, path: string): SpatialPointPcssSpec {
  const fail = (at: string, message: string): never => { throw sceneCompositionDiagnosticError(at, message); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail(path, "must be a PCSS object");
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) if (key !== "sourceRadius" && key !== "maxRadiusTexels") fail(`${path}.${key}`, "is not supported");
  const scalar = (key: string, fallback: number, min: number, max: number): number => {
    const n = input[key] === undefined ? fallback : input[key];
    if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max) return fail(`${path}.${key}`, `must be finite in ${min}..${max}`);
    return n;
  };
  return { sourceRadius: scalar("sourceRadius", 1, 0, 1000), maxRadiusTexels: scalar("maxRadiusTexels", 16, 1, 32) };
}
export function validSpatialPointPcss(v: Float32Array): boolean {
  for (let owner = 0; owner < 2; owner++) {
    const at = 600 + owner * 4;
    if (v[at] === 0) { if (v.subarray(at + 1, at + 4).some(x => x !== 0)) return false; }
    else if (v[at] !== 1 || v[138] < 0 || owner === 1 && (v[589] !== 1 || v[584] < 0)
      || v[at + 1] < 0 || v[at + 1] > 1000 || v[at + 2] < 1 || v[at + 2] > 32 || v[at + 3] !== 0) return false;
  }
  return true;
}
