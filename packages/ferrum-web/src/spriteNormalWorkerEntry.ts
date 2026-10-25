import { NormalGeneratorWorkerRuntime } from "./spriteNormalWorkerRuntime.js";
import {
  NORMAL_WORKER_FORMAT,
  SPRITE_NORMAL_WORKER_LIMITS as limits,
  SpriteNormalWorkerError,
  normalizeNormalGeneratorSource,
  normalizeNormalWorkerInput,
  type NormalWorkerRequest,
  type NormalWorkerResponse,
} from "./spriteNormalWorkerProtocol.js";

interface NormalWorkerScope {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}
const scope = self as unknown as NormalWorkerScope,
  runtime = new NormalGeneratorWorkerRuntime();
let busy = false;
scope.addEventListener("message", (event) => {
  void handle(event.data);
});
async function handle(value: unknown): Promise<void> {
  const data = value as Partial<NormalWorkerRequest>;
  if (
    !data ||
    data.format !== NORMAL_WORKER_FORMAT ||
    data.version !== 1 ||
    !Number.isSafeInteger(data.id)
  )
    return;
  const reply = (payload: NormalWorkerResponse) =>
    scope.postMessage(
      payload,
      payload.ok ? [payload.result.normalPng, payload.result.colorPng] : [],
    );
  const envelope = {
    format: NORMAL_WORKER_FORMAT,
    version: 1,
    id: data.id!,
  } as const;
  if (busy) {
    reply({
      ...envelope,
      ok: false,
      code: "invalidInput",
      message: "Only one job may run per worker",
    });
    return;
  }
  busy = true;
  try {
    if (
      !(data.buffer instanceof ArrayBuffer) ||
      !Number.isInteger(data.cacheBytes) ||
      data.cacheBytes! < 0 ||
      data.cacheBytes! > limits.cacheBytes
    )
      throw new SpriteNormalWorkerError(
        "invalidInput",
        "Invalid owned buffer or cache byte limit",
      );
    const source = normalizeNormalGeneratorSource(data.source!),
      job = normalizeNormalWorkerInput({
        ...data.job!,
        bytes: new Uint8Array(data.buffer),
      });
    const result = await runtime.run({
      ...data,
      source,
      job,
    } as NormalWorkerRequest);
    reply({ ...envelope, ok: true, result });
  } catch (error) {
    reply({
      ...envelope,
      ok: false,
      code:
        error instanceof SpriteNormalWorkerError
          ? error.code
          : "generationFailed",
      message: String(error instanceof Error ? error.message : error).slice(
        0,
        2000,
      ),
    });
  } finally {
    busy = false;
  }
}
