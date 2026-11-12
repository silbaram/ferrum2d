import { SHAFT_PRECISION_CASES, shaftPrecisionReference, auditShaftPrecision } from "./spatial-light-shafts-precision-report.mjs";
import {test} from "node:test";
import assert from "node:assert/strict";
import {encodePngRgba,decodePng} from "../../scripts/tools/pack-textures.mjs";
import {SHAFT_CASES} from "./spatial-light-shafts-cases.mjs";
import {auditLightShaftPixels,shaftReference} from "./spatial-light-shafts-report.mjs";
const read=async image=>image;
const decode=x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4,encode=x=>Math.min(255,Math.round(255*(x<=.0031308?12.92*x:1.055*x**(1/2.4)-.055)));
function fixture(){
 const width=96,height=72,rows=[];
 for(const c of SHAFT_CASES){
  const env=c.environment,s=env.lightShafts,v=Array(632).fill(0),pixel=env.pixelArt,ao=!!env.ambientOcclusion,enabled=env.lighting.enabled!==false;
  v[0]=Number(enabled)|(pixel?16:0)|(ao?64:0);v[83]=Number(enabled);v[84]=0;v[85]=1;v[86]=0;v[87]=1;v.splice(88,3,1,.9,.7);v[91]=500;v[92]=512;v[94]=400;
  const direction=env.lighting.directional.direction,length=Math.hypot(direction.x,direction.y,direction.elevation);
  v.splice(84,3,direction.x/length,direction.elevation/length,-direction.y/length);
  if(pixel){v[80]=pixel.width;v[81]=pixel.height;}if(ao){v[132]=1;v[133]=1;}
  if(s&&enabled){v.splice(616,10,1,s.intensity??.5,s.density??.01,s.maxDistance??200,...(s.color??[1,1,1]),s.anisotropy??0,s.quality==="low"?4:2,s.quality==="low"?16:s.quality==="high"?48:32);}
  const active=v[616]&&v[617]>0&&v[618]>0,w=pixel?.width??width,h=pixel?.height??height,low=active?Math.ceil(w/v[624])*Math.ceil(h/v[624]):0,draws=active?1+Number(!ao):0,bytes=active?(low+Number(!ao)*w*h)*8:0;
  const camera=Array(16).fill(0).concat([0,0,90,150,0,20,-20,150,.1,800,width,height]),sunMatrix=[1/400,0,0,0,0,0,-1/500,0,0,-1/400,0,0,0,0,0,1];
  const row={name:c.name,width,height,camera,environment:v,sunMatrix,environmentVersion:14,presentation:[0,0,1,1,0,0],warm:{terrainTriangleCount:36,shadowPassCount:0,shadowUploadBytes:0,lightShaftDrawCalls:draws,lightShaftTextureBytes:bytes,lightShaftTexelFetchBudget:active?low*(v[625]+1)+w*h*(4+2*Number(!ao)):0,lightShaftSampleBudget:active?v[625]+1:0,effectDrawCalls:1+Number(ao)+draws,effectTextureBytes:w*h*(12+Number(ao)*16)+bytes}};
  const data=new Uint8Array(width*height*4);for(let i=0;i<data.length;i+=4)data.set([80,90,100,255],i);
  if(active)for(let gy=3;gy<=17;gy++)for(let gx=3;gx<=17;gx++){const x=Math.floor(width*gx/20),y=Math.floor(height*gy/20),ref=shaftReference(row,x,y);if(ref)for(let k=0;k<3;k++)data[(y*width+x)*4+k]=encode(decode([80,90,100][k]/255)+ref[k]);}
  row.image=encodePngRgba(width,height,data);rows.push(row);
 }
 for(const name of ["saved","fresh-restore","off","re-enabled"])rows.push({...rows.find(r=>r.name===(name==="off"?"plain":"balanced")),name});
 return rows;
}
test("light shafts independent ray-box reference accepts controlled images",async()=>{const result=await auditLightShaftPixels(fixture(),read);assert(result.metrics.balanced.samples>=20);assert(result.metrics.balanced.signal>8);});
test("light shafts oracle rejects missing effect, incorrect tint, stale restore and blank frames",async()=>{
 for(const [target,source]of [["balanced","plain"],["tinted","balanced"],["fresh-restore","plain"]]){const rows=fixture();rows.find(r=>r.name===target).image=rows.find(r=>r.name===source).image;await assert.rejects(auditLightShaftPixels(rows,read));}
 const rows=fixture();for(const r of rows)r.image=encodePngRgba(r.width,r.height,new Uint8Array(r.width*r.height*4));await assert.rejects(auditLightShaftPixels(rows,read));
});
test("light shafts oracle rejects missing states, absent costs, added passes and shadow redraw",async()=>{
 await assert.rejects(auditLightShaftPixels(fixture().slice(1),read),/states/);
 for(const mutate of [r=>delete r.warm.lightShaftTextureBytes,r=>r.warm.lightShaftSampleBudget=0,r=>r.warm.effectDrawCalls++,r=>r.warm.shadowPassCount=1,r=>r.environmentVersion=13]){const rows=fixture();mutate(rows.find(r=>r.name==="balanced"));await assert.rejects(auditLightShaftPixels(rows,read));}
});
test("light shafts oracle rejects overwriting an empty scene background",async()=>{
 const rows=fixture(),row=rows.find(r=>r.name==="thin"),image=decodePng(row.image);
 let changed=false;
 for(let gy=3;gy<=17&&!changed;gy++)for(let gx=3;gx<=17&&!changed;gx++){
  const x=Math.floor(row.width*gx/20),y=Math.floor(row.height*gy/20);
  if(shaftReference(row,x,y)?.background){image.pixels.set([0,0,0,255],(y*row.width+x)*4);changed=true;}
 }
 assert(changed,"Fixture must cover empty background");row.image=encodePngRgba(row.width,row.height,image.pixels);
 await assert.rejects(auditLightShaftPixels(rows,read),/integral thin/);
});

const controlledPrecision = () => Object.fromEntries(["webgl2","webgpu"].map(backend => [backend,SHAFT_PRECISION_CASES.map(c=>({name:c.name,amount:shaftPrecisionReference(c)}))]));
test("packed shaft precision oracle accepts the closed integral and rejects cancellation, missing thin scattering and non-unit sun phase",()=>{
 assert.equal(auditShaftPrecision(controlledPrecision()).webgl2.cases,30);
 for(const [name,amount] of [["distant-16",.4947322],["thin-16",0],["sun-normalization-16",.00053914]]){
  const result=controlledPrecision();result.webgpu.find(r=>r.name===name).amount=amount;assert.throws(()=>auditShaftPrecision(result),/Light shaft precision/);
 }
 const missing=controlledPrecision();missing.webgl2.pop();assert.throws(()=>auditShaftPrecision(missing));
 const invalid=controlledPrecision();invalid.webgl2[0].amount=NaN;assert.throws(()=>auditShaftPrecision(invalid),/Light shaft precision/);
});
