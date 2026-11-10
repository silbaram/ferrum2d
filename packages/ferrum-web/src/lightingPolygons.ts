import type { LightingShadowOptions, PolygonOccluder2D, ResolvedLightingScene2D } from "./lightingTypes.js";

const fields = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));

/** Strict owned cold geometry. Validate the actual float32 vertices used by rasterization too. */
export function resolvePolygonOccluders(value: unknown, path: string): PolygonOccluder2D[] {
  if (!Array.isArray(value) || value.length > 256) throw Error(`${path} must be an array of at most 256 polygons`);
  const result: PolygonOccluder2D[] = [];
  for (let i = 0; i < value.length; i++) {
    const polygon = value[i], at = `${path}[${i}]`;
    if (!fields(polygon, ["vertices"]) || !Array.isArray(polygon.vertices) || polygon.vertices.length < 3 || polygon.vertices.length > 8)
      throw Error(`${at} requires 3..8 ordered convex vertices`);
    const vertices: { x: number; y: number }[] = [], raster: { x: number; y: number }[] = [];
    for (let j = 0; j < polygon.vertices.length; j++) {
      const point: unknown = polygon.vertices[j];
      if (!fields(point, ["x", "y"]) || ![point.x, point.y].every(n => typeof n === "number" && Number.isFinite(Math.fround(n)) && Math.abs(n) <= 1e9))
        throw Error(`${at}.vertices[${j}] requires finite XY coordinates in -1e9..1e9`);
      // The preceding numeric checks establish both fields; retain authored precision.
      const x = point.x as number, y = point.y as number;
      vertices.push({ x, y }); raster.push({ x: Math.fround(x), y: Math.fround(y) });
    }
    if (!strictlyConvex(vertices) || !strictlyConvex(raster)) throw Error(`${at} must be strictly convex and nondegenerate after float32 conversion`);
    result.push({ vertices });
  }
  return result;
}

function strictlyConvex(points: PolygonOccluder2D["vertices"]): boolean {
  let winding = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    for (let j = 0; j < points.length; j++) {
      if (j === i || j === (i + 1) % points.length) continue;
      const c = points[j], turn = Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
      if (!turn || winding && turn !== winding) return false;
      winding = turn;
    }
  }
  return !!winding;
}

/** Safe warm match also checks field shape; adding an unsupported field cannot bypass validation. */
export function polygonOccludersMatch(source: unknown, cached: readonly PolygonOccluder2D[]): boolean {
  if (!Array.isArray(source) || source.length !== cached.length) return false;
  for (let i = 0; i < source.length; i++) {
    const polygon = source[i];
    if (!fields(polygon, ["vertices"]) || !Array.isArray(polygon.vertices) || polygon.vertices.length !== cached[i].vertices.length) return false;
    for (let j = 0; j < polygon.vertices.length; j++) {
      const point: unknown = polygon.vertices[j], previous = cached[i].vertices[j];
      if (!fields(point, ["x", "y"]) || point.x !== previous.x || point.y !== previous.y) return false;
    }
  }
  return true;
}

export function validatePolygonLightingBounds(scene: ResolvedLightingScene2D, authoredShadows?: boolean | LightingShadowOptions): void {
  if (!scene.polygonOccluders?.length) return;
  if (authoredShadows && typeof authoredShadows === "object") {
    for (const key of ["projectionLength", "maxDistance"] as const) {
      const value = authoredShadows[key];
      if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1e6))
        throw Error(`polygon lighting ${key} must be finite in 0..1e6 (exclusive0), even OFF`);
    }
  }
  if (scene.tileOccluders.length > 1024) throw Error("polygon lighting supports at most 1024 rectangle occluders");
  if (scene.shadows.projectionLength > 1e6 || (scene.shadows.maxDistance ?? 0) > 1e6) throw Error("polygon lighting projectionLength/maxDistance must be at most 1e6");
  for (const light of scene.pointLights) {
    if (Math.abs(light.x) > 1e9 || Math.abs(light.y) > 1e9 || light.radius > 1e6 || (light.radiusY ?? light.radius) > 1e6 ||
        ![light.radius, light.radiusY ?? light.radius, (light.radiusY ?? light.radius) / light.radius].every(n => Number.isFinite(Math.fround(n)) && Math.fround(n) > 0))
      throw Error("polygon lighting requires bounded finite point positions, radii and float32 aspect");
  }
}
