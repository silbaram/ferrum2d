import { pixelPaletteColors } from "./placementPixelDocument";

export const PIXEL_PALETTE_BYTES = 16 * 1024;
export function readPixelPalette(input: string): string[] {
  if (new TextEncoder().encode(input).length > PIXEL_PALETTE_BYTES) throw Error("Palette file exceeds 16 KiB");
  let value: unknown;
  try { value = JSON.parse(input); } catch { throw Error("Invalid pixel palette file"); }
  if (!value || typeof value !== "object" || !("format" in value) || value.format !== "ferrum2d.pixel-palette" ||
      !("version" in value) || value.version !== 1 || !("colors" in value)) throw Error("Invalid pixel palette file");
  return pixelPaletteColors(value.colors);
}
export function exportPixelPalette(colors: readonly string[]): string {
  return JSON.stringify({ format: "ferrum2d.pixel-palette", version: 1, colors: pixelPaletteColors(colors) }, null, 2) + "\n";
}
