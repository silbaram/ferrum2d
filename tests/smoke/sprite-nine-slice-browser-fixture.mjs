import {createEngine, createRenderer, AssetLoader, createDataSceneView, decodeRenderCommands} from '@ferrum2d/ferrum-web/core';
import {applyDataSceneAuthoringDocument} from '@ferrum2d/ferrum-web/authoring';

const check=(value,label)=>{if(!value)throw Error(label);};
const colors=[[255,0,0],[0,255,0],[0,0,255],[255,255,0],[255,255,255],[0,255,255],[255,0,255],[128,128,128],[64,128,192]];
function atlas() {
  const canvas=document.createElement('canvas');canvas.width=32;canvas.height=24;
  const values=new Uint8ClampedArray(32*24*4);
  for(let y=0;y<24;y++)for(let x=0;x<32;x++) {
    const sx=x-8,sy=y-6,inside=sx>=0&&sx<16&&sy>=0&&sy<12;
    const color=inside?colors[(sy<3?0:sy<11?1:2)*3+(sx<2?0:sx<12?1:2)]:[255,96,0];
    values.set([...color,255],(y*32+x)*4);
  }
  canvas.getContext('2d').putImageData(new ImageData(values,32,24),0,0);return canvas.toDataURL();
}
async function readPixels(renderer,canvas) {
  if(typeof renderer.gpuDevice!=='function') {
    const gl=canvas.getContext('webgl2'),values=new Uint8Array(canvas.width*canvas.height*4);
    gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,values);check(gl.getError()===0,'GL readback');return values;
  }
  const device=renderer.gpuDevice(),texture=canvas.getContext('webgpu').getCurrentTexture(),stride=Math.ceil(canvas.width*4/256)*256;
  const buffer=device.createBuffer({size:stride*canvas.height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try {
    const encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture},{buffer,bytesPerRow:stride,rowsPerImage:canvas.height},{width:canvas.width,height:canvas.height,depthOrArrayLayers:1});device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);
    const mapped=new Uint8Array(buffer.getMappedRange()),values=new Uint8Array(canvas.width*canvas.height*4);
    for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++) {
      const a=y*stride+x*4,b=((canvas.height-1-y)*canvas.width+x)*4;values.set(mapped.subarray(a,a+4),b);
      if(texture.format.startsWith('bgra'))[values[b],values[b+2]]=[values[b+2],values[b]];
    }
    buffer.unmap();return values;
  } finally {buffer.destroy();}
}

/** CPU oracle samples the inverse full-object transform and border regions, not emitted tiles. */
function verify(pixels,canvas,options) {
  const {width=80,height=48,rotation=0,ground=1,originX=.5,originY=.5,scale=1,flipX=false,flipY=false,borderScale=3}=options;
  const w=width*scale,h=height*scale,bs=borderScale*scale,dpr=canvas.width/160;
  const horizontal=2+4,vertical=3+1;
  const left=(flipX?4:2)*bs*Math.min(1,w/(horizontal*bs)),right=(flipX?2:4)*bs*Math.min(1,w/(horizontal*bs));
  const top=(flipY?1:3)*bs*Math.min(1,h/(vertical*bs)),bottom=(flipY?3:1)*bs*Math.min(1,h/(vertical*bs));
  const co=Math.cos(rotation),si=Math.sin(rotation),dx=(.5-originX)*w,dy=(.5-originY)*h;
  const cx=80+co*dx-si*dy,cy=64+(si*dx+co*dy)*ground;
  let count=0;const seen=new Set();
  for(let py=0;py<canvas.height;py++)for(let px=0;px<canvas.width;px++) {
    const screenX=(px+.5)/dpr-cx,screenY=((py+.5)/dpr-cy)/ground;
    const x=co*screenX+si*screenY+w/2,y=-si*screenX+co*screenY+h/2;
    if(x<=0||y<=0||x>=w||y>=h)continue;
    if(Math.min(...[0,left,w-right,w].map(v=>Math.abs(x-v)),...[0,top,h-bottom,h].map(v=>Math.abs(y-v)))<.8/dpr)continue;
    let ix=x<left?0:x<w-right?1:2,iy=y<top?0:y<h-bottom?1:2;
    if(flipX)ix=2-ix;if(flipY)iy=2-iy;
    const expected=colors[iy*3+ix],at=((canvas.height-1-py)*canvas.width+px)*4;
    for(let k=0;k<3;k++)check(Math.abs(pixels[at+k]-expected[k])<=2,`pixel ${px},${py} channel ${k}: ${pixels[at+k]} != ${expected[k]} (${JSON.stringify(options)})`);
    check(pixels[at+3]===255,'opaque panel alpha changed');count++;seen.add(iy*3+ix);
  }
  check(count>8,'no independent interior pixels tested');return {pixels:count,regions:seen.size};
}

