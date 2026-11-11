import { spatialPcssDisk } from "./spatialPcssKernel.js";

const blockers = spatialPcssDisk(16), filters = spatialPcssDisk(32);
// Each sample returns (biased blocker distance, receiver-plane distance). Their ratio
// projects radial cube depth onto the central receiver plane before averaging.
// The search uses the existing near plane, and both disks are capped in tangent space.
export const POINT_PCSS_GLSL = `
const vec2 POINT_BLOCKERS[16]=vec2[16](${blockers.map(p => `vec2(${p})`).join(",")});
const vec2 POINT_FILTER[32]=vec2[32](${filters.map(p => `vec2(${p})`).join(",")});
float pointPcssVisibility(samplerCube shadowMap,float authoredBias,vec3 axis,float plane,float d,float radius,vec3 geometric,float bias,vec3 pcss,float size){
 if(pcss.y<=0.)return pointCompare(shadowMap,authoredBias,axis,plane,d,radius,geometric,bias);
 vec3 up=abs(axis.y)>.99?vec3(0.,0.,1.):vec3(0.,1.,0.);
 vec3 tangent=normalize(cross(axis,up)),bitangent=cross(axis,tangent);
 float nearPlane=clamp(radius*.0001,.001,.1),cap=pcss.z*2./size;
 float search=min(cap,pcss.y/nearPlane*max(d-nearPlane,0.)/d),ratio=0.,count=0.;
 for(int i=0;i<16;i++){
  vec2 offset=POINT_BLOCKERS[i]*search;
  vec3 ray=axis+tangent*offset.x+bitangent*offset.y;
  vec2 sampleDepth=pointSample(shadowMap,authoredBias,ray,plane,d,radius,geometric,bias);
  if(sampleDepth.x<sampleDepth.y){ratio+=sampleDepth.x/sampleDepth.y;count+=1.;}
 }
 if(count==0.)return 1.;
 ratio/=count;
 float spread=min(cap,pcss.y/d*(1.-ratio)/max(ratio,.000001));
 if(spread<1./size)return pointCompare(shadowMap,authoredBias,axis,plane,d,radius,geometric,bias);
 float visibility=0.;
 for(int i=0;i<32;i++){
  vec2 offset=POINT_FILTER[i]*spread;
  visibility+=pointCompare(shadowMap,authoredBias,axis+tangent*offset.x+bitangent*offset.y,plane,d,radius,geometric,bias);
 }
 return visibility/32.;
}`;
export const POINT_PCSS_WGSL = `
const POINT_BLOCKERS=array<vec2f,16>(${blockers.map(p => `vec2f(${p})`).join(",")});
const POINT_FILTER=array<vec2f,32>(${filters.map(p => `vec2f(${p})`).join(",")});
fn pointPcssVisibility(second:bool,authoredBias:f32,axis:vec3f,plane:f32,d:f32,radius:f32,geometric:vec3f,bias:f32,pcss:vec3f,size:f32)->f32{
 if(pcss.y<=0.){return pointCompare(second,authoredBias,axis,plane,d,radius,geometric,bias);}
 var up=vec3f(0.,1.,0.);if(abs(axis.y)>.99){up=vec3f(0.,0.,1.);}
 let tangent=normalize(cross(axis,up));let bitangent=cross(axis,tangent);
 let nearPlane=clamp(radius*.0001,.001,.1);let cap=pcss.z*2./size;
 let search=min(cap,pcss.y/nearPlane*max(d-nearPlane,0.)/d);var ratio=0.;var count=0.;
 for(var i=0;i<16;i++){
  let offset=POINT_BLOCKERS[i]*search;
  let ray=axis+tangent*offset.x+bitangent*offset.y;
  let sampleDepth=pointSample(second,authoredBias,ray,plane,d,radius,geometric,bias);
  if(sampleDepth.x<sampleDepth.y){ratio+=sampleDepth.x/sampleDepth.y;count+=1.;}
 }
 if(count==0.){return 1.;}
 ratio/=count;
 let spread=min(cap,pcss.y/d*(1.-ratio)/max(ratio,.000001));
 if(spread<1./size){return pointCompare(second,authoredBias,axis,plane,d,radius,geometric,bias);}
 var visibility=0.;
 for(var i=0;i<32;i++){
  let offset=POINT_FILTER[i]*spread;
  visibility+=pointCompare(second,authoredBias,axis+tangent*offset.x+bitangent*offset.y,plane,d,radius,geometric,bias);
 }
 return visibility/32.;
}`;
