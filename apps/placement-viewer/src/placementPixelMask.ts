import { PIXEL_LIMITS, pixelRegionContains, type PixelRegion } from "./placementPixelDocument";
import { walkPixelLine } from "./placementPixelDrawing";

export type PixelSelectionOperation = "replace" | "add" | "subtract" | "intersect";
export type PixelSelectionShape = "rectangle" | "color" | "wand" | "lasso" | "polygon";
export interface PixelSelectionSettings { shape: PixelSelectionShape; operation: PixelSelectionOperation; tolerance: number; diagonal: boolean; }
export const PIXEL_SELECTION_DEFAULTS: Readonly<PixelSelectionSettings> = { shape: "rectangle", operation: "replace", tolerance: 0, diagonal: false };
export const PIXEL_SELECTION_PATH_LIMIT = 1024;
export function copyPixelArea(r?: PixelRegion): PixelRegion | undefined { return r && { ...r, ...(r.mask ? { mask: r.mask.slice() } : {}) }; }
export function checkPixelArea(r: PixelRegion) {
  if (![r.x, r.y, r.width, r.height].every(Number.isSafeInteger) || Math.abs(r.x) > 1_048_576 || Math.abs(r.y) > 1_048_576 ||
      r.width < 1 || r.height < 1 || r.width > PIXEL_LIMITS.side || r.height > PIXEL_LIMITS.side ||
      (r.mask !== undefined && (!(r.mask instanceof Uint8Array) || r.mask.length !== r.width * r.height || r.mask.some(v => v > 1)))) throw Error("Invalid pixel selection region");
}
export function trimPixelMask(domain: PixelRegion, bits: Uint8Array): PixelRegion | undefined {
  checkPixelArea(domain);
  if (!(bits instanceof Uint8Array) || bits.length !== domain.width * domain.height || bits.some(v => v > 1)) throw Error("Invalid pixel selection mask");
  let left = domain.width, top = domain.height, right = -1, bottom = -1;
  for (let i = 0; i < bits.length; i++) if (bits[i]) { const x = i % domain.width, y = Math.floor(i / domain.width); left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
  if (right < left) return;
  const width = right - left + 1, height = bottom - top + 1, mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) mask.set(bits.subarray((y + top) * domain.width + left, (y + top) * domain.width + left + width), y * width);
  return { x: domain.x + left, y: domain.y + top, width, height, ...(mask.every(v => v === 1) ? {} : { mask }) };
}
export function clipPixelArea(area: PixelRegion, domain: PixelRegion): PixelRegion | undefined {
  checkPixelArea(area); checkPixelArea(domain);
  const x = Math.max(area.x, domain.x), y = Math.max(area.y, domain.y), width = Math.min(area.x + area.width, domain.x + domain.width) - x, height = Math.min(area.y + area.height, domain.y + domain.height) - y;
  if (width <= 0 || height <= 0) return;
  if (!area.mask && !domain.mask) return { x, y, width, height };
  const rect = { x, y, width, height }, bits = new Uint8Array(width * height);
  for (let i = 0; i < bits.length; i++) { const px = x + i % width, py = y + Math.floor(i / width); bits[i] = Number(pixelRegionContains(area, px, py) && pixelRegionContains(domain, px, py)); }
  return trimPixelMask(rect, bits);
}
export function combinePixelAreas(a: PixelRegion | undefined, b: PixelRegion | undefined, operation: PixelSelectionOperation, domain: PixelRegion) {
  if (!["replace", "add", "subtract", "intersect"].includes(operation)) throw Error("Invalid selection operation");
  checkPixelArea(domain); if (a) checkPixelArea(a); if (b) checkPixelArea(b);
  const bits = new Uint8Array(domain.width * domain.height);
  for (let i = 0; i < bits.length; i++) {
    const x = domain.x + i % domain.width, y = domain.y + Math.floor(i / domain.width), pa = !!a && pixelRegionContains(a, x, y), pb = !!b && pixelRegionContains(b, x, y);
    bits[i] = Number(operation === "replace" ? pb : operation === "add" ? pa || pb : operation === "subtract" ? pa && !pb : pa && pb);
  }
  return trimPixelMask(domain, bits);
}
export function colorPixelArea(pixels: Uint8Array, width: number, height: number, domain: PixelRegion, x: number, y: number, tolerance = 0, connected = true, diagonal = false) {
  checkPixelArea(domain);
  if (![width, height].every(n => Number.isInteger(n) && n > 0 && n <= PIXEL_LIMITS.side) || !(pixels instanceof Uint8Array) || pixels.length !== width * height * 4 ||
      domain.x < 0 || domain.y < 0 || domain.x + domain.width > width || domain.y + domain.height > height ||
      !Number.isInteger(tolerance) || tolerance < 0 || tolerance > 255 || typeof connected !== "boolean" || typeof diagonal !== "boolean" || !Number.isSafeInteger(x) || !Number.isSafeInteger(y)) throw Error("Invalid color selection");
  if (!pixelRegionContains(domain, x, y)) return;
  const target = pixels.subarray((y * width + x) * 4, (y * width + x + 1) * 4), bits = new Uint8Array(domain.width * domain.height);
  const matches = (px: number, py: number) => pixelRegionContains(domain, px, py) && target.every((v, c) => Math.abs(v - pixels[(py * width + px) * 4 + c]) <= tolerance);
  if (!connected) for (let i = 0; i < bits.length; i++) bits[i] = Number(matches(domain.x + i % domain.width, domain.y + Math.floor(i / domain.width)));
  else {
    const queue = new Uint32Array(bits.length), visited = new Uint8Array(bits.length); let head = 0, tail = 0;
    const add = (px: number, py: number) => {
      if (!pixelRegionContains(domain, px, py)) return;
      const i = (py - domain.y) * domain.width + px - domain.x; if (visited[i]) return; visited[i] = 1;
      if (matches(px, py)) { bits[i] = 1; queue[tail++] = i; }
    };
    add(x, y);
    while (head < tail) { const i = queue[head++], px = domain.x + i % domain.width, py = domain.y + Math.floor(i / domain.width);
      add(px - 1, py); add(px + 1, py); add(px, py - 1); add(px, py + 1);
      if (diagonal) { add(px - 1, py - 1); add(px + 1, py - 1); add(px - 1, py + 1); add(px + 1, py + 1); }
    }
  }
  return trimPixelMask(domain, bits);
}
export function polygonPixelArea(domain: PixelRegion, points: readonly { x: number; y: number }[]) {
  checkPixelArea(domain);
  if (points.length > PIXEL_SELECTION_PATH_LIMIT) throw Error("Selection path limit reached");
  if (points.some(p => ![p.x, p.y].every(n => Number.isSafeInteger(n) && Math.abs(n) <= 1_048_576))) throw Error("Invalid selection path");
  if (!points.length) return;
  const bits = new Uint8Array(domain.width * domain.height), put = (x: number, y: number) => { if (pixelRegionContains(domain, x, y)) bits[(y - domain.y) * domain.width + x - domain.x] = 1; };
  if (points.length === 1) put(points[0].x, points[0].y);
  else {
    for (let y = domain.y; y < domain.y + domain.height; y++) {
      const crossings: number[] = [];
      for (let i = 0; i < points.length; i++) { const a = points[i], b = points[(i + 1) % points.length]; if ((a.y > y) !== (b.y > y)) crossings.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y)); }
      crossings.sort((a, b) => a - b);
      for (let i = 0; i + 1 < crossings.length; i += 2) for (let x = Math.max(domain.x, Math.ceil(crossings[i])); x <= Math.min(domain.x + domain.width - 1, Math.floor(crossings[i + 1])); x++) put(x, y);
    }
    for (let i = 0; i < points.length; i++) { const a = points[i], b = points[(i + 1) % points.length]; walkPixelLine(a.x, a.y, b.x, b.y, domain, put); }
  }
  return trimPixelMask(domain, bits);
}
