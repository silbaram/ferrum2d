import { createRenderer, createFerrumRuntime, AssetLoader, srgbToLinear, linearToSrgb } from '@ferrum2d/ferrum-web/core';
import { pixels } from './flat-pixel-perfect-fixture.mjs';

const check=(value,label)=>{if(!value)throw Error('sprite palette: '+label);};
const redToGreen={from:'#ff0000',to:'#00ff00'}, blueToRed={from:'#0000ff',to:'#ff0000'};
const material={paletteSwap:[{textureId:1,colors:[redToGreen,blueToRed,{from:'#804020',to:'#4080c0'}]}, {textureId:2,colors:[{from:'#ff0000',to:'#0000ff'}]}]};
function image(normal=false) {
  const colors=normal?Array(6).fill([128,128,255,255]):[[255,0,0,255],[0,0,255,255],[128,64,32,255],[255,0,0,128],[0,255,0,0],[0,255,0,255]];
  const canvas=document.createElement('canvas');canvas.width=6;canvas.height=1;
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(colors.flat()),6,1),0,0);return canvas.toDataURL();
}
function commands({normal=false,tint=1,flags=0}={}) {
  return {commandCount:3,floatsPerCommand:15,buffer:new Float32Array([1,2,3].flatMap((id,index)=>[4,4+index*16,48,12,0,0,1,1,tint,tint,tint,1,id,flags,0])),
    ...((flags&32)?{groundShadowProjection:new Float32Array([0,1,1])}:{}),
    ...(normal?{spriteNormalMaterials:{version:1,stride:2,buffer:new Uint32Array([4,0,4,0,4,0])}}:{})};
}
function delta(a,b){check(a.length===b.length,'pixel size');let max=0;for(let i=0;i<a.length;i++)max=Math.max(max,Math.abs(a[i]-b[i]));return max;}
function rgb(data,x,y,width){return [...data.slice((y*width+x)*4,(y*width+x)*4+3)];}
function expect(actual,expected,label,tolerance=2){check(actual.every((v,i)=>Math.abs(v-expected[i])<=tolerance),`${label}: ${actual} != ${expected}`);}
function expectAlphaUnchanged(a,b,label){check(a.length===b.length,label+' size');for(let i=3;i<a.length;i+=4)check(a[i]===b[i],label+' alpha at '+i);}
function allocationCounter(owner,methods) {
  const counts={},originals=new Map();
  for(const name of methods){const original=owner[name];originals.set(name,original);counts[name]=0;owner[name]=function(...args){counts[name]++;return Reflect.apply(original,this,args);};}
  return {counts,restore(){for(const [name,original] of originals)owner[name]=original;}};
}
const packed=data=>{let text='';for(let i=0;i<data.length;i+=8192)text+=String.fromCharCode(...data.subarray(i,i+8192));return btoa(text);};

/** An unbound atlas must retain its original sampling when another texture opts in. */
export async function probePaletteSampling(preferred) {
  const canvas=document.createElement('canvas');canvas.style.cssText='display:block;width:128px;height:64px';canvas.dataset.spatialGpuTarget='true';document.body.append(canvas);
  const renderer=await createRenderer(canvas,{preferred,webgl2:{preserveDrawingBuffer:true}});
  try {
    check((typeof renderer.gpuDevice==='function')===(preferred==='webgpu'),'sampling backend');
    const atlas=document.createElement('canvas');atlas.width=4096;atlas.height=1;
    const rgba=new Uint8ClampedArray(4096*4);
    for(let x=0;x<4096;x++)rgba.set([(x*71)%256,(x*31)%256,(x*151)%256,255],x*4);
    atlas.getContext('2d').putImageData(new ImageData(rgba,4096,1),0,0);
    await renderer.loadTexture(9,atlas.toDataURL(),{colorSpace:'none'});
    let maxDelta=0;
    for(const rotation of [0,.017,.3]) {
      const cmd={commandCount:1,floatsPerCommand:15,buffer:new Float32Array([.13,.27,126.9,61.3,.01015,0,.98313,1,1,1,1,1,9,0,rotation])};
      const draw=async()=>{renderer.render();renderer.renderCommands(cmd);renderer.renderPostProcess();await renderer.gpuDevice?.().queue.onSubmittedWorkDone();return pixels(renderer,canvas);};
      renderer.setSpriteMaterial(false);const baseline=await draw();renderer.setSpriteMaterial(material);const after=await draw();
      maxDelta=Math.max(maxDelta,delta(baseline,after));
    }
    check(maxDelta===0,'unbound atlas changed precision/sampling: '+maxDelta);
    return {unboundAtlasPixelsUnchanged:true,atlasWidth:4096,rotations:3,maxDelta};
  }finally{renderer.destroy();window.disposeSpatialGpuTarget?.(canvas);canvas.remove();}
}

