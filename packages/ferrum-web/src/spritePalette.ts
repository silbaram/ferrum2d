/** Exact RGB8 substitutions; alpha always comes from the source texture. */
export interface SpritePaletteSwap {
  textureId: number;
  colors: readonly { from: string; to: string }[];
}

export const MAX_SPRITE_PALETTE_COLORS = 32;
const MAX_PALETTE_TEXTURES = 64;

export interface ResolvedSpritePalette {
  readonly key: string;
  readonly count: number;
  /** vec4 arrays (padding W), in source RGB8 units and normalized target RGB. */
  readonly from: Float32Array;
  readonly to: Float32Array;
}
export type ResolvedSpritePalettes = ReadonlyMap<number, ResolvedSpritePalette>;

export function resolveSpritePalettes(input: readonly SpritePaletteSwap[]): ResolvedSpritePalettes | undefined {
  if (!Array.isArray(input) || input.length > MAX_PALETTE_TEXTURES) {
    throw new Error("paletteSwap must be an array of at most 64 texture bindings.");
  }
  if (input.length === 0) return undefined;
  const result = new Map<number, ResolvedSpritePalette>();
  for (const binding of input) {
    if (!binding || !Number.isSafeInteger(binding.textureId) || binding.textureId < 0 || binding.textureId > 0xffffff) {
      throw new Error("paletteSwap.textureId must be an integer in [0, 16777215].");
    }
    if (result.has(binding.textureId)) throw new Error("Duplicate paletteSwap textureId.");
    if (!Array.isArray(binding.colors) || binding.colors.length < 1 || binding.colors.length > MAX_SPRITE_PALETTE_COLORS) {
      throw new Error("paletteSwap.colors must contain 1..32 RGB replacements.");
    }
    const from = new Float32Array(MAX_SPRITE_PALETTE_COLORS * 4);
    const to = new Float32Array(MAX_SPRITE_PALETTE_COLORS * 4);
    const seen = new Set<number>();
    for (let index=0; index<binding.colors.length; index++) {
      const pair=binding.colors[index];
      const source = rgb(pair?.from), target = rgb(pair?.to);
      if (seen.has(source)) throw new Error("Duplicate paletteSwap source RGB.");
      seen.add(source);
      from.set([(source >> 16) & 255, (source >> 8) & 255, source & 255], index * 4);
      to.set([((target >> 16) & 255) / 255, ((target >> 8) & 255) / 255, (target & 255) / 255], index * 4);
    }
    result.set(binding.textureId, { key: Array.from(from).join(",")+":"+Array.from(to).join(","), count: binding.colors.length, from, to });
  }
  return result;
}

function rgb(value: unknown): number {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error("paletteSwap colors must be #rrggbb strings (alpha is preserved).");
  }
  return Number.parseInt(value.slice(1), 16);
}

/** Reject lossy/premultiplied inputs rather than silently missing palette matches. */
export function validatePaletteTexture(
  info: { colorSpace: "srgb" | "linear" | "none"; compressed?: boolean } | undefined,
  linearTarget: boolean,
): boolean {
  if (!info) throw new Error("paletteSwap requires a loaded image texture with color-space metadata; RenderTexture inputs are unsupported.");
  if (info.compressed) throw new Error("paletteSwap requires lossless RGB8: load the PNG without ktx2Url.");
  if (info.colorSpace === "srgb" && !linearTarget) {
    throw new Error('paletteSwap cannot match legacy premultiplied sRGB exactly. Load the PNG with { colorSpace: "none" }, or use WebGL2 linear-srgb.');
  }
  return info.colorSpace === "srgb";
}
