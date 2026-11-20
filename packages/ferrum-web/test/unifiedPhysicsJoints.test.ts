import {deepEqual,equal,throws} from "node:assert/strict";
import {test} from "node:test";
import {createUnifiedPhysicsJointApi,readUnifiedPhysicsJoints} from "../src/unifiedPhysicsJoints.js";

test("joint facade rejects invalid capability, pointer and identity rows and copies Wasm aliases before growth",()=>{
  const memory=new WebAssembly.Memory({initial:1});let count=1,ptr=0,version=1,calls=0,grow=false;
  const native={
    unified_physics_joint_version:()=>version,unified_physics_joint_stride_words:()=>14,
    create_unified_physics_joint:()=>new Uint32Array([2,3]),update_unified_physics_joint:()=>{calls++;},remove_unified_physics_joint:()=>{calls++;},
    query_unified_physics_joints:(handles:Uint32Array,all:boolean)=>{
      if(grow){memory.grow(1);deepEqual([...handles],[2,3]);}count=all?1:handles.length/2;
    },
    set_unified_physics_joint_events_enabled:()=>{calls++;},drain_unified_physics_joint_events:()=>{},
    unified_physics_joint_count:()=>count,unified_physics_joint_ptr:()=>ptr,
    unified_physics_joint_dropped_native:()=>0,unified_physics_joint_dropped_events:()=>0,
  };
  new Uint32Array(memory.buffer,0,2).set([2,3]);const alias=new Uint32Array(memory.buffer,0,2);grow=true;
  equal(readUnifiedPhysicsJoints(native,memory,false,alias).count,1);equal(alias.length,0);grow=false;
  ptr=3;throws(()=>readUnifiedPhysicsJoints(native,memory,false));ptr=memory.buffer.byteLength;throws(()=>readUnifiedPhysicsJoints(native,memory,false));ptr=0;
  throws(()=>readUnifiedPhysicsJoints(native,memory,false,new Uint32Array([2])));
  const api=createUnifiedPhysicsJointApi(native,{readUnifiedPhysicsJoints:(events,handles)=>readUnifiedPhysicsJoints(native,memory,events,handles)},()=>{});
  throws(()=>api.setUnifiedPhysicsJointEventsEnabled(1 as unknown as boolean));throws(()=>api.removeUnifiedPhysicsJoint({slot:-1,generation:0}));equal(calls,0);
  version=2;throws(()=>api.queryUnifiedPhysicsJointStates(),/version 1/);version=1;
  const dead=createUnifiedPhysicsJointApi(native,{readUnifiedPhysicsJoints:()=>{throw new Error("should not read");}},()=>{throw new Error("destroyed");});
  throws(()=>dead.queryUnifiedPhysicsJointStates(),/destroyed/);
});
