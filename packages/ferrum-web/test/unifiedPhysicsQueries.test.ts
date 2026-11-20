import {deepEqual,equal,throws} from "node:assert/strict";
import {test} from "node:test";
import {createUnifiedPhysicsQueryBatch,queryUnifiedPhysics,UNIFIED_PHYSICS_QUERY_LAYOUT as Q} from "../src/unifiedPhysicsQueries.js";

test("query compilation bounds aggregate capacity, flags, vector conversion and convex geometry",()=>{
  const ray={type:"ray" as const,origin:[0,1,0] as const,direction:[0,-1,0] as const,maxDistance:10};
  throws(()=>createUnifiedPhysicsQueryBatch(Array.from({length:257},()=>ray)),/256/);
  throws(()=>createUnifiedPhysicsQueryBatch([{...ray,limit:65536},{...ray,limit:1}]),/capacity/);
  throws(()=>createUnifiedPhysicsQueryBatch([{...ray,limit:0}]),/capacity/);
  throws(()=>createUnifiedPhysicsQueryBatch([{...ray,maxDistance:1e100}]),/finite/);
  // @ts-expect-error runtime JS callers cannot substitute truthy strings.
  throws(()=>createUnifiedPhysicsQueryBatch([{...ray,solid:"true"}]),/boolean/);
  // @ts-expect-error terrain shapes are targets, not convex query shapes.
  throws(()=>createUnifiedPhysicsQueryBatch([{type:"overlap",shape:{type:"compound",parts:[]}}]),/convex/);
  const batch=createUnifiedPhysicsQueryBatch([ray]);
  equal(batch.metadata[Q.inputFlags],Q.respectTargetMaskFlag|Q.solidRayFlag);
  equal(batch.metadata[Q.inputLimit],32);
  batch.values[Q.inputPosition]=4;equal(batch.values[0],4);
  deepEqual([...batch.values.slice(Q.inputMotion,Q.inputMotion+3)],[0,-1,0]);
  const floor=createUnifiedPhysicsQueryBatch([{type:"point",point:[0,0,0],filter:{planarSpan:{elevation:0,height:1}}}]);
  equal(floor.metadata[Q.inputFloor],0);equal(floor.metadata[Q.inputFlags],Q.planarSpanFlag|Q.respectTargetMaskFlag);
});

test("query bridge copies all four aliases before growth and rejects forged result summaries or ABI",()=>{
  const memory=new WebAssembly.Memory({initial:1});
  const original=createUnifiedPhysicsQueryBatch([{type:"overlap",shape:{type:"sphere",radius:0.5}}]);
  const batch={metadata:new Uint32Array(memory.buffer,0,12),values:new Float32Array(memory.buffer,128,13),
    shapeMetadata:new Uint32Array(memory.buffer,256,1),shapeValues:new Float32Array(memory.buffer,288,1)};
  batch.metadata.set(original.metadata);batch.values.set(original.values);
  batch.shapeMetadata.set(original.shapeMetadata);batch.shapeValues.set(original.shapeValues);
  let calls=0;
  const native={
    unified_physics_query_version:()=>1,unified_physics_query_hit_stride_words:()=>19,unified_physics_query_summary_stride_words:()=>3,
    unified_physics_query_count:()=>1,unified_physics_query_hit_count:()=>1,
    unified_physics_query_hit_ptr:()=>1024,unified_physics_query_summary_ptr:()=>2048,
    query_unified_physics:(m:Uint32Array,v:Float32Array,sm:Uint32Array,sv:Float32Array)=>{
      calls++;memory.grow(1);
      deepEqual(m,original.metadata);deepEqual(v,original.values);deepEqual(sm,original.shapeMetadata);deepEqual(sv,original.shapeValues);
      new Uint32Array(memory.buffer,1024,19).set([0,2,1,9,3,2,4,5,6]);
      new Float32Array(memory.buffer,1024,19)[Q.point]=2;
      new Uint32Array(memory.buffer,2048,3).set([0,1,0]);
    },
  };
  const state=queryUnifiedPhysics(native,memory,batch);
  equal(calls,1);equal(batch.metadata.length,0);equal(state.words.buffer,memory.buffer);
  equal(state.hitCount,1);equal(state.stride,19);equal(state.words[Q.entity],9);equal(state.floats[Q.point],2);
  native.unified_physics_query_hit_stride_words=()=>18;
  throws(()=>queryUnifiedPhysics(native,memory,original),/version 1/);equal(calls,1);
  native.unified_physics_query_hit_stride_words=()=>19;
  native.query_unified_physics=()=>{calls++;new Uint32Array(memory.buffer,2048,3).set([1,1,0]);};
  throws(()=>queryUnifiedPhysics(native,memory,original),/summary/);
  native.unified_physics_query_hit_ptr=()=>1;
  throws(()=>queryUnifiedPhysics(native,memory,original),/buffers/);
});
