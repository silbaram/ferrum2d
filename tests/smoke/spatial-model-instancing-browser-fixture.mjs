import { loadSpatialGlb, createEngine, captureGameStateSnapshot, restoreGameStateSnapshot } from "@ferrum2d/ferrum-web/core";
import { applyDataSceneAuthoringDocument } from "@ferrum2d/ferrum-web/authoring";

export async function probeSpatialModelInstancing(scene, canvas) {
  const {engine,renderer}=scene,gl=canvas.getContext("webgl2");
  const check=(ok,message,evidence)=>{if(!ok)throw Error(`${message}: ${JSON.stringify(evidence)}`);};
  const wait=async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);};
  const image=()=>{const p=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
  const difference=(a,b)=>a.reduce((n,v,i)=>n+Number(Math.abs(v-b[i])>3),0);
  const marker={visual:{kind:"sprite",texture:0,width:1,height:1,color:"#ffffff00"},collider:"none",layer:"wall"};
  const rock=await loadSpatialGlb("/rock.glb",{materialProfile:"diffuse"});
  check(engine.registerDataSceneSpatialModel("instanced-rock",rock),"instancing asset registration failed");
  const make=(count)=>({format:"ferrum2d.consumer.scene-authoring",version:1,
    sceneComposition:{initialFragment:"forest",prefabs:{object:{}},fragments:{forest:{instances:Array.from({length:count},(_,i)=>({id:`rock-${i}`,prefab:"object",x:(i%32-15.5)*8,y:(Math.floor(i/32)-15.5)*8,props:{components:marker}}))}}},behaviorRecipes:{entities:{}},
    spatial:{camera:{projection:"orthographic",position:{x:0,y:-300,elevation:500},target:{x:0,y:0,elevation:0},height:Math.max(400,400*canvas.clientHeight/canvas.clientWidth),near:.1,far:3000},terrain:[],billboards:{},
      models:Object.fromEntries(Array.from({length:count},(_,i)=>[`rock-${i}`,{asset:"instanced-rock",contentId:rock.contentId,scale:.18,castShadow:false}]))}});
  const cases=[];let document,handles,sharedResources,sharedLive;
  for(const count of [100,500,1000]) {
    document=make(count);
    handles=applyDataSceneAuthoringDocument(engine,document,{spatialModelPreparer:renderer}).entityHandles;
    engine.pauseDataScene();await wait();
    const stats={...scene.frame.stats.spatial},resources=renderer.resourceStats();
    check(engine.dataSceneState()==="paused"&&Object.keys(handles).length===count&&scene.frame.spatial.models.words.length===count*20,"native instance state/scale mismatch",{count,stats});
    check(stats.modelCount===count&&stats.visibleModelCount===count&&stats.modelDrawCalls===rock.primitiveCount&&stats.modelInstancedDrawCalls===rock.primitiveCount&&stats.modelTriangleCount===count*rock.triangleCount,"shared models were not instanced",{count,stats});
    check(stats.modelUploadBytes===0&&stats.modelInstanceUploadBytes===count*64&&gl.getError()===gl.NO_ERROR,"warm instance upload/state mismatch",{count,stats});
    if(sharedResources)check(resources.bufferCount===sharedResources.bufferCount&&resources.textureCount===sharedResources.textureCount&&resources.bufferBytes===sharedResources.bufferBytes,"shared model GPU allocation grew with instance count",{count,resources,sharedResources});
    const live=JSON.stringify(window.spatialGpuResources().live);
    if(sharedLive)check(live===sharedLive,"GPU object count grew with instance count",{count,live,sharedLive});
    sharedLive=live;
    const actualDraws=[],actualUploads=[],drawInstanced=gl.drawElementsInstanced,upload=gl.bufferSubData,getAttribute=gl.getVertexAttrib;
    const saved2=getAttribute.call(gl,2,gl.CURRENT_VERTEX_ATTRIB),saved3=getAttribute.call(gl,3,gl.CURRENT_VERTEX_ATTRIB);
    const caller2=Float32Array.from([.125,.25,.5,.75]),caller3=Float32Array.from([.25,.5,.75,1]);
    gl.vertexAttrib4fv(2,caller2);gl.vertexAttrib4fv(3,caller3);
    let attributeReads=0,genericPreserved=false;
    gl.getVertexAttrib=function(...args){attributeReads++;return getAttribute.apply(this,args);};
    gl.drawElementsInstanced=function(...args){actualDraws.push({indices:args[1],instances:args[4]});return drawInstanced.apply(this,args);};
    gl.bufferSubData=function(...args){if(args[0]===gl.ARRAY_BUFFER)actualUploads.push({offset:args[1],bytes:args[2].byteLength});return upload.apply(this,args);};
    try{
      renderer.render();renderer.renderCommands(scene.frame.state.renderCommandBuffer);renderer.renderPostProcess();
      genericPreserved=[...getAttribute.call(gl,2,gl.CURRENT_VERTEX_ATTRIB)].every((v,i)=>v===caller2[i])&&[...getAttribute.call(gl,3,gl.CURRENT_VERTEX_ATTRIB)].every((v,i)=>v===caller3[i]);
    }finally{gl.drawElementsInstanced=drawInstanced;gl.bufferSubData=upload;gl.getVertexAttrib=getAttribute;gl.vertexAttrib4fv(2,saved2);gl.vertexAttrib4fv(3,saved3);}
    check(attributeReads===0&&genericPreserved,"model rendering queried or changed caller generic attributes",{attributeReads,genericPreserved});
    check(actualDraws.length===1&&actualDraws[0].instances===count&&actualDraws[0].indices===rock.triangleCount*3&&actualUploads.length===1&&actualUploads[0].offset===0&&actualUploads.reduce((n,v)=>n+v.bytes,0)===count*64,"stats differ from actual GL instancing/upload calls",{count,actualDraws,actualUploads});
    const samples=[],created=JSON.stringify(window.spatialGpuResources().created);
    for(let sample=0;sample<12;sample++){
      const started=performance.now();renderer.render();renderer.renderCommands(scene.frame.state.renderCommandBuffer);renderer.renderPostProcess();samples.push(performance.now()-started);
    }
    check(JSON.stringify(window.spatialGpuResources().created)===created,"steady instancing allocated GPU objects");
    samples.sort((a,b)=>a-b);
    sharedResources=resources;cases.push({submissionMedianMs:samples[6],submissionP95Ms:samples[11],count,drawCalls:stats.modelDrawCalls,triangles:stats.modelTriangleCount,matrixUploadBytes:stats.modelInstanceUploadBytes,assetUploadBytes:stats.modelUploadBytes,bufferCount:resources.bufferCount,textureCount:resources.textureCount,genericAttributeReadCount:attributeReads,genericAttributeValuesPreserved:genericPreserved});
  }
  await window.spatialDebugScreenshot("model-instancing-1000",canvas.toDataURL());
  // Offscreen instances retain asset lifetime and consume neither main triangles nor matrix uploads.
  const culled=structuredClone(document);Object.assign(culled.sceneComposition.fragments.forest.instances[0],{x:100000,y:100000});
  applyDataSceneAuthoringDocument(engine,culled,{spatialModelPreparer:renderer});engine.pauseDataScene();await wait();
  check(scene.frame.stats.spatial.modelCount===1000&&scene.frame.stats.spatial.visibleModelCount===999&&scene.frame.stats.spatial.modelInstanceUploadBytes===999*64,"native instance culling bypassed",scene.frame.stats.spatial);
  applyDataSceneAuthoringDocument(engine,document,{spatialModelPreparer:renderer});engine.pauseDataScene();await wait();
  const before=image(),saved=JSON.parse(JSON.stringify(captureGameStateSnapshot(engine,{includeDataSceneState:true,includeDataSceneProgress:true,dataSceneAuthoringDocument:document})));
  let freshFrame;
  const fresh=await createEngine(frame=>{freshFrame=frame;},undefined,undefined,()=>renderer.viewportSize());
  let restoredStats;
  try {
    fresh.setViewportSize(renderer.viewportSize().width,renderer.viewportSize().height);
    check(fresh.registerDataSceneSpatialModel("instanced-rock",rock),"fresh instance asset registration failed");
    const restored=restoreGameStateSnapshot(fresh,saved,{dataSceneAuthoringApplyOptions:{spatialModelPreparer:renderer}});
    check(restored.dataSceneStateApplied,"1000-instance progress restore failed");fresh.start();await wait();
    renderer.render();restoredStats=renderer.renderCommands(freshFrame.renderCommandBuffer);renderer.renderPostProcess();
    check(restoredStats.spatial.modelCount===1000&&restoredStats.spatial.modelDrawCalls===1&&restoredStats.spatial.modelUploadBytes===0&&difference(before,image())===0,"fresh instance pixels/resources changed",restoredStats.spatial);
    await window.spatialDebugScreenshot("model-instancing-restored",canvas.toDataURL());
  } finally {fresh.destroy();}
  // Compare the real instanced path with ordinary single draws of independently loaded identical
  // resources. Both use the public loader, native poses, materials, depth and point/sun shadows.
  const material=await loadSpatialGlb("/tree-material.glb",{materialProfile:"diffuse"});
  const independent=await loadSpatialGlb("/tree-material.glb",{materialProfile:"diffuse"});
  check(engine.registerDataSceneSpatialModel("instanced-tree",material)&&engine.registerDataSceneSpatialModel("independent-tree",independent),"material reference assets failed");
  const pair=make(2);pair.sceneComposition.fragments.forest.instances.forEach((p,i)=>{p.x=i*28-14;p.y=i*8;});
  pair.spatial.camera={projection:"orthographic",position:{x:35,y:-120,elevation:100},target:{x:0,y:0,elevation:16},height:Math.max(100,100*canvas.clientHeight/canvas.clientWidth),near:.1,far:1200};
  pair.spatial.terrain=[{id:"ground",x:-200,y:-200,width:400,depth:400,elevation:0,color:[.4,.4,.4,1],castShadow:false}];
  pair.spatial.models=Object.fromEntries([0,1].map(i=>[`rock-${i}`,{asset:"instanced-tree",contentId:material.contentId,scale:i?1.25:.8,yawDegrees:i?90:-25,elevation:i?0:8}]));
  pair.spatial.environment={lighting:{ambient:[.15,.15,.15],lights:[{position:{x:-30,y:-30,elevation:60},radius:200}],shadows:{lightIndex:0,resolution:128,bias:.05},directional:{direction:{x:-1,y:-1,elevation:2},intensity:1,shadows:{resolution:128,bias:.05}}},fog:{color:[.3,.4,.5],start:100,end:900}};
  const activate=async(doc)=>{
    const first=[],render=renderer.renderCommands,instanced=gl.drawElementsInstanced,upload=gl.bufferSubData,pointer=gl.vertexAttribPointer;
    let calls,bytes=0,uploadCalls=0,offsets=[];
    gl.drawElementsInstanced=function(...args){calls?.push(args[4]);return instanced.apply(this,args);};
    gl.bufferSubData=function(...args){if(calls&&args[0]===gl.ARRAY_BUFFER){bytes+=args[2].byteLength;uploadCalls++;}return upload.apply(this,args);};
    gl.vertexAttribPointer=function(...args){if(calls&&args[0]===6)offsets.push(args[5]);return pointer.apply(this,args);};
    renderer.renderCommands=function(...args){
      calls=[];bytes=0;uploadCalls=0;offsets=[];const result=render.apply(this,args);
      if(result.spatial)first.push({...result.spatial,actualInstancedCounts:calls.slice(),actualArrayUploadBytes:bytes,actualArrayUploadCalls:uploadCalls,actualInstanceOffsets:offsets.slice()});
      calls=undefined;return result;
    };
    try{applyDataSceneAuthoringDocument(engine,doc,{spatialModelPreparer:renderer});engine.pauseDataScene();await wait();}
    finally{renderer.renderCommands=render;gl.drawElementsInstanced=instanced;gl.bufferSubData=upload;gl.vertexAttribPointer=pointer;}
    return{pixels:image(),warm:first[first.length-1]??{...scene.frame.stats.spatial},first:first[0]};
  };
  const batched=await activate(pair);
  check(batched.warm.modelInstancedDrawCalls===material.primitiveCount&&batched.warm.modelDrawCalls===material.primitiveCount&&batched.first.shadowPassCount===7&&batched.first.shadowTriangleCount>0,"instanced material/shadow path missing",batched);
  check(batched.warm.shadowCacheHit&&batched.warm.shadowPassCount===0&&batched.warm.shadowDrawCalls===0&&batched.warm.modelInstanceUploadBytes===128&&batched.warm.actualArrayUploadCalls===1,"unchanged instancing bypassed the shadow cache",batched.warm);
  const poses=scene.frame.spatial.models.values,firstAt=poses[16]===-14?0:20,secondAt=20-firstAt;
  check(poses.length===40&&poses[firstAt+16]===-14&&poses[secondAt+16]===14&&Math.abs(poses[firstAt+9]-.8)<1e-6&&Math.abs(poses[secondAt+9]-1.25)<1e-6&&poses[firstAt+17]===8&&poses[secondAt+17]===0&&Math.abs(poses[firstAt+6])>.1&&poses[secondAt+4]===0,"comparison lost distinct native rotation/scale/elevation",[...poses]);
  check(batched.first.actualInstancedCounts.length>batched.first.modelInstancedDrawCalls&&batched.first.actualInstancedCounts.every(n=>n===2)&&batched.first.actualArrayUploadBytes===batched.first.modelInstanceUploadBytes&&batched.first.modelInstanceUploadBytes>128,"shadow batches/uploads do not match actual GL calls",batched.first);
  check(batched.first.actualArrayUploadCalls===1&&new Set(batched.first.actualInstanceOffsets).size===batched.first.actualInstanceOffsets.length&&batched.first.actualInstanceOffsets[batched.first.actualInstanceOffsets.length-1]===0,"matrix passes reused an already submitted instance range",batched.first);
  await window.spatialDebugScreenshot("model-instancing-material",canvas.toDataURL());
  const reference=structuredClone(pair);reference.spatial.models["rock-1"].asset="independent-tree";
  const ordinary=await activate(reference),materialDifference=difference(batched.pixels,ordinary.pixels);
  check(ordinary.warm.modelInstancedDrawCalls===0&&ordinary.warm.modelDrawCalls===material.primitiveCount*2&&materialDifference===0&&gl.getError()===gl.NO_ERROR,"instancing changed MASK/normal/emissive/depth/fog/shadow pixels",{materialDifference,batched:batched.warm,ordinary:ordinary.warm});
  applyDataSceneAuthoringDocument(engine,{format:"ferrum2d.consumer.scene-authoring",version:1,sceneComposition:{prefabs:{}},behaviorRecipes:{entities:{}}});engine.pauseDataScene();await wait();
  check(engine.releaseDataSceneSpatialModel("instanced-rock")&&engine.releaseDataSceneSpatialModel("instanced-tree")&&engine.releaseDataSceneSpatialModel("independent-tree"),"instanced assets retained after scene clear");
  return{cases,culledCount:1,freshRestore:true,restorePixelDifference:0,freshUploadBytes:restoredStats.spatial.modelUploadBytes,materialPixelDifference:materialDifference,materialDraws:{instanced:batched.warm.modelDrawCalls,ordinary:ordinary.warm.modelDrawCalls},shadowPassCount:batched.first.shadowPassCount,transformedMaterialParity:true,shadowInstancedCalls:batched.first.actualInstancedCounts.length-batched.first.modelInstancedDrawCalls,shadowMatrixUploadBytes:batched.first.modelInstanceUploadBytes-128,frameMatrixUploadCalls:batched.first.actualArrayUploadCalls,independentPassOffsets:true,resourceRelease:true};
}
