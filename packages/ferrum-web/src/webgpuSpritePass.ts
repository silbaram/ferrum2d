import { SPRITE_NORMAL_NONE } from "./spriteNormals.js";
import { webGpuResources } from "./webgpuResources.js";
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
  private readonly normalRangeScratch: (WebGpuSpriteRange & {normalTextureId:number})[] = [];

  constructor(
    private readonly device: GPUDevice,
    private readonly format: GPUTextureFormat,
    uniformBindGroupLayout: GPUBindGroupLayout,
    textureBindGroupLayout: GPUBindGroupLayout,
    private readonly textureStore: WebGpuTextureStore,
    private readonly resolutionBindGroup: GPUBindGroup,
    private readonly normalMode=false,
  ) {
    this.spritePipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: normalMode?[uniformBindGroupLayout,textureBindGroupLayout,textureBindGroupLayout]:[uniformBindGroupLayout, textureBindGroupLayout],
    });
    this.spriteInstanceBuffer = webGpuResources(this.device).createBuffer({
      size: COMMAND_STRIDE_BYTES,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.spritePipeline = this.createSpritePipeline("alpha");
    this.additiveSpritePipeline = normalMode?this.spritePipeline:this.createSpritePipeline("additive");
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
    const normalRanges=this.normalMode?this.normalRanges(commands):undefined;
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
      for (const range of (normalRanges&&materialPass.kind==="base"?normalRanges:ranges)) {
        drawCalls += this.drawRange(pass, range, passByteOffset,"normalTextureId" in range?range.normalTextureId as number:SPRITE_NORMAL_NONE);
      }
    }
    return { drawCalls, textureSwitchCount: (normalRanges??ranges).length - 1 };
  }

  destroy(): void {
    webGpuResources(this.device).destroy(this.spriteInstanceBuffer);
    this.materialStaging = new Float32Array(0);
    this.spriteRangeScratch.length = 0;
    this.spriteInstanceCapacityBytes = 0;
  }

  private createSpritePipeline(blendMode: SpriteMaterialBlendMode): GPURenderPipeline {
    const module = this.device.createShaderModule({
      code: `
        struct Resolution {
          size: vec2f,
          groundYScale: f32,
          shadowProjection: vec3f,
        };
        @group(0) @binding(0) var<uniform> resolution: Resolution;
        @group(1) @binding(0) var spriteSampler: sampler;
        @group(1) @binding(1) var spriteTexture: texture_2d<f32>;
        ${this.normalMode?"@group(2) @binding(0) var normalSampler:sampler; @group(2) @binding(1) var normalTexture:texture_2d<f32>;":""}

        struct VertexInput {
          @location(0) rect: vec4f,
          @location(1) uvRect: vec4f,
          @location(2) color: vec4f,
          @location(3) rotation: f32,
          @location(4) flags: f32,
          @builtin(vertex_index) vertexIndex: u32,
        };

        struct VertexOutput {
          @builtin(position) position: vec4f,
          @location(0) uv: vec2f,
          @location(1) color: vec4f,
          @location(2) corner: vec2f,
          @location(3) @interpolate(flat) flags: f32,
          ${this.normalMode?"@location(4) @interpolate(flat) rotationCS:vec2f, @location(5) @interpolate(flat) uvSign:vec2f,":""}
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
          let local = (corner - vec2f(0.5, 0.5)) * input.rect.zw;
          let rotationCos = cos(input.rotation);
          let rotationSin = sin(input.rotation);
          var rotated = vec2f(
            local.x * rotationCos - local.y * rotationSin,
            local.x * rotationSin + local.y * rotationCos,
          );
          if ((u32(input.flags) & 32u) != 0u) {
            let s = resolution.shadowProjection;
            rotated = vec2f(s.y * rotated.x - s.x * rotated.y * s.z,
              -s.x * rotated.x - s.y * rotated.y * s.z);
          }
          if ((u32(input.flags) & 4u) != 0u) { rotated.y *= resolution.groundYScale; }
          let pixelPosition = input.rect.xy + input.rect.zw * 0.5 + rotated;
          let zeroToOne = pixelPosition / resolution.size;
          let clip = zeroToOne * 2.0 - vec2f(1.0, 1.0);
          var output: VertexOutput;
          output.position = vec4f(clip * vec2f(1.0, -1.0), 0.0, 1.0);
          output.uv = mix(input.uvRect.xy, input.uvRect.zw, corner);
          output.color = input.color;
          output.corner = corner;
          output.flags = input.flags;
          ${this.normalMode?"output.rotationCS=vec2f(rotationCos,rotationSin);output.uvSign=select(vec2f(1.),vec2f(-1.),input.uvRect.zw<input.uvRect.xy);":""}
          return output;
        }

        ${this.normalMode?NORMAL_FRAGMENT:`        @fragment
        fn fs_main(input: VertexOutput) -> @location(0) vec4f {
          let sampled = textureSample(spriteTexture, spriteSampler, input.uv);
          if ((u32(input.flags) & 32u) != 0u) {
            return vec4f(input.color.rgb, sampled.a * input.color.a);
          }
          if ((u32(input.flags) & 24u) != 0u) {
            let q = (input.corner - vec2f(0.5)) * 2.0;
            if ((u32(input.flags) & 8u) != 0u && dot(q, q) > 1.0) { discard; }
            return input.color;
          }
          return sampled * input.color;
        }`}

      `,
    });

    return webGpuResources(this.device).createRenderPipeline({
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
            { shaderLocation: 3, offset: 14 * BYTES_PER_F32, format: "float32" },
            { shaderLocation: 4, offset: 13 * BYTES_PER_F32, format: "float32" },
          ],
        }],
      },
      fragment: {
        module,
        entryPoint: "fs_main",
        targets: this.normalMode?[{format:"rgba8unorm",blend:spriteBlendState("alpha")},{format:"rgba8unorm",blend:spriteBlendState("alpha")}]:[{
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
    normalTextureId=SPRITE_NORMAL_NONE,
  ): number {
    const commandCount = range.end - range.start;
    if (commandCount <= 0) {
      return 0;
    }
    const color=this.textureStore.resource(range.textureId);pass.setBindGroup(1,color.bindGroup);
    if(this.normalMode){const mapped=normalTextureId!==SPRITE_NORMAL_NONE,normal=mapped?this.textureStore.resource(normalTextureId):color;
      if(mapped&&(normal.colorSpace==="srgb"||normal.width!==color.width||normal.height!==color.height))throw Error("Sprite normals require a same-size linear/data texture");
      pass.setBindGroup(2,normal.bindGroup);
    }
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
    if (this.normalMode || commands.floatsPerCommand !== FLOATS_PER_COMMAND || spriteMaterialPassRequiresCommandCopy(materialPass)) {
      this.ensureMaterialStaging(uploadFloatCount);
      const materialFloatCount = writeSpriteMaterialPassCommandsInto(
        commands,
        0,
        commands.commandCount,
        materialPass,
        this.materialStaging,
      );
      if(this.normalMode)for(let i=0;i<commands.commandCount;i++){
        const mapped=materialPass.kind==="base"&&(commands.spriteNormalMaterials?.buffer[i*2]??SPRITE_NORMAL_NONE)!==SPRITE_NORMAL_NONE;
        this.materialStaging[i*FLOATS_PER_COMMAND+13]=(this.materialStaging[i*FLOATS_PER_COMMAND+13]&~64)|(mapped?64:0);
      }
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

  private normalRanges(commands:RenderCommandBufferView){
    const ranges=this.normalRangeScratch;let count=0;
    for(let start=0;start<commands.commandCount;){
      const textureId=Math.trunc(commands.buffer[start*commands.floatsPerCommand+12]),normalTextureId=commands.spriteNormalMaterials!.buffer[start*2];let end=start+1;
      while(end<commands.commandCount&&Math.trunc(commands.buffer[end*commands.floatsPerCommand+12])===textureId&&commands.spriteNormalMaterials!.buffer[end*2]===normalTextureId)end++;
      const range=ranges[count]??(ranges[count]={textureId,normalTextureId,start,end});range.textureId=textureId;range.normalTextureId=normalTextureId;range.start=start;range.end=end;count++;start=end;
    }ranges.length=count;return ranges;
  }

  private spritePipelineForBlendMode(blendMode: SpriteMaterialBlendMode): GPURenderPipeline {
    return blendMode === "additive" ? this.additiveSpritePipeline : this.spritePipeline;
  }

  private ensureSpriteInstanceCapacity(byteCount: number): void {
    if (this.spriteInstanceCapacityBytes >= byteCount) {
      return;
    }
    const nextSize = nextPowerOfTwo(byteCount);
    webGpuResources(this.device).destroy(this.spriteInstanceBuffer);
    this.spriteInstanceBuffer = webGpuResources(this.device).createBuffer({
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

const NORMAL_FRAGMENT = `
struct NormalOutput { @location(0) normal:vec4f, @location(1) coverage:vec4f, };
@fragment fn fs_main(input:VertexOutput)->NormalOutput {
  let flags=u32(input.flags);var alpha=input.color.a;
  if((flags&24u)!=0u){let q=(input.corner-.5)*2.;if((flags&8u)!=0u&&dot(q,q)>1.){discard;}}
  else {alpha*=textureSampleLevel(spriteTexture,spriteSampler,input.uv,0.).a;}
  let mapped=(flags&64u)!=0u&&(flags&56u)==0u;var n=vec3f(0.);
  if(mapped){let raw=textureSampleLevel(normalTexture,normalSampler,input.uv,0.).rgb*2.-1.;var local=vec3f(0.,0.,1.);
    if(length(raw)>=0.01){local=normalize(raw);}local=vec3f(local.xy*input.uvSign,local.z);
    let c=input.rotationCS.x;let s=input.rotationCS.y;n=vec3f(c*local.x+s*local.y,s*local.x-c*local.y,local.z);
  }
  var output:NormalOutput;output.normal=vec4f(n*.5+.5,alpha);output.coverage=vec4f(select(0.,1.,mapped),0.,0.,alpha);return output;
}`;
