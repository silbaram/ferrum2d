import type { Renderer } from "./renderer";
import { SpriteBatch } from "./spriteBatch";
import { TextureManager } from "./textureManager";
import type { RenderCommandView } from "./wasmBridge";

export interface WebGL2RendererOptions { clearColor?: [number, number, number, number]; }

export interface RendererStats {
  drawCalls: number;
  batchCount: number;
  spriteCount: number;
}

export class WebGL2Renderer implements Renderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly textureManager: TextureManager;
  private readonly spriteBatch: SpriteBatch;
  private logicalWidth = 0;
  private logicalHeight = 0;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly options: WebGL2RendererOptions = {}) {
    const gl = canvas.getContext("webgl2");
    if (!gl) throw new Error("WebGL2 context를 생성할 수 없습니다.");
    this.gl = gl;
    this.textureManager = new TextureManager(gl);
    this.spriteBatch = new SpriteBatch(gl);
    this.resize();
  }

  async loadTexture(url: string): Promise<WebGLTexture> {
    try { return await this.textureManager.load(url); } catch { return this.textureManager.createPlaceholderTexture(); }
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.logicalWidth = this.canvas.clientWidth;
    this.logicalHeight = this.canvas.clientHeight;

    const drawingBufferWidth = Math.floor(this.logicalWidth * dpr);
    const drawingBufferHeight = Math.floor(this.logicalHeight * dpr);

    if (this.canvas.width !== drawingBufferWidth || this.canvas.height !== drawingBufferHeight) {
      this.canvas.width = drawingBufferWidth;
      this.canvas.height = drawingBufferHeight;
    }

    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  render(): void {
    const clear = this.options.clearColor ?? [0.08, 0.1, 0.15, 1.0];
    this.gl.clearColor(clear[0], clear[1], clear[2], clear[3]);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  renderCommands(texture: WebGLTexture, commands: ReadonlyArray<RenderCommandView>): RendererStats {
    const drawCalls = this.spriteBatch.drawBatch(texture, commands, [this.logicalWidth, this.logicalHeight]);
    return {
      drawCalls,
      batchCount: commands.length > 0 ? 1 : 0,
      spriteCount: commands.length,
    };
  }

  destroy(): void {
    this.spriteBatch.destroy();
    this.textureManager.destroy();
  }
}
