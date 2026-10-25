import {
  NORMAL_WORKER_FORMAT,
  NORMAL_GENERATOR_REVISION,
  SPRITE_NORMAL_WORKER_LIMITS as limits,
  SpriteNormalWorkerError,
  normalizeNormalGeneratorSource,
  normalizeNormalWorkerInput,
  normalPngDimensions,
  type SpriteNormalGeneratorSource,
  type SpriteNormalWorkerInput,
  type SpriteNormalWorkerResult,
  type SpriteNormalWorkerErrorCode,
  type NormalWorkerJob,
  type NormalWorkerRequest,
} from "./spriteNormalWorkerProtocol.js";
export {
  SPRITE_NORMAL_WORKER_LIMITS,
  SpriteNormalWorkerError,
} from "./spriteNormalWorkerProtocol.js";
export type {
  SpriteNormalGeneratorSource,
  SpriteNormalGenerationSettings,
  SpriteNormalWorkerInput,
  SpriteNormalWorkerResult,
  SpriteNormalWorkerStats,
  SpriteNormalWorkerErrorCode,
} from "./spriteNormalWorkerProtocol.js";

export interface SpriteNormalWorkerPort {
  postMessage(message: unknown, transfer: Transferable[]): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  addEventListener(
    type: "error" | "messageerror",
    listener: (event: Event) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  removeEventListener(
    type: "error" | "messageerror",
    listener: (event: Event) => void,
  ): void;
  terminate(): void;
}
export interface CreateSpriteNormalWorkerClientOptions {
  generator: SpriteNormalGeneratorSource;
  /** Override module worker construction for a host/bundler. Returned workers are owned by this client. */
  workerFactory?: () => SpriteNormalWorkerPort;
  cacheBytes?: number;
}
export interface SpriteNormalWorkerGenerateOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}
export interface SpriteNormalWorkerClient {
  /** Latest valid request wins; caller bytes are copied, never detached or mutated. */
  generate(
    input: SpriteNormalWorkerInput,
    options?: SpriteNormalWorkerGenerateOptions,
  ): Promise<SpriteNormalWorkerResult>;
  cancel(): void;
  /** Drops the compiled generator and result cache; rejects an active request. */
  clearCache(): void;
  destroy(): void;
}
interface PendingJob {
  id: number;
  job: NormalWorkerJob;
  resolve: (value: SpriteNormalWorkerResult) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
}
const codes: readonly SpriteNormalWorkerErrorCode[] = [
  "invalidInput",
  "unavailable",
  "aborted",
  "superseded",
  "timeout",
  "destroyed",
  "generatorInvalid",
  "generationFailed",
  "resultInvalid",
];

