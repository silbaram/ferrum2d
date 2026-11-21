import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { applyDataSceneAuthoringDocument, type DataSceneComponentsSpec, type SceneAuthoringDocumentSpec } from "../src/authoring.js";
import { createEngine, initializeFerrumWasm, captureGameStateSnapshot } from "../src/core.js";
import type { FerrumEngine } from "../src/engineTypes.js";
import { attachDataSceneRuntimeEngineAdapter } from "../src/dataSceneRuntimeTarget.js";
import { attachDataSceneProgressAdapter } from "../src/dataSceneProgress.js";
import { attachNativePhysicsAuthoring } from "../src/nativePhysicsAuthoring.js";
import { attachMemoryDataSceneVariableRuntime } from "./dataSceneVariableRuntimeTestAdapter.js";
import type { SceneCompositionJsonValue } from "../src/sceneComposition.js";

const animated: DataSceneComponentsSpec = {
  visual: {kind:"sprite",texture:11,width:2,height:3,animationSet:{initialClip:0,clips:[
    {id:0,fps:4,loop:true,frames:[{u0:0,v0:0,u1:0.5,v1:1},{u0:0.5,v0:0,u1:1,v1:1}]},
    {id:1,fps:2,loop:true,frames:[{u0:0,v0:0,u1:1,v1:1}]},
  ]}}, collider:"none",layer:"wall",body:{kind:"fixed",collider:{shape:{type:"sphere",radius:0.5}}},
};
function document(template = true): SceneAuthoringDocumentSpec {
  return {format:"ferrum2d.consumer.scene-authoring",version:1,physics:{space:"spatial",gravity:[0,0,0],lengthUnit:1,stepSeconds:0.01},
    sceneComposition:{initialFragment:"main",prefabs:{object:{}},fragments:{main:{instances:[{id:"actor",prefab:"object",props:{
      components:template?{template:"animated"}:structuredClone(animated) as unknown as SceneCompositionJsonValue,
    }}]}}},behaviorRecipes:{entities:{}}};
}
async function engine(options: Parameters<typeof createEngine>[4] = {}) {
  await initializeFerrumWasm(await readFile(new URL("../pkg/ferrum_core_bg.wasm",import.meta.url)));
  return createEngine(undefined, undefined, undefined, undefined, options);
}

test("inline and template reapply preserve native animation phase without rereading prior catalogs", async () => {
  const e = await engine();
  try {
    const first = applyDataSceneAuthoringDocument(e,document(false));
    ok(e.updateDataSceneSpriteAnimations([{entity:first.entityHandles.actor,frame:1,paused:true,flipX:true}]));
    const playback = e.dataSceneSpriteAnimationState(first.entityHandles.actor);
    const spec = structuredClone(animated);
    let oldCalls = 0;
    const templated = applyDataSceneAuthoringDocument(e,document(),{preserveAnimationAndLod:true,componentTemplates:()=>{
      oldCalls++; if(oldCalls>1)throw Error("previous catalog must not be read again"); return spec;
    }});
    deepEqual(e.dataSceneSpriteAnimationState(templated.entityHandles.actor),playback);
    equal(oldCalls,1);
    (spec.visual as {animationSet:{initialClip:number}}).animationSet.initialClip=1;
    const again = applyDataSceneAuthoringDocument(e,document(),{preserveAnimationAndLod:true,componentTemplates:{animated:structuredClone(animated)}});
    deepEqual(e.dataSceneSpriteAnimationState(again.entityHandles.actor),playback);
    equal(oldCalls,1);
    const inline = applyDataSceneAuthoringDocument(e,document(false),{preserveAnimationAndLod:true});
    deepEqual(e.dataSceneSpriteAnimationState(inline.entityHandles.actor),playback);
    const changed = structuredClone(animated);
    (changed.visual as {animationSet:{initialClip:number}}).animationSet.initialClip=1;
    const reset = applyDataSceneAuthoringDocument(e,document(),{preserveAnimationAndLod:true,componentTemplates:{animated:changed}});
    equal(e.dataSceneSpriteAnimationState(reset.entityHandles.actor)!.clip,1);
    equal(e.dataSceneSpriteAnimationState(reset.entityHandles.actor)!.elapsedSeconds,0);
    deepEqual(reset.document.sceneComposition.fragments.main.instances[0].props.components,{template:"animated"});
  } finally { e.destroy(); }
});

