import {createRenderer} from '@ferrum2d/ferrum-web/core';

const check=(value,label)=>{if(!value)throw Error(label);};
function image(pixels){const canvas=document.createElement('canvas');canvas.width=pixels.length;canvas.height=1;canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels.flat()),pixels.length,1),0,0);return canvas.toDataURL();}
const NONE=16777215;
function commands({normal=2,uv=[0,0,.5,1],rotation=0,foreground,ground=1}={}){
  const values=[32,32,64,64,...uv,1,1,1,1,1,0,rotation],materials=[normal,0];
  if(foreground!==undefined){values.push(32,32,64,64,0,0,.5,1,1,1,1,foreground,1,0,0);materials.push(NONE,0);}
  return {buffer:new Float32Array(values),commandCount:values.length/15,floatsPerCommand:15,groundYScale:ground,spriteNormalMaterials:{version:1,stride:2,buffer:new Uint32Array(materials)}};
}
async function pixels(renderer,canvas){
  if(typeof renderer.gpuDevice!=='function'){const gl=canvas.getContext('webgl2'),values=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,values);check(gl.getError()===0,'GL readback error');return values;}
  const device=renderer.gpuDevice(),texture=canvas.getContext('webgpu').getCurrentTexture(),stride=Math.ceil(canvas.width*4/256)*256;
  const buffer=device.createBuffer({size:stride*canvas.height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try{const encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture},{buffer,bytesPerRow:stride,rowsPerImage:canvas.height},{width:canvas.width,height:canvas.height,depthOrArrayLayers:1});device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);
    const mapped=new Uint8Array(buffer.getMappedRange()),values=new Uint8Array(canvas.width*canvas.height*4);
    for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){const a=y*stride+x*4,b=((canvas.height-1-y)*canvas.width+x)*4;values.set(mapped.subarray(a,a+4),b);if(texture.format.startsWith('bgra'))[values[b],values[b+2]]=[values[b+2],values[b]];}
    buffer.unmap();return values;
  }finally{buffer.destroy();}
}
function difference(a,b){let count=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>6)count++;return count;}

