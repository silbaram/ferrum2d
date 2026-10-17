import { loadSpatialGlb, createEngine, captureGameStateSnapshot, restoreGameStateSnapshot } from "@ferrum2d/ferrum-web/core";
import { addSpatialModelAssembly, applyDataSceneAuthoringDocument, createSceneInstanceHandleRegistry } from "@ferrum2d/ferrum-web/authoring";

// Public authoring API + real native movement/rendering. No JS simulation or proxy relocation at runtime.
export async function probeSpatialModelAssembly(scene, canvas) {
  const {engine,renderer,view}=scene,gl=canvas.getContext("webgl2");
  const check=(ok,message,evidence)=>{if(!ok)throw Error(`${message}: ${JSON.stringify(evidence)}`);};
  const wait=async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);};
  const image=()=>{const out=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,out);return out;};
  const asset=await loadSpatialGlb("/building.glb",{materialProfile:"diffuse"});
  check(engine.registerDataSceneSpatialModel("building",asset),"assembly model registration failed");
  // Decimal local seams may overlap as JS doubles after placement while sharing one native edge.
  const decimalBase={format:"ferrum2d.consumer.scene-authoring",version:1,sceneComposition:{prefabs:{}},behaviorRecipes:{entities:{}},
    spatial:{camera:{projection:"orthographic",position:{x:0,y:-200,elevation:200},target:{x:0,y:0,elevation:0},height:300},terrain:[],billboards:{}}};
  const localX=-3.7,localWidth=103.7;
  const decimal=addSpatialModelAssembly(decimalBase,{id:"__proto__",x:-100.1,y:0,scale:3.7,model:{asset:"building",contentId:asset.contentId},terrain:[
    {id:"a",x:localX,y:0,width:localWidth,depth:10,elevation:0},
    {id:"b",x:localX+localWidth,y:0,width:localWidth,depth:10,elevation:0},
  ]});
  const decimalHandles=applyDataSceneAuthoringDocument(engine,decimal,{spatialModelPreparer:renderer}).entityHandles;
  engine.pauseDataScene();await wait();
  const decimalHash=captureGameStateSnapshot(engine,{includeDataSceneState:true,includeDataSceneProgress:true,dataSceneAuthoringDocument:decimal}).snapshotHash;
  let decimalRejections=0;
  for(const patch of [{x:16777216,width:1},{x:decimal.spatial.terrain[1].x-.01}]){
    const invalid=structuredClone(decimal);Object.assign(invalid.spatial.terrain[0],patch);
    try{applyDataSceneAuthoringDocument(engine,invalid);}catch{decimalRejections++;}
    check(engine.gameplayEntityExists(decimalHandles["__proto__"])&&captureGameStateSnapshot(engine,{includeDataSceneState:true,includeDataSceneProgress:true,dataSceneAuthoringDocument:decimal}).snapshotHash===decimalHash,"invalid f32 bounds replaced the scene/progress");
  }
  check(decimalRejections===2,"invalid f32 bounds accepted",decimalRejections);
  const proxy={id:"wall",x:0,y:0,halfWidth:1,halfDepth:1,elevation:0,height:1};
  const invalidProxies=[{colliders:Array(1)},{colliders:null},{terrain:null},{connections:null},
    ...[{x:16777216,halfWidth:.25},{y:16777216,halfDepth:.25},{elevation:16777216,height:1},
      {x:3e38,halfWidth:1e38},{y:-3e38,halfDepth:1e38},{halfWidth:2e38}].map(p=>({colliders:[{...proxy,...p}]}))];
  const proxyResources=JSON.stringify(renderer.resourceStats());let proxyRejections=0;
  for(const patch of invalidProxies){
    try{
      applyDataSceneAuthoringDocument(engine,addSpatialModelAssembly(decimalBase,{id:"bad-parent",x:0,y:0,model:{asset:"building",contentId:asset.contentId},
        children:[{id:"bad-child",x:0,y:0,model:{asset:"building",contentId:asset.contentId},...patch}]}),{spatialModelPreparer:renderer});
    }catch{proxyRejections++;}
    check(engine.gameplayEntityExists(decimalHandles["__proto__"])&&captureGameStateSnapshot(engine,{includeDataSceneState:true,includeDataSceneProgress:true,dataSceneAuthoringDocument:decimal}).snapshotHash===decimalHash,"invalid child proxy replaced native scene/progress");
    check(JSON.stringify(renderer.resourceStats())===proxyResources,"invalid child proxy changed GPU resources");
  }
  check(proxyRejections===10,"invalid child proxies accepted",proxyRejections);
  const localTerrain=[
    {id:"approach",x:-64,y:-48,width:128,depth:80,elevation:0},
    {id:"ramp",x:-16,y:32,width:32,depth:32,elevation:0,endElevation:32,kind:"ramp"},
    {id:"side-left",x:-64,y:32,width:48,depth:32,elevation:0},
    {id:"side-right",x:16,y:32,width:48,depth:32,elevation:0},
    {id:"below",x:-64,y:64,width:128,depth:80,elevation:0},
    {id:"upper",x:-48,y:64,width:96,depth:64,elevation:32,baseElevation:24,kind:"bridge",floorId:1},
  ];
  const walls=[["left",-46,96,2,32],["right",46,96,2,32],["back",0,126,48,2],["front-left",-30,66,18,2],["front-right",30,66,18,2]];
  const results=[],hierarchies=[];
  // Exercise prepared model activation from an actual completed flat frame too.
  applyDataSceneAuthoringDocument(engine,{format:"ferrum2d.consumer.scene-authoring",version:1,sceneComposition:{prefabs:{}},behaviorRecipes:{entities:{}}});
  engine.pauseDataScene();await wait();
  const flatResources=renderer.resourceStats();
  renderer.render();renderer.renderCommands(scene.frame.state.renderCommandBuffer);
  const flatPreparation=renderer.prepareSpatialModels([asset]);
  flatPreparation.commit();flatPreparation.dispose();renderer.renderPostProcess();
  check(renderer.resourceStats().bufferCount===flatResources.bufferCount+16,"flat frame end evicted a newer preparation");
  // An unused committed preparation is still retired by the next genuinely flat frame.
  renderer.render();renderer.renderCommands(scene.frame.state.renderCommandBuffer);renderer.renderPostProcess();
  check(renderer.resourceStats().bufferCount===flatResources.bufferCount,"unused flat preparation leaked");
  for(const nested of [false,true])for(const [yawDegrees,scale,x,y,elevation] of [[0,.75,-80,-16,8],[90,1.25,120,32,16],[180,.5,-32,180,24],[270,1.5,-180,0,8]]) {
    const [c,s]=[[1,0],[0,1],[-1,0],[0,-1]][yawDegrees/90];
    const delta=(lx,ly)=>({x:(c*lx-s*ly)*scale,y:(s*lx+c*ly)*scale});
    const point=(lx,ly,h=0)=>{const d=delta(lx,ly);return{x:x+d.x,y:y+d.y,elevation:elevation+h*scale};};
    const same=(actual,expected)=>Math.abs(actual.x-expected.x)<.002&&Math.abs(actual.y-expected.y)<.002&&Math.abs(actual.elevation-expected.elevation)<.002;
    const pose=(e,h)=>{const p=e.getPhysicsEntity(h);return{x:p.x,y:p.y,elevation:p.heightSpan.elevation,floorId:p.heightSpan.floorId};};
    const actor=()=>({visual:{kind:"sprite",texture:1,width:16*scale,height:24*scale,originY:1},collider:{type:"aabb",halfWidth:2*scale,halfHeight:2*scale,isTrigger:false},body:{type:"kinematic",heightSpan:{floorId:0,elevation,height:8*scale}},layer:"player"});
    const makeInstance=(id,lx,ly)=>{const p=point(lx,ly);return{id,prefab:"object",x:p.x,y:p.y,props:{components:actor()}};};
    const base={format:"ferrum2d.consumer.scene-authoring",version:1,gameplay:{primaryActor:"actor"},
      sceneComposition:{initialFragment:"lab",prefabs:{object:{}},fragments:{lab:{instances:[makeInstance("actor",0,-16),makeInstance("under",-56,96)]}}},behaviorRecipes:{entities:{}},
      spatial:{camera:{projection:"orthographic",position:point(0,-180,360),target:point(0,64,16),height:Math.max(260,180*canvas.clientHeight/canvas.clientWidth)*scale,near:.1,far:2500},terrain:[],billboards:{actor:{castShadow:false},under:{castShadow:false}},actor:{instanceId:"actor",speed:96*scale,maxStepHeight:8*scale,maxDropHeight:8*scale},environment:{lighting:{ambient:[.8,.8,.8],lights:[]}}}};
    const assembly={id:"house",x,y,elevation,yawDegrees,scale,model:{asset:"building",contentId:asset.contentId},terrain:localTerrain,connections:[{from:"ramp",to:"upper"}],
      colliders:walls.map(([id,x,y,halfWidth,halfDepth])=>({id,x,y,halfWidth,halfDepth,elevation:32,height:48,floorId:1}))};
    // Two culled ancestors share the same asset. Only the grandchild has physics surfaces.
    // The root's rotation/scale/height are composed through the intermediate local placement.
    const hierarchy={id:"village",x:x+4098,y:y+4098,elevation:elevation-8,yawDegrees:90,scale:2,
      model:{asset:"building",contentId:asset.contentId,castShadow:false},children:[{
        id:"wing",x:0,y:0,elevation:4,yawDegrees:0,scale:.75,model:{asset:"building",contentId:asset.contentId,castShadow:false},
        children:[{...assembly,x:-2732,y:2732,elevation:0,yawDegrees:yawDegrees-90,scale:scale/1.5}],
      }]};
    const modelId=nested?"village/children/wing/children/house":"house";
    const document=addSpatialModelAssembly(base,nested?hierarchy:assembly);
    const firstFrames=[],render=renderer.renderCommands;
    let handles;
    renderer.renderCommands=function(...args){const stats=render.apply(this,args);if(stats.spatial)firstFrames.push({...stats.spatial});return stats;};
    try{
      handles=applyDataSceneAuthoringDocument(engine,document,{spatialModelPreparer:renderer}).entityHandles;
      engine.pauseDataScene();await wait();
    }finally{renderer.renderCommands=render;}
    check(firstFrames[0]?.modelDrawCalls===8&&firstFrames[0].modelUploadBytes===0,"prepared assembly uploaded on first frame",{yawDegrees,first:firstFrames[0]});
    check(gl.getError()===gl.NO_ERROR,"prepared assembly transition left WebGL error",{yawDegrees});
    const exposed=[...scene.frame.spatial.models.assets.values()];
    check(exposed.length===1&&exposed[0]===asset&&Object.isFrozen(exposed[0])&&!("primitives" in exposed[0])&&!("images" in exposed[0]),"frame exposed private model geometry/pixels");
    const warm={...scene.frame.stats.spatial};
    check(warm.modelCount===(nested?3:1)&&warm.visibleModelCount===1&&warm.modelDrawCalls===8&&warm.modelTriangleCount===96&&warm.modelUploadBytes===0&&warm.terrainTriangleCount===0,"assembly submission changed",{nested,yawDegrees,warm});
    if(nested){
      const poses=scene.frame.spatial.models.values;
      check(poses.length===60,"hierarchy did not submit all native model instances",{length:poses.length});
      const matching=[];
      for(let at=0;at<poses.length;at+=20)if(poses[at+16]===x&&poses[at+17]===elevation&&poses[at+18]===-y)matching.push(at);
      check(matching.length===1,"hierarchy native model pivot changed",{modelId,x,y,elevation,poses:[...poses]});
      const at=matching[0];
      check(poses[at+4]===c*scale&&poses[at+6]===-s*scale&&poses[at+9]===scale&&poses[at+12]===s*scale&&poses[at+14]===c*scale,"hierarchy native rotation/scale changed",{yawDegrees,scale,matrix:[...poses.subarray(at+4,at+20)]});
      const parents=[];
      for(let p=0;p<poses.length;p+=20)if(poses[p+16]===x+4098&&poses[p+17]===elevation&&poses[p+18]===-(y+4098))parents.push(p);
      check(parents.length===1&&poses[parents[0]+4]===0&&poses[parents[0]+6]===-1.5&&poses[parents[0]+9]===1.5&&poses[parents[0]+12]===1.5&&poses[parents[0]+14]===0,"intermediate parent transform did not compose to yaw 90/scale 1.5",{poses:[...poses]});
    }
    const move=delta(0,8),trace=[];
    for(let step=0;step<14;step++){
      check(engine.moveDataSceneSpatialBody(handles.actor,move.x,move.y,{maxStepHeight:8*scale,maxDropHeight:8*scale}),"rotated ramp move rejected",{yawDegrees,step});
      trace.push(pose(engine,handles.actor));
    }
    check(same(trace.at(-1),point(0,96,32))&&trace.at(-1).floorId===1,"rotated ramp/floor transition mismatch",{yawDegrees,trace});
    const intoWall=delta(64,0);
    engine.moveDataSceneSpatialBody(handles.actor,intoWall.x,intoWall.y);
    const blocked=pose(engine,handles.actor);
    check(same(blocked,point(42,96,32)),"rotated/scaled wall collider mismatch",{yawDegrees,blocked,expected:point(42,96,32)});
    const toCenter=point(0,96,32);engine.setPhysicsBodyPosition(handles.actor,toCenter.x,toCenter.y);
    const lowerMove=delta(56,0);engine.moveDataSceneSpatialBody(handles.under,lowerMove.x,lowerMove.y);
    check(same(pose(engine,handles.under),point(0,96))&&pose(engine,handles.under).floorId===0,"rotated lower floor blocked by upper walls",{yawDegrees});
    await wait();
    const picks=[];
    for(const [id,lx,ly,h] of [["ramp",0,48,16],["upper",0,96,32]]){
      const expected=point(lx,ly,h),projected=view.project(expected,scene.frame.spatial),hit=view.pick(projected,scene.frame.spatial);
      check(hit?.surfaceId===`${modelId}/terrain/${id}`&&same(hit,expected),"rotated terrain picking mismatch",{nested,yawDegrees,id,hit,expected});picks.push({id:hit.surfaceId,elevation:hit.elevation,normal:hit.normal});
    }
    // Depth comparison against an actual model-free native frame.
    const sample=data=>{const p=view.project(point(0,96,12),scene.frame.spatial),px=Math.round(p.x*canvas.width/canvas.clientWidth),py=canvas.height-1-Math.round(p.y*canvas.height/canvas.clientHeight);return [...data.subarray((py*canvas.width+px)*4,(py*canvas.width+px)*4+3)];};
    const occluded=sample(image()),without=structuredClone(document.spatial);without.models={};
    check(engine.configureDataSceneSpatial(without,handles),"assembly depth reference rejected");await wait();const reference=sample(image());
    check(reference[0]>reference[1]+60&&!(occluded[0]>occluded[1]+60),"rotated model did not occlude the lower character",{yawDegrees,occluded,reference});
    handles=applyDataSceneAuthoringDocument(engine,document,{spatialModelPreparer:renderer}).entityHandles;engine.pauseDataScene();
    const destination=point(0,96,32);
    check(engine.moveDataSceneSpatialActorTo({x:destination.x,y:destination.y,floorId:1,speed:640*scale,cellSize:16*scale,arrivalRadius:0}),"assembly navigation request failed",{yawDegrees,stats:engine.dataSceneSpatialMoveStats()});
    engine.resumeDataScene();let frames=0;
    while(engine.dataSceneSpatialMoveStatus()==="moving"&&frames++<400)await wait();
    engine.pauseDataScene();await wait();
    const navigation={status:engine.dataSceneSpatialMoveStatus(),pose:pose(engine,handles.actor),stats:engine.dataSceneSpatialMoveStats()};
    check(navigation.status==="arrived"&&same(navigation.pose,destination)&&navigation.pose.floorId===1&&navigation.stats.searchCount===1&&navigation.stats.probeWorkUnits<=8_000_000,"rotated native navigation failed",{yawDegrees,navigation});
    const saved=JSON.parse(JSON.stringify(captureGameStateSnapshot(engine,{includeDataSceneState:true,includeDataSceneProgress:true,dataSceneAuthoringDocument:document}))),before=image();
    check(saved.dataScene.version===7&&saved.dataScene.authoringDocument.spatial.models[modelId].yawDegrees===yawDegrees,"assembly save lost placement");
    if(yawDegrees===270)await window.spatialDebugScreenshot(nested?"model-hierarchy":"model-assembly",canvas.toDataURL());
    const registry=createSceneInstanceHandleRegistry();let frame;
    const fresh=await createEngine(state=>{frame=state;},undefined,undefined,()=>renderer.viewportSize());
    let restoreDifferences;
    try{
      fresh.setViewportSize(renderer.viewportSize().width,renderer.viewportSize().height);
      check(fresh.registerDataSceneSpatialModel("building",asset),"fresh assembly model registration failed");
      check(restoreGameStateSnapshot(fresh,saved,{dataSceneAuthoringApplyOptions:{instanceHandleRegistry:registry,spatialModelPreparer:renderer}}).dataSceneStateApplied,"fresh assembly restore failed");
      fresh.start();await wait();renderer.render();renderer.renderCommands(frame.renderCommandBuffer);renderer.renderPostProcess();
      const imageAfter=image();
      restoreDifferences=before.reduce((n,v,i)=>n+Number(v!==imageAfter[i]),0);
      check(restoreDifferences===0&&same(pose(fresh,registry.get("actor")),destination),"fresh assembly pixels/pose changed",{yawDegrees,restoreDifferences});
      if(yawDegrees===270)await window.spatialDebugScreenshot(nested?"model-hierarchy-restored":"model-assembly-restored",canvas.toDataURL());
      fresh.moveDataSceneSpatialBody(registry.get("actor"),intoWall.x,intoWall.y);
      check(same(pose(fresh,registry.get("actor")),point(42,96,32)),"restored assembly wall missing",{yawDegrees});
    }finally{fresh.destroy();}
    (nested?hierarchies:results).push({yawDegrees,scale,x,y,elevation,modelId,firstFrame:firstFrames[0],warm,trace,blocked,picks,occluded,reference,navigation,restoreDifferences});
  }
  const allocated=renderer.resourceStats();
  const empty={format:"ferrum2d.consumer.scene-authoring",version:1,sceneComposition:{prefabs:{}},behaviorRecipes:{entities:{}}};
  applyDataSceneAuthoringDocument(engine,empty);engine.pauseDataScene();await wait();const released=renderer.resourceStats();
  check(released.bufferCount===allocated.bufferCount-16,"assembly model buffers leaked",{allocated,released});
  check(engine.releaseDataSceneSpatialModel("building"),"assembly CPU model still referenced");
  check(gl.getError()===gl.NO_ERROR,"assembly WebGL error");
  return {cases:results,hierarchies,uncancelledParentTransform:true,proxyRejections,flatCommitPreserved:true,unusedFlatCommitReleased:true,opaqueFrameAssets:true,prototypeIdApplied:"__proto__",decimalPlacementApplied:true,decimalRejections,resourceRelease:true};
}
