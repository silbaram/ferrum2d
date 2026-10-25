import { deepEqual, equal, ok, rejects, throws } from "node:assert/strict";
import { test } from "node:test";
import {
  createSpriteNormalWorkerClient,
  SPRITE_NORMAL_WORKER_LIMITS,
  type SpriteNormalWorkerPort,
} from "../src/authoring.js";
import {
  NORMAL_WORKER_FORMAT,
  NORMAL_GENERATOR_REVISION,
  normalizeNormalWorkerInput,
  normalizeNormalGeneratorSource,
  type NormalWorkerRequest,
  type SpriteNormalWorkerResult,
} from "../src/spriteNormalWorkerProtocol.js";
import {
  NormalGeneratorWorkerRuntime,
  type LoadedNormalGenerator,
  type NormalWasmResult,
} from "../src/spriteNormalWorkerRuntime.js";
import { normalWorkerTiming } from "../src/spriteNormalWorkerOutput.js";

const png = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPwCgv6DwAD0gHyPaP/ZQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);
async function rejectsCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => undefined,
    (error) => error,
  );
  ok(error instanceof Error);
  equal((error as { code?: string }).code, code);
}
const source = {
  manifestUrl: "https://assets.test/normal/manifest.json",
  manifestSha256: "a".repeat(64),
};
const input = () => ({ name: "one.png", bytes: png.slice() });
function job(
  name = "one.png",
  cacheBytes = SPRITE_NORMAL_WORKER_LIMITS.cacheBytes,
): NormalWorkerRequest {
  return {
    format: NORMAL_WORKER_FORMAT,
    version: 1,
    id: 1,
    source,
    job: normalizeNormalWorkerInput({ ...input(), name }),
    buffer: png.slice().buffer,
    cacheBytes,
  };
}
function generator(options: { getterFails?: boolean } = {}) {
  const counts = {
    calls: 0,
    free: 0,
    loads: 0,
    settings: [] as Record<string, unknown>[],
  };
  const instance: LoadedNormalGenerator = {
    generate(_bytes, settings) {
      counts.calls++;
      counts.settings.push(JSON.parse(settings));
      return {
        get normal_png() {
          if (options.getterFails) throw new Error("getter failed");
          return png;
        },
        color_png: png,
        metadata: JSON.stringify({ width: 1, height: 1, animation: null }),
        free() {
          counts.free++;
        },
      } as NormalWasmResult;
    },
    memoryBytes: () => 65536,
    provenance: {
      repository: "https://github.com/Hugo-Dz/spritefusion-sprite-normals.git",
      revision: NORMAL_GENERATOR_REVISION,
      binarySha256: "b".repeat(64),
      manifestSha256: source.manifestSha256,
    },
  };
  return {
    counts,
    runtime: new NormalGeneratorWorkerRuntime(async () => {
      counts.loads++;
      return instance;
    }),
  };
}

test("worker input/settings and generator identity reject unsupported or unbounded data", () => {
  const settings = normalizeNormalWorkerInput(input()).settings;
  deepEqual(settings, {
    normalStrength: 1.5,
    detailStrength: 6,
    detailScale: 0.6,
    shapeStrength: 1.15,
    shapeRadius: 4,
    shapeSoftness: 1.15,
    alphaThreshold: 0.03,
  });
  for (const patch of [
    { name: "../bad.png" },
    { bytes: new Uint8Array() },
    { settings: null },
    { settings: { shapeRadius: 513 } },
    { settings: { alphaThreshold: NaN } },
    { settings: { directx: true } },
    { settings: { frameSize: { width: 0, height: 1 } } },
    { animation: {} },
    { animation: { loop: true, padding: 1 } },
    { animation: { loop: true, clipId: 65536 } },
  ])
    throws(() => normalizeNormalWorkerInput({ ...input(), ...patch } as never));
  for (const generator of [
    { ...source, manifestSha256: "bad" },
    { ...source, manifestUrl: "file:///a" },
    { ...source, manifestUrl: "https://user:pass@test/a" },
  ])
    throws(() => normalizeNormalGeneratorSource(generator));
});

