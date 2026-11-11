import {FLAT_RECEIVER_MASK_WGSL} from "./flatReceiverMaskShaders.js";
import { expandLitSpriteCommands } from "./spriteLighting.js";
import { flatLitWgslFragment } from "./flatLitShaders.js";
import { spriteSurfaceTextureId } from "./spriteSurface.js";
import { WebGpuSpriteSurfaceTextures } from "./webgpuSpriteSurface.js";
import { SPRITE_NORMAL_NONE } from "./spriteNormals.js";
import { WebGpuSpritePalette } from "./webgpuSpritePalette.js";
import { SPRITE_PALETTE_WGSL } from "./spritePaletteShaders.js";
import type { ResolvedSpritePalettes } from "./spritePalette.js";
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
import { groundShadowRanges } from "./groundShadowRanges.js";
import type { WebGpuSpriteRange } from "./webgpuSpriteRanges.js";
import type { WebGpuTextureStore } from "./webgpuTextureStore.js";

const FLOATS_PER_COMMAND = SPRITE_RENDER_COMMAND_FLOATS;
const BYTES_PER_F32 = Float32Array.BYTES_PER_ELEMENT;
const COMMAND_STRIDE_BYTES = FLOATS_PER_COMMAND * BYTES_PER_F32;
interface NormalRange extends WebGpuSpriteRange {normalTextureId:number;emissionTextureId?:number;specularTextureId?:number;roughnessTextureId?:number;}

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
  private readonly normalRangeScratch: NormalRange[] = [];
  private readonly surfaceTextures?:WebGpuSpriteSurfaceTextures;
  private palette?: { resources:WebGpuSpritePalette; alpha:GPURenderPipeline; additive:GPURenderPipeline };

  constructor(
    private readonly device: GPUDevice,
    private readonly format: GPUTextureFormat,
    private readonly uniformBindGroupLayout: GPUBindGroupLayout,
    private readonly textureBindGroupLayout: GPUBindGroupLayout,
    private readonly textureStore: WebGpuTextureStore,
    private readonly resolutionBindGroup: GPUBindGroup,
    private readonly normalMode=false,
    private readonly sunMaskMode=false,
    private readonly litMode?: "color" | "data" | "masks",
    private readonly litHdr = false,
    private readonly linearWorking = false,
    private readonly surfaceMode = false,
  ) {
    if(surfaceMode && (!normalMode || litMode!=="data"))throw Error("Surface staging requires the lit data pass");
    if(surfaceMode)this.surfaceTextures=new WebGpuSpriteSurfaceTextures(device);
    this.spritePipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: normalMode?[uniformBindGroupLayout,textureBindGroupLayout,textureBindGroupLayout,...(this.surfaceTextures?[this.surfaceTextures.layout]:[])]:[uniformBindGroupLayout, textureBindGroupLayout],
    });
    this.spriteInstanceBuffer = webGpuResources(this.device).createBuffer({
      size: COMMAND_STRIDE_BYTES,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.spritePipeline = this.createSpritePipeline("alpha");
    this.additiveSpritePipeline = normalMode?this.spritePipeline:this.createSpritePipeline("additive");
  }

  private get stride(): number { return (this.litMode==="masks"?19:this.surfaceMode ? 24 : this.litMode ? 17 : 15) * 4; }

  configurePalettes(palettes:ResolvedSpritePalettes|undefined):void {
    if(this.normalMode) return;
    if(!palettes) { this.releasePalette(); return; }
    if(this.palette) { this.palette.resources.configure(palettes); return; }
    const resources=new WebGpuSpritePalette(this.device,this.linearWorking);
    const pipelines:GPURenderPipeline[]=[];
    try {
      resources.configure(palettes);
      const layout=this.device.createPipelineLayout({bindGroupLayouts:[this.uniformBindGroupLayout,this.textureBindGroupLayout,resources.layout]});
      const alpha=this.createSpritePipeline("alpha",layout);pipelines.push(alpha);
      const additive=this.createSpritePipeline("additive",layout);pipelines.push(additive);
      this.palette={resources,alpha,additive};
    } catch(error) { resources.destroy(); for(const pipeline of pipelines) webGpuResources(this.device).releasePipeline(pipeline); throw error; }
  }

  validatePalettes(commands:RenderCommandBufferView):void {
    if(this.palette&&commands.spatial) throw new Error("paletteSwap currently supports flat 2D sprite commands only.");
  }

  private releasePalette():void {
    if(!this.palette) return;
    this.palette.resources.destroy();
    webGpuResources(this.device).releasePipeline(this.palette.alpha);
    webGpuResources(this.device).releasePipeline(this.palette.additive);
    this.palette=undefined;
  }

  draw(
    pass: GPURenderPassEncoder,
    commands: RenderCommandBufferView,
    spriteMaterialPasses: readonly SpriteMaterialPass[],
    maskReceivers=false,
  ): WebGpuSpritePassStats {
    if (commands.commandCount === 0) {
      return { drawCalls: 0, textureSwitchCount: 0 };
    }

    const ranges = this.sunMaskMode?groundShadowRanges(commands,this.spriteRangeScratch,maskReceivers):spriteRanges(commands, this.spriteRangeScratch);
    const normalRanges=this.normalMode?this.normalRanges(commands):undefined;
    const commandBytes = commands.commandCount * this.stride;
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
      if(!this.palette) pass.setPipeline(this.spritePipelineForBlendMode(materialPass.blendMode));
      pass.setBindGroup(0, this.resolutionBindGroup);
      const passByteOffset = passIndex * commandBytes;
      for (const range of (normalRanges&&materialPass.kind==="base"?normalRanges:ranges)) {
        const palette=materialPass.kind==="base"?this.palette?.resources.group(range.textureId,!!this.textureStore.resource(range.textureId).linearBindGroup):undefined;
        if(this.palette) pass.setPipeline(palette?(materialPass.blendMode==="additive"?this.palette.additive:this.palette.alpha):this.spritePipelineForBlendMode(materialPass.blendMode));
        if(palette) pass.setBindGroup(2,palette);
        drawCalls += this.drawRange(pass, range, passByteOffset,"normalTextureId" in range?range.normalTextureId as number:SPRITE_NORMAL_NONE);
      }
    }
    return { drawCalls, textureSwitchCount: Math.max(0,(normalRanges??ranges).length - 1) };
  }

  destroy(): void {
    this.releasePalette();
    this.surfaceTextures?.destroy();
    webGpuResources(this.device).destroy(this.spriteInstanceBuffer);
    this.materialStaging = new Float32Array(0);
    this.spriteRangeScratch.length = 0;
    this.spriteInstanceCapacityBytes = 0;
  }

  private createSpritePipeline(blendMode: SpriteMaterialBlendMode, paletteLayout?:GPUPipelineLayout): GPURenderPipeline {
    const module = this.device.createShaderModule({
      code: `
        struct Resolution {
          size: vec2f,
          groundYScale: f32,
          pixelSnap: f32,
          shadowProjection: vec3f,
          skipGroundShadows: f32,
        };
        @group(0) @binding(0) var<uniform> resolution: Resolution;
        @group(1) @binding(0) var spriteSampler: sampler;
        @group(1) @binding(1) var spriteTexture: texture_2d<f32>;
        ${this.normalMode?"@group(2) @binding(0) var normalSampler:sampler; @group(2) @binding(1) var normalTexture:texture_2d<f32>;":""}
        ${paletteLayout?SPRITE_PALETTE_WGSL:""}

        struct VertexInput {
          @location(0) rect: vec4f,
          @location(1) uvRect: vec4f,
          @location(2) color: vec4f,
          @location(3) rotation: f32,
          @location(4) flags: f32,
          ${this.litMode?"@location(5) lighting:vec2f,":""}
          ${this.litMode==="masks"?"@location(6) receiverMasks:vec2f,":""}
          ${this.surfaceMode?"@location(6) surface:vec4f,@location(7) surfaceParams:vec2f,":""}
          @builtin(vertex_index) vertexIndex: u32,
        };

        struct VertexOutput {
          @builtin(position) position: vec4f,
          @location(0) uv: vec2f,
          @location(1) color: vec4f,
          @location(2) corner: vec2f,
          @location(3) @interpolate(flat) flags: f32,
          ${this.litMode?"@location(6) @interpolate(flat) lighting:vec2f,":""}
          ${this.litMode==="masks"?"@location(7) @interpolate(flat) receiverMasks:vec2f,":""}
          ${this.surfaceMode?"@location(7) @interpolate(flat) surface:vec4f,@location(8) @interpolate(flat) surfaceParams:vec2f,":""}
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
          var pixelPosition = input.rect.xy + input.rect.zw * 0.5 + rotated;
          if (resolution.pixelSnap > 0.0) {
            if (min(abs(rotationCos), abs(rotationSin)) < 0.000001 && (u32(input.flags) & 32u) == 0u) {
              if (input.rotation == 0.0) {
                var edge = corner;
                if ((u32(input.flags) & 4u) != 0u) { edge.y = 0.5 + (corner.y - 0.5) * resolution.groundYScale; }
                pixelPosition = input.rect.xy + input.rect.zw * edge;
              }
              pixelPosition = floor(pixelPosition * resolution.pixelSnap + vec2f(0.5)) / resolution.pixelSnap;
            } else {
              pixelPosition += floor(input.rect.xy * resolution.pixelSnap + vec2f(0.5)) / resolution.pixelSnap - input.rect.xy;
            }
          }
          let zeroToOne = pixelPosition / resolution.size;
          let clip = zeroToOne * 2.0 - vec2f(1.0, 1.0);
          var output: VertexOutput;
          output.position = vec4f(clip * vec2f(1.0, -1.0), 0.0, 1.0);
          ${this.sunMaskMode?"":"if(resolution.skipGroundShadows>0.5 && (u32(input.flags)&4u)!=0u && (u32(input.flags)&56u)!=0u){output.position=vec4f(2.,2.,2.,1.);}"}
          output.uv = mix(input.uvRect.xy, input.uvRect.zw, corner);
          output.color = input.color;
          output.corner = corner;
          output.flags = input.flags;
          ${this.litMode?"output.lighting=input.lighting;":""}
          ${this.litMode==="masks"?"output.receiverMasks=input.receiverMasks;":""}
          ${this.surfaceMode?"output.surface=input.surface;output.surfaceParams=input.surfaceParams;":""}
          ${this.normalMode?"output.rotationCS=vec2f(rotationCos,rotationSin);output.uvSign=select(vec2f(1.),vec2f(-1.),input.uvRect.zw<input.uvRect.xy);":""}
          return output;
        }

        ${this.litMode==="masks"?FLAT_RECEIVER_MASK_WGSL:this.litMode?flatLitWgslFragment(this.litMode==="data",this.linearWorking,this.surfaceMode):this.normalMode?NORMAL_FRAGMENT:this.sunMaskMode?SUN_MASK_FRAGMENT:`        @fragment
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
          return ${paletteLayout?"paletteColor(sampled)":"sampled"} * input.color;
        }`}

      `,
    });

    return webGpuResources(this.device).createRenderPipeline({
      layout: paletteLayout??this.spritePipelineLayout,
      vertex: {
        module,
        entryPoint: "vs_main",
        buffers: [{
          arrayStride: this.stride,
          stepMode: "instance",
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x4" },
            { shaderLocation: 1, offset: 4 * BYTES_PER_F32, format: "float32x4" },
            { shaderLocation: 2, offset: 8 * BYTES_PER_F32, format: "float32x4" },
            { shaderLocation: 3, offset: 14 * BYTES_PER_F32, format: "float32" },
            { shaderLocation: 4, offset: 13 * BYTES_PER_F32, format: "float32" },
            ...(this.litMode?[{shaderLocation:5,offset:60,format:"float32x2" as const}]:[]),
            ...(this.litMode==="masks"?[{shaderLocation:6,offset:68,format:"float32x2" as const}]:[]),
            ...(this.surfaceMode?[{shaderLocation:6,offset:68,format:"float32x4" as const},{shaderLocation:7,offset:84,format:"float32x2" as const}]:[]),
          ],
        }],
      },
      fragment: {
        module,
        entryPoint: "fs_main",
        targets: this.litMode==="data"?(this.surfaceMode?[0,1,2,3]:[0,1,2]).map(i=>({format:i===3?"rgba16float":i===2?(this.litHdr?"rgba16float":this.linearWorking?"rgba8unorm-srgb":"rgba8unorm"):"rgba8unorm",blend:spriteBlendState("alpha")})):this.normalMode?[{format:"rgba8unorm",blend:spriteBlendState("alpha")},{format:"rgba8unorm",blend:spriteBlendState("alpha")}]:[{
          format: this.format,
          blend: this.sunMaskMode&&blendMode==="additive"?{color:{operation:"max",srcFactor:"one",dstFactor:"one"},alpha:{operation:"max",srcFactor:"one",dstFactor:"one"}}:spriteBlendState(blendMode),
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
    const color=this.textureStore.resource(range.textureId);pass.setBindGroup(1,this.linearWorking ? color.linearBindGroup ?? color.bindGroup : color.bindGroup);
    if(this.normalMode){const mapped=normalTextureId!==SPRITE_NORMAL_NONE,normal=mapped?this.textureStore.resource(normalTextureId):color;
      if(mapped&&(normal.colorSpace==="srgb"||normal.width!==color.width||normal.height!==color.height))throw Error("Sprite normals require a same-size linear/data texture");
      pass.setBindGroup(2,normal.bindGroup);
    }
    if(this.surfaceTextures){
      const surface=range as NormalRange;
      const emission=surface.emissionTextureId??SPRITE_NORMAL_NONE,specular=surface.specularTextureId??SPRITE_NORMAL_NONE,roughness=surface.roughnessTextureId??SPRITE_NORMAL_NONE;
      pass.setBindGroup(3,this.surfaceTextures.group(
        (emission===SPRITE_NORMAL_NONE?color:this.textureStore.resource(emission)).view,
        (specular===SPRITE_NORMAL_NONE?color:this.textureStore.resource(specular)).view,
        (roughness===SPRITE_NORMAL_NONE?color:this.textureStore.resource(roughness)).view));
    }
    pass.setVertexBuffer(
      0,
      this.spriteInstanceBuffer,
      passByteOffset + range.start * this.stride,
      commandCount * this.stride,
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
    if (this.litMode || this.normalMode || commands.floatsPerCommand !== FLOATS_PER_COMMAND || spriteMaterialPassRequiresCommandCopy(materialPass)) {
      this.ensureMaterialStaging(commands.commandCount * (this.stride/4));
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
      if(this.litMode) expandLitSpriteCommands(this.materialStaging,commands,0,commands.commandCount,this.textureStore,this.linearWorking,this.litHdr,this.surfaceMode,false,this.litMode==="masks");
      this.device.queue.writeBuffer(
        this.spriteInstanceBuffer,
        byteOffset,
        this.materialStaging.buffer,
        this.materialStaging.byteOffset,
        this.litMode ? commands.commandCount * this.stride : materialFloatCount * BYTES_PER_F32,
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
      const textureId=Math.trunc(commands.buffer[start*commands.floatsPerCommand+12]),normalTextureId=commands.spriteNormalMaterials?.buffer[start*2]??SPRITE_NORMAL_NONE;let end=start+1;
      while(end<commands.commandCount&&Math.trunc(commands.buffer[end*commands.floatsPerCommand+12])===textureId&&(commands.spriteNormalMaterials?.buffer[end*2]??SPRITE_NORMAL_NONE)===normalTextureId){
        let same=true;if(this.surfaceMode)for(let map=0;map<3;map++)if(spriteSurfaceTextureId(commands,start,map)!==spriteSurfaceTextureId(commands,end,map)){same=false;break;}
        if(!same)break;end++;
      }
      if(this.surfaceMode){const range=ranges[count]??(ranges[count]={textureId,normalTextureId,start,end});range.emissionTextureId=spriteSurfaceTextureId(commands,start,0);range.specularTextureId=spriteSurfaceTextureId(commands,start,1);range.roughnessTextureId=spriteSurfaceTextureId(commands,start,2);}
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
  if(mapped){let normalSize=textureDimensions(normalTexture);
    let texel=clamp(vec2i(floor((input.uv+vec2f(1./4194304.))*vec2f(normalSize))),vec2i(0),vec2i(normalSize)-1);
    let raw=textureLoad(normalTexture,texel,0).rgb*2.-1.;var local=vec3f(0.,0.,1.);
    if(length(raw)>=0.01){local=normalize(raw);}local=vec3f(local.xy*input.uvSign,local.z);
    let c=input.rotationCS.x;let s=input.rotationCS.y;n=vec3f(c*local.x+s*local.y,s*local.x-c*local.y,local.z);
  }
  var output:NormalOutput;output.normal=vec4f(n*.5+.5,alpha);output.coverage=vec4f(select(0.,1.,mapped),0.,0.,alpha);return output;
}`;

const SUN_MASK_FRAGMENT = `
@fragment fn fs_main(input:VertexOutput)->@location(0) vec4f {
  let flags=u32(input.flags);var alpha=input.color.a;
  if((flags&24u)!=0u){let q=(input.corner-.5)*2.;if((flags&8u)!=0u&&dot(q,q)>1.){discard;}}
  else {alpha*=textureSampleLevel(spriteTexture,spriteSampler,input.uv,0.).a;}
  if((flags&4u)!=0u){return vec4f(alpha,0.,0.,1.);}
  return vec4f(0.,0.,0.,alpha);
}`;
