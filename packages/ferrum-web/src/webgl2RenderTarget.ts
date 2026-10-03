import type { WebGL2FullscreenRenderTarget } from "./webgl2FullscreenPass";

/** Internal GPU allocation shared by post-processing and public render textures. */
export class WebGL2RenderTarget implements WebGL2FullscreenRenderTarget {
  readonly texture: WebGLTexture;
  readonly framebuffer: WebGLFramebuffer;
  private width = 0;
  private height = 0;
  private destroyed = false;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    width: number,
    height: number,
    filter: "nearest" | "linear" = "linear",
    private readonly srgbStorage = false,
  ) {
    validateRenderTargetSize(gl, width, height);
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) {
      if (texture) gl.deleteTexture(texture);
      if (framebuffer) gl.deleteFramebuffer(framebuffer);
      throw new Error("WebGL2 render target allocation failed.");
    }
    this.texture = texture;
    this.framebuffer = framebuffer;
    // WebGL parameter types are defined by their query enums.
    const previousTexture = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
    try {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      const sampling = filter === "nearest" ? gl.NEAREST : gl.LINEAR;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, sampling);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, sampling);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.resize(width, height);
    } catch (error) {
      this.destroy();
      throw error;
    } finally {
      gl.bindTexture(gl.TEXTURE_2D, previousTexture);
    }
  }

  resize(width: number, height: number): void {
    if (this.destroyed) throw new Error("WebGL2 render target has been destroyed.");
    if (this.width === width && this.height === height) return;
    validateRenderTargetSize(this.gl, width, height);
    const gl = this.gl;
    // DRAW_FRAMEBUFFER preserves a caller's separate READ_FRAMEBUFFER binding.
    const previousFramebuffer = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const previousTexture = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
    try {
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, this.srgbStorage ? gl.SRGB8_ALPHA8 : gl.RGBA8,
        width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.framebuffer);
      gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
      const status = gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`WebGL2 render target framebuffer incomplete: ${status}`);
      }
      this.width = width;
      this.height = height;
    } finally {
      gl.bindTexture(gl.TEXTURE_2D, previousTexture);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, previousFramebuffer);
    }
  }

  get allocatedTextureBytes(): number {
    return this.destroyed ? 0 : this.width * this.height * 4;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.gl.deleteFramebuffer(this.framebuffer);
    this.gl.deleteTexture(this.texture);
  }
}

function validateRenderTargetSize(gl: WebGL2RenderingContext, width: number, height: number): void {
  const limit: number = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width > limit || height > limit) {
    throw new Error(`RenderTexture dimensions must be positive integers <= MAX_TEXTURE_SIZE (${limit}).`);
  }
}
