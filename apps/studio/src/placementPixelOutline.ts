import { PIXEL_LIMITS, pixelRegionContains, type PixelRegion } from "./placementPixelDocument";
import type { PixelDrawMask } from "./placementPixelDrawing";
import { checkPixelArea } from "./placementPixelMask";

/** One-pixel silhouette operation; reads the immutable cel, writes only an eligible mask. */
export function pixelOutlineMask(pixels: Uint8Array, width: number, height: number, region: PixelRegion, selection: PixelRegion | undefined, place: "inside" | "outside", diagonal: boolean) {
  checkPixelArea(region); if (selection) checkPixelArea(selection);
  if (![width, height].every(v => Number.isInteger(v) && v > 0 && v <= PIXEL_LIMITS.side) || !(pixels instanceof Uint8Array) || pixels.length !== width * height * 4 ||
      region.x < 0 || region.y < 0 || region.x + region.width > width || region.y + region.height > height || !["inside", "outside"].includes(place) || typeof diagonal !== "boolean") throw Error("Invalid outline settings");
  const offsets = [[-1, 0], [1, 0], [0, -1], [0, 1], ...(diagonal ? [[-1, -1], [1, -1], [-1, 1], [1, 1]] : [])];
  const mask: PixelDrawMask = { region: { ...region }, pixels: new Uint8Array(region.width * region.height) };
  const opaque = (x: number, y: number) => pixelRegionContains(region, x, y) && pixels[(y * width + x) * 4 + 3] > 0;
  let count = 0, clipped = false;
  for (let y = region.y; y < region.y + region.height; y++) for (let x = region.x; x < region.x + region.width; x++) {
    const inside = opaque(x, y);
    if (inside && place === "outside" && (!selection || pixelRegionContains(selection, x, y)) && offsets.some(([dx, dy]) => !pixelRegionContains(region, x + dx, y + dy))) clipped = true;
    if ((selection && !pixelRegionContains(selection, x, y)) || (place === "outside" ? inside : !inside)) continue;
    if (offsets.some(([dx, dy]) => place === "outside" ? opaque(x + dx, y + dy) : !opaque(x + dx, y + dy))) { mask.pixels[(y - region.y) * region.width + x - region.x] = 1; count++; }
  }
  return { mask, count, clipped };
}
