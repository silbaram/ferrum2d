import { WebGpuSpriteNormals } from "./webgpuSpriteNormals.js";
import { spriteNormalsActive } from "./spriteNormals.js";
import { WebGpuTimer, beginWebGpuRenderPass } from "./webgpuGpuTimer.js";
import { webGpuResources } from "./webgpuResources.js";
import { WebGpuSpatialPass } from "./webgpuSpatialPass.js";
import "./webgpuTypes.js";
import {
  addLightingStatsInto,
  addPhysicsDebugLineStatsInto,
  addPostProcessStatsInto,
  emptyRendererStats,
  resetRendererStatsInto,
  writeRendererStatsForCommandsInto,
} from "./renderer.js";
import type { Renderer, RendererStats } from "./renderer.js";
import type { PostProcessStackInput } from "./cameraPostProcessing.js";
import type { LightingScene2D, ResolvedLightingScene2D } from "./lighting.js";
import {
  createLightingSceneResolveCache,
  createResolvedLightingScene,
  resolveLightingSceneInto,
} from "./lightingNormalize.js";
import { resolveSpriteMaterialPreset, spriteMaterialPasses } from "./spriteMaterial.js";
import { groundShadowProjection } from "./groundShadowProjection.js";
import type { SpriteMaterialPass, SpriteMaterialPresetInput } from "./spriteMaterial.js";
import type { PixelMaskTerrain } from "./pixelMaskTerrain.js";
import type {
  PixelMaskTerrainAlphaPatch,
  PixelMaskTerrainTextureUploadOptions,
} from "./pixelMaskTerrain.js";
import type { PhysicsDebugLineBufferView, RenderCommandBufferView } from "./wasmBridge.js";
import type { PhysicsDebugLineCamera } from "./renderer.js";
import { WebGpuDebugLinePass } from "./webgpuDebugLinePass.js";
import { WebGpuLightingPass } from "./webgpuLightingPass.js";
import { WebGpuPostProcessPass, resolveWebGpuPostProcessPasses } from "./webgpuPostProcessPass.js";
import { WebGpuSpritePass } from "./webgpuSpritePass.js";
import { WebGpuTextureStore } from "./webgpuTextureStore.js";
import { resolveColorManagementMode, resolveTextureColorSpace } from "./colorManagement.js";
import type { ColorManagementMode, TextureLoadOptions } from "./colorManagement.js";
import type { SpatialModelAsset, SpatialModelPreparation } from "./spatialModel.js";

export interface WebGPURendererOptions {
  /** linear-srgb is currently supported by WebGL2 only; createRenderer can fall back. */
  colorManagement?: ColorManagementMode;
  /** Opt-in asynchronous render-pass timing; unavailable adapters still render. */
  gpuTiming?: boolean;
  clearColor?: [number, number, number, number];
  powerPreference?: GPUPowerPreference;
  fallbackAdapter?: boolean;
  lighting?: LightingScene2D | false;
  spriteMaterial?: SpriteMaterialPresetInput;
  postProcess?: PostProcessStackInput;
}

const UNIFORM_BUFFER_BYTES = 32;
const PLACEHOLDER_TEXTURE_ID = 0;

