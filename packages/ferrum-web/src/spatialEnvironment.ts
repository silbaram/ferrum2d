import { sceneCompositionDiagnosticError } from "./diagnostics.js";
import type { SpatialPoint } from "./dataSceneSpatial.js";

export type SpatialRgb = readonly [number, number, number];
export interface SpatialPointLightSpec {
  position: SpatialPoint;
  color?: SpatialRgb;
  intensity?: number;
  radius: number;
}
export interface SpatialLightingSpec {
  ambient?: SpatialRgb;
  lights: readonly SpatialPointLightSpec[];
  /** A single omnidirectional depth cube. All authored terrain/cutout billboards cast shadows. */
  shadows?: {
    lightIndex: number;
    resolution?: 128 | 256 | 512 | 1024;
    bias?: number;
  };
}
export interface SpatialDepthOfFieldSpec {
  focusDistance: number;
  focusRange?: number;
  aperture?: number;
  /** CSS pixels; bounded 13-tap depth-aware disk, maximum 12. */
  maxBlurRadius?: number;
}
export interface SpatialColorGradingSpec {
  /** Exposure value in stops. Default 0. */
  exposure?: number;
  contrast?: number;
  saturation?: number;
  tint?: SpatialRgb;
  toneMapping?: "none" | "reinhard" | "aces";
}
export interface SpatialFogSpec {
  color: SpatialRgb;
  start: number;
  end: number;
}
export interface SpatialEnvironmentSpec {
  lighting?: SpatialLightingSpec;
  depthOfField?: SpatialDepthOfFieldSpec;
  colorGrading?: SpatialColorGradingSpec;
  fog?: SpatialFogSpec;
}
/** Borrowed native environment v1; acquire with each frame, copy before deferred use. */
export interface SpatialEnvironmentBufferView {
  version: 1;
  values: Float32Array;
  shadowMatrices: Float32Array;
  shadowCasters: Float32Array;
  shadowCasterVertexCount: number;
}
export const SPATIAL_ENVIRONMENT_VALUES = 80;
export function validSpatialEnvironmentValues(v: Float32Array): boolean {
  if (
    v.length !== 80 ||
    v.some((x) => !Number.isFinite(x)) ||
    !Number.isInteger(v[0]) ||
    v[0] < 0 ||
    v[0] > 15 ||
    !Number.isInteger(v[1]) ||
    v[1] < 0 ||
    v[1] > 4 ||
    !Number.isInteger(v[2]) ||
    v[2] < -1 ||
    v[2] > 3
  )
    return false;
  if (!(v[0] & 1) && (v[1] !== 0 || v[2] !== -1)) return false;
  const range = (start: number, end: number, min: number, max: number) => {
    for (let i = start; i < end; i++)
      if (v[i] < min || v[i] > max) return false;
    return true;
  };
  if (
    !range(5, 8, 0, 4) ||
    !range(4, 5, 0, 10) ||
    (v[2] >= 0 && (v[2] >= v[1] || ![128, 256, 512, 1024].includes(v[3]))) ||
    (v[2] < 0 && v[3] !== 0)
  )
    return false;
  for (let i = 0; i < 4; i++) {
    const p = 12 + i * 12;
    if (i >= v[1]) {
      if (!range(p, p + 12, 0, 0)) return false;
      continue;
    }
    if (
      !range(p, p + 3, -1e6, 1e6) ||
      !range(p + 3, p + 4, 0.1, 1e6) ||
      !range(p + 4, p + 7, 0, 1) ||
      !range(p + 7, p + 8, 0, 64) ||
      !range(p + 8, p + 12, 0, 0)
    )
      return false;
  }
  return (
    range(8, 12, 0, 0) &&
    range(60, 61, 0.001, 1e6) &&
    range(61, 62, 0, 1e6) &&
    range(62, 63, 0, 32) &&
    range(63, 64, 0, 12) &&
    range(64, 65, -10, 10) &&
    range(65, 67, 0, 2) &&
    [0, 1, 2].includes(v[67]) &&
    range(68, 71, 0, 4) &&
    range(71, 72, 0, 1e6) &&
    v[72] > v[71] &&
    v[72] <= 1e6 &&
    range(73, 76, 0, 1) &&
    range(76, 80, 0, 0)
  );
}
function object(
  value: unknown,
  path: string,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw sceneCompositionDiagnosticError(path, "must be an object");
  for (const key of Object.keys(value))
    if (!keys.includes(key))
      throw sceneCompositionDiagnosticError(
        `${path}.${key}`,
        "is not supported",
      );
  return value as Record<string, unknown>;
}
function number(
  value: unknown,
  path: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(Math.fround(value)) ||
    Math.fround(value) < min ||
    Math.fround(value) > max
  )
    throw sceneCompositionDiagnosticError(
      path,
      `must be a finite f32 in ${min}..${max}`,
    );
  return value;
}
function rgb(value: unknown, path: string, max = 4): SpatialRgb {
  if (!Array.isArray(value) || value.length !== 3)
    throw sceneCompositionDiagnosticError(path, "must have three RGB channels");
  return [
    number(value[0], `${path}[0]`, 0, max),
    number(value[1], `${path}[1]`, 0, max),
    number(value[2], `${path}[2]`, 0, max),
  ];
}
export function resolveSpatialEnvironmentSpec(
  value: unknown,
  path = "spatial.environment",
): SpatialEnvironmentSpec {
  const o = object(value, path, [
    "lighting",
    "depthOfField",
    "colorGrading",
    "fog",
  ]);
  const result: SpatialEnvironmentSpec = {};
  if (o.lighting !== undefined) {
    const l = object(o.lighting, `${path}.lighting`, [
      "ambient",
      "lights",
      "shadows",
    ]);
    if (!Array.isArray(l.lights) || l.lights.length > 4)
      throw sceneCompositionDiagnosticError(
        `${path}.lighting.lights`,
        "must be an array of at most four lights",
      );
    const lights = Array.from(
      l.lights,
      (value, index): SpatialPointLightSpec => {
        const at = `${path}.lighting.lights[${index}]`,
          s = object(value, at, ["position", "color", "intensity", "radius"]),
          p = object(s.position, `${at}.position`, ["x", "y", "elevation"]);
        return {
          position: {
            x: number(p.x, `${at}.position.x`, -1e6, 1e6),
            y: number(p.y, `${at}.position.y`, -1e6, 1e6),
            elevation: number(
              p.elevation,
              `${at}.position.elevation`,
              -1e6,
              1e6,
            ),
          },
          radius: number(s.radius, `${at}.radius`, 0.1, 1e6),
          color: rgb(
            s.color === undefined ? [1, 1, 1] : s.color,
            `${at}.color`,
            1,
          ),
          intensity: number(
            s.intensity === undefined ? 1 : s.intensity,
            `${at}.intensity`,
            0,
            64,
          ),
        };
      },
    );
    let shadows: SpatialLightingSpec["shadows"];
    if (l.shadows !== undefined) {
      const s = object(l.shadows, `${path}.lighting.shadows`, [
        "lightIndex",
        "resolution",
        "bias",
      ]);
      const lightIndex = number(
          s.lightIndex,
          `${path}.lighting.shadows.lightIndex`,
          0,
          3,
        ),
        resolution = s.resolution === undefined ? 256 : s.resolution;
      if (!Number.isInteger(lightIndex) || lightIndex >= lights.length)
        throw sceneCompositionDiagnosticError(
          `${path}.lighting.shadows.lightIndex`,
          "must reference an authored light",
        );
      if (![128, 256, 512, 1024].includes(resolution as number))
        throw sceneCompositionDiagnosticError(
          `${path}.lighting.shadows.resolution`,
          "must be 128, 256, 512 or 1024",
        );
      shadows = {
        lightIndex,
        resolution: resolution as 128 | 256 | 512 | 1024,
        bias: number(
          s.bias === undefined ? 0.05 : s.bias,
          `${path}.lighting.shadows.bias`,
          0,
          10,
        ),
      };
    }
    result.lighting = {
      ambient: rgb(
        l.ambient === undefined ? [0.15, 0.15, 0.15] : l.ambient,
        `${path}.lighting.ambient`,
      ),
      lights,
      ...(shadows === undefined ? {} : { shadows }),
    };
  }
  if (o.depthOfField !== undefined) {
    const d = object(o.depthOfField, `${path}.depthOfField`, [
      "focusDistance",
      "focusRange",
      "aperture",
      "maxBlurRadius",
    ]);
    result.depthOfField = {
      focusDistance: number(
        d.focusDistance,
        `${path}.depthOfField.focusDistance`,
        0.001,
        1e6,
      ),
      focusRange: number(
        d.focusRange === undefined ? 10 : d.focusRange,
        `${path}.depthOfField.focusRange`,
        0,
        1e6,
      ),
      aperture: number(
        d.aperture === undefined ? 8 : d.aperture,
        `${path}.depthOfField.aperture`,
        0,
        32,
      ),
      maxBlurRadius: number(
        d.maxBlurRadius === undefined ? 8 : d.maxBlurRadius,
        `${path}.depthOfField.maxBlurRadius`,
        0,
        12,
      ),
    };
  }
  if (o.colorGrading !== undefined) {
    const c = object(o.colorGrading, `${path}.colorGrading`, [
        "exposure",
        "contrast",
        "saturation",
        "tint",
        "toneMapping",
      ]),
      tone = c.toneMapping === undefined ? "none" : c.toneMapping;
    if (tone !== "none" && tone !== "reinhard" && tone !== "aces")
      throw sceneCompositionDiagnosticError(
        `${path}.colorGrading.toneMapping`,
        "must be none, reinhard or aces",
      );
    result.colorGrading = {
      exposure: number(
        c.exposure === undefined ? 0 : c.exposure,
        `${path}.colorGrading.exposure`,
        -10,
        10,
      ),
      contrast: number(
        c.contrast === undefined ? 1 : c.contrast,
        `${path}.colorGrading.contrast`,
        0,
        2,
      ),
      saturation: number(
        c.saturation === undefined ? 1 : c.saturation,
        `${path}.colorGrading.saturation`,
        0,
        2,
      ),
      tint: rgb(
        c.tint === undefined ? [1, 1, 1] : c.tint,
        `${path}.colorGrading.tint`,
      ),
      toneMapping: tone,
    };
  }
  if (o.fog !== undefined) {
    const f = object(o.fog, `${path}.fog`, ["color", "start", "end"]),
      start = number(f.start, `${path}.fog.start`, 0, 1e6),
      end = number(f.end, `${path}.fog.end`, 0.001, 1e6);
    if (Math.fround(end) <= Math.fround(start))
      throw sceneCompositionDiagnosticError(
        `${path}.fog.end`,
        "must exceed start",
      );
    result.fog = { color: rgb(f.color, `${path}.fog.color`, 1), start, end };
  }
  return result;
}
export function compileSpatialEnvironment(
  input: SpatialEnvironmentSpec | null,
): Float32Array {
  if (input === null) return new Float32Array();
  const spec = resolveSpatialEnvironmentSpec(input),
    v = new Float32Array(80);
  v[2] = -1;
  v[4] = 0.05;
  v.set([0.15, 0.15, 0.15], 5);
  v.set([100, 10, 8, 8, 0, 1, 1, 0, 1, 1, 1, 0, 1000, 0, 0, 0], 60);
  if (spec.lighting) {
    v[0] |= 1;
    v[1] = spec.lighting.lights.length;
    v.set(spec.lighting.ambient!, 5);
    spec.lighting.lights.forEach((l, i) =>
      v.set(
        [
          l.position.x,
          l.position.elevation,
          -l.position.y,
          l.radius,
          ...l.color!,
          l.intensity!,
          0,
          0,
          0,
          0,
        ],
        12 + i * 12,
      ),
    );
    if (spec.lighting.shadows) {
      v[2] = spec.lighting.shadows.lightIndex;
      v[3] = spec.lighting.shadows.resolution!;
      v[4] = spec.lighting.shadows.bias!;
    }
  }
  if (spec.depthOfField) {
    v[0] |= 4;
    const d = spec.depthOfField;
    v.set([d.focusDistance, d.focusRange!, d.aperture!, d.maxBlurRadius!], 60);
  }
  if (spec.colorGrading) {
    v[0] |= 8;
    const c = spec.colorGrading;
    v.set(
      [
        c.exposure!,
        c.contrast!,
        c.saturation!,
        ["none", "reinhard", "aces"].indexOf(c.toneMapping!),
        ...c.tint!,
      ],
      64,
    );
  }
  if (spec.fog) {
    v[0] |= 2;
    v.set([spec.fog.start, spec.fog.end, ...spec.fog.color], 71);
  }
  return v;
}
export function decodeSpatialEnvironment(
  v: Float32Array,
): SpatialEnvironmentSpec | null {
  if (v.length === 0) return null;
  if (!validSpatialEnvironmentValues(v))
    throw new Error("Invalid native spatial environment");
  const flags = v[0],
    spec: SpatialEnvironmentSpec = {};
  if (flags & 1)
    spec.lighting = {
      ambient: [v[5], v[6], v[7]],
      lights: Array.from({ length: v[1] }, (_, i) => {
        const p = 12 + i * 12;
        return {
          position: { x: v[p], elevation: v[p + 1], y: -v[p + 2] },
          radius: v[p + 3],
          color: [v[p + 4], v[p + 5], v[p + 6]],
          intensity: v[p + 7],
        };
      }),
      ...(v[2] < 0
        ? {}
        : {
            shadows: {
              lightIndex: v[2],
              resolution: v[3] as 128 | 256 | 512 | 1024,
              bias: v[4],
            },
          }),
    };
  if (flags & 4)
    spec.depthOfField = {
      focusDistance: v[60],
      focusRange: v[61],
      aperture: v[62],
      maxBlurRadius: v[63],
    };
  if (flags & 8)
    spec.colorGrading = {
      exposure: v[64],
      contrast: v[65],
      saturation: v[66],
      toneMapping: (["none", "reinhard", "aces"] as const)[v[67]],
      tint: [v[68], v[69], v[70]],
    };
  if (flags & 2)
    spec.fog = { start: v[71], end: v[72], color: [v[73], v[74], v[75]] };
  return resolveSpatialEnvironmentSpec(spec);
}
