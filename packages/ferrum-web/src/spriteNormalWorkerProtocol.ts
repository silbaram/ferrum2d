/** Optional asset generator; independent of engine Wasm, simulation and frame scheduling. */
export const SPRITE_NORMAL_WORKER_LIMITS = Object.freeze({
  inputBytes: 16 * 1024 * 1024,
  outputBytes: 40 * 1024 * 1024,
  metadataBytes: 256 * 1024,
  pixels: 4_194_304,
  frames: 256,
  dimension: 4096,
  memoryBytes: 256 * 1024 * 1024,
  cacheBytes: 8 * 1024 * 1024,
  cacheEntries: 4,
  timeoutMs: 30_000,
  maxTimeoutMs: 120_000,
});
export const NORMAL_GENERATOR_REVISION =
  "d14b06726cabab09c68a403ce2e684a52efbfe4c";
export const NORMAL_WORKER_FORMAT = "ferrum2d.sprite-normal.worker";
export type SpriteNormalWorkerErrorCode =
  | "invalidInput"
  | "unavailable"
  | "aborted"
  | "superseded"
  | "timeout"
  | "destroyed"
  | "generatorInvalid"
  | "generationFailed"
  | "resultInvalid";
export class SpriteNormalWorkerError extends Error {
  constructor(
    readonly code: SpriteNormalWorkerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SpriteNormalWorkerError";
  }
}
export interface SpriteNormalGeneratorSource {
  manifestUrl: string;
  manifestSha256: string;
}
export interface SpriteNormalGenerationSettings {
  normalStrength?: number;
  detailStrength?: number;
  detailScale?: number;
  shapeStrength?: number;
  shapeRadius?: number;
  shapeSoftness?: number;
  alphaThreshold?: number;
  frameSize?: { width: number; height: number };
}
export interface SpriteNormalWorkerInput {
  name: string;
  bytes: Uint8Array;
  settings?: SpriteNormalGenerationSettings;
  animation?: { loop: boolean; clipId?: number };
}
export interface SpriteNormalWorkerStats {
  cacheHit: boolean;
  cacheEntries: number;
  cacheBytes: number;
  wasmMemoryBytes: number;
  generatorCalls: number;
  freedResults: number;
}
export interface SpriteNormalWorkerResult {
  normalPng: ArrayBuffer;
  colorPng: ArrayBuffer;
  metadataJson: string;
  /** Existing CLI report/animation descriptor formats, accepted by createSpriteNormalAssetBinding. */
  report: Record<string, unknown>;
  descriptor?: Record<string, unknown>;
  descriptorSha256?: string;
  elapsedMs: number;
  stats: SpriteNormalWorkerStats;
}
export interface NormalWorkerJob {
  name: string;
  settings: Required<Omit<SpriteNormalGenerationSettings, "frameSize">> &
    Pick<SpriteNormalGenerationSettings, "frameSize">;
  animation?: { loop: boolean; clipId: number };
}
export interface NormalWorkerRequest {
  format: typeof NORMAL_WORKER_FORMAT;
  version: 1;
  id: number;
  source: SpriteNormalGeneratorSource;
  job: NormalWorkerJob;
  buffer: ArrayBuffer;
  cacheBytes: number;
}
export type NormalWorkerResponse = {
  format: typeof NORMAL_WORKER_FORMAT;
  version: 1;
  id: number;
} & (
  | { ok: true; result: SpriteNormalWorkerResult }
  | { ok: false; code: SpriteNormalWorkerErrorCode; message: string }
);
export function normalRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new SpriteNormalWorkerError(
      "invalidInput",
      `${label} must be an object`,
    );
  return value as Record<string, unknown>;
}
function keys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new SpriteNormalWorkerError(
      "invalidInput",
      `${label} contains unsupported fields`,
    );
}
export function normalizeNormalGeneratorSource(
  value: SpriteNormalGeneratorSource,
): SpriteNormalGeneratorSource {
  const source = normalRecord(value, "generator");
  keys(source, ["manifestUrl", "manifestSha256"], "generator");
  let url: URL;
  try {
    url = new URL(
      String(source.manifestUrl),
      globalThis.location?.href ?? import.meta.url,
    );
  } catch {
    throw new SpriteNormalWorkerError(
      "invalidInput",
      "Invalid generator manifest URL",
    );
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    url.href.length > 4096 ||
    typeof source.manifestSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(source.manifestSha256)
  )
    throw new SpriteNormalWorkerError(
      "invalidInput",
      "Expected HTTP(S) manifest URL and lowercase SHA-256",
    );
  return { manifestUrl: url.href, manifestSha256: source.manifestSha256 };
}
export function normalizeNormalWorkerInput(
  value: SpriteNormalWorkerInput,
): NormalWorkerJob {
  const input = normalRecord(value, "input");
  keys(input, ["name", "bytes", "settings", "animation"], "input");
  if (
    typeof input.name !== "string" ||
    !/^([^/\\\u0000-\u001f]+)\.(png|gif|apng)$/i.test(input.name) ||
    input.name.trim() !== input.name ||
    input.name.length > 128
  )
    throw new SpriteNormalWorkerError(
      "invalidInput",
      "name must be a PNG/GIF/APNG basename of at most 128 characters",
    );
  if (
    !(input.bytes instanceof Uint8Array) ||
    !(input.bytes.buffer instanceof ArrayBuffer) ||
    !input.bytes.byteLength ||
    input.bytes.byteLength > SPRITE_NORMAL_WORKER_LIMITS.inputBytes
  )
    throw new SpriteNormalWorkerError(
      "invalidInput",
      "Expected 1 byte..16 MiB owned Uint8Array input",
    );
  const raw =
    input.settings === undefined
      ? {}
      : normalRecord(input.settings, "settings");
  const ranges = {
    normalStrength: [0, 8, 1.5],
    detailStrength: [0, 8, 6],
    detailScale: [0.6, 8, 0.6],
    shapeStrength: [0, 8, 1.15],
    shapeRadius: [0.5, 512, 4],
    shapeSoftness: [0, 8, 1.15],
    alphaThreshold: [0, 0.99, 0.03],
  } as const;
  keys(raw, [...Object.keys(ranges), "frameSize"], "settings");
  const settings: Record<string, unknown> = {};
  for (const [key, [min, max, fallback]] of Object.entries(ranges)) {
    const n = Object.prototype.hasOwnProperty.call(raw, key)
      ? raw[key]
      : fallback;
    if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max)
      throw new SpriteNormalWorkerError(
        "invalidInput",
        `${key} must be finite in ${min}..${max}`,
      );
    settings[key] = n;
  }
  if (raw.frameSize !== undefined) {
    const frame = normalRecord(raw.frameSize, "frameSize");
    keys(frame, ["width", "height"], "frameSize");
    if (
      [frame.width, frame.height].some(
        (n) =>
          !Number.isInteger(n) || (n as number) < 1 || (n as number) > 4096,
      )
    )
      throw new SpriteNormalWorkerError(
        "invalidInput",
        "frameSize must contain dimensions in 1..4096",
      );
    settings.frameSize = { width: frame.width, height: frame.height };
  }
  let animation: NormalWorkerJob["animation"];
  if (input.animation !== undefined) {
    const a = normalRecord(input.animation, "animation");
    keys(a, ["loop", "clipId"], "animation");
    const id = a.clipId === undefined ? 0 : a.clipId;
    if (
      typeof a.loop !== "boolean" ||
      !Number.isInteger(id) ||
      (id as number) < 0 ||
      (id as number) > 65535
    )
      throw new SpriteNormalWorkerError(
        "invalidInput",
        "animation requires explicit boolean loop and optional uint16 clipId; source grid has no packing options",
      );
    animation = { loop: a.loop, clipId: id as number };
  }
  return {
    name: input.name,
    settings: settings as NormalWorkerJob["settings"],
    ...(animation ? { animation } : {}),
  };
}
export async function normalSha256(
  bytes: Uint8Array | string,
): Promise<string> {
  const data =
    typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", data as Uint8Array<ArrayBuffer>),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}

export function normalPngDimensions(buffer: ArrayBuffer): {
  width: number;
  height: number;
} {
  const b = new Uint8Array(buffer);
  if (
    b.length < 33 ||
    [137, 80, 78, 71, 13, 10, 26, 10].some((n, i) => b[i] !== n)
  )
    throw new SpriteNormalWorkerError("resultInvalid", "Expected PNG output");
  const view = new DataView(buffer),
    width = view.getUint32(16),
    height = view.getUint32(20);
  if (
    !width ||
    !height ||
    width > 4096 ||
    height > 4096 ||
    width * height > SPRITE_NORMAL_WORKER_LIMITS.pixels
  )
    throw new SpriteNormalWorkerError(
      "resultInvalid",
      "PNG dimensions exceed the generator contract",
    );
  return { width, height };
}
