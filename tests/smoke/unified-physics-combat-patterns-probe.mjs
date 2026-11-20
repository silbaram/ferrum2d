import assert from "node:assert/strict";

export async function probeUnifiedCombatPatterns(page) {
  const result=await page.evaluate(async()=>{
    const {createEngine,UNIFIED_PHYSICS_STATE_LAYOUT:B}=await import("@ferrum2d/ferrum-web/core");
    const {applyDataSceneAuthoringDocument}=await import("@ferrum2d/ferrum-web/authoring");
    let elapsed=0,frames=0,steps=0,vertices=0,maxWork=0,maxSearches=0,maxRustMs=0,minHeight=Infinity,finish,timer,ids;
    const snapshot=()=>{
      const view=e.queryUnifiedPhysicsBodyStates(ids);
      return {positions:[0,1,2,3].map(i=>Array.from(view.floats.slice(i*B.stride+B.position,i*B.stride+B.position+3))),
        velocities:[0,1,2,3].map(i=>Array.from(view.floats.slice(i*B.stride+B.linearVelocity,i*B.stride+B.linearVelocity+3)))};
    };
    const e=await createEngine(frame=>{
      elapsed+=frame.physics.fixedConsumedSeconds;frames++;steps+=frame.unifiedPhysics?.frame.backendSteps??0;
      maxRustMs=Math.max(maxRustMs,frame.rustUpdateTimeMs);
      const spatial=frame.renderCommandBuffer.spatial;if(spatial)vertices=Math.max(vertices,spatial.billboards.length/spatial.vertexStride);
      const stats=e.dataSceneCombatNavigationStats();maxWork=Math.max(maxWork,stats.frameWorkUnits);maxSearches=Math.max(maxSearches,stats.frameSearches);
      const {positions}=snapshot();minHeight=Math.min(minHeight,...positions.slice(0,3).map(p=>p[1]));
      if(elapsed>=4.5){e.pause();finish();}
    },undefined,undefined,()=>({width:320,height:180}));
    const capsule={kind:"kinematic-position",elevation:1,renderOffset:[100,0,0],collider:{shape:{type:"capsule",halfHeight:0.5,radius:0.25}},character:{}};
    const object=(id,x,y,body,recipe)=>({id,prefab:"object",x,y,props:{behaviorRecipes:recipe?[recipe]:[],components:{
      visual:{kind:"primitive",shape:"circle",radius:0.25},collider:"none",layer:id==="player"?"player":id==="wall"?"wall":"enemy",body,
    }}});
    const doc={format:"ferrum2d.consumer.scene-authoring",version:1,
      physics:{space:"spatial",gravity:[0,-10,0],stepSeconds:0.01,lengthUnit:1},
      gameplay:{primaryActor:"player",combat:true,combatNavigation:{movementPatterns:"all",cellSize:0.5,maxStepHeight:0.3,maxDropHeight:0.2,
        repathIntervalSeconds:0.1,arrivalRadius:1,maxAgents:3,crowdAvoidance:{padding:0.1}}},
      sceneComposition:{initialFragment:"main",prefabs:{object:{}},fragments:{main:{instances:[
        object("player",4,0,{kind:"fixed",elevation:1,collider:{shape:{type:"sphere",radius:0.25},sensor:true}}),
        object("seeker",100,0,capsule,"seeking"),object("chaser",99,-1.5,capsule,"chasing"),
        object("accelerator",97,-3,capsule,"accelerating"),
        object("controlled",-4,3,{...capsule,renderOffset:[0,0,0]},"accelerating"),
        object("wall",1.5,0,{kind:"fixed",elevation:1,collider:{shape:{type:"box",halfExtents:[0.3,1,0.6]}}}),
      ]}}},behaviorRecipes:{entities:{
        seeking:{recipes:[{kind:"seekTarget",target:"primaryActor",speed:2,turnRate:0.25}]},
        chasing:{recipes:[{kind:"chase",target:"primaryActor",speed:2,stopDistance:1}]},
        accelerating:{recipes:[{kind:"accelerate",accelerationX:0.02,accelerationY:0,maxSpeed:0.5}]},
      }},spatial:{camera:{projection:"orthographic",position:{x:0,y:-100,elevation:100},target:{x:0,y:0,elevation:10},height:300},
        terrain:[{id:"floor",x:-10,y:-10,width:30,depth:20,elevation:0,baseElevation:-1}],
        actor:{instanceId:"controlled",speed:2,maxStepHeight:0.3,maxDropHeight:0.2},
        billboards:{player:{},seeker:{},chaser:{},accelerator:{},controlled:{},wall:{}}},
    };
    try {
      const applied=applyDataSceneAuthoringDocument(e,doc,{textureId:()=>11});
      ids=new Uint32Array(["seeker","chaser","accelerator","controlled"].flatMap(id=>{
        const h=applied.entityHandles[id];return [h.entityId,h.entityGeneration];}));
      for(let i=0;i<120;i++)e.stepRigidBodies(Math.fround(0.01));
      const initial=snapshot();const supported=e.supportsDataSceneNativeCombatMovement();
      const done=new Promise((resolve,reject)=>{finish=resolve;timer=setTimeout(()=>reject(new Error("Native movement RAF timed out")),45000);});
      e.start();await done;e.pause();const final=snapshot();
      let oldRejected=false;
      const old=new Proxy(e,{get(target,key){return key==="supportsDataSceneNativeCombatMovement"?()=>false:Reflect.get(target,key);}});
      try{applyDataSceneAuthoringDocument(old,doc,{textureId:()=>11});}catch(error){oldRejected=/native capsule movement Wasm/.test(String(error));}
      return {supported,initial,final,retained:snapshot(),oldRejected,playing:e.dataSceneState(),entities:e.entityCount(),
        stats:e.dataSceneCombatNavigationStats(),scheduler:e.dataSceneCombatNavigationSchedulerStats(),crowd:e.dataSceneCombatCrowdStats(),combat:e.dataSceneCombatStats(),
        frames,steps,vertices,maxWork,maxSearches,maxRustMs,minHeight};
    } finally {clearTimeout(timer);e.destroy();}
  });
  assert(result.supported&&result.oldRejected);assert.deepEqual(result.retained,result.final);
  assert.equal(result.playing,"playing");assert.equal(result.entities,6);assert.equal(result.stats.agents,3);
  assert.equal(result.combat.aiSteps,result.steps*3);
  for(const at of result.final.positions.slice(0,2))assert(at[0]>3&&Math.hypot(at[0]-4,at[2])<=1.03,JSON.stringify(result));
  const acceleration=result.final.positions[2],velocity=result.final.velocities[2];
  assert(acceleration[0]>result.initial.positions[2][0]+1&&Math.hypot(velocity[0],velocity[2])<=0.51,JSON.stringify(result));
  assert(Math.abs(result.final.positions[3][0]+4)<0.001,JSON.stringify(result));
  assert(result.crowd.enabled&&result.scheduler.cacheHits>0&&result.stats.searches>0,JSON.stringify(result));
  assert(result.maxWork<=1_000_000&&result.maxSearches<=1&&Number.isFinite(result.maxRustMs));
  assert(result.frames>0&&result.steps>=450&&result.vertices>=36&&result.minHeight>0.74,JSON.stringify(result));
  return result;
}
