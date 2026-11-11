import { createEngine, createRenderer, captureGameStateSnapshot, restoreGameStateSnapshot, GAME_STATE_CODE } from "@ferrum2d/ferrum-web/core";
import { applyDataSceneAuthoringDocument } from "@ferrum2d/ferrum-web/authoring";
import { check, pixels, difference, png } from "/fixture.mjs";
import { ownedSpatial } from "/environment.mjs";
import { HEIGHT_FOG_CASES, HEIGHT_FOG_TERRAIN, heightFogCamera } from "/height-fog-cases.mjs";

async function probe(backend,projection,colorManagement){
 const canvas=document.createElement("canvas");canvas.style.width="min(640px,100vw)";canvas.style.height="min(480px,100vh)";
 if(backend==="webgpu")canvas.dataset.spatialGpuTarget="true";document.body.replaceChildren(canvas);
 const errors=[],fallback=[],rows=[],images=[],engines=[];
 const renderer=await createRenderer(canvas,{preferred:backend,colorManagement,fallbackBehavior:"silent",onFallback:i=>fallback.push(i.reason),webgl2:{preserveDrawingBuffer:true}});
 check((typeof renderer.gpuDevice==="function")===(backend==="webgpu")&&!fallback.length,"Height fog renderer fallback",fallback);
 let device=renderer.gpuDevice?.();const listen=()=>device?.addEventListener("uncapturederror",e=>errors.push(e.error.message));listen();
 const oldRAF=window.requestAnimationFrame,oldCancel=window.cancelAnimationFrame,pending=new Map();let serial=1,clock=0,packet,frame,engine,nativeTerrain;
 window.requestAnimationFrame=cb=>{const id=serial++;pending.set(id,cb);return id;};window.cancelAnimationFrame=id=>pending.delete(id);
 const step=()=>{clock+=17;const callbacks=[...pending.values()];pending.clear();for(const cb of callbacks)cb(clock);};
 try{
  const makeEngine=async()=>{
   const e=await createEngine(state=>{frame=state;const previous=packet?.spatial,source=state.renderCommandBuffer.spatial;
    packet={...state.renderCommandBuffer,buffer:state.renderCommandBuffer.buffer.slice(),spatial:source&&ownedSpatial(source)};
    if(previous&&source&&nativeTerrain?.memory===source.terrain.buffer&&nativeTerrain.offset===source.terrain.byteOffset&&nativeTerrain.length===source.terrain.length&&nativeTerrain.revision===source.terrainRevision)packet.spatial.terrain=previous.terrain;
    nativeTerrain=source&&{memory:source.terrain.buffer,offset:source.terrain.byteOffset,length:source.terrain.length,revision:source.terrainRevision};
   },undefined,undefined,()=>renderer.viewportSize());e.configureFixedTimestep(false);engines.push(e);return e;
  };
  const doc={format:"ferrum2d.consumer.scene-authoring",version:1,sceneComposition:{initialFragment:"lab",prefabs:{body:{}},fragments:{lab:{instances:[{id:"body",prefab:"body",x:0,y:0,props:{components:{visual:{kind:"sprite",texture:0,width:1,height:1,color:"#ffffff00"},collider:"none",layer:"wall"}}}]}}},behaviorRecipes:{entities:{}},
   spatial:{camera:heightFogCamera(projection),terrain:HEIGHT_FOG_TERRAIN,billboards:{},environment:{composition:"separated"}}};
  engine=await makeEngine();applyDataSceneAuthoringDocument(engine,doc,{colorManagement});engine.start();step();step();
  const draw=async()=>{check(frame.gameState===GAME_STATE_CODE.playing&&frame.entityCount===1,"Height fog live state");renderer.render();const stats={...renderer.renderCommands(packet).spatial};renderer.renderPostProcess();
   check(stats.terrainTriangleCount>0&&!errors.length,"Height fog geometry/GPU validation",{stats,errors});return{data:await pixels(renderer,canvas),stats,resources:renderer.resourceStats()};};
  const row=async(name,environment,direction="down")=>{
   window.heightFogState={backend,projection,colorManagement,name};
   if(name.endsWith("-plain")||name==="recovered")console.debug("environment state height fog",backend,projection,colorManagement,name);
   if(environment!==undefined){check(engine.setDataSceneSpatialEnvironment(environment),"Height fog environment rejected",name);check(engine.setDataSceneSpatialCamera(heightFogCamera(projection,direction),renderer.viewportSize()),"Height fog camera rejected");step();}
   const first=await draw(),warm=await draw();
   if(name.startsWith("lit-"))check(first.stats.shadowPassCount===(name==="lit-plain"?13:0),"Height fog invalidated existing PCSS maps",{name,stats:first.stats});
   check(difference(first.data,warm.data)===0,"Height fog warm pixels changed",name);
   check(warm.stats.shadowPassCount===0&&warm.stats.shadowUploadBytes===0,"Height fog warm shadow budget",name);
   rows.push({name,width:canvas.width,height:canvas.height,stats:first.stats,warm:warm.stats,resources:warm.resources,camera:Array.from(packet.spatial.camera),presentation:Array.from(packet.spatial.presentation??[0,0,1,1,0,0]),environmentVersion:packet.spatial.environment?.version,image:png(warm.data,canvas.width,canvas.height)});images.push(warm.data);
  };
  for(const c of HEIGHT_FOG_CASES)await row(c.name,c.environment,c.direction);
  const savedEnvironment=HEIGHT_FOG_CASES.find(c=>c.name==="ao-default").environment;
  await row("saved",savedEnvironment);
  // Authored document has no height fog: only the live progress carries v16.
  const saved=JSON.parse(JSON.stringify(captureGameStateSnapshot(engine,{includeDataSceneState:true,includeDataSceneProgress:true,dataSceneAuthoringDocument:doc})));
  check(saved.dataScene.version===16,"Height fog state16 capture");engine.stop();engine=await makeEngine();
  check(restoreGameStateSnapshot(engine,saved,{dataSceneAuthoringApplyOptions:{colorManagement}}).dataSceneStateApplied,"Height fog fresh restore");engine.start();step();step();await row("fresh-restore");
  await row("off",HEIGHT_FOG_CASES.find(c=>c.name==="ao-plain").environment);await row("re-enabled",savedEnvironment);
  if(backend==="webgpu"){const old=renderer.gpuDevice();old.destroy();await old.lost;await Promise.resolve();await renderer.recoverDevice();device=renderer.gpuDevice();listen();await row("recovered");}
  renderer.destroy();const released=renderer.resourceStats();check(released.textureCount===0&&released.bufferCount===0,"Height fog resource leak",released);
  return{backend,projection,colorManagement,rows,images,errors,snapshotVersion:saved.dataScene.version,released};
 }finally{for(const e of engines)e.destroy();renderer.destroy();device?.destroy();window.disposeSpatialGpuTarget?.(canvas);window.requestAnimationFrame=oldRAF;window.cancelAnimationFrame=oldCancel;}
}
export async function probeSpatialHeightFog(colorManagement){
 const result=[];
 for(const projection of ["orthographic","perspective"]){
  const backends=[];for(const backend of ["webgl2","webgpu"])backends.push(await probe(backend,projection,colorManagement));
  const comparisons=backends[0].rows.map((row,i)=>{const j=backends[1].rows.findIndex(r=>r.name===row.name);check(j>=0,"Missing height fog parity row");const differentPixels=difference(backends[0].images[i],backends[1].images[j],3),pixelCount=backends[0].images[i].length/4;
   check(differentPixels<=pixelCount*.015,"Height fog backend parity",{name:row.name,differentPixels,pixelCount});return{name:row.name,differentPixels,pixelCount};});
  for(const b of backends)delete b.images;result.push({projection,backends,comparisons});
 }return result;
}
