import { createRenderer } from '@ferrum2d/ferrum-web/core';
import { texture, readPixels } from './flat-lighting-contract-fixture.mjs';
const check=(v,label)=>{if(!v)throw Error(label);};
const near=(a,b,label,tolerance=3)=>check(b.every((x,i)=>Math.abs(a[i]-x)<=tolerance),`${label}: ${a} != ${b}`);
const sprite=(x,y,w,h,id,uv=[0,0,1,1],color=[1,1,1,1])=>[x,y,w,h,...uv,...color,id,0,0];
function commands(rows,modes){const words=new Uint32Array(rows.length*2),values=new Float32Array(words.buffer);modes.forEach((m,i)=>{words[i*2]=m;values[i*2+1]=m===2?.502:0;});return {buffer:Float32Array.from(rows.flat()),floatsPerCommand:15,commandCount:rows.length,spriteLightingMaterials:{version:1,stride:2,words,values}};}
const scene=commands([...[8,40,72].map((x,i)=>sprite(x,16,16,16,1,[i/3,0,(i+1)/3,1])),sprite(8,40,16,8,2),sprite(32,40,16,8,3),sprite(56,40,16,8,4)],[1,1,1,2,0,1]);
export async function probeFlatLit(preferred,colorManagement='legacy'){
 const canvas=document.createElement('canvas');canvas.style.cssText='width:96px;height:64px;display:block';canvas.dataset.spatialGpuTarget='true';document.body.append(canvas);
 let renderer,device,stage='setup';const results=[],errors=[];let failure,afterDestroy;
 try{
  renderer=await createRenderer(canvas,{preferred,colorManagement,fallbackBehavior:'silent',webgl2:{preserveDrawingBuffer:true,clearColor:[0,0,0,1]},webgpu:{clearColor:[0,0,0,1]}});
  check((typeof renderer.gpuDevice==='function'?'webgpu':'webgl2')===preferred,'Actual backend mismatch');
  const attach=()=>{device=renderer.gpuDevice?.();device?.addEventListener('uncapturederror',e=>errors.push(e.error.message));};attach();
  await renderer.loadTexture(1,texture([[0,0,0,255],[96,96,96,255],[255,255,255,255]]),{alphaMode:'straight'});
  await renderer.loadTexture(2,texture([[0,255,0,0],[0,255,0,255]]),{alphaMode:'straight'});
  await renderer.loadTexture(3,texture([[32,96,160,255]]),{alphaMode:'straight'});
  await renderer.loadTexture(4,texture([[255,255,255,128]]),{alphaMode:'straight'});
  await renderer.loadTexture(7,texture([[0,255,0,128]]),{alphaMode:'straight'});
  await renderer.loadTexture(8,texture(Array(3).fill([255,128,128,255])),{colorSpace:'none'});
  await renderer.loadTexture(5,texture([[0,0,255,128]]),{alphaMode:'straight'});
  const sample=(data,x,y)=>Array.from(data.subarray((Math.floor(y*devicePixelRatio)*canvas.width+Math.floor(x*devicePixelRatio))*4,(Math.floor(y*devicePixelRatio)*canvas.width+Math.floor(x*devicePixelRatio))*4+4));
  const draw=async(name,lighting,packet=scene,hud)=>{
   stage=name;renderer.setLighting(lighting);renderer.render();const start=performance.now();renderer.renderCommands(packet);
   if(hud){renderer.setLighting(false);renderer.renderCommands(hud);}renderer.renderPostProcess();await device?.queue.onSubmittedWorkDone();
   const pixels=await readPixels(renderer,canvas);check(!errors.length,errors.join('\n'));
   const result={name,rgba:[[16,24],[48,24],[80,24],[10,44],[20,44],[40,44],[64,44]].map(([x,y])=>sample(pixels,x,y)),stats:renderer.stats(),resources:renderer.resourceStats(),cpuSubmitAndReadbackMs:performance.now()-start};results.push(result);return {...result,pixels};
  };
  const settings={profile:'lit',ambientIrradiance:[.625,.625,.625]};
  const off=await draw('off',{...settings,enabled:false});
  const lit=await draw('ambient',settings);
  for(const [i,v]of [0,76,207].entries())near(lit.rgba[i],[v,v,v,255],'linear albedo '+i);
  near(lit.rgba[3],[0,0,0,255],'cutout hole');near(lit.rgba[4],[0,207,0,255],'cutout body');
  const excluded=colorManagement==='linear-srgb'?[32,96,160,255]:[32,96,160,255];near(lit.rgba[5],excluded,'explicit unlit');
  near(lit.rgba[6],[207,207,207,255],'opaque forces partial source alpha to one');
  check(lit.stats.normalDrawCalls>0&&lit.stats.lightingDrawCalls===3,'receiver data, ambient and two composite passes');
  check(lit.resources.renderTargetCount===off.resources.renderTargetCount+4,'four optional targets');
  const sun=await draw('ambient-sun',{profile:'lit',ambientIrradiance:[.5,.5,.5],directionalLight:{directionX:1,directionY:0,elevationRadians:Math.PI/2,color:[.25,.25,.25],intensity:.5}});for(let i=0;i<3;i++)near(sun.rgba[i],lit.rgba[i],'albedo times ambient plus sun');
  const exact=commands([sprite(40,16,16,16,7)],[2]);const cutoff=await draw('cutoff-above',settings,exact);near(cutoff.rgba[1],[0,0,0,255],'f32 cutoff .502 rejects alpha128');exact.spriteLightingMaterials.values[1]=.501;const lower=await draw('cutoff-below',settings,exact);near(lower.rgba[1],[0,207,0,255],'f32 cutoff .501 accepts alpha128');
  const normal=commands([sprite(40,16,16,16,1,[2/3,0,1,1])],[1]);normal.spriteNormalMaterials={version:1,stride:2,buffer:new Uint32Array([8,0])};
  const normalSun={profile:'lit',ambientIrradiance:[.05,.05,.05],directionalLight:{directionX:-1,directionY:0,elevationRadians:.2,color:[1,1,1],intensity:.5}};const facing=await draw('normal-facing',normalSun,normal);normal.buffer[14]=Math.PI;const turned=await draw('normal-turned',normalSun,normal);check(facing.rgba[1][0]>turned.rgba[1][0]+80,'mapped normal rotation affects real lit surface');
  const warm=await draw('warm',settings);const warmer=await draw('warmer',settings);check(warm.resources.estimatedBytes===warmer.resources.estimatedBytes,'warm allocation plateau');
  const none=commands([sprite(32,40,16,8,3)],[0]);const noReceivers=await draw('no-receivers',settings,none);check(noReceivers.stats.normalDrawCalls===0&&noReceivers.stats.lightingDrawCalls===0&&noReceivers.resources.renderTargetCount===off.resources.renderTargetCount,'no receiver extra cost');
  const restored=await draw('off-restored',{...settings,enabled:false});check(restored.pixels.every((v,i)=>v===off.pixels[i]),'OFF exact restoration');check(restored.stats.normalDrawCalls===0&&restored.stats.lightingDrawCalls===0&&restored.resources.renderTargetCount===off.resources.renderTargetCount,'OFF extra cost');
  // Unlit translucent foreground must stay blue while attenuating the lit receiver below.
  const overlay=commands([sprite(40,16,16,16,1,[2/3,0,1,1]),sprite(40,16,16,16,5)],[1,0]);
  const foreground=await draw('foreground',{profile:'lit',ambientIrradiance:[.25,.25,.25]},overlay);
  const expected=colorManagement==='linear-srgb'?[99,99,207,255]:[68,68,196,preferred==='webgl2'?191:255];near(foreground.rgba[1],expected,'unlit foreground');
  const brightForeground=await draw('SDR-bright-foreground',{profile:'lit',hdr:false,ambientIrradiance:[0,0,0],directionalLight:{directionX:1,directionY:0,elevationRadians:Math.PI/2,color:[1,1,1],intensity:4}},overlay);
  near(brightForeground.rgba[1],colorManagement==='linear-srgb'?[187,187,255,255]:[127,127,255,preferred==='webgl2'?191:255],'SDR clamp before foreground coverage');
  const A={x:32,y:24,radius:128,height:128,falloff:1,color:[1,0,0,1],intensity:.5},B={...A,x:80,y:8,color:[0,0,1,1]};
  const shadow=(lights,walls=[])=>({profile:'lit',ambientIrradiance:[.05,.05,.05],pointLights:lights,tileOccluders:walls,shadows:{color:[0,0,0,1],projectionLength:512}});
  const both=await draw('two-lights',shadow([A,B])),blocked=await draw('red-blocked',shadow([A,B],[{x:48,y:16,width:8,height:16}])),blue=await draw('blue-only',shadow([B]));
  const wall={x:48,y:16,width:8,height:16},half={...shadow([A,B],[wall]),shadows:{color:[0,0,0,.5],projectionLength:512}},single=await draw('half-shadow',half),duplicate=await draw('union-half-shadow',{...half,tileOccluders:[wall,{...wall}]});near(single.rgba[2],duplicate.rgba[2],'duplicate union',1);
  near(blocked.rgba[2],blue.rgba[2],'blocked red preserves blue');check(both.rgba[2][0]>blocked.rgba[2][0]+20&&blocked.rgba[2][2]>70,'measured per-light visibility');
  const hud=commands([sprite(32,40,16,8,3)],[0]);const withHud=await draw('HUD',settings,scene,hud);near(withHud.rgba[5],excluded,'HUD stays unchanged');
  // Failure must happen before a receiver draw changes destination or setter state.
  const before=await draw('pre-invalid',settings);let rejected=false;try{renderer.setLighting({...settings,ambient:[1,0,0,1]});}catch{rejected=true;}check(rejected,'ambiguous ambient rejected');
  const after=await draw('post-invalid',settings);check(after.pixels.every((v,i)=>v===before.pixels[i]),'invalid setter mutated rendering');
  await renderer.loadTexture(6,texture([[255,255,255,255]]));if(preferred==='webgl2'&&colorManagement==='legacy'){let failed=false;try{renderer.prepareFlatLighting(settings,[{textureId:6,lighting:{mode:'opaque'}}]);}catch{failed=true;}check(failed,'unknown/premultiplied asset accepted');}
  // Receiver metadata and exact cutoff survive encoded texture recovery.
  if(device){const before=await draw('pre-recovery',settings);device.destroy();await device.lost;await new Promise(r=>setTimeout(r,0));check(await renderer.recoverDevice(),'device recovery failed');attach();const after=await draw('post-recovery',settings);check(after.pixels.every((v,i)=>v===before.pixels[i]),'recovery pixel parity');check(after.resources.estimatedBytes<=before.resources.estimatedBytes,'recovery allocation leak');}
  canvas.style.width='120px';canvas.style.height='80px';renderer.resize();await draw('resized',settings);canvas.style.width='96px';canvas.style.height='64px';renderer.resize();const resized=await draw('resized-restored',settings);check(resized.pixels.every((v,i)=>v===lit.pixels[i]),'resize/DPR restoration');
 }catch(error){failure={stage,message:error.message,stack:error.stack};}
 finally{try{renderer?.destroy();afterDestroy=renderer?.resourceStats();}catch(error){failure??={stage:'destroy',message:error.message};}canvas.remove();}
 return {ok:!failure,preferred,colorManagement,dpr:devicePixelRatio,results,...(failure?{failure}:{}),errors,afterDestroy};
}
