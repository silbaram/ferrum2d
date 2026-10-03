import { KTX2_MAX_INPUT_BYTES, textureLoadAbortError } from "./ktx2Texture";
import type { Ktx2Transcoder, Ktx2TranscoderOptions, Ktx2TranscodeOptions, Ktx2TranscodedImage, Ktx2WorkerReply, Ktx2WorkerRequest } from "./ktx2Texture";

/** Creates a lazy, reusable decode Worker. The caller owns and destroys this object. */
export function createKtx2Transcoder(options: Ktx2TranscoderOptions = {}): Ktx2Transcoder {
  return new WorkerKtx2Transcoder(options);
}

class WorkerKtx2Transcoder implements Ktx2Transcoder {
  private worker?: Worker;
  private nextId = 0;
  private destroyed = false;
  private readonly submitted = new Set<number>();
  private readonly pending = new Map<number, {
    resolve(image: Ktx2TranscodedImage): void;
    reject(error: Error): void;
    cleanup(): void;
  }>();

  constructor(private readonly options: Ktx2TranscoderOptions) {}

  transcode(data: Uint8Array, options: Ktx2TranscodeOptions): Promise<Ktx2TranscodedImage> {
    if (this.destroyed || options.signal?.aborted) return Promise.reject(textureLoadAbortError());
    if (!["astc-4x4", "bc7", "etc2-rgba"].includes(options.format)
      || typeof options.srgb !== "boolean" || typeof options.allowAlpha !== "boolean"
      || !Number.isInteger(options.maxDimension) || options.maxDimension < 4
      || (options.signal !== undefined && (typeof options.signal.addEventListener !== "function"
        || typeof options.signal.removeEventListener !== "function"))) {
      return Promise.reject(new Error("Invalid KTX2 transcode options."));
    }
    if (!(data instanceof Uint8Array) || data.byteLength < 80 || data.byteLength > KTX2_MAX_INPUT_BYTES) {
      return Promise.reject(new Error("KTX2 data size is outside 80 bytes..64 MiB."));
    }
    if (this.submitted.size >= 32) return Promise.reject(new Error("Too many pending KTX2 requests."));
    return new Promise((resolve, reject) => {
      let worker: Worker;
      try { worker = this.ensureWorker(); } catch (error) { reject(error); return; }
      const id = ++this.nextId;
      const signal = options.signal;
      const abort = () => {
        this.pending.delete(id);
        cleanup();
        reject(textureLoadAbortError());
        if (this.pending.size === 0) this.failWorker(textureLoadAbortError());
      };
      const timeout = setTimeout(() => this.failWorker(new Error("KTX2 worker timed out.")), 30_000);
      const cleanup = () => { clearTimeout(timeout); signal?.removeEventListener("abort", abort); };
      this.pending.set(id, { resolve, reject, cleanup });
      signal?.addEventListener("abort", abort, { once: true });
      try {
        // Copy before transfer: callers/caches retain ownership of the input bytes.
        const copy = data.slice();
        const { signal: _signal, ...decodeOptions } = options;
        const request: Ktx2WorkerRequest = {
          id, data: copy, options: decodeOptions,
          jsUrl: this.absoluteUrl(this.options.transcoderJsUrl ?? new URL("./vendor/basis/basis_transcoder.js", import.meta.url)),
          wasmUrl: this.absoluteUrl(this.options.transcoderWasmUrl ?? new URL("./vendor/basis/basis_transcoder.wasm", import.meta.url)),
        };
        this.submitted.add(id);
        worker.postMessage(request, [copy.buffer]);
      } catch (error) {
        this.submitted.delete(id);
        this.pending.delete(id);
        cleanup();
        reject(error);
      }
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.failWorker(textureLoadAbortError());
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    // Keep the default literal URL recognizable to Vite's worker bundler.
    const worker = this.options.workerUrl === undefined
      ? new Worker(new URL("./ktx2Worker.js", import.meta.url), { type: "module" })
      : new Worker(this.options.workerUrl, { type: "module" });
    worker.onmessage = (event: MessageEvent<Ktx2WorkerReply>) => {
      const reply = event.data;
      this.submitted.delete(reply.id);
      const request = this.pending.get(reply.id);
      if (!request) return; // cancelled request; the Worker has already released the decoder image
      this.pending.delete(reply.id);
      request.cleanup();
      if ("error" in reply) request.reject(new Error(reply.error));
      else request.resolve(reply.image);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      this.failWorker(new Error(event.message || "KTX2 worker failed."));
    };
    worker.onmessageerror = () => this.failWorker(new Error("KTX2 worker message failed."));
    this.worker = worker;
    return worker;
  }

  private failWorker(error: Error): void {
    this.worker?.terminate();
    this.worker = undefined;
    for (const request of this.pending.values()) { request.cleanup(); request.reject(error); }
    this.pending.clear();
    this.submitted.clear();
  }

  private absoluteUrl(url: string | URL): string {
    return new URL(url, globalThis.location?.href ?? import.meta.url).href;
  }
}
