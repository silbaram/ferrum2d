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
import { createResolvedLightingScene, resolveLightingSceneInto } from "./lightingNormalize.js";
import { resolveSpriteMaterialPreset, spriteMaterialPasses } from "./spriteMaterial.js";
import type { SpriteMaterialPass, SpriteMaterialPresetInput } from "./spriteMaterial.js";
import type {
  PixelMaskTerrain,
  PixelMaskTerrainAlphaPatch,
  PixelMaskTerrainTextureUploadOptions,
} from "./pixelMaskTerrain.js";
import type { PhysicsDebugLineBufferView, RenderCommandBufferView } from "./wasmBridge.js";
import type { PhysicsDebugLineCamera } from "./physicsDebugLineBatch.js";
import { WebGpuDebugLinePass } from "./webgpuDebugLinePass.js";
import { WebGpuLightingPass } from "./webgpuLightingPass.js";
import { WebGpuPostProcessPass } from "./webgpuPostProcessPass.js";
import { WebGpuSpritePass } from "./webgpuSpritePass.js";
import { WebGpuTextureStore } from "./webgpuTextureStore.js";

export interface WebGPURendererOptions {
  clearColor?: [number, number, number, number];
  powerPreference?: GPUPowerPreference;
  fallbackAdapter?: boolean;
  lighting?: LightingScene2D | false;
  spriteMaterial?: SpriteMaterialPresetInput;
  postProcess?: PostProcessStackInput;
}

const UNIFORM_BUFFER_BYTES = 8;
const PLACEHOLDER_TEXTURE_ID = 0;

export class WebGPURenderer implements Renderer {
  private readonly uniformBindGroupLayout: GPUBindGroupLayout;
  private readonly textureBindGroupLayout: GPUBindGroupLayout;
  private readonly uniformPipelineLayout: GPUPipelineLayout;
  private readonly resolutionBuffer: GPUBuffer;
  private readonly resolutionBindGroup: GPUBindGroup;
  private readonly spritePass: WebGpuSpritePass;
  private readonly debugLinePass: WebGpuDebugLinePass;
  private readonly lightingPass: WebGpuLightingPass;
  private readonly postProcessPass: WebGpuPostProcessPass;
  private readonly textureStore: WebGpuTextureStore;
  private currentStats: RendererStats = emptyRendererStats();
  private lightingScene: ResolvedLightingScene2D = createResolvedLightingScene();
  private lightingSceneStaging: ResolvedLightingScene2D = createResolvedLightingScene();
  private spriteMaterialPasses: readonly SpriteMaterialPass[];
  private logicalWidth = 0;
  private logicalHeight = 0;
  private readonly resolutionStaging = new Float32Array(2);
  private destroyed = false;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly adapter: GPUAdapter,
    private readonly device: GPUDevice,
    private readonly context: GPUCanvasContext,
    private readonly format: GPUTextureFormat,
    private readonly options: WebGPURendererOptions = {},
  ) {
    const sampler = this.device.createSampler({
      magFilter: "nearest",
      minFilter: "nearest",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    this.uniformBindGroupLayout = this.createUniformBindGroupLayout();
    this.textureBindGroupLayout = this.createTextureBindGroupLayout();
    this.textureStore = new WebGpuTextureStore(this.device, sampler, this.textureBindGroupLayout);
    this.postProcessPass = new WebGpuPostProcessPass(this.device, this.context, this.format, options.postProcess);
    this.uniformPipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.uniformBindGroupLayout],
    });
    this.resolutionBuffer = this.device.createBuffer({
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
      this.context,
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
    resolveLightingSceneInto(this.lightingScene, options.lighting);
    this.spriteMaterialPasses = spriteMaterialPasses(resolveSpriteMaterialPreset(options.spriteMaterial));
    this.resize();
    this.textureStore.createPlaceholderTextureForId(PLACEHOLDER_TEXTURE_ID);
  }

  static isSupported(): boolean {
    return typeof navigator !== "undefined" && navigator.gpu !== undefined;
  }

  static async create(
    canvas?: HTMLCanvasElement,
    options: WebGPURendererOptions = {},
  ): Promise<WebGPURenderer> {
    if (canvas === undefined) {
      throw new Error("WebGPURenderer.create(...) requires an HTMLCanvasElement.");
    }
    if (!WebGPURenderer.isSupported()) {
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
    const device = await adapter.requestDevice();
    const context = canvas.getContext("webgpu");
    if (context === null) {
      throw new Error("WebGPU canvas context is not available.");
    }
    const format = gpu.getPreferredCanvasFormat();
    const renderer = new WebGPURenderer(canvas, adapter, device, context, format, options);
    renderer.configureContext();
    return renderer;
  }

  gpuAdapter(): GPUAdapter {
    this.assertAlive();
    return this.adapter;
  }

  gpuDevice(): GPUDevice {
    this.assertAlive();
    return this.device;
  }

  async loadTexture(textureId: number, url: string): Promise<GPUTexture>;
  async loadTexture(url: string): Promise<GPUTexture>;
  async loadTexture(first: number | string, second?: string): Promise<GPUTexture> {
    this.assertAlive();
    if (typeof first === "number") {
      if (second === undefined) {
        throw new Error("loadTexture(textureId, url) requires a texture URL.");
      }
      return await this.textureStore.loadTexture(first, second);
    }

    return await this.textureStore.load(first);
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

  viewportSize(): { width: number; height: number } {
    return {
      width: this.logicalWidth,
      height: this.logicalHeight,
    };
  }

  stats(): RendererStats {
    return { ...this.currentStats };
  }

  setLighting(scene: LightingScene2D | false | undefined): void {
    this.assertAlive();
    const nextLightingScene = resolveLightingSceneInto(this.lightingSceneStaging, scene);
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

  resize(): void {
    this.assertAlive();
    const dpr = window.devicePixelRatio || 1;
    this.logicalWidth = this.canvas.clientWidth;
    this.logicalHeight = this.canvas.clientHeight;
    const drawingBufferWidth = Math.max(1, Math.floor(this.logicalWidth * dpr));
    const drawingBufferHeight = Math.max(1, Math.floor(this.logicalHeight * dpr));
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
    const encoder = this.device.createCommandEncoder();
    const pass = this.beginRenderPass(encoder, "load");

    const spriteStats = this.spritePass.draw(pass, commands, this.spriteMaterialPasses);
    const lightingStats = this.lightingPass.draw(pass, this.lightingScene, this.logicalWidth, this.logicalHeight);

    pass.end();
    this.device.queue.submit([encoder.finish()]);
    writeRendererStatsForCommandsInto(
      this.currentStats,
      commands,
      spriteStats.drawCalls,
      spriteStats.textureSwitchCount,
    );
    addLightingStatsInto(
      this.currentStats,
      lightingStats.drawCalls,
      lightingStats.pointLightCount,
      lightingStats.tileOccluderCount,
      lightingStats.shadowDrawCalls,
      lightingStats.shadowCasterCount,
    );
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

    const drawCalls = this.debugLinePass.draw(lines, camera, this.logicalWidth, this.logicalHeight);
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
    this.postProcessPass.destroy();
    this.textureStore.destroy();
    this.debugLinePass.destroy();
    this.lightingPass.destroy();
    this.spritePass.destroy();
    this.resolutionBuffer.destroy();
  }

  private configureContext(): void {
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: "premultiplied",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  private beginRenderPass(
    encoder: GPUCommandEncoder,
    loadOp: GPULoadOp,
  ): GPURenderPassEncoder {
    const clear = this.options.clearColor ?? [0.08, 0.1, 0.15, 1.0];
    return encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
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
