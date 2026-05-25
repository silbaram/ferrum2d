import type {
  PhysicsReplayInputRunOptions,
  PhysicsReplayInputRunResult,
  PhysicsReplayInputStream,
  PhysicsWorldSnapshot,
} from "./physicsSnapshot.js";

export const PHYSICS_REPLAY_WORKER_REQUEST_FORMAT = "ferrum2d.physics-replay.worker.request";
export const PHYSICS_REPLAY_WORKER_RESPONSE_FORMAT = "ferrum2d.physics-replay.worker.response";
export const PHYSICS_REPLAY_WORKER_VERSION = 1;

export type PhysicsReplayWorkerRequest =
  | PhysicsReplayWorkerRunRequest
  | PhysicsReplayWorkerTransferBenchmarkRequest;

export interface PhysicsReplayWorkerRequestBase {
  format: typeof PHYSICS_REPLAY_WORKER_REQUEST_FORMAT;
  version: typeof PHYSICS_REPLAY_WORKER_VERSION;
  id: string;
}

export interface PhysicsReplayWorkerRunRequest extends PhysicsReplayWorkerRequestBase {
  kind: "runReplay";
  snapshot: PhysicsWorldSnapshot;
  inputStream: PhysicsReplayInputStream;
  options?: PhysicsReplayInputRunOptions;
}

export interface PhysicsReplayWorkerTransferBenchmarkRequest extends PhysicsReplayWorkerRequestBase {
  kind: "benchmarkTransfer";
  byteLength: number;
  buffer: ArrayBuffer;
  sentAtMs: number;
}

export type PhysicsReplayWorkerResponse =
  | PhysicsReplayWorkerRunSuccessResponse
  | PhysicsReplayWorkerTransferBenchmarkSuccessResponse
  | PhysicsReplayWorkerFailureResponse;

export interface PhysicsReplayWorkerResponseBase {
  format: typeof PHYSICS_REPLAY_WORKER_RESPONSE_FORMAT;
  version: typeof PHYSICS_REPLAY_WORKER_VERSION;
  id: string;
}

export interface PhysicsReplayWorkerRunSuccessResponse extends PhysicsReplayWorkerResponseBase {
  kind: "runReplay";
  ok: true;
  result: PhysicsReplayInputRunResult;
  elapsedMs: number;
}

export interface PhysicsReplayWorkerTransferBenchmarkSuccessResponse extends PhysicsReplayWorkerResponseBase {
  kind: "benchmarkTransfer";
  ok: true;
  byteLength: number;
  buffer: ArrayBuffer;
  sentAtMs: number;
  workerReceivedAtMs: number;
  workerSentAtMs: number;
}

export interface PhysicsReplayWorkerFailureResponse extends PhysicsReplayWorkerResponseBase {
  kind: PhysicsReplayWorkerRequest["kind"];
  ok: false;
  error: PhysicsReplayWorkerError;
}

export interface PhysicsReplayWorkerError {
  name: string;
  message: string;
  stack?: string;
}

export interface PhysicsReplayWorkerPort {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  terminate?(): void;
}

export interface CreatePhysicsReplayWorkerClientOptions {
  worker?: PhysicsReplayWorkerPort;
  workerUrl?: URL | string;
  workerOptions?: WorkerOptions;
}

export interface PhysicsReplayWorkerRunOptions extends PhysicsReplayInputRunOptions {
  timeoutMs?: number;
}

export interface PhysicsReplayWorkerRunResult {
  result: PhysicsReplayInputRunResult;
  elapsedMs: number;
}

export interface PhysicsReplayWorkerTransferBenchmarkOptions {
  byteLength?: number;
  iterations?: number;
  timeoutMs?: number;
}

export interface PhysicsReplayWorkerTransferBenchmarkSample {
  byteLength: number;
  roundTripMs: number;
  workerQueueMs: number;
}

export interface PhysicsReplayWorkerTransferBenchmarkResult {
  byteLength: number;
  iterations: number;
  samples: readonly PhysicsReplayWorkerTransferBenchmarkSample[];
  averageRoundTripMs: number;
  maxRoundTripMs: number;
}

interface PendingRequest {
  kind: PhysicsReplayWorkerRequest["kind"];
  resolve: (response: PhysicsReplayWorkerResponse) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout> | undefined;
}

const DEFAULT_WORKER_TIMEOUT_MS = 10_000;
const DEFAULT_TRANSFER_BENCHMARK_BYTES = 1024 * 1024;
const DEFAULT_TRANSFER_BENCHMARK_ITERATIONS = 3;

export function createPhysicsReplayWorkerClient(
  options: CreatePhysicsReplayWorkerClientOptions = {},
): PhysicsReplayWorkerClient {
  return new PhysicsReplayWorkerClient(options.worker ?? createDefaultWorker(options));
}

export class PhysicsReplayWorkerClient {
  private readonly pending = new Map<string, PendingRequest>();
  private sequence = 0;
  private disposed = false;

  constructor(private readonly worker: PhysicsReplayWorkerPort) {
    this.worker.addEventListener("message", this.handleMessage);
  }

  async runReplay(
    snapshot: PhysicsWorldSnapshot,
    inputStream: PhysicsReplayInputStream,
    options: PhysicsReplayWorkerRunOptions = {},
  ): Promise<PhysicsReplayWorkerRunResult> {
    this.assertAlive();
    const response = await this.request({
      format: PHYSICS_REPLAY_WORKER_REQUEST_FORMAT,
      version: PHYSICS_REPLAY_WORKER_VERSION,
      id: this.nextId("replay"),
      kind: "runReplay",
      snapshot,
      inputStream,
      options: replayRunOptions(options),
    }, options.timeoutMs);

    if (response.kind !== "runReplay" || response.ok !== true) {
      throw new Error("Physics replay worker returned an invalid runReplay response.");
    }
    return {
      result: response.result,
      elapsedMs: response.elapsedMs,
    };
  }

