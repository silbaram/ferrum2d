import {createRenderer,srgbToLinear,linearToSrgb} from '@ferrum2d/ferrum-web/core';
import {pixels} from './flat-pixel-perfect-fixture.mjs';
const check=(value,label)=>{if(!value)throw Error('sampled postprocess: '+label);};
const delta=(a,b)=>{check(a.length===b.length,'length');let d=0;for(let i=0;i<a.length;i++)d=Math.max(d,Math.abs(a[i]-b[i]));return d;};
const effects=[{kind:'bloom',threshold:.2,intensity:.5,radius:1.25},{kind:'crt',curvature:.08,scanlineIntensity:.2,chromaticAberration:.01},
  {kind:'vignette',intensity:.7,radius:.6,softness:.2,color:[.1,.05,.2,.4]},{kind:'glitch',intensity:.08,chromaticAberration:.02,seed:13.25}];
export async function probeSampledPostProcess(preferred,virtual=false,colorManagement='legacy',partialAlpha=false) {
  const canvas=document.createElement('canvas');canvas.style.cssText='width:73px;height:55px';canvas.dataset.spatialGpuTarget='true';document.body.append(canvas);
  const renderer=await createRenderer(canvas,{preferred,colorManagement,pixelPerfect:virtual?{width:31,height:23}:false,webgl2:{preserveDrawingBuffer:true,clearColor:[0,0,0,0]},webgpu:{clearColor:[0,0,0,0]}});
  const gpu=typeof renderer.gpuDevice==='function';check(gpu===(preferred==='webgpu'),'backend fallback');let device=renderer.gpuDevice?.();const errors=[];
  const watch=()=>device?.addEventListener('uncapturederror',e=>errors.push(e.error.message));watch();
  // One source texel per logical pixel: isolate effect sampling from ambiguous nearest
  // ties when stretching an 8px sprite across an odd-sized viewport. Baseline parity
  // is asserted before any effect, so different scene input cannot hide in its tolerance.
  const source=document.createElement('canvas');source.width=virtual?31:73;source.height=virtual?23:55;
  const data=new Uint8ClampedArray(source.width*source.height*4);
  for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++) {
    const u=Math.floor(x*8/source.width),v=Math.floor(y*8/source.height);
    data.set([20+u*27,18+v*28,80+(u+v)%3*40,partialAlpha?(u===7?128:u===6?0:255):255],(y*source.width+x)*4);
  }
  source.getContext('2d').putImageData(new ImageData(data,source.width,source.height),0,0);
  const cmd={commandCount:1,floatsPerCommand:15,buffer:new Float32Array([0,0,virtual?31:73,virtual?23:55,0,0,1,1,1,1,1,1,1,0,0])};
  const draw=async(read=true)=>{renderer.render();renderer.renderCommands(cmd);
    // Capture before encoding/presentation. The final pixel-perfect alpha is forced
    // opaque and cannot be used to reconstruct a translucent linear working target.
    let linearInput;
    if(read&&colorManagement==='linear-srgb') {
      const gl=canvas.getContext('webgl2'),w=virtual?31:canvas.width,h=virtual?23:canvas.height;
      check(gl.getParameter(gl.FRAMEBUFFER_BINDING)!==null,'linear scene input FBO');
      const bottom=new Uint8Array(w*h*4);linearInput=new Uint8Array(bottom.length);
      gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,bottom);check(gl.getError()===0,'linear scene readback');
      for(let y=0;y<h;y++)linearInput.set(bottom.subarray((h-1-y)*w*4,(h-y)*w*4),y*w*4);
    }
    const stats={...renderer.renderPostProcess()};await device?.queue.onSubmittedWorkDone();check(!errors.length,errors.join('\n'));
    if(!read)return {stats};const raw=await pixels(renderer,canvas);if(!virtual)return {stats,data:raw,linearInput,width:canvas.width,height:canvas.height};
    const p=renderer.pixelPerfectPresentation(),out=new Uint8Array(p.sourceWidth*p.sourceHeight*4);
    for(let y=0;y<p.sourceHeight;y++)for(let x=0;x<p.sourceWidth;x++) {
      const at=((p.y+y*p.scale)*canvas.width+p.x+x*p.scale)*4;out.set(raw.subarray(at,at+4),(y*p.sourceWidth+x)*4);
      for(let dy=0;dy<p.scale;dy++)for(let dx=0;dx<p.scale;dx++)for(let c=0;c<4;c++)check(raw[((p.y+y*p.scale+dy)*canvas.width+p.x+x*p.scale+dx)*4+c]===raw[at+c],'nearest block');
    }
    return {stats,data:out,linearInput,width:p.sourceWidth,height:p.sourceHeight};};
  const references={};let stats;
  try {
    await renderer.loadTexture(1,source.toDataURL(),{colorSpace:colorManagement==='linear-srgb'?'srgb':'none'});const base=await draw(),initial=renderer.resourceStats();references.baseline=Array.from(base.data);
    for(const effect of effects) {
      renderer.setPostProcess(effect);const result=await draw();stats=result.stats;check(stats.postProcessPassCount===1&&stats.postProcessDrawCalls===1,'single pass cost');
      check(delta(base.data,result.data)>5,effect.kind+' unchanged');references[effect.kind]=Array.from(result.data);
      if(['bloom','vignette'].includes(effect.kind))for(let i=3;i<base.data.length;i+=4)check(base.data[i]===result.data[i],effect.kind+' alpha');
      if(partialAlpha&&!virtual&&['crt','glitch'].includes(effect.kind))verifySampledAlpha(base,result,effect);
      if(effect.kind==='crt'){check(result.data.at(-1)===255,'CRT corner opacity');check([...result.data.slice(-4,-1)].every(v=>v===0),'CRT corner black');}
      if(effect.kind==='glitch') {
        check(delta(result.data,(await draw()).data)===0,'deterministic glitch');
        renderer.setPostProcess({...effect,seed:-7.5});const changed=(await draw()).data;
        check(delta(result.data,changed)>5,'glitch ignores changed seed');references.changedSeed=Array.from(changed);
        renderer.setPostProcess(effect);check(delta(result.data,(await draw()).data)===0,'glitch seed restore');
      }
    }
    renderer.setPostProcess({kind:'bloom',threshold:1});check(delta((await draw()).data,base.data)<=1,'bloom threshold endpoint');
    renderer.setPostProcess({kind:'vignette',radius:0,intensity:.6,color:[.2,.4,.6,.5]});const uniform=(await draw()).data;
    for(let i=0;i<base.data.length;i+=4){
      const alpha=(base.linearInput??base.data)[i+3]/255;check(uniform[i+3]===base.data[i+3],'radius0 alpha');
      for(let c=0;c<3;c++) {
        const tint=[.2,.4,.6][c];
        const expected=colorManagement==='linear-srgb'
          ? (alpha>0?linearToSrgb(srgbToLinear(base.linearInput[i+c]/255)/alpha*.7+tint*.3)*alpha*255:0)
          : base.data[i+c]*.7+tint*255*.3;
        check(Math.abs(uniform[i+c]-expected)<=2,`vignette radius endpoint ${preferred} ${colorManagement} virtual=${virtual} at ${i+c}: ${uniform[i+c]} != ${expected}; base=${base.data.slice(i,i+4)}`);
      }
    }
    const stack=[{opacity:.1},...effects,{kind:'pixelArt',levels:8,dither:.2,scanlineIntensity:.1},{opacity:.15}];
    renderer.setPostProcess(stack);const combined=await draw();references.combined=Array.from(combined.data);check(combined.stats.postProcessPassCount===7,'combined order/count');
    renderer.setPostProcess([...stack].reverse());const reversed=await draw();check(delta(combined.data,reversed.data)>5,'ordered stack');references.reversed=Array.from(reversed.data);
    renderer.setPostProcess(stack);const memory=renderer.resourceStats(),owner=device??canvas.getContext('webgl2');
    const methods=gpu?['createTexture','createBuffer','createRenderPipeline','createSampler']:['createTexture','createBuffer','createProgram'],counts={},originals=new Map();
    for(const name of methods){const fn=owner[name];originals.set(name,fn);counts[name]=0;owner[name]=function(...args){counts[name]++;return Reflect.apply(fn,this,args);};}
    try{for(let i=0;i<8;i++){renderer.setPostProcess(structuredClone(stack));await draw(false);}}finally{for(const [name,fn]of originals)owner[name]=fn;}
    check(Object.values(counts).every(n=>n===0),'allocation per frame');
    if(gpu)check(memory.textureCount===initial.textureCount+1,'effects must share one copied texture');
    let rejected=false;try{renderer.setPostProcess([...stack,{kind:'bloom',threshold:2}]);}catch{rejected=true;}
    check(rejected&&delta((await draw()).data,combined.data)===0,'atomic invalid update');
    canvas.style.width='91px';canvas.style.height='69px';renderer.resize();await draw();
    if(virtual){check(renderer.resourceStats().textureBytes===memory.textureBytes,'virtual size changed');check(delta((await draw()).data,combined.data)===0,'virtual effect changed after resize');}
    canvas.style.width='73px';canvas.style.height='55px';renderer.resize();check(delta((await draw()).data,combined.data)===0,'resize restore');
    let recoveries=0;if(gpu){device.destroy();await device.lost;await new Promise(done=>setTimeout(done,0));await renderer.recoverDevice();device=renderer.gpuDevice();watch();check(delta((await draw()).data,combined.data)===0,'effect recovery');recoveries++;}
    renderer.setPostProcess(false);check(delta((await draw()).data,base.data)===0,'off restores baseline');
    if(gpu)for(const key of ['textureCount','bufferCount','programCount'])check(renderer.resourceStats()[key]===initial[key],'off resource '+key);
    const numericBoundaries=!virtual&&colorManagement==='legacy'&&!partialAlpha?await verifyNumericBoundaries(preferred):undefined;
    return {preferred,virtual,colorManagement,partialAlpha,width:base.width,height:base.height,references,drawCalls:stats.drawCalls,passCount:7,allocations:counts,recoveries,seedChangesImage:true,alphaOracle:partialAlpha&&!virtual,numericBoundaries,errors};
  } finally {renderer.destroy();const stats=renderer.resourceStats();check(stats.textureCount===0&&stats.bufferCount===0&&stats.programCount===0,'destroy');window.disposeSpatialGpuTarget?.(canvas);canvas.remove();}
}

