import {deepEqual,equal,ok,throws} from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {test} from "node:test";
import {createEngine,initializeFerrumWasm,UNIFIED_PHYSICS_JOINT_LAYOUT as L,type UnifiedPhysicsJointKind} from "../src/core.js";
import {wasm_memory} from "../pkg/ferrum_core.js";
async function setup(space:"spatial"|"planar-xy"="spatial",maxEvents=64) {
  await initializeFerrumWasm(await readFile(new URL("../pkg/ferrum_core_bg.wasm",import.meta.url)));
  const e=await createEngine();e.useDataScene();e.configureUnifiedPhysics({space,gravity:[0,0,0],lengthUnit:1,stepSeconds:0.01,maxEvents});
  const a=e.spawnUnifiedPhysicsBody({kind:"fixed",collider:{shape:{type:"sphere",radius:0.1}}});
  const b=e.spawnUnifiedPhysicsBody({pose:{position:[2,0,0]},collider:{shape:{type:"sphere",radius:0.1},density:0}});
  e.setUnifiedPhysicsMassProperties(b,{mass:1,principalInertia:[1,1,1],center:[0,0,0],inertiaRotation:[0,0,0,1]});
  return {e,a,b};
}

test("all thirteen public joint kinds accept native settings, preserve identity on update and invalidate after removal",async()=>{
  const {e,a,b}=await setup("planar-xy");
  const motor={targetPosition:0.1,targetVelocity:1,stiffness:2,damping:3,maxForce:100},spring={stiffness:4,damping:5};
  const kinds:UnifiedPhysicsJointKind[]=[{type:"fixed"},{type:"spherical"},{type:"revolute",limits:[-1,1],motor},
    {type:"prismatic",limits:[-1,1],motor},{type:"distance",length:2},{type:"rope",maxLength:3},
    {type:"frequencySpring",restLength:2,frequencyHz:3,dampingRatio:0.5},{type:"accelerationSpring",restLength:2,...spring},
    {type:"spring",restLength:2,...spring},{type:"elasticRope",maxLength:3,spring},{type:"gear",ratio:2,referenceAngle:0.1,spring},
    {type:"pulley",groundA:[0,5,0],groundB:[2,5,0],length:10,ratio:1,slack:true,spring},
    {type:"continuousRevolute",limits:[-10,10],motor:{...motor,targetPosition:5}}];
  try {
    for(let code=0;code<kinds.length;code++) {
      const kind=kinds[code];const frame={rotation:[0,-Math.SQRT1_2,0,Math.SQRT1_2] as const};
      const settings={bodyA:a,bodyB:b,kind,contactsEnabled:true,breakForce:1000,breakTorque:1000,
        ...([2,12].includes(code)?{localFrameA:frame,localFrameB:frame}:{}),...(code===0?{linearSpring:spring,angularSpring:spring}:{})};
      const id=e.createUnifiedPhysicsJoint(settings);const handles=new Uint32Array([id.slot,id.generation]);
      let state=e.queryUnifiedPhysicsJointStates(handles);equal(state.count,1);equal(state.words[L.code],code);equal(state.words[L.flags],15);
      e.updateUnifiedPhysicsJoint(id,{...settings,enabled:false});state=e.queryUnifiedPhysicsJointStates(handles);
      equal(state.words[L.flags]&L.enabledFlag,0);equal(state.words[L.joint],id.slot);equal(state.words[L.joint+1],id.generation);
      e.removeUnifiedPhysicsJoint(id);throws(()=>e.queryUnifiedPhysicsJointStates(handles));
    }
    equal(e.queryUnifiedPhysicsJointStates().count,0);equal(e.queryUnifiedPhysicsJointStates(new Uint32Array()).count,0);
  } finally {e.destroy();}
  throws(()=>e.queryUnifiedPhysicsJointStates(),/destroyed/i);
});

