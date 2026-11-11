import './nativeRuntimeTestHelper.js';
import {test} from 'node:test';
import {equal,deepEqual,ok,throws} from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import type {Engine} from '../pkg/ferrum_core.js';
import {readSpriteLightMasks,supportsSpriteLightMasks,validateSpriteLightMasks} from '../src/spriteLightMasks.js';
import {configureSpriteLighting,readSpriteLighting,resolveSpriteLightingMaterial,expandLitSpriteCommands} from '../src/spriteLighting.js';
import {snapshotRenderFrameBuffers} from '../src/frameBufferSnapshot.js';
import {normalizeLightingScene} from '../src/lightingNormalize.js';

function setup(){
 const memory=new WebAssembly.Memory({initial:1}),buffer=new Uint32Array(memory.buffer,128,2);buffer.set([0,3]);
 const words=new Uint32Array([1,0]),lighting={version:1 as const,stride:2 as const,words,values:new Float32Array(words.buffer)};
 let captured:Uint32Array|undefined,version=0;
 const native={sprite_lighting_material_abi_version:()=>1,sprite_lighting_material_size:()=>8,sprite_lighting_material_ptr:()=>256,sprite_lighting_material_len:()=>1,
  configure_sprite_lighting_materials:(value:Uint32Array)=>{captured=value.slice();version=1;return true;},configure_sprite_lighting_materials_v2:(value:Uint32Array)=>{captured=value.slice();version=2;return true;},
  sprite_light_mask_abi_version:()=>1,sprite_light_mask_size:()=>8,sprite_light_mask_ptr:()=>128,sprite_light_mask_len:()=>1};
 const read=()=>readSpriteLightMasks(native as unknown as Engine,memory,1,lighting)!;
 return {native,memory,buffer,lighting,read,captured:()=>captured,version:()=>version};
}
test('independent receiver masks preserve zero and reject unknown/invalid values or unlit declarations',()=>{
 deepEqual(resolveSpriteLightingMaterial({mode:'cutout',lightMask:0,shadowMask:255},'receiver'),{mode:'cutout',lightMask:0,shadowMask:255});
 for(const lightMask of [-1,256,NaN,.5,null,'1'])throws(()=>resolveSpriteLightingMaterial({mode:'opaque',lightMask},'receiver'),/lightMask/);
 throws(()=>resolveSpriteLightingMaterial({mode:'unlit',shadowMask:0},'receiver'),/shadowMask/);
 const scene=normalizeLightingScene({profile:'lit',enabled:false,directionalLight:{directionX:1,directionY:0,lightMask:0,shadowMask:3},pointLights:[{x:0,y:0,radius:10,lightMask:2,shadowMask:0}]});
 equal(scene.directionalLight!.lightMask,0);equal(scene.pointLights[0].shadowMask,0);
 throws(()=>normalizeLightingScene({pointLights:[{x:0,y:0,radius:10,lightMask:1}]}),/lit profile/);
 throws(()=>normalizeLightingScene({enabled:false,pointLights:[{x:0,y:0,radius:10,lightMask:0}]}),/lit profile/);
 throws(()=>normalizeLightingScene({enabled:false,directionalLight:{directionX:1,directionY:0,shadowMask:0}}),/lit profile/);
 throws(()=>normalizeLightingScene({profile:'lit',pointLights:[{x:0,y:0,radius:10,shadowMask:-1}]}),/shadowMask/);
});
test('receiver updates use atomic combined v2 only when masks are requested and reject old native before writes',()=>{
 const b=setup(),entity={entityId:4,entityGeneration:2};
 ok(configureSpriteLighting(b.native as unknown as Engine,[{entity,lighting:{mode:'opaque',lightMask:0,shadowMask:3}},{entity:{entityId:5,entityGeneration:1}}]));
 equal(b.version(),2);deepEqual([...b.captured()!],[4,2,1,0,0,3,5,1,0,0,255,255]);
 ok(configureSpriteLighting(b.native as unknown as Engine,[{entity,lighting:{mode:'opaque'}}]));equal(b.version(),1);
 const legacy={...b.native,configure_sprite_lighting_materials_v2:undefined} as unknown as Engine;
 equal(configureSpriteLighting(legacy,[{entity,lighting:{mode:'opaque',lightMask:255}}]),false);equal(b.version(),1);
 equal(configureSpriteLighting(b.native as unknown as Engine,[{entity,lighting:{mode:'opaque',lightMask:256}}]),false);equal(b.version(),1);
});
test('mask reader rejects partial ABI, unsupported layouts and unsafe pointers/counts',()=>{
 const b=setup();equal(readSpriteLightMasks({} as Engine,b.memory,1),undefined);ok(supportsSpriteLightMasks(b.native as unknown as Engine));
 for(const change of [{sprite_light_mask_size:()=>16},{sprite_light_mask_abi_version:()=>2},{sprite_light_mask_ptr:undefined}])throws(()=>readSpriteLightMasks({...b.native,...change} as unknown as Engine,b.memory,1,b.lighting),/Unsupported/);
 for(const ptr of [-4,2,b.memory.buffer.byteLength-4])throws(()=>readSpriteLightMasks({...b.native,sprite_light_mask_ptr:()=>ptr} as unknown as Engine,b.memory,1,b.lighting),/Misaligned/);
 throws(()=>readSpriteLightMasks(b.native as unknown as Engine,b.memory,2,b.lighting),/Misaligned/);deepEqual([...b.read().buffer],[0,3]);
});
test('mask packet validates channels/receiver/profile and owned deferred copies survive memory growth',()=>{
 const b=setup(),view=b.read(),commands={commandCount:1,floatsPerCommand:15,buffer:new Float32Array(15),spriteLightMasks:view,spriteLightingMaterials:b.lighting};
 ok(validateSpriteLightMasks(commands,'lit'));throws(()=>validateSpriteLightMasks(commands,'legacy'),/lit profile/);
 throws(()=>validateSpriteLightMasks({...commands,spriteLightingMaterials:undefined}),/opaque/);
 b.buffer[0]=256;throws(()=>validateSpriteLightMasks(commands),/channels/);b.buffer.set([255,255]);equal(validateSpriteLightMasks(commands),false);
 b.buffer.set([0,3]);const copy=snapshotRenderFrameBuffers({renderCommandBuffer:commands,cameraX:0,cameraY:0});b.memory.grow(1);
 equal(view.buffer.length,0);deepEqual([...b.read().buffer],[0,3]);deepEqual([...copy.renderCommandBuffer.spriteLightMasks!.buffer],[0,3]);
});
test('private mask draw staging keeps geometry/receiver prefix and independent byte channels',()=>{
 const data=new Float32Array(38),buffer=Float32Array.from({length:30},(_,i)=>i+1),masks=new Uint32Array([0,3,255,0]);data.set(buffer);
 expandLitSpriteCommands(data,{commandCount:2,floatsPerCommand:15,buffer,spriteLightMasks:{version:1,stride:2,buffer:masks}},0,2,{},false,false,false,false,true);
 deepEqual([...data.subarray(0,15)],[...buffer.subarray(0,15)]);deepEqual([...data.subarray(19,34)],[...buffer.subarray(15,30)]);
 deepEqual([...data.subarray(17,19)],[0,3]);deepEqual([...data.subarray(36,38)],[255,0]);
});
test('actual native mask sidecar keeps old receiver ABI and resets via existing default setter',async()=>{
 const core=await import('../pkg/ferrum_core.js'),wasm=core.initSync({module:await readFile(new URL('../pkg/ferrum_core_bg.wasm',import.meta.url))}),engine=new core.Engine();
 try{
  engine.use_data_scene();engine.set_viewport_size(100,100);ok(engine.configure_data_scene_camera(20,20,0xffffffff,0,false,0,0,0,0,0));
  ok(engine.spawn_data_scene_entity(20,20,0,0,7,32,64,0,0,1,1,0,0,0,1,0,0,true,true,8,8,0,0,0,0,0,0,new Float32Array()));
  const entity={entityId:engine.data_scene_entity_id(),entityGeneration:engine.data_scene_entity_generation()};
  ok(configureSpriteLighting(engine,[{entity,lighting:{mode:'opaque',lightMask:0,shadowMask:3}}]));engine.update(0);
  deepEqual([...readSpriteLightMasks(engine,wasm.memory,1,readSpriteLighting(engine,wasm.memory,1))!.buffer],[0,3]);
  equal(engine.sprite_lighting_material_size(),8);equal(engine.sprite_surface_material_size(),40);
  ok(configureSpriteLighting(engine,[{entity,lighting:{mode:'opaque'}}]));engine.update(0);equal(readSpriteLightMasks(engine,wasm.memory,1),undefined);
 }finally{engine.free();}
});
