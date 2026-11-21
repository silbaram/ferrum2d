import {deepEqual,equal,throws} from "node:assert/strict";
import {test} from "node:test";
import {createUnifiedPhysicsQueryBatch,UNIFIED_PHYSICS_QUERY_LAYOUT as Q} from "../src/unifiedPhysicsQueries.js";
import {readTerrainImpacts,TERRAIN_IMPACT_LAYOUT as T} from "../src/terrainImpacts.js";
import {decodeGameplayEvents} from "../src/gameplayEventDecoder.js";

test("terrain purpose flags preserve all existing query fields and reject unknown purpose",()=>{
  const row={type:"ray" as const,origin:[0,1,0] as const,direction:[0,-1,0] as const,maxDistance:8};
  for(const [purpose,code] of [["all",1],["movement",2],["projectile",3],["vision",4]] as const){
    const batch=createUnifiedPhysicsQueryBatch([{...row,filter:{terrain:purpose,mask:7,includeSensors:false,respectTargetMask:false}}]);
    equal(batch.metadata[Q.inputFlags],Q.solidRayFlag|(code<<Q.terrainShift));equal(batch.metadata[Q.inputMask],7);
    deepEqual([...batch.values.slice(Q.inputPosition,Q.inputPosition+3)],[0,1,0]);
  }
  // @ts-expect-error arbitrary JavaScript cannot forge another purpose.
  throws(()=>createUnifiedPhysicsQueryBatch([{...row,filter:{terrain:"allWalls"}}]),/purpose/);
  const plain=createUnifiedPhysicsQueryBatch([row]);equal(plain.metadata[Q.inputFlags],34);
});
test("terrain frame ABI keeps full terrain/actor generations and signed XYZ witnesses",()=>{
  const memory=new WebAssembly.Memory({initial:1});const pointer=256;
  const words=new Uint32Array(memory.buffer,pointer,24),floats=new Float32Array(memory.buffer,pointer,24);
  words.set([1,0,7,9,11,13,17,19,23,29,31,37,2,65535,0]);
  floats.set([-0,3.5,-8],T.point);floats.set([-1,0,0],T.normal);floats[T.impulse]=2.5;floats[T.approachSpeed]=4;
  const native={terrain_impact_version:()=>1,terrain_impact_stride_words:()=>24,terrain_impact_count:()=>1,terrain_impact_dropped:()=>3,terrain_impact_ptr:()=>pointer};
  const view=readTerrainImpacts(native,memory);equal(view.stride,24);equal(view.count,1);equal(view.dropped,3);
  deepEqual([...view.words.slice(T.actor,T.actor+2)],[7,9]);deepEqual([...view.words.slice(T.terrain,T.terrain+3)],[2,65535,0]);equal(Object.is(view.floats[T.point],-0),true);
  const events=decodeGameplayEvents({buffer:new Uint32Array([15,7,9,0xffffffff,0,2,0,0]),eventCount:1,u32sPerEvent:8});equal(events[0].kind,"terrainImpact");equal(events[0].sourceId,0xffffffff);equal(events[0].payloadBits,0);
  memory.grow(1);equal(view.words.length,0);equal(readTerrainImpacts(native,memory).words.buffer,memory.buffer);
});
test("terrain frame reader rejects incompatible or unbounded native views before constructing arrays",()=>{
  const memory=new WebAssembly.Memory({initial:1});
  const native={terrain_impact_version:()=>1,terrain_impact_stride_words:()=>24,terrain_impact_count:()=>0,terrain_impact_dropped:()=>0,terrain_impact_ptr:()=>0};
  equal(readTerrainImpacts(native,memory).count,0);
  for(const count of [-1,0.5,4097,Number.MAX_SAFE_INTEGER]){native.terrain_impact_count=()=>count;throws(()=>readTerrainImpacts(native,memory),/buffer/);}
  native.terrain_impact_count=()=>1;native.terrain_impact_ptr=()=>2;throws(()=>readTerrainImpacts(native,memory),/buffer/);
  native.terrain_impact_ptr=()=>65532;throws(()=>readTerrainImpacts(native,memory),/buffer/);
  native.terrain_impact_ptr=()=>0;native.terrain_impact_stride_words=()=>23;throws(()=>readTerrainImpacts(native,memory),/ABI/);
});
