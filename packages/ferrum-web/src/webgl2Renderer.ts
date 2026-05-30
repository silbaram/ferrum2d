import {
  addLightingStatsInto,
  addPhysicsDebugLineStatsInto,
  addPostProcessStatsInto,
  emptyRendererStats,
  resetRendererStatsInto,
  writeRendererStatsForCommandsInto,
} from "./renderer";
import { PhysicsDebugLineBatch } from "./physicsDebugLineBatch";
import type { PhysicsDebugLineCamera } from "./physicsDebugLineBatch";
import type { Renderer } from "./renderer";
import type { RendererStats } from "./renderer";
import { cameraPostProcessingDiagnosticError } from "./diagnostics";
import {
  resolvePostProcessPasses,
} from "./cameraPostProcessing";
import type { PostProcessStackInput, ResolvedPostProcessPass } from "./cameraPostProcessing";
import { SpriteBatch } from "./spriteBatch";
import type { LightingScene2D, ResolvedLightingScene2D } from "./lighting";
import {
  createLightingSceneResolveCache,
  createResolvedLightingScene,
  resolveLightingSceneInto,
} from "./lightingNormalize";
import { resolveSpriteMaterialPreset } from "./spriteMaterial";
import type { ResolvedSpriteMaterialPreset, SpriteMaterialPresetInput } from "./spriteMaterial";
import { TextureManager } from "./textureManager";
import { WebGL2FullscreenPass } from "./webgl2FullscreenPass";
import type { WebGL2FullscreenPassStats, WebGL2FullscreenRenderTarget } from "./webgl2FullscreenPass";
import { WebGL2LightingPass } from "./webgl2LightingPass";
import type {
  PixelMaskTerrain,
  PixelMaskTerrainAlphaPatch,
  PixelMaskTerrainTextureUploadOptions,
} from "./pixelMaskTerrain";
import type { PhysicsDebugLineBufferView, RenderCommandBufferView } from "./wasmBridge";

type WebGL2FrameTargetMode = "default" | "postProcess";

const COPY_POST_PROCESS_PASS: ResolvedPostProcessPass = {
  kind: "fade",
  color: [0, 0, 0, 0],
};

export interface WebGL2RendererOptions {
  clearColor?: [number, number, number, number];
  preserveDrawingBuffer?: boolean;
  lighting?: LightingScene2D | false;
  spriteMaterial?: SpriteMaterialPresetInput;
  postProcess?: PostProcessStackInput;
}

