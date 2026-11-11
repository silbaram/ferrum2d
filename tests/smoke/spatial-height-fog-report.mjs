import assert from "node:assert/strict";
import { decodePng } from "../../scripts/tools/pack-textures.mjs";
import { HEIGHT_FOG_CASES, HEIGHT_FOG_STATES, HEIGHT_FOG_TERRAIN, heightFogCamera } from "./spatial-height-fog-cases.mjs";
export { HEIGHT_FOG_STATES };
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),add=(a,b,s=1)=>a.map((v,i)=>v+s*b[i]);
const normalized=v=>v.map(x=>x/Math.hypot(...v));
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const decode=x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4;
const encode=x=>255*(x<=.0031308?x*12.92:1.055*x**(1/2.4)-.055);
// Independent midpoint quadrature, deliberately not the analytic shader formula.
export function numericalHeightFog(origin,receiver,viewDepth,fog){
 if(!fog)return 0;
 if(!fog.height)return Math.max(0,Math.min(1,(viewDepth-fog.start)/(fog.end-fog.start)));
 const {baseHeight=0,density=.01,falloff=.02}=fog.height;
 const begin=fog.start/viewDepth,end=Math.min(1,fog.end/viewDepth);if(begin>=end)return 0;
 const distance=Math.hypot(...receiver.map((v,i)=>v-origin[i]));let integral=0;
 const steps=4096;
 for(let i=0;i<steps;i++){const t=begin+(i+.5)*(end-begin)/steps,y=origin[1]+(receiver[1]-origin[1])*t;integral+=density*Math.exp(-falloff*Math.max(y-baseHeight,0));}
 return -Math.expm1(-integral*distance*(end-begin)/steps);
}
export function heightFogReferenceSurface(camera,width,height,x,y,pixelArt,presentation=[0,0,1,1,0,0]){
 const eye=camera.slice(17,20),forward=normalized(add(camera.slice(20,23),eye,-1)),right=normalized(cross(forward,[0,1,0])),up=cross(right,forward),perspective=camera[16]===1;
 const left=Math.round(width*presentation[0]),top=Math.round(height*presentation[1]),displayWidth=Math.round(width*presentation[2]),displayHeight=Math.round(height*presentation[3]);
 if(x<left||x>=left+displayWidth||y<top||y>=top+displayHeight)return;
 x-=left;y-=top;width=displayWidth;height=displayHeight;
 const w=pixelArt?.width??width,h=pixelArt?.height??height;
 const u=(Math.floor((x+.5)*w/width)+.5)/w*2-1,v=1-(Math.floor((y+.5)*h/height)+.5)/h*2;
 const half=perspective?Math.tan(camera[23]/2):camera[23]/2;
 const offset=add(right.map(v=>v*u*camera[26]/camera[27]*half),up,v*half);
 const origin=perspective?eye:add(eye,offset),ray=perspective?normalized(add(forward,offset)):forward;
 let closest;
 for(const t of HEIGHT_FOG_TERRAIN){
  const lo=[t.x,t.baseElevation,-t.y-t.depth],hi=[t.x+t.width,t.elevation,-t.y];let entry=-Infinity,exit=Infinity,axis=-1;
  for(let i=0;i<3;i++){
   if(Math.abs(ray[i])<1e-12){if(origin[i]<lo[i]||origin[i]>hi[i]){exit=-Infinity;break;}continue;}
   const a=(lo[i]-origin[i])/ray[i],b=(hi[i]-origin[i])/ray[i];if(Math.min(a,b)>entry){entry=Math.min(a,b);axis=i;}exit=Math.min(exit,Math.max(a,b));
  }
  if(entry<0||entry>exit||closest&&entry>=closest.distance)continue;
  const hit=add(origin,ray,entry),margin=Math.min(...hit.flatMap((v,i)=>i===axis?[]:[v-lo[i],hi[i]-v]));
  closest={distance:entry,origin,hit,z:dot(add(hit,eye,-1),forward),margin};
 }
 return closest;
}
export async function auditSpatialHeightFogPixels(rows,readImage,projection){
 const byName=new Map(rows.map(r=>[r.name,r]));assert.equal(byName.size,rows.length,"Duplicate height fog state");
 assert.deepEqual([...byName.keys()], [...HEIGHT_FOG_STATES,...(byName.has("recovered")?["recovered"]:[])],"Missing/unexpected height fog state");
 const images=new Map();for(const r of rows){const img=decodePng(await readImage(r.image));assert.equal(img.width,r.width);assert.equal(img.height,r.height);images.set(r.name,img);
  assert(r.stats.terrainTriangleCount>0,"Missing height fog geometry");assert.equal(r.warm.shadowPassCount,0,"Height fog warm shadow redraw");assert.equal(r.warm.shadowUploadBytes,0);assert(Number.isFinite(r.warm.drawCalls),"Missing height fog warm draw budget");
 }
 const equal=(a,b)=>{const x=images.get(a).pixels,y=images.get(b).pixels;assert.equal(x.length,y.length);assert(x.every((v,i)=>Math.abs(v-y[i])<=1),`Height fog stale/restore image ${a}/${b}`);};
 for(const route of ["legacy","separated","ao"]){equal(`${route}-plain`,`${route}-zero`);equal(`${route}-plain`,`${route}-beyond`);}
 equal("pixel-plain","pixel-zero");for(const name of ["saved","fresh-restore","re-enabled",...(byName.has("recovered")?["recovered"]:[])])equal("ao-default",name);equal("ao-plain","off");
 const metrics={};
 for(const c of HEIGHT_FOG_CASES){
  const r=byName.get(c.name),base=byName.get(c.baseline),a=images.get(c.name),b=images.get(c.baseline),expectedCamera=heightFogCamera(projection,c.direction);
  assert.equal(r.camera.length,28);assert.equal(r.camera[16],projection==="perspective"?1:0);
  const expected=[expectedCamera.position.x,expectedCamera.position.elevation,-expectedCamera.position.y,expectedCamera.target.x,expectedCamera.target.elevation,-expectedCamera.target.y];
  for(let i=0;i<6;i++)assert(Math.abs(r.camera[17+i]-expected[i])<(c.environment.pixelArt?2:.0001),"Height fog camera fixture drift");
  assert(r.camera.every(Number.isFinite));
  if(c.environment.fog?.height){assert.equal(r.environmentVersion,13,"Height fog missing native v13");
   assert.equal(r.resources.textureCount,base.resources.textureCount,"Height fog allocated a texture");assert.equal(r.resources.bufferCount,base.resources.bufferCount,"Height fog allocated a buffer");assert.equal(r.warm.drawCalls,base.warm.drawCalls,"Height fog added a pass");}
  let samples=0,maxError=0,signal=0;const heights=[];
  for(let gy=2;gy<=18;gy++)for(let gx=2;gx<=18;gx++){
   const x=Math.floor(a.width*gx/20),y=Math.floor(a.height*gy/20),s=heightFogReferenceSurface(r.camera,a.width,a.height,x,y,c.environment.pixelArt,r.presentation);
   if(!s||s.margin<5||s.z<1)continue;
   const offset=(y*a.width+x)*4;assert.equal(b.pixels[offset+3],255,"Height fog baseline is blank");
   // Baseline must contain the authored material, not a blank/replaced image.
   assert(b.pixels[offset]>15&&b.pixels[offset+1]>20&&b.pixels[offset+2]>25,"Missing height fog material signal");
   const alpha=numericalHeightFog(s.origin,s.hit,s.z,c.environment.fog);heights.push(s.hit[1]);
   for(let channel=0;channel<3;channel++){
    const original=b.pixels[offset+channel],expected=c.environment.fog?encode(decode(original/255)*(1-alpha)+c.environment.fog.color[channel]*alpha):original;
    const error=Math.abs(a.pixels[offset+channel]-expected);maxError=Math.max(maxError,error);signal=Math.max(signal,Math.abs(a.pixels[offset+channel]-original));
    assert(error<=3,`Height fog integral mismatch ${c.name} (${x},${y}) channel ${channel}: got ${a.pixels[offset+channel]}, expected ${expected.toFixed(3)}, alpha ${alpha.toFixed(5)}, receiver ${s.hit}`);
   }samples++;
  }
  assert(samples>=40,`Insufficient height fog receiver samples ${c.name}: ${samples}`);
  if(c.environment.fog?.height&&!["zero","thin","beyond"].some(n=>c.name.endsWith(n)))assert(signal>8,`Missing height fog response ${c.name}`);
  metrics[c.name]={samples,maxError,signal,minHeight:Math.min(...heights),maxHeight:Math.max(...heights)};
 }
 return{states:rows.length,quadratureSteps:4096,metrics};
}
