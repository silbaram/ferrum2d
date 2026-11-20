import assert from "node:assert/strict";

export async function probeUnifiedCombatNavigation(page) {
  const result = await page.evaluate(async () => {
    const { createEngine, UNIFIED_PHYSICS_STATE_LAYOUT: B } = await import("@ferrum2d/ferrum-web/core");
    const { applyDataSceneAuthoringDocument } = await import("@ferrum2d/ferrum-web/authoring");
    let elapsed=0,frames=0,steps=0,vertices=0,maxRustMs=0,maxWork=0,maxSearches=0,finish,timer;
    const e=await createEngine(frame=>{
      elapsed+=frame.physics.fixedConsumedSeconds;frames++;steps+=frame.unifiedPhysics?.frame.backendSteps??0;
      maxRustMs=Math.max(maxRustMs,frame.rustUpdateTimeMs);
      const spatial=frame.renderCommandBuffer.spatial;
      if(spatial)vertices=Math.max(vertices,spatial.billboards.length/spatial.vertexStride);
      const stats=e.dataSceneCombatNavigationStats();
      maxWork=Math.max(maxWork,stats.frameWorkUnits);maxSearches=Math.max(maxSearches,stats.frameSearches);
      if(elapsed>=3.5){e.pause();finish();}
    },undefined,undefined,()=>({width:320,height:180}));
    const object=(id,x,layer,body,recipe)=>({id,prefab:"object",x,y:0,props:{behaviorRecipes:recipe?[recipe]:[],components:{
      visual:{kind:"primitive",shape:"circle",radius:0.25},collider:"none",layer,body,
    }}});
    const doc={format:"ferrum2d.consumer.scene-authoring",version:1,
      physics:{space:"spatial",gravity:[0,-10,0],stepSeconds:0.01,lengthUnit:1},
      gameplay:{primaryActor:"player",combat:true,combatNavigation:{cellSize:0.5,maxStepHeight:0.3,maxDropHeight:0.2,repathIntervalSeconds:0.1,arrivalRadius:0.5,maxAgents:2}},
      sceneComposition:{initialFragment:"main",prefabs:{object:{}},fragments:{main:{instances:[
        object("player",-96,"player",{kind:"fixed",elevation:1,renderOffset:[-100,0,0],collider:{shape:{type:"sphere",radius:0.25},sensor:true}}),
        object("enemy",100,"enemy",{kind:"kinematic-position",elevation:1,renderOffset:[100,0,0],collider:{shape:{type:"capsule",halfHeight:0.5,radius:0.25}},character:{}},"chaser"),
        {...object("peer",99,"enemy",{kind:"kinematic-position",elevation:1,renderOffset:[100,0,0],collider:{shape:{type:"capsule",halfHeight:0.5,radius:0.25}},character:{}},"chaser"),y:-1.5},
        object("controlled",-4,"enemy",{kind:"kinematic-position",elevation:1,collider:{shape:{type:"capsule",halfHeight:0.5,radius:0.25}},character:{}},"chaser"),
        object("wall",1.5,"wall",{kind:"fixed",elevation:1,collider:{shape:{type:"box",halfExtents:[0.3,1,0.6]}}}),
      ]}}},behaviorRecipes:{entities:{chaser:{recipes:[{kind:"chase",target:"primaryActor",speed:2,stopDistance:1}]}}},
      spatial:{camera:{projection:"orthographic",position:{x:0,y:-100,elevation:100},target:{x:0,y:0,elevation:10},height:300},
        terrain:[{id:"floor",x:-10,y:-10,width:30,depth:20,elevation:0,baseElevation:-1,kind:"flat",color:[0.3,0.45,0.35,1]}],
        actor:{instanceId:"controlled",speed:2,maxStepHeight:0.3,maxDropHeight:0.2},billboards:{player:{},enemy:{},wall:{},controlled:{},peer:{}}},
    };
    try {
      const applied=applyDataSceneAuthoringDocument(e,doc,{textureId:()=>11});
      const enemy=applied.entityHandles.enemy,ids=new Uint32Array([enemy.entityId,enemy.entityGeneration]);
      const pos=()=>[...e.queryUnifiedPhysicsBodyStates(ids).floats.slice(B.position,B.position+3)];
      for(let i=0;i<120;i++)e.stepRigidBodies(Math.fround(0.01));
      const initial=pos();
      const other=applied.entityHandles.peer,otherIds=new Uint32Array([other.entityId,other.entityGeneration]);
      const peerPos=()=>[...e.queryUnifiedPhysicsBodyStates(otherIds).floats.slice(B.position,B.position+3)];
      const peerInitial=peerPos();
      const configured=e.supportsDataSceneNativeCombatNavigation();
      if(!configured)throw new Error("Native Chase authoring capability is missing");
      const done=new Promise((resolve,reject)=>{finish=resolve;timer=setTimeout(()=>reject(new Error("Native Chase RAF timed out")),45000);});
      e.start();await done;e.pause();
      const final=pos();let oldRejected=false,rejectedOptions=0;
      const old=new Proxy(e,{get(target,key){return key==="supportsDataSceneNativeCombatNavigation"?()=>false:Reflect.get(target,key);}});
      try{applyDataSceneAuthoringDocument(old,doc,{textureId:()=>11});}catch(error){oldRejected=/native capsule navigation Wasm/.test(String(error));}
      for(const option of [{maxStepHeight:10001}]) {
        const bad=structuredClone(doc);Object.assign(bad.gameplay.combatNavigation,option);
        try{applyDataSceneAuthoringDocument(e,bad,{textureId:()=>11});}catch(error){if(/native controller/.test(String(error)))rejectedOptions++;}
      }
      const retained=pos();const c=applied.entityHandles.controlled;
      const controlled=[...e.queryUnifiedPhysicsBodyStates(new Uint32Array([c.entityId,c.entityGeneration])).floats.slice(B.position,B.position+3)];
      return {configured,initial,final,peerInitial,peerFinal:peerPos(),oldRejected,rejectedOptions,retained,controlled,stats:e.dataSceneCombatNavigationStats(),combat:e.dataSceneCombatStats(),scheduler:e.dataSceneCombatNavigationSchedulerStats(),
        playing:e.dataSceneState(),entities:e.entityCount(),frames,steps,vertices,maxRustMs,maxWork,maxSearches};
    } finally {clearTimeout(timer);e.destroy();}
  });
  assert(result.configured);assert.equal(result.playing,"playing");assert.equal(result.entities,5);
  assert(result.oldRejected);assert.equal(result.rejectedOptions,1);assert.deepEqual(result.retained,result.final);
  assert(Math.abs(result.controlled[0]+4)<0.001);
  assert(Math.abs(result.initial[0])<0.001);assert(result.final[0]>3&&Math.hypot(result.final[0]-4,result.final[2])<=1.02,JSON.stringify(result));
  assert.equal(result.combat.aiSteps,result.steps*2);assert.equal(result.stats.agents,2);
  assert(result.scheduler.cacheHits>0&&result.scheduler.cachedRoutes>0,JSON.stringify(result));
  assert(result.peerFinal[0]>result.peerInitial[0]+0.1,JSON.stringify(result));assert(result.stats.searches>0&&result.scheduler.searchSlices>0);
  assert(result.maxWork<=1_000_000&&result.maxSearches<=1&&Number.isFinite(result.maxRustMs));
  assert(result.frames>0&&result.steps>=350&&result.vertices>=30);
  return result;
}
