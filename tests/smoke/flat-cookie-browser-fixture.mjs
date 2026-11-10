import { createRenderer } from '@ferrum2d/ferrum-web/core';
import { texture, readPixels } from './flat-lighting-contract-fixture.mjs';
const check=(ok,label)=>{if(!ok)throw Error(label);};
const near=(a,b,label,t=3)=>check(b.every((v,i)=>Math.abs(v-a[i])<=t),`${label}: ${a} != ${b}`);
const encode=x=>Math.round(255*(x<=.0031308?12.92*x:1.055*x**(1/2.4)-.055));
function packet({id=1,surface,masks}={}){
 const words=new Uint32Array([1,0]),values=new Float32Array(words.buffer),result={commandCount:1,floatsPerCommand:15,buffer:new Float32Array([0,0,96,64,0,0,1,1,1,1,1,1,id,0,0]),spriteLightingMaterials:{version:1,stride:2,words,values}};
 if(masks)result.spriteLightMasks={version:1,stride:2,buffer:new Uint32Array(masks)};
 if(surface){const words=new Uint32Array(10),values=new Float32Array(words.buffer);words.set([16777215,16777215,16777215,1]);values.set([...(surface.emission??[0,0,0]),surface.specular??0,surface.roughness??1],4);result.spriteSurfaceMaterials={version:1,stride:10,words,values};}return result;
}
export async function probeFlatCookie(preferred,colorManagement='legacy'){
 const canvas=document.createElement('canvas');canvas.style.cssText='width:96px;height:64px;display:block';canvas.dataset.spatialGpuTarget='true';document.body.append(canvas);
 let renderer,device,afterDestroy,failure,stage='setup';const results=[],errors=[];
 try{
  renderer=await createRenderer(canvas,{preferred,colorManagement,fallbackBehavior:'silent',onFallback:event=>errors.push(String(event.reason)),webgl2:{preserveDrawingBuffer:true,clearColor:[0,0,0,1]},webgpu:{clearColor:[0,0,0,1]}});
  check((typeof renderer.gpuDevice==='function'?'webgpu':'webgl2')===preferred,'cookie fallback');
  const attach=()=>{device=renderer.gpuDevice?.();device?.addEventListener('uncapturederror',event=>errors.push(event.error.message));};attach();
  await renderer.loadTexture(1,texture([[255,255,255,255]]),{alphaMode:'straight'});await renderer.loadTexture(2,texture([[0,0,0,255]]),{alphaMode:'straight'});
  const data={colorSpace:'none',alphaMode:'straight'},black=[0,255,255,255],white=[255,0,0,255],half=[128,255,255,128];
  for(const [id,pixels]of [[10,[white]],[11,[black]],[12,[black,black,white,white]],[13,[white,white,black,black]],[14,[half]],[15,[black,white,black,black]]])await renderer.loadTexture(id,texture(pixels),data);
  await renderer.loadTexture(16,texture([white]),{colorSpace:'srgb',alphaMode:'straight'});
  const sample=pixels=>[[16,24],[80,24],[48,8],[48,48]].map(([x,y])=>{const at=(Math.floor(y*devicePixelRatio)*canvas.width+Math.floor(x*devicePixelRatio))*4;return Array.from(pixels.subarray(at,at+4));});
  const draw=async(name,scene,commands=packet(),later)=>{
   stage=name;if(scene!==undefined)renderer.setLighting(scene);renderer.render();renderer.renderCommands(commands);later?.();renderer.renderPostProcess();await device?.queue.onSubmittedWorkDone();
   const pixels=await readPixels(renderer,canvas);check(!errors.length,errors.join('\n'));const row={name,rgba:sample(pixels),stats:renderer.stats(),resources:renderer.resourceStats()};results.push(row);return {...row,pixels};
  };
  const same=(a,b,label)=>check(a.pixels.length===b.pixels.length&&a.pixels.every((v,i)=>v===b.pixels[i]),label);
  let saved;
  for(const hdr of [false,true]){
   const name=hdr?'hdr-':'sdr-',base={profile:'lit',ambientIrradiance:[.05,.05,.05],...(hdr?{hdr:{toneMapping:'none'}}:{})};
   const point={x:48,y:24,radius:80,height:80,falloff:1,intensity:.5,color:[1,1,1]},scene=(cookie)=>({...base,pointLights:[{...point,...(cookie?{cookie}:{})}]}),radial=await draw(name+'radial',scene());
   const whiteCookie=await draw(name+'white',scene({textureId:10}));same(radial,whiteCookie,'white cookie changed point light');
   check(whiteCookie.resources.renderTargetCount===radial.resources.renderTargetCount,'cookie added a render target');
   check(whiteCookie.stats.textureBindCount===radial.stats.textureBindCount+1,'cookie data binding missing from frame statistics');
   const dark=await draw(name+'black',scene({texture:11})),ambient=await draw(name+'ambient',{...base,pointLights:[]});same(dark,ambient,'raw red0 cookie did not remove direct light');
   const halfRow=await draw(name+'half-rgba',scene({texture:14}));
   // Pixel center, radial falloff and geometric height are evaluated independently from cookie sampling.
   const dx=80+0.5/devicePixelRatio-48,dy=.5/devicePixelRatio,d=Math.hypot(dx,dy),energy=.05+.5*(1-d/80)*80/Math.hypot(80,d)*(128/255)**2;
   near(halfRow.rgba[1],[encode(energy),encode(energy),encode(energy),255],'cookie must use straight raw R*A');
   const pattern=await draw(name+'pattern',scene({texture:12}));near(pattern.rgba[0],ambient.rgba[0],'left pattern zero');near(pattern.rgba[1],radial.rgba[1],'right pattern one');
   const flipped=await draw(name+'uv-flip',scene({texture:12,uv:[1,0,0,1]})),rotated=await draw(name+'rotation-pi',scene({texture:12,rotationRadians:Math.PI}));same(flipped,rotated,'rotation differs from independent UV flip');
   same(flipped,await draw(name+'baked-flip',scene({texture:13})),'UV flip differs from baked pattern');
   same(radial,await draw(name+'atlas-white',scene({texture:15,uv:[.25,0,.5,1]})),'cookie atlas sampled neighboring black cells');
   const quarter=await draw(name+'rotation-quarter',scene({texture:12,rotationRadians:Math.PI/2}));near(quarter.rgba[2],ambient.rgba[2],'cookie top/bottom orientation');near(quarter.rgba[3],radial.rgba[3],'rotated cookie bottom');
   const cone=await draw(name+'spot-cookie',{...base,pointLights:[{...point,spot:{directionX:1,directionY:0,angleDegrees:90},cookie:{texture:10}}]});near(cone.rgba[0],ambient.rgba[0],'cookie bypassed spot cone');near(cone.rgba[1],radial.rgba[1],'spot interior changed under white cookie');
   const emitted=packet({id:2,surface:{emission:[.1,.05,.025]}}),emission=await draw(name+'emission',scene({texture:11}),emitted);same(emission,await draw(name+'emission-reference',{...base,pointLights:[]},emitted),'cookie filtered emission');
   const reflective=packet({id:2,surface:{specular:1,roughness:.5}}),specular=await draw(name+'specular',scene({texture:12}),reflective);check(specular.rgba[0][0]===0&&specular.rgba[1][0]>5,'cookie did not filter GGX');
   const masked=await draw(name+'receiver-zero',scene({texture:10}),packet({masks:[0,255]}));same(masked,ambient,'cookie bypassed light reception');
   const red={...point,color:[1,0,0],cookie:{texture:12}},blue={...point,color:[0,0,1],cookie:{texture:12,rotationRadians:Math.PI}},pair={...base,directionalLight:{directionX:1,directionY:0,elevationRadians:Math.PI/2,color:[0,1,0],intensity:.05},pointLights:[red,blue]};
   const both=await draw(name+'two-offsets',pair),baked=await draw(name+'two-baked',{...pair,pointLights:[red,{...blue,cookie:{texture:13}}]});same(both,baked,'per-light uniform offset or texture binding leaked');
   check(both.rgba[0][2]>both.rgba[0][0]+40&&both.rgba[1][0]>both.rgba[1][2]+40,'two cookie lights not independent');
   const other={...point,x:80,y:0,color:[0,0,1],cookie:{texture:10}},walls={...base,pointLights:[red,other],tileOccluders:[{x:64,y:16,width:8,height:16}],shadows:{color:[0,0,0,1],projectionLength:512}};
   const shadow=await draw(name+'shadow-cookie',walls),blueOnly=await draw(name+'shadow-reference',{...base,pointLights:[other]});near(shadow.rgba[1],blueOnly.rgba[1],'cookie shadow removed other light');
   const bypass=await draw(name+'shadow-bypass',walls,packet({masks:[255,0]})),noShadow=await draw(name+'shadow-bypass-reference',{...walls,shadows:false});same(bypass,noShadow,'cookie ignored independent shadow mask');
   const before=await draw(name+'before-invalid',scene({texture:12}));for(const cookie of [{texture:16},{texture:999},{texture:'missing'}]){let failed=false;try{renderer.setLighting(scene(cookie));}catch{failed=true;}check(failed,'bad cookie accepted');}
   same(before,await draw(name+'after-invalid',undefined),'invalid cookie changed active lighting');
   const multi=()=>{renderer.setLighting(scene({texture:13}));renderer.renderCommands(packet());};
   const packets=await draw(name+'multi-packet',scene({texture:12}),packet(),multi),single=await draw(name+'multi-reference',scene({texture:13}));same(packets,single,'per-packet cookie parameters overwritten before submission');
   const disabled=await draw(name+'off-cookie',{...scene({texture:12}),enabled:false}),off=await draw(name+'off-reference',{...scene(),enabled:false});same(disabled,off,'OFF cookie changed world');check(disabled.stats.normalDrawCalls===0&&disabled.stats.lightingDrawCalls===0&&disabled.resources.renderTargetCount===off.resources.renderTargetCount,'OFF cookie target/pass cost');
   const warm=await draw(name+'warm',scene({texture:12})),warmer=await draw(name+'warmer',scene({texture:12}));same(warm,warmer,'warm cookie pixels unstable');check(warm.resources.estimatedBytes===warmer.resources.estimatedBytes,'cookie warm allocation growth');saved=scene({texture:12});
  }
  const original=await draw('before-replace',saved);await renderer.loadTexture(12,texture([[255,0,0,255],[255,0,0,255],[0,0,0,255],[0,0,0,255]]),data);
  const replaced=await draw('after-replace',saved);check(replaced.rgba[0][0]>original.rgba[0][0]+40,'cookie texture replacement kept stale view');
  if(!device){
   const gl=canvas.getContext('webgl2'),texture=gl.createTexture(),sampler=gl.createSampler();
   gl.activeTexture(gl.TEXTURE6);const previousTexture=gl.getParameter(gl.TEXTURE_BINDING_2D),previousSampler=gl.getParameter(gl.SAMPLER_BINDING);
   // An incomplete external texture and mip sampler expose leaked sampler bindings.
   gl.bindTexture(gl.TEXTURE_2D,texture);gl.bindSampler(6,sampler);gl.activeTexture(gl.TEXTURE0);
   try{
    await draw('external-unit6-cookie',saved);await draw('external-unit6-plain',{...saved,pointLights:saved.pointLights.map(({cookie,...light})=>light)});
    gl.activeTexture(gl.TEXTURE6);check(gl.getParameter(gl.TEXTURE_BINDING_2D)===texture&&gl.getParameter(gl.SAMPLER_BINDING)===sampler,'cookie did not restore external unit6 state');check(gl.getError()===gl.NO_ERROR,'external cookie sampler caused GL validation error');
   }finally{gl.activeTexture(gl.TEXTURE6);gl.bindTexture(gl.TEXTURE_2D,previousTexture);gl.bindSampler(6,previousSampler);gl.deleteTexture(texture);gl.deleteSampler(sampler);gl.activeTexture(gl.TEXTURE0);}
  }else{await draw('external-unit6-cookie',saved);await draw('external-unit6-plain',{...saved,pointLights:saved.pointLights.map(({cookie,...light})=>light)});}
  const before=await draw('before-recovery',saved);if(device){device.destroy();await device.lost;await new Promise(resolve=>setTimeout(resolve,0));check(await renderer.recoverDevice(),'cookie recovery');attach();}same(before,await draw('after-recovery',saved),'cookie recovery changed pattern');
  canvas.style.width='128px';renderer.resize();await draw('resized',saved);canvas.style.width='96px';renderer.resize();same(before,await draw('resize-restored',saved),'cookie resize changed pattern');
 }catch(error){failure={stage,message:error.message,stack:error.stack};}
 finally{renderer?.destroy();afterDestroy=renderer?.resourceStats();canvas.remove();}
 return {ok:!failure,preferred,colorManagement,dpr:devicePixelRatio,results,errors,afterDestroy,...(failure?{failure}:{})};
}
