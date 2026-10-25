import type { SpatialTerrainSurface } from "@ferrum2d/ferrum-web/core";
export const GRID_LINE_BUDGET = 512;
export interface GridViewport {
  cssWidth: number;
  cssHeight: number;
  cameraX: number;
  cameraY: number;
  zoom: number;
}
export type GridSurface = Pick<
  SpatialTerrainSurface,
  "x" | "y" | "width" | "depth" | "elevation" | "endElevation" | "rampAxis"
>;
export type GridColor = readonly [number, number, number, number];
export interface PlaneProjection {
  camera: Float32Array;
  rect: { left: number; top: number; width: number; height: number };
}

/** Authoring ray/plane intersection; engine coordinates are X/Y + elevation. */
export function pointOnElevationPlane(
  client: { x: number; y: number },
  elevation: number,
  { camera: m, rect }: PlaneProjection,
) {
  if (rect.width <= 0 || rect.height <= 0 || !Number.isFinite(elevation)) return;
  const u = ((client.x - rect.left) / rect.width) * 2 - 1,
    v = 1 - ((client.y - rect.top) / rect.height) * 2,
    a = m[0] - u * m[3], b = -m[8] + u * m[11],
    c = m[1] - v * m[3], d = -m[9] + v * m[11],
    cx = -((m[4] - u * m[7]) * elevation + m[12] - u * m[15]),
    cy = -((m[5] - v * m[7]) * elevation + m[13] - v * m[15]),
    determinant = a * d - b * c,
    scale = Math.max(Math.abs(a), Math.abs(b)) * Math.max(Math.abs(c), Math.abs(d));
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= scale * 1e-12) return;
  const x = (cx * d - b * cy) / determinant,
    y = (a * cy - cx * c) / determinant,
    w = m[3] * x + m[7] * elevation - m[11] * y + m[15];
  if (![x, y, w].every(Number.isFinite) || w <= 0) return;
  return { x, y, elevation };
}

/** Intersect the view frustum with a plane, bounded by the authoring coordinate limit.
 * Clipping all six homogeneous planes also handles a horizon crossing the viewport.
 */
