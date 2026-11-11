import { createRenderer } from '@ferrum2d/ferrum-web/core';
import { texture, readPixels } from './flat-lighting-contract-fixture.mjs';
const check=(v,label)=>{if(!v)throw Error(label);};
const near=(a,b,label,tolerance=3)=>check(b.every((x,i)=>Math.abs(a[i]-x)<=tolerance),`${label}: ${a} != ${b}`);
const encode=x=>x<=.0031308?12.92*x:1.055*x**(1/2.4)-.055;
const decode=x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4;
const mapped=(rgb,alpha=1,mode='reinhard',exposure=0)=>[...rgb.map(x=>{x*=2**exposure;if(mode==='reinhard')x=x/(1+x);if(mode==='aces')x=x*(2.51*x+.03)/(x*(2.43*x+.59)+.14);return Math.round(encode(Math.max(0,Math.min(1,x)))*alpha*255);}),Math.round(alpha*255)];
const row=(id=1,color=[1,1,1,1],rect=[0,0,96,64])=>[...rect,0,0,1,1,...color,id,0,0];
function packet(rows=[row()],modes=[1]){const words=new Uint32Array(rows.length*2),values=new Float32Array(words.buffer);modes.forEach((m,i)=>words[i*2]=m);return {buffer:Float32Array.from(rows.flat()),floatsPerCommand:15,commandCount:rows.length,spriteLightingMaterials:{version:1,stride:2,words,values}};}
const lighting=(intensity=4,hdr={})=>({profile:'lit',ambientIrradiance:[0,0,0],directionalLight:{directionX:1,directionY:0,elevationRadians:Math.PI/2,color:[1,1,1],intensity},hdr});

