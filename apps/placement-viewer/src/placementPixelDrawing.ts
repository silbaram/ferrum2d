import { PIXEL_LIMITS, type PixelRegion } from "./placementPixelDocument";

export type PixelShape = "line" | "rectangle" | "ellipse";
export interface PixelDrawSettings { size: number; mirrorX: boolean; mirrorY: boolean; filled: boolean; }
export interface PixelDrawMask { region: PixelRegion; pixels: Uint8Array; }
export const PIXEL_DRAW_DEFAULTS: Readonly<PixelDrawSettings> = { size: 1, mirrorX: false, mirrorY: false, filled: false };
export const PIXEL_BRUSH_MAX = 32;
export function pixelDrawSettings(value: PixelDrawSettings): PixelDrawSettings {
  if (!Number.isInteger(value.size) || value.size < 1 || value.size > PIXEL_BRUSH_MAX ||
      [value.mirrorX, value.mirrorY, value.filled].some(flag => typeof flag !== "boolean")) throw Error("Invalid pixel drawing settings");
  return { ...value };
}
function validRect(r: PixelRegion) {
  if (![r.x, r.y, r.width, r.height].every(Number.isSafeInteger) || Math.abs(r.x) > 1_048_576 || Math.abs(r.y) > 1_048_576 ||
      r.width < 1 || r.height < 1 || r.width > PIXEL_LIMITS.side || r.height > PIXEL_LIMITS.side) throw Error("Invalid pixel drawing region");
}
/** Clipping matches the original 1px stroke, before the bounded Bresenham walk. */
function line(x0: number, y0: number, x1: number, y1: number, r: PixelRegion, put: (x: number, y: number) => void) {
  const dx = x1 - x0, dy = y1 - y0;
  let low = 0, high = 1;
  for (const [p, q] of [[-dx, x0 - r.x], [dx, r.x + r.width - 1 - x0], [-dy, y0 - r.y], [dy, r.y + r.height - 1 - y0]]) {
    if (p === 0) { if (q < 0) return; continue; }
    if (p < 0) low = Math.max(low, q / p); else high = Math.min(high, q / p);
    if (low > high) return;
  }
  let x = Math.round(x0 + dx * low), y = Math.round(y0 + dy * low);
  const endX = Math.round(x0 + dx * high), endY = Math.round(y0 + dy * high);
  const ax = Math.abs(endX - x), ay = -Math.abs(endY - y), sx = x < endX ? 1 : -1, sy = y < endY ? 1 : -1;
  let error = ax + ay;
  for (;;) {
    put(x, y); if (x === endX && y === endY) break;
    const twice = error * 2;
    if (twice >= ay) { error += ay; x += sx; }
    if (twice <= ax) { error += ax; y += sy; }
  }
}
/** Integer, unblended mask. Work is bounded by frame/brush size, never pointer distance. */
export function rasterPixelDrawing(kind: PixelShape, region: PixelRegion, from: { x: number; y: number }, to: { x: number; y: number },
  settings: PixelDrawSettings = PIXEL_DRAW_DEFAULTS, clip?: PixelRegion, square = false): PixelDrawMask {
  validRect(region); if (clip) validRect(clip);
  if (region.x < 0 || region.y < 0 || region.x + region.width > PIXEL_LIMITS.side || region.y + region.height > PIXEL_LIMITS.side)
    throw Error("Invalid pixel drawing region");
  if (![from.x, from.y, to.x, to.y].every(n => Number.isSafeInteger(n) && Math.abs(n) <= 1_048_576)) throw Error("Invalid stroke coordinates");
  if (!["line", "rectangle", "ellipse"].includes(kind)) throw Error("Invalid pixel shape");
  const options = pixelDrawSettings(settings), pixels = new Uint8Array(region.width * region.height);
  const put = (x: number, y: number) => {
    if (x < region.x || y < region.y || x >= region.x + region.width || y >= region.y + region.height ||
        (clip && (x < clip.x || y < clip.y || x >= clip.x + clip.width || y >= clip.y + clip.height))) return;
    pixels[(y - region.y) * region.width + x - region.x] = 1;
  };
  const mirrored = (x: number, y: number) => {
    const mx = 2 * region.x + region.width - 1 - x, my = 2 * region.y + region.height - 1 - y;
    put(x, y); if (options.mirrorX) put(mx, y); if (options.mirrorY) put(x, my); if (options.mirrorX && options.mirrorY) put(mx, my);
  };
  const before = Math.floor((options.size - 1) / 2), after = options.size - 1 - before;
  const stamp = (x: number, y: number) => {
    for (let py = y - before; py <= y + after; py++) for (let px = x - before; px <= x + after; px++) mirrored(px, py);
  };
  const expanded = { x: region.x - after, y: region.y - after, width: region.width + before + after, height: region.height + before + after };
  if (kind === "line") line(from.x, from.y, to.x, to.y, expanded, stamp);
  else {
    const length = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
    const end = square ? { x: from.x + (Math.sign(to.x - from.x) || 1) * length, y: from.y + (Math.sign(to.y - from.y) || 1) * length } : to;
    const left = Math.min(from.x, end.x), top = Math.min(from.y, end.y), right = Math.max(from.x, end.x), bottom = Math.max(from.y, end.y);
    if (kind === "rectangle" && !options.filled) {
      line(left, top, right, top, expanded, stamp); line(right, top, right, bottom, expanded, stamp);
      line(right, bottom, left, bottom, expanded, stamp); line(left, bottom, left, top, expanded, stamp);
    } else {
      const box = options.filled ? region : expanded;
      const cx = (left + right) / 2, cy = (top + bottom) / 2, rx = (right - left + 1) / 2, ry = (bottom - top + 1) / 2;
      const inside = (x: number, y: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
      for (let y = Math.max(top, box.y); y <= Math.min(bottom, box.y + box.height - 1); y++)
        for (let x = Math.max(left, box.x); x <= Math.min(right, box.x + box.width - 1); x++) {
          if (kind === "ellipse" && !inside(x, y)) continue;
          if (options.filled) mirrored(x, y);
          else if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) stamp(x, y);
        }
    }
  }
  return { region: { ...region }, pixels };
}
