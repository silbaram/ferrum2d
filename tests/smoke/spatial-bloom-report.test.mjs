import { test } from 'node:test';
import { rejects } from 'node:assert/strict';
import { encodePngRgba } from '../../scripts/tools/pack-textures.mjs';
import { auditSpatialBloomPixels, WIDE_BLOOM_STATES, WIDE_BLOOM_WORK_CEILINGS } from './spatial-bloom-report.mjs';
import { wideBloomReference } from './spatial-bloom-reference.mjs';
const read=async value=>value;
function fixture(){
 const hdr=new Uint8Array(128*128*4),sharp=new Uint8Array(hdr.length);for(let i=3;i<hdr.length;i+=4)hdr[i]=sharp[i]=255;
 for(let y=60;y<68;y++)for(let x=60;x<68;x++)for(let c=0;c<3;c++){hdr[(y*128+x)*4+c]=137;sharp[(y*128+x)*4+c]=255;}
 const sharpPng=encodePngRgba(128,128,sharp),hdrPng=encodePngRgba(128,128,hdr);
 const rows=WIDE_BLOOM_STATES.map(name=>({name,width:128,height:128,image:name==='hdr-reference'?hdrPng:sharpPng,allocated:{textures:0,buffers:0,groups:0,pipelines:0},resources:{renderTargetCount:1},frameWork:{spatialBloomDrawCalls:0,spatialBloomTextureBytes:0,spatialBloomTexelFetchBudget:0},workBudget:{passed:true,violations:[]}}));
 for(const quality of ['low','balanced','high']){
  const [draws,bytes,fetches]=WIDE_BLOOM_WORK_CEILINGS[1][quality],image=encodePngRgba(128,128,wideBloomReference(hdr,128,128,{quality}));
  for(const name of [quality,quality+'-warm'])Object.assign(rows.find(r=>r.name===name),{image,resources:{renderTargetCount:draws},frameWork:{spatialBloomDrawCalls:draws,spatialBloomTextureBytes:bytes,spatialBloomTexelFetchBudget:fetches}});
 }
 return {rows,sharpPng,hdrPng};
}
test('Bloom PNG gate rejects empty world evidence even when state and budget flags claim success',async()=>{
 const {rows}=fixture(),blank=new Uint8Array(128*128*4),png=encodePngRgba(128,128,blank);
 await rejects(auditSpatialBloomPixels(rows.map(r=>({...r,image:png})),read,1),/HDR source signal/);
 await rejects(auditSpatialBloomPixels(rows.slice(1),read,1),/state matrix/);
});
test('Bloom PNG gate rejects absent halo, missing measurements and warm allocations',async()=>{
 const missing=fixture();missing.rows.find(r=>r.name==='low').frameWork.spatialBloomTextureBytes=undefined;
 await rejects(auditSpatialBloomPixels(missing.rows,read,1),/Measured Bloom work/);
 const cold=fixture();cold.rows.find(r=>r.name==='low-warm').allocated.buffers=1;
 await rejects(auditSpatialBloomPixels(cold.rows,read,1),/Warm Bloom allocated/);
 const absent=fixture();for(const row of absent.rows)if(row.name==='low'||row.name==='low-warm')row.image=absent.sharpPng;
 await rejects(auditSpatialBloomPixels(absent.rows,read,1),/CPU signal reference|halo/);
});