test("actual joint motor motion, reaction and atomic update work through public Wasm; borrowed state aliases survive input allocation",async()=>{
  const {e,a,b}=await setup();
  try {
    const settings={bodyA:a,bodyB:b,kind:{type:"prismatic" as const,motor:{targetPosition:0,targetVelocity:2,stiffness:0,damping:10,maxForce:100}}};
    const joint=e.createUnifiedPhysicsJoint(settings),handles=new Uint32Array([joint.slot,joint.generation]);
    for(let i=0;i<20;i++)e.stepRigidBodies(Math.fround(0.01));
    const state=e.queryUnifiedPhysicsJointStates(handles);ok(state.floats[L.force]>0);
    const s=e.queryUnifiedPhysicsBodyStates(new Uint32Array([b.entityId,b.entityGeneration]));ok(s.floats[3]>2.1);ok(s.floats[10]>1);
    const copy=state.words.slice();throws(()=>e.updateUnifiedPhysicsJoint(joint,{...settings,kind:{type:"distance",length:-1}}));
    deepEqual(e.queryUnifiedPhysicsJointStates(handles).words,copy);
    const duplicate=new Uint32Array([...handles,...handles]);equal(e.queryUnifiedPhysicsJointStates(duplicate).count,2);
    const alias=e.queryUnifiedPhysicsJointStates(handles).words.subarray(0,2);equal(e.queryUnifiedPhysicsJointStates(alias).count,1);
    const old=e.queryUnifiedPhysicsJointStates(handles);wasm_memory().grow(1);equal(old.words.length,0);equal(e.queryUnifiedPhysicsJointStates(handles).count,1);
    e.updateUnifiedPhysicsJoint(joint,{...settings,enabled:false});equal(e.queryUnifiedPhysicsJointStates(handles).floats[L.force],0);
    throws(()=>e.updateUnifiedPhysicsJoint(joint,{...settings,bodyA:b,bodyB:a}));
  } finally {e.destroy();}
});

test("force/torque breaks expose actual reactions and entity generations independently from state queries",async()=>{
  for(let reason=0;reason<3;reason++) {
    const {e,a,b}=await setup();
    try {
      e.setUnifiedPhysicsPoses(new Uint32Array([b.entityId,b.entityGeneration]),new Float32Array([0,0,0,0,0,0,1]));
      e.setUnifiedPhysicsJointEventsEnabled(true);
      const joint=e.createUnifiedPhysicsJoint({bodyA:a,bodyB:b,kind:{type:"fixed"},breakForce:1,breakTorque:1});
      e.addUnifiedPhysicsForces(new Uint32Array([b.entityId,b.entityGeneration]),new Float32Array([reason!==1?10:0,0,0,0,reason!==0?10:0,0]));
      e.stepRigidBodies(Math.fround(0.01));e.removeUnifiedPhysicsBody(b);
      equal(e.queryUnifiedPhysicsJointStates().count,0);const event=e.drainUnifiedPhysicsJointEvents();equal(event.count,1);
      equal(event.words[L.code],reason);equal(event.words[L.joint],joint.slot);equal(event.words[L.entityB],b.entityId);equal(event.words[L.entityB+1],b.entityGeneration);
      if(reason!==1)ok(event.floats[L.force]>1);if(reason!==0)ok(event.floats[L.torque]>1);
      const copy=event.words.slice();e.queryUnifiedPhysicsJointStates();deepEqual(event.words,copy);
      equal(e.drainUnifiedPhysicsJointEvents().count,0);
    } finally {e.destroy();}
  }
});

test("overflow exposes native/public drops and full live recovery; explicit and body removal retain original identities",async()=>{
  const {e,a,b}=await setup("spatial",1);const settings={bodyA:a,bodyB:b,kind:{type:"distance" as const,length:2}};
  try {
    const silent=e.createUnifiedPhysicsJoint(settings);e.removeUnifiedPhysicsJoint(silent);e.setUnifiedPhysicsJointEventsEnabled(true);equal(e.drainUnifiedPhysicsJointEvents().count,0);
    for(let i=0;i<3;i++)e.createUnifiedPhysicsJoint(settings);
    e.removeUnifiedPhysicsBody(b);
    const replacement=e.spawnUnifiedPhysicsBody({pose:{position:[2,0,0]},collider:{shape:{type:"sphere",radius:0.1}}});
    const j=e.createUnifiedPhysicsJoint({...settings,bodyB:replacement});e.removeUnifiedPhysicsJoint(j);
    const live=e.createUnifiedPhysicsJoint({...settings,bodyB:replacement});
    e.setUnifiedPhysicsJointEventsEnabled(true);const events=e.drainUnifiedPhysicsJointEvents();equal(events.count,1);equal(events.droppedNative,2);equal(events.droppedEvents,1);
    equal(events.words[L.code],L.bodyRemoved);equal(events.words[L.entityB],b.entityId);equal(events.words[L.entityB+1],b.entityGeneration);
    const state=e.queryUnifiedPhysicsJointStates();equal(state.count,1);equal(state.words[L.joint],live.slot);equal(state.words[L.joint+1],live.generation);
    e.removeUnifiedPhysicsJoint(live);const removed=e.drainUnifiedPhysicsJointEvents();equal(removed.count,1);equal(removed.words[L.code],L.removed);
    equal(removed.droppedEvents,0);equal(removed.droppedNative,0);throws(()=>e.removeUnifiedPhysicsJoint(j));
  } finally {e.destroy();}
});