export async function probeSpriteNineSlice(preferred) {
  const canvas=document.createElement('canvas');canvas.style.cssText='width:160px;height:128px';canvas.dataset.spatialGpuTarget='true';document.body.append(canvas);
  const renderer=await createRenderer(canvas,{preferred,fallbackBehavior:'silent',webgl2:{preserveDrawingBuffer:true}});
  check((typeof renderer.gpuDevice==='function'?'webgpu':'webgl2')===preferred,'renderer silently fell back');
  const loader=new AssetLoader(renderer),device=preferred==='webgpu'?renderer.gpuDevice():undefined,errors=[];
  device?.addEventListener('uncapturederror',e=>errors.push(e.error.message));
  const raf=requestAnimationFrame,cancel=cancelAnimationFrame,pending=new Map();let token=0,time=0,engine,last,handle;
  globalThis.requestAnimationFrame=fn=>{pending.set(++token,fn);return token;};globalThis.cancelAnimationFrame=id=>pending.delete(id);
  const pump=async()=>{time+=20;const work=[...pending.values()];pending.clear();for(const fn of work)fn(time);await device?.queue.onSubmittedWorkDone();check(!errors.length,errors.join('\n'));return readPixels(renderer,canvas);};
  const cases=[{}, {flipX:true}, {flipY:true}, {flipX:true,flipY:true}, {width:9,height:6}, {rotation:Math.PI/2}, {rotation:.6}, {ground:.5,rotation:.3}, {scale:1.5,width:48,height:32}, {originX:0,originY:1,width:32,height:24,rotation:.4}];
  const results=[];
  try {
    await loader.loadAssets({textures:{panel:atlas()}});
    engine=await createEngine(frame=>{renderer.render();renderer.renderCommands(frame.renderCommandBuffer);last={state:frame.gameState,entities:frame.entityCount,commands:decodeRenderCommands(frame.renderCommandBuffer),...renderer.stats()};},()=>({}),loader,()=>renderer.viewportSize(),{fixedTimestep:false});
    const apply=options=>{
      const {width=80,height=48,scale=1,rotation=0,ground=1,originX=.5,originY=.5,flipX=false,flipY=false,borderScale=3}=options;
      const visual = {
        kind:'sprite', texture:'panel', width, height, originX, originY, projection:'ground',
        frame:{u0:.25,v0:.25,u1:.75,v1:.75},
        nineSlice:{sourceWidth:16,sourceHeight:12,left:2,right:4,top:3,bottom:1,borderScale,flipX,flipY},
      };
      const document = {
        format:'ferrum2d.consumer.scene-authoring', version:1, behaviorRecipes:{entities:{}},
        sceneComposition:{initialFragment:'main',prefabs:{panel:{}},fragments:{main:{instances:[{
          id:'panel',prefab:'panel',x:0,y:0,scale,rotationRadians:rotation,
          props:{components:{collider:'none',layer:'wall',visual}},
        }]}}},
      };
      handle=applyDataSceneAuthoringDocument(engine,document).entityHandles.panel;
      createDataSceneView(engine,renderer,canvas,{x:0,y:0,groundYScale:ground});
      check(engine.pauseDataScene(),'scene did not enter Paused');
      check(engine.resumeDataScene(),'scene did not enter Playing');
    };
    apply({});engine.start();await pump();
    for(const options of cases) {
      apply(options);await pump();const pixels=await pump();
      check(last.state===1&&last.entities===1,'slice produced simulation entities or non-playing state');
      check(last.commands.length===(options.width===9?4:9),'draw command count exceeds sliced geometry');
      check(last.drawCalls<=2&&last.textureSwitchCount<=2,'9-slice batch broke draw budget');
      results.push({options,...verify(pixels,canvas,options),commands:last.commands.length,drawCalls:last.drawCalls});
    }
    apply({});await pump();const before=await pump();
    check(!engine.configureSpriteNineSlices([{entity:handle,nineSlice:{sourceWidth:16,sourceHeight:12,left:16,right:1,top:1,bottom:1}}]),'invalid binding accepted');
    const after=await pump();check(before.every((v,i)=>v===after[i]),'failed binding changed visible pixels');
    check(engine.configureSpriteNineSlices([{entity:handle}]),'detach rejected');await pump();const stretched=await pump();
    check(last.commands.length===1,'detach did not restore ordinary sprite');check(before.some((v,i)=>v!==stretched[i]),'detach output identical to nine-slice');
    return {backend:preferred,dpr:devicePixelRatio,cases:results,atomicFailure:true,detach:true,errors};
  } finally {
    engine?.destroy();globalThis.requestAnimationFrame=raf;globalThis.cancelAnimationFrame=cancel;renderer.destroy();
    const stats=renderer.resourceStats();check(stats.textureCount===0&&stats.bufferCount===0&&stats.programCount===0,'nine-slice fixture leaked renderer resources');
    window.disposeSpatialGpuTarget?.(canvas);canvas.remove();
  }
}