test("worker runtime frees every result and cache transfers do not detach retained or caller bytes", async () => {
  const { runtime, counts } = generator(),
    request = job(),
    before = new Uint8Array(request.buffer).slice();
  const first = await runtime.run(request);
  equal(first.stats.cacheHit, false);
  equal(counts.calls, 1);
  equal(counts.free, 1);
  const received = structuredClone(first, {
    transfer: [first.normalPng, first.colorPng],
  });
  new Uint8Array(received.normalPng)[0] = 0;
  const again = await runtime.run(request);
  equal(again.stats.cacheHit, true);
  equal(new Uint8Array(again.normalPng)[0], 137);
  equal(counts.loads, 1);
  equal(counts.calls, 1);
  equal(counts.free, 1);
  deepEqual(new Uint8Array(request.buffer), before);
  const changed = job();
  changed.job.settings.shapeRadius = 8;
  await runtime.run(changed);
  equal(counts.calls, 2);
  equal(counts.free, 2);
  equal(counts.settings[0].shape_radius, 4);
  equal(counts.settings[0].shape_softness, 1.15);
  equal(counts.settings[0].alpha_threshold, 0.03);
});

test("worker cache obeys entry/byte budgets and disabling cache releases old entries", async () => {
  const { runtime } = generator();
  let last: SpriteNormalWorkerResult | undefined;
  for (let i = 0; i < 7; i++) last = await runtime.run(job(`name-${i}.png`));
  equal(last!.stats.cacheEntries, 4);
  ok(last!.stats.cacheBytes <= SPRITE_NORMAL_WORKER_LIMITS.cacheBytes);
  const uncached = await runtime.run(job("name-6.png", 0));
  equal(uncached.stats.cacheEntries, 0);
  equal(uncached.stats.cacheBytes, 0);
  equal(uncached.stats.cacheHit, false);
});

test("getter failure still frees native result; invalid frame grids do not load Wasm", async () => {
  const config = { getterFails: true },
    { runtime, counts } = generator(config);
  await rejects(runtime.run(job()), /getter failed/);
  equal(counts.free, 1);
  config.getterFails = false;
  const result = await runtime.run(job());
  equal(result.stats.generatorCalls, 2);
  equal(result.stats.freedResults, 2);
  const other = generator(),
    invalid = job();
  invalid.job.settings.frameSize = { width: 2, height: 1 };
  await rejects(other.runtime.run(invalid), /frame grid/);
  equal(other.counts.loads, 0);
});

test("browser timing conversion preserves CLI millisecond and fractional delays or rejects native overflow", () => {
  const gif = normalWorkerTiming([
    [50, 1],
    [90, 1],
    [120, 1],
    [60, 1],
  ]);
  deepEqual(gif.repeats, [5, 9, 12, 6]);
  equal(gif.nativeFps, 100);
  const apng = normalWorkerTiming([
    [1000, 12],
    [1000, 20],
    [1000, 30],
  ]);
  deepEqual(apng.tickMs, [50, 3]);
  deepEqual(apng.repeats, [5, 3, 2]);
  equal(apng.nativeFps, 60);
  for (const delays of [
    [[0, 1]],
    [
      [1, 1],
      [32, 1],
    ],
    [[1, 2]],
    [[1, 0]],
  ])
    throws(() => normalWorkerTiming(delays));
});

class FakePort {
  readonly listeners = new Map<string, Set<(event: never) => void>>();
  terminated = false;
  request?: NormalWorkerRequest;
  readonly runtime = generator().runtime;
  addEventListener(type: string, listener: (event: never) => void) {
    const list = this.listeners.get(type) ?? new Set();
    list.add(listener);
    this.listeners.set(type, list);
  }
  removeEventListener(type: string, listener: (event: never) => void) {
    this.listeners.get(type)?.delete(listener);
  }
  terminate() {
    this.terminated = true;
  }
  postMessage(message: NormalWorkerRequest, transfer: Transferable[]) {
    this.request = structuredClone(message, { transfer });
  }
  emit(data: unknown) {
    for (const fn of this.listeners.get("message") ?? []) fn({ data } as never);
  }
  async reply() {
    const request = this.request!,
      result = await this.runtime.run(request);
    this.emit(
      structuredClone(
        {
          format: NORMAL_WORKER_FORMAT,
          version: 1,
          id: request.id,
          ok: true,
          result,
        },
        { transfer: [result.normalPng, result.colorPng] },
      ),
    );
  }
}
function clientFixture() {
  const ports: FakePort[] = [];
  const client = createSpriteNormalWorkerClient({
    generator: source,
    workerFactory: () => {
      const port = new FakePort();
      ports.push(port);
      return port as unknown as SpriteNormalWorkerPort;
    },
  });
  return { client, ports };
}

