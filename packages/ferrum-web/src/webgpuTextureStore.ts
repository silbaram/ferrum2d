import { textureLoadAbortError } from "./ktx2Texture.js";
import { resolveTextureColorSpace } from "./colorManagement.js";
import type { TextureLoadOptions } from "./colorManagement.js";
import type {
  PixelMaskTerrain,
  PixelMaskTerrainAlphaPatch,
  PixelMaskTerrainTextureUploadOptions,
} from "./pixelMaskTerrain.js";

export interface WebGpuTextureResource {
  texture: GPUTexture;
  view: GPUTextureView;
  bindGroup: GPUBindGroup;
  width: number;
  height: number;
}

export interface WebGpuTextureWriteBytes {
  data: Uint8Array;
  bytesPerRow: number;
  rowsPerImage: number;
}

const TEXTURE_ROW_ALIGNMENT = 256;

export class WebGpuTextureStore {
  private readonly textures = new Set<GPUTexture>();
  private readonly texturesById = new Map<number, WebGpuTextureResource>();
  private readonly pendingLoads = new Set<AbortController>();
  private readonly pendingIds = new Map<number, AbortController>();
  private destroyed = false;

  constructor(
    private readonly device: GPUDevice,
    private readonly sampler: GPUSampler,
    private readonly textureBindGroupLayout: GPUBindGroupLayout,
  ) {}

  async load(url: string, options?: TextureLoadOptions): Promise<GPUTexture> {
    return this.loadManaged(url, options);
  }

  async loadTexture(textureId: number, url: string, options?: TextureLoadOptions): Promise<GPUTexture> {
    validateTextureId(textureId);
    return this.loadManaged(url, options, textureId);
  }

  private async loadManaged(url: string, options: TextureLoadOptions = {}, textureId?: number): Promise<GPUTexture> {
    this.assertAlive();
    resolveTextureColorSpace(options);
    if (options.signal?.aborted) throw textureLoadAbortError();
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    this.pendingLoads.add(controller);
    if (textureId !== undefined) {
      this.pendingIds.get(textureId)?.abort();
      this.pendingIds.set(textureId, controller);
    }
    try {
      // Native WebGPU currently uses the ordinary image fallback even when ktx2Url is present.
      const bitmap = await this.loadImageBitmap(url, options, controller.signal);
      try {
        if (this.destroyed || controller.signal.aborted) throw textureLoadAbortError();
        return this.createTextureFromSource(textureId, bitmap);
      } finally { bitmap.close(); }
    } catch (error) {
      if (this.destroyed || controller.signal.aborted) throw textureLoadAbortError();
      throw error;
    } finally {
      this.pendingLoads.delete(controller);
      if (textureId !== undefined && this.pendingIds.get(textureId) === controller) this.pendingIds.delete(textureId);
      options.signal?.removeEventListener("abort", abort);
    }
  }

  createPixelMaskTerrainTexture(
    textureId: number,
    terrain: PixelMaskTerrain,
    options: PixelMaskTerrainTextureUploadOptions = {},
  ): GPUTexture {
    this.assertAlive();
    return this.createTextureFromRgbaData(
      textureId,
      terrain.width,
      terrain.height,
      rgbaFromAlpha(terrain.width, terrain.height, terrain.data, options),
    );
  }

  updatePixelMaskTerrainTexture(
    textureId: number,
    patch: PixelMaskTerrainAlphaPatch,
    options: PixelMaskTerrainTextureUploadOptions = {},
  ): void {
    this.assertAlive();
    const resource = this.resource(textureId);
    if (
      patch.rect.x < 0
      || patch.rect.y < 0
      || patch.rect.x + patch.rect.width > resource.width
      || patch.rect.y + patch.rect.height > resource.height
    ) {
      throw new Error("Pixel mask terrain patch is outside the WebGPU texture bounds.");
    }
    const upload = textureWriteBytes(
      patch.rect.width,
      patch.rect.height,
      rgbaFromAlpha(patch.rect.width, patch.rect.height, patch.alpha, options),
    );
    this.device.queue.writeTexture(
      {
        texture: resource.texture,
        origin: { x: patch.rect.x, y: patch.rect.y },
      },
      upload.data,
      { bytesPerRow: upload.bytesPerRow, rowsPerImage: upload.rowsPerImage },
      { width: patch.rect.width, height: patch.rect.height, depthOrArrayLayers: 1 },
    );
  }

  createPlaceholderTextureForId(textureId: number): void {
    this.createTextureFromRgbaData(textureId, 1, 1, new Uint8Array([255, 255, 255, 255]));
  }

  evictTexture(textureId: number): boolean {
    this.assertAlive();
    validateTextureId(textureId);
    if (textureId === 0) {
      return false;
    }
    this.pendingIds.get(textureId)?.abort();
    const resource = this.texturesById.get(textureId);
    if (resource === undefined) {
      return false;
    }
    resource.texture.destroy();
    this.textures.delete(resource.texture);
    this.texturesById.delete(textureId);
    return true;
  }