export class WebGL2Renderer implements Renderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly textureManager: TextureManager;
  private readonly spriteBatch: SpriteBatch;
  private readonly physicsDebugLineBatch: PhysicsDebugLineBatch;
  private readonly lightingPass: WebGL2LightingPass;
  private readonly fullscreenPass: WebGL2FullscreenPass;
  private currentStats: RendererStats = emptyRendererStats();
  private lightingScene: ResolvedLightingScene2D = createResolvedLightingScene();
  private lightingSceneStaging: ResolvedLightingScene2D = createResolvedLightingScene();
  private readonly lightingResolveCache = createLightingSceneResolveCache();
  private spriteMaterial: ResolvedSpriteMaterialPreset;
  private postProcessPasses: readonly ResolvedPostProcessPass[];
  private sceneRenderTarget?: WebGL2RenderTarget;
  private postProcessScratchA?: WebGL2RenderTarget;
  private postProcessScratchB?: WebGL2RenderTarget;
  private logicalWidth = 0;
  private logicalHeight = 0;
  private readonly logicalResolution: [number, number] = [0, 0];
  private readonly drawingBufferResolution: [number, number] = [0, 0];
  private frameStarted = false;
  private frameHasDrawnScene = false;
  private frameTargetMode: WebGL2FrameTargetMode = "default";
  private destroyed = false;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly options: WebGL2RendererOptions = {}) {
    const gl = canvas.getContext("webgl2", {
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
    });
    if (!gl) throw new Error("WebGL2 context를 생성할 수 없습니다.");
    this.gl = gl;
    this.textureManager = new TextureManager(gl);
    this.textureManager.createPlaceholderTextureForId(0);
    this.spriteBatch = new SpriteBatch(gl);
    this.physicsDebugLineBatch = new PhysicsDebugLineBatch(gl);
    this.lightingPass = new WebGL2LightingPass(gl);
    this.fullscreenPass = new WebGL2FullscreenPass(gl);
    resolveLightingSceneInto(this.lightingScene, options.lighting, this.lightingResolveCache);
    this.spriteMaterial = resolveSpriteMaterialPreset(options.spriteMaterial);
    this.postProcessPasses = resolvePostProcessPasses(options.postProcess);
    this.resize();
  }

  async loadTexture(textureId: number, url: string): Promise<WebGLTexture>;
  async loadTexture(url: string): Promise<WebGLTexture>;
  async loadTexture(first: number | string, second?: string): Promise<WebGLTexture> {
    this.assertAlive();
    if (typeof first === "number") {
      if (second === undefined) {
        throw new Error("loadTexture(textureId, url) requires a texture URL.");
      }
      return await this.textureManager.loadTexture(first, second);
    }

    try {
      return await this.textureManager.load(first);
    } catch {
      return this.textureManager.createPlaceholderTexture();
    }
  }

  createPixelMaskTerrainTexture(
    textureId: number,
    terrain: PixelMaskTerrain,
    options?: PixelMaskTerrainTextureUploadOptions,
  ): WebGLTexture {
    this.assertAlive();
    return this.textureManager.createPixelMaskTerrainTexture(textureId, terrain, options);
  }

  updatePixelMaskTerrainTexture(
    textureId: number,
    patch: PixelMaskTerrainAlphaPatch,
    options?: PixelMaskTerrainTextureUploadOptions,
  ): void {
    this.assertAlive();
    this.textureManager.updatePixelMaskTerrainTexture(textureId, patch, options);
  }

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
    this.spriteMaterial = resolveSpriteMaterialPreset(material);
  }

  setPostProcess(postProcess: PostProcessStackInput): void {
    this.assertAlive();
    const nextPasses = resolvePostProcessPasses(postProcess);
    this.assertCanApplyPostProcessChange(nextPasses);
    this.postProcessPasses = nextPasses;
    if (this.frameStarted && !this.frameHasDrawnScene) {
      this.bindFrameStartTarget();
      this.clearFrameTarget();
    }
  }

  resize(): void {
    this.assertAlive();
    const dpr = window.devicePixelRatio || 1;
    this.logicalWidth = this.canvas.clientWidth;
    this.logicalHeight = this.canvas.clientHeight;

    const drawingBufferWidth = Math.floor(this.logicalWidth * dpr);
    const drawingBufferHeight = Math.floor(this.logicalHeight * dpr);

    if (this.canvas.width !== drawingBufferWidth || this.canvas.height !== drawingBufferHeight) {
      this.canvas.width = drawingBufferWidth;
      this.canvas.height = drawingBufferHeight;
    }
    this.logicalResolution[0] = this.logicalWidth;
    this.logicalResolution[1] = this.logicalHeight;

    this.resizePostProcessTargets();
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    if (this.frameStarted && !this.frameHasDrawnScene) {
      this.bindFrameStartTarget();
      this.clearFrameTarget();
    }
  }

  viewportSize(): { width: number; height: number } {
    return {
      width: this.logicalWidth,
      height: this.logicalHeight,
    };
  }

  render(): void {
    this.assertAlive();
    resetRendererStatsInto(this.currentStats);
    this.frameStarted = true;
    this.frameHasDrawnScene = false;
    this.bindFrameStartTarget();
    this.clearFrameTarget();
  }

  renderCommands(commands: RenderCommandBufferView): RendererStats;
  renderCommands(texture: WebGLTexture, commands: RenderCommandBufferView): RendererStats;
  renderCommands(
    first: RenderCommandBufferView | WebGLTexture,
    second?: RenderCommandBufferView,
  ): RendererStats {
    this.assertAlive();
    this.ensureCurrentFrameTarget();
    const commands = second ?? (first as RenderCommandBufferView);
    const resolution = this.logicalResolution;
    const batchStats = second
      ? this.spriteBatch.drawBatch(
        first as WebGLTexture,
        second,
        resolution,
        this.spriteMaterial,
      )
      : this.spriteBatch.drawBatches(
        this.textureManager,
        commands,
        resolution,
        this.spriteMaterial,
      );
    writeRendererStatsForCommandsInto(
      this.currentStats,
      commands,
      batchStats.drawCalls,
      batchStats.textureSwitchCount,
    );
    const lightingStats = this.lightingPass.draw(this.lightingScene, resolution);
    addLightingStatsInto(
      this.currentStats,
      lightingStats.drawCalls,
      lightingStats.pointLightCount,
      lightingStats.tileOccluderCount,
      lightingStats.shadowDrawCalls,
      lightingStats.shadowCasterCount,
    );
    this.frameHasDrawnScene = true;
    return this.stats();
  }

  renderPhysicsDebugLines(
    lines: PhysicsDebugLineBufferView,
    camera: PhysicsDebugLineCamera,
  ): RendererStats {
    this.assertAlive();
    this.ensureCurrentFrameTarget();
    const drawCalls = this.physicsDebugLineBatch.draw(
      lines,
      this.logicalResolution,
      camera,
    );
    addPhysicsDebugLineStatsInto(
      this.currentStats,
      lines.lineCount,
      drawCalls,
    );
    if (lines.lineCount > 0) {
      this.frameHasDrawnScene = true;
    }
    return this.stats();
  }

  renderPostProcess(postProcess?: PostProcessStackInput): RendererStats {
    this.assertAlive();
    if (postProcess !== undefined) {
      this.setPostProcess(postProcess);
    }
    if (this.postProcessPasses.length === 0) {
      let copyDrawCalls = 0;
      if (this.frameTargetMode === "postProcess") {
        copyDrawCalls = this.copySceneTargetToDefaultFramebuffer().drawCalls;
      }
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
      addPostProcessStatsInto(this.currentStats, copyDrawCalls, 0);
      this.frameStarted = false;
      this.frameTargetMode = "default";
      return this.stats();
    }
    if (this.frameTargetMode !== "postProcess") {
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
      addPostProcessStatsInto(this.currentStats, 0, 0);
      this.frameStarted = false;
      this.frameTargetMode = "default";
      return this.stats();
    }
    const targets = this.ensurePostProcessTargets();
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    const postProcessStats = this.fullscreenPass.draw({
      sourceTexture: targets.scene.texture,
      passes: this.postProcessPasses,
      resolution: this.currentDrawingBufferResolution(),
      scratchTargets: [targets.scratchA, targets.scratchB],
    });
    addPostProcessStatsInto(
      this.currentStats,
      postProcessStats.drawCalls,
      postProcessStats.passCount,
    );
    this.frameStarted = false;
    this.frameTargetMode = "default";
    return this.stats();
  }

  private currentDrawingBufferResolution(): [number, number] {
    this.drawingBufferResolution[0] = this.canvas.width;
    this.drawingBufferResolution[1] = this.canvas.height;
    return this.drawingBufferResolution;
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.spriteBatch.destroy();
    this.physicsDebugLineBatch.destroy();
    this.lightingPass.destroy();
    this.fullscreenPass.destroy();
    this.sceneRenderTarget?.destroy();
    this.postProcessScratchA?.destroy();
    this.postProcessScratchB?.destroy();
    this.textureManager.destroy();
  }

  private bindFrameStartTarget(): void {
    if (this.postProcessPasses.length === 0) {
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      this.frameTargetMode = "default";
      return;
    }
    const targets = this.ensurePostProcessTargets();
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, targets.scene.framebuffer);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.frameTargetMode = "postProcess";
  }

  private ensureCurrentFrameTarget(): void {
    if (!this.frameStarted || this.frameHasDrawnScene) {
      return;
    }
    const expectedTargetMode = this.postProcessPasses.length === 0 ? "default" : "postProcess";
    if (this.frameTargetMode !== expectedTargetMode) {
      this.bindFrameStartTarget();
      this.clearFrameTarget();
    }
  }

  private assertCanApplyPostProcessChange(nextPasses: readonly ResolvedPostProcessPass[]): void {
    if (
      this.frameStarted
      && this.frameHasDrawnScene
      && this.frameTargetMode !== "postProcess"
      && nextPasses.length > 0
    ) {
      throw cameraPostProcessingDiagnosticError(
        "webgl2.postProcess",
        "post-process passes must be configured before scene drawing starts; call setPostProcess before renderCommands.",
      );
    }
  }

  private clearFrameTarget(): void {
    const clear = this.options.clearColor ?? [0.08, 0.1, 0.15, 1.0];
    this.gl.clearColor(clear[0], clear[1], clear[2], clear[3]);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  private copySceneTargetToDefaultFramebuffer(): WebGL2FullscreenPassStats {
    const targets = this.ensurePostProcessTargets();
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    return this.fullscreenPass.draw({
      sourceTexture: targets.scene.texture,
      passes: [COPY_POST_PROCESS_PASS],
      resolution: this.currentDrawingBufferResolution(),
      scratchTargets: [targets.scratchA, targets.scratchB],
    });
  }

  private ensurePostProcessTargets(): {
    scene: WebGL2RenderTarget;
    scratchA: WebGL2FullscreenRenderTarget;
    scratchB: WebGL2FullscreenRenderTarget;
  } {
    const width = Math.max(1, this.canvas.width);
    const height = Math.max(1, this.canvas.height);
    this.sceneRenderTarget ??= new WebGL2RenderTarget(this.gl, width, height);
    this.postProcessScratchA ??= new WebGL2RenderTarget(this.gl, width, height);
    this.postProcessScratchB ??= new WebGL2RenderTarget(this.gl, width, height);
    this.sceneRenderTarget.resize(width, height);
    this.postProcessScratchA.resize(width, height);
    this.postProcessScratchB.resize(width, height);
    return {
      scene: this.sceneRenderTarget,
      scratchA: this.postProcessScratchA,
      scratchB: this.postProcessScratchB,
    };
  }

  private resizePostProcessTargets(): void {
    if (!this.sceneRenderTarget && !this.postProcessScratchA && !this.postProcessScratchB) {
      return;
    }
    const width = Math.max(1, this.canvas.width);
    const height = Math.max(1, this.canvas.height);
    this.sceneRenderTarget?.resize(width, height);
    this.postProcessScratchA?.resize(width, height);
    this.postProcessScratchB?.resize(width, height);
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error("WebGL2Renderer has been destroyed.");
    }
  }
}

