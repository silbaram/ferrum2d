import { deepEqual, equal, ok, throws } from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import type { Engine } from '../pkg/ferrum_core.js';
import { configureSpriteLighting, readSpriteLighting, supportsSpriteLighting, validateSpriteLighting, expandLitSpriteCommands } from '../src/spriteLighting.js';
import { normalizeLightingScene } from '../src/lightingNormalize.js';
import { resolveTextureColorSpace } from '../src/colorManagement.js';
import { resolveDataSceneComponentsSpec } from '../src/dataSceneComponents.js';
import { snapshotRenderFrameBuffers } from '../src/frameBufferSnapshot.js';
import { captureGameStateSnapshot, restoreGameStateSnapshot, createEngine } from '../src/core.js';
import { applyDataSceneAuthoringDocument, resolveSceneAuthoringDocument } from '../src/authoring.js';
import { attachDataSceneRuntimeEngineAdapter } from '../src/dataSceneRuntimeTarget.js';
import type { FerrumEngine } from '../src/engineTypes.js';
import type { RenderCommandBufferView } from '../src/renderCommandDecoder.js';

function packet():RenderCommandBufferView { const words=new Uint32Array(4),values=new Float32Array(words.buffer);words[0]=2;values[1]=Math.fround(.502);return {commandCount:2,floatsPerCommand:15,buffer:new Float32Array(30),spriteLightingMaterials:{version:1,stride:2,words,values}}; }
test('lit normalization is explicit, round trips, preserves disabled profile and bounds float irradiance',()=>{
 const lit=normalizeLightingScene({profile:'lit',ambientIrradiance:[.1,.2,.3]});deepEqual(normalizeLightingScene(JSON.parse(JSON.stringify(lit))),lit);
 equal(normalizeLightingScene({profile:'lit',enabled:false}).profile,'lit');equal(normalizeLightingScene(false).profile,undefined);equal(normalizeLightingScene({}).profile,undefined);
 for(const value of [{profile:'bad'},{ambientIrradiance:[1,1,1]},{profile:'lit',ambient:[1,0,0,1]},{profile:'lit',ambientIrradiance:[-1,1,1]},{profile:'lit',ambientIrradiance:[1,Infinity,1]},{profile:'lit',pointLights:Array(33).fill({x:0,y:0,radius:1})},{profile:'lit',pointLights:[{x:0,y:0,radius:1,intensity:65}]},{profile:'lit',debug:{tileOccluders:true}}])throws(()=>normalizeLightingScene(value as never));
 throws(()=>resolveTextureColorSpace({alphaMode:'premultiplied'} as never));equal(resolveTextureColorSpace({alphaMode:'straight'}),'srgb');
});
test('receiver sidecar is aliased, copied for owned frames and expanded without losing command order',()=>{
 const original=packet();original.buffer=Float32Array.from({length:30},(_,i)=>i);
 const copy=snapshotRenderFrameBuffers({renderCommandBuffer:original,cameraX:0,cameraY:0}).renderCommandBuffer;ok(copy.spriteLightingMaterials!.words.buffer===copy.spriteLightingMaterials!.values.buffer);ok(copy.spriteLightingMaterials!.words.buffer!==original.spriteLightingMaterials!.words.buffer);
 original.spriteLightingMaterials!.values[1]=.1;equal(copy.spriteLightingMaterials!.values[1],Math.fround(.502));
 const staging=new Float32Array(34);staging.set(copy.buffer);expandLitSpriteCommands(staging,copy,0,2,{textureInfo:()=>({colorSpace:'srgb'})},false);deepEqual(Array.from(staging.slice(0,15)),Array.from(copy.buffer.slice(0,15)));deepEqual(Array.from(staging.slice(17,32)),Array.from(copy.buffer.slice(15,30)));equal(staging[15],6);equal(staging[16],Math.fround(.502));equal(staging[32],4);
 throws(()=>validateSpriteLighting({...copy,spriteLightingMaterials:{...copy.spriteLightingMaterials!,values:new Float32Array(4)}}));
});
test('optional ABI rejects mixed versions and validates whole batches before native mutation',()=>{
 const memory=new WebAssembly.Memory({initial:1});const view=packet().spriteLightingMaterials!;new Uint32Array(memory.buffer,32,4).set(view.words);const calls:Uint32Array[]=[];
 const raw={sprite_lighting_material_abi_version:()=>1,sprite_lighting_material_size:()=>8,sprite_lighting_material_ptr:()=>32,sprite_lighting_material_len:()=>2,configure_sprite_lighting_materials:(v:Uint32Array)=>{calls.push(v);return true;}};const engine=raw as unknown as Engine;
 equal(supportsSpriteLighting({} as Engine),false);equal(readSpriteLighting({} as Engine,memory,2),undefined);
 for(const key of Object.keys(raw)){throws(()=>readSpriteLighting({...raw,[key]:undefined} as unknown as Engine,memory,2));}
 ok(readSpriteLighting(engine,memory,2));throws(()=>readSpriteLighting(engine,memory,3));
 const valid={entity:{entityId:1,entityGeneration:2},lighting:{mode:'cutout' as const,alphaCutoff:.502}};
 equal(configureSpriteLighting(engine,[valid,{entity:{entityId:2,entityGeneration:1},lighting:{mode:'opaque',alphaCutoff:.5}}]),false);equal(calls.length,0);
 ok(configureSpriteLighting(engine,[valid]));equal(new Float32Array(calls[0].buffer)[3],Math.fround(.502));
});
test('authoring validates sprite receiver fields without applying them to primitives',()=>{
 const resolved=resolveDataSceneComponentsSpec({visual:{kind:'sprite',texture:1,width:8,height:8,lighting:{mode:'cutout',alphaCutoff:.502}},collider:'none',layer:'wall'});ok(resolved.mode==='inline');if(resolved.mode==='inline')deepEqual(resolved.sprite.lighting,{mode:'cutout',alphaCutoff:.502});
 for(const lighting of [{mode:'cutout',alphaCutoff:NaN},{mode:'opaque',alphaCutoff:.5},{mode:'lit'},{mode:'unlit',extra:true}])throws(()=>resolveDataSceneComponentsSpec({sprite:{texture:1,width:8,height:8,lighting},collider:'none',layer:'wall'}));
 throws(()=>resolveDataSceneComponentsSpec({visual:{kind:'primitive',shape:'rectangle',width:8,height:8,lighting:{mode:'opaque'}},collider:'none',layer:'wall'}));
});
test('oversized receiver batches fail before resolving assets or replacing the live scene', () => {
 const events: string[] = [];
 const engine = attachDataSceneRuntimeEngineAdapter({
  configureSpriteLightingMaterials: () => { events.push('configure'); return true; },
 } as unknown as FerrumEngine, {
  supportsSpriteLightingMaterials: () => true,
  useDataScene: () => { events.push('activate'); },
  textureId: () => { events.push('texture'); return 1; },
  spawnDataSceneEntity: () => { events.push('spawn'); return { entityId: 1, entityGeneration: 1 }; },
 });
 const document = {
  format: 'ferrum2d.consumer.scene-authoring', version: 1,
  lighting: { profile: 'lit' },
  sceneComposition: {
   prefabs: { sprite: { props: { components: {
    sprite: { texture: 'color', width: 8, height: 8, lighting: { mode: 'opaque' } }, collider: 'none', layer: 'wall',
   } } } },
   fragments: { main: { instances: Array.from({ length: 65_537 }, (_, i) => ({ id: `sprite_${i}`, prefab: 'sprite' })) } },
  },
  behaviorRecipes: { entities: {} },
 };
 throws(() => applyDataSceneAuthoringDocument(engine, document, {
  path: 'largeScene', flatLightingPreparer: { prepareFlatLighting: () => { events.push('preflight'); } },
 }), /largeScene\.components\.lighting.*at most 65536 sprite lighting materials/);
 equal(events.length, 0);
});
test('native authoring preflights lit assets before replacing the live scene and round trips documents',async()=>{
 const fetch=globalThis.fetch;globalThis.fetch=(async(input,options)=>String(input).startsWith('file:')?new Response(Uint8Array.from(await readFile(new URL(String(input)))).buffer,{headers:{'Content-Type':'application/wasm'}}):fetch(input,options)) as typeof fetch;
 const engine=await createEngine();try{
 const document={format:'ferrum2d.consumer.scene-authoring',version:1,lighting:{profile:'lit',ambientIrradiance:[.2,.2,.2]},sceneComposition:{initialFragment:'main',prefabs:{sprite:{}},fragments:{main:{instances:[{id:'hero',prefab:'sprite',x:20,y:20,props:{components:{sprite:{texture:1,width:8,height:8,lighting:{mode:'cutout',alphaCutoff:.502}},collider:'none',layer:'wall'}}}]}}},behaviorRecipes:{entities:{}}};
 const preflights:unknown[]=[];const options={flatLightingPreparer:{prepareFlatLighting:(scene:unknown,assets:unknown)=>{preflights.push([scene,assets]);}}};
 const applied=applyDataSceneAuthoringDocument(engine,document,options);equal(engine.entityCount(),1);equal(preflights.length,1);deepEqual(resolveSceneAuthoringDocument(JSON.parse(JSON.stringify(document)),{validateBindings:true,validateComponents:true}),applied.document);
 const saved=captureGameStateSnapshot(engine,{includeDataSceneState:true,includeDataSceneProgress:true,dataSceneAuthoringDocument:document});
 const handle=applied.entityHandles.hero;throws(()=>restoreGameStateSnapshot(engine,saved),/preflight/);ok(engine.configureSpriteLightingMaterials([{entity:handle,lighting:{mode:'cutout'}}]));
 ok(restoreGameStateSnapshot(engine,JSON.parse(JSON.stringify(saved)),{dataSceneAuthoringApplyOptions:options}).dataSceneAuthoringDocumentApplied);
 const fresh=applyDataSceneAuthoringDocument(engine,document,options).entityHandles.hero;
throws(()=>applyDataSceneAuthoringDocument(engine,document),/preflight/);throws(()=>applyDataSceneAuthoringDocument(engine,document,{flatLightingPreparer:{prepareFlatLighting:()=>{throw Error('bad alpha');}}}),/bad alpha/);equal(engine.entityCount(),1);ok(engine.configureSpriteLightingMaterials([{entity:fresh,lighting:{mode:'opaque'}}]));
 const selected = { ...document, sceneComposition: { ...document.sceneComposition,
  fragments: { ...document.sceneComposition.fragments, alternate: { instances: [{ id: 'other', prefab: 'sprite', props: { components: {
   sprite: { texture: 2, width: 8, height: 8, lighting: { mode: 'opaque' } }, collider: 'none', layer: 'wall',
  } } }] } },
 } };
 const selection = applyDataSceneAuthoringDocument(engine, selected, {
  fragment: 'alternate', flatLightingPreparer: { prepareFlatLighting: (_scene, assets) => {
   equal(assets.length, 1); equal(assets[0].textureId, 2);
  } },
 });
 ok(selection.entityHandles.other); equal(engine.entityCount(), 1);
 const hdrDocument={...document,lighting:{...document.lighting,hdr:{enabled:false,exposure:2,toneMapping:'aces' as const}}};
 applyDataSceneAuthoringDocument(engine,hdrDocument,options);
 const hdrSaved=captureGameStateSnapshot(engine,{includeDataSceneState:true,includeDataSceneProgress:true,dataSceneAuthoringDocument:hdrDocument});
 const hdrRestored=restoreGameStateSnapshot(engine,JSON.parse(JSON.stringify(hdrSaved)),{dataSceneAuthoringApplyOptions:options});
 ok(hdrRestored.dataSceneAuthoringDocumentApplied);
 deepEqual(resolveSceneAuthoringDocument(hdrDocument).lighting!.hdr,hdrDocument.lighting.hdr);
 }finally{engine.destroy();globalThis.fetch=fetch;}
});
