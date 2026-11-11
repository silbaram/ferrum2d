/** Shader-only working-space conversion. Data/normal/mask textures never use these transforms. */
const GLSL_TRANSFER = `
vec3 decodeColor(vec3 c){return mix(pow(max((c+.055)/1.055,vec3(0.)),vec3(2.4)),c/12.92,lessThanEqual(c,vec3(.04045)));}
vec3 encodeColor(vec3 c){c=clamp(c,0.,1.);return mix(1.055*pow(c,vec3(1./2.4))-.055,c*12.92,lessThanEqual(c,vec3(.0031308)));}
`;
export function flatLitGlslFragment(data: boolean, surface = false): string {
  return `#version 300 es
precision highp float;
in vec2 v_uv;in vec2 v_normal_uv;in vec4 v_color;in vec2 v_corner;
flat in float v_flags;flat in vec2 v_lighting;flat in vec2 v_rotation_cs;flat in vec2 v_uv_sign;
uniform sampler2D u_texture;uniform bool u_output_srgb;
${data ? "uniform sampler2D u_normal_texture;uniform bool u_has_normal,u_normal_flip_y;layout(location=0) out vec4 outNormal;layout(location=1) out vec4 outCoverage;layout(location=2) out vec4 outAlbedo;" : "out vec4 outColor;"}
${surface ? `flat in vec4 v_surface;flat in vec2 v_surface_params;
uniform sampler2D u_emission_map,u_specular_map,u_roughness_map;layout(location=3) out vec4 outEmission;
vec4 surfaceMap(sampler2D map,vec2 uv,bool flip){if(flip)uv.y=1.-uv.y;ivec2 size=textureSize(map,0);return texelFetch(map,clamp(ivec2(floor((uv+vec2(1./4194304.))*vec2(size))),ivec2(0),size-1),0);}` : ""}
${GLSL_TRANSFER}
void main(){
 int flags=int(v_flags),mode=int(v_lighting.x)%4;
 vec4 sampled=texture(u_texture,v_uv);bool hdr=(int(v_lighting.x)&8)!=0;
 vec3 sampledLinear=(int(v_lighting.x)&4)!=0?decodeColor(sampled.rgb):sampled.rgb;
 vec4 color=hdr?vec4(sampledLinear*v_color.rgb,sampled.a*v_color.a):sampled*v_color;
 if((flags&32)!=0)color=vec4(v_color.rgb,sampled.a*v_color.a);
 else if((flags&24)!=0){vec2 q=(v_corner-.5)*2.;if((flags&8)!=0&&dot(q,q)>1.)discard;color=v_color;}
 if(mode!=0){
   if(mode==2&&color.a<v_lighting.y)discard;
   vec3 albedo=sampledLinear*v_color.rgb;
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
 ${surface ? `vec3 emission=vec3(0.);float specular=0.,roughness=mode!=0?1.:0.;int maps=int(v_surface_params.y);
 if(mode!=0 && (maps&128)!=0){
  vec3 emitted=(maps&1)!=0?surfaceMap(u_emission_map,v_normal_uv,(maps&2)!=0).rgb:vec3(1.);
  if((maps&64)!=0)emitted=decodeColor(emitted);
  emission=emitted*v_surface.rgb;
  specular=v_surface.a*((maps&4)!=0?surfaceMap(u_specular_map,v_normal_uv,(maps&8)!=0).a:1.);
  roughness=v_surface_params.x*((maps&16)!=0?surfaceMap(u_roughness_map,v_normal_uv,(maps&32)!=0).g:1.);
 }
 outEmission=vec4(emission,color.a);
 outCoverage=vec4(specular,mode!=0?1.:0.,roughness,color.a);` : `outCoverage=vec4(1.,mode!=0?1.:0.,0.,color.a);`}
 outNormal=vec4(n*.5+.5,color.a);
 outAlbedo=vec4(mode!=0?color.rgb:vec3(0.),color.a);` : "outColor=color;"}
}`;
}

export const FLAT_LIT_COMPOSITE_GLSL = {
  vertex: `#version 300 es
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}`,
  fragment: `#version 300 es
