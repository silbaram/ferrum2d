import { createEngine, createRenderer, createDataSceneSpatialView, loadSpatialGlb, captureGameStateSnapshot, restoreGameStateSnapshot, GAME_STATE_CODE } from "@ferrum2d/ferrum-web/core";
import { applyDataSceneAuthoringDocument } from "@ferrum2d/ferrum-web/authoring";
import { check, pixels, difference, png } from "/fixture.mjs";
import { ownedSpatial } from "/environment.mjs";
import { receiverSurface } from "/shadow-receivers.mjs";

// Self-authored horizontal plates. Shadow-only rendering exposes the whole receiver to the oracle.
function plate(width) {
  const vertices = new Float32Array(36);
  vertices.set([-width/2,0,-20, -width/2,0,20, width/2,0,-20, width/2,0,-20, -width/2,0,20, width/2,0,20]);
  for(let i=18;i<36;i+=3)vertices[i+1]=1;
  const json = { asset:{version:"2.0"},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],
    meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1},material:0}]}],
    materials:[{doubleSided:true,pbrMetallicRoughness:{metallicFactor:0,roughnessFactor:1}}],
    buffers:[{byteLength:vertices.byteLength}],bufferViews:[{buffer:0,byteLength:72},{buffer:0,byteOffset:72,byteLength:72}],
    accessors:[{bufferView:0,componentType:5126,count:6,type:"VEC3",min:[-width/2,0,-20],max:[width/2,0,20]},{bufferView:1,componentType:5126,count:6,type:"VEC3"}] };
  const encoded = new TextEncoder().encode(JSON.stringify(json)), padded = (encoded.length+3)&~3;
  const result = new ArrayBuffer(28+padded+vertices.byteLength), view = new DataView(result);
  [0x46546c67,2,result.byteLength,padded,0x4e4f534a].forEach((n,i)=>view.setUint32(i*4,n,true));
  new Uint8Array(result,20,padded).fill(32); new Uint8Array(result,20,encoded.length).set(encoded);
  view.setUint32(20+padded,vertices.byteLength,true);view.setUint32(24+padded,0x004e4942,true);
  new Uint8Array(result,28+padded).set(new Uint8Array(vertices.buffer));return result;
}
function tintedReceiver(kind){
  const bytes=receiverSurface(kind).bytes,oldSize=new DataView(bytes).getUint32(12,true);
  const json=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,oldSize)));
  json.materials[0].pbrMetallicRoughness.baseColorFactor=[.5,1,.5,1];
  const raw=new TextEncoder().encode(JSON.stringify(json)),padded=(raw.length+3)&~3,tail=new Uint8Array(bytes,20+oldSize);
  const result=new ArrayBuffer(20+padded+tail.length),view=new DataView(result);
  [0x46546c67,2,result.byteLength,padded,0x4e4f534a].forEach((n,i)=>view.setUint32(i*4,n,true));
  new Uint8Array(result,20,padded).fill(32);new Uint8Array(result,20,raw.length).set(raw);new Uint8Array(result,20+padded).set(tail);return result;
}

