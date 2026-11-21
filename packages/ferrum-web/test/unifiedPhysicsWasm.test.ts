import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createEngine, initializeFerrumWasm, UNIFIED_PHYSICS_STATE_LAYOUT as L } from "../src/core.js";
import { wasm_memory } from "../pkg/ferrum_core.js";
import { UNIFIED_PHYSICS_CHARACTER_LAYOUT as C, type UnifiedPhysicsShape } from "../src/core.js";

test("public body commands preserve atomic admission and drive planar and spatial dynamics in real Wasm", async () => {
  await initializeFerrumWasm(await readFile(new URL("../pkg/ferrum_core_bg.wasm", import.meta.url)));
  for(const space of ["planar-xy","spatial"] as const) {
    const e=await createEngine();
    try {
      e.useDataScene();e.configureUnifiedPhysics({space,gravity:[0,0,0],lengthUnit:1,stepSeconds:0.01});
      const collider={shape:{type:"box" as const,halfExtents:[0.5,0.5,0.5] as const}};
      const a=e.spawnUnifiedPhysicsBody({collider});
      const k=e.spawnUnifiedPhysicsBody({kind:"kinematic-position",pose:{position:[20,0,0]},collider});
      const fixed=e.spawnUnifiedPhysicsBody({kind:"fixed",pose:{position:[40,0,0]},collider});
      const h=new Uint32Array([a.entityId,a.entityGeneration]);
      const kh=new Uint32Array([k.entityId,k.entityGeneration]);
      const z=space==="spatial"?3:0;
      e.setUnifiedPhysicsPoses(new Uint32Array([...h,...kh]),new Float32Array([1,2,z,0,0,0,1,21,2,z,0,0,0,1]));
      let state=e.queryUnifiedPhysicsBodyStates(h);
      deepEqual([...state.floats.slice(L.position,L.position+3)],[1,2,z]);
      // Supply aliases of the native query buffer; wrapper allocations must not invalidate input.
      e.setUnifiedPhysicsPoses(state.words.subarray(0,2),state.floats.subarray(L.position,L.position+7));
      throws(()=>e.setUnifiedPhysicsPoses(new Uint32Array([...h,...kh]),new Float32Array([9,2,z,0,0,0,1,21,2,z,0,0,0,0])));
      equal(e.queryUnifiedPhysicsBodyStates(h).floats[L.position],1);
      e.setUnifiedPhysicsKinematicTargets(kh,new Float32Array([23,2,z,0,0,0,1]));
      throws(()=>e.setUnifiedPhysicsKinematicTargets(new Uint32Array([...kh,...h]),new Float32Array([99,2,z,0,0,0,1,0,0,0,0,0,0,1])));
      e.stepRigidBodies(Math.fround(0.01));
      ok(Math.abs(e.queryUnifiedPhysicsBodyStates(kh).floats[L.position]-23)<1e-4);
      e.applyUnifiedPhysicsImpulses(h,new Float32Array([2,0,0,0,0,1]));
      state=e.queryUnifiedPhysicsBodyStates(h);
      ok(Math.abs(state.floats[L.linearVelocity]-2)<1e-4);
      ok(Math.abs(state.floats[L.angularVelocity+2]-6)<1e-4);
      e.addUnifiedPhysicsForces(h,new Float32Array([4,0,0,0,0,0]));
      e.stepRigidBodies(Math.fround(0.01));
      ok(Math.abs(e.queryUnifiedPhysicsBodyStates(h).floats[L.linearVelocity]-2.04)<1e-4);
      e.clearUnifiedPhysicsForces(h);e.stepRigidBodies(Math.fround(0.01));
      ok(Math.abs(e.queryUnifiedPhysicsBodyStates(h).floats[L.linearVelocity]-2.04)<1e-4);
      e.setUnifiedPhysicsSleeping(h,true);
      const badHandles=new Uint32Array([...h,fixed.entityId,fixed.entityGeneration]);
      throws(()=>e.applyUnifiedPhysicsImpulses(badHandles,new Float32Array(12).fill(1)));
      state=e.queryUnifiedPhysicsBodyStates(h);
      ok(state.words[L.flags]&L.sleepingFlag);equal(state.floats[L.linearVelocity],0);
      e.setUnifiedPhysicsSleeping(h,false);
      equal(e.queryUnifiedPhysicsBodyStates(h).words[L.flags]&L.sleepingFlag,0);
      e.removeUnifiedPhysicsBody(a);throws(()=>e.clearUnifiedPhysicsForces(h));
    } finally {e.destroy();}
    throws(()=>e.setUnifiedPhysicsSleeping(new Uint32Array(),false),/destroyed/i);
  }
});

