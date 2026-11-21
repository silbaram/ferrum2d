import { registerTextureFileOwner, captureResourceSource, fileResourceBlob, type ResourceTextureData, type ResourceTextureEntry } from "./nativeFileResourceOwners.js";
import { ResourceBudget, NativeFileResourceError, resourceInteger } from "./nativeFileResourceBudget.js";
import { copyFileTextureData } from "./nativeFileResourceTextures.js";
import { readFileWebGpuTexture } from "./nativeFileResourceWebGpu.js";
import { webGpuResources } from "./webgpuResources.js";
import { createAssetLoadScope } from "./assetLoadTasks.js";
import { rgbaFromAlpha } from "./pixelMaskTextureData.js";
import { textureLoadAbortError } from "./ktx2Texture.js";
import { resolveTextureColorSpace } from "./colorManagement.js";
import type { TextureLoadOptions, TextureColorSpace } from "./colorManagement.js";
import type {
  PixelMaskTerrain,
  PixelMaskTerrainAlphaPatch,
  PixelMaskTerrainTextureUploadOptions,
} from "./pixelMaskTerrain.js";

export { rgbaFromAlpha } from "./pixelMaskTextureData.js";

export interface WebGpuTextureResource {
  texture: GPUTexture;
  view: GPUTextureView;
  bindGroup: GPUBindGroup;
  linearBindGroup?: GPUBindGroup;
  width: number;
  height: number;
  colorSpace: TextureColorSpace;
  alphaMode: "straight";
  revision: number;
  source?: Blob;
}

export interface WebGpuTextureWriteBytes {
  data: Uint8Array;
  bytesPerRow: number;
  rowsPerImage: number;
}

const TEXTURE_ROW_ALIGNMENT = 256;

export class WebGpuTextureStore {
  private fileGeneration = 0;
  private fileObjects = new Map<GPUTexture, { generation: number; width: number; height: number; colorSpace: TextureColorSpace; source?: { blob: Blob; url: string } }>();
  private textures = new Set<GPUTexture>();
  private texturesById = new Map<number, WebGpuTextureResource>();
  private readonly pendingLoads = new Set<AbortController>();
  private readonly pendingIds = new Map<number, AbortController>();
  private destroyed = false;
  private revision = 0;

  constructor(
    private readonly device: GPUDevice,
    private readonly sampler: GPUSampler,
    private readonly textureBindGroupLayout: GPUBindGroupLayout,
    private readonly linearWorking = false,
  ) {
    registerTextureFileOwner(this, { capture: budget => this.captureFileTextures(budget),
      prepare: (data, budget) => this.prepareFileTextures(data, budget), revision: () => this.fileGeneration });
  }

  async load(url: string, options?: TextureLoadOptions): Promise<GPUTexture> {
    return this.loadManaged(url, options);
  }

  async loadTexture(textureId: number, url: string, options?: TextureLoadOptions): Promise<GPUTexture> {
    validateTextureId(textureId);
    return this.loadManaged(url, options, textureId);
  }

