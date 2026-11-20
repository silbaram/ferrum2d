import {deepEqual, equal, throws} from "node:assert/strict";
import {test} from "node:test";
import {createUnifiedPhysicsAuthoringApi, type UnifiedPhysicsShape} from "../src/unifiedPhysicsAuthoring.js";
import {queryUnifiedPhysicsCharacterStates} from "../src/unifiedPhysicsCharacters.js";

test("authoring rejects over-capacity, nested and lossy metadata before native creation",()=>{
  let calls=0;
  const api=createUnifiedPhysicsAuthoringApi({
    unified_physics_authoring_version:()=>1,
    spawn_unified_physics_body:()=>{calls++;return new Uint32Array([9,2]);},
    remove_unified_physics_body:()=>{},
  },()=>{});
  const bad:UnifiedPhysicsShape[]=[
    {type:"heightfield",rows:65536,columns:65536,size:[1,1],heights:[]},
    {type:"triangleMesh",vertices:[0,0,0,1,0,0,0,0,1],triangles:[0,1,2**32]},
    {type:"triangleMesh",vertices:[0,0,0,1,0,0,0,0,1],triangles:[0,1,1.5]},
    {type:"convexHull",points:Array.from({length:257},()=>[0,0,0])},
    {type:"sphere",radius:1e100},
  ];
  for(const shape of bad)throws(()=>api.spawnUnifiedPhysicsBody({collider:{shape}}));
  const recursive={type:"compound",parts:[]} as unknown as {type:"compound";parts:{shape:UnifiedPhysicsShape}[]};
  recursive.parts.push({shape:recursive as UnifiedPhysicsShape});
  throws(()=>api.spawnUnifiedPhysicsBody({collider:{shape:recursive as UnifiedPhysicsShape}}),/convex/);
  equal(calls,0);
  deepEqual(api.spawnUnifiedPhysicsBody({collider:{shape:{type:"sphere",radius:1}}}),{entityId:9,entityGeneration:2});
  equal(calls,1);
});

test("character query copies native aliases and reacquires state after memory growth",()=>{
  const memory=new WebAssembly.Memory({initial:1});const handles=new Uint32Array(memory.buffer,0,2);handles.set([8,4]);
  let calls=0;
  const native={
    unified_physics_character_version:()=>1,configure_unified_physics_character:()=>{},set_unified_physics_character_inputs:()=>{},
    unified_physics_character_state_stride_words:()=>28,unified_physics_character_state_count:()=>1,unified_physics_character_state_ptr:()=>256,
    query_unified_physics_character_states:(h:Uint32Array)=>{
      calls++;memory.grow(1);deepEqual([...h],[8,4]);
      new Uint32Array(memory.buffer,256,3).set([8,4,129]);new Float32Array(memory.buffer,256+18*4,1)[0]=3;
    },
  };
  const state=queryUnifiedPhysicsCharacterStates(native,memory,handles);
  equal(calls,1);equal(state.stride,28);equal(state.count,1);equal(state.words[2],129);equal(state.floats[18],3);
  native.unified_physics_character_state_stride_words=()=>27;
  throws(()=>queryUnifiedPhysicsCharacterStates(native,memory,new Uint32Array([8,4])),/version 1/);
  equal(calls,1);
});