export async function probeFlatHdr(preferred,colorManagement='legacy'){
 const canvas=document.createElement('canvas');canvas.style.cssText='width:96px;height:64px;display:block';canvas.dataset.spatialGpuTarget='true';document.body.append(canvas);
 let renderer,device,stage='setup',failure,afterDestroy;const results=[],errors=[];
 try{
  renderer=await createRenderer(canvas,{preferred,colorManagement,fallbackBehavior:'silent',webgl2:{preserveDrawingBuffer:true,clearColor:[0,0,0,0]},webgpu:{clearColor:[0,0,0,0]}});
  check((typeof renderer.gpuDevice==='function'?'webgpu':'webgl2')===preferred,'Actual backend mismatch');
  const attach=()=>{device=renderer.gpuDevice?.();device?.addEventListener('uncapturederror',e=>errors.push(e.error.message));};attach();
  for(const [id,pixels,options]of [[1,[[255,255,255,255]],{}],[2,[[0,0,255,128]],{}],[3,[[96,96,96,255]],{}],[4,[[128,128,128,255]],{colorSpace:'none'}],[5,[[8,8,8,255]],{}],[6,[[255,128,128,255]],{colorSpace:'none'}]])await renderer.loadTexture(id,texture(pixels),{alphaMode:'straight',...options});
  const sample=pixels=>{const x=Math.floor(canvas.width/2),y=Math.floor(canvas.height/2);return Array.from(pixels.subarray((y*canvas.width+x)*4,(y*canvas.width+x)*4+4));};
  const finish=async name=>{stage=name;renderer.renderPostProcess();await device?.queue.onSubmittedWorkDone();const pixels=await readPixels(renderer,canvas);check(!errors.length,errors.join('\n'));const result={name,rgba:sample(pixels),stats:renderer.stats(),resources:renderer.resourceStats()};results.push(result);return {...result,pixels};};
  const draw=async(name,settings,commands=packet(),after)=>{stage=name;renderer.setLighting(settings);renderer.render();renderer.renderCommands(commands);after?.();return finish(name);};
  const base=await draw('SDR',lighting(4,false));
  const two=await draw('radiance-two',lighting(2));near(two.rgba,mapped([2,2,2]),'radiance 2');
  const four=await draw('radiance-four',lighting(4));near(four.rgba,mapped([4,4,4]),'radiance 4');check(four.rgba[0]>two.rgba[0]+12,'HDR radiance was clamped before tone mapping');
  check(four.stats.postProcessPassCount===base.stats.postProcessPassCount+1,'one HDR output pass');
  check(four.resources.renderTargetCount===base.resources.renderTargetCount+1,'one extra HDR world target');
  check(four.resources.textureBytes===base.resources.textureBytes+canvas.width*canvas.height*12,'float world plus float albedo byte accounting');
  const exposure=await draw('exposure-minus-one',lighting(4,{exposure:-1}));near(exposure.rgba,two.rgba,'one exposure stop');
  const aces=await draw('ACES',lighting(2,{toneMapping:'aces'}));near(aces.rgba,mapped([2,2,2],1,'aces'),'ACES');
  const none=await draw('no-tone-map',lighting(4,{toneMapping:'none',exposure:-3}));near(none.rgba,mapped([4,4,4],1,'none',-3),'unclamped exposure before final clip');
  const cutoff=packet([row(2)],[2]);cutoff.spriteLightingMaterials.values[1]=.502;
  const hole=await draw('cutout-hole',lighting(),cutoff);near(hole.rgba,[0,0,0,0],'cutout discards before HDR lighting');
  cutoff.spriteLightingMaterials.values[1]=.501;const body=await draw('cutout-body',lighting(),cutoff);near(body.rgba,mapped([0,0,4]),'cutout accepted coverage');
  const normal=packet();normal.spriteNormalMaterials={version:1,stride:2,buffer:new Uint32Array([6,0])};
  const normalSettings={...lighting(),directionalLight:{...lighting().directionalLight,directionX:-1,elevationRadians:.2}};
  const facing=await draw('normal-facing',normalSettings,normal);normal.buffer[14]=Math.PI;
  const turned=await draw('normal-turned',normalSettings,normal);check(facing.rgba[0]>220&&turned.rgba[0]<3,'HDR normal data and rotated normal incidence');
  const tint=await draw('linear-tint',lighting(4),packet([row(3,[.5,.5,.5,1])],[1]));near(tint.rgba,mapped(Array(3).fill(decode(96/255)*.5*4)),'single color decode and linear tint');
  const dark=await draw('dark-albedo',lighting(4),packet([row(5)],[1]));near(dark.rgba,mapped(Array(3).fill(decode(8/255)*4)),'dark albedo float precision',1);
  const data=await draw('linear-source',lighting(4),packet([row(4)],[1]));near(data.rgba,mapped(Array(3).fill(128/255*4)),'data texture must not decode');
  const combined=packet([row(),row(2)],[1,0]);const foreground=await draw('foreground-one-packet',lighting(4),combined);
  const alpha=128/255;near(foreground.rgba,mapped([4*(1-alpha),4*(1-alpha),4*(1-alpha)+alpha]),'linear foreground accumulation');
  const split=await draw('foreground-two-packets',lighting(4),packet(),()=>renderer.renderCommands(packet([row(2)],[0])));
  near(split.rgba,foreground.rgba,'two world submissions resolve only once',1);check(split.stats.postProcessPassCount===1,'multi-packet extra HDR resolve');
  const transparent=await draw('transparent-world',lighting(4),packet([row(1,[1,1,1,.5])],[0]));near(transparent.rgba,mapped([1,1,1],.5),'unpremultiply tone map then premultiply');
  const before=await draw('before-invalid',lighting(4));
  stage='invalid-atomic';renderer.setLighting(lighting(4));renderer.render();renderer.renderCommands(packet());
  const invalids=[lighting(4,{exposure:Infinity}),lighting(4,{exposure:11}),lighting(4,{toneMapping:'bad'}),lighting(4,{exposure:1})];
  for(const value of invalids){let rejected=false;try{renderer.setLighting(value);}catch{rejected=true;}check(rejected,'invalid/late HDR change accepted');}
  const bad=packet();bad.spriteLightingMaterials={...bad.spriteLightingMaterials,version:9};let badRejected=false;try{renderer.renderCommands(bad);}catch{badRejected=true;}check(badRejected,'malformed sidecar accepted into HDR world');
  let resizedRejected=false;try{renderer.resize();}catch{resizedRejected=true;}check(resizedRejected,'resize accepted during HDR world');
  const after=await finish('after-invalid');check(after.pixels.every((v,i)=>v===before.pixels[i]),'invalid setter flushed or mutated the HDR world');
  const hud=await draw('HUD-boundary',lighting(4),packet(),()=>{renderer.setLighting(false);renderer.renderCommands(packet([row(3)],[0]));});near(hud.rgba,[96,96,96,255],'HUD excluded from HDR');check(hud.stats.postProcessPassCount===base.stats.postProcessPassCount+1,'HUD reset erased HDR resolve stats');
  check(hud.resources.renderTargetCount===base.resources.renderTargetCount-4,'disabled HDR and receiver targets released at HUD boundary');
  stage='late-enable';renderer.setLighting(false);renderer.render();renderer.renderCommands(packet([row(3)],[0]));let rejected=false;try{renderer.setLighting(lighting());}catch{rejected=true;}check(rejected,'late HDR enabled after SDR draw');const late=await finish('late-enable');near(late.rgba,[96,96,96,255],'late enable atomicity');
  const debug=await draw('debug-lines',lighting(),packet(),()=>renderer.renderPhysicsDebugLines({lineCount:1,floatsPerLine:8,buffer:Float32Array.from([-30,-20,30,-20,1,0,0,1])},{x:0,y:0}));near(debug.rgba,four.rgba,'debug pipeline retained HDR target');check(debug.stats.physicsDebugLineCount===1,'HDR debug draw not counted');
  const warm=await draw('warm',lighting()),warmer=await draw('warmer',lighting());check(warm.resources.estimatedBytes===warmer.resources.estimatedBytes,'warm allocation plateau');
  const off=await draw('HDR-off',lighting(4,{enabled:false,exposure:2,toneMapping:'aces'}));check(off.pixels.every((v,i)=>v===base.pixels[i]),'disabled HDR identity');check(off.resources.renderTargetCount===base.resources.renderTargetCount&&off.stats.postProcessPassCount===base.stats.postProcessPassCount,'disabled HDR extra target/pass');
  if(device){const before=await draw('pre-recovery',lighting());device.destroy();await device.lost;await new Promise(r=>setTimeout(r,0));check(await renderer.recoverDevice(),'HDR device recovery failed');attach();renderer.render();renderer.renderCommands(packet());const after=await finish('post-recovery');check(after.pixels.every((v,i)=>v===before.pixels[i]),'HDR recovery lost retained configuration');check(after.resources.estimatedBytes<=before.resources.estimatedBytes,'HDR recovery allocation leak');}
  canvas.style.width='120px';canvas.style.height='80px';renderer.resize();await draw('resized',lighting());canvas.style.width='96px';canvas.style.height='64px';renderer.resize();const resized=await draw('resize-restored',lighting());check(resized.pixels.every((v,i)=>v===four.pixels[i]),'HDR resize/DPR restoration');
  renderer.setPixelPerfect({width:96,height:64});const pixel=await draw('pixel-perfect',lighting());check(pixel.stats.presentationPassCount===1,'pixel perfect presentation missing');near(pixel.rgba,four.rgba,'pixel-perfect HDR parity');renderer.setPixelPerfect(false);const continuous=await draw('pixel-perfect-off',lighting());near(continuous.rgba,four.rgba,'pixel-perfect off HDR parity');
 }catch(error){failure={stage,message:error.message,stack:error.stack};}
 finally{try{renderer?.destroy();afterDestroy=renderer?.resourceStats();}catch(error){failure??={stage:'destroy',message:error.message};}canvas.remove();}
 return {ok:!failure,preferred,colorManagement,dpr:devicePixelRatio,results,...(failure?{failure}:{}),errors,afterDestroy};
}
