export const FLAT_HDR_GLSL = {
  vertex: `#version 300 es
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}`,
  fragment: `#version 300 es
precision highp float;
uniform sampler2D u_source;uniform vec3 u_output;out vec4 outColor;
void main(){vec4 value=texelFetch(u_source,ivec2(gl_FragCoord.xy),0);float a=value.a;
 vec3 c=a>0.?max(value.rgb/a,vec3(0.))*exp2(u_output.x):vec3(0.);
 if(u_output.y==1.)c=c/(1.+c);
 else if(u_output.y==2.)c=(c*(2.51*c+.03))/(c*(2.43*c+.59)+.14);
 c=clamp(c,0.,1.);
 if(u_output.z==1.)c=mix(1.055*pow(c,vec3(1./2.4))-.055,c*12.92,lessThanEqual(c,vec3(.0031308)));
 outColor=vec4(c*a,a);
}`,
};

export const FLAT_HDR_WGSL = `
@group(0) @binding(0) var source:texture_2d<f32>;
@group(0) @binding(1) var<uniform> output:vec4f;
@vertex fn vs_main(@builtin(vertex_index)i:u32)->@builtin(position)vec4f{
 let p=vec2f(f32((i<<1u)&2u),f32(i&2u));return vec4f(p*2.-1.,0.,1.);
}
@fragment fn fs_main(@builtin(position)p:vec4f)->@location(0)vec4f{
 let value=textureLoad(source,vec2i(p.xy),0);let a=value.a;
 var c=select(vec3f(0.),max(value.rgb/max(a,.000001),vec3f(0.))*exp2(output.x),a>0.);
 if(output.y==1.){c=c/(1.+c);}else if(output.y==2.){c=(c*(2.51*c+.03))/(c*(2.43*c+.59)+.14);}
 c=clamp(c,vec3f(0.),vec3f(1.));
 if(output.z==1.){c=select(1.055*pow(c,vec3f(1./2.4))-vec3f(.055),c*12.92,c<=vec3f(.0031308));}
 return vec4f(c*a,a);
}`;
