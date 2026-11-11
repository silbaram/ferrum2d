import assert from 'node:assert/strict';
import { decodePng } from '../../scripts/tools/pack-textures.mjs';
import { wideBloomReference } from './spatial-bloom-reference.mjs';

export const WIDE_BLOOM_STATES=Object.freeze(['sharp','hdr-reference','wide-zero','gather','low','low-warm','balanced','balanced-warm','high','high-warm','exposure-before-output','fractional-radius','threshold-empty','wide-off','odd-hdr-reference','odd-wide','odd-stable-hdr-reference','odd-stable-wide','size-restored','pixel-art-hdr-reference','pixel-art-wide','before-restore','same-frame-repeat','hud','fresh-restore','recovered-wide','environment-cleared','after-clear-wide']);
export const WIDE_BLOOM_WORK_CEILINGS=Object.freeze({1:{low:[5,11264,85504],balanced:[6,44032,89600],high:[5,45056,104448]},2:{low:[6,44032,335360],balanced:[7,175104,351744],high:[6,176128,366592]}});
const difference=(a,b,tolerance=0)=>{assert.equal(a.length,b.length);let n=0;for(let i=0;i<a.length;i+=4)if([0,1,2,3].some(c=>Math.abs(a[i+c]-b[i+c])>tolerance))n++;return n;};

