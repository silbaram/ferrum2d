import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { TextureManager } from "../src/textureManager.js";
import { selectWebGL2Ktx2Format } from "../src/webgl2CompressedTexture.js";
import { createKtx2Transcoder } from "../src/ktx2Transcoder.js";
import type { Ktx2TranscodedImage, Ktx2Transcoder, Ktx2TranscodeOptions } from "../src/ktx2Texture.js";
import { WebGpuTextureStore } from "../src/webgpuTextureStore.js";
import { assetManifestFingerprint } from "../src/assetPreload.js";

async function rejection(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  try { await promise; } catch (error) {
    equal(pattern.test(error instanceof Error ? `${error.name}: ${error.message}` : String(error)), true);
    return;
  }
  throw new Error(`Expected rejection: ${pattern}`);
}

const decoded = (): Ktx2TranscodedImage => ({ width: 8, height: 8, format: "bc7", data: new Uint8Array(64) });
function fixture(transcoder?: Ktx2Transcoder | false) {
  const deleted: WebGLTexture[] = [];
  const uploads: number[] = [];
  const fallback: unknown[] = [];
  let supported = new Uint32Array([0x8e8c, 0x8e8d]);
  const gl = {
    COMPRESSED_TEXTURE_FORMATS: 1, MAX_TEXTURE_SIZE: 2, NO_ERROR: 0, getError: () => 0,
    getExtension: () => ({}),
    getParameter: (parameter: number) => parameter === 1 ? supported : 4096,
    createTexture: () => ({}), deleteTexture: (texture: WebGLTexture) => deleted.push(texture),
    bindTexture: () => {}, texParameteri: () => {}, pixelStorei: () => {},
    texImage2D: () => uploads.push(256), compressedTexImage2D: (...args: unknown[]) => uploads.push((args[6] as Uint8Array).byteLength),
  } as unknown as WebGL2RenderingContext;
  return { gl, deleted, uploads, fallback, unsupported: () => { supported = new Uint32Array(); },
    manager: new TextureManager(gl, "linear-srgb", { ktx2: transcoder, onKtx2Fallback: (info) => fallback.push(info) }) };
}

async function withImages(action: (urls: string[], closed: () => number) => Promise<void>): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalBitmap = globalThis.createImageBitmap;
  const urls: string[] = [];
  let closed = 0;
  globalThis.fetch = async (url) => { urls.push(String(url)); return new Response(new Uint8Array(80)); };
  // This fake covers loading lifecycle only, not image decode or WebGL pixels.
  globalThis.createImageBitmap = async () => ({ width: 8, height: 8, close: () => { closed++; } } as ImageBitmap);
  try { await action(urls, () => closed); }
  finally { globalThis.fetch = originalFetch; globalThis.createImageBitmap = originalBitmap; }
}

test("KTX2 selects supported linear/sRGB formats and updates manifest identity", () => {
  const { gl, unsupported } = fixture();
  deepEqual(selectWebGL2Ktx2Format(gl, false), { format: "bc7", internalFormat: 0x8e8c });
  deepEqual(selectWebGL2Ktx2Format(gl, true), { format: "bc7", internalFormat: 0x8e8d });
  unsupported();
  equal(selectWebGL2Ktx2Format(gl, true), undefined);
  const base = { textures: { atlas: "atlas.png" } };
  const a = assetManifestFingerprint(base);
  const b = assetManifestFingerprint({ ...base, textureOptions: { atlas: { ktx2Url: "atlas.ktx2" } } });
  const c = assetManifestFingerprint({ ...base, textureOptions: { atlas: { ktx2Url: "atlas-v2.ktx2" } } });
  equal(a === b, false); equal(b === c, false);
});

test("KTX2 uploads compressed bytes once and does not destroy an injected shared transcoder", async () => {
  await withImages(async (urls, closed) => {
    let destroys = 0;
    const { manager, uploads } = fixture({ transcode: async () => decoded(), destroy: () => { destroys++; } });
    const texture = await manager.loadTexture(1, "atlas.png", { ktx2Url: "atlas.ktx2" });
    manager.setTexture(1, texture, { width: 8, height: 8 });
    deepEqual(urls, ["atlas.ktx2"]);
    deepEqual(uploads, [64]);
    equal(closed(), 0);
    equal(manager.resourceStats().textureBytes, 64);
    manager.evictTexture(1);
    equal(manager.resourceStats().textureBytes, 0);
    manager.destroy();
    equal(destroys, 0);
  });
});

test("unsupported formats, failed transcode and invalid output fall back to the image", async () => {
  for (const failure of ["capability", "decode", "dimensions"]) await withImages(async (urls, closed) => {
    const f = fixture({ transcode: async () => {
      if (failure === "decode") throw new Error("bad data");
      return { ...decoded(), width: -1 };
    }, destroy: () => {} });
    if (failure === "capability") f.unsupported();
    await f.manager.loadTexture(1, "atlas.png", { ktx2Url: "atlas.ktx2" });
    equal(urls[urls.length - 1], "atlas.png");
    deepEqual(f.uploads, [256]);
    equal(f.fallback.length, 1);
    equal(closed(), 1);
    equal(f.manager.resourceStats().textureBytes, 256);
    f.manager.destroy();
  });
});

