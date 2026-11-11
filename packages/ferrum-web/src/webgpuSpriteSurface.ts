/** Raw, nearest-loaded material maps. View identity invalidates groups on texture replacement. */
export class WebGpuSpriteSurfaceTextures {
  readonly layout: GPUBindGroupLayout;
  private groups=new WeakMap<GPUTextureView,WeakMap<GPUTextureView,WeakMap<GPUTextureView,GPUBindGroup>>>();
  constructor(private readonly device:GPUDevice){
    this.layout=device.createBindGroupLayout({entries:[0,1,2].map(binding=>({binding,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"unfilterable-float" as const}}))});
  }
  group(emission:GPUTextureView,specular:GPUTextureView,roughness:GPUTextureView):GPUBindGroup{
    let bySpecular=this.groups.get(emission);
    if(!bySpecular){bySpecular=new WeakMap();this.groups.set(emission,bySpecular);}
    let byRoughness=bySpecular.get(specular);
    if(!byRoughness){byRoughness=new WeakMap();bySpecular.set(specular,byRoughness);}
    let group=byRoughness.get(roughness);
    if(!group){group=this.device.createBindGroup({layout:this.layout,entries:[{binding:0,resource:emission},{binding:1,resource:specular},{binding:2,resource:roughness}]});byRoughness.set(roughness,group);}
    return group;
  }
  destroy():void{this.groups=new WeakMap();}
}
