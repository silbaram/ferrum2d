import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pixelDocument as d,documentUrl,drawingUrl,maskUrl,pixelModuleUrl,checkedPixelImport} from './pixel-editing-modules.mjs';
const {createPixelBrushLibrary:library,createPixelImageBrushStroke:stroke}=await checkedPixelImport(await pixelModuleUrl('placementPixelImageBrush',{'./placementPixelDocument':documentUrl,'./placementPixelDrawing':drawingUrl,'./placementPixelMask':maskUrl}));
const red=[255,0,0,128],blue=[0,0,255,255],box={x:0,y:0,width:8,height:8};
const one=()=>({width:1,height:1,pixels:Uint8Array.from(red)});
const count=result=>result.region.mask.reduce((n,v)=>n+v,0);
test('library rejects oversized/empty inputs before allocation and caps slots without changing the source',()=>{
  const lib=library();for(const block of [{width:1e9,height:1,pixels:new Uint8Array(0)},{width:33,height:1,pixels:new Uint8Array(132)},{width:1,height:1,pixels:new Uint8Array(4)},{...one(),mask:new Uint8Array([2])}])assert.throws(()=>lib.capture(block));
  assert.equal(lib.entries().length,0);assert.equal(lib.capture(one()),'brush-1');for(let i=1;i<8;i++)lib.capture(one());assert.throws(()=>lib.capture(one()),/full/);assert.equal(lib.entries().length,8);lib.clear();assert.equal(lib.entries().length,0);
});
test('captured and gesture snapshots own their pixels and masks independently',()=>{
  const lib=library(),block=one(),id=lib.capture(block);block.pixels.fill(0);const brush=lib.snapshot(id),s=stroke(box,{x:1,y:1},brush);brush.pixels.fill(0);brush.mask.fill(0);
  const result=s.add(1,1);assert.equal(count(result),1);assert.deepEqual([...result.pixels.subarray(36,40)],red);assert.deepEqual([...lib.snapshot(id).pixels],red);
  assert.throws(()=>lib.snapshot(id,1));assert.throws(()=>lib.snapshot(id,0,0,0));
});
test('raw alpha and sparse/transparent brush pixels preserve destination background; one Undo and cancellation are exact',()=>{
  const source={...d.newPixelDocument(8,8),rgba:Buffer.from(Array(64).fill([7,8,9,0]).flat()).toString('base64')},e=d.createPixelEditor(source),lib=library();
  const id=lib.capture({width:2,height:2,pixels:Uint8Array.from([...red,10,20,30,0,...blue,...blue]),mask:new Uint8Array([1,1,0,1])});
  const s=stroke(box,{x:2,y:2},lib.snapshot(id,0,0)),result=s.add(2,2,true);assert.equal(count(result),2);const before=e.document();e.previewRegion(result.region,result.pixels);assert.deepEqual(e.document(),before);
  e.begin();e.paintRegion(result.region,result.pixels);e.paintRegion(result.region,result.pixels);e.commit();assert.equal(e.history().undo,1);assert.deepEqual(e.sample(2,2),red);assert.deepEqual(e.sample(3,3),blue);assert.deepEqual(e.sample(3,2),[7,8,9,0]);assert.deepEqual(e.sample(2,3),[7,8,9,0]);
  const saved=e.document();e.undo();assert.deepEqual(e.document(),source);e.redo();assert.deepEqual(e.document(),saved);e.begin();e.paintRegion(stroke(box,{x:0,y:0},lib.snapshot(id,0,0)).add(0,0).region,result.pixels);e.cancel();assert.deepEqual(e.document(),saved);
});
test('spacing is independent of pointer event segmentation and explicitly includes the final endpoint',()=>{
  const lib=library(),id=lib.capture(one()),brush=lib.snapshot(id,0,0,3),a=stroke(box,{x:0,y:0},brush),b=stroke(box,{x:0,y:0},brush);
  const complete=a.add(7,0,true);b.add(2,0);b.add(5,0);assert.deepEqual(b.add(7,0,true),complete);assert.equal(count(complete),4);for(const x of [0,3,6,7])assert.equal(complete.region.mask[x],1);
});
test('mirror reflects colored footprint while final sparse clip and atlas origin protect other pixels',()=>{
  const lib=library(),id=lib.capture({width:2,height:1,pixels:Uint8Array.from([...red,...blue])}),brush=lib.snapshot(id,0,0),clip={x:1,y:1,width:6,height:1,mask:new Uint8Array([0,1,0,0,1,0])};
  const result=stroke(box,{x:1,y:1},brush,clip,true).add(1,1);assert.equal(count(result),2);for(const x of [2,5])assert.deepEqual([...result.pixels.subarray((8+x)*4,(8+x+1)*4)],blue);
  const r={x:4,y:0,width:4,height:8},atlas=stroke(r,{x:4,y:0},brush,undefined,true).add(4,0);assert.equal(count(atlas),4);assert.equal(atlas.region.x,4);
});
test('extreme distances are bounded and invalid inputs leave prior stroke output intact',()=>{
  const lib=library(),brush=lib.snapshot(lib.capture(one())),s=stroke(box,{x:0,y:0},brush);assert.equal(s.add(1_048_576,1_048_576,true).pixels.length,256);const before=s.add(0,0);assert.throws(()=>s.add(Infinity,0));assert.deepEqual(s.add(0,0),before);
});
