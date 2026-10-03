import { KTX2_MAX_DIMENSION, KTX2_MAX_INPUT_BYTES, ktx2BlockBytes } from "./ktx2Texture";
import type { Ktx2WorkerReply, Ktx2WorkerRequest, Ktx2TranscodedImage } from "./ktx2Texture";

interface BasisFile {
  isValid(): boolean;
  isETC1S(): boolean;
  isUASTC(): boolean;
  isSRGB(): boolean;
  getHasAlpha(): boolean;
  getDFDFlags(): number;
  startTranscoding(): boolean;
  getImageTranscodedSizeInBytes(level: number, layer: number, face: number, format: number): number;
  transcodeImage(data: Uint8Array, level: number, layer: number, face: number, format: number, alpha: number, channel0: number, channel1: number): boolean;
  close(): void;
  delete(): void;
}

interface BasisModule {
  initializeBasis(): void;
  KTX2File: new(data: Uint8Array) => BasisFile;
  transcoder_texture_format: Record<"cTFASTC_4x4_RGBA" | "cTFBC7_RGBA" | "cTFETC2_RGBA", { value: number }>;
}

interface WorkerPort {
  onmessage: ((event: MessageEvent<Ktx2WorkerRequest>) => void) | null;
  postMessage(reply: Ktx2WorkerReply, transfer?: Transferable[]): void;
}

// This entrypoint is loaded only as a dedicated module Worker, never on the main thread.
const port = globalThis as unknown as WorkerPort;
let modulePromise: Promise<BasisModule> | undefined;
let queue: Promise<void> = Promise.resolve();

port.onmessage = (event) => {
  const request = event.data;
  queue = queue.then(async () => {
    try {
      const size = validateContainer(request);
      modulePromise ??= loadModule(request.jsUrl, request.wasmUrl);
      const basis = await modulePromise;
      const image = transcode(basis, request, size);
      port.postMessage({ id: request.id, image }, [image.data.buffer]);
    } catch (error) {
      port.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) });
    }
  });
};

async function loadModule(jsUrl: string, wasmUrl: string): Promise<BasisModule> {
  const [factoryModule, response] = await Promise.all([
    import(/* @vite-ignore */ jsUrl), fetch(wasmUrl),
  ]);
  if (!response.ok) throw new Error(`Basis Wasm fetch failed: HTTP ${response.status}.`);
  if (typeof factoryModule.default !== "function") throw new Error("Basis module has no factory.");
  // The vendored factory ABI is pinned and verified by package checks and real-browser tests.
  const basis: BasisModule = await factoryModule.default({ wasmBinary: await response.arrayBuffer() });
  basis.initializeBasis();
  return basis;
}

function transcode(basis: BasisModule, request: Ktx2WorkerRequest, size: { width: number; height: number }): Ktx2TranscodedImage {
  const file = new basis.KTX2File(request.data);
  try {
    if (!file.isValid() || (!file.isETC1S() && !file.isUASTC())) throw new Error("KTX2 must contain ETC1S or UASTC LDR data.");
    if (Boolean(file.isSRGB()) !== request.options.srgb) throw new Error("KTX2 color space does not match texture metadata.");
    if (file.getDFDFlags() & 1) throw new Error("Premultiplied KTX2 input is unsupported.");
    if (file.getHasAlpha() && !request.options.allowAlpha) throw new Error("KTX2 alpha requires linear-srgb rendering; using the legacy image fallback.");
    const name = request.options.format === "astc-4x4" ? "cTFASTC_4x4_RGBA"
      : request.options.format === "bc7" ? "cTFBC7_RGBA" : "cTFETC2_RGBA";
    const format = basis.transcoder_texture_format[name].value;
    if (!file.startTranscoding()) throw new Error("KTX2 transcoder initialization failed.");
    const bytes = file.getImageTranscodedSizeInBytes(0, 0, 0, format);
    if (bytes !== ktx2BlockBytes(size.width, size.height)) throw new Error("Invalid KTX2 transcoded byte size.");
    const data = new Uint8Array(bytes);
    if (!file.transcodeImage(data, 0, 0, 0, format, 0, -1, -1)) throw new Error("KTX2 transcode failed.");
    return { ...size, data, format: request.options.format };
  } finally {
    file.close();
    file.delete();
  }
}

function validateContainer(request: Ktx2WorkerRequest): { width: number; height: number } {
  const data = request.data;
  const signature = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
  if (data.byteLength < 80 || data.byteLength > KTX2_MAX_INPUT_BYTES
    || signature.some((value, index) => data[index] !== value)) throw new Error("Invalid KTX2 header.");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const width = view.getUint32(20, true), height = view.getUint32(24, true);
  const maxDimension = Math.min(KTX2_MAX_DIMENSION, request.options.maxDimension);
  if (!Number.isInteger(maxDimension) || width < 4 || height < 4 || width % 4 !== 0 || height % 4 !== 0
    || width > maxDimension || height > maxDimension
    || view.getUint32(12, true) !== 0 || view.getUint32(28, true) !== 0
    || view.getUint32(32, true) !== 0 || view.getUint32(36, true) !== 1
    || view.getUint32(40, true) < 1 || view.getUint32(40, true) > 14) {
    throw new Error("KTX2 requires a supported-size, non-array 2D Basis texture with dimensions divisible by four.");
  }
  const offset = view.getUint32(56, true), length = view.getUint32(60, true);
  if (offset + length > data.byteLength) throw new Error("KTX2 metadata exceeds file bounds.");
  let cursor = offset;
  while (cursor < offset + length) {
    if (cursor + 4 > offset + length) throw new Error("Invalid KTX2 metadata entry.");
    const size = view.getUint32(cursor, true);
    cursor += 4;
    if (cursor + size > offset + length) throw new Error("Invalid KTX2 metadata entry size.");
    const entry = data.subarray(cursor, cursor + size);
    const separator = entry.indexOf(0);
    if (separator < 0) throw new Error("Invalid KTX2 metadata key.");
    const decoder = new TextDecoder();
    if (decoder.decode(entry.subarray(0, separator)) === "KTXorientation"
      && decoder.decode(entry.subarray(separator + 1)).replace(/\0+$/, "") !== "rd") {
      throw new Error("KTX2 requires right/down orientation.");
    }
    cursor += Math.ceil(size / 4) * 4;
  }
  return { width, height };
}
