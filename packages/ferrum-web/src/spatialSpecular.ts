/** Bounded non-metallic direct GGX lobe on the existing Lambert lighting units.
 * Effective roughness >= .12 and lobe <=16 keep even 33*64 light units within float16.
 * Ambient/hemisphere remain diffuse; no IBL, metal, transmission or BLEND is implied.
 */
export const SPATIAL_SPECULAR_GLSL = `
vec3 directSpecular(vec3 n,vec3 light,vec3 view,vec3 f0,float roughness){
 float nl=max(dot(n,light),0.),nv=max(dot(n,view),0.);vec3 halfVector=light+view;
 if(nl<=0. || nv<=0. || length(halfVector)<.000001)return vec3(0.);
 vec3 h=normalize(halfVector);float nh=max(dot(n,h),0.),vh=clamp(dot(view,h),0.,1.);
 float r=clamp(roughness,.12,1.),a=r*r,a2=a*a,d=nh*nh*(a2-1.)+1.;
 float distribution=a2/(3.14159265359*d*d),k=(r+1.)*(r+1.)*.125;
 float geometry=nl/(nl*(1.-k)+k)*nv/(nv*(1.-k)+k);
 vec3 fresnel=f0+(vec3(1.)-f0)*pow(1.-vh,5.);
 return clamp(distribution*geometry*fresnel/max(4.*nv,.00001),vec3(0.),vec3(16.));
}`;

export const SPATIAL_SPECULAR_WGSL = `
fn directSpecular(n:vec3f,light:vec3f,view:vec3f,f0:vec3f,roughness:f32)->vec3f{
 let nl=max(dot(n,light),0.);let nv=max(dot(n,view),0.);let halfVector=light+view;
 if(nl<=0. || nv<=0. || length(halfVector)<.000001){return vec3f(0.);}
 let h=normalize(halfVector);let nh=max(dot(n,h),0.);let vh=clamp(dot(view,h),0.,1.);
 let r=clamp(roughness,.12,1.);let a=r*r;let a2=a*a;let d=nh*nh*(a2-1.)+1.;
 let distribution=a2/(3.14159265359*d*d);let k=(r+1.)*(r+1.)*.125;
 let geometry=nl/(nl*(1.-k)+k)*nv/(nv*(1.-k)+k);
 let fresnel=f0+(vec3f(1.)-f0)*pow(1.-vh,5.);
 return clamp(distribution*geometry*fresnel/max(4.*nv,.00001),vec3f(0.),vec3f(16.));
}`;
