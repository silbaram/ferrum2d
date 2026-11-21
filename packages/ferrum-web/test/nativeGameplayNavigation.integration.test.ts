import "./nativeRuntimeTestHelper.js";
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { createEngine } from "../src/createEngine.js";
import { nativeFileEngineOwner } from "../src/nativeFileEngineOwner.js";
import { UNIFIED_PHYSICS_STATE_LAYOUT } from "../src/unifiedPhysics.js";

// Requires Root's fresh combined navigation/default Native Wasm. No production
// build is run in this isolated owner mirror and no old pkg is relabelled.
test("omitted SDK physics options route an actual native-only body around native-only grid obstacles", async () => {
  const engine = await createEngine();
  try {
    equal(engine.physicsBackend(), "unified-3d");
    engine.useDataScene();
    const native = nativeFileEngineOwner(engine).native;
    equal(native.fixed_timestep_enabled(), false);
    const actor = engine.spawnUnifiedPhysicsBody({kind:"kinematic-velocity", pose:{position:[0.5,0.5,0]}, renderOffset:[100,200,0], collider:{shape:{type:"sphere",radius:0.2}}});
    const wall = engine.spawnUnifiedPhysicsBody({kind:"fixed",pose:{position:[4.5,0.5,0]},renderOffset:[-100,-200,0],collider:{shape:{type:"box",halfExtents:[0.45,0.45,1]}}});
    ok(engine.configureDataSceneGameplay({primaryActor:actor}));
    ok(engine.configureDataSceneNavigation({columns:12,rows:6,cellWidth:1,cellHeight:1,costs:Array(72).fill(1),obstacles:[{instanceId:"gate",collider:true}]},{gate:wall}));
    equal(native.query_tilemap_navigation_waypoint(0.5,0.5,4.5,0.5),false);
    ok(engine.moveDataSceneActorTo({x:10.5,y:0.5,speed:4,arrivalRadius:0}));
    for(let i=0;i<50;i++) native.update(0.1);
    equal(engine.dataSceneMoveStatus(),"arrived");
    const state=engine.queryUnifiedPhysicsBodyStates(new Uint32Array([actor.entityId,actor.entityGeneration]));
    const position=UNIFIED_PHYSICS_STATE_LAYOUT.position;
    ok(Math.abs(state.floats[position]!-10.5)<0.002);
    ok(Math.abs(state.floats[position+1]!-0.5)<0.002);
    equal(native.fixed_timestep_enabled(),false);
    engine.removeUnifiedPhysicsBody(wall);
    equal(native.query_tilemap_navigation_waypoint(0.5,0.5,4.5,0.5),true);
  } finally { engine.destroy(); }
});

test("actual SDK native route request rejection retains pending route and native file bytes", async () => {
  const engine=await createEngine();
  try {
    engine.useDataScene();
    const native=nativeFileEngineOwner(engine).native;
    const actor=engine.spawnUnifiedPhysicsBody({kind:"kinematic-velocity",pose:{position:[0.5,0.5,0]},collider:{shape:{type:"capsule",halfHeight:0.2,radius:0.2}}});
    ok(engine.configureDataSceneGameplay({primaryActor:actor}));
    ok(engine.configureDataSceneNavigation({columns:12,rows:6,cellWidth:1,cellHeight:1,costs:Array(72).fill(1)}));
    ok(engine.moveDataSceneActorTo({x:10.5,y:0.5,speed:2,arrivalRadius:0}));
    const bytes=()=>native.capture_native_file(new TextEncoder().encode("{}{}{}{}{}{}"),new Uint32Array([2,2,2,2,2,2]),7,9,new Uint32Array());
    const before=bytes();
    equal(native.move_data_scene_actor_to(50,50,2,0,0xffffffff,true),false);
    deepEqual(bytes(),before);
    equal(engine.dataSceneMoveStatus(),"moving");
  } finally { engine.destroy(); }
});
