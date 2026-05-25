import { createEngine } from "./createEngine.js";
import {
  runPhysicsReplayInputStream,
  restorePhysicsWorldSnapshot,
} from "./physicsSnapshot.js";
import {
  PHYSICS_REPLAY_WORKER_REQUEST_FORMAT,
  PHYSICS_REPLAY_WORKER_RESPONSE_FORMAT,
  PHYSICS_REPLAY_WORKER_VERSION,
  type PhysicsReplayWorkerError,
  type PhysicsReplayWorkerRequest,
  type PhysicsReplayWorkerResponse,
} from "./physicsReplayWorker.js";

interface PhysicsReplayWorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const workerScope = self as unknown as PhysicsReplayWorkerScope;

workerScope.addEventListener("message", (event) => {
  void handleWorkerMessage(event.data);
});

async function handleWorkerMessage(data: unknown): Promise<void> {
  if (!isPhysicsReplayWorkerRequest(data)) {
    return;
  }

  if (data.kind === "benchmarkTransfer") {
    const receivedAtMs = performance.now();
    workerScope.postMessage({
      format: PHYSICS_REPLAY_WORKER_RESPONSE_FORMAT,
      version: PHYSICS_REPLAY_WORKER_VERSION,
      id: data.id,
      kind: "benchmarkTransfer",
      ok: true,
      byteLength: data.byteLength,
      buffer: data.buffer,
      sentAtMs: data.sentAtMs,
      workerReceivedAtMs: receivedAtMs,
      workerSentAtMs: performance.now(),
    } satisfies PhysicsReplayWorkerResponse, [data.buffer]);
    return;
  }

  const startedAtMs = performance.now();
  let engine: Awaited<ReturnType<typeof createEngine>> | undefined;
  try {
    engine = await createEngine(undefined, undefined, undefined, () => ({ width: 1, height: 1 }), {
      physicsMode: data.snapshot.spec.mode,
    });
    const restoredWorld = restorePhysicsWorldSnapshot(engine, data.snapshot);
    const result = runPhysicsReplayInputStream(engine, restoredWorld, data.inputStream, data.options);
    workerScope.postMessage({
      format: PHYSICS_REPLAY_WORKER_RESPONSE_FORMAT,
      version: PHYSICS_REPLAY_WORKER_VERSION,
      id: data.id,
      kind: "runReplay",
      ok: true,
      result,
      elapsedMs: Math.max(0, performance.now() - startedAtMs),
    } satisfies PhysicsReplayWorkerResponse);
  } catch (error) {
    workerScope.postMessage(failureResponse(data, error));
  } finally {
    engine?.destroy();
  }
}

function failureResponse(
  request: PhysicsReplayWorkerRequest,
  error: unknown,
): PhysicsReplayWorkerResponse {
  return {
    format: PHYSICS_REPLAY_WORKER_RESPONSE_FORMAT,
    version: PHYSICS_REPLAY_WORKER_VERSION,
    id: request.id,
    kind: request.kind,
    ok: false,
    error: workerError(error),
  };
}

function workerError(error: unknown): PhysicsReplayWorkerError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }
  return {
    name: "Error",
    message: String(error),
  };
}

function isPhysicsReplayWorkerRequest(value: unknown): value is PhysicsReplayWorkerRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as PhysicsReplayWorkerRequest;
  return (
    candidate.format === PHYSICS_REPLAY_WORKER_REQUEST_FORMAT
    && candidate.version === PHYSICS_REPLAY_WORKER_VERSION
    && typeof candidate.id === "string"
    && (candidate.kind === "runReplay" || candidate.kind === "benchmarkTransfer")
  );
}
