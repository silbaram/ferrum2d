/** Ferrum-owned editing source. Runtime assets contain flattened PNGs only. */
export const PIXEL_LIMITS = {
  side: 256,
  documentBytes: 400_000,
  historySteps: 64,
  historyBytes: 16 * 1024 * 1024,
} as const;
export type PixelColor = readonly [number, number, number, number];
export interface PixelDocument {
  format: "ferrum2d.pixel-document";
  version: 1;
  name: string;
  width: number;
  height: number;
  colorSpace: "srgb";
  layer: { id: string; name: string };
  frame: { id: string; durationMs: number };
  palette: string[];
  /** Row-major, straight-alpha RGBA8, base64. No UI state or Undo log. */
  rgba: string;
}
export const PIXEL_PALETTE = [
  "#000000ff", "#ffffffff", "#6b7280ff", "#374151ff",
  "#ef4444ff", "#f97316ff", "#f5a742ff", "#fde047ff",
  "#84cc16ff", "#22c55eff", "#14b8a6ff", "#38bdf8ff",
  "#3b82f6ff", "#8b5cf6ff", "#ec4899ff", "#a16207ff",
];
const fail = (message: string): never => { throw Error(message); };
// The object guard excludes null and arrays; individual properties remain unknown.
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : fail("Invalid pixel document");
function integer(value: unknown, min: number, max: number,
  message = "Pixel dimensions must be integers from 1 to 256"): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value : fail(message);
}
function text(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 64
    ? value : fail("Pixel names require 1–64 characters");
}
export function pixelColor(hex: string): PixelColor {
  if (!/^#[\da-f]{8}$/i.test(hex)) fail("Invalid RGBA color");
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16), parseInt(hex.slice(7, 9), 16)];
}
export function pixelHex(color: PixelColor): string {
  if (color.length !== 4 || color.some(n => !Number.isInteger(n) || n < 0 || n > 255))
    fail("Invalid RGBA color");
  return "#" + color.map(n => n.toString(16).padStart(2, "0")).join("");
}
function base64(bytes: Uint8Array): string {
  let value = "";
  for (let i = 0; i < bytes.length; i += 16384)
    value += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(value);
}
export function pixelBytes(document: PixelDocument): Uint8Array {
  return decodeRgba(document.rgba);
}
function decodeRgba(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, value => value.charCodeAt(0));
}
export function readPixelDocument(input: string): PixelDocument {
  if (new TextEncoder().encode(input).length > PIXEL_LIMITS.documentBytes)
    fail("Pixel document exceeds the byte limit");
  const value = object(JSON.parse(input));
  if (value.format !== "ferrum2d.pixel-document" || value.version !== 1 || value.colorSpace !== "srgb")
    fail("Unsupported pixel document format or version");
  const width = integer(value.width, 1, PIXEL_LIMITS.side);
  const height = integer(value.height, 1, PIXEL_LIMITS.side);
  const layer = object(value.layer), frame = object(value.frame);
  const paletteValue = value.palette;
  if (!Array.isArray(paletteValue) || paletteValue.length > 256)
    return fail("Invalid pixel palette");
  const palette = paletteValue.map((color: unknown) =>
    typeof color === "string" && /^#[\da-f]{8}$/i.test(color) ? color : fail("Invalid pixel palette"));
  const expected = width * height * 4;
  const rgba = value.rgba;
  if (typeof rgba !== "string" || rgba.length !== 4 * Math.ceil(expected / 3) ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(rgba))
    return fail("Invalid pixel byte length");
  let bytes: Uint8Array;
  try { bytes = decodeRgba(rgba); }
  catch { return fail("Invalid pixel encoding"); }
  if (bytes.length !== expected || base64(bytes) !== rgba)
    fail("Invalid pixel encoding");
  return {
    format: "ferrum2d.pixel-document", version: 1, name: text(value.name),
    width, height, colorSpace: "srgb",
    layer: { id: text(layer.id), name: text(layer.name) },
    frame: { id: text(frame.id), durationMs: integer(frame.durationMs, 1, 60000,
      "Frame duration must be an integer from 1 to 60000") },
    palette, rgba,
  };
}
export function newPixelDocument(width = 32, height = 32, name = "sprite"): PixelDocument {
  integer(width, 1, PIXEL_LIMITS.side); integer(height, 1, PIXEL_LIMITS.side);
  return {
    format: "ferrum2d.pixel-document", version: 1, name: text(name),
    width, height, colorSpace: "srgb",
    layer: { id: "layer-1", name: "Layer 1" },
    frame: { id: "frame-1", durationMs: 100 },
    palette: [...PIXEL_PALETTE], rgba: base64(new Uint8Array(width * height * 4)),
  };
}
export function pixelDocumentFromRgba(width: number, height: number, name: string, pixels: Uint8Array): PixelDocument {
  const document = newPixelDocument(width, height, name);
  if (pixels.length !== width * height * 4) fail("Invalid pixel byte length");
  document.rgba = base64(pixels);
  return document;
}
const equal = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((n, i) => n === b[i]);

/** One explicit transaction per stroke/fill; cancel never destroys the Redo branch. */
export function createPixelEditor(source: PixelDocument) {
  const document = readPixelDocument(JSON.stringify(source));
  let pixels = pixelBytes(document), checkpoint = pixels.slice();
  let dirtyCache: boolean | undefined = false;
  let pending: Uint8Array | undefined;
  const undo: { before: Uint8Array; after: Uint8Array }[] = [], redo: typeof undo = [];
  const validPoint = (x: number, y: number) => Number.isInteger(x) && Number.isInteger(y) &&
    x >= 0 && y >= 0 && x < document.width && y < document.height;
  function begin() {
    if (pending) fail("Finish the pixel stroke first");
    pending = pixels.slice();
  }
  function cancel() {
    if (pending) { pixels = pending; dirtyCache = undefined; }
    pending = undefined;
  }
  function commit() {
    if (!pending) return false;
    const before = pending;
    pending = undefined;
    if (equal(before, pixels)) return false;
    redo.length = 0;
    undo.push({ before, after: pixels.slice() });
    while (undo.length > PIXEL_LIMITS.historySteps ||
      undo.length * pixels.length * 2 > PIXEL_LIMITS.historyBytes) undo.shift();
    return true;
  }
  function put(x: number, y: number, color: PixelColor) {
    if (!pending) fail("Start a pixel transaction first");
    if (validPoint(x, y)) {
      pixels.set(color, (y * document.width + x) * 4); dirtyCache = undefined;
    }
  }
  function sample(x: number, y: number): PixelColor | undefined {
    if (!validPoint(x, y)) return;
    const offset = (y * document.width + x) * 4;
    return [pixels[offset], pixels[offset + 1], pixels[offset + 2], pixels[offset + 3]];
  }
  return {
    width: document.width, height: document.height, name: document.name,
    palette: [...document.palette],
    begin, commit, cancel, sample,
    active: () => pending !== undefined,
    dirty: () => dirtyCache ??= !equal(checkpoint, pixels),
    markExported() { checkpoint = pixels.slice(); dirtyCache = false; },
    bytes: () => pixels.slice(),
    document(): PixelDocument { return { ...structuredClone(document), rgba: base64(pixels) }; },
    history: () => ({
      undo: undo.length, redo: redo.length,
      bytes: (undo.length + redo.length) * pixels.length * 2,
    }),
    undo() {
      cancel();
      const step = undo.pop();
      if (step) { pixels = step.before.slice(); dirtyCache = undefined; redo.push(step); }
    },
    redo() {
      cancel();
      const step = redo.pop();
      if (step) { pixels = step.after.slice(); dirtyCache = undefined; undo.push(step); }
    },
    line(x0: number, y0: number, x1: number, y1: number, color: PixelColor) {
      pixelHex(color);
      if ([x0, y0, x1, y1].some(n => !Number.isInteger(n) || Math.abs(n) > 1_048_576))
        fail("Invalid stroke coordinates");
      // Clip before rasterizing so pointer capture outside the image has bounded cost.
      const dx = x1 - x0, dy = y1 - y0;
      let low = 0, high = 1;
      for (const [p, q] of [[-dx, x0], [dx, document.width - 1 - x0], [-dy, y0], [dy, document.height - 1 - y0]]) {
        if (p === 0) { if (q < 0) return; continue; }
        const t = q / p;
        if (p < 0) low = Math.max(low, t); else high = Math.min(high, t);
        if (low > high) return;
      }
      let x = Math.round(x0 + dx * low), y = Math.round(y0 + dy * low);
      const endX = Math.round(x0 + dx * high), endY = Math.round(y0 + dy * high);
      const ax = Math.abs(endX - x), ay = -Math.abs(endY - y);
      const sx = x < endX ? 1 : -1, sy = y < endY ? 1 : -1;
      let error = ax + ay;
      for (;;) {
        put(x, y, color);
        if (x === endX && y === endY) break;
        const twice = 2 * error;
        if (twice >= ay) { error += ay; x += sx; }
        if (twice <= ax) { error += ax; y += sy; }
      }
    },
    fill(x: number, y: number, color: PixelColor) {
      pixelHex(color);
      if (!pending) fail("Start a pixel transaction first");
      const target = sample(x, y);
      if (!target || target.every((n, i) => n === color[i])) return;
      // Enqueue each pixel at most once; neither recursion nor an unbounded work list.
      const queue = new Uint32Array(document.width * document.height);
      const visited = new Uint8Array(queue.length);
      let head = 0, tail = 0;
      const enqueue = (px: number, py: number) => {
        if (!validPoint(px, py)) return;
        const index = py * document.width + px;
        if (visited[index]) return;
        visited[index] = 1;
        const offset = index * 4;
        const same = target[3] === 0
          ? pixels[offset + 3] === 0
          : target.every((n, i) => n === pixels[offset + i]);
        if (same) queue[tail++] = index;
      };
      enqueue(x, y);
      while (head < tail) {
        const index = queue[head++], px = index % document.width, py = Math.floor(index / document.width);
        put(px, py, color);
        enqueue(px - 1, py); enqueue(px + 1, py); enqueue(px, py - 1); enqueue(px, py + 1);
      }
    },
  };
}
