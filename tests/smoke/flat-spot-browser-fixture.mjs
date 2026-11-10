import { createRenderer, createDataSceneView } from '@ferrum2d/ferrum-web/core';
import { texture, readPixels } from './flat-lighting-contract-fixture.mjs';
const check=(ok,label)=>{if(!ok)throw Error(label);};
const near=(a,b,label,tolerance=3)=>check(b.every((v,i)=>Math.abs(v-a[i])<=tolerance),`${label}: ${a} != ${b}`);
const points=[[104,48],[24,48],[64,8],[64,88],[98,35]];
export function packet({id=1,mode=1,surface,masks,rect=[0,0,128,96]}={}){
 const words=new Uint32Array([mode,0]),values=new Float32Array(words.buffer);if(mode===2)values[1]=.5;
 const result={commandCount:1,floatsPerCommand:15,buffer:new Float32Array([...rect,0,0,1,1,1,1,1,1,id,0,0]),spriteLightingMaterials:{version:1,stride:2,words,values}};
 if(masks)result.spriteLightMasks={version:1,stride:2,buffer:new Uint32Array(masks)};
 if(surface){const words=new Uint32Array(10),values=new Float32Array(words.buffer);words.set([16777215,16777215,16777215,1]);values.set([...(surface.emission??[0,0,0]),surface.specular??0,surface.roughness??1],4);result.spriteSurfaceMaterials={version:1,stride:10,words,values};}
 return result;
}
export async function probeFlatSpot(preferred,colorManagement='legacy'){
 const canvas=document.createElement('canvas');canvas.style.cssText='width:128px;height:96px;display:block';canvas.dataset.spatialGpuTarget='true';document.body.append(canvas);
 let renderer,device,afterDestroy,failure,stage='setup';const results=[],errors=[];
 try{
  renderer=await createRenderer(canvas,{preferred,colorManagement,fallbackBehavior:'silent',onFallback:event=>errors.push(String(event.reason)),webgl2:{preserveDrawingBuffer:true,clearColor:[0,0,0,1]},webgpu:{clearColor:[0,0,0,1]}});
  check((typeof renderer.gpuDevice==='function'?'webgpu':'webgl2')===preferred,'spot renderer fallback');
  const attach=()=>{device=renderer.gpuDevice?.();device?.addEventListener('uncapturederror',event=>errors.push(event.error.message));};attach();
  for(const [id,pixels]of [[1,[[255,255,255,255]]],[2,[[0,0,0,255]]],[3,[[255,255,255,0],[255,255,255,255]]],[4,[[0,0,255,255]]]])await renderer.loadTexture(id,texture(pixels),{alphaMode:'straight'});
  const sample=data=>points.map(([x,y])=>{const at=(Math.floor(y*devicePixelRatio)*canvas.width+Math.floor(x*devicePixelRatio))*4;return Array.from(data.subarray(at,at+4));});
  const draw=async(name,scene,commands=packet(),hud=false)=>{
   stage=name;if(scene!==undefined)renderer.setLighting(scene);renderer.render();renderer.renderCommands(commands);
   if(hud){renderer.setLighting(false);renderer.renderCommands(packet({id:4,mode:0,rect:[100,44,12,8]}));}
   renderer.renderPostProcess();await device?.queue.onSubmittedWorkDone();const pixels=await readPixels(renderer,canvas);
   check(!errors.length,errors.join('\n'));const result={name,rgba:sample(pixels),stats:renderer.stats(),resources:renderer.resourceStats()};results.push(result);return {...result,pixels};
  };
  const same=(a,b,label)=>check(a.pixels.length===b.pixels.length&&a.pixels.every((v,i)=>v===b.pixels[i]),label);
  const view=createDataSceneView({setDataSceneCamera:()=>true,setDataSceneGroundYScale:()=>true,setViewportSize(){},cameraX:()=>64,cameraY:()=>96,cameraGroundYScale:()=>.5},
   {setViewportZoom(){},setGroundYScale(){},viewportSize:()=>renderer.viewportSize()},canvas,{x:64,y:96,groundYScale:.5});
  let savedScene;
  for(const hdr of [false,true]){
   const name=hdr?'hdr-':'sdr-',base={profile:'lit',ambientIrradiance:[.05,.05,.05],...(hdr?{hdr:{toneMapping:'none'}}:{})};
   const point={x:64,y:48,radius:100,height:128,falloff:1,intensity:.5,color:[1,1,1]},spot={directionX:1,directionY:0,angleDegrees:90};
   const scene=light=>({...base,pointLights:[light]}),cone=scene({...point,spot});savedScene=cone;
   const radial=await draw(name+'radial',scene(point));
   same(radial,await draw(name+'circle360',scene({...point,spot:{...spot,angleDegrees:360}})),'full-circle hard cone changes radial light');
   const right=await draw(name+'right',cone),left=await draw(name+'left',scene({...point,spot:{...spot,directionX:-1}}));
   near(right.rgba[0],radial.rgba[0],'inside right cone');near(left.rgba[1],radial.rgba[1],'inside left cone');
   check(right.rgba[0][0]>right.rgba[1][0]+50&&left.rgba[1][0]>left.rgba[0][0]+50,'cone direction has no visible effect');
   const soft=await draw(name+'penumbra',scene({...point,spot:{...spot,penumbra:1}}));
   check(right.rgba[4][0]>soft.rgba[4][0]+5&&soft.rgba[4][0]>right.rgba[1][0]+15,'penumbra lacks bounded smooth attenuation');
   const ellipse={...point,radiusY:50},ellipseRadial=await draw(name+'ellipse-radial',scene(ellipse)),diagonal=await draw(name+'ellipse-diagonal',scene({...ellipse,spot:{...spot,directionY:1}}));
   // In range-normalized XY, the authored diagonal is (1,2): down is inside its45-degree half-cone, right is outside.
   near(diagonal.rgba[3],ellipseRadial.rgba[3],'elliptical diagonal cone rejected down receiver');
   check(ellipseRadial.rgba[0][0]>diagonal.rgba[0][0]+50,'spot direction ignored elliptical Y metric');
   const projected=await draw(name+'world-short-direction',view.lighting(scene({...point,y:96,spot:{directionX:0,directionY:1e-6,angleDegrees:90}}),view.snapshot()));
   same(projected,await draw(name+'world-direction-reference',scene({...ellipse,spot:{directionX:0,directionY:1,angleDegrees:90}})),'ground projection rejected or distorted a short valid direction');
   const zero=await draw(name+'receiver-zero',cone,packet({masks:[0,255]}));
   same(zero,await draw(name+'ambient-reference',{...base,pointLights:[]}),'cone ignored receiver light mask or ambient');
   const reflective=packet({id:2,surface:{specular:1,roughness:.5}});
   const specular=await draw(name+'specular',cone,reflective),specularRadial=await draw(name+'specular-radial',scene(point),reflective);
   near(specular.rgba[0],specularRadial.rgba[0],'cone clipped interior GGX');check(specular.rgba[0][0]>5&&specular.rgba[1][0]===0,'cone did not filter GGX outside');
   const emitted=packet({id:2,surface:{emission:[.1,.05,.025]}}),emission=await draw(name+'emission',cone,emitted);
   same(emission,await draw(name+'emission-reference',{...base,pointLights:[]},emitted),'cone changed independent emission');
   const cutout=await draw(name+'cutout',cone,packet({id:3,mode:2}));check(cutout.rgba[0][0]>100&&cutout.rgba[1][0]===0,'cone ignored alpha cutout');
   const cutoutRadial=await draw(name+'cutout-radial',scene(point),packet({id:3,mode:2}));near(cutout.rgba[0],cutoutRadial.rgba[0],'cone changed inside cutout');
   const hud=await draw(name+'hud',cone,packet(),true);near(hud.rgba[0],[0,0,255,255],'cone changed HUD');
   same(radial,await draw(name+'radial-restored',scene(point)),'stale cone parameters after detach');
   const disabled=await draw(name+'off-cone',{...cone,enabled:false}),off=await draw(name+'off-radial',{...scene(point),enabled:false});same(disabled,off,'disabled cone changed frame');
   check(disabled.stats.normalDrawCalls===0&&disabled.stats.lightingDrawCalls===0&&disabled.resources.renderTargetCount===off.resources.renderTargetCount,'OFF cone added pass or target');
   const before=await draw(name+'pre-invalid',cone);let rejected=false;try{renderer.setLighting(scene({...point,spot:{...spot,directionX:0}}));}catch{rejected=true;}check(rejected,'zero cone direction accepted');
   same(before,await draw(name+'post-invalid',undefined),'failed cone validation replaced active lighting');
   const red={...point,color:[1,0,0],spot,lightMask:1},blue={...point,x:32,y:8,color:[0,0,1],lightMask:2},pair={...base,pointLights:[red,blue]};
   const both=await draw(name+'two-lights',pair),blocked=await draw(name+'red-shadow',{...pair,tileOccluders:[{x:80,y:40,width:8,height:16}],shadows:{color:[0,0,0,1],projectionLength:512}}),blueOnly=await draw(name+'blue-reference',{...base,pointLights:[blue]});
   near(blocked.rgba[0],blueOnly.rgba[0],'cone shadow removed the other light');check(both.rgba[0][0]>blocked.rgba[0][0]+50&&blocked.rgba[0][2]>80,'cone shadow fixture lacks independent energy');
   const masked=await draw(name+'red-mask',pair,packet({masks:[1,255]})),redOnly=await draw(name+'red-reference',scene(red));same(masked,redOnly,'cone leaked other light channel');
  }
  const before=await draw('before-resize',savedScene);canvas.style.width='160px';canvas.style.height='120px';renderer.resize();await draw('resized',savedScene);canvas.style.width='128px';canvas.style.height='96px';renderer.resize();same(before,await draw('resize-restored',savedScene),'spot resize changed pixels');
  const recoveryBefore=await draw('before-recovery',savedScene);
  if(device){device.destroy();await device.lost;await new Promise(resolve=>setTimeout(resolve,0));check(await renderer.recoverDevice(),'spot recovery failed');attach();}
  same(recoveryBefore,await draw('after-recovery',savedScene),'spot recovery changed pixels');
 }catch(error){failure={stage,message:error.message,stack:error.stack};}
 finally{renderer?.destroy();afterDestroy=renderer?.resourceStats();canvas.remove();}
 return {ok:!failure,preferred,colorManagement,dpr:devicePixelRatio,results,errors,afterDestroy,...(failure?{failure}:{})};
}
