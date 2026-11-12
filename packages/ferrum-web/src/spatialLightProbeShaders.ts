/** Shared policy: normalize overlapping colors, use strongest smooth influence as coverage.
 * Dividing by max(total, tiny) is safe even for fragments outside all probe spheres.
 */
export const LIGHT_PROBES_GLSL = `
uniform int u_probeCount;
uniform vec4 u_probePosition[8],u_probeColor[8];
vec3 probeFill(vec3 world,vec3 fallback){
 vec3 weighted=vec3(0.);float total=0.,coverage=0.;
 for(int i=0;i<8;i++){
  if(i>=u_probeCount)break;
  float t=clamp(1.-length(world-u_probePosition[i].xyz)/u_probePosition[i].w,0.,1.);
  float weight=t*t*(3.-2.*t);
  weighted+=u_probeColor[i].rgb*u_probeColor[i].w*weight;
  total+=weight;coverage=max(coverage,weight);
 }
 return mix(fallback,weighted/max(total,1e-20),coverage);
}`;
export const LIGHT_PROBES_WGSL = `
fn probeFill(world:vec3f,fallback:vec3f)->vec3f{
 var weighted=vec3f(0.);var total=0.;var coverage=0.;
 for(var i=0u;i<8u;i++){
  if(i>=u32(env.probes.y)){break;}
  let position=env.probeValues[i*2u];let color=env.probeValues[i*2u+1u];
  let t=clamp(1.-length(world-position.xyz)/position.w,0.,1.);
  let weight=t*t*(3.-2.*t);
  weighted+=color.rgb*color.w*weight;
  total+=weight;coverage=max(coverage,weight);
 }
 return mix(fallback,weighted/max(total,1e-20),coverage);
}`;
