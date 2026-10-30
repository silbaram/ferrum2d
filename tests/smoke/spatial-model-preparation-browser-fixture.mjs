import { loadSpatialGlb, createEngine, WebGL2Renderer, captureGameStateSnapshot, restoreGameStateSnapshot } from "@ferrum2d/ferrum-web/core";
import { applyDataSceneAuthoringDocument, createSceneInstanceHandleRegistry } from "@ferrum2d/ferrum-web/authoring";

export async function probeSpatialModelPreparation(scene, canvas) {
  const {engine,renderer}=scene,gl=canvas.getContext("webgl2");
  const check=(ok,message,evidence)=>{if(!ok)throw Error(`${message}: ${JSON.stringify(evidence)}`);};
  const wait=async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);};
  const image=()=>{const data=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,data);return data;};
  const differences=(a,b)=>a.reduce((n,v,i)=>n+Number(v!==b[i]),0);
  const snapshot=doc=>JSON.parse(JSON.stringify(captureGameStateSnapshot(engine,{includeDataSceneState:true,includeDataSceneProgress:true,dataSceneAuthoringDocument:doc})));
  const live=()=>window.spatialGpuResources().live;
  const assets=[];
  for(const name of ["rock","tree-material","building"]){
    const asset=await loadSpatialGlb(`/${name}.glb`,{materialProfile:"diffuse"});assets.push(asset);
    check(engine.registerDataSceneSpatialModel(`prepare-${name}`,asset),"prepare fixture registration failed",name);
  }
  const visual={kind:"sprite",texture:1,width:16,height:24,originY:1};
  const object=(id,x,y,actor=false)=>({id,prefab:"object",x,y,props:{components:{visual,
    collider:actor?{type:"aabb",halfWidth:2,halfHeight:2,isTrigger:false}:"none",layer:actor?"player":"wall",
    ...(actor?{body:{type:"kinematic",heightSpan:{floorId:0,elevation:0,height:8}}}:{})}}});
  const baseline={format:"ferrum2d.consumer.scene-authoring",version:1,gameplay:{primaryActor:"actor"},
    sceneComposition:{initialFragment:"lab",prefabs:{object:{}},fragments:{lab:{instances:[object("actor",-48,-16,true),object("rock",0,0)]}}},behaviorRecipes:{entities:{}},
    spatial:{camera:{projection:"orthographic",position:{x:80,y:-200,elevation:260},target:{x:0,y:48,elevation:24},height:Math.max(300,240*canvas.clientHeight/canvas.clientWidth),near:.1,far:1500},
      terrain:[{id:"ground",x:-200,y:-200,width:400,depth:400,elevation:0,color:[.65,.65,.65,1],castShadow:false}],
      billboards:{actor:{castShadow:false}},models:{rock:{asset:"prepare-rock",contentId:assets[0].contentId}},actor:{instanceId:"actor",speed:96},
      environment:{lighting:{ambient:[.4,.4,.4],lights:[],directional:{direction:{x:1,y:-1,elevation:2},intensity:.7}}}}};
  let handles=applyDataSceneAuthoringDocument(engine,baseline,{spatialModelPreparer:renderer}).entityHandles;
  engine.pauseDataScene();await wait();check(gl.getError()===gl.NO_ERROR,"baseline indexed model draw left WebGL error");const savedBefore=snapshot(baseline),before=image(),beforeResources=renderer.resourceStats();
  const target=structuredClone(baseline);target.sceneComposition.fragments.lab.instances=[object("actor",-48,-16,true),object("tree",-64,16),object("house",40,0)];
  target.spatial.models={tree:{asset:"prepare-tree-material",contentId:assets[1].contentId},house:{asset:"prepare-building",contentId:assets[2].contentId}};
  const faults=[];
  const inject=(context,phase)=>{
    const names={texture:"createTexture",buffer:"createBuffer",sampler:"createSampler",upload:"texImage2D"};
    const name=names[phase],original=context[name],at={texture:2,buffer:6,sampler:4,upload:2}[phase];let attempts=0;
    context[name]=function(...args){
      if(++attempts===at){if(phase!=="upload")return null;args[0]=-1;}
      return original.apply(this,args);
    };
    return ()=>{context[name]=original;return attempts;};
  };
  // Exercise caller state independently of the enclosing spatial draw's state guard.
  const oldActive=gl.getParameter(gl.ACTIVE_TEXTURE),oldArray=gl.getParameter(gl.ARRAY_BUFFER_BINDING),oldPbo=gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING),oldVao=gl.getParameter(gl.VERTEX_ARRAY_BINDING);
  gl.activeTexture(gl.TEXTURE0);const oldTexture=gl.getParameter(gl.TEXTURE_BINDING_2D);
  const parameters=[gl.UNPACK_ALIGNMENT,gl.UNPACK_FLIP_Y_WEBGL,gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,gl.UNPACK_ROW_LENGTH,gl.UNPACK_IMAGE_HEIGHT,gl.UNPACK_SKIP_PIXELS,gl.UNPACK_SKIP_ROWS,gl.UNPACK_SKIP_IMAGES],oldUnpack=parameters.map(p=>gl.getParameter(p));
  const callerBuffer=gl.createBuffer(),callerIndex=gl.createBuffer(),callerPbo=gl.createBuffer(),callerTexture=gl.createTexture(),callerVao=gl.createVertexArray();
  check(callerBuffer&&callerIndex&&callerPbo&&callerTexture&&callerVao,"caller resource allocation failed");
  const state=()=>[gl.getParameter(gl.ACTIVE_TEXTURE),gl.getParameter(gl.ARRAY_BUFFER_BINDING),gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING),gl.getParameter(gl.VERTEX_ARRAY_BINDING),gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING),...parameters.map(p=>gl.getParameter(p))];
  try{
    gl.bindVertexArray(callerVao);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,callerIndex);gl.bindBuffer(gl.ARRAY_BUFFER,callerBuffer);
    gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,callerPbo);gl.bufferData(gl.PIXEL_UNPACK_BUFFER,4096,gl.STATIC_DRAW);
    gl.bindTexture(gl.TEXTURE_2D,callerTexture);gl.activeTexture(gl.TEXTURE3);
    parameters.forEach((p,i)=>gl.pixelStorei(p,[8,1,1,16,16,1,1,1][i]));
    const expected=state(),allocated=JSON.stringify(live());
    for(const phase of ["texture","buffer","sampler","upload"]){
      const undo=inject(gl,phase);let rejected=false,attempts;
      try{applyDataSceneAuthoringDocument(engine,target,{spatialModelPreparer:renderer});}
      catch(error){rejected=/Model .*failed/.test(String(error));}
      finally{attempts=undo();}
      check(rejected&&attempts>={texture:2,buffer:6,sampler:4,upload:2}[phase],"GPU fault did not reach and reject preparation",{phase,attempts});
      check(JSON.stringify(live())===allocated,"staged GPU resources leaked or old resources were removed",{phase,live:live(),allocated});
      const actual=state();check(actual.every((v,i)=>v===expected[i]),"cold preparation changed caller GL state",phase);
      gl.activeTexture(gl.TEXTURE0);check(gl.getParameter(gl.TEXTURE_BINDING_2D)===callerTexture,"preparation replaced caller texture");gl.activeTexture(gl.TEXTURE3);
      check(gl.getError()===gl.NO_ERROR,"failed upload left WebGL errors",phase);
      check(engine.gameplayEntityExists(handles.actor)&&engine.dataSceneState()==="paused"&&snapshot(baseline).snapshotHash===savedBefore.snapshotHash,"GPU fault replaced old scene/progress",phase);
      check(differences(before,image())===0,"GPU preparation drew over old framebuffer",phase);
      faults.push({phase,attempts,oldScenePreserved:true,progressPreserved:true,pixelDifferences:0,resourceCountsPreserved:true});
    }
  }finally{
    gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,oldPbo);parameters.forEach((p,i)=>gl.pixelStorei(p,oldUnpack[i]));
    gl.bindVertexArray(oldVao);gl.bindBuffer(gl.ARRAY_BUFFER,oldArray);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,oldTexture);gl.activeTexture(oldActive);
    gl.deleteBuffer(callerBuffer);gl.deleteBuffer(callerIndex);gl.deleteBuffer(callerPbo);gl.deleteTexture(callerTexture);gl.deleteVertexArray(callerVao);
  }
  check(JSON.stringify(renderer.resourceStats())===JSON.stringify(beforeResources),"failed preparation changed renderer resources");
  await wait();check(differences(before,image())===0&&scene.frame.stats.spatial.modelUploadBytes===0,"old scene failed to continue after rejected preparation");
  await window.spatialDebugScreenshot("model-preparation-preserved",canvas.toDataURL());
  const firstFrames=[],uploads=[],render=renderer.renderCommands;
  renderer.renderCommands=function(...args){const stats=render.apply(this,args);if(stats.spatial)firstFrames.push({...stats.spatial});return stats;};
  try{
    handles=applyDataSceneAuthoringDocument(engine,target,{spatialModelPreparer:{prepareSpatialModels:handles=>{const ready=renderer.prepareSpatialModels(handles);uploads.push(ready.uploadBytes);return ready;}}}).entityHandles;
    engine.pauseDataScene();await wait();
  }finally{renderer.renderCommands=render;}
  check(uploads[0]>0&&firstFrames[0]?.modelCount===2&&firstFrames[0].modelDrawCalls===5&&firstFrames[0].modelTriangleCount===110&&firstFrames[0].modelUploadBytes===0,"prepared scene uploaded models on first render",{uploads,first:firstFrames[0]});
  check(differences(before,image())>100,"new prepared models did not change the screen");
  const saved=snapshot(target),preparedImage=image();
  check(saved.dataScene.version===7&&!JSON.stringify(saved).includes("spatialModelPreparer"),"preparer leaked into serialized state");
  // Rock was evicted only after successful activation. A failed restore must retain the new scene.
  const originalTexture=gl.createTexture;gl.createTexture=()=>null;let restoreRejected=false;
  try{restoreGameStateSnapshot(engine,savedBefore,{dataSceneAuthoringApplyOptions:{spatialModelPreparer:renderer}});}
  catch(error){restoreRejected=/allocation failed/.test(String(error));}
  finally{gl.createTexture=originalTexture;}
  check(restoreRejected&&engine.gameplayEntityExists(handles.actor)&&snapshot(target).snapshotHash===saved.snapshotHash,"GPU restore failure replaced current scene");
  check(differences(preparedImage,image())===0,"rejected restore changed framebuffer");
  await window.spatialDebugScreenshot("model-preparation-activated",canvas.toDataURL());
  const registry=createSceneInstanceHandleRegistry();let frame,freshUpload=-1;
  const fresh=await createEngine(next=>{frame=next;},undefined,undefined,()=>renderer.viewportSize());
  try{
    fresh.setViewportSize(renderer.viewportSize().width,renderer.viewportSize().height);
    fresh.registerDataSceneSpatialModel("prepare-tree-material",assets[1]);fresh.registerDataSceneSpatialModel("prepare-building",assets[2]);
    check(restoreGameStateSnapshot(fresh,saved,{dataSceneAuthoringApplyOptions:{instanceHandleRegistry:registry,spatialModelPreparer:{prepareSpatialModels:handles=>{const ready=renderer.prepareSpatialModels(handles);freshUpload=ready.uploadBytes;return ready;}}}}).dataSceneStateApplied,"prepared fresh restore failed");
    fresh.start();await wait();renderer.render();const stats=renderer.renderCommands(frame.renderCommandBuffer);renderer.renderPostProcess();
    check(freshUpload===0&&stats.spatial.modelUploadBytes===0&&differences(preparedImage,image())===0,"fresh native IDs reuploaded prepared resources or changed pixels",{freshUpload,stats:stats.spatial});
  }finally{fresh.destroy();}
  await wait();
  const resourceBaseline=JSON.stringify(live()),pending=renderer.prepareSpatialModels([assets[0]]);
  let overlap=false;try{renderer.prepareSpatialModels([assets[0]]);}catch{overlap=true;}
  pending.dispose();pending.dispose();let stale=false;try{pending.commit();}catch{stale=true;}
  check(overlap&&stale&&JSON.stringify(live())===resourceBaseline,"overlap/cancel preparation leaked resources");
  // Cold geometry shader and buffer allocation failures must also be retryable before any scene draw.
  const coldFailures=[];
  for(const phase of ["shader","pipeline-buffer","instance-storage"]){
    const coldCanvas=document.createElement("canvas"),cold=new WebGL2Renderer(coldCanvas),context=coldCanvas.getContext("webgl2"),baselineLive=JSON.stringify(live());
    const name=phase==="shader"?"createShader":phase==="instance-storage"?"bufferData":"createBuffer",allocate=context[name];let failed=false,storageAttemptBytes;
    context[name]=phase==="instance-storage"?function(...args){
      // Reject the cold dynamic allocation regardless of its reserved capacity.
      if(storageAttemptBytes===undefined&&args[0]===context.ARRAY_BUFFER&&typeof args[1]==="number"&&args[1]>0&&args[2]===context.DYNAMIC_DRAW){storageAttemptBytes=args[1];args[1]=-1;}
      return allocate.apply(this,args);
    }:()=>null;
    try{cold.prepareSpatialModels([assets[0]]);}catch{failed=true;}
    finally{context[name]=allocate;}
    try{
      if(phase==="instance-storage")check(storageAttemptBytes>0,"cold instance allocation fault was not reached",{phase,storageAttemptBytes});
      check(failed,"cold pipeline fault was not rejected",{phase,storageAttemptBytes});
      check(JSON.stringify(live())===baselineLive,"cold pipeline failure leaked resources",phase);
      const retry=cold.prepareSpatialModels([assets[0]]);retry.commit();retry.dispose();
      const staged=cold.prepareSpatialModels([assets[1]]);cold.destroy();let rejected=false;try{staged.commit();}catch{rejected=true;}staged.dispose();
      check(rejected,"destroyed renderer accepted stale preparation");coldFailures.push({phase,storageAttemptBytes,retry:true,staleRejected:true});
    }finally{cold.destroy();context.getExtension("WEBGL_lose_context")?.loseContext();}
  }
  const allocated=renderer.resourceStats(),empty=structuredClone(target);empty.spatial.models={};empty.sceneComposition.fragments.lab.instances.splice(1);
  applyDataSceneAuthoringDocument(engine,empty);engine.pauseDataScene();await wait();const released=renderer.resourceStats();
  check(released.bufferCount===allocated.bufferCount-10&&released.textureCount===allocated.textureCount-3,"prepared model GPU resources leaked",{allocated,released});
  for(const name of ["rock","tree-material","building"])check(engine.releaseDataSceneSpatialModel(`prepare-${name}`),"prepared CPU resource release failed",name);
  check(gl.getError()===gl.NO_ERROR,"preparation probe left WebGL errors");
  return {faults,coldFailures,firstFrame:firstFrames[0],preparedUploadBytes:uploads[0],freshUploadBytes:freshUpload,restoreRejected,freshRestore:true,pixelDifferences:0,overlapRejected:overlap,staleRejected:stale,resourceRelease:true};
}