precision highp float;uniform sampler2D u_albedo,u_coverage,u_irradiance,u_emission;uniform bool u_subtract,u_output_srgb,u_hdr,u_surface;
out vec4 outColor;${GLSL_TRANSFER}
void main(){ivec2 p=ivec2(gl_FragCoord.xy);vec3 weighted=texelFetch(u_albedo,p,0).rgb;
 if(u_subtract){outColor=vec4(weighted,0.);return;}
 float coverage=texelFetch(u_coverage,p,0).g;
 vec3 base=coverage>0.?weighted/coverage:vec3(0.);
 vec3 lit=u_surface?texelFetch(u_irradiance,p,0).rgb+(coverage>0.?texelFetch(u_emission,p,0).rgb/coverage:vec3(0.)):(u_output_srgb?decodeColor(base):base)*texelFetch(u_irradiance,p,0).rgb;
 outColor=vec4((u_output_srgb?encodeColor(lit):u_hdr?lit:clamp(lit,0.,1.))*coverage,0.);
}`,
};

const WGSL_TRANSFER = `
fn decodeColor(c:vec3f)->vec3f{return select(pow(max((c+vec3f(.055))/1.055,vec3f(0.)),vec3f(2.4)),c/12.92,c<=vec3f(.04045));}
fn encodeColor(value:vec3f)->vec3f{let c=clamp(value,vec3f(0.),vec3f(1.));return select(1.055*pow(c,vec3f(1./2.4))-vec3f(.055),c*12.92,c<=vec3f(.0031308));}
`;
export function flatLitWgslFragment(data: boolean, linearWorking = false, surface = false): string {
  return `${WGSL_TRANSFER}