function validateResult(
  value: unknown,
  source: SpriteNormalGeneratorSource,
  job: NormalWorkerJob,
): SpriteNormalWorkerResult {
  const r = value as SpriteNormalWorkerResult;
  if (
    !r ||
    !(r.normalPng instanceof ArrayBuffer) ||
    !(r.colorPng instanceof ArrayBuffer) ||
    r.normalPng === r.colorPng ||
    r.normalPng.byteLength + r.colorPng.byteLength > limits.outputBytes ||
    typeof r.metadataJson !== "string" ||
    new TextEncoder().encode(r.metadataJson).length > limits.metadataBytes ||
    !Number.isFinite(r.elapsedMs) ||
    r.elapsedMs < 0
  )
    throw new SpriteNormalWorkerError(
      "resultInvalid",
      "Invalid owned generator output",
    );
  const normal = normalPngDimensions(r.normalPng),
    color = normalPngDimensions(r.colorPng),
    metadata = JSON.parse(r.metadataJson),
    g = r.report?.generator as Record<string, unknown>,
    s = r.stats;
  if (
    normal.width !== color.width ||
    normal.height !== color.height ||
    metadata.width !== normal.width ||
    metadata.height !== normal.height ||
    new Uint8Array(r.normalPng)[24] !== 8 ||
    new Uint8Array(r.normalPng)[25] !== 6 ||
    r.report?.format !== "ferrum2d.sprite-normals.report" ||
    r.report.version !== 1 ||
    r.report.ok !== true ||
    !g ||
    g.revision !== NORMAL_GENERATOR_REVISION ||
    g.manifestSha256 !== source.manifestSha256 ||
    !Array.isArray(r.report.results) ||
    r.report.results.length !== 1 ||
    (r.report.results[0] as { input?: { path?: string } }).input?.path !==
      job.name ||
    !s ||
    typeof s.cacheHit !== "boolean" ||
    ![
      s.cacheEntries,
      s.cacheBytes,
      s.wasmMemoryBytes,
      s.generatorCalls,
      s.freedResults,
    ].every((n) => Number.isSafeInteger(n) && n >= 0) ||
    !s.wasmMemoryBytes ||
    s.wasmMemoryBytes > limits.memoryBytes ||
    s.cacheBytes > limits.cacheBytes ||
    s.cacheEntries > limits.cacheEntries ||
    s.generatorCalls !== s.freedResults
  )
    throw new SpriteNormalWorkerError(
      "resultInvalid",
      "Generator response provenance, dimensions or resource stats differ",
    );
  if (
    job.animation &&
    (!r.descriptor ||
      typeof r.descriptorSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(r.descriptorSha256))
  )
    throw new SpriteNormalWorkerError(
      "resultInvalid",
      "Animation descriptor missing",
    );
  return r;
}

