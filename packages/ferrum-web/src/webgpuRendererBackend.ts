import { flatHdrOptions, validateFlatHdrTransition, type ResolvedFlatHdrOptions } from "./flatHdr.js";
import { WebGpuHdrPass } from "./webgpuHdrPass.js";
import { srgbToLinear } from "./colorManagement.js";
import { WebGpuFlatLitPass } from "./webgpuFlatLitPass.js";
import { validateFlatLitCommands, validateFlatLitMaterial, validateFlatLitAsset, type FlatLightingAsset } from "./flatLit.js";
import { WebGpuSpriteNormals } from "./webgpuSpriteNormals.js";
import { WebGpuPixelPerfect } from "./webgpuPixelPerfect.js";
import { resolvePixelPerfectOptions, resolvePixelPerfectPresentation, type PixelPerfectOptions, type PixelPerfectPresentation } from "./pixelPerfect.js";
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
import { groundShadowCount } from "./groundShadowRanges.js";
import { validateGroundShadowVolumes } from "./groundShadowVolumes.js";
import { WebGpuSunShadowMask } from "./webgpuSunShadowMask.js";
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
  pixelPerfect?: PixelPerfectOptions | false;
  /** Opt-in linear RGB composition and sRGB presentation; legacy remains the default. */
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
  readonly supportsGroundShadowVolumes = true;
  private readonly spatialPass: WebGpuSpatialPass;
  private context?: GPUCanvasContext;
  private readonly linearWorking: boolean;
  private readonly workingFormat: GPUTextureFormat;
  private managedFrame?: WebGpuPixelPerfect;
  private managedDrawCalls = 0;
  private readonly uniformBindGroupLayout: GPUBindGroupLayout;
  private readonly textureBindGroupLayout: GPUBindGroupLayout;
  private readonly uniformPipelineLayout: GPUPipelineLayout;
  private readonly resolutionBuffer: GPUBuffer;
  private readonly resolutionBindGroup: GPUBindGroup;
  private readonly spritePass: WebGpuSpritePass;
  private spriteNormals?:WebGpuSpriteNormals;
  private flatLit?:WebGpuFlatLitPass;
  private flatLitHdr?:WebGpuFlatLitPass;
  private flatLitSurface?:WebGpuFlatLitPass;
  private flatLitHdrSurface?:WebGpuFlatLitPass;
  private flatPassesUsed=0;
  private readonly flatSurfaceState={active:false};
  private hdrPass?:WebGpuHdrPass;
  private hdrActive?:ResolvedFlatHdrOptions;
  private hdrDebugLines?:WebGpuDebugLinePass;
  private hdrDrawCalls=0;
  private frameHasDrawnScene=false;
  private spriteMaterial=resolveSpriteMaterialPreset(undefined);
  private sunShadowMask?:WebGpuSunShadowMask;
  private sunShadowConfigured=false;
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
  private pixelPerfect?: PixelPerfectOptions;
  private presentation?: PixelPerfectPresentation;
  private pixelPass?: WebGpuPixelPerfect;
  private frameActive = false;
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
    this.pixelPerfect = resolvePixelPerfectOptions(options.pixelPerfect);
    this.linearWorking = resolveColorManagementMode(options.colorManagement) === "linear-srgb";
    this.workingFormat = this.linearWorking ? "rgba8unorm-srgb" : this.format;
    this.timer = new WebGpuTimer(device, options.gpuTiming === true);
    const sampler = this.device.createSampler({
      magFilter: "nearest",
      minFilter: "nearest",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    this.uniformBindGroupLayout = this.createUniformBindGroupLayout();
    this.textureBindGroupLayout = this.createTextureBindGroupLayout();
    this.textureStore = new WebGpuTextureStore(this.device, sampler, this.textureBindGroupLayout, this.linearWorking);
    this.postProcessPass = new WebGpuPostProcessPass(this.device, () => this.frameTexture(), this.workingFormat, options.postProcess, this.linearWorking);
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
      this.workingFormat,
      this.uniformBindGroupLayout,
      this.textureBindGroupLayout,
      this.textureStore,
      this.resolutionBindGroup,
      false, false, undefined, false, this.linearWorking,
    );
    this.debugLinePass = new WebGpuDebugLinePass(
      this.device,
      () => this.frameTexture(),
      this.workingFormat,
      this.uniformPipelineLayout,
      this.resolutionBindGroup,
    );
    this.lightingPass = new WebGpuLightingPass(
      this.device,
      this.workingFormat,
      this.uniformPipelineLayout,
      this.resolutionBindGroup,
    );
    resolveLightingSceneInto(this.lightingScene, options.lighting, this.lightingResolveCache);
    this.sunShadowConfigured=!!options.lighting&&options.lighting.directionalLight!==undefined;
    this.spriteMaterial=resolveSpriteMaterialPreset(options.spriteMaterial);if(this.lightingScene.profile==="lit")validateFlatLitMaterial(this.spriteMaterial);
    this.spriteMaterialPasses = spriteMaterialPasses(this.spriteMaterial);
    this.spritePass.configurePalettes(this.spriteMaterialPasses[this.spriteMaterialPasses.length-1]?.paletteSwap);
    this.textureStore.createPlaceholderTextureForId(PLACEHOLDER_TEXTURE_ID);
    this.spatialPass = new WebGpuSpatialPass(device, this.workingFormat, this.textureBindGroupLayout, this.textureStore, this.linearWorking);
    if(this.pixelPerfect) {
      this.pixelPass=new WebGpuPixelPerfect(device,this.workingFormat,this.format,this.linearWorking);
      this.pixelPass.resize(this.pixelPerfect.width,this.pixelPerfect.height);
    } else if(this.linearWorking) {
      // Validate the managed presentation pipeline before committing the canvas context.
      this.managedFrame=new WebGpuPixelPerfect(device,this.workingFormat,this.format,true,false);
      this.managedFrame.resize(1,1);
    }
  }

  static isSupported(): boolean {
    return typeof navigator !== "undefined" && navigator.gpu !== undefined;
  }

  static async create(
    canvas?: HTMLCanvasElement,
    options: WebGPURendererOptions = {},
  ): Promise<WebGpuRendererBackend> {
    resolvePixelPerfectOptions(options.pixelPerfect);
    resolveColorManagementMode(options.colorManagement);
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
    const stats = { ...this.currentStats };
    stats.textureBindCount+=this.hdrDrawCalls+this.managedDrawCalls;
    stats.drawCalls+=this.managedDrawCalls;stats.postProcessDrawCalls+=this.managedDrawCalls;
    stats.drawCalls+=this.hdrDrawCalls;stats.postProcessDrawCalls+=this.hdrDrawCalls;stats.postProcessPassCount+=this.hdrDrawCalls;
    return stats;
  }

  setLighting(scene: LightingScene2D | false | undefined): void {
    this.assertAlive();
    const nextLightingScene = resolveLightingSceneInto(this.lightingSceneStaging, scene, this.lightingResolveCache);
    if(nextLightingScene.profile==="lit") validateFlatLitMaterial(this.spriteMaterial);
    const nextHdr=flatHdrOptions(nextLightingScene);
    if(this.frameActive)validateFlatHdrTransition(nextHdr,this.hdrActive,this.frameHasDrawnScene);
    if(!nextHdr)this.resolveHdr();
    this.lightingSceneStaging = this.lightingScene;
    this.lightingScene = nextLightingScene;
    if(nextLightingScene.profile==="lit")this.lightingPass.clearTargets();
    this.sunShadowConfigured=!!scene&&scene.directionalLight!==undefined;
    if(nextLightingScene.profile!=="lit"||!nextLightingScene.enabled){this.clearFlatTargets();}
    if(!nextHdr){this.hdrPass?.release();this.flatLitHdr?.clearTargets();this.flatLitHdrSurface?.clearTargets();}
  }

  private clearFlatTargets():void{this.flatLit?.clearTargets();this.flatLitSurface?.clearTargets();this.flatLitHdr?.clearTargets();this.flatLitHdrSurface?.clearTargets();}
  private pruneFlatTargets():void{
    if(!(this.flatPassesUsed&1))this.flatLit?.clearTargets();if(!(this.flatPassesUsed&2))this.flatLitSurface?.clearTargets();
    if(!(this.flatPassesUsed&4))this.flatLitHdr?.clearTargets();if(!(this.flatPassesUsed&8))this.flatLitHdrSurface?.clearTargets();
  }
  prepareFlatLighting(scene:LightingScene2D,assets:readonly FlatLightingAsset[]):void{
    this.assertAlive();const resolved=resolveLightingSceneInto(createResolvedLightingScene(),scene);if(resolved.profile!=="lit")return;validateFlatLitMaterial(this.spriteMaterial);for(const asset of assets)validateFlatLitAsset(this.textureStore,asset,flatHdrOptions(resolved)!==undefined);
  }
  setSpriteMaterial(material: SpriteMaterialPresetInput): void {
    this.assertAlive();
    const resolved = resolveSpriteMaterialPreset(material);
    if(this.lightingScene.profile==="lit")validateFlatLitMaterial(resolved);
    this.spritePass.configurePalettes(resolved.paletteSwap);
    this.spriteMaterial=resolved;
    this.spriteMaterialPasses = spriteMaterialPasses(resolved);
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
    if (this.hdrActive) throw Error("Finish the Flat HDR world before changing viewport zoom");
    this.viewportZoom = zoom;
    this.resize();
  }

  resize(): void {
    this.assertAlive();
    if (this.hdrActive) throw Error("Finish the Flat HDR world before resizing");
    const dpr = window.devicePixelRatio || 1;
    this.logicalWidth = (this.pixelPerfect?.width ?? this.canvas.clientWidth) / this.viewportZoom;
    this.logicalHeight = (this.pixelPerfect?.height ?? this.canvas.clientHeight) / this.viewportZoom;
    const drawingBufferWidth = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const drawingBufferHeight = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== drawingBufferWidth || this.canvas.height !== drawingBufferHeight) {
      this.canvas.width = drawingBufferWidth;
      this.canvas.height = drawingBufferHeight;
      this.configureContext();
    }
    this.presentation = this.pixelPerfect ? resolvePixelPerfectPresentation(drawingBufferWidth,drawingBufferHeight,this.pixelPerfect) : undefined;
    if(this.pixelPerfect) {
      this.pixelPass ??= new WebGpuPixelPerfect(this.device,this.workingFormat,this.format,this.linearWorking);
      this.pixelPass.resize(this.pixelPerfect.width,this.pixelPerfect.height);
      this.managedFrame?.release();
    } else if(this.linearWorking) this.prepareManagedFrame();
    this.writeResolution();
  }

  setPixelPerfect(options: PixelPerfectOptions | false | undefined): void {
    this.assertAlive();
    if(this.frameActive)throw Error("Configure pixelPerfect between frames");
    const next=resolvePixelPerfectOptions(options);
    // Prepare before committing the configuration; a synchronous allocation
    // failure keeps the previous target and presentation usable.
    if(next) {
      this.pixelPass??=new WebGpuPixelPerfect(this.device,this.workingFormat,this.format,this.linearWorking);
      this.pixelPass.resize(next.width,next.height);
    }
    if(!next && this.linearWorking)this.prepareManagedFrame();
    this.pixelPerfect=next;
    if(!next)this.pixelPass?.release();
    this.resize();
  }
  pixelPerfectPresentation(): PixelPerfectPresentation | undefined { return this.presentation; }

  render(): void {
    this.assertAlive();
    this.pruneFlatTargets();this.flatPassesUsed=0;
    this.hdrActive=undefined;this.hdrDrawCalls=0;this.managedDrawCalls=0;this.frameHasDrawnScene=false;
    if(!flatHdrOptions(this.lightingScene)){this.hdrPass?.release();this.flatLitHdr?.clearTargets();this.flatLitHdrSurface?.clearTargets();}
    resetRendererStatsInto(this.currentStats);
    this.frameActive = true;
    const encoder = this.device.createCommandEncoder();
    const pass = this.beginRenderPass(encoder, "clear");
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  renderCommands(commands: RenderCommandBufferView): RendererStats {
    this.assertAlive();
    const receivers=validateFlatLitCommands(commands,this.lightingScene,this.textureStore,this.spriteMaterial,this.flatSurfaceState);const lit=this.lightingScene.profile==="lit";
    const hdr=flatHdrOptions(this.lightingScene);
    if(hdr)validateFlatHdrTransition(hdr,this.hdrActive,this.frameHasDrawnScene);
    let flat:WebGpuFlatLitPass|undefined;
    if(lit){
      const surface=this.flatSurfaceState.active&&this.lightingScene.enabled;
      flat=surface ? (hdr ? (this.flatLitHdrSurface??=new WebGpuFlatLitPass(this.device,"rgba16float",this.uniformBindGroupLayout,this.textureBindGroupLayout,this.textureStore,this.resolutionBindGroup,this.uniformPipelineLayout,true,this.linearWorking,true))
        : (this.flatLitSurface??=new WebGpuFlatLitPass(this.device,this.workingFormat,this.uniformBindGroupLayout,this.textureBindGroupLayout,this.textureStore,this.resolutionBindGroup,this.uniformPipelineLayout,false,this.linearWorking,true)))
        : hdr?(this.flatLitHdr??=new WebGpuFlatLitPass(this.device,"rgba16float",this.uniformBindGroupLayout,this.textureBindGroupLayout,this.textureStore,this.resolutionBindGroup,this.uniformPipelineLayout,true,this.linearWorking))
        :(this.flatLit??=new WebGpuFlatLitPass(this.device,this.workingFormat,this.uniformBindGroupLayout,this.textureBindGroupLayout,this.textureStore,this.resolutionBindGroup,this.uniformPipelineLayout,false,this.linearWorking));
      this.flatPassesUsed|=1<<((hdr?2:0)+(surface?1:0));
      flat.prepareFrame(this.pixelPerfect?.width??this.canvas.width,this.pixelPerfect?.height??this.canvas.height,receivers&&this.lightingScene.enabled);

    }else{this.clearFlatTargets();}
    const volumeCasters=validateGroundShadowVolumes(commands,!commands.spatial&&this.sunShadowConfigured);
    this.spritePass.validatePalettes(commands);
    if(commands.spatial && this.pixelPerfect)throw Error("Flat pixelPerfect cannot render spatial scenes; use spatial.environment.pixelArt");
    if (commands.groundYScale !== undefined && commands.groundYScale !== this.groundYScale) this.setGroundYScale(commands.groundYScale);
    const projection = groundShadowProjection(commands);
    const x = projection[0], y = projection[1], length = projection[2];
    const deferredSun=!commands.spatial&&this.sunShadowConfigured;
    const skipShadows=deferredSun?1:0;
    if (this.resolutionStaging[4] !== x || this.resolutionStaging[5] !== y || this.resolutionStaging[6] !== length || this.resolutionStaging[7]!==skipShadows) {
      this.resolutionStaging[4] = x; this.resolutionStaging[5] = y; this.resolutionStaging[6] = length;
      this.resolutionStaging[7]=skipShadows;
      this.writeResolution();
    }
    if (commands.spatial && this.lightingScene.enabled) throw Error("Spatial rendering cannot use flat LightingScene2D");
    if(hdr)this.beginHdr(hdr);
    const encoder = this.device.createCommandEncoder();
    const mapped=spriteNormalsActive(commands);
    const groundCasters=(!lit||receivers)&&deferredSun&&this.lightingScene.enabled&&(this.lightingScene.directionalLight?.intensity??0)>0?groundShadowCount(commands)+volumeCasters:0;
    const sunMaskStats=groundCasters>0
      ?(this.sunShadowMask??=new WebGpuSunShadowMask(this.device,this.uniformBindGroupLayout,this.textureBindGroupLayout,this.textureStore,this.resolutionBindGroup)).draw(encoder,commands,this.pixelPerfect?.width??this.canvas.width,this.pixelPerfect?.height??this.canvas.height):undefined;
    if(!sunMaskStats)this.sunShadowMask?.clearTarget();
    const normalStats=!lit&&mapped&&this.lightingScene.enabled?(this.spriteNormals??=new WebGpuSpriteNormals(this.device,this.uniformBindGroupLayout,this.textureBindGroupLayout,this.textureStore,this.resolutionBindGroup)).draw(encoder,commands,this.pixelPerfect?.width??this.canvas.width,this.pixelPerfect?.height??this.canvas.height,this.spriteMaterialPasses):undefined;
    if(!normalStats)this.spriteNormals?.clearTargets();
    const spatial = commands.spatial ? this.spatialPass.draw(commands.spatial, encoder, this.baseFrameTexture().createView(), this.canvas.width, this.canvas.height) : undefined;
    const target = this.frameTexture().createView();
    const pass = this.beginRenderPass(encoder, "load", target);

    const spriteStats = lit?flat!.drawColor(pass,commands,this.spriteMaterialPasses):this.spritePass.draw(pass, commands, this.spriteMaterialPasses);
    let flatStats;
    let lightingStats;
    if(lit){pass.end();if(receivers&&this.lightingScene.enabled)flatStats=flat!.drawLighting(encoder,target,commands,this.lightingScene,this.logicalWidth,this.logicalHeight,this.spriteMaterialPasses,sunMaskStats);lightingStats=flatStats?.lighting??{drawCalls:0,pointLightCount:0,tileOccluderCount:0,shadowDrawCalls:0,shadowCasterCount:0};}
    else {lightingStats=this.lightingPass.draw(pass, this.lightingScene, this.logicalWidth, this.logicalHeight,normalStats?this.spriteNormals!.buffers:undefined,{encoder,view:target,width:this.pixelPerfect?.width??this.canvas.width,height:this.pixelPerfect?.height??this.canvas.height},sunMaskStats);if(!lightingStats.passEnded)pass.end();}
    this.device.queue.submit([encoder.finish()]);
    if(commands.spatial)this.spatialPass.commitSubmission(commands.spatial);
    writeRendererStatsForCommandsInto(
      this.currentStats,
      commands,
      spriteStats.drawCalls,
      spriteStats.textureSwitchCount,
    );
    if(flatStats){this.currentStats.drawCalls+=flatStats.data.drawCalls;this.currentStats.batchCount+=flatStats.data.drawCalls;this.currentStats.textureBindCount+=flatStats.data.drawCalls*(this.flatSurfaceState.active?5:2)+(this.flatSurfaceState.active?5:3);this.currentStats.textureSwitchCount+=flatStats.data.textureSwitchCount;}
    this.currentStats.normalDrawCalls=flatStats?.data.drawCalls??normalStats?.drawCalls??0;
    if(normalStats){this.currentStats.drawCalls+=normalStats.drawCalls;this.currentStats.batchCount+=normalStats.drawCalls;this.currentStats.textureBindCount+=normalStats.drawCalls*2+2;this.currentStats.textureSwitchCount+=normalStats.textureSwitchCount;}
    addLightingStatsInto(
      this.currentStats,
      lightingStats.drawCalls,
      lightingStats.pointLightCount,
      lightingStats.tileOccluderCount,
      lightingStats.shadowDrawCalls,
      lightingStats.shadowCasterCount,
    );
    if(sunMaskStats){this.currentStats.drawCalls+=sunMaskStats.drawCalls;this.currentStats.lightingDrawCalls+=sunMaskStats.drawCalls;this.currentStats.batchCount+=sunMaskStats.drawCalls;this.currentStats.shadowDrawCalls+=sunMaskStats.drawCalls;this.currentStats.shadowCasterCount+=groundCasters;this.currentStats.textureBindCount+=sunMaskStats.drawCalls+1;this.currentStats.textureSwitchCount+=sunMaskStats.textureSwitchCount;}
    if (spatial) {
      this.currentStats.spatial = spatial; this.currentStats.drawCalls += spatial.drawCalls; this.currentStats.batchCount += spatial.drawCalls;
      this.currentStats.spriteCount += spatial.billboardCount; this.currentStats.textureBindCount += spatial.textureBindCount; this.currentStats.textureSwitchCount += spatial.textureSwitchCount;
    }
    this.frameHasDrawnScene=true;
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

    const hdr=flatHdrOptions(this.lightingScene);
    if(hdr){validateFlatHdrTransition(hdr,this.hdrActive,this.frameHasDrawnScene);this.beginHdr(hdr);}
    const debug=this.hdrActive?(this.hdrDebugLines??=new WebGpuDebugLinePass(this.device,()=>this.frameTexture(),"rgba16float",this.uniformPipelineLayout,this.resolutionBindGroup)):this.debugLinePass;
    const drawCalls = debug.draw(lines, { ...camera, groundYScale: this.groundYScale }, this.logicalWidth, this.logicalHeight);
    addPhysicsDebugLineStatsInto(this.currentStats, lines.lineCount, drawCalls);
    this.frameHasDrawnScene=true;
    return this.stats();
  }

  renderPostProcess(postProcess?: PostProcessStackInput): RendererStats {
    this.assertAlive();
    this.pruneFlatTargets();
    if (postProcess !== undefined) {
      this.postProcessPass.setPostProcess(postProcess);
    }
    this.resolveHdr();
    if ((this.presentation || this.linearWorking) && !this.frameActive) return this.stats();
    const postProcessStats = this.postProcessPass.drawPasses();
    addPostProcessStatsInto(
      this.currentStats,
      postProcessStats.drawCalls,
      postProcessStats.passCount,
    );
    if(this.presentation && this.frameActive) {
      this.pixelPass!.present(this.requireContext().getCurrentTexture(),this.presentation,this.pixelPerfect!.background!);
      this.currentStats.drawCalls++;this.currentStats.presentationPassCount=1;
    }
    if(this.linearWorking && !this.presentation && this.frameActive){
      this.managedFrame!.present(this.requireContext().getCurrentTexture(),{x:0,y:0,width:this.canvas.width,height:this.canvas.height},[0,0,0]);
      this.managedDrawCalls++;
    }
    this.frameActive=false;
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
    this.flatLit?.destroy();this.flatLitHdr?.destroy();this.flatLitSurface?.destroy();this.flatLitHdrSurface?.destroy();this.hdrPass?.destroy();this.hdrDebugLines?.destroy();
    this.sunShadowMask?.destroy();
    this.pixelPass?.release();this.managedFrame?.release();
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
    view?: GPUTextureView,
  ): GPURenderPassEncoder {
    const clear = this.options.clearColor ?? [0.08, 0.1, 0.15, 1.0], alphaScale=this.linearWorking?clear[3]:1;
    return beginWebGpuRenderPass(this.device, encoder, {
      colorAttachments: [{
        view: view ?? this.frameTexture().createView(),
        loadOp,
        storeOp: "store",
        clearValue: { r: clear[0]*alphaScale, g: clear[1]*alphaScale, b: clear[2]*alphaScale, a: clear[3] },
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

  private baseFrameTexture(): GPUTexture { return this.pixelPerfect ? this.pixelPass!.texture() : this.linearWorking ? this.managedFrame!.texture() : this.requireContext().getCurrentTexture(); }
  private frameTexture(): GPUTexture { return this.hdrActive ? this.hdrPass!.texture() : this.baseFrameTexture(); }

  private prepareManagedFrame():void {
    this.managedFrame??=new WebGpuPixelPerfect(this.device,this.workingFormat,this.format,true,false);
    this.managedFrame.resize(Math.max(1,this.canvas.width),Math.max(1,this.canvas.height));
  }

  private beginHdr(options:ResolvedFlatHdrOptions):void {
    if(this.hdrActive)return;
    this.hdrPass??=new WebGpuHdrPass(this.device,this.workingFormat);
    this.hdrPass.prepare(this.pixelPerfect?.width??this.canvas.width,this.pixelPerfect?.height??this.canvas.height);
    const clear=this.options.clearColor??[.08,.1,.15,1],rgb=this.linearWorking?clear:clear.slice(0,3).map(srgbToLinear);
    const encoder=this.device.createCommandEncoder(),pass=beginWebGpuRenderPass(this.device,encoder,{colorAttachments:[{
      view:this.hdrPass.texture().createView(),loadOp:"clear",storeOp:"store",clearValue:{r:rgb[0]!*clear[3],g:rgb[1]!*clear[3],b:rgb[2]!*clear[3],a:clear[3]},
    }]});pass.end();this.device.queue.submit([encoder.finish()]);
    this.hdrActive={...options};
  }

  private resolveHdr():void {
    if(!this.hdrActive)return;
    this.hdrPass!.resolve(this.baseFrameTexture(),this.hdrActive,!this.linearWorking);
    this.hdrActive=undefined;this.hdrDrawCalls++;
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
    // Occupies the existing alignment padding before shadowProjection (byte 12).
    this.resolutionStaging[3] = this.pixelPerfect?.snap ? this.viewportZoom : 0;
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
