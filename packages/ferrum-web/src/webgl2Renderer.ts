import { emptyRendererStats, rendererStatsForCommands } from "./renderer";
import type { Renderer } from "./renderer";
import type { RendererStats } from "./renderer";
import { SpriteBatch } from "./spriteBatch";
import { TextureManager } from "./textureManager";
import type { RenderCommandBufferView } from "./wasmBridge";

export interface WebGL2RendererOptions {
  clearColor?: [number, number, number, number];
  preserveDrawingBuffer?: boolean;
}

export class WebGL2Renderer implements Renderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly textureManager: TextureManager;
  private readonly spriteBatch: SpriteBatch;
  private currentStats: RendererStats = emptyRendererStats();
  private logicalWidth = 0;
  private logicalHeight = 0;
  private destroyed = false;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly options: WebGL2RendererOptions = {}) {
    const gl = canvas.getContext("webgl2", {
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
    });
    if (!gl) throw new Error("WebGL2 context를 생성할 수 없습니다.");
    this.gl = gl;
    this.textureManager = new TextureManager(gl);
    this.textureManager.createPlaceholderTextureForId(0);
    this.spriteBatch = new SpriteBatch(gl);
    this.resize();
  }

  async loadTexture(textureId: number, url: string): Promise<WebGLTexture>;
  async loadTexture(url: string): Promise<WebGLTexture>;
  async loadTexture(first: number | string, second?: string): Promise<WebGLTexture> {
    this.assertAlive();
    if (typeof first === "number") {
      if (second === undefined) {
        throw new Error("loadTexture(textureId, url) requires a texture URL.");
      }
      return await this.textureManager.loadTexture(first, second);
    }

    try {
      return await this.textureManager.load(first);
    } catch {
      return this.textureManager.createPlaceholderTexture();
    }
  }

  stats(): RendererStats {
    return { ...this.currentStats };
  }

  resize(): void {
    this.assertAlive();
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

  viewportSize(): { width: number; height: number } {
    return {
      width: this.logicalWidth,
      height: this.logicalHeight,
    };
  }

  render(): void {
    this.assertAlive();
    const clear = this.options.clearColor ?? [0.08, 0.1, 0.15, 1.0];
    this.gl.clearColor(clear[0], clear[1], clear[2], clear[3]);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  renderCommands(commands: RenderCommandBufferView): RendererStats;
  renderCommands(texture: WebGLTexture, commands: RenderCommandBufferView): RendererStats;
  renderCommands(
    first: RenderCommandBufferView | WebGLTexture,
    second?: RenderCommandBufferView,
  ): RendererStats {
    this.assertAlive();
    const commands = second ?? (first as RenderCommandBufferView);
    const batchStats = second
      ? this.spriteBatch.drawBatch(first as WebGLTexture, second, [this.logicalWidth, this.logicalHeight])
      : this.spriteBatch.drawBatches(this.textureManager, commands, [this.logicalWidth, this.logicalHeight]);
    this.currentStats = rendererStatsForCommands(commands, batchStats.drawCalls, batchStats.textureSwitchCount);
    return this.stats();
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.spriteBatch.destroy();
    this.textureManager.destroy();
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error("WebGL2Renderer has been destroyed.");
    }
  }
}
