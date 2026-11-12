import type { SpatialRenderBufferView } from "./dataSceneSpatial.js";
import { spatialLightShaftsActive } from "./spatialLightShafts.js";
import type { SpatialRendererStats } from "./renderer.js";

export interface SpatialLightShaftPlan { width: number; height: number; samples: number; textureBytes: number; drawCalls: number; fetchBudget: number }
export function spatialLightShaftPlan(v: Float32Array | undefined, width: number, height: number): SpatialLightShaftPlan | undefined {
  if (!spatialLightShaftsActive(v)) return;
  const w = Math.ceil(width / v![624]), h = Math.ceil(height / v![624]), resolve = !(v![132] === 1 && v![133] > 0);
  return { width: w, height: h, samples: v![625], textureBytes: w * h * 8 + Number(resolve) * width * height * 8,
    drawCalls: 1 + Number(resolve), fetchBudget: w * h * (v![625] + 1) + width * height * (4 + 2 * Number(resolve)) };
}
export function writeSpatialLightShaftStats(stats: SpatialRendererStats, plan?: SpatialLightShaftPlan): void {
  stats.lightShaftDrawCalls = plan?.drawCalls ?? 0; stats.lightShaftTextureBytes = plan?.textureBytes ?? 0;
  stats.lightShaftTexelFetchBudget = plan?.fetchBudget ?? 0; stats.lightShaftSampleBudget = plan ? plan.samples + 1 : 0;
}
/** Private platform uniform: 52 floats. Camera and lighting are read from the native packet. */
export function writeLightShaftUniforms(out: Float32Array, frame: SpatialRenderBufferView, plan: SpatialLightShaftPlan, width: number, height: number): void {
  const c = frame.camera, e = frame.environment!, v = e.values;
  out.fill(0); out.set(e.shadowMatrices.subarray(e.shadowMatrices.length - 16), 0);
  const dx = c[20] - c[17], dy = c[21] - c[18], dz = c[22] - c[19], length = Math.hypot(dx, dy, dz);
  const fx = dx / length, fy = dy / length, fz = dz / length, horizontal = Math.hypot(fx, fz), rx = -fz / horizontal, rz = fx / horizontal;
  out.set([c[17], c[18], c[19], c[16], fx, fy, fz, c[16] ? Math.tan(c[23] / 2) : c[23] / 2,
    rx, 0, rz, width / height, -rz * fy, rz * fx - rx * fz, rx * fy, c[24],
    v[84], v[85], v[86], c[25], v[88] * v[620] * v[87] * v[617], v[89] * v[621] * v[87] * v[617], v[90] * v[622] * v[87] * v[617], v[618],
    v[619], v[623], v[93] / (2 * v[91]) + .000001, plan.samples, width, height, plan.width, plan.height,
    v[94], 2 * v[91], v[92], 0], 16);
}

export const LIGHT_SHAFT_GLSL = `#version 300 es
precision highp float;
uniform highp sampler2D u_depth,u_shadow;
uniform vec4 u_p[13];out vec4 color;
float depthAt(vec2 uv){ivec2 size=textureSize(u_depth,0);ivec2 p=clamp(ivec2(uv*vec2(size)),ivec2(0),size-1);return texelFetch(u_depth,ivec2(p.x,size.y-1-p.y),0).r;}
float visibility(vec3 world){
 vec3 q=(mat4(u_p[0],u_p[1],u_p[2],u_p[3])*vec4(world,1.)).xyz*.5+.5;
 if(any(lessThan(q,vec3(0.)))||any(greaterThanEqual(q,vec3(1.))))return 0.;
 float edge=min(min(min(q.x,1.-q.x),min(q.y,1.-q.y))*2.*u_p[12].x,min(q.z,1.-q.z)*u_p[12].y);
 float fade=smoothstep(0.,8.*u_p[12].x/u_p[12].z,edge);
 return fade*step(q.z,texelFetch(u_shadow,ivec2(q.xy*u_p[12].z),0).r+u_p[10].z);
}
void main(){
 vec2 uv=vec2(gl_FragCoord.x,u_p[11].w-gl_FragCoord.y)/u_p[11].zw;
 float d=depthAt(uv),near=u_p[7].w,far=u_p[8].w;
 bool perspective=u_p[4].w>0.;float z=perspective?2.*near*far/(far+near-(d*2.-1.)*(far-near)):mix(near,far,d);
 vec3 offset=(u_p[6].xyz*((uv.x*2.-1.)*u_p[6].w)+u_p[7].xyz*(1.-uv.y*2.))*u_p[5].w;
 vec3 origin=u_p[4].xyz+(perspective?vec3(0.):offset),ray=perspective?normalize(u_p[5].xyz+offset):u_p[5].xyz;
 float cosine=dot(ray,u_p[5].xyz),start=near/cosine,stop=min(z/cosine,u_p[10].x),dt=max(stop-start,0.)/u_p[10].w;
 float tau=u_p[9].w*dt,weight=exp(-min(u_p[9].w*start,80.))*(tau<.01?tau*(1.-tau*.5+tau*tau/6.):1.-exp(-min(tau,80.))),decay=exp(-min(tau,80.)),sum=0.;
 for(int i=0;i<48;i++){if(float(i)>=u_p[10].w)break;sum+=visibility(origin+ray*(start+(float(i)+.5)*dt))*weight;weight*=decay;}
 float g=u_p[10].y,phase=pow((1.-g)*(1.-g)/max(1.+g*g-2.*g*clamp(dot(ray,u_p[8].xyz),-1.,1.),.0001),1.5);
 color=vec4(u_p[9].rgb*sum*phase,1.);
}`;

