import type { TextureAssetManager } from "./assetLoader.js";
import type { LightingScene2D } from "./lighting.js";
import type { SpriteMaterialPresetInput } from "./spriteMaterial.js";
import type { PixelMaskTerrainTextureTarget } from "./pixelMaskTerrainRuntime.js";
import type { SpatialModelPreparer } from "./spatialModel.js";
import type { PhysicsDebugLineBufferView, RenderCommandBufferView } from "./wasmBridge.js";
import type { PhysicsDebugLineCamera, Renderer, RendererStats } from "./renderer.js";

/** Structural runtime port: concrete GPU objects and private backend state stay behind it. */
export interface FerrumRuntimeRenderer extends Renderer, TextureAssetManager,
  Partial<SpatialModelPreparer>, Partial<PixelMaskTerrainTextureTarget> {
  renderCommands(commands: RenderCommandBufferView): RendererStats;
  renderPhysicsDebugLines?(lines: PhysicsDebugLineBufferView, camera: PhysicsDebugLineCamera): RendererStats;
  viewportSize(): { width: number; height: number };
  setLighting?(scene: LightingScene2D | false | undefined): void;
  setSpriteMaterial?(material: SpriteMaterialPresetInput): void;
}

/** A frame consumer does not load textures, resize a canvas or own renderer lifetime. */
export type RuntimeFrameRenderTarget = Pick<FerrumRuntimeRenderer,
  | "supportsSpatialScene" | "render" | "renderCommands" | "renderPhysicsDebugLines"
  | "setLighting" | "setSpriteMaterial" | "setPostProcess" | "renderPostProcess"
  | "beginGpuTiming" | "endGpuTiming" | "gpuTimingStats" | "resourceStats"
>;
