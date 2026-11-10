/** Receiver identity survives unlit alpha; the lighting coverage pass handles its visibility. */
export const FLAT_RECEIVER_MASK_GLSL = `#version 300 es
precision highp float;
in vec2 v_uv;in vec4 v_color;flat in vec2 v_lighting;flat in vec2 v_receiver_masks;
uniform sampler2D u_texture;out vec4 outColor;
void main(){float alpha=texture(u_texture,v_uv).a*v_color.a;int mode=int(v_lighting.x)%4;if(mode==0)discard;
 if(mode==2&&alpha<v_lighting.y)discard;
 outColor=vec4(v_receiver_masks/255.,0.,1.);}`;
export const FLAT_RECEIVER_MASK_WGSL = `
@fragment fn fs_main(input:VertexOutput)->@location(0) vec4f{
 let alpha=textureSample(spriteTexture,spriteSampler,input.uv).a*input.color.a;
 let mode=u32(input.lighting.x)%4u;if(mode==0u){discard;}
 if(mode==2u&&alpha<input.lighting.y){discard;}
 return vec4f(input.receiverMasks/255.,0.,1.);
}`;
