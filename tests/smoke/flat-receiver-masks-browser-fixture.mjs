import {createRenderer,createEngine,createDataSceneView,captureGameStateSnapshot,restoreGameStateSnapshot} from '@ferrum2d/ferrum-web/core';
import {applyDataSceneAuthoringDocument} from '@ferrum2d/ferrum-web/authoring';
import {texture,readPixels} from './flat-lighting-contract-fixture.mjs';
const check=(value,label)=>{if(!value)throw Error(label);};
const encode=x=>Math.round(255*(x<=.0031308?x*12.92:1.055*x**(1/2.4)-.055));
const near=(a,b,label,tolerance=3)=>check(b.every((v,i)=>Math.abs(a[i]-v)<=tolerance),`${label}: ${a} != ${b}`);
function packet(rows=[{}]){
 const buffer=Float32Array.from(rows.flatMap(r=>[...(r.rect??[40,16,16,16]),0,0,1,1,1,1,1,1,r.id??1,r.flags??0,0]));
 const words=new Uint32Array(rows.length*2),values=new Float32Array(words.buffer);
 rows.forEach((r,i)=>{words[i*2]=r.mode??1;values[i*2+1]=r.mode===2?.5:0;});
 const result={buffer,commandCount:rows.length,floatsPerCommand:15,spriteLightingMaterials:{version:1,stride:2,words,values}};
 if(rows.some(r=>r.masks!==undefined))result.spriteLightMasks={version:1,stride:2,buffer:Uint32Array.from(rows.flatMap(r=>r.masks??[255,255]))};
 if(rows.some(r=>r.surface)){
  const words=new Uint32Array(rows.length*10),values=new Float32Array(words.buffer);
  rows.forEach((r,i)=>{const at=i*10;words.set([16777215,16777215,16777215,Number(!!r.surface)],at);values.set([...(r.surface?.emission??[0,0,0]),r.surface?.specular??0,r.surface?.roughness??1],at+4);});
  result.spriteSurfaceMaterials={version:1,stride:10,words,values};
 }
 return result;
}
export async function probeFlatReceiverMasks(preferred,colorManagement='legacy'){
 const canvas=document.createElement('canvas');canvas.style.cssText='width:96px;height:64px;display:block';canvas.dataset.spatialGpuTarget='true';document.body.append(canvas);
 let renderer,device,afterDestroy,failure,stage='setup';const results=[],errors=[];
 try{
  renderer=await createRenderer(canvas,{preferred,colorManagement,onFallback:info=>errors.push('Fallback: '+String(info.reason)),fallbackBehavior:'silent',webgl2:{preserveDrawingBuffer:true,clearColor:[0,0,0,1]},webgpu:{clearColor:[0,0,0,1]}});
  check((typeof renderer.gpuDevice==='function'?'webgpu':'webgl2')===preferred,'receiver masks used fallback');
  const attach=()=>{device=renderer.gpuDevice?.();device?.addEventListener('uncapturederror',event=>errors.push(event.error.message));};attach();
  for(const [id,pixel]of [[1,[255,255,255,255]],[2,[0,0,0,255]],[3,[0,0,0,0]],[4,[0,0,255,128]]])await renderer.loadTexture(id,texture([pixel]),{alphaMode:'straight'});
  const sample=pixels=>[[48,24],[44,20],[52,28]].map(([x,y])=>{const at=(Math.floor(y*devicePixelRatio)*canvas.width+Math.floor(x*devicePixelRatio))*4;return Array.from(pixels.subarray(at,at+4));});
  const draw=async(name,scene,commands=packet(),later)=>{
   stage=name;renderer.setLighting(scene);renderer.render();renderer.renderCommands(commands);later?.();renderer.renderPostProcess();await device?.queue.onSubmittedWorkDone();
   const pixels=await readPixels(renderer,canvas);check(!errors.length,errors.join('\n'));const result={name,rgba:sample(pixels),stats:renderer.stats(),resources:renderer.resourceStats()};results.push(result);return {...result,pixels};
  };
  const compare=(a,b,label)=>{for(let i=0;i<a.rgba.length;i++)near(a.rgba[i],b.rgba[i],label+' point'+i);};
  for(const hdr of [false,true]){
   const prefix=hdr?'hdr-':'sdr-',base={profile:'lit',ambientIrradiance:[.05,.05,.05],...(hdr?{hdr:{toneMapping:'none'}}:{})};
   const sun={...base,directionalLight:{directionX:1,directionY:0,elevationRadians:Math.PI/2,color:[1,1,1],intensity:.5,lightMask:1,shadowMask:1}};
   const normal=await draw(prefix+'default',sun),explicit=await draw(prefix+'explicit-default',sun,packet([{masks:[255,255]}]));compare(normal,explicit,'default masks identity');
   check(normal.resources.renderTargetCount===explicit.resources.renderTargetCount,'default masks allocated target');
   const masked=await draw(prefix+'receiver-light-zero',sun,packet([{masks:[0,255]}]));near(masked.rgba[0],[encode(.05),encode(.05),encode(.05),255],'zero light mask preserves ambient');
   check(masked.resources.renderTargetCount===normal.resources.renderTargetCount+1,'receiver identity target count');
   check(masked.resources.textureBytes===normal.resources.textureBytes+canvas.width*canvas.height*4,'receiver target byte accounting');
   check(masked.stats.drawCalls===normal.stats.drawCalls+1,'mask draw is missing from total stats');
   compare(await draw(prefix+'light-channel-zero',{...sun,directionalLight:{...sun.directionalLight,lightMask:0}}),masked,'light channels apply without receiver target');
   compare(await draw(prefix+'receiver-nonmatching',sun,packet([{masks:[2,255]}])),masked,'nonmatching light bits');
   const points=[{x:8,y:24,height:64,radius:200,intensity:.5,color:[1,0,0],lightMask:1,shadowMask:1},{x:80,y:24,height:64,radius:200,intensity:.5,color:[0,0,1],lightMask:2,shadowMask:2}];
   const scene={...base,ambientIrradiance:[0,0,0],pointLights:points},referenceR=await draw(prefix+'reference-red',{...scene,pointLights:[points[0]]}),referenceB=await draw(prefix+'reference-blue',{...scene,pointLights:[points[1]]}),both=await draw(prefix+'reference-both',scene);
   compare(await draw(prefix+'receiver-select-red',scene,packet([{masks:[1,255]}])),referenceR,'red only');
   compare(await draw(prefix+'receiver-select-blue',scene,packet([{masks:[2,255]}])),referenceB,'blue only');
   compare(await draw(prefix+'receiver-select-both',scene,packet([{masks:[3,255]}])),both,'channel union');
   const shadow={...scene,shadows:{color:[0,0,0,1]},tileOccluders:[{x:24,y:8,width:4,height:32}]};
   compare(await draw(prefix+'shadow-A-only',shadow,packet([{masks:[3,1]}])),referenceB,'shadow of A preserves B');
   compare(await draw(prefix+'shadow-zero',shadow,packet([{masks:[3,0]}])),both,'zero shadow mask preserves light');
   compare(await draw(prefix+'shadow-nonmatching',shadow,packet([{masks:[3,2]}])),both,'independent shadow bits');
   compare(await draw(prefix+'light-shadow-independent',shadow,packet([{masks:[1,0]}])),referenceR,'receive A without its shadow');
   compare(await draw(prefix+'light-shadow-channel-zero',{...shadow,pointLights:points.map(light=>({...light,shadowMask:0}))}),both,'light shadow channels bypass without receiver target');
   const sunScene={...base,ambientIrradiance:[0,0,0],pointLights:[points[1]],directionalLight:{directionX:1,directionY:0,elevationRadians:Math.PI/2,color:[0,1,0],intensity:.5,lightMask:1,shadowMask:1}};
   const ground=(masks,caster=true)=>packet([{flags:4,masks},...(caster?[{mode:0,flags:20}]:[])]);
   const sunOpen=await draw(prefix+'sun-ground-open',sunScene,ground([3,255],false));
   const sunBlocked=await draw(prefix+'sun-ground-shadowed',sunScene,ground([3,1]));
   const noSun=await draw(prefix+'sun-ground-reference',{...sunScene,directionalLight:{...sunScene.directionalLight,intensity:0}},ground([3,1]));
   compare(sunBlocked,noSun,'sun shadow preserves point light');check(sunOpen.rgba[0][1]>sunBlocked.rgba[0][1]+30,'sun mask fixture did not cast a shadow');check(sunBlocked.stats.shadowCasterCount===1,'sun mask caster not submitted');
   compare(await draw(prefix+'sun-shadow-zero',sunScene,ground([3,0])),sunOpen,'independent sun shadow receiver');
   compare(await draw(prefix+'sun-shadow-channel-zero',{...sunScene,directionalLight:{...sunScene.directionalLight,shadowMask:0}},ground([3,255])),sunOpen,'sun shadow channel bypass');
   const emitted={emission:[.1,.2,.3],specular:1,roughness:1};
   const emission=await draw(prefix+'surface-emission-independent',scene,packet([{id:2,masks:[0,0],surface:emitted}]));near(emission.rgba[0],[encode(.1),encode(.2),encode(.3),255],'masks preserve emission and exclude reflection');
   compare(await draw(prefix+'surface-emission-reference',{...scene,pointLights:[]},packet([{id:2,surface:emitted}])),emission,'unlit emission identity');
   const specular=await draw(prefix+'specular-mask',scene,packet([{id:2,masks:[1,255],surface:{specular:1}}]));
   compare(await draw(prefix+'specular-reference',{...scene,pointLights:[points[0]]},packet([{id:2,surface:{specular:1}}])),specular,'bounded reflection follows light mask');
   compare(await draw(prefix+'cutout-preserves-underlying',scene,packet([{masks:[1,255]},{id:3,mode:2,masks:[0,0]}])),referenceR,'cutout hole does not replace receiver identity');
   const foreground=await draw(prefix+'unlit-foreground',scene,packet([{masks:[1,255]},{id:4,mode:0}]));
   compare(await draw(prefix+'unlit-foreground-reference',{...scene,pointLights:[points[0]]},packet([{}, {id:4,mode:0}])),foreground,'unlit alpha retains receiver channels');
   const mixed=()=>{renderer.renderCommands(packet());renderer.renderCommands(packet([{masks:[1,0]}]));};
   const multi=await draw(prefix+'multiple-packets',scene,packet([{masks:[1,0]}]),mixed),warm=await draw(prefix+'multiple-packets-warm',scene,packet([{masks:[1,0]}]),mixed);compare(multi,warm,'warm packet mask targets');check(multi.resources.estimatedBytes===warm.resources.estimatedBytes,'mask target thrashing');
   const off=await draw(prefix+'disabled',{...scene,enabled:false},packet([{masks:[0,0]}]));near(off.rgba[0],[255,255,255,255],'disabled receiver masks');check(off.stats.normalDrawCalls===0,'disabled mask data draws');
   const after=await draw(prefix+'mask-target-release',sun);check(after.resources.renderTargetCount===normal.resources.renderTargetCount,'unused mask target retained');
   const before=await draw(prefix+'invalid-before',scene,packet([{masks:[1,0]}]));let rejected=false;try{renderer.renderCommands(packet([{masks:[256,0]}]));}catch{rejected=true;}check(rejected,'out-of-range mask accepted');
   const unchanged=await readPixels(renderer,canvas);check(unchanged.every((v,i)=>v===before.pixels[i]),'rejected mask mutated framebuffer');
  }
  const runtimeScene={profile:'lit',hdr:{toneMapping:'none'},ambientIrradiance:[0,0,0],pointLights:[{x:16,y:24,height:64,radius:200,intensity:.5,color:[1,0,0],lightMask:1},{x:80,y:24,height:64,radius:200,intensity:.5,color:[0,0,1],lightMask:2}]},runtimePacket=packet([{masks:[1,0]}]);
  const sizeBefore=await draw('mask-before-resize',runtimeScene,runtimePacket);
  canvas.style.width='128px';canvas.style.height='80px';renderer.resize();const resized=await draw('mask-resized',runtimeScene,runtimePacket);compare(resized,sizeBefore,'resize mask pixels');check(resized.resources.renderTargetCount===sizeBefore.resources.renderTargetCount,'resize target leak');
  renderer.setPixelPerfect({width:96,height:64,snap:true});const pixel=await draw('mask-pixel-perfect',runtimeScene,runtimePacket);
  const at=(Math.floor(32*devicePixelRatio)*canvas.width+Math.floor(64*devicePixelRatio))*4;near(Array.from(pixel.pixels.subarray(at,at+4)),sizeBefore.rgba[0],'nearest mask presentation');
  renderer.setPixelPerfect(false);canvas.style.width='96px';canvas.style.height='64px';renderer.resize();
  const raf=requestAnimationFrame,cancel=cancelAnimationFrame,pending=new Map();let token=0,time=0,engine,view,last;
  globalThis.requestAnimationFrame=callback=>{pending.set(++token,callback);return token;};globalThis.cancelAnimationFrame=id=>pending.delete(id);
  const doc={format:'ferrum2d.consumer.scene-authoring',version:1,behaviorRecipes:{entities:{}},lighting:{...runtimeScene,pointLights:runtimeScene.pointLights.map(light=>({...light,x:light.x-48,y:0}))},sceneComposition:{initialFragment:'main',prefabs:{object:{}},fragments:{main:{instances:[{id:'hero',prefab:'object',props:{components:{visual:{kind:'sprite',texture:1,width:16,height:16,originX:.5,originY:.5,lighting:{mode:'opaque',lightMask:1,shadowMask:0}},collider:'none',layer:'wall'}}}]}}}};
  const options={flatLightingPreparer:renderer},pump=async()=>{time+=20;const work=[...pending.values()];pending.clear();for(const callback of work)callback(time);await device?.queue.onSubmittedWorkDone();check(!errors.length,errors.join('\n'));return readPixels(renderer,canvas);};
  const record=(name,pixels)=>{const result={name,rgba:sample(pixels),stats:renderer.stats(),resources:renderer.resourceStats()};results.push(result);return result;};
  try{
   stage='native-mask-authoring';engine=await createEngine(frame=>{renderer.setLighting(view?view.lighting(doc.lighting,view.snapshot(frame)):false);renderer.render();renderer.renderCommands(frame.renderCommandBuffer);renderer.renderPostProcess();last={state:frame.gameState,entities:frame.entityCount,masks:Array.from(frame.renderCommandBuffer.spriteLightMasks?.buffer??[])};},()=>({}),undefined,()=>renderer.viewportSize(),{fixedTimestep:false});
   const size=renderer.viewportSize();engine.setViewportSize(size.width,size.height);const first=applyDataSceneAuthoringDocument(engine,doc,options).entityHandles.hero;view=createDataSceneView(engine,renderer,canvas,{x:0,y:0,zoom:1});engine.pauseDataScene();engine.start();await pump();await pump();check(engine.resumeDataScene(),'native mask scene failed to play');
   const played=record('native-mask-playing',await pump());check(last.state===1&&last.entities===1&&last.masks[0]===1&&last.masks[1]===0,'native mask/state metadata missing');check(played.rgba[0][0]>20&&played.rgba[0][2]===0,'actual native light mask pixel incorrect');
   const saved=JSON.parse(JSON.stringify(captureGameStateSnapshot(engine,{includeDataSceneState:true,includeDataSceneProgress:true,dataSceneAuthoringDocument:doc})));check(JSON.stringify(saved).includes('"shadowMask":0'),'native JSON mask zero lost');
   check(restoreGameStateSnapshot(engine,saved,{dataSceneAuthoringApplyOptions:options}).dataSceneAuthoringDocumentApplied,'native mask restore failed');check(!engine.configureSpriteLightingMaterials([{entity:first,lighting:{mode:'opaque',lightMask:2}}]),'restored scene accepted stale receiver');
   await pump();const restored=record('native-mask-restored',await pump());compare(restored,played,'actual mask JSON restored pixels');
  }finally{engine?.destroy();globalThis.requestAnimationFrame=raf;globalThis.cancelAnimationFrame=cancel;}
  if(device){
   const before=await draw('mask-before-recovery',runtimeScene,runtimePacket);check(before.rgba[0][0]>20&&before.rgba[0][2]===0,'recovery fixture must have visible selected red light');
   device.destroy();await device.lost;await new Promise(resolve=>setTimeout(resolve,0));check(await renderer.recoverDevice(),'mask device recovery');attach();const after=await draw('mask-after-recovery',runtimeScene,runtimePacket);compare(after,before,'recovered mask pixels');
   check(after.resources.renderTargetCount===before.resources.renderTargetCount&&after.resources.textureBytes===before.resources.textureBytes,'recovery mask resource leak');
  }
 }catch(error){failure={stage,message:error.message,stack:error.stack};}
 finally{try{renderer?.destroy();afterDestroy=renderer?.resourceStats();}catch(error){failure??={stage:'destroy',message:error.message};}window.disposeSpatialGpuTarget?.(canvas);canvas.remove();}
 return {ok:!failure,preferred,colorManagement,dpr:devicePixelRatio,results,errors,afterDestroy,...(failure?{failure}:{})};
}