export function visibleWorkingPlane(m: Float32Array, elevation: number): GridSurface | undefined {
  if (m.length < 16 || !Array.from(m.subarray(0, 16)).every(Number.isFinite) || !Number.isFinite(elevation)) return;
  let polygon = [ [-1e6, -1e6], [1e6, -1e6], [1e6, 1e6], [-1e6, 1e6] ];
  for (const row of [0, 1, 2]) for (const sign of [-1, 1]) {
    const distance = ([x, y]: number[]) =>
      (m[3] + sign * m[row]) * x - (m[11] + sign * m[8 + row]) * y +
      (m[7] + sign * m[4 + row]) * elevation + m[15] + sign * m[12 + row];
    const clipped: number[][] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length],
        da = distance(a), db = distance(b);
      if (da >= 0) clipped.push(a);
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);
        clipped.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    polygon = clipped;
  }
  if (polygon.length < 3) return;
  const x = Math.min(...polygon.map(p => p[0])), y = Math.min(...polygon.map(p => p[1])),
    width = Math.max(...polygon.map(p => p[0])) - x,
    depth = Math.max(...polygon.map(p => p[1])) - y;
  if (width <= 0 || depth <= 0) return;
  return { x, y, width, depth, elevation };
}
const valid = (n: number) => Number.isFinite(n);
function count(min: number, max: number, step: number) {
  return Math.max(0, Math.floor(max / step) - Math.ceil(min / step) + 1);
}
function lines(
  min: number,
  max: number,
  step: number,
  visit: (n: number) => void,
) {
  const first = Math.ceil(min / step),
    last = Math.floor(max / step);
  for (let i = first; i <= last && i - first < GRID_LINE_BUDGET; i++)
    visit(i * step);
}
function spacing(
  base: number,
  pixels: number,
  estimate: (step: number) => number,
) {
  let step = Number.isFinite(base) && base > 0 ? base : 16;
  for (
    let i = 0;
    i < 48 &&
    (pixels * (step / base) < 12 || estimate(step) > GRID_LINE_BUDGET);
    i++
  )
    step *= 2;
  return step;
}
function colorAt(
  n: number,
  step: number,
  minor: GridColor,
  major: GridColor,
): GridColor {
  if (Math.abs(n) < step * 1e-7)
    return [major[0], major[1], major[2], Math.min(1, major[3] * 1.45)];
  return Math.abs(Math.round(n / step)) % 5 === 0 ? major : minor;
}
export function flatGrid(
  v: GridViewport,
  base: number,
  minor: GridColor,
  major: GridColor,
) {
  if (
    ![v.cssWidth, v.cssHeight, v.cameraX, v.cameraY, v.zoom].every(valid) ||
    v.cssWidth <= 0 ||
    v.cssHeight <= 0 ||
    v.zoom <= 0
  )
    return { step: base, buffer: new Float32Array(), lineCount: 0 };
  const halfX = v.cssWidth / v.zoom / 2,
    halfY = v.cssHeight / v.zoom / 2,
    minX = v.cameraX - halfX,
    maxX = v.cameraX + halfX,
    minY = v.cameraY - halfY,
    maxY = v.cameraY + halfY,
    step = spacing(
      base,
      base * v.zoom,
      (s) => count(minX, maxX, s) + count(minY, maxY, s),
    ),
    values: number[] = [];
  const add = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    color: GridColor,
  ) => {
    if (values.length / 8 < GRID_LINE_BUDGET)
      values.push(x0, y0, x1, y1, ...color);
  };
  lines(minX, maxX, step, (x) =>
    add(x, minY, x, maxY, colorAt(x, step, minor, major)),
  );
  lines(minY, maxY, step, (y) =>
    add(minX, y, maxX, y, colorAt(y, step, minor, major)),
  );
  return {
    step,
    buffer: new Float32Array(values),
    lineCount: values.length / 8,
  };
}
export function gridElevation(s: GridSurface, x: number, y: number) {
  return (
    s.elevation +
    ((s.endElevation ?? s.elevation) - s.elevation) *
      (s.rampAxis === "x" ? (x - s.x) / s.width : (y - s.y) / s.depth)
  );
}
function project(
  m: Float32Array,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
) {
  const d = m[3] * x + m[7] * z - m[11] * y + m[15];
  if (d <= 0) return undefined;
  return {
    x: (((m[0] * x + m[4] * z - m[8] * y + m[12]) / d) * w) / 2,
    y: (((m[1] * x + m[5] * z - m[9] * y + m[13]) / d) * h) / 2,
  };
}
export function spatialGrid(
  surfaces: readonly GridSurface[],
  m: Float32Array,
  width: number,
  height: number,
  base: number,
  minor: GridColor,
  major: GridColor,
  perspectiveFade = false,
) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    return { step: base, vertices: new Float32Array(), lineCount: 0 };
  const visible = surfaces.filter((s) => {
    const corners = [
      [s.x, s.y],
      [s.x + s.width, s.y],
      [s.x + s.width, s.y + s.depth],
      [s.x, s.y + s.depth],
    ];
    const p = corners
      .map(([x, y]) => project(m, x, y, gridElevation(s, x, y), width, height))
      .filter((p) => p !== undefined);
    return (
      p.length > 0 &&
      Math.min(...p.map((p) => p.x)) <= width / 2 &&
      Math.max(...p.map((p) => p.x)) >= -width / 2 &&
      Math.min(...p.map((p) => p.y)) <= height / 2 &&
      Math.max(...p.map((p) => p.y)) >= -height / 2
    );
  });
  let pixels = Infinity;
  for (const s of visible) {
    const x = s.x + s.width / 2,
      y = s.y + s.depth / 2,
      z = gridElevation(s, x, y),
      p = project(m, x, y, z, width, height);
    if (!p) continue;
    const q = project(m, x + base, y, gridElevation(s, x + base, y), width, height),
      r = project(m, x, y + base, gridElevation(s, x, y + base), width, height);
    if (q && r) {
      const ux = q.x - p.x, uy = q.y - p.y,
        vx = r.x - p.x, vy = r.y - p.y,
        area = Math.abs(ux * vy - uy * vx),
        length = Math.max(Math.hypot(ux, uy), Math.hypot(vx, vy));
      // Perpendicular line separation, rather than edge length: at low pitch the
      // two ground axes project almost parallel and otherwise produce moiré.
      if (length > 0 && area > 0) pixels = Math.min(pixels, area / length);
    }
  }
  const step = spacing(base, Number.isFinite(pixels) ? pixels : 12, (s) =>
    visible.reduce(
      (n, v) => n + count(v.x, v.x + v.width, s) + count(v.y, v.y + v.depth, s),
      0,
    ),
  );
  const values: number[] = [];
  const groups = new Map<string, {
    vertical: boolean; fixed: number; slope: number; intercept: number;
    color: GridColor; ranges: [number, number][];
  }>();
  const add = (
    s: GridSurface,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    c: GridColor,
  ) => {
    const vertical = x0 === x1, fixed = vertical ? x0 : y0,
      start = vertical ? y0 : x0, end = vertical ? y1 : x1;
    if (end <= start) return;
    const z0 = gridElevation(s, x0, y0),
      slope = (gridElevation(s, x1, y1) - z0) / (end - start),
      intercept = z0 - slope * start,
      key = [vertical, fixed, slope.toPrecision(12), intercept.toPrecision(12)].join(":");
    let group = groups.get(key);
    if (!group) {
      group = { vertical, fixed, slope, intercept, color: c, ranges: [] };
      groups.set(key, group);
    }
    group.ranges.push([start, end]);
  };
  for (const s of visible) {
    lines(s.x, s.x + s.width, step, (x) =>
      add(s, x, s.y, x, s.y + s.depth, colorAt(x, step, minor, major)),
    );
    lines(s.y, s.y + s.depth, step, (y) =>
      add(s, s.x, y, s.x + s.width, y, colorAt(y, step, minor, major)),
    );
  }
  const perspective = perspectiveFade &&
    Math.abs(m[3]) + Math.abs(m[7]) + Math.abs(m[11]) > 1e-8;
  let farW = 0;
  if (perspective) for (const s of visible) {
    for (const x of [s.x, s.x + s.width]) for (const y of [s.y, s.y + s.depth])
      farW = Math.max(farW, m[3] * x + m[7] * gridElevation(s, x, y) - m[11] * y + m[15]);
  }
  // Union collinear intervals, including partially overlapping terrain patches.
  // This keeps alpha constant along shared boundaries instead of drawing twice.
  for (const g of groups.values()) {
    g.ranges.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const range of g.ranges) {
      const last = merged[merged.length - 1];
      if (last && range[0] <= last[1] + 1e-7) last[1] = Math.max(last[1], range[1]);
      else merged.push([...range]);
    }
    for (const range of merged) {
      if (values.length / 22 >= GRID_LINE_BUDGET) break;
      for (const n of range) {
        const x = g.vertical ? g.fixed : n, y = g.vertical ? n : g.fixed,
          z = g.slope * n + g.intercept + 0.025,
          w = m[3] * x + m[7] * z - m[11] * y + m[15],
          fade = farW > 0 ? Math.max(0, Math.min(1, 1 - (w / farW) ** 2)) : 1;
        values.push(x, z, -y, 0, 0, g.color[0], g.color[1], g.color[2], g.color[3] * fade, 0, 0);
      }
    }
  }
  return {
    step,
    vertices: new Float32Array(values),
    lineCount: values.length / 22,
  };
}
