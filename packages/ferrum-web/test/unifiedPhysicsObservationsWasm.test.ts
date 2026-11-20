import {deepEqual,equal,ok,throws} from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {test} from "node:test";
import {createEngine, initializeFerrumWasm, UNIFIED_PHYSICS_CONTACT_LAYOUT as M,
  UNIFIED_PHYSICS_OBSERVATION_LAYOUT as O} from "../src/core.js";
import {wasm_memory} from "../pkg/ferrum_core.js";

test("public contacts expose geometric witnesses while solved XYZ impulses and native statistics survive geometry edits",async()=>{
  await initializeFerrumWasm(await readFile(new URL("../pkg/ferrum_core_bg.wasm",import.meta.url)));
  // The opening diagnostics/observations checks intentionally precede native setup.
  const e=await createEngine(undefined, undefined, undefined, undefined, { physicsBackend: "legacy" });
  try {
    equal(e.queryUnifiedPhysicsDiagnostics(),undefined);throws(()=>e.queryUnifiedPhysicsObservations());
    e.useDataScene();e.configureUnifiedPhysics({space:"spatial",gravity:[0,0,0],lengthUnit:1,stepSeconds:0.01});
    const shape={type:"box" as const,halfExtents:[0.5,0.5,0.5] as const};
    const a=e.spawnUnifiedPhysicsBody({kind:"fixed",collider:{shape,category:2},renderOffset:[0,100,0]});
    const b=e.spawnUnifiedPhysicsBody({pose:{position:[0,1,0]},collider:{shape,category:4}});
    let contacts=e.queryUnifiedPhysicsContactManifolds({categoryA:2,categoryB:4});
    equal(contacts.manifolds.count,1);ok(contacts.points.count>=4);
    equal(contacts.manifolds.words[M.entity],a.entityId);ok(contacts.manifolds.floats[M.normal+1]>0.99);
    ok(Math.abs(contacts.points.floats[M.firstPoint+1]-0.5)<1e-5);
    const contactCopy=contacts.manifolds.words.slice();wasm_memory().grow(1);equal(contacts.manifolds.words.length,0);
    contacts=e.queryUnifiedPhysicsContactManifolds({categoryA:2,categoryB:4});deepEqual(contacts.manifolds.words,contactCopy);
    const bounded=e.queryUnifiedPhysicsContactManifolds({maxPoints:1});equal(bounded.manifolds.count,0);ok(bounded.truncated);
    equal(e.queryUnifiedPhysicsObservations().impulses.count,0);
    e.setUnifiedPhysicsVelocities(new Uint32Array([b.entityId,b.entityGeneration]),new Float32Array([1,-6,2,0,0,0]));
    e.stepRigidBodies(Math.fround(0.01));
    const observed=e.queryUnifiedPhysicsObservations();ok(observed.impulses.count>0);
    equal(observed.diagnostics.backend,"rapier3d");equal(observed.diagnostics.legacySolverRowMetricsAvailable,false);
    equal(observed.diagnostics.fixedSteps,1);equal(observed.diagnostics.frame.backendSteps,1);
    equal(observed.diagnostics.step.dynamicBodies,1);ok(observed.diagnostics.step.solverContacts>0);
    equal(observed.diagnostics.solvedContacts,observed.impulses.count);
    const i=observed.impulses;equal(i.words[O.categories],6);ok(i.floats[O.normalImpulse]>0);
    ok(Math.abs(i.floats[O.approachSpeed]-6)<1e-4);ok(Math.abs(i.floats[O.impulseNormal+1])>0.99);
    const copy=i.words.slice();e.removeUnifiedPhysicsBody(b);e.queryUnifiedPhysicsContactManifolds();
    deepEqual(e.queryUnifiedPhysicsObservations().impulses.words,copy);
    equal(observed.diagnostics.step.dynamicBodies,1); // Historical snapshot is owned.
  } finally {e.destroy();}
  throws(()=>e.queryUnifiedPhysicsContactManifolds(),/destroyed/i);
  throws(()=>e.queryUnifiedPhysicsObservations(),/destroyed/i);
  throws(()=>e.queryUnifiedPhysicsDiagnostics(),/destroyed/i);
});

test("public CCD observations preserve physical witnesses and per-frame accumulation independently of last-tick contacts",async()=>{
  await initializeFerrumWasm(await readFile(new URL("../pkg/ferrum_core_bg.wasm",import.meta.url)));
  const e=await createEngine();
  try {
    e.useDataScene();e.configureUnifiedPhysics({space:"planar-xy",gravity:[0,0,0],lengthUnit:1,stepSeconds:0.01});
    const wall=e.spawnUnifiedPhysicsBody({kind:"fixed",collider:{shape:{type:"box",halfExtents:[0.05,1,2]}}});
    const moving=e.spawnUnifiedPhysicsBody({pose:{position:[-2,0,0]},linearVelocity:[600,0,0],ccd:true,
      collider:{shape:{type:"sphere",radius:0.5}}});
    for(let i=0;i<3;i++)e.stepRigidBodies(Math.fround(0.01));
    const observed=e.queryUnifiedPhysicsObservations();
    equal(observed.diagnostics.frame.backendSteps,3);equal(observed.diagnostics.step.backendSteps,1);
    ok(observed.ccd.count>0);equal(observed.diagnostics.step.ccdClamps,0);
    const c=observed.ccd;equal(c.words[O.entity],moving.entityId);equal(c.words[O.second+O.entity],wall.entityId);
    ok(c.floats[O.fraction]>=0 && c.floats[O.fraction]<1);ok(c.floats[O.sweepSeconds]>0);ok(c.floats[O.ccdNormal]<-0.99);
    const saved=c.words.slice();e.removeUnifiedPhysicsBody(moving);
    deepEqual(e.queryUnifiedPhysicsObservations().ccd.words,saved);
  } finally {e.destroy();}
});
