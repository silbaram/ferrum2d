import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pixelDocument as d,documentUrl,maskUrl,pixelModuleUrl,checkedPixelImport} from './pixel-editing-modules.mjs';
const {pixelOutlineMask:outline}=await checkedPixelImport(await pixelModuleUrl('placementPixelOutline',{'./placementPixelDocument':documentUrl,'./placementPixelMask':maskUrl}));
const region={x:0,y:0,width:5,height:5},color=[90,80,70,128];
test('silhouette outside/inside and four/eight neighbours have exact distinct footprints',()=>{
  const raw=new Uint8Array(100);raw.set([10,20,30,128],48);const copy=raw.slice();
  assert.equal(outline(raw,5,5,region,undefined,'outside',false).count,4);assert.equal(outline(raw,5,5,region,undefined,'outside',true).count,8);
  assert.equal(outline(raw,5,5,region,undefined,'inside',false).count,1);assert.deepEqual(raw,copy);
});
test('holes and transparent RGB are classified by alpha, while selection is only a final write mask',()=>{
  const raw=Uint8Array.from(Array(25).fill([100,90,80,0]).flat());for(let y=1;y<=3;y++)for(let x=1;x<=3;x++)if(x!==2||y!==2)raw.set(color,(y*5+x)*4);
  const mask={x:2,y:2,width:1,height:1};const result=outline(raw,5,5,region,mask,'outside',false);assert.equal(result.count,1);assert.equal(result.mask.pixels[12],1);
  assert.equal(outline(raw,5,5,region,mask,'inside',false).count,0);
});
test('frame clipping is explicit and nonzero atlas rect reads never use neighbouring frames',()=>{
  const raw=new Uint8Array(100);raw.set(color,0);assert.equal(outline(raw,5,5,region,undefined,'outside',true).clipped,true);
  const r={x:2,y:0,width:3,height:5};const result=outline(raw,5,5,r,undefined,'outside',true);assert.equal(result.count,0);assert.equal(result.clipped,false);
});
test('preview/cancel keep source and history; one apply and Undo preserve exact source bytes',()=>{
  const source={...d.newPixelDocument(5,5),rgba:Buffer.from(Array.from({length:25},(_,i)=>i===12?[20,30,40,128]:[1,2,3,0]).flat()).toString('base64')},e=d.createPixelEditor(source);
  const {mask}=outline(e.layerBytes(e.selectedLayer()),5,5,region,undefined,'outside',false),revision=e.revision();e.previewPaint(mask,color);assert.deepEqual(e.document(),source);assert.equal(e.revision(),revision);assert.equal(e.history().undo,0);
  e.editPaint(mask,color);assert.equal(e.history().undo,1);e.undo();assert.deepEqual(e.document(),source);
});
test('invalid inputs fail without reading outside bounds',()=>{
  const raw=new Uint8Array(100);for(const run of [()=>outline(raw,4,5,region,undefined,'outside',false),()=>outline(raw,5,5,{...region,x:-1},undefined,'outside',false),()=>outline(raw,5,5,region,undefined,'bad',false),()=>outline(raw,5,5,region,{x:0,y:0,width:1,height:1,mask:new Uint8Array([2])},'outside',false)])assert.throws(run);
});