export function createSpriteNormalWorkerClient(
  options: CreateSpriteNormalWorkerClientOptions,
): SpriteNormalWorkerClient {
  const source = normalizeNormalGeneratorSource(options.generator),
    cacheBytes = options.cacheBytes ?? limits.cacheBytes,
    workerFactory = options.workerFactory;
  if (
    !Number.isInteger(cacheBytes) ||
    cacheBytes < 0 ||
    cacheBytes > limits.cacheBytes
  )
    throw new SpriteNormalWorkerError(
      "invalidInput",
      "cacheBytes must be an integer in 0..8 MiB",
    );
  let worker: SpriteNormalWorkerPort | undefined,
    pending: PendingJob | undefined,
    closed = false,
    sequence = 0,
    removeListeners: (() => void) | undefined;
  const terminate = () => {
    const previous = worker;
    worker = undefined;
    removeListeners?.();
    removeListeners = undefined;
    try {
      previous?.terminate();
    } catch {
      /* A failed worker still loses all listeners and pending work. */
    }
  };
  const reject = (
    code: SpriteNormalWorkerErrorCode,
    message: string,
    stop = true,
  ) => {
    const previous = pending;
    pending = undefined;
    previous?.cleanup();
    if (stop) terminate();
    previous?.reject(new SpriteNormalWorkerError(code, message));
  };
  const ensureWorker = (): SpriteNormalWorkerPort => {
    if (worker) return worker;
    let port: SpriteNormalWorkerPort;
    try {
      port = workerFactory
        ? workerFactory()
        : new Worker(new URL("./spriteNormalWorkerEntry.js", import.meta.url), {
            type: "module",
            name: "ferrum-normal-generator",
          });
    } catch {
      throw new SpriteNormalWorkerError(
        "unavailable",
        "A module Worker is required for sprite normal generation",
      );
    }
    worker = port;
    const message = (event: MessageEvent<unknown>) => {
      const data = event.data as {
        id?: number;
        format?: string;
        version?: number;
        ok?: boolean;
        code?: SpriteNormalWorkerErrorCode;
        message?: string;
        result?: unknown;
      };
      if (port !== worker || !pending || data?.id !== pending.id) return;
      try {
        if (
          data.format !== NORMAL_WORKER_FORMAT ||
          data.version !== 1 ||
          typeof data.ok !== "boolean"
        )
          throw new SpriteNormalWorkerError(
            "resultInvalid",
            "Invalid generator response envelope",
          );
        if (!data.ok) {
          if (
            !data.code ||
            !codes.includes(data.code) ||
            typeof data.message !== "string" ||
            data.message.length > 2000
          )
            throw new SpriteNormalWorkerError(
              "resultInvalid",
              "Invalid generator failure envelope",
            );
          reject(data.code, data.message);
          return;
        }
        const result = validateResult(data.result, source, pending.job),
          completed = pending;
        pending = undefined;
        completed.cleanup();
        completed.resolve(result);
      } catch (error) {
        reject(
          "resultInvalid",
          String(error instanceof Error ? error.message : error),
        );
      }
    };
    const failure = (event: Event) => {
      if (port !== worker) return;
      event.preventDefault?.();
      reject(
        "generationFailed",
        event.type === "messageerror"
          ? "Cannot decode generator worker message"
          : "Generator worker failed",
      );
    };
    port.addEventListener("message", message);
    port.addEventListener("error", failure);
    port.addEventListener("messageerror", failure);
    removeListeners = () => {
      port.removeEventListener("message", message);
      port.removeEventListener("error", failure);
      port.removeEventListener("messageerror", failure);
    };
    return port;
  };
  return {
    generate(input, requestOptions = {}) {
      if (closed)
        return Promise.reject(
          new SpriteNormalWorkerError(
            "destroyed",
            "Generator client is destroyed",
          ),
        );
      const signal = requestOptions.signal;
      let job: NormalWorkerJob, buffer: ArrayBuffer, timeoutMs: number;
      try {
        job = normalizeNormalWorkerInput(input);
        timeoutMs = requestOptions.timeoutMs ?? limits.timeoutMs;
        if (
          !Number.isInteger(timeoutMs) ||
          timeoutMs < 1 ||
          timeoutMs > limits.maxTimeoutMs
        )
          throw new SpriteNormalWorkerError(
            "invalidInput",
            "timeoutMs must be an integer in 1..120000",
          );
        if (signal?.aborted)
          return Promise.reject(
            new SpriteNormalWorkerError("aborted", "Generation was aborted"),
          );
        buffer = input.bytes.slice().buffer;
      } catch (error) {
        return Promise.reject(error);
      }
      if (pending)
        reject(
          "superseded",
          "A newer generation request superseded this request",
        );
      return new Promise((resolve, rejectPromise) => {
        const id = ++sequence;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const abort = () => {
          if (pending?.id === id) reject("aborted", "Generation was aborted");
        };
        const cleanup = () => {
          if (timer !== undefined) clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
        };
        try {
          const port = ensureWorker();
          pending = { id, job, resolve, reject: rejectPromise, cleanup };
          timer = setTimeout(() => {
            if (pending?.id === id)
              reject(
                "timeout",
                "Generation exceeded its time budget; worker terminated",
              );
          }, timeoutMs);
          signal?.addEventListener("abort", abort, {
            once: true,
          });
          if (signal?.aborted) {
            abort();
            return;
          }
          const request: NormalWorkerRequest = {
            format: NORMAL_WORKER_FORMAT,
            version: 1,
            id,
            source,
            job,
            buffer,
            cacheBytes,
          };
          port.postMessage(request, [buffer]);
        } catch (error) {
          if (pending?.id === id)
            reject(
              "unavailable",
              String(error instanceof Error ? error.message : error),
            );
          else {
            cleanup();
            terminate();
            rejectPromise(
              error instanceof Error ? error : new Error(String(error)),
            );
          }
        }
      });
    },
    cancel() {
      if (pending) reject("aborted", "Generation was cancelled");
    },
    clearCache() {
      reject("aborted", "Generator cache was cleared");
    },
    destroy() {
      if (closed) return;
      closed = true;
      reject("destroyed", "Generator client was destroyed");
    },
  };
}
