import {
  emptyRendererStats,
  rendererStatsForCommands,
  rendererStatsWithPhysicsDebugLines,
} from "./renderer.js";
import type { Renderer, RendererStats } from "./renderer.js";
import type {
  PixelMaskTerrain,
  PixelMaskTerrainAlphaPatch,
  PixelMaskTerrainTextureUploadOptions,
} from "./pixelMaskTerrain.js";
import type { PhysicsDebugLineBufferView, RenderCommandBufferView } from "./wasmBridge.js";
import type { PhysicsDebugLineCamera } from "./physicsDebugLineBatch.js";

export interface WebGPURendererOptions {
  clearColor?: [number, number, number, number];
  powerPreference?: GPUPowerPreference;
  fallbackAdapter?: boolean;
}

interface WebGpuTextureResource {
  texture: GPUTexture;
  view: GPUTextureView;
  bindGroup: GPUBindGroup;
  width: number;
  height: number;
}

const FLOATS_PER_COMMAND = 13;
const BYTES_PER_F32 = Float32Array.BYTES_PER_ELEMENT;
const COMMAND_STRIDE_BYTES = FLOATS_PER_COMMAND * BYTES_PER_F32;
const FLOATS_PER_DEBUG_VERTEX = 6;
const DEBUG_VERTEX_STRIDE_BYTES = FLOATS_PER_DEBUG_VERTEX * BYTES_PER_F32;
const UNIFORM_BUFFER_BYTES = 8;
const PLACEHOLDER_TEXTURE_ID = 0;

