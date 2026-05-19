import { emptyRendererStats } from "./renderer.js";
import type { Renderer, RendererStats } from "./renderer.js";

/** @deprecated WebGPU는 현재 MVP 범위 밖입니다. 이 타입은 마이그레이션 호환용입니다. */
export interface WebGPURendererOptions {
  clearColor?: [number, number, number, number];
}

/**
 * @deprecated WebGPU renderer는 현재 MVP 범위 밖입니다.
 * WebGL2Renderer 또는 createRenderer(..., { preferred: "webgl2" })를 사용하세요.
 */
export class WebGPURenderer implements Renderer {
  private constructor() {}

  static async create(_canvas?: HTMLCanvasElement, _options: WebGPURendererOptions = {}): Promise<WebGPURenderer> {
    throw unsupportedWebGpuError();
  }

  render(): void {
    throw unsupportedWebGpuError();
  }

  resize(): void {
    throw unsupportedWebGpuError();
  }

  stats(): RendererStats {
    return emptyRendererStats();
  }

  destroy(): void {}
}

function unsupportedWebGpuError(): Error {
  return new Error("WebGPU renderer is outside the current Ferrum2D MVP scope. Use WebGL2Renderer instead.");
}
