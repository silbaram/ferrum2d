import {deepEqual,equal,ok,throws} from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {test} from "node:test";
import {createEngine,initializeFerrumWasm,createUnifiedPhysicsQueryBatch,UNIFIED_PHYSICS_COLLISION_LAYOUT as C,
  type UnifiedPhysicsBodySettings} from "../src/core.js";
import {wasm_memory} from "../pkg/ferrum_core.js";
const settings:UnifiedPhysicsBodySettings={kind:"dynamic",enabled:true,gravityScale:1,linearDamping:0,angularDamping:0,canSleep:true,ccd:false,lockRotation:false};
const sphere={shape:{type:"sphere" as const,radius:0.5}};

async function engine(space:"planar-xy"|"spatial"="spatial") {
  await initializeFerrumWasm(await readFile(new URL("../pkg/ferrum_core_bg.wasm",import.meta.url)));
  const e=await createEngine();e.useDataScene();e.configureUnifiedPhysics({space,gravity:[0,0,0],lengthUnit:1,stepSeconds:0.01});return e;
}

test("mutable integration and mass settings change actual Wasm dynamics and disabled queries immediately",async()=>{
  const e=await engine("planar-xy");const b=e.spawnUnifiedPhysicsBody({collider:{...sphere,density:0}});
  const h=new Uint32Array([b.entityId,b.entityGeneration]);
  const point=createUnifiedPhysicsQueryBatch([{type:"point",point:[0,0,0]}]);
  try {
    e.setUnifiedPhysicsMassProperties(b,{mass:2,principalInertia:[4,4,4],center:[0,0,0],inertiaRotation:[0,0,0,1]});
    e.applyUnifiedPhysicsImpulses(h,new Float32Array([4,0,0,0,0,8]));
    let s=e.queryUnifiedPhysicsBodyStates(h);equal(s.floats[10],2);equal(s.floats[15],2);
    e.setUnifiedPhysicsBodyOptions(b,{...settings,lockRotation:true});s=e.queryUnifiedPhysicsBodyStates(h);equal(s.floats[10],2);equal(s.floats[15],0);
    throws(()=>e.setUnifiedPhysicsVelocities(h,new Float32Array([0,0,1,0,0,0])));
    throws(()=>e.setUnifiedPhysicsBodyOptions(b,{...settings,kind:"fixed",linearDamping:-1}));
    e.applyUnifiedPhysicsImpulses(h,new Float32Array([2,0,0,0,0,0]));equal(e.queryUnifiedPhysicsBodyStates(h).floats[10],3);
    e.setUnifiedPhysicsBodyOptions(b,{...settings,enabled:false});equal(e.queryUnifiedPhysics(point).hitCount,0);
    e.stepRigidBodies(Math.fround(0.01));equal(e.queryUnifiedPhysicsBodyStates(h).floats[3],0);
    e.setUnifiedPhysicsBodyOptions(b,settings);equal(e.queryUnifiedPhysics(point).hitCount,1);
    e.stepRigidBodies(Math.fround(0.01));ok(e.queryUnifiedPhysicsBodyStates(h).floats[3]>0);
    e.setUnifiedPhysicsBodyOptions(b,{...settings,kind:"fixed"});throws(()=>e.applyUnifiedPhysicsImpulses(h,new Float32Array([1,0,0,0,0,0])));
    e.setUnifiedPhysicsBodyOptions(b,settings);e.applyUnifiedPhysicsImpulses(h,new Float32Array([1,0,0,0,0,0]));
  } finally {e.destroy();}
  throws(()=>e.setUnifiedPhysicsBodyOptions(b,settings),/destroyed/i);
});

