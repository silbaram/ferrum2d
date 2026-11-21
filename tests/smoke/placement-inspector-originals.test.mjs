import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {studioSourceModule} from './placement-physics-summary-source.mjs';
const {createScenePlacementViewer,resolveSceneAuthoringDocument,mergeScenePlacementPatch,createPlacementInspectorOriginals:create}=await studioSourceModule(`
 export {createScenePlacementViewer,resolveSceneAuthoringDocument,mergeScenePlacementPatch} from '@ferrum2d/ferrum-web/authoring';
 export {createPlacementInspectorOriginals} from './apps/studio/src/placementInspectorOriginals.ts';
`);
const colors={normalize:value=>value,primitive:'#ffffff',point:'#ffffff'};
const components={visual:{kind:'sprite',asset:'hero',width:16,height:24,normalTexture:'hero-normal',shadow:{shape:'ellipse'}},collider:{type:'aabb',halfWidth:8,halfHeight:12},layer:'wall',body:{type:'static',heightSpan:{floorId:0,elevation:0,height:24}}};
function fixture(legacy=false){const c=structuredClone(components);if(legacy){c.sprite={...c.visual,texture:'hero'};delete c.sprite.kind;delete c.sprite.asset;delete c.visual;}return {format:'ferrum2d.consumer.scene-authoring',version:1,behaviorRecipes:{entities:{}},sceneComposition:{prefabs:{object:{props:{components:c}}},fragments:{main:{instances:[{id:'a',prefab:'object',x:1.234567,y:2},{id:'b',prefab:'object',x:20,y:4}]}}}};}
function setup(document=fixture()){const viewer=createScenePlacementViewer({document,viewport:{cssWidth:640,cssHeight:480}});viewer.selectInstance('a');const original=create(resolveSceneAuthoringDocument(document),colors,document.spatial);const draft=()=>viewer.exportPatch()?mergeScenePlacementPatch(document,viewer.exportPatch()).document:document;const plan=(key,target)=>original.plan(key,viewer.state(),target,draft());const apply=plan=>plan.kind==='transform'?viewer.updateInstanceTransforms(plan.updates):plan.kind==='layers'?viewer.updateInstanceRenderLayers(plan.updates):plan.kind==='components'?viewer.updateInstanceComponents(plan.id,plan.components):assert.fail('Unexpected spatial input');return {viewer,original,draft,plan,apply};}
test('display rounding is not a modification and restoring a transform keeps exact source precision',()=>{
 const {viewer,original,plan,apply}=setup();assert.equal(original.read('transform:x',viewer.state()).value,'1.2');assert.equal(original.read('transform:x',viewer.state()).modified,false);
 viewer.updateInstanceTransform('a',{x:6});const count=viewer.historyState().undoCount;apply(plan('transform:x'));assert.equal(viewer.state().selected.transform.x,1.234567);assert.equal(viewer.historyState().undoCount,count+1);viewer.undo();assert.equal(viewer.state().selected.transform.x,6);
});
test('multi-selection restores each original, including a changed secondary and unchanged primary, in one undo',()=>{
 const {viewer,original,plan,apply}=setup();viewer.updateInstanceTransform('a',{x:6});viewer.selectInstances(['a','b']);assert.equal(original.read('transform:x',viewer.state()).modified,true);const before=viewer.historyState().undoCount;apply(plan('transform:x'));assert.equal(viewer.historyState().undoCount,before+1);assert.deepEqual(viewer.state().instances.map(i=>i.transform.x),[1.234567,20]);viewer.undo();assert.equal(viewer.state().instances[0].transform.x,6);
});
for(const legacy of [false,true])test(`component restore preserves unrelated raw metadata (${legacy?'legacy sprite':'visual'})`,()=>{
 const {viewer,draft,plan,apply}=setup(fixture(legacy)),key=legacy?'sprite':'visual';const c=structuredClone(components);if(legacy){c.sprite={...c.visual,texture:'hero'};delete c.sprite.kind;delete c.sprite.asset;delete c.visual;}c[key].width=32;c[key].normalTexture='changed-normal';c[key].tint='#ff0000';c[key].animationSet={clips:[{id:0,fps:8,frames:[{u0:0,v0:0,u1:1,v1:1}]}],initialClip:0};c.collider.offsetX=3;viewer.updateInstanceComponents('a',c);
 const before=structuredClone(plan('component:visualWidth').components);apply(plan('component:visualWidth'));const after=plan('component:visualWidth').components;assert.deepEqual(after,{...before,[key]:{...before[key],width:16}});assert.equal(viewer.state().selected.visual.width,16);assert.equal(after[key].normalTexture,'changed-normal');assert.deepEqual(after[key].animationSet,c[key].animationSet);assert.deepEqual(after.body,c.body);assert.deepEqual(after[key].shadow,c[key].shadow);
 apply(plan('component:colliderOffsetX'));assert.equal(Object.hasOwn(plan('component:visualWidth').components.collider,'offsetX'),false,'absent optional property is deleted, not replaced with a guessed value');
 const saved=resolveSceneAuthoringDocument(draft()),newBaseline=create(saved,colors,draft().spatial);assert.equal(newBaseline.read('component:visualWidth',viewer.state()).value,'16');
});
test('locked and newly added objects have no restorable transform operation',()=>{
 const {viewer,original,plan}=setup();viewer.setInstancesLocked(['a'],true);assert.throws(()=>plan('transform:x'),/Unlock/);viewer.setInstancesLocked(['a'],false);viewer.addInstance('main',{id:'new',prefab:'object',x:9,y:9});viewer.selectInstance('new');assert.equal(original.read('transform:x',viewer.state()).canRestore,false);assert.throws(()=>plan('transform:x'),/No restorable/);
});
test('a rename retains the authored baseline and read-only filters never produce patches',()=>{
 const {viewer,original}=setup();const before=JSON.stringify(viewer.exportPatch());for(let i=0;i<5;i++)original.read('component:visualWidth',viewer.state());assert.equal(JSON.stringify(viewer.exportPatch()),before);viewer.renameInstance('a','renamed');assert.equal(original.read('transform:x',viewer.state()).value,'1.2');
});
test('reopening a saved document establishes a new baseline rather than the original session source',()=>{
 const {viewer,draft,original}=setup();viewer.updateInstanceTransform('a',{x:42});assert.equal(original.read('transform:x',viewer.state()).modified,true);
 const saved=structuredClone(draft()),next=setup(saved);assert.equal(next.original.read('transform:x',next.viewer.state()).value,'42');assert.equal(next.original.read('transform:x',next.viewer.state()).modified,false);
});
test('spatial baselines retain authored model values across rename and do not invent optional restores',async()=>{
 const document=JSON.parse(await readFile(new URL('../fixtures/placement.hd2d.scene-authoring.json',import.meta.url),'utf8'));
 document.spatial.models={crate_ground:{asset:'tree',contentId:'a'.repeat(64),yawDegrees:17,elevation:8,scale:1.5,lightMask:3,shadowMask:5}};delete document.spatial.billboards.crate_ground;
 const viewer=createScenePlacementViewer({document,viewport:{cssWidth:640,cssHeight:480}}),original=create(resolveSceneAuthoringDocument(document),colors,document.spatial);
 viewer.selectInstance('crate_ground');assert.deepEqual(original.read('spatial:yaw',viewer.state(),{kind:'model',id:'crate_ground'}),{value:'17',canRestore:true});
 viewer.renameInstance('crate_ground','renamed');assert.deepEqual(original.read('spatial:offset',viewer.state(),{kind:'model',id:'renamed'}),{value:'8',canRestore:true});
 assert.deepEqual(original.read('spatial:lightMask',viewer.state(),{kind:'model',id:'renamed'}),{value:'3',canRestore:true});
 assert.deepEqual(original.read('spatial:shadowMask',viewer.state(),{kind:'model',id:'renamed'}),{value:'5',canRestore:true});
 assert.deepEqual(original.read('spatial:lightMask',viewer.state(),{kind:'billboard',id:'agent_ground'}),{value:'255',canRestore:false});
 assert.deepEqual(original.read('spatial:floorId',viewer.state(),{kind:'surface',id:'ground'}),{value:'0',canRestore:false});
 assert.deepEqual(original.read('spatial:elevation',viewer.state(),{kind:'surface',id:'bridge'}),{value:'40',canRestore:true});
 assert.deepEqual(original.read('spatial:offset',viewer.state(),{kind:'billboard',id:'agent_ground'}),{value:'0',canRestore:false});
});
test('native elevation originals use the body anchor and keep omitted anchors unrestorable',()=>{
 const document=fixture(),raw=document.sceneComposition.prefabs.object.props.components;
 document.physics={space:'spatial',gravity:[0,-9.81,0],lengthUnit:1};
 raw.collider='none';raw.body={kind:'dynamic',elevation:12.75,renderOffset:[1,-8,2],rotation:[0,0,0,1],collider:{shape:{type:'sphere',radius:2},friction:0.7}};
 const {viewer,original,plan}=setup(document),target={kind:'model',id:'a'};
 assert.deepEqual(original.read('spatial:elevation',viewer.state(),target),{value:'12.75',canRestore:true});
 const edited=structuredClone(raw);edited.body.elevation=40;edited.visual.width=32;viewer.updateInstanceComponents('a',edited);
 assert.deepEqual(plan('component:visualWidth').components.body,edited.body,'a visual reset retains the current native collider, pose and render offset');
 assert.equal(plan('spatial:elevation',target).kind,'spatial-input');
 viewer.renameInstance('a','renamed');assert.deepEqual(original.read('spatial:elevation',viewer.state(),{kind:'billboard',id:'renamed'}),{value:'12.75',canRestore:true});
 assert.deepEqual(viewer.state().selected.body.renderOffset,[1,-8,2]);
 const absent=structuredClone(document);delete absent.sceneComposition.prefabs.object.props.components.body.elevation;
 const next=setup(absent);assert.equal(next.original.read('spatial:elevation',next.viewer.state(),target),undefined);
 assert.throws(()=>next.plan('spatial:elevation',target),/No restorable/);
});
test('legacy elevation originals still use heightSpan and explicit zero is restorable',()=>{
 const {viewer,original}=setup();assert.deepEqual(original.read('spatial:elevation',viewer.state(),{kind:'billboard',id:'a'}),{value:'0',canRestore:true});
});
test('component reset keeps authored controller options and unknown component metadata exact',()=>{
 const document=fixture(),raw=document.sceneComposition.prefabs.object.props.components;
 document.physics={space:'planar-xy',gravity:[0,0,0],lengthUnit:1};
 raw.collider.isTrigger=false;raw.body={type:'kinematic',kinematicController:{maxStepHeight:0.1000000001,maxDropHeight:0,allowLedgeDrop:false}};raw.custom={tool:{version:7}};
 const {viewer,plan,apply}=setup(document),edited=structuredClone(raw);edited.visual.width=32;edited.body.kinematicController.maxDropHeight=3;viewer.updateInstanceComponents('a',edited);
 const reset=plan('component:visualWidth');assert.deepEqual(reset.components.body,edited.body);assert.deepEqual(reset.components.custom,raw.custom);
 apply(reset);assert.deepEqual(plan('component:visualWidth').components.body,edited.body);
});
