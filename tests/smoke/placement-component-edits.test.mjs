import assert from 'node:assert/strict';
import {test} from 'node:test';
import {studioSourceModule} from './placement-physics-summary-source.mjs';
const {createScenePlacementViewer,mergeScenePlacementPatch,readPlacementAuthoredComponents:read,preservePlacementComponentMetadata:preserve}=await studioSourceModule(`
 export {createScenePlacementViewer,mergeScenePlacementPatch} from '@ferrum2d/ferrum-web/authoring';
 export {readPlacementAuthoredComponents,preservePlacementComponentMetadata} from './apps/studio/src/placementComponentEdits.ts';
`);
const visual={kind:'sprite',asset:'hero',width:16,height:24,tint:'#ff0000',normalTexture:'hero-normal',projection:'upright',shadow:{shape:'ellipse'},animationSet:{clips:[{id:0,fps:8,frames:[{u0:0,v0:0,u1:1,v1:1}]}],initialClip:0}};
const body={type:'dynamic',mass:3,canSleep:false,gravityScale:0.2,linearDamping:0.3,angularDamping:0.4,material:{friction:0.8,restitution:0.1},heightSpan:{floorId:0,elevation:0,height:24}};
const source={visual,collider:{type:'aabb',halfWidth:8,halfHeight:12},body,layer:'wall',custom:{version:2}};
const document={format:'ferrum2d.consumer.scene-authoring',version:1,behaviorRecipes:{entities:{}},sceneComposition:{prefabs:{object:{props:{components:source}}},fragments:{main:{instances:[{id:'a',prefab:'object'}]}}}};
test('component editing preserves unrepresented metadata and exact body authoring',()=>{
 const original=structuredClone(source);
 const next=preserve(source,{visual:{kind:'sprite',asset:'hero',width:32,height:24,color:'#00ff00'},collider:source.collider,layer:'wall',body:{type:'dynamic'}});
 for(const key of ['normalTexture','projection','shadow','animationSet'])assert.deepEqual(next.visual[key],source.visual[key]);
 assert.deepEqual(next.body,body);assert.deepEqual(next.custom,source.custom);assert(!Object.hasOwn(next.visual,'tint'),'changing color must not retain an overriding old tint');
 assert(!Object.hasOwn(next.visual.shadow,'width'),'omitted automatic shadow dimensions stay omitted');
 assert.deepEqual(source,original);next.body.material.friction=0;assert.equal(source.body.material.friction,0.8);
});
test('legacy sprite edit keeps metadata, removes the legacy alias and supports a shape change',()=>{
 const legacy=structuredClone(source);legacy.sprite={...legacy.visual,texture:'hero'};delete legacy.sprite.kind;delete legacy.sprite.asset;delete legacy.visual;
 const next=preserve(legacy,{visual:{kind:'sprite',asset:'hero',width:20,height:24},collider:'none',layer:'wall'});
 assert(!Object.hasOwn(next,'sprite'));assert.deepEqual(next.visual.animationSet,visual.animationSet);assert.equal(next.visual.normalTexture,'hero-normal');
 const shape=preserve(legacy,{visual:{kind:'primitive',shape:'rect',width:20,height:24},collider:'none',layer:'wall'});
 assert(!Object.hasOwn(shape.visual,'normalTexture'));assert(!Object.hasOwn(shape.visual,'animationSet'));assert.deepEqual(shape.visual.shadow,visual.shadow);
});
test('an absent body remains absent and gesture snapshots cannot mutate the source',()=>{
 const raw={visual:{kind:'primitive',shape:'circle',radius:8,shadow:{shape:'ellipse'}},collider:'none',layer:'wall'};
 const next=preserve(raw,{visual:{kind:'primitive',shape:'circle',radius:12},collider:'none',layer:'wall',body:{type:'static'}});
 assert(!Object.hasOwn(next,'body'));assert.deepEqual(next.visual.shadow,raw.visual.shadow);assert.equal(next.visual.radius,12);assert.equal(raw.visual.radius,8);
});
test('current authored components follow patch changes, preserve prefabs and undo in one step',()=>{
 const viewer=createScenePlacementViewer({document,viewport:{cssWidth:640,cssHeight:480}});viewer.selectInstance('a');
 const authored=read(document,'main','a');assert.deepEqual(authored,source);
 const next=preserve(authored,{visual:{kind:'sprite',asset:'hero',width:32,height:24,tint:'#ff0000'},collider:{...source.collider,offsetX:3},layer:'wall'});
 viewer.updateInstanceComponents('a',next);assert.equal(viewer.historyState().undoCount,1);
 const merged=mergeScenePlacementPatch(document,viewer.exportPatch()).document;
 assert.deepEqual(read(merged,'main','a'),next);assert.deepEqual(merged.sceneComposition.prefabs,document.sceneComposition.prefabs);
 viewer.undo();assert(!viewer.exportPatch());viewer.redo();assert.deepEqual(read(mergeScenePlacementPatch(document,viewer.exportPatch()).document,'main','a'),next);
 assert.equal(read(document,'main','missing'),undefined);
});
test('native nested collider, pose and render offset survive component patch, save, undo and redo',()=>{
 const doc=structuredClone(document),raw=doc.sceneComposition.prefabs.object.props.components;
 doc.physics={space:'spatial',gravity:[0,-9.81,0],lengthUnit:1};raw.collider='none';
 raw.body={kind:'dynamic',elevation:16,rotation:[0,0,0,1],renderOffset:[0,-2,0],angularVelocity:[1,2,3],collider:{shape:{type:'compound',parts:[{pose:{position:[1,2,3]},shape:{type:'box',halfExtents:[2,3,4]}}]},pose:{position:[4,5,6]},friction:0.7,category:8,mask:255}};
 const viewer=createScenePlacementViewer({document:doc,viewport:{cssWidth:640,cssHeight:480}});viewer.selectInstance('a');
 const authored=read(doc,'main','a'),next=preserve(authored,{visual:{...visual,width:32},collider:'none',layer:'wall',body:{type:'static'}});
 viewer.updateInstanceComponents('a',next);const saved=mergeScenePlacementPatch(doc,viewer.exportPatch()).document;
 assert.deepEqual(read(saved,'main','a').body,raw.body);assert.deepEqual(read(saved,'main','a').custom,raw.custom);
 assert.deepEqual(saved.sceneComposition.prefabs,doc.sceneComposition.prefabs);assert.equal(viewer.historyState().undoCount,1);
 viewer.undo();assert(!viewer.exportPatch());viewer.redo();assert.deepEqual(read(mergeScenePlacementPatch(doc,viewer.exportPatch()).document,'main','a').body,raw.body);
 next.body.collider.shape.parts[0].pose.position[0]=99;assert.equal(raw.body.collider.shape.parts[0].pose.position[0],1);
});
test('legacy kinematic controller omission and explicit settings survive unrelated component edits',()=>{
 for(const controller of [undefined,{}, {solidMaskBits:0,maxIterations:8,maxStepHeight:0,maxDropHeight:3.25,allowLedgeDrop:false}]){
  const doc=structuredClone(document),raw=doc.sceneComposition.prefabs.object.props.components;
  raw.collider.isTrigger=false;
  raw.body={type:'kinematic',heightSpan:{floorId:0,elevation:0,height:24},...(controller===undefined?{}:{kinematicController:controller})};
  const viewer=createScenePlacementViewer({document:doc,viewport:{cssWidth:640,cssHeight:480}});viewer.selectInstance('a');
  const next=preserve(read(doc,'main','a'),{visual:{...visual,width:40},collider:{...raw.collider,offsetX:2},layer:'wall'});
  viewer.updateInstanceComponents('a',next);const saved=mergeScenePlacementPatch(doc,viewer.exportPatch()).document;
  assert.deepEqual(read(saved,'main','a').body,raw.body);assert.deepEqual(read(saved,'main','a').custom,raw.custom);
  viewer.undo();assert(!viewer.exportPatch());viewer.redo();assert.deepEqual(read(mergeScenePlacementPatch(doc,viewer.exportPatch()).document,'main','a').body,raw.body);
 }
});

test('two workspace viewers keep separate selections, drafts and Undo using the same instance IDs', () => {
  const documentWithTwoInstances = structuredClone(document);
  documentWithTwoInstances.sceneComposition.fragments.main.instances.push({ id: 'b', prefab: 'object' });
  const viewport = { cssWidth: 640, cssHeight: 480 };
  const first = createScenePlacementViewer({ document: documentWithTwoInstances, viewport });
  const second = createScenePlacementViewer({ document: documentWithTwoInstances, viewport });
  first.selectInstance('a');
  first.updateInstanceTransform('a', { x: 752 });
  const firstDraft = first.exportPatch();
  second.selectInstance('b');
  second.updateInstanceTransform('b', { x: 424 });
  assert.equal(first.state().selectedInstanceId, 'a');
  assert.equal(second.state().selectedInstanceId, 'b');
  assert.deepEqual(first.exportPatch(), firstDraft);
  assert.equal(first.historyState().undoCount, 1);
  assert.equal(second.historyState().undoCount, 1);
  second.undo();
  assert.equal(second.exportPatch(), undefined);
  assert.deepEqual(first.exportPatch(), firstDraft);
  assert.equal(first.historyState().undoCount, 1);
});
