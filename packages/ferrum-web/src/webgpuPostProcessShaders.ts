import { pixelPostProcessWgsl } from "./pixelPostProcessShaders.js";

/** Legacy encoded scene colors. Sampling uses GL-style bottom-origin UVs. */
export function texturePostProcessWgsl(linearWorking = false): string { return `
struct Settings { params: vec4f, color: vec4f, effect: vec4f };
@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var<uniform> settings: Settings;
@group(0) @binding(2) var sceneSampler: sampler;
@vertex fn vertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let positions = array<vec2f, 3>(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
  return vec4f(positions[index], 0, 1);
}
fn sampleScene(uv: vec2f) -> vec4f {
  // Finite f32 settings can add to Infinity (glitch chroma + offset). Resolve
  // the edge address explicitly, like the GL path, before texture sampling.
  let bounded = clamp(uv, vec2f(0.0), vec2f(1.0));
  return textureSampleLevel(image, sceneSampler, vec2f(bounded.x, 1.0 - bounded.y), 0.0);
}
fn bandNoise(band: u32, seed: f32) -> f32 {
  var value = band ^ bitcast<u32>(seed);
  value = (value ^ (value >> 16u)) * 0x7feb352du;
  value = (value ^ (value >> 15u)) * 0x846ca68bu;
  value = value ^ (value >> 16u);
  return f32(value >> 8u) / 16777216.0;
}
${pixelPostProcessWgsl(linearWorking)}
@fragment fn fragment(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let dimensions = vec2f(textureDimensions(image));
  let uv = vec2f(position.x / dimensions.x, 1.0 - position.y / dimensions.y);
  let params = settings.params;
  let kind = u32(settings.effect.x);
  if (kind == 6u) { return applyPixelArt(position, textureLoad(image, vec2i(position.xy), 0), params); }
  let scene = sampleScene(uv);
  if (kind == 2u) {
    var sum = vec3f(0.0); var weightSum = 0.0;
    for (var y = -2; y <= 2; y++) {
      for (var x = -2; x <= 2; x++) {
        let delta = vec2f(f32(x), f32(y));
        let color = sampleScene(clamp(uv + delta / dimensions * params.z, vec2f(0.0), vec2f(1.0))).rgb;
        let luma = dot(color, vec3f(0.2126, 0.7152, 0.0722));
        // threshold=1 means no sample exceeds the threshold, without smoothstep(1,1).
        var bright = 0.0;
        if (params.x < 1.0) { bright = smoothstep(params.x, 1.0, luma); }
        let weight = 1.0 / (1.0 + length(delta));
        sum += color * bright * weight; weightSum += weight;
      }
    }
    return vec4f(scene.rgb + sum / weightSum * params.y, scene.a);
  }
  if (kind == 3u) {
    let centered = uv * 2.0 - 1.0;
    let warped = uv + centered * dot(centered, centered) * params.x;
    if (any(warped < vec2f(0.0)) || any(warped > vec2f(1.0))) { return vec4f(0.0,0.0,0.0,1.0); }
    let center = sampleScene(warped);
    let color = vec3f(sampleScene(warped + vec2f(params.z,0.0)).r, center.g, sampleScene(warped - vec2f(params.z,0.0)).b);
    let scanline = 1.0 - params.y * (0.5 + 0.5 * sin((dimensions.y - position.y) * 3.14159265));
    return vec4f(color * scanline, center.a);
  }
  if (kind == 4u) {
    var edge = 1.0;
    if (params.y > 0.0) {
      let inner = max(0.0, params.y - params.z);
      let distanceFromCenter = distance(uv, vec2f(0.5));
      // A positive JSON softness can collapse the two bounds in f32 arithmetic.
      edge = step(params.y, distanceFromCenter);
      if (inner < params.y) { edge = smoothstep(inner, params.y, distanceFromCenter); }
    }
    return vec4f(mix(scene.rgb, settings.color.rgb${linearWorking ? " * scene.a" : ""}, edge * params.x * settings.color.a), scene.a);
  }
  let band = u32(floor((dimensions.y - position.y) * 48.0 / dimensions.y));
  let offset = (bandNoise(band,params.z) - 0.5) * params.x;
  let shifted = clamp(uv + vec2f(offset,0.0),vec2f(0.0),vec2f(1.0));
  let chroma = params.y + abs(offset) * 0.25;
  let base = sampleScene(shifted);
  return vec4f(sampleScene(shifted + vec2f(chroma,0.0)).r,base.g,sampleScene(shifted - vec2f(chroma,0.0)).b,base.a);
}`;
}
export const TEXTURE_POST_PROCESS_WGSL = texturePostProcessWgsl();
