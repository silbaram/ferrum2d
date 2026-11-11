import { test } from "node:test";
import assert from "node:assert/strict";
import { encodePngRgba } from "../../scripts/tools/pack-textures.mjs";
import { auditSpatialHeightFogPixels, numericalHeightFog, heightFogReferenceSurface } from "./spatial-height-fog-report.mjs";
import { HEIGHT_FOG_CASES, heightFogCamera } from "./spatial-height-fog-cases.mjs";
const read=async x=>Buffer.from(x),cache=new Map();
function fixture(projection="orthographic"){
 if(cache.has(projection))return structuredClone(cache.get(projection));
 const width=80,height=60,rows=[];
 const decode=x=>((x+.055)/1.055)**2.4,encode=x=>Math.round(255*(1.055*x**(1/2.4)-.055));
 for(const c of HEIGHT_FOG_CASES){
  const spec=heightFogCamera(projection,c.direction),camera=Array(16).fill(0).concat([projection==="perspective"?1:0,0,spec.position.elevation,150,0,spec.target.elevation,0,projection==="perspective"?50*Math.PI/180:160,.1,1000,width,height]);
  const baseColor=c.environment.lighting&&c.environment.ambientOcclusion?[40,60,80]:[80,100,120];
  const data=new Uint8Array(width*height*4);for(let i=0;i<data.length;i+=4)data.set([...baseColor,255],i);
  for(let gy=2;gy<=18;gy++)for(let gx=2;gx<=18;gx++){
   const x=Math.floor(width*gx/20),y=Math.floor(height*gy/20),s=heightFogReferenceSurface(camera,width,height,x,y,c.environment.pixelArt);if(!s)continue;
   const a=numericalHeightFog(s.origin,s.hit,s.z,c.environment.fog);
   for(let channel=0;channel<3;channel++)data[(y*width+x)*4+channel]=c.environment.fog?encode(decode(baseColor[channel]/255)*(1-a)+c.environment.fog.color[channel]*a):baseColor[channel];
  }
  rows.push({name:c.name,width,height,camera,environmentVersion:13,stats:{terrainTriangleCount:30,drawCalls:2},warm:{shadowPassCount:0,shadowUploadBytes:0,drawCalls:2},resources:{textureCount:3,bufferCount:3},image:encodePngRgba(width,height,data)});
 }
 for(const name of ["saved","fresh-restore","off","re-enabled","recovered"])rows.push({...structuredClone(rows.find(r=>r.name===(name==="off"?"ao-plain":"ao-default"))),name});
 cache.set(projection,rows);return structuredClone(rows);
}
test("height fog numerical oracle agrees with uniform Beer-Lambert extinction and empty segments",()=>{
 const fog={color:[1,1,1],start:20,end:50,height:{density:.01,falloff:0}};
 assert(Math.abs(numericalHeightFog([0,40,0],[0,40,100],100,fog)-(1-Math.exp(-.3)))<1e-12);
 assert.equal(numericalHeightFog([0,0,0],[0,0,10],10,fog),0);
});
test("height fog PNG oracle accepts numerical controls in both projections",async()=>{
 for(const projection of ["orthographic","perspective"]){const result=await auditSpatialHeightFogPixels(fixture(projection),read,projection);assert(result.metrics["ao-default"].samples>=40);}
});
test("height fog audit rejects blank frames, ignored density/falloff and stale restore",async()=>{
 const blank=fixture().map(r=>({...r,image:encodePngRgba(r.width,r.height,new Uint8Array(r.width*r.height*4))}));await assert.rejects(auditSpatialHeightFogPixels(blank,read,"orthographic"),/blank|material|AO signal/);
 for(const [target,source]of [["legacy-default","legacy-plain"],["ao-steep","ao-uniform"],["separated-clipped","separated-default"],["fresh-restore","ao-plain"],["pixel-zero","pixel-default"]]){
  const rows=fixture();rows.find(r=>r.name===target).image=rows.find(r=>r.name===source).image;await assert.rejects(auditSpatialHeightFogPixels(rows,read,"orthographic"),/mismatch|stale/);
 }
});
test("height fog audit rejects missing states, warm redraw, ABI drift and extra resources",async()=>{
 await assert.rejects(auditSpatialHeightFogPixels(fixture().slice(1),read,"orthographic"),/state/);
 for(const mutate of [r=>r.warm.shadowPassCount=1,r=>r.environmentVersion=12,r=>r.resources.textureCount=4,r=>delete r.resources.bufferCount,r=>r.warm.drawCalls=3,r=>r.camera[18]=0]){
  const rows=fixture();mutate(rows.find(r=>r.name==="ao-default"));await assert.rejects(auditSpatialHeightFogPixels(rows,read,"orthographic"));
 }
});
test("height fog audit rejects the perspective central-eye ray substituted for orthographic rays",async()=>{
 const rows=fixture(),wrong=fixture("perspective");rows.find(r=>r.name==="legacy-default").image=wrong.find(r=>r.name==="legacy-default").image;
 await assert.rejects(auditSpatialHeightFogPixels(rows,read,"orthographic"),/mismatch/);
});

test("height fog audit rejects an AO path with no actual indirect occlusion",async()=>{
 const rows=fixture();rows.find(r=>r.name==="separated-plain").image=rows.find(r=>r.name==="ao-plain").image;
 // Make identity controls agree so the failure specifically reaches the AO signal gate.
 for(const name of ["separated-zero","separated-beyond"])rows.find(r=>r.name===name).image=rows.find(r=>r.name==="ao-plain").image;
 await assert.rejects(auditSpatialHeightFogPixels(rows,read,"orthographic"),/AO signal/);
});
