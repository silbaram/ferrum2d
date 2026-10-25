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
  if (Math.abs(n) < step * 1e-7) return [major[0], major[1], major[2], 1];
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
) {
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
    for (const q of [
      project(m, x + base, y, gridElevation(s, x + base, y), width, height),
      project(m, x, y + base, gridElevation(s, x, y + base), width, height),
    ])
      if (q) {
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d > 0.1) pixels = Math.min(pixels, d);
      }
  }
  const step = spacing(base, Number.isFinite(pixels) ? pixels : 12, (s) =>
    visible.reduce(
      (n, v) => n + count(v.x, v.x + v.width, s) + count(v.y, v.y + v.depth, s),
      0,
    ),
  );
  const values: number[] = [];
  const vertex = (s: GridSurface, x: number, y: number, c: GridColor) =>
    values.push(x, gridElevation(s, x, y) + 0.025, -y, 0, 0, ...c, 0, 0);
  const add = (
    s: GridSurface,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    c: GridColor,
  ) => {
    if (values.length / 22 >= GRID_LINE_BUDGET) return;
    vertex(s, x0, y0, c);
    vertex(s, x1, y1, c);
  };
  for (const s of visible) {
    lines(s.x, s.x + s.width, step, (x) =>
      add(s, x, s.y, x, s.y + s.depth, colorAt(x, step, minor, major)),
    );
    lines(s.y, s.y + s.depth, step, (y) =>
      add(s, s.x, y, s.x + s.width, y, colorAt(y, step, minor, major)),
    );
  }
  return {
    step,
    vertices: new Float32Array(values),
    lineCount: values.length / 22,
  };
}
