import { SpriteBatch, type SpriteTextureSource } from "./spriteBatch.js";
import type { RenderCommandBufferView } from "./renderCommandDecoder.js";
import { WebGL2VolumeShadowBatch } from "./webgl2VolumeShadowBatch.js";

/** One R8 ground-only visibility mask, shared by all native sun silhouettes. */
export class WebGL2SunShadowMask {
  private readonly batch: SpriteBatch;
  private volumes?:WebGL2VolumeShadowBatch;
  private texture?: WebGLTexture;
  private framebuffer?: WebGLFramebuffer;
  private width = 0;
  private height = 0;
  private readonly empty = new Float32Array(4);
  constructor(private readonly gl: WebGL2RenderingContext) {
    this.batch = new SpriteBatch(gl, false, false, false, true);
  }
  draw(source: SpriteTextureSource, commands: RenderCommandBufferView, width: number, height: number,
    resolution: [number, number], offset: readonly [number, number], restore: () => void, pixelSnap: number, groundYScale: number) {
    const gl = this.gl;
    const capabilities = [gl.DEPTH_TEST, gl.CULL_FACE, gl.SCISSOR_TEST];
    const enabled = capabilities.map(capability => gl.isEnabled(capability));
    const colorMask = gl.getParameter(gl.COLOR_WRITEMASK) as boolean[];
    try {
      this.resize(width, height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer!); gl.viewport(0, 0, width, height);
      for (const capability of capabilities) gl.disable(capability);
      gl.colorMask(true, true, true, true); gl.clearBufferfv(gl.COLOR, 0, this.empty);
      this.batch.pixelSnap = pixelSnap; this.batch.groundYScale = groundYScale;
      this.batch.maskReceivers = false;
      const volumeDraws=commands.groundShadowVolumes?.vertexCount
        ?(this.volumes??=new WebGL2VolumeShadowBatch(gl)).draw(commands.groundShadowVolumes,resolution,offset,pixelSnap):0;
      const casters = this.batch.drawBatches(source, commands, resolution, undefined, offset);
      // Ground shadows do not shade roofs, walls, characters or foreground sprites.
      this.batch.maskReceivers = true;
      const receivers = this.batch.drawBatches(source, commands, resolution, undefined, offset);
      return { texture: this.texture!, drawCalls: casters.drawCalls + receivers.drawCalls + volumeDraws,
        textureSwitchCount: casters.textureSwitchCount + receivers.textureSwitchCount };
    } finally {
      capabilities.forEach((capability, i) => enabled[i] ? gl.enable(capability) : gl.disable(capability));
      gl.colorMask(colorMask[0], colorMask[1], colorMask[2], colorMask[3]); restore();
    }
  }
  resourceStats() {
    const batch=this.batch.resourceStats(),volumes=this.volumes?.resourceStats();
    return { bufferCount:batch.bufferCount+(volumes?.bufferCount??0),programCount:batch.programCount+(volumes?.programCount??0),bufferBytes:batch.bufferBytes+(volumes?.bufferBytes??0), textureCount: this.texture ? 1 : 0,
      renderTargetCount: this.texture ? 1 : 0, textureBytes: this.width * this.height };
  }
  clearTarget() {
    if (this.texture) this.gl.deleteTexture(this.texture);
    if (this.framebuffer) this.gl.deleteFramebuffer(this.framebuffer);
    this.texture = undefined; this.framebuffer = undefined; this.width = this.height = 0;
  }
  destroy() { this.clearTarget(); this.batch.destroy(); this.volumes?.destroy(); }
  private resize(width: number, height: number) {
    if (this.width === width && this.height === height) return;
    const gl = this.gl, limit = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > limit || height > limit)
      throw Error("Invalid sunlight shadow mask dimensions");
    const texture = gl.createTexture(), framebuffer = gl.createFramebuffer();
    try {
      if (!texture || !framebuffer) throw Error("Sunlight shadow mask allocation failed");
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw Error("Incomplete sunlight shadow mask");
    } catch (error) { if (texture) gl.deleteTexture(texture); if (framebuffer) gl.deleteFramebuffer(framebuffer); throw error; }
    this.clearTarget(); this.texture = texture!; this.framebuffer = framebuffer!; this.width = width; this.height = height;
  }
}