async function probe(backend, projection, colorManagement) {
  const canvas = document.createElement("canvas"); canvas.style.width="320px";canvas.style.height="240px";
  if(backend==="webgpu")canvas.dataset.spatialGpuTarget="true";document.body.replaceChildren(canvas);
  const errors=[],fallback=[],rows=[],images=[],engines=[];
  const renderer=await createRenderer(canvas,{preferred:backend,colorManagement,fallbackBehavior:"silent",onFallback:i=>fallback.push(i.reason),webgl2:{preserveDrawingBuffer:true}});
  check((typeof renderer.gpuDevice==="function")===(backend==="webgpu")&&!fallback.length,"PCSS renderer fallback",fallback);
  let device=renderer.gpuDevice?.();const listen=()=>device?.addEventListener("uncapturederror",e=>errors.push(e.error.message));listen();
  const oldRAF=window.requestAnimationFrame,oldCancel=window.cancelAnimationFrame,pending=new Map();let serial=1,clock=0,packet,frame,engine,nativeTerrain;
  window.requestAnimationFrame=cb=>{const id=serial++;pending.set(id,cb);return id;};window.cancelAnimationFrame=id=>pending.delete(id);
  const step=()=>{clock+=17;const callbacks=[...pending.values()];pending.clear();for(const cb of callbacks)cb(clock);};
  try {
    const assets={plate:await loadSpatialGlb(plate(40),{materialProfile:"diffuse"}),thin:await loadSpatialGlb(plate(2),{materialProfile:"diffuse"})};
    for(const kind of ["slope","curve"])assets[kind]=await loadSpatialGlb(tintedReceiver(kind),{materialProfile:"diffuse"});
    const makeEngine=async()=>{
      const e=await createEngine(state=>{
        frame=state;const previous=packet?.spatial,source=state.renderCommandBuffer.spatial;
        packet={...state.renderCommandBuffer,buffer:state.renderCommandBuffer.buffer.slice(),spatial:source&&ownedSpatial(source)};
        if(previous&&source&&nativeTerrain?.memory===source.terrain.buffer&&nativeTerrain.offset===source.terrain.byteOffset&&nativeTerrain.length===source.terrain.length&&nativeTerrain.revision===source.terrainRevision)packet.spatial.terrain=previous.terrain;
        nativeTerrain=source&&{memory:source.terrain.buffer,offset:source.terrain.byteOffset,length:source.terrain.length,revision:source.terrainRevision};
      },undefined,undefined,()=>renderer.viewportSize());
      for(const [id,asset]of Object.entries(assets))check(e.registerDataSceneSpatialModel(id,asset),"PCSS model registration");
      e.configureFixedTimestep(false);engines.push(e);return e;
    };
    const env=(filter="hard",pcss,dual=false)=>({composition:"separated",lighting:{ambient:[.1,.1,.1],shadowFilter:filter,
      lights:dual?[{position:{x:-50,y:0,elevation:100},radius:300,color:[0,1,0],intensity:.3},{position:{x:50,y:0,elevation:100},radius:300,color:[0,0,1],intensity:.3}]:[],
      ...(dual?{pointShadows:[{lightIndex:0,resolution:128},{lightIndex:1,resolution:256}]}:{}),
      directional:{direction:{x:0,y:0,elevation:1},color:[1,0,0],intensity:.8,shadows:{resolution:512,extent:96,distance:160,bias:.01,center:{x:0,y:0,elevation:0},...(pcss?{pcss}:{})}}}});
    const doc={format:"ferrum2d.consumer.scene-authoring",version:1,
      sceneComposition:{initialFragment:"lab",prefabs:{body:{}},fragments:{lab:{instances:[{id:"plate",prefab:"body",x:0,y:0,props:{components:{visual:{kind:"sprite",texture:0,width:1,height:1,color:"#ffffff00"},collider:"none",layer:"wall"}}}]}}},behaviorRecipes:{entities:{}},
      spatial:{camera:{projection,position:{x:0,y:-150,elevation:180},target:{x:0,y:0,elevation:0},...(projection==="orthographic"?{height:120}:{fovDegrees:40}),near:.1,far:1000},
        terrain:[{id:"floor",x:-110,y:-110,width:220,depth:220,elevation:0,baseElevation:-4,color:[.5,.5,.5,1]}],billboards:{},
        models:{plate:{asset:"plate",contentId:assets.plate.contentId,elevation:.25,shadowOnly:true}},environment:env()}};
    if(backend==="webgpu")await renderer.preloadSpatialModels(Object.values(assets));
    engine=await makeEngine();
    const apply=()=>{applyDataSceneAuthoringDocument(engine,doc,{spatialModelPreparer:renderer,colorManagement});engine.start();step();step();};apply();
    const view=()=>createDataSceneSpatialView(engine,canvas);
    const draw=async()=>{
      check(frame.gameState===GAME_STATE_CODE.playing&&frame.entityCount===1,"PCSS live scene state");
      renderer.render();const s=renderer.renderCommands(packet).spatial;renderer.renderPostProcess();
      check(s.modelCount===1&&s.triangleCount>0&&!errors.length,"PCSS geometry/GPU validation",{s,errors});
      return {data:await pixels(renderer,canvas),stats:{...s}};
    };
    const row=async(name,environment,passes)=>{
      window.sunPcssState={backend,projection,colorManagement,name};
      if(environment){check(engine.setDataSceneSpatialEnvironment(environment),"PCSS source rejected",name);step();}
      const first=await draw(),warm=await draw();
      check(first.stats.shadowPassCount===passes&&warm.stats.shadowPassCount===0&&warm.stats.shadowUploadBytes===0,"PCSS cache/pass budget",{name,first:first.stats,warm:warm.stats});
      check(difference(first.data,warm.data)===0,"PCSS warm image changed",name);
      const points=[];for(let x=-36;x<=36;x+=.125){const p=view().project({x,y:0,elevation:.001},packet.spatial);check(p?.visible,"PCSS profile out of view",{x,p});points.push([Math.round(p.x*canvas.width/canvas.clientWidth),Math.round(p.y*canvas.height/canvas.clientHeight)]);}
      rows.push({name,stats:first.stats,warm:warm.stats,width:canvas.width,height:canvas.height,points,image:png(warm.data,canvas.width,canvas.height),environmentVersion:packet.spatial.environment.version});images.push(warm.data);return warm;
    };
    const ambient=env();ambient.lighting.directional.intensity=0;delete ambient.lighting.directional.shadows;
    await row("ambient",ambient,0);
    const plain=env();delete plain.lighting.directional.shadows;await row("plain",plain,0);
    await row("contact-hard",env(),1);
    await row("contact-pcf3",env("pcf3"),0);
    await row("contact-zero",env("pcf3",{angularRadius:0}),0);
    await row("contact-pcss",env("hard",{angularRadius:5}),0);
    doc.spatial.models.plate.elevation=16;doc.spatial.environment=env("hard",{angularRadius:5});apply();
    await row("mid-pcss",null,1);
    doc.spatial.models.plate.elevation=64;apply();await row("far-pcss",null,1);
    await row("far-hard",env(),0);
    await row("far-pcf3",env("pcf3"),0);
    await row("far-limited",env("hard",{angularRadius:5,maxRadiusTexels:2}),0);
    await row("far-small-angle",env("hard",{angularRadius:1}),0);
    for(const resolution of [128,256,1024]){
      const e=env("hard",{angularRadius:5,maxRadiusTexels:32});e.lighting.directional.shadows.resolution=resolution;
      await row(`resolution-${resolution}`,e,1);
    }
    await row("camera-base",env("hard",{angularRadius:5}),1);
    const shifted=structuredClone(doc.spatial.camera);shifted.position.x+=.03;shifted.target.x+=.03;
    check(engine.setDataSceneSpatialCamera(shifted,renderer.viewportSize()),"PCSS camera edit rejected");step();await row("camera-shift",null,0);
    check(engine.setDataSceneSpatialCamera(doc.spatial.camera,renderer.viewportSize()),"PCSS camera reset rejected");step();await row("camera-return",null,0);
    const follow=env("hard",{angularRadius:5});delete follow.lighting.directional.shadows.center;
    await row("follow-base",follow,0);
    check(engine.setDataSceneSpatialCamera(shifted,renderer.viewportSize()),"PCSS following camera edit rejected");step();await row("follow-shift",null,0);
    check(engine.setDataSceneSpatialCamera(doc.spatial.camera,renderer.viewportSize()),"PCSS following camera reset rejected");step();await row("follow-return",null,0);
    doc.spatial.models.plate={asset:"thin",contentId:assets.thin.contentId,elevation:.25,shadowOnly:true};doc.spatial.environment=env("hard",{angularRadius:5});apply();
    await row("thin-contact",null,1);
    doc.spatial.models.plate.elevation=64;doc.spatial.environment=env("hard",{angularRadius:1});apply();await row("thin-far",null,1);
    for(const kind of ["slope","curve"]){
      doc.spatial.models.plate={asset:kind,contentId:assets[kind].contentId,scale:.25};doc.spatial.environment=plain;apply();
      await row(`${kind}-plain`,null,0);
      await row(`${kind}-pcss`,env("hard",{angularRadius:5,maxRadiusTexels:32}),1);
    }
    doc.spatial.models.plate={asset:"plate",contentId:assets.plate.contentId,elevation:64,shadowOnly:true};doc.spatial.environment=env("pcf3",undefined,true);apply();
    await row("dual-pcf3",null,13);
    const dual=env("pcf3",{angularRadius:5},true);await row("dual-pcss",dual,0);
    const saved=JSON.parse(JSON.stringify(captureGameStateSnapshot(engine,{includeDataSceneState:true,includeDataSceneProgress:true,dataSceneAuthoringDocument:doc})));
    check(saved.dataScene.version===14,"PCSS state14 capture");
    engine.stop();engine=await makeEngine();check(restoreGameStateSnapshot(engine,saved,{dataSceneAuthoringApplyOptions:{spatialModelPreparer:renderer,colorManagement}}).dataSceneStateApplied,"PCSS fresh restore");engine.start();step();step();await row("fresh-restore",null,13);
    const off=structuredClone(dual);off.lighting.enabled=false;await row("off",off,0);await row("re-enabled",dual,13);
    if(backend==="webgpu"){const old=renderer.gpuDevice();old.destroy();await old.lost;await Promise.resolve();await renderer.recoverDevice();device=renderer.gpuDevice();listen();await row("recovered",null,13);}
    renderer.destroy();check(renderer.resourceStats().textureCount===0&&renderer.resourceStats().bufferCount===0,"PCSS resource leak");
    return {backend,projection,colorManagement,rows,images,errors,snapshotVersion:saved.dataScene.version};
  } finally {for(const e of engines)e.destroy();renderer.destroy();device?.destroy();window.disposeSpatialGpuTarget?.(canvas);window.requestAnimationFrame=oldRAF;window.cancelAnimationFrame=oldCancel;}
}
export async function probeSpatialSunPcss(colorManagement){
  const result=[];
  for(const projection of ["orthographic","perspective"]){
    const backends=[];for(const backend of ["webgl2","webgpu"])backends.push(await probe(backend,projection,colorManagement));
    const comparisons=backends[0].rows.map((row,i)=>{const j=backends[1].rows.findIndex(r=>r.name===row.name);check(j>=0,"Missing PCSS parity row",row.name);
      const differentPixels=difference(backends[0].images[i],backends[1].images[j],3),pixelCount=backends[0].images[i].length/4;
      check(differentPixels<=pixelCount*.01,"PCSS backend parity",{name:row.name,differentPixels,pixelCount});return {name:row.name,differentPixels,pixelCount};});
    for(const b of backends)delete b.images;result.push({projection,backends,comparisons});
  }return result;
}
