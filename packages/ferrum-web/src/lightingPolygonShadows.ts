import { clipPolygonToRectInto, createShadowProjectionScratch, writeTriangulatedPolygonInto } from "./lightingShadows.js";
import type { PolygonOccluder2D, ResolvedPointLight2D, ShadowClipRect, ShadowProjectionPoint } from "./lightingTypes.js";

// <=8 body vertices +2 tangent endpoints +4 rectangle clip intersections =>12 triangles.
export const MAX_POLYGON_SHADOW_FLOATS = 72;
export function createPolygonShadowScratch() {
  return { points: Array.from({ length: 10 }, () => ({ x: 0, y: 0 })), angles: new Float64Array(8),
    order: [] as number[], hull: [] as ShadowProjectionPoint[], clip: createShadowProjectionScratch() };
}
type Scratch = ReturnType<typeof createPolygonShadowScratch>;

export function polygonDistanceSquared(polygon: PolygonOccluder2D, light: ResolvedPointLight2D): number {
  const scaleY = (light.radiusY ?? light.radius) / light.radius;
  let distance = Infinity;
  const points = polygon.vertices;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const x = a.x - light.x, y = (a.y - light.y) / scaleY, dx = b.x - a.x, dy = (b.y - a.y) / scaleY;
    const t = Math.max(0, Math.min(1, -(x * dx + y * dy) / (dx * dx + dy * dy)));
    distance = Math.min(distance, (x + dx * t) ** 2 + (y + dy * t) ** 2);
  }
  return distance;
}

/** Hull of the body and its two extruded angular tangents; rectangle projection stays separate. */
export function writePolygonShadowTrianglesInto(target: Float32Array, offset: number, polygon: PolygonOccluder2D,
  light: ResolvedPointLight2D, projectionLength: number, scratch: Scratch, clipRect: ShadowClipRect): number {
  const vertices = polygon.vertices, n = vertices.length, scaleY = (light.radiusY ?? light.radius) / light.radius;
  let positive = false, negative = false;
  for (let i = 0; i < n; i++) {
    const a = vertices[i], b = vertices[(i + 1) % n];
    const side = (b.x - a.x) * (light.y - a.y) - (b.y - a.y) * (light.x - a.x);
    positive ||= side > 0; negative ||= side < 0;
  }
  if (!positive || !negative) return 0; // Inside/on boundary, matching rectangle policy.
  const { points, angles, order, hull } = scratch;
  order.length = n;
  for (let i = 0; i < n; i++) {
    points[i].x = vertices[i].x; points[i].y = vertices[i].y; order[i] = i;
    angles[i] = Math.atan2((points[i].y - light.y) / scaleY, points[i].x - light.x);
  }
  order.sort((a, b) => angles[a] - angles[b]);
  let gap = -Infinity, gapIndex = 0;
  for (let i = 0; i < n; i++) {
    const difference = angles[order[(i + 1) % n]] + (i === n - 1 ? Math.PI * 2 : 0) - angles[order[i]];
    if (difference > gap) { gap = difference; gapIndex = i; }
  }
  for (let j = 0; j < 2; j++) {
    let index = order[(gapIndex + (j === 0 ? 1 : 0)) % n];
    const rayX = points[index].x - light.x, rayY = (points[index].y - light.y) / scaleY;
    let farthest = rayX * rayX + rayY * rayY;
    // An edge can lie on a tangent ray. Choose its farthest endpoint in either
    // winding, including atan2's -pi/+pi split, rather than relying on sort order.
    for (let i = 0; i < n; i++) {
      const dx = points[i].x - light.x, dy = (points[i].y - light.y) / scaleY;
      const distance = dx * dx + dy * dy;
      const sameRay = angles[i] === angles[index] || rayX * dy - rayY * dx === 0 && rayX * dx + rayY * dy > 0;
      if (sameRay && distance > farthest) { index = i; farthest = distance; }
    }
    const point = points[index], far = points[n + j];
    const dx = point.x - light.x, dy = point.y - light.y, distance = Math.hypot(dx, dy / scaleY);
    if (distance <= .0001) return 0;
    far.x = point.x + dx / distance * projectionLength; far.y = point.y + dy / distance * projectionLength;
  }
  order.length = n + 2;
  for (let i = 0; i < n + 2; i++) order[i] = i;
  order.sort((a, b) => points[a].x - points[b].x || points[a].y - points[b].y);
  let count = 0;
  const append = (point: ShadowProjectionPoint, threshold: number) => {
    while (count >= threshold && turn(hull[count - 2], hull[count - 1], point) <= 0) count--;
    hull[count++] = point;
  };
  for (const i of order) append(points[i], 2);
  const threshold = count + 1;
  for (let i = order.length - 2; i >= 0; i--) append(points[order[i]], threshold);
  count--;
  const clipped = clipPolygonToRectInto(hull, count, clipRect, scratch.clip);
  const required = Math.max(0, clipped - 2) * 6;
  if (required > MAX_POLYGON_SHADOW_FLOATS || offset + required > target.length) throw Error("Polygon shadow staging exceeds its bounded geometry budget");
  return writeTriangulatedPolygonInto(scratch.clip.result, clipped, target, offset);
}

function turn(a: ShadowProjectionPoint, b: ShadowProjectionPoint, c: ShadowProjectionPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
