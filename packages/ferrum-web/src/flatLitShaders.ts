/** Shader-only working-space conversion. Data/normal/mask textures never use these transforms. */
const GLSL_TRANSFER = `
vec3 decodeColor(vec3 c){return mix(pow(max((c+.055)/1.055,vec3(0.)),vec3(2.4)),c/12.92,lessThanEqual(c,vec3(.04045)));}
vec3 encodeColor(vec3 c){c=clamp(c,0.,1.);return mix(1.055*pow(c,vec3(1./2.4))-.055,c*12.92,lessThanEqual(c,vec3(.0031308)));}
`;
export function flatLitGlslFragment(data: boolean): string {
  return `#version 300 es
precision highp float;
in vec2 v_uv;in vec2 v_normal_uv;in vec4 v_color;in vec2 v_corner;
flat in float v_flags;flat in vec2 v_lighting;flat in vec2 v_rotation_cs;flat in vec2 v_uv_sign;
uniform sampler2D u_texture;uniform bool u_output_srgb;
${data ? "uniform sampler2D u_normal_texture;uniform bool u_has_normal,u_normal_flip_y;layout(location=0) out vec4 outNormal;layout(location=1) out vec4 outCoverage;layout(location=2) out vec4 outAlbedo;" : "out vec4 outColor;"}
${GLSL_TRANSFER}
void main(){
 int flags=int(v_flags),mode=int(v_lighting.x)%4;
 vec4 sampled=texture(u_texture,v_uv);vec4 color=sampled*v_color;
 if((flags&32)!=0)color=vec4(v_color.rgb,sampled.a*v_color.a);
 else if((flags&24)!=0){vec2 q=(v_corner-.5)*2.;if((flags&8)!=0&&dot(q,q)>1.)discard;color=v_color;}
 if(mode!=0){
   if(mode==2&&color.a<v_lighting.y)discard;
   vec3 albedo=(v_lighting.x>=4.?decodeColor(sampled.rgb):sampled.rgb)*v_color.rgb;
   color=vec4(u_output_srgb?encodeColor(albedo):albedo,1.);
 }
 ${data ? `
 vec3 n=vec3(0.);
 if(mode!=0){n=vec3(0.,0.,1.);if(u_has_normal){
  vec2 uv=v_normal_uv;if(u_normal_flip_y)uv.y=1.-uv.y;
  ivec2 size=textureSize(u_normal_texture,0);ivec2 texel=clamp(ivec2(floor((uv+vec2(1./4194304.))*vec2(size))),ivec2(0),size-1);
  vec3 local=texelFetch(u_normal_texture,texel,0).rgb*2.-1.;local=length(local)<.01?vec3(0.,0.,1.):normalize(local);local.xy*=v_uv_sign;
  float c=v_rotation_cs.x,s=v_rotation_cs.y;n=vec3(c*local.x+s*local.y,s*local.x-c*local.y,local.z);
 }}
 outNormal=vec4(n*.5+.5,color.a);outCoverage=vec4(1.,mode!=0?1.:0.,0.,color.a);
 outAlbedo=vec4(mode!=0?color.rgb:vec3(0.),color.a);` : "outColor=color;"}
}`;
}

export const FLAT_LIT_COMPOSITE_GLSL = {
  vertex: `#version 300 es
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}`,
  fragment: `#version 300 es
precision highp float;uniform sampler2D u_albedo,u_coverage,u_irradiance;uniform bool u_subtract,u_output_srgb;
out vec4 outColor;${GLSL_TRANSFER}
void main(){ivec2 p=ivec2(gl_FragCoord.xy);vec3 weighted=texelFetch(u_albedo,p,0).rgb;
 if(u_subtract){outColor=vec4(weighted,0.);return;}
 float coverage=texelFetch(u_coverage,p,0).g;
 vec3 base=coverage>0.?weighted/coverage:vec3(0.);
 vec3 lit=(u_output_srgb?decodeColor(base):base)*texelFetch(u_irradiance,p,0).rgb;
 outColor=vec4((u_output_srgb?encodeColor(lit):clamp(lit,0.,1.))*coverage,0.);
}`,
};

