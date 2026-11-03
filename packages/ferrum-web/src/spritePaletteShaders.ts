/** Only compiled into opt-in variants. No palette branch/fetch in the default shader. */
export const SPRITE_PALETTE_GLSL = `
uniform int u_palette_count;
uniform vec4 u_palette_from[32];
uniform vec4 u_palette_to[32];
uniform bool u_palette_srgb;
vec3 paletteEncode(vec3 x) {
  return mix(x*12.92,1.055*pow(max(x,vec3(0.)),vec3(1./2.4))-.055,step(vec3(.0031308),x));
}
vec3 paletteDecode(vec3 x) {
  return mix(x/12.92,pow((x+.055)/1.055,vec3(2.4)),step(vec3(.04045),x));
}
vec4 paletteColor(vec4 sampled) {
  if (sampled.a==0.) return sampled;
  vec3 key=floor((u_palette_srgb?paletteEncode(sampled.rgb):sampled.rgb)*255.+.5);
  for(int i=0;i<32;i++) {
    if(i>=u_palette_count) break;
    if(all(equal(key,u_palette_from[i].rgb))) {
      vec3 rgb=u_palette_to[i].rgb;
      return vec4(u_palette_srgb?paletteDecode(rgb):rgb,sampled.a);
    }
  }
  return sampled;
}`;

export const SPRITE_PALETTE_WGSL = `
struct Palette { sourceColors: array<vec4f,32>, targetColors: array<vec4f,32>, count: vec4u };
@group(2) @binding(0) var<uniform> palette: Palette;
fn paletteColor(sampled: vec4f) -> vec4f {
  if (sampled.a == 0.) { return sampled; }
  let key = floor(sampled.rgb*255.+vec3f(.5));
  for (var i=0u; i<32u; i++) {
    if (i>=palette.count.x) { break; }
    if (all(key==palette.sourceColors[i].rgb)) { return vec4f(palette.targetColors[i].rgb,sampled.a); }
  }
  return sampled;
}`;
