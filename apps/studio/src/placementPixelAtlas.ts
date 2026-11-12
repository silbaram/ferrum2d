export interface PixelRect { x: number; y: number; width: number; height: number; }
export interface PixelUv { u0: number; v0: number; u1: number; v1: number; }
export interface PixelAtlasMetadata {
  texture: string;
  frames: { id: string; frame: PixelUv }[];
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid pixel atlas metadata");
  return value as Record<string, unknown>;
}
/** UVs must identify exact pixel edges; never round or rescale authored rectangles. */
export function pixelAtlasRect(width: number, height: number, frame: PixelUv): PixelRect {
  if ([frame.u0, frame.v0, frame.u1, frame.v1].some(value => !Number.isFinite(value) || value < 0 || value > 1))
    throw Error("Atlas frames require integer pixel rectangles within the image");
  const edges = [frame.u0 * width, frame.v0 * height, frame.u1 * width, frame.v1 * height];
  const rounded = edges.map(Math.round);
  if (edges.some((value, index) => !Number.isFinite(value) || Math.abs(value - rounded[index]) > 1e-7) ||
    rounded[0] < 0 || rounded[1] < 0 || rounded[2] > width || rounded[3] > height ||
    rounded[2] <= rounded[0] || rounded[3] <= rounded[1]) throw Error("Atlas frames require integer pixel rectangles within the image");
  return { x: rounded[0], y: rounded[1], width: rounded[2] - rounded[0], height: rounded[3] - rounded[1] };
}
export function readPixelAtlas(value: unknown, width: number, height: number): PixelAtlasMetadata {
  const atlas = record(value);
  const validText = (value: unknown, max: number): value is string => typeof value === "string" &&
    value.trim().length > 0 && value.length <= max && !/[\uD800-\uDFFF]/u.test(value);
  if (!validText(atlas.texture, 256) || !Array.isArray(atlas.frames) || !atlas.frames.length || atlas.frames.length > 256)
    throw Error("Invalid pixel atlas metadata");
  const ids = new Set<string>(), rects: PixelRect[] = [];
  const frames = atlas.frames.map(raw => {
    const entry = record(raw), uv = record(entry.frame);
    if (!validText(entry.id, 64) || ids.has(entry.id) ||
      [uv.u0, uv.v0, uv.u1, uv.v1].some(value => typeof value !== "number")) throw Error("Invalid pixel atlas metadata");
    ids.add(entry.id);
    const frame = { u0: uv.u0 as number, v0: uv.v0 as number, u1: uv.u1 as number, v1: uv.v1 as number };
    const rect = pixelAtlasRect(width, height, frame);
    if (rects.some(other => rect.x < other.x + other.width && other.x < rect.x + rect.width &&
      rect.y < other.y + other.height && other.y < rect.y + rect.height)) throw Error("Overlapping atlas frames cannot be edited safely");
    rects.push(rect);
    return { id: entry.id, frame };
  });
  return { texture: atlas.texture, frames };
}
