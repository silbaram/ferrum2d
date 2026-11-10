import {createRenderer,createEngine} from '@ferrum2d/ferrum-web/core';
import {createPixelMaskTerrain} from '@ferrum2d/ferrum-web/labs';
import {texture,readPixels} from './flat-lighting-contract-fixture.mjs';
const check=(value,label)=>{if(!value)throw Error(label);};
const near=(a,b,label,tolerance=3)=>check(b.every((v,i)=>Math.abs(v-a[i])<=tolerance),label+': '+a+' != '+b);
const row=(id=1,color=[1,1,1,1],rect=[0,0,64,48])=>[...rect,0,0,1,1,...color,id,0,0];
const packet=(rows=[row()])=>({buffer:Float32Array.from(rows.flat()),commandCount:rows.length,floatsPerCommand:15});
const sample=(data,w,h)=>{const at=(Math.floor(h/2)*w+Math.floor(w/2))*4;return Array.from(data.slice(at,at+4));};
export async function probeManagedColor(preferred){
 const canvas=document.createElement('canvas');canvas.style.cssText='width:64px;height:48px;display:block';canvas.dataset.spatialGpuTarget='true';document.body.append(canvas);
 let renderer,device,engine,terrain,legacyTargets,initialTargets,stage='setup',failure,afterDestroy;const results=[],errors=[];
 try{
  engine=await createEngine();
  const reference=document.createElement('canvas');reference.style.cssText='width:64px;height:48px';reference.dataset.spatialGpuTarget='true';document.body.append(reference);
  let legacy;
  try{legacy=await createRenderer(reference,{preferred,colorManagement:'legacy',fallbackBehavior:'silent'});check((typeof legacy.gpuDevice==='function'?'webgpu':'webgl2')===preferred,'legacy structural reference fell back');legacyTargets=legacy.resourceStats().renderTargetCount;}
  finally{legacy?.destroy();reference.remove();}
  const fallbacks=[];
  renderer=await createRenderer(canvas,{preferred,colorManagement:'linear-srgb',fallbackBehavior:'silent',onFallback:x=>fallbacks.push(String(x.reason)),webgl2:{preserveDrawingBuffer:true,clearColor:[0,0,0,0]},webgpu:{clearColor:[0,0,0,0]}});
  check((typeof renderer.gpuDevice==='function'?'webgpu':'webgl2')===preferred&&fallbacks.length===0,'managed renderer used fallback');
  renderer.render();renderer.renderPostProcess();
  initialTargets=renderer.resourceStats().renderTargetCount;check(initialTargets===legacyTargets+1,'managed mode must add exactly one scene target');
  const watch=()=>{device=renderer.gpuDevice?.();device?.addEventListener('uncapturederror',e=>errors.push(e.error.message));};watch();
  for(const [id,rgba,options]of [[1,[[255,255,255,255]],{}],[2,[[128,128,128,255]],{}],[3,[[128,128,128,128]],{}],[4,[[128,128,128,255]],{colorSpace:'none'}],[5,[[128,128,128,255]],{colorSpace:'linear'}],[6,[[0,32,128,255],[64,128,255,255],[128,192,64,255],[255,64,32,255]],{}]])await renderer.loadTexture(id,texture(rgba),options);
  const draw=async(name,commands=packet(),passes=[],material='unlit',after)=>{
   stage=name;renderer.setPostProcess(passes);renderer.setSpriteMaterial(material);renderer.setLighting(false);renderer.render();renderer.renderCommands(commands);after?.();renderer.renderPostProcess();
   await device?.queue.onSubmittedWorkDone();const pixels=await readPixels(renderer,canvas);check(errors.length===0,errors.join('\n'));
   const result={name,rgba:sample(pixels,canvas.width,canvas.height),width:canvas.width,height:canvas.height,stats:renderer.stats(),resources:renderer.resourceStats(),pixels:Array.from(pixels)};results.push(result);return result;
  };
  const roundtrip=await draw('srgb-roundtrip',packet([row(2)]));near(roundtrip.rgba,[128,128,128,255],'sRGB transfer');
  const baseline=roundtrip.resources;check(baseline.renderTargetCount===initialTargets,'asset uploads were counted as scene targets');check(roundtrip.stats.postProcessDrawCalls===1,'final transfer cost missing');
  near((await draw('data-source',packet([row(4)]))).rgba,[188,188,188,255],'data must not decode');
  near((await draw('linear-source',packet([row(5)]))).rgba,[188,188,188,255],'linear source must not decode');
  near((await draw('numeric-tint',packet([row(1,[.5,.5,.5,1])]))).rgba,[188,188,188,255],'linear tint');
  near((await draw('source-alpha',packet([row(3)]))).rgba,[64,64,64,128],'linear source alpha and premultiplied presentation');
  near((await draw('tint-alpha',packet([row(1,[1,1,1,.5])]))).rgba,[128,128,128,128],'linear alpha coverage');
  const fade={kind:'fade',color:[1,1,1],opacity:.5};
  near((await draw('transparent-fade',packet([row(2,[1,1,1,.5])]),[fade])).rgba,[102,102,102,128],'fade respects destination alpha');
  near((await draw('transparent-vignette',packet([row(2,[1,1,1,.5])]),[{kind:'vignette',color:[1,1,1,1],intensity:.5,radius:0,softness:.1}])).rgba,[102,102,102,128],'vignette respects alpha');
  near((await draw('two-fades',packet(),[{kind:'fade',color:[0,0,0],opacity:.5},{kind:'fade',color:[0,0,0],opacity:.5}])).rgba,[137,137,137,255],'one final encode');
  near((await draw('bloom-below',packet([row(2)]),[{kind:'bloom',threshold:.5,intensity:1,radius:2}])).rgba,[128,128,128,255],'scene-linear threshold');
  near((await draw('bloom-above',packet([row(1,[.6,.6,.6,1])]),[{kind:'bloom',threshold:.5,intensity:.5,radius:2}])).rgba,[208,208,208,255],'scene-linear bloom');
  const patterned=packet([row(6)]);
  await draw('crt',patterned,[{kind:'crt',curvature:.08,scanlineIntensity:.1,chromaticAberration:.02}]);
  await draw('glitch',patterned,[{kind:'glitch',intensity:.2,chromaticAberration:.03,seed:17}]);
  await draw('pixel-art',patterned,[{kind:'pixelArt',levels:8,dither:.5,scanlineIntensity:.1}]);
  await draw('transparent-pixel-art',packet([row(3)]),[{kind:'pixelArt',levels:8,dither:.5,scanlineIntensity:.1}]);
  await draw('effect-chain',patterned,[{kind:'bloom',threshold:.2,intensity:.2,radius:2},{kind:'vignette',intensity:.3,color:[.2,.5,.8,1],radius:.6,softness:.5},{kind:'glitch',intensity:.1,seed:0}]);
  const palette=textureId=>({paletteSwap:[{textureId,colors:[{from:'#808080',to:'#40c880'}]}]});
  near((await draw('srgb-palette',packet([row(2)]),[],palette(2))).rgba,[64,200,128,255],'palette encoded key and linear replacement');
  near((await draw('data-palette',packet([row(4)]),[],palette(4))).rgba,[137,229,188,255],'data palette remains numeric linear');
  near((await draw('color-mix',packet(),[],{colorMix:{color:[0,0,0,1],amount:.5}})).rgba,[188,188,188,255],'linear material mix');
  terrain=createPixelMaskTerrain({width:1,height:1,fill:'solid'});renderer.createPixelMaskTerrainTexture(7,terrain,{color:[128,128,128]});
  near((await draw('pixel-mask',packet([row(7)]))).rgba,[128,128,128,255],'pixel-mask RGB byte role');
  renderer.updatePixelMaskTerrainTexture(7,{rect:{x:0,y:0,width:1,height:1},alpha:new Uint8Array([128])},{color:[128,128,128]});
  near((await draw('pixel-mask-patch',packet([row(7)]))).rgba,[64,64,64,128],'pixel-mask alpha patch');
  const warm=await draw('warm',patterned),warmer=await draw('warmer',patterned);check(warm.resources.estimatedBytes===warmer.resources.estimatedBytes,'warm resource growth');
  renderer.setPixelPerfect({width:64,height:48});const pixel=await draw('pixel-perfect',packet([row(2)]));near(pixel.rgba,roundtrip.rgba,'pixel-perfect transfer');check(pixel.stats.presentationPassCount===1,'pixel presentation missing');
  renderer.setPixelPerfect(false);const continuous=await draw('pixel-perfect-off',packet([row(2)]));near(continuous.rgba,roundtrip.rgba,'managed target after pixel-perfect off');
  check(continuous.resources.renderTargetCount===warmer.resources.renderTargetCount,'managed target retained duplicate virtual texture');
  canvas.style.width='80px';canvas.style.height='60px';renderer.resize();await draw('resized',packet([row(2)]));canvas.style.width='64px';canvas.style.height='48px';renderer.resize();
  const resize=await draw('resize-restored',packet([row(2)]));check(resize.pixels.every((v,i)=>v===roundtrip.pixels[i]),'resize/DPR changed color');
  if(device){const before=await draw('pre-recovery',packet([row(7)]));device.destroy();await device.lost;await new Promise(r=>setTimeout(r,0));check(await renderer.recoverDevice(),'managed recovery failed');watch();const after=await draw('post-recovery',packet([row(7)]));check(after.pixels.every((v,i)=>v===before.pixels[i]),'managed recovery lost color/alpha roles');check(after.resources.estimatedBytes<=before.resources.estimatedBytes,'managed recovery leak');}
 }catch(error){failure={stage,message:error.message,stack:error.stack};}
 finally{try{terrain?.destroy();engine?.destroy();renderer?.destroy();afterDestroy=renderer?.resourceStats();}catch(error){failure??={stage:'destroy',message:error.message};}canvas.remove();}
 return {ok:!failure,legacyTargets,initialTargets,preferred,colorManagement:'linear-srgb',dpr:devicePixelRatio,results,errors,afterDestroy,...(failure?{failure}:{})};
}
