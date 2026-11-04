import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import type { Engine } from "../pkg/ferrum_core.js";
import type { FerrumEngine } from "../src/engineTypes.js";
import { configureSpriteNineSlices, resolveSpriteNineSlice, supportsSpriteNineSlices, type SpriteNineSliceUpdate } from "../src/spriteNineSlice.js";
import { dataSceneObjectVisualBounds, resolveDataSceneComponentsSpec } from "../src/dataSceneComponents.js";
import { applyDataSceneAuthoringDocument, attachDataSceneRuntimeEngineAdapter, createDataSceneRuntimeTarget, type DataSceneRuntimeSpawnRequest } from "../src/dataSceneRuntimeTarget.js";
import { resolveSceneAuthoringDocument } from "../src/sceneAuthoringDocument.js";
import { attachMemoryDataSceneVariableRuntime } from "./dataSceneVariableRuntimeTestAdapter.js";
import { createScenePlacementViewer } from "../src/scenePlacementViewer.js";

const nineSlice = {sourceWidth:16,sourceHeight:12,left:2,right:4,top:3,bottom:1};
const components = {visual:{kind:"sprite",texture:"panel",width:80,height:40,nineSlice,originX:0,originY:1},collider:"none",layer:"wall"};
const instance = {id:"panel",sourceId:"panel",prefab:"panel",x:12,y:24,rotationRadians:0.6,scale:2,layer:3,props:{components}};
function document() { return {format:"ferrum2d.consumer.scene-authoring" as const,version:1 as const,sceneComposition:{initialFragment:"main",prefabs:{panel:{}},fragments:{main:{instances:[structuredClone(instance)]}}},behaviorRecipes:{entities:{}}}; }
function runtime(supported = true) {
  const events:string[]=[], requests:DataSceneRuntimeSpawnRequest[]=[], batches:(readonly SpriteNineSliceUpdate[])[]=[];
  const engine=attachMemoryDataSceneVariableRuntime(attachDataSceneRuntimeEngineAdapter({
    applyGameplayBehaviorCommands:(commands:readonly unknown[])=>({commands,results:commands.map(()=>true)}),
    configureSpriteNineSlices:(updates:readonly SpriteNineSliceUpdate[])=>{events.push("batch");batches.push(updates);return true;},
  } as unknown as FerrumEngine, {
    supportsSpriteNineSlices:()=>supported,useDataScene:()=>{events.push("activate");},textureId:()=>7,
    spawnDataSceneEntity:request=>{requests.push(request);events.push("spawn");return {entityId:42,entityGeneration:9};},
  }));
  return {engine,events,requests,batches};
}

test("9-slice descriptor validates source center, exact borders, booleans and f32 scale",()=>{
  deepEqual(resolveSpriteNineSlice(nineSlice),{...nineSlice,borderScale:1,flipX:false,flipY:false});
  for(const invalid of [null,[],{...nineSlice,sourceWidth:0},{...nineSlice,sourceHeight:16385},{...nineSlice,left:-1},
    {...nineSlice,top:0.5},{...nineSlice,right:14},{...nineSlice,bottom:9},{...nineSlice,borderScale:NaN},
    {...nineSlice,borderScale:0},{...nineSlice,borderScale:1e-50},{...nineSlice,borderScale:65537},{...nineSlice,borderScale:null},
    {...nineSlice,flipX:1},{...nineSlice,flipY:null},{...nineSlice,typo:2}]) throws(()=>resolveSpriteNineSlice(invalid),/nineSlice/);
});

test("9-slice batches validate fully before one bulk call and preserve integer handles",()=>{
  const calls:{handles:number[];values:number[]}[]=[];
  const engine={sprite_nine_slice_abi_version:()=>1,configure_sprite_nine_slices:(h:Uint32Array,v:Float32Array)=>{calls.push({handles:[...h],values:[...v]});return true;}} as unknown as Engine;
  const a={entity:{entityId:0xffffffff,entityGeneration:0xfffffffe},nineSlice:{...nineSlice,flipX:true,borderScale:2}};
  const detach={entity:{entityId:3,entityGeneration:9}};
  ok(supportsSpriteNineSlices(engine));ok(configureSpriteNineSlices(engine,[a,detach]));
  deepEqual(calls,[{handles:[0xffffffff,0xfffffffe,3,9],values:[16,12,2,4,3,1,2,1,0,...Array(9).fill(0)]}]);
  for(const updates of [[a,a],[a,{...a,entity:{entityId:1,entityGeneration:-1}}],[a,{...detach,nineSlice:{...nineSlice,top:12}}],
    Array.from({length:65537},(_,entityId)=>({entity:{entityId,entityGeneration:0}}))]) equal(configureSpriteNineSlices(engine,updates),false);
  equal(calls.length,1);equal(configureSpriteNineSlices({} as Engine,[]),false);
  equal(supportsSpriteNineSlices({...engine,sprite_nine_slice_abi_version:()=>2} as unknown as Engine),false);
});