export async function probeSpriteNormals2D(preferred,linearFallback=false){
  const canvas=document.createElement('canvas');canvas.style.cssText='width:160px;height:128px;display:block';canvas.dataset.spatialGpuTarget='true';document.body.append(canvas);
  let fallbacks=0;
  const renderer=await createRenderer(canvas,{preferred:linearFallback?"webgpu":preferred,...(linearFallback?{colorManagement:"linear-srgb"}:{}),onFallback:()=>fallbacks++,webgl2:{preserveDrawingBuffer:true},fallbackBehavior:'silent'}),errors=[];
  const backend=typeof renderer.gpuDevice==='function'?'webgpu':'webgl2';if(linearFallback)check(fallbacks===1,'linear mode did not take supported WebGL2 fallback');check(backend===preferred,'requested renderer unavailable: '+preferred+' got '+backend);
  let device=preferred==='webgpu'?renderer.gpuDevice():undefined;device?.addEventListener('uncapturederror',event=>errors.push(event.error.message));
  const light={enabled:true,ambient:[0,0,0,0],pointLights:[{x:145,y:64,radius:200,height:40,color:[1,1,1,1],intensity:.8,falloff:1}]};
  const draw=async(command=commands(),lighting=light)=>{renderer.setLighting(lighting);renderer.render();const stats=renderer.renderCommands(command);renderer.renderPostProcess();await device?.queue.onSubmittedWorkDone();check(!errors.length,errors.join('\n'));return {pixels:await pixels(renderer,canvas),stats,resources:renderer.resourceStats()};};
  let after;
  try{
    await renderer.loadTexture(1,image([[48,48,48,255],[48,48,48,255]]));
    await renderer.loadTexture(2,image([[255,128,128,255],[0,128,128,255]]),{colorSpace:'none'});
    await renderer.loadTexture(3,image([[128,255,128,255],[128,255,128,255]]),{colorSpace:'none'});
    await renderer.loadTexture(4,image([[255,128,128,255],[255,128,128,255]]),{colorSpace:'srgb'});
    const legacyCommand=commands({normal:NONE});delete legacyCommand.spriteNormalMaterials;
    const legacy=await draw(legacyCommand),none=await draw(commands({normal:NONE}));
    check(difference(legacy.pixels,none.pixels)===0,'unmapped sidecar changes legacy output');check((none.stats.normalDrawCalls??0)===0,'unmapped frame draws a normal pass');
    const right=await draw(),left=await draw(commands({uv:[.5,0,1,1]}));
    check(right.stats.normalDrawCalls===1&&right.resources.renderTargetCount===legacy.resources.renderTargetCount+2,'normal MRT draw/resource accounting');
    const frameDifference=difference(right.pixels,left.pixels);check(frameDifference>500,'normal atlas frames must change real lighting');
    const flipped=await draw(commands({uv:[.5,0,0,1]}));check(difference(flipped.pixels,left.pixels)<10,'flipX must also flip normal basis');
    if(preferred==='webgl2'){
      const gl=canvas.getContext('webgl2');gl.disable(gl.SCISSOR_TEST);renderer.render();gl.enable(gl.SCISSOR_TEST);gl.scissor(0,0,canvas.width/2,canvas.height);
      renderer.renderCommands(commands());check(gl.isEnabled(gl.SCISSOR_TEST),'normal pass leaked scissor state');
      gl.disable(gl.SCISSOR_TEST);gl.colorMask(false,true,true,true);renderer.renderCommands(commands());check(gl.getParameter(gl.COLOR_WRITEMASK)[0]===false,'normal pass leaked color mask');gl.colorMask(true,true,true,true);
    }
    const downLight={...light,pointLights:[{...light.pointLights[0],x:64,y:145}]};
    const rotated=await draw(commands({rotation:Math.PI/2}),downLight),unrotated=await draw(commands(),downLight);check(difference(rotated.pixels,unrotated.pixels)>500,'rotation must rotate normal basis');
    const upLight={...light,pointLights:[{...light.pointLights[0],x:64,y:-20}]};
    const up=await draw(commands({normal:3}),upLight),flipY=await draw(commands({normal:3,uv:[0,1,.5,0]}),upLight);check(difference(up.pixels,flipY.pixels)>500,'flipY must flip normal basis');
    const low=await draw(commands(),{...light,pointLights:[{...light.pointLights[0],height:0}]}),high=await draw(commands(),{...light,pointLights:[{...light.pointLights[0],height:1000}]});
    check(difference(low.pixels,high.pixels)>500,'point normal height has no effect');
    const sun={enabled:true,ambient:[0,0,0,0],pointLights:[],directionalLight:{directionX:-1,directionY:0,elevationRadians:0,intensity:.8,color:[1,1,1]}};
    const horizon=await draw(commands(),sun),zenith=await draw(commands(),{...sun,directionalLight:{...sun.directionalLight,elevationRadians:Math.PI/2}});
    check(difference(horizon.pixels,zenith.pixels)>500,'sun normal elevation has no effect');
    const flatSun=await draw(legacyCommand,sun),flatZenith=await draw(legacyCommand,{...sun,directionalLight:{...sun.directionalLight,elevationRadians:Math.PI/2}});check(difference(flatSun.pixels,flatZenith.pixels)===0,'sun elevation changed unmapped legacy color');
    const covered=await draw(commands({foreground:1})),flatCovered=await draw(commands({normal:NONE,foreground:1}));check(difference(covered.pixels,flatCovered.pixels)===0,'unmapped opaque foreground must hide previous normals');
    const semi=await draw(commands({foreground:.5}));check(difference(semi.pixels,right.pixels)>100&&difference(semi.pixels,legacy.pixels)>100,'semi-transparent foreground must mix mapped coverage');
    const off=await draw(commands(),false),offFlat=await draw(legacyCommand,false);check(difference(off.pixels,offFlat.pixels)===0&&(off.stats.normalDrawCalls??0)===0,'disabled lighting must preserve unlit output/cost');
    check(off.resources.renderTargetCount===legacy.resources.renderTargetCount,'disabled normal targets retained');
    for(const invalid of [commands({normal:4}),{...commands(),spriteNormalMaterials:{version:1,stride:2,buffer:new Uint32Array([2,1])}}]){let rejected=false;try{await draw(invalid);}catch{rejected=true;}check(rejected,'invalid normal texture/record was accepted');}
    let recovery;
    if(preferred==='webgpu'){
      const before=await draw();let restoredBytes;
      for(let cycle=0;cycle<2;cycle++){
        const old=device,generation=renderer.deviceState().generation;old.destroy();await old.lost;await new Promise(done=>setTimeout(done,0));
        check(renderer.deviceState().status==='lost','normal device loss not observed');const restoring=renderer.recoverDevice();check(restoring===renderer.recoverDevice(),'normal recovery did not coalesce');await restoring;
        device=renderer.gpuDevice();device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
        const after=await draw();check(renderer.deviceState().generation===generation+1&&difference(before.pixels,after.pixels)===0,'normal recovery changed pixels');
        check(after.stats.normalDrawCalls===1&&after.resources.renderTargetCount===before.resources.renderTargetCount&&after.resources.estimatedBytes<=before.resources.estimatedBytes&&(restoredBytes===undefined||restoredBytes===after.resources.estimatedBytes),'normal recovery leaked GPU allocations '+JSON.stringify({before:before.resources,after:after.resources}));
        restoredBytes=after.resources.estimatedBytes;
      }
      recovery={cycles:2,pixelParity:true,allocationPlateau:true};
    }
    await draw(legacyCommand);check(!errors.length,errors.join('\n'));
    return {backend,linearFallback,...(recovery?{recovery}:{}),frameDifference,normalDrawCalls:right.stats.normalDrawCalls,normalTargetBytes:160*128*devicePixelRatio**2*8,legacyPreserved:true,pointHeightAndSunElevation:true,flipRotation:true,foregroundCoverage:true,disabledCostZero:true,errors};
  }finally{renderer.destroy();if(preferred==='webgl2'){const gl=canvas.getContext('webgl2');check(gl.getParameter(gl.CURRENT_PROGRAM)===null,'destroy left a deleted current program for the next renderer');check(gl.getError()===0,'destroy introduced GL errors');}after=renderer.resourceStats();check(after.textureCount===0&&after.bufferCount===0&&after.programCount===0,'renderer resources leaked on destroy '+JSON.stringify(after));window.disposeSpatialGpuTarget?.(canvas);canvas.remove();}
}

