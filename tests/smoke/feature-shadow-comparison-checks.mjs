import assert from "node:assert/strict";

/** Native world receivers projected through the displayed camera, with actual GL/GPU readback. */
export async function checkShadowComparison({page,control,snapshot,pixelHash,artifactDir}){
  const render=async action=>{const before=(await snapshot()).renderedFrames;await action();await page.waitForFunction(n=>window.ferrumFeatureLab.snapshot().renderedFrames>n,before);return snapshot();};
  const range=(key,value)=>render(()=>control(key).evaluate((input,value)=>{input.value=String(value);input.dispatchEvent(new Event("input",{bubbles:true}));},value));
  const points=Array.from({length:41*29},(_,i)=>({x:-72+(i%41)*6,y:-30+Math.floor(i/41)*6}));
  const sample=()=>page.evaluate(async points=>{
    const canvas=document.querySelector("canvas"),device=window.playgroundGpuDevice;
    const projected=window.ferrumFeatureLab.projectGround(points);let bytes,stride;
    if(!device){const gl=canvas.getContext("webgl2");stride=canvas.width*4;bytes=new Uint8Array(stride*canvas.height);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,bytes);if(gl.getError())throw Error("Ground GL readback failed");}
    else{await device.queue.onSubmittedWorkDone();stride=Math.ceil(canvas.width*4/256)*256;
      const buffer=device.createBuffer({size:stride*canvas.height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      try{const encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture:canvas.getContext("webgpu").getCurrentTexture()},{buffer,bytesPerRow:stride,rowsPerImage:canvas.height},{width:canvas.width,height:canvas.height});device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);bytes=new Uint8Array(buffer.getMappedRange()).slice();buffer.unmap();}finally{buffer.destroy();}}
    return projected.map(p=>{if(!p)return null;const x=Math.round(p.x*canvas.width/canvas.clientWidth),y=Math.round(p.y*canvas.height/canvas.clientHeight);
      if(x<0||x>=canvas.width||y<0||y>=canvas.height)return null;const row=device?y:canvas.height-1-y;return Array.from(bytes.slice(row*stride+x*4,row*stride+x*4+3));});
  },points);
  const contrast=(off,on)=>off&&on?Math.min(...off.map((c,i)=>c-on[i])):0;
  const floor=c=>c&&Math.min(...c)>70&&Math.max(...c)-Math.min(...c)<35;
  const pair=async(mode="proxy")=>{await render(()=>control("shadow-mode").selectOption("off"));const off=await sample();await render(()=>control("shadow-mode").selectOption(mode));return {off,on:await sample()};};
  const masked=(pair,threshold=25)=>points.flatMap((_,i)=>floor(pair.off[i])&&contrast(pair.off[i],pair.on[i])>threshold?[i]:[]);
  const subjects=indices=>({actor:indices.filter(i=>points[i].x<20).length,tree:indices.filter(i=>points[i].x>=20).length});
  const model=()=>page.evaluate(()=>window.ferrumFeatureLab.shadowModels());
  const initial=await snapshot(),initialPixels=await page.evaluate(pixelHash),models=await model();
  assert.equal(initial.visibleModels,0);assert.equal(initial.models,2);
  for(const m of Object.values(models)){assert.equal(m.cameraVisible,false);assert.equal(m.hasPhysicsBody,false);}
  const baseline=await pair(),candidates=new Set(masked(baseline));
  const core=[...candidates].filter(i=>i%41>0&&i%41<40&&i>=41&&i<41*28&&[i-1,i+1,i-41,i+41].every(n=>candidates.has(n)));
  assert(core.length>=5,`The real assets must cast a measurable ground shadow: ${core.length} interior receivers`);
  const proxySubjects=subjects(core);
  assert(proxySubjects.actor>=3&&proxySubjects.tree>=3,"Both the character and tree must cast their own measurable volume shadow");
  const views=[];
  for(const angle of [30,90,-90,180]){
    await range("camera-angle",angle);assert.deepEqual(await model(),models,"Camera orbit must not rotate or move native shadow volumes");
    const current=await pair(),common=core.filter(i=>floor(current.off[i]));
    const retained=common.filter(i=>contrast(current.off[i],current.on[i])>20);
    assert(common.length>=3&&retained.length>=common.length*.95,`World shadow changed with camera ${angle}: ${retained.length}/${common.length}`);
    views.push({angle,visibleReceivers:common.length,retained:retained.length});
  }
  await range("camera-angle",0);await range("camera-pan",32);
  const panned=await pair(),common=core.filter(i=>floor(panned.off[i]));
  assert(common.length>=3&&common.filter(i=>contrast(panned.off[i],panned.on[i])>20).length>=common.length*.95);
  await range("camera-pan",0);
  await render(()=>control("shadow-mode").selectOption("billboard"));
  assert.notEqual((await page.evaluate(pixelHash)).hash,initialPixels.hash,"Billboard and volume modes must show different native shadows");
  const billboardBaseline=await pair("billboard");
  await range("camera-angle",90);
  const billboardOrbit=await pair("billboard"),billboardSubjects=subjects(masked(billboardOrbit));
  assert(billboardSubjects.actor>=3&&billboardSubjects.tree>=3,"Billboard mode must actually cast shadows for both textured sprites");
  const commonFloor=points.flatMap((_,i)=>floor(billboardBaseline.off[i])&&floor(billboardOrbit.off[i])?[i]:[]);
  const changedFootprint=commonFloor.filter(i=>(contrast(billboardBaseline.off[i],billboardBaseline.on[i])>25)!==(contrast(billboardOrbit.off[i],billboardOrbit.on[i])>25)).length;
  assert(changedFootprint>=3,"The camera-facing plane's world shadow must change with camera orbit");
  await range("camera-angle",0);
  await render(()=>control("shadow-mode").selectOption("proxy"));
  await render(()=>control("proxy-visible").check());assert.equal((await snapshot()).visibleModels,2);
  await page.screenshot({path:`${artifactDir}/${initial.backend}-shadow-volumes.png`,fullPage:true});
  await render(()=>control("proxy-visible").uncheck());assert.equal((await snapshot()).visibleModels,0);
  await control("actor-height").locator("xpath=ancestor::details").locator("summary").click();
  await range("actor-height",16);const raised=await model();
  assert(Math.abs(raised.actor_shadow.transform[13]-models.actor_shadow.transform[13]-16)<1e-5,"Native attachment must inherit actor height");
  await range("actor-x",16);const moved=await model();assert(Math.abs(moved.actor_shadow.transform[12]-raised.actor_shadow.transform[12]-16)<1e-5);
  await range("actor-yaw",90);assert.notDeepEqual((await model()).actor_shadow.transform,moved.actor_shadow.transform);
  const yawExport=await control("download").evaluate(async a=>(await fetch(a.href)).json());assert.equal(yawExport.spatial.attachments.actor_shadow.yawDegrees,90);
  await range("actor-height",0);await range("actor-x",0);await range("actor-yaw",0);
  await range("actor-frame",1);assert.equal((await snapshot()).shadowComparison.animation.clip,2);
  assert.match(await page.locator('[data-value="observation"]').textContent(),/프레임 1/,'The readout must show the selected atlas frame, not frame zero of a single-frame clip');
  assert.notEqual((await page.evaluate(pixelHash)).hash,initialPixels.hash,"Real character atlas frames must change the visible sprite");
  const animatedFrame=await sample();assert(core.every(i=>contrast(baseline.off[i],animatedFrame[i])>20),"Changing sprite UV must preserve the volume shadow");
  await render(()=>control("actor-animate").check());
  const animation=(await snapshot()).shadowComparison.animation;
  await page.waitForFunction(frame=>window.ferrumFeatureLab.snapshot().shadowComparison.animation.frame!==frame,animation.frame);
  await control("pause").click();await page.waitForFunction(()=>window.ferrumFeatureLab.snapshot().state==="paused");
  const paused=(await snapshot()).shadowComparison.animation;await page.waitForTimeout(220);assert.deepEqual((await snapshot()).shadowComparison.animation,paused);
  await range("actor-height",8);assert.equal((await snapshot()).state,"paused","Editing a comparison must preserve pause");
  const downloaded=await control("download").evaluate(async a=>(await fetch(a.href)).json());
  assert.equal(downloaded.sceneComposition.fragments.lab.instances.find(i=>i.id==="actor").props.components.body.heightSpan.elevation,8);
  assert.equal(downloaded.spatial.models.actor_shadow.shadowOnly,true);
  assert.deepEqual(downloaded.spatial.camera,(await snapshot()).shadowComparison.camera);
  const sunAngles=[];
  for(const elevation of [10,85]){
    await range("shadow-elevation",elevation);
    const doc=await control("download").evaluate(async a=>(await fetch(a.href)).json()),v=doc.spatial.environment.lighting.directional.direction;
    assert(Math.abs(Math.atan2(v.elevation,Math.hypot(v.x,v.y))*180/Math.PI-elevation)<1e-6,"The exported sun angle must match its control");
    sunAngles.push(await page.evaluate(pixelHash));
    assert.equal((await snapshot()).state,"paused");
  }
  assert.notEqual(sunAngles[0].hash,sunAngles[1].hash,"Sun elevation must change actual native lighting");
  await render(()=>control("reset").click());assert.equal((await snapshot()).shadowComparison.animate,false);
  assert.equal((await page.evaluate(pixelHash)).hash,initialPixels.hash,"Reset must restore the exact static framebuffer");
  await render(()=>control("actor-animate").check());
  await page.evaluate(backend=>{
    const prototype=backend==="webgl2"?WebGL2RenderingContext.prototype:GPUQueue.prototype;
    const method=backend==="webgl2"?"clear":"submit",original=prototype[method];
    prototype[method]=function(){prototype[method]=original;throw Error("Test one-shot shadow render failure");};
  },initial.backend);
  await page.waitForFunction(()=>!!window.ferrumFeatureLab.snapshot().failed);
  const failedFrames=(await snapshot()).renderedFrames;
  await page.waitForTimeout(120);assert.equal((await snapshot()).renderedFrames,failedFrames,"A render failure must stop submissions");
  await render(()=>control("reset").click());assert.equal((await snapshot()).failed,undefined);
  assert.equal((await page.evaluate(pixelHash)).hash,initialPixels.hash,"Reset after a render failure must restore the actual framebuffer");
  await page.screenshot({path:`${artifactDir}/${initial.backend}-shadow-comparison.png`,fullPage:true});
  return {core:core.length,coreIndices:core,proxySubjects,billboardSubjects,changedFootprint,sunAngles:[10,85],views,pan:true,visibleVolumes:true,poseInheritance:true,animation:true,pause:true,export:true,reset:true,renderRecovery:true,
    receiverRgb:core.map(i=>({index:i,off:baseline.off[i],on:baseline.on[i]}))};
}
