import { WebGpuSpritePass } from "./webgpuSpritePass.js";
import { beginWebGpuRenderPass } from "./webgpuGpuTimer.js";
import { webGpuResources } from "./webgpuResources.js";
import type { WebGpuTextureStore } from "./webgpuTextureStore.js";
import type { RenderCommandBufferView } from "./renderCommandDecoder.js";
import type { SpriteMaterialPass } from "./spriteMaterial.js";

export interface WebGpuSpriteNormalBindings {layout:GPUBindGroupLayout;bindGroup:GPUBindGroup;}
/** Data MRTs share the exact color geometry/order, including unmapped foreground alpha. */
export class WebGpuSpriteNormals {
  private readonly batch:WebGpuSpritePass;
  private readonly layout:GPUBindGroupLayout;
  private textures:GPUTexture[]=[];
  private views:GPUTextureView[]=[];
  private bindGroup?:GPUBindGroup;
  private width=0;private height=0;
  constructor(private readonly device:GPUDevice,uniform:GPUBindGroupLayout,texture:GPUBindGroupLayout,store:WebGpuTextureStore,resolution:GPUBindGroup){
    this.batch=new WebGpuSpritePass(device,"rgba8unorm",uniform,texture,store,resolution,true);
    this.layout=device.createBindGroupLayout({entries:[0,1].map(binding=>({binding,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"float",viewDimension:"2d",multisampled:false}}))});
  }
  draw(encoder:GPUCommandEncoder,commands:RenderCommandBufferView,width:number,height:number,materials:readonly SpriteMaterialPass[]){
    this.resize(width,height);
    const pass=beginWebGpuRenderPass(this.device,encoder,{colorAttachments:this.views.map((view,i)=>({view,loadOp:"clear",storeOp:"store",clearValue:i?{r:0,g:0,b:0,a:0}:{r:.5,g:.5,b:.5,a:0}}))});
    try{return this.batch.draw(pass,commands,materials);}finally{pass.end();}
  }
  get buffers():WebGpuSpriteNormalBindings{if(!this.bindGroup)throw Error("Sprite normal targets not allocated");return {layout:this.layout,bindGroup:this.bindGroup};}
  clearTargets(){for(const texture of this.textures)webGpuResources(this.device).destroy(texture);this.textures=[];this.views=[];this.bindGroup=undefined;this.width=this.height=0;}
  destroy(){this.clearTargets();this.batch.destroy();}
  private resize(width:number,height:number){
    if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>this.device.limits.maxTextureDimension2D||height>this.device.limits.maxTextureDimension2D)throw Error("Invalid sprite normal target dimensions");
    if(this.width===width&&this.height===height)return;
    const textures:GPUTexture[]=[],views:GPUTextureView[]=[];
    let bindGroup:GPUBindGroup;
    try{
      for(let i=0;i<2;i++){const texture=webGpuResources(this.device).createTexture({size:{width,height,depthOrArrayLayers:1},format:"rgba8unorm",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});textures.push(texture);views.push(texture.createView());}
      bindGroup=this.device.createBindGroup({layout:this.layout,entries:views.map((resource,binding)=>({binding,resource}))});
    }catch(error){for(const texture of textures)webGpuResources(this.device).destroy(texture);throw error;}
    this.clearTargets();this.textures=textures;this.views=views;this.bindGroup=bindGroup;this.width=width;this.height=height;
  }
}
