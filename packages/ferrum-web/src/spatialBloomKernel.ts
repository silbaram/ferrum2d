import type { SpatialRendererStats } from "./renderer.js";
import { spatialWideBloom } from "./spatialBloom.js";

export interface SpatialBloomPlan {
  width: number;
  height: number;
  scale: number;
  sampleWidth: number;
  sampleHeight: number;
  kernel: number;
  step: number;
  levels: readonly { width: number; height: number }[];
  textureBytes: number;
  prefilterFetchBudget: number;
  drawCalls: number;
}
/** GPU texture-load work bound, not a measured fragment count or GPU duration. */
export function spatialBloomPlan(v: Float32Array | undefined, width: number, height: number, cssHeight: number): SpatialBloomPlan | undefined {
  if (!spatialWideBloom(v)) return undefined;
  const baseScale = v![581], kernel = v![582];
  const radius = Math.min(Math.max(width, height) * 2, v![130] * height / cssHeight);
  let scale = baseScale, w = Math.ceil(width / scale), h = Math.ceil(height / scale);
  const levels = [{ width: w, height: h }];
  let texturePixels = w * h, fetches = w * h * baseScale * baseScale;
  while (radius > scale * kernel && (w > 1 || h > 1)) {
    scale *= 2; w = Math.ceil(w / 2); h = Math.ceil(h / 2);
    levels.push({ width: w, height: h }); texturePixels += w * h; fetches += w * h * 4;
  }
  return { width: w, height: h, scale: baseScale, sampleWidth: width / scale, sampleHeight: height / scale, kernel, levels, step: radius / (scale * kernel),
    textureBytes: (texturePixels + w * h) * 8,
    prefilterFetchBudget: fetches + w * h * 4 * (kernel * 2 + 1), drawCalls: levels.length + 2 };
}
export function spatialBloomFetchBudget(plan: SpatialBloomPlan, outputWidth: number, outputHeight: number): number {
  return plan.prefilterFetchBudget + outputWidth * outputHeight * 4;
}

export function writeSpatialBloomStats(stats: Pick<SpatialRendererStats,"bloomDrawCalls"|"bloomTextureBytes"|"bloomTexelFetchBudget"|"bloomSampleBudget">, v: Float32Array | undefined, plan: SpatialBloomPlan | undefined, outputWidth: number, outputHeight: number): void {
  const active = v?.[128] === 1 && v[129] > 0;
  stats.bloomDrawCalls = active && plan ? plan.drawCalls : 0;
  stats.bloomTextureBytes = active && plan ? plan.textureBytes : 0;
  stats.bloomTexelFetchBudget = !active ? 0 : plan ? spatialBloomFetchBudget(plan, outputWidth, outputHeight) : 32 * outputWidth * outputHeight;
  stats.bloomSampleBudget = !active ? 0 : plan ? Math.max(plan.scale * plan.scale, (plan.kernel * 2 + 1) * 2) : 32;
}

export const spatialBloomFragmentGLSL = `#version 300 es
precision highp float;
uniform sampler2D u_source;
uniform int u_scale,u_kernel,u_stage,u_targetHeight;
uniform float u_step,u_threshold;
out vec4 outColor;
vec3 load(ivec2 p){ivec2 size=textureSize(u_source,0);p=clamp(p,ivec2(0),size-1);return texelFetch(u_source,ivec2(p.x,size.y-1-p.y),0).rgb;}
void main(){
 ivec2 pixel=ivec2(int(gl_FragCoord.x),u_targetHeight-1-int(gl_FragCoord.y));vec3 sum=vec3(0.);float weight=0.;
 if(u_stage==0 || u_stage==3){
  for(int y=0;y<4;y++)for(int x=0;x<4;x++){
   if(x>=u_scale || y>=u_scale)continue;
   vec3 c=max(load(pixel*u_scale+ivec2(x,y)),vec3(0.));float peak=max(c.r,max(c.g,c.b));
   sum+=u_stage==0?c*(max(peak-u_threshold,0.)/max(peak,.00001)):c;weight+=1.;
  }
 }else{
  for(int i=-8;i<=8;i++){
   if(abs(i)>u_kernel)continue;float r=float(i)/float(u_kernel),w=exp(-4.*r*r);
   float offset=float(i)*u_step;int base=int(floor(offset));ivec2 axis=u_stage==1?ivec2(1,0):ivec2(0,1);
   sum+=mix(load(pixel+axis*base),load(pixel+axis*(base+1)),fract(offset))*w;weight+=w;
  }
 }
 outColor=vec4(sum/max(weight,.00001),1.);
}`;

export const spatialBloomWGSL = `
struct Params{config:vec4f,threshold:vec4f};
@group(0) @binding(0) var source:texture_2d<f32>;
@group(0) @binding(1) var<uniform> params:Params;
@vertex fn vs_main(@builtin(vertex_index) i:u32)->@builtin(position)vec4f{
 let uv=vec2f(f32((i<<1u)&2u),f32(i&2u));return vec4f(uv*2.-1.,0.,1.);
}
fn load(p:vec2i)->vec3f{return textureLoad(source,clamp(p,vec2i(0),vec2i(textureDimensions(source))-vec2i(1)),0).rgb;}
@fragment fn fs_main(@builtin(position) position:vec4f)->@location(0)vec4f{
 let pixel=vec2i(position.xy);let scale=i32(params.config.x);let kernel=i32(params.config.y);let stage=i32(params.config.z);
 var sum=vec3f(0.);var weight=0.;
 if(stage==0 || stage==3){
  for(var y=0;y<4;y++){for(var x=0;x<4;x++){
   if(x>=scale || y>=scale){continue;}
   let c=max(load(pixel*scale+vec2i(x,y)),vec3f(0.));let peak=max(c.r,max(c.g,c.b));
   if(stage==0){sum+=c*(max(peak-params.threshold.x,0.)/max(peak,.00001));}else{sum+=c;}weight+=1.;
  }}
 }else{
  for(var i=-8;i<=8;i++){
   if(abs(i)>kernel){continue;}let r=f32(i)/f32(kernel);let w=exp(-4.*r*r);
   let offset=f32(i)*params.config.w;let base=i32(floor(offset));let axis=select(vec2i(0,1),vec2i(1,0),stage==1);
   sum+=mix(load(pixel+axis*base),load(pixel+axis*(base+1)),fract(offset))*w;weight+=w;
  }
 }
 return vec4f(sum/max(weight,.00001),1.);
}`;