${data ? `struct LitOutput{@location(0) normal:vec4f,@location(1) coverage:vec4f,@location(2) albedo:vec4f${surface ? ",@location(3) emission:vec4f" : ""}};` : ""}
${surface ? `@group(3) @binding(0) var emissionMap:texture_2d<f32>;
@group(3) @binding(1) var specularMap:texture_2d<f32>;
@group(3) @binding(2) var roughnessMap:texture_2d<f32>;
fn surfaceMap(map:texture_2d<f32>,coordinate:vec2f,flip:bool)->vec4f{
 var uv=coordinate;if(flip){uv.y=1.-uv.y;}let size=textureDimensions(map);
 return textureLoad(map,clamp(vec2i(floor((uv+vec2f(1./4194304.))*vec2f(size))),vec2i(0),vec2i(size)-vec2i(1)),0);
}` : ""}
@fragment fn fs_main(input:VertexOutput)->${data ? "LitOutput" : "@location(0) vec4f"}{
 let flags=u32(input.flags);let mode=u32(input.lighting.x)%4u;
 let sampled=textureSample(spriteTexture,spriteSampler,input.uv);let hdr=(u32(input.lighting.x)&8u)!=0u;
 let sampledLinear=select(sampled.rgb,decodeColor(sampled.rgb),(u32(input.lighting.x)&4u)!=0u);
 var color=select(sampled*input.color,vec4f(sampledLinear*input.color.rgb,sampled.a*input.color.a),hdr);
 if((flags&32u)!=0u){color=vec4f(input.color.rgb,sampled.a*input.color.a);}
 else if((flags&24u)!=0u){let q=(input.corner-.5)*2.;if((flags&8u)!=0u&&dot(q,q)>1.){discard;}color=input.color;}
 if(mode!=0u){if(mode==2u&&color.a<input.lighting.y){discard;}
   let albedo=sampledLinear*input.color.rgb;
   color=vec4f(select(encodeColor(albedo),albedo,${linearWorking ? "true" : "hdr"}),1.);
 }
 ${data ? `var n=vec3f(0.);if(mode!=0u){n=vec3f(0.,0.,1.);if((flags&64u)!=0u){
 let size=textureDimensions(normalTexture);let uv=clamp(vec2i(floor((input.uv+vec2f(1./4194304.))*vec2f(size))),vec2i(0),vec2i(size)-vec2i(1));
 var local=textureLoad(normalTexture,uv,0).rgb*2.-1.;if(length(local)<.01){local=vec3f(0.,0.,1.);}else{local=normalize(local);}
 local=vec3f(local.xy*input.uvSign,local.z);let c=input.rotationCS.x;let s=input.rotationCS.y;
 n=vec3f(c*local.x+s*local.y,s*local.x-c*local.y,local.z);
 }}var output:LitOutput;output.normal=vec4f(n*.5+.5,color.a);
 ${surface ? `var emission=vec3f(0.);var specular=0.;var roughness=select(0.,1.,mode!=0u);let maps=u32(input.surfaceParams.y);
 if(mode!=0u && (maps&128u)!=0u){
  var emitted=vec3f(1.);if((maps&1u)!=0u){emitted=surfaceMap(emissionMap,input.uv,(maps&2u)!=0u).rgb;}
  if((maps&64u)!=0u){emitted=decodeColor(emitted);}emission=emitted*input.surface.rgb;
  specular=input.surface.a;if((maps&4u)!=0u){specular*=surfaceMap(specularMap,input.uv,(maps&8u)!=0u).a;}
  roughness=input.surfaceParams.x;if((maps&16u)!=0u){roughness*=surfaceMap(roughnessMap,input.uv,(maps&32u)!=0u).g;}
 }
 output.emission=vec4f(emission,color.a);output.coverage=vec4f(specular,select(0.,1.,mode!=0u),roughness,color.a);` : `output.coverage=vec4f(1.,select(0.,1.,mode!=0u),0.,color.a);`}
 output.albedo=vec4f(select(vec3f(0.),color.rgb,mode!=0u),color.a);return output;` : "return color;"}
}`;
}

export function flatLitCompositeWgsl(hdr = false, linearWorking = false, surface = false): string { return `${WGSL_TRANSFER}
@group(0) @binding(0) var albedo:texture_2d<f32>;
@group(0) @binding(1) var coverage:texture_2d<f32>;
@group(0) @binding(2) var irradiance:texture_2d<f32>;
${surface?"@group(0) @binding(3) var emission:texture_2d<f32>;":""}
@vertex fn vs_main(@builtin(vertex_index)i:u32)->@builtin(position)vec4f{
 let p=vec2f(f32((i<<1u)&2u),f32(i&2u));return vec4f(p*2.-1.,0.,1.);
}
@fragment fn fs_subtract(@builtin(position)p:vec4f)->@location(0)vec4f{return vec4f(textureLoad(albedo,vec2i(p.xy),0).rgb,0.);}
@fragment fn fs_add(@builtin(position)p:vec4f)->@location(0)vec4f{
 let at=vec2i(p.xy);let weight=textureLoad(coverage,at,0).g;
 let base=textureLoad(albedo,at,0).rgb/max(weight,.000001);
 ${surface?"let lit=textureLoad(irradiance,at,0).rgb+textureLoad(emission,at,0).rgb/max(weight,.000001);":""}
 return vec4f(${surface?(hdr?"lit":linearWorking?"clamp(lit,vec3f(0.),vec3f(1.))":"encodeColor(lit)"):hdr ? "base*textureLoad(irradiance,at,0).rgb" : linearWorking ? "clamp(base*textureLoad(irradiance,at,0).rgb,vec3f(0.),vec3f(1.))" : "encodeColor(decodeColor(base)*textureLoad(irradiance,at,0).rgb)"}*weight,0.);
}`;
}
export const FLAT_LIT_COMPOSITE_WGSL = flatLitCompositeWgsl();