test("public Web API imports authored planar bodies and executes atomic bulk commands in real Wasm", async () => {
  await initializeFerrumWasm(await readFile(new URL("../pkg/ferrum_core_bg.wasm", import.meta.url)));
  // Exercise explicit legacy-component import, including legacy scene-change policy.
  const engine = await createEngine(undefined, undefined, undefined, undefined, { physicsBackend: "legacy" });
  try {
    const config = { space: "planar-xy" as const, gravity: [0, 0, 0] as const, lengthUnit: 1, stepSeconds: 0.01 };
    // All three built-in scenes explicitly opt in to planar physics; spatial built-ins remain unsupported.
    throws(() => engine.configureUnifiedPhysics({ ...config, space: "spatial" }));
    engine.configureUnifiedPhysics(config);
    equal(engine.physicsBackend(), "unified-3d");
    const player = engine.builtInShooterPlayerHandle();
    if (!player) throw new Error("Shooter must retain its primary actor after native setup");
    equal(engine.queryUnifiedPhysicsBodyStates(new Uint32Array([player.entityId, player.entityGeneration])).count, 1);
    engine.useBreakoutGame();
    equal(engine.physicsBackend(), "legacy");
    throws(() => engine.configureUnifiedPhysics({ ...config, space: "spatial" }));
    engine.configureUnifiedPhysics(config);
    equal(engine.physicsBackend(), "unified-3d");
    const paddle = engine.builtInBreakoutPaddleHandle(), ball = engine.builtInBreakoutBallHandle();
    if (!paddle || !ball) throw new Error("Breakout must retain its native paddle and ball");
    equal(engine.queryUnifiedPhysicsBodyStates(new Uint32Array([paddle.entityId, paddle.entityGeneration, ball.entityId, ball.entityGeneration])).count, 2);
    engine.usePlatformerGame();
    equal(engine.physicsBackend(), "legacy");
    throws(() => engine.configureUnifiedPhysics({ ...config, space: "spatial" }));
    engine.configureUnifiedPhysics(config);
    equal(engine.physicsBackend(), "unified-3d");
    const platformerPlayer = engine.builtInPlatformerPlayerHandle();
    if (!platformerPlayer) throw new Error("Platformer must retain its native player");
    equal(engine.queryUnifiedPhysicsBodyStates(new Uint32Array([platformerPlayer.entityId, platformerPlayer.entityGeneration])).count, 1);
    engine.useDataScene();
    const a = engine.spawnRigidBody({ x: 0, y: 0, collider: {type: "circle", radius: 0.1}, mass: 1 });
    const b = engine.spawnRigidBody({ x: 5, y: 0, collider: {type: "circle", radius: 0.1}, mass: 1 });
    engine.configureUnifiedPhysics(config);
    const handles = new Uint32Array([a.entityId, a.entityGeneration, b.entityId, b.entityGeneration]);
    engine.setUnifiedPhysicsVelocities(handles, new Float32Array([2, 0, 0, 0, 0, 0, -1, 0, 0, 0, 0, 0]));
    engine.stepRigidBodies(Math.fround(0.01));
    let state = engine.queryUnifiedPhysicsBodyStates(handles);
    equal(state.count, 2); equal(state.stride, L.stride);
    equal(state.words[L.entityId], a.entityId);
    equal(state.words[L.stride + L.entityGeneration], b.entityGeneration);
    ok(Math.abs(state.floats[L.position] - 0.02) < 1e-5);
    ok(Math.abs(state.floats[L.stride + L.position] - 4.99) < 1e-5);
    equal(state.floats[L.position + 2], 0);
    equal(state.floats[L.rotation + 3], 1);
    deepEqual([...state.floats.slice(L.linearVelocity, L.linearVelocity + 3)], [2, 0, 0]);
    const bad = new Float32Array([9, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]);
    throws(() => engine.setUnifiedPhysicsVelocities(handles, bad));
    state = engine.queryUnifiedPhysicsBodyStates(handles);
    equal(state.floats[L.linearVelocity], 2);
    equal(state.floats[L.stride + L.linearVelocity], -1);
    const retained = state.floats.slice();
    wasm_memory().grow(1);
    equal(state.floats.length, 0);
    state = engine.queryUnifiedPhysicsBodyStates(handles);
    deepEqual(state.floats, retained);
    throws(() => engine.capturePhysicsSolverState([a, b])); // No incomplete legacy snapshot success.
    ok(engine.despawnPhysicsEntity(b));
    throws(() => engine.queryUnifiedPhysicsBodyStates(handles));
    throws(() => engine.setUnifiedPhysicsVelocities(handles, new Float32Array(12)));
    state = engine.queryUnifiedPhysicsBodyStates(handles.slice(0, 2));
    equal(state.floats[L.linearVelocity], 2);
  } finally {
    engine.destroy();
  }
  throws(() => engine.queryUnifiedPhysicsBodyStates(new Uint32Array()), /destroyed/i);
});

