import { retainResourceCaptureFence, registerTextureFileOwner, captureResourceSource, fileResourceBlob, type ResourceTextureData, type ResourceTextureEntry } from "./nativeFileResourceOwners.js";
import { ResourceBudget, resourceInteger, resourceKeys, NativeFileResourceError } from "./nativeFileResourceBudget.js";
import { readFileWebGlTexture } from "./nativeFileResourceWebGl.js";
import { copyFileTextureData } from "./nativeFileResourceTextures.js";
import { createKtx2Transcoder } from "./ktx2Transcoder.js";
import { createAssetLoadScope } from "./assetLoadTasks.js";
import { rgbaFromAlpha } from "./pixelMaskTextureData.js";
import { KTX2_MAX_INPUT_BYTES, KTX2_MAX_DIMENSION, ktx2BlockBytes, textureLoadAbortError } from "./ktx2Texture.js";
import type { Ktx2Transcoder, Ktx2TranscodedImage } from "./ktx2Texture.js";
import { selectWebGL2Ktx2Format } from "./webgl2CompressedTexture.js";
import type { WebGL2CompressedTextureFormat } from "./webgl2CompressedTexture.js";

export interface TextureManagerOptions {
  /** Injected transcoders remain caller-owned. false always selects the normal image. */
  ktx2?: Ktx2Transcoder | false;
  onKtx2Fallback?: (info: { url: string; ktx2Url: string; reason: unknown }) => void;
}

import { describeError, diagnosticError } from "./diagnostics.js";
import { resolveColorManagementMode, resolveTextureColorSpace } from "./colorManagement.js";
import type { ColorManagementMode, TextureLoadOptions } from "./colorManagement.js";
import type {
  PixelMaskTerrain,
  PixelMaskTerrainAlphaPatch,
  PixelMaskTerrainTextureUploadOptions,
} from "./pixelMaskTerrain.js";

function fileSourceDimensions(source:TexImageSource):TextureSize {
 if("videoWidth" in source)return {width:source.videoWidth,height:source.videoHeight};
 if("naturalWidth" in source)return {width:source.naturalWidth,height:source.naturalHeight};
 if("displayWidth" in source)return {width:source.displayWidth,height:source.displayHeight};
 return {width:source.width,height:source.height};
}

interface TextureSize {
  width: number;
  height: number;
}

interface FileTextureRecord { generation:number;program?:{width:number;height:number;colorSpace:"srgb"|"linear"|"none";alphaMode?:"straight"|"premultiplied"};source?:{blob:Blob;url:string};blocks?:Blob;format?:WebGL2CompressedTextureFormat;}

