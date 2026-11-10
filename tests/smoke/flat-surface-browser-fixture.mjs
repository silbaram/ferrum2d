import {createRenderer,createEngine,createDataSceneView,captureGameStateSnapshot,restoreGameStateSnapshot} from '@ferrum2d/ferrum-web/core';
import {applyDataSceneAuthoringDocument} from '@ferrum2d/ferrum-web/authoring';
import {texture,readPixels} from './flat-lighting-contract-fixture.mjs';
const NONE=16777215;
const check=(value,label)=>{if(!value)throw Error(label);};
const decode=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
const encode=v=>Math.round(255*(Math.max(0,Math.min(1,v))<=.0031308?Math.max(0,v)*12.92:1.055*Math.max(0,Math.min(1,v))**(1/2.4)-.055));
const near=(actual,expected,label,tolerance=3)=>check(expected.every((value,index)=>Math.abs(value-actual[index])<=tolerance),`${label}: ${actual} != ${expected}`);
const row=(id=1,mode=1,surface={})=>({id,mode,surface});
function packet(rows=[row()]){
 const buffer=Float32Array.from(rows.flatMap(r=>[...(r.rect??[40,16,16,16]),...(r.uv??[0,0,1,1]),1,1,1,1,r.id,0,r.rotation??0]));
 const words=new Uint32Array(rows.length*2),values=new Float32Array(words.buffer),surfaces=new Uint32Array(rows.length*10),factors=new Float32Array(surfaces.buffer);
 rows.forEach((r,i)=>{
  words[i*2]=r.mode;values[i*2+1]=r.mode===2?.5:0;
  const at=i*10,s=r.surface;surfaces.set([s?.emissionTextureId??NONE,s?.specularTextureId??NONE,s?.roughnessTextureId??NONE,Number(s!==null)],at);
  factors.set([...(s?.emission??[0,0,0]),s?.specular??0,s?.roughness??1],at+4);
 });
 return {buffer,commandCount:rows.length,floatsPerCommand:15,spriteLightingMaterials:{version:1,stride:2,words,values},spriteSurfaceMaterials:{version:1,stride:10,words:surfaces,values:factors},...(rows.some(r=>r.normal!==undefined)?{spriteNormalMaterials:{version:1,stride:2,buffer:Uint32Array.from(rows.flatMap(r=>[r.normal??NONE,0]))}}:{})};
}
function image2x2(pixels){const canvas=document.createElement('canvas');canvas.width=canvas.height=2;canvas.getContext('2d').putImageData(new ImageData(Uint8ClampedArray.from(pixels.flat()),2,2),0,0);return canvas.toDataURL();}
function sameFrame(a,b,label,tolerance=3){check(a.length===b.length,label+' size');let changed=0;for(let i=0;i<a.length;i++)if(Math.abs(a[i]-b[i])>tolerance)changed++;check(changed===0,label+': '+changed+' channels differ');}
const lit=(hdr=true)=>({profile:'lit',ambientIrradiance:[0,0,0],directionalLight:{directionX:1,directionY:0,elevationRadians:Math.PI/2,intensity:4,color:[1,1,1]},...(hdr?{hdr:{toneMapping:'none'}}:{})});
export async function probeFlatSurface(preferred,colorManagement='legacy'){
 const canvas=document.createElement('canvas');canvas.style.cssText='width:96px;height:64px;display:block';canvas.dataset.spatialGpuTarget='true';document.body.append(canvas);
 let renderer,device,afterDestroy,stage='setup',failure;const results=[],errors=[];
 try{
  renderer=await createRenderer(canvas,{preferred,colorManagement,fallbackBehavior:'silent',webgl2:{preserveDrawingBuffer:true,clearColor:[0,0,0,1]},webgpu:{clearColor:[0,0,0,1]}});
  check((typeof renderer.gpuDevice==='function'?'webgpu':'webgl2')===preferred,'Actual surface backend mismatch');
  const attach=()=>{device=renderer.gpuDevice?.();device?.addEventListener('uncapturederror',event=>errors.push(event.error.message));};attach();
  const load=async(id,pixel,options={})=>renderer.loadTexture(id,texture([pixel]),{alphaMode:'straight',...options});
  await load(1,[0,0,0,255]);await load(2,[96,96,96,255]);await load(3,[255,255,255,255]);await load(4,[0,0,255,128]);
  await load(10,[255,0,0,128],{colorSpace:'none'});await load(11,[255,128,0,255],{colorSpace:'none'});await load(12,[128,64,32,255]);
  const sample=pixels=>[[48,24],[44,20],[52,20],[44,28],[52,28]].map(([x,y])=>{const at=(Math.floor(y*devicePixelRatio)*canvas.width+Math.floor(x*devicePixelRatio))*4;return Array.from(pixels.subarray(at,at+4));});
  const record=(name,pixels)=>{const result={name,rgba:sample(pixels),stats:renderer.stats(),resources:renderer.resourceStats()};results.push(result);return {...result,pixels};};
  const draw=async(name,settings=lit(),commands=packet(),later)=>{
   stage=name;renderer.setLighting(settings);renderer.render();renderer.renderCommands(commands);later?.();renderer.renderPostProcess();await device?.queue.onSubmittedWorkDone();
   const pixels=await readPixels(renderer,canvas);check(!errors.length,errors.join('\n'));
   return record(name,pixels);
  };
  const rough=await draw('roughness-one',lit(),packet([row(1,1,{specular:1,roughness:1})]));near(rough.rgba[0],[encode(4*.04/(4*Math.PI)),encode(4*.04/(4*Math.PI)),encode(4*.04/(4*Math.PI)),255],'normal-incidence roughness1 analytic');
  const quantized=Math.round(.5*255)/255,energy=4*.04/(4*Math.PI*quantized**4);
  const smooth=await draw('roughness-half',lit(),packet([row(1,1,{specular:1,roughness:.5})]));near(smooth.rgba[0],[encode(energy),encode(energy),encode(energy),255],'normal-incidence roughness.5 analytic');
  await draw('roughness-zero',lit(),packet([row(1,1,{specular:1,roughness:0})]));
  const zero=await draw('surface-zero',lit(),packet([row(1,1,{specular:0,roughness:.5})]));near(zero.rgba[0],[0,0,0,255],'zero highlight');
  check(rough.resources.renderTargetCount===zero.resources.renderTargetCount+1,'surface extra target count');check(rough.stats.textureBindCount===zero.stats.textureBindCount+5,'surface map/composite binding budget is missing');
  const ambient=await draw('ambient-only',{profile:'lit',hdr:{toneMapping:'none'},ambientIrradiance:[1,1,1]},packet([row(1,1,{specular:1})]));near(ambient.rgba[0],[0,0,0,255],'ambient must not create specular');
  const emission=await draw('emission-hdr',{profile:'lit',hdr:{toneMapping:'reinhard'},ambientIrradiance:[0,0,0]},packet([row(1,1,{emission:[4,2,1]})]));near(emission.rgba[0],[encode(4/5),encode(2/3),encode(1/2),255],'emission above1 through HDR');
  const scalar=await draw('specular-alpha-map',lit(),packet([row(1,1,{specular:1,specularTextureId:10})]));const scalarEnergy=4*.04/(4*Math.PI)*(128/255);near(scalar.rgba[0],[encode(scalarEnergy),encode(scalarEnergy),encode(scalarEnergy),255],'raw alpha channel');
  const mapped=await draw('roughness-green-map',lit(),packet([row(1,1,{specular:1,roughnessTextureId:11})]));near(mapped.rgba[0],smooth.rgba[0],'raw green channel');
  const emitted=await draw('emission-srgb-map',{profile:'lit',hdr:{toneMapping:'none'},ambientIrradiance:[0,0,0]},packet([row(1,1,{emission:[4,4,4],emissionTextureId:12})]));near(emitted.rgba[0],[...[128,64,32].map(v=>encode(decode(v/255)*4)),255],'emission color must decode exactly once');
  const gray=await draw('gray-albedo',lit(),packet([row(2,1,{specular:1})]));const g=encode(decode(96/255)*4+4*.04/(4*Math.PI));near(gray.rgba[0],[g,g,g,255],'albedo diffuse plus independent reflection');
  const foreground=await draw('foreground-one-packet',lit(),packet([row(1,1,{specular:1}),row(4,0,null)]));const alpha=128/255,e=4*.04/(4*Math.PI)*(1-alpha);near(foreground.rgba[0],[encode(e),encode(e),encode(e+alpha),255],'unlit foreground retains independent specular');
  const split=await draw('foreground-two-packets',lit(),packet([row(1,1,{specular:1})]),()=>renderer.renderCommands(packet([row(4,0,null)])));near(split.rgba[0],foreground.rgba[0],'multiple world submissions');
  const warm=await draw('warm-two-packets',lit(),packet([row(1,1,{specular:1})]),()=>renderer.renderCommands(packet([row(4,0,null)])));
  check(warm.resources.estimatedBytes===split.resources.estimatedBytes,'multiple packet targets reallocated');
  const off=await draw('lighting-off',{...lit(),enabled:false},packet([row(1,1,{specular:1,emission:[4,2,1]})]));near(off.rgba[0],[0,0,0,255],'disabled profile restores base');check(off.stats.normalDrawCalls===0,'disabled surface still submitted data');
  for(const hdr of [false,true]){
   const value=await draw(hdr?'hdr-surface':'sdr-surface',lit(hdr),packet([row(1,1,{specular:1})]));near(value.rgba[0].slice(0,3),rough.rgba[0].slice(0,3),'SDR/HDR reflection');
  }
  const colors=[[255,0,0,255],[0,128,0,255],[0,0,64,255],[128,96,48,255]],black=colors.map(()=>[0,0,0,255]);
  await renderer.loadTexture(20,image2x2(black),{alphaMode:'straight'});
  await renderer.loadTexture(21,image2x2(colors),{alphaMode:'straight'});
  await renderer.loadTexture(22,image2x2(colors),{alphaMode:'straight'});
  const unlitScene={profile:'lit',hdr:{toneMapping:'none'},ambientIrradiance:[1,1,1]},darkScene={...unlitScene,ambientIrradiance:[0,0,0]};
  for(const [name,uv,rotation]of [['atlas',[0,0,1,1],0],['flip-x',[1,0,0,1],0],['flip-y',[0,1,1,0],0],['rotated',[0,0,1,1],Math.PI/2],['atlas-frame',[.5,0,1,.5],0]]){
   const reference=await draw(name+'-reference',unlitScene,packet([{...row(21,1,null),uv,rotation}]));
   const mapped=await draw(name+'-emission',darkScene,packet([{...row(20,1,{emission:[1,1,1],emissionTextureId:22}),uv,rotation}]));
   sameFrame(mapped.pixels,reference.pixels,name+' map UV/flip/rotation');
  }
  const strengths=[0,64,128,255],roughnesses=[255,192,128,96];
  await renderer.loadTexture(23,image2x2(strengths.map(a=>[0,0,0,a])),{alphaMode:'straight',colorSpace:'none'});
  await renderer.loadTexture(24,image2x2(roughnesses.map(g=>[255,g,255,255])),{alphaMode:'straight',colorSpace:'none'});
  const independent=await draw('independent-data-maps',lit(),packet([row(20,1,{specular:1,specularTextureId:23,roughnessTextureId:24})]));
  for(let i=0;i<4;i++){const e=4*.04/(4*Math.PI*(roughnesses[i]/255)**4)*(strengths[i]/255);near(independent.rgba[i+1],[encode(e),encode(e),encode(e),255],'independent raw map '+i);}
  await renderer.loadTexture(25,image2x2([[128,128,255,255],[230,128,200,255],[128,230,200,255],[26,128,200,255]]),{alphaMode:'straight',colorSpace:'none'});
  const normal=await draw('normal-map-surface',lit(),packet([{...row(20,1,{specular:1,roughness:.5}),normal:25}]));
  check(normal.rgba[1][0]>normal.rgba[2][0]+5,'normal map did not affect specular');
  const normalFlip=await draw('normal-map-flipped',lit(),packet([{...row(20,1,{specular:1,roughness:.5}),normal:25,uv:[1,0,0,1]}]));
  near(normalFlip.rgba[2],normal.rgba[1],'normal and surface atlas flip alignment');
  const alphas=[0,255,128,127];
  await renderer.loadTexture(26,image2x2(alphas.map(a=>[0,0,0,a])),{alphaMode:'straight'});
  const cutout=await draw('cutout-emission',darkScene,packet([row(26,2,{emission:[1,1,1],emissionTextureId:22})]));
  for(let i=0;i<4;i++)near(cutout.rgba[i+1],alphas[i]>=128?colors[i]:[0,0,0,255],'cutout gates emission '+i);
  const pointScene={profile:'lit',hdr:{toneMapping:'none'},ambientIrradiance:[0,0,0],pointLights:[{x:48,y:24,height:32,radius:80,intensity:4,falloff:1,color:[1,0,0]},{x:48,y:24,height:32,radius:80,intensity:4,falloff:1,color:[0,0,1]}]};
  const points=await draw('two-colored-point-specular',pointScene,packet([row(1,1,{specular:1})]));
  check(points.rgba[0][0]>20&&points.rgba[0][2]>20&&points.rgba[0][1]===0,'colored point highlights not accumulated');
  const shadowLights=[{x:8,y:24,height:64,radius:200,intensity:16,color:[1,0,0]},{x:80,y:24,height:64,radius:200,intensity:16,color:[0,0,1]}];
  const shadowScene={...pointScene,pointLights:shadowLights,shadows:{color:[0,0,0,1]},tileOccluders:[{x:24,y:8,width:4,height:32}]};
  const shadowed=await draw('specular-shadow-A-only',shadowScene,packet([row(1,1,{specular:1})]));
  const onlyB=await draw('specular-shadow-reference-B',{...shadowScene,pointLights:[shadowLights[1]]},packet([row(1,1,{specular:1})]));
  near(shadowed.rgba[0],onlyB.rgba[0],'A occlusion preserves B highlight');check(onlyB.rgba[0][2]>15,'shadow isolation fixture has no visible B');
  const twice=await draw('specular-shadow-duplicate',{...shadowScene,tileOccluders:[...shadowScene.tileOccluders,...shadowScene.tileOccluders]},packet([row(1,1,{specular:1})]));
  sameFrame(twice.pixels,shadowed.pixels,'specular shadow mask union',0);
  const replaced=await draw('before-map-reimport',darkScene,packet([row(20,1,{emission:[1,1,1],emissionTextureId:22})]));
  await renderer.loadTexture(22,image2x2(colors.map(()=>[32,64,128,255])),{alphaMode:'straight'});
  const replacement=await draw('after-map-reimport',darkScene,packet([row(20,1,{emission:[1,1,1],emissionTextureId:22})]));
  near(replacement.rgba[0],[32,64,128,255],'reimport replaces cached views');check(replaced.rgba[1][0]!==replacement.rgba[1][0],'reimport left stale map');
  const warmReimport=await draw('warm-map-reimport',darkScene,packet([row(20,1,{emission:[1,1,1],emissionTextureId:22})]));
  sameFrame(replacement.pixels,warmReimport.pixels,'warm map pixels',0);check(replacement.resources.estimatedBytes===warmReimport.resources.estimatedBytes,'warm map allocation plateau');
  const grouped=await draw('consecutive-map-ranges',darkScene,packet([
   {...row(20,1,{emission:[1,1,1],emissionTextureId:21}),rect:[40,16,5,16],uv:[0,0,.5,.5]},
   {...row(20,1,{emission:[0,0,1]}),rect:[45,16,5,16]},
   {...row(20,1,{emission:[1,1,1],emissionTextureId:22}),rect:[50,16,6,16]},
  ]));
  near(grouped.rgba[1],[255,0,0,255],'first map range');near(grouped.rgba[0],[0,0,255,255],'unmapped range');near(grouped.rgba[2],[32,64,128,255],'replaced map range');
  for(const id of [1,999]){
   const invalid=packet([row(20,1,{specular:1,specularTextureId:id})]);let rejected=false;
   try{renderer.renderCommands(invalid);}catch{rejected=true;}
   check(rejected,'invalid surface asset was accepted');sameFrame(await readPixels(renderer,canvas),grouped.pixels,'rejected map mutated framebuffer',0);
  }
  canvas.style.width='128px';canvas.style.height='80px';renderer.resize();
  const resized=await draw('surface-resize',lit(),packet([row(1,1,{specular:1})]));near(resized.rgba[0],rough.rgba[0],'resize preserves material');
  renderer.setPixelPerfect({width:96,height:64,snap:true});
  const pixel=await draw('surface-pixel-perfect',lit(),packet([row(1,1,{specular:1})]));
  const at=(Math.floor(32*devicePixelRatio)*canvas.width+Math.floor(64*devicePixelRatio))*4;
  near(Array.from(pixel.pixels.subarray(at,at+4)),rough.rgba[0],'letterboxed pixel-perfect material');
  renderer.setPixelPerfect(false);canvas.style.width='96px';canvas.style.height='64px';renderer.resize();
  const raf=requestAnimationFrame,cancel=cancelAnimationFrame,pending=new Map();let token=0,time=0,engine,view,scene,last;
  globalThis.requestAnimationFrame=callback=>{pending.set(++token,callback);return token;};globalThis.cancelAnimationFrame=id=>pending.delete(id);
  const pump=async()=>{time+=20;const work=[...pending.values()];pending.clear();for(const callback of work)callback(time);await device?.queue.onSubmittedWorkDone();check(!errors.length,errors.join('\n'));return readPixels(renderer,canvas);};
  const frames=[{u0:0,v0:0,u1:.5,v1:.5},{u0:.5,v0:0,u1:1,v1:.5}],samples=new Map();
  const authored={format:'ferrum2d.consumer.scene-authoring',version:1,behaviorRecipes:{entities:{}},lighting:darkScene,
   sceneComposition:{initialFragment:'main',prefabs:{object:{}},fragments:{main:{instances:[{id:'hero',prefab:'object',props:{components:{collider:'none',layer:'wall',visual:{kind:'sprite',texture:'black',width:32,height:32,originX:.5,originY:.5,lighting:{mode:'opaque'},surface:{emission:[1,1,1],emissionTexture:'emission'},animationSet:{initialClip:7,clips:[{id:7,fps:10,loop:false,frames}]}}}}}]}}}};
  const options={flatLightingPreparer:renderer,colorManagement,textureId:name=>{if(name==='black')return 20;if(name==='emission')return 21;throw Error('missing texture');}};
  const apply=doc=>{scene=doc;const result=applyDataSceneAuthoringDocument(engine,doc,options);view=createDataSceneView(engine,renderer,canvas,{x:0,y:0,zoom:1});engine.pauseDataScene();return result.entityHandles.hero;};
  try{
   stage='native-authoring';
   engine=await createEngine(frame=>{renderer.setLighting(view?view.lighting(scene.lighting,view.snapshot(frame)):false);renderer.render();renderer.renderCommands(frame.renderCommandBuffer);renderer.renderPostProcess();
    const material=frame.renderCommandBuffer.spriteSurfaceMaterials;last={state:frame.gameState,entities:frame.entityCount,material:material?Array.from(material.words):undefined};
   },()=>({}),undefined,()=>renderer.viewportSize(),{fixedTimestep:false});
   const size=renderer.viewportSize();engine.setViewportSize(size.width,size.height);const first=apply(authored);engine.start();await pump();await pump();check(engine.resumeDataScene(),'surface runtime failed to play');
   for(let i=0;i<16;i++){
    const pixels=await pump(),state=engine.dataSceneSpriteAnimationState(first);check(last.state===1&&last.entities===1&&last.material?.[0]===21,'native sorted surface metadata/state lost');
    if(!samples.has(state.frame)){samples.set(state.frame,pixels);const output=record('native-animation-frame-'+state.frame,pixels);near(output.rgba[0],colors[state.frame],'native animation emission frame');}
   }
   check(samples.size===2&&engine.dataSceneSpriteAnimationState(first).finished,'native material animation did not finish');
   for(const [frame,pixels]of samples){const doc=structuredClone(authored),visual=doc.sceneComposition.fragments.main.instances[0].props.components.visual;delete visual.animationSet;visual.frame=frames[frame];apply(doc);await pump();const actual=await pump();sameFrame(actual,pixels,'native animation/static map UV',0);record('native-static-frame-'+frame,actual);}
   const saved=JSON.parse(JSON.stringify(captureGameStateSnapshot(engine,{includeDataSceneState:true,includeDataSceneProgress:true,dataSceneAuthoringDocument:scene})));
   check(JSON.stringify(saved).includes('"emissionTexture":"emission"'),'saved material lost stable asset reference');
   check(restoreGameStateSnapshot(engine,saved,{dataSceneAuthoringApplyOptions:options}).dataSceneAuthoringDocumentApplied,'surface JSON restore failed');
   check(!engine.configureSpriteSurfaceMaterials([{entity:first,surface:{emission:[1,0,0]}}]),'restored surface accepted stale native handle');
   await pump();const restored=await pump();record('native-json-restored',restored);sameFrame(samples.get(1),restored,'restored material pixels',0);
  }finally{engine?.destroy();globalThis.requestAnimationFrame=raf;globalThis.cancelAnimationFrame=cancel;}
  if(device){const before=await draw('pre-recovery',lit(),packet([row(1,1,{specular:1,roughnessTextureId:11})]));device.destroy();await device.lost;await new Promise(resolve=>setTimeout(resolve,0));check(await renderer.recoverDevice(),'surface device recovery');attach();const after=await draw('post-recovery',lit(),packet([row(1,1,{specular:1,roughnessTextureId:11})]));near(after.rgba[0],before.rgba[0],'surface recovery pixels',0);}
 }catch(error){failure={stage,message:error.message,stack:error.stack};}
 finally{try{renderer?.destroy();afterDestroy=renderer?.resourceStats();}catch(error){failure??={stage:'destroy',message:error.message};}canvas.remove();}
 return {ok:!failure,preferred,colorManagement,dpr:devicePixelRatio,results,errors,afterDestroy,...(failure?{failure}:{})};
}
