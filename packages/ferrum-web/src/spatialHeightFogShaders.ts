// Integrate exp(-falloff * max(height-base, 0)) over the visible ray segment.
// Sorting the endpoint heights avoids exp of a positive/overflowing argument.
// The Taylor branch removes cancellation for horizontal rays and falloff=0.
export const HEIGHT_FOG_GLSL = `
float fogExponentialMean(float x){
 if(x<.01)return 1.-x*.5+x*x/6.-x*x*x/24.;
 return (1.-exp(-min(x,80.)))/x;
}
float heightFogAmount(float z,float rayLength,float originHeight,float receiverHeight,vec4 fog,vec2 range){
 if(fog.z<=0. || z<=range.x)return 0.;
 float begin=range.x/z,end=min(range.y/z,1.);
 float a=mix(originHeight,receiverHeight,begin)-fog.y,b=mix(originHeight,receiverHeight,end)-fog.y;
 float lo=min(a,b),hi=max(a,b),mean=1.;
 if(hi>0.){
  float above=exp(-min(max(lo,0.)*fog.w,80.))*fogExponentialMean((hi-max(lo,0.))*fog.w);
  mean=lo<0.?mix(1.,above,hi/(hi-lo)):above;
 }
 float opticalDepth=min(fog.z*rayLength*(end-begin)*mean,80.);
 // Also preserve very thin fog instead of subtracting two nearly equal floats.
 return opticalDepth<.01?opticalDepth*fogExponentialMean(opticalDepth):1.-exp(-opticalDepth);
}`;
export const HEIGHT_FOG_WGSL = `
fn fogExponentialMean(x:f32)->f32{
 if(x<.01){return 1.-x*.5+x*x/6.-x*x*x/24.;}
 return (1.-exp(-min(x,80.)))/x;
}
fn heightFogAmount(z:f32,rayLength:f32,originHeight:f32,receiverHeight:f32,fog:vec4f,range:vec2f)->f32{
 if(fog.z<=0. || z<=range.x){return 0.;}
 let begin=range.x/z;let end=min(range.y/z,1.);
 let a=mix(originHeight,receiverHeight,begin)-fog.y;let b=mix(originHeight,receiverHeight,end)-fog.y;
 let lo=min(a,b);let hi=max(a,b);var mean=1.;
 if(hi>0.){
  let above=exp(-min(max(lo,0.)*fog.w,80.))*fogExponentialMean((hi-max(lo,0.))*fog.w);
  mean=above;if(lo<0.){mean=mix(1.,above,hi/(hi-lo));}
 }
 let opticalDepth=min(fog.z*rayLength*(end-begin)*mean,80.);
 if(opticalDepth<.01){return opticalDepth*fogExponentialMean(opticalDepth);}
 return 1.-exp(-opticalDepth);
}`;