export class WebGPURenderer implements Renderer {
  private readonly sampler: GPUSampler;
  private readonly uniformBindGroupLayout: GPUBindGroupLayout;
  private readonly textureBindGroupLayout: GPUBindGroupLayout;
  private readonly spritePipelineLayout: GPUPipelineLayout;
  private readonly linePipelineLayout: GPUPipelineLayout;
  private readonly spritePipeline: GPURenderPipeline;
  private readonly linePipeline: GPURenderPipeline;
  private readonly resolutionBuffer: GPUBuffer;
  private readonly resolutionBindGroup: GPUBindGroup;
  private spriteInstanceBuffer: GPUBuffer;
  private lineVertexBuffer: GPUBuffer;
  private readonly texturesById = new Map<number, WebGpuTextureResource>();
  private currentStats: RendererStats = emptyRendererStats();
  private logicalWidth = 0;
  private logicalHeight = 0;
  private spriteInstanceCapacityBytes = 0;
  private lineVertexCapacityBytes = 0;
  private lineStaging = new Float32Array(0);
  private destroyed = false;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly adapter: GPUAdapter,
    private readonly device: GPUDevice,
    private readonly context: GPUCanvasContext,
    private readonly format: GPUTextureFormat,
    private readonly options: WebGPURendererOptions = {},
  ) {
    this.sampler = this.device.createSampler({
      magFilter: "nearest",
      minFilter: "nearest",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    this.uniformBindGroupLayout = this.createUniformBindGroupLayout();
    this.textureBindGroupLayout = this.createTextureBindGroupLayout();
    this.spritePipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.uniformBindGroupLayout, this.textureBindGroupLayout],
    });
    this.linePipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.uniformBindGroupLayout],
    });
    this.resolutionBuffer = this.device.createBuffer({
      size: UNIFORM_BUFFER_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.spriteInstanceBuffer = this.device.createBuffer({
      size: COMMAND_STRIDE_BYTES,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.spriteInstanceCapacityBytes = COMMAND_STRIDE_BYTES;
    this.lineVertexBuffer = this.device.createBuffer({
      size: DEBUG_VERTEX_STRIDE_BYTES,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.lineVertexCapacityBytes = DEBUG_VERTEX_STRIDE_BYTES;
    this.spritePipeline = this.createSpritePipeline();
    this.linePipeline = this.createLinePipeline();
    this.resolutionBindGroup = this.device.createBindGroup({
      layout: this.uniformBindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.resolutionBuffer } }],
    });
    this.resize();
    this.createPlaceholderTextureForId(PLACEHOLDER_TEXTURE_ID);
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
      const bitmap = await this.loadImageBitmap(second);
      try {
        this.assertAlive();
        return this.createTextureFromSource(first, bitmap);
      } finally {
        bitmap.close();
      }
    }

    const bitmap = await this.loadImageBitmap(first);
    try {
      this.assertAlive();
      return this.createTextureFromSource(undefined, bitmap);
    } finally {
      bitmap.close();
    }
  }

  createPixelMaskTerrainTexture(
    textureId: number,
    terrain: PixelMaskTerrain,
    options: PixelMaskTerrainTextureUploadOptions = {},
  ): GPUTexture {
    this.assertAlive();
    return this.createTextureFromRgbaData(
      textureId,
      terrain.width,
      terrain.height,
      rgbaFromAlpha(terrain.width, terrain.height, terrain.data, options),
    );
  }

  updatePixelMaskTerrainTexture(
    textureId: number,
    patch: PixelMaskTerrainAlphaPatch,
    options: PixelMaskTerrainTextureUploadOptions = {},
  ): void {
    this.assertAlive();
    const resource = this.textureResource(textureId);
    if (
      patch.rect.x < 0
      || patch.rect.y < 0
      || patch.rect.x + patch.rect.width > resource.width
      || patch.rect.y + patch.rect.height > resource.height
    ) {
      throw new Error("Pixel mask terrain patch is outside the WebGPU texture bounds.");
    }
    const upload = textureWriteBytes(patch.rect.width, patch.rect.height, rgbaFromAlpha(patch.rect.width, patch.rect.height, patch.alpha, options));
    this.device.queue.writeTexture(
      {
        texture: resource.texture,
        origin: { x: patch.rect.x, y: patch.rect.y },
      },
      upload.data,
      { bytesPerRow: upload.bytesPerRow, rowsPerImage: upload.rowsPerImage },
      { width: patch.rect.width, height: patch.rect.height, depthOrArrayLayers: 1 },
    );
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
    this.currentStats = emptyRendererStats();
    const encoder = this.device.createCommandEncoder();
    const pass = this.beginRenderPass(encoder, "clear");
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  renderCommands(commands: RenderCommandBufferView): RendererStats {
    this.assertAlive();
    if (commands.commandCount === 0) {
      return this.stats();
    }

    const encoder = this.device.createCommandEncoder();
    const pass = this.beginRenderPass(encoder, "load");
    pass.setPipeline(this.spritePipeline);
    pass.setBindGroup(0, this.resolutionBindGroup);

    let drawCalls = 0;
    let textureSwitchCount = 0;
    let batchStart = 0;
    let currentTextureId = textureIdAt(commands, 0);
    for (let index = 1; index < commands.commandCount; index += 1) {
      const nextTextureId = textureIdAt(commands, index);
      if (nextTextureId === currentTextureId) {
        continue;
      }
      drawCalls += this.drawSpriteRange(pass, commands, currentTextureId, batchStart, index);
      textureSwitchCount += 1;
      batchStart = index;
      currentTextureId = nextTextureId;
    }
    drawCalls += this.drawSpriteRange(pass, commands, currentTextureId, batchStart, commands.commandCount);

    pass.end();
    this.device.queue.submit([encoder.finish()]);
    this.currentStats = rendererStatsForCommands(commands, drawCalls, textureSwitchCount);
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

    const vertexCount = lines.lineCount * 2;
    const floatCount = vertexCount * FLOATS_PER_DEBUG_VERTEX;
    this.ensureLineStaging(floatCount);
    this.writeLineStaging(lines, camera);
    this.ensureLineVertexCapacity(floatCount * BYTES_PER_F32);
    this.device.queue.writeBuffer(this.lineVertexBuffer, 0, this.lineStaging.subarray(0, floatCount));

    const encoder = this.device.createCommandEncoder();
    const pass = this.beginRenderPass(encoder, "load");
    pass.setPipeline(this.linePipeline);
    pass.setBindGroup(0, this.resolutionBindGroup);
    pass.setVertexBuffer(0, this.lineVertexBuffer);
    pass.draw(vertexCount, 1, 0, 0);
    pass.end();
    this.device.queue.submit([encoder.finish()]);

    this.currentStats = rendererStatsWithPhysicsDebugLines(this.currentStats, lines.lineCount, 1);
    return this.stats();
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    for (const resource of this.texturesById.values()) {
      resource.texture.destroy();
    }
    this.texturesById.clear();
    this.spriteInstanceBuffer.destroy();
    this.lineVertexBuffer.destroy();
    this.resolutionBuffer.destroy();
    this.lineStaging = new Float32Array(0);
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

  private createSpritePipeline(): GPURenderPipeline {
    const module = this.device.createShaderModule({
      code: `
        struct Resolution {
          size: vec2f,
        };
        @group(0) @binding(0) var<uniform> resolution: Resolution;
        @group(1) @binding(0) var spriteSampler: sampler;
        @group(1) @binding(1) var spriteTexture: texture_2d<f32>;

        struct VertexInput {
          @location(0) rect: vec4f,
          @location(1) uvRect: vec4f,
          @location(2) color: vec4f,
          @builtin(vertex_index) vertexIndex: u32,
        };

        struct VertexOutput {
          @builtin(position) position: vec4f,
          @location(0) uv: vec2f,
          @location(1) color: vec4f,
        };

        fn cornerForVertex(vertexIndex: u32) -> vec2f {
          if (vertexIndex == 0u) { return vec2f(0.0, 0.0); }
          if (vertexIndex == 1u) { return vec2f(1.0, 0.0); }
          if (vertexIndex == 2u) { return vec2f(0.0, 1.0); }
          if (vertexIndex == 3u) { return vec2f(0.0, 1.0); }
          if (vertexIndex == 4u) { return vec2f(1.0, 0.0); }
          return vec2f(1.0, 1.0);
        }

        @vertex
        fn vs_main(input: VertexInput) -> VertexOutput {
          let corner = cornerForVertex(input.vertexIndex % 6u);
          let pixelPosition = input.rect.xy + corner * input.rect.zw;
          let zeroToOne = pixelPosition / resolution.size;
          let clip = zeroToOne * 2.0 - vec2f(1.0, 1.0);
          var output: VertexOutput;
          output.position = vec4f(clip * vec2f(1.0, -1.0), 0.0, 1.0);
          output.uv = mix(input.uvRect.xy, input.uvRect.zw, corner);
          output.color = input.color;
          return output;
        }

        @fragment
        fn fs_main(input: VertexOutput) -> @location(0) vec4f {
          return textureSample(spriteTexture, spriteSampler, input.uv) * input.color;
        }
      `,
    });

    return this.device.createRenderPipeline({
      layout: this.spritePipelineLayout,
      vertex: {
        module,
        entryPoint: "vs_main",
        buffers: [{
          arrayStride: COMMAND_STRIDE_BYTES,
          stepMode: "instance",
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x4" },
            { shaderLocation: 1, offset: 4 * BYTES_PER_F32, format: "float32x4" },
            { shaderLocation: 2, offset: 8 * BYTES_PER_F32, format: "float32x4" },
          ],
        }],
      },
      fragment: {
        module,
        entryPoint: "fs_main",
        targets: [{
          format: this.format,
          blend: {
            color: {
              srcFactor: "src-alpha",
              dstFactor: "one-minus-src-alpha",
              operation: "add",
            },
            alpha: {
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
              operation: "add",
            },
          },
        }],
      },
      primitive: { topology: "triangle-list" },
    });
  }

  private createLinePipeline(): GPURenderPipeline {
    const module = this.device.createShaderModule({
      code: `
        struct Resolution {
          size: vec2f,
        };
        @group(0) @binding(0) var<uniform> resolution: Resolution;

        struct VertexInput {
          @location(0) position: vec2f,
          @location(1) color: vec4f,
        };

        struct VertexOutput {
          @builtin(position) position: vec4f,
          @location(0) color: vec4f,
        };

        @vertex
        fn vs_main(input: VertexInput) -> VertexOutput {
          let zeroToOne = input.position / resolution.size;
          let clip = zeroToOne * 2.0 - vec2f(1.0, 1.0);
          var output: VertexOutput;
          output.position = vec4f(clip * vec2f(1.0, -1.0), 0.0, 1.0);
          output.color = input.color;
          return output;
        }

        @fragment
        fn fs_main(input: VertexOutput) -> @location(0) vec4f {
          return input.color;
        }
      `,
    });

    return this.device.createRenderPipeline({
      layout: this.linePipelineLayout,
      vertex: {
        module,
        entryPoint: "vs_main",
        buffers: [{
          arrayStride: DEBUG_VERTEX_STRIDE_BYTES,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x2" },
            { shaderLocation: 1, offset: 2 * BYTES_PER_F32, format: "float32x4" },
          ],
        }],
      },
      fragment: {
        module,
        entryPoint: "fs_main",
        targets: [{
          format: this.format,
          blend: {
            color: {
              srcFactor: "src-alpha",
              dstFactor: "one-minus-src-alpha",
              operation: "add",
            },
            alpha: {
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
              operation: "add",
            },
          },
        }],
      },
      primitive: { topology: "line-list" },
    });
  }

  private drawSpriteRange(
    pass: GPURenderPassEncoder,
    commands: RenderCommandBufferView,
    textureId: number,
    startCommand: number,
    endCommand: number,
  ): number {
    const commandCount = endCommand - startCommand;
    if (commandCount <= 0) {
      return 0;
    }
    const commandFloatOffset = startCommand * commands.floatsPerCommand;
    const floatCount = commandCount * commands.floatsPerCommand;
    const byteCount = commandCount * commands.floatsPerCommand * BYTES_PER_F32;
    this.ensureSpriteInstanceCapacity(byteCount);
    this.device.queue.writeBuffer(this.spriteInstanceBuffer, 0, commands.buffer.subarray(commandFloatOffset, commandFloatOffset + floatCount));
    pass.setBindGroup(1, this.textureResource(textureId).bindGroup);
    pass.setVertexBuffer(0, this.spriteInstanceBuffer);
    pass.draw(6, commandCount, 0, 0);
    return 1;
  }

  private createTextureFromSource(textureId: number | undefined, source: ImageBitmap): GPUTexture {
    const texture = this.device.createTexture({
      size: { width: source.width, height: source.height, depthOrArrayLayers: 1 },
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture(
      { source },
      { texture },
      { width: source.width, height: source.height, depthOrArrayLayers: 1 },
    );
    const resource = this.createTextureResource(texture, source.width, source.height);
    if (textureId !== undefined) {
      this.setTexture(textureId, resource);
    }
    return texture;
  }

  private createTextureFromRgbaData(
    textureId: number,
    width: number,
    height: number,
    data: Uint8Array,
  ): GPUTexture {
    const texture = this.device.createTexture({
      size: { width, height, depthOrArrayLayers: 1 },
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const upload = textureWriteBytes(width, height, data);
    this.device.queue.writeTexture(
      { texture },
      upload.data,
      { bytesPerRow: upload.bytesPerRow, rowsPerImage: upload.rowsPerImage },
      { width, height, depthOrArrayLayers: 1 },
    );
    this.setTexture(textureId, this.createTextureResource(texture, width, height));
    return texture;
  }

  private createPlaceholderTextureForId(textureId: number): void {
    this.createTextureFromRgbaData(textureId, 1, 1, new Uint8Array([255, 255, 255, 255]));
  }

  private createTextureResource(texture: GPUTexture, width: number, height: number): WebGpuTextureResource {
    const view = texture.createView();
    const bindGroup = this.device.createBindGroup({
      layout: this.textureBindGroupLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: view },
      ],
    });
    return { texture, view, bindGroup, width, height };
  }

  private setTexture(textureId: number, resource: WebGpuTextureResource): void {
    if (!Number.isInteger(textureId) || textureId < 0) {
      throw new Error("texture_id must be a non-negative integer.");
    }
    const previous = this.texturesById.get(textureId);
    if (previous && previous.texture !== resource.texture) {
      previous.texture.destroy();
    }
    this.texturesById.set(textureId, resource);
  }

  private textureResource(textureId: number): WebGpuTextureResource {
    const resource = this.texturesById.get(textureId);
    if (resource === undefined) {
      throw new Error(`WebGPU texture ${textureId} is not loaded.`);
    }
    return resource;
  }

  private writeResolution(): void {
    this.device.queue.writeBuffer(
      this.resolutionBuffer,
      0,
      new Float32Array([Math.max(this.logicalWidth, 1), Math.max(this.logicalHeight, 1)]),
    );
  }

  private writeLineStaging(lines: PhysicsDebugLineBufferView, camera: PhysicsDebugLineCamera): void {
    const originX = this.logicalWidth * 0.5 - camera.x;
    const originY = this.logicalHeight * 0.5 - camera.y;
    let vertexOffset = 0;
    for (let lineIndex = 0; lineIndex < lines.lineCount; lineIndex += 1) {
      const lineOffset = lineIndex * lines.floatsPerLine;
      const x0 = lines.buffer[lineOffset] + originX;
      const y0 = lines.buffer[lineOffset + 1] + originY;
      const x1 = lines.buffer[lineOffset + 2] + originX;
      const y1 = lines.buffer[lineOffset + 3] + originY;
      const r = lines.buffer[lineOffset + 4];
      const g = lines.buffer[lineOffset + 5];
      const b = lines.buffer[lineOffset + 6];
      const a = lines.buffer[lineOffset + 7];
      vertexOffset = writeDebugVertex(this.lineStaging, vertexOffset, x0, y0, r, g, b, a);
      vertexOffset = writeDebugVertex(this.lineStaging, vertexOffset, x1, y1, r, g, b, a);
    }
  }

  private ensureSpriteInstanceCapacity(byteCount: number): void {
    if (this.spriteInstanceCapacityBytes >= byteCount) {
      return;
    }
    const nextSize = nextPowerOfTwo(byteCount);
    this.spriteInstanceBuffer.destroy();
    this.spriteInstanceBuffer = this.device.createBuffer({
      size: nextSize,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.spriteInstanceCapacityBytes = nextSize;
  }

  private ensureLineVertexCapacity(byteCount: number): void {
    if (this.lineVertexCapacityBytes >= byteCount) {
      return;
    }
    const nextSize = nextPowerOfTwo(byteCount);
    this.lineVertexBuffer.destroy();
    this.lineVertexBuffer = this.device.createBuffer({
      size: nextSize,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.lineVertexCapacityBytes = nextSize;
  }

  private ensureLineStaging(floatCount: number): void {
    if (this.lineStaging.length >= floatCount) {
      return;
    }
    this.lineStaging = new Float32Array(floatCount);
  }

  private async loadImageBitmap(url: string): Promise<ImageBitmap> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Texture load failed: HTTP ${response.status} ${response.statusText}`.trim());
    }
    return await createImageBitmap(await response.blob());
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error("WebGPURenderer has been destroyed.");
    }
  }
}

function textureIdAt(commands: RenderCommandBufferView, commandIndex: number): number {
  const offset = commandIndex * commands.floatsPerCommand;
  return Math.trunc(commands.buffer[offset + 12]);
}

function writeDebugVertex(
  buffer: Float32Array,
  offset: number,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a: number,
): number {
  buffer[offset] = x;
  buffer[offset + 1] = y;
  buffer[offset + 2] = r;
  buffer[offset + 3] = g;
  buffer[offset + 4] = b;
  buffer[offset + 5] = a;
  return offset + FLOATS_PER_DEBUG_VERTEX;
}

function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(value, 1)));
}

function textureWriteBytes(
  width: number,
  height: number,
  rgba: Uint8Array,
): { data: Uint8Array; bytesPerRow: number; rowsPerImage: number } {
  const rowBytes = width * 4;
  const bytesPerRow = alignTo(rowBytes, 256);
  if (bytesPerRow === rowBytes) {
    return { data: rgba, bytesPerRow, rowsPerImage: height };
  }

  const padded = new Uint8Array(bytesPerRow * height);
  for (let row = 0; row < height; row += 1) {
    const sourceStart = row * rowBytes;
    const sourceEnd = sourceStart + rowBytes;
    padded.set(rgba.subarray(sourceStart, sourceEnd), row * bytesPerRow);
  }
  return { data: padded, bytesPerRow, rowsPerImage: height };
}

function alignTo(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function rgbaFromAlpha(
  width: number,
  height: number,
  alpha: Uint8Array,
  options: PixelMaskTerrainTextureUploadOptions,
): Uint8Array {
  if (alpha.length !== width * height) {
    throw new Error("pixel mask terrain alpha length must equal width * height.");
  }
  const [rawR, rawG, rawB] = options.color ?? [255, 255, 255];
  const r = colorByte(rawR, "pixelMaskTerrain.texture.color[0]");
  const g = colorByte(rawG, "pixelMaskTerrain.texture.color[1]");
  const b = colorByte(rawB, "pixelMaskTerrain.texture.color[2]");
  const alphaScale = finitePositiveNumber(options.alphaScale ?? 1, "pixelMaskTerrain.texture.alphaScale");
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < alpha.length; index += 1) {
    const offset = index * 4;
    rgba[offset] = r;
    rgba[offset + 1] = g;
    rgba[offset + 2] = b;
    rgba[offset + 3] = Math.min(255, Math.round(alpha[index] * alphaScale));
  }
  return rgba;
}

function colorByte(value: number, path: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 255) {
    throw new Error(`${path} must be between 0 and 255.`);
  }
  return Math.round(value);
}

function finitePositiveNumber(value: number, path: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${path} must be a non-negative finite number.`);
  }
  return value;
}
