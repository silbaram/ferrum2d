import { AudioManager } from "./audioManager";
import { AssetLoader } from "./assetLoader";
import type { Renderer } from "./renderer";
import type { RendererStats } from "./renderer";
import { SpriteBatch } from "./spriteBatch";
import { TextureManager } from "./textureManager";
import type { AssetLoadProgressCallback, AssetManifest, LoadedAssets } from "./assetLoader";
import type { AudioEventView, RenderCommandBufferView } from "./wasmBridge";

export interface WebGL2RendererOptions { clearColor?: [number, number, number, number]; }

export class WebGL2Renderer implements Renderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly textureManager: TextureManager;
  private readonly audioManager: AudioManager;
  private readonly assetLoader: AssetLoader;
  private readonly spriteBatch: SpriteBatch;
  private currentStats: RendererStats = { drawCalls: 0, batchCount: 0, spriteCount: 0 };
  private logicalWidth = 0;
  private logicalHeight = 0;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly options: WebGL2RendererOptions = {}) {
    const gl = canvas.getContext("webgl2");
    if (!gl) throw new Error("WebGL2 context를 생성할 수 없습니다.");
    this.gl = gl;
    this.textureManager = new TextureManager(gl);
    this.textureManager.createPlaceholderTextureForId(0);
    this.audioManager = new AudioManager();
    this.assetLoader = new AssetLoader(this.textureManager, this.audioManager);
    this.spriteBatch = new SpriteBatch(gl);
    this.resize();
  }

  async loadTexture(url: string): Promise<WebGLTexture> {
    try { return await this.textureManager.load(url); } catch { return this.textureManager.createPlaceholderTexture(); }
  }

  async loadAssets(manifest: AssetManifest, onProgress?: AssetLoadProgressCallback): Promise<LoadedAssets> {
    return await this.assetLoader.loadAssets(manifest, onProgress);
  }

  textureId(name: string): number {
    return this.assetLoader.textureId(name);
  }

  soundId(name: string): number {
    return this.assetLoader.soundId(name);
  }

  playAudioEvents(events: readonly AudioEventView[]): void {
    this.audioManager.playEvents(events);
  }

  stats(): RendererStats {
    return { ...this.currentStats };
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

  renderCommands(commands: RenderCommandBufferView): RendererStats;
  renderCommands(texture: WebGLTexture, commands: RenderCommandBufferView): RendererStats;
  renderCommands(
    first: RenderCommandBufferView | WebGLTexture,
    second?: RenderCommandBufferView,
  ): RendererStats {
    const commands = second ?? (first as RenderCommandBufferView);
    const drawCalls = second
      ? this.spriteBatch.drawBatch(first as WebGLTexture, second, [this.logicalWidth, this.logicalHeight])
      : this.spriteBatch.drawBatches(this.textureManager, commands, [this.logicalWidth, this.logicalHeight]);
    this.currentStats = {
      drawCalls,
      batchCount: drawCalls,
      spriteCount: commands.commandCount,
    };
    return this.stats();
  }

  destroy(): void {
    this.spriteBatch.destroy();
    this.textureManager.destroy();
    this.audioManager.destroy();
  }
}
