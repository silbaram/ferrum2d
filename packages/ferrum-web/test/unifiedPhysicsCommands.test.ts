import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { createUnifiedPhysicsCommandApi } from "../src/unifiedPhysicsCommands.js";

test("body batches check capability, sizes and lifecycle before native mutation and copy both inputs before growth", () => {
  const memory = new WebAssembly.Memory({initial:1});
  const handles = new Uint32Array(memory.buffer,0,400);
  const values = new Float32Array(memory.buffer,2048,1200);
  handles[0]=0xf1234567;values[0]=2;
  let alive=true, calls=0, copies=0;
  const native = {
    unified_physics_command_version:()=>1,
    command_unified_physics_bodies:(code:number,h:Uint32Array,v:Float32Array)=>{
      calls++;equal(code,4);memory.grow(1);
      equal(h.length,400);equal(v.length,1200);equal(h[0],0xf1234567);equal(v[0],2);
    },
  };
  const api=createUnifiedPhysicsCommandApi(native, {
    copyUnifiedPhysicsInputAliases:(h,v)=>{copies++;return {handles:h.slice(),values:v.slice()};},
  },()=>{if(!alive)throw new Error("destroyed");});
  api.applyUnifiedPhysicsImpulses(handles,values);
  equal(calls,1);equal(copies,1);equal(handles.length,0);equal(values.length,0);
  throws(()=>api.setUnifiedPhysicsPoses(new Uint32Array(2),new Float32Array(6)),/7 f32/);
  throws(()=>api.addUnifiedPhysicsForces(new Uint32Array(1),new Float32Array(6)),/pairs/);
  throws(()=>api.clearUnifiedPhysicsForces(new Uint32Array(131074)),/pairs/);
  // @ts-expect-error JS callers still cannot pass a truthy string for sleeping.
  throws(()=>api.setUnifiedPhysicsSleeping(new Uint32Array(2),"true"),/boolean/);
  native.unified_physics_command_version=()=>2;
  throws(()=>api.setUnifiedPhysicsKinematicTargets(new Uint32Array(2),new Float32Array(7)),/version 1/);
  alive=false;
  throws(()=>api.clearUnifiedPhysicsForces(new Uint32Array()),/destroyed/);
  throws(()=>api.setUnifiedPhysicsSleeping(new Uint32Array(),false),/destroyed/);
  deepEqual([calls,copies],[1,1]);
});