/** Real Wasm animation sidecar + common camera metric, independent of editor preview. */
export async function probeSpriteNormalRuntime2D(preferred) {
  const {createEngine,AssetLoader,createDataSceneView,decodeRenderCommands}=await import('@ferrum2d/ferrum-web/core');
  const {applyDataSceneAuthoringDocument}=await import('@ferrum2d/ferrum-web/authoring');
  const canvas=document.createElement('canvas');canvas.style.cssText='width:160px;height:128px';canvas.dataset.spatialGpuTarget='true';document.body.append(canvas);
  const renderer=await createRenderer(canvas,{preferred,webgl2:{preserveDrawingBuffer:true},fallbackBehavior:'silent'}),loader=new AssetLoader(renderer);
  const errors=[];const device=preferred==='webgpu'?renderer.gpuDevice():undefined;device?.addEventListener('uncapturederror',e=>errors.push(e.error.message));
  const raf=requestAnimationFrame,cancel=cancelAnimationFrame,pending=new Map();let token=0,engine,view,last,scene,time=0;
  globalThis.requestAnimationFrame=callback=>{pending.set(++token,callback);return token;};globalThis.cancelAnimationFrame=id=>pending.delete(id);
  const pump=async()=>{time+=20;const work=[...pending.values()];pending.clear();for(const callback of work)callback(time);await device?.queue.onSubmittedWorkDone();check(!errors.length,errors.join('\n'));return pixels(renderer,canvas);};
  const frames=[{u0:0,v0:0,u1:.5,v1:1},{u0:.5,v0:0,u1:1,v1:1}],samples=new Map();
  const base={format:'ferrum2d.consumer.scene-authoring',version:1,behaviorRecipes:{entities:{}},
    sceneComposition:{initialFragment:'main',prefabs:{object:{}},fragments:{main:{instances:[{id:'hero',prefab:'object',x:0,y:0,props:{components:{collider:'none',layer:'wall',visual:{kind:'sprite',texture:'color',normalTexture:'normal',width:64,height:64,originX:.5,originY:.5,animationSet:{initialClip:7,clips:[{id:7,fps:10,loop:false,frames}]}}}}}]}}},
    lighting:{ambient:[0,0,0,0],pointLights:[{x:80,y:0,radius:200,height:40,intensity:.8,color:[1,1,1,1],falloff:1}]}};
  const apply=(document,options={})=>{scene=document;const result=applyDataSceneAuthoringDocument(engine,document);view=createDataSceneView(engine,renderer,canvas,{x:options.x??0,y:0,groundYScale:options.g??1,zoom:options.zoom??1});engine.pauseDataScene();return result.entityHandles.hero;};
  try {
    await loader.loadAssets({textures:{color:image([[48,48,48,255],[48,48,48,255]]),normal:image([[255,128,128,255],[0,128,128,255]])},textureOptions:{normal:{colorSpace:'none'}}});
    engine=await createEngine(frame=>{renderer.setLighting(view?view.lighting(scene.lighting,view.snapshot(frame)):false);renderer.render();renderer.renderCommands(frame.renderCommandBuffer);
      const commands=decodeRenderCommands(frame.renderCommandBuffer),sidecar=frame.renderCommandBuffer.spriteNormalMaterials;
      last={state:frame.gameState,entities:frame.entityCount,uv:commands[0]?.uv,sidecar:sidecar?Array.from(sidecar.buffer):undefined,...renderer.stats()};
    },()=>({}),loader,()=>renderer.viewportSize(),{fixedTimestep:false});
    const size=renderer.viewportSize();engine.setViewportSize(size.width,size.height);const handle=apply(base);engine.start();await pump();await pump();
    check(engine.resumeDataScene(),'normal runtime failed to enter Playing');
    for(let i=0;i<18;i++){
      const output=await pump(),state=engine.dataSceneSpriteAnimationState(handle);
      check(last.state===1&&last.entities===1&&last.normalDrawCalls===1&&last.drawCalls<=8&&last.textureSwitchCount<=4,'runtime state or normal cost budget differs');
      check(last.sidecar?.[0]===engine.textureId('normal')&&last.sidecar[1]===0,'Wasm sorted normal sidecar is missing');
      check(last.uv.every((value,index)=>Math.abs(value-Object.values(frames[state.frame])[index])<1e-6),'runtime atlas UV differs');
      if(!samples.has(state.frame))samples.set(state.frame,output);
    }
    check(samples.size===2&&engine.dataSceneSpriteAnimationState(handle).finished,'native normal animation did not finish');
    let frameDifference=difference(...samples.values());check(frameDifference>500,'actual Wasm frame normals did not change lighting');
    for(const [frame,output] of samples){const expected=structuredClone(base),visual=expected.sceneComposition.fragments.main.instances[0].props.components.visual;delete visual.animationSet;visual.frame=frames[frame];apply(expected);await pump();const actual=await pump();check(difference(actual,output)===0,'animated normal UV differs from independent static scene');}
    // Pan and ground compression use the same logical light metric as command geometry.
    const staticScene=structuredClone(base),visual=staticScene.sceneComposition.fragments.main.instances[0].props.components.visual;delete visual.animationSet;visual.frame=frames[0];
    const camera=[];
    for(const options of [{x:0,g:1,zoom:1},{x:12,g:.5,zoom:1},{x:0,g:1,zoom:.75}]){
      apply(staticScene,options);await pump();const mapped=await pump(),stats={...last};
      const flat=structuredClone(staticScene);delete flat.sceneComposition.fragments.main.instances[0].props.components.visual.normalTexture;apply(flat,options);await pump();const unlit=await pump();
      const changed=difference(mapped,unlit);check(changed>300&&stats.normalDrawCalls===1&&(last.normalDrawCalls??0)===0,'camera metric lost normal response');camera.push({options,changed,normalDrawCalls:stats.normalDrawCalls});
    }
    return {wasmAnimation:true,finished:true,frames:samples.size,frameDifference,staticUVParity:true,playingState:1,camera,errors};
  } finally {engine?.destroy();renderer.destroy();globalThis.requestAnimationFrame=raf;globalThis.cancelAnimationFrame=cancel;const after=renderer.resourceStats();check(after.textureCount===0&&after.bufferCount===0&&after.programCount===0,'runtime resource leak');window.disposeSpatialGpuTarget?.(canvas);canvas.remove();}
}