test("destroy, evict and AbortSignal prevent late decoder results or image fallback", async () => {
  for (const operation of ["destroy", "evict", "signal"]) await withImages(async (urls) => {
    let resolve!: (image: Ktx2TranscodedImage) => void;
    let started!: () => void;
    const ready = new Promise<void>((done) => { started = done; });
    const f = fixture({ transcode: () => new Promise((done) => { resolve = done; started(); }), destroy: () => {} });
    const controller = new AbortController();
    const loading = f.manager.loadTexture(1, "atlas.png", { ktx2Url: "atlas.ktx2", signal: controller.signal });
    await ready;
    if (operation === "destroy") f.manager.destroy();
    if (operation === "evict") f.manager.evictTexture(1);
    if (operation === "signal") controller.abort();
    resolve(decoded());
    await rejection(loading, /AbortError/);
    deepEqual(urls, ["atlas.ktx2"]);
    deepEqual(f.uploads, []);
    equal(f.manager.resourceStats().textureCount, 0);
    f.manager.destroy();
  });
});

test("superseded texture loads cannot overwrite the latest result", async () => {
  await withImages(async () => {
    const completions: Array<(image: Ktx2TranscodedImage) => void> = [];
    const f = fixture({ transcode: () => new Promise((resolve) => { completions.push(resolve); }), destroy: () => {} });
    const first = f.manager.loadTexture(1, "old.png", { ktx2Url: "old.ktx2" });
    while (completions.length < 1) await new Promise((resolve) => setTimeout(resolve, 0));
    const second = f.manager.loadTexture(1, "new.png", { ktx2Url: "new.ktx2" });
    while (completions.length < 2) await new Promise((resolve) => setTimeout(resolve, 0));
    completions[1](decoded());
    const texture = await second;
    completions[0](decoded());
    await rejection(first, /AbortError/);
    equal(f.manager.texture(1), texture);
    deepEqual(f.uploads, [64]);
    f.manager.destroy();
  });
});

test("worker cancellation and destroy settle requests and release the owned Worker", async () => {
  const previous = globalThis.Worker;
  const workers: FakeWorker[] = [];
  class FakeWorker {
    onmessage?: (event: MessageEvent) => void;
    onerror?: (event: ErrorEvent) => void;
    onmessageerror?: () => void;
    terminated = false;
    requests: Array<{ id: number; data: Uint8Array }> = [];
    constructor() { workers.push(this); }
    postMessage(request: { id: number; data: Uint8Array }): void { this.requests.push(request); }
    terminate(): void { this.terminated = true; }
  }
  // Test replaces only the platform Worker boundary; production worker uses actual Basis in browser smoke.
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  const decoder = createKtx2Transcoder();
  const options: Ktx2TranscodeOptions = { format: "bc7", srgb: true, allowAlpha: true, maxDimension: 1024 };
  try {
    equal(workers.length, 0);
    const data = new Uint8Array(80);
    const first = decoder.transcode(data, options);
    equal(workers.length, 1);
    equal(workers[0].requests[0].data === data, false);
    workers[0].onmessage?.({ data: { id: 1, image: decoded() } } as MessageEvent);
    equal((await first).data.byteLength, 64);
    const controller = new AbortController();
    const cancelled = decoder.transcode(data, { ...options, signal: controller.signal });
    controller.abort();
    await rejection(cancelled, /AbortError/);
    equal(workers[0].terminated, true);
    const pending = decoder.transcode(data, options);
    decoder.destroy(); decoder.destroy();
    await rejection(pending, /AbortError/);
    equal(workers[1].terminated, true);
    await rejection(decoder.transcode(data, options), /AbortError/);
  } finally { decoder.destroy(); globalThis.Worker = previous; }
});


test("GPU rejection deletes the failed compressed texture before image fallback", async () => {
  await withImages(async () => {
    const f = fixture({ transcode: async () => decoded(), destroy: () => {} });
    f.gl.getError = () => 0x0502;
    await f.manager.loadTexture(1, "atlas.png", { ktx2Url: "atlas.ktx2" });
    equal(f.deleted.length, 1);
    equal(f.fallback.length, 1);
    equal(f.manager.resourceStats().textureBytes, 256);
    f.manager.destroy();
  });
});

test("oversized KTX2 responses cancel the response body before fallback", async () => {
  await withImages(async () => {
    const original = globalThis.fetch;
    let cancelled = false;
    globalThis.fetch = async (url, options) => String(url).endsWith(".ktx2")
      ? new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-length": String(65 * 1024 * 1024) } })
      : original(url, options);
    const f = fixture({ transcode: async () => { throw new Error("must not decode"); }, destroy: () => {} });
    await f.manager.loadTexture(1, "atlas.png", { ktx2Url: "atlas.ktx2" });
    equal(cancelled, true);
    deepEqual(f.uploads, [256]);
    f.manager.destroy();
  });
});

test("WebGPU chooses the image fallback and closes decode results cancelled before upload", async () => {
  for (const operation of ["signal", "evict", "destroy"]) await withImages(async (urls) => {
    let resolve!: (image: ImageBitmap) => void;
    let start!: () => void;
    const ready = new Promise<void>((done) => { start = done; });
    let closed = 0;
    globalThis.createImageBitmap = () => new Promise((done) => { resolve = done; start(); });
    const device = { createTexture: () => { throw new Error("late GPU upload"); } } as unknown as GPUDevice;
    const store = new WebGpuTextureStore(device, {} as GPUSampler, {} as GPUBindGroupLayout);
    const controller = new AbortController();
    const pending = store.loadTexture(1, "atlas.png", { ktx2Url: "atlas.ktx2", signal: controller.signal });
    await ready;
    if (operation === "signal") controller.abort();
    if (operation === "evict") store.evictTexture(1);
    if (operation === "destroy") store.destroy();
    resolve({ width: 8, height: 8, close: () => { closed++; } } as ImageBitmap);
    await rejection(pending, /AbortError/);
    deepEqual(urls, ["atlas.png"]);
    equal(closed, 1);
    store.destroy();
  });
});