export class TextureManager {
  private fileGeneration = 0;
  private fileObjects = new Map<WebGLTexture,FileTextureRecord>();
  private textures = new Set<WebGLTexture>();
  private texturesById = new Map<number, WebGLTexture>();
  private textureSizesById = new Map<number, TextureSize>();
  private textureBytesByObject = new Map<WebGLTexture, number | undefined>();
  private knownTextureBytes = 0;
  private unmeasuredTextureCount = 0;
  private readonly pendingLoads = new Set<AbortController>();
  private readonly pendingIds = new Map<number, AbortController>();
  private ownedTranscoder?: Ktx2Transcoder;
  private destroyed = false;
  private revision = 0;
  private textureInfos = new Map<WebGLTexture, { width: number; height: number; colorSpace: "srgb" | "linear" | "none"; compressed?: boolean; alphaMode?: "straight" | "premultiplied" }>();
  textureInfo(textureId: number) { return this.textureInfos.get(this.texture(textureId)); }
  contentRevision(): number { return this.revision; }

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly colorManagement: ColorManagementMode = "legacy",
    private readonly options: TextureManagerOptions = {},
  ) {
    resolveColorManagementMode(colorManagement);
    registerTextureFileOwner(this, { capture: budget => this.captureFileTextures(budget),
      prepare: (data, budget) => this.prepareFileTextures(data, budget), revision: () => this.fileGeneration });
  }

  async load(url: string, options?: TextureLoadOptions): Promise<WebGLTexture> {
    return this.loadManaged(url, options);
  }

  async loadTexture(textureId: number, url: string, options?: TextureLoadOptions): Promise<WebGLTexture> {
    validateTextureId(textureId);
    return this.loadManaged(url, options, textureId);
  }

  private async loadManaged(url: string, options: TextureLoadOptions = {}, textureId?: number): Promise<WebGLTexture> {
    this.assertAlive();
    const colorSpace = resolveTextureColorSpace(options);
    const ktx2Url = options.ktx2Url;
    if (options.signal?.aborted) throw textureLoadAbortError();
    const scope = createAssetLoadScope(options.signal);
    const controller = scope.controller;
    this.pendingLoads.add(controller);
    const signal = controller.signal;
    let texture: WebGLTexture | undefined;
    try {
      if (textureId !== undefined) {
        const previous = this.pendingIds.get(textureId);
        // Abort listeners may start a newer load or synchronously replace this ID.
        this.pendingIds.set(textureId, controller);
        previous?.abort();
      }
      this.assertLoadActive(signal);
      if (ktx2Url !== undefined && this.options.ktx2 !== false) {
        try {
          const format = selectWebGL2Ktx2Format(this.gl, this.colorManagement === "linear-srgb" && colorSpace === "srgb");
          if (!format) throw new Error("No supported KTX2 GPU block format.");
          const response = await fetch(ktx2Url, { signal });
          if (!response.ok) {
            try { await response.body?.cancel(); }
            catch { /* Preserve the HTTP failure if cleanup fails. */ }
            this.assertLoadActive(signal);
            throw new Error(`KTX2 fetch failed: HTTP ${response.status}.`);
          }
          const length = Number(response.headers.get("content-length"));
          if (length > KTX2_MAX_INPUT_BYTES) {
            await response.body?.cancel();
            throw new Error("KTX2 input exceeds 64 MiB.");
          }
          const bytes = await readKtx2Bytes(response);
          this.assertLoadActive(signal);
          const transcoder = this.options.ktx2 || (this.ownedTranscoder ??= createKtx2Transcoder());
          const image = await transcoder.transcode(bytes, {
            format: format.format, srgb: colorSpace === "srgb",
            allowAlpha: this.colorManagement === "linear-srgb" || options.alphaMode === "straight",
            maxDimension: Math.min(KTX2_MAX_DIMENSION, this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE)), signal,
          });
          this.assertLoadActive(signal);
          texture = this.createCompressedTexture(image, format);
          this.fileObjects.set(texture, { generation: ++this.fileGeneration, program:{width:image.width,height:image.height,colorSpace,alphaMode:"straight"}, source: { blob: new Blob([bytes.slice()]), url: ktx2Url },
            blocks: new Blob([image.data.slice()]), format });
          this.textureInfos.set(texture, { width: image.width, height: image.height, colorSpace, compressed: true, alphaMode: "straight" });
        } catch (reason) {
          this.assertLoadActive(signal);
          this.options.onKtx2Fallback?.({ url, ktx2Url, reason });
        }
      }
      if (texture === undefined) {
        this.assertLoadActive(signal);
        const decoded = await this.loadImageBitmap(url, colorSpace, signal, options.alphaMode);
        const image = decoded.image;
        try {
          this.assertLoadActive(signal);
          texture = this.createTextureFromSource(image, { colorSpace, ...(options.alphaMode === undefined ? {} : { alphaMode: options.alphaMode }) });
          this.fileObjects.set(texture, { ...this.fileObjects.get(texture)!, generation: ++this.fileGeneration, source: { blob: decoded.blob, url } });
        } finally { image.close(); }
      }
      this.assertLoadActive(signal);
      // Completing this request must not emit an abort on its own signal.
      if (textureId !== undefined) this.registerTexture(textureId, texture);
      return texture;
    } catch (error) {
      if (texture && this.textures.has(texture)) this.releaseUnreferencedTexture(texture);
      throw error;
    } finally {
      this.pendingLoads.delete(controller);
      if (textureId !== undefined && this.pendingIds.get(textureId) === controller) this.pendingIds.delete(textureId);
      scope.dispose();
    }
  }

  private assertLoadActive(signal: AbortSignal): void {
    if (this.destroyed || signal.aborted) throw textureLoadAbortError();
  }

  private createCompressedTexture(image: Ktx2TranscodedImage, format: WebGL2CompressedTextureFormat): WebGLTexture {
    const maxSize = Math.min(KTX2_MAX_DIMENSION, this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE));
    if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 4 || image.height < 4
      || image.width % 4 !== 0 || image.height % 4 !== 0
      || image.width > maxSize || image.height > maxSize || image.format !== format.format
      || !(image.data instanceof Uint8Array) || image.data.byteLength !== ktx2BlockBytes(image.width, image.height)) {
      throw new Error("Invalid KTX2 transcoder output.");
    }
    const texture = this.gl.createTexture();
    if (!texture) throw new Error("Compressed texture allocation failed.");
    try {
      this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
      this.gl.compressedTexImage2D(this.gl.TEXTURE_2D, 0, format.internalFormat, image.width, image.height, 0, image.data);
      const error = this.gl.getError();
      if (error !== this.gl.NO_ERROR) throw new Error(`KTX2 GPU upload failed: ${error}.`);
      this.adoptTexture(texture, image.data.byteLength);
      return texture;
    } catch (error) {
      this.gl.deleteTexture(texture);
      throw error;
    } finally { this.gl.bindTexture(this.gl.TEXTURE_2D, null); }
  }

  createTextureFromSource(source: TexImageSource, options?: TextureLoadOptions): WebGLTexture {
    this.assertAlive();
    const colorSpace = resolveTextureColorSpace(options);
    const texture = this.gl.createTexture();
    if (!texture) {
      throw diagnosticError("Texture create error", {
        kind: "texture",
        detail: "WebGL texture creation returned null",
      }, "FERRUM_TEXTURE_CREATE");
    }

    try {
      this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
      this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, this.colorManagement === "legacy" && colorSpace === "srgb" && options?.alphaMode !== "straight" ? 1 : 0);
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        0,
        this.colorManagement === "linear-srgb" && colorSpace === "srgb" ? this.gl.SRGB8_ALPHA8 : this.gl.RGBA,
        this.gl.RGBA,
        this.gl.UNSIGNED_BYTE,
        source,
      );

      this.adoptTexture(texture, sourceByteLength(source));
      const size=fileSourceDimensions(source),record=this.fileObjects.get(texture)!;
      record.program={...size,colorSpace,alphaMode:this.colorManagement === "legacy" && colorSpace === "srgb" && options?.alphaMode !== "straight" ? "premultiplied" : "straight"};
      if (!("videoWidth" in source || "naturalWidth" in source || "displayWidth" in source)) this.textureInfos.set(texture, { width: source.width, height: source.height, colorSpace, alphaMode: this.colorManagement === "legacy" && colorSpace === "srgb" && options?.alphaMode !== "straight" ? "premultiplied" : "straight" });
    } catch (error) {
      this.gl.deleteTexture(texture);
      throw error;
    } finally {
      this.gl.bindTexture(this.gl.TEXTURE_2D, null);
    }
    return texture;
  }

  createPixelMaskTerrainTexture(
    textureId: number,
    terrain: PixelMaskTerrain,
    options: PixelMaskTerrainTextureUploadOptions = {},
  ): WebGLTexture {
    this.assertAlive();
    validateTextureId(textureId);
    const texture = this.createTextureFromRgbaData(
      terrain.width,
      terrain.height,
      rgbaFromAlpha(terrain.width, terrain.height, terrain.data, options),
    );
    try { this.setTexture(textureId, texture, { width: terrain.width, height: terrain.height }); }
    catch (error) {
      if (this.textures.has(texture)) this.releaseUnreferencedTexture(texture);
      throw error;
    }
    return texture;
  }

  updatePixelMaskTerrainTexture(
    textureId: number,
    patch: PixelMaskTerrainAlphaPatch,
    options: PixelMaskTerrainTextureUploadOptions = {},
  ): void {
    this.assertAlive();
    const texture = this.texture(textureId);
    const size = this.textureSizesById.get(textureId);
    if (size === undefined) {
      throw diagnosticError("Texture update error", {
        kind: "texture",
        id: textureId,
        detail: "Texture size is unknown. Create the pixel mask terrain texture before patch updates.",
      }, "FERRUM_TEXTURE_REGISTRY");
    }
    if (
      patch.rect.x < 0
      || patch.rect.y < 0
      || patch.rect.x + patch.rect.width > size.width
      || patch.rect.y + patch.rect.height > size.height
    ) {
      throw diagnosticError("Texture update error", {
        kind: "texture",
        id: textureId,
        detail: "Pixel mask terrain patch is outside the texture bounds.",
      }, "FERRUM_TEXTURE_REGISTRY");
    }
    const rgba = rgbaFromAlpha(patch.rect.width, patch.rect.height, patch.alpha, options);
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    this.revision++;
    this.gl.texSubImage2D(
      this.gl.TEXTURE_2D,
      0,
      patch.rect.x,
      patch.rect.y,
      patch.rect.width,
      patch.rect.height,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      rgba,
    );
    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
    const record = this.fileObjects.get(texture); if (record) record.generation = ++this.fileGeneration;
  }

  createPlaceholderTextureForId(textureId: number, size = 64): WebGLTexture {
    this.assertAlive();
    validateTextureId(textureId);
    const texture = this.createPlaceholderTexture(size);
    try { this.setTexture(textureId, texture); }
    catch (error) {
      if (this.textures.has(texture)) this.releaseUnreferencedTexture(texture);
      throw error;
    }
    return texture;
  }

  createPlaceholderTexture(size = 64): WebGLTexture {
    this.assertAlive();
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw diagnosticError("Texture create error", {
        kind: "texture",
        detail: "Placeholder canvas context is not available",
      }, "FERRUM_TEXTURE_CREATE");
    }

    ctx.fillStyle = "#101820";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#2ecc71";
    ctx.fillRect(0, 0, size / 2, size / 2);
    ctx.fillRect(size / 2, size / 2, size / 2, size / 2);

    return this.createTextureFromSource(canvas);
  }

  setTexture(textureId: number, texture: WebGLTexture, size?: TextureSize): void {
    this.assertAlive();
    validateTextureId(textureId);

    const dimensions = size === undefined ? undefined : { width: size.width, height: size.height };
    if (dimensions !== undefined && (!Number.isInteger(dimensions.width) || !Number.isInteger(dimensions.height)
      || dimensions.width <= 0 || dimensions.height <= 0)) throw new Error("Texture dimensions must be positive integers.");
    const controller = new AbortController(), previous = this.pendingIds.get(textureId);
    // Synchronous replacements also participate in the same-ID ordering fence.
    this.pendingIds.set(textureId, controller);
    try {
      previous?.abort();
      this.assertLoadActive(controller.signal);
      this.registerTexture(textureId, texture, dimensions);
    } finally {
      if (this.pendingIds.get(textureId) === controller) this.pendingIds.delete(textureId);
    }
  }

  private registerTexture(textureId: number, texture: WebGLTexture, size?: TextureSize): void {
    const previousTexture = this.texturesById.get(textureId);
    this.adoptTexture(texture, size === undefined ? undefined : size.width * size.height * 4);
    this.texturesById.set(textureId, texture);
    this.revision++;
    this.fileGeneration++;
    if (previousTexture && previousTexture !== texture) this.releaseUnreferencedTexture(previousTexture);
    if (size === undefined) {
      this.textureSizesById.delete(textureId);
    } else {
      this.textureSizesById.set(textureId, { width: size.width, height: size.height });
    }
  }

  evictTexture(textureId: number): boolean {
    this.assertAlive();
    validateTextureId(textureId);
    if (textureId === 0) return false;
    const controller = new AbortController(), previous = this.pendingIds.get(textureId);
    this.pendingIds.set(textureId, controller);
    try {
      previous?.abort();
      // A replacement started by the abort callback is newer than this eviction.
      if (this.destroyed || controller.signal.aborted) return false;
      const texture = this.texturesById.get(textureId);
      if (!texture) return false;
      this.texturesById.delete(textureId);
      this.revision++;
      this.fileGeneration++;
      this.textureSizesById.delete(textureId);
      this.releaseUnreferencedTexture(texture);
      return true;
    } finally {
      if (this.pendingIds.get(textureId) === controller) this.pendingIds.delete(textureId);
    }
  }

  resourceStats(): { textureCount: number; textureBytes?: number; unmeasuredTextureCount: number } {
    return {
      textureCount: this.textures.size,
      textureBytes: this.unmeasuredTextureCount === 0 ? this.knownTextureBytes : undefined,
      unmeasuredTextureCount: this.unmeasuredTextureCount,
    };
  }

  private adoptTexture(texture: WebGLTexture, bytes?: number): void {
    if (this.textures.has(texture)) {
      // Registration/aliases must not erase dimensions learned during upload.
      if (bytes === undefined) return;
      const previous = this.textureBytesByObject.get(texture);
      // setTexture dimensions are not a GPU resize. Preserve the actual upload format/size.
      if (previous !== undefined) return;
      this.unmeasuredTextureCount -= 1;
    } else {
      this.textures.add(texture);
      this.fileObjects.set(texture, { generation: ++this.fileGeneration });
    }
    this.textureBytesByObject.set(texture, bytes);
    if (bytes === undefined) this.unmeasuredTextureCount += 1;
    else this.knownTextureBytes += bytes;
  }

  private releaseUnreferencedTexture(texture: WebGLTexture): void {
    // Only registry mutations scan aliases; frame statistics remain O(1).
    for (const referenced of this.texturesById.values()) if (referenced === texture) return;
    this.gl.deleteTexture(texture);
    this.textures.delete(texture);
    const bytes = this.textureBytesByObject.get(texture);
    if (bytes === undefined) this.unmeasuredTextureCount -= 1;
    else this.knownTextureBytes -= bytes;
    this.textureBytesByObject.delete(texture);
    this.textureInfos.delete(texture);
    this.fileObjects.delete(texture);
    this.fileGeneration++;
  }

  texture(textureId: number): WebGLTexture {
    this.assertAlive();
    const texture = this.texturesById.get(textureId);
    if (!texture) {
      throw diagnosticError("Texture lookup error", {
        kind: "texture",
        id: textureId,
        detail: "Texture is not loaded. Check loadAssets() and Rust texture_id setup.",
      }, "FERRUM_TEXTURE_LOOKUP");
    }
    return texture;
  }

  hasTexture(textureId: number): boolean {
    this.assertAlive();
    return this.texturesById.has(textureId);
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    for (const controller of this.pendingLoads) controller.abort();
    this.pendingLoads.clear();
    this.pendingIds.clear();
    this.ownedTranscoder?.destroy();
    for (const texture of this.textures) this.gl.deleteTexture(texture);
    this.textureInfos.clear();
    this.fileObjects.clear();
    this.fileGeneration++;
    this.textures.clear();
    this.texturesById.clear();
    this.textureSizesById.clear();
    this.textureBytesByObject.clear();
    this.knownTextureBytes = 0;
    this.unmeasuredTextureCount = 0;
  }

  private createTextureFromRgbaData(width: number, height: number, data: Uint8Array): WebGLTexture {
    const texture = this.gl.createTexture();
    if (!texture) {
      throw diagnosticError("Texture create error", {
        kind: "texture",
        detail: "WebGL texture creation returned null",
      }, "FERRUM_TEXTURE_CREATE");
    }
    try {
      this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
      this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        0,
        this.colorManagement === "linear-srgb" ? this.gl.SRGB8_ALPHA8 : this.gl.RGBA,
        width,
        height,
        0,
        this.gl.RGBA,
        this.gl.UNSIGNED_BYTE,
        data,
      );
      this.adoptTexture(texture, width * height * 4);
      const record = this.fileObjects.get(texture);
      if (record) record.program = { width, height, colorSpace: this.colorManagement === "linear-srgb" ? "srgb" : "none" };
    } catch (error) {
      this.gl.deleteTexture(texture);
      throw error;
    } finally {
      this.gl.bindTexture(this.gl.TEXTURE_2D, null);
    }
    return texture;
  }

  private async captureFileTextures(b: ResourceBudget): Promise<ResourceTextureData> {
    this.assertAlive();
    if (this.pendingLoads.size || this.pendingIds.size) b.fail("BUSY", "texture loads");
    const generation = this.fileGeneration, revision = this.revision;
    b.charge("resources", this.textures.size); b.work(this.textures.size + this.texturesById.size);
    b.charge("metadataBytes", (this.textures.size + this.texturesById.size) * 32);
    const aliases = new Map<WebGLTexture, number[]>();
    for (const texture of this.textures) aliases.set(texture, []);
    for (const [id, texture] of this.texturesById) {
      const ids = aliases.get(texture); if (!ids) return b.fail("DATA", "texture alias owner"); ids.push(id);
    }
    const records:{texture:WebGLTexture;ids:readonly number[];info:NonNullable<FileTextureRecord["program"]>;runtimeMetadata?:import("./nativeFileResourceOwners.js").ResourceTextureRuntimeInfo;runtimeInfo:boolean;record:FileTextureRecord;sampler:readonly[number,number,number,number];storage:"rgba8"|"srgb8-alpha8";pixels:Uint8Array}[] = [];
    for (const [texture, ids] of aliases) {
      const runtimeInfo = this.textureInfos.get(texture), record = this.fileObjects.get(texture);
      if(runtimeInfo){resourceKeys(runtimeInfo,["width","height","colorSpace","compressed","alphaMode"],b);resourceInteger(runtimeInfo.width,"renderer info width",1,0x7fffffff);resourceInteger(runtimeInfo.height,"renderer info height",1,0x7fffffff);
        if(!["srgb","linear","none"].includes(runtimeInfo.colorSpace)||runtimeInfo.compressed!==undefined&&typeof runtimeInfo.compressed!=="boolean"||runtimeInfo.alphaMode!==undefined&&!["straight","premultiplied"].includes(runtimeInfo.alphaMode))return b.fail("DATA","renderer info metadata");}
      const info = record?.program;
      if (!info || !record) return b.fail("CAPABILITY", "external texture metadata requires host binding");
      const previous = this.gl.getParameter(this.gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
      let sampler: readonly [number, number, number, number];
      try {
        this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
        const values = [this.gl.TEXTURE_MIN_FILTER, this.gl.TEXTURE_MAG_FILTER, this.gl.TEXTURE_WRAP_S, this.gl.TEXTURE_WRAP_T].map(p => this.gl.getTexParameter(this.gl.TEXTURE_2D, p) as number);
        if ((values[0] !== this.gl.NEAREST && values[0] !== this.gl.LINEAR) || this.gl.getTexParameter(this.gl.TEXTURE_2D, this.gl.TEXTURE_BASE_LEVEL) !== 0)
          return b.fail("CAPABILITY", "external mip storage requires host binding");
        sampler = [values[0], values[1], values[2], values[3]];
      } finally { this.gl.bindTexture(this.gl.TEXTURE_2D, previous); }
      const storage = this.colorManagement === "linear-srgb" && info.colorSpace === "srgb" ? "srgb8-alpha8" as const : "rgba8" as const;
      b.charge("gpuBytes", record.blocks?.size ?? info.width * info.height * 4);
      const pixels = readFileWebGlTexture(this.gl, texture, info.width, info.height, !!record.blocks, storage === "srgb8-alpha8", b);
      records.push({ texture, ids: Object.freeze(ids), info: { ...info }, runtimeMetadata:runtimeInfo===undefined?undefined:{...runtimeInfo}, runtimeInfo: runtimeInfo !== undefined, record: { ...record }, sampler, storage, pixels });
    }
    const entries: ResourceTextureEntry[] = [];
    for (const row of records) {
      const source = row.record.source === undefined ? undefined : await captureResourceSource(row.record.source, b);
      let compressed;
      if (row.record.blocks && row.record.format) {
        b.charge("decodedBytes", row.record.blocks.size); b.work(row.record.blocks.size);
        compressed = Object.freeze({ ...row.record.format, blocks: new Uint8Array(await row.record.blocks.arrayBuffer()) });
      }
      entries.push(Object.freeze({ ids: row.ids, width: row.info.width, height: row.info.height, generation: row.record.generation,
        colorSpace: row.info.colorSpace, alphaMode: row.info.alphaMode ?? "unknown", runtimeInfo: row.runtimeInfo, ...(row.runtimeMetadata===undefined?{}:{runtimeMetadata:Object.freeze(row.runtimeMetadata)}), storage: row.storage, sampler: row.sampler, pixels: row.pixels,
        ...(source === undefined ? {} : { source }), ...(compressed === undefined ? {} : { compressed }) }));
    }
    const assertCurrent=(budget:ResourceBudget)=>{this.assertAlive();if(generation!==this.fileGeneration||revision!==this.revision||this.pendingLoads.size||this.pendingIds.size)return budget.fail("STALE","texture capture");
      budget.work(records.length);for(const row of records){const actual=this.textureInfos.get(row.texture),saved=row.runtimeMetadata;
        if(actual)resourceKeys(actual,["width","height","colorSpace","compressed","alphaMode"],budget);
        if((actual===undefined)!==(saved===undefined)||actual&&saved&&(Reflect.ownKeys(actual).length!==Reflect.ownKeys(saved).length||Reflect.ownKeys(saved).some(key=>!Object.is(Reflect.get(actual,key),Reflect.get(saved,key)))))return budget.fail("STALE","mutable renderer texture metadata");
      }
    };assertCurrent(b);
    const data=Object.freeze({ backend: "webgl2" as const, generation, contentRevision: revision, colorManagement: this.colorManagement, entries: Object.freeze(entries) });retainResourceCaptureFence(data,assertCurrent);return data;
  }

  private async prepareFileTextures(input: ResourceTextureData, b: ResourceBudget) {
    this.assertAlive();
    if (this.pendingLoads.size || this.pendingIds.size || this.gl.isContextLost()) b.fail("BUSY", "texture target lifecycle");
    const targetGeneration = this.fileGeneration, targetRevision = this.revision;
    const data = copyFileTextureData(input, b);
    if (data.backend !== "webgl2" || data.colorManagement !== this.colorManagement) b.fail("CAPABILITY", "texture backend/color management");
    b.work(32); b.charge("metadataBytes", 32 * 8); // Fixed preparation/adoption transaction records.
    const next = new TextureManager(this.gl, data.colorManagement, { ktx2: false });
    try {
      const sources = new Map<object, { blob: Blob; url: string }>();
      for (const entry of data.entries) {
        let source;
        if (entry.source) {
          source = sources.get(entry.source);
          if (!source) { source = { url: entry.source.url, blob: fileResourceBlob(entry.source.bytes, entry.source.mime, b) }; sources.set(entry.source, source); }
        }
        const texture = next.restoreFileTexture(entry, b);
        for (const id of entry.ids) next.registerTexture(id, texture);
        next.fileObjects.set(texture, { generation: next.fileObjects.get(texture)?.generation ?? next.fileGeneration,
          program: { width: entry.width, height: entry.height, colorSpace: entry.colorSpace,...(entry.alphaMode==="unknown"?{}:{alphaMode:entry.alphaMode}) },
          ...(source === undefined ? {} : { source }),
          ...(entry.compressed === undefined ? {} : { blocks: fileResourceBlob(entry.compressed.blocks, "", b, "decodedBytes"), format: entry.compressed }) });
      }
      b.work(data.entries.length); b.charge("metadataBytes", data.entries.length * 8);
      const savedOrigin = Object.freeze({ version: 1 as const, generation: data.generation, contentRevision: data.contentRevision, resourceGenerations: Object.freeze(data.entries.map(entry => entry.generation)) });
      const target = this, preparedGeneration = next.fileGeneration, preparedRevision = next.revision;
      let adopted = false, disposed = false;
      return Object.freeze({ get owner() { return adopted ? target : next; }, savedOrigin,
        runtimeGeneration: () => adopted ? this.fileGeneration : next.fileGeneration,
        adopt: () => {
          if (adopted || disposed || this.destroyed || next.destroyed || this.gl.isContextLost()
            || this.gl !== next.gl || this.colorManagement !== next.colorManagement
            || this.fileGeneration !== targetGeneration || this.revision !== targetRevision
            || next.fileGeneration !== preparedGeneration || next.revision !== preparedRevision
            || this.pendingLoads.size || this.pendingIds.size || next.pendingLoads.size || next.pendingIds.size)
            throw new NativeFileResourceError("STALE", "texture adoption lifetime");
          const generation = resourceInteger(Math.max(this.fileGeneration, next.fileGeneration), "fresh texture generation", 0, Number.MAX_SAFE_INTEGER - 1) + 1;
          const revision = resourceInteger(Math.max(this.revision, next.revision), "fresh texture revision", 0, Number.MAX_SAFE_INTEGER - 1) + 1;
          // All allocations/validation precede these ordinary private-field swaps.
          // Passes keep this manager (not its private maps), and revision changes.
          [this.fileObjects, next.fileObjects] = [next.fileObjects, this.fileObjects];
          [this.textures, next.textures] = [next.textures, this.textures];
          [this.texturesById, next.texturesById] = [next.texturesById, this.texturesById];
          [this.textureInfos, next.textureInfos] = [next.textureInfos, this.textureInfos];
          [this.textureSizesById, next.textureSizesById] = [next.textureSizesById, this.textureSizesById];
          [this.textureBytesByObject, next.textureBytesByObject] = [next.textureBytesByObject, this.textureBytesByObject];
          [this.knownTextureBytes, next.knownTextureBytes] = [next.knownTextureBytes, this.knownTextureBytes];
          [this.unmeasuredTextureCount, next.unmeasuredTextureCount] = [next.unmeasuredTextureCount, this.unmeasuredTextureCount];
          this.fileGeneration = generation; this.revision = revision;
          adopted = true; next.disposeFileTextures(); disposed = true; // Only superseded unpublished target allocations.
        },
        dispose: () => { if (!disposed) { next.disposeFileTextures(); disposed = true; } },
      });
    } catch (error) { next.destroy(); throw error; }
  }

  /** Cold lease cleanup retains failed native deletes for a later dispose retry.
   * After an adoption failure the caller also destroys the unpublished target. */
  private disposeFileTextures(): void {
    if (!this.destroyed) { this.destroyed = true; this.fileGeneration++; }
    let failure = false;
    for (const texture of this.textures) {
      try { this.gl.deleteTexture(texture); this.textures.delete(texture); }
      catch { failure = true; }
    }
    this.fileObjects.clear(); this.texturesById.clear(); this.textureSizesById.clear();
    this.textureInfos.clear(); this.textureBytesByObject.clear(); this.knownTextureBytes = 0; this.unmeasuredTextureCount = 0;
    if (failure) throw new NativeFileResourceError("GPU", "detached texture cleanup; retry dispose and destroy unpublished target");
  }

  private restoreFileTexture(entry: ResourceTextureEntry, b: ResourceBudget): WebGLTexture {
    const gl = this.gl;
    if (entry.width > gl.getParameter(gl.MAX_TEXTURE_SIZE) || entry.height > gl.getParameter(gl.MAX_TEXTURE_SIZE)) b.fail("CAPABILITY", "device texture dimensions");
    if (entry.compressed) {
      gl.getExtension("WEBGL_compressed_texture_astc"); gl.getExtension("EXT_texture_compression_bptc"); gl.getExtension("WEBGL_compressed_texture_etc");
      const formats: Uint32Array = gl.getParameter(gl.COMPRESSED_TEXTURE_FORMATS);
      if (!formats.includes(entry.compressed.internalFormat)) b.fail("CAPABILITY", "device compressed format");
    }
    const previous = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
    const unpack = gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING) as WebGLBuffer | null;
    const params = [gl.UNPACK_ALIGNMENT, gl.UNPACK_ROW_LENGTH, gl.UNPACK_IMAGE_HEIGHT, gl.UNPACK_SKIP_PIXELS, gl.UNPACK_SKIP_ROWS, gl.UNPACK_SKIP_IMAGES, gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, gl.UNPACK_FLIP_Y_WEBGL, gl.UNPACK_COLORSPACE_CONVERSION_WEBGL];
    const values = params.map(p => gl.getParameter(p) as number);
    const texture = gl.createTexture(); if (!texture) return b.fail("ALLOCATION", "file texture");
    try {
      gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null); params.forEach(p => gl.pixelStorei(p, p === gl.UNPACK_ALIGNMENT ? 1 : p === gl.UNPACK_COLORSPACE_CONVERSION_WEBGL ? gl.NONE : 0));
      gl.bindTexture(gl.TEXTURE_2D, texture);
      [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER, gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach((p, i) => gl.texParameteri(gl.TEXTURE_2D, p, entry.sampler[i]));
      if (entry.compressed) gl.compressedTexImage2D(gl.TEXTURE_2D, 0, entry.compressed.internalFormat, entry.width, entry.height, 0, entry.compressed.blocks);
      else gl.texImage2D(gl.TEXTURE_2D, 0, entry.storage === "srgb8-alpha8" ? gl.SRGB8_ALPHA8 : gl.RGBA8, entry.width, entry.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, entry.pixels);
      if (gl.getError() !== gl.NO_ERROR || gl.isContextLost()) return b.fail("GPU", "file texture upload");
      const actual = readFileWebGlTexture(gl, texture, entry.width, entry.height, !!entry.compressed, entry.storage === "srgb8-alpha8", b);
      b.work(actual.length);
      if (actual.some((value, i) => value !== entry.pixels[i])) return b.fail("CAPABILITY", "compressed current bytes require external host binding");
      this.adoptTexture(texture, entry.compressed?.blocks.byteLength ?? entry.pixels.byteLength);
      if (entry.runtimeInfo) this.textureInfos.set(texture, entry.runtimeMetadata ? {...entry.runtimeMetadata} : { width: entry.width, height: entry.height, colorSpace: entry.colorSpace,
        ...(entry.alphaMode === "unknown" ? {} : { alphaMode: entry.alphaMode }), ...(entry.compressed === undefined ? {} : { compressed: true }) });
      return texture;
    } catch (error) { gl.deleteTexture(texture); throw error; }
    finally { gl.bindTexture(gl.TEXTURE_2D, previous); gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, unpack); params.forEach((p, i) => gl.pixelStorei(p, values[i])); }
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error("TextureManager has been destroyed.");
    }
  }

  private async loadImageBitmap(url: string, colorSpace: "srgb" | "linear" | "none", signal: AbortSignal, alphaMode?: "straight"): Promise<{ image: ImageBitmap; blob: Blob }> {
    let response: Response;
    try {
      response = await fetch(url, { signal });
    } catch (error) {
      this.assertLoadActive(signal);
      throw diagnosticError("Texture load error", {
        kind: "texture",
        url,
        detail: describeError(error),
      }, "FERRUM_TEXTURE_LOAD");
    }
    if (!response.ok) {
      try { await response.body?.cancel(); }
      catch { /* Preserve the HTTP failure if cleanup fails. */ }
      this.assertLoadActive(signal);
      throw diagnosticError("Texture load error", {
        kind: "texture",
        url,
        detail: `HTTP ${response.status} ${response.statusText}`.trim(),
      }, "FERRUM_TEXTURE_LOAD");
    }

    let blob: Blob;
    try {
      this.assertLoadActive(signal);
      blob = await response.blob();
      this.assertLoadActive(signal);
    } catch (error) {
      this.assertLoadActive(signal);
      throw diagnosticError("Texture load error", {
        kind: "texture",
        url,
        detail: describeError(error),
      }, "FERRUM_TEXTURE_LOAD");
    }
    try {
      const image = this.colorManagement === "legacy" && colorSpace === "srgb" && alphaMode !== "straight" ? await createImageBitmap(blob)
        : await createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: colorSpace === "srgb" ? "default" : "none" });
      return { image, blob };
    } catch (error) {
      this.assertLoadActive(signal);
      throw diagnosticError("Texture decode error", {
        kind: "texture",
        url,
        detail: describeError(error),
      }, "FERRUM_TEXTURE_DECODE");
    }
  }
}

function validateTextureId(textureId: number): void {
  if (!Number.isInteger(textureId) || textureId < 0) {
    throw diagnosticError("Texture registry error", {
      kind: "texture",
      id: textureId,
      detail: "texture_id must be a non-negative integer",
    }, "FERRUM_TEXTURE_REGISTRY");
  }
}

// Bitmap/canvas/ImageData dimensions describe uploaded pixels. DOM images (SVG/density
// correction) and video frames can differ; retain an unknown estimate rather than guess.
// https://registry.khronos.org/webgl/specs/latest/1.0/#TEXTURE_UPLOAD_SIZE
function sourceByteLength(source: TexImageSource): number | undefined {
  if ("videoWidth" in source || "naturalWidth" in source || "displayWidth" in source) return undefined;
  return source.width * source.height * 4;
}

async function readKtx2Bytes(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("KTX2 response has no body.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > KTX2_MAX_INPUT_BYTES) {
        await reader.cancel();
        throw new Error("KTX2 input exceeds 64 MiB.");
      }
      chunks.push(result.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
