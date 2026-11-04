/** Indexed editing uses unique straight-alpha RGBA entries, with a permanent transparent index0. */
const key = (bytes: Uint8Array, offset: number) => (bytes[offset] * 0x1000000 + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
const hex = (value: number) => "#" + value.toString(16).padStart(8, "0");
export function validateIndexedPalette(colors: readonly string[]): void {
  if (colors.length < 1 || colors.length > 256 || colors[0] !== "#00000000" || colors.some(color => !/^#[0-9a-f]{8}$/.test(color)) || new Set(colors).size !== colors.length)
    throw Error("Indexed palettes require 1–256 unique colors and transparent index 0");
}
function lookup(colors: readonly string[]) {
  validateIndexedPalette(colors); return new Map(colors.map((color, index) => [parseInt(color.slice(1), 16), index]));
}
/** Exact conversion, never implicit quantization. Throws before changing the caller's palette. */
export function collectIndexedPalette(buffers: Iterable<Uint8Array>, initial: readonly string[] = ["#00000000"]): string[] {
  const result = [...initial], map = lookup(result);
  for (const pixels of buffers) {
    if (pixels.length % 4) throw Error("Invalid pixel byte length");
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const color = key(pixels, offset); if (map.has(color)) continue;
      if (result.length >= 256) throw Error("Indexed color limit exceeded. Reduce colors or use RGBA mode.");
      map.set(color, result.length); result.push(hex(color));
    }
  }
  return result;
}
export function encodePixelIndices(pixels: Uint8Array, colors: readonly string[]): Uint8Array {
  if (pixels.length % 4) throw Error("Invalid pixel byte length");
  const map = lookup(colors), result = new Uint8Array(pixels.length / 4);
  for (let i = 0; i < result.length; i++) {
    const index = map.get(key(pixels, i * 4));
    if (index === undefined) throw Error("Cannot remove a palette color used by pixels");
    result[i] = index;
  }
  return result;
}
export function decodePixelIndices(indices: Uint8Array, colors: readonly string[]): Uint8Array {
  validateIndexedPalette(colors);
  const palette = colors.map(color => parseInt(color.slice(1), 16)), result = new Uint8Array(indices.length * 4);
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] >= palette.length) throw Error("Pixel palette index is out of range");
    const color = palette[indices[i]], offset = i * 4;
    result[offset] = color >>> 24; result[offset + 1] = color >>> 16; result[offset + 2] = color >>> 8; result[offset + 3] = color;
  }
  return result;
}
