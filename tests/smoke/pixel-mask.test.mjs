import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pixelDocument as d,pixelMask as m,pixelSelection as s,pixelDrawing as drawing} from './pixel-editing-modules.mjs';
const box={x:0,y:0,width:5,height:5},rgba=[20,30,40,128];
const count=r=>r?r.mask?r.mask.reduce((n,v)=>n+v,0):r.width*r.height:0;
const select=e=>s.createPixelSelection({editor:()=>e,canEdit:()=>true});
test('mask combinations preserve holes and support add, subtract, intersect, clipping and empty selections',()=>{
  const a={x:0,y:0,width:1,height:2},b={x:4,y:0,width:1,height:2};const union=m.combinePixelAreas(a,b,'add',box);assert.equal(count(union),4);assert.equal(union.mask[2],0);
  assert.deepEqual(m.combinePixelAreas(union,a,'subtract',box),b);assert.deepEqual(m.combinePixelAreas(union,a,'intersect',box),a);
  assert.equal(m.combinePixelAreas(a,b,'intersect',box),undefined);assert.equal(m.combinePixelAreas(a,undefined,'replace',box),undefined);
  assert.equal(count(m.clipPixelArea(union,{x:0,y:0,width:4,height:5})),2);
});
test('color and wand use exact RGBA by default with explicit tolerance and 4/8 connectivity',()=>{
  const pixels=new Uint8Array(100);for(const [x,y]of [[0,0],[1,1],[2,2],[4,0]])pixels.set(rgba,(y*5+x)*4);
  assert.equal(count(m.colorPixelArea(pixels,5,5,box,0,0)),1);assert.equal(count(m.colorPixelArea(pixels,5,5,box,0,0,0,true,true)),3);
  assert.equal(count(m.colorPixelArea(pixels,5,5,box,0,0,0,false)),4);
  pixels.set([1,2,3,0],4);assert.equal(count(m.colorPixelArea(pixels,5,5,box,1,0,0,false)),1);
  assert.equal(count(m.colorPixelArea(pixels,5,5,box,1,0,3,false)),21);assert.throws(()=>m.colorPixelArea(pixels,5,5,box,0,0,256));
});
test('bounded polygon scan fill handles concavity, closure, degenerate lines and huge off-canvas vertices',()=>{
  const triangle=m.polygonPixelArea(box,[{x:0,y:0},{x:4,y:0},{x:0,y:4}]);assert(count(triangle)>5&&count(triangle)<25);assert.equal(d.pixelRegionContains(triangle,4,4),false);
  assert.equal(count(m.polygonPixelArea(box,[{x:2,y:2}])),1);assert.equal(count(m.polygonPixelArea(box,[{x:-1_048_576,y:2},{x:1_048_576,y:2}])),5);
  assert.throws(()=>m.polygonPixelArea(box,Array(1025).fill({x:0,y:0})),/limit/);
});
test('sparse selection overlap moves selected pixels while preserving holes and destination background',()=>{
  const source={...d.newPixelDocument(5,5),rgba:Buffer.from(Array.from({length:25},(_,i)=>[i,2,3,i%2?128:0]).flat()).toString('base64')};const e=d.createPixelEditor(source),selection=select(e);
  const area={x:0,y:0,width:3,height:1,mask:new Uint8Array([1,0,1])};selection.select(area);selection.copy();const before=e.document(),revision=e.revision();
  selection.moveBy(1,0);const preview=selection.preview();assert.deepEqual(e.document(),before);assert.equal(e.revision(),revision);selection.confirm();
  const raw=Buffer.from(e.document().rgba,'base64'),old=Buffer.from(source.rgba,'base64');assert.deepEqual(raw.subarray(0,4),Buffer.alloc(4));assert.deepEqual(raw.subarray(4,8),old.subarray(0,4));assert.deepEqual(raw.subarray(8,12),Buffer.alloc(4));assert.deepEqual(raw.subarray(12,16),old.subarray(8,12));assert.deepEqual(e.bytes(),preview);
  e.undo();assert.deepEqual(e.document(),source);selection.paste();selection.confirm();assert.deepEqual(e.document(),source,'clipboard holes do not erase the underlying pixels');
});
test('sparse clipboard rotates and mirrors its mask together with exact raw pixels',()=>{
  const e=d.createPixelEditor(d.newPixelDocument(5,5));const area={x:1,y:1,width:3,height:2,mask:new Uint8Array([1,0,1,0,1,0])};e.editRegion(area,Uint8Array.from(Array(6).fill(rgba).flat()));e.markExported();const source=e.document(),selection=select(e);selection.select(area);
  selection.transform('rotate');assert.deepEqual(selection.area().mask,new Uint8Array([0,1,1,0,0,1]));assert.deepEqual({width:selection.area().width,height:selection.area().height},{width:2,height:3});assert.deepEqual(e.document(),source);selection.cancel();selection.select(area);
  for(let i=0;i<4;i++)selection.transform('rotate');assert.equal(selection.confirm(),false);assert.deepEqual(e.document(),source);
  selection.select(area);selection.transform('flip-x');selection.transform('flip-x');assert.equal(selection.confirm(),false);assert.deepEqual(e.document(),source);
});
test('paint, shape, fill and palette replacement use sparse selection as their final write/propagation mask',()=>{
  const e=d.createPixelEditor(d.newPixelDocument(5,5)),area={x:0,y:0,width:3,height:3,mask:new Uint8Array([1,0,1,1,0,1,1,0,1])};
  const mask=drawing.rasterPixelDrawing('rectangle',box,{x:0,y:0},{x:4,y:4},{...drawing.PIXEL_DRAW_DEFAULTS,filled:true},area);assert.equal(mask.pixels.reduce((n,v)=>n+v,0),6);
  e.editPaint(mask,rgba);assert.equal(e.countColor(rgba,'selection',area),6);assert.equal(e.countColor([0,0,0,0],'selection',area),0);
  e.begin();e.fill(0,0,[90,80,70,255],area);e.commit();assert.deepEqual(e.sample(2,0),rgba,'fill cannot jump across a gap in the selection');assert.deepEqual(e.sample(1,0),[0,0,0,0]);
  e.replaceColor(rgba,[50,60,70,255],'selection',area);assert.equal(e.countColor([50,60,70,255],'cel'),3);
});
test('v1-v5 keep source contracts, other cels and IDs while masked edits share Undo and reject bad masks atomically',()=>{
  const b=d.newPixelDocument(4,4),layer={id:'layer-1',name:'Layer 1',visible:true,locked:false};
  const sources=[b,{format:b.format,version:2,name:b.name,width:4,height:4,colorSpace:'srgb',frame:b.frame,palette:b.palette,layers:[{...layer,rgba:b.rgba}]},
    {format:b.format,version:3,name:b.name,width:4,height:4,colorSpace:'srgb',palette:b.palette,layers:[layer],frames:['a','b'].map(id=>({id,durationMs:100,cels:[{layerId:layer.id,rgba:b.rgba}]}))},
    {...b,version:4,atlas:{texture:'sheet',frames:[{id:'left',frame:{u0:0,v0:0,u1:.5,v1:1}},{id:'right',frame:{u0:.5,v0:0,u1:1,v1:1}}]}}];
  sources.push({...structuredClone(sources[2]),version:5,tags:[{id:'tag',name:'Idle',clipId:7,frameIds:['a','b'],loop:true}],initialTag:'tag',nextClipId:8});
  for(const source of sources){const e=d.createPixelEditor(source),area={x:0,y:0,width:2,height:2,mask:new Uint8Array([1,0,0,1])};e.editRegion(area,Uint8Array.from(Array(4).fill(rgba).flat()));assert.deepEqual(e.readRegion(area).mask,area.mask);const next=e.document();assert.deepEqual(d.readPixelDocument(JSON.stringify(next)),next);assert.equal(next.version,source.version);
    if(next.frames)assert.deepEqual(next.frames[1],source.frames[1]);e.undo();assert.deepEqual(e.document(),source);const history=e.history();assert.throws(()=>e.editRegion({...area,mask:new Uint8Array([2])},new Uint8Array(16)));assert.deepEqual(e.document(),source);assert.deepEqual(e.history(),history);}
});
test('selection snapshots are independent and cancel/stale target never mutates source',()=>{
  const e=d.createPixelEditor(d.newPixelDocument(5,5)),selection=select(e),area={x:0,y:0,width:3,height:1,mask:new Uint8Array([1,0,1])};selection.select(area);area.mask.fill(0);assert.equal(count(selection.area()),2);
  const saved=selection.area();selection.moveBy(1,1);selection.cancel();assert.deepEqual(selection.area(),saved);e.addFrame();assert.equal(selection.pending(),false);assert.equal(selection.area(),undefined);
});
