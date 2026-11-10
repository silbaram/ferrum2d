import './nativeRuntimeTestHelper.js';
import {test} from 'node:test';
import {deepEqual,equal,ok,throws} from 'node:assert/strict';
import {createEngine,captureGameStateSnapshot,restoreGameStateSnapshot,hashGameStateSnapshot} from '../src/core.js';
import type {LightingScene2D} from '../src/lightingTypes.js';
import {resolveDataSceneComponentsSpec} from '../src/dataSceneComponents.js';
import {applyDataSceneAuthoringDocument,createSceneInstanceHandleRegistry,createScenePlacementViewer,mergeScenePlacementPatch,resolveSceneAuthoringDocument} from '../src/authoring.js';
import {validateFlatLitAsset,type FlatLightingAsset} from '../src/flatLit.js';
import {attachDataSceneRuntimeEngineAdapter} from '../src/dataSceneRuntimeTarget.js';

const surface={emission:[4,2,1] as const,specular:0,roughness:0,emissionTexture:'glow',specularTexture:'specular',roughnessTexture:'roughness'};
function components(value=surface){return {visual:{kind:'sprite' as const,texture:'base',width:16,height:16,lighting:{mode:'opaque' as const},surface:structuredClone(value)},collider:'none' as const,layer:'wall' as const};}
function document(){return {format:'ferrum2d.consumer.scene-authoring' as const,version:1 as const,lighting:{profile:'lit' as const,hdr:{toneMapping:'none' as const},ambientIrradiance:[0,0,0] as const},
 sceneComposition:{initialFragment:'main',prefabs:{object:{}},fragments:{main:{instances:[{id:'hero',prefab:'object',props:{components:components()}}]}}},behaviorRecipes:{entities:{}}};}