  async benchmarkTransfer(
    options: PhysicsReplayWorkerTransferBenchmarkOptions = {},
  ): Promise<PhysicsReplayWorkerTransferBenchmarkResult> {
    this.assertAlive();
    const byteLength = positiveInteger(options.byteLength ?? DEFAULT_TRANSFER_BENCHMARK_BYTES, "byteLength");
    const iterations = positiveInteger(options.iterations ?? DEFAULT_TRANSFER_BENCHMARK_ITERATIONS, "iterations");
    const samples: PhysicsReplayWorkerTransferBenchmarkSample[] = [];

    for (let index = 0; index < iterations; index += 1) {
      const buffer = new ArrayBuffer(byteLength);
      const sentAtMs = performance.now();
      const response = await this.request({
        format: PHYSICS_REPLAY_WORKER_REQUEST_FORMAT,
        version: PHYSICS_REPLAY_WORKER_VERSION,
        id: this.nextId("benchmark"),
        kind: "benchmarkTransfer",
        byteLength,
        buffer,
        sentAtMs,
      }, options.timeoutMs, [buffer]);

      if (response.kind !== "benchmarkTransfer" || response.ok !== true) {
        throw new Error("Physics replay worker returned an invalid benchmarkTransfer response.");
      }
      const receivedAtMs = performance.now();
      samples.push({
        byteLength: response.byteLength,
        roundTripMs: Math.max(0, receivedAtMs - response.sentAtMs),
        workerQueueMs: Math.max(0, response.workerSentAtMs - response.workerReceivedAtMs),
      });
    }

    const roundTrips = samples.map((sample) => sample.roundTripMs);
    return {
      byteLength,
      iterations,
      samples,
      averageRoundTripMs: roundTrips.reduce((sum, value) => sum + value, 0) / roundTrips.length,
      maxRoundTripMs: Math.max(...roundTrips),
    };
  }

  destroy(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.worker.removeEventListener("message", this.handleMessage);
    for (const pending of this.pending.values()) {
      if (pending.timeoutId !== undefined) {
        clearTimeout(pending.timeoutId);
      }
      pending.reject(new Error("PhysicsReplayWorkerClient has been destroyed."));
    }
    this.pending.clear();
    this.worker.terminate?.();
  }

  private request(
    message: PhysicsReplayWorkerRequest,
    timeoutMs = DEFAULT_WORKER_TIMEOUT_MS,
    transfer?: Transferable[],
  ): Promise<PhysicsReplayWorkerResponse> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(message.id);
        reject(new Error(`Physics replay worker request '${message.id}' timed out.`));
      }, timeoutMs);
      this.pending.set(message.id, {
        kind: message.kind,
        resolve,
        reject,
        timeoutId,
      });
      try {
        this.worker.postMessage(message, transfer);
      } catch (error) {
        this.pending.delete(message.id);
        clearTimeout(timeoutId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private readonly handleMessage = (event: MessageEvent<unknown>): void => {
    const response = event.data;
    if (!isPhysicsReplayWorkerResponse(response)) {
      return;
    }
    const pending = this.pending.get(response.id);
    if (pending === undefined) {
      return;
    }
    this.pending.delete(response.id);
    if (pending.timeoutId !== undefined) {
      clearTimeout(pending.timeoutId);
    }
    if (response.ok) {
      pending.resolve(response);
      return;
    }
    pending.reject(workerResponseError(response.error));
  };

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  private assertAlive(): void {
    if (this.disposed) {
      throw new Error("PhysicsReplayWorkerClient has been destroyed.");
    }
  }
}

function createDefaultWorker(options: CreatePhysicsReplayWorkerClientOptions): PhysicsReplayWorkerPort {
  if (typeof Worker === "undefined") {
    throw new Error("Physics replay worker requires browser Worker support or an injected worker.");
  }
  return new Worker(
    options.workerUrl ?? new URL("./physicsReplayWorkerEntry.js", import.meta.url),
    { type: "module", ...options.workerOptions },
  );
}

function replayRunOptions(options: PhysicsReplayWorkerRunOptions): PhysicsReplayInputRunOptions | undefined {
  const { timeoutMs: _timeoutMs, ...replayOptions } = options;
  return Object.keys(replayOptions).length === 0 ? undefined : replayOptions;
}

function isPhysicsReplayWorkerResponse(value: unknown): value is PhysicsReplayWorkerResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as PhysicsReplayWorkerResponse;
  return (
    candidate.format === PHYSICS_REPLAY_WORKER_RESPONSE_FORMAT
    && candidate.version === PHYSICS_REPLAY_WORKER_VERSION
    && typeof candidate.id === "string"
    && (candidate.kind === "runReplay" || candidate.kind === "benchmarkTransfer")
    && typeof candidate.ok === "boolean"
  );
}

function workerResponseError(error: PhysicsReplayWorkerError): Error {
  const resolved = new Error(error.message);
  resolved.name = error.name || "PhysicsReplayWorkerError";
  if (error.stack !== undefined) {
    resolved.stack = error.stack;
  }
  return resolved;
}

function positiveInteger(value: number, label: string): number {
  if (Number.isInteger(value) && value > 0) {
    return value;
  }
  throw new Error(`physics replay worker ${label} must be a positive integer.`);
}
