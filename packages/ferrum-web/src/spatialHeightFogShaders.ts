// Integrate exp(-falloff * max(height-base, 0)) over the visible ray segment.
// Sorting the endpoint heights avoids exp of a positive/overflowing argument.
// Callers supply heights relative to the fog base before camera reconstruction.
// The Taylor branch removes cancellation for horizontal rays and falloff=0.
export const HEIGHT_FOG_GLSL = `
float fogExponentialMean(float x){
 if(x<.01)return 1.-x*.5+x*x/6.-x*x*x/24.;
 return (1.-exp(-min(x,80.)))/x;
}
float heightFogAmount(float z,float rayLength,float originOffset,float receiverOffset,vec4 fog,vec2 range){
 if(fog.z<=0. || z<=range.x)return 0.;
 // Subtract depths before normalization: adjacent far-depth floats can divide to the same value.
 float segmentDepth=min(range.y,z)-range.x;
 // Reconstruct relative to the zero-height crossing, or the lower positive endpoint.
 // This avoids subtracting nearly equal large heights at a clipped interval.
 float stop=min(range.y,z),slope=(receiverOffset-originOffset)/z,a=originOffset,b=receiverOffset;
 if(originOffset*receiverOffset<0.){
  float crossing=z*(originOffset/(originOffset-receiverOffset));
  a=slope*(range.x-crossing);b=slope*(stop-crossing);
 }else if(originOffset>0. || receiverOffset>0.){
  if(slope>=0.){a=originOffset+slope*range.x;b=originOffset+slope*stop;}
  else{a=receiverOffset-slope*(z-range.x);b=receiverOffset-slope*(z-stop);}
 }
 float lo=min(a,b),hi=max(a,b),mean=1.;
 if(hi>0.){
  float above=exp(-min(max(lo,0.)*fog.w,80.))*fogExponentialMean((hi-max(lo,0.))*fog.w);
  mean=lo<0.?(-lo+hi*above)/(hi-lo):above;
 }
 float opticalDepth=min(fog.z*(rayLength/z)*segmentDepth*mean,80.);
 // Also preserve very thin fog instead of subtracting two nearly equal floats.
 return opticalDepth<.01?opticalDepth*fogExponentialMean(opticalDepth):1.-exp(-opticalDepth);
}`;
export const HEIGHT_FOG_WGSL = `
fn fogExponentialMean(x:f32)->f32{
 if(x<.01){return 1.-x*.5+x*x/6.-x*x*x/24.;}
 return (1.-exp(-min(x,80.)))/x;
}
fn heightFogAmount(z:f32,rayLength:f32,originOffset:f32,receiverOffset:f32,fog:vec4f,range:vec2f)->f32{
 if(fog.z<=0. || z<=range.x){return 0.;}
 let segmentDepth=min(range.y,z)-range.x;
 let stop=min(range.y,z);let slope=(receiverOffset-originOffset)/z;var a=originOffset;var b=receiverOffset;
 if(originOffset*receiverOffset<0.){
  let crossing=z*(originOffset/(originOffset-receiverOffset));
  a=slope*(range.x-crossing);b=slope*(stop-crossing);
 }else if(originOffset>0. || receiverOffset>0.){
  if(slope>=0.){a=originOffset+slope*range.x;b=originOffset+slope*stop;}
  else{a=receiverOffset-slope*(z-range.x);b=receiverOffset-slope*(z-stop);}
 }
 let lo=min(a,b);let hi=max(a,b);var mean=1.;
 if(hi>0.){
  let above=exp(-min(max(lo,0.)*fog.w,80.))*fogExponentialMean((hi-max(lo,0.))*fog.w);
  mean=above;if(lo<0.){mean=(-lo+hi*above)/(hi-lo);}
 }
 let opticalDepth=min(fog.z*(rayLength/z)*segmentDepth*mean,80.);
 if(opticalDepth<.01){return opticalDepth*fogExponentialMean(opticalDepth);}
 return 1.-exp(-opticalDepth);
}`;
