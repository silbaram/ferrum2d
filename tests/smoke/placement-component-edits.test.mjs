import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const ts=createRequire(new URL('../../apps/studio/package.json',import.meta.url))('typescript');
const root=new URL('../../apps/studio/node_modules/@ferrum2d/ferrum-web/',import.meta.url);
const pkg=JSON.parse(await readFile(new URL('package.json',root)));
const authoring=new URL(pkg.exports['./authoring'].import,root).href;
const {createScenePlacementViewer,mergeScenePlacementPatch}=await import(authoring);
const code=ts.transpileModule(await readFile(new URL('../../apps/studio/src/placementComponentEdits.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replaceAll(JSON.stringify('@ferrum2d/ferrum-web/authoring'),JSON.stringify(authoring));
const {readPlacementAuthoredComponents:read,preservePlacementComponentMetadata:preserve}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
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
