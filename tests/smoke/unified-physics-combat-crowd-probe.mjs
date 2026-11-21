import assert from "node:assert/strict";

export async function probeUnifiedCombatCrowd(page) {
  const result = await page.evaluate(async () => {
    const { createEngine, UNIFIED_PHYSICS_STATE_LAYOUT: B } = await import("@ferrum2d/ferrum-web/core");
    const { applyDataSceneAuthoringDocument } = await import("@ferrum2d/ferrum-web/authoring");
    let elapsed=0,frames=0,steps=0,vertices=0,maxWork=0,maxSearches=0,steered=0,minSeparation=Infinity,minHeight=Infinity,maxDeviation=0;
    let ids,finish,timer;
    const positions = () => {
      const view=e.queryUnifiedPhysicsBodyStates(ids);
      return [0,1].map(row=>Array.from(view.floats.slice(row*B.stride+B.position,row*B.stride+B.position+3)));
    };
    const e=await createEngine(frame=>{
      elapsed+=frame.physics.fixedConsumedSeconds;frames++;steps+=frame.unifiedPhysics?.frame.backendSteps??0;
      const spatial=frame.renderCommandBuffer.spatial;
      if(spatial)vertices=Math.max(vertices,spatial.billboards.length/spatial.vertexStride);
      const navigation=e.dataSceneCombatNavigationStats(),crowd=e.dataSceneCombatCrowdStats();
      maxWork=Math.max(maxWork,navigation.frameWorkUnits);maxSearches=Math.max(maxSearches,navigation.frameSearches);
      steered+=crowd.frameAvoidanceMoves;
      const [a,b]=positions();
      minSeparation=Math.min(minSeparation,Math.hypot(a[0]-b[0],a[2]-b[2]));
      minHeight=Math.min(minHeight,a[1]);maxDeviation=Math.max(maxDeviation,Math.abs(a[2]));
      if(elapsed>=3.5){e.pause();finish();}
    },undefined,undefined,()=>({width:320,height:180}));
    const body={kind:"kinematic-position",elevation:1,renderOffset:[100,0,0],collider:{shape:{type:"capsule",halfHeight:0.5,radius:0.25}},character:{}};
    const object=(id,x,layer,shape,recipe)=>({id,prefab:"object",x,y:0,props:{behaviorRecipes:recipe?[recipe]:[],components:{
      visual:{kind:"primitive",shape:"circle",radius:0.25},collider:"none",layer,body:shape,
    }}});
    const doc={format:"ferrum2d.consumer.scene-authoring",version:1,
      physics:{space:"spatial",gravity:[0,-10,0],stepSeconds:0.01,lengthUnit:1},
      gameplay:{primaryActor:"player",combat:true,combatNavigation:{cellSize:0.5,maxStepHeight:0.3,maxDropHeight:0.2,
        repathIntervalSeconds:0.1,arrivalRadius:0.5,maxAgents:2,crowdAvoidance:{padding:0.1}}},
      sceneComposition:{initialFragment:"main",prefabs:{object:{}},fragments:{main:{instances:[
        object("player",4,"player",{kind:"fixed",elevation:1,collider:{shape:{type:"sphere",radius:0.25},sensor:true}}),
        object("enemy",100,"enemy",body,"moving"),object("peer",101.5,"enemy",body,"resting"),
      ]}}},behaviorRecipes:{entities:{
        moving:{recipes:[{kind:"chase",target:"primaryActor",speed:2,stopDistance:1}]},
        resting:{recipes:[{kind:"chase",target:"primaryActor",speed:2,stopDistance:2.6}]},
      }},
      spatial:{camera:{projection:"orthographic",position:{x:0,y:-100,elevation:100},target:{x:0,y:0,elevation:10},height:300},
        terrain:[{id:"floor",x:-10,y:-10,width:30,depth:20,elevation:0,baseElevation:-1}],billboards:{player:{},enemy:{},peer:{}}},
    };
    try {
      const applied=applyDataSceneAuthoringDocument(e,doc,{textureId:()=>11});
      const a=applied.entityHandles.enemy,b=applied.entityHandles.peer;
      ids=new Uint32Array([a.entityId,a.entityGeneration,b.entityId,b.entityGeneration]);
      for(let i=0;i<120;i++)e.stepRigidBodies(Math.fround(0.01));
      const initial=positions();
      if(!e.supportsDataSceneNativeCombatCrowd())throw new Error("Native capsule crowd capability is missing");
      const beforeSearches=e.dataSceneCombatNavigationStats().searches;
      const done=new Promise((resolve,reject)=>{finish=resolve;timer=setTimeout(()=>reject(new Error("Native crowd RAF timed out")),45000);});
      e.start();await done;e.pause();
      const final=positions();let oldRejected=false;
      const old=new Proxy(e,{get(target,key){return key==="supportsDataSceneNativeCombatCrowd"?()=>false:Reflect.get(target,key);}});
      try{applyDataSceneAuthoringDocument(old,doc,{textureId:()=>11});}catch(error){oldRejected=/native capsule crowd Wasm/.test(String(error));}
      return {initial,final,retained:positions(),oldRejected,beforeSearches,playing:e.dataSceneState(),entities:e.entityCount(),
        stats:e.dataSceneCombatNavigationStats(),crowd:e.dataSceneCombatCrowdStats(),combat:e.dataSceneCombatStats(),
        frames,steps,vertices,maxWork,maxSearches,steered,minSeparation,minHeight,maxDeviation};
    } finally {clearTimeout(timer);e.destroy();}
  });
  assert(result.oldRejected);assert.deepEqual(result.retained,result.final);
  assert.equal(result.beforeSearches,0);assert.equal(result.playing,"playing");assert.equal(result.entities,3);
  assert.equal(result.stats.agents,2);assert.equal(result.combat.aiSteps,result.steps*2);
  const [a,b]=result.final;
  assert(a[0]>3&&Math.hypot(a[0]-4,a[2])<=1.02,JSON.stringify(result));
  assert(Math.abs(b[0]-1.5)<0.001&&Math.abs(b[2])<0.001,JSON.stringify(result));
  assert(result.maxDeviation>0.3&&result.minSeparation>=0.49&&result.minHeight>0.74,JSON.stringify(result));
  assert(result.crowd.enabled&&result.crowd.neighborTests>0&&result.steered>0,JSON.stringify(result));
  assert(result.maxWork<=1_000_000&&result.maxSearches<=1);
  assert(result.frames>0&&result.steps>=350&&result.vertices>=18);
  return result;
}