// A fixed odd virtual target makes the center and the f32 outer-edge regression
// identical at every DPR. This uses actual shader output, not duplicated smoothstep math.
async function verifyNumericBoundaries(preferred) {
  const canvas=document.createElement('canvas');canvas.style.cssText='width:25px;height:25px';canvas.dataset.spatialGpuTarget='true';document.body.append(canvas);
  let renderer;
  try {
    renderer=await createRenderer(canvas,{preferred,pixelPerfect:{width:5,height:5},webgl2:{preserveDrawingBuffer:true}});
    check((typeof renderer.gpuDevice==='function')===(preferred==='webgpu'),'numeric boundary fallback');
    const device=renderer.gpuDevice?.(),errors=[];
    device?.addEventListener('uncapturederror',event=>errors.push(event.error.message));
    const source=document.createElement('canvas');source.width=source.height=5;
    const data=new Uint8ClampedArray(100);
    for(let y=0;y<5;y++)for(let x=0;x<5;x++)data.set([30+x*40,50+y*30,20+x*30+y*5,255],(y*5+x)*4);
    source.getContext('2d').putImageData(new ImageData(data,5,5),0,0);
    await renderer.loadTexture(1,source.toDataURL(),{colorSpace:'none'});
    const commands={commandCount:1,floatsPerCommand:15,buffer:new Float32Array([0,0,5,5,0,0,1,1,1,1,1,1,1,0,0])};
    const draw=async()=>{
      renderer.render();renderer.renderCommands(commands);const stats=renderer.renderPostProcess();
      await device?.queue.onSubmittedWorkDone();check(!errors.length,errors.join('\n'));
      const raw=await pixels(renderer,canvas),p=renderer.pixelPerfectPresentation(),output=new Uint8Array(100);
      for(let y=0;y<5;y++)for(let x=0;x<5;x++){
        const offset=((p.y+y*p.scale)*canvas.width+p.x+x*p.scale)*4;
        output.set(raw.subarray(offset,offset+4),(y*5+x)*4);
      }
      return {data:output,stats};
    };
    const baseline=await draw(),maximum=3.4028234663852886e38;
    const radius=Math.fround(Math.fround(.9)-.5),outer=[],settings={kind:'vignette',intensity:.7,radius,color:[0,0,0,1]};
    for(const softness of [1e-9,Number.MIN_VALUE]) {
      renderer.setPostProcess({...settings,softness});const result=await draw();
      const offset=(2*5+4)*4;
      for(let channel=0;channel<3;channel++)check(Math.abs(result.data[offset+channel]-baseline.data[offset+channel]*.3)<=2,'collapsed vignette outer edge');
      check(result.data[offset+3]===255&&result.stats.postProcessPassCount===1,'hard edge pass/alpha');
      outer.push(Array.from(result.data.subarray(offset,offset+4)));
    }
    renderer.setPostProcess({...settings,radius:0,softness:Number.MIN_VALUE});const all=await draw();
    for(let i=0;i<100;i+=4)for(let channel=0;channel<3;channel++)check(Math.abs(all.data[i+channel]-baseline.data[i+channel]*.3)<=2,'zero radius tiny softness');
    renderer.setPostProcess({...settings,softness:0});const disabled=await draw();
    check(delta(disabled.data,baseline.data)===0&&disabled.stats.postProcessPassCount===0,'zero softness remains disabled');
    renderer.setPostProcess({...settings,softness:.1});const accepted=await draw(),before=renderer.resourceStats();
    const invalid=[{kind:'crt',curvature:1e100},{kind:'glitch',seed:1e100},{kind:'glitch',seed:-1e100},
      {enabled:false,bloom:{intensity:0,radius:1e100}},{enabled:false,glitch:{intensity:0,chromaticAberration:0,seed:1e100}}];
    for(const input of invalid) {
      let rejected=false;try{renderer.setPostProcess(input);}catch(error){rejected=/Float32/.test(String(error));}
      check(rejected,'Float32 overflow must reject before changing the stack');
      check(delta((await draw()).data,accepted.data)===0,'Float32 rejection changed active output');
      const current=renderer.resourceStats();for(const key of ['textureCount','bufferCount','programCount'])check(current[key]===before[key],'Float32 rejection changed resource '+key);
    }
    renderer.setPostProcess({kind:'crt',curvature:maximum,scanlineIntensity:0,chromaticAberration:0});const crt=await draw();
    check(delta(crt.data.subarray(48,52),baseline.data.subarray(48,52))<=1,'finite maximum curvature must keep center fixed');
    renderer.setPostProcess({kind:'glitch',intensity:maximum,chromaticAberration:maximum,seed:13.25});const extreme=await draw();
    for(let y=0;y<5;y++)for(let x=0;x<5;x++){
      const offset=(y*5+x)*4;
      check(Math.abs(extreme.data[offset]-baseline.data[(y*5+4)*4])<=1,'maximum glitch red must sample right edge');
      check(Math.abs(extreme.data[offset+2]-baseline.data[(y*5)*4+2])<=1,'maximum glitch blue must sample left edge');
      check(extreme.data[offset+3]===255,'maximum glitch alpha');
    }
    for(const seed of [-maximum,maximum]){
      renderer.setPostProcess({kind:'glitch',seed});const first=await draw();
      check(delta(first.data,(await draw()).data)===0,'finite maximum seed must remain deterministic');
    }
    return {radius,outer,rejected:invalid.length,finiteMaximum:maximum,errors};
  } finally {
    renderer?.destroy();const resources=renderer?.resourceStats?.();
    if(resources)check(resources.textureCount===0&&resources.bufferCount===0&&resources.programCount===0,'numeric boundary cleanup');
    window.disposeSpatialGpuTarget?.(canvas);canvas.remove();
  }
}

