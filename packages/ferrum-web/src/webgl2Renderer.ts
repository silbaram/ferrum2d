import { prepareWebGL2Renderer } from "./webgl2ShaderPrograms";
import type { ShaderPreparationOptions } from "./shaderPreparation";
import type { RendererResourceStats } from "./rendererResources";
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
import type { SpriteTextureSource } from "./spriteBatch";
import type { LightingScene2D, ResolvedLightingScene2D } from "./lighting";
import {
  createLightingSceneResolveCache,
  createResolvedLightingScene,
  resolveLightingSceneInto,
} from "./lightingNormalize";
import { resolveSpriteMaterialPreset } from "./spriteMaterial";
import type { ResolvedSpriteMaterialPreset, SpriteMaterialPresetInput } from "./spriteMaterial";
import { WebGL2RenderTarget } from "./webgl2RenderTarget";
import { WebGL2RenderTextureStore } from "./webgl2RenderTextureStore";
import type { RenderTexture, RenderTextureOptions, RenderToTextureOptions } from "./renderTexture";
import { resolveColorManagementMode, resolveTextureColorSpace } from "./colorManagement";
import type { ColorManagementMode, TextureLoadOptions } from "./colorManagement";
import { TextureManager } from "./textureManager";
import type { TextureManagerOptions } from "./textureManager";
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

export interface WebGL2RendererOptions extends TextureManagerOptions {
  colorManagement?: ColorManagementMode;
  clearColor?: [number, number, number, number];
  preserveDrawingBuffer?: boolean;
  lighting?: LightingScene2D | false;
  spriteMaterial?: SpriteMaterialPresetInput;
  postProcess?: PostProcessStackInput;
}