  private async loadManaged(url: string, options: TextureLoadOptions = {}, textureId?: number): Promise<GPUTexture> {
    this.assertAlive();
    const colorSpace = resolveTextureColorSpace(options);
    if (options.signal?.aborted) throw textureLoadAbortError();
    const scope = createAssetLoadScope(options.signal);
    const controller = scope.controller;
    this.pendingLoads.add(controller);
    try {
      if (textureId !== undefined) {
        const previous = this.pendingIds.get(textureId);
        this.pendingIds.set(textureId, controller);
        previous?.abort();
      }
      this.assertLoadActive(controller.signal);
      // Native WebGPU currently uses the ordinary image fallback even when ktx2Url is present.
      const {bitmap,blob} = await this.loadImageBitmap(url, colorSpace, controller.signal, options.alphaMode);
      try {
        this.assertLoadActive(controller.signal);
        const texture = this.createTextureFromSource(textureId, bitmap, colorSpace, blob, controller.signal);
        const record = this.fileObjects.get(texture); if (record) record.source = { blob, url };
        return texture;
      } finally { bitmap.close(); }
    } catch (error) {
      if (this.destroyed || controller.signal.aborted) throw textureLoadAbortError();
      throw error;
    } finally {
      this.pendingLoads.delete(controller);
      if (textureId !== undefined && this.pendingIds.get(textureId) === controller) this.pendingIds.delete(textureId);
      scope.dispose();
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
    resource.revision = ++this.revision;
    const record = this.fileObjects.get(resource.texture); if (record) record.generation = ++this.fileGeneration;
  }

  restoreRgbaTexture(id: number, width: number, height: number, data: Uint8Array): GPUTexture { this.assertAlive(); return this.createTextureFromRgbaData(id,width,height,data); }

  createPlaceholderTextureForId(textureId: number): void {
    this.assertAlive();
    this.createTextureFromRgbaData(textureId, 1, 1, new Uint8Array([255, 255, 255, 255]));
  }

  evictTexture(textureId: number): boolean {
    this.assertAlive();
    validateTextureId(textureId);
    if (textureId === 0) {
      return false;
    }
    const controller = new AbortController(), previous = this.pendingIds.get(textureId);
    this.pendingIds.set(textureId, controller);
    try {
      previous?.abort();
      if (this.destroyed || controller.signal.aborted) return false;
      const resource = this.texturesById.get(textureId);
      if (resource === undefined) return false;
      webGpuResources(this.device).destroy(resource.texture);
      this.textures.delete(resource.texture);
      this.texturesById.delete(textureId);
      this.fileObjects.delete(resource.texture); this.fileGeneration++;
      return true;
    } finally {
      if (this.pendingIds.get(textureId) === controller) this.pendingIds.delete(textureId);
    }
  }

  textureRevision(textureId: number): number | undefined { return this.texturesById.get(textureId)?.revision; }

  textureInfo(textureId: number): WebGpuTextureResource { return this.resource(textureId); }

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
    this.fileObjects.clear(); this.fileGeneration++;
    this.pendingIds.clear();
    for (const texture of this.textures) {
      webGpuResources(this.device).destroy(texture);
    }
    this.textures.clear();
    this.texturesById.clear();
  }

  private async loadImageBitmap(url: string, colorSpace: TextureColorSpace, signal: AbortSignal, alphaMode?: "straight"): Promise<{bitmap:ImageBitmap;blob:Blob}> {
    const response = await fetch(url, { signal });
    if (!response.ok) {
      try { await response.body?.cancel(); }
      catch { /* Preserve the HTTP failure if cleanup fails. */ }
      this.assertLoadActive(signal);
      throw new Error(`Texture load failed: HTTP ${response.status} ${response.statusText}`.trim());
    }
    this.assertLoadActive(signal);
    const blob = await response.blob();
    this.assertLoadActive(signal);
    const bitmap = colorSpace === "srgb" && alphaMode !== "straight" && !this.linearWorking ? await createImageBitmap(blob)
      : await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
    return {bitmap,blob};
  }

  private createTextureFromSource(textureId: number | undefined, source: ImageBitmap, colorSpace: TextureColorSpace, blob: Blob, signal: AbortSignal): GPUTexture {
    const texture = webGpuResources(this.device).createTexture({
      size: { width: source.width, height: source.height, depthOrArrayLayers: 1 },
      format: "rgba8unorm",
      ...(this.linearWorking ? { viewFormats: ["rgba8unorm-srgb"] } : {}),
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT,
    }, false);
    try {
      this.device.queue.copyExternalImageToTexture(
        { source },
        { texture },
        { width: source.width, height: source.height, depthOrArrayLayers: 1 },
      );
      this.fileObjects.set(texture, { generation: ++this.fileGeneration, width: source.width, height: source.height, colorSpace,
        source: { blob, url: "" } });
      if (textureId === undefined) {
        this.textures.add(texture);
        return texture;
      }
      const resource = this.createTextureResource(texture, source.width, source.height, colorSpace);resource.source=blob;
      this.assertLoadActive(signal);
      // Register a completed load without aborting its own controller.
      this.registerTexture(textureId, resource);
      return texture;
    } catch (error) {
      webGpuResources(this.device).destroy(texture);
      throw error;
    }
  }

