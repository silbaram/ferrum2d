import './nativeRuntimeTestHelper.js';
import {test} from 'node:test';
import {deepEqual,equal,ok,throws} from 'node:assert/strict';
import {createEngine,captureGameStateSnapshot,restoreGameStateSnapshot,hashGameStateSnapshot} from '../src/core.js';
import {applyDataSceneAuthoringDocument,createSceneInstanceHandleRegistry,createScenePlacementViewer,mergeScenePlacementPatch,resolveSceneAuthoringDocument} from '../src/authoring.js';
import {attachDataSceneRuntimeEngineAdapter} from '../src/dataSceneRuntimeTarget.js';
import {validateFlatLitAsset,type FlatLightingAsset} from '../src/flatLit.js';
import type {LightingScene2D} from '../src/lightingTypes.js';
const components=()=>({visual:{kind:'sprite' as const,texture:1,width:16,height:16,lighting:{mode:'cutout' as const,alphaCutoff:.5,lightMask:0,shadowMask:3}},collider:'none' as const,layer:'wall' as const});
const document=()=>({format:'ferrum2d.consumer.scene-authoring' as const,version:1 as const,lighting:{profile:'lit' as const,enabled:false,ambientIrradiance:[0,0,0] as const,pointLights:[{x:0,y:0,radius:10,lightMask:1,shadowMask:2}]},sceneComposition:{initialFragment:'main',prefabs:{object:{}},fragments:{main:{instances:[{id:'hero',prefab:'object',props:{components:components()}}]}}},behaviorRecipes:{entities:{}}});
function options(){const calls:readonly FlatLightingAsset[][]=[];return {calls,flatLightingPreparer:{prepareFlatLighting:(_scene:LightingScene2D,assets:readonly FlatLightingAsset[])=>{for(const asset of assets)validateFlatLitAsset({textureInfo:()=>({width:1,height:1,colorSpace:'srgb',alphaMode:'straight'})},asset);(calls as FlatLightingAsset[][]).push([...assets]);}}};}

test('authored masks preserve zero/OFF values through preflight, patch undo/redo and JSON fresh-handle restore',async()=>{
 const engine=await createEngine(),p=options(),registry=createSceneInstanceHandleRegistry(),applyOptions={flatLightingPreparer:p.flatLightingPreparer,instanceHandleRegistry:registry};
 try{
  const doc=document();applyDataSceneAuthoringDocument(engine,doc,applyOptions);
  equal(p.calls[0][0].lighting.lightMask,0);equal(p.calls[0][0].lighting.shadowMask,3);
  const viewer=createScenePlacementViewer({document:doc,viewport:{cssWidth:96,cssHeight:64},selectedInstanceId:'hero'}),changed=components();changed.visual.lighting.shadowMask=0;
  viewer.updateInstanceComponents('hero',changed);const patch=JSON.parse(JSON.stringify(viewer.exportPatch()));
  const merged=mergeScenePlacementPatch(doc,patch).document;equal((merged.sceneComposition.fragments!.main.instances![0].props!.components as ReturnType<typeof components>).visual.lighting.shadowMask,0);
  viewer.undo();equal(viewer.exportPatch(),undefined);viewer.redo();deepEqual(viewer.exportPatch(),patch);equal(viewer.retainsAssetReference('mask-is-not-an-asset',3),false);
  const patched=applyDataSceneAuthoringDocument(engine,merged,applyOptions).entityHandles.hero;
  const saved=JSON.parse(JSON.stringify(captureGameStateSnapshot(engine,{includeDataSceneState:true,includeDataSceneProgress:true,dataSceneAuthoringDocument:JSON.parse(JSON.stringify(merged))})));
  ok(JSON.stringify(saved).includes('"lightMask":0'));ok(JSON.stringify(saved).includes('"enabled":false'));
  ok(restoreGameStateSnapshot(engine,saved,{dataSceneAuthoringApplyOptions:applyOptions}).dataSceneAuthoringDocumentApplied);
  const fresh=registry.entries().find(entry=>entry.instanceId==='hero')!.handle;
  equal(engine.configureSpriteLightingMaterials([{entity:patched,lighting:{mode:'opaque',lightMask:0,shadowMask:0}}]),false);
  ok(engine.configureSpriteLightingMaterials([{entity:fresh,lighting:{mode:'opaque',lightMask:0,shadowMask:0}}]));
 }finally{engine.destroy();}
});
test('invalid profiles/channels and missing native mask capability fail before restore changes current scene',async()=>{
 const engine=await createEngine(),p=options(),registry=createSceneInstanceHandleRegistry(),applyOptions={flatLightingPreparer:p.flatLightingPreparer,instanceHandleRegistry:registry};
 try{
  const doc=document(),first=applyDataSceneAuthoringDocument(engine,doc,applyOptions).entityHandles.hero;
  const invalid=document();invalid.sceneComposition.fragments.main.instances[0].props.components.visual.lighting.lightMask=256;
  throws(()=>applyDataSceneAuthoringDocument(engine,invalid,applyOptions),/lightMask/);
  const badProfile=structuredClone(doc);delete (badProfile as {lighting?:unknown}).lighting;throws(()=>resolveSceneAuthoringDocument(badProfile,{validateComponents:true}),/flat lit/);
  const saved=JSON.parse(JSON.stringify(captureGameStateSnapshot(engine,{includeDataSceneState:true,includeDataSceneProgress:true,dataSceneAuthoringDocument:doc})));
  saved.dataScene.authoringDocument=badProfile;saved.snapshotHash=hashGameStateSnapshot(saved);throws(()=>restoreGameStateSnapshot(engine,saved,{dataSceneAuthoringApplyOptions:applyOptions}),/flat lit/);
  saved.dataScene.authoringDocument=doc;saved.snapshotHash=hashGameStateSnapshot(saved);
  const legacy=attachDataSceneRuntimeEngineAdapter({...engine},{supportsSpriteLightingMaterials:()=>true,useDataScene:()=>{throw Error('must not activate');},textureId:()=>{throw Error('must not resolve');},spawnDataSceneEntity:()=>undefined});
  throws(()=>restoreGameStateSnapshot(legacy,saved,{dataSceneAuthoringApplyOptions:applyOptions}),/native support/);
  equal(engine.entityCount(),1);deepEqual(registry.entries().find(entry=>entry.instanceId==='hero')!.handle,first);
  ok(engine.configureSpriteLightingMaterials([{entity:first,lighting:{mode:'opaque',lightMask:0,shadowMask:0}}]));
 }finally{engine.destroy();}
});
