import "./nativeRuntimeTestHelper.js";
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { applyDataSceneAuthoringDocument } from "../src/authoring.js";
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

test("64 native agents replay the fixed 50 ms browser scenario with the same 405-step state hash", async () => {
  let steps = 0;
  let frames = 0;
  const engine = await createEngine(frame => {
    steps += frame.unifiedPhysics?.frame.backendSteps ?? 0;
    frames++;
  });
  const request = globalThis.requestAnimationFrame;
  const cancel = globalThis.cancelAnimationFrame;
  let tick: FrameRequestCallback | undefined;
  globalThis.requestAnimationFrame = callback => { tick = callback; return 1; };
  globalThis.cancelAnimationFrame = () => { tick = undefined; };
  try {
    // Match probeFixed50msNativeGameplayNavigation, including its four grounding steps.
    const agents = Array.from({ length: 64 }, (_, index) => ({
      id: `agent-${Math.floor(index / 8)}-${index % 8}`,
      prefab: "agent",
      x: 94 + index % 8 * 0.55,
      y: 1.925 - Math.floor(index / 8) * 0.55,
    }));
    const document = {
      format: "ferrum2d.consumer.scene-authoring",
      version: 1,
      physics: { space: "spatial", gravity: [0, -10, 0], stepSeconds: 0.01, lengthUnit: 1 },
      gameplay: { primaryActor: "target", combat: true, combatNavigation: {
        cellSize: 0.5, maxStepHeight: 0.3, maxDropHeight: 0.2, repathIntervalSeconds: 0.1,
        arrivalRadius: 1, maxAgents: 64, crowdAvoidance: { padding: 0.1 },
      } },
      sceneComposition: {
        initialFragment: "main",
        prefabs: {
          target: { props: { components: {
            visual: { kind: "primitive", shape: "circle", radius: 0.1 }, collider: "none", layer: "player",
            body: { kind: "fixed", elevation: 0.76, collider: { shape: { type: "sphere", radius: 0.1 }, sensor: true } },
          } } },
          agent: { props: { behaviorRecipes: ["move"], components: {
            visual: { kind: "primitive", shape: "circle", radius: 0.25 }, collider: "none", layer: "enemy",
            body: { kind: "kinematic-position", elevation: 0.76, renderOffset: [100, 0, 0],
              collider: { shape: { type: "capsule", halfHeight: 0.5, radius: 0.25 } }, character: {} },
          } } },
        },
        fragments: { main: { instances: [{ id: "target", prefab: "target", x: 20, y: 0 }, ...agents] } },
      },
      behaviorRecipes: { entities: { move: { recipes: [{ kind: "chase", target: "primaryActor", speed: 2, stopDistance: 0 }] } } },
      spatial: {
        camera: { projection: "orthographic", position: { x: 100, y: -20, elevation: 20 },
          target: { x: 100, y: 0, elevation: 0 }, height: 30 },
        terrain: [{ id: "floor", x: -20, y: -20, width: 60, depth: 40, elevation: 0, baseElevation: -1 }],
        billboards: Object.fromEntries(["target", ...agents.map(agent => agent.id)].map(id => [id, {}])),
      },
    };
    const { entityHandles } = applyDataSceneAuthoringDocument(engine, document, { textureId: () => 11 });
    const ids = new Uint32Array(agents.flatMap(({ id }) => {
      const handle = entityHandles[id];
      return [handle.entityId, handle.entityGeneration];
    }));
    const poses = () => {
      const { floats, stride } = engine.queryUnifiedPhysicsBodyStates(ids);
      return agents.map((_, row) => {
        const offset = row * stride + UNIFIED_PHYSICS_STATE_LAYOUT.position;
        return [...floats.slice(offset, offset + 3)];
      });
    };
    for (let i = 0; i < 4; i++) engine.stepRigidBodies(Math.fround(0.01));
    const initial = poses();
    engine.start();
    for (let frame = 0; frame <= 81; frame++) {
      if (!tick) throw new Error("Missing scheduled crowd frame");
      tick((frame + 1) * 50);
    }
    equal(frames, 81);
    equal(steps, 405);
    const stats = engine.dataSceneCombatNavigationStats();
    if (!stats) throw new Error("Missing native crowd statistics");
    equal(stats.agents, 64);
    const state = new TextEncoder().encode(JSON.stringify([initial, poses(), stats]));
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", state));
    const hash = Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
    equal(hash, "486c58c1e2a2fec256d42c63fc567da28d89576a5305d3c6be24ec8d96f9a301");
  } finally {
    engine.destroy();
    globalThis.requestAnimationFrame = request;
    globalThis.cancelAnimationFrame = cancel;
  }
});
