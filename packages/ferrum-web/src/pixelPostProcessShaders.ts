// Top-left anchored ordered Bayer pattern, identical on both renderers.
const BAYER_4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export const PIXEL_POST_PROCESS_GLSL = `
uniform highp sampler2D u_pixel_scene;
uniform highp vec4 u_pixel_params;
highp vec3 pixelLinearToSrgb(highp vec3 rgb) {
  rgb = clamp(rgb, 0.0, 1.0);
  return mix(12.92 * rgb, 1.055 * pow(rgb, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), rgb));
}
highp vec3 pixelSrgbToLinear(highp vec3 rgb) {
  return mix(rgb / 12.92, pow((rgb + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), rgb));
}
highp vec4 applyPixelArt() {
  const int bayer[16] = int[16](${BAYER_4.join(",")});
  highp ivec2 texel = ivec2(gl_FragCoord.xy);
  highp vec4 scene = texelFetch(u_pixel_scene, texel, 0);
  highp ivec2 pixel = ivec2(texel.x, textureSize(u_pixel_scene, 0).y - 1 - texel.y);
  highp float threshold = (float(bayer[(pixel.y % 4) * 4 + pixel.x % 4]) + 0.5) / 16.0 - 0.5;
  highp float steps = u_pixel_params.x - 1.0;
  highp vec3 rgb = u_linear_working_space
    ? (scene.a > 0.0 ? pixelLinearToSrgb(scene.rgb / scene.a) : vec3(0.0)) : scene.rgb;
  rgb = clamp(floor(clamp(rgb, 0.0, 1.0) * steps + 0.5 + threshold * u_pixel_params.y), 0.0, steps) / steps;
  rgb *= 1.0 - float(pixel.y % 2) * u_pixel_params.z;
  if (u_linear_working_space) rgb = pixelSrgbToLinear(rgb) * scene.a;
  return vec4(rgb, scene.a);
}`;

export const PIXEL_POST_PROCESS_WGSL_FUNCTION = `
fn applyPixelArt(position: vec4f, scene: vec4f, params: vec4f) -> vec4f {
  let bayer = array<u32, 16>(${BAYER_4.map(value => value + "u").join(",")});
  let pixel = vec2u(position.xy);
  let threshold = (f32(bayer[(pixel.y % 4u) * 4u + pixel.x % 4u]) + 0.5) / 16.0 - 0.5;
  let steps = params.x - 1.0;
  var rgb = clamp(floor(clamp(scene.rgb, vec3f(0), vec3f(1)) * steps + 0.5 + threshold * params.y), vec3f(0), vec3f(steps)) / steps;
  rgb *= 1.0 - f32(pixel.y % 2u) * params.z;
  return vec4f(rgb, scene.a);
}`;
