import type { ResolvedSpritePalettes } from "./spritePalette.js";
import { webGpuResources } from "./webgpuResources.js";

/** One immutable uniform buffer per binding: queue writes never alias multiple draws. */
export class WebGpuSpritePalette {
  readonly layout: GPUBindGroupLayout;
  private bindings = new Map<number,{buffer:GPUBuffer; group:GPUBindGroup; key:string}>();
  constructor(private readonly device:GPUDevice) {
    this.layout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}]});
  }
  configure(palettes:ResolvedSpritePalettes):void {
    if (palettes.size===this.bindings.size && [...palettes].every(([id,palette])=>this.bindings.get(id)?.key===palette.key)) return;
    const next = new Map<number,{buffer:GPUBuffer; group:GPUBindGroup; key:string}>();
    try {
      for (const [id,palette] of palettes) {
        const buffer=webGpuResources(this.device).createBuffer({size:1040,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
        try {
          const bytes=new ArrayBuffer(1040), floats=new Float32Array(bytes);
          floats.set(palette.from); floats.set(palette.to,128);
          new Uint32Array(bytes)[256]=palette.count;
          this.device.queue.writeBuffer(buffer,0,bytes);
          const group=this.device.createBindGroup({layout:this.layout,entries:[{binding:0,resource:{buffer}}]});
          next.set(id,{buffer,group,key:palette.key});
        } catch(error) { webGpuResources(this.device).destroy(buffer); throw error; }
      }
    } catch(error) { for(const binding of next.values()) webGpuResources(this.device).destroy(binding.buffer); throw error; }
    this.destroy(); this.bindings=next;
  }
  group(textureId:number):GPUBindGroup|undefined { return this.bindings.get(textureId)?.group; }
  destroy():void { for(const binding of this.bindings.values()) webGpuResources(this.device).destroy(binding.buffer);this.bindings.clear(); }
}
