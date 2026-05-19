import type { Renderer } from "./renderer";
import type { WebGPURendererOptions } from "./webgpuRenderer";
import { WebGL2Renderer } from "./webgl2Renderer";

/** @deprecated WebGPU는 현재 MVP 범위 밖입니다. WebGL2 fallback 진단 호환용 타입입니다. */
export interface RendererFallbackInfo {
  preferred: "webgpu";
  fallback: "webgl2";
  reason: unknown;
}

export interface CreateRendererOptions {
  /**
   * @deprecated MVP는 WebGL2만 지원합니다. "webgpu"를 전달하면 WebGL2로 fallback합니다.
   */
  preferred?: "webgpu" | "webgl2";
  webgl2?: ConstructorParameters<typeof WebGL2Renderer>[1];
  /** @deprecated WebGPU는 현재 MVP 범위 밖입니다. */
  webgpu?: WebGPURendererOptions;
  /** @deprecated WebGPU fallback 진단 호환용입니다. */
  onFallback?: (info: RendererFallbackInfo) => void;
  /** @deprecated WebGPU fallback 진단 호환용입니다. */
  fallbackBehavior?: "silent" | "warn";
}

export async function createRenderer(
  canvas: HTMLCanvasElement,
  options: CreateRendererOptions = {},
): Promise<Renderer> {
  if (options.preferred === "webgpu") {
    const reason = new Error("WebGPU renderer is outside the current Ferrum2D MVP scope. Using WebGL2Renderer.");
    options.onFallback?.({
      preferred: "webgpu",
      fallback: "webgl2",
      reason,
    });
    if ((options.fallbackBehavior ?? "warn") === "warn") {
      console.warn("[ferrum-web] WebGPU는 현재 MVP 범위 밖이므로 WebGL2로 fallback합니다.", reason);
    }
  }

  return new WebGL2Renderer(canvas, options.webgl2);
}
