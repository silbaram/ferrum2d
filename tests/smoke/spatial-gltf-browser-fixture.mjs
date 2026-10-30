import {loadSpatialGlb,loadSpatialGltf,SpatialModelAssetCache,createEngine,captureGameStateSnapshot,restoreGameStateSnapshot} from "@ferrum2d/ferrum-web/core";
import {addSpatialModelAssembly,applyDataSceneAuthoringDocument,createSceneInstanceHandleRegistry} from "@ferrum2d/ferrum-web/authoring";
export async function probeSpatialGltf(scene,canvas){
  const {engine,renderer,view}=scene,gl=canvas.getContext("webgl2"),check=(ok,message,data)=>{if(!ok)throw Error(`${message}: ${JSON.stringify(data)}`);};
  const wait=async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);};
  const image=()=>{const p=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
  const diff=(a,b)=>a.reduce((n,v,i)=>n+Number(Math.abs(v-b[i])>3),0);
  const names=["rock","tree-material","building"],external=[],reference=[];
  const cache=new SpatialModelAssetCache({maxEntries:3}),leases=[],requests=new Map(),initialFetch=globalThis.fetch;
  try{
  globalThis.fetch=async(...args)=>{const url=String(args[0]);if(url.includes("/gltf/"))requests.set(url,(requests.get(url)??0)+1);return initialFetch(...args);};
  try{for(const name of names){
    const request={url:`/gltf/${name}/scene.gltf`,format:"gltf",materialProfile:"diffuse"};
    const [one,two,b]=await Promise.all([cache.acquire(request),cache.acquire(request),loadSpatialGlb(`/${name}.glb`,{materialProfile:"diffuse"})]);
    leases.push(one,two);const a=one.asset;check(a===two.asset,"model cache duplicated an asset",name);
    check(a.primitiveCount===b.primitiveCount&&a.triangleCount===b.triangleCount&&JSON.stringify(a.bounds)===JSON.stringify(b.bounds),"glTF geometry differs from GLB",name);
    check(engine.registerDataSceneSpatialModel(`gltf-${name}`,a)&&engine.registerDataSceneSpatialModel(`glb-${name}`,b),"glTF registration failed",name);external.push(a);reference.push(b);
  }}finally{globalThis.fetch=initialFetch;}
  const cached=cache.stats(),cacheRequests=[...requests.values()].reduce((n,c)=>n+c,0);
  check(cacheRequests===10&&requests.size===10&&cached.entryCount===3&&cached.activeLeaseCount===6&&cached.pendingLoadCount===0&&cached.byteLength===external.reduce((n,a)=>n+a.byteLength,0),"model cache repeated transfer or ownership",{cached,cacheRequests,requests:[...requests]});
  const actor={visual:{kind:"sprite",texture:1,width:16,height:24,originY:1},collider:{type:"aabb",halfWidth:2,halfHeight:2,isTrigger:false},body:{type:"kinematic",heightSpan:{floorId:0,elevation:0,height:8}},layer:"player"};
  const base={format:"ferrum2d.consumer.scene-authoring",version:1,gameplay:{primaryActor:"actor"},
    sceneComposition:{initialFragment:"lab",prefabs:{object:{}},fragments:{lab:{instances:[{id:"actor",prefab:"object",x:0,y:-16,props:{components:actor}}]}}},behaviorRecipes:{entities:{}},
    spatial:{camera:{projection:"orthographic",position:{x:80,y:-200,elevation:260},target:{x:0,y:48,elevation:24},height:Math.max(420,320*canvas.clientHeight/canvas.clientWidth),near:.1,far:2000},terrain:[],billboards:{actor:{castShadow:false}},actor:{instanceId:"actor",speed:96,maxStepHeight:8,maxDropHeight:8},
      environment:{lighting:{ambient:[.3,.3,.3],lights:[{position:{x:-30,y:-30,elevation:100},radius:350}],shadows:{lightIndex:0,resolution:128,bias:.05},directional:{direction:{x:-1,y:-1,elevation:2},intensity:1,shadows:{resolution:128,bias:.05}}},fog:{color:[.2,.3,.4],start:100,end:1200},depthOfField:{focusDistance:350,focusRange:100,aperture:2,maxBlurRadius:2}}}};
  const terrain=[{id:"approach",x:-64,y:-48,width:128,depth:80,elevation:0},{id:"ramp",x:-16,y:32,width:32,depth:32,elevation:0,endElevation:32,kind:"ramp"},
    {id:"side-left",x:-64,y:32,width:48,depth:32,elevation:0},{id:"side-right",x:16,y:32,width:48,depth:32,elevation:0},
    {id:"below",x:-64,y:64,width:128,depth:80,elevation:0},{id:"upper",x:-48,y:64,width:96,depth:64,elevation:32,baseElevation:24,kind:"bridge",floorId:1}];
  const walls=[["left",-46,96,2,32],["right",46,96,2,32],["back",0,126,48,2],["front-left",-30,66,18,2],["front-right",30,66,18,2]];
  const make=(assets,prefix)=>{
    let doc=addSpatialModelAssembly(base,{id:"house",x:0,y:0,model:{asset:`${prefix}-building`,contentId:assets[2].contentId},terrain,connections:[{from:"ramp",to:"upper"}],colliders:walls.map(([id,x,y,halfWidth,halfDepth])=>({id,x,y,halfWidth,halfDepth,elevation:32,height:48,floorId:1}))});
    doc=addSpatialModelAssembly(doc,{id:"rock",x:-120,y:0,model:{asset:`${prefix}-rock`,contentId:assets[0].contentId},colliders:[{id:"trunk",x:0,y:0,halfWidth:12,halfDepth:10,elevation:0,height:24}]});
    return addSpatialModelAssembly(doc,{id:"tree",x:120,y:16,yawDegrees:90,model:{asset:`${prefix}-tree-material`,contentId:assets[1].contentId},colliders:[{id:"trunk",x:0,y:0,halfWidth:3,halfDepth:3,elevation:0,height:32}]});
  };
  applyDataSceneAuthoringDocument(engine,make(reference,"glb"),{spatialModelPreparer:renderer});engine.pauseDataScene();await wait();const expected=image();
  const document=make(external,"gltf"),first=[],render=renderer.renderCommands;let handles;
  renderer.renderCommands=function(...args){const stats=render.apply(this,args);if(stats.spatial)first.push({...stats.spatial});return stats;};
  try{handles=applyDataSceneAuthoringDocument(engine,document,{spatialModelPreparer:renderer}).entityHandles;engine.pauseDataScene();await wait();}finally{renderer.renderCommands=render;}
  const parity=diff(expected,image()),warm={...scene.frame.stats.spatial};
  check(parity===0&&warm.modelCount===3&&warm.visibleModelCount===3&&warm.modelDrawCalls===6&&warm.modelTriangleCount===118&&warm.modelUploadBytes===0&&first[0].modelUploadBytes===0,"separate glTF bypassed normal model rendering",{parity,warm,first:first[0]});
  check(first[0].shadowPassCount===7&&warm.shadowCacheHit&&warm.dofSampleBudget===13&&gl.getError()===gl.NO_ERROR,"glTF environment/cache mismatch",{first:first[0],warm});
  await window.spatialDebugScreenshot("model-gltf",canvas.toDataURL());
  const hash=()=>captureGameStateSnapshot(engine,{includeDataSceneState:true,includeDataSceneProgress:true,dataSceneAuthoringDocument:document}).snapshotHash;
  const beforeHash=hash(),resources=JSON.stringify(renderer.resourceStats());let missing=false,aborted=false,streamStarted=false,invalidAccessorRejected=false;
  let cacheProtected=false;
  try{await cache.acquire({url:"/gltf/gzip.gltf",format:"gltf",materialProfile:"diffuse"});}catch(error){cacheProtected=/capacity is pinned/.test(String(error));}
  const transient=new SpatialModelAssetCache({maxEntries:2,maxPendingLoads:1}),consumer=new AbortController();
  let sharedCancellation=false,destroyCancellation=false;
  try{
    const request={url:"/gltf/slow.gltf",format:"gltf",materialProfile:"diffuse"};
    const cancel=transient.acquire(request,{signal:consumer.signal}),keep=transient.acquire(request);
    consumer.abort();try{await cancel;}catch(error){sharedCancellation=/AbortError/.test(String(error));}
    const survivor=await keep;sharedCancellation&&=survivor.asset.contentId===external[2].contentId&&transient.stats().activeLeaseCount===1;
    survivor.release();check(transient.evictUnused()===1&&transient.stats().byteLength===0,"unused model cache resource retained");
    const pending=transient.acquire(request);transient.destroy();try{await pending;}catch(error){destroyCancellation=/AbortError/.test(String(error));}
    check(sharedCancellation&&destroyCancellation&&transient.stats().entryCount===0&&transient.stats().waitingRequestCount===0,"model cache cancellation lost consumer isolation",{sharedCancellation,destroyCancellation,stats:transient.stats()});
  }finally{transient.destroy();}
  try{await loadSpatialGltf("/gltf/bad-accessor.gltf",{materialProfile:"diffuse"});}catch(error){invalidAccessorRejected=/original bufferView/.test(String(error));}
  const encoded=await loadSpatialGltf("/gltf/gzip.gltf",{materialProfile:"diffuse"}),encodedBinary=encoded.contentId===external[2].contentId;
  const corsUrl=new URL("/gltf/gzip.gltf",location.href);corsUrl.hostname="localhost";
  const corsFetch=globalThis.fetch;let hiddenEncoding=false;
  globalThis.fetch=async(...args)=>{const response=await corsFetch(...args);if(String(args[0]).endsWith("/gltf-gzip.bin"))hiddenEncoding=response.type==="cors"&&response.headers.get("content-encoding")===null&&Number(response.headers.get("content-length"))>0;return response;};
  let corsEncodedBinary=false;
  try{corsEncodedBinary=(await loadSpatialGltf(corsUrl.href,{materialProfile:"diffuse"})).contentId===external[2].contentId&&hiddenEncoding;}finally{globalThis.fetch=corsFetch;}
  check(encodedBinary&&corsEncodedBinary,"encoded glTF binary identity differs",{encodedBinary,corsEncodedBinary,hiddenEncoding});
  try{await loadSpatialGltf("/gltf/broken.gltf",{materialProfile:"diffuse"});}catch(error){missing=/HTTP 404/.test(String(error));}
  const fetch=globalThis.fetch,controller=new AbortController();
  globalThis.fetch=async(...args)=>{const response=await fetch(...args);if(String(args[0]).endsWith("/gltf-slow.bin")){streamStarted=true;setTimeout(()=>controller.abort(),0);}return response;};
  try{await loadSpatialGltf("/gltf/slow.gltf",{materialProfile:"diffuse",signal:controller.signal});}catch(error){aborted=/AbortError/.test(String(error));}finally{globalThis.fetch=fetch;}
  const changed=await loadSpatialGltf("/gltf/changed.gltf",{materialProfile:"diffuse"});
  check(changed.contentId!==external[2].contentId&&engine.registerDataSceneSpatialModel("gltf-changed",changed),"dependency bytes did not change content identity");
  const bad=structuredClone(document);bad.spatial.models.house.asset="gltf-changed";let contentMismatch=false;
  try{applyDataSceneAuthoringDocument(engine,bad,{spatialModelPreparer:renderer});}catch{contentMismatch=true;}
  check(missing&&aborted&&streamStarted&&cacheProtected&&invalidAccessorRejected&&contentMismatch&&engine.gameplayEntityExists(handles.actor)&&hash()===beforeHash&&JSON.stringify(renderer.resourceStats())===resources,"failed glTF preparation replaced active scene/progress/resources",{missing,aborted,streamStarted,cacheProtected,invalidAccessorRejected,contentMismatch});
  check(engine.releaseDataSceneSpatialModel("gltf-changed"),"changed resource retained after rejection");
  for(let step=0;step<14;step++)check(engine.moveDataSceneSpatialBody(handles.actor,0,8),"glTF ramp move rejected",step);
  const upper=engine.getPhysicsEntity(handles.actor);check(upper.x===0&&upper.y===96&&upper.heightSpan.elevation===32&&upper.heightSpan.floorId===1,"glTF building walk proxies diverged",upper);
  engine.moveDataSceneSpatialBody(handles.actor,64,0);const blocked=engine.getPhysicsEntity(handles.actor);check(blocked.x===42,"glTF upper wall did not block",blocked);
  await wait();const pickPoint=view.project({x:0,y:96,elevation:32},scene.frame.spatial),rect=canvas.getBoundingClientRect();
  const hit=view.pick({x:rect.left+pickPoint.x,y:rect.top+pickPoint.y},scene.frame.spatial);check(hit?.surfaceId==="house/terrain/upper"&&Math.abs(hit.elevation-32)<.001,"glTF surface picking diverged",hit);
  const saved=JSON.parse(JSON.stringify(captureGameStateSnapshot(engine,{includeDataSceneState:true,includeDataSceneProgress:true,dataSceneAuthoringDocument:document}))),pixels=image(),registry=createSceneInstanceHandleRegistry();let frame;
  const fresh=await createEngine(next=>{frame=next;},undefined,undefined,()=>renderer.viewportSize());
  try{
    fresh.setViewportSize(renderer.viewportSize().width,renderer.viewportSize().height);
    for(let i=0;i<names.length;i++)check(fresh.registerDataSceneSpatialModel(`gltf-${names[i]}`,external[i]),"fresh glTF resource registration failed");
    check(restoreGameStateSnapshot(fresh,saved,{dataSceneAuthoringApplyOptions:{instanceHandleRegistry:registry,spatialModelPreparer:renderer}}).dataSceneStateApplied,"fresh glTF restore failed");
    fresh.start();await wait();renderer.render();const stats=renderer.renderCommands(frame.renderCommandBuffer);renderer.renderPostProcess();
    const pose=fresh.getPhysicsEntity(registry.get("actor"));check(diff(pixels,image())===0&&pose.x===42&&pose.heightSpan.elevation===32&&stats.spatial.modelCount===3&&stats.spatial.modelUploadBytes===0,"fresh glTF restore changed pixels/physics/resources",{pose,stats:stats.spatial});
    await window.spatialDebugScreenshot("model-gltf-restored",canvas.toDataURL());
  }finally{fresh.destroy();}
  await wait();const allocated=renderer.resourceStats();
  applyDataSceneAuthoringDocument(engine,{format:"ferrum2d.consumer.scene-authoring",version:1,sceneComposition:{prefabs:{}},behaviorRecipes:{entities:{}}});engine.pauseDataScene();await wait();
  const released=renderer.resourceStats();check(released.bufferCount===allocated.bufferCount-12&&released.textureCount<allocated.textureCount,"glTF GPU resources retained after clear",{allocated,released});
  for(const name of names)for(const prefix of ["gltf","glb"])check(engine.releaseDataSceneSpatialModel(`${prefix}-${name}`),"glTF CPU resource release failed");
  leases.forEach(lease=>lease.release());check(cache.evictUnused()===3,"model cache did not evict idle assets");const cleared=cache.stats();cache.destroy();
  check(cleared.entryCount===0&&cleared.byteLength===0&&cleared.activeLeaseCount===0&&cleared.waitingRequestCount===0,"model cache retained ownership",cleared);
  check(gl.getError()===gl.NO_ERROR,"glTF probe left WebGL error");
  return {models:3,first:first[0],warm,glbPixelDifference:parity,restorePixelDifference:0,missing,aborted,streamStarted,invalidAccessorRejected,encodedBinary,corsEncodedBinary,cacheProtected,sharedCancellation,destroyCancellation,cacheRequests,cached,cacheReleased:true,contentMismatch,oldScenePreserved:true,upperFloor:upper.heightSpan.floorId,blockedX:blocked.x,pickedSurface:hit.surfaceId,freshRestore:true,resourceRelease:true};
  }finally{leases.forEach(lease=>lease.release());cache.destroy();}
}
