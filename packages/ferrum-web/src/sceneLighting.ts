import { sceneCompositionDiagnosticError } from "./diagnostics.js";
import { normalizeLightingScene } from "./lightingNormalize.js";
import type { LightingScene2D, ResolvedLightingScene2D } from "./lightingTypes.js";

/** Cold authored world-space lighting. Validate disabled settings too, and never discard them. */
export function resolveSceneLighting(value: unknown, path = "sceneAuthoring.lighting"): ResolvedLightingScene2D {
  const record = (value: unknown, at: string, keys: readonly string[]): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw sceneCompositionDiagnosticError(at, "must be an object");
    for (const key of Object.keys(value)) if (!keys.includes(key)) throw sceneCompositionDiagnosticError(`${at}.${key}`, "is not supported");
    return value as Record<string, unknown>;
  };
  const boolean = (value: unknown, at: string) => {
    if (value !== undefined && typeof value !== "boolean") throw sceneCompositionDiagnosticError(at, "must be a boolean");
  };
  const bounded = (value: unknown, at: string, min: number, max: number) => {
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(Math.fround(value)) || value < min || value > max))
      throw sceneCompositionDiagnosticError(at, `must be a finite number in ${min}..${max}`);
  };
  const scene = record(value, path, ["enabled", "ambient", "directionalLight", "pointLights", "tileOccluders", "shadows", "debug"]);
  boolean(scene.enabled, `${path}.enabled`);
  for (const [name, maximum, keys] of [
    ["pointLights", 32, ["x", "y", "radius", "radiusY", "height", "color", "intensity", "falloff"]],
    ["tileOccluders", 1024, ["x", "y", "width", "height"]],
  ] as const) {
    const items = scene[name];
    if (items === undefined) continue;
    if (!Array.isArray(items) || items.length > maximum) throw sceneCompositionDiagnosticError(`${path}.${name}`, `must be an array of at most ${maximum} entries`);
    items.forEach((value, index) => {
      const at = `${path}.${name}[${index}]`, item = record(value, at, keys);
      for (const axis of ["x", "y"]) bounded(item[axis], `${at}.${axis}`, -1e6, 1e6);
      for (const size of ["radius", "radiusY", "width"]) bounded(item[size], `${at}.${size}`, 0.001, 1e6);
      bounded(item.height, `${at}.height`, name === "pointLights" ? 0 : 0.001, 1e6);
      bounded(item.intensity, `${at}.intensity`, 0, 64);
      bounded(item.falloff, `${at}.falloff`, 0.001, 64);
    });
  }
  if (scene.directionalLight !== undefined)
    record(scene.directionalLight, `${path}.directionalLight`, ["directionX", "directionY", "intensity", "color", "shadowOpacity", "shadowLengthScale", "maxCasters", "elevationRadians"]);
  let shadows = scene.shadows;
  if (shadows !== undefined && typeof shadows !== "boolean") {
    const shadow = record(shadows, `${path}.shadows`, ["enabled", "color", "projectionLength", "maxDistance"]);
    boolean(shadow.enabled, `${path}.shadows.enabled`);
    bounded(shadow.projectionLength, `${path}.shadows.projectionLength`, 0.001, 1e6);
    bounded(shadow.maxDistance, `${path}.shadows.maxDistance`, 0.001, 1e6);
    shadows = { ...shadow, enabled: true };
  }
  if (scene.debug !== undefined) {
    const debug = record(scene.debug, `${path}.debug`, ["tileOccluders", "color"]);
    boolean(debug.tileOccluders, `${path}.debug.tileOccluders`);
  }
  try {
    const result = normalizeLightingScene({ ...scene, enabled: true, shadows } as LightingScene2D);
    const shadowEnabled = typeof scene.shadows === "object" && scene.shadows !== null
      ? (scene.shadows as Record<string, unknown>).enabled !== false : scene.shadows === true;
    return { ...result, enabled: scene.enabled !== false, shadows: { ...result.shadows, enabled: shadowEnabled } };
  } catch (error) {
    throw sceneCompositionDiagnosticError(path, error instanceof Error ? error.message : String(error));
  }
}
