import { deepEqual, equal, rejects, throws } from "node:assert/strict";
import { test } from "node:test";
import "./nativeRuntimeTestHelper.js";
import type { TextureLoadOptions } from "../src/colorManagement.js";
import { PixelMaskTerrain, type PixelMaskTerrainTextureUploadOptions } from "../src/pixelMaskTerrain.js";
import { rgbaFromAlpha } from "../src/pixelMaskTextureData.js";
import { TextureManager, type TextureManagerOptions } from "../src/textureManager.js";
import { WebGpuTextureStore, rgbaFromAlpha as compatibilityRgbaFromAlpha } from "../src/webgpuTextureStore.js";

type Backend = "webgl2" | "webgpu";
const backends: readonly Backend[] = ["webgl2", "webgpu"];

// Capture bytes at the platform upload boundary, including WebGPU row padding.
// Native GPU allocation and rendering remain covered by browser smoke.
function fixture(backend: Backend, options: TextureManagerOptions = {}) {
  let allocations = 0, releases = 0;
  const uploads: Uint8Array[] = [];
  const createTexture = () => {
    allocations++;
    return { createView: () => ({}), destroy: () => { releases++; } };
  };
  let manager: TextureManager | WebGpuTextureStore;
  if (backend === "webgl2") {
    const upload = (...args: unknown[]) => {
      if (args[8] instanceof Uint8Array) uploads.push(args[8].slice());
    };
    const gl = {
      COMPRESSED_TEXTURE_FORMATS: 1, MAX_TEXTURE_SIZE: 2,
      getExtension: () => ({}), getParameter: (parameter: number) => parameter === 1 ? new Uint32Array([0x8e8c, 0x8e8d]) : 4096,
      createTexture, deleteTexture: () => { releases++; },
      bindTexture() {}, texParameteri() {}, pixelStorei() {},
      texImage2D: upload, texSubImage2D: upload,
    } as unknown as WebGL2RenderingContext;
    manager = new TextureManager(gl, "legacy", options);
  } else {
    const globals = globalThis as typeof globalThis & { GPUTextureUsage?: typeof GPUTextureUsage };
    globals.GPUTextureUsage = {
      COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16,
    };
    const device = {
      createTexture, createBindGroup: () => ({}),
      queue: {
        copyExternalImageToTexture() {},
        writeTexture(_destination: unknown, bytes: Uint8Array, layout: { bytesPerRow: number }, size: { width: number; height: number }) {
          const compact = new Uint8Array(size.width * size.height * 4);
          for (let row = 0; row < size.height; row++)
            compact.set(bytes.subarray(row * layout.bytesPerRow, row * layout.bytesPerRow + size.width * 4), row * size.width * 4);
          uploads.push(compact);
        },
      },
    } as unknown as GPUDevice;
    manager = new WebGpuTextureStore(device, {} as GPUSampler, {} as GPUBindGroupLayout);
  }
  return {
    manager, uploads, allocations: () => allocations, releases: () => releases,
    texture: (id: number) => manager instanceof TextureManager ? manager.texture(id) : manager.resource(id).texture,
    colorSpace: (id: number) => manager instanceof TextureManager ? manager.textureInfo(id)?.colorSpace : manager.resource(id).colorSpace,
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function observedController() {
  const controller = new AbortController(), signal = controller.signal;
  const listeners = new Set<unknown>();
  const add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
    if (type === "abort") listeners.add(listener);
    add(type, listener, options);
  };
  signal.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => {
    if (type === "abort") listeners.delete(listener);
    remove(type, listener, options);
  };
  return { controller, signal, listeners };
}

async function withImages(run: (images: {
  signals: AbortSignal[];
  decode: (index: number) => Promise<Deferred<ImageBitmap>>;
  bitmap: () => ImageBitmap;
  closed: () => number;
  failFetch: () => void;
}) => Promise<void>) {
  const fetch = globalThis.fetch, bitmap = globalThis.createImageBitmap;
  const signals: AbortSignal[] = [];
  const started: Deferred<Deferred<ImageBitmap>>[] = [];
  const slot = (index: number) => started[index] ??= deferred<Deferred<ImageBitmap>>();
  let count = 0, closed = 0, failFetch = false;
  globalThis.fetch = async (_url, options) => {
    signals.push(options!.signal!);
    if (failFetch) throw new Error("fetch failed");
    return new Response(new Uint8Array([1]));
  };
  globalThis.createImageBitmap = () => {
    const decoding = deferred<ImageBitmap>();
    slot(count++).resolve(decoding);
    return decoding.promise;
  };
  try {
    await run({ signals, decode: (index) => slot(index).promise,
      bitmap: () => ({ width: 2, height: 2, close: () => { closed++; } }) as ImageBitmap,
      closed: () => closed, failFetch: () => { failFetch = true; } });
  } finally { globalThis.fetch = fetch; globalThis.createImageBitmap = bitmap; }
}

test("shared terrain bytes retain the WebGPU export, defaults, rounding and alpha clamping", () => {
  equal(compatibilityRgbaFromAlpha, rgbaFromAlpha);
  deepEqual(Array.from(rgbaFromAlpha(2, 1, new Uint8Array([0, 255]))), [255, 255, 255, 0, 255, 255, 255, 255]);
  deepEqual(Array.from(rgbaFromAlpha(2, 1, new Uint8Array([1, 128]), {
    color: [12.2, 34.6, 56.1], alphaScale: 1.5,
  })), [12, 35, 56, 2, 12, 35, 56, 192]);
  deepEqual(Array.from(rgbaFromAlpha(1, 1, new Uint8Array([255]), { alphaScale: 0 })), [255, 255, 255, 0]);
});

for (const backend of backends) {
  test(`${backend} terrain creation and patch uploads preserve the same unpremultiplied RGBA bytes`, () => {
    const f = fixture(backend);
    try {
      f.manager.createPixelMaskTerrainTexture(1, new PixelMaskTerrain({ width: 2, height: 2, data: [0, 1, 128, 255] }), {
        color: [12.2, 34.6, 56.1], alphaScale: 1.5,
      });
      deepEqual(Array.from(f.uploads[0]), [12, 35, 56, 0, 12, 35, 56, 2, 12, 35, 56, 192, 12, 35, 56, 255]);
      f.manager.updatePixelMaskTerrainTexture(1, { rect: { x: 1, y: 0, width: 1, height: 2 }, alpha: new Uint8Array([3, 255]) }, {
        color: [0, 127.5, 255], alphaScale: 0.5,
      });
      deepEqual(Array.from(f.uploads[1]), [0, 128, 255, 2, 0, 128, 255, 128]);
    } finally { f.manager.destroy(); }
  });

  test(`${backend} rejects invalid shared terrain bytes before allocation or patch upload`, () => {
    const f = fixture(backend), terrain = new PixelMaskTerrain({ width: 1, height: 1, data: [255] });
    const invalid: [PixelMaskTerrainTextureUploadOptions, RegExp][] = [
      [{ color: [-1, 0, 0] }, /pixelMaskTerrain\.texture\.color\[0\] must be between 0 and 255\./],
      [{ color: [0, NaN, 0] }, /pixelMaskTerrain\.texture\.color\[1\] must be between 0 and 255\./],
      [{ color: [0, 0, Infinity] }, /pixelMaskTerrain\.texture\.color\[2\] must be between 0 and 255\./],
      [{ alphaScale: -1 }, /pixelMaskTerrain\.texture\.alphaScale must be a non-negative finite number\./],
      [{ alphaScale: Infinity }, /pixelMaskTerrain\.texture\.alphaScale must be a non-negative finite number\./],
    ];
    try {
      for (const [options, expected] of invalid) {
        throws(() => rgbaFromAlpha(1, 1, terrain.data, options), expected);
        throws(() => f.manager.createPixelMaskTerrainTexture(1, terrain, options), expected);
      }
      equal(f.allocations(), 0);
      f.manager.createPixelMaskTerrainTexture(1, terrain);
      throws(() => f.manager.updatePixelMaskTerrainTexture(1, { rect: { x: 0, y: 0, width: 1, height: 1 }, alpha: new Uint8Array() }),
        /pixel mask terrain alpha length must equal width \* height\./);
      equal(f.uploads.length, 1);
    } finally { f.manager.destroy(); }
  });

  test(`${backend} pre-aborted loads do not fetch, attach listeners or allocate`, async () => {
    const f = fixture(backend), external = observedController();
    try {
      external.controller.abort();
      await withImages(async (images) => {
        await rejects(f.manager.loadTexture(1, "pre-aborted.png", { signal: external.signal }), /AbortError/);
        equal(images.signals.length, 0); equal(external.listeners.size, 0); equal(f.allocations(), 0);
      });
    } finally { f.manager.destroy(); }
  });

  test(`${backend} closes late decode results and releases listeners after cancellation, eviction and destruction`, async () => {
    for (const operation of ["signal", "evict", "destroy"]) {
      const f = fixture(backend), external = observedController();
      try {
        await withImages(async (images) => {
          const loading = f.manager.loadTexture(1, "late.png", { signal: external.signal });
          const decoding = await images.decode(0);
          equal(external.listeners.size, 1);
          if (operation === "signal") external.controller.abort();
          if (operation === "evict") f.manager.evictTexture(1);
          if (operation === "destroy") f.manager.destroy();
          equal(images.signals[0].aborted, true);
          decoding.resolve(images.bitmap());
          await rejects(loading, /AbortError/);
          equal(images.closed(), 1); equal(f.allocations(), 0); equal(external.listeners.size, 0);
        });
      } finally { f.manager.destroy(); }
    }
  });

  test(`${backend} successful loads clean up the original signal even if caller options change`, async () => {
    const f = fixture(backend), external = observedController(), replacement = observedController();
    const options: TextureLoadOptions = { signal: external.signal };
    try {
      await withImages(async (images) => {
        const loading = f.manager.loadTexture(1, "success.png", options), decoding = await images.decode(0);
        options.signal = replacement.signal;
        decoding.resolve(images.bitmap());
        const texture = await loading;
        equal(f.texture(1), texture); equal(images.closed(), 1); equal(f.allocations(), 1);
        equal(external.listeners.size, 0); equal(replacement.listeners.size, 0);
        external.controller.abort(); replacement.controller.abort();
        equal(f.texture(1), texture);
      });
    } finally { f.manager.destroy(); }
    equal(f.releases(), 1);
  });

  test(`${backend} fetch and decode failures release their external abort listeners`, async () => {
    for (const phase of ["fetch", "decode"]) {
      const f = fixture(backend), external = observedController();
      try {
        await withImages(async (images) => {
          if (phase === "fetch") images.failFetch();
          const loading = f.manager.loadTexture(1, "failure.png", { signal: external.signal });
          const rejected = rejects(loading, /failed/);
          if (phase === "decode") (await images.decode(0)).reject(new Error("decode failed"));
          await rejected;
          equal(external.listeners.size, 0); equal(f.allocations(), 0); equal(images.closed(), 0);
        });
      } finally { f.manager.destroy(); }
    }
  });

  test(`${backend} stale request cleanup leaves a newer same-ID load cancellable`, async () => {
    const f = fixture(backend), firstSignal = observedController(), secondSignal = observedController();
    try {
      await withImages(async (images) => {
        const first = f.manager.loadTexture(1, "first.png", { signal: firstSignal.signal });
        const firstDecode = await images.decode(0);
        const second = f.manager.loadTexture(1, "second.png", { signal: secondSignal.signal });
        const secondDecode = await images.decode(1);
        equal(images.signals[0].aborted, true); equal(images.signals[1].aborted, false);
        firstDecode.resolve(images.bitmap());
        await rejects(first, /AbortError/);
        equal(firstSignal.listeners.size, 0); equal(secondSignal.listeners.size, 1);
        equal(images.signals[1].aborted, false);
        f.manager.evictTexture(1);
        equal(images.signals[1].aborted, true);
        secondDecode.resolve(images.bitmap());
        await rejects(second, /AbortError/);
        equal(secondSignal.listeners.size, 0); equal(images.closed(), 2); equal(f.allocations(), 0);
      });
    } finally { f.manager.destroy(); }
  });
}

for (const backend of backends) {
  test(`${backend} tracks the newest same-ID request started inside an abort listener`, async () => {
    const f = fixture(backend), savedFetch = globalThis.fetch, savedBitmap = globalThis.createImageBitmap;
    const calls: string[] = [], responses: (() => void)[] = [];
    let latest: Promise<unknown> | undefined;
    globalThis.fetch = (url, options) => new Promise<Response>((resolve, reject) => {
      calls.push(String(url)); responses.push(() => resolve(new Response(new Uint8Array([1]))));
      options!.signal!.addEventListener("abort", () => {
        if (url === "first.png") latest = f.manager.loadTexture(1, "latest.png");
        reject(new DOMException("aborted", "AbortError"));
      }, { once: true });
    });
    globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} }) as ImageBitmap;
    try {
      const first = f.manager.loadTexture(1, "first.png");
      const middle = f.manager.loadTexture(1, "middle.png");
      // Eviction must reach the request started by the synchronous abort callback.
      f.manager.evictTexture(1);
      responses.forEach((complete) => complete());
      const outcomes = await Promise.allSettled([first, middle, latest!]);
      deepEqual(outcomes.map((outcome) => outcome.status), ["rejected", "rejected", "rejected"]);
      deepEqual(calls, ["first.png", "latest.png"]);
      equal(f.allocations(), 0);
    } finally { f.manager.destroy(); globalThis.fetch = savedFetch; globalThis.createImageBitmap = savedBitmap; }
  });

  test(`${backend} successful registration does not abort its own load signal`, async () => {
    const f = fixture(backend); let aborts = 0;
    try {
      await withImages(async (images) => {
        const loading = f.manager.loadTexture(1, "success.png"), decoding = await images.decode(0);
        images.signals[0].addEventListener("abort", () => { aborts++; f.manager.destroy(); });
        decoding.resolve(images.bitmap());
        const texture = await loading;
        equal(aborts, 0); equal(images.signals[0].aborted, false);
        equal(f.texture(1), texture); equal(f.releases(), 0);
      });
    } finally { f.manager.destroy(); }
    equal(f.allocations(), f.releases());
  });

  test(`${backend} synchronous replacement cannot register after a reentrant destroy`, async () => {
    const f = fixture(backend);
    try {
      await withImages(async (images) => {
        const loading = f.manager.loadTexture(1, "pending.png"), decoding = await images.decode(0);
        images.signals[0].addEventListener("abort", () => f.manager.destroy());
        let failure: unknown;
        try { f.manager.createPixelMaskTerrainTexture(1, new PixelMaskTerrain({ width: 1, height: 1 })); }
        catch (error) { failure = error; }
        decoding.resolve(images.bitmap());
        await rejects(loading, /AbortError/);
        equal(/AbortError|destroyed/.test(String(failure)), true);
        equal(f.allocations(), f.releases());
      });
    } finally { f.manager.destroy(); }
    equal(f.allocations(), f.releases());
  });

  test(`${backend} reentrant synchronous replacement wins and releases the superseded allocation`, async () => {
    const f = fixture(backend);
    try {
      await withImages(async (images) => {
        const loading = f.manager.loadTexture(1, "pending.png"), decoding = await images.decode(0);
        let latest: unknown;
        images.signals[0].addEventListener("abort", () => {
          latest = f.manager.createPixelMaskTerrainTexture(1, new PixelMaskTerrain({ width: 1, height: 1, fill: "solid" }));
        });
        let failure: unknown;
        try { f.manager.createPixelMaskTerrainTexture(1, new PixelMaskTerrain({ width: 1, height: 1 })); }
        catch (error) { failure = error; }
        decoding.resolve(images.bitmap());
        await rejects(loading, /AbortError/);
        equal(/AbortError/.test(String(failure)), true);
        equal(f.texture(1), latest); equal(f.allocations(), 2); equal(f.releases(), 1);
      });
    } finally { f.manager.destroy(); }
    equal(f.allocations(), f.releases());
  });

  test(`${backend} captures color space before asynchronous decode`, async () => {
    const f = fixture(backend), options: TextureLoadOptions = { colorSpace: "none" };
    try {
      await withImages(async (images) => {
        const loading = f.manager.loadTexture(1, "normal.png", options), decoding = await images.decode(0);
        options.colorSpace = "srgb";
        decoding.resolve(images.bitmap()); await loading;
        equal(f.colorSpace(1), "none");
      });
    } finally { f.manager.destroy(); }
  });

  test(`${backend} eviction does not erase a newer texture registered by an abort listener`, async () => {
    const f = fixture(backend);
    try {
      await withImages(async (images) => {
        const loading = f.manager.loadTexture(1, "pending.png"), decoding = await images.decode(0);
        let latest: unknown;
        images.signals[0].addEventListener("abort", () => {
          latest = f.manager.createPixelMaskTerrainTexture(1, new PixelMaskTerrain({ width: 1, height: 1 }));
        });
        const evicted = f.manager.evictTexture(1);
        decoding.resolve(images.bitmap()); await rejects(loading, /AbortError/);
        equal(evicted, false); equal(f.texture(1), latest); equal(f.releases(), 0);
      });
    } finally { f.manager.destroy(); }
    equal(f.allocations(), f.releases());
  });

  test(`${backend} failed HTTP responses cancel their bodies and retain HTTP errors when cleanup fails`, async () => {
    for (const cleanupFails of [false, true]) {
      const f = fixture(backend); let cancelled = 0;
      try {
        await withImages(async () => {
          const body = new ReadableStream<Uint8Array>({ cancel() { cancelled++; if (cleanupFails) throw Error("cleanup failed"); } });
          globalThis.fetch = async () => new Response(body, { status: 503, statusText: "Unavailable" });
          await rejects(f.manager.loadTexture(1, "http-error.png"), /HTTP 503 Unavailable/);
          equal(cancelled, 1); equal(body.locked, false); equal(f.allocations(), 0);
        });
      } finally { f.manager.destroy(); }
    }
  });
}

