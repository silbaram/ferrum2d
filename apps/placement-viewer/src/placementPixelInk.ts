import { pixelHex, pixelRegionContains, PIXEL_LIMITS, type PixelColor, type PixelRegion } from "./placementPixelDocument";
import type { PixelDrawMask } from "./placementPixelDrawing";

export type PixelGradientMode = "colors" | "dither" | "palette";
export interface PixelInkSettings { secondary: PixelColor; density: number; gradient: PixelGradientMode; }
export const PIXEL_INK_DEFAULTS: Readonly<PixelInkSettings> = { secondary: [0, 0, 0, 255], density: 8, gradient: "dither" };
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
type Point = { x: number; y: number };
type Mirror = { mirrorX: boolean; mirrorY: boolean };
export function pixelInkSettings(value: PixelInkSettings): PixelInkSettings {
  pixelHex(value.secondary);
  if (!Number.isInteger(value.density) || value.density < 0 || value.density > 16 || !["colors", "dither", "palette"].includes(value.gradient)) throw Error("Invalid color tool settings");
  return { ...value, secondary: [...value.secondary] };
}
function validRegion(r: PixelRegion): void {
  if (![r.x, r.y, r.width, r.height].every(Number.isSafeInteger) || r.x < 0 || r.y < 0 || r.width < 1 || r.height < 1 ||
      r.x + r.width > PIXEL_LIMITS.atlasSide || r.y + r.height > PIXEL_LIMITS.atlasSide ||
      (r.mask !== undefined && (!(r.mask instanceof Uint8Array) || r.mask.length !== r.width * r.height || r.mask.some(n => n > 1)))) throw Error("Invalid color tool region");
}
function mirrorPoint(x: number, y: number, r: PixelRegion, mirror: Mirror, from: Point): Point {
  const oppositeX = 2 * r.x + r.width - 1 - x, oppositeY = 2 * r.y + r.height - 1 - y;
  return {
    x: mirror.mirrorX ? (from.x < r.x + r.width / 2 ? Math.min(x, oppositeX) : Math.max(x, oppositeX)) : x,
    y: mirror.mirrorY ? (from.y < r.y + r.height / 2 ? Math.min(y, oppositeY) : Math.max(y, oppositeY)) : y,
  };
}
function rank(x: number, y: number, r: PixelRegion): number { return BAYER[((y - r.y) % 4) * 4 + (x - r.x) % 4]; }

/** The footprint is already clipped/mirrored by the normal brush rasterizer. */
export function ditherPixelPaint(mask: PixelDrawMask, color: PixelColor, ink: PixelInkSettings, mirror: Mirror) {
  const r = mask.region; validRegion(r); pixelHex(color); const settings = pixelInkSettings(ink);
  if (!(mask.pixels instanceof Uint8Array) || mask.pixels.length !== r.width * r.height || mask.pixels.some(n => n > 1)) throw Error("Invalid color tool region");
  const pixels = new Uint8Array(r.width * r.height * 4);
  for (let y = r.y; y < r.y + r.height; y++) for (let x = r.x; x < r.x + r.width; x++) {
    const i = (y - r.y) * r.width + x - r.x;
    if (!mask.pixels[i]) continue;
    const p = mirrorPoint(x, y, r, mirror, r);
    pixels.set(rank(p.x, p.y, r) < settings.density ? settings.secondary : color, i * 4);
  }
  return { region: { ...r, mask: mask.pixels.slice() }, pixels };
}

/** Drag defines the projection; the selected cel region is filled only on commit. */
export function gradientPixelPaint(r: PixelRegion, from: Point, to: Point, color: PixelColor, ink: PixelInkSettings,
  palette: readonly PixelColor[], clip?: PixelRegion, mirror: Mirror = { mirrorX: false, mirrorY: false }) {
  validRegion(r); if (clip) validRegion(clip); pixelHex(color); const settings = pixelInkSettings(ink);
  if (![from.x, from.y, to.x, to.y].every(n => Number.isSafeInteger(n) && Math.abs(n) <= 1_048_576)) throw Error("Invalid color tool region");
  if (settings.gradient === "palette") {
    if (palette.length < 2 || palette.length > 256) throw Error("Gradient requires at least two palette colors");
    for (const entry of palette) pixelHex(entry);
  }
  const pixels = new Uint8Array(r.width * r.height * 4), mask = new Uint8Array(r.width * r.height);
  const dx = to.x - from.x, dy = to.y - from.y, length = dx * dx + dy * dy;
  for (let y = r.y; y < r.y + r.height; y++) for (let x = r.x; x < r.x + r.width; x++) {
    if (!pixelRegionContains(r, x, y) || (clip && !pixelRegionContains(clip, x, y))) continue;
    const p = mirrorPoint(x, y, r, mirror, from);
    const t = length ? Math.max(0, Math.min(1, ((p.x - from.x) * dx + (p.y - from.y) * dy) / length)) : 0;
    const value = settings.gradient === "palette" ? palette[Math.round(t * (palette.length - 1))]
      : settings.gradient === "dither" ? ((rank(p.x, p.y, r) + 0.5) / 16 < t ? settings.secondary : color)
      : color.map((v, c) => Math.round(v + (settings.secondary[c] - v) * t));
    const i = (y - r.y) * r.width + x - r.x; mask[i] = 1; pixels.set(value, i * 4);
  }
  return { region: { ...r, mask }, pixels };
}
