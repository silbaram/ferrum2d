import { createRenderer, createFerrumRuntime, AssetLoader, srgbToLinear, linearToSrgb } from '@ferrum2d/ferrum-web/core';
import { pixels } from './flat-pixel-perfect-fixture.mjs';

const check = (value, label) => { if (!value) throw Error('pixel postprocess: ' + label); };
const effect = { kind: 'pixelArt', levels: 4, dither: 1, scanlineIntensity: .25 };
const matrix = [[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
function image() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8;
  const data = new Uint8ClampedArray(256);
  for (let y=0;y<8;y++) for(let x=0;x<8;x++) data.set([20+x*20,22+y*24,90,x===7?(y<4?128:0):255],(y*8+x)*4);
  canvas.getContext('2d').putImageData(new ImageData(data,8,8),0,0);
  return canvas.toDataURL();
}
function commands(width=32,height=24) {
  return { commandCount:1,floatsPerCommand:15,buffer:new Float32Array([0,0,width,height,0,0,1,1,1,1,1,1,1,0,0]) };
}
function maxDelta(a,b) { check(a.length===b.length,'size');let delta=0;for(let i=0;i<a.length;i++)delta=Math.max(delta,Math.abs(a[i]-b[i]));return delta; }
function verifyAlpha(base, output, label) {
  check(base.length===output.length,label+' size');
  for(let i=3;i<base.length;i+=4)check(base[i]===output[i],`${label} alpha at pixel ${(i-3)/4}: ${output[i]} != ${base[i]}`);
}
function verifyEffect(base, output, width, height, settings) {
  let tested=0,changed=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const i=(y*width+x)*4;
    check(output[i+3]===base[i+3],'alpha changed');
    // Opaque pixels have the same encoded RGB contract in legacy and linear-sRGB.
    if(base[i+3]!==255 || x>=Math.floor(width*7/8))continue;
    for(let c=0;c<3;c++) {
      const steps=settings.levels-1, threshold=(matrix[y%4][x%4]+.5)/16-.5;
      const quantized=Math.max(0,Math.min(steps,Math.floor(base[i+c]/255*steps+.5+threshold*(settings.dither??0))))/steps;
      const expected=Math.round(255*quantized*(y%2?1-(settings.scanlineIntensity??0):1));
      check(Math.abs(output[i+c]-expected)<=2,`oracle ${x},${y},${c}: ${output[i+c]} != ${expected}`);
      if(output[i+c]!==base[i+c])changed++;
    }
    tested++;
  }
  check(tested>100&&changed>50,'oracle did not exercise effect');
}
function virtualPixels(data,p) {
  const out=new Uint8Array(p.sourceWidth*p.sourceHeight*4);
  for(let y=0;y<p.sourceHeight;y++)for(let x=0;x<p.sourceWidth;x++) {
    const src=((p.y+y*p.scale)*p.canvasWidth+p.x+x*p.scale)*4;
    out.set(data.subarray(src,src+4),(y*p.sourceWidth+x)*4);
    for(let dy=0;dy<p.scale;dy++)for(let dx=0;dx<p.scale;dx++) {
      const at=((p.y+y*p.scale+dy)*p.canvasWidth+p.x+x*p.scale+dx)*4;
      for(let c=0;c<4;c++)check(data[at+c]===data[src+c],'effect blurred nearest block');
    }
  }
  return out;
}
export async function probePixelPostProcess(preferred, colorManagement='legacy', virtual=false) {
  const canvas=document.createElement('canvas');canvas.style.cssText='display:block;width:160px;height:120px';
  canvas.dataset.spatialGpuTarget='true';document.body.append(canvas);
  const renderer=await createRenderer(canvas,{preferred,colorManagement,
    pixelPerfect:virtual?{width:31,height:23,background:[.1,.2,.3]}:false,
    webgl2:{preserveDrawingBuffer:true,clearColor:[0,0,0,0]},webgpu:{clearColor:[0,0,0,0]}});
  const gpu=typeof renderer.gpuDevice==='function';check(gpu===(preferred==='webgpu'),'backend fallback');
  const errors=[];let device=renderer.gpuDevice?.();
  const watch=()=>device?.addEventListener('uncapturederror',e=>errors.push(e.error.message));watch();
  const cmd=commands(virtual?31:160,virtual?23:120);
  const draw=async(read=true)=>{renderer.render();renderer.renderCommands(cmd);const stats={...renderer.renderPostProcess()};await device?.queue.onSubmittedWorkDone();check(!errors.length,errors.join('\n'));return {stats,data:read?await pixels(renderer,canvas):undefined};};
  const sample=data=>virtual?virtualPixels(data,renderer.pixelPerfectPresentation()):data;
  let result;
  try {
    await renderer.loadTexture(1,image(),{colorSpace:colorManagement==='linear-srgb'?'srgb':'none'});
    const base=sample((await draw()).data), initial=renderer.resourceStats();
    renderer.setPostProcess({kind:'pixelArt',levels:4});
    const quantized=sample((await draw()).data),width=virtual?31:canvas.width,height=virtual?23:canvas.height;
    verifyEffect(base,quantized,width,height,{levels:4});
    renderer.setPostProcess(effect);const changed=await draw(), output=sample(changed.data);
    verifyEffect(base,output,width,height,effect);
    check(changed.stats.postProcessPassCount===1&&changed.stats.postProcessDrawCalls===1,'effect budget '+JSON.stringify(changed.stats));
    for(const invalid of [{kind:'pixelArt',levels:1},{levels:4},{kind:'pixelArt',typo:true},
      {pixelArt:{dither:1,typo:true}},{enabled:'false',pixelArt:{}},{enabled:false,pixelArt:{levels:1}}]) {
      let rejected=false;try{renderer.setPostProcess(invalid);}catch{rejected=true;}
      check(rejected&&maxDelta(sample((await draw()).data),output)===0,'invalid settings mutated active pass '+JSON.stringify(invalid));
    }
    renderer.setPostProcess([{kind:'pixelArt',levels:4},{kind:'pixelArt',levels:2,scanlineIntensity:.25}]);
    const stacked=await draw();
    verifyEffect(quantized,sample(stacked.data),width,height,{levels:2,scanlineIntensity:.25});
    check(stacked.stats.postProcessPassCount===2&&stacked.stats.postProcessDrawCalls===2,'stacked effect budget');
    renderer.setPostProcess(effect);
    if(gpu){let rejected=false;try{renderer.setPostProcess([effect,{kind:'bloom'}]);}catch(e){rejected=/requires the WebGL2/.test(String(e));}check(rejected,'unsupported stack silently dropped');}
    // Measure real GPU allocations only while rendering; readback owns separate buffers.
    const owner=device??canvas.getContext('webgl2'),methods=gpu?['createTexture','createBuffer','createRenderPipeline']:['createTexture','createBuffer','createProgram'];
    const counts={},originals=new Map();for(const name of methods){const fn=owner[name];originals.set(name,fn);counts[name]=0;owner[name]=function(...args){counts[name]++;return Reflect.apply(fn,this,args);};}
    try{for(let i=0;i<12;i++){renderer.setPostProcess({...effect});await draw(false);}}finally{for(const [name,fn]of originals)owner[name]=fn;}
    check(Object.values(counts).every(n=>n===0),'repeated settings allocate GPU resources');
    // Fade controls color strength; combining it with pixelArt must preserve scene coverage.
    renderer.setPostProcess({opacity:.25});const faded=sample((await draw()).data);
    verifyAlpha(base,faded,'fade');
    renderer.setPostProcess([{opacity:.25},effect]);const fadeThenPixel=sample((await draw()).data);
    verifyEffect(faded,fadeThenPixel,width,height,effect);verifyAlpha(base,fadeThenPixel,'fade then pixelArt');
    renderer.setPostProcess([effect,{opacity:.25}]);const afterFade=sample((await draw()).data);
    verifyAlpha(base,afterFade,'pixelArt then fade');
    for(let y=0;y<height;y++)for(let x=0;x<Math.floor(width*.7);x++)for(let c=0;c<3;c++) {
      const i=(y*width+x)*4+c;
      if(colorManagement==='legacy')check(Math.abs(afterFade[i]-output[i]*.75)<=2,'fade order');
    }
    renderer.setPostProcess(effect);
    if(virtual) {
      const memory=renderer.resourceStats().textureBytes;
      canvas.style.width='197px';canvas.style.height='151px';renderer.resize();
      check(maxDelta(sample((await draw()).data),output)===0,'DPR/resize changed virtual pattern');
      check(renderer.resourceStats().textureBytes===memory,'virtual target grew with CSS size');
    } else {
      canvas.style.width='112px';canvas.style.height='80px';renderer.resize();await draw();
      canvas.style.width='160px';canvas.style.height='120px';renderer.resize();
      check(maxDelta(sample((await draw()).data),output)===0,'resize restore');
    }
    let recoveries=0;
    if(gpu)for(let i=0;i<2;i++){
      device.destroy();await device.lost;await new Promise(done=>setTimeout(done,0));await renderer.recoverDevice();device=renderer.gpuDevice();watch();
      check(maxDelta(sample((await draw()).data),output)===0,'recovered effect pixels');recoveries++;
    }
    renderer.setPostProcess(false);const disabled=await draw();
    check(maxDelta(sample(disabled.data),base)===0&&disabled.stats.postProcessPassCount===0,'disabled baseline');
    if(gpu){const resources=renderer.resourceStats();for(const key of ['textureCount','bufferCount','programCount'])check(resources[key]===initial[key],'disabled resources '+key);}
    result={preferred,colorManagement,virtual,oracle:true,alphaPreserved:true,drawCalls:changed.stats.drawCalls,
      virtualSize:virtual?[31,23]:undefined,stackedPixelPasses:2,invalidShapeAtomicity:true,
      postProcessPassCount:changed.stats.postProcessPassCount,allocations:counts,recoveries,
      reference:virtual?Array.from(output):undefined,errors};
  } finally {renderer.destroy();const r=renderer.resourceStats();check(r.textureCount===0&&r.bufferCount===0&&r.programCount===0,'destroy resources');window.disposeSpatialGpuTarget?.(canvas);canvas.remove();}
  return result;
}