/** Decodes actual artifacts; successful state/metric flags alone cannot satisfy the pixel gate. */
export async function auditSpatialBloomPixels(rows,readImage,dpr){
 assert(WIDE_BLOOM_WORK_CEILINGS[dpr],'Unsupported Bloom audit DPR');
 assert.equal(rows.length,WIDE_BLOOM_STATES.length,'Incomplete Bloom state matrix');
 const byName=new Map(rows.map(row=>[row.name,row]));assert.equal(byName.size,rows.length,'Duplicate Bloom states');
 for(const name of WIDE_BLOOM_STATES)assert(byName.has(name),`Missing Bloom state ${name}`);
 const decoded=new Map();
 const get=async name=>{if(!decoded.has(name)){const row=byName.get(name),img=decodePng(await readImage(row.image));assert.equal(img.width,row.width);assert.equal(img.height,row.height);decoded.set(name,img);}return decoded.get(name);};
 const sharp=await get('sharp'),hdr=await get('hdr-reference');
 assert.equal(sharp.width,128*dpr);assert.equal(sharp.height,128*dpr);
 let sourcePixels=0,peak=0;for(let i=0;i<hdr.pixels.length;i+=4){peak=Math.max(peak,hdr.pixels[i]);if(hdr.pixels[i]>10)sourcePixels++;}
 assert(sourcePixels>8&&peak>10&&peak<250,'HDR source signal is empty or clipped');
 for(const name of ['wide-zero','threshold-empty','wide-off','size-restored'])assert.equal(difference(sharp.pixels,(await get(name)).pixels),0,`${name} identity`);
 const gather=await get('gather'),signals=[];
 for(const quality of ['low','balanced','high']){
  const row=byName.get(quality),image=await get(quality),warm=byName.get(quality+'-warm');
  assert.equal(difference(image.pixels,(await get(quality+'-warm')).pixels),0,'Bloom warm pixels changed');
  assert(Object.values(warm.allocated).every(n=>n===0),'Warm Bloom allocated GPU resources');
  const [draws,bytes,fetches]=WIDE_BLOOM_WORK_CEILINGS[dpr][quality];
  assert.deepEqual([row.frameWork.spatialBloomDrawCalls,row.frameWork.spatialBloomTextureBytes,row.frameWork.spatialBloomTexelFetchBudget],[draws,bytes,fetches],'Measured Bloom work missing/mismatched');
  assert.equal(row.resources.renderTargetCount-byName.get('gather').resources.renderTargetCount,draws-1,'Bloom target count mismatch');
  assert.equal(difference(image.pixels,wideBloomReference(hdr.pixels,hdr.width,hdr.height,{quality,dpr}),3),0,'Bloom CPU signal reference');
  let haloPixels=0;for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++)if(Math.hypot((x+.5)/dpr-64,(y+.5)/dpr-64)>28&&image.pixels[(y*image.width+x)*4]>gather.pixels[(y*image.width+x)*4]+3)haloPixels++;
  assert(haloPixels>64,'Wide Bloom halo is absent');signals.push({quality,haloPixels,draws,bytes,fetches});
 }
 for(const [name,options]of [['fractional-radius',{radius:37.5}],['exposure-before-output',{exposure:-2}]])assert.equal(difference((await get(name)).pixels,wideBloomReference(hdr.pixels,hdr.width,hdr.height,{dpr,...options}),3),0,`${name} reference`);
 for(const [source,name]of [['odd-hdr-reference','odd-wide'],['odd-stable-hdr-reference','odd-stable-wide']]){
  const input=await get(source);assert.equal(difference((await get(name)).pixels,wideBloomReference(input.pixels,input.width,input.height,{dpr}),3),0,`${name} reference`);
 }
 const before=await get('before-restore');
 for(const name of ['same-frame-repeat','fresh-restore','recovered-wide','after-clear-wide'])assert.equal(difference(before.pixels,(await get(name)).pixels),0,`${name} pixels changed`);
 const baseWork=byName.get('before-restore').frameWork,repeat=byName.get('same-frame-repeat').frameWork,hudWork=byName.get('hud').frameWork;
 assert.deepEqual(repeat,{spatialBloomDrawCalls:2*baseWork.spatialBloomDrawCalls,spatialBloomTextureBytes:baseWork.spatialBloomTextureBytes,spatialBloomTexelFetchBudget:2*baseWork.spatialBloomTexelFetchBudget},'Repeated packet work lost');
 assert.deepEqual(hudWork,baseWork,'HUD erased Bloom work');
 assert.deepEqual(byName.get('environment-cleared').frameWork,{spatialBloomDrawCalls:0,spatialBloomTextureBytes:0,spatialBloomTexelFetchBudget:0},'Cleared Bloom work retained');
 const hud=await get('hud'),center=((hud.height/2|0)*hud.width+(hud.width/2|0))*4;
 assert.deepEqual([...hud.pixels.subarray(center,center+4)],[0,0,255,255],'Bloom filtered HUD');
 for(let y=0;y<hud.height;y++)for(let x=0;x<hud.width;x++)if((x+.5)/dpr<57||(x+.5)/dpr>71||(y+.5)/dpr<57||(y+.5)/dpr>71){const at=(y*hud.width+x)*4;assert.deepEqual(hud.pixels.subarray(at,at+4),before.pixels.subarray(at,at+4),'HUD changed world pixels');}
 const virtualHdr=await get('pixel-art-hdr-reference'),virtual=await get('pixel-art-wide'),zoom=virtual.width/64,input=new Uint8Array(64*64*4);
 for(let y=0;y<64;y++)for(let x=0;x<64;x++){const at=(y*zoom*virtual.width+x*zoom)*4;input.set(virtualHdr.pixels.subarray(at,at+4),(y*64+x)*4);}
 const expected=wideBloomReference(input,64,64,{dpr:.5});
 for(let y=0;y<virtual.height;y++)for(let x=0;x<virtual.width;x++){
  const at=(y*virtual.width+x)*4,reference=(Math.floor(y/zoom)*64+Math.floor(x/zoom))*4,origin=(Math.floor(y/zoom)*zoom*virtual.width+Math.floor(x/zoom)*zoom)*4;
  assert.deepEqual(virtual.pixels.subarray(at,at+4),virtual.pixels.subarray(origin,origin+4),'PixelArt nearest output changed');
  for(let c=0;c<3;c++)assert(Math.abs(virtual.pixels[at+c]-expected[reference+c])<=3,'PixelArt signal reference');
 }
 return {sourcePixels,sourcePeak:peak,presets:signals,nearest:true,freshRestore:true,frameWork:true};
}
