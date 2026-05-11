export class TextureManager {
  private readonly textures = new Set<WebGLTexture>();
  private readonly texturesById = new Map<number, WebGLTexture>();

  constructor(private readonly gl: WebGL2RenderingContext) {}

  async load(url: string): Promise<WebGLTexture> {
    const image = await this.loadImageBitmap(url);
    try {
      return this.createTextureFromSource(image);
    } finally {
      image.close();
    }
  }

  async loadTexture(textureId: number, url: string): Promise<WebGLTexture> {
    const texture = await this.load(url);
    this.setTexture(textureId, texture);
    return texture;
  }

  createTextureFromSource(source: TexImageSource): WebGLTexture {
    const texture = this.gl.createTexture();
    if (!texture) throw new Error("Texture 생성 실패");

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
    const texture = this.createPlaceholderTexture(size);
    this.setTexture(textureId, texture);
    return texture;
  }

  createPlaceholderTexture(size = 64): WebGLTexture {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Placeholder canvas context 생성 실패");

    ctx.fillStyle = "#101820";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#2ecc71";
    ctx.fillRect(0, 0, size / 2, size / 2);
    ctx.fillRect(size / 2, size / 2, size / 2, size / 2);

    return this.createTextureFromSource(canvas);
  }

  setTexture(textureId: number, texture: WebGLTexture): void {
    if (!Number.isInteger(textureId) || textureId < 0) {
      throw new Error(`Invalid texture_id '${textureId}'. texture_id must be a non-negative integer.`);
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
    const texture = this.texturesById.get(textureId);
    if (!texture) {
      throw new Error(`Texture id ${textureId} is not loaded. Check loadAssets() and Rust texture_id setup.`);
    }
    return texture;
  }

  hasTexture(textureId: number): boolean {
    return this.texturesById.has(textureId);
  }

  destroy(): void {
    for (const texture of this.textures) this.gl.deleteTexture(texture);
    this.textures.clear();
    this.texturesById.clear();
  }

  private async loadImageBitmap(url: string): Promise<ImageBitmap> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Image asset failed to load from '${url}' (${response.status} ${response.statusText}).`);
    }

    const blob = await response.blob();
    try {
      return await createImageBitmap(blob);
    } catch {
      throw new Error(`Image asset failed to decode from '${url}'.`);
    }
  }
}