export class WebGL2Renderer implements Renderer {
  readonly colorManagement: ColorManagementMode;
  private readonly gl: WebGL2RenderingContext;
  private readonly textureManager: TextureManager;
  private readonly spriteBatch: SpriteBatch;
  private readonly renderTextures: WebGL2RenderTextureStore;
  private readonly loadingTextureIds = new Map<number, number>();
  private readonly textureSource: SpriteTextureSource;
  private readonly offscreenStats = emptyRendererStats();
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
  private viewportZoom = 1;
  private groundYScale = 1;
  private logicalWidth = 0;
  private logicalHeight = 0;
  private readonly logicalResolution: [number, number] = [0, 0];
  private readonly drawingBufferResolution: [number, number] = [0, 0];
  private readonly spriteScreenOffset: [number, number] = [0, 0];
  private frameStarted = false;
  private frameHasDrawnScene = false;
  private frameTargetMode: WebGL2FrameTargetMode = "default";
  private destroyed = false;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly options: WebGL2RendererOptions = {}) {
    this.colorManagement = resolveColorManagementMode(options.colorManagement);
    const gl = canvas.getContext("webgl2", {
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
    });
    if (!gl) throw new Error("WebGL2 context를 생성할 수 없습니다.");
    this.gl = gl;
    resolveLightingSceneInto(this.lightingScene, options.lighting, this.lightingResolveCache);
    this.spriteMaterial = resolveSpriteMaterialPreset(options.spriteMaterial);
    this.postProcessPasses = resolvePostProcessPasses(options.postProcess);
    const cleanup: Array<() => void> = [];
    try {
      this.textureManager = new TextureManager(gl, this.colorManagement, options);
      cleanup.push(() => this.textureManager.destroy());
      this.renderTextures = new WebGL2RenderTextureStore(gl, this.colorManagement === "linear-srgb");
      cleanup.push(() => this.renderTextures.destroy());
      this.textureSource = {
        texture: (id) => this.renderTextures.texture(id) ?? this.textureManager.texture(id),
        textureFlipY: (id) => this.renderTextures.has(id),
      };
      this.textureManager.createPlaceholderTextureForId(0);
      this.spriteBatch = new SpriteBatch(gl, this.colorManagement === "linear-srgb");
      cleanup.push(() => this.spriteBatch.destroy());
      this.physicsDebugLineBatch = new PhysicsDebugLineBatch(gl, this.colorManagement === "linear-srgb");
      cleanup.push(() => this.physicsDebugLineBatch.destroy());
      this.lightingPass = new WebGL2LightingPass(gl, this.colorManagement === "linear-srgb");
      cleanup.push(() => this.lightingPass.destroy());
      this.fullscreenPass = new WebGL2FullscreenPass(gl);
      cleanup.push(() => this.fullscreenPass.destroy());
      this.resize();
    } catch (error) {
      for (const dispose of cleanup.reverse()) dispose();
      throw error;
    }
  }

  /** Optional preparation path; the normal constructor remains synchronous. */
  static async create(
    canvas: HTMLCanvasElement,
    options: WebGL2RendererOptions = {},
    preparation: ShaderPreparationOptions = {},
  ): Promise<WebGL2Renderer> {
    resolveColorManagementMode(options.colorManagement);
    if (preparation.signal?.aborted) throw new DOMException("Shader preparation was cancelled.", "AbortError");
    const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: options.preserveDrawingBuffer ?? false });
    if (!gl) throw new Error("WebGL2 context를 생성할 수 없습니다.");
    return prepareWebGL2Renderer(gl, preparation, () => new WebGL2Renderer(canvas, options));
  }

  async loadTexture(textureId: number, url: string, options?: TextureLoadOptions): Promise<WebGLTexture>;
  async loadTexture(url: string, options?: TextureLoadOptions): Promise<WebGLTexture>;
  async loadTexture(first: number | string, second?: string | TextureLoadOptions, options?: TextureLoadOptions): Promise<WebGLTexture> {
    this.assertAlive();
    if (typeof first === "number") {
      if (typeof second !== "string") {
        throw new Error("loadTexture(textureId, url) requires a texture URL.");
      }
      this.assertAssetTextureId(first);
      this.loadingTextureIds.set(first, (this.loadingTextureIds.get(first) ?? 0) + 1);
      try {
        return await this.textureManager.loadTexture(first, second, options);
      } finally {
        const remaining = (this.loadingTextureIds.get(first) ?? 1) - 1;
        if (remaining === 0) this.loadingTextureIds.delete(first);
        else this.loadingTextureIds.set(first, remaining);
      }
    }

    const loadOptions = typeof second === "object" ? second : undefined;
    resolveTextureColorSpace(loadOptions);
    try {
      return await this.textureManager.load(first, loadOptions);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      return this.textureManager.createPlaceholderTexture();
    }
  }

  createPixelMaskTerrainTexture(
    textureId: number,
    terrain: PixelMaskTerrain,
    options?: PixelMaskTerrainTextureUploadOptions,
  ): WebGLTexture {
    this.assertAlive();
    this.assertAssetTextureId(textureId);
    return this.textureManager.createPixelMaskTerrainTexture(textureId, terrain, options);
  }

  updatePixelMaskTerrainTexture(
    textureId: number,
    patch: PixelMaskTerrainAlphaPatch,
    options?: PixelMaskTerrainTextureUploadOptions,
  ): void {
    this.assertAlive();
    this.assertAssetTextureId(textureId);
    this.textureManager.updatePixelMaskTerrainTexture(textureId, patch, options);
  }

  evictTexture(textureId: number): boolean {
    this.assertAlive();
    this.assertAssetTextureId(textureId);
    return this.textureManager.evictTexture(textureId);
  }

  /** Allocates an opaque image. The id must not belong to an asset or a pending load. */
  createRenderTexture(textureId: number, options: RenderTextureOptions): RenderTexture {
    this.assertAlive();
    if (this.textureManager.hasTexture(textureId) || this.loadingTextureIds.has(textureId)) {
      throw new Error("RenderTexture textureId is already used by an asset or pending load.");
    }
    return this.renderTextures.create(textureId, options);
  }

  /** Resizing discards pixels; render again before sampling. Failed allocation preserves the old image. */
  resizeRenderTexture(target: RenderTexture, width: number, height: number): void {
    this.assertAlive();
    this.renderTextures.resize(target, width, height);
  }

  /** Releases this renderer's image. Repeating the call for the same handle returns false. */
  destroyRenderTexture(target: RenderTexture): boolean {
    this.assertAlive();
    return this.renderTextures.release(target);
  }

  /**
   * Draws sprite commands only, using the current sprite material and screen offset.
   * Call after render() to include this pass in the current frame's stats().
   * Commands remain in their original screen coordinates; this does not recull the world.
   * The returned stats describe only this pass, while stats() includes main and offscreen work.
   */
  renderToTexture(
    target: RenderTexture,
    commands: RenderCommandBufferView,
    options: RenderToTextureOptions = {},
  ): RendererStats {
    this.assertAlive();
    const resource = this.renderTextures.target(target);
    const viewport = options.viewport ?? this.viewportSize();
    const clear = options.clearColor ?? [0, 0, 0];
    if (!Number.isFinite(viewport.width) || viewport.width <= 0
      || !Number.isFinite(viewport.height) || viewport.height <= 0) {
      throw new Error("RenderTexture viewport dimensions must be finite and positive.");
    }
    if (clear.length !== 3 || ![0, 1, 2].every((index) => Number.isFinite(clear[index]) && clear[index] >= 0 && clear[index] <= 1)) {
      throw new Error("RenderTexture clearColor must contain three RGB values in [0, 1].");
    }
    if (!Number.isInteger(commands.commandCount) || commands.commandCount < 0
      || !Number.isInteger(commands.floatsPerCommand) || commands.floatsPerCommand < 13
      || commands.commandCount * commands.floatsPerCommand > commands.buffer.length) {
      throw new Error("Invalid RenderTexture command buffer layout.");
    }
    // Validate before clearing: a feedback or missing-texture error must preserve the image.
    for (let i = 0; i < commands.commandCount; i += 1) {
      const id = Math.trunc(commands.buffer[i * commands.floatsPerCommand + 12]);
      if (id === target.textureId) throw new Error("RenderTexture feedback: cannot sample the active output texture.");
      this.textureSource.texture(id);
    }

    const gl = this.gl;
    // Each getParameter return type is guaranteed by the corresponding WebGL enum.
    const previousFramebuffer = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const previousViewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
    const previousClear = gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array;
    const previousMask = gl.getParameter(gl.COLOR_WRITEMASK) as boolean[];
    const scissorEnabled = gl.isEnabled(gl.SCISSOR_TEST);
    const stats = emptyRendererStats();
    const previousGroundYScale = this.groundYScale;
    try {
      if (commands.groundYScale !== undefined) this.setGroundYScale(commands.groundYScale);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, resource.framebuffer);
      gl.viewport(0, 0, target.width, target.height);
      gl.disable(gl.SCISSOR_TEST);
      gl.colorMask(true, true, true, true);
      gl.clearColor(clear[0], clear[1], clear[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      // Preserve opaque alpha even with translucent sprites and additive material passes.
      gl.colorMask(true, true, true, false);
      const batch = this.spriteBatch.drawBatches(
        this.textureSource, commands, [viewport.width, viewport.height], this.spriteMaterial, this.spriteScreenOffset,
      );
      writeRendererStatsForCommandsInto(stats, commands, batch.drawCalls, batch.textureSwitchCount);
      this.offscreenStats.drawCalls += stats.drawCalls;
      this.offscreenStats.batchCount += stats.batchCount;
      this.offscreenStats.spriteCount += stats.spriteCount;
      this.offscreenStats.renderCommandCount += stats.renderCommandCount;
      this.offscreenStats.textureBindCount += stats.textureBindCount;
      this.offscreenStats.textureSwitchCount += stats.textureSwitchCount;
    } finally {
      this.setGroundYScale(previousGroundYScale);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, previousFramebuffer);
      gl.viewport(previousViewport[0], previousViewport[1], previousViewport[2], previousViewport[3]);
      gl.clearColor(previousClear[0], previousClear[1], previousClear[2], previousClear[3]);
      gl.colorMask(previousMask[0], previousMask[1], previousMask[2], previousMask[3]);
      if (scissorEnabled) gl.enable(gl.SCISSOR_TEST);
    }
    return stats;
  }

  resourceStats(): RendererResourceStats {
    const assets = this.textureManager.resourceStats();
    const captures = this.renderTextures.resourceStats();
    let renderTargetCount = captures.renderTargetCount;
    let targetBytes = captures.textureBytes;
    for (const target of [this.sceneRenderTarget, this.postProcessScratchA, this.postProcessScratchB]) {
      const bytes = target?.allocatedTextureBytes ?? 0;
      if (bytes > 0) renderTargetCount += 1;
      targetBytes += bytes;
    }
    let bufferCount = 0;
    let programCount = 0;
    let bufferBytes = 0;
    for (const owner of [this.spriteBatch, this.physicsDebugLineBatch, this.lightingPass, this.fullscreenPass]) {
      const stats = owner.resourceStats();
      bufferCount += stats.bufferCount;
      programCount += stats.programCount;
      bufferBytes += stats.bufferBytes;
    }
    const textureBytes = assets.textureBytes === undefined ? undefined : assets.textureBytes + targetBytes;
    return {
      textureCount: assets.textureCount + renderTargetCount,
      bufferCount, programCount, renderTargetCount,
      unmeasuredTextureCount: assets.unmeasuredTextureCount,
      textureBytes, bufferBytes,
      estimatedBytes: textureBytes === undefined ? undefined : textureBytes + bufferBytes,
    };
  }

  stats(): RendererStats {
    const stats = { ...this.currentStats };
    stats.drawCalls += this.offscreenStats.drawCalls;
    stats.batchCount += this.offscreenStats.batchCount;
    stats.spriteCount += this.offscreenStats.spriteCount;
    stats.renderCommandCount += this.offscreenStats.renderCommandCount;
    stats.textureBindCount += this.offscreenStats.textureBindCount;
    stats.textureSwitchCount += this.offscreenStats.textureSwitchCount;
    return stats;
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

  setSpriteScreenOffset(x: number, y: number): void {
    this.assertAlive();
    this.spriteScreenOffset[0] = Number.isFinite(x) ? x : 0;
    this.spriteScreenOffset[1] = Number.isFinite(y) ? y : 0;
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

  setGroundYScale(scale: number): void {
    this.assertAlive();
    // Rust sends f32 metadata; the encoded lower bound is slightly less than JS 0.01.
    if (!Number.isFinite(scale) || scale < Math.fround(0.01) || scale > 1) throw new Error("groundYScale must be in [0.01, 1]");
    this.groundYScale = scale;
    this.spriteBatch.groundYScale = scale;
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

    const drawingBufferWidth = Math.floor(this.canvas.clientWidth * dpr);
    const drawingBufferHeight = Math.floor(this.canvas.clientHeight * dpr);

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
    resetRendererStatsInto(this.offscreenStats);
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
    if (commands.groundYScale !== undefined) this.setGroundYScale(commands.groundYScale);
    const resolution = this.logicalResolution;
    const batchStats = second
      ? this.spriteBatch.drawBatch(
        first as WebGLTexture,
        second,
        resolution,
        this.spriteMaterial,
        this.spriteScreenOffset,
      )
      : this.spriteBatch.drawBatches(
        this.textureSource,
        commands,
        resolution,
        this.spriteMaterial,
        this.spriteScreenOffset,
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
      { ...camera, groundYScale: this.groundYScale },
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
    const scene = this.ensureSceneRenderTarget();
    const targets = this.postProcessPasses.length > 1 ? this.ensurePostProcessTargets() : undefined;
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    const postProcessStats = this.fullscreenPass.draw({
      sourceTexture: scene.texture,
      passes: this.postProcessPasses,
      resolution: this.currentDrawingBufferResolution(),
      scratchTargets: targets && [targets.scratchA, targets.scratchB],
      encodeSrgb: this.colorManagement === "linear-srgb",
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
    this.renderTextures.destroy();
    this.textureManager.destroy();
  }

  private bindFrameStartTarget(): void {
    if (this.postProcessPasses.length === 0 && this.colorManagement === "legacy") {
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      this.frameTargetMode = "default";
      return;
    }
    const target = this.ensureSceneRenderTarget();
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, target.framebuffer);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.frameTargetMode = "postProcess";
  }

  private ensureCurrentFrameTarget(): void {
    if (!this.frameStarted || this.frameHasDrawnScene) {
      return;
    }
    const expectedTargetMode = this.postProcessPasses.length === 0 && this.colorManagement === "legacy" ? "default" : "postProcess";
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
    const scale = this.colorManagement === "linear-srgb" ? clear[3] : 1;
    this.gl.clearColor(clear[0] * scale, clear[1] * scale, clear[2] * scale, clear[3]);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  private copySceneTargetToDefaultFramebuffer(): WebGL2FullscreenPassStats {
    const scene = this.ensureSceneRenderTarget();
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    return this.fullscreenPass.draw({
      sourceTexture: scene.texture,
      passes: [COPY_POST_PROCESS_PASS],
      encodeSrgb: this.colorManagement === "linear-srgb",
      resolution: this.currentDrawingBufferResolution(),
    });
  }

  private ensureSceneRenderTarget(): WebGL2RenderTarget {
    const width = Math.max(1, this.canvas.width);
    const height = Math.max(1, this.canvas.height);
    this.sceneRenderTarget ??= new WebGL2RenderTarget(this.gl, width, height, "linear", this.colorManagement === "linear-srgb");
    this.sceneRenderTarget.resize(width, height);
    return this.sceneRenderTarget;
  }

  private ensurePostProcessTargets(): {
    scene: WebGL2RenderTarget;
    scratchA: WebGL2FullscreenRenderTarget;
    scratchB: WebGL2FullscreenRenderTarget;
  } {
    const width = Math.max(1, this.canvas.width);
    const height = Math.max(1, this.canvas.height);
    const srgbStorage = this.colorManagement === "linear-srgb";
    const scene = this.ensureSceneRenderTarget();
    this.postProcessScratchA ??= new WebGL2RenderTarget(this.gl, width, height, "linear", srgbStorage);
    this.postProcessScratchB ??= new WebGL2RenderTarget(this.gl, width, height, "linear", srgbStorage);
    this.postProcessScratchA.resize(width, height);
    this.postProcessScratchB.resize(width, height);
    return {
      scene,
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

  private assertAssetTextureId(textureId: number): void {
    if (this.renderTextures.has(textureId)) {
      throw new Error("Texture id is owned by a RenderTexture; use its dedicated lifecycle methods.");
    }
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error("WebGL2Renderer has been destroyed.");
    }
  }
}