const WGSL_TRANSFER = `
fn decodeColor(c:vec3f)->vec3f{return select(pow(max((c+vec3f(.055))/1.055,vec3f(0.)),vec3f(2.4)),c/12.92,c<=vec3f(.04045));}
fn encodeColor(value:vec3f)->vec3f{let c=clamp(value,vec3f(0.),vec3f(1.));return select(1.055*pow(c,vec3f(1./2.4))-vec3f(.055),c*12.92,c<=vec3f(.0031308));}
`;
export function flatLitWgslFragment(data: boolean): string {
  return `${WGSL_TRANSFER}
${data ? "struct LitOutput{@location(0) normal:vec4f,@location(1) coverage:vec4f,@location(2) albedo:vec4f};" : ""}
@fragment fn fs_main(input:VertexOutput)->${data ? "LitOutput" : "@location(0) vec4f"}{
 let flags=u32(input.flags);let mode=u32(input.lighting.x)%4u;
 let sampled=textureSample(spriteTexture,spriteSampler,input.uv);var color=sampled*input.color;
 if((flags&32u)!=0u){color=vec4f(input.color.rgb,sampled.a*input.color.a);}
 else if((flags&24u)!=0u){let q=(input.corner-.5)*2.;if((flags&8u)!=0u&&dot(q,q)>1.){discard;}color=input.color;}
 if(mode!=0u){if(mode==2u&&color.a<input.lighting.y){discard;}
   let albedo=select(sampled.rgb,decodeColor(sampled.rgb),input.lighting.x>=4.)*input.color.rgb;
   color=vec4f(encodeColor(albedo),1.);
 }
 ${data ? `var n=vec3f(0.);if(mode!=0u){n=vec3f(0.,0.,1.);if((flags&64u)!=0u){
 let size=textureDimensions(normalTexture);let uv=clamp(vec2i(floor((input.uv+vec2f(1./4194304.))*vec2f(size))),vec2i(0),vec2i(size)-vec2i(1));
 var local=textureLoad(normalTexture,uv,0).rgb*2.-1.;if(length(local)<.01){local=vec3f(0.,0.,1.);}else{local=normalize(local);}
 local=vec3f(local.xy*input.uvSign,local.z);let c=input.rotationCS.x;let s=input.rotationCS.y;
 n=vec3f(c*local.x+s*local.y,s*local.x-c*local.y,local.z);
 }}var output:LitOutput;output.normal=vec4f(n*.5+.5,color.a);output.coverage=vec4f(1.,select(0.,1.,mode!=0u),0.,color.a);
 output.albedo=vec4f(select(vec3f(0.),color.rgb,mode!=0u),color.a);return output;` : "return color;"}
}`;
}

export const FLAT_LIT_COMPOSITE_WGSL = `${WGSL_TRANSFER}
@group(0) @binding(0) var albedo:texture_2d<f32>;
@group(0) @binding(1) var coverage:texture_2d<f32>;
@group(0) @binding(2) var irradiance:texture_2d<f32>;
@vertex fn vs_main(@builtin(vertex_index)i:u32)->@builtin(position)vec4f{
 let p=vec2f(f32((i<<1u)&2u),f32(i&2u));return vec4f(p*2.-1.,0.,1.);
}
@fragment fn fs_subtract(@builtin(position)p:vec4f)->@location(0)vec4f{return vec4f(textureLoad(albedo,vec2i(p.xy),0).rgb,0.);}
@fragment fn fs_add(@builtin(position)p:vec4f)->@location(0)vec4f{
 let at=vec2i(p.xy);let weight=textureLoad(coverage,at,0).g;
 let base=textureLoad(albedo,at,0).rgb/max(weight,.000001);
 return vec4f(encodeColor(decodeColor(base)*textureLoad(irradiance,at,0).rgb)*weight,0.);
}`;
