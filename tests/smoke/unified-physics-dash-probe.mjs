import assert from "node:assert/strict";
export async function probeUnifiedDash(page) {
  const results = await page.evaluate(async () => {
    const { createEngine, UNIFIED_PHYSICS_STATE_LAYOUT: B, UNIFIED_PHYSICS_CHARACTER_LAYOUT: C } = await import("@ferrum2d/ferrum-web/core");
    const { applyDataSceneAuthoringDocument } = await import("@ferrum2d/ferrum-web/authoring");
    const results = [];
    for (const mode of ["planar-xy", "spatial", "character"]) {
      const character = mode === "character", spatial = mode !== "planar-xy";
      const input = { w:false,a:false,s:false,d:true,space:false,enter:false,mouseLeft:false,mouseX:0,mouseY:0 };
      let elapsed=0,consumed=0,duration=0,finish,timer,frames=0,steps=0,maxRustMs=0,vertices=0;
      const events=[];
      const e=await createEngine(frame=>{
        frames++;steps+=frame.unifiedPhysics?.frame.backendSteps??0;
        elapsed+=frame.physics.fixedConsumedSeconds;consumed+=frame.physics.fixedConsumedSeconds;
        maxRustMs=Math.max(maxRustMs,frame.rustUpdateTimeMs);
        const p=frame.renderCommandBuffer.spatial;if(p)vertices=Math.max(vertices,p.billboards.length/p.vertexStride);
        events.push(...frame.gameplayEvents.map(event=>({...event})));
        if(elapsed>=duration){e.pause();finish();}
      },()=>input,undefined,()=>({width:320,height:180}));
      const run=async(seconds,start=false)=>{
        elapsed=0;duration=seconds;
        const done=new Promise((resolve,reject)=>{finish=resolve;timer=setTimeout(()=>reject(new Error("Native dash RAF timed out")),45000);});
        try{if(start)e.start();else e.resume();await done;}finally{clearTimeout(timer);e.pause();}
      };
      const instance=(id,x,layer,body,recipe)=>({id,prefab:"object",x,y:spatial?0:1,props:{behaviorRecipes:recipe?[recipe]:[],components:{
        visual:{kind:"primitive",shape:"circle",radius:0.25},collider:"none",layer,body,
      }}});
      const doc={format:"ferrum2d.consumer.scene-authoring",version:1,
        physics:{space:spatial?"spatial":"planar-xy",gravity:[0,character?-10:0,0],lengthUnit:1,stepSeconds:0.01},
        gameplay:{primaryActor:"actor",combat:true},ids:{actions:{dash:77,counter:78},timers:{counter:9}},
        sceneComposition:{initialFragment:"main",prefabs:{object:{}},fragments:{main:{instances:[
          instance("actor",100,"player",{kind:character?"kinematic-position":"kinematic-velocity",elevation:spatial?1:0,renderOffset:[100,0,0],
            collider:{shape:character?{type:"capsule",halfHeight:0.5,radius:0.25}:{type:"sphere",radius:0.25},sensor:!character},...(character?{character:{}}:{})},"actor"),
          instance("enemy",96,"enemy",{kind:"kinematic-velocity",elevation:spatial?1:0,renderOffset:[100,0,0],collider:{shape:{type:"sphere",radius:0.25},sensor:true}},"enemy"),
          instance("wall",2,"wall",{kind:"fixed",elevation:spatial?1:0,collider:{shape:{type:"box",halfExtents:[0.1,1,1]}}}),
        ]}}},behaviorRecipes:{entities:{
          actor:{recipes:[{kind:"dashAction",action:"dash",distance:4,cooldownSeconds:1}]},
          enemy:{recipes:[{kind:"dashAction",action:"counter",aim:"targetPlayer",distance:2,cooldownSeconds:1},{kind:"timerTrigger",timer:"counter",action:"counter",seconds:1}]},
        }},
        ...(spatial?{spatial:{camera:{projection:"orthographic",position:{x:0,y:-100,elevation:100},target:{x:0,y:0,elevation:10},height:300},
          terrain:[{id:"floor",x:-10,y:-10,width:20,depth:20,elevation:0,baseElevation:-1,kind:"flat",color:[0.3,0.45,0.35,1]}],billboards:{actor:{},enemy:{},wall:{}}}}:{}),
      };
      try{
        const applied=applyDataSceneAuthoringDocument(e,doc,{textureId:()=>11});const a=applied.entityHandles.actor,b=applied.entityHandles.enemy;
        const ids=new Uint32Array([a.entityId,a.entityGeneration]);
        const position=()=>[...e.queryUnifiedPhysicsBodyStates(ids).floats.slice(B.position,B.position+3)];
        if(character)for(let i=0;i<120;i++)e.stepRigidBodies(Math.fround(0.01));
        const initial=position();
        if(character)e.setUnifiedPhysicsCharacterInputs(ids,new Float32Array([0,0,0,4]));
        if(!e.setInputActionBinding(77,0,{control:"mouseLeft",activation:"pressed"}))throw new Error("Dash binding rejected");
        input.mouseLeft=true;await run(0.03,true);const dashed=position(),first=e.gameplayEntityDiagnostics(a);
        const jumped=character?e.queryUnifiedPhysicsCharacterStates(ids).floats[C.verticalSpeed]:null;
        input.mouseLeft=false;await run(0.03);input.mouseLeft=true;await run(0.03);const cooldown=position();
        input.mouseLeft=false;await run(Math.max(0.01,1.05-consumed));
        const enemyIds=new Uint32Array([b.entityId,b.entityGeneration]);const enemy=[...e.queryUnifiedPhysicsBodyStates(enemyIds).floats.slice(B.position,B.position+3)];
        results.push({mode,initial,dashed,first,jumped,cooldown,enemy,events,playing:e.dataSceneState(),entities:e.entityCount(),frames,steps,maxRustMs,vertices});
      }finally{clearTimeout(timer);e.destroy();}
    }
    return results;
  });
  for(const r of results){
    assert.equal(r.playing,"playing");assert.equal(r.entities,3);assert(r.frames>0&&r.steps>=105&&Number.isFinite(r.maxRustMs));
    assert(r.dashed[0]>1.6&&r.dashed[0]<1.76,JSON.stringify(r));assert(r.first.actions.find(a=>a.id===77).remainingSeconds>0.8);
    assert(Math.abs(r.cooldown[0]-r.dashed[0])<0.003,JSON.stringify(r));assert(Math.abs(r.enemy[0]+2)<0.003,JSON.stringify(r));
    assert(!r.events.some(e=>e.kind==="actionFailed"),JSON.stringify(r));
    if(r.mode!=="planar-xy")assert(r.vertices>=18,JSON.stringify(r));
    if(r.mode==="character")assert(r.jumped>2.8&&r.dashed[1]>r.initial[1]+0.05,JSON.stringify(r));
  }
  return results;
}
