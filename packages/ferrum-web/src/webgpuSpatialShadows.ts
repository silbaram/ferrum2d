import { SUN_PCSS_WGSL } from "./spatialSunPcss.js";
import { secondSpatialShadowSlot } from "./spatialPointShadows.js";
import { beginWebGpuRenderPass } from "./webgpuGpuTimer.js";
import { webGpuResources } from "./webgpuResources.js";
import { spatialModelMaterialWGSL } from "./webgpuSpatialMaterial.js";
import type { SpatialRenderBufferView } from "./dataSceneSpatial.js";
export const spatialShadowSamplingWGSL = `
@group(2) @binding(1) var pointMap:texture_depth_2d_array;
@group(2) @binding(2) var sunMap:texture_depth_2d;
@group(2) @binding(4) var pointMap2:texture_depth_2d_array;
fn slopeBias(n:vec3f,direction:vec3f)->f32{
 let incidence=max(dot(n,direction),0.);
 return min(sqrt(max(1.-incidence*incidence,0.))/max(incidence,.2),2.);
}
fn pointCompare(second:bool,authoredBias:f32,direction:vec3f,plane:f32,d:f32,radius:f32,geometric:vec3f,fallbackBias:f32)->f32{
 let a=abs(direction);var face=0;var st=vec2f(0.);var major=0.;
 if(a.x>=a.y && a.x>=a.z){
  face=select(1,0,direction.x>=0.);major=a.x;st=vec2f(select(direction.z,-direction.z,direction.x>=0.),-direction.y);
 }else if(a.y>=a.z){
  face=select(3,2,direction.y>=0.);major=a.y;st=vec2f(direction.x,select(-direction.z,direction.z,direction.y>=0.));
 }else{
  face=select(5,4,direction.z>=0.);major=a.z;st=vec2f(select(-direction.x,direction.x,direction.z>=0.),-direction.y);
 }
 var size=textureDimensions(pointMap);if(second){size=textureDimensions(pointMap2);}
 let pixel=vec2i(clamp(floor((st/major*.5+.5)*vec2f(size)),vec2f(0.),vec2f(size)-1.));
 let uv=(vec2f(pixel)+.5)*2./vec2f(size)-1.;var ray=vec3f(0.);
 switch face{
  case 0:{ray=vec3f(1.,-uv.y,-uv.x);}
  case 1:{ray=vec3f(-1.,-uv.y,uv.x);}
  case 2:{ray=vec3f(uv.x,1.,uv.y);}
  case 3:{ray=vec3f(uv.x,-1.,-uv.y);}
  case 4:{ray=vec3f(uv.x,-uv.y,1.);}
  default:{ray=vec3f(-uv.x,-uv.y,-1.);}
 }
 ray=normalize(ray);
 var expected=d;var bias=fallbackBias;let denominator=dot(geometric,ray);
 if(abs(denominator)>.000001){
  let distance=plane/denominator;
  if(distance>0. && distance<radius){
   expected=distance;
   let slope=sqrt(max(1.-denominator*denominator,0.))/abs(denominator);
   bias=authoredBias+expected/f32(size.x)*.1767766953*slope;
  }
 }
 bias+=radius/16777216.+max(expected,d)*.000001;
 var depth=0.;if(second){depth=textureLoad(pointMap2,vec2i(pixel.x,i32(size.y)-1-pixel.y),face,0);}
 else{depth=textureLoad(pointMap,vec2i(pixel.x,i32(size.y)-1-pixel.y),face,0);}
 return select(1.,0.,depth*radius+bias<expected);
}
fn pointVisibility(second:bool,authoredBias:f32,delta:vec3f,d:f32,radius:f32,geometric:vec3f)->f32{
 if(d<=max(authoredBias,.000001)){return 1.;}
 var size=f32(textureDimensions(pointMap).x);if(second){size=f32(textureDimensions(pointMap2).x);}let filtered=e(95u)==1.;
 let bias=authoredBias+2.*d/size*slopeBias(geometric,delta/d)*select(1.,3.,filtered);
 let axis= -delta/d;let plane=dot(geometric,axis)*d;
 if(!filtered){return pointCompare(second,authoredBias,axis,plane,d,radius,geometric,bias);}
 var up=vec3f(0.,1.,0.);if(abs(axis.y)>.99){up=vec3f(0.,0.,1.);}
 let tangent=normalize(cross(axis,up));let bitangent=cross(axis,tangent);var visibility=0.;
 for(var y= -1;y<=1;y++){for(var x= -1;x<=1;x++){
  let direction=axis+(tangent*f32(x)+bitangent*f32(y))*2./size;
  visibility+=pointCompare(second,authoredBias,direction,plane,d,radius,geometric,bias);
 }}return visibility/9.;
}
fn sunCompare(pixel:vec2i,size:vec2u,q:vec3f,gradient:vec2f,bias:f32)->f32{
 let at=clamp(pixel,vec2i(0),vec2i(size)-1);
 let uv=(vec2f(at)+.5)/vec2f(size);let expected=q.z+dot(gradient,uv-q.xy);
 if(expected<0. || expected>1.){return 1.;}
 return select(1.,0.,textureLoad(sunMap,vec2i(at.x,i32(size.y)-1-at.y),0)+bias<expected);
}
${SUN_PCSS_WGSL}
fn sunVisibility(world:vec3f,geometric:vec3f,direction:vec3f)->f32{
 let clip=env.shadow[6]*vec4f(world+geometric*e(124u),1.);let q=clip.xyz/clip.w*.5+.5;
 if(any(q<vec3f(0.))||any(q>vec3f(1.))){return 1.;}
 let size=textureDimensions(sunMap);let filtered=e(95u)==1.;let extent=e(94u);let span=e(91u)*2.;
 let xyEdge=min(min(q.x,1.-q.x),min(q.y,1.-q.y))*2.*extent;
 let depthEdge=min(q.z,1.-q.z)*span;
 let weight=smoothstep(0.,8.*extent/f32(size.x),min(xyEdge,depthEdge));
 let incidence=dot(geometric,direction);var gradient=vec2f(0.);var bias=e(93u)/span+.000001;
 if(abs(incidence)>.000001){
  // Same receiver plane as GLSL, with no additional fragment derivatives.
  let m=env.shadow[6];let r=vec3f(m[0][0],m[1][0],m[2][0])*extent;
  let up=vec3f(m[0][1],m[1][1],m[2][1])*extent;
  gradient=vec2f(dot(geometric,r),dot(geometric,up))*(2.*extent/(span*incidence));
  bias+=(abs(gradient.x)+abs(gradient.y))/(8.*f32(size.x));
 }else{
  let footprint=select(select(1.,3.,filtered),select(1.,max(1.,env.sunPcss.z),env.sunPcss.y>0.),env.sunPcss.x>0.);
  bias+=2.*extent/f32(size.x)*slopeBias(geometric,direction)*footprint/span;
 }
 if(env.sunPcss.x>0.){return mix(1.,sunPcssVisibility(q,size,gradient,bias),weight);}
 // Choose canonical Y-up texels first; flip the integer row only for textureLoad.
 let pixel=vec2i(floor(q.xy*vec2f(size)));
 if(!filtered){return mix(1.,sunCompare(pixel,size,q,gradient,bias),weight);}
 var visibility=0.;
 for(var y= -1;y<=1;y++){for(var x= -1;x<=1;x++){
  visibility+=sunCompare(pixel+vec2i(x,y),size,q,gradient,bias);
 }}return mix(1.,visibility/9.,weight);
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
 let uv=f.position.xy*(2.*camera.params.y)-1.;
 return clamp(length(vec3f(uv,1.))/(f.position.w*camera.light.w),0.,1.);
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
 let uv=f.position.xy*(2.*camera.params.y)-1.;
 return clamp(length(vec3f(uv,1.))/(f.position.w*camera.light.w),0.,1.);
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
  private point2?: Target;
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
    for (const r of [v && v[2] >= 0 ? v[3] : 0, v?.[92] ?? 0, secondSpatialShadowSlot(v) >= 0 ? v![585] : 0])
      if (r > this.device.limits.maxTextureDimension2D)
        throw Error("Spatial shadow target exceeds device texture limit");
  }
  ready(frame: SpatialRenderBufferView): boolean {
    const v = frame.environment?.values, mask = this.readyMaps(frame);
    return (!v || v[2] < 0 || !!(mask & 1)) &&
      (secondSpatialShadowSlot(v) < 0 || !!(mask & 2)) && (!v || !(v[92] > 0) || !!(mask & 4));
  }
  readyMaps(frame: SpatialRenderBufferView): number {
    const v = frame.environment?.values;
    return Number(!!this.point?.rendered && this.point.resolution === v?.[3]) |
      (this.point2?.rendered && this.point2.resolution === v?.[585] ? 2 : 0) |
      (this.sun?.rendered && this.sun.resolution === v?.[92] ? 4 : 0);
  }
  prepare(frame: SpatialRenderBufferView): void {
    this.validate(frame);
    const v = frame.environment?.values;
    this.replace("point", v && v[2] >= 0 ? v[3] : 0, 6);
    this.replace("sun", v?.[92] ?? 0, 1);
    this.replace("point2", secondSpatialShadowSlot(v) >= 0 ? v![585] : 0, 6);
  }
  views(): {
    point: GPUTextureView;
    point2: GPUTextureView;
    sun: GPUTextureView;
  } {
    return { point: this.point?.view ?? this.defaultPoint, point2: this.point2?.view ?? this.defaultPoint, sun: this.sun?.view ?? this.defaultSun };
  }
  private replace(key: "point" | "point2" | "sun", resolution: number, layers: number): void {
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
    maps = 7,
  ): number {
    this.assertAlive();
    let count = 0;
    if (maps & 1 && this.point) this.point.rendered = false;
    if (maps & 2 && this.point2) this.point2.rendered = false;
    if (maps & 4 && this.sun) this.sun.rendered = false;
    for (const [target, base] of [
      [this.point, 0],
      [this.sun, 6],
      [this.point2, 7],
    ] as const)
      if (target && (maps & (base === 0 ? 1 : base === 7 ? 2 : 4)))
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
  commitSubmission(maps = 7): void {
    if (maps & 1 && this.point) this.point.rendered = true;
    if (maps & 2 && this.point2) this.point2.rendered = true;
    if (maps & 4 && this.sun) this.sun.rendered = true;
  }
  textureBytes(): number {
    return (
      (this.point ? this.point.resolution ** 2 * 24 : 0) + (this.point2 ? this.point2.resolution ** 2 * 24 : 0) +
      (this.sun ? this.sun.resolution ** 2 * 4 : 0)
    );
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    webGpuResources(this.device).destroy(this.point?.texture);
    webGpuResources(this.device).destroy(this.point2?.texture);
    webGpuResources(this.device).destroy(this.sun?.texture);
    this.point = undefined;
    this.point2 = undefined;
    this.sun = undefined;
    webGpuResources(this.device).destroy(this.dummyPoint);
    webGpuResources(this.device).destroy(this.dummySun);
  }
  private assertAlive(): void {
    if (this.destroyed) throw Error("Spatial shadows destroyed");
    if (this.failure) throw this.failure;
  }
}
