import { WebGpuSpritePass } from "./webgpuSpritePass.js";
import { webGpuResources } from "./webgpuResources.js";
import { beginWebGpuRenderPass } from "./webgpuGpuTimer.js";
import type { WebGpuTextureStore } from "./webgpuTextureStore.js";
import type { RenderCommandBufferView } from "./renderCommandDecoder.js";
import type { SpriteMaterialPass } from "./spriteMaterial.js";
import { WebGpuVolumeShadowBatch } from "./webgpuVolumeShadowBatch.js";

const CASTERS: readonly SpriteMaterialPass[] = [{kind:"base",blendMode:"additive",offsetX:0,offsetY:0}];
const RECEIVERS: readonly SpriteMaterialPass[] = [{kind:"base",blendMode:"alpha",offsetX:0,offsetY:0}];
export interface WebGpuSunShadowBindings { layout: GPUBindGroupLayout; bindGroup: GPUBindGroup; }

/** MAX union followed by upright alpha removal; one byte per physical target pixel. */
export class WebGpuSunShadowMask {
  private readonly batch: WebGpuSpritePass;
  private readonly layout: GPUBindGroupLayout;
  private readonly tint: GPUBuffer;
  private volumes?:WebGpuVolumeShadowBatch;
  private texture?: GPUTexture;
  private view?: GPUTextureView;
  private bindGroup?: GPUBindGroup;
  private width = 0;
  private height = 0;
  constructor(private readonly device: GPUDevice, private readonly uniform: GPUBindGroupLayout, texture: GPUBindGroupLayout, store: WebGpuTextureStore, private readonly resolution: GPUBindGroup) {
    this.batch = new WebGpuSpritePass(device,"r8unorm",uniform,texture,store,resolution,false,true);
    this.layout = device.createBindGroupLayout({entries:[
      {binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"float",viewDimension:"2d",multisampled:false}},
      {binding:1,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}},
    ]});
    this.tint = webGpuResources(device).createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    // New WebGPU buffers are zero-initialized: sunlight transmission is black.
  }
  draw(encoder: GPUCommandEncoder, commands: RenderCommandBufferView, width: number, height: number) {
    this.resize(width,height);
    const pass = beginWebGpuRenderPass(this.device,encoder,{colorAttachments:[{view:this.view!,loadOp:"clear",storeOp:"store",clearValue:{r:0,g:0,b:0,a:0}}]});
    try {
      const volumeDraws=commands.groundShadowVolumes?.vertexCount
        ?(this.volumes??=new WebGpuVolumeShadowBatch(this.device,this.uniform,this.resolution)).draw(pass,commands.groundShadowVolumes):0;
      const casters = this.batch.draw(pass,commands,CASTERS);
      const receivers = this.batch.draw(pass,commands,RECEIVERS,true);
      return {layout:this.layout,bindGroup:this.bindGroup!,drawCalls:casters.drawCalls+receivers.drawCalls+volumeDraws,
        textureSwitchCount:casters.textureSwitchCount+receivers.textureSwitchCount};
    } finally { pass.end(); }
  }
  clearTarget() {
    if(this.texture)webGpuResources(this.device).destroy(this.texture);
    this.texture=undefined;this.view=undefined;this.bindGroup=undefined;this.width=this.height=0;
  }
  destroy(){this.clearTarget();this.batch.destroy();this.volumes?.destroy();webGpuResources(this.device).destroy(this.tint);}
  private resize(width: number,height: number) {
    if(this.width===width&&this.height===height)return;
    if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>this.device.limits.maxTextureDimension2D||height>this.device.limits.maxTextureDimension2D)
      throw Error("Invalid sunlight shadow mask dimensions");
    const texture=webGpuResources(this.device).createTexture({size:{width,height,depthOrArrayLayers:1},format:"r8unorm",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
    try {
      const view=texture.createView();
      const bindGroup=this.device.createBindGroup({layout:this.layout,entries:[{binding:0,resource:view},{binding:1,resource:{buffer:this.tint}}]});
      this.clearTarget();this.texture=texture;this.view=view;this.bindGroup=bindGroup;this.width=width;this.height=height;
    } catch(error){webGpuResources(this.device).destroy(texture);throw error;}
  }
}