test("client starts lazily, snapshots input bytes, reuses worker cache and clears it explicitly", async () => {
  const { client, ports } = clientFixture();
  equal(ports.length, 0);
  const original = input(),
    before = original.bytes.slice(),
    pending = client.generate(original);
  equal(ports.length, 1);
  deepEqual(original.bytes, before);
  ok(original.bytes.buffer.byteLength > 0);
  original.bytes[0] = 0;
  await ports[0].reply();
  await pending;
  const warm = client.generate(input());
  await ports[0].reply();
  equal((await warm).stats.cacheHit, true);
  client.clearCache();
  ok(ports[0].terminated);
  const fresh = client.generate(input());
  await ports[1].reply();
  equal((await fresh).stats.cacheHit, false);
  client.destroy();
  client.destroy();
  ok(ports[1].terminated);
  await rejectsCode(client.generate(input()), "destroyed");
});

test("new valid requests supersede old jobs, remove old listeners and ignore queued stale messages", async () => {
  const { client, ports } = clientFixture(),
    first = client.generate(input()),
    rejected = rejectsCode(first, "superseded");
  const stale = [...ports[0].listeners.get("message")!][0],
    next = client.generate(input());
  await rejected;
  ok(ports[0].terminated);
  equal(ports[0].listeners.get("message")!.size, 0);
  stale({
    data: {
      format: NORMAL_WORKER_FORMAT,
      version: 1,
      id: ports[0].request!.id,
      ok: true,
      result: {},
    },
  } as never);
  await ports[1].reply();
  await next;
  client.destroy();
});

test("invalid configuration does not cancel active work; AbortSignal and destroy terminate owned workers", async () => {
  const { client, ports } = clientFixture(),
    active = client.generate(input());
  await rejectsCode(
    client.generate({ ...input(), animation: {} as never }),
    "invalidInput",
  );
  equal(ports[0].terminated, false);
  await ports[0].reply();
  await active;
  const aborted = new AbortController();
  aborted.abort();
  await rejectsCode(
    client.generate(input(), { signal: aborted.signal }),
    "aborted",
  );
  equal(ports.length, 1);
  const controller = new AbortController(),
    pending = client.generate(input(), { signal: controller.signal }),
    rejected = rejectsCode(pending, "aborted");
  controller.abort();
  await rejected;
  ok(ports[0].terminated);
  const last = client.generate(input()),
    destroyed = rejectsCode(last, "destroyed");
  client.destroy();
  await destroyed;
  ok(ports[1].terminated);
});

test("timeout and malformed output reject once and recreate a usable worker", async () => {
  const { client, ports } = clientFixture();
  await rejectsCode(client.generate(input(), { timeoutMs: 5 }), "timeout");
  ok(ports[0].terminated);
  const pending = client.generate(input()),
    invalid = rejectsCode(pending, "resultInvalid");
  ports[1].emit({
    format: NORMAL_WORKER_FORMAT,
    version: 1,
    id: ports[1].request!.id,
    ok: true,
    result: { normalPng: new ArrayBuffer(2) },
  });
  await invalid;
  ok(ports[1].terminated);
  const good = client.generate(input());
  await ports[2].reply();
  await good;
  client.destroy();
});

test("request cleanup removes the original abort listener even if host options change", async () => {
  const { client, ports } = clientFixture(),
    controller = new AbortController();
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  let removals = 0;
  controller.signal.removeEventListener = (
    ...args: Parameters<AbortSignal["removeEventListener"]>
  ) => {
    removals++;
    remove(...args);
  };
  const options = { signal: controller.signal },
    pending = client.generate(input(), options);
  options.signal = new AbortController().signal;
  await ports[0].reply();
  await pending;
  equal(removals, 1);
  client.destroy();
});
