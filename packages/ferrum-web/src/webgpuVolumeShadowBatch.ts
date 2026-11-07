import { webGpuResources } from "./webgpuResources.js";
import type { RenderCommandBufferView } from "./renderCommandDecoder.js";

export class WebGpuVolumeShadowBatch {
  private readonly pipeline: GPURenderPipeline;
  private buffer?: GPUBuffer;
  private bytes=0;
  constructor(private readonly device:GPUDevice,uniform:GPUBindGroupLayout,private readonly resolution:GPUBindGroup){
    const module=device.createShaderModule({code:`
      struct Resolution { size:vec2f, groundYScale:f32, pixelSnap:f32, shadowProjection:vec3f, skipGroundShadows:f32 };
      @group(0) @binding(0) var<uniform> resolution:Resolution;
      struct Output { @builtin(position) position:vec4f, @location(0) opacity:f32 };
      @vertex fn vs_main(@location(0) input:vec3f)->Output {
        var p=input.xy;if(resolution.pixelSnap>0.){p=floor(p*resolution.pixelSnap+.5)/resolution.pixelSnap;}
        var o:Output;o.position=vec4f((p/resolution.size*2.-1.)*vec2f(1.,-1.),0.,1.);o.opacity=input.z;return o;
      }
      @fragment fn fs_main(input:Output)->@location(0) vec4f {return vec4f(input.opacity,0.,0.,1.);}
    `});
    this.pipeline=webGpuResources(device).createRenderPipeline({layout:device.createPipelineLayout({bindGroupLayouts:[uniform]}),
      vertex:{module,entryPoint:"vs_main",buffers:[{arrayStride:12,stepMode:"vertex",attributes:[{shaderLocation:0,offset:0,format:"float32x3"}]}]},
      fragment:{module,entryPoint:"fs_main",targets:[{format:"r8unorm",blend:{color:{operation:"max",srcFactor:"one",dstFactor:"one"},alpha:{operation:"max",srcFactor:"one",dstFactor:"one"}}}]},
      primitive:{topology:"triangle-list"}});
  }
  draw(pass:GPURenderPassEncoder,volumes:NonNullable<RenderCommandBufferView["groundShadowVolumes"]>):number {
    if(!volumes.vertexCount)return 0;
    const bytes=volumes.buffer.byteLength;
    if(bytes>this.bytes){
      const size=2**Math.ceil(Math.log2(Math.max(16,bytes)));
      const buffer=webGpuResources(this.device).createBuffer({size,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
      if(this.buffer)webGpuResources(this.device).destroy(this.buffer);this.buffer=buffer;this.bytes=size;
    }
    this.device.queue.writeBuffer(this.buffer!,0,volumes.buffer.buffer,volumes.buffer.byteOffset,bytes);
    pass.setPipeline(this.pipeline);pass.setBindGroup(0,this.resolution);pass.setVertexBuffer(0,this.buffer!,0,bytes);pass.draw(volumes.vertexCount);
    return 1;
  }
  destroy(){if(this.buffer)webGpuResources(this.device).destroy(this.buffer);this.buffer=undefined;this.bytes=0;webGpuResources(this.device).releasePipeline(this.pipeline);}
}
