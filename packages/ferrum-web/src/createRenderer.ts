import type { Renderer } from "./renderer";
import type { WebGPURendererOptions } from "./webgpuRenderer";
import { WebGPURenderer } from "./webgpuRenderer";
import { WebGL2Renderer } from "./webgl2Renderer";

export type CreatedRenderer = WebGL2Renderer | WebGPURenderer;

export interface RendererFallbackInfo {
  preferred: "webgpu";
  fallback: "webgl2";
  reason: unknown;
}

export interface CreateRendererOptions {
  preferred?: "webgpu" | "webgl2";
  webgl2?: ConstructorParameters<typeof WebGL2Renderer>[1];
  webgpu?: WebGPURendererOptions;
  onFallback?: (info: RendererFallbackInfo) => void;
  fallbackBehavior?: "silent" | "warn";
}

export async function createRenderer(
  canvas: HTMLCanvasElement,
  options: CreateRendererOptions = {},
): Promise<CreatedRenderer & Renderer> {
  if (options.preferred === "webgpu") {
    try {
      return await WebGPURenderer.create(canvas, options.webgpu);
    } catch (reason) {
      options.onFallback?.({
        preferred: "webgpu",
        fallback: "webgl2",
        reason,
      });
      if ((options.fallbackBehavior ?? "warn") === "warn") {
        console.warn("[ferrum-web] WebGPU renderer를 사용할 수 없어 WebGL2로 fallback합니다.", reason);
      }
    }
  }

  return new WebGL2Renderer(canvas, options.webgl2);
}
