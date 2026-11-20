import assert from "node:assert/strict";

// Real packed SDK + Wasm. No explicit configureUnifiedPhysics call is used.
export async function probePhysicsSpecNative(page) {
  const result = await page.evaluate(async () => {
    const { createEngine, resolvePhysicsSpec, UNIFIED_PHYSICS_STATE_LAYOUT: L } = await import("@ferrum2d/ferrum-web/core");
    const { applyPhysicsSceneProfile, createPhysicsWorldFromSpec } = await import("@ferrum2d/ferrum-web/authoring");
    const { capturePhysicsWorldSnapshot } = await import("@ferrum2d/ferrum-web/quality");
    const physics = {
      mode: "rigid", gravity: [0,0], solver: {stepSeconds:0.01},
      bodies: {
        moving: {type:"dynamic",position:[0,0],velocity:[1,0],mass:1,canSleep:false,collider:{shape:"circle",radius:0.25}},
        wall: {type:"static",position:[10,0],collider:{shape:"box",size:[1,1]}},
      },
    };
    const handles = world => new Uint32Array(Object.values(world.bodies).flatMap(h=>[h.entityId,h.entityGeneration]));
    const manualEngine = await createEngine(()=>{});
    manualEngine.useDataScene();
    const manual = applyPhysicsSceneProfile(manualEngine,{profile:"manual",physics});
    const input = handles(manual.world);
    const backend = manualEngine.physicsBackend();
    const componentRows = manualEngine.capturePhysicsBodyStateBuffer(Object.values(manual.world.bodies)).states.length;
    const initial = Array.from(manualEngine.queryUnifiedPhysicsBodyStates(input).floats);
    manualEngine.start();
    await new Promise(r=>setTimeout(r,100));
    manualEngine.stop();
    const idle = Array.from(manualEngine.queryUnifiedPhysicsBodyStates(input).floats);
    manualEngine.stepRigidBodies(manual.stepSeconds,manual.stepOptions);
    const moved = Array.from(manualEngine.queryUnifiedPhysicsBodyStates(input).floats);
    const componentMoved = manualEngine.capturePhysicsBodyStateBuffer(Object.values(manual.world.bodies)).states[0];
    const checkpoint = manualEngine.captureRuntimeCheckpoint();
    manualEngine.stepRigidBodies(manual.stepSeconds,manual.stepOptions);
    manualEngine.restoreRuntimeCheckpoint(checkpoint);
    const restored = Array.from(manualEngine.queryUnifiedPhysicsBodyStates(input).floats);
    checkpoint.dispose();
    let modeRejected=false;
    try { applyPhysicsSceneProfile(manualEngine,{physics:{mode:"none"}},{replace:manual}); }
    catch {modeRejected=true;}
    const retained = manualEngine.queryUnifiedPhysicsBodyStates(input).count;
    let jsonRejected=false;
    try { capturePhysicsWorldSnapshot(manualEngine,manual.world); }
    catch (error) {jsonRejected=/runtime checkpoints/.test(String(error));}
    const extra = createPhysicsWorldFromSpec(manualEngine,{
      mode:"rigid",gravity:[0,0],solver:{stepSeconds:0.01},
      bodies:{extra:{type:"static",position:[20,0],collider:{shape:"circle",radius:1}}},
    });
    const extended = manualEngine.queryUnifiedPhysicsBodyStates(new Uint32Array([...input,...handles(extra)])).count;
    const afterAddition = Array.from(manualEngine.queryUnifiedPhysicsBodyStates(input).floats);
    extra.clear();manual.clear();manualEngine.destroy();

    let frames=0, nativeSteps=0, mode;
    const runtimeEngine = await createEngine(frame=>{
      frames++;mode=frame.physics.mode;nativeSteps+=frame.unifiedPhysics?.frame.backendSteps??0;
    });
    runtimeEngine.useDataScene();
    const runtime = applyPhysicsSceneProfile(runtimeEngine,{physics});
    const runtimeHandles=handles(runtime.world);
    runtimeEngine.start();await new Promise(r=>setTimeout(r,150));runtimeEngine.stop();
    const automatic = Array.from(runtimeEngine.queryUnifiedPhysicsBodyStates(runtimeHandles).floats);
    runtime.clear();runtimeEngine.destroy();
    return {backend,componentRows,componentMoved,initial,idle,moved,restored,afterAddition,retained,extended,modeRejected,jsonRejected,
      automatic,frames,nativeSteps,mode,position:L.position,velocity:L.linearVelocity};
  });
  assert.deepEqual(result.idle,result.initial,"manual profile must not auto-step native bodies");
  assert.equal(result.backend,"unified-3d");assert.equal(result.componentRows,2);
  assert(result.moved[result.position]>result.initial[result.position],"manual stepping must advance the native body");
  assert(Math.abs(result.moved[result.velocity]-1)<1e-5);
  assert(Math.abs(result.componentMoved.x-result.moved[result.position])<1e-6);
  assert(Math.abs(result.componentMoved.velocityX-result.moved[result.velocity])<1e-6);
  assert.deepEqual(result.restored,result.moved,"native Physics Spec bodies must replay through memory checkpoints");
  assert.deepEqual(result.afterAddition,result.moved,"identical world setup must retain existing native state");
  assert.equal(result.retained,2);assert.equal(result.extended,3);
  assert.equal(result.modeRejected,true);assert.equal(result.jsonRejected,true);
  assert(result.frames>0);assert(result.nativeSteps>0);assert.equal(result.mode,"rigid");
  assert(result.automatic[result.position]>0,"runtime profile must step the native backend on RAF");
  return result;
}