/** Inspect the actual sRGB8 input target, not an ideal PNG value before framebuffer quantization. */
export async function probePixelPostProcessAlpha() {
  const canvas=document.createElement('canvas');canvas.style.cssText='width:37px;height:29px';document.body.append(canvas);
  const renderer=await createRenderer(canvas,{preferred:'webgl2',colorManagement:'linear-srgb',webgl2:{preserveDrawingBuffer:true,clearColor:[0,0,0,0]}});
  const gl=canvas.getContext('webgl2');let inspected=0,maxError=0;
  try {
    const asset=document.createElement('canvas');asset.width=4;asset.height=1;
    asset.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray([171,171,171,197,128,128,128,236,90,180,50,128,0,0,0,0]),4,1),0,0);
    await renderer.loadTexture(1,asset.toDataURL(),{colorSpace:'srgb'});
    for(const settings of [{kind:'pixelArt',levels:2,dither:0,scanlineIntensity:0},{kind:'pixelArt',levels:16,dither:1,scanlineIntensity:.25}]) {
      renderer.setPostProcess(settings);renderer.render();renderer.renderCommands(commands(37,29));
      const input=new Uint8Array(canvas.width*canvas.height*4);
      check(gl.getParameter(gl.FRAMEBUFFER_BINDING)!==null,'alpha probe must read real scene FBO');
      gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,input);
      check(gl.getError()===0,'alpha input read');renderer.renderPostProcess();const output=await pixels(renderer,canvas);
      for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++) {
        const src=((canvas.height-1-y)*canvas.width+x)*4, dst=(y*canvas.width+x)*4,alpha=input[src+3]/255;
        check(output[dst+3]===input[src+3],'linear alpha coverage changed');
        for(let c=0;c<3;c++) {
          const straight=alpha>0?linearToSrgb(Math.max(0,Math.min(1,srgbToLinear(input[src+c]/255)/alpha))):0;
          const steps=settings.levels-1,threshold=(matrix[y%4][x%4]+.5)/16-.5;
          const q=Math.max(0,Math.min(steps,Math.floor(straight*steps+.5+threshold*settings.dither)))/steps;
          const expected=255*q*(y%2?1-settings.scanlineIntensity:1)*alpha;
          const delta=Math.abs(output[dst+c]-expected);maxError=Math.max(maxError,delta);
          check(delta<=2,`linear alpha oracle ${x},${y},${c}: ${output[dst+c]} != ${expected}`);
        }
        if(alpha>0&&alpha<1)inspected++;
      }
    }
    check(inspected>100,'no partial-alpha samples');return {inspected,maxError,source:'actual SRGB8_ALPHA8 framebuffer'};
  } finally {renderer.destroy();canvas.remove();}
}

