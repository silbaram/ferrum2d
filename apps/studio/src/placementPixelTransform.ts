import { PIXEL_LIMITS, type PixelBlock } from "./placementPixelDocument";

export interface PixelTransform {
  angle: number;
  scaleX: number;
  scaleY: number;
  sampling: "nearest" | "linear";
}

/** Inverse mapping from destination pixel centers. All allocations are bounded by the existing selection limit. */
export function transformPixelBlock(source: PixelBlock, transform: PixelTransform): PixelBlock {
  const { angle, scaleX, scaleY, sampling } = transform;
  if (!Number.isFinite(angle) || Math.abs(angle) > 360 ||
      ![scaleX, scaleY].every(value => Number.isFinite(value) && value >= 0.01 && value <= 16) ||
      (sampling !== "nearest" && sampling !== "linear")) throw Error("Invalid pixel transform settings");
  if (![source.width, source.height].every(value => Number.isInteger(value) && value >= 1 && value <= PIXEL_LIMITS.side) ||
      !(source.pixels instanceof Uint8Array) || source.pixels.length !== source.width * source.height * 4 ||
      (source.mask !== undefined && (!(source.mask instanceof Uint8Array) || source.mask.length !== source.width * source.height || source.mask.some(value => value > 1))))
    throw Error("Invalid pixel selection bytes");
  const scaledWidth = Math.max(1, Math.round(source.width * scaleX)), scaledHeight = Math.max(1, Math.round(source.height * scaleY));
  const radians = angle * Math.PI / 180;
  // Snap cardinal rotations to exact coefficients so +/-90 and360 cannot add a stray row or column.
  const snap = (value: number) => Math.abs(value) < 1e-12 ? 0 : Math.abs(Math.abs(value) - 1) < 1e-12 ? Math.sign(value) : value;
  const cos = snap(Math.cos(radians)), sin = snap(Math.sin(radians));
  const width = Math.ceil(Math.abs(scaledWidth * cos) + Math.abs(scaledHeight * sin));
  const height = Math.ceil(Math.abs(scaledWidth * sin) + Math.abs(scaledHeight * cos));
  if (width > PIXEL_LIMITS.side || height > PIXEL_LIMITS.side) throw Error("Transformed selection exceeds 256 pixels. Reduce the scale.");
  const pixels = new Uint8Array(width * height * 4), mask = new Uint8Array(width * height);
  const premultiplied = [0, 0, 0], transparent = [0, 0, 0];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = x + 0.5 - width / 2, dy = y + 0.5 - height / 2;
    const sx = (dx * cos + dy * sin) * source.width / scaledWidth + source.width / 2 - 0.5;
    const sy = (-dx * sin + dy * cos) * source.height / scaledHeight + source.height / 2 - 0.5;
    if (sx < -0.5 || sy < -0.5 || sx >= source.width - 0.5 || sy >= source.height - 0.5) continue;
    const index = y * width + x, offset = index * 4;
    if (sampling === "nearest") {
      const from = Math.floor(sy + 0.5) * source.width + Math.floor(sx + 0.5);
      if (source.mask && !source.mask[from]) continue;
      mask[index] = 1; pixels.set(source.pixels.subarray(from * 4, from * 4 + 4), offset);
      continue;
    }
    const left = Math.floor(sx), top = Math.floor(sy), tx = sx - left, ty = sy - top;
    let coverage = 0, alpha = 0;
    premultiplied.fill(0); transparent.fill(0);
    for (let iy = 0; iy < 2; iy++) for (let ix = 0; ix < 2; ix++) {
      const weight = (ix ? tx : 1 - tx) * (iy ? ty : 1 - ty);
      if (!weight) continue;
      const from = Math.max(0, Math.min(source.height - 1, top + iy)) * source.width + Math.max(0, Math.min(source.width - 1, left + ix));
      if (source.mask && !source.mask[from]) continue;
      const a = source.pixels[from * 4 + 3]; coverage += weight; alpha += weight * a;
      for (let c = 0; c < 3; c++) {
        premultiplied[c] += weight * a * source.pixels[from * 4 + c];
        transparent[c] += weight * source.pixels[from * 4 + c];
      }
    }
    if (!coverage) continue;
    mask[index] = 1; pixels[offset + 3] = Math.round(alpha);
    // Interpolate premultiplied colors to avoid dark fringes; retain raw RGB when all contributors are transparent.
    for (let c = 0; c < 3; c++) pixels[offset + c] = Math.round(alpha ? premultiplied[c] / alpha : transparent[c] / coverage);
  }
  return { width, height, pixels, ...(mask.every(value => value === 1) ? {} : { mask }) };
}
