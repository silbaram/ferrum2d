import { WebGpuSpritePass } from "./webgpuSpritePass.js";
import { WebGpuLightingPass } from "./webgpuLightingPass.js";
import { beginWebGpuRenderPass } from "./webgpuGpuTimer.js";
import { webGpuResources } from "./webgpuResources.js";
import { flatLitCompositeWgsl } from "./flatLitShaders.js";
import { createResolvedLightingScene } from "./lightingNormalize.js";
import type { ResolvedLightingScene2D } from "./lightingTypes.js";
import type { WebGpuTextureStore } from "./webgpuTextureStore.js";
import type { RenderCommandBufferView } from "./renderCommandDecoder.js";
import type { SpriteMaterialPass } from "./spriteMaterial.js";
import type { WebGpuSunShadowBindings } from "./webgpuSunShadowMask.js";

/** Receiver-only composition. Scratch attachments are allocated only while enabled. */
export class WebGpuFlatLitPass {
  private readonly color: WebGpuSpritePass;
  private data?: WebGpuSpritePass;
  private lights?: WebGpuLightingPass;
  private readonly normalLayout: GPUBindGroupLayout;
  private readonly compositeLayout: GPUBindGroupLayout;
  private subtract?: GPURenderPipeline;
  private add?: GPURenderPipeline;
  private textures: GPUTexture[]=[];
  private views: GPUTextureView[]=[];
  private normals?: GPUBindGroup;
  private composite?: GPUBindGroup;
  private width=0; private height=0;
  private readonly effective=createResolvedLightingScene();
  constructor(private readonly device:GPUDevice,private readonly format:GPUTextureFormat,private readonly uniform:GPUBindGroupLayout,
    private readonly texture:GPUBindGroupLayout,private readonly store:WebGpuTextureStore,private readonly resolution:GPUBindGroup,private readonly lightingLayout:GPUPipelineLayout, private readonly hdr = false){
    this.color=new WebGpuSpritePass(device,format,uniform,texture,store,resolution,false,false,"color",hdr);
    const entries=(count:number)=>Array.from({length:count},(_,binding)=>({binding,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"unfilterable-float" as const,viewDimension:"2d" as const,multisampled:false}}));
    // Normal RGBA8 attachments use the same binding contract as the legacy lighting pass.
    this.normalLayout=device.createBindGroupLayout({entries:[0,1].map(binding=>({binding,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"float",viewDimension:"2d",multisampled:false}}))});
    this.compositeLayout=device.createBindGroupLayout({entries:entries(3)});
  }
  prepareFrame(width:number,height:number,enabled:boolean):void{
    if(!enabled){this.clearTargets();return;}
    this.data??=new WebGpuSpritePass(this.device,"rgba8unorm",this.uniform,this.texture,this.store,this.resolution,true,false,"data",this.hdr);
    this.lights??=new WebGpuLightingPass(this.device,"rgba16float",this.lightingLayout,this.resolution,true);
    if(!this.add)this.prepareComposite();
    this.resize(width,height);
  }
  drawColor(pass:GPURenderPassEncoder,commands:RenderCommandBufferView,materials:readonly SpriteMaterialPass[]){return this.color.draw(pass,commands,materials);}
  drawLighting(encoder:GPUCommandEncoder,target:GPUTextureView,commands:RenderCommandBufferView,scene:ResolvedLightingScene2D,
    logicalWidth:number,logicalHeight:number,materials:readonly SpriteMaterialPass[],sunMask?:WebGpuSunShadowBindings){
    const dataPass=beginWebGpuRenderPass(this.device,encoder,{colorAttachments:this.views.slice(0,3).map((view,i)=>({view,loadOp:"clear",storeOp:"store",clearValue:i===0?{r:.5,g:.5,b:.5,a:0}:i===1?{r:1,g:0,b:0,a:0}:{r:0,g:0,b:0,a:0}}))});
    let data;try{data=this.data!.draw(dataPass,commands,materials);}finally{dataPass.end();}
    const effective=this.effective,ambient=effective.ambient as [number,number,number,number];
    ambient[0]=scene.ambientIrradiance![0];ambient[1]=scene.ambientIrradiance![1];ambient[2]=scene.ambientIrradiance![2];ambient[3]=1;
    effective.enabled=true;effective.pointLights=scene.pointLights;effective.tileOccluders=scene.tileOccluders;effective.directionalLight=scene.directionalLight;effective.shadows=scene.shadows;
    const pass=beginWebGpuRenderPass(this.device,encoder,{colorAttachments:[{view:this.views[3]!,loadOp:"clear",storeOp:"store",clearValue:{r:0,g:0,b:0,a:0}}]});
    const lighting=this.lights!.draw(pass,effective,logicalWidth,logicalHeight,{layout:this.normalLayout,bindGroup:this.normals!},{encoder,view:this.views[3]!,width:this.width,height:this.height},sunMask);
    if(!lighting.passEnded)pass.end();
    const composite=beginWebGpuRenderPass(this.device,encoder,{colorAttachments:[{view:target,loadOp:"load",storeOp:"store"}]});
    try{composite.setBindGroup(0,this.composite!);composite.setPipeline(this.subtract!);composite.draw(3);composite.setPipeline(this.add!);composite.draw(3);}finally{composite.end();}
    return {data,lighting:{...lighting,drawCalls:lighting.drawCalls+2}};
  }
  clearTargets(){for(const texture of this.textures)webGpuResources(this.device).destroy(texture);this.textures=[];this.views=[];this.normals=undefined;this.composite=undefined;this.width=this.height=0;this.lights?.clearTargets();}
  destroy(){this.clearTargets();this.color.destroy();this.data?.destroy();this.lights?.destroy();if(this.add)webGpuResources(this.device).releasePipeline(this.add);if(this.subtract)webGpuResources(this.device).releasePipeline(this.subtract);}
  private prepareComposite(){
    const module=this.device.createShaderModule({code:flatLitCompositeWgsl(this.hdr)}),layout=this.device.createPipelineLayout({bindGroupLayouts:[this.compositeLayout]});
    const pipeline=(subtract:boolean)=>webGpuResources(this.device).createRenderPipeline({layout,vertex:{module,entryPoint:"vs_main"},fragment:{module,entryPoint:subtract?"fs_subtract":"fs_add",targets:[{format:this.format,writeMask:7,blend:{color:{srcFactor:"one",dstFactor:"one",operation:subtract?"reverse-subtract":"add"},alpha:{srcFactor:"zero",dstFactor:"one",operation:"add"}}}]},primitive:{topology:"triangle-list"}});
    const subtract=pipeline(true);try{this.add=pipeline(false);this.subtract=subtract;}catch(error){webGpuResources(this.device).releasePipeline(subtract);throw error;}
  }
  private resize(width:number,height:number){
    if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>this.device.limits.maxTextureDimension2D||height>this.device.limits.maxTextureDimension2D)throw Error("Invalid lit target dimensions");
    if(this.width===width&&this.height===height)return;
    const textures:GPUTexture[]=[],views:GPUTextureView[]=[];let normals:GPUBindGroup,composite:GPUBindGroup;
    try{for(let i=0;i<4;i++){const texture=webGpuResources(this.device).createTexture({size:{width,height,depthOrArrayLayers:1},format:i===3||i===2&&this.hdr?"rgba16float":"rgba8unorm",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});textures.push(texture);views.push(texture.createView());}
      normals=this.device.createBindGroup({layout:this.normalLayout,entries:views.slice(0,2).map((resource,binding)=>({binding,resource}))});
      composite=this.device.createBindGroup({layout:this.compositeLayout,entries:[views[2]!,views[1]!,views[3]!].map((resource,binding)=>({binding,resource}))});
    }catch(error){textures.forEach(texture=>webGpuResources(this.device).destroy(texture));throw error;}
    this.clearTargets();this.textures=textures;this.views=views;this.normals=normals;this.composite=composite;this.width=width;this.height=height;
  }
}
