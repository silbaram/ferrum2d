/** Legacy preserves existing output; linear-srgb uses linear RGB math and sRGB presentation. */
export type ColorManagementMode = "legacy" | "linear-srgb";

/** Non-color data has no transfer function; alpha is always linear. */
export type TextureColorSpace = "srgb" | "linear" | "none";

export interface TextureLoadOptions {
  /** Color images default to sRGB. Use none for masks/data or linear for linear RGB bytes. */
  colorSpace?: TextureColorSpace;
  /** Optional preferred Basis KTX2 URL. The normal URL remains the image fallback. */
  ktx2Url?: string;
  /** Runtime cancellation; not part of asset cache identity. */
  signal?: AbortSignal;
}

export function resolveColorManagementMode(value: unknown = "legacy"): ColorManagementMode {
  if (value !== "legacy" && value !== "linear-srgb") throw new Error("colorManagement must be legacy or linear-srgb.");
  return value;
}

export function resolveTextureColorSpace(options: TextureLoadOptions = {}): TextureColorSpace {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new Error("Texture load options must be an object.");
  }
  if (options.ktx2Url !== undefined && (typeof options.ktx2Url !== "string" || options.ktx2Url.trim().length === 0)) {
    throw new Error("Texture ktx2Url must be a non-empty URL string.");
  }
  if (options.signal !== undefined && (!options.signal || typeof options.signal.addEventListener !== "function"
    || typeof options.signal.removeEventListener !== "function" || typeof options.signal.aborted !== "boolean")) throw new Error("Texture signal must be an AbortSignal.");
  const value = options.colorSpace === undefined ? "srgb" : options.colorSpace;
  if (value !== "srgb" && value !== "linear" && value !== "none") {
    throw new Error("Texture colorSpace must be srgb, linear or none.");
  }
  return value;
}

/** Converts a normalized sRGB channel to a linear working-space channel. Does not convert alpha. */
export function srgbToLinear(value: number): number {
  validateChannel(value);
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** Converts a normalized linear channel to sRGB. Does not convert alpha. */
export function linearToSrgb(value: number): number {
  validateChannel(value);
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
}

function validateChannel(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("Color channel must be finite and in [0, 1].");
}
