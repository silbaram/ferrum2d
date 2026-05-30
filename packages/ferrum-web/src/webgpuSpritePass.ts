import {
  SPRITE_RENDER_COMMAND_FLOATS,
  spriteMaterialPassRequiresCommandCopy,
  writeSpriteMaterialPassCommandsInto,
} from "./spriteMaterial.js";
import type {
  SpriteMaterialBlendMode,
  SpriteMaterialPass,
} from "./spriteMaterial.js";
import type { RenderCommandBufferView } from "./wasmBridge.js";
import { spriteRanges } from "./webgpuSpriteRanges.js";
import type { WebGpuSpriteRange } from "./webgpuSpriteRanges.js";
import type { WebGpuTextureStore } from "./webgpuTextureStore.js";

const FLOATS_PER_COMMAND = SPRITE_RENDER_COMMAND_FLOATS;
const BYTES_PER_F32 = Float32Array.BYTES_PER_ELEMENT;
const COMMAND_STRIDE_BYTES = FLOATS_PER_COMMAND * BYTES_PER_F32;

export interface WebGpuSpritePassStats {
  drawCalls: number;
  textureSwitchCount: number;
}

export class WebGpuSpritePass {
  private readonly spritePipelineLayout: GPUPipelineLayout;
  private readonly spritePipeline: GPURenderPipeline;
  private readonly additiveSpritePipeline: GPURenderPipeline;
  private spriteInstanceBuffer: GPUBuffer;
  private spriteInstanceCapacityBytes = COMMAND_STRIDE_BYTES;
  private materialStaging = new Float32Array(0);
  private readonly spriteRangeScratch: WebGpuSpriteRange[] = [];

  constructor(
    private readonly device: GPUDevice,
    private readonly format: GPUTextureFormat,
    uniformBindGroupLayout: GPUBindGroupLayout,
    textureBindGroupLayout: GPUBindGroupLayout,
    private readonly textureStore: WebGpuTextureStore,
    private readonly resolutionBindGroup: GPUBindGroup,
  ) {
    this.spritePipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [uniformBindGroupLayout, textureBindGroupLayout],
    });
    this.spriteInstanceBuffer = this.device.createBuffer({
      size: COMMAND_STRIDE_BYTES,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.spritePipeline = this.createSpritePipeline("alpha");
    this.additiveSpritePipeline = this.createSpritePipeline("additive");
  }

  draw(
    pass: GPURenderPassEncoder,
    commands: RenderCommandBufferView,
    spriteMaterialPasses: readonly SpriteMaterialPass[],
  ): WebGpuSpritePassStats {
    if (commands.commandCount === 0) {
      return { drawCalls: 0, textureSwitchCount: 0 };
    }

    const ranges = spriteRanges(commands, this.spriteRangeScratch);
    const commandBytes = commands.commandCount * COMMAND_STRIDE_BYTES;
    this.ensureSpriteInstanceCapacity(commandBytes * spriteMaterialPasses.length);
    for (let passIndex = 0; passIndex < spriteMaterialPasses.length; passIndex += 1) {
      this.uploadMaterialPass(
        commands,
        spriteMaterialPasses[passIndex],
        passIndex * commandBytes,
      );
    }

    let drawCalls = 0;
    for (let passIndex = 0; passIndex < spriteMaterialPasses.length; passIndex += 1) {
      const materialPass = spriteMaterialPasses[passIndex];
      pass.setPipeline(this.spritePipelineForBlendMode(materialPass.blendMode));
      pass.setBindGroup(0, this.resolutionBindGroup);
      const passByteOffset = passIndex * commandBytes;
      for (const range of ranges) {
        drawCalls += this.drawRange(pass, range, passByteOffset);
      }
    }
    return { drawCalls, textureSwitchCount: ranges.length - 1 };
  }

  destroy(): void {
    this.spriteInstanceBuffer.destroy();
    this.materialStaging = new Float32Array(0);
    this.spriteRangeScratch.length = 0;
    this.spriteInstanceCapacityBytes = 0;
  }

  private createSpritePipeline(blendMode: SpriteMaterialBlendMode): GPURenderPipeline {
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
          blend: spriteBlendState(blendMode),
        }],
      },
      primitive: { topology: "triangle-list" },
    });
  }

  private drawRange(
    pass: GPURenderPassEncoder,
    range: WebGpuSpriteRange,
    passByteOffset: number,
  ): number {
    const commandCount = range.end - range.start;
    if (commandCount <= 0) {
      return 0;
    }
    pass.setBindGroup(1, this.textureStore.resource(range.textureId).bindGroup);
    pass.setVertexBuffer(
      0,
      this.spriteInstanceBuffer,
      passByteOffset + range.start * COMMAND_STRIDE_BYTES,
      commandCount * COMMAND_STRIDE_BYTES,
    );
    pass.draw(6, commandCount, 0, 0);
    return 1;
  }

  private uploadMaterialPass(
    commands: RenderCommandBufferView,
    materialPass: SpriteMaterialPass,
    byteOffset: number,
  ): void {
    const uploadFloatCount = commands.commandCount * FLOATS_PER_COMMAND;
    const byteCount = uploadFloatCount * BYTES_PER_F32;
    if (commands.floatsPerCommand !== FLOATS_PER_COMMAND || spriteMaterialPassRequiresCommandCopy(materialPass)) {
      this.ensureMaterialStaging(uploadFloatCount);
      const materialFloatCount = writeSpriteMaterialPassCommandsInto(
        commands,
        0,
        commands.commandCount,
        materialPass,
        this.materialStaging,
      );
      this.device.queue.writeBuffer(
        this.spriteInstanceBuffer,
        byteOffset,
        this.materialStaging.buffer,
        this.materialStaging.byteOffset,
        materialFloatCount * BYTES_PER_F32,
      );
      return;
    }

    this.device.queue.writeBuffer(
      this.spriteInstanceBuffer,
      byteOffset,
      commands.buffer.buffer,
      commands.buffer.byteOffset,
      byteCount,
    );
  }

  private spritePipelineForBlendMode(blendMode: SpriteMaterialBlendMode): GPURenderPipeline {
    return blendMode === "additive" ? this.additiveSpritePipeline : this.spritePipeline;
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

  private ensureMaterialStaging(floatCount: number): void {
    if (this.materialStaging.length >= floatCount) {
      return;
    }
    this.materialStaging = new Float32Array(webGpuSpriteStagingCapacity(floatCount));
  }
}

export function webGpuSpriteStagingCapacity(requiredFloatCount: number): number {
  return nextPowerOfTwo(requiredFloatCount);
}

function spriteBlendState(blendMode: SpriteMaterialBlendMode): GPUBlendState {
  if (blendMode === "additive") {
    return {
      color: { srcFactor: "src-alpha", dstFactor: "one", operation: "add" },
      alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
    };
  }
  return {
    color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
    alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  };
}

function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(value, 1)));
}
