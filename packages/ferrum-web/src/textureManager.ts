import { describeError, diagnosticError } from "./diagnostics.js";
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
  private destroyed = false;

  constructor(private readonly gl: WebGL2RenderingContext) {}

  async load(url: string): Promise<WebGLTexture> {
    this.assertAlive();
    const image = await this.loadImageBitmap(url);
    try {
      this.assertAlive();
      return this.createTextureFromSource(image);
    } finally {
      image.close();
    }
  }

  async loadTexture(textureId: number, url: string): Promise<WebGLTexture> {
    this.assertAlive();
    const texture = await this.load(url);
    this.assertAlive();
    this.setTexture(textureId, texture);
    return texture;
  }

  createTextureFromSource(source: TexImageSource): WebGLTexture {
    this.assertAlive();
    const texture = this.gl.createTexture();
    if (!texture) {
      throw diagnosticError("Texture create error", {
        kind: "texture",
        detail: "WebGL texture creation returned null",
      }, "FERRUM_TEXTURE_CREATE");
    }

    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      source,
    );

    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
    this.textures.add(texture);
    return texture;
  }

  createPixelMaskTerrainTexture(
    textureId: number,
    terrain: PixelMaskTerrain,
    options: PixelMaskTerrainTextureUploadOptions = {},
  ): WebGLTexture {
    this.assertAlive();
    const texture = this.createTextureFromRgbaData(
      terrain.width,
      terrain.height,
      rgbaFromAlpha(terrain.width, terrain.height, terrain.data, options),
    );
    this.setTexture(textureId, texture, { width: terrain.width, height: terrain.height });
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
    const texture = this.createPlaceholderTexture(size);
    this.setTexture(textureId, texture);
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

    const previousTexture = this.texturesById.get(textureId);
    if (previousTexture && previousTexture !== texture) {
      this.gl.deleteTexture(previousTexture);
      this.textures.delete(previousTexture);
    }

    this.textures.add(texture);
    this.texturesById.set(textureId, texture);
    if (size === undefined) {
      this.textureSizesById.delete(textureId);
    } else {
      this.textureSizesById.set(textureId, size);
    }
  }

  evictTexture(textureId: number): boolean {
    this.assertAlive();
    validateTextureId(textureId);
    if (textureId === 0) {
      return false;
    }
    const texture = this.texturesById.get(textureId);
    if (!texture) {
      return false;
    }
    this.gl.deleteTexture(texture);
    this.textures.delete(texture);
    this.texturesById.delete(textureId);
    this.textureSizesById.delete(textureId);
    return true;
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
    for (const texture of this.textures) this.gl.deleteTexture(texture);
    this.textures.clear();
    this.texturesById.clear();
    this.textureSizesById.clear();
  }

  private createTextureFromRgbaData(width: number, height: number, data: Uint8Array): WebGLTexture {
    const texture = this.gl.createTexture();
    if (!texture) {
      throw diagnosticError("Texture create error", {
        kind: "texture",
        detail: "WebGL texture creation returned null",
      }, "FERRUM_TEXTURE_CREATE");
    }
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      width,
      height,
      0,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      data,
    );
    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
    this.textures.add(texture);
    return texture;
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error("TextureManager has been destroyed.");
    }
  }

  private async loadImageBitmap(url: string): Promise<ImageBitmap> {
    let response: Response;
    try {
      response = await fetch(url);
    } catch (error) {
      throw diagnosticError("Texture load error", {
        kind: "texture",
        url,
        detail: describeError(error),
      }, "FERRUM_TEXTURE_LOAD");
    }
    if (!response.ok) {
      throw diagnosticError("Texture load error", {
        kind: "texture",
        url,
        detail: `HTTP ${response.status} ${response.statusText}`.trim(),
      }, "FERRUM_TEXTURE_LOAD");
    }

    let blob: Blob;
    try {
      blob = await response.blob();
    } catch (error) {
      throw diagnosticError("Texture load error", {
        kind: "texture",
        url,
        detail: describeError(error),
      }, "FERRUM_TEXTURE_LOAD");
    }
    try {
      return await createImageBitmap(blob);
    } catch (error) {
      throw diagnosticError("Texture decode error", {
        kind: "texture",
        url,
        detail: describeError(error),
      }, "FERRUM_TEXTURE_DECODE");
    }
  }
}

function rgbaFromAlpha(
  width: number,
  height: number,
  alpha: Uint8Array,
  options: PixelMaskTerrainTextureUploadOptions,
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
    throw diagnosticError("Texture registry error", {
      kind: "texture",
      id: textureId,
      detail: "texture_id must be a non-negative integer",
    }, "FERRUM_TEXTURE_REGISTRY");
  }
}
