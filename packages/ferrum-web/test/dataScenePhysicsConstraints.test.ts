import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createEngine, initializeFerrumWasm, UNIFIED_PHYSICS_CHARACTER_LAYOUT as C,
  UNIFIED_PHYSICS_JOINT_LAYOUT as J, UNIFIED_PHYSICS_STATE_LAYOUT as B, type UnifiedPhysicsJointKind } from "../src/core.js";
import { applyDataSceneAuthoringDocument, resolveSceneAuthoringDocument, createScenePlacementViewer, mergeScenePlacementPatch,
  type DataScenePhysicsBodySpec, type DataScenePhysicsJointSpec, type SceneAuthoringDocumentSpec } from "../src/authoring.js";
import type { SceneCompositionJsonValue } from "../src/sceneComposition.js";

function scene(space: "spatial" | "planar-xy", bodies: Record<string, DataScenePhysicsBodySpec>,
  joints?: Record<string, DataScenePhysicsJointSpec>): SceneAuthoringDocumentSpec {
  return { format: "ferrum2d.consumer.scene-authoring", version: 1,
    physics: { space, gravity: [0,0,0], lengthUnit: 1, stepSeconds: 0.01, joints },
    sceneComposition: { initialFragment: "main", prefabs: { object: {} }, fragments: { main: { instances:
      Object.entries(bodies).map(([id,body]) => ({ id, prefab: "object", props: { components: {
        visual: { kind: "primitive", shape: "circle", radius: 0.5 }, collider: "none", layer: "wall",
        body: JSON.parse(JSON.stringify(body)) as SceneCompositionJsonValue,
      } } })),
    } } }, behaviorRecipes: { entities: {} } };
}
const capsule: DataScenePhysicsBodySpec = {kind:"kinematic-position", collider:{shape:{type:"capsule",halfHeight:0.5,radius:0.25}}, character:{}};
const fixed: DataScenePhysicsBodySpec = {kind:"fixed",collider:{shape:{type:"sphere",radius:0.1}}};
const dynamic: DataScenePhysicsBodySpec = {collider:{shape:{type:"sphere",radius:0.1}}};
async function engine() {
  await initializeFerrumWasm(await readFile(new URL("../pkg/ferrum_core_bg.wasm",import.meta.url)));
  return createEngine();
}
test("authored capsule controllers fall, ground, walk and jump in both world modes through actual Wasm",async()=>{
  const e=await engine();
  try { for(const space of ["spatial","planar-xy"] as const) {
    const doc=scene(space,{floor:{kind:"fixed",collider:{shape:{type:"box",halfExtents:[20,0.1,20]}}},actor:{...capsule,elevation:space==="spatial"?2:0}});
    doc.physics!.gravity=[0,-10,0];
    if(space==="planar-xy") doc.sceneComposition.fragments!.main.instances![1].y=2;
    const applied=applyDataSceneAuthoringDocument(e,doc,{textureId:()=>11}),h=applied.entityHandles.actor,ids=new Uint32Array([h.entityId,h.entityGeneration]);
    for(let i=0;i<200;i++)e.stepRigidBodies(Math.fround(0.01));
    let state=e.queryUnifiedPhysicsCharacterStates(ids);
    ok(state.words[C.flags]&C.groundedFlag,space);ok(state.words[C.flags]&C.groundPresentFlag);
    const before=e.queryUnifiedPhysicsBodyStates(ids).floats.slice(B.position,B.position+3);
    e.setUnifiedPhysicsCharacterInputs(ids,new Float32Array([2,0,space==="spatial"?1:0,0]));
    for(let i=0;i<20;i++)e.stepRigidBodies(Math.fround(0.01));
    const walking=e.queryUnifiedPhysicsBodyStates(ids).floats.slice(B.position,B.position+3);
    ok(walking[0]>before[0]+0.3);equal(walking[2]===0,space==="planar-xy");
    e.setUnifiedPhysicsCharacterInputs(ids,new Float32Array([0,0,0,4]));
    for(let i=0;i<10;i++)e.stepRigidBodies(Math.fround(0.01));
    ok(e.queryUnifiedPhysicsBodyStates(ids).floats[B.position+1]>walking[1]+0.2);
    state=e.queryUnifiedPhysicsCharacterStates(ids);equal(state.words[C.flags]&C.groundedFlag,0);
    equal(e.entityCount(),2);
  } } finally {e.destroy();}
});
test("all authored joint kinds resolve named endpoints to native identities, including prototype-like names",async()=>{
  const e=await engine(),motor={targetPosition:0.1,targetVelocity:1,stiffness:2,damping:3,maxForce:100},spring={stiffness:4,damping:5};
  const kinds: UnifiedPhysicsJointKind[]=[{type:"fixed"},{type:"spherical"},{type:"revolute",limits:[-1,1],motor},
    {type:"prismatic",limits:[-1,1],motor},{type:"distance",length:2},{type:"rope",maxLength:3},
    {type:"frequencySpring",restLength:2,frequencyHz:3,dampingRatio:0.5},{type:"accelerationSpring",restLength:2,...spring},
    {type:"spring",restLength:2,...spring},{type:"elasticRope",maxLength:3,spring},{type:"gear",ratio:2,referenceAngle:0.1,spring},
    {type:"pulley",groundA:[0,5,0],groundB:[2,5,0],length:10,ratio:1,slack:true,spring},
    {type:"continuousRevolute",limits:[-10,10],motor}];
  try { for(const space of ["spatial","planar-xy"] as const) for(let code=0;code<kinds.length;code++) {
    const frame={rotation:[0,-Math.SQRT1_2,0,Math.SQRT1_2] as const};
    const joint:DataScenePhysicsJointSpec={bodyA:"a",bodyB:"b",kind:kinds[code],contactsEnabled:true,breakForce:1000,breakTorque:1000,
      ...([2,12].includes(code)?{localFrameA:frame,localFrameB:frame}:{}),...(code===0?{linearSpring:spring,angularSpring:spring}:{})};
    const doc=scene(space,{a:fixed,b:dynamic},Object.fromEntries([["__proto__",joint]]));
    doc.sceneComposition.fragments!.main.instances![1].x=2;
    if(space==="spatial" && [10,12].includes(code)) {
      throws(()=>applyDataSceneAuthoringDocument(e,doc,{textureId:()=>11}),/joint/);
      continue;
    }
    const result=applyDataSceneAuthoringDocument(e,doc,{textureId:()=>11}),id=result.physicsJoints!["__proto__"];
    const state=e.queryUnifiedPhysicsJointStates(new Uint32Array([id.slot,id.generation]));
    equal(state.count,1);equal(state.words[J.code],code);equal(state.words[J.flags],15);
    equal(state.words[J.entityA],result.entityHandles.a.entityId);equal(state.words[J.entityB],result.entityHandles.b.entityId);
    equal(e.queryUnifiedPhysicsJointStates().count,1);
  } }finally{e.destroy();}
});
test("authored motor drives the rendered body and scaled local frames constrain physical placement",async()=>{
  const e=await engine();
  try {
    const doc=scene("spatial",{a:fixed,b:dynamic},{rail:{bodyA:"a",bodyB:"b",kind:{type:"prismatic",motor:{targetPosition:0,targetVelocity:2,stiffness:0,damping:10,maxForce:100}}}});
    const result=applyDataSceneAuthoringDocument(e,doc,{textureId:()=>11}),b=result.entityHandles.b,ids=new Uint32Array([b.entityId,b.entityGeneration]);
    let peakForce=0;
    for(let i=0;i<20;i++) {e.stepRigidBodies(Math.fround(0.01));peakForce=Math.max(peakForce,e.queryUnifiedPhysicsJointStates().floats[J.force]);}
    ok(e.queryUnifiedPhysicsBodyStates(ids).floats[B.position]>0.3);
    ok(e.queryUnifiedPhysicsBodyStates(ids).floats[B.linearVelocity]>1);ok(peakForce>0);
    const scaled=scene("spatial",{a:fixed,b:dynamic},{lock:{bodyA:"a",bodyB:"b",kind:{type:"fixed"},localFrameA:{position:[1,0,0]},localFrameB:{position:[1,0,0]}}});
    const viewer=createScenePlacementViewer({document:scaled,viewport:{cssWidth:320,cssHeight:180}});
    viewer.updateInstanceTransform("a",{scale:3});viewer.updateInstanceTransform("b",{scale:2,x:1});
    const merged=mergeScenePlacementPatch(scaled,viewer.exportPatch()!).document;
    deepEqual(merged.physics,scaled.physics);
    const applied=applyDataSceneAuthoringDocument(e,merged,{textureId:()=>11}),h=applied.entityHandles.b;
    for(let i=0;i<50;i++)e.stepRigidBodies(Math.fround(0.01));
    ok(Math.abs(e.queryUnifiedPhysicsBodyStates(new Uint32Array([h.entityId,h.entityGeneration])).floats[B.position]-1)<1e-4);
  }finally{e.destroy();}
});
test("invalid controllers, joint references/settings and aggregate capacities preserve the live scene",async()=>{
  const e=await engine();
  try {
    const previous=applyDataSceneAuthoringDocument(e,scene("spatial",{actor:capsule}),{textureId:()=>11});
    const h=previous.entityHandles.actor,ids=new Uint32Array([h.entityId,h.entityGeneration]);
    const joint:DataScenePhysicsJointSpec={bodyA:"a",bodyB:"b",kind:{type:"fixed"}};
    const characterCapacity=scene("spatial",{a:capsule,b:capsule});characterCapacity.physics!.maxCharacters=1;
    const jointCapacity=scene("spatial",{a:fixed,b:dynamic},{first:joint,second:joint});jointCapacity.physics!.maxJoints=1;
    for(const bad of [scene("spatial",{a:{...capsule,kind:"dynamic"}}),scene("spatial",{a:{...dynamic,character:{}}}),
      scene("spatial",{a:{...capsule,character:{up:[0,0,0]}}}),characterCapacity,jointCapacity,
      scene("spatial",{a:fixed,b:dynamic},{bad:{...joint,bodyB:"missing"}}),
      scene("spatial",{a:fixed,b:dynamic},{bad:{...joint,bodyB:"a"}}),
      scene("spatial",{a:fixed,b:dynamic},{bad:{...joint,kind:{type:"distance",length:-1}}}),
      scene("planar-xy",{a:fixed,b:dynamic},{bad:{...joint,kind:{type:"revolute"}}}),
    ]) {
      throws(()=>applyDataSceneAuthoringDocument(e,bad,{validateBindings:false,validateComponents:false}),/physics|body|joint/i);
      equal(e.entityCount(),1);equal(e.queryUnifiedPhysicsCharacterStates(ids).count,1);
      equal(e.queryUnifiedPhysicsJointStates().count,0);
    }
    const unknowns=[scene("spatial",{a:{...capsule,character:{typo:1} as never}}),
      scene("spatial",{a:fixed,b:dynamic},{bad:{...joint,localFrameA:{typo:1} as never}}),
      scene("spatial",{a:fixed,b:dynamic},{bad:{...joint,kind:{type:"prismatic",motor:{typo:1}} as never}})];
    for(const doc of unknowns) throws(()=>resolveSceneAuthoringDocument(doc),/typo/);
    const visual=scene("spatial",{a:fixed,b:dynamic},{bad:joint});
    const components=visual.sceneComposition.fragments!.main.instances![1].props!.components as Record<string,unknown>;delete components.body;
    throws(()=>resolveSceneAuthoringDocument(visual),/physics body/);
  }finally{e.destroy();}
});