test("mutable colliders retain generation, update geometry and mass, reject foreign/stale ownership and preserve removal events",async()=>{
  const e=await engine();const a=e.spawnUnifiedPhysicsBody({collider:sphere});
  const b=e.spawnUnifiedPhysicsBody({kind:"fixed",pose:{position:[0.75,0,0]},collider:{...sphere,sensor:true}});
  try {
    const [c]=e.queryUnifiedPhysicsColliders(a), [foreign]=e.queryUnifiedPhysicsColliders(b);
    throws(()=>e.updateUnifiedPhysicsCollider(a,foreign,sphere));throws(()=>e.removeUnifiedPhysicsCollider(b,c));
    const point=createUnifiedPhysicsQueryBatch([{type:"point",point:[0,1.5,0]}]);
    equal(e.queryUnifiedPhysics(point).hitCount,0);
    e.updateUnifiedPhysicsCollider(a,c,{shape:{type:"box",halfExtents:[0.5,2,0.5]},density:0});
    equal(e.queryUnifiedPhysics(point).hitCount,1);deepEqual(e.queryUnifiedPhysicsColliders(a),[c]);
    throws(()=>e.updateUnifiedPhysicsCollider(a,c,{shape:{type:"sphere",radius:-1}}));equal(e.queryUnifiedPhysics(point).hitCount,1);
    // Borrowed Wasm geometry must be owned before wasm-bindgen allocates input buffers.
    const memory=wasm_memory();memory.grow(1);
    const vertices=new Float32Array(memory.buffer,memory.buffer.byteLength-36,9);vertices.set([-1,0,-1,1,0,-1,0,0,1]);
    e.updateUnifiedPhysicsCollider(b,foreign,{shape:{type:"triangleMesh",vertices,triangles:[0,1,2]},sensor:true});
    e.updateUnifiedPhysicsCollider(b,foreign,{...sphere,sensor:true});
    e.setUnifiedPhysicsCollisionEventsEnabled(true);e.stepRigidBodies(Math.fround(0.01));equal(e.drainUnifiedPhysicsCollisionEvents().count,1);
    e.removeUnifiedPhysicsCollider(a,c);equal(e.queryUnifiedPhysicsColliders(a).length,0);
    const newer=e.addUnifiedPhysicsCollider(a,sphere);ok(newer.slot!==c.slot || newer.generation!==c.generation);
    const events=e.drainUnifiedPhysicsCollisionEvents();equal(events.count,1);equal(events.words[C.phase],1);
    equal(events.words[C.first+C.collider],c.slot);equal(events.words[C.first+C.collider+1],c.generation);
    throws(()=>e.updateUnifiedPhysicsCollider(a,c,sphere));throws(()=>e.removeUnifiedPhysicsCollider(a,c));
    e.removeUnifiedPhysicsBody(a);throws(()=>e.queryUnifiedPhysicsColliders(a));throws(()=>e.addUnifiedPhysicsCollider(a,sphere));
  } finally {e.destroy();}
});

test("Web edits honor imported component and character ownership without changing the running world",async()=>{
  await initializeFerrumWasm(await readFile(new URL("../pkg/ferrum_core_bg.wasm",import.meta.url)));
  const e=await createEngine();e.useDataScene();const imported=e.spawnRigidBody({x:0,y:0,collider:{type:"circle",radius:1},mass:2});
  e.configureUnifiedPhysics({space:"planar-xy",gravity:[0,0,0],lengthUnit:1,stepSeconds:0.01});
  try {
    const [c]=e.queryUnifiedPhysicsColliders(imported);
    throws(()=>e.setUnifiedPhysicsBodyOptions(imported,settings),/BodyOwnershipConflict/);
    throws(()=>e.updateUnifiedPhysicsCollider(imported,c,sphere),/BodyOwnershipConflict/);
    throws(()=>e.removeUnifiedPhysicsCollider(imported,c),/BodyOwnershipConflict/);
    e.stepRigidBodies(Math.fround(0.01));deepEqual(e.queryUnifiedPhysicsColliders(imported),[c]);
    const actor=e.spawnUnifiedPhysicsBody({kind:"kinematic-position",pose:{position:[10,0,0]},collider:{shape:{type:"capsule",halfHeight:0.5,radius:0.25}}});
    e.configureUnifiedPhysicsCharacter(actor,{});const [capsule]=e.queryUnifiedPhysicsColliders(actor);
    throws(()=>e.setUnifiedPhysicsBodyOptions(actor,settings));throws(()=>e.removeUnifiedPhysicsCollider(actor,capsule));
    throws(()=>e.updateUnifiedPhysicsCollider(actor,capsule,sphere));throws(()=>e.addUnifiedPhysicsCollider(actor,sphere));
    const sensor=e.addUnifiedPhysicsCollider(actor,{...sphere,sensor:true});e.removeUnifiedPhysicsCollider(actor,sensor);
    e.configureUnifiedPhysicsCharacter(actor,false);e.setUnifiedPhysicsBodyOptions(actor,settings);
  } finally {e.destroy();}
});
