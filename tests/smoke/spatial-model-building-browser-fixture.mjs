import { loadSpatialGlb, createEngine, captureGameStateSnapshot, restoreGameStateSnapshot } from "@ferrum2d/ferrum-web/core";
import { applyDataSceneAuthoringDocument, createSceneInstanceHandleRegistry } from "@ferrum2d/ferrum-web/authoring";

// Native world-unit proxies are explicit. Fragment includes namespace the assembly;
// they do not turn the static GLB hierarchy into runtime parenting or mesh physics.
export async function probeSpatialBuilding(scene, canvas) {
  const {engine,renderer,view}=scene,gl=canvas.getContext("webgl2");
  const check=(ok,message,evidence)=>{if(!ok)throw Error(`${message}: ${JSON.stringify(evidence)}`);};
  const wait=async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);};
  const image=()=>{const out=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,out);return out;};
  const sample=(data,point)=>{
    const p=view.project(point,scene.frame.spatial),x=Math.round(p.x*canvas.width/canvas.clientWidth),y=canvas.height-1-Math.round(p.y*canvas.height/canvas.clientHeight);
    check(p.visible&&x>=0&&y>=0&&x<canvas.width&&y<canvas.height,"building sample outside frame",{point,p});
    return [...data.subarray((y*canvas.width+x)*4,(y*canvas.width+x)*4+3)];
  };
  const pose=(e,h)=>{const p=e.getPhysicsEntity(h);return {x:p.x,y:p.y,floorId:p.heightSpan.floorId,elevation:p.heightSpan.elevation};};
  const red=p=>p[0]>p[1]+60;
  const asset=await loadSpatialGlb("/building.glb",{materialProfile:"diffuse"});
  check(asset.primitiveCount===3&&asset.triangleCount===96,"building hierarchy baking mismatch",asset);
  check(JSON.stringify(asset.bounds)===JSON.stringify([-64,-4,-144,64,80,48]),"building axis/pivot/bounds mismatch",asset.bounds);
  check(engine.registerDataSceneSpatialModel("building",asset),"building registration failed");
  const camera={projection:"orthographic",position:{x:0,y:-180,elevation:360},target:{x:0,y:64,elevation:16},height:Math.max(260,180*canvas.clientHeight/canvas.clientWidth),near:.1,far:1500};
  const proxy=(id,x,y,width,depth,elevation,extra={})=>({id,x,y,width,depth,elevation,render:false,...extra});
  const body=(floorId,elevation,height,type="kinematic")=>({type,heightSpan:{floorId,elevation,height}});
  const actor=(floorId=0,elevation=0)=>({visual:{kind:"sprite",texture:1,width:16,height:24,originY:1},collider:{type:"aabb",halfWidth:2,halfHeight:2,isTrigger:false},body:body(floorId,elevation,8),layer:"player"});
  const walls=[
    ["left",-46,96,2,32],["right",46,96,2,32],["back",0,126,48,2],
    ["front-left",-30,66,18,2],["front-right",30,66,18,2],
  ];
  const document={format:"ferrum2d.consumer.scene-authoring",version:1,gameplay:{primaryActor:"actor"},
    sceneComposition:{initialFragment:"lab",prefabs:{object:{}},fragments:{
      lab:{instances:[
        {id:"actor",prefab:"object",x:0,y:-16,props:{components:actor()}},
        {id:"under",prefab:"object",x:-56,y:96,props:{components:actor()}},
      ],include:[{fragment:"building",idPrefix:"house/"}]},
      building:{instances:[
        {id:"model",prefab:"object",x:0,y:0,props:{components:{visual:{kind:"sprite",texture:1,width:1,height:1},collider:"none",layer:"wall"}}},
        ...walls.map(([id,x,y,halfWidth,halfHeight])=>({id:`wall-${id}`,prefab:"object",x,y,props:{components:{visual:{kind:"sprite",texture:1,width:1,height:1,color:"#ffffff00"},collider:{type:"aabb",halfWidth,halfHeight,isTrigger:false},body:body(1,32,48,"static"),layer:"wall"}}})),
      ]},
    }},behaviorRecipes:{entities:{}},spatial:{camera,
      terrain:[proxy("approach",-64,-48,128,80,0),proxy("ramp",-16,32,32,32,0,{kind:"ramp",endElevation:32}),
        proxy("side-left",-64,32,48,32,0),proxy("side-right",16,32,48,32,0),proxy("below",-64,64,128,80,0),
        proxy("upper",-48,64,96,64,32,{baseElevation:24,kind:"bridge",floorId:1})],
      connections:[{from:"ramp",to:"upper"}],billboards:{actor:{castShadow:false},under:{castShadow:false}},
      models:{"house/model":{asset:"building",contentId:asset.contentId}},actor:{instanceId:"actor",speed:96,maxStepHeight:8,maxDropHeight:8},
      environment:{lighting:{ambient:[.6,.6,.6],lights:[],directional:{direction:{x:1,y:-1,elevation:2},intensity:.5}}},
    }};
  let handles=applyDataSceneAuthoringDocument(engine,document).entityHandles;
  engine.pauseDataScene();await wait();
  const warm={...scene.frame.stats.spatial},revision=scene.frame.spatial.terrainRevision;
  check(warm.visibleTerrainChunkCount===0&&warm.terrainTriangleCount===0&&warm.modelDrawCalls===3&&warm.modelTriangleCount===96&&warm.modelUploadBytes===0,"building proxy/model submission mismatch",warm);
  check(scene.frame.spatial.terrainVertexCount===216,"hidden proxies changed static terrain indexing");
  engine.setDataSceneSpatialDebug({terrain:true,depthTest:false});await wait();
  const debugLines=scene.frame.stats.spatial.debugLineCount;
  check(debugLines>0,"hidden proxies missing from authoring debug",scene.frame.stats.spatial);
  engine.setDataSceneSpatialDebug(null);await wait();
  const trace=[pose(engine,handles.actor)];
  for(let i=0;i<14;i++){
    check(engine.moveDataSceneSpatialBody(handles.actor,0,8,{maxStepHeight:8,maxDropHeight:8}),"building ramp move rejected",i);await wait();trace.push(pose(engine,handles.actor));
    check(engine.gameplayEntityExists(handles.actor)&&scene.frame.spatial.terrainRevision===revision&&scene.frame.stats.spatial.modelUploadBytes===0,"building traversal replaced actor or uploaded static model");
  }
  check(trace.at(-1).y===96&&trace.at(-1).floorId===1&&trace.at(-1).elevation===32,"building doorway/ramp transition failed",trace);
  check(engine.moveDataSceneSpatialBody(handles.actor,64,0),"building wall sweep rejected");
  const blocked=pose(engine,handles.actor);check(blocked.x===42,"upper wall collider did not block",blocked);
  engine.setPhysicsBodyPosition(handles.actor,0,96);
  check(engine.moveDataSceneSpatialBody(handles.under,56,0),"lower floor movement rejected");
  const under=pose(engine,handles.under);check(under.x===0&&under.floorId===0&&under.elevation===0,"lower floor wall isolation failed",under);await wait();
  const occluded=image(),upperPixel=sample(occluded,{x:0,y:96,elevation:44}),underPixel=sample(occluded,{x:0,y:96,elevation:12});
  const noModel=structuredClone(document.spatial);noModel.models={};
  check(engine.configureDataSceneSpatial(noModel,handles),"building visibility reference rejected");await wait();
  const referenceUnder=sample(image(),{x:0,y:96,elevation:12});
  check(red(upperPixel)&&!red(underPixel)&&red(referenceUnder),"building shared depth did not separate floors",{upperPixel,underPixel,referenceUnder});
  check(engine.configureDataSceneSpatial(document.spatial,handles),"building rebind failed");await wait();
  const cameraChecks=[];
  for(const projection of ["orthographic","perspective"]){
    const c=projection==="orthographic"?{...camera,height:camera.height*1.1,position:{x:80,y:-180,elevation:380}}:{projection,position:{x:80,y:-180,elevation:380},target:camera.target,fovDegrees:Math.min(100,Math.max(45,45*canvas.clientHeight/canvas.clientWidth)),near:.1,far:1500};
    check(engine.setDataSceneSpatialCamera(c,renderer.viewportSize()),"building camera rejected",c);await wait();
    const projected=view.project({x:0,y:96,elevation:32},scene.frame.spatial),hit=view.pick(projected,scene.frame.spatial);
    check(hit?.surfaceId==="upper"&&hit.floorId===1&&Math.abs(hit.elevation-32)<.01,"hidden upper proxy picking mismatch",{projection,hit});cameraChecks.push({projection,surfaceId:hit.surfaceId,floorId:hit.floorId});
  }
  const shadowChecks=[];
  for(const kind of ["point","sun"]){
    const spec=structuredClone(document.spatial);
    spec.environment={lighting:{ambient:[.12,.12,.12],lights:[],...(kind==="sun"?{directional:{direction:{x:1,y:-1,elevation:2},intensity:.9,shadows:{resolution:512,bias:.05}}}:{lights:[{position:{x:-80,y:16,elevation:160},radius:400,intensity:1.5}],shadows:{lightIndex:0,resolution:512,bias:.05}})}};
    const render=async cast=>{
      let indexedDraws=0;const draw=gl.drawElements;
      gl.drawElements=function(...args){indexedDraws++;return draw.apply(this,args);};
      try{spec.models["house/model"].castShadow=cast;check(engine.configureDataSceneSpatial(spec,handles),"building shadow configuration rejected");await wait();return {pixels:image(),indexedDraws};}
      finally{gl.drawElements=draw;}
    };
    const without=await render(false),withShadow=await render(true),lit=without.pixels,shadow=withShadow.pixels;let changed=0,maxDelta=0;
    for(let i=0;i<lit.length;i+=4){const d=Math.max(...[0,1,2].map(k=>Math.abs(lit[i+k]-shadow[i+k])));if(d>8)changed++;maxDelta=Math.max(maxDelta,d);}
    check(changed>100&&maxDelta>20&&withShadow.indexedDraws>without.indexedDraws,"building did not share actual model shadows",{kind,changed,maxDelta,stats:scene.frame.stats.spatial});
    const ranges=scene.frame.spatial.environment.shadowSubmission.ranges;
    for(let i=0;i<ranges.length;i+=4)check(ranges[i+1]!==0,"hidden walk proxy entered shadow submission");
    shadowChecks.push({kind,changed,maxDelta,indexedDrawsWithout:without.indexedDraws,indexedDrawsWith:withShadow.indexedDraws,warmCacheHit:scene.frame.stats.spatial.shadowCacheHit});
  }
  // Reapply the exact document before capture; native poses may then differ from authored defaults.
  handles=applyDataSceneAuthoringDocument(engine,document).entityHandles;engine.pauseDataScene();await wait();
  check(engine.moveDataSceneSpatialActorTo({x:0,y:96,floorId:1,speed:192,cellSize:16,arrivalRadius:0}),"building navigation request rejected",engine.dataSceneSpatialMoveStats());
  engine.resumeDataScene();let frames=0;
  while(engine.dataSceneSpatialMoveStatus()==="moving"&&frames++<600)await wait();
  engine.pauseDataScene();
  const navigation={frames,status:engine.dataSceneSpatialMoveStatus(),pose:pose(engine,handles.actor),stats:engine.dataSceneSpatialMoveStats()};
  check(navigation.status==="arrived"&&navigation.pose.floorId===1&&navigation.pose.y===96,"building navigation failed",navigation);
  check(navigation.stats.searchCount===1&&navigation.stats.remainingWaypointCount===0&&navigation.stats.probeWorkUnits<=8_000_000,"building route exceeded work/replanning budget",navigation);
  check(engine.moveDataSceneSpatialBody(handles.under,56,0),"saved lower floor move rejected");await wait();
  await window.spatialDebugScreenshot("model-building",canvas.toDataURL());
  const saved=JSON.parse(JSON.stringify(captureGameStateSnapshot(engine,{includeDataSceneState:true,includeDataSceneProgress:true,dataSceneAuthoringDocument:document}))),before=image();
  check(saved.dataScene.version===7&&saved.dataScene.authoringDocument.spatial.terrain.every(s=>s.render===false),"building save omitted proxy contract",saved.dataScene.version);
  const registry=createSceneInstanceHandleRegistry();let frame;
  const fresh=await createEngine(state=>{frame=state;},undefined,undefined,()=>renderer.viewportSize());
  let restoreDifferences,restoredBlocked;
  try{
    fresh.setViewportSize(renderer.viewportSize().width,renderer.viewportSize().height);
    check(fresh.registerDataSceneSpatialModel("building",asset),"fresh building registration failed");
    check(restoreGameStateSnapshot(fresh,saved,{dataSceneAuthoringApplyOptions:{instanceHandleRegistry:registry}}).dataSceneStateApplied,"fresh building restore failed");
    fresh.start();await wait();renderer.render();renderer.renderCommands(frame.renderCommandBuffer);renderer.renderPostProcess();
    const after=image();restoreDifferences=before.reduce((n,v,i)=>n+Number(v!==after[i]),0);
    check(restoreDifferences===0&&pose(fresh,registry.get("actor")).floorId===1,"fresh building pixels/pose changed",restoreDifferences);
    await window.spatialDebugScreenshot("model-building-restored",canvas.toDataURL());
    check(fresh.moveDataSceneSpatialBody(registry.get("actor"),64,0),"restored wall sweep rejected");
    restoredBlocked=pose(fresh,registry.get("actor"));check(restoredBlocked.x===42,"fresh building wall proxy missing",restoredBlocked);
  }finally{fresh.destroy();}
  let invalidRejected=0;
  for(const patch of [{render:null},{render:false,textureId:1},{render:false,castShadow:true}]){
    const invalid=structuredClone(document);Object.assign(invalid.spatial.terrain[0],patch);
    try{applyDataSceneAuthoringDocument(engine,invalid);}catch{invalidRejected++;}
    check(engine.gameplayEntityExists(handles.actor),"invalid building proxy replaced active scene");
  }
  check(invalidRejected===3,"invalid building proxy accepted",invalidRejected);
  // Restore the model after the fresh-engine render; measure the last scene reference release.
  await wait();const allocated=renderer.resourceStats();
  const empty=structuredClone(document);empty.spatial.models={};empty.sceneComposition.fragments.building.instances.shift();
  applyDataSceneAuthoringDocument(engine,empty);engine.pauseDataScene();await wait();const released=renderer.resourceStats();
  check(released.bufferCount===allocated.bufferCount-6,"building GPU buffers leaked",{allocated,released});
  check(engine.releaseDataSceneSpatialModel("building"),"building CPU resource still in use");
  check(gl.getError()===gl.NO_ERROR,"building WebGL error");
  return {contentId:asset.contentId,primitiveCount:3,triangleCount:96,warm,debugLines,trace,blocked,under,upperPixel,underPixel,referenceUnder,cameraChecks,shadowChecks,navigation,savedVersion:saved.dataScene.version,restoreDifferences,restoredBlocked,invalidRejected,freshRestore:true,resourceRelease:true};
}
