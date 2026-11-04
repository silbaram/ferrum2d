/** App-private RGBA patches. Geometry/metadata changes use the model's snapshot fallback. */
export interface PixelHistoryRect {
  frame: number; layer: number; x: number; y: number; width: number; height: number;
  before: Uint8Array; after: Uint8Array;
}
interface PixelHistoryFrame { pixels: Uint8Array[]; }

/** Inputs have identical dimensions, cel ordering and metadata. Model copy-on-write keeps committed buffers immutable. */
export function pixelHistoryRects(before: readonly PixelHistoryFrame[], after: readonly PixelHistoryFrame[], width: number, height: number): PixelHistoryRect[] {
  const patches: PixelHistoryRect[] = [];
  for (let frame = 0; frame < before.length; frame++) for (let layer = 0; layer < before[frame].pixels.length; layer++) {
    const a = before[frame].pixels[layer], b = after[frame].pixels[layer];
    if (a === b) continue;
    let left = width, top = height, right = -1, bottom = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2] && a[i + 3] === b[i + 3]) continue;
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
    if (right < 0) continue;
    const w = right - left + 1, h = bottom - top + 1;
    // Dense fills already own immutable before/after cels. Reuse them instead of
    // allocating two more full buffers, especially for small single-cel sources.
    if (w === width && h === height) {
      patches.push({ frame, layer, x: 0, y: 0, width, height, before: a, after: b });
      continue;
    }
    const previous = new Uint8Array(w * h * 4), next = new Uint8Array(previous.length);
    for (let row = 0; row < h; row++) {
      const start = ((top + row) * width + left) * 4;
      previous.set(a.subarray(start, start + w * 4), row * w * 4);
      next.set(b.subarray(start, start + w * 4), row * w * 4);
    }
    patches.push({ frame, layer, x: left, y: top, width: w, height: h, before: previous, after: next });
  }
  return patches;
}

/** Copy changed cels before restoring bytes: an unchanged cel can still belong to an older snapshot. */
export function applyPixelHistoryRects<T extends PixelHistoryFrame>(frames: readonly T[], patches: readonly PixelHistoryRect[], width: number, side: "before" | "after"): T[] {
  const next = frames.map(frame => ({ ...frame, pixels: [...frame.pixels] }));
  for (const patch of patches) {
    const pixels = next[patch.frame].pixels[patch.layer].slice();
    for (let row = 0; row < patch.height; row++) {
      pixels.set(patch[side].subarray(row * patch.width * 4, (row + 1) * patch.width * 4), ((patch.y + row) * width + patch.x) * 4);
    }
    next[patch.frame].pixels[patch.layer] = pixels;
  }
  return next;
}
