import { webGpuResources } from "./webgpuResources.js";
import { beginWebGpuRenderPass } from "./webgpuGpuTimer.js";
import type { PixelPerfectPresentation } from "./pixelPerfect.js";
/** One reusable virtual color target and a nearest presentation pipeline. */
export class WebGpuPixelPerfect {
    private readonly pipeline: GPURenderPipeline;
    private readonly sampler: GPUSampler;
    private target?: GPUTexture;
    private group?: GPUBindGroup;
    private width = 0;
    private height = 0;
    constructor(private readonly device: GPUDevice, private readonly format: GPUTextureFormat, outputFormat = format, encodeSrgb = false, opaque = true) {
        this.sampler = device.createSampler({ minFilter: "nearest", magFilter: "nearest" });
        const module = device.createShaderModule({ code: `
      struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f };
      @group(0) @binding(0) var image: texture_2d<f32>;
      @group(0) @binding(1) var nearest: sampler;
      @vertex fn vertex(@builtin(vertex_index) index: u32) -> Vertex {
        let p = array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3))[index];
        var v: Vertex; v.position=vec4f(p,0,1); v.uv=vec2f(p.x*0.5+0.5,0.5-p.y*0.5); return v;
      }
      @fragment fn fragment(v: Vertex) -> @location(0) vec4f {
        let color = textureSample(image,nearest,v.uv);
        var rgb=color.rgb;
        ${encodeSrgb ? `if(color.a>0.){let c=clamp(rgb/color.a,vec3f(0.),vec3f(1.));rgb=select(1.055*pow(c,vec3f(1./2.4))-vec3f(.055),c*12.92,c<=vec3f(.0031308))*color.a;}else{rgb=vec3f(0.);}` : ""}
        return vec4f(rgb, ${opaque ? "1.0" : "color.a"});
      }
    ` });
        this.pipeline = webGpuResources(device).createRenderPipeline({ layout: "auto", vertex: { module, entryPoint: "vertex" },
            fragment: { module, entryPoint: "fragment", targets: [{ format: outputFormat }] }, primitive: { topology: "triangle-list" } });
    }
    resize(width: number, height: number): void {
        if (this.target && width === this.width && height === this.height)
            return;
        if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>this.device.limits.maxTextureDimension2D||height>this.device.limits.maxTextureDimension2D)throw Error("Invalid presentation target dimensions");
        const target = webGpuResources(this.device).createTexture({ size: { width, height }, format: this.format,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
        let group: GPUBindGroup;
        try {
            group = this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [
                    { binding: 0, resource: target.createView() }, { binding: 1, resource: this.sampler }
                ] });
        }
        catch (error) {
            webGpuResources(this.device).destroy(target);
            throw error;
        }
        webGpuResources(this.device).destroy(this.target);
        this.target = target;
        this.group = group;
        this.width = width;
        this.height = height;
    }
    texture(): GPUTexture { if (!this.target)
        throw Error("Pixel-perfect target is not configured"); return this.target; }
    present(destination: GPUTexture, p: Pick<PixelPerfectPresentation, "x" | "y" | "width" | "height">, color: readonly number[]): void {
        const encoder = this.device.createCommandEncoder();
        const pass = beginWebGpuRenderPass(this.device, encoder, { colorAttachments: [{ view: destination.createView(), loadOp: "clear", storeOp: "store",
                    clearValue: { r: color[0], g: color[1], b: color[2], a: 1 } }] });
        pass.setViewport(p.x, p.y, p.width, p.height, 0, 1);
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.group!);
        pass.draw(3);
        pass.end();
        this.device.queue.submit([encoder.finish()]);
    }
    release(): void { webGpuResources(this.device).destroy(this.target); this.target = undefined; this.group = undefined; this.width = this.height = 0; }
}
