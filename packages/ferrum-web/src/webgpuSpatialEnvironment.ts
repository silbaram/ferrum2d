import { WebGpuSpatialLightShafts } from "./webgpuSpatialLightShafts.js";
import { spatialLightShaftPlan, writeSpatialLightShaftStats, type SpatialLightShaftPlan } from "./spatialLightShaftKernel.js";
import { HEIGHT_FOG_WGSL } from "./spatialHeightFogShaders.js";
import { spatialSunPcssScale } from "./spatialSunPcss.js";
import { secondSpatialShadowSlot } from "./spatialPointShadows.js";
import type { SpatialRendererStats } from "./renderer.js";
import { WebGpuSpatialBloom } from "./webgpuSpatialBloom.js";
import { spatialBloomPlan, writeSpatialBloomStats, type SpatialBloomPlan } from "./spatialBloomKernel.js";
import { beginWebGpuRenderPass } from "./webgpuGpuTimer.js";
import { webGpuResources } from "./webgpuResources.js";
import type { SpatialRenderBufferView } from "./dataSceneSpatial.js";
import { spatialDofPass, spatialIndirectPass, spatialResolvePass, spatialSeparated } from "./spatialComposition.js";
import { WebGpuSpatialShadows, spatialShadowSamplingWGSL } from "./webgpuSpatialShadows.js";
import { WebGpuSpatialReceivers } from "./webgpuSpatialReceivers.js";
import { SPATIAL_SPECULAR_WGSL } from "./spatialSpecular.js";
// Native environment's shared v1..v4 prefix padded to 512 floats, followed by eye/forward/view/size.
// v5's fixed sun center is consumed by Rust in its shadow matrices, not by the GPU uniform layout.
// v7 channels follow the private camera/matrices; dynamic receiver rows have a separate binding.
const UNIFORM_BYTES = 2720,
  UNIFORM_STRIDE = 2816;