class WebGL2RenderTarget implements WebGL2FullscreenRenderTarget {
  readonly texture: WebGLTexture;
  readonly framebuffer: WebGLFramebuffer;
  private width = 0;
  private height = 0;
  private destroyed = false;

  constructor(private readonly gl: WebGL2RenderingContext, width: number, height: number) {
    const texture = this.gl.createTexture();
    const framebuffer = this.gl.createFramebuffer();
    if (!texture || !framebuffer) {
      throw new Error("WebGL2 post-process render target 생성 실패");
    }
    this.texture = texture;
    this.framebuffer = framebuffer;

    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
    this.resize(width, height);
  }

  resize(width: number, height: number): void {
    if (this.destroyed || (this.width === width && this.height === height)) {
      return;
    }
    this.width = width;
    this.height = height;
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      width,
      height,
      0,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      null,
    );
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffer);
    this.gl.framebufferTexture2D(
      this.gl.FRAMEBUFFER,
      this.gl.COLOR_ATTACHMENT0,
      this.gl.TEXTURE_2D,
      this.texture,
      0,
    );
    const status = this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER);
    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    if (status !== this.gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`WebGL2 post-process framebuffer incomplete: ${status}`);
    }
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.gl.deleteFramebuffer(this.framebuffer);
    this.gl.deleteTexture(this.texture);
  }
}
