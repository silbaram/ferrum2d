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

interface TextureSize {
  width: number;
  height: number;
}

export class TextureManager {
  private readonly textures = new Set<WebGLTexture>();
  private readonly texturesById = new Map<number, WebGLTexture>();
  private readonly textureSizesById = new Map<number, TextureSize>();
  private readonly textureBytesByObject = new Map<WebGLTexture, number | undefined>();
  private knownTextureBytes = 0;
  private unmeasuredTextureCount = 0;
  private readonly pendingLoads = new Set<AbortController>();
  private readonly pendingIds = new Map<number, AbortController>();
  private ownedTranscoder?: Ktx2Transcoder;
  private destroyed = false;
  private revision = 0;
  private readonly textureInfos = new Map<WebGLTexture, { width: number; height: number; colorSpace: "srgb" | "linear" | "none"; compressed?: boolean; alphaMode?: "straight" | "premultiplied" }>();
  textureInfo(textureId: number) { return this.textureInfos.get(this.texture(textureId)); }
  contentRevision(): number { return this.revision; }

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly colorManagement: ColorManagementMode = "legacy",
    private readonly options: TextureManagerOptions = {},
  ) {
    resolveColorManagementMode(colorManagement);
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
          this.textureInfos.set(texture, { width: image.width, height: image.height, colorSpace, compressed: true, alphaMode: "straight" });
        } catch (reason) {
          this.assertLoadActive(signal);
          this.options.onKtx2Fallback?.({ url, ktx2Url, reason });
        }
      }
      if (texture === undefined) {
        this.assertLoadActive(signal);
        const image = await this.loadImageBitmap(url, colorSpace, signal, options.alphaMode);
        try {
          this.assertLoadActive(signal);
          texture = this.createTextureFromSource(image, { colorSpace, ...(options.alphaMode === undefined ? {} : { alphaMode: options.alphaMode }) });
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
    } catch (error) {
      this.gl.deleteTexture(texture);
      throw error;
    } finally {
      this.gl.bindTexture(this.gl.TEXTURE_2D, null);
    }
    return texture;
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error("TextureManager has been destroyed.");
    }
  }

  private async loadImageBitmap(url: string, colorSpace: "srgb" | "linear" | "none", signal: AbortSignal, alphaMode?: "straight"): Promise<ImageBitmap> {
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
      if (this.colorManagement === "legacy" && colorSpace === "srgb" && alphaMode !== "straight") return await createImageBitmap(blob);
      return await createImageBitmap(blob, {
        premultiplyAlpha: "none",
        colorSpaceConversion: colorSpace === "srgb" ? "default" : "none",
      });
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