// Legacy GL accumulates source alpha differently from WebGPU before postprocessing.
// Compare identical opaque input across backends, then check each partial-alpha pass
// against its actual scene input instead of silently changing legacy sprite blending.
function verifySampledAlpha(base,result,effect) {
  const {width,height,data}=base;
  const alpha=(u,v)=>{
    const px=u*width-.5,py=(1-v)*height-.5,x=Math.floor(px),y=Math.floor(py),fx=px-x,fy=py-y;
    const at=(xx,yy)=>data[(Math.max(0,Math.min(height-1,yy))*width+Math.max(0,Math.min(width-1,xx)))*4+3];
    return (at(x,y)*(1-fx)+at(x+1,y)*fx)*(1-fy)+(at(x,y+1)*(1-fx)+at(x+1,y+1)*fx)*fy;
  };
  const seedBits=new DataView(new ArrayBuffer(4));seedBits.setFloat32(0,effect.seed??0,true);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    let u=(x+.5)/width,v=1-(y+.5)/height,expected;
    if(effect.kind==='crt') {
      const cx=u*2-1,cy=v*2-1,r=cx*cx+cy*cy;
      u+=cx*r*effect.curvature;v+=cy*r*effect.curvature;
      expected=u<0||u>1||v<0||v>1?255:alpha(u,v);
    } else {
      let hash=Math.floor((height-y-.5)*48/height)^seedBits.getUint32(0,true);
      hash=Math.imul(hash^(hash>>>16),0x7feb352d);hash=Math.imul(hash^(hash>>>15),0x846ca68b);hash^=hash>>>16;
      u=Math.max(0,Math.min(1,u+((hash>>>8)/16777216-.5)*effect.intensity));
      expected=alpha(u,v);
    }
    check(Math.abs(result.data[(y*width+x)*4+3]-expected)<=2,`${effect.kind} sampled alpha ${x},${y}`);
  }
}