export async function probeSpritePalette(preferred,colorManagement='legacy') {
  const canvas=document.createElement('canvas');canvas.style.cssText='display:block;width:128px;height:64px';canvas.dataset.spatialGpuTarget='true';document.body.append(canvas);
  const errors=[];
  const renderer=await createRenderer(canvas,{preferred,colorManagement,webgl2:{preserveDrawingBuffer:true,gpuTiming:true},fallbackBehavior:'silent'});
  const gpu=typeof renderer.gpuDevice==='function';check(gpu===(preferred==='webgpu'),'requested backend unavailable');
  let device=gpu?renderer.gpuDevice():undefined;
  const watch=()=>device?.addEventListener('uncapturederror',event=>errors.push(event.error.message));watch();
  const draw=async(cmd=commands(),readback=true)=>{renderer.beginGpuTiming?.();renderer.render();const stats=renderer.renderCommands(cmd);renderer.renderPostProcess();renderer.endGpuTiming?.();await device?.queue.onSubmittedWorkDone();return {data:readback?await pixels(renderer,canvas):undefined,stats:{...stats},resources:renderer.resourceStats()};};
  let report;
  try {
    for(const id of [1,2,3])await renderer.loadTexture(id,image(),{colorSpace:colorManagement==='linear-srgb'?'srgb':'none'});
    await renderer.loadTexture(4,image(true),{colorSpace:'none'});
    // Normal rendering keeps its shader/buffers warm even when MRTs are released.
    renderer.setLighting({enabled:true,ambient:[1,1,1,1],pointLights:[]});await draw(commands({normal:true}));renderer.setLighting(false);
    const base=await draw();
    renderer.setSpriteMaterial(material);
    const swapped=await draw(), width=canvas.width, scale=devicePixelRatio;
    const at=(x,y)=>rgb(swapped.data,Math.floor(x*scale),Math.floor(y*scale),width);
    expect(at(8,8),[0,255,0],'team one red→green');expect(at(16,8),[255,0,0],'single replacement, no cascade');
    expect(at(24,8),[64,128,192],'non-primary RGB/transfer function');
    expect(at(8,24),[0,0,255],'team two independent uniform');expect(at(8,40),[255,0,0],'unbound texture unchanged');
    expect(at(40,8),rgb(base.data,Math.floor(40*scale),Math.floor(8*scale),width),'transparent texel unchanged');
    const background=at(40,8),halfExpected=background.map((channel,i)=>colorManagement==='linear-srgb'
      ?255*linearToSrgb(srgbToLinear(channel/255)*(127/255)+(i===1?128/255:0))
      :channel*(127/255)+(i===1?128:0));
    expect(at(32,8),halfExpected,'partial alpha must be preserved');
    expectAlphaUnchanged(base.data,swapped.data,'palette');
    check(swapped.stats.drawCalls===base.stats.drawCalls&&swapped.stats.drawCalls===3,'palette added draw calls');
    check(swapped.resources.textureCount===base.resources.textureCount,'palette duplicated source textures');
    const references={base:packed(base.data),swapped:packed(swapped.data)};
    const outputChannel=value=>255*(colorManagement==='linear-srgb'?linearToSrgb(value):value);
    const pixel=(data,x,y)=>rgb(data,Math.floor(x*scale),Math.floor(y*scale),width);
    const tinted=await draw(commands({tint:.5}));expect(pixel(tinted.data,8,8),[0,outputChannel(.5),0],'palette before tint');references.tint=packed(tinted.data);
    for(const [name,options] of [['outline',{outline:{color:[.2,.3,.4,1]}}],['flash',{colorMix:{color:[1,.3,.2,1],amount:.5}}],['additive',{blendMode:'additive'}]]) {
      renderer.setSpriteMaterial({...material,...options});const effect=await draw();references[name]=packed(effect.data);
      if(name==='outline')expect(pixel(effect.data,3,8),[outputChannel(.2),0,0],'outline preserves original red');
      if(name==='flash')expect(pixel(effect.data,8,8),[0,outputChannel(.65),0],'palette before colorMix tint');
      if(name==='additive')expect(pixel(effect.data,8,8),[background[0],255,background[2]],'additive palette over background');
    }
    renderer.setSpriteMaterial(false);const shadow=await draw(commands({flags:32})),primitive=await draw(commands({flags:16}));
    const collisionMaterial={paletteSwap:material.paletteSwap.map(binding=>({...binding,colors:[...binding.colors,{from:'#ffffff',to:'#ff00ff'},{from:'#8080ff',to:'#ff8080'}]}))};
    renderer.setSpriteMaterial(collisionMaterial);check(delta(shadow.data,(await draw(commands({flags:32}))).data)===0,'ground shadow recolored');check(delta(primitive.data,(await draw(commands({flags:16}))).data)===0,'procedural primitive recolored');
    const lighting={enabled:true,ambient:[.3,.3,.3,1],pointLights:[{x:30,y:8,radius:100,height:30,color:[1,1,1,1],intensity:.7}]};
    renderer.setLighting(lighting);const normal=await draw(commands({normal:true}));check(normal.stats.normalDrawCalls===3,'normal pass missing');references.normal=packed(normal.data);
    renderer.setSpriteMaterial(material);check(delta(normal.data,(await draw(commands({normal:true}))).data)===0,'palette collision changed normal direction/coverage');
    renderer.setLighting(false);
    await draw(); // Disabled lighting releases normal MRTs before the plateau baseline.
    const allocation=renderer.resourceStats(),counter=allocationCounter(device??canvas.getContext('webgl2'),gpu?['createBuffer','createRenderPipeline','createBindGroup']:['createBuffer','createProgram']);
    try{for(let i=0;i<20;i++){renderer.setSpriteMaterial(structuredClone(material));await draw(undefined,false);}}finally{counter.restore();}
    check(Object.values(counter.counts).every(count=>count===0),'equivalent provider creates GPU resources '+JSON.stringify(counter.counts));
    check(JSON.stringify(renderer.resourceStats())===JSON.stringify(allocation),'equivalent provider material reallocates/leaks');
    let rejected=false;try{renderer.setSpriteMaterial({paletteSwap:[...material.paletteSwap,...material.paletteSwap]});}catch{rejected=true;}check(rejected,'duplicate binding accepted');check(delta((await draw()).data,swapped.data)===0,'invalid update changed active material');
    if(gpu) {
      for(const [method,input] of [
        ['setSpriteMaterial',{paletteSwap:[{textureId:1,colors:[{from:'#ff0000',to:'#ffff00'}]}]}],
        ['setLighting',{enabled:true,ambient:[0,0,0,1],pointLights:[]}],
        ['setPostProcess',{kind:'fade',opacity:1}],
      ]) {
        let rejected=false;try{renderer[method](new Proxy(input,{}));}catch(error){rejected=error.name==='DataCloneError';}
        check(rejected,method+' non-cloneable input not diagnosed');check(delta((await draw()).data,swapped.data)===0,method+' failure changed live settings');
      }
      renderer.render();renderer.renderCommands(commands());await device.queue.onSubmittedWorkDone();const beforePost=await pixels(renderer,canvas);
      let postRejected=false;try{renderer.renderPostProcess(new Proxy({kind:'fade',opacity:1},{}));}catch(error){postRejected=error.name==='DataCloneError';}
      check(postRejected,'renderPostProcess clone error missing');check(delta(beforePost,await pixels(renderer,canvas))===0,'failed explicit postprocess changed frame');
      let reads=0;
      renderer.setSpriteMaterial({get paletteSwap(){reads++;return [{textureId:1,colors:[{from:'#ff0000',to:reads===1?'#ffff00':'#0000ff'}]}];}});
      check(reads===1,'live and recovery settings read different inputs');expect(pixel((await draw()).data,8,8),[255,255,0],'owned settings snapshot');renderer.setSpriteMaterial(material);
    }
    renderer.setSpriteMaterial({paletteSwap:[{textureId:1,colors:[{from:'#ff0000',to:'#ffff00'}]}]});const updated=await draw();expect(rgb(updated.data,Math.floor(8*scale),Math.floor(8*scale),width),[255,255,0],'updated palette');
    renderer.setSpriteMaterial(material);
    const maxColors=[...Array.from({length:31},(_,i)=>({from:'#'+i.toString(16).padStart(6,'0'),to:'#000000'})),redToGreen];
    renderer.setSpriteMaterial({paletteSwap:Array.from({length:64},(_,i)=>({textureId:i+1,colors:maxColors}))});
    expect(rgb((await draw()).data,Math.floor(8*scale),Math.floor(8*scale),width),[0,255,0],'32nd color / 64 binding limit');
    await renderer.loadTexture(64,image(),{colorSpace:colorManagement==='linear-srgb'?'srgb':'none'});
    const lastBinding=commands();for(let i=0;i<3;i++)lastBinding.buffer[i*15+12]=64;
    expect(pixel((await draw(lastBinding)).data,8,8),[0,255,0],'64th palette binding');renderer.evictTexture(64);
    renderer.setSpriteMaterial(material);
    let spatialRejected=false;try{renderer.renderCommands({...commands(),spatial:{}});}catch(error){spatialRejected=String(error).includes('flat 2D');}check(spatialRejected,'spatial palette must be diagnosed before drawing');
    if(gpu) {
      await renderer.loadTexture(3,image());renderer.setSpriteMaterial({paletteSwap:[{textureId:3,colors:[redToGreen]}]});
      expect(rgb((await draw()).data,Math.floor(8*scale),Math.floor(40*scale),width),[0,255,0],'WebGPU straight sRGB input');
      await renderer.loadTexture(3,image(),{colorSpace:'none'});renderer.setSpriteMaterial(material);
      for(let i=0;i<2;i++) {const old=device,generation=renderer.deviceState().generation;old.destroy();await old.lost;await new Promise(done=>setTimeout(done,0));await renderer.recoverDevice();device=renderer.gpuDevice();watch();check(renderer.deviceState().generation===generation+1,'recovery generation');check(delta((await draw()).data,swapped.data)===0,'recovery lost palette pixels');}
    } else {
      const target=renderer.createRenderTexture(100,{width:128,height:64});renderer.renderToTexture(target,commands());
      renderer.setSpriteMaterial(false);renderer.render();renderer.renderCommands({commandCount:1,floatsPerCommand:15,buffer:new Float32Array([0,0,128,64,0,0,1,1,1,1,1,1,target.textureId,0,0])});renderer.renderPostProcess();
      expect(rgb(await pixels(renderer,canvas),Math.floor(8*scale),Math.floor(8*scale),width),[0,255,0],'RenderTexture capture');
      renderer.setSpriteMaterial({paletteSwap:[{textureId:target.textureId,colors:[redToGreen]}]});
      let captureRejected=false;try{renderer.renderCommands({commandCount:1,floatsPerCommand:15,buffer:new Float32Array([0,0,8,8,0,0,1,1,1,1,1,1,target.textureId,0,0])});}catch{captureRejected=true;}check(captureRejected,'palette matched RenderTexture input');
      renderer.destroyRenderTexture(target);
      if(colorManagement==='legacy') {await renderer.loadTexture(3,image());renderer.setSpriteMaterial({paletteSwap:[{textureId:3,colors:[redToGreen]}]});let rejected=false;try{await draw();}catch(error){rejected=String(error).includes('premultiplied');}check(rejected,'legacy sRGB input needs diagnostic');await renderer.loadTexture(3,image(),{colorSpace:'none'});}
    }
    // Restore the same optional normal infrastructure after device replacement,
    // so off-state resource equality cannot hide a leaked palette allocation.
    renderer.setSpriteMaterial(material);renderer.setLighting({enabled:true,ambient:[1,1,1,1],pointLights:[]});await draw(commands({normal:true}));renderer.setLighting(false);await draw();
    renderer.setSpriteMaterial({paletteSwap:[]});const disabled=await draw();
    check(delta(disabled.data,base.data)===0,'disabled palette changed baseline');
    check(disabled.resources.programCount===base.resources.programCount&&disabled.resources.bufferCount===base.resources.bufferCount&&disabled.resources.textureCount===base.resources.textureCount,'disabled variant resources retained '+JSON.stringify({base:base.resources,disabled:disabled.resources}));
    check(disabled.stats.drawCalls===base.stats.drawCalls,'disabled cost regression');
    check(errors.length===0,errors.join('\n'));
    report={preferred,colorManagement,references,drawCalls:swapped.stats.drawCalls,textureSwitchCount:swapped.stats.textureSwitchCount,
      disabledDrawAndResourcesRestored:true,equivalentProviderAllocations:counter.counts,alphaPreserved:true,expectedEffectPixels:true,lastPaletteBindingDrawn:true,
      normalDrawCalls:normal.stats.normalDrawCalls,recoveryCycles:gpu?2:0,gpuTiming:renderer.gpuTimingStats?.(),errors};
  } catch(error) {throw Error(preferred+'/'+colorManagement+': '+String(error)+' '+errors.join('\n'));}
  finally {renderer.destroy();const resources=renderer.resourceStats();check(resources.textureCount===0&&resources.bufferCount===0&&resources.programCount===0,'destroy leaked resources');window.disposeSpatialGpuTarget?.(canvas);canvas.remove();}
  return report;
}