export async function probePixelPostProcessRuntime(preferred) {
  const canvas=document.createElement('canvas');canvas.style.cssText='width:128px;height:96px';canvas.dataset.spatialGpuTarget='true';document.body.append(canvas);
  const renderer=await createRenderer(canvas,{preferred,webgl2:{preserveDrawingBuffer:true}}),loader=new AssetLoader(renderer);
  check((typeof renderer.gpuDevice==='function')===(preferred==='webgpu'),'native backend');
  await loader.loadAssets({textures:{hero:image()},textureOptions:{hero:{colorSpace:'none'}}});
  const count=1024;
  const dataScene={format:'ferrum2d.consumer.scene-authoring',version:1,behaviorRecipes:{entities:{}},sceneComposition:{initialFragment:'main',prefabs:{object:{}},fragments:{main:{instances:Array.from({length:count},(_,i)=>({id:'sprite_'+i,prefab:'object',x:784+i%32,y:448+Math.floor(i/32),props:{components:{visual:{kind:'sprite',texture:'hero',width:1,height:1,frame:{u0:.5,v0:0,u1:.625,v1:.125}},collider:'none',layer:'wall'}}}))}}}};
  let last;const runtime=await createFerrumRuntime({canvas,renderer,assetHost:loader,dataScene,autostart:false,postProcess:()=>effect,onFrame:frame=>{last=frame;}});
  const raf=requestAnimationFrame,cancel=cancelAnimationFrame,pending=new Map();let serial=0,time=0;
  globalThis.requestAnimationFrame=callback=>{pending.set(++serial,callback);return serial;};globalThis.cancelAnimationFrame=id=>pending.delete(id);
  try {
    runtime.start();const costs=[];
    for(let i=0;i<60;i++){time+=16;const callbacks=[...pending.values()];pending.clear();check(callbacks.length===1,'native loop');const start=performance.now();callbacks[0](time);costs.push(performance.now()-start);await renderer.gpuDevice?.().queue.onSubmittedWorkDone();}
    check(last.frame.gameState===1&&last.frame.entityCount===count&&last.frame.renderCommandBuffer.commandCount===count,'native state/size');
    check(last.rendererStats.postProcessPassCount===1&&last.rendererStats.drawCalls===2&&last.rendererStats.textureSwitchCount===0,'native cost');
    costs.sort((a,b)=>a-b);const p95=costs[57];check(p95<250,'native CPU budget');
    const data=await pixels(renderer,canvas);let colored=0;for(let i=0;i<data.length;i+=4)if(data[i]>=60&&data[i+2]>=60&&data[i+1]<3)colored++;
    check(colored>100,'native effect not visible');
    return {preferred,playing:1,entities:count,commands:count,drawCalls:2,postProcessPassCount:1,frames:60,frameCpuP95Ms:p95,coloredPixels:colored};
  } finally {runtime.destroy();renderer.destroy();globalThis.requestAnimationFrame=raf;globalThis.cancelAnimationFrame=cancel;window.disposeSpatialGpuTarget?.(canvas);canvas.remove();}
}
