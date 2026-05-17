import type { Renderer } from "./renderer";
import { WebGL2Renderer } from "./webgl2Renderer";
import { WebGPURenderer, type WebGPURendererOptions } from "./webgpuRenderer";

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
): Promise<Renderer> {
  const preferred = options.preferred ?? "webgl2";

  if (preferred === "webgpu") {
    try {
      return await WebGPURenderer.create(canvas, options.webgpu);
    } catch (reason) {
      options.onFallback?.({
        preferred: "webgpu",
        fallback: "webgl2",
        reason,
      });

      if ((options.fallbackBehavior ?? "warn") === "warn") {
        console.warn("[ferrum-web] WebGPU 초기화 실패로 WebGL2로 fallback합니다.", reason);
      }

      return new WebGL2Renderer(canvas, options.webgl2);
    }
  }

  return new WebGL2Renderer(canvas, options.webgl2);
}