/** Real Rust Data Scene/GameLoop: no synthetic state, commands or profiler samples. */
export async function probePaletteRuntime(preferred) {
  const canvas=document.createElement('canvas');canvas.style.cssText='display:block;width:128px;height:96px';canvas.dataset.spatialGpuTarget='true';document.body.append(canvas);
  const renderer=await createRenderer(canvas,{preferred,webgl2:{preserveDrawingBuffer:true,gpuTiming:true}}),loader=new AssetLoader(renderer);
  const backend=typeof renderer.gpuDevice==='function'?'webgpu':'webgl2';check(backend===preferred,'native runtime backend fallback');
  await loader.loadAssets({textures:{hero:image()},textureOptions:{hero:{colorSpace:'none'}}});
  const id=loader.textureId('hero'), count=2048;
  const dataScene={format:'ferrum2d.consumer.scene-authoring',version:1,behaviorRecipes:{entities:{}},sceneComposition:{initialFragment:'main',prefabs:{object:{}},fragments:{main:{instances:Array.from({length:count},(_,i)=>({id:'sprite_'+i,prefab:'object',x:784+i%32,y:448+Math.floor(i/32),props:{components:{visual:{kind:'sprite',texture:'hero',width:1,height:1,frame:{u0:0,v0:0,u1:1/6,v1:1}},collider:'none',layer:'wall'}}}))}}}};
  let last,providerCalls=0,published=0,currentMaterial={paletteSwap:[{textureId:id,colors:[redToGreen]}]};
  const runtime=await createFerrumRuntime({canvas,renderer,assetHost:loader,dataScene,autostart:false,
    spriteMaterial:()=>{providerCalls++;return currentMaterial;},lighting:()=>false,postProcess:()=>false,
    onFrame:frame=>{last=frame;published++;}});
  const raf=requestAnimationFrame,cancel=cancelAnimationFrame,pending=new Map();let serial=0,time=0;
  globalThis.requestAnimationFrame=callback=>{pending.set(++serial,callback);return serial;};globalThis.cancelAnimationFrame=id=>pending.delete(id);
  const pump=async()=>{time+=16;const callbacks=[...pending.values()];pending.clear();check(callbacks.length===1,'GameLoop stopped');const start=performance.now();for(const callback of callbacks)callback(time);const elapsed=performance.now()-start;if(renderer.isRenderReady?.()!==false)await renderer.gpuDevice?.().queue.onSubmittedWorkDone();return elapsed;};
  try {
    runtime.start();const costs=[];
    for(let i=0;i<60;i++)costs.push(await pump());
    check(last.frame.gameState===1&&last.frame.entityCount===count,'native Playing/entities');check(last.frame.renderCommandBuffer.commandCount===count,'native command count');
    check(last.rendererStats.drawCalls<=2&&last.rendererStats.textureSwitchCount===0,'native batching budget');
    const data=await pixels(renderer,canvas);let green=0;for(let i=0;i<data.length;i+=4)if(data[i+1]>200&&data[i]<30&&data[i+2]<30)green++;
    check(green>500,'native material not visible: '+green);costs.sort((a,b)=>a-b);const p95=costs[Math.floor(costs.length*.95)];check(p95<250,'2048-sprite CPU budget '+p95);
    const recovery=[];
    if(backend==='webgpu')for(let cycle=0;cycle<2;cycle++) {
      const old=renderer.gpuDevice(), beforeProviders=providerCalls, beforePublished=published, beforeTime=last.frame.timeSeconds;
      old.destroy();await old.lost;await new Promise(done=>setTimeout(done,0));
      check(renderer.deviceState().status==='lost'&&renderer.isRenderReady()===false,'native loss state');
      currentMaterial=cycle===0?false:{paletteSwap:[{textureId:id,colors:[{from:'#ff0000',to:'#0000ff'}]}]};
      await pump();await pump();check(last.rendererStats.drawCalls===0,'lost frame submitted commands');
      const restoring=renderer.recoverDevice();check(renderer.deviceState().status==='recovering','native recovering state');
      await pump();check(providerCalls===beforeProviders,'providers applied during loss/recovery');
      check(published===beforePublished+3&&last.frame.timeSeconds>beforeTime&&last.frame.gameState===1,'native frames stopped during recovery');
      await restoring;check(renderer.isRenderReady()===true,'native readiness not restored');await pump();
      const restored=await pixels(renderer,canvas),channel=cycle===0?0:2;let matched=0;
      for(let i=0;i<restored.length;i+=4)if(restored[i+channel]>200&&restored[i+1]<30&&restored[i+(channel===0?2:0)]<30)matched++;
      check(matched>500&&providerCalls===beforeProviders+1&&last.rendererStats.drawCalls===1,'provider update not applied after recovery');
      recovery.push({disabledPalette:cycle===0,publishedWhileUnavailable:3,providersWhileUnavailable:0,matchedPixels:matched});
    }
    return {backend,playing:1,entities:last.frame.entityCount,commands:last.frame.renderCommandBuffer.commandCount,drawCalls:last.rendererStats.drawCalls,textureSwitchCount:last.rendererStats.textureSwitchCount,frames:costs.length,frameCpuP95Ms:p95,greenPixels:green,recovery,gpuTiming:renderer.gpuTimingStats?.()};
  } finally {runtime.destroy();renderer.destroy();globalThis.requestAnimationFrame=raf;globalThis.cancelAnimationFrame=cancel;window.disposeSpatialGpuTarget?.(canvas);canvas.remove();}
}