test("9-slice visual and legacy sprite resolution preserve full object bounds for selection",()=>{
  for (const value of [components,{sprite:{texture:"panel",width:80,height:40,nineSlice},collider:"none",layer:"wall"}]) {
    const c=resolveDataSceneComponentsSpec(value);if(c.mode!=="inline" || c.visual.kind!=="sprite") throw Error("expected inline sprite");
    deepEqual(c.sprite.nineSlice,resolveSpriteNineSlice(nineSlice));deepEqual(c.visual.nineSlice,c.sprite.nineSlice);
    deepEqual(dataSceneObjectVisualBounds(c),{width:80,height:40});
  }
  throws(()=>resolveDataSceneComponentsSpec({...components,visual:{...components.visual,shadow:{shape:"alpha"}}}),/9-slice/);
  ok(resolveDataSceneComponentsSpec({...components,visual:{...components.visual,shadow:{shape:"box"}}}));
});

test("9-slice scene uses one deferred batch before prototypes and scales borders with instance size",()=>{
  const r=runtime();const result=applyDataSceneAuthoringDocument(r.engine,document());
  deepEqual(r.events,["activate","spawn","batch"]);equal(r.requests.length,1);
  equal(r.requests[0].nineSlice,undefined);equal(r.requests[0].spriteWidth,160);equal(r.requests[0].spriteHeight,80);
  equal(r.requests[0].originX,0);equal(r.requests[0].originY,1);equal(r.requests[0].rotationRadians,0.6);
  deepEqual(r.batches,[[{entity:result.entityHandles.panel,nineSlice:{...resolveSpriteNineSlice(nineSlice),borderScale:2}}]]);
  const direct=runtime();createDataSceneRuntimeTarget(direct.engine).spawnSceneInstance(instance);
  deepEqual(direct.requests[0].nineSlice,{...resolveSpriteNineSlice(nineSlice),borderScale:2});
});

test("9-slice unsupported runtime and scale overflow reject before destructive scene activation",()=>{
  const unsupported=runtime(false);throws(()=>applyDataSceneAuthoringDocument(unsupported.engine,document()),/9-slice.*native/);
  deepEqual(unsupported.events,[]);
  const r=runtime(),doc=document();doc.sceneComposition.fragments.main.instances[0].scale=65537;
  throws(()=>applyDataSceneAuthoringDocument(r.engine,doc),/borderScale/);deepEqual(r.events,[]);
  const direct=runtime(false);throws(()=>createDataSceneRuntimeTarget(direct.engine).spawnSceneInstance(instance),/9-slice.*native/);deepEqual(direct.events,[]);
});

test("9-slice spatial billboard bindings are rejected instead of silently losing borders",()=>{
  const doc={...document(),spatial:{camera:{position:{x:100,y:-100,elevation:100},target:{x:0,y:0,elevation:0},projection:"orthographic",height:300,near:0.1,far:1000},terrain:[],billboards:{panel:{unitsPerPixel:1,alphaCutoff:0.5,elevation:0}}}};
  throws(()=>resolveSceneAuthoringDocument(doc),/9-slice/);
});

test("9-slice picks the entire rotated object and returns independent metadata",()=>{
  const doc=document(),panel=doc.sceneComposition.fragments.main.instances[0];
  panel.x=100;panel.y=100;panel.rotationRadians=0;
  const viewer=createScenePlacementViewer({document:doc,viewport:{cssWidth:400,cssHeight:240}});
  equal(viewer.pickInstanceAtScreen({x:180,y:60})?.instanceId,"panel");
  equal(viewer.pickInstanceAtScreen({x:270,y:60}),undefined);
  viewer.updateInstanceTransform("panel",{rotationRadians:Math.PI/2});
  equal(viewer.pickInstanceAtScreen({x:140,y:180})?.instanceId,"panel");
  equal(viewer.pickInstanceAtScreen({x:80,y:180}),undefined);
  const visual=viewer.state().instances[0].visual;
  if(visual?.kind!=="sprite" || !visual.nineSlice)throw Error("9-slice metadata missing from viewer");
  visual.nineSlice.left=9;
  const fresh=viewer.state().instances[0].visual;
  if(fresh?.kind!=="sprite")throw Error("sprite missing");
  equal(fresh.nineSlice?.left,2);
});
