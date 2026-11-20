import assert from "node:assert/strict";
import { RUNTIME_BUDGET_PROFILES, DEPLOYMENT_RUNTIME_SAMPLE_FRAMES } from "./runtime-budget-profiles.mjs";

export async function probeNativeGameplayNavigation(page) {
  const result=await page.evaluate(async ({budget,sampleFrames})=>{
    const {createEngine,WebGL2Renderer,UNIFIED_PHYSICS_STATE_LAYOUT:B}=await import("@ferrum2d/ferrum-web/core");
    const {applyDataSceneAuthoringDocument}=await import("@ferrum2d/ferrum-web/authoring");
    const canvas=globalThis.document.createElement("canvas");canvas.width=640;canvas.height=360;
    canvas.style.cssText="display:block;width:640px;height:360px";globalThis.document.body.append(canvas);
    const renderer=new WebGL2Renderer(canvas);
    const white="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==";
    await Promise.all([renderer.loadTexture(0,white),renderer.loadTexture(11,white)]);
    let ids,finish,reject,timer,elapsed=0,frames=0,steps=0,maxVertices=0,maxWork=0,maxSearches=0;
    let maxFrameTimeMs=0,maxRustUpdateTimeMs=0,maxJsHeapUsedBytes=0,maxWasmLinearMemoryBytes=0,minSeparation=Infinity;
    let maxRenderTimeMs=0,maxDrawCalls=0,maxRenderCommandCount=0,maxTextureSwitchCount=0,maxBillboards=0,maxFixedSteps=0,maxSolidChecks=0,maxTileChecks=0,maxCcdChecks=0,maxCollisionPairs=0;
    const poses=()=>{
      const view=e.queryUnifiedPhysicsBodyStates(ids);
      return Array.from({length:64},(_,row)=>Array.from(view.floats.slice(row*B.stride+B.position,row*B.stride+B.position+3)));
    };
    const e=await createEngine(frame=>{
      try {
        const renderAt=performance.now();renderer.render();renderer.renderCommands(frame.renderCommandBuffer);renderer.renderPostProcess();
        maxRenderTimeMs=Math.max(maxRenderTimeMs,performance.now()-renderAt);
        const rendered=renderer.stats();maxDrawCalls=Math.max(maxDrawCalls,rendered.drawCalls);maxRenderCommandCount=Math.max(maxRenderCommandCount,rendered.renderCommandCount);
        maxTextureSwitchCount=Math.max(maxTextureSwitchCount,rendered.textureSwitchCount);maxBillboards=Math.max(maxBillboards,rendered.spatial?.billboardCount??0);
        maxFixedSteps=Math.max(maxFixedSteps,frame.physics.fixedSteps);maxSolidChecks=Math.max(maxSolidChecks,frame.physics.solidCandidateChecks);
        maxTileChecks=Math.max(maxTileChecks,frame.physics.tileCandidateChecks);maxCcdChecks=Math.max(maxCcdChecks,frame.physics.ccdChecks);maxCollisionPairs=Math.max(maxCollisionPairs,frame.physics.collisionPairs);
        frames++;steps+=frame.unifiedPhysics?.frame.backendSteps??0;elapsed+=frame.physics.fixedConsumedSeconds;
        maxFrameTimeMs=Math.max(maxFrameTimeMs,frame.frameTimeMs);maxRustUpdateTimeMs=Math.max(maxRustUpdateTimeMs,frame.rustUpdateTimeMs);
        maxJsHeapUsedBytes=Math.max(maxJsHeapUsedBytes,performance.memory?.usedJSHeapSize??0);
        maxWasmLinearMemoryBytes=Math.max(maxWasmLinearMemoryBytes,frame.wasmLinearMemoryBytes??0);
        const spatial=frame.renderCommandBuffer.spatial;
        if(spatial)maxVertices=Math.max(maxVertices,spatial.billboards.length/spatial.vertexStride);
        const nav=e.dataSceneCombatNavigationStats();maxWork=Math.max(maxWork,nav.frameWorkUnits);maxSearches=Math.max(maxSearches,nav.frameSearches);
        const points=poses();
        for(let i=0;i<points.length;i++)for(let j=0;j<i;j++)minSeparation=Math.min(minSeparation,Math.hypot(points[i][0]-points[j][0],points[i][2]-points[j][2]));
        if(elapsed>=4&&frames>=sampleFrames){e.pause();finish();}
      }catch(error){e.pause();reject(error);}
    },undefined,undefined,()=>renderer.viewportSize());
    const instances=[{id:"target",prefab:"target",x:20,y:0}];
    const billboards={target:{}};
    for(let row=0;row<8;row++)for(let column=0;column<8;column++){
      const id=`agent-${row}-${column}`;
      instances.push({id,prefab:"agent",x:94+column*0.55,y:1.925-row*0.55});billboards[id]={};
    }
    const document={format:"ferrum2d.consumer.scene-authoring",version:1,
      physics:{space:"spatial",gravity:[0,-10,0],stepSeconds:0.01,lengthUnit:1},
      gameplay:{primaryActor:"target",combat:true,combatNavigation:{cellSize:0.5,maxStepHeight:0.3,maxDropHeight:0.2,repathIntervalSeconds:0.1,arrivalRadius:1,maxAgents:64,crowdAvoidance:{padding:0.1}}},
      sceneComposition:{initialFragment:"main",prefabs:{
        target:{props:{components:{visual:{kind:"primitive",shape:"circle",radius:0.1},collider:"none",layer:"player",body:{kind:"fixed",elevation:0.76,collider:{shape:{type:"sphere",radius:0.1},sensor:true}}}}},
        agent:{props:{behaviorRecipes:["move"],components:{visual:{kind:"primitive",shape:"circle",radius:0.25},collider:"none",layer:"enemy",body:{kind:"kinematic-position",elevation:0.76,renderOffset:[100,0,0],collider:{shape:{type:"capsule",halfHeight:0.5,radius:0.25}},character:{}}}}},
      },fragments:{main:{instances}}},
      behaviorRecipes:{entities:{move:{recipes:[{kind:"chase",target:"primaryActor",speed:2,stopDistance:0}]}}},
      spatial:{camera:{projection:"orthographic",position:{x:100,y:-20,elevation:20},target:{x:100,y:0,elevation:0},height:30},terrain:[{id:"floor",x:-20,y:-20,width:60,depth:40,elevation:0,baseElevation:-1}],billboards},
    };
    try {
      if(e.physicsBackend()!=="unified-3d")throw new Error("omitted SDK options did not select Native");
      const applied=applyDataSceneAuthoringDocument(e,document,{textureId:()=>11});
      ids=new Uint32Array(instances.slice(1).flatMap(({id})=>{const h=applied.entityHandles[id];return [h.entityId,h.entityGeneration];}));
      for(let i=0;i<4;i++)e.stepRigidBodies(Math.fround(0.01));
      const initial=poses();
      const targetHandle=applied.entityHandles.target;
      const targetView=e.queryUnifiedPhysicsBodyStates(new Uint32Array([targetHandle.entityId,targetHandle.entityGeneration]));
      const goal=Array.from(targetView.floats.slice(B.position,B.position+3));
      const done=new Promise((resolve,fail)=>{finish=resolve;reject=fail;timer=setTimeout(()=>fail(new Error("dense Native crowd RAF timed out")),45000);});
      e.start();await done;e.pause();
      const final=poses(),stats=e.dataSceneCombatNavigationStats();
      const checkpoint=e.captureRuntimeCheckpoint(),trace=[];
      try {
        for(let i=0;i<6;i++){e.stepRigidBodies(Math.fround(0.01));trace.push(poses());}
        e.restoreRuntimeCheckpoint(checkpoint);
        for(const expected of trace){e.stepRigidBodies(Math.fround(0.01));if(JSON.stringify(poses())!==JSON.stringify(expected))throw new Error("dense Native checkpoint continuation differs");}
      }finally{checkpoint.dispose();}
      return {initial,final,goal,stats,frames,steps,maxVertices,maxWork,maxSearches,minSeparation,maxFrameTimeMs,maxRustUpdateTimeMs,maxJsHeapUsedBytes,maxWasmLinearMemoryBytes,maxRenderTimeMs,maxDrawCalls,maxRenderCommandCount,maxTextureSwitchCount,maxBillboards,maxFixedSteps,maxSolidChecks,maxTileChecks,maxCcdChecks,maxCollisionPairs,elapsed,backend:e.physicsBackend(),state:e.dataSceneState(),checkpointSixStepExact:true,budgetProfile:"physics-sandbox",budget};
    } finally{clearTimeout(timer);e.destroy();renderer.destroy();canvas.remove();}
  },{budget:RUNTIME_BUDGET_PROFILES["physics-sandbox"],sampleFrames:DEPLOYMENT_RUNTIME_SAMPLE_FRAMES});
  assert.equal(result.backend,"unified-3d");assert.equal(result.state,"playing");assert.equal(result.stats.agents,64);
  assert(result.frames>=DEPLOYMENT_RUNTIME_SAMPLE_FRAMES&&result.steps>0&&result.maxVertices>=64*6,JSON.stringify(result));
  assert(result.minSeparation>=0.49,JSON.stringify(result));
  let totalGoalProgress=0;
  const goalDistance=p=>Math.hypot(p[0]-result.goal[0],p[2]-result.goal[2]);
  for(let i=0;i<64;i++){
    const progress=goalDistance(result.initial[i])-goalDistance(result.final[i]);
    assert(progress>0,`no goal progress agent ${i}: ${JSON.stringify(result)}`);totalGoalProgress+=progress;
  }
  assert(totalGoalProgress>64*0.1,JSON.stringify(result));
  assert(result.maxWork<=1_000_000&&result.maxSearches<=1,JSON.stringify(result));
  const budget=RUNTIME_BUDGET_PROFILES["physics-sandbox"];
  assert(result.maxBillboards>=64,JSON.stringify(result));
  for(const [actual,key] of [[result.maxRenderTimeMs,"maxRenderTimeMs"],[result.maxDrawCalls,"maxDrawCalls"],[result.maxRenderCommandCount,"maxRenderCommandCount"],[result.maxTextureSwitchCount,"maxTextureSwitchCount"],[result.maxFixedSteps,"maxPhysicsFixedSteps"],[result.maxSolidChecks,"maxPhysicsSolidCandidateChecks"],[result.maxTileChecks,"maxPhysicsTileCandidateChecks"],[result.maxCcdChecks,"maxPhysicsCcdChecks"],[result.maxCollisionPairs,"maxCollisionPairCount"]])assert(actual<=budget[key],`${key}: ${JSON.stringify(result)}`);
  assert(result.maxFrameTimeMs<=budget.maxFrameTimeMs,JSON.stringify(result));
  assert(result.maxRustUpdateTimeMs<=budget.maxRustUpdateTimeMs,JSON.stringify(result));
  if(result.maxJsHeapUsedBytes>0)assert(result.maxJsHeapUsedBytes<=budget.maxJsHeapUsedBytes,JSON.stringify(result));
  assert(result.checkpointSixStepExact);
  return result;
}
