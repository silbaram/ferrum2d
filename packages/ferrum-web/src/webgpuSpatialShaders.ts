import { spatialEnvironmentWGSL } from "./webgpuSpatialEnvironment.js";
export const spatialGeometryWGSL =
  spatialEnvironmentWGSL +
  `
struct Camera{matrix:mat4x4f};
@group(0) @binding(0) var<uniform> camera:Camera;
@group(1) @binding(0) var colorSampler:sampler;
@group(1) @binding(1) var colorTexture:texture_2d<f32>;
@group(3) @binding(0) var normalSampler:sampler;
@group(3) @binding(1) var normalTexture:texture_2d<f32>;
struct Vertex{@location(0) position:vec3f,@location(1) uv:vec2f,@location(2) color:vec4f,@location(3) cutoff:f32};
struct Fragment{@builtin(position) position:vec4f,@location(0) uv:vec2f,@location(1) color:vec4f,@location(2) @interpolate(flat) cutoff:f32,@location(3) world:vec3f};
@vertex fn vs_main(v:Vertex)->Fragment{
 var f:Fragment;var clip=camera.matrix*vec4f(v.position,1.);clip.z=(clip.z+clip.w)*.5;
 f.position=clip;f.uv=v.uv;f.color=v.color;f.cutoff=v.cutoff;f.world=v.position;return f;
}
@fragment fn fs_main(f:Fragment)->@location(0) vec4f{
 let color=textureSample(colorTexture,colorSampler,f.uv)*f.color;
 // WebGPU framebuffer Y points down; GLSL dFdy points up.
 let dx=dpdx(f.world);let dy= -dpdy(f.world);let crossNormal=cross(dx,dy);
 var n=vec3f(0.,1.,0.);if(length(crossNormal)>.000001){n=normalize(crossNormal);}
 let geometric=n;
 let a=dpdx(f.uv);let b= -dpdy(f.uv);let det=a.x*b.y-a.y*b.x;
 let sampled=textureSample(normalTexture,normalSampler,f.uv).rgb*2.-1.;
 if(abs(det)>.00000001){
  let t=(dx*b.y-dy*a.y)/det;let bt= -(dy*a.x-dx*b.x)/det;
  if(length(t)>.000001&&length(bt)>.000001&&length(sampled)>.000001){n=normalize(normalize(t)*sampled.x+normalize(bt)*sampled.y+n*sampled.z);}
 }
 if(color.a<f.cutoff){discard;}
 if(!environmentEnabled()){return vec4f(color.rgb,1.);}
 return vec4f(shade(linearize(color.rgb),vec3f(0.),f.world,n,geometric,false),1.);
}
@fragment fn fs_debug(f:Fragment)->@location(0) vec4f{
 if(environmentEnabled()){return vec4f(linearize(f.color.rgb),1.);}return vec4f(f.color.rgb,1.);
}`;
export function spatialModelWGSL(mapped: boolean): string {
  return (
    spatialEnvironmentWGSL +
    `
struct Camera{matrix:mat4x4f};
struct Material{color:vec4f,emission:vec4f,params:vec4f};
@group(0) @binding(0) var<uniform> camera:Camera;
@group(1) @binding(0) var<uniform> material:Material;
@group(1) @binding(1) var baseSampler:sampler;
@group(1) @binding(2) var baseTexture:texture_2d<f32>;
@group(1) @binding(3) var normalSampler:sampler;
@group(1) @binding(4) var normalTexture:texture_2d<f32>;
@group(1) @binding(5) var emissionSampler:sampler;
@group(1) @binding(6) var emissionTexture:texture_2d<f32>;
struct Input{
 @location(0) position:vec3f,@location(1) uv:vec2f,@location(2) normal:vec3f,
 @location(3) m0:vec4f,@location(4) m1:vec4f,@location(5) m2:vec4f,@location(6) m3:vec4f,
 ${mapped ? "@location(7) tangent:vec4f," : ""}
};
struct Fragment{@builtin(position) position:vec4f,@location(0) uv:vec2f,@location(1) world:vec3f,@location(2) normal:vec3f,@location(3) tangent:vec4f};
@vertex fn vs_main(v:Input)->Fragment{
 let model=mat4x4f(v.m0,v.m1,v.m2,v.m3);let world=model*vec4f(v.position,1.);var p=camera.matrix*world;p.z=(p.z+p.w)*.5;
 var f:Fragment;f.position=p;f.uv=v.uv;f.world=world.xyz;
 let basis=mat3x3f(v.m0.xyz,v.m1.xyz,v.m2.xyz);f.normal=basis*v.normal;
 let tangent=${mapped ? "v.tangent" : "vec4f(0.)"};f.tangent=vec4f(basis*tangent.xyz,tangent.w);return f;
}
@fragment fn fs_main(f:Fragment,@builtin(front_facing) front:bool)->@location(0) vec4f{
 let c=textureSample(baseTexture,baseSampler,f.uv)*material.color;
 let sampled=textureSample(normalTexture,normalSampler,f.uv).rgb*2.-1.;
 let emitted=textureSample(emissionTexture,emissionSampler,f.uv).rgb*material.emission.xyz;
 let geometric=cross(dpdx(f.world),-dpdy(f.world));var n=vec3f(0.,1.,0.);
 if(length(geometric)>.000001){n=normalize(geometric);}
 let geometricNormal=n;
 let facing=select(-1.,1.,front);
 if(length(f.normal)>.000001){
  let normal=normalize(f.normal);n=normal*facing;
  if(material.params.w>.5){
   let t=f.tangent.xyz-normal*dot(normal,f.tangent.xyz);let sn=vec3f(sampled.xy*material.params.z,sampled.z);
   if(length(t)>.000001&&length(sn)>.000001){let tangent=normalize(t);n=normalize(tangent*sn.x+cross(normal,tangent)*f.tangent.w*sn.y+normal*sn.z)*facing;}
  }
 }
 if(c.a<material.params.x){discard;}
 let unlit=material.params.y>.5;var emission=emitted;if(unlit){emission=vec3f(0.);}
 if(!environmentEnabled()){return vec4f(encode(c.rgb+emission),1.);}
 return vec4f(shade(c.rgb,emission,f.world,n,geometricNormal,unlit),1.);
}`
  );
}
