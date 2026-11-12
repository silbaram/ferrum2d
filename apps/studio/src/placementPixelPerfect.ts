import { rasterPixelDrawing, walkPixelLine, pixelRepeatDomain, repeatPixelPoint, PIXEL_REPEAT_DEFAULTS, type PixelRepeat, type PixelDrawMask, type PixelDrawSettings } from "./placementPixelDrawing";
import type { PixelRegion } from "./placementPixelDocument";

type Point = { x: number; y: number };
/** Bounded stroke: settled source pixels + two provisional points, never a growing point list. */
export function createPixelPerfectStroke(region: PixelRegion, from: Point, settings: PixelDrawSettings, clip?: PixelRegion, repeat: PixelRepeat = PIXEL_REPEAT_DEFAULTS) {
  region = { ...region }; settings = { ...settings }; clip = clip && { ...clip, ...(clip.mask ? { mask: clip.mask.slice() } : {}) };
  repeat = { ...repeat }; const domain = pixelRepeatDomain(region, repeat);
  rasterPixelDrawing("line", region, from, from, settings, clip); // Shared bounds/settings validation.
  if (settings.size !== 1) throw Error("Pixel perfect requires a 1px pencil");
  const settled = new Uint8Array(region.width * region.height), tail: Point[] = [];
  let last = { ...from };
  const index = (p: Point) => (p.y - region.y) * region.width + p.x - region.x;
  const inside = (p: Point) => p.x >= domain.x && p.y >= domain.y && p.x < domain.x + domain.width && p.y < domain.y + domain.height;
  function settleTail() {
    for (const raw of tail) { const point = repeatPixelPoint(region, raw.x, raw.y, repeat); if (point) settled[index(point)] = 1; }
    tail.length = 0;
  }
  function append(p: Point) {
    const b = tail.at(-1); if (b && b.x === p.x && b.y === p.y) return;
    const a = tail.at(-2);
    if (a && b && Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1 && Math.abs(p.x - b.x) + Math.abs(p.y - b.y) === 1 && a.x !== p.x && a.y !== p.y) tail.pop();
    else if (tail.length === 2) { const raw = tail.shift()!, point = repeatPixelPoint(region, raw.x, raw.y, repeat); if (point) settled[index(point)] = 1; }
    tail.push(p);
  }
  if (inside(from)) append(from);
  return {
    add(x: number, y: number): PixelDrawMask {
      if (![x, y].every(n => Number.isSafeInteger(n) && Math.abs(n) <= 1_048_576)) throw Error("Invalid stroke coordinates");
      // Clipped-out points are a path break, not a shortcut that can create an artificial corner on reentry.
      if (!inside(last)) settleTail();
      walkPixelLine(last.x, last.y, x, y, domain, (x, y) => append({ x, y })); last = { x, y };
      if (!inside(last)) settleTail();
      const source = settled.slice(), pixels = new Uint8Array(source.length);
      for (const raw of tail) { const point = repeatPixelPoint(region, raw.x, raw.y, repeat); if (point) source[index(point)] = 1; }
      const put = (x: number, y: number) => {
        if (clip && (x < clip.x || y < clip.y || x >= clip.x + clip.width || y >= clip.y + clip.height)) return;
        if (clip?.mask && !clip.mask[(y - clip.y) * clip.width + x - clip.x]) return;
        pixels[(y - region.y) * region.width + x - region.x] = 1;
      };
      for (let i = 0; i < source.length; i++) if (source[i]) {
        const px = region.x + i % region.width, py = region.y + Math.floor(i / region.width);
        const mx = 2 * region.x + region.width - 1 - px, my = 2 * region.y + region.height - 1 - py;
        put(px, py); if (settings.mirrorX) put(mx, py); if (settings.mirrorY) put(px, my); if (settings.mirrorX && settings.mirrorY) put(mx, my);
      }
      return { region: { ...region }, pixels };
    },
  };
}
