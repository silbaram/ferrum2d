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
  const canvas = document.createElement("canvas"); canvas.style.width="min(640px,100vw)";canvas.style.height="min(480px,100vh)";
  if(backend==="webgpu")canvas.dataset.spatialGpuTarget="true";document.body.replaceChildren(canvas);
  const errors=[],fallback=[],rows=[],images=[],engines=[];
  const renderer=await createRenderer(canvas,{preferred:backend,colorManagement,fallbackBehavior:"silent",onFallback:i=>fallback.push(i.reason),webgl2:{preserveDrawingBuffer:true}});
  check((typeof renderer.gpuDevice==="function")===(backend==="webgpu")&&!fallback.length,"Point PCSS renderer fallback",fallback);
  let device=renderer.gpuDevice?.();const listen=()=>device?.addEventListener("uncapturederror",e=>errors.push(e.error.message));listen();
  const oldRAF=window.requestAnimationFrame,oldCancel=window.cancelAnimationFrame,pending=new Map();let serial=1,clock=0,packet,frame,engine,nativeTerrain;
  window.requestAnimationFrame=cb=>{const id=serial++;pending.set(id,cb);return id;};window.cancelAnimationFrame=id=>pending.delete(id);
  const step=()=>{clock+=17;const callbacks=[...pending.values()];pending.clear();for(const cb of callbacks)cb(clock);};
  try {
    const assets={plate:await loadSpatialGlb(plate(20),{materialProfile:"diffuse"}),thin:await loadSpatialGlb(plate(2),{materialProfile:"diffuse"})};
    for(const kind of ["slope","curve"])assets[kind]=await loadSpatialGlb(tintedReceiver(kind),{materialProfile:"diffuse"});
    const makeEngine=async()=>{
      const e=await createEngine(state=>{
        frame=state;const previous=packet?.spatial,source=state.renderCommandBuffer.spatial;
        packet={...state.renderCommandBuffer,buffer:state.renderCommandBuffer.buffer.slice(),spatial:source&&ownedSpatial(source)};
        if(previous&&source&&nativeTerrain?.memory===source.terrain.buffer&&nativeTerrain.offset===source.terrain.byteOffset&&nativeTerrain.length===source.terrain.length&&nativeTerrain.revision===source.terrainRevision)packet.spatial.terrain=previous.terrain;
        nativeTerrain=source&&{memory:source.terrain.buffer,offset:source.terrain.byteOffset,length:source.terrain.length,revision:source.terrainRevision};
      },undefined,undefined,()=>renderer.viewportSize());
      for(const [id,asset]of Object.entries(assets))check(e.registerDataSceneSpatialModel(id,asset),"Point PCSS model registration");
      e.configureFixedTimestep(false);engines.push(e);return e;
    };
    const env=(filter="hard",pcss,dual=false)=>({composition:"separated",lighting:{ambient:[.1,.1,.1],shadowFilter:filter,
      lights:[{position:{x:0,y:0,elevation:128},radius:400,color:[1,0,0],intensity:1.8},
        ...(dual?[{position:{x:30,y:0,elevation:128},radius:400,color:[0,1,0],intensity:1.8}]:[])],
      ...(dual?{pointShadows:[{lightIndex:0,resolution:512,bias:.01,...(pcss?{pcss}:{})},{lightIndex:1,resolution:256,bias:.01}],
        directional:{direction:{x:0,y:0,elevation:1},color:[0,0,1],intensity:.6,shadows:{resolution:128,extent:96,distance:160,pcss:{}}}}
        :{shadows:{lightIndex:0,resolution:512,bias:.01,...(pcss?{pcss}:{})}})}});
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
      check(frame.gameState===GAME_STATE_CODE.playing&&frame.entityCount===1,"Point PCSS live scene state");
      renderer.render();const s=renderer.renderCommands(packet).spatial;renderer.renderPostProcess();
      check(s.modelCount===1&&s.triangleCount>0&&!errors.length,"Point PCSS geometry/GPU validation",{s,errors});
      return {data:await pixels(renderer,canvas),stats:{...s}};
    };
    const row=async(name,environment,passes)=>{
      window.pointPcssState={backend,projection,colorManagement,name};
      check(canvas.clientWidth===Math.min(640,innerWidth)&&canvas.clientHeight===Math.min(480,innerHeight),"Point PCSS responsive viewport mismatch");
      if(environment){check(engine.setDataSceneSpatialEnvironment(environment),"Point PCSS source rejected",name);step();}
      const first=await draw(),warm=await draw();
      check(first.stats.shadowPassCount===passes&&warm.stats.shadowPassCount===0&&warm.stats.shadowUploadBytes===0,"Point PCSS cache/pass budget",{name,first:first.stats,warm:warm.stats});
      check(difference(first.data,warm.data)===0,"Point PCSS warm image changed",name);
      const points=[];for(let x=-36;x<=36;x+=.125){const p=view().project({x,y:0,elevation:.001},packet.spatial);check(p?.visible,"Point PCSS profile out of view",{x,p});points.push([Math.round(p.x*canvas.width/canvas.clientWidth),Math.round(p.y*canvas.height/canvas.clientHeight)]);}
      rows.push({name,stats:first.stats,warm:warm.stats,width:canvas.width,height:canvas.height,points,image:png(warm.data,canvas.width,canvas.height),environmentVersion:packet.spatial.environment.version});images.push(warm.data);return warm;
    };
    const ambient=env();ambient.lighting.lights[0].intensity=0;delete ambient.lighting.shadows;
    await row("ambient",ambient,0);
    const plain=env();delete plain.lighting.shadows;await row("plain",plain,0);
    await row("contact-hard",env(),6);
    await row("contact-pcf3",env("pcf3"),0);
    await row("contact-zero",env("pcf3",{sourceRadius:0}),0);
    await row("contact-pcss",env("hard",{sourceRadius:8}),0);
    doc.spatial.models.plate.elevation=16;doc.spatial.environment=env("hard",{sourceRadius:8});apply();
    await row("mid-pcss",null,6);
    doc.spatial.models.plate.elevation=64;apply();await row("far-pcss",null,6);
    await row("far-hard",env(),0);
    await row("far-pcf3",env("pcf3"),0);
    await row("far-limited",env("hard",{sourceRadius:8,maxRadiusTexels:2}),0);
    await row("far-small-source",env("hard",{sourceRadius:2}),0);
    for(const resolution of [128,256,1024]){
      const e=env("hard",{sourceRadius:8,maxRadiusTexels:32});e.lighting.shadows.resolution=resolution;
      await row(`resolution-${resolution}`,e,6);
    }
    await row("camera-base",env("hard",{sourceRadius:8}),6);
    const shifted=structuredClone(doc.spatial.camera);shifted.position.x+=.03;shifted.target.x+=.03;
    check(engine.setDataSceneSpatialCamera(shifted,renderer.viewportSize()),"Point PCSS camera edit rejected");step();await row("camera-shift",null,0);
    check(engine.setDataSceneSpatialCamera(doc.spatial.camera,renderer.viewportSize()),"Point PCSS camera reset rejected");step();await row("camera-return",null,0);
    doc.spatial.models.plate={asset:"thin",contentId:assets.thin.contentId,elevation:.25,shadowOnly:true};doc.spatial.environment=env("hard",{sourceRadius:8});apply();
    await row("thin-contact",null,6);
    doc.spatial.models.plate.elevation=64;doc.spatial.environment=env("hard",{sourceRadius:2});apply();await row("thin-far",null,6);
    for(const kind of ["slope","curve"]){
      doc.spatial.models.plate={asset:kind,contentId:assets[kind].contentId,scale:.25};doc.spatial.environment=plain;apply();
      await row(`${kind}-plain`,null,0);
      await row(`${kind}-pcss`,env("hard",{sourceRadius:8,maxRadiusTexels:32}),6);
    }
    // The center receiver lies on a cube edge, then a three-face corner.
    for(const corner of [false,true]){
      const name=corner?"corner":"seam",hard=env();hard.lighting.lights[0].position={x:128,y:corner?128:0,elevation:128};
      const instance=doc.sceneComposition.fragments.lab.instances[0];instance.x=64;instance.y=corner?64:0;
      doc.spatial.models.plate={asset:"plate",contentId:assets.plate.contentId,elevation:64,shadowOnly:true};
      const baseline=structuredClone(hard);delete baseline.lighting.shadows;doc.spatial.environment=baseline;apply();
      await row(`${name}-plain`,null,0);await row(`${name}-hard`,hard,6);
      const zero=structuredClone(hard);zero.lighting.shadows.pcss={sourceRadius:0};await row(`${name}-zero`,zero,0);
      const soft=structuredClone(hard);soft.lighting.shadows.pcss={sourceRadius:8,maxRadiusTexels:32};await row(`${name}-pcss`,soft,0);
    }
    doc.sceneComposition.fragments.lab.instances[0].x=0;doc.sceneComposition.fragments.lab.instances[0].y=0;
    doc.spatial.models.plate={asset:"plate",contentId:assets.plate.contentId,elevation:64,shadowOnly:true};doc.spatial.environment=env("pcf3",undefined,true);apply();
    await row("dual-pcf3",null,13);
    const first=env("pcf3",{sourceRadius:8},true);await row("dual-first",first,0);
    const second=env("pcf3",undefined,true);second.lighting.pointShadows[1].pcss={sourceRadius:8,maxRadiusTexels:32};await row("dual-second",second,0);
    const dual=structuredClone(first);dual.lighting.pointShadows[1].pcss=second.lighting.pointShadows[1].pcss;await row("dual-pcss",dual,0);
    const saved=JSON.parse(JSON.stringify(captureGameStateSnapshot(engine,{includeDataSceneState:true,includeDataSceneProgress:true,dataSceneAuthoringDocument:doc})));
    check(saved.dataScene.version===15,"Point PCSS state15 capture");
    engine.stop();engine=await makeEngine();check(restoreGameStateSnapshot(engine,saved,{dataSceneAuthoringApplyOptions:{spatialModelPreparer:renderer,colorManagement}}).dataSceneStateApplied,"Point PCSS fresh restore");engine.start();step();step();await row("fresh-restore",null,13);
    const off=structuredClone(dual);off.lighting.enabled=false;await row("off",off,0);await row("re-enabled",dual,13);
    if(backend==="webgpu"){const old=renderer.gpuDevice();old.destroy();await old.lost;await Promise.resolve();await renderer.recoverDevice();device=renderer.gpuDevice();listen();await row("recovered",null,13);}
    renderer.destroy();check(renderer.resourceStats().textureCount===0&&renderer.resourceStats().bufferCount===0,"Point PCSS resource leak");
    return {backend,projection,colorManagement,rows,images,errors,snapshotVersion:saved.dataScene.version};
  } finally {for(const e of engines)e.destroy();renderer.destroy();device?.destroy();window.disposeSpatialGpuTarget?.(canvas);window.requestAnimationFrame=oldRAF;window.cancelAnimationFrame=oldCancel;}
}
export async function probeSpatialPointPcss(colorManagement){
  const result=[];
  for(const projection of ["orthographic","perspective"]){
    const backends=[];for(const backend of ["webgl2","webgpu"])backends.push(await probe(backend,projection,colorManagement));
    const comparisons=backends[0].rows.map((row,i)=>{const j=backends[1].rows.findIndex(r=>r.name===row.name);check(j>=0,"Missing Point PCSS parity row",row.name);
      const differentPixels=difference(backends[0].images[i],backends[1].images[j],3),pixelCount=backends[0].images[i].length/4;
      check(differentPixels<=pixelCount*.01,"Point PCSS backend parity",{name:row.name,differentPixels,pixelCount});return {name:row.name,differentPixels,pixelCount};});
    for(const b of backends)delete b.images;result.push({projection,backends,comparisons});
  }return result;
}
