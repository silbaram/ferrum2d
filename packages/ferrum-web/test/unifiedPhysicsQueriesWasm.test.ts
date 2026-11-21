import {deepEqual,equal,ok,throws} from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {test} from "node:test";
import {createEngine,initializeFerrumWasm,createUnifiedPhysicsQueryBatch,UNIFIED_PHYSICS_QUERY_LAYOUT as Q,
  UNIFIED_PHYSICS_STATE_LAYOUT as S} from "../src/core.js";
import {wasm_memory} from "../pkg/ferrum_core.js";

test("public mixed queries return XYZ geometry and truncation, reuse input and reacquire grown Wasm memory",async()=>{
  await initializeFerrumWasm(await readFile(new URL("../pkg/ferrum_core_bg.wasm",import.meta.url)));
  const e=await createEngine();
  try{
    e.useDataScene();e.configureUnifiedPhysics({space:"spatial",gravity:[0,0,0],lengthUnit:1});
    const collider={shape:{type:"sphere" as const,radius:0.5}};
    const a=e.spawnUnifiedPhysicsBody({kind:"fixed",collider,renderOffset:[0,100,0]});
    e.spawnUnifiedPhysicsBody({kind:"fixed",pose:{position:[0,-3,0]},collider});
    const batch=createUnifiedPhysicsQueryBatch([
      {type:"ray",origin:[0,10,0],direction:[0,-7,0],maxDistance:20,limit:1},
      {type:"point",point:[0,0,0]},
      {type:"overlap",shape:{type:"box",halfExtents:[0.25,0.25,0.25]}},
      {type:"sweep",shape:{type:"sphere",radius:0.25},pose:{position:[0,2,0]},translation:[0,-4,0]},
      {type:"nearest",point:[0,2,0],maxDistance:5},
    ]);
    let result=e.queryUnifiedPhysics(batch);
    deepEqual([...result.summaries],[0,1,1,1,1,0,2,1,0,3,1,0,4,2,0]);
    equal(result.queryCount,5);equal(result.hitCount,6);equal(result.stride,19);
    equal(result.words[Q.entity],a.entityId);equal(result.words[Q.entity+1],a.entityGeneration);
    equal(result.floats[Q.value],9.5);deepEqual([...result.floats.slice(Q.point,Q.point+3)],[0,0.5,0]);
    ok(Math.abs(result.floats[3*Q.hitStride+Q.value]-0.3125)<1e-4);
    const copy=result.words.slice();wasm_memory().grow(1);equal(result.words.length,0);
    result=e.queryUnifiedPhysics(batch);deepEqual(result.words,copy);
    batch.values[Q.inputPosition]=5;result=e.queryUnifiedPhysics(batch);equal(result.summaries[Q.summaryCount],0);
    e.setUnifiedPhysicsPoses(new Uint32Array([a.entityId,a.entityGeneration]),new Float32Array([5,0,0,0,0,0,1]));
    result=e.queryUnifiedPhysics(batch);equal(result.summaries[Q.summaryCount],1);equal(result.floats[Q.value],9.5);
    const h=e.queryUnifiedPhysicsBodyStates(new Uint32Array([a.entityId,a.entityGeneration]));
    equal(h.floats[S.position],5);equal(h.floats[S.position+1],0);
    batch.values[4*Q.inputStride+Q.inputDistance]=-1;throws(()=>e.queryUnifiedPhysics(batch));
    batch.values[4*Q.inputStride+Q.inputDistance]=5;equal(e.queryUnifiedPhysics(batch).queryCount,5);
  }finally{e.destroy();}
  throws(()=>e.queryUnifiedPhysics(createUnifiedPhysicsQueryBatch([])),/destroyed/i);
});

test("public planar queries respect sensor and generation filters after immediate removal",async()=>{
  await initializeFerrumWasm(await readFile(new URL("../pkg/ferrum_core_bg.wasm",import.meta.url)));
  const e=await createEngine();
  try{
    e.useDataScene();e.configureUnifiedPhysics({space:"planar-xy",gravity:[0,0,0],lengthUnit:1});
    const a=e.spawnUnifiedPhysicsBody({kind:"fixed",collider:{shape:{type:"sphere",radius:0.5},sensor:true,category:2,mask:4}});
    const ray={type:"ray" as const,origin:[0,10,0] as const,direction:[0,-1,0] as const,maxDistance:20};
    equal(e.queryUnifiedPhysics(createUnifiedPhysicsQueryBatch([ray])).hitCount,0);
    const visible=createUnifiedPhysicsQueryBatch([{...ray,filter:{includeSensors:true,category:1,respectTargetMask:false}}]);
    let result=e.queryUnifiedPhysics(visible);equal(result.hitCount,1);ok(result.words[Q.flags]&Q.sensorFlag);
    const excludeCollider={slot:result.words[Q.collider],generation:result.words[Q.collider+1]};
    equal(e.queryUnifiedPhysics(createUnifiedPhysicsQueryBatch([{...ray,filter:{includeSensors:true,excludeCollider}}])).hitCount,0);
    equal(e.queryUnifiedPhysics(createUnifiedPhysicsQueryBatch([{...ray,filter:{includeSensors:true,excludeBody:a}}])).hitCount,0);
    const tilted=createUnifiedPhysicsQueryBatch([{...ray,direction:[0,-1,1]}]);throws(()=>e.queryUnifiedPhysics(tilted));
    e.removeUnifiedPhysicsBody(a);equal(e.queryUnifiedPhysics(visible).hitCount,0);
    throws(()=>e.queryUnifiedPhysics(createUnifiedPhysicsQueryBatch([{...ray,filter:{excludeCollider}}])));
    throws(()=>e.queryUnifiedPhysics(createUnifiedPhysicsQueryBatch([{...ray,filter:{excludeBody:a}}])));
    const next=e.spawnUnifiedPhysicsBody({kind:"fixed",collider:{shape:{type:"sphere",radius:0.5}}});
    result=e.queryUnifiedPhysics(visible);equal(result.words[Q.entity],next.entityId);equal(result.words[Q.entity+1],next.entityGeneration);
  }finally{e.destroy();}
});
