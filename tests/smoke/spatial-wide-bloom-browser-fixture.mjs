import { evaluateRuntimeDiagnosticsSample } from '@ferrum2d/ferrum-web/quality';
import { wideBloomReference } from '/bloom-reference.mjs';
import { createEngine, createRenderer, captureGameStateSnapshot, restoreGameStateSnapshot, hashGameStateSnapshot } from '@ferrum2d/ferrum-web/core';
import { applyDataSceneAuthoringDocument } from '@ferrum2d/ferrum-web/authoring';
import { check, difference, pixels, png } from '/fixture.mjs';

async function probe(backend, projection, colorManagement, variant){
 const canvas=document.createElement('canvas');canvas.style.cssText='position:fixed;left:0;top:0;width:128px;height:128px';canvas.dataset.spatialGpuTarget='true';document.body.append(canvas);
 let renderer,engine,pending;const errors=[],rows=[],images=[],allocations={textures:0,buffers:0,groups:0,pipelines:0};
 try{
  renderer=await createRenderer(canvas,{preferred:backend,colorManagement,fallbackBehavior:'silent',onFallback:e=>errors.push(String(e.reason)),webgl2:{preserveDrawingBuffer:true}});
  check((typeof renderer.gpuDevice==='function')===(backend==='webgpu'),'wide Bloom backend fallback',errors);
  const watch=()=>{
   const device=renderer.gpuDevice?.();device?.addEventListener('uncapturederror',e=>errors.push(e.error.message));
   const owner=device??canvas.getContext('webgl2');
   for(const [method,key] of [['createTexture','textures'],['createBuffer','buffers'],...(device?[['createBindGroup','groups'],['createRenderPipeline','pipelines']]:[])]){const original=owner[method].bind(owner);owner[method]=(...args)=>{allocations[key]++;return original(...args);};}
  };watch();
  const makeEngine=()=>createEngine(frame=>{if(!pending)return;const request=pending;pending=undefined;try{
   const before={...allocations};renderer.render();const stats=renderer.renderCommands(frame.renderCommandBuffer);
   if(request.repeat)renderer.renderCommands(frame.renderCommandBuffer);
   if(request.hud)renderer.renderCommands({commandCount:1,floatsPerCommand:15,buffer:new Float32Array([58,58,12,12,0,0,1,1,1,1,1,1,7,0,0])});
   renderer.renderPostProcess();const final=renderer.stats();engine.stop();
   const allocated=Object.fromEntries(Object.entries(allocations).map(([key,value])=>[key,value-before[key]]));
   const frameWork={spatialBloomDrawCalls:final.spatialBloomDrawCalls,spatialBloomTextureBytes:final.spatialBloomTextureBytes,spatialBloomTexelFetchBudget:final.spatialBloomTexelFetchBudget};
   pixels(renderer,canvas).then(data=>request.resolve({data,stats:{...stats.spatial},frameWork,allocated,resources:renderer.resourceStats()}),request.reject);
  }catch(error){engine.stop();request.reject(error);}});
  engine=await makeEngine();
  const blue=globalThis.document.createElement("canvas");blue.width=blue.height=1;blue.getContext("2d").fillStyle="blue";blue.getContext("2d").fillRect(0,0,1,1);await renderer.loadTexture(7,blue.toDataURL());
  const size=renderer.viewportSize();engine.setViewportSize(size.width,size.height);
  const document={format:'ferrum2d.consumer.scene-authoring',version:1,
   sceneComposition:{prefabs:{},fragments:{main:{instances:[]}}},behaviorRecipes:{entities:{}},spatial:{
    camera:{projection,position:{x:0,y:-1,elevation:100},target:{x:0,y:0,elevation:0},...(projection==='orthographic'?{height:128}:{fovDegrees:65.238486}),near:1,far:200},
    terrain:[[-128,-128,124,256],[4,-128,124,256],[-4,-128,8,124],[-4,4,8,124],[-4,-4,8,8]].map(([x,y,width,depth],i)=>({id:'surface'+i,x,y,width,depth,elevation:0,color:i===4?[1,1,1,1]:[0,0,0,1]})),billboards:{}}};applyDataSceneAuthoringDocument(engine,document);
  engine.pauseDataScene();
  const draw=(name,environment,options={})=>new Promise((resolve,reject)=>{
   if(environment!==undefined)check(engine.setDataSceneSpatialEnvironment(environment),'wide Bloom source rejected',{name,environment});
   const timeout=setTimeout(()=>reject(Error('wide Bloom frame timeout')),15000);
   pending={...options,resolve:row=>{clearTimeout(timeout);try{check(row.stats.terrainTriangleCount>=10&&row.stats.drawCalls<32,'wide Bloom runtime/work shape',row.stats);rows.push({name,width:canvas.width,height:canvas.height,stats:row.stats,frameWork:row.frameWork,allocated:row.allocated,resources:row.resources});images.push(row.data);resolve(row);}catch(error){reject(error);}},reject:e=>{clearTimeout(timeout);reject(e);}};engine.start();
  });
  const base={composition:'separated',lighting:{ambient:[4,4,4],lights:[]},
   ...(variant==='plain'?{}:{fog:{color:[0,0,0],start:0,end:200}}),
   ...(variant==='fog-ao'?{ambientOcclusion:{strength:1,radius:4,bias:.1}}:{})};
  const sharp=await draw('sharp',base);
  const hdr=await draw('hdr-reference',{...base,colorGrading:{exposure:-4,toneMapping:'none'}});
  const off=await draw('wide-zero',{...base,bloom:{mode:'wide',radius:64,strength:0}});
  check(difference(sharp.data,off.data)===0,'zero wide Bloom changes pixels');
  const gather=await draw('gather',{...base,bloom:{radius:24,threshold:1,strength:1}});
  for(const quality of ['low','balanced','high']){
   const spec={...base,bloom:{mode:'wide',quality,radius:64,threshold:1,strength:1}};
   const a=await draw(quality,spec),warm=await draw(quality+'-warm',spec);
   check(difference(a.data,warm.data)===0,'wide Bloom warm drift');
   check(Object.values(warm.allocated).every(n=>n===0),'wide warm render allocated GPU resources',warm.allocated);
   check(a.resources.renderTargetCount>gather.resources.renderTargetCount,'wide Bloom targets missing');
   check(a.stats.bloomDrawCalls>=3&&a.stats.bloomTexelFetchBudget<gather.stats.bloomTexelFetchBudget,'wide Bloom cost evidence missing',{a:a.stats,gather:gather.stats});
   const expected=wideBloomReference(hdr.data,canvas.width,canvas.height,{quality,dpr:devicePixelRatio});
   const oracleDifference=difference(a.data,expected,3);check(oracleDifference<a.data.length/4*.005,'independent CPU HDR Bloom reference',{quality,oracleDifference});rows.at(-2).oracleDifference=oracleDifference;
   const limits=devicePixelRatio===1?{low:[5,11264,85504],balanced:[6,44032,89600],high:[5,45056,104448]}:{low:[6,44032,335360],balanced:[7,175104,351744],high:[6,176128,366592]};
   const [draws,bytes,fetches]=limits[quality];
   const budget={maxSpatialBloomDrawCalls:draws,maxSpatialBloomTextureBytes:bytes,maxSpatialBloomTexelFetchBudget:fetches};
   const report=evaluateRuntimeDiagnosticsSample(a.frameWork,budget);check(report.passed,'measured Bloom work budget rejected',report);rows.at(-2).workBudget=report;
   check(a.stats.bloomDrawCalls===draws&&a.stats.bloomTextureBytes===bytes&&a.stats.bloomTexelFetchBudget===fetches,'Bloom work counter does not reflect fixture workload',a.stats);
   check(a.resources.renderTargetCount-gather.resources.renderTargetCount===draws-1,'Bloom target accounting mismatch');
   check(evaluateRuntimeDiagnosticsSample({...a.frameWork,spatialBloomTextureBytes:undefined},budget).violations.some(v=>v.reason==='missingMetric'),'unmeasured Bloom target cost accepted as zero');
   let halo=0;for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
    const dx=(x+.5)/devicePixelRatio-64,dy=(y+.5)/devicePixelRatio-64,at=(y*canvas.width+x)*4;
    if(Math.hypot(dx,dy)>28&&a.data[at]>gather.data[at]+3)halo++;
   }
   check(halo>64,'wide halo did not extend beyond the small gather',{quality,halo});rows.at(-2).haloPixels=halo;
  }
  const exposed=await draw('exposure-before-output',{...base,bloom:{mode:'wide',radius:64,threshold:1,strength:1},colorGrading:{exposure:-2,toneMapping:'none'}});
  check(difference(exposed.data,wideBloomReference(hdr.data,canvas.width,canvas.height,{dpr:devicePixelRatio,exposure:-2}),3)<exposed.data.length/4*.005,'wide threshold applied after exposure');
  const fractional=await draw('fractional-radius',{...base,bloom:{mode:'wide',radius:37.5,threshold:1,strength:1}});
  const fractionalDifference=difference(fractional.data,wideBloomReference(hdr.data,canvas.width,canvas.height,{dpr:devicePixelRatio,radius:37.5}),3);check(fractionalDifference===0,'fractional wide radius CPU reference',{fractionalDifference});rows.at(-1).oracleDifference=fractionalDifference;
  const threshold=await draw('threshold-empty',{...base,bloom:{mode:'wide',radius:64,threshold:64}});
  check(difference(sharp.data,threshold.data)===0,'wide threshold not applied before downsampling');
  const zero=await draw('wide-off',{...base,bloom:{mode:'wide',radius:64,strength:0}});
  check(difference(sharp.data,zero.data)===0&&zero.resources.renderTargetCount===off.resources.renderTargetCount,'wide OFF targets retained');
  canvas.style.width='127px';canvas.style.height='95px';renderer.resize();
  let viewport=renderer.viewportSize();engine.setViewportSize(viewport.width,viewport.height);
  const oddHdr=await draw('odd-hdr-reference',{...base,colorGrading:{exposure:-4,toneMapping:'none'}});
  const odd=await draw('odd-wide',{...base,bloom:{mode:'wide',radius:64,threshold:1,strength:1}});
  const oddDifference=difference(odd.data,wideBloomReference(oddHdr.data,canvas.width,canvas.height,{dpr:devicePixelRatio}),3);
  check(oddDifference<odd.data.length/4*.005,'odd target grid shifted the halo',{oddDifference});rows.at(-1).oracleDifference=oddDifference;
  const l=-3.625,r=4.125,t=-3.375,b=4.5;
  const stableDocument=structuredClone(document);
  stableDocument.spatial.terrain=[[-128,-128,l+128,256],[r,-128,128-r,256],[l,-128,r-l,t+128],[l,b,r-l,128-b],[l,t,r-l,b-t]].map(([x,y,width,depth],i)=>({id:'stable'+i,x,y,width,depth,elevation:0,color:i===4?[1,1,1,1]:[0,0,0,1]}));
  applyDataSceneAuthoringDocument(engine,stableDocument);engine.pauseDataScene();
  const stableHdr=await draw('odd-stable-hdr-reference',{...base,colorGrading:{exposure:-4,toneMapping:'none'}});
  const stable=await draw('odd-stable-wide',{...base,bloom:{mode:'wide',radius:64,threshold:1,strength:1}});
  const stableDifference=difference(stable.data,wideBloomReference(stableHdr.data,canvas.width,canvas.height,{dpr:devicePixelRatio}),3);
  check(stableDifference===0,'odd stable input CPU reference',{stableDifference});rows.at(-1).oracleDifference=stableDifference;
  canvas.style.width='128px';canvas.style.height='128px';renderer.resize();viewport=renderer.viewportSize();engine.setViewportSize(viewport.width,viewport.height);
  applyDataSceneAuthoringDocument(engine,document);engine.pauseDataScene();
  const restoredSize=await draw('size-restored',base);check(difference(sharp.data,restoredSize.data)===0,'wide Bloom resize restoration');
  const virtual={...base,pixelArt:{width:64,height:64,snapCamera:true}};
  const virtualHdr=await draw('pixel-art-hdr-reference',{...virtual,colorGrading:{exposure:-4,toneMapping:'none'}});
  const pixelArt=await draw('pixel-art-wide',{...virtual,bloom:{mode:'wide',radius:64,threshold:1,strength:1}});
  const zoom=canvas.width/64;
  for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)for(let c=0;c<4;c++)check(pixelArt.data[(y*canvas.width+x)*4+c]===pixelArt.data[(Math.floor(y/zoom)*zoom*canvas.width+Math.floor(x/zoom)*zoom)*4+c],'wide Bloom broke pixelArt nearest output');
  const virtualSource=new Uint8Array(64*64*4);for(let y=0;y<64;y++)for(let x=0;x<64;x++)virtualSource.set(virtualHdr.data.subarray((y*zoom*canvas.width+x*zoom)*4,(y*zoom*canvas.width+x*zoom)*4+4),(y*64+x)*4);
  const virtualReference=wideBloomReference(virtualSource,64,64,{dpr:.5});
  let virtualDifference=0;for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if([0,1,2].some(c=>Math.abs(pixelArt.data[(y*canvas.width+x)*4+c]-virtualReference[(Math.floor(y/zoom)*64+Math.floor(x/zoom))*4+c])>3))virtualDifference++;
  check(virtualDifference===0,'pixelArt wide CPU signal reference',{virtualDifference});rows.at(-1).oracleDifference=virtualDifference;
  const wide={...base,bloom:{mode:'wide',radius:64,threshold:1,strength:1}};
  const beforeRestore=await draw('before-restore',wide);
  const repeated=await draw('same-frame-repeat',wide,{repeat:true});check(difference(beforeRestore.data,repeated.data)===0,'repeated wide packet changed pixels');
  check(repeated.frameWork.spatialBloomDrawCalls===2*beforeRestore.stats.bloomDrawCalls&&repeated.frameWork.spatialBloomTextureBytes===beforeRestore.stats.bloomTextureBytes&&repeated.frameWork.spatialBloomTexelFetchBudget===2*beforeRestore.stats.bloomTexelFetchBudget,'multiple spatial packets lost Bloom work',repeated.frameWork);
  const hud=await draw('hud',wide,{hud:true});const center=((canvas.height/2|0)*canvas.width+(canvas.width/2|0))*4;
  check(hud.data[center]===0&&hud.data[center+1]===0&&hud.data[center+2]===255,'wide Bloom affected HUD');
  check(hud.frameWork.spatialBloomDrawCalls===beforeRestore.stats.bloomDrawCalls&&hud.frameWork.spatialBloomTextureBytes===beforeRestore.stats.bloomTextureBytes,'HUD erased frame Bloom work',hud.frameWork);
  const options={includeDataSceneState:true,includeDataSceneProgress:true,dataSceneAuthoringDocument:document};
  const saved=JSON.parse(JSON.stringify(captureGameStateSnapshot(engine,options)));check(saved.dataScene.version===12&&saved.dataScene.progress.spatial.lightSelection===undefined,'wide state version/policy presence');
  engine.destroy();engine=await makeEngine();engine.setViewportSize(size.width,size.height);
  check(restoreGameStateSnapshot(engine,saved).dataSceneStateApplied,'fresh wide restoration rejected');
  const restored=await draw('fresh-restore',undefined);check(difference(beforeRestore.data,restored.data)===0,'fresh wide pixels changed');
  const beforeReject=captureGameStateSnapshot(engine,options).dataScene.progress;
  const bad=JSON.parse(JSON.stringify(saved));bad.dataScene.version=11;bad.snapshotHash=hashGameStateSnapshot(bad);
  let rejected=false;try{restoreGameStateSnapshot(engine,bad);}catch(error){rejected=/version 12/.test(error.message);}check(rejected,'wide snapshot downgrade accepted');
  check(JSON.stringify(captureGameStateSnapshot(engine,options).dataScene.progress)===JSON.stringify(beforeReject),'invalid wide snapshot mutated progress');
  if(renderer.gpuDevice){const device=renderer.gpuDevice();device.destroy();await device.lost;check(await renderer.recoverDevice(),'wide device recovery rejected');watch();}
  const recovered=await draw('recovered-wide',undefined);check(difference(restored.data,recovered.data)===0,'wide recovery pixels changed');
  const cleared=await draw('environment-cleared',null);check(cleared.frameWork.spatialBloomDrawCalls===0&&cleared.frameWork.spatialBloomTextureBytes===0&&cleared.frameWork.spatialBloomTexelFetchBudget===0,'cleared environment retained Bloom work',cleared.frameWork);
  const returned=await draw('after-clear-wide',wide);check(difference(beforeRestore.data,returned.data)===0,'wide return after OFF changed pixels');
  check(errors.length===0,'wide Bloom GPU errors',errors);
  return {backend,projection,colorManagement,rows,images,errors,restored:true,recovered:backend==='webgpu',snapshotVersion:12,pixelArtNearest:true,gpuTimeMs:null,width:canvas.width,height:canvas.height};
 }finally{engine?.destroy();renderer?.destroy();window.disposeSpatialGpuTarget?.(canvas);canvas.remove();
  if(renderer)for(const key of ['textureCount','bufferCount','programCount','renderTargetCount'])check(renderer.resourceStats()[key]===0,'wide Bloom resource leak',{key,resources:renderer.resourceStats()});}
}
export async function probeSpatialWideBloom(colorManagement, variant='plain'){
 check(['plain','fog','fog-ao'].includes(variant),'Unknown wide Bloom composition variant');
 const result=[];
 for(const projection of ['orthographic','perspective']){
  const pair=[];for(const backend of ['webgl2','webgpu'])pair.push(await probe(backend,projection,colorManagement,variant));
  const inputIndex=pair[0].rows.findIndex(r=>r.name==='odd-hdr-reference');
  const sourceRasterDifferentPixels=difference(pair[0].images[inputIndex],pair[1].images[inputIndex],0);
  const stableIndex=pair[0].rows.findIndex(r=>r.name==='odd-stable-hdr-reference');
  check(difference(pair[0].images[stableIndex],pair[1].images[stableIndex],0)===0,'off-tie HDR sources differ before Bloom');
  const comparisons=pair[0].images.map((data,i)=>{
   const different=difference(data,pair[1].images[i],3),name=pair[0].rows[i].name;
   // Preserve the raster-tie case and check each backend against its own independently captured HDR source.
   // A second source avoids pixel-edge ties and must also pass raw backend parity.
   const inputVariation=name==='odd-wide'&&sourceRasterDifferentPixels>0;
   const oracleProven=pair.every(b=>b.rows[i].oracleDifference===0);
   return {name,different,sourceRasterDifferentPixels:inputVariation?sourceRasterDifferentPixels:0,kind:inputVariation?'source-raster-variation':'pixel-parity',passed:inputVariation?oracleProven:different<data.length/4*.01};
  });

  for(const backend of pair){backend.rows.forEach((row,i)=>row.image=png(backend.images[i],row.width,row.height));delete backend.images;}
  result.push({projection,comparisons,backends:pair});
 }
 return result;
}