export const LIGHT_SHAFT_WGSL = `
struct Params{p:array<vec4f,13>};
@group(0) @binding(0) var depth:texture_depth_2d;
@group(0) @binding(1) var shadow:texture_depth_2d;
@group(0) @binding(2) var<uniform> u:Params;
@vertex fn vs_main(@builtin(vertex_index) i:u32)->@builtin(position)vec4f{let uv=vec2f(f32((i<<1u)&2u),f32(i&2u));return vec4f(uv*2.-1.,0.,1.);}
fn visibility(world:vec3f)->f32{
 let q=(mat4x4f(u.p[0],u.p[1],u.p[2],u.p[3])*vec4f(world,1.)).xyz*.5+.5;
 if(any(q<vec3f(0.))||any(q>=vec3f(1.))){return 0.;}
 let edge=min(min(min(q.x,1.-q.x),min(q.y,1.-q.y))*2.*u.p[12].x,min(q.z,1.-q.z)*u.p[12].y);
 let fade=smoothstep(0.,8.*u.p[12].x/u.p[12].z,edge);
 let xy=vec2i(q.xy*u.p[12].z);let size=i32(u.p[12].z);
 return fade*step(q.z,textureLoad(shadow,vec2i(xy.x,size-1-xy.y),0)+u.p[10].z);
}
@fragment fn fs_main(@builtin(position) position:vec4f)->@location(0)vec4f{
 let uv=position.xy/u.p[11].zw;let size=vec2i(textureDimensions(depth));let d=textureLoad(depth,clamp(vec2i(uv*vec2f(size)),vec2i(0),size-vec2i(1)),0);
 let near=u.p[7].w;let far=u.p[8].w;let perspective=u.p[4].w>0.;var z=mix(near,far,d);if(perspective){z=2.*near*far/(far+near-(d*2.-1.)*(far-near));}
 let offset=(u.p[6].xyz*((uv.x*2.-1.)*u.p[6].w)+u.p[7].xyz*(1.-uv.y*2.))*u.p[5].w;
 var origin=u.p[4].xyz+offset;var ray=u.p[5].xyz;if(perspective){origin=u.p[4].xyz;ray=normalize(ray+offset);}
 let cosine=dot(ray,u.p[5].xyz);let start=near/cosine;let stop=min(z/cosine,u.p[10].x);let dt=max(stop-start,0.)/u.p[10].w;
 let tau=u.p[9].w*dt;var attenuation=1.-exp(-min(tau,80.));if(tau<.01){attenuation=tau*(1.-tau*.5+tau*tau/6.);}
 var weight=exp(-min(u.p[9].w*start,80.))*attenuation;let decay=exp(-min(tau,80.));var sum=0.;
 for(var i=0;i<48;i++){if(f32(i)>=u.p[10].w){break;}sum+=visibility(origin+ray*(start+(f32(i)+.5)*dt))*weight;weight*=decay;}
 let g=u.p[10].y;let phase=pow((1.-g)*(1.-g)/max(1.+g*g-2.*g*clamp(dot(ray,u.p[8].xyz),-1.,1.),.0001),1.5);
 return vec4f(u.p[9].rgb*sum*phase,1.);
}`;
