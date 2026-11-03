import { pixelPaletteColors } from "./placementPixelDocument";

export const PIXEL_PALETTE_BYTES = 16 * 1024;
/** Import formats share the document's bounded, ordered RGBA palette. Export stays lossless JSON. */
export function readPixelPalette(input: string, filename = ""): string[] {
  if (new TextEncoder().encode(input).length > PIXEL_PALETTE_BYTES) throw Error("Palette file exceeds 16 KiB");
  const text = input.replace(/^\uFEFF/, "");
  const extension = filename.toLowerCase().split(".").at(-1);
  if (extension === "gpl" || (!filename && text.startsWith("GIMP Palette"))) return readGplPalette(text);
  if (extension === "hex") return readHexPalette(text);
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw Error("Invalid pixel palette file"); }
  if (!value || typeof value !== "object" || !("format" in value) || value.format !== "ferrum2d.pixel-palette" ||
      !("version" in value) || value.version !== 1 || !("colors" in value)) throw Error("Invalid pixel palette file");
  return pixelPaletteColors(value.colors);
}

// GPL v1/v2: https://developer.gimp.org/core/standards/gpl/ . Names/columns are presentation metadata.
function readGplPalette(input: string): string[] {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  const invalid = () => { throw Error("Invalid GPL palette"); };
  if (lines[0] !== "GIMP Palette") return invalid();
  let start = 1;
  if (lines[start]?.startsWith("Name:")) {
    start++;
    if (lines[start]?.startsWith("Columns:")) {
      const columns = lines[start++].slice(8).trim();
      if (!/^\d+$/.test(columns) || Number(columns) > 255) return invalid();
    }
  }
  const colors: string[] = [];
  for (const row of lines.slice(start)) {
    const line = row.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(\d+)\s+(\d+)\s+(\d+)(?:\s+.*)?$/.exec(line);
    if (!match) return invalid();
    const rgb = match.slice(1, 4).map(Number);
    if (rgb.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return invalid();
    colors.push("#" + rgb.map(value => value.toString(16).padStart(2, "0")).join("") + "ff");
  }
  if (!colors.length) return invalid();
  return pixelPaletteColors(colors);
}

/** One RGB or RGBA hex value per line; optional #, blank lines and // comments. */
function readHexPalette(input: string): string[] {
  const colors: string[] = [];
  for (const row of input.replace(/\r\n?/g, "\n").split("\n")) {
    const line = row.trim();
    if (!line || line.startsWith("//")) continue;
    const match = /^#?([\da-f]{6}(?:[\da-f]{2})?)$/i.exec(line);
    if (!match) throw Error("Invalid HEX palette");
    colors.push("#" + match[1].toLowerCase() + (match[1].length === 6 ? "ff" : ""));
  }
  if (!colors.length) throw Error("Invalid HEX palette");
  return pixelPaletteColors(colors);
}
export function exportPixelPalette(colors: readonly string[]): string {
  return JSON.stringify({ format: "ferrum2d.pixel-palette", version: 1, colors: pixelPaletteColors(colors) }, null, 2) + "\n";
}
