import { createRenderer, createDataSceneView } from '@ferrum2d/ferrum-web/core';
import { texture, readPixels } from './flat-lighting-contract-fixture.mjs';
import { packet } from './flat-spot-browser-fixture.mjs';
const check=(ok,label)=>{if(!ok)throw Error(label);};
const near=(a,b,label,t=3)=>check(b.every((v,i)=>Math.abs(v-a[i])<=t),`${label}: ${a} != ${b}`);
const points=[[104,48],[24,48],[64,8],[64,88]];
const cross=(ax,ay,bx,by)=>ax*by-ay*bx;
function blocked(x,y,light,vertices){
 const px=x-light.x,py=y-light.y;
 for(let i=0;i<vertices.length;i++){
  const a=vertices[i],b=vertices[(i+1)%vertices.length],ax=a.x-light.x,ay=a.y-light.y,dx=b.x-a.x,dy=b.y-a.y,den=cross(px,py,dx,dy);
  if(!den)continue;const t=cross(ax,ay,dx,dy)/den,u=cross(ax,ay,px,py)/den;
  if(t>=0&&t<=1&&u>=0&&u<=1)return true;
 }return false;
}
function boundaryDistance(x,y,light,vertices){
 let closest=Infinity;
 for(let i=0;i<vertices.length;i++){
  const a=vertices[i],b=vertices[(i+1)%vertices.length];
  for(const [start,end]of [[a,b],[light,a]]){const dx=end.x-start.x,dy=end.y-start.y;closest=Math.min(closest,Math.abs(cross(dx,dy,x-start.x,y-start.y))/Math.hypot(dx,dy));}
 }return closest;
}
export async function probeFlatPolygon(preferred,colorManagement='legacy'){
 const canvas=document.createElement('canvas');canvas.style.cssText='width:128px;height:96px;display:block';canvas.dataset.spatialGpuTarget='true';document.body.append(canvas);
 let renderer,device,afterDestroy,failure,stage='setup',oracleSamples=0;const results=[],errors=[];
 try{
  renderer=await createRenderer(canvas,{preferred,colorManagement,fallbackBehavior:'silent',onFallback:event=>errors.push(String(event.reason)),webgl2:{preserveDrawingBuffer:true,clearColor:[0,0,0,1]},webgpu:{clearColor:[0,0,0,1]}});
  check((typeof renderer.gpuDevice==='function'?'webgpu':'webgl2')===preferred,'polygon fallback');
  const attach=()=>{device=renderer.gpuDevice?.();device?.addEventListener('uncapturederror',event=>errors.push(event.error.message));};attach();
  for(const [id,pixels]of [[1,[[255,255,255,255]]],[2,[[0,0,0,255]]],[3,[[255,255,255,0],[255,255,255,255]]],[4,[[0,0,255,255]]]])await renderer.loadTexture(id,texture(pixels),{alphaMode:'straight'});
  await renderer.loadTexture(7,texture([[255,0,0,255]]),{alphaMode:'straight',colorSpace:'none'});
  const sample=data=>points.map(([x,y])=>{const at=(Math.floor(y*devicePixelRatio)*canvas.width+Math.floor(x*devicePixelRatio))*4;return Array.from(data.subarray(at,at+4));});
  const draw=async(name,scene,commands=packet(),hud=false)=>{
   stage=name;if(scene!==undefined)renderer.setLighting(scene);renderer.render();renderer.renderCommands(commands);
   if(hud){renderer.setLighting(false);renderer.renderCommands(packet({id:4,mode:0,rect:[100,44,12,8]}));}
   renderer.renderPostProcess();await device?.queue.onSubmittedWorkDone();const pixels=await readPixels(renderer,canvas);check(!errors.length,errors.join('\n'));
   const row={name,rgba:sample(pixels),stats:renderer.stats(),resources:renderer.resourceStats()};results.push(row);return {...row,pixels};
  };
  const same=(a,b,label)=>check(a.pixels.length===b.pixels.length&&a.pixels.every((v,i)=>v===b.pixels[i]),label);
  let saved;
  for(const hdr of [false,true]){
   const prefix=hdr?'hdr-':'sdr-',base={profile:'lit',ambientIrradiance:[.05,.05,.05],...(hdr?{hdr:{toneMapping:'none'}}:{})},light={x:12,y:48,radius:150,height:80,falloff:1,intensity:.5};
   const polygon={vertices:[{x:48,y:24},{x:72,y:48},{x:48,y:72}]},shadows={color:[0,0,0,1],projectionLength:512},scene={...base,pointLights:[light],polygonOccluders:[polygon],shadows};
   const plain=await draw(prefix+'plain',{...scene,polygonOccluders:[]}),ambient=await draw(prefix+'ambient',{...base,pointLights:[]}),cast=await draw(prefix+'polygon',scene);
   let litCount=0,blockedCount=0;
   for(let py=1;py<canvas.height;py+=3)for(let px=1;px<canvas.width;px+=3){
    const x=(px+.5)/devicePixelRatio,y=(py+.5)/devicePixelRatio;if(boundaryDistance(x,y,light,polygon.vertices)<1.1/devicePixelRatio)continue;
    const shaded=blocked(x,y,light,polygon.vertices),at=(py*canvas.width+px)*4,reference=shaded?ambient:plain;
    near([...cast.pixels.subarray(at,at+4)],[...reference.pixels.subarray(at,at+4)],`${prefix}ray/edge oracle at ${x},${y}`);oracleSamples++;if(shaded)blockedCount++;else litCount++;
   }
   check(blockedCount>150&&litCount>150,'polygon oracle did not cover both regions');
   check(cast.stats.shadowCasterCount===1&&cast.stats.tileOccluderCount===0&&cast.stats.shadowDrawCalls>0,'polygon caster statistics');
   same(cast,await draw(prefix+'reverse',{...scene,polygonOccluders:[{vertices:[...polygon.vertices].reverse()}]}),'polygon winding changed shadow');
   const aligned={vertices:[{x:12.01,y:48},{x:72,y:48},{x:72,y:96},{x:12.01,y:96}]},edgeScene={...scene,shadows:{...shadows,projectionLength:1},polygonOccluders:[aligned]};
   same(await draw(prefix+'aligned-edge',edgeScene),await draw(prefix+'aligned-edge-reverse',{...edgeScene,polygonOccluders:[{vertices:[...aligned.vertices].reverse()}]}),'aligned tangent ray depends on polygon winding');
   same(cast,await draw(prefix+'overlap',{...scene,polygonOccluders:[polygon,structuredClone(polygon)]}),'overlap was not max-union');
   const half={...scene,shadows:{...shadows,color:[.2,.4,.6,.5]}},one=await draw(prefix+'half',half);same(one,await draw(prefix+'half-overlap',{...half,polygonOccluders:[polygon,polygon]}),'partial transmission repeated for polygon overlap');
   same(plain,await draw(prefix+'shadow-bypass',scene,packet({masks:[255,0]})),'polygon bypassed independent shadow mask');
   same(ambient,await draw(prefix+'light-zero',scene,packet({masks:[0,255]})),'polygon bypassed independent light mask');
   const red={...light,color:[1,0,0],shadowMask:1},blue={...light,x:104,color:[0,0,1],shadowMask:2},pair={...scene,pointLights:[red,blue]};
   const two=await draw(prefix+'two-lights',pair),blueOnly=await draw(prefix+'blue-reference',{...base,pointLights:[blue]});near(two.rgba[0],blueOnly.rgba[0],'polygon A shadow removed B');
   const emissionCommands=packet({id:2,surface:{emission:[.2,.1,.05]}}),emission=await draw(prefix+'emission',scene,emissionCommands);same(emission,await draw(prefix+'emission-reference',{...base,pointLights:[]},emissionCommands),'polygon filtered emission');
   const specular=await draw(prefix+'specular',scene,packet({id:2,surface:{specular:1,roughness:.5}}));check(specular.rgba[0][0]===0&&specular.rgba[1][0]>5,'polygon specular visibility');
   same(cast,await draw(prefix+'spot-cookie',{...scene,pointLights:[{...light,spot:{directionX:1,directionY:0,angleDegrees:360},cookie:{texture:7}}]}),'polygon did not compose with spot/cookie');
   const rectangle={x:48,y:24,width:24,height:48},rectScene={...scene,polygonOccluders:[],tileOccluders:[rectangle]},quad={vertices:[{x:48,y:24},{x:72,y:24},{x:72,y:72},{x:48,y:72}]};
   const oldRect=await draw(prefix+'rectangle',rectScene),newRect=await draw(prefix+'quad',{...scene,polygonOccluders:[quad]});
   for(let y=0;y<canvas.height;y++)for(let x=Math.floor(74*devicePixelRatio);x<canvas.width;x++){const at=(y*canvas.width+x)*4;near([...newRect.pixels.subarray(at,at+4)],[...oldRect.pixels.subarray(at,at+4)],'rear rectangle reference');}
   const inside={...scene,pointLights:[{...light,x:55}]};same(await draw(prefix+'inside',inside),await draw(prefix+'inside-reference',{...inside,polygonOccluders:[]}),'light inside polygon should not cast');
   const distant={vertices:polygon.vertices.map(p=>({x:p.x+1000,y:p.y}))};const culled=await draw(prefix+'culled',{...scene,polygonOccluders:[distant]});same(culled,plain,'far polygon not culled');check(culled.stats.shadowCasterCount===0,'culled polygon counted');
   const updated=structuredClone(scene);updated.polygonOccluders[0].vertices[1].x=90;
   const previous=await draw(prefix+'before-mutation',updated);updated.polygonOccluders[0].vertices[0].y=40;
   const mutated=await draw(prefix+'in-place-mutation',updated);check(mutated.pixels.some((v,i)=>v!==previous.pixels[i]),'polygon in-place mutation reused stale geometry');same(mutated,await draw(prefix+'mutation-reference',JSON.parse(JSON.stringify(updated))),'in-place polygon differs from fresh source');
   const before=await draw(prefix+'before-invalid',scene);
   for(const bad of [{vertices:new Array(4)},{vertices:[{x:0,y:0},{x:1,y:1},{x:2,y:2}]}])for(const enabled of [true,false]){let failed=false;try{renderer.setLighting({...scene,enabled,polygonOccluders:[bad]});}catch{failed=true;}check(failed,'invalid polygon accepted');}
   same(before,await draw(prefix+'after-invalid',undefined),'invalid polygon setter changed active scene');
   const warm=await draw(prefix+'warm',scene),warmer=await draw(prefix+'warmer',scene);same(warm,warmer,'warm polygon pixel drift');check(warm.resources.estimatedBytes===warmer.resources.estimatedBytes,'polygon warm allocation growth');
   const off=await draw(prefix+'off',{...scene,enabled:false}),empty=await draw(prefix+'off-reference',{...scene,enabled:false,polygonOccluders:[]});same(off,empty,'OFF polygon changed output');check(off.stats.shadowDrawCalls===0&&off.stats.lightingDrawCalls===0&&off.resources.renderTargetCount===empty.resources.renderTargetCount,'OFF polygon cost');
   const cutout=await draw(prefix+'cutout',scene,packet({id:3,mode:2}));check(cutout.rgba[1][0]===0,'polygon cutout hole filled');
   const hud=await draw(prefix+'hud',scene,packet(),true);near(hud.rgba[0],[0,0,255,255],'polygon affected HUD');saved=scene;
  }
  const view=createDataSceneView({setDataSceneCamera:()=>true,setDataSceneGroundYScale:()=>true,setViewportSize(){},cameraX:()=>64,cameraY:()=>96,cameraGroundYScale:()=>.5},
   {setViewportZoom(){},setGroundYScale(){},viewportSize:()=>renderer.viewportSize()},canvas,{x:64,y:96,groundYScale:.5});
  const world={...saved,pointLights:saved.pointLights.map(p=>({...p,y:p.y*2})),polygonOccluders:saved.polygonOccluders.map(p=>({vertices:p.vertices.map(v=>({x:v.x,y:v.y*2}))}))};
  same(await draw('world-projection',view.lighting(world)),await draw('world-reference',{...saved,pointLights:saved.pointLights.map(p=>({...p,radiusY:p.radius*.5}))}),'polygon world projection');
  const before=await draw('before-recovery',saved);if(device){device.destroy();await device.lost;await new Promise(resolve=>setTimeout(resolve,0));check(await renderer.recoverDevice(),'polygon recovery');attach();}same(before,await draw('after-recovery',saved),'polygon recovery pixel drift');
  canvas.style.width='160px';renderer.resize();await draw('resized',saved);canvas.style.width='128px';renderer.resize();same(before,await draw('resize-restored',saved),'polygon resize pixel drift');
 }catch(error){failure={stage,message:error.message,stack:error.stack};}
 finally{renderer?.destroy();afterDestroy=renderer?.resourceStats();canvas.remove();}
 return {ok:!failure,preferred,colorManagement,dpr:devicePixelRatio,results,errors,oracleSamples,afterDestroy,...(failure?{failure}:{})};
}