test("WebGL KTX2 HTTP fallback cancels the failed body and preserves its diagnostic", async () => {
  for (const cleanupFails of [false, true]) {
    const reasons: unknown[] = [], f = fixture("webgl2", { onKtx2Fallback: ({ reason }) => reasons.push(reason) });
    let cancelled = 0;
    try {
      await withImages(async (images) => {
        const body = new ReadableStream<Uint8Array>({ cancel() { cancelled++; if (cleanupFails) throw Error("cleanup failed"); } });
        globalThis.fetch = async (url) => String(url).endsWith(".ktx2")
          ? new Response(body, { status: 503 }) : new Response(new Uint8Array([1]));
        const loading = f.manager.loadTexture(1, "fallback.png", { ktx2Url: "error.ktx2" });
        (await images.decode(0)).resolve(images.bitmap()); await loading;
        equal(cancelled, 1); equal(reasons.length, 1); equal(/HTTP 503/.test(String(reasons[0])), true);
      });
    } finally { f.manager.destroy(); }
  }
});

test("WebGPU placeholder creation rejects after destruction without allocating", () => {
  const f = fixture("webgpu"); f.manager.destroy();
  throws(() => f.manager.createPlaceholderTextureForId(0), /destroyed/);
  equal(f.allocations(), 0);
});

test("WebGL texture size metadata stays at the validated dimensions after caller or abort-listener mutation", async () => {
  for (const duringAbort of [false, true]) {
    const f = fixture("webgl2"), manager = f.manager as TextureManager, size = { width: 2, height: 2 };
    try {
      await withImages(async (images) => {
        // External texture dimensions are learned solely from setTexture(size).
        const texture: WebGLTexture = {};
        const pending = duringAbort ? manager.loadTexture(7, "pending.png") : undefined;
        const decoding = duringAbort ? await images.decode(0) : undefined;
        if (duringAbort) images.signals[0].addEventListener("abort", () => { size.width = 4; size.height = 4; });
        manager.setTexture(7, texture, size);
        size.width = 4; size.height = 4;
        if (decoding) { decoding.resolve(images.bitmap()); await rejects(pending!, /AbortError/); }
        equal(manager.resourceStats().textureBytes, 16);
        throws(() => manager.updatePixelMaskTerrainTexture(7, { rect: { x: 3, y: 0, width: 1, height: 1 }, alpha: new Uint8Array([255]) }), /outside the texture bounds/);
        equal(f.uploads.length, 0);
      });
    } finally { manager.destroy(); }
  }
});
