import { sceneCompositionDiagnosticError } from "./diagnostics.js";
import type { SpatialPoint } from "./dataSceneSpatial.js";
import type { SpatialEnvironmentSpec, SpatialRgb } from "./spatialEnvironment.js";

/** Authored isotropic diffuse fill, smoothly replacing ambient/hemisphere inside a sphere. */
export interface SpatialLightProbeSpec {
  /** World X/Y/elevation, each -1e6..1e6. */
  position: SpatialPoint;
  /** Influence radius in world units, 0.1..10000. */
  radius: number;
  /** Linear RGB, each 0..1; default white. */
  color?: SpatialRgb;
  /** 0..4, default 1. Zero produces a dark region; it does not disable the probe. */
  intensity?: number;
}
export function requestsSpatialLightProbes(spec?: SpatialEnvironmentSpec | null): boolean {
  return spec?.lighting?.probes !== undefined;
}
export function supportsSpatialLightProbes(engine: unknown): boolean {
  const native = engine as { spatial_light_probes_abi_version?: () => number } | undefined;
  return typeof native?.spatial_light_probes_abi_version === "function" && native.spatial_light_probes_abi_version() === 1;
}
export function resolveSpatialLightProbes(value: unknown, path: string): SpatialLightProbeSpec[] {
  const fail = (at: string, message: string): never => { throw sceneCompositionDiagnosticError(at, message); };
  const record = (v: unknown, at: string, keys: string[]): Record<string, unknown> => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return fail(at, "must be an object");
    for (const key of Object.keys(v)) if (!keys.includes(key)) fail(`${at}.${key}`, "is not supported");
    return v as Record<string, unknown>;
  };
  const scalar = (v: unknown, at: string, min: number, max: number): number => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) return fail(at, `must be finite in ${min}..${max}`);
    return v;
  };
  if (!Array.isArray(value) || value.length > 8) return fail(path, "must be an array of at most 8 probes");
  // Array.from visits holes as undefined so sparse authoring cannot bypass validation.
  return Array.from(value, (v, i) => {
    const at = `${path}[${i}]`, p = record(v, at, ["position", "radius", "color", "intensity"]);
    const position = record(p.position, `${at}.position`, ["x", "y", "elevation"]);
    const c = p.color === undefined ? [1, 1, 1] : p.color;
    if (!Array.isArray(c) || c.length !== 3) return fail(`${at}.color`, "must contain three channels");
    return {
      position: { x: scalar(position.x, `${at}.position.x`, -1e6, 1e6), y: scalar(position.y, `${at}.position.y`, -1e6, 1e6), elevation: scalar(position.elevation, `${at}.position.elevation`, -1e6, 1e6) },
      radius: scalar(p.radius, `${at}.radius`, .1, 10000),
      color: [scalar(c[0], `${at}.color[0]`, 0, 1), scalar(c[1], `${at}.color[1]`, 0, 1), scalar(c[2], `${at}.color[2]`, 0, 1)],
      intensity: scalar(p.intensity === undefined ? 1 : p.intensity, `${at}.intensity`, 0, 4),
    };
  });
}
/** Called after finite-value and length validation; unused records/reserved fields must be zero. */
export function validSpatialLightProbes(v: Float32Array): boolean {
  if (v[632] === 0) {
    for (let i = 633; i < 700; i++) if (v[i] !== 0) return false;
    return true;
  }
  const count = v[633];
  if (v[632] !== 1 || !Number.isInteger(count) || count < 0 || count > 8 || v[634] !== 0 || v[635] !== 0) return false;
  for (let i = 0; i < count; i++) {
    const p = 636 + i * 8;
    for (let channel = 0; channel < 3; channel++) {
      if (Math.abs(v[p + channel]) > 1e6 || v[p + 4 + channel] < 0 || v[p + 4 + channel] > 1) return false;
    }
    if (v[p + 3] < Math.fround(.1) || v[p + 3] > 10000 || v[p + 7] < 0 || v[p + 7] > 4) return false;
  }
  for (let i = 636 + count * 8; i < 700; i++) if (v[i] !== 0) return false;
  return true;
}
