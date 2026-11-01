import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pixelDocument as d} from './pixel-editing-modules.mjs';
function source(){const b=d.newPixelDocument(5,4);const layers=[{id:'body',name:'Body',visible:true,locked:false},{id:'locked',name:'Locked',visible:true,locked:true},{id:'hidden',name:'Hidden',visible:false,locked:false}];return{format:b.format,version:5,name:'range',width:5,height:4,colorSpace:'srgb',palette:b.palette,layers,frames:['a','b','c'].map((id,f)=>({id,durationMs:100+f,cels:layers.map((l,n)=>({layerId:l.id,rgba:Buffer.from(Array.from({length:20},(_,i)=>[i+f*20,n*30,50,i%2?128:0]).flat()).toString('base64')}))})),tags:[{id:'walk',name:'Walk',clipId:9,frameIds:['a','b','c'],loop:false}],initialTag:'walk',nextClipId:10};}
const area={x:0,y:0,width:3,height:1,mask:new Uint8Array([1,0,1])};
test('range preview is readonly and masked overlap move protects non-target cels/metadata with one Undo',()=>{
  const original=source(),e=d.createPixelEditor(original),before=e.document(),revision=e.revision(),history=e.history();const plan=e.previewBatchTransform(['c','a'],'body',area,{kind:'move',dx:1,dy:0});
  assert.deepEqual(plan.targetIds,['a','c']);assert.equal(plan.changedFrames,2);assert.equal(plan.clipped,false);assert.deepEqual(e.document(),before);assert.equal(e.revision(),revision);assert.deepEqual(e.history(),history);
  e.batchTransform(['c','a'],'body',area,{kind:'move',dx:1,dy:0});const after=e.document();assert.deepEqual(after.layers,original.layers);assert.deepEqual(after.tags,original.tags);assert.equal(after.initialTag,original.initialTag);assert.equal(after.nextClipId,10);assert.deepEqual(after.frames[1],original.frames[1]);
  for(const i of [0,2]){assert.deepEqual(after.frames[i].cels.slice(1),original.frames[i].cels.slice(1));assert.equal(after.frames[i].durationMs,original.frames[i].durationMs);const raw=Buffer.from(after.frames[i].cels[0].rgba,'base64'),old=Buffer.from(original.frames[i].cels[0].rgba,'base64');assert.deepEqual(raw.subarray(0,4),Buffer.alloc(4));assert.deepEqual(raw.subarray(4,8),old.subarray(0,4));assert.deepEqual(raw.subarray(8,12),Buffer.alloc(4));assert.deepEqual(raw.subarray(12,16),old.subarray(8,12));assert.deepEqual(raw.subarray(16),old.subarray(16));}
  assert.equal(e.history().undo,1);e.undo();assert.deepEqual(e.document(),original);e.redo();assert.deepEqual(e.document(),after);assert.deepEqual(d.readPixelDocument(JSON.stringify(after)),after);
});
test('flip reflects sparse mask and transparent RGB without changing current frame/layer selection',()=>{
  const e=d.createPixelEditor(source());e.selectFrame('b');e.selectLayer('body');const before=e.document(),mask={x:0,y:0,width:3,height:2,mask:new Uint8Array([1,0,1,0,1,0])};
  e.batchTransform(['a','b'],'body',mask,{kind:'flip-y'});assert.equal(e.selectedFrame(),'b');assert.equal(e.selectedLayer(),'body');const once=e.document();e.batchTransform(['a','b'],'body',mask.mask?{...mask,mask:new Uint8Array([0,1,0,1,0,1])}:mask,{kind:'flip-y'});
  assert.notDeepEqual(once,before);e.undo();e.undo();assert.deepEqual(e.document(),before);
});
test('hidden/locked layers report excluded cels and do not consume history, revision or Redo',()=>{
  const e=d.createPixelEditor(source());e.batchTransform(['a'],'body',undefined,{kind:'flip-x'});e.undo();const original=e.document(),history=e.history(),revision=e.revision();
  for(const layer of ['hidden','locked']){const plan=e.previewBatchTransform(['a','b'],layer,undefined,{kind:'move',dx:1,dy:1});assert.deepEqual(plan.targetIds,[]);assert.deepEqual(plan.skippedIds,['a','b']);assert.equal(plan.changedFrames,0);assert.equal(e.batchTransform(['a','b'],layer,undefined,{kind:'flip-x'}),false);}
  assert.deepEqual(e.document(),original);assert.deepEqual(e.history(),history);assert.equal(e.revision(),revision);
});
test('invalid or stale targets and pending strokes fail atomically; no-op retains Redo',()=>{
  const e=d.createPixelEditor(source());e.batchTransform(['a'],'body',undefined,{kind:'flip-x'});e.undo();const before=e.document(),history=e.history(),revision=e.revision();
  for(const run of [()=>e.batchTransform(['a','missing'],'body',area,{kind:'flip-x'}),()=>e.batchTransform(['a','a'],'body',area,{kind:'flip-x'}),()=>e.batchTransform(Array(2),'body',area,{kind:'flip-x'}),()=>e.batchTransform(['a'],'missing',area,{kind:'flip-x'}),()=>e.batchTransform(['a'],'body',area,{kind:'move',dx:NaN,dy:0}),()=>e.previewBatchTransform(['a'],'body',area,{kind:'flip-x'},'b')])assert.throws(run);
  assert.equal(e.batchTransform(['a','b'],'body',area,{kind:'move',dx:0,dy:0}),false);assert.deepEqual(e.document(),before);assert.deepEqual(e.history(),history);assert.equal(e.revision(),revision);
  e.begin();assert.throws(()=>e.batchTransform(['a'],'body',area,{kind:'flip-x'}));e.cancel();assert.deepEqual(e.document(),before);assert.deepEqual(e.history(),history);
});
test('clipping is explicit and fixed atlas operations preserve neighbouring rects and source version',()=>{
  const b=d.newPixelDocument(8,4),original={...b,version:4,atlas:{texture:'sheet',frames:[{id:'left',frame:{u0:0,v0:0,u1:.5,v1:1}},{id:'right',frame:{u0:.5,v0:0,u1:1,v1:1}}]},rgba:Buffer.from(Array.from({length:32},(_,i)=>[i,30,40,128]).flat()).toString('base64')},e=d.createPixelEditor(original);e.selectAtlasFrame('right');
  const plan=e.previewBatchTransform([b.frame.id],b.layer.id,undefined,{kind:'move',dx:1,dy:0});assert.equal(plan.clipped,true);e.batchTransform([b.frame.id],b.layer.id,undefined,{kind:'move',dx:1,dy:0});const bytes=Buffer.from(e.document().rgba,'base64'),old=Buffer.from(original.rgba,'base64');for(let y=0;y<4;y++)assert.deepEqual(bytes.subarray(y*32,y*32+16),old.subarray(y*32,y*32+16));e.undo();assert.deepEqual(e.document(),original);
});
