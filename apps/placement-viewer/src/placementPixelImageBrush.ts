import { pixelRegionContains, type PixelBlock, type PixelRegion } from "./placementPixelDocument";
import { checkPixelArea } from "./placementPixelMask";
import { walkPixelLine, pixelRepeatDomain, repeatPixelPoint, PIXEL_REPEAT_DEFAULTS, type PixelRepeat } from "./placementPixelDrawing";

export const PIXEL_IMAGE_BRUSH_LIMITS = { side: 32, slots: 8, bytes: 64 * 1024, spacing: 32 } as const;
export interface PixelImageBrush extends PixelBlock { id: string; mask: Uint8Array; anchorX: number; anchorY: number; spacing: number; }
function valid(brush: PixelImageBrush) {
  if (![brush.width, brush.height].every(v => Number.isInteger(v) && v >= 1 && v <= PIXEL_IMAGE_BRUSH_LIMITS.side) ||
      !(brush.pixels instanceof Uint8Array) || brush.pixels.length !== brush.width * brush.height * 4 || !(brush.mask instanceof Uint8Array) || brush.mask.length !== brush.width * brush.height || brush.mask.some(v => v > 1) ||
      !Number.isInteger(brush.anchorX) || brush.anchorX < 0 || brush.anchorX >= brush.width || !Number.isInteger(brush.anchorY) || brush.anchorY < 0 || brush.anchorY >= brush.height ||
      !Number.isInteger(brush.spacing) || brush.spacing < 1 || brush.spacing > PIXEL_IMAGE_BRUSH_LIMITS.spacing) throw Error("Invalid image brush");
}
export function createPixelBrushLibrary() {
  const entries: PixelImageBrush[] = []; let serial = 0;
  return {
    capture(block: PixelBlock) {
      if (![block.width, block.height].every(v => Number.isInteger(v) && v >= 1 && v <= PIXEL_IMAGE_BRUSH_LIMITS.side) || !(block.pixels instanceof Uint8Array) || block.pixels.length !== block.width * block.height * 4) throw Error("Invalid image brush");
      const mask = block.mask?.slice() ?? new Uint8Array(block.width * block.height).fill(1);
      const brush: PixelImageBrush = { ...block, id: "brush-" + (serial + 1), pixels: block.pixels.slice(), mask, anchorX: Math.floor((block.width - 1) / 2), anchorY: Math.floor((block.height - 1) / 2), spacing: 1 };
      valid(brush);
      if (entries.length >= PIXEL_IMAGE_BRUSH_LIMITS.slots || entries.reduce((n, b) => n + b.pixels.byteLength + b.mask.byteLength, 0) + brush.pixels.byteLength + mask.byteLength > PIXEL_IMAGE_BRUSH_LIMITS.bytes) throw Error("Image brush library is full");
      if (!mask.some((v, i) => v && brush.pixels[i * 4 + 3] > 0)) throw Error("Brush has no visible pixels");
      serial++; entries.push(brush); return brush.id;
    },
    entries: () => entries.map(({ id, width, height }) => ({ id, width, height })),
    snapshot(id: string, anchorX?: number, anchorY?: number, spacing?: number) {
      const source = entries.find(b => b.id === id); if (!source) throw Error("Image brush not found");
      const brush = { ...source, pixels: source.pixels.slice(), mask: source.mask.slice(), anchorX: anchorX ?? source.anchorX, anchorY: anchorY ?? source.anchorY, spacing: spacing ?? source.spacing }; valid(brush); return brush;
    },
    remove(id: string) { const i = entries.findIndex(b => b.id === id); if (i < 0) throw Error("Image brush not found"); entries.splice(i, 1); },
    clear() { entries.length = 0; serial = 0; },
  };
}
/** Immutable source brush, bounded accumulated write mask. Overlaps use the last stamp's raw RGBA. */
export function createPixelImageBrushStroke(region: PixelRegion, from: { x: number; y: number }, input: PixelImageBrush,
  clip?: PixelRegion, mirrorX = false, mirrorY = false, repeat: PixelRepeat = PIXEL_REPEAT_DEFAULTS) {
  checkPixelArea(region); if (clip) checkPixelArea(clip); valid(input);
  repeat = { ...repeat }; const domain = pixelRepeatDomain(region, repeat);
  if (typeof mirrorX !== "boolean" || typeof mirrorY !== "boolean") throw Error("Invalid image brush");
  const brush = { ...input, pixels: input.pixels.slice(), mask: input.mask.slice() }, area = { ...region, ...(region.mask ? { mask: region.mask.slice() } : {}) }, selection = clip && { ...clip, ...(clip.mask ? { mask: clip.mask.slice() } : {}) };
  const pixels = new Uint8Array(area.width * area.height * 4), mask = new Uint8Array(area.width * area.height);
  const checkPoint = (x: number, y: number) => { if (![x, y].every(v => Number.isSafeInteger(v) && Math.abs(v) <= 1_048_576)) throw Error("Invalid stroke coordinates"); };
  let last = { ...from }, rasterLast = { ...from }, distance = 0;
  function stamp(x: number, y: number) {
    const put = (px: number, py: number, offset: number) => {
      const p = repeatPixelPoint(area, px, py, repeat); if (!p || (selection && !pixelRegionContains(selection, p.x, p.y))) return;
      const i = (p.y - area.y) * area.width + p.x - area.x; mask[i] = 1; pixels.set(brush.pixels.subarray(offset, offset + 4), i * 4);
    };
    for (let by = 0; by < brush.height; by++) for (let bx = 0; bx < brush.width; bx++) {
      const i = by * brush.width + bx; if (!brush.mask[i] || !brush.pixels[i * 4 + 3]) continue;
      const px = x - brush.anchorX + bx, py = y - brush.anchorY + by, mx = 2 * area.x + area.width - 1 - px, my = 2 * area.y + area.height - 1 - py;
      put(px, py, i * 4); if (mirrorX) put(mx, py, i * 4); if (mirrorY) put(px, my, i * 4); if (mirrorX && mirrorY) put(mx, my, i * 4);
    }
  }
  checkPoint(from.x, from.y); stamp(from.x, from.y);
  const expanded = { x: domain.x - (repeat.x ? 0 : brush.width), y: domain.y - (repeat.y ? 0 : brush.height), width: domain.width + (repeat.x ? 0 : 2 * brush.width), height: domain.height + (repeat.y ? 0 : 2 * brush.height) };
  return {
    add(x: number, y: number, finish = false) {
      checkPoint(x, y);
      walkPixelLine(last.x, last.y, x, y, expanded, (px, py) => {
        if (px === rasterLast.x && py === rasterLast.y) return;
        rasterLast = { x: px, y: py }; if (++distance >= brush.spacing) { stamp(px, py); distance = 0; }
      });
      last = { x, y }; if (finish && ((!repeat.x && !repeat.y) || (x >= expanded.x && y >= expanded.y && x < expanded.x + expanded.width && y < expanded.y + expanded.height))) stamp(x, y);
      return { region: { ...area, mask: mask.slice() }, pixels: pixels.slice() };
    },
  };
}