const ids:Record<string,number>={base:1,glow:12,specular:10,roughness:11};
function preflight(){
 const calls:{scene:LightingScene2D;assets:readonly FlatLightingAsset[]}[]=[];
 const source={textureInfo:(id:number)=>Object.values(ids).includes(id)?{width:1,height:1,colorSpace:id===10||id===11?'none' as const:'srgb' as const,alphaMode:'straight' as const}:undefined};
 return {calls,options:{textureId:(name:string)=>{if(!(name in ids))throw Error('missing asset');return ids[name];},flatLightingPreparer:{prepareFlatLighting:(scene:LightingScene2D,assets:readonly FlatLightingAsset[])=>{for(const asset of assets)validateFlatLitAsset(source,asset,true);calls.push({scene,assets});}}}};
}
test('surface schema preserves stable map refs and explicit zero coefficients across visual/sprite forms',()=>{
 const resolved=resolveDataSceneComponentsSpec(components());if(resolved.mode!=='inline')throw Error('Expected inline surface');
 deepEqual(resolved.sprite.surface,{emission:[4,2,1],specular:0,roughness:0,emissionTexture:{kind:'asset',value:'glow',name:'glow'},specularTexture:{kind:'asset',value:'specular',name:'specular'},roughnessTexture:{kind:'asset',value:'roughness',name:'roughness'}});
 deepEqual(resolved.visual.kind==='sprite'?resolved.visual.surface:undefined,resolved.sprite.surface);
 const shortcut=resolveDataSceneComponentsSpec({sprite:{texture:'base',width:16,height:16,lighting:{mode:'opaque'},surface},collider:'none',layer:'wall'});if(shortcut.mode!=='inline')throw Error('Expected inline surface');deepEqual(shortcut.sprite.surface,resolved.sprite.surface);
 for(const invalid of [null,{metallic:1},{emissionTextureId:12},{specularTexture:''},{roughnessTexture:16777215},{emission:[1,2,65]}])throws(()=>resolveDataSceneComponentsSpec({...components(),visual:{...components().visual,surface:invalid}}),/surface/);
 throws(()=>resolveDataSceneComponentsSpec({...components(),visual:{...components().visual,lighting:{mode:'unlit'}}}),/opaque\/cutout/);
 throws(()=>resolveDataSceneComponentsSpec({visual:{kind:'primitive',shape:'rect',width:16,height:16,surface},collider:'none',layer:'wall'}),/surface/);
 const wrong=document();delete (wrong as {lighting?:unknown}).lighting;throws(()=>resolveSceneAuthoringDocument(wrong,{validateComponents:true}),/flat lit/);
});
test('authored maps preflight as numeric IDs and survive JSON restore with fresh native handles',async()=>{
 const engine=await createEngine(),p=preflight(),registry=createSceneInstanceHandleRegistry(),options={...p.options,instanceHandleRegistry:registry};
 try{
  const doc=document(),applied=applyDataSceneAuthoringDocument(engine,doc,options);equal(engine.entityCount(),1);
  deepEqual(p.calls[0].assets[0].surface,{emission:[4,2,1],specular:0,roughness:0,emissionTextureId:12,specularTextureId:10,roughnessTextureId:11});
  const snapshot=JSON.parse(JSON.stringify(captureGameStateSnapshot(engine,{includeDataSceneState:true,includeDataSceneProgress:true,dataSceneAuthoringDocument:doc})));
  ok(JSON.stringify(snapshot).includes('"emissionTexture":"glow"'));ok(!JSON.stringify(snapshot).includes('emissionTextureId'));
  ok(restoreGameStateSnapshot(engine,snapshot,{dataSceneAuthoringApplyOptions:options}).dataSceneAuthoringDocumentApplied);
  const fresh=registry.entries().find(entry=>entry.instanceId==='hero')!.handle,old=applied.entityHandles.hero;
  ok(fresh.entityId!==old.entityId||fresh.entityGeneration!==old.entityGeneration);
  equal(engine.configureSpriteSurfaceMaterials([{entity:old,surface:{emission:[1,0,0]}}]),false);
  ok(engine.configureSpriteSurfaceMaterials([{entity:fresh,surface:{emission:[4,2,1],emissionTextureId:12}}]));
 }finally{engine.destroy();}
});
test('invalid map names/roles and restored surface profiles leave current entities and registry intact',async()=>{
 const engine=await createEngine(),p=preflight(),registry=createSceneInstanceHandleRegistry(),options={...p.options,instanceHandleRegistry:registry};
 try{
  const doc=document(),old=applyDataSceneAuthoringDocument(engine,doc,options).entityHandles.hero;
  const missing=document();missing.sceneComposition.fragments.main.instances[0].props.components.visual.surface.emissionTexture='missing';
  throws(()=>applyDataSceneAuthoringDocument(engine,missing,options),/not registered/);equal(engine.entityCount(),1);
  const role=document();role.sceneComposition.fragments.main.instances[0].props.components.visual.surface.specularTexture='glow';
  throws(()=>applyDataSceneAuthoringDocument(engine,role,options),/Surface maps/);
  const saved=JSON.parse(JSON.stringify(captureGameStateSnapshot(engine,{includeDataSceneState:true,includeDataSceneProgress:true,dataSceneAuthoringDocument:doc})));
  saved.dataScene.authoringDocument=role;saved.snapshotHash=hashGameStateSnapshot(saved);throws(()=>restoreGameStateSnapshot(engine,saved,{dataSceneAuthoringApplyOptions:options}),/Surface maps/);
  const badProfile=structuredClone(saved);delete badProfile.dataScene.authoringDocument.lighting;badProfile.snapshotHash=hashGameStateSnapshot(badProfile);
  throws(()=>restoreGameStateSnapshot(engine,badProfile,{dataSceneAuthoringApplyOptions:options}),/flat lit/);
  const valid=JSON.parse(JSON.stringify(captureGameStateSnapshot(engine,{includeDataSceneState:true,includeDataSceneProgress:true,dataSceneAuthoringDocument:doc})));
  const unsupported=attachDataSceneRuntimeEngineAdapter({...engine},{supportsSpriteLightingMaterials:()=>true,
   useDataScene:()=>{throw Error('must preflight before scene change');},textureId:()=>{throw Error('must preflight before asset lookup');},spawnDataSceneEntity:()=>undefined});
  throws(()=>restoreGameStateSnapshot(unsupported,valid,{dataSceneAuthoringApplyOptions:options}),/native v1/);
  deepEqual(registry.entries().find(entry=>entry.instanceId==='hero')!.handle,old);
  ok(engine.configureSpriteSurfaceMaterials([{entity:old,surface:{emission:[1,0,0]}}]));
 }finally{engine.destroy();}
});
test('surface component patches merge deterministically and retain map revisions across undo/redo',()=>{
 const doc=document(),viewer=createScenePlacementViewer({document:doc,viewport:{cssWidth:96,cssHeight:64},selectedInstanceId:'hero'});
 viewer.updateInstanceComponents('hero',components({...surface,emissionTexture:'glow.next'}));
 const patch=JSON.parse(JSON.stringify(viewer.exportPatch()));ok(patch);
 const merged=mergeScenePlacementPatch(doc,patch).document;
 equal((merged.sceneComposition.fragments!.main.instances![0].props!.components as ReturnType<typeof components>).visual.surface.emissionTexture,'glow.next');
 viewer.undo();equal(viewer.exportPatch(),undefined);ok(viewer.retainsAssetReference('glow.next'));viewer.redo();deepEqual(viewer.exportPatch(),patch);
 viewer.updateInstanceComponents('hero',{...components(),visual:{...components().visual,surface:{emissionTexture:42,specularTexture:43,roughnessTexture:44}}});
 for(const id of [42,43,44])ok(viewer.retainsAssetReference('numeric-map',id));
 equal(viewer.retainsAssetReference('dimension',16),false);
});