test("public spatial authoring supports every native shape and rejects bad creation without leaking entities", async () => {
  await initializeFerrumWasm(await readFile(new URL("../pkg/ferrum_core_bg.wasm", import.meta.url)));
  const e = await createEngine();
  try {
    e.useDataScene(); e.configureUnifiedPhysics({space:"spatial", gravity:[0,-9.81,0], lengthUnit:1});
    const shapes: UnifiedPhysicsShape[] = [
      {type:"box", halfExtents:[1,1,1]}, {type:"sphere", radius:1}, {type:"capsule", halfHeight:0.5, radius:0.25},
      {type:"convexHull", points:[[0,0,0],[1,0,0],[0,1,0],[0,0,1]]},
      {type:"triangleMesh", vertices:new Float32Array([-1,0,-1,1,0,-1,0,0,1]), triangles:new Uint32Array([0,1,2])},
      {type:"heightfield", rows:2, columns:2, size:[2,2], heights:[0,0,0,0]},
      {type:"compound", parts:[{shape:{type:"sphere", radius:0.5}}, {pose:{position:[2,0,0]},shape:{type:"box",halfExtents:[0.5,1,0.5]}}]},
    ];
    for (const shape of shapes) {
      const h=e.spawnUnifiedPhysicsBody({kind:"fixed",pose:{position:[1,2,3]},collider:{shape},renderOffset:[0,-0.5,0]});
      const state=e.queryUnifiedPhysicsBodyStates(new Uint32Array([h.entityId,h.entityGeneration]));
      deepEqual([...state.floats.slice(L.position,L.position+3)],[1,2,3]);
      // The legacy 2D body snapshot cannot represent these spatial shapes.
      // Native tests cover XY projection; verify the projected elevation through Web here.
      equal(e.getPhysicsEntity(h),undefined);
      equal(e.getPhysicsBodyHeightSpan(h)?.elevation,1.5);
      e.removeUnifiedPhysicsBody(h);
    }
    const before=e.entityCount();
    throws(()=>e.spawnUnifiedPhysicsBody({collider:{shape:{type:"triangleMesh",vertices:[0,0,0,1,0,0,0,0,1],triangles:[0,1,2]}}}));
    throws(()=>e.spawnUnifiedPhysicsBody({kind:"fixed",collider:{shape:{type:"heightfield",rows:2,columns:2,size:[2,2],heights:[0]}}}));
    throws(()=>e.spawnUnifiedPhysicsBody({collider:{shape:{type:"sphere",radius:-1}}}));
    equal(e.entityCount(),before);
  } finally {e.destroy();}
});

test("spatial capsule Web input preserves queued jump on rejection and reports grounded state", async () => {
  await initializeFerrumWasm(await readFile(new URL("../pkg/ferrum_core_bg.wasm", import.meta.url)));
  const e=await createEngine();const step=Math.fround(0.01);
  try {
    e.useDataScene(); e.configureUnifiedPhysics({space:"spatial",gravity:[0,-9.81,0],lengthUnit:1,stepSeconds:step});
    const ground=e.spawnUnifiedPhysicsBody({kind:"fixed",pose:{position:[0,-0.25,0]},collider:{shape:{type:"box",halfExtents:[10,0.25,10]}}});
    const actor=e.spawnUnifiedPhysicsBody({kind:"kinematic-position",pose:{position:[0,0.76,0]},collider:{shape:{type:"capsule",halfHeight:0.5,radius:0.25}}});
    const handles=new Uint32Array([actor.entityId,actor.entityGeneration]);
    e.configureUnifiedPhysicsCharacter(actor,{});
    e.stepRigidBodies(step);e.stepRigidBodies(step);
    let state=e.queryUnifiedPhysicsCharacterStates(handles);
    ok(state.words[C.flags]&C.groundedFlag);ok(state.words[C.flags]&C.groundPresentFlag);
    equal(state.stride,C.stride);equal(state.words[C.entityId],actor.entityId);
    e.setUnifiedPhysicsCharacterInputs(handles,new Float32Array([1,0,1,4]));
    throws(()=>e.setUnifiedPhysicsCharacterInputs(new Uint32Array([...handles,ground.entityId,ground.entityGeneration]),new Float32Array(8)));
    e.stepRigidBodies(step);
    state=e.queryUnifiedPhysicsCharacterStates(handles);
    ok(state.floats[C.verticalSpeed]>3);ok(state.floats[C.translation]>0.009);ok(state.floats[C.translation+2]>0.009);
    for(let i=0;i<160;i++)e.stepRigidBodies(step);
    state=e.queryUnifiedPhysicsCharacterStates(handles);ok(state.words[C.flags]&C.groundedFlag);
    equal(state.words[C.failedPairCasts],0);equal(state.words[C.failedObstacleCasts],0);
    const saved=state.words.slice();wasm_memory().grow(1);
    state=e.queryUnifiedPhysicsCharacterStates(handles);deepEqual(state.words,saved);
    e.configureUnifiedPhysicsCharacter(actor,false);throws(()=>e.queryUnifiedPhysicsCharacterStates(handles));
    e.setUnifiedPhysicsVelocities(handles,new Float32Array(6));
    e.removeUnifiedPhysicsBody(actor);throws(()=>e.configureUnifiedPhysicsCharacter(actor,{}));
  } finally {e.destroy();}
});
