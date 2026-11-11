import { sceneCompositionDiagnosticError } from "./diagnostics.js";
import type { SpatialEnvironmentSpec } from "./spatialEnvironment.js";

/** Sun-only bounded PCSS. Presence overrides lighting.shadowFilter for the sun. */
export interface SpatialSunPcssSpec {
  /** Angular radius in degrees, 0..5 (default 0.5). Zero gives a hard sun shadow. */
  angularRadius?: number;
  /** Search/filter radius cap in shadow-map texels, 1..32 (default 16). */
  maxRadiusTexels?: number;
}

export function requestsSpatialSunPcss(spec?: SpatialEnvironmentSpec | null): boolean {
  return spec?.lighting?.directional?.shadows?.pcss !== undefined;
}
export function supportsSpatialSunPcss(engine: unknown): boolean {
  const native = engine as { spatial_sun_pcss_abi_version?: () => number } | undefined;
  return typeof native?.spatial_sun_pcss_abi_version === "function" && native.spatial_sun_pcss_abi_version() === 1;
}
export function resolveSpatialSunPcss(value: unknown, path: string): SpatialSunPcssSpec {
  const fail = (at: string, message: string): never => { throw sceneCompositionDiagnosticError(at, message); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail(path, "must be a PCSS object");
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) if (key !== "angularRadius" && key !== "maxRadiusTexels") fail(`${path}.${key}`, "is not supported");
  const scalar = (key: string, fallback: number, min: number, max: number): number => {
    const n = input[key] === undefined ? fallback : input[key];
    if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max) return fail(`${path}.${key}`, `must be finite in ${min}..${max}`);
    return n;
  };
  return { angularRadius: scalar("angularRadius", 0.5, 0, 5), maxRadiusTexels: scalar("maxRadiusTexels", 16, 1, 32) };
}
export function validSpatialSunPcss(v: Float32Array): boolean {
  if (v[592] === 0) return v.subarray(593, 600).every(x => x === 0);
  return v[592] === 1 && v[83] === 1 && v[92] > 0 && v[593] >= 0 && v[593] <= 5
    && v[594] >= 1 && v[594] <= 32 && v.subarray(595, 600).every(x => x === 0);
}
/** Converts a normalized orthographic depth gap to a penumbra radius in texels. */
export function spatialSunPcssScale(v?: Float32Array): number {
  return v?.[592] === 1 ? Math.tan(v[593] * Math.PI / 180) * v[91] * v[92] / v[94] : 0;
}

// A fixed disk with a center tap. Generated once; no screen/frame-dependent noise or textures.
// Both shader languages consume exactly the same coordinates and bounded loop counts.
const disk = (count: number): string[] => Array.from({ length: count }, (_, i) => {
  const radius = Math.sqrt(i / (count - 1)), angle = i * 2.399963229728653;
  return `${(Math.cos(angle) * radius).toFixed(8)},${(Math.sin(angle) * radius).toFixed(8)}`;
});
const blockers = disk(16), filters = disk(32);
export const SUN_PCSS_DISKS_GLSL = `
const vec2 SUN_BLOCKERS[16]=vec2[16](${blockers.map(p => `vec2(${p})`).join(",")});
const vec2 SUN_FILTER[32]=vec2[32](${filters.map(p => `vec2(${p})`).join(",")});`;
export const SUN_PCSS_DISKS_WGSL = `
const SUN_BLOCKERS=array<vec2f,16>(${blockers.map(p => `vec2f(${p})`).join(",")});
const SUN_FILTER=array<vec2f,32>(${filters.map(p => `vec2f(${p})`).join(",")});`;

export const SUN_PCSS_GLSL = SUN_PCSS_DISKS_GLSL + `
float sunPcssVisibility(vec3 q,vec2 size,vec2 gradient,float bias){
 vec2 center=q.xy*size;
 if(u_sunPcss.y<=0.)return sunCompare(floor(center),size,q,gradient,bias);
 float searchRadius=min(u_sunPcss.z,q.z*u_sunPcss.y),gap=0.,count=0.;
 for(int i=0;i<16;i++){
  vec2 pixel=floor(center+SUN_BLOCKERS[i]*searchRadius);
  if(any(lessThan(pixel,vec2(0.))) || any(greaterThanEqual(pixel,size)))continue;
  vec2 uv=(pixel+.5)/size;float expected=q.z+dot(gradient,uv-q.xy);
  if(expected<0. || expected>1.)continue;
  float depth=texelFetch(u_sunMap,ivec2(pixel),0).r;
  if(depth+bias<expected){gap+=expected-depth-bias;count+=1.;}
 }
 if(count==0.)return 1.;
 float radius=min(u_sunPcss.z,gap/count*u_sunPcss.y);
 if(radius<.5)return sunCompare(floor(center),size,q,gradient,bias);
 float visibility=0.;
 for(int i=0;i<32;i++){
  vec2 pixel=floor(center+SUN_FILTER[i]*radius);
  if(any(lessThan(pixel,vec2(0.))) || any(greaterThanEqual(pixel,size))){visibility+=1.;continue;}
  visibility+=sunCompare(pixel,size,q,gradient,bias);
 }
 return visibility/32.;
}`;
export const SUN_PCSS_WGSL = SUN_PCSS_DISKS_WGSL + `
fn sunPcssVisibility(q:vec3f,size:vec2u,gradient:vec2f,bias:f32)->f32{
 let center=q.xy*vec2f(size);
 if(env.sunPcss.y<=0.){return sunCompare(vec2i(floor(center)),size,q,gradient,bias);}
 let searchRadius=min(env.sunPcss.z,q.z*env.sunPcss.y);var gap=0.;var count=0.;
 for(var i=0;i<16;i++){
  let pixel=vec2i(floor(center+SUN_BLOCKERS[i]*searchRadius));
  if(any(pixel<vec2i(0)) || any(pixel>=vec2i(size))){continue;}
  let uv=(vec2f(pixel)+.5)/vec2f(size);let expected=q.z+dot(gradient,uv-q.xy);
  if(expected<0. || expected>1.){continue;}
  let depth=textureLoad(sunMap,vec2i(pixel.x,i32(size.y)-1-pixel.y),0);
  if(depth+bias<expected){gap+=expected-depth-bias;count+=1.;}
 }
 if(count==0.){return 1.;}
 let radius=min(env.sunPcss.z,gap/count*env.sunPcss.y);
 if(radius<.5){return sunCompare(vec2i(floor(center)),size,q,gradient,bias);}
 var visibility=0.;
 for(var i=0;i<32;i++){
  let pixel=vec2i(floor(center+SUN_FILTER[i]*radius));
  if(any(pixel<vec2i(0)) || any(pixel>=vec2i(size))){visibility+=1.;continue;}
  visibility+=sunCompare(pixel,size,q,gradient,bias);
 }
 return visibility/32.;
}`;