test("template continuity rollback restores native animation and prior metadata; external reset invalidates its epoch", async () => {
  const e = await engine(), configure = e.configureUnifiedPhysicsCharacter;
  try {
    const doc = document(), first = applyDataSceneAuthoringDocument(e,doc,{componentTemplates:{animated}});
    ok(e.updateDataSceneSpriteAnimations([{entity:first.entityHandles.actor,frame:1,paused:true,flipY:true}]));
    const playback = e.dataSceneSpriteAnimationState(first.entityHandles.actor);
    const controller: DataSceneComponentsSpec = {...animated,body:{kind:"kinematic-position",collider:{shape:{type:"capsule",halfHeight:0.5,radius:0.25}},character:{}}};
    e.configureUnifiedPhysicsCharacter=()=>{throw Error("late template continuity failure");};
    throws(()=>applyDataSceneAuthoringDocument(e,doc,{preserveAnimationAndLod:true,componentTemplates:{animated:controller}}),/late template continuity failure/);
    deepEqual(e.dataSceneSpriteAnimationState(first.entityHandles.actor),playback);
    e.configureUnifiedPhysicsCharacter=configure;
    const retry=applyDataSceneAuthoringDocument(e,doc,{preserveAnimationAndLod:true,componentTemplates:{animated}});
    deepEqual(e.dataSceneSpriteAnimationState(retry.entityHandles.actor),playback);
    throws(()=>captureGameStateSnapshot(e,{includeDataSceneState:true,includeDataSceneProgress:true,dataSceneAuthoringDocument:doc as unknown as SceneCompositionJsonValue}),/native physics snapshots/);
    e.useDataScene();
    throws(()=>applyDataSceneAuthoringDocument(e,doc,{preserveAnimationAndLod:true,componentTemplates:{animated}}),/previous complete default authoring/);
    equal(e.entityCount(),0);
  } finally { e.configureUnifiedPhysicsCharacter=configure; e.destroy(); }
});

test("template animation and LOD masks use detached metadata and rollback prior handles without progress reads", () => {
  const captures: {handles:number[];masks:number[]}[] = [];
  let nextId=0,failFinish=false,epoch=1;
  const unexpected=():never=>{throw Error("continuity must not read simulation progress");};
  const e=attachMemoryDataSceneVariableRuntime(attachDataSceneRuntimeEngineAdapter({
    configureUnifiedPhysics(){},bindUnifiedPhysicsBody(){},preflightDataSceneSpatialModels:()=>true,configureDataSceneSpatial:()=>true,
  } as unknown as FerrumEngine,{
    useDataScene(){},textureId:()=>11,preflightPhysics(){},spawnDataSceneEntity:()=>({entityId:++nextId,entityGeneration:1}),
    beginAuthoringContinuity(handles,masks){captures.push({handles:[...handles],masks:[...masks]});return 1;},
    finishAuthoringContinuity:()=>!failFinish,cancelAuthoringContinuity(){},
  }));
  attachNativePhysicsAuthoring(e,{supported:()=>true,finalize(){},run:operation=>operation()});
  attachDataSceneProgressAdapter(e,{epoch:()=>epoch,spatialRevision:()=>0,capture:unexpected,navigation:unexpected,obstacles:unexpected,
    animations:unexpected,viewport:unexpected,spatial:unexpected,preflightSpatial:unexpected,restore:unexpected});
  const doc=document();
  doc.spatial={camera:{projection:"orthographic",position:{x:0,y:-10,elevation:10},target:{x:0,y:0,elevation:0},height:20},terrain:[],billboards:{},
    models:{actor:{asset:"mesh",contentId:"a".repeat(64),lods:[{asset:"far",contentId:"b".repeat(64),minDistance:100}]}}};
  const first=applyDataSceneAuthoringDocument(e,doc,{componentTemplates:{animated}});
  // The public resolved document belongs to the caller; changing it must not
  // change the old continuity comparison snapshot.
  (first.document.spatial!.models!.actor.lods![0] as {minDistance:number}).minDistance=999;
  failFinish=true;
  throws(()=>applyDataSceneAuthoringDocument(e,doc,{componentTemplates:{animated},preserveAnimationAndLod:true}),/restore rejected/);
  failFinish=false;
  applyDataSceneAuthoringDocument(e,doc,{componentTemplates:{animated},preserveAnimationAndLod:true});
  deepEqual(captures[0],{handles:[first.entityHandles.actor.entityId,1],masks:[3]});
  deepEqual(captures[1],captures[0]);
  const changed=structuredClone(doc);
  (changed.spatial!.models!.actor.lods![0] as {minDistance:number}).minDistance=120;
  applyDataSceneAuthoringDocument(e,changed,{componentTemplates:{animated},preserveAnimationAndLod:true});
  deepEqual(captures[2].masks,[1]);
  const clip=structuredClone(animated);
  (clip.visual as {animationSet:{initialClip:number}}).animationSet.initialClip=1;
  applyDataSceneAuthoringDocument(e,changed,{componentTemplates:{animated:clip},preserveAnimationAndLod:true});
  deepEqual(captures[3].masks,[2]);
  epoch++;
  throws(()=>applyDataSceneAuthoringDocument(e,changed,{componentTemplates:{animated:clip},preserveAnimationAndLod:true}),/previous complete default authoring/);
});

test("flat template continuity keeps the existing JSON progress catalog restriction", async () => {
  // Reach the JSON catalog restriction without the independent native-physics gate.
  const e=await engine({ physicsBackend: "legacy" });
  try {
    const doc=document();delete doc.physics;
    const spec=structuredClone(animated);delete spec.body;
    const options={componentTemplates:{animated:spec}};
    applyDataSceneAuthoringDocument(e,doc,options);
    applyDataSceneAuthoringDocument(e,doc,{...options,preserveAnimationAndLod:true});
    throws(()=>captureGameStateSnapshot(e,{includeDataSceneState:true,includeDataSceneProgress:true,dataSceneAuthoringDocument:doc as unknown as SceneCompositionJsonValue}),/default binding options/);
  } finally {e.destroy();}
});
