/** Cold, isolated readback: Canvas 2D would premultiply and lose transparent RGB. */
export class SpatialModelImageReader {
  private gl?: WebGL2RenderingContext;
  private texture: WebGLTexture | null = null;
  private framebuffer: WebGLFramebuffer | null = null;

  read(bitmap: ImageBitmap): Uint8ClampedArray {
    if (!this.gl) this.initialize();
    const gl = this.gl!;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    // The caller creates the bitmap with premultiplyAlpha/colorSpaceConversion: none.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
      throw new Error("Spatial GLB: image readback framebuffer incomplete");
    const rgba = new Uint8ClampedArray(bitmap.width * bitmap.height * 4);
    gl.readPixels(0, 0, bitmap.width, bitmap.height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    const error = gl.getError();
    if (error !== gl.NO_ERROR || gl.isContextLost())
      throw new Error(`Spatial GLB: image readback failed (WebGL error 0x${error.toString(16)})`);
    return rgba;
  }

  private initialize(): void {
    const options = { antialias: false, depth: false, stencil: false };
    let context = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1).getContext("webgl2", options) : null;
    if (!context && typeof document !== "undefined") {
      const fallback = Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("webgl2", options);
      if (fallback && "readBuffer" in fallback) context = fallback;
    }
    if (!context || !("readBuffer" in context))
      throw new Error("Spatial GLB: WebGL2 image readback unavailable");
    this.gl = context;
    try {
      this.texture = context.createTexture();
      this.framebuffer = context.createFramebuffer();
      if (!this.texture || !this.framebuffer)
        throw new Error("Spatial GLB: image readback allocation failed");
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  destroy(): void {
    if (!this.gl) return;
    const gl = this.gl;
    gl.deleteFramebuffer(this.framebuffer);
    gl.deleteTexture(this.texture);
    // Release the transient context too; decoded assets keep only CPU RGBA bytes.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    this.gl = undefined;
    this.texture = this.framebuffer = null;
  }
}
