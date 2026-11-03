import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pixelModuleUrl, checkedPixelImport } from './pixel-editing-modules.mjs';
const sdk=new URL('../../packages/ferrum-web/dist/authoring.js',import.meta.url).href;
const {asepriteSliceCatalog:catalog,asepriteSliceOrigin:origin,asepriteSlicePivotPatch:patch}=await checkedPixelImport(await pixelModuleUrl('placementAsepriteSlices',{'@ferrum2d/ferrum-web/authoring':sdk}));
const {mergeScenePlacementPatch}=await import(sdk);
function asset(slices=[{name:'feet',keys:[{frame:0,bounds:{x:2,y:1,w:20,h:22},pivot:{x:10,y:21},center:{x:4,y:4,w:12,h:14}},{frame:12,bounds:{x:0,y:0,w:24,h:24},pivot:{x:6,y:24}}]}]) {
  return {id:'atlas',frames:[{id:'a',width:24,height:24,uv:{u0:0,v0:0,u1:1,v1:.5}},{id:'b',width:24,height:24,uv:{u0:0,v0:.5,u1:1,v1:1}}],jsonText:JSON.stringify({frames:{a:{},b:{}},meta:slices===undefined?{}:{slices}})};
}
function document(a=asset()) {
  return {format:'ferrum2d.consumer.scene-authoring',version:1,behaviorRecipes:{entities:{}},sceneComposition:{initialFragment:'main',prefabs:{object:{}},fragments:{main:{instances:[{id:'hero',prefab:'object',x:30,y:40,rotationRadians:.3,scale:1.2,props:{components:{visual:{kind:'sprite',texture:a.id,width:64,height:96,frame:a.frames[0].uv,originX:.1,originY:.2,normalTexture:'normal',tint:'#eeeeff'},body:{type:'static'},collider:{type:'aabb',halfWidth:4,halfHeight:5},layer:'enemy'}}}]}}}};
}
const state={fragment:'main',selectedInstanceId:'hero',selectedInstanceIds:['hero'],lockedInstanceIds:[]};
const selected={slice:'feet',keyFrame:0,frame:'a'};
const visual=doc=>doc.sceneComposition.fragments.main.instances[0].props.components.visual;
test('slice origin uses bounds-local pivot on restored canvas, with explicit original key frame',()=>{
  const a=asset(),zero=origin(a,'feet',0,'a'),later=origin(a,'feet',12,'b');
  assert.deepEqual(zero.point,{x:12,y:22});assert.deepEqual(zero.origin,{x:.5,y:22/24});assert.deepEqual(zero.center,{x:4,y:4,w:12,h:14});
  assert.deepEqual(later.origin,{x:.25,y:1});assert.throws(()=>origin(a,'feet',1,'b'),/choose a slice key/);
});
test('explicit origin patch changes only origin and is replayable without mutating the document',()=>{
  const a=asset(),doc=document(a),before=structuredClone(doc),p=patch(doc,state,a,selected),after=mergeScenePlacementPatch(doc,p).document;
  assert.equal(p.operations.length,1);assert.equal(p.operations[0].kind,'updateComponents');assert.deepEqual(doc,before);
  const expected=structuredClone(before);Object.assign(visual(expected),{originX:.5,originY:22/24});assert.deepEqual(after,expected);
});
test('selection, lock, source texture and static frame mismatches fail without changing the scene',()=>{
  const a=asset(),doc=document(a),before=structuredClone(doc);
  for(const override of [{selectedInstanceId:undefined},{selectedInstanceIds:['hero','other']},{lockedInstanceIds:['hero']},{fragment:'other'}])assert.throws(()=>patch(doc,{...state,...override},a,selected));
  assert.throws(()=>patch(doc,state,a,{...selected,frame:'b'}),/currently used/);
  for(const mutate of [v=>v.texture='other',v=>v.kind='primitive']){const next=document(a);mutate(visual(next));assert.throws(()=>patch(next,state,a,selected));}
  assert.deepEqual(doc,before);
});
test('animated sprite receives one shared origin and retains clips, timing, normals and all other components',()=>{
  const a=asset(),doc=document(a),v=visual(doc);delete v.frame;
  v.animationSet={initialClip:7,clips:[{id:7,fps:5,loop:false,frames:a.frames.map(f=>f.uv),direction:'pingpong',emitEvents:true}]};
  const before=structuredClone(doc),p=patch(doc,state,a,selected),expected=structuredClone(doc);
  Object.assign(visual(expected),{originX:.5,originY:22/24});assert.deepEqual(mergeScenePlacementPatch(doc,p).document,expected);assert.deepEqual(doc,before);
  const aliases=structuredClone(a);aliases.frames.push({...aliases.frames[0],id:'same-packed-rect'});
  assert.deepEqual(patch(doc,state,aliases,selected).operations[0].components.visual,visual(expected),'duplicate packed rect IDs share the same origin canvas');
  const bad=structuredClone(a);bad.frames[1].height=23;assert.throws(()=>patch(doc,state,bad,selected),/same source canvas/);
  const changed=structuredClone(doc);visual(changed).animationSet.clips[0].frames[0].u1=.75;assert.throws(()=>patch(changed,state,a,selected),/known frames/);
});
test('missing metadata, empty slices and keys without a pivot stay readable',()=>{
  const absent=asset();absent.jsonText='{"meta":{}}';assert.deepEqual(catalog(absent),[]);assert.deepEqual(catalog(asset([])),[]);
  const a=asset([{name:'panel',keys:[{frame:0,bounds:{x:1,y:1,w:20,h:20},center:{x:4,y:4,w:12,h:12}}]}]);
  assert.equal(origin(a,'panel',0,'a').origin,undefined);assert.throws(()=>patch(document(a),state,a,{slice:'panel',keyFrame:0,frame:'a'}),/no pivot/);
  assert.deepEqual(catalog(asset([{name:'empty'}]))[0].keys,[]);
});
test('out-of-canvas slice bounds reject application; explicit off-canvas pivots preserve finite origin',()=>{
  for(const bounds of [{x:-1,y:0,w:24,h:24},{x:0,y:1,w:24,h:24}])assert.throws(()=>origin(asset([{name:'feet',keys:[{frame:0,bounds,pivot:{x:1,y:1}}]}]),'feet',0,'a'),/source canvas/);
  const a=asset([{name:'feet',keys:[{frame:0,bounds:{x:0,y:0,w:24,h:24},pivot:{x:-24,y:48}}]}]);
  assert.deepEqual(origin(a,'feet',0,'a').origin,{x:-1,y:2});assert.equal(patch(document(a),state,a,selected).operations[0].components.visual.originY,2);
});
test('malformed metadata, duplicate names/keys, invalid rects and excessive metadata fail closed only in slice helpers',()=>{
  for(const slices of [null,{},Array.from({length:65},(_,i)=>({name:String(i)})),[{name:''}],[{name:'same'},{name:'same'}],[{name:'a',keys:null}],[{name:'a',keys:Array.from({length:257},(_,frame)=>({frame,bounds:{x:0,y:0,w:1,h:1}}))}]])assert.throws(()=>catalog(asset(slices)));
  const base=catalog(asset())[0].keys[0];
  for(const mutate of [k=>k.frame=-1,k=>k.frame=65536,k=>k.bounds.w=0,k=>k.bounds.x=1.5,k=>k.pivot.x=4097,k=>k.center.x=20]){const key=structuredClone(base);mutate(key);assert.throws(()=>catalog(asset([{name:'a',keys:[key]}])));}
  for(const frames of [[1,0],[0,0]])assert.throws(()=>catalog(asset([{name:'a',keys:frames.map(frame=>({...base,frame}))}])),/strictly increasing/);
});
test('hash/array exports do not reinterpret source key numbers as exported frame indices',()=>{
  for(const frames of [{a:{},b:{}},[{filename:'b'},{filename:'a'}]]){const a=asset();const raw=JSON.parse(a.jsonText);raw.frames=frames;a.jsonText=JSON.stringify(raw);assert.deepEqual(origin(a,'feet',12,'a').origin,{x:.25,y:1});}
});
