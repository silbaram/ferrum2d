import {loadSpatialGlb,createEngine,captureGameStateSnapshot,restoreGameStateSnapshot,WebGL2Renderer} from '@ferrum2d/ferrum-web/core';
import {materialVariant} from '/spatial-model-tree-probe.mjs';
import {addSpatialModelAssembly,applyDataSceneAuthoringDocument,createSceneInstanceHandleRegistry} from '@ferrum2d/ferrum-web/authoring';

export async function probeSpatialModelMotionStreaming(scene,canvas){
  const {engine,renderer}=scene,gl=canvas.getContext('webgl2');
  const check=(ok,message,evidence)=>{if(!ok)throw Error(`${message}: ${JSON.stringify(evidence)}`);};
  const wait=async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);};
  const near=await loadSpatialGlb('/building.glb',{materialProfile:'diffuse'}),far=await loadSpatialGlb('/rock.glb',{materialProfile:'diffuse'});
  for(const[id,asset]of [['motion-near',near],['motion-far',far]])check(engine.registerDataSceneSpatialModel(id,asset),'model registration failed',id);
  const base={format:'ferrum2d.consumer.scene-authoring',version:1,sceneComposition:{prefabs:{}},behaviorRecipes:{entities:{}},spatial:{camera:{projection:'orthographic',position:{x:0,y:-100,elevation:100},target:{x:0,y:0,elevation:0},height:400,far:4000},terrain:[{id:'ground',x:-1000,y:-1000,width:2000,depth:2000,elevation:0}],billboards:{}}};
  const source=await(await fetch('/tree-material.glb')).arrayBuffer();
  const batched=await loadSpatialGlb(materialVariant(source,(_m,j)=>{j.meshes[1].primitives=Array.from({length:64},()=>structuredClone(j.meshes[1].primitives[0]));}),{materialProfile:'diffuse'});
  check(batched.primitiveCount===2&&batched.diagnostics.some(d=>d.includes('material batches')),'large MASK material did not merge',batched);
  check(engine.registerDataSceneSpatialModel('batch-mask',batched),'large model registration failed');
  const batchDoc=addSpatialModelAssembly(base,{id:'batch',x:0,y:0,model:{asset:'batch-mask',contentId:batched.contentId}});
  applyDataSceneAuthoringDocument(engine,batchDoc,{spatialModelPreparer:renderer});engine.pauseDataScene();await wait();
  const batchStats={...scene.frame.stats.spatial};
  check(batchStats.modelDrawCalls===2&&batchStats.modelTriangleCount===batched.triangleCount&&batchStats.modelUploadBytes===0,'large material batch GPU submission wrong',batchStats);
  const doc=addSpatialModelAssembly(base,{id:'root',x:0,y:0,motion:'kinematic',model:{asset:'motion-near',contentId:near.contentId},colliders:[{id:'wall',x:20,y:0,halfWidth:4,halfDepth:20,elevation:0,height:64}],children:[{id:'child',x:40,y:0,model:{asset:'motion-far',contentId:far.contentId}}]});
  const handles=applyDataSceneAuthoringDocument(engine,doc,{spatialModelPreparer:renderer}).entityHandles;
  engine.pauseDataScene();await wait();
  check(engine.setPhysicsBodyPosition(handles.root,100,150)&&engine.setPhysicsBodyRotation(handles.root,Math.PI/4)&&engine.setPhysicsBodyHeightSpan(handles.root,{floorId:2,elevation:16,height:1}),'root motion rejected');
  await wait();
  const child=engine.getPhysicsEntity(handles['root/children/child']),proxy=engine.getPhysicsEntity(handles['root/colliders/wall']);
  const close=(a,b)=>Math.abs(a-b)<.001;
  check(close(child.x,100+40/Math.sqrt(2))&&close(child.y,150+40/Math.sqrt(2))&&child.heightSpan.floorId===2&&child.heightSpan.elevation===16,'child pose did not follow native root',child);
  check(close(proxy.x,100+20/Math.sqrt(2))&&close(proxy.y,150+20/Math.sqrt(2))&&proxy.heightSpan.floorId===2,'collider pose did not follow root',proxy);
  check(!engine.setPhysicsBodyPosition(handles['root/colliders/wall'],0,0),'derived collider accepted direct relocation');
  const saved=JSON.parse(JSON.stringify(captureGameStateSnapshot(engine,{includeDataSceneState:true,includeDataSceneProgress:true,dataSceneAuthoringDocument:doc})));
  check(saved.dataScene.version===8,'moving hierarchy save did not use version8',saved.dataScene);
  const before=scene.frame.spatial.models.values.slice(),registry=createSceneInstanceHandleRegistry();let freshFrame;
  const fresh=await createEngine(frame=>{freshFrame=frame;},undefined,undefined,()=>renderer.viewportSize());
  try{
    for(const[id,asset]of [['motion-near',near],['motion-far',far]])check(fresh.registerDataSceneSpatialModel(id,asset),'fresh model registration failed');
    fresh.setViewportSize(renderer.viewportSize().width,renderer.viewportSize().height);
    check(restoreGameStateSnapshot(fresh,saved,{dataSceneAuthoringApplyOptions:{instanceHandleRegistry:registry,spatialModelPreparer:renderer}}).dataSceneStateApplied,'moving hierarchy restore failed');
    fresh.start();await wait();
    const after=freshFrame.renderCommandBuffer.spatial.models.values;
    check(before.length===after.length&&before.every((v,i)=>v===after[i]),'fresh hierarchy matrices changed',{before:[...before],after:[...after]});
  }finally{fresh.destroy();}
  // Separate static visual policy: physics continues to exist when GPU residency is released.
  const chunkBase=structuredClone(base);chunkBase.spatial.modelChunks={village:{min:{x:-50,y:-50,elevation:0},max:{x:50,y:50,elevation:120},loadDistance:500,unloadDistance:650}};
  const streamed=addSpatialModelAssembly(chunkBase,{id:'chunk-model',x:0,y:0,model:{asset:'motion-near',contentId:near.contentId,chunk:'village',lods:[{asset:'motion-far',contentId:far.contentId,minDistance:300}]},colliders:[{id:'wall',x:0,y:0,halfWidth:4,halfDepth:4,elevation:0,height:8}]});
  streamed.spatial.modelChunks={village:{min:{x:-50,y:-50,elevation:0},max:{x:50,y:50,elevation:120},loadDistance:500,unloadDistance:650}};
  const streamHandles=applyDataSceneAuthoringDocument(engine,streamed,{spatialModelPreparer:renderer}).entityHandles;engine.pauseDataScene();await wait();
  const samples=[];
  const moveCamera=async x=>{const camera=structuredClone(streamed.spatial.camera);camera.position.x=x;check(engine.setDataSceneSpatialCamera(camera,renderer.viewportSize()),'stream camera rejected');await wait();const frame=scene.frame.spatial.models;const entries=[];for(let i=0;i<(frame?.words.length??0);i+=20)entries.push({asset:frame.assets.get(frame.words[i]).contentId,mask:frame.words[i+2]});const result={x,entries,stats:{...scene.frame.stats.spatial},resources:renderer.resourceStats()};samples.push(result);return result;};
  const nearSample=await moveCamera(0);check(nearSample.entries[0]?.asset===near.contentId,'near LOD not selected',nearSample);
  const farSample=await moveCamera(400);check(farSample.entries[0]?.asset===far.contentId,'far LOD not selected',farSample);
  const steady=await moveCamera(400);check(steady.stats.modelUploadBytes===0,'stable LOD reuploaded',steady);
  const unloaded=await moveCamera(800);check(unloaded.entries.length===0&&engine.gameplayEntityExists(streamHandles['chunk-model/colliders/wall']),'unloaded visual removed physics or retained draws',unloaded);
  check(unloaded.resources.bufferCount<farSample.resources.bufferCount,'chunk GPU buffers retained',samples);
  const outside=await moveCamera(600);check(outside.entries.length===0,'chunk unload hysteresis ignored',outside);
  const reloaded=await moveCamera(400);check(reloaded.entries[0]?.asset===far.contentId,'chunk did not reload',reloaded);
  for(let i=0;i<3;i++){await moveCamera(0);await moveCamera(400);await moveCamera(800);await moveCamera(400);}
  check(samples.at(-1).resources.bufferCount===farSample.resources.bufferCount&&samples.at(-1).resources.textureCount===farSample.resources.textureCount,'chunk round trip leaked resources',samples);
  check(!engine.releaseDataSceneSpatialModel('motion-near')&&!engine.releaseDataSceneSpatialModel('motion-far'),'active LOD source was released');
  const timingCanvas=document.createElement('canvas');timingCanvas.width=320;timingCanvas.height=180;
  const timed=new WebGL2Renderer(timingCanvas,{gpuTiming:true});const timings=[];
  try{for(let i=0;i<12;i++){timed.beginGpuTiming();timed.render();timed.renderCommands(scene.frame.state.renderCommandBuffer);timed.renderPostProcess();timed.endGpuTiming();await new Promise(requestAnimationFrame);timings.push(timed.gpuTimingStats());}
    check(timings.some(s=>s.status==='ready'||s.status==='unsupported'||s.status==='disjoint'),'GPU timer did not report readiness/support status',timings);
  }finally{timed.destroy();}
  applyDataSceneAuthoringDocument(engine,base);engine.pauseDataScene();await wait();
  for(const id of ['motion-near','motion-far','batch-mask'])check(engine.releaseDataSceneSpatialModel(id),'model resource release failed',id);
  check(gl.getError()===gl.NO_ERROR,'motion/streaming WebGL error');
  return {child,proxy,batchStats,samples,timings,freshRestore:true,resourceRelease:true};
}
