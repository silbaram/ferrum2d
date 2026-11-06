import type { PixelMaskTerrainTextureUploadOptions } from "./pixelMaskTerrain.js";

/** Shared CPU bytes; each renderer owns its upload format and row alignment. */
export function rgbaFromAlpha(
  width: number,
  height: number,
  alpha: Uint8Array,
  options: PixelMaskTerrainTextureUploadOptions = {},
): Uint8Array {
  if (alpha.length !== width * height) {
    throw new Error("pixel mask terrain alpha length must equal width * height.");
  }
  const [rawR, rawG, rawB] = options.color ?? [255, 255, 255];
  const r = colorByte(rawR, "pixelMaskTerrain.texture.color[0]");
  const g = colorByte(rawG, "pixelMaskTerrain.texture.color[1]");
  const b = colorByte(rawB, "pixelMaskTerrain.texture.color[2]");
  const alphaScale = finitePositiveNumber(options.alphaScale ?? 1, "pixelMaskTerrain.texture.alphaScale");
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < alpha.length; index += 1) {
    const offset = index * 4;
    rgba[offset] = r;
    rgba[offset + 1] = g;
    rgba[offset + 2] = b;
    rgba[offset + 3] = Math.min(255, Math.round(alpha[index] * alphaScale));
  }
  return rgba;
}

function colorByte(value: number, path: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 255) {
    throw new Error(`${path} must be between 0 and 255.`);
  }
  return Math.round(value);
}

function finitePositiveNumber(value: number, path: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${path} must be a non-negative finite number.`);
  }
  return value;
}
