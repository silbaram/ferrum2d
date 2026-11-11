import { sceneCompositionDiagnosticError } from "./diagnostics.js";
import type { SpatialEnvironmentSpec } from "./spatialEnvironment.js";

/** One authored omnidirectional depth cube. Radius comes from the referenced light. */
export interface SpatialPointShadowSpec {
  lightIndex: number;
  resolution?: 128 | 256 | 512 | 1024;
  bias?: number;
  /** World units along the geometric normal for shadow queries only. Default0. */
  normalBias?: number;
}

export function requestsSpatialPointShadows(spec?: SpatialEnvironmentSpec | null): boolean {
  return spec?.lighting?.pointShadows !== undefined;
}
export function supportsSpatialPointShadows(engine: unknown): boolean {
  const native = engine as { spatial_point_shadows_abi_version?: () => number } | undefined;
  return typeof native?.spatial_point_shadows_abi_version === "function" && native.spatial_point_shadows_abi_version() === 1;
}
export function secondSpatialShadowSlot(v?: Float32Array): number {
  return v?.length === 592 ? v[588] : -1;
}
export function spatialShadowOwner(v: Float32Array, source: number): number {
  return source === v[138] ? 0 : v.length === 592 && source === v[584] ? 1 : -1;
}
export function validSpatialPointShadows(v: Float32Array): boolean {
  if (v[589] !== 1 || v[590] !== 0 || v[591] !== 0 || v[138] < 0 || !Number.isInteger(v[584])
      || v[584] < -1 || v[584] >= v[137] || v[584] === v[138]) return false;
  if (v[584] < 0) return v.subarray(585, 588).every(x => x === 0) && v[588] === -1;
  return v[136] >= 2 && (!(v[0] & 1) || v[1] >= 2) && [128, 256, 512, 1024].includes(v[585]) && v[586] >= 0 && v[586] <= 10
    && v[587] >= 0 && v[587] <= 10 && v[588] === (v[0] & 1 ? 1 : -1);
}
export function resolveSpatialPointShadows(value: unknown, lightCount: number, budget: number, path: string): readonly SpatialPointShadowSpec[] {
  const fail = (at: string, message: string): never => { throw sceneCompositionDiagnosticError(at, message); };
  if (!Array.isArray(value) || value.length < 1 || value.length > 2 || value.length > budget)
    return fail(path, "requires one or two shadow lights within maxActiveLights");
  const seen = new Set<number>();
  return Array.from(value, (entry, i) => {
    const at = `${path}[${i}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return fail(at, "must be a shadow object");
    const input = entry as Record<string, unknown>;
    for (const key of Object.keys(input)) if (!["lightIndex", "resolution", "bias", "normalBias"].includes(key)) fail(`${at}.${key}`, "is not supported");
    const lightIndex = input.lightIndex;
    if (typeof lightIndex !== "number" || !Number.isInteger(lightIndex) || lightIndex < 0 || lightIndex >= lightCount || seen.has(lightIndex))
      return fail(`${at}.lightIndex`, "must reference a unique authored light");
    seen.add(lightIndex);
    const resolution = input.resolution === undefined ? 256 : input.resolution;
    if (![128, 256, 512, 1024].includes(resolution as number)) return fail(`${at}.resolution`, "must be 128, 256, 512 or 1024");
    const scalar = (key: "bias" | "normalBias", fallback: number): number => {
      const n = input[key] === undefined ? fallback : input[key];
      if (typeof n !== "number" || !Number.isFinite(Math.fround(n)) || n < 0 || n > 10) return fail(`${at}.${key}`, "must be finite in 0..10");
      return n;
    };
    const normalBias = scalar("normalBias", 0);
    return { lightIndex, resolution: resolution as SpatialPointShadowSpec["resolution"], bias: scalar("bias", 0.05), ...(normalBias > 0 ? { normalBias } : {}) };
  });
}