export class WebGpuRendererBackend implements Renderer {
  readonly supportsSpatialScene = true;
  private readonly spatialPass: WebGpuSpatialPass;
  private context?: GPUCanvasContext;
  private readonly uniformBindGroupLayout: GPUBindGroupLayout;
  private readonly textureBindGroupLayout: GPUBindGroupLayout;
  private readonly uniformPipelineLayout: GPUPipelineLayout;
  private readonly resolutionBuffer: GPUBuffer;
  private readonly resolutionBindGroup: GPUBindGroup;
  private readonly spritePass: WebGpuSpritePass;
  private spriteNormals?:WebGpuSpriteNormals;
  private readonly debugLinePass: WebGpuDebugLinePass;
  private readonly lightingPass: WebGpuLightingPass;
  private readonly postProcessPass: WebGpuPostProcessPass;
  private readonly textureStore: WebGpuTextureStore;
  private currentStats: RendererStats = emptyRendererStats();
  private lightingScene: ResolvedLightingScene2D = createResolvedLightingScene();
  private lightingSceneStaging: ResolvedLightingScene2D = createResolvedLightingScene();
  private readonly lightingResolveCache = createLightingSceneResolveCache();
  private spriteMaterialPasses: readonly SpriteMaterialPass[];
  private viewportZoom = 1;
  private groundYScale = 1;
  private logicalWidth = 0;
  private logicalHeight = 0;
  private readonly resolutionStaging = new Float32Array([0, 0, 1, 0, 1, 0, 1, 0]);
  private destroyed = false;
  private readonly timer: WebGpuTimer;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly adapter: GPUAdapter,
    private readonly device: GPUDevice,
    private readonly format: GPUTextureFormat,
    private readonly options: WebGPURendererOptions = {},
  ) {
    this.timer = new WebGpuTimer(device, options.gpuTiming === true);
    const sampler = this.device.createSampler({
      magFilter: "nearest",
      minFilter: "nearest",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    this.uniformBindGroupLayout = this.createUniformBindGroupLayout();
    this.textureBindGroupLayout = this.createTextureBindGroupLayout();
    this.textureStore = new WebGpuTextureStore(this.device, sampler, this.textureBindGroupLayout);
    this.postProcessPass = new WebGpuPostProcessPass(this.device, () => this.requireContext().getCurrentTexture(), this.format, options.postProcess);
    this.uniformPipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.uniformBindGroupLayout],
    });
    this.resolutionBuffer = webGpuResources(this.device).createBuffer({
      size: UNIFORM_BUFFER_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.resolutionBindGroup = this.device.createBindGroup({
      layout: this.uniformBindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.resolutionBuffer } }],
    });
    this.spritePass = new WebGpuSpritePass(
      this.device,
      this.format,
      this.uniformBindGroupLayout,
      this.textureBindGroupLayout,
      this.textureStore,
      this.resolutionBindGroup,
    );
    this.debugLinePass = new WebGpuDebugLinePass(
      this.device,
      () => this.requireContext().getCurrentTexture(),
      this.format,
      this.uniformPipelineLayout,
      this.resolutionBindGroup,
    );
    this.lightingPass = new WebGpuLightingPass(
      this.device,
      this.format,
      this.uniformPipelineLayout,
      this.resolutionBindGroup,
    );
    resolveLightingSceneInto(this.lightingScene, options.lighting, this.lightingResolveCache);
    this.spriteMaterialPasses = spriteMaterialPasses(resolveSpriteMaterialPreset(options.spriteMaterial));
    this.textureStore.createPlaceholderTextureForId(PLACEHOLDER_TEXTURE_ID);
    this.spatialPass = new WebGpuSpatialPass(device, format, this.textureBindGroupLayout, this.textureStore);
  }

  static isSupported(): boolean {
    return typeof navigator !== "undefined" && navigator.gpu !== undefined;
  }

  static async create(
    canvas?: HTMLCanvasElement,
    options: WebGPURendererOptions = {},
  ): Promise<WebGpuRendererBackend> {
    if (resolveColorManagementMode(options.colorManagement) !== "legacy") {
      throw new Error("WebGPU linear-srgb color management is not supported; use the WebGL2 fallback.");
    }
    resolveWebGpuPostProcessPasses(options.postProcess);
    if (canvas === undefined) {
      throw new Error("WebGPURenderer.create(...) requires an HTMLCanvasElement.");
    }
    if (!WebGpuRendererBackend.isSupported()) {
      throw new Error("WebGPU is not available in this browser.");
    }

    const gpu = navigator.gpu;
    if (gpu === undefined) {
      throw new Error("WebGPU is not available in this browser.");
    }
    const adapter = await gpu.requestAdapter({
      powerPreference: options.powerPreference,
      forceFallbackAdapter: options.fallbackAdapter,
    });
    if (adapter === null) {
      throw new Error("WebGPU adapter is not available.");
    }
    const device = await adapter.requestDevice(options.gpuTiming && adapter.features?.has("timestamp-query") ? { requiredFeatures: ["timestamp-query"] } : undefined);
    let initialLoss: {message:string} | undefined;
    void device.lost?.then(info=>{initialLoss=info;});
    let renderer: WebGpuRendererBackend | undefined, bound = false;
    try {
      // Validate/allocate all pipelines before the irreversible canvas context selection.
      device.pushErrorScope("validation"); device.pushErrorScope("out-of-memory");
      try {
        renderer = new WebGpuRendererBackend(canvas, adapter, device, gpu.getPreferredCanvasFormat(), options);
      } finally {
        const allocation = await device.popErrorScope(), validation = await device.popErrorScope();
        if (allocation || validation) throw Error((allocation ?? validation)!.message);
      }
      if (initialLoss) throw Error("WebGPU device was lost before canvas commit: "+initialLoss.message);
      const context = canvas.getContext("webgpu");
      if (!context) throw Error("WebGPU canvas context is not available.");
      bound = true; renderer.context = context; renderer.configureContext(); renderer.resize();
      return renderer;
    } catch (reason) {
      renderer?.destroy(); webGpuResources(device).destroyAll(); device.destroy();
      if (bound) throw new WebGpuCanvasCommitError(reason);
      throw reason;
    }
  }

  gpuAdapter(): GPUAdapter {
    this.assertAlive();
    return this.adapter;
  }

  gpuDevice(): GPUDevice {
    this.assertAlive();
    return this.device;
  }

  /** Cold GPU preparation for protected Data Scene authoring activation. */
  prepareSpatialModels(assets: readonly SpatialModelAsset[]): SpatialModelPreparation {
    this.assertAlive();
    return this.spatialPass.prepareModels(assets);
  }

  /** Await GPU upload/validation before applying a scene with these models. Returns uploaded bytes. */
  preloadSpatialModels(assets: readonly SpatialModelAsset[]): Promise<number> {
    this.assertAlive();
    return this.spatialPass.preloadModels(assets);
  }

  async loadTexture(textureId: number, url: string, options?: TextureLoadOptions): Promise<GPUTexture>;
  async loadTexture(url: string, options?: TextureLoadOptions): Promise<GPUTexture>;
  async loadTexture(first: number | string, second?: string | TextureLoadOptions, options?: TextureLoadOptions): Promise<GPUTexture> {
    this.assertAlive();
    if (typeof first === "number") {
      if (typeof second !== "string") {
        throw new Error("loadTexture(textureId, url) requires a texture URL.");
      }
      resolveTextureColorSpace(options);
      return await this.textureStore.loadTexture(first, second, options);
    }

    const loadOptions = typeof second === "object" ? second : undefined;
    resolveTextureColorSpace(loadOptions);
    return await this.textureStore.load(first, loadOptions);
  }

  createPixelMaskTerrainTexture(
    textureId: number,
    terrain: PixelMaskTerrain,
    options: PixelMaskTerrainTextureUploadOptions = {},
  ): GPUTexture {
    this.assertAlive();
    return this.textureStore.createPixelMaskTerrainTexture(textureId, terrain, options);
  }

  updatePixelMaskTerrainTexture(
    textureId: number,
    patch: PixelMaskTerrainAlphaPatch,
    options: PixelMaskTerrainTextureUploadOptions = {},
  ): void {
    this.assertAlive();
    this.textureStore.updatePixelMaskTerrainTexture(textureId, patch, options);
  }

  evictTexture(textureId: number): boolean {
    this.assertAlive();
    return this.textureStore.evictTexture(textureId);
  }

  viewportSize(): { width: number; height: number } {
    return {
      width: this.logicalWidth,
      height: this.logicalHeight,
    };
  }

  textureSource(id: number): Blob { const source=this.textureStore.resource(id).source;if(!source)throw Error("Texture has no encoded recovery source");return source; }

  restoreRgbaTexture(id: number, width: number, height: number, data: Uint8Array): GPUTexture { return this.textureStore.restoreRgbaTexture(id,width,height,data); }

  resourceStats() { return webGpuResources(this.device).stats(); }
  beginGpuTiming(): void { this.assertAlive(); this.timer.beginFrame(); }
  endGpuTiming(discard = false): void { if (!this.destroyed) this.timer.endFrame(discard); }
  gpuTimingStats() { return this.timer.stats(); }

  stats(): RendererStats {
    return { ...this.currentStats };
  }

  setLighting(scene: LightingScene2D | false | undefined): void {
    this.assertAlive();
    const nextLightingScene = resolveLightingSceneInto(this.lightingSceneStaging, scene, this.lightingResolveCache);
    this.lightingSceneStaging = this.lightingScene;
    this.lightingScene = nextLightingScene;
  }

  setSpriteMaterial(material: SpriteMaterialPresetInput): void {
    this.assertAlive();
    this.spriteMaterialPasses = spriteMaterialPasses(resolveSpriteMaterialPreset(material));
  }

  setPostProcess(postProcess: PostProcessStackInput): void {
    this.assertAlive();
    this.postProcessPass.setPostProcess(postProcess);
  }

  setGroundYScale(scale: number): void {
    this.assertAlive();
    // Rust sends f32 metadata; the encoded lower bound is slightly less than JS 0.01.
    if (!Number.isFinite(scale) || scale < Math.fround(0.01) || scale > 1) throw new Error("groundYScale must be in [0.01, 1]");
    this.groundYScale = scale;
    this.writeResolution();
  }

  setViewportZoom(zoom: number): void {
    this.assertAlive();
    if (!Number.isFinite(zoom) || zoom < 0.0001 || zoom > 10000) throw new Error("Viewport zoom must be in [0.0001, 10000].");
    this.viewportZoom = zoom;
    this.resize();
  }

  resize(): void {
    this.assertAlive();
    const dpr = window.devicePixelRatio || 1;
    this.logicalWidth = this.canvas.clientWidth / this.viewportZoom;
    this.logicalHeight = this.canvas.clientHeight / this.viewportZoom;
    const drawingBufferWidth = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const drawingBufferHeight = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== drawingBufferWidth || this.canvas.height !== drawingBufferHeight) {
      this.canvas.width = drawingBufferWidth;
      this.canvas.height = drawingBufferHeight;
      this.configureContext();
    }
    this.writeResolution();
  }

  render(): void {
    this.assertAlive();
    resetRendererStatsInto(this.currentStats);
    const encoder = this.device.createCommandEncoder();
    const pass = this.beginRenderPass(encoder, "clear");
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  renderCommands(commands: RenderCommandBufferView): RendererStats {
    this.assertAlive();
    if (commands.groundYScale !== undefined && commands.groundYScale !== this.groundYScale) this.setGroundYScale(commands.groundYScale);
    const projection = groundShadowProjection(commands);
    const x = projection[0], y = projection[1], length = projection[2];
    if (this.resolutionStaging[4] !== x || this.resolutionStaging[5] !== y || this.resolutionStaging[6] !== length) {
      this.resolutionStaging[4] = x; this.resolutionStaging[5] = y; this.resolutionStaging[6] = length;
      this.writeResolution();
    }
    if (commands.spatial && this.lightingScene.enabled) throw Error("Spatial rendering cannot use flat LightingScene2D");
    const encoder = this.device.createCommandEncoder();
    const mapped=spriteNormalsActive(commands);
    const normalStats=mapped&&this.lightingScene.enabled?(this.spriteNormals??=new WebGpuSpriteNormals(this.device,this.uniformBindGroupLayout,this.textureBindGroupLayout,this.textureStore,this.resolutionBindGroup)).draw(encoder,commands,this.canvas.width,this.canvas.height,this.spriteMaterialPasses):undefined;
    if(!normalStats)this.spriteNormals?.clearTargets();
    const spatial = commands.spatial ? this.spatialPass.draw(commands.spatial, encoder, this.requireContext().getCurrentTexture().createView(), this.canvas.width, this.canvas.height) : undefined;
    const pass = this.beginRenderPass(encoder, "load");

    const spriteStats = this.spritePass.draw(pass, commands, this.spriteMaterialPasses);
    const lightingStats = this.lightingPass.draw(pass, this.lightingScene, this.logicalWidth, this.logicalHeight,normalStats?this.spriteNormals!.buffers:undefined);

    pass.end();
    this.device.queue.submit([encoder.finish()]);
    if(commands.spatial)this.spatialPass.commitSubmission(commands.spatial);
    writeRendererStatsForCommandsInto(
      this.currentStats,
      commands,
      spriteStats.drawCalls,
      spriteStats.textureSwitchCount,
    );
    this.currentStats.normalDrawCalls=normalStats?.drawCalls??0;
    if(normalStats){this.currentStats.drawCalls+=normalStats.drawCalls;this.currentStats.batchCount+=normalStats.drawCalls;this.currentStats.textureBindCount+=normalStats.drawCalls*2+2;this.currentStats.textureSwitchCount+=normalStats.textureSwitchCount;}
    addLightingStatsInto(
      this.currentStats,
      lightingStats.drawCalls,
      lightingStats.pointLightCount,
      lightingStats.tileOccluderCount,
      lightingStats.shadowDrawCalls,
      lightingStats.shadowCasterCount,
    );
    if (spatial) {
      this.currentStats.spatial = spatial; this.currentStats.drawCalls += spatial.drawCalls; this.currentStats.batchCount += spatial.drawCalls;
      this.currentStats.spriteCount += spatial.billboardCount; this.currentStats.textureBindCount += spatial.textureBindCount; this.currentStats.textureSwitchCount += spatial.textureSwitchCount;
    }
    return this.stats();
  }

  renderPhysicsDebugLines(
    lines: PhysicsDebugLineBufferView,
    camera: PhysicsDebugLineCamera,
  ): RendererStats {
    this.assertAlive();
    if (lines.lineCount === 0) {
      return this.stats();
    }

    const drawCalls = this.debugLinePass.draw(lines, { ...camera, groundYScale: this.groundYScale }, this.logicalWidth, this.logicalHeight);
    addPhysicsDebugLineStatsInto(this.currentStats, lines.lineCount, drawCalls);
    return this.stats();
  }

  renderPostProcess(postProcess?: PostProcessStackInput): RendererStats {
    this.assertAlive();
    if (postProcess !== undefined) {
      this.postProcessPass.setPostProcess(postProcess);
    }
    const postProcessStats = this.postProcessPass.drawPasses();
    addPostProcessStatsInto(
      this.currentStats,
      postProcessStats.drawCalls,
      postProcessStats.passCount,
    );
    return this.stats();
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.timer.destroy();
    this.spatialPass.destroy();
    this.postProcessPass.destroy();
    this.textureStore.destroy();
    this.debugLinePass.destroy();
    this.lightingPass.destroy();
    this.spritePass.destroy();
    this.spriteNormals?.destroy();
    webGpuResources(this.device).destroy(this.resolutionBuffer);
    webGpuResources(this.device).destroyAll();
  }

  private requireContext(): GPUCanvasContext {
    if (!this.context) throw Error("WebGPU canvas has not been committed");
    return this.context;
  }

  private configureContext(): void {
    this.requireContext().configure({
      device: this.device,
      format: this.format,
      alphaMode: "premultiplied",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
  }

  private beginRenderPass(
    encoder: GPUCommandEncoder,
    loadOp: GPULoadOp,
  ): GPURenderPassEncoder {
    const clear = this.options.clearColor ?? [0.08, 0.1, 0.15, 1.0];
    return beginWebGpuRenderPass(this.device, encoder, {
      colorAttachments: [{
        view: this.requireContext().getCurrentTexture().createView(),
        loadOp,
        storeOp: "store",
        clearValue: { r: clear[0], g: clear[1], b: clear[2], a: clear[3] },
      }],
    });
  }

  private createUniformBindGroupLayout(): GPUBindGroupLayout {
    return this.device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: "uniform" },
      }],
    });
  }

  private createTextureBindGroupLayout(): GPUBindGroupLayout {
    return this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: "filtering" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float", viewDimension: "2d", multisampled: false },
        },
      ],
    });
  }

  private writeResolution(): void {
    this.resolutionStaging[0] = Math.max(this.logicalWidth, 1);
    this.resolutionStaging[1] = Math.max(this.logicalHeight, 1);
    this.resolutionStaging[2] = this.groundYScale;
    this.device.queue.writeBuffer(
      this.resolutionBuffer,
      0,
      this.resolutionStaging,
    );
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error("WebGPURenderer has been destroyed.");
    }
  }
}

/** Canvas contexts cannot switch API after selection; automatic same-canvas fallback is impossible. */
export class WebGpuCanvasCommitError extends Error {
  constructor(readonly cause: unknown) {
    super("WebGPU canvas initialization failed after binding; another renderer requires a fresh canvas.");
    this.name = "WebGpuCanvasCommitError";
  }
}