export const spatialEnvironmentWGSL = `
struct Environment {
 values: array<vec4f,128>, eye:vec4f, forward:vec4f, view:vec4f, size:vec4f, shadow:array<mat4x4f,7>, channels:array<vec4f,2>, wideBloom:vec4f, pointShadow2:vec4f, sunPcss:vec4f, pointPcss:vec4f, pointPcss2:vec4f, heightFog:vec4f, fogCamera:vec4f, shafts:vec4f,
};
@group(2) @binding(0) var<uniform> env:Environment;
${HEIGHT_FOG_WGSL}
@group(2) @binding(3) var<uniform> receiver:vec4u;
fn channel(i:u32)->u32{return u32(env.channels[i/4u][i%4u]);}
fn receiverMasks()->vec2u{if(env.channels[1].y>.5){return receiver.xy;}return vec2u(255u);}
fn receivesLight(channels:u32)->bool{return (receiverMasks().x&(channels&255u))!=0u;}
fn receivesShadow(channels:u32)->bool{return (receiverMasks().y&((channels>>8u)&255u))!=0u;}
fn e(i:u32)->f32{return env.values[i/4u][i%4u];}
// Private GPU camera layout v2: forward.w packs AO-resolve/profile/DOF-prepass bits.
// This remains separate from the native environment prefix and the appended channel tail.
fn compositionFlags()->u32{return u32(env.forward.w);}
fn environmentEnabled()->bool{return e(0u)>0.;}
fn linearize(c:vec3f)->vec3f{return select(c/12.92,pow((c+.055)/1.055,vec3f(2.4)),c>=vec3f(.04045));}
fn encode(c:vec3f)->vec3f{return select(c*12.92,1.055*pow(max(c,vec3f(0.)),vec3f(1./2.4))-.055,c>=vec3f(.0031308));}
${spatialShadowSamplingWGSL}
${SPATIAL_SPECULAR_WGSL}
struct SpatialLightingOutput { @location(0) color:vec4f, @location(1) indirect:vec4f };
fn indirectColor(albedo:vec3f,n:vec3f,unlit:bool)->vec3f{
 if((u32(e(0u))&1u)==0u || unlit){return vec3f(0.);}
 var illumination=vec3f(e(5u),e(6u),e(7u));
 if(e(112u)>0. && e(119u)>0.){
  let weight=clamp(dot(n,normalize(vec3f(e(113u),e(114u),e(115u))))*.5+.5,0.,1.);
  illumination+=mix(vec3f(e(120u),e(121u),e(122u)),vec3f(e(116u),e(117u),e(118u)),weight)*e(119u);
 }
 return albedo*illumination;
}
fn lightingOutput(color:vec3f,indirect:vec3f)->SpatialLightingOutput{
 var output:SpatialLightingOutput;output.color=vec4f(color,1.);output.indirect=vec4f(indirect,1.);return output;
}
fn shadeSurface(albedo:vec3f,emission:vec3f,world:vec3f,n:vec3f,geometric:vec3f,unlit:bool,f0:vec3f,roughness:f32,specularWeight:f32)->vec3f{
 var color=albedo;
 if((u32(e(0u))&1u)!=0u && !unlit){
  var reflection=vec3f(0.);var view=vec3f(0.);
  if(specularWeight>0.){let eyeDelta=env.eye.xyz-world;if(length(eyeDelta)>.000001){view=normalize(eyeDelta);}}
  var illumination=vec3f(e(5u),e(6u),e(7u));
  if(e(112u)>0. && e(119u)>0.){
   let weight=clamp(dot(n,normalize(vec3f(e(113u),e(114u),e(115u))))*.5+.5,0.,1.);
   illumination+=mix(vec3f(e(120u),e(121u),e(122u)),vec3f(e(116u),e(117u),e(118u)),weight)*e(119u);
  }
  for(var i=0u;i<4u;i++){
   if(i>=u32(e(1u))){break;}
   let channels=channel(i+1u);if(!receivesLight(channels)){continue;}
   let p=12u+i*12u;let delta=vec3f(e(p),e(p+1u),e(p+2u))-world;
   let d=length(delta);let radius=e(p+3u);var lambert=1.;
   if(d>.000001){lambert=max(dot(n,delta/d),0.);}
   var falloff=max(1.-d*d/(radius*radius),0.);
   let cone=144u+i*8u;
   var coneWeight=1.;
   if(e(cone+5u)>0. && d>.000001){let angle=dot(-delta/d,vec3f(e(cone),e(cone+1u),e(cone+2u)));coneWeight=step(e(cone+3u),angle);if(e(cone+4u)>e(cone+3u)+.000001){coneWeight=smoothstep(e(cone+3u),e(cone+4u),angle);}}
   var visibility=1.;if(env.size.w>0. && receivesShadow(channels) && (f32(i)==e(2u) || f32(i)==env.pointShadow2.x)){
    let second=f32(i)==env.pointShadow2.x;let receiverDelta=delta-geometric*select(e(123u),env.pointShadow2.z,second);
    visibility=pointVisibility(second,select(e(4u),env.pointShadow2.y,second),receiverDelta,length(receiverDelta),radius,geometric);
   }
   illumination+=vec3f(e(p+4u),e(p+5u),e(p+6u))*e(p+7u)*falloff*falloff*lambert*visibility*coneWeight;
   if(specularWeight>0. && d>.000001){reflection+=vec3f(e(p+4u),e(p+5u),e(p+6u))*e(p+7u)*falloff*falloff*visibility*coneWeight*directSpecular(n,delta/d,view,f0,roughness);}
  }
  if(e(83u)>0. && receivesLight(channel(0u))){let direction=normalize(vec3f(e(84u),e(85u),e(86u)));var visibility=1.;if(env.size.w>0. && receivesShadow(channel(0u)) && e(92u)>0.){visibility=sunVisibility(world,geometric,direction);}
   illumination+=vec3f(e(88u),e(89u),e(90u))*e(87u)*max(dot(n,direction),0.)*visibility;
   if(specularWeight>0.){reflection+=vec3f(e(88u),e(89u),e(90u))*e(87u)*visibility*directSpecular(n,direction,view,f0,roughness);}}
  color=color*illumination+reflection*specularWeight;
 }
 color+=emission;
 if((u32(e(0u))&2u)!=0u && (compositionFlags()&1u)==0u){
  let z=max(dot(world-env.eye.xyz,env.forward.xyz),0.);
  var amount=clamp((z-e(71u))/(e(72u)-e(71u)),0.,1.);
  if(env.heightFog.x>0.){let receiver=world.y-env.heightFog.y;var origin=receiver-env.forward.y*z;var rayLength=z;
   if(env.view.z>0.){origin=env.eye.y-env.heightFog.y;rayLength=length(world-env.eye.xyz);}
   amount=heightFogAmount(z,rayLength,origin,receiver,env.heightFog,vec2f(e(71u),e(72u)));}
  color=mix(color,vec3f(e(73u),e(74u),e(75u)),amount);
 }
 return color;
}
fn shade(albedo:vec3f,emission:vec3f,world:vec3f,n:vec3f,geometric:vec3f,unlit:bool)->vec3f{
 return shadeSurface(albedo,emission,world,n,geometric,unlit,vec3f(0.),1.,0.);
}`;
function composite(linearWorking: boolean): string { return spatialEnvironmentWGSL.split("@group(2)").join("@group(0)") +
  `
@group(1) @binding(0) var sceneColor:texture_2d<f32>;
@group(1) @binding(1) var sceneDepth:texture_depth_2d;
@group(1) @binding(2) var sceneIndirect:texture_2d<f32>;
@group(1) @binding(3) var sceneBloom:texture_2d<f32>;
@group(1) @binding(4) var sceneShafts:texture_2d<f32>;
fn shaftsAt(uv:vec2f)->vec3f{
 let size=vec2i(textureDimensions(sceneShafts));let p=uv*vec2f(size)-vec2f(.5);let a=vec2i(floor(p));let hi=size-vec2i(1);let w=fract(p);
 return mix(mix(textureLoad(sceneShafts,clamp(a,vec2i(0),hi),0).rgb,textureLoad(sceneShafts,clamp(a+vec2i(1,0),vec2i(0),hi),0).rgb,w.x),mix(textureLoad(sceneShafts,clamp(a+vec2i(0,1),vec2i(0),hi),0).rgb,textureLoad(sceneShafts,clamp(a+vec2i(1,1),vec2i(0),hi),0).rgb,w.x),w.y);
}
fn wideBloom(uv:vec2f)->vec3f{
 let p=uv*env.wideBloom.yz-vec2f(.5);let a=vec2i(floor(p));let hi=vec2i(textureDimensions(sceneBloom))-vec2i(1);let w=fract(p);
 return mix(mix(textureLoad(sceneBloom,clamp(a,vec2i(0),hi),0).rgb,textureLoad(sceneBloom,clamp(a+vec2i(1,0),vec2i(0),hi),0).rgb,w.x),mix(textureLoad(sceneBloom,clamp(a+vec2i(0,1),vec2i(0),hi),0).rgb,textureLoad(sceneBloom,clamp(a+vec2i(1,1),vec2i(0),hi),0).rgb,w.x),w.y);
}
struct F { @builtin(position) p:vec4f,@location(0) uv:vec2f };
@vertex fn vs_main(@builtin(vertex_index) i:u32)->F{
 let uv=vec2f(f32((i<<1u)&2u),f32(i&2u));var f:F;
 f.p=vec4f(uv*2.-1.,0.,1.);f.uv=vec2f(uv.x,1.-uv.y);return f;
}
fn pixel(uv:vec2f)->vec2i{return vec2i(clamp(uv*env.size.xy,vec2f(0.),env.size.xy-1.));}
fn depthAt(uv:vec2f)->f32{return textureLoad(sceneDepth,pixel(uv),0);}
fn colorAt(uv:vec2f)->vec4f{return textureLoad(sceneColor,pixel(uv),0);}
fn viewDepth(d:f32)->f32{
 let n=env.view.x;let f=env.view.y;
 if(env.view.z>0.){return 2.*n*f/(f+n-(d*2.-1.)*(f-n));}return mix(n,f,d);
}
fn aces(c:vec3f)->vec3f{return clamp(c*(2.51*c+.03)/(c*(2.43*c+.59)+.14),vec3f(0.),vec3f(1.));}
fn viewPosition(uv:vec2f,z:f32)->vec3f{var h=env.eye.w*.5;if(env.view.z>0.){h=tan(env.eye.w*.5)*z;}return vec3f(vec2f(uv.x*2.-1.,1.-uv.y*2.)*vec2f(env.size.x/env.size.y,1.)*h,-z);}
fn compose(f:F,stage:u32)->vec4f{
 let center=colorAt(f.uv);var shaft=vec3f(0.);if(stage==1u && env.shafts.x>0. && center.a>0.){shaft=shaftsAt((vec2f(pixel(f.uv))+vec2f(.5))/env.size.xy);}
 if(center.a<=0. && (stage>0u || e(128u)<=0. || e(129u)<=0.)){discard;}
 let z=viewDepth(depthAt(f.uv));var color=center.rgb;let flags=u32(e(0u));
 let focus=env.view.w;let focusRange=e(61u);let aperture=e(62u);let maxRadius=e(63u)*env.size.y/env.size.z;
 if(stage!=1u && (flags&4u)!=0u && ((compositionFlags()&4u)==0u || stage==2u) && e(96u)==1.){
  let centerDelta=z-focus;let centerRadius=sign(centerDelta)*clamp(max(abs(centerDelta)-focusRange,0.)/max(z,.001)*aperture,0.,1.)*maxRadius;
  var farSum=color;var nearSum=vec3f(0.);var farWeight=1.;var nearWeight=0.;var kernelWeight=0.;
  for(var i=0u;i<24u;i++){
   let angle=f32(i)*2.39996323;let r=sqrt((f32(i)+.5)/24.)*maxRadius;
   let uv=clamp(f.uv+vec2f(cos(angle),-sin(angle))*r/env.size.xy,vec2f(.5)/env.size.xy,vec2f(1.)-vec2f(.5)/env.size.xy);
   let kernel=1.-r/max(maxRadius,.001);kernelWeight+=kernel;let d=depthAt(uv);if(d>=1.){continue;}
   let nz=viewDepth(d);let delta=nz-focus;let sampleRadius=sign(delta)*clamp(max(abs(delta)-focusRange,0.)/max(nz,.001)*aperture,0.,1.)*maxRadius;
   let sampleColor=colorAt(uv).rgb;
   if(centerRadius>r && sampleRadius>=0. && abs(nz-z)<=max(focusRange,z*.02)){farSum+=sampleColor*kernel;farWeight+=kernel;}
   if(sampleRadius< -r){let weight=kernel*smoothstep(0.,1.,-sampleRadius-r);nearSum+=sampleColor*weight;nearWeight+=weight;}
  }
  color=farSum/farWeight;
  if(nearWeight>.00001){var coverage=clamp(nearWeight/max(kernelWeight,.00001),0.,1.);if(centerRadius< -.05){coverage=1.;}color=mix(color,nearSum/nearWeight,coverage);}
 }else if(stage!=1u && (flags&4u)!=0u && ((compositionFlags()&4u)==0u || stage==2u)){
  let coc=clamp(max(abs(z-focus)-focusRange,0.)/max(z,.001)*aperture,0.,1.);let radius=coc*maxRadius;
  if(radius>.05){var sum=color*2.;var weight=2.;
   for(var i=0u;i<12u;i++){
    let angle=f32(i)*2.39996323;let r=sqrt((f32(i)+.5)/12.)*radius;
    let uv=clamp(f.uv+vec2f(cos(angle),-sin(angle))*r/env.size.xy,vec2f(.5)/env.size.xy,vec2f(1.)-vec2f(.5)/env.size.xy);
    let d=depthAt(uv);if(d>=1.){continue;}let nz=viewDepth(d);if(abs(nz-z)>max(focusRange,z*.02)){continue;}
    sum+=colorAt(uv).rgb;weight+=1.;
   }color=sum/weight;
  }
 }
 let position=viewPosition(f.uv,z);
 if((stage==1u || (compositionFlags()&2u)==0u) && e(132u)>0. && e(133u)>0. && depthAt(f.uv)<1.){
  let dx=vec2f(2./env.size.x,0.);let dy=vec2f(0.,-2./env.size.y);
  let zl=viewDepth(depthAt(f.uv-dx));let zr=viewDepth(depthAt(f.uv+dx));let zd=viewDepth(depthAt(f.uv-dy));let zu=viewDepth(depthAt(f.uv+dy));
  let tangent=select(viewPosition(f.uv+dx,zr)-position,position-viewPosition(f.uv-dx,zl),abs(zl-z)<abs(zr-z));
  let bitangent=select(viewPosition(f.uv+dy,zu)-position,position-viewPosition(f.uv-dy,zd),abs(zd-z)<abs(zu-z));
  var normal=cross(tangent,bitangent);if(length(normal)>.00001){normal=normalize(normal);}else{normal=vec3f(0.,0.,1.);}
  var h=env.eye.w*.5;if(env.view.z>0.){h=tan(env.eye.w*.5)*z;}
  let radius=min(64.,e(134u)*env.size.y/(2.*max(h,.001)));var occlusion=0.;
  for(var i=0u;i<12u;i++){
   let angle=f32(i)*2.39996323;let r=sqrt((f32(i)+.5)/12.)*radius;
   let uv=f.uv+vec2f(cos(angle),-sin(angle))*r/env.size.xy;
   if(any(uv<vec2f(0.)) || any(uv>vec2f(1.))){continue;}
   let d=depthAt(uv);if(d>=1.){continue;}
   let delta=viewPosition(uv,viewDepth(d))-position;let distance=length(delta);
   if(distance>.0001){occlusion+=max((dot(normal,delta)-e(135u))/distance,0.)*max(1.-distance/e(134u),0.);}
  }
  let visibility=1.-clamp(occlusion/12.*e(133u)*3.,0.,.9);
  if(stage==1u){color-=textureLoad(sceneIndirect,pixel(f.uv),0).rgb*(1.-visibility);}else{color*=visibility;}
 }
 if(stage==1u && (flags&2u)!=0u && center.a>0.){
  var amount=clamp((z-e(71u))/(e(72u)-e(71u)),0.,1.);
  if(env.heightFog.x>0.){let eyeOffset=env.fogCamera.x-env.heightFog.y;var origin=eyeOffset+env.fogCamera.y*position.y;var rayLength=z;
   if(env.view.z>0.){origin=eyeOffset;rayLength=length(position);}
   let receiver=eyeOffset+env.fogCamera.y*position.y+env.fogCamera.z*z;
   amount=heightFogAmount(z,rayLength,origin,receiver,env.heightFog,vec2f(e(71u),e(72u)));}
  color=mix(color,vec3f(e(73u),e(74u),e(75u)),amount);
 }
 color+=shaft;
 if(stage>0u){return vec4f(max(color,vec3f(0.)),center.a);}
 if(e(128u)>0. && e(129u)>0.){
  var glow=vec3f(0.);var weight=0.;
  if(env.wideBloom.x>0.){glow=wideBloom(select(f.uv,(vec2f(pixel(f.uv))+vec2f(.5))/env.size.xy,(flags&16u)!=0u))*e(129u);}else{
  for(var i=0u;i<32u;i++){
   let angle=f32(i)*2.39996323;let r=sqrt((f32(i)+.5)/32.);let w=exp(-r*r*4.);
   let uv=f.uv+vec2f(cos(angle),-sin(angle))*r*e(130u)*env.size.y/env.size.z/env.size.xy;
   weight+=w;if(any(uv<vec2f(0.)) || any(uv>vec2f(1.))){continue;}
   let sampleColor=colorAt(uv).rgb;let peak=max(sampleColor.r,max(sampleColor.g,sampleColor.b));
   glow+=sampleColor*(max(peak-e(131u),0.)/max(peak,.00001))*w;
  }
  glow*=e(129u)/max(weight,.00001);
  }
  if(center.a<=0. && max(glow.r,max(glow.g,glow.b))<.00001){discard;}
  color+=glow;
 }
 if((flags&8u)!=0u){
  color*=exp2(e(64u));if(e(67u)>1.5){color=aces(color);}else if(e(67u)>.5){color=color/(vec3f(1.)+color);}
  let l=dot(color,vec3f(.2126,.7152,.0722));color=mix(vec3f(l),color,e(66u));
  color=max((color-vec3f(.18))*e(65u)+vec3f(.18),vec3f(0.))*vec3f(e(68u),e(69u),e(70u));
 }
 return vec4f(${linearWorking ? "color" : "encode(color)"},1.);
}
@fragment fn fs_main(f:F)->@location(0)vec4f{return compose(f,0u);}
@fragment fn fs_resolve(f:F)->@location(0)vec4f{return compose(f,1u);}
@fragment fn fs_dof(f:F)->@location(0)vec4f{return compose(f,2u);}
`;
}
/** HDR platform targets and native environment uniforms. No game/scene state is owned here. */
export class WebGpuSpatialEnvironment {
  readonly layout: GPUBindGroupLayout;
  readonly shadows: WebGpuSpatialShadows;
  readonly receivers: WebGpuSpatialReceivers;
  private groups: GPUBindGroup[] = [];
  private pointView?: GPUTextureView;
  private pointView2?: GPUTextureView;
  private sunView?: GPUTextureView;
  private receiverBuffer?: GPUBuffer;
  get group(): GPUBindGroup {
    return this.groups[0];
  }
  receiverGroup(receive: boolean): GPUBindGroup {
    return this.groups[receive ? 0 : 1];
  }
  private readonly uniform: GPUBuffer;
  private readonly values = new Float32Array((UNIFORM_STRIDE / 4) * 2);
  private readonly pipeline: GPURenderPipeline;
  private readonly intermediatePipeline: (entry: "fs_resolve" | "fs_dof") => GPURenderPipeline;
  private resolvePipeline?: GPURenderPipeline;
  private dofPipeline?: GPURenderPipeline;
  private readonly imagesLayout: GPUBindGroupLayout;
  private shaftPass?: WebGpuSpatialLightShafts;
  private shaftPlan?: SpatialLightShaftPlan;
  private boundShaftView?: GPUTextureView;
  private bloomPass?: WebGpuSpatialBloom;
  private bloomPlan?: SpatialBloomPlan;
  private boundBloomView?: GPUTextureView;
  private color?: GPUTexture;
  private depth?: GPUTexture;
  private colorView?: GPUTextureView;
  private depthView?: GPUTextureView;
  private images?: GPUBindGroup;
  private indirect?: GPUTexture;
  private indirectView?: GPUTextureView;
  private resolved?: GPUTexture;
  private dof?: GPUTexture;
  private resolvedView?: GPUTextureView;
  private dofView?: GPUTextureView;
  private resolvedImages?: GPUBindGroup;
  private dofImages?: GPUBindGroup;
  private width = 0;
  private height = 0;
  private destroyed = false;
  private targetFailure?: Error;
  constructor(
    private readonly device: GPUDevice,
    format: GPUTextureFormat,
    linearWorking = false,
  ) {
    this.shadows = new WebGpuSpatialShadows(device);
    this.receivers = new WebGpuSpatialReceivers(device);
    this.layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "depth", viewDimension: "2d-array" },
        },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "depth" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: 16 } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "depth", viewDimension: "2d-array" } },
      ],
    });
    this.uniform = webGpuResources(device).createBuffer({
      label: "Spatial environment",
      size: UNIFORM_STRIDE * 2,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.refreshGroups();
    this.imagesLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "unfilterable-float" },
        },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "depth" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float" } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float" } },
      ],
    });
    const module = device.createShaderModule({
      label: "Spatial HDR/depth composite",
      code: composite(linearWorking),
    });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [this.layout, this.imagesLayout] });
    this.intermediatePipeline = entry => webGpuResources(device).createRenderPipeline({
      label: `Spatial composition ${entry}`, layout,
      vertex: { module, entryPoint: "vs_main" },
      fragment: { module, entryPoint: entry, targets: [{ format: "rgba16float" }] },
      primitive: { topology: "triangle-list" },
    });
    this.pipeline = webGpuResources(device).createRenderPipeline({
      layout,
      vertex: { module, entryPoint: "vs_main" },
      fragment: { module, entryPoint: "fs_main", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    });
  }
  validate(frame: SpatialRenderBufferView, width: number, height: number): [number, number] {
    if (this.destroyed) throw Error("Spatial environment destroyed");
    if (this.targetFailure) throw this.targetFailure;
    const v = frame.environment?.values;
    this.shadows.validate(frame);
    const p = frame.presentation;
    if (p) {
      if (p[4] !== 0 || p[5] !== 0) {
        if (
          !v ||
          !(v[0] & 16) ||
          ![p[4], p[5]].every((x) => Number.isInteger(x) && x > 0 && x <= 2048) ||
          p[4] * p[5] > 1048576 ||
          p[4] !== v[80] ||
          p[5] !== v[81]
        )
          throw Error("Invalid spatial pixelArt dimensions");
      }
    }
    if (v && v[0]) {
      const c = frame.camera;
      if (
        !(
          c[24] > 0 &&
          c[25] > c[24] &&
          c[27] > 0 &&
          Math.hypot(c[20] - c[17], c[21] - c[18], c[22] - c[19]) > 0
        )
      )
        throw Error("Invalid spatial environment camera");
    }
    const w = p && p[4] > 0 ? p[4] : width,
      h = p && p[5] > 0 ? p[5] : height;
    for (const [x, y] of [
      [width, height],
      [w, h],
    ])
      if (
        ![x, y].every(
          (n) => Number.isInteger(n) && n > 0 && n <= this.device.limits.maxTextureDimension2D,
        ) ||
        x * y > 8388608
      )
        throw Error("WebGPU spatial depth target exceeds the device or 8M pixel budget");
    return [w, h];
  }
  prepare(frame: SpatialRenderBufferView, width: number, height: number): void {
    if (this.destroyed) throw Error("Spatial environment destroyed");
    if (this.targetFailure) throw this.targetFailure;
    this.receivers.prepare(frame);
    this.shadows.prepare(frame);
    this.refreshGroups();
    this.values.fill(0);
    if (frame.environment) this.values.set(frame.environment.values.subarray(0, 512));
    else this.values[2] = -1;
    const c = frame.camera;
    this.values.set(c.subarray(17, 20), 512);
    this.values[515]=c[23];
    const x = c[20] - c[17],
      y = c[21] - c[18],
      z = c[22] - c[19],
      length = Math.hypot(x, y, z) || 1;
    this.values.set(
      [
        x / length,
        y / length,
        z / length,
        0,
        c[24],
        c[25],
        c[16],
        this.values[97] === 1 && this.values[99] > 0 ? this.values[99] : this.values[60],
        width,
        height,
        c[27],
        1,
      ],
      516,
    );
    const env = frame.environment;
    if (env?.values[2]! >= 0) this.values.set(env!.shadowMatrices.subarray(0, 96), 528);
    if (env?.values[92]! > 0)
      this.values.set(env!.shadowMatrices.subarray(env!.shadowMatrices.length - 16), 624);
    const indirect = spatialIndirectPass(env?.values), resolve = spatialResolvePass(env?.values), dof = spatialDofPass(env?.values);
    // Private GPU camera layout v2; native reserved words are never reused.
    this.values[519] = Number(resolve) | (Number(spatialSeparated(env?.values)) << 1) | (Number(dof) << 2);
    for (let i = 0; i < 5; i++) this.values[640 + i] = env && env.values.length >= 576 ? env.values[544 + i] : 65535;
    this.values[645] = Number(this.receivers.enabled());
    this.bloomPlan = spatialBloomPlan(env?.values, width, height, c[27]);
    const bloomView = this.bloomPlan ? (this.bloomPass ??= new WebGpuSpatialBloom(this.device)).prepare(this.bloomPlan) : this.bloomPass?.prepare();
    this.values[648] = Number(!!bloomView);
    this.values[649] = this.bloomPlan?.sampleWidth ?? 1; this.values[650] = this.bloomPlan?.sampleHeight ?? 1;
    this.values.set([secondSpatialShadowSlot(env?.values), env?.values[586] ?? 0, env?.values[587] ?? 0, 0], 652);
    this.values.set([env?.values[592] ?? 0, spatialSunPcssScale(env?.values), env?.values[594] ?? 0, 0], 656);
    this.values.set([env?.values[600] ?? 0, env?.values[601] ?? 0, env?.values[602] ?? 0, 0,
      env?.values[604] ?? 0, env?.values[605] ?? 0, env?.values[606] ?? 0, 0], 660);
    this.values[668] = env?.values[608] ?? 0; this.values[669] = env?.values[609] ?? 0;
    this.values[670] = env?.values[610] ?? 0; this.values[671] = env?.values[611] ?? 0;
    this.values[672] = c[18]; this.values[673] = Math.hypot(x, z) / length;
    this.values[674] = y / length; this.values[675] = c[16];
    this.shaftPlan = spatialLightShaftPlan(env?.values, width, height);
    const shaftView = this.shaftPlan ? (this.shaftPass ??= new WebGpuSpatialLightShafts(this.device)).prepare(this.shaftPlan) : this.shaftPass?.prepare();
    this.values[676] = Number(!!shaftView);
    this.values.copyWithin(UNIFORM_STRIDE / 4, 0, UNIFORM_BYTES / 4);
    this.values[UNIFORM_STRIDE / 4 + 527] = 0;
    this.device.queue.writeBuffer(this.uniform, 0, this.values);
    if (!this.values[0]) {
      this.releaseTarget();
      return;
    }
    if (this.width === width && this.height === height && this.images && !!this.indirect === indirect && !!this.dof === dof && !!this.resolved === resolve && this.boundShaftView === shaftView && this.boundBloomView === bloomView) return;
    let color: GPUTexture | undefined, depth: GPUTexture | undefined;
    const scratch: GPUTexture[] = [];
    this.device.pushErrorScope("validation");
    this.device.pushErrorScope("out-of-memory");
    try {
      color = webGpuResources(this.device).createTexture({
        label: "Spatial HDR color",
        size: [width, height, 1],
        format: "rgba16float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      depth = webGpuResources(this.device).createTexture({
        label: "Spatial HDR depth",
        size: [width, height, 1],
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      const colorView = color.createView(),
        depthView = depth.createView();
      const createScratch = () => {
        const texture = webGpuResources(this.device).createTexture({
          label: "Spatial composition HDR", size: [width, height, 1], format: "rgba16float",
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        scratch.push(texture); return texture;
      };
      const indirectTexture = indirect ? createScratch() : undefined;
      const resolvedTexture = resolve ? createScratch() : undefined;
      const dofTexture = dof ? createScratch() : undefined;
      if (resolve) this.resolvePipeline ??= this.intermediatePipeline("fs_resolve");
      if (dof) this.dofPipeline ??= this.intermediatePipeline("fs_dof");
      const indirectView = indirectTexture?.createView() ?? colorView;
      const imagesFor = (resource: GPUTextureView) => this.device.createBindGroup({
        layout: this.imagesLayout,
        entries: [
          { binding: 0, resource },
          { binding: 1, resource: depthView },
          { binding: 2, resource: indirectView },
          { binding: 3, resource: bloomView ?? colorView },
          { binding: 4, resource: shaftView ?? colorView },
        ],
      });
      const images = imagesFor(colorView);
      const resolvedView = resolvedTexture?.createView(), dofView = dofTexture?.createView();
      const resolvedImages = resolvedView ? imagesFor(resolvedView) : undefined;
      const dofImages = dofView ? imagesFor(dofView) : undefined;
      this.releaseTarget();
      this.color = color;
      this.boundBloomView = bloomView; this.boundShaftView = shaftView;
      this.depth = depth;
      this.colorView = colorView;
      this.depthView = depthView;
      this.images = images;
      this.indirect = indirectTexture; this.resolved = resolvedTexture; this.dof = dofTexture;
      this.indirectView = indirectTexture ? indirectView : undefined;
      this.resolvedView = resolvedView; this.dofView = dofView;
      this.resolvedImages = resolvedImages; this.dofImages = dofImages;
      this.width = width;
      this.height = height;
    } catch (error) {
      webGpuResources(this.device).destroy(color);
      webGpuResources(this.device).destroy(depth);
      scratch.forEach(texture => webGpuResources(this.device).destroy(texture));
      throw error;
    } finally {
      // Frame rendering is synchronous. Never retain an asynchronously invalid target as a warm hit.
      // This is outside the cold model-activation rollback contract: surface the failure on the next API call.
      const allocation = this.device.popErrorScope(),
        validation = this.device.popErrorScope(),
        replacement = color;
      void Promise.all([allocation, validation]).then(
        (errors) => {
          const error = errors.find(Boolean);
          if (error && !this.destroyed && replacement === this.color) {
            this.releaseTarget();
            this.targetFailure = Error(`Spatial HDR GPU allocation failed: ${error.message}`);
          }
        },
        (error) => {
          if (!this.destroyed && replacement === this.color) {
            this.releaseTarget();
            this.targetFailure = Error(`Spatial HDR GPU validation failed: ${String(error)}`);
          }
        },
      );
    }
  }
  scene():
    | {
        color: GPUTextureView;
        depth: GPUTextureView;
        indirect?: GPUTextureView;
      }
    | undefined {
    return this.images ? { color: this.colorView!, depth: this.depthView!, indirect: this.indirectView } : undefined;
  }
  composite(
    frame: SpatialRenderBufferView,
    encoder: GPUCommandEncoder,
    target: GPUTextureView,
    width: number,
    height: number,
  ): number {
    if (this.destroyed) throw Error("Spatial environment destroyed");
    if (!this.images) throw Error("Spatial HDR target is not prepared");
    let images = this.images, passes = 1;
    let bloomSource = this.colorView!;
    if (this.shaftPlan) { this.shaftPass!.draw(encoder, frame, this.shaftPlan, this.depthView!, this.shadows.views().sun, this.width, this.height); passes++; }
    for (const [view, pipeline, output] of [
      [this.resolvedView, this.resolvePipeline, this.resolvedImages],
      [this.dofView, this.dofPipeline, this.dofImages],
    ] as const) {
      if (!view) continue;
      const intermediate = beginWebGpuRenderPass(this.device, encoder, {
        label: "Spatial composition intermediate", colorAttachments: [{ view, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } }],
      });
      try {
        intermediate.setPipeline(pipeline!); intermediate.setBindGroup(0, this.group, [0]);
        intermediate.setBindGroup(1, images); intermediate.draw(3);
      } finally { intermediate.end(); }
      images = output!; bloomSource = view; passes++;
    }
    if (this.bloomPlan) { this.bloomPass!.draw(encoder, bloomSource, this.bloomPlan, frame.environment!.values[131]); passes += this.bloomPlan.drawCalls; }
    const pass = beginWebGpuRenderPass(this.device, encoder, {
      label: "Spatial HDR composite",
      colorAttachments: [{ view: target, loadOp: "load", storeOp: "store" }],
    });
    const p = frame.presentation;
    if (p && p[4] > 0) {
      const x = Math.round(p[0] * width),
        y = Math.round(p[1] * height),
        w = Math.max(1, Math.round(p[2] * width)),
        h = Math.max(1, Math.round(p[3] * height));
      pass.setViewport(x, y, w, h, 0, 1);
      pass.setScissorRect(x, y, Math.min(w, width - x), Math.min(h, height - y));
    }
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.group, [0]);
    pass.setBindGroup(1, images);
    pass.draw(3);
    pass.end();
    return passes;
  }
  private refreshGroups(): void {
    const v = this.shadows.views(), receiverBuffer = this.receivers.binding(this.uniform);
    if (this.pointView === v.point && this.pointView2 === v.point2 && this.sunView === v.sun && this.receiverBuffer === receiverBuffer) return;
    // Initial groups participate in the renderer factory's pre-context validation scope.
    const capture = this.groups.length > 0;
    if (capture) {
      this.device.pushErrorScope("validation");
      this.device.pushErrorScope("out-of-memory");
    }
    let replacement: GPUBindGroup[] | undefined;
    try {
      replacement = [0, 1].map((i) =>
        this.device.createBindGroup({
          layout: this.layout,
          entries: [
            {
              binding: 0,
              resource: { buffer: this.uniform, offset: i * UNIFORM_STRIDE, size: UNIFORM_BYTES },
            },
            { binding: 1, resource: v.point },
            { binding: 2, resource: v.sun },
            { binding: 4, resource: v.point2 },
            { binding: 3, resource: { buffer: receiverBuffer, offset: 0, size: 16 } },
          ],
        }),
      );
      this.groups = replacement;
      this.pointView = v.point;
      this.pointView2 = v.point2;
      this.sunView = v.sun;
      this.receiverBuffer = receiverBuffer;
    } finally {
      if (capture) {
        const allocation = this.device.popErrorScope(),
          validation = this.device.popErrorScope();
        void Promise.all([allocation, validation]).then(
          (errors) => {
            const error = errors.find(Boolean);
            if (error && replacement === this.groups && !this.destroyed) {
              this.releaseTarget();
              this.targetFailure = Error(
                `Spatial environment binding GPU allocation failed: ${error.message}`,
              );
            }
          },
          (error) => {
            if (replacement === this.groups && !this.destroyed) {
              this.releaseTarget();
              this.targetFailure = Error(
                `Spatial environment binding GPU validation failed: ${String(error)}`,
              );
            }
          },
        );
      }
    }
  }
  textureBytes(): number {
    return (this.shaftPass?.textureBytes() ?? 0) + (this.bloomPlan?.textureBytes ?? 0) + this.width * this.height * (12 + 8 * (Number(!!this.indirect) + Number(!!this.resolved) + Number(!!this.dof)));
  }
  writeBloomStats(stats: SpatialRendererStats, values: Float32Array | undefined, outputWidth: number, outputHeight: number): void {
    writeSpatialBloomStats(stats, values, this.bloomPlan, outputWidth, outputHeight);
    writeSpatialLightShaftStats(stats, this.shaftPlan);
  }
  private releaseTarget(): void {
    webGpuResources(this.device).destroy(this.color);
    webGpuResources(this.device).destroy(this.depth);
    for (const texture of [this.indirect, this.resolved, this.dof]) webGpuResources(this.device).destroy(texture);
    this.indirect = undefined; this.resolved = undefined; this.dof = undefined;
    this.indirectView = undefined; this.resolvedView = undefined; this.dofView = undefined;
    this.resolvedImages = undefined; this.dofImages = undefined;
    this.color = undefined;
    this.depth = undefined;
    this.images = undefined;
    this.colorView = undefined;
    this.depthView = undefined;
    this.width = 0;
    this.height = 0;
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.releaseTarget();
    this.bloomPass?.destroy(); this.shaftPass?.destroy();
    webGpuResources(this.device).destroy(this.uniform);
    this.shadows.destroy();
    this.receivers.destroy();
    webGpuResources(this.device).releasePipeline(this.pipeline);
    if (this.resolvePipeline) webGpuResources(this.device).releasePipeline(this.resolvePipeline);
    if (this.dofPipeline) webGpuResources(this.device).releasePipeline(this.dofPipeline);
  }
}
