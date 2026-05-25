import { equal, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  PHYSICS_REPLAY_INPUT_STREAM_FORMAT,
  PHYSICS_REPLAY_INPUT_STREAM_VERSION,
  PHYSICS_WORLD_SNAPSHOT_FORMAT,
  PHYSICS_WORLD_SNAPSHOT_VERSION,
  createPhysicsReplayInputStream,
} from "../src/physicsSnapshot.js";
import type {
  PhysicsReplayInputRunResult,
  PhysicsWorldSnapshot,
} from "../src/physicsSnapshot.js";
import {
  PHYSICS_REPLAY_WORKER_REQUEST_FORMAT,
  PHYSICS_REPLAY_WORKER_RESPONSE_FORMAT,
  PHYSICS_REPLAY_WORKER_VERSION,
  PhysicsReplayWorkerClient,
} from "../src/physicsReplayWorker.js";
import type {
  PhysicsReplayWorkerRequest,
  PhysicsReplayWorkerResponse,
} from "../src/physicsReplayWorker.js";
import { resolvePhysicsSpec } from "../src/physicsSpec.js";

test("PhysicsReplayWorkerClient sends replay requests and resolves matching responses", async () => {
  const worker = new FakeWorkerPort();
  const client = new PhysicsReplayWorkerClient(worker);
  const snapshot = emptySnapshot();
  const inputStream = createPhysicsReplayInputStream({ frameCount: 2, fixedStepSeconds: 1 / 60 });

  const promise = client.runReplay(snapshot, inputStream, { path: "worker.replay", timeoutMs: 1000 });
  const request = worker.lastMessage();
  equal(request.format, PHYSICS_REPLAY_WORKER_REQUEST_FORMAT);
  equal(request.version, PHYSICS_REPLAY_WORKER_VERSION);
  if (request.kind !== "runReplay") {
    throw new Error("Expected runReplay worker request.");
  }
  equal(request.options?.path, "worker.replay");

  worker.emit({
    format: PHYSICS_REPLAY_WORKER_RESPONSE_FORMAT,
    version: PHYSICS_REPLAY_WORKER_VERSION,
    id: request.id,
    kind: "runReplay",
    ok: true,
    result: replayRunResult(snapshot),
    elapsedMs: 1.5,
  });

  const result = await promise;
  equal(result.result.replayHash, "worker-hash");
  equal(result.elapsedMs, 1.5);
  client.destroy();
}
);

test("PhysicsReplayWorkerClient benchmarks transferable buffers", async () => {
  const worker = new FakeWorkerPort();
  const client = new PhysicsReplayWorkerClient(worker);
  const promise = client.benchmarkTransfer({ byteLength: 16, iterations: 1, timeoutMs: 1000 });
  const request = worker.lastMessage();

  if (request.kind !== "benchmarkTransfer") {
    throw new Error("Expected benchmarkTransfer worker request.");
  }
  equal(request.byteLength, 16);
  equal(worker.lastTransferCount(), 1);

  worker.emit({
    format: PHYSICS_REPLAY_WORKER_RESPONSE_FORMAT,
    version: PHYSICS_REPLAY_WORKER_VERSION,
    id: request.id,
    kind: "benchmarkTransfer",
    ok: true,
    byteLength: request.byteLength,
    buffer: new ArrayBuffer(request.byteLength),
    sentAtMs: request.sentAtMs,
    workerReceivedAtMs: request.sentAtMs + 1,
    workerSentAtMs: request.sentAtMs + 2,
  });

  const result = await promise;
  equal(result.byteLength, 16);
  equal(result.iterations, 1);
  equal(result.samples.length, 1);
  ok(result.samples[0].roundTripMs >= 0);
  client.destroy();
});

test("PhysicsReplayWorkerClient rejects worker failures", async () => {
  const worker = new FakeWorkerPort();
  const client = new PhysicsReplayWorkerClient(worker);
  const promise = client.runReplay(emptySnapshot(), createPhysicsReplayInputStream({ frameCount: 0 }), {
    timeoutMs: 1000,
  });
  const request = worker.lastMessage();

  worker.emit({
    format: PHYSICS_REPLAY_WORKER_RESPONSE_FORMAT,
    version: PHYSICS_REPLAY_WORKER_VERSION,
    id: request.id,
    kind: "runReplay",
    ok: false,
    error: { name: "WorkerError", message: "boom" },
  });

  await rejectsWithMessage(promise, "boom");
  client.destroy();
});

class FakeWorkerPort {
  private readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();
  private readonly messages: PhysicsReplayWorkerRequest[] = [];
  private transferCount = 0;

  postMessage(message: unknown, transfer?: Transferable[]): void {
    this.messages.push(message as PhysicsReplayWorkerRequest);
    this.transferCount = transfer?.length ?? 0;
  }

  addEventListener(_type: "message", listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "message", listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.delete(listener);
  }

  lastMessage(): PhysicsReplayWorkerRequest {
    const message = this.messages[this.messages.length - 1];
    if (message === undefined) {
      throw new Error("Expected worker message.");
    }
    return message;
  }

  lastTransferCount(): number {
    return this.transferCount;
  }

  emit(response: PhysicsReplayWorkerResponse): void {
    const event = { data: response } as MessageEvent<unknown>;
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

function emptySnapshot(): PhysicsWorldSnapshot {
  const spec = resolvePhysicsSpec({ mode: "rigid" });
  return {
    format: PHYSICS_WORLD_SNAPSHOT_FORMAT,
    version: PHYSICS_WORLD_SNAPSHOT_VERSION,
    frame: 0,
    source: "physics-spec",
    spec,
    stepSeconds: 1 / 60,
    stepOptions: {},
    bodies: {},
    joints: {},
    worldAnchors: [],
    bodyCount: 0,
    jointCount: 0,
    replayHash: "initial-hash",
  };
}

function replayRunResult(snapshot: PhysicsWorldSnapshot): PhysicsReplayInputRunResult {
  return {
    inputStream: {
      format: PHYSICS_REPLAY_INPUT_STREAM_FORMAT,
      version: PHYSICS_REPLAY_INPUT_STREAM_VERSION,
      frameCount: 2,
    },
    frameCount: 2,
    deltaSeconds: 1 / 60,
    replayHash: "worker-hash",
    snapshots: [],
    finalSnapshot: snapshot,
    stepStats: [],
  };
}

async function rejectsWithMessage(promise: Promise<unknown>, expected: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    equal(error instanceof Error ? error.message : String(error), expected);
    return;
  }
  throw new Error("Expected promise to reject.");
}
