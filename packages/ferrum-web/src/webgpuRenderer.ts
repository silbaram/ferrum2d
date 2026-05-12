import { emptyRendererStats } from "./renderer";
import type { Renderer, RendererStats } from "./renderer";

export interface WebGPURendererOptions {
  clearColor?: [number, number, number, number];
}

export class WebGPURenderer implements Renderer {
  private readonly context: GPUCanvasContext;
  private readonly clearColor: [number, number, number, number];
  private device: GPUDevice | null = null;
  private format: GPUTextureFormat | null = null;
  private currentStats: RendererStats = emptyRendererStats();
  private destroyed = false;
  private logicalWidth = 0;
  private logicalHeight = 0;

  private constructor(private readonly canvas: HTMLCanvasElement, options: WebGPURendererOptions = {}) {
    const context = canvas.getContext("webgpu") as GPUCanvasContext | null;
    if (!context) {
      throw new Error("WebGPU canvas context를 생성할 수 없습니다.");
    }
    this.context = context;
    this.clearColor = options.clearColor ?? [0.08, 0.1, 0.15, 1.0];
    this.resize();
  }

  static async create(canvas: HTMLCanvasElement, options: WebGPURendererOptions = {}): Promise<WebGPURenderer> {
    if (!navigator.gpu) {
      throw new Error("이 브라우저는 WebGPU를 지원하지 않습니다.");
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error("WebGPU adapter를 찾을 수 없습니다.");
    }

    const renderer = new WebGPURenderer(canvas, options);
    renderer.device = await adapter.requestDevice();
    renderer.format = navigator.gpu.getPreferredCanvasFormat();
    renderer.context.configure({
      device: renderer.device,
      format: renderer.format,
      alphaMode: "opaque",
    });
    return renderer;
  }

  render(): void {
    this.assertUsable();

    const encoder = this.device!.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: {
          r: this.clearColor[0],
          g: this.clearColor[1],
          b: this.clearColor[2],
          a: this.clearColor[3],
        },
        loadOp: "clear",
        storeOp: "store",
      }],
    });
    pass.end();
    this.device!.queue.submit([encoder.finish()]);
    this.currentStats = emptyRendererStats();
  }

  resize(): void {
    this.logicalWidth = this.canvas.clientWidth;
    this.logicalHeight = this.canvas.clientHeight;

    const dpr = window.devicePixelRatio || 1;
    const drawingBufferWidth = Math.floor(this.logicalWidth * dpr);
    const drawingBufferHeight = Math.floor(this.logicalHeight * dpr);

    if (this.canvas.width !== drawingBufferWidth || this.canvas.height !== drawingBufferHeight) {
      this.canvas.width = drawingBufferWidth;
      this.canvas.height = drawingBufferHeight;
    }
  }

  viewportSize(): { width: number; height: number } {
    return { width: this.logicalWidth, height: this.logicalHeight };
  }

  stats(): RendererStats {
    return { ...this.currentStats };
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.currentStats = emptyRendererStats();
    this.context.unconfigure?.();
    this.device = null;
    this.format = null;
  }

  private assertUsable(): void {
    if (this.destroyed) {
      throw new Error("WebGPURenderer가 destroy() 된 뒤 render()가 호출되었습니다.");
    }
    if (!this.device || !this.format) {
      throw new Error("WebGPURenderer가 초기화되지 않았습니다. WebGPURenderer.create()를 사용하세요.");
    }
  }
}
