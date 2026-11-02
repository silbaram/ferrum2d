import type { DataSceneSpatialSpec } from "./dataSceneSpatial.js";
import { resolveDataSceneSpatialSpec } from "./dataSceneSpatial.js";
import { assertWebGpuSpatialSpecSupported } from "./webgpuSpatialSupport.js";
import type { ShaderPreparationOptions } from "./shaderPreparation";
import type { Renderer } from "./renderer";
import type { WebGPURendererOptions } from "./webgpuRenderer";
import { WebGPURenderer, WebGpuCanvasCommitError } from "./webgpuRenderer";
import { WebGL2Renderer } from "./webgl2Renderer";
import { resolveColorManagementMode } from "./colorManagement";
import type { ColorManagementMode } from "./colorManagement";
import { resolvePixelPerfectOptions, type PixelPerfectOptions } from "./pixelPerfect.js";

export type CreatedRenderer = WebGL2Renderer | WebGPURenderer;

export interface RendererFallbackInfo {
  preferred: "webgpu";
  fallback: "webgl2";
  reason: unknown;
}

export interface CreateRendererOptions {
  pixelPerfect?: PixelPerfectOptions | false;
  /** Shared by the requested renderer and its fallback. */
  colorManagement?: ColorManagementMode;
  /** Opt-in WebGL2 shader readiness, including a WebGL2 fallback. */
  shaderPreparation?: ShaderPreparationOptions;
  preferred?: "webgpu" | "webgl2";
  /** Authored spatial requirements, checked before selecting an irreversible canvas context. */
  spatial?: DataSceneSpatialSpec;
  webgl2?: ConstructorParameters<typeof WebGL2Renderer>[1];
  webgpu?: WebGPURendererOptions;
  onFallback?: (info: RendererFallbackInfo) => void;
  fallbackBehavior?: "silent" | "warn";
}

export async function createRenderer(
  canvas: HTMLCanvasElement,
  options: CreateRendererOptions = {},
): Promise<CreatedRenderer & Renderer> {
  if (options.shaderPreparation?.signal?.aborted)
    throw new DOMException("Renderer creation was cancelled.", "AbortError");
  const colorManagement = resolveRendererColorManagement(options);
  const pixelPerfect = resolveRendererPixelPerfect(options);
  const spatial =
    options.spatial === undefined ? undefined : resolveDataSceneSpatialSpec(options.spatial);
  if(spatial && pixelPerfect)throw Error("Flat pixelPerfect cannot be combined with spatial; use spatial.environment.pixelArt");
  if (options.preferred === "webgpu") {
    try {
      if (spatial) assertWebGpuSpatialSpecSupported(spatial);
      const renderer = await WebGPURenderer.create(canvas, { ...options.webgpu, colorManagement, pixelPerfect });
      if (options.shaderPreparation?.signal?.aborted) {
        renderer.destroy();
        throw new DOMException("Renderer creation was cancelled.", "AbortError");
      }
      return renderer;
    } catch (reason) {
      if (reason instanceof WebGpuCanvasCommitError) throw reason;
      if (options.shaderPreparation?.signal?.aborted)
        throw new DOMException("Renderer creation was cancelled.", "AbortError");
      options.onFallback?.({
        preferred: "webgpu",
        fallback: "webgl2",
        reason,
      });
      if ((options.fallbackBehavior ?? "warn") === "warn") {
        console.warn(
          "[ferrum-web] WebGPU renderer를 사용할 수 없어 WebGL2로 fallback합니다.",
          reason,
        );
      }
    }
  }

  const webgl2 = { ...options.webgl2, colorManagement, pixelPerfect };
  return options.shaderPreparation === undefined
    ? new WebGL2Renderer(canvas, webgl2)
    : WebGL2Renderer.create(canvas, webgl2, options.shaderPreparation);
}

/** Internal shared resolution for renderer creation and runtime-authored colors. */
export function resolveRendererColorManagement(
  options: Pick<CreateRendererOptions, "colorManagement" | "webgl2" | "webgpu">,
): ColorManagementMode {
  const colorManagement = resolveColorManagementMode(
    options.colorManagement ?? options.webgl2?.colorManagement ?? options.webgpu?.colorManagement,
  );
  for (const mode of [
    options.colorManagement,
    options.webgl2?.colorManagement,
    options.webgpu?.colorManagement,
  ]) {
    if (mode !== undefined && resolveColorManagementMode(mode) !== colorManagement) {
      throw new Error("Conflicting renderer colorManagement options.");
    }
  }
  return colorManagement;
}

export function resolveRendererPixelPerfect(options: Pick<CreateRendererOptions,"pixelPerfect"|"webgl2"|"webgpu">): PixelPerfectOptions | undefined {
  const values=[options.pixelPerfect,options.webgl2?.pixelPerfect,options.webgpu?.pixelPerfect].filter(value=>value!==undefined);
  const settings=values.map(resolvePixelPerfectOptions);
  // Omitted snap and explicit false describe the same default presentation.
  const key = (value: PixelPerfectOptions | undefined) => value === undefined ? undefined :
    JSON.stringify([value.width, value.height, value.background, value.snap ?? false]);
  if(settings.some(value=>key(value)!==key(settings[0])))throw Error("Conflicting renderer pixelPerfect options");
  return settings[0];
}
