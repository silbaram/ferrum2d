import "./nativeRuntimeTestHelper.js";
import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import { Engine, NativeFilePrepare } from "../pkg/ferrum_core.js";
import { createEngine, createDetachedEngineFacade } from "../src/createEngine.js";
import { nativeFileEngineOwner, captureDetachedEngineMetadata } from "../src/nativeFileEngineOwner.js";
import { WasmBridge } from "../src/wasmBridge.js";
import { UNIFIED_PHYSICS_STATE_LAYOUT } from "../src/unifiedPhysics.js";

/** These assertions require Root's next fresh production Wasm. The immutable
 * baseline1734 Wasm predates the raw-constructor change; do not relabel it. */
function rawBytes(e: Engine) {
  return e.capture_native_file(new TextEncoder().encode("{}{}{}{}{}{}"),new Uint32Array([2,2,2,2,2,2]),0,0,new Uint32Array());
}
const near=(actual:number,expected:number)=>ok(Math.abs(actual-expected)<.002,`${actual} != ${expected}`);

test("raw Wasm Engine and omitted SDK creation use native variable automatic physics across every scene",async()=>{
  const raw=new Engine();
  try{equal(raw.physics_spec_backend_active(),true);equal(raw.default_physics_policy_scene(),1);equal(raw.fixed_timestep_enabled(),false);equal(raw.default_physics_policy_fixed_timestep(),false);}
  finally{raw.free();}
  const engine=await createEngine(),native=nativeFileEngineOwner(engine).native;
  try{
    equal(engine.physicsBackend(),"unified-3d");equal(native.fixed_timestep_enabled(),false);
    for(const scene of [4,2,3,1,4]){
      if(scene===4)engine.useDataScene();else if(scene===2)engine.useBreakoutGame();else if(scene===3)engine.usePlatformerGame();else engine.setTextureIds({player:0,enemy:0,bullet:0});
      equal(engine.physicsBackend(),"unified-3d");equal(native.default_physics_policy_scene(),scene);equal(native.fixed_timestep_enabled(),false);
    }
    const body=engine.spawnUnifiedPhysicsBody({kind:"dynamic",pose:{position:[10,20,0]},linearVelocity:[2,0,0],collider:{shape:{type:"sphere",radius:.25}}});
    native.update(.023);
    const state=engine.queryUnifiedPhysicsBodyStates(new Uint32Array([body.entityId,body.entityGeneration]));
    near(state.floats[UNIFIED_PHYSICS_STATE_LAYOUT.position],10.046);
    near(state.floats[UNIFIED_PHYSICS_STATE_LAYOUT.position+1],20);
    equal(native.fixed_timestep_enabled(),false);
  }finally{engine.destroy();}
});

test("implicit native Game Spec settings match applied metadata and explicit legacy remains available",async()=>{
  const engine=await createEngine(),legacy=await createEngine(undefined,undefined,undefined,undefined,{physicsBackend:"legacy"});
  try{
    const native=nativeFileEngineOwner(engine).native, before=rawBytes(native);
    throws(()=>engine.setGameSpec({physics:{mode:"none"}}),/native defaults/);deepEqual(rawBytes(native),before);
    const resolved=engine.setGameSpec({physics:{mode:"rigid",gravity:[2,31],continuous:true,solver:{fixedTimestep:false,stepSeconds:.02,velocityIterations:4,positionIterations:3}}});
    equal(resolved.physics.gravityX,2);equal(resolved.physics.gravityY,31);equal(resolved.physics.solver.velocityIterations,4);
    equal(native.unified_physics_clock_step_seconds(),Math.fround(.02));equal(native.fixed_timestep_enabled(),false);
    equal(nativeFileEngineOwner(engine).frame.physicsSpec.solver.stepSeconds,Math.fround(.02));
    engine.useDataScene();equal(native.unified_physics_clock_step_seconds(),Math.fround(1/60));equal(native.fixed_timestep_enabled(),false);
    equal(legacy.physicsBackend(),"legacy");legacy.useDataScene();equal(legacy.physicsBackend(),"legacy");
    equal(legacy.setGameSpec({physics:{mode:"none"}}).physics.mode,"none");equal(legacy.physicsBackend(),"legacy");
  }finally{engine.destroy();legacy.destroy();}
});

test("file install and detached facade preserve saved explicit legacy/native policy without creation reapplication",async()=>{
  for(const legacy of [false,true]){
    const source=await createEngine(undefined,undefined,undefined,undefined,legacy?{physicsBackend:"legacy"}:{}),bridge=await WasmBridge.init();
    let target:Awaited<ReturnType<typeof createEngine>>|undefined;
    const placeholder=bridge.engine();let prepared:NativeFilePrepare|undefined;
    try{
      source.useDataScene();const native=nativeFileEngineOwner(source).native;
      if(!legacy)source.configureFixedTimestep({enabled:false,stepSeconds:1/60,maxFrameSeconds:.08,maxStepsPerUpdate:3});
      native.update(.023);const file=rawBytes(native),metadata=captureDetachedEngineMetadata(nativeFileEngineOwner(source));
      prepared=new NativeFilePrepare(placeholder,file,0,0,new Uint32Array());
      equal(placeholder.install_native_file_prepare(prepared),0);prepared.free();prepared=undefined;
      const installed=rawBytes(placeholder);
      target=await createDetachedEngineFacade(bridge,metadata,{},undefined,undefined,undefined,legacy?{physicsBackend:"legacy"}:{});
      deepEqual(rawBytes(placeholder),installed);equal(target.physicsBackend(),legacy?"legacy":"unified-3d");
      equal(placeholder.fixed_timestep_enabled(),false);equal(placeholder.default_physics_policy_scene(),legacy?0:4);
      if(!legacy)equal(placeholder.unified_physics_clock_max_frame_seconds(),Math.fround(.08));
      target.usePlatformerGame();equal(target.physicsBackend(),legacy?"legacy":"unified-3d");
    }finally{prepared?.free();source.destroy();if(target)target.destroy();else placeholder.free();}
  }
});
