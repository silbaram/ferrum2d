import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { PixelMaskTerrain } from "../src/pixelMaskTerrain.js";
import { WebGpuTextureStore, rgbaFromAlpha, textureWriteBytes } from "../src/webgpuTextureStore.js";

interface CapturedWriteTextureCall {
  destination: unknown;
  data: Uint8Array;
  layout: {
    bytesPerRow: number;
    rowsPerImage: number;
  };
  size: unknown;
}

class FakeGpuTexture {
  destroyed = false;

  createView(): unknown {
    return { texture: this };
  }

  destroy(): void {
    this.destroyed = true;
  }
}

class FakeGpuQueue {
  readonly writeTextureCalls: CapturedWriteTextureCall[] = [];

  writeTexture(
    destination: unknown,
    data: Uint8Array,
    layout: { bytesPerRow: number; rowsPerImage: number },
    size: unknown,
  ): void {
    this.writeTextureCalls.push({ destination, data, layout, size });
  }

  copyExternalImageToTexture(): void {}
}

class FakeGpuDevice {
  readonly queue = new FakeGpuQueue();
  readonly textures: FakeGpuTexture[] = [];
  readonly bindGroups: unknown[] = [];

  createTexture(): GPUTexture {
    const texture = new FakeGpuTexture();
    this.textures.push(texture);
    return texture as unknown as GPUTexture;
  }

  createBindGroup(descriptor: unknown): GPUBindGroup {
    const bindGroup = { descriptor };
    this.bindGroups.push(bindGroup);
    return bindGroup as unknown as GPUBindGroup;
  }
}

test("textureWriteBytes reuses aligned RGBA rows without padding", () => {
  const rgba = new Uint8Array(64 * 2 * 4);
  const upload = textureWriteBytes(64, 2, rgba);
  equal(upload.data, rgba);
  equal(upload.bytesPerRow, 256);
  equal(upload.rowsPerImage, 2);
});

test("textureWriteBytes pads WebGPU rows to 256-byte alignment", () => {
  const rgba = new Uint8Array([
    1, 2, 3, 4,
    5, 6, 7, 8,
  ]);
  const upload = textureWriteBytes(1, 2, rgba);

  equal(upload.bytesPerRow, 256);
  equal(upload.rowsPerImage, 2);
  equal(upload.data.length, 512);
  deepEqual(Array.from(upload.data.slice(0, 4)), [1, 2, 3, 4]);
  deepEqual(Array.from(upload.data.slice(256, 260)), [5, 6, 7, 8]);
});

test("rgbaFromAlpha converts pixel mask alpha into tinted RGBA bytes", () => {
  const rgba = rgbaFromAlpha(2, 1, new Uint8Array([10, 200]), {
    color: [12.2, 34.6, 56.1],
    alphaScale: 1.5,
  });

  deepEqual(Array.from(rgba), [
    12, 35, 56, 15,
    12, 35, 56, 255,
  ]);
});

test("rgbaFromAlpha rejects invalid alpha data and upload options", () => {
  throwsWithMessage(
    () => rgbaFromAlpha(2, 2, new Uint8Array([1])),
    /alpha length/,
  );
  throwsWithMessage(
    () => rgbaFromAlpha(1, 1, new Uint8Array([1]), { color: [256, 0, 0] }),
    /color\[0\]/,
  );
  throwsWithMessage(
    () => rgbaFromAlpha(1, 1, new Uint8Array([1]), { alphaScale: Number.NaN }),
    /alphaScale/,
  );
});

test("WebGpuTextureStore replaces texture ids and destroys stale textures", () => {
  const { device, store } = createTextureStore();
  const terrain = new PixelMaskTerrain({ width: 1, height: 1, data: [255] });

  store.createPixelMaskTerrainTexture(3, terrain);
  const firstTexture = device.textures[0];
  const firstResource = store.resource(3);

  store.createPixelMaskTerrainTexture(3, terrain);

  equal(firstTexture.destroyed, true);
  equal(device.textures[1].destroyed, false);
  ok(store.resource(3) !== firstResource);
  store.destroy();
});

test("WebGpuTextureStore destroy releases registered textures exactly once", () => {
  const { device, store } = createTextureStore();
  store.createPixelMaskTerrainTexture(1, new PixelMaskTerrain({ width: 1, height: 1, data: [128] }));
  store.createPixelMaskTerrainTexture(2, new PixelMaskTerrain({ width: 1, height: 1, data: [64] }));

  store.destroy();
  store.destroy();

  equal(device.textures.length, 2);
  equal(device.textures.every((texture) => texture.destroyed), true);
});

test("WebGpuTextureStore update preserves padded WebGPU upload layout", () => {
  const { device, store } = createTextureStore();
  store.createPixelMaskTerrainTexture(9, new PixelMaskTerrain({ width: 2, height: 2, data: [1, 2, 3, 4] }));

  store.updatePixelMaskTerrainTexture(9, {
    rect: { x: 0, y: 1, width: 1, height: 1 },
    alpha: new Uint8Array([200]),
  });

  const patchUpload = device.queue.writeTextureCalls[1];
  equal(patchUpload.layout.bytesPerRow, 256);
  equal(patchUpload.layout.rowsPerImage, 1);
  equal(patchUpload.data.length, 256);
  deepEqual(Array.from(patchUpload.data.slice(0, 4)), [255, 255, 255, 200]);
});

test("WebGpuTextureStore rejects pixel mask patches outside texture bounds", () => {
  const { store } = createTextureStore();
  store.createPixelMaskTerrainTexture(4, new PixelMaskTerrain({ width: 2, height: 2, data: [1, 2, 3, 4] }));

  throwsWithMessage(
    () => store.updatePixelMaskTerrainTexture(4, {
      rect: { x: 1, y: 1, width: 2, height: 1 },
      alpha: new Uint8Array([255, 255]),
    }),
    /outside the WebGPU texture bounds/,
  );
});

function throwsWithMessage(run: () => void, expected: RegExp): void {
  try {
    run();
  } catch (error) {
    ok(expected.test(error instanceof Error ? error.message : String(error)));
    return;
  }
  throw new Error(`Expected callback to throw ${expected}.`);
}

function createTextureStore(): { device: FakeGpuDevice; store: WebGpuTextureStore } {
  installWebGpuGlobals();
  const device = new FakeGpuDevice();
  return {
    device,
    store: new WebGpuTextureStore(
      device as unknown as GPUDevice,
      {} as GPUSampler,
      {} as GPUBindGroupLayout,
    ),
  };
}

function installWebGpuGlobals(): void {
  const globals = globalThis as typeof globalThis & {
    GPUTextureUsage?: typeof GPUTextureUsage;
  };
  globals.GPUTextureUsage = {
    COPY_SRC: 1,
    COPY_DST: 2,
    TEXTURE_BINDING: 4,
    STORAGE_BINDING: 8,
    RENDER_ATTACHMENT: 16,
  };
}
