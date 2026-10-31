import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pixelDocument as d,pixelDrawing as draw,documentUrl,drawingUrl,maskUrl,pixelModuleUrl,checkedPixelImport} from './pixel-editing-modules.mjs';
const {createPixelPerfectStroke:perfect}=await checkedPixelImport(await pixelModuleUrl('placementPixelPerfect',{'./placementPixelDrawing':drawingUrl}));
const {createPixelBrushLibrary:library,createPixelImageBrushStroke:imageStroke}=await checkedPixelImport(await pixelModuleUrl('placementPixelImageBrush',{'./placementPixelDocument':documentUrl,'./placementPixelDrawing':drawingUrl,'./placementPixelMask':maskUrl}));
const region={x:0,y:0,width:4,height:4},repeat={x:true,y:true},red=[255,0,0,128];
const points=mask=>[...mask.pixels].flatMap((v,i)=>v?[[i%4,Math.floor(i/4)]]:[]);
const line=(a,b,settings=draw.PIXEL_DRAW_DEFAULTS,clip)=>draw.rasterPixelDrawing('line',region,{x:a[0],y:a[1]},{x:b[0],y:b[1]},settings,clip,false,repeat);
test('floor modulo wraps positive/negative edges and corner strokes with one unblended write per pixel',()=>{
  assert.deepEqual(draw.repeatPixelPoint(region,-1,-1,repeat),{x:3,y:3});assert.deepEqual(points(line([3,3],[4,4])),[[0,0],[3,3]]);assert.deepEqual(points(line([0,0],[-1,-1])),[[0,0],[3,3]]);
  const e=d.createPixelEditor(d.newPixelDocument(4,4));e.editPaint(line([3,3],[4,4]),red);assert.deepEqual(e.sample(0,0),red);assert.equal(e.history().undo,1);e.undo();assert.equal(e.countColor([0,0,0,0],'cel'),16);
});
test('brushes larger than a frame, mirrors and sparse selection still share a final bounded mask',()=>{
  const clip={x:0,y:0,width:4,height:4,mask:Uint8Array.from(Array.from({length:16},(_,i)=>i===0||i===15?1:0))};
  const mask=line([1,1],[2,1],{...draw.PIXEL_DRAW_DEFAULTS,size:32,mirrorX:true,mirrorY:true},clip);assert.deepEqual(points(mask),[[0,0],[3,3]]);assert(mask.pixels.every(v=>v===0||v===1));
});
test('repeat axis domains stay bounded to their preview and extreme pointer distances cannot grow work buffers',()=>{
  assert.deepEqual(draw.pixelRepeatDomain(region,repeat),{x:-4,y:-4,width:12,height:12});assert.deepEqual(draw.pixelRepeatDomain(region,{x:true,y:false}),{x:-4,y:0,width:12,height:4});
  assert.equal(line([0,0],[1_048_576,1_048_576]).pixels.length,16);assert.equal(points(line([100,100],[101,101])).length,0);assert.throws(()=>draw.pixelRepeatDomain(region,{x:1,y:false}));
});
test('filled shapes and outlines wrap across seams with clipping in source coordinates',()=>{
  const mask=draw.rasterPixelDrawing('rectangle',region,{x:3,y:3},{x:4,y:4},{...draw.PIXEL_DRAW_DEFAULTS,filled:true},undefined,false,repeat);
  assert.deepEqual(points(mask),[[0,0],[3,0],[0,3],[3,3]]);
});
test('pixel-perfect corner restoration crosses seams without erasing the original transparent RGB',()=>{
  const source={...d.newPixelDocument(4,4),rgba:Buffer.from(Array(16).fill([10,20,30,0]).flat()).toString('base64')},e=d.createPixelEditor(source),s=perfect(region,{x:3,y:0},draw.PIXEL_DRAW_DEFAULTS,undefined,repeat);
  e.begin();e.paintStrokeMask(s.add(4,0),red);e.paintStrokeMask(s.add(4,1),red);e.commit();assert.deepEqual(e.sample(0,0),[10,20,30,0]);assert.deepEqual(e.sample(0,1),red);e.undo();assert.deepEqual(e.document(),source);
});
test('colored image brushes larger than a frame wrap every source pixel in deterministic last-write order',()=>{
  const lib=library(),id=lib.capture({width:3,height:1,pixels:Uint8Array.from([...red,0,0,255,255,0,255,0,128])}),small={x:0,y:0,width:2,height:1};
  const result=imageStroke(small,{x:0,y:0},lib.snapshot(id,0,0),undefined,false,false,{x:true,y:false}).add(0,0,true);
  assert.deepEqual([...result.pixels],[0,255,0,128,0,0,255,255]);assert.deepEqual([...result.region.mask],[1,1]);
});
test('flood fill connects repeated edges but cannot propagate through excluded selection pixels',()=>{
  const pixels=Uint8Array.from(Array(16).fill([100,0,0,255]).flat());pixels.set(red,16);pixels.set(red,28);
  const source={...d.newPixelDocument(4,4),rgba:Buffer.from(pixels).toString('base64')},e=d.createPixelEditor(source);e.begin();e.fill(0,1,[0,255,0,255],undefined,{x:true,y:false});e.commit();assert.deepEqual(e.sample(3,1),[0,255,0,255]);e.undo();
  e.begin();e.fill(0,1,[0,255,0,255],{x:0,y:1,width:4,height:1,mask:new Uint8Array([1,0,0,0])},{x:true,y:false});e.commit();assert.deepEqual(e.sample(3,1),red);e.undo();assert.deepEqual(e.document(),source);
  const atlas=d.createPixelEditor({...source,version:4,atlas:{texture:'sheet',frames:[{id:'all',frame:{u0:0,v0:0,u1:1,v1:1}}]}});atlas.begin();assert.throws(()=>atlas.fill(0,1,red,undefined,repeat));atlas.cancel();assert.deepEqual(atlas.document().rgba,source.rgba);
});
