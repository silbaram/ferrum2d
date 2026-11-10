import {WebGpuSpritePass} from './webgpuSpritePass.js';
import {webGpuResources} from './webgpuResources.js';
import {beginWebGpuRenderPass} from './webgpuGpuTimer.js';
import type {WebGpuTextureStore} from './webgpuTextureStore.js';
import type {RenderCommandBufferView} from './renderCommandDecoder.js';
import type {SpriteMaterialPass} from './spriteMaterial.js';

export class WebGpuReceiverMasks {
  private readonly batch:WebGpuSpritePass;
  private texture?:GPUTexture;
  view?:GPUTextureView;
  private width=0;private height=0;
  constructor(private readonly device:GPUDevice,uniform:GPUBindGroupLayout,texture:GPUBindGroupLayout,store:WebGpuTextureStore,resolution:GPUBindGroup){
    this.batch=new WebGpuSpritePass(device,'rgba8unorm',uniform,texture,store,resolution,false,false,'masks');
  }
  prepare(width:number,height:number):boolean{
    if(this.width===width&&this.height===height&&this.view)return false;
    const texture=webGpuResources(this.device).createTexture({size:{width,height,depthOrArrayLayers:1},format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
    let view:GPUTextureView;try{view=texture.createView();}catch(error){webGpuResources(this.device).destroy(texture);throw error;}
    this.clearTarget();this.texture=texture;this.view=view;this.width=width;this.height=height;return true;
  }
  draw(encoder:GPUCommandEncoder,commands:RenderCommandBufferView,materials:readonly SpriteMaterialPass[]){
    const pass=beginWebGpuRenderPass(this.device,encoder,{colorAttachments:[{view:this.view!,loadOp:'clear',storeOp:'store',clearValue:{r:1,g:1,b:0,a:0}}]});
    try{return this.batch.draw(pass,commands,materials);}finally{pass.end();}
  }
  clearTarget():void{webGpuResources(this.device).destroy(this.texture);this.texture=undefined;this.view=undefined;this.width=this.height=0;}
  destroy():void{this.clearTarget();this.batch.destroy();}
}
