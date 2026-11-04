import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pixelDocument as d,pixelSelection as s,pixelTransform as t} from './pixel-editing-modules.mjs';
const identity={angle:0,scaleX:1,scaleY:1,sampling:'nearest'};
const change=(block,settings={})=>t.transformPixelBlock(block,{...identity,...settings});
const block=(width,height)=>({width,height,pixels:Uint8Array.from(Array.from({length:width*height},(_,i)=>[i+1,11,22,i%2?0:255]).flat())});
const colors=value=>Array.from({length:value.width*value.height},(_,i)=>value.pixels[i*4]);
function setup(width=8,height=8){
  const pixels=block(width,height).pixels,source=d.pixelDocumentFromRgba(width,height,'transform',pixels);
  let editor=d.createPixelEditor(source),canEdit=true;
  const selection=s.createPixelSelection({editor:()=>editor,canEdit:()=>canEdit});
  return {source,editor,selection,replace(){editor=d.createPixelEditor(source);},readOnly(){canEdit=false;}};
}
test('identity and cardinal rotation preserve exact raw RGBA, orientation and masks',()=>{
  const original=block(2,3);
  for(const sampling of ['nearest','linear'])for(const angle of [0,360,-360])assert.deepEqual(change(original,{angle,sampling}),original);
  for(const sampling of ['nearest','linear']){
    const right=change(original,{angle:90,sampling}),left=change(original,{angle:-90,sampling});
    assert.deepEqual([right.width,right.height],[3,2]);assert.deepEqual(colors(right),[5,3,1,6,4,2]);assert.deepEqual(colors(left),[2,4,6,1,3,5]);
    original.mask=new Uint8Array([1,0,0,1,1,0]);
    assert.deepEqual(change(original,{angle:90,sampling}).mask,new Uint8Array([1,0,1,0,1,0]));delete original.mask;
  }
});
test('nearest scaling replicates pixel centers while non-cardinal rotation masks empty corners',()=>{
  assert.deepEqual(colors(change(block(2,2),{scaleX:2,scaleY:2})),[1,1,2,2,1,1,2,2,3,3,4,4,3,3,4,4]);
  assert.deepEqual(colors(change(block(4,1),{scaleX:.5})),[2,4]);
  const rotated=change(block(3,3),{angle:45});assert.deepEqual([rotated.width,rotated.height],[5,5]);
  assert.equal(rotated.mask[0],0);assert.equal(rotated.mask[12],1);assert.equal(rotated.pixels[48],5);
  const before=block(3,3),copy=structuredClone(before);change(before,{angle:33,scaleX:1.5});assert.deepEqual(before,copy);
});
test('linear filtering uses premultiplied alpha and preserves fully transparent RGB',()=>{
  const input={width:2,height:1,pixels:new Uint8Array([255,0,0,255,0,0,255,0])};
  const out=change(input,{scaleX:2,sampling:'linear'});
  assert.deepEqual([...out.pixels],[255,0,0,255,255,0,0,191,255,0,0,64,0,0,255,0]);
  input.pixels[3]=0;assert.deepEqual([...change(input,{scaleX:2,sampling:'linear'}).pixels.slice(4,8)],[191,0,64,0]);
  input.mask=new Uint8Array([1,0]);input.pixels[3]=255;
  const masked=change(input,{scaleX:2,sampling:'linear'});assert.deepEqual(masked.mask,new Uint8Array([1,1,1,0]));assert.deepEqual([...masked.pixels.slice(8,12)],[255,0,0,64]);
});
test('transform rejects unbounded work, malformed masks and non-finite input',()=>{
  const original=block(2,2);
  for(const settings of [{angle:NaN},{angle:Infinity},{angle:361},{scaleX:0},{scaleY:-1},{scaleX:17},{scaleY:Infinity},{sampling:'unknown'}])assert.throws(()=>change(original,settings),/settings/);
  assert.throws(()=>change(block(256,256),{angle:45}),/exceeds/);
  assert.throws(()=>change(block(32,1),{scaleX:16}),/exceeds/);
  for(const extra of [{width:0},{pixels:new Uint8Array(1)},{mask:new Uint8Array(1)},{mask:new Uint8Array([0,1,2,0])}])assert.throws(()=>change({...original,...extra}),/bytes/);
});
test('free-transform previews are pure, non-cumulative and apply once with exact Undo/Redo',()=>{
  const {editor,selection,source}=setup();selection.select({x:2,y:2,width:3,height:3});const area=selection.area(),history=editor.history(),revision=editor.revision();
  const session=selection.beginFreeTransform();const settings={...identity,angle:37,scaleX:1.7,scaleY:.7};
  const expected=session.preview(settings);session.preview({...identity,angle:-17,scaleX:.5});assert.deepEqual(session.preview(settings),expected);
  assert.deepEqual(editor.document(),source);assert.deepEqual(editor.history(),history);assert.equal(editor.revision(),revision);assert.deepEqual(selection.area(),area);assert.equal(editor.dirty(),false);
  assert(session.apply(settings));assert.deepEqual(editor.bytes(),expected.pixels);assert.equal(editor.history().undo,1);const result=editor.document();
  assert(!session.valid());assert.throws(()=>session.apply(identity),/context/);
  editor.undo();assert.deepEqual(editor.document(),source);editor.redo();assert.deepEqual(editor.document(),result);
  selection.all();const noop=selection.beginFreeTransform();assert.equal(noop.apply(identity),false);assert.equal(editor.history().undo,1);
});
test('cancel preserves floating moves; identity applies that move in one step',()=>{
  const {editor,selection,source}=setup();selection.select({x:2,y:2,width:2,height:2});selection.moveBy(2,0);
  const area=selection.area(),preview=selection.preview(),session=selection.beginFreeTransform();session.preview({...identity,angle:25});session.cancel();
  assert(selection.pending());assert.deepEqual(selection.area(),area);assert.deepEqual(selection.preview(),preview);assert.deepEqual(editor.document(),source);
  selection.beginFreeTransform().apply(identity);assert.deepEqual(editor.bytes(),preview);assert.equal(editor.history().undo,1);editor.undo();assert.deepEqual(editor.document(),source);
});
test('selection, source, permission, editor, frame and layer changes invalidate captured sessions',()=>{
  for(const invalidate of [ctx=>ctx.selection.clear(),ctx=>ctx.selection.moveBy(1,0),ctx=>ctx.editor.addFrame(),ctx=>ctx.editor.addLayer(),ctx=>ctx.editor.setLayerLocked(ctx.editor.selectedLayer(),true),ctx=>ctx.editor.setLayerVisible(ctx.editor.selectedLayer(),false),ctx=>ctx.readOnly(),ctx=>ctx.replace()]){
    const ctx=setup();ctx.selection.all();const session=ctx.selection.beginFreeTransform();invalidate(ctx);const source=ctx.editor.document(),history=ctx.editor.history();
    assert(!session.valid());assert.throws(()=>session.apply(identity),/context/);assert.deepEqual(ctx.editor.document(),source);assert.deepEqual(ctx.editor.history(),history);
  }
});
test('fixed atlas transforms clip selected pixels without modifying neighboring frame bytes',()=>{
  const base=d.pixelDocumentFromRgba(8,4,'atlas',block(8,4).pixels),source={...base,version:4,atlas:{texture:'sheet',frames:[{id:'left',frame:{u0:0,v0:0,u1:.5,v1:1}},{id:'right',frame:{u0:.5,v0:0,u1:1,v1:1}}]}};
  const editor=d.createPixelEditor(source),selection=s.createPixelSelection({editor:()=>editor,canEdit:()=>true});selection.all();
  const session=selection.beginFreeTransform(),settings={...identity,angle:45,scaleX:2};assert.equal(session.preview(settings).clipped,true);session.apply(settings);
  const raw=Buffer.from(editor.document().rgba,'base64'),old=Buffer.from(source.rgba,'base64');for(let y=0;y<4;y++)assert.deepEqual(raw.subarray((y*8+4)*4,(y*8+8)*4),old.subarray((y*8+4)*4,(y*8+8)*4));
  editor.undo();assert.deepEqual(editor.document(),source);selection.select({x:1,y:1,width:2,height:2});const next=selection.beginFreeTransform();editor.selectAtlasFrame('right');assert.throws(()=>next.apply(identity),/context/);
});
test('rotated sparse selection reports only actual pixels clipped and preserves destination holes',()=>{
  const {editor,selection}=setup();selection.select({x:2,y:2,width:3,height:3,mask:new Uint8Array([0,1,0,1,1,1,0,1,0])});
  const session=selection.beginFreeTransform(),settings={...identity,angle:45};assert.equal(session.preview(settings).clipped,false);
  const before=editor.layerBytes(editor.selectedLayer());session.apply(settings);assert.deepEqual(editor.layerBytes(editor.selectedLayer()).slice((1*8+1)*4,(1*8+2)*4),before.slice((1*8+1)*4,(1*8+2)*4));
});
