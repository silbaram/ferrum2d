import { describeError, diagnosticError } from "./diagnostics.js";

export class TextureManager {
  private readonly textures = new Set<WebGLTexture>();
  private readonly texturesById = new Map<number, WebGLTexture>();
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
      });
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
      });
    }

    ctx.fillStyle = "#101820";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#2ecc71";
    ctx.fillRect(0, 0, size / 2, size / 2);
    ctx.fillRect(size / 2, size / 2, size / 2, size / 2);

    return this.createTextureFromSource(canvas);
  }

  setTexture(textureId: number, texture: WebGLTexture): void {
    this.assertAlive();
    if (!Number.isInteger(textureId) || textureId < 0) {
      throw diagnosticError("Texture registry error", {
        kind: "texture",
        id: textureId,
        detail: "texture_id must be a non-negative integer",
      });
    }

    const previousTexture = this.texturesById.get(textureId);
    if (previousTexture && previousTexture !== texture) {
      this.gl.deleteTexture(previousTexture);
      this.textures.delete(previousTexture);
    }

    this.textures.add(texture);
    this.texturesById.set(textureId, texture);
  }

  texture(textureId: number): WebGLTexture {
    this.assertAlive();
    const texture = this.texturesById.get(textureId);
    if (!texture) {
      throw diagnosticError("Texture lookup error", {
        kind: "texture",
        id: textureId,
        detail: "Texture is not loaded. Check loadAssets() and Rust texture_id setup.",
      });
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
      });
    }
    if (!response.ok) {
      throw diagnosticError("Texture load error", {
        kind: "texture",
        url,
        detail: `HTTP ${response.status} ${response.statusText}`.trim(),
      });
    }

    let blob: Blob;
    try {
      blob = await response.blob();
    } catch (error) {
      throw diagnosticError("Texture load error", {
        kind: "texture",
        url,
        detail: describeError(error),
      });
    }
    try {
      return await createImageBitmap(blob);
    } catch (error) {
      throw diagnosticError("Texture decode error", {
        kind: "texture",
        url,
        detail: describeError(error),
      });
    }
  }
}
