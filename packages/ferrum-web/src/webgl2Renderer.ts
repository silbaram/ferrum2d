import type { Renderer } from "./renderer";
import { SpriteBatch } from "./spriteBatch";
import { TextureManager } from "./textureManager";
import type { RenderCommandView } from "./wasmBridge";

export interface WebGL2RendererOptions { clearColor?: [number, number, number, number]; }

export class WebGL2Renderer implements Renderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly textureManager: TextureManager;
  private readonly spriteBatch: SpriteBatch;

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
    const width = Math.floor(this.canvas.clientWidth * dpr);
    const height = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  render(): void {
    const clear = this.options.clearColor ?? [0.08, 0.1, 0.15, 1.0];
    this.gl.clearColor(clear[0], clear[1], clear[2], clear[3]);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  renderCommands(texture: WebGLTexture, commands: ReadonlyArray<RenderCommandView>): { drawCalls: number; batchCount: number } {
    const drawCalls = this.spriteBatch.drawBatch(texture, commands, [this.canvas.width, this.canvas.height]);
    return { drawCalls, batchCount: commands.length > 0 ? 1 : 0 };
  }

  destroy(): void { this.spriteBatch.destroy(); }
}
