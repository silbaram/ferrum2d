/** Supported LDR block formats. Every format uses 16 bytes per 4x4 block. */
export type Ktx2TextureFormat = "astc-4x4" | "bc7" | "etc2-rgba";

export interface Ktx2TranscodeOptions {
  format: Ktx2TextureFormat;
  srgb: boolean;
  allowAlpha: boolean;
  maxDimension: number;
  signal?: AbortSignal;
}

export interface Ktx2TranscodedImage {
  width: number;
  height: number;
  format: Ktx2TextureFormat;
  data: Uint8Array;
}

export interface Ktx2Transcoder {
  transcode(data: Uint8Array, options: Ktx2TranscodeOptions): Promise<Ktx2TranscodedImage>;
  destroy(): void;
}

export interface Ktx2TranscoderOptions {
  /** Override when self-hosting decoder assets outside the package's generated URLs. */
  transcoderJsUrl?: string | URL;
  transcoderWasmUrl?: string | URL;
  workerUrl?: string | URL;
}

export interface Ktx2WorkerRequest {
  id: number;
  data: Uint8Array;
  options: Omit<Ktx2TranscodeOptions, "signal">;
  jsUrl: string;
  wasmUrl: string;
}

export type Ktx2WorkerReply = { id: number; image: Ktx2TranscodedImage } | { id: number; error: string };

export const KTX2_MAX_INPUT_BYTES = 64 * 1024 * 1024;
export const KTX2_MAX_DIMENSION = 8192;

export function ktx2BlockBytes(width: number, height: number): number {
  return Math.ceil(width / 4) * Math.ceil(height / 4) * 16;
}

export function textureLoadAbortError(): Error {
  return new DOMException("Texture loading was cancelled.", "AbortError");
}
