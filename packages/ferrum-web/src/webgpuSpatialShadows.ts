import { beginWebGpuRenderPass } from "./webgpuGpuTimer.js";
import { webGpuResources } from "./webgpuResources.js";
import { spatialModelMaterialWGSL } from "./webgpuSpatialMaterial.js";
import type { SpatialRenderBufferView } from "./dataSceneSpatial.js";
export const spatialShadowSamplingWGSL = `
@group(2) @binding(1) var pointMap:texture_depth_2d_array;
@group(2) @binding(2) var sunMap:texture_depth_2d;
fn slopeBias(n:vec3f,direction:vec3f)->f32{
 let incidence=max(dot(n,direction),0.);
 return min(sqrt(max(1.-incidence*incidence,0.))/max(incidence,.2),2.);
}
fn pointDepth(direction:vec3f)->f32{
 let a=abs(direction);var face=0u;
 if(a.x>=a.y && a.x>=a.z){face=select(1u,0u,direction.x>=0.);}
 else if(a.y>=a.z){face=select(3u,2u,direction.y>=0.);}
 else{face=select(5u,4u,direction.z>=0.);}
 let clip=env.shadow[face]*vec4f(direction,0.);let ndc=clip.xy/clip.w;
 let uv=vec2f(ndc.x*.5+.5,.5-ndc.y*.5);let size=textureDimensions(pointMap);
 return textureLoad(pointMap,vec2i(clamp(uv*vec2f(size),vec2f(0.),vec2f(size)-1.)),i32(face),0);
}
fn pointVisibility(delta:vec3f,d:f32,radius:f32,geometric:vec3f)->f32{
 if(d<=max(e(4u),.000001)){return 1.;}
 let size=f32(textureDimensions(pointMap).x);let filtered=e(95u)==1.;
 let bias=e(4u)+2.*d/size*slopeBias(geometric,delta/d)*select(1.,3.,filtered);
 let axis= -delta/d;
 if(!filtered){return select(1.,0.,pointDepth(axis)*radius+bias<d);}
 var up=vec3f(0.,1.,0.);if(abs(axis.y)>.99){up=vec3f(0.,0.,1.);}
 let tangent=normalize(cross(axis,up));let bitangent=cross(axis,tangent);var visibility=0.;
 for(var y= -1;y<=1;y++){for(var x= -1;x<=1;x++){
  let direction=axis+(tangent*f32(x)+bitangent*f32(y))*2./size;
  visibility+=select(1.,0.,pointDepth(direction)*radius+bias<d);
 }}return visibility/9.;
}
fn sunVisibility(world:vec3f,geometric:vec3f,direction:vec3f)->f32{
 let clip=env.shadow[6]*vec4f(world+geometric*e(124u),1.);let q=clip.xyz/clip.w*.5+.5;
 if(any(q<vec3f(0.))||any(q>vec3f(1.))){return 1.;}
 let size=textureDimensions(sunMap);let filtered=e(95u)==1.;
 let bias=(e(93u)+2.*e(94u)/f32(size.x)*slopeBias(geometric,direction)*select(1.,3.,filtered))/(e(91u)*2.);
 let uv=vec2f(q.x,1.-q.y);let pixel=vec2i(clamp(uv*vec2f(size),vec2f(0.),vec2f(size)-1.));
 if(!filtered){return select(1.,0.,textureLoad(sunMap,pixel,0)+bias<q.z);}
 var visibility=0.;for(var y= -1;y<=1;y++){for(var x= -1;x<=1;x++){
  let at=clamp(pixel+vec2i(x,y),vec2i(0),vec2i(size)-1);
  visibility+=select(1.,0.,textureLoad(sunMap,at,0)+bias<q.z);
 }}return visibility/9.;
}`;
export const spatialShadowCameraWGSL = `
struct ShadowCamera{matrix:mat4x4f,light:vec4f,params:vec4f};
@group(0) @binding(0) var<uniform> camera:ShadowCamera;
`;
export const spatialShadowGeometryWGSL =
  spatialShadowCameraWGSL +
  `
@group(1) @binding(0) var colorSampler:sampler;
@group(1) @binding(1) var colorTexture:texture_2d<f32>;
struct Input{@location(0) position:vec3f,@location(1) uv:vec2f,@location(2) color:vec4f,@location(3) cutoff:f32};
struct Fragment{@builtin(position) position:vec4f,@location(0) world:vec3f,@location(1) uv:vec2f,@location(2) alpha:f32,@location(3) @interpolate(flat) cutoff:f32};
@vertex fn vs_main(v:Input)->Fragment{
 var f:Fragment;var clip=camera.matrix*vec4f(v.position,1.);clip.z=(clip.z+clip.w)*.5;
 f.position=clip;f.world=v.position;f.uv=v.uv;f.alpha=v.color.a;f.cutoff=v.cutoff;return f;
}
@fragment fn fs_main(f:Fragment)->@builtin(frag_depth) f32{
 let alpha=textureSample(colorTexture,colorSampler,f.uv).a*f.alpha;
 if(alpha<f.cutoff){discard;}
 if(camera.params.x>0.){return f.position.z;}
 return clamp(length(f.world-camera.light.xyz)/camera.light.w,0.,1.);
}`;
export const spatialShadowModelWGSL =
  spatialShadowCameraWGSL +
  `
${spatialModelMaterialWGSL}
@group(1) @binding(0) var<uniform> material:Material;
@group(1) @binding(1) var colorSampler:sampler;
@group(1) @binding(2) var colorTexture:texture_2d<f32>;
struct Input{@location(0) position:vec3f,@location(1) uv:vec2f,@location(3) m0:vec4f,@location(4) m1:vec4f,@location(5) m2:vec4f,@location(6) m3:vec4f};
struct Fragment{@builtin(position) position:vec4f,@location(0) world:vec3f,@location(1) uv:vec2f};
@vertex fn vs_main(v:Input)->Fragment{
 let world=mat4x4f(v.m0,v.m1,v.m2,v.m3)*vec4f(v.position,1.);var clip=camera.matrix*world;clip.z=(clip.z+clip.w)*.5;
 var f:Fragment;f.position=clip;f.world=world.xyz;f.uv=v.uv;return f;
}
@fragment fn fs_main(f:Fragment)->@builtin(frag_depth) f32{
 if(textureSample(colorTexture,colorSampler,modelUv(f.uv,material.baseUv)).a*material.color.a<material.params.x){discard;}
 if(camera.params.x>0.){return f.position.z;}
 return clamp(length(f.world-camera.light.xyz)/camera.light.w,0.,1.);
}`;
interface Target {
  texture: GPUTexture;
  view: GPUTextureView;
  faces: GPUTextureView[];
  resolution: number;
  rendered: boolean;
}
/** Shadow attachments only; native matrices, face ranges and caster visibility stay authoritative. */
export class WebGpuSpatialShadows {
  private readonly dummyPoint: GPUTexture;
  private readonly dummySun: GPUTexture;
  private readonly defaultPoint: GPUTextureView;
  private readonly defaultSun: GPUTextureView;
  private point?: Target;
  private sun?: Target;
  private failure?: Error;
  private destroyed = false;
  constructor(private readonly device: GPUDevice) {
    this.dummyPoint = webGpuResources(device).createTexture({
      label: "Spatial inactive point shadow",
      size: [1, 1, 6],
      format: "depth32float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.dummySun = webGpuResources(device).createTexture({
      label: "Spatial inactive sun shadow",
      size: [1, 1, 1],
      format: "depth32float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.defaultPoint = this.dummyPoint.createView({ dimension: "2d-array" });
    this.defaultSun = this.dummySun.createView();
  }
  validate(frame: SpatialRenderBufferView): void {
    this.assertAlive();
    const v = frame.environment?.values;
    for (const r of [v && v[2] >= 0 ? v[3] : 0, v?.[92] ?? 0])
      if (r > this.device.limits.maxTextureDimension2D)
        throw Error("Spatial shadow target exceeds device texture limit");
  }
  ready(frame: SpatialRenderBufferView): boolean {
    const v = frame.environment?.values;
    return (
      (!v || v[2] < 0 || (this.point?.resolution === v[3] && this.point.rendered)) &&
      (!v || !(v[92] > 0) || (this.sun?.resolution === v[92] && this.sun.rendered))
    );
  }
  prepare(frame: SpatialRenderBufferView): void {
    this.validate(frame);
    const v = frame.environment?.values;
    this.replace("point", v && v[2] >= 0 ? v[3] : 0, 6);
    this.replace("sun", v?.[92] ?? 0, 1);
  }
  views(): {
    point: GPUTextureView;
    sun: GPUTextureView;
  } {
    return { point: this.point?.view ?? this.defaultPoint, sun: this.sun?.view ?? this.defaultSun };
  }
  private replace(key: "point" | "sun", resolution: number, layers: number): void {
    const old = this[key];
    if (!resolution) {
      webGpuResources(this.device).destroy(old?.texture);
      this[key] = undefined;
      return;
    }
    if (old?.resolution === resolution) return;
    let texture: GPUTexture | undefined, replacement: Target | undefined;
    this.device.pushErrorScope("validation");
    this.device.pushErrorScope("out-of-memory");
    try {
      texture = webGpuResources(this.device).createTexture({
        label: `Spatial ${key} shadow`,
        size: [resolution, resolution, layers],
        format: "depth32float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      replacement = {
        texture,
        resolution,
        rendered: false,
        view: texture.createView({ dimension: layers === 6 ? "2d-array" : "2d" }),
        faces: Array.from({ length: layers }, (_, i) =>
          texture!.createView({ dimension: "2d", baseArrayLayer: i, arrayLayerCount: 1 }),
        ),
      };
      webGpuResources(this.device).destroy(old?.texture);
      this[key] = replacement;
    } catch (error) {
      webGpuResources(this.device).destroy(texture);
      throw error;
    } finally {
      const allocation = this.device.popErrorScope(),
        validation = this.device.popErrorScope();
      void Promise.all([allocation, validation]).then(
        (errors) => {
          const error = errors.find(Boolean);
          if (error && replacement && this[key] === replacement && !this.destroyed) {
            webGpuResources(this.device).destroy(replacement.texture);
            this[key] = undefined;
            this.failure = Error(`Spatial shadow GPU allocation failed: ${error.message}`);
          }
        },
        (error) => {
          if (replacement && this[key] === replacement && !this.destroyed) {
            webGpuResources(this.device).destroy(replacement.texture);
            this[key] = undefined;
            this.failure = Error(`Spatial shadow GPU validation failed: ${String(error)}`);
          }
        },
      );
    }
  }
  draw(
    encoder: GPUCommandEncoder,
    submit: (pass: GPURenderPassEncoder, face: number) => void,
  ): number {
    this.assertAlive();
    let count = 0;
    if (this.point) this.point.rendered = false;
    if (this.sun) this.sun.rendered = false;
    for (const [target, base] of [
      [this.point, 0],
      [this.sun, 6],
    ] as const)
      if (target)
        for (let i = 0; i < target.faces.length; i++) {
          const pass = beginWebGpuRenderPass(this.device, encoder, {
            label: `Spatial shadow face ${base + i}`,
            colorAttachments: [],
            depthStencilAttachment: {
              view: target.faces[i],
              depthLoadOp: "clear",
              depthStoreOp: "store",
              depthClearValue: 1,
            },
          });
          submit(pass, base + i);
          pass.end();
          count++;
        }
    return count;
  }
  commitSubmission(): void {
    if (this.point) this.point.rendered = true;
    if (this.sun) this.sun.rendered = true;
  }
  textureBytes(): number {
    return (
      (this.point ? this.point.resolution ** 2 * 24 : 0) +
      (this.sun ? this.sun.resolution ** 2 * 4 : 0)
    );
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    webGpuResources(this.device).destroy(this.point?.texture);
    webGpuResources(this.device).destroy(this.sun?.texture);
    this.point = undefined;
    this.sun = undefined;
    webGpuResources(this.device).destroy(this.dummyPoint);
    webGpuResources(this.device).destroy(this.dummySun);
  }
  private assertAlive(): void {
    if (this.destroyed) throw Error("Spatial shadows destroyed");
    if (this.failure) throw this.failure;
  }
}