  resource(textureId: number): WebGpuTextureResource {
    this.assertAlive();
    const resource = this.texturesById.get(textureId);
    if (resource === undefined) {
      throw new Error(`WebGPU texture ${textureId} is not loaded.`);
    }
    return resource;
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    for (const controller of this.pendingLoads) controller.abort();
    this.pendingLoads.clear();
    this.pendingIds.clear();
    for (const texture of this.textures) {
      texture.destroy();
    }
    this.textures.clear();
    this.texturesById.clear();
  }

  private async loadImageBitmap(url: string, options: TextureLoadOptions, signal: AbortSignal): Promise<ImageBitmap> {
    const colorSpace = resolveTextureColorSpace(options);
    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new Error(`Texture load failed: HTTP ${response.status} ${response.statusText}`.trim());
    }
    const blob = await response.blob();
    return colorSpace === "srgb" ? await createImageBitmap(blob)
      : await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  }

  private createTextureFromSource(textureId: number | undefined, source: ImageBitmap): GPUTexture {
    const texture = this.device.createTexture({
      size: { width: source.width, height: source.height, depthOrArrayLayers: 1 },
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture(
      { source },
      { texture },
      { width: source.width, height: source.height, depthOrArrayLayers: 1 },
    );
    if (textureId === undefined) {
      this.textures.add(texture);
      return texture;
    }
    this.setTexture(textureId, this.createTextureResource(texture, source.width, source.height));
    return texture;
  }

  private createTextureFromRgbaData(
    textureId: number,
    width: number,
    height: number,
    data: Uint8Array,
  ): GPUTexture {
    validateTextureId(textureId);
    const texture = this.device.createTexture({
      size: { width, height, depthOrArrayLayers: 1 },
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const upload = textureWriteBytes(width, height, data);
    this.device.queue.writeTexture(
      { texture },
      upload.data,
      { bytesPerRow: upload.bytesPerRow, rowsPerImage: upload.rowsPerImage },
      { width, height, depthOrArrayLayers: 1 },
    );
    this.setTexture(textureId, this.createTextureResource(texture, width, height));
    return texture;
  }

  private createTextureResource(texture: GPUTexture, width: number, height: number): WebGpuTextureResource {
    const view = texture.createView();
    const bindGroup = this.device.createBindGroup({
      layout: this.textureBindGroupLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: view },
      ],
    });
    return { texture, view, bindGroup, width, height };
  }

  private setTexture(textureId: number, resource: WebGpuTextureResource): void {
    validateTextureId(textureId);
    this.pendingIds.get(textureId)?.abort();
    const previous = this.texturesById.get(textureId);
    if (previous && previous.texture !== resource.texture) {
      previous.texture.destroy();
      this.textures.delete(previous.texture);
    }
    this.textures.add(resource.texture);
    this.texturesById.set(textureId, resource);
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error("WebGpuTextureStore has been destroyed.");
    }
  }
}

export function textureWriteBytes(
  width: number,
  height: number,
  rgba: Uint8Array,
): WebGpuTextureWriteBytes {
  const rowBytes = width * 4;
  const bytesPerRow = alignTo(rowBytes, TEXTURE_ROW_ALIGNMENT);
  if (bytesPerRow === rowBytes) {
    return { data: rgba, bytesPerRow, rowsPerImage: height };
  }

  const padded = new Uint8Array(bytesPerRow * height);
  for (let row = 0; row < height; row += 1) {
    const sourceStart = row * rowBytes;
    const sourceEnd = sourceStart + rowBytes;
    padded.set(rgba.subarray(sourceStart, sourceEnd), row * bytesPerRow);
  }
  return { data: padded, bytesPerRow, rowsPerImage: height };
}

export function rgbaFromAlpha(
  width: number,
  height: number,
  alpha: Uint8Array,
  options: PixelMaskTerrainTextureUploadOptions = {},
): Uint8Array {
  if (alpha.length !== width * height) {
    throw new Error("pixel mask terrain alpha length must equal width * height.");
  }
  const [rawR, rawG, rawB] = options.color ?? [255, 255, 255];
  const r = colorByte(rawR, "pixelMaskTerrain.texture.color[0]");
  const g = colorByte(rawG, "pixelMaskTerrain.texture.color[1]");
  const b = colorByte(rawB, "pixelMaskTerrain.texture.color[2]");
  const alphaScale = finitePositiveNumber(options.alphaScale ?? 1, "pixelMaskTerrain.texture.alphaScale");
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < alpha.length; index += 1) {
    const offset = index * 4;
    rgba[offset] = r;
    rgba[offset + 1] = g;
    rgba[offset + 2] = b;
    rgba[offset + 3] = Math.min(255, Math.round(alpha[index] * alphaScale));
  }
  return rgba;
}

function alignTo(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function colorByte(value: number, path: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 255) {
    throw new Error(`${path} must be between 0 and 255.`);
  }
  return Math.round(value);
}

function finitePositiveNumber(value: number, path: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${path} must be a non-negative finite number.`);
  }
  return value;
}

function validateTextureId(textureId: number): void {
  if (!Number.isInteger(textureId) || textureId < 0) {
    throw new Error("texture_id must be a non-negative integer.");
  }
}
