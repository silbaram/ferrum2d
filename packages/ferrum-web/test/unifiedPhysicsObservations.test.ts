import {equal, throws} from "node:assert/strict";
import {test} from "node:test";
import {queryUnifiedPhysicsContactManifolds, queryUnifiedPhysicsDiagnostics, queryUnifiedPhysicsObservations} from "../src/unifiedPhysicsObservations.js";

test("observation bridge validates ABI, whole manifold ranges and pointers and reacquires memory after query", () => {
  const memory = new WebAssembly.Memory({initial:1});
  let queries = 0;
  const native = {
    unified_physics_observations_version: () => 1,
    unified_physics_observation_stride_words: (kind:number) => [27,7,32,28,71][kind],
    unified_physics_observation_count: (kind:number) => [1,1,0,0,1][kind],
    unified_physics_observation_ptr: (kind:number) => [0,128,256,512,1024][kind],
    unified_physics_contacts_truncated: () => false,
    unified_physics_contacts_total_manifolds: () => 1,
    unified_physics_contacts_total_points: () => 1,
    query_unified_physics_contacts: () => {
      queries++; memory.grow(1);
      const m = new Uint32Array(memory.buffer,0,27); m[25]=0; m[26]=1;
      new Float32Array(memory.buffer,128,7)[6]=0.125;
    },
    query_unified_physics_observations: () => {},
    query_unified_physics_diagnostics: () => {
      new Uint32Array(memory.buffer,1024,71).set([1,1,3,0,0,4,1]);
      new Uint32Array(memory.buffer,1024,71)[39+12]=3;
      return true;
    },
  };
  const contacts = queryUnifiedPhysicsContactManifolds(native,memory);
  equal(queries,1); equal(contacts.points.floats.buffer,memory.buffer); equal(contacts.points.floats[6],0.125);
  native.query_unified_physics_contacts = () => { new Uint32Array(memory.buffer,0,27)[25]=1; };
  throws(() => queryUnifiedPhysicsContactManifolds(native,memory), /range/);
  throws(() => queryUnifiedPhysicsContactManifolds(native,memory,{maxPoints:0}), /options/);
  // @ts-expect-error runtime JavaScript flags must be actual booleans.
  throws(() => queryUnifiedPhysicsContactManifolds(native,memory,{includeSensors:"true"}), /options/);
  const stats = queryUnifiedPhysicsDiagnostics(native,memory)!;
  equal(stats.frame.backendSteps,3);equal(stats.fixedSteps,3);equal(stats.impulsesDropped,1);
  new Uint32Array(memory.buffer,1024,71).fill(0);memory.grow(1);
  equal(stats.frame.backendSteps,3); // Owned diagnostics never alias Wasm memory.
  throws(() => queryUnifiedPhysicsObservations(native,memory), /capability/);
  native.unified_physics_observation_ptr = () => 1;
  throws(() => queryUnifiedPhysicsObservations(native,memory), /buffer/);
  native.unified_physics_observation_stride_words = () => 1;
  throws(() => queryUnifiedPhysicsObservations(native,memory), /version 1/);
});