  private createTextureFromRgbaData(
    textureId: number,
    width: number,
    height: number,
    data: Uint8Array,
  ): GPUTexture {
    validateTextureId(textureId);
    const upload = textureWriteBytes(width, height, data);
    const texture = webGpuResources(this.device).createTexture({
      size: { width, height, depthOrArrayLayers: 1 },
      format: "rgba8unorm",
      ...(this.linearWorking ? { viewFormats: ["rgba8unorm-srgb"] } : {}),
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT,
    }, false);
    try {
      this.device.queue.writeTexture(
        { texture },
        upload.data,
        { bytesPerRow: upload.bytesPerRow, rowsPerImage: upload.rowsPerImage },
        { width, height, depthOrArrayLayers: 1 },
      );
      this.fileObjects.set(texture, { generation: ++this.fileGeneration, width, height, colorSpace: this.linearWorking ? "srgb" : "none" });
      this.setTexture(textureId, this.createTextureResource(texture, width, height, this.linearWorking ? "srgb" : "none"));
      return texture;
    } catch (error) {
      webGpuResources(this.device).destroy(texture);
      throw error;
    }
  }

  private createTextureResource(texture: GPUTexture, width: number, height: number, colorSpace: TextureColorSpace = "none"): WebGpuTextureResource {
    const view = texture.createView();
    const bindGroup = this.device.createBindGroup({
      layout: this.textureBindGroupLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: view },
      ],
    });
    const linearBindGroup = this.linearWorking && colorSpace === "srgb" ? this.device.createBindGroup({
      layout: this.textureBindGroupLayout, entries: [{ binding: 0, resource: this.sampler },
        { binding: 1, resource: texture.createView({ format: "rgba8unorm-srgb" }) }],
    }) : undefined;
    return { texture, view, bindGroup, ...(linearBindGroup ? { linearBindGroup } : {}), width, height, colorSpace, alphaMode: "straight", revision: 0 };
  }

  private setTexture(textureId: number, resource: WebGpuTextureResource): void {
    this.assertAlive();
    validateTextureId(textureId);
    const controller = new AbortController(), previous = this.pendingIds.get(textureId);
    this.pendingIds.set(textureId, controller);
    try {
      previous?.abort();
      this.assertLoadActive(controller.signal);
      this.registerTexture(textureId, resource);
    } finally {
      if (this.pendingIds.get(textureId) === controller) this.pendingIds.delete(textureId);
    }
  }

  private registerTexture(textureId: number, resource: WebGpuTextureResource): void {
    const previous = this.texturesById.get(textureId);
    if (previous && previous.texture !== resource.texture) {
      webGpuResources(this.device).destroy(previous.texture);
      this.textures.delete(previous.texture);
      this.fileObjects.delete(previous.texture);
    }
    this.textures.add(resource.texture);
    resource.revision = ++this.revision;
    this.texturesById.set(textureId, resource);
    this.fileGeneration++;
  }

  private async captureFileTextures(b: ResourceBudget): Promise<ResourceTextureData> {
    this.assertAlive();
    if (this.pendingLoads.size || this.pendingIds.size) b.fail("BUSY", "GPU texture loads");
    const generation = this.fileGeneration, revision = this.revision;
    b.charge("resources", this.textures.size); b.work(this.textures.size + this.texturesById.size);
    const aliases = new Map<GPUTexture, number[]>();
    for (const texture of this.textures) aliases.set(texture, []);
    for (const [id, resource] of this.texturesById) {
      const ids = aliases.get(resource.texture);
      if (!ids) return b.fail("DATA", "GPU alias owner"); ids.push(id);
    }
    const entries: ResourceTextureEntry[] = [];
    for (const [texture, ids] of aliases) {
      const record = this.fileObjects.get(texture);
      if (!record || record.width !== texture.width || record.height !== texture.height) return b.fail("DATA", "GPU tracked descriptor");
      b.charge("gpuBytes", record.width * record.height * 4);
      const pixels = await readFileWebGpuTexture(this.device, texture, b);
      const source = record.source === undefined ? undefined : await captureResourceSource(record.source, b);
      entries.push(Object.freeze({ ids: Object.freeze(ids), width: record.width, height: record.height, generation: record.generation,
        colorSpace: record.colorSpace, alphaMode: "straight", runtimeInfo: true, storage: "rgba8", sampler: Object.freeze([9728, 9728, 33071, 33071] as const), pixels,
        ...(source === undefined ? {} : { source }) }));
    }
    this.assertAlive();
    if (generation !== this.fileGeneration || revision !== this.revision || this.pendingLoads.size || this.pendingIds.size) b.fail("STALE", "GPU texture capture");
    return Object.freeze({ backend: "webgpu", generation, contentRevision: revision, colorManagement: this.linearWorking ? "linear-srgb" : "legacy", entries: Object.freeze(entries) });
  }

  private async prepareFileTextures(input: ResourceTextureData, b: ResourceBudget) {
    this.assertAlive();
    if (this.pendingLoads.size || this.pendingIds.size) b.fail("BUSY", "GPU target lifecycle");
    const targetGeneration = this.fileGeneration, targetRevision = this.revision;
    const data = copyFileTextureData(input, b);
    if (data.backend !== "webgpu" || (data.colorManagement === "linear-srgb") !== this.linearWorking) b.fail("CAPABILITY", "GPU texture backend");
    for (const entry of data.entries) {
      if (entry.ids.length > 1 || entry.compressed || entry.storage !== "rgba8" || entry.alphaMode !== "straight"
        || entry.sampler.some((v, i) => v !== [9728, 9728, 33071, 33071][i])) b.fail("DATA", "GPU asset storage/sampler");
      if (entry.width > this.device.limits.maxTextureDimension2D || entry.height > this.device.limits.maxTextureDimension2D) b.fail("CAPABILITY", "GPU texture dimensions");
    }
    b.work(24 + data.entries.length); b.charge("metadataBytes", 24 * 8);
    const next = new WebGpuTextureStore(this.device, this.sampler, this.textureBindGroupLayout, data.colorManagement === "linear-srgb");
    this.device.pushErrorScope("validation"); this.device.pushErrorScope("out-of-memory");
    let error: unknown;
    try {
      const sources = new Map<object, {blob:Blob;url:string}>();
      for (const entry of data.entries) {
        let source;
        if (entry.source) {
          source = sources.get(entry.source);
          if (!source) { source = {url:entry.source.url,blob:fileResourceBlob(entry.source.bytes,entry.source.mime,b)};sources.set(entry.source,source); }
        }
        // Charge the row-padding allocation before textureWriteBytes creates it.
        if (entry.width * 4 % 256) { const padded = Math.ceil(entry.width * 4 / 256) * 256 * entry.height; b.charge("decodedBytes", padded); b.work(padded); }
        const upload = textureWriteBytes(entry.width, entry.height, entry.pixels);
        const texture = webGpuResources(this.device).createTexture({ size: [entry.width, entry.height, 1], format: "rgba8unorm",
          ...(next.linearWorking ? { viewFormats: ["rgba8unorm-srgb"] } : {}),
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT }, false);
        next.textures.add(texture);
        this.device.queue.writeTexture({ texture }, upload.data, { bytesPerRow: upload.bytesPerRow, rowsPerImage: upload.rowsPerImage }, [entry.width, entry.height, 1]);
        const record = { generation: ++next.fileGeneration, width: entry.width, height: entry.height, colorSpace: entry.colorSpace,
          ...(source === undefined ? {} : {source}) };
        next.fileObjects.set(texture, record);
        if (entry.ids.length) next.registerTexture(entry.ids[0], next.createTextureResource(texture, entry.width, entry.height, entry.colorSpace));
      }
      await this.device.queue.onSubmittedWorkDone();
    } catch (failure) { error = failure; }
    try { const allocation = await this.device.popErrorScope(), validation = await this.device.popErrorScope(); if (allocation || validation) error ??= allocation ?? validation; }
    catch (failure) { error ??= failure; }
    if (error) { next.destroy(); if (error instanceof NativeFileResourceError) throw error; return b.fail("GPU", "detached GPU texture upload"); }
    b.work(data.entries.length); b.charge("metadataBytes", data.entries.length * 8);
    const savedOrigin = Object.freeze({ version: 1 as const, generation: data.generation, contentRevision: data.contentRevision, resourceGenerations: Object.freeze(data.entries.map(entry => entry.generation)) });
    const target = this, preparedGeneration = next.fileGeneration, preparedRevision = next.revision;
    let adopted = false, disposed = false;
    return Object.freeze({ get owner() { return adopted ? target : next; }, savedOrigin,
      runtimeGeneration: () => adopted ? this.fileGeneration : next.fileGeneration,
      adopt: () => {
        if (adopted || disposed || this.destroyed || next.destroyed || this.device !== next.device
          || this.sampler !== next.sampler || this.textureBindGroupLayout !== next.textureBindGroupLayout || this.linearWorking !== next.linearWorking
          || this.fileGeneration !== targetGeneration || this.revision !== targetRevision
          || next.fileGeneration !== preparedGeneration || next.revision !== preparedRevision
          || this.pendingLoads.size || this.pendingIds.size || next.pendingLoads.size || next.pendingIds.size)
          throw new NativeFileResourceError("STALE", "GPU texture adoption lifetime");
        const generation = resourceInteger(Math.max(this.fileGeneration, next.fileGeneration), "fresh GPU texture generation", 0, Number.MAX_SAFE_INTEGER - 1) + 1;
        const revision = resourceInteger(Math.max(this.revision, next.revision), "fresh GPU texture revision", 0, Number.MAX_SAFE_INTEGER - 1) + 1;
        // Revisions of every replacement row change, including same ID/old revision.
        // Lookup consumers retain this store and fetch current views/groups per use.
        for (const resource of next.texturesById.values()) resource.revision = revision;
        [this.fileObjects, next.fileObjects] = [next.fileObjects, this.fileObjects];
        [this.textures, next.textures] = [next.textures, this.textures];
        [this.texturesById, next.texturesById] = [next.texturesById, this.texturesById];
        this.fileGeneration = generation; this.revision = revision;
        adopted = true; next.disposeFileTextures(); disposed = true;
      },
      dispose: () => { if (!disposed) { next.disposeFileTextures(); disposed = true; } },
    });
  }

  /** Cold lease cleanup retries failed native destroys without destroying any
   * successfully transferred target textures a second time. */
  private disposeFileTextures(): void {
    if (!this.destroyed) { this.destroyed = true; this.fileGeneration++; }
    let failure = false;
    for (const texture of this.textures) {
      try { webGpuResources(this.device).destroy(texture); this.textures.delete(texture); }
      catch { failure = true; }
    }
    this.fileObjects.clear(); this.texturesById.clear();
    if (failure) throw new NativeFileResourceError("GPU", "detached GPU cleanup; retry dispose and destroy unpublished target");
  }

  private assertLoadActive(signal: AbortSignal): void {
    if (this.destroyed || signal.aborted) throw textureLoadAbortError();
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

function alignTo(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function validateTextureId(textureId: number): void {
  if (!Number.isInteger(textureId) || textureId < 0) {
    throw new Error("texture_id must be a non-negative integer.");
  }
}
