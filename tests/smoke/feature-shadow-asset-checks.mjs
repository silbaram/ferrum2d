import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

/** Exercise existing native animation/LOD policies, using real atlas assets and receiver pixels. */
export async function checkShadowAssets({page,control,snapshot,pixelHash,render,range,sample,points,floor,contrast,pair,model,artifactDir}){
  const assets=JSON.parse(await readFile(new URL("../../examples/starter-runtime/public/features/spatial/shadow-assets.json",import.meta.url),"utf8"));
  const initial=await snapshot(),initialHash=(await page.evaluate(pixelHash)).hash,baseModels=await model();
  const baseline=await pair(),core=points.flatMap((p,i)=>floor(baseline.off[i])&&contrast(baseline.off[i],baseline.on[i])>25?[i]:[]);
  const flips=[];
  // Open once: controls are deliberately in an initially collapsed disclosure.
  await control("actor-flip-x").locator("xpath=ancestor::details").evaluate(d=>d.open=true);
  for(const [x,y]of [[true,false],[false,true],[true,true],[false,false]]){
    const before=(await snapshot()).renderedFrames;
    await page.evaluate(({x,y})=>{for(const [key,value]of [["actor-flip-x",x],["actor-flip-y",y]]){const input=document.querySelector(`[data-control="${key}"]`);input.checked=value;input.dispatchEvent(new Event("change",{bubbles:true}));}},{x,y});
    await page.waitForFunction(n=>window.ferrumFeatureLab.snapshot().renderedFrames>n,before);
    const s=await snapshot(),rgb=await sample();
    assert.equal(s.shadowComparison.animation.flipX,x);assert.equal(s.shadowComparison.animation.flipY,y);
    assert.deepEqual(await model(),baseModels,"Sprite UV flips must not mirror the physical shadow volume");
    assert(core.every(i=>contrast(baseline.off[i],rgb[i])>20),"Flips lost a volume-shadow receiver");
    const hash=(await page.evaluate(pixelHash)).hash;
    if(x||y)assert.notEqual(hash,initialHash,"Flip controls must change the real sprite pixels");else assert.equal(hash,initialHash);
    flips.push({x,y,receivers:core.length});
  }
  await render(()=>control("actor-animate").check());
  await render(()=>control("actor-flip-x").check());
  const animated=(await snapshot()).shadowComparison.animation;
  await page.waitForFunction(frame=>window.ferrumFeatureLab.snapshot().shadowComparison.animation.frame!==frame,animated.frame);
  await control("pause").click();await page.waitForFunction(()=>window.ferrumFeatureLab.snapshot().state==="paused");
  assert.equal((await snapshot()).shadowComparison.animation.flipX,true);
  const saved=await control("playback-download").evaluate(async a=>{a.click();return (await fetch(a.href)).json();});
  const playback=saved.dataScene.progress.instances.find(i=>i.id==="actor").animation;
  assert.equal(playback.flipX,true);assert.equal(playback.flipY,false);assert(playback.elapsedSeconds>0);
  assert.equal(saved.dataScene.authoringDocument.spatial.models.actor_shadow.shadowOnly,true);
  await render(()=>control("reset").click());

  // Keep the authored map fixed so changing eye distance isolates native LOD selection.
  await render(()=>control("shadow-center").selectOption("world"));
  const fixed=await model(),matrix=(await snapshot()).sunMatrix;
  const fixedDistance=await range("camera-distance",200);
  assert.deepEqual(await model(),fixed,"Single-LOD volume must remain fixed at any eye distance");
  assert.deepEqual(fixedDistance.sunMatrix,matrix);assert.equal(fixedDistance.shadowCacheHit,true);
  await range("camera-distance",100);
  await render(()=>control("shadow-lod").selectOption("distance"));
  const high=await model(),near=await sample(),lodViews=[];
  for(const [distance,low,cache]of [[130,false,true],[200,true,false],[130,true,true],[100,false,false],[100,false,true]]){
    const state=await range("camera-distance",distance),models=await model();
    for(const [id,kind]of [["actor_shadow","actor"],["tree_shadow","tree"]]){
      assert.equal(models[id].contentId,assets.models[`shadow-${kind}${low?"-low":""}`],`Native ${id} LOD at ${distance}%`);
      assert.deepEqual(models[id].transform,high[id].transform);
      assert.equal(models[id].hasPhysicsBody,false);
      if(low)assert(models[id].triangles<high[id].triangles,"The selected LOD must actually reduce geometry");
    }
    assert.deepEqual(state.sunMatrix,matrix);
    assert.equal(state.shadowCacheHit,cache,"Camera-only changes reuse shadows; a changed caster asset must invalidate them");
    const rgb=await sample(),common=points.flatMap((_,i)=>floor(baseline.off[i])?[i]:[]);
    const changed=common.filter(i=>(contrast(baseline.off[i],near[i])>25)!==(contrast(baseline.off[i],rgb[i])>25)).length;
    if(low)assert(changed>=3,`LOD must visibly change the world shadow silhouette (${changed})`);
    else assert(common.every(i=>Math.max(...rgb[i].map((c,k)=>Math.abs(c-near[i][k])))<=3),"Returning to detailed LOD must restore receiver pixels");
    lodViews.push({distance,low,cache:state.shadowCacheHit,changed});
  }
  const exported=await control("download").evaluate(async a=>(await fetch(a.href)).json());
  assert.equal(exported.spatial.models.tree_shadow.lods[0].minDistance,600);
  assert.deepEqual(exported.spatial.camera,(await snapshot()).shadowComparison.camera);

  // Reapplying presentation settings must not erase compatible native transient state.
  await range("camera-distance",200);await range("camera-distance",130);
  await render(()=>control("actor-animate").check());
  await page.waitForFunction(()=>window.ferrumFeatureLab.snapshot().shadowComparison.animation.frame>0);
  await control("pause").click();await page.waitForFunction(()=>window.ferrumFeatureLab.snapshot().state==="paused");
  await render(()=>control("actor-flip-x").check());
  const phase=(await snapshot()).shadowComparison.animation,low=await model(),reapplyContinuity=[];
  for(const [name,action]of [
    ["show",()=>render(()=>control("proxy-visible").check())],
    ["hide",()=>render(()=>control("proxy-visible").uncheck())],
    ["sun50",()=>range("shadow-elevation",50)],
    ["sun45",()=>range("shadow-elevation",45)],
    ["yaw30",()=>range("actor-yaw",30)],
    ["yaw0",()=>range("actor-yaw",0)],
    ["shadow-off",()=>render(()=>control("shadow-mode").selectOption("off"))],
    ["shadow-on",()=>render(()=>control("shadow-mode").selectOption("proxy"))],
  ]){
    await action();const s=await snapshot(),models=await model();
    assert.equal(s.state,"paused");assert.deepEqual(s.shadowComparison.animation,phase,`${name}: paused playback phase must survive cold reapply`);
    for(const id of ["actor_shadow","tree_shadow"])assert.equal(models[id].contentId,low[id].contentId,`${name}: native LOD history must survive a presentation change`);
    reapplyContinuity.push(name);
  }
  await render(()=>control("shadow-asset").selectOption("crate"));
  assert.deepEqual((await snapshot()).shadowComparison.animation,phase,"Changing the other asset must preserve the character's exact paused phase");
  assert.equal((await model()).actor_shadow.contentId,low.actor_shadow.contentId);
  const continued=await control("playback-download").evaluate(async a=>{a.click();return(await fetch(a.href)).json();});
  assert.equal(continued.dataScene.progress.instances.find(i=>i.id==="actor").animation.elapsedSeconds,phase.elapsedSeconds);
  assert.equal(continued.dataScene.authoringDocument.spatial.models.tree_shadow.asset,"shadow-crate");
  await render(()=>control("actor-animate").uncheck());
  assert.equal((await snapshot()).shadowComparison.animation.clip,1);
  await range("actor-frame",2);assert.equal((await snapshot()).shadowComparison.animation.clip,3);
  assert.equal((await snapshot()).shadowComparison.animation.elapsedSeconds,0,"An explicit new clip must retain its authored starting phase");

  const beforeRejection=await snapshot(),beforeRejectionHash=(await page.evaluate(pixelHash)).hash;
  await page.evaluate(backend=>{
    window.shadowPreparationFault={kind:backend==="webgl2"?"buffer-allocation":"preloaded-model-limit-validation",hits:0};
    const fail=()=>{window.shadowPreparationFault.hits++;throw Error("Test one-shot shadow model preparation failure");};
    if(backend==="webgl2"){
      const prototype=WebGL2RenderingContext.prototype,original=prototype.createBuffer;
      prototype.createBuffer=function(){prototype.createBuffer=original;return fail();};
    }else{
      // WebGPU keeps preloaded assets resident, so a scene switch need not allocate.
      // Reject the real model-preparation limits check instead of an unused allocation hook.
      const prototype=GPUDevice.prototype,descriptor=Object.getOwnPropertyDescriptor(prototype,"limits");
      Object.defineProperty(prototype,"limits",{...descriptor,get(){Object.defineProperty(prototype,"limits",descriptor);return fail();}});
    }
  },initial.backend);
  await control("shadow-asset").selectOption("lantern");
  const preparationFault=await page.evaluate(()=>window.shadowPreparationFault);
  assert.equal(preparationFault.hits,1,"Failure injection must reach the actual preparation path exactly once");
  assert.match(await page.locator('[data-value="control-error"]').textContent(),/Test one-shot shadow model preparation failure/);
  assert.equal(await control("shadow-asset").inputValue(),"crate","Rejected preparation must restore the accepted form values");
  const rejected=await snapshot();
  assert.equal(rejected.failed,undefined);assert.equal(rejected.shadowComparison.asset,beforeRejection.shadowComparison.asset);
  assert.deepEqual(rejected.shadowComparison.animation,beforeRejection.shadowComparison.animation);
  for(const key of ["textureCount","bufferCount","renderTargetCount","programCount"])assert.equal(rejected.resources[key],beforeRejection.resources[key],`Rejected preparation leaked ${key}`);
  assert.equal((await page.evaluate(pixelHash)).hash,beforeRejectionHash,"Preflight failure must leave the old framebuffer intact");
  const stillSaved=await control("playback-download").evaluate(async a=>{a.click();return(await fetch(a.href)).json();});
  assert.equal(stillSaved.dataScene.authoringDocument.spatial.models.tree_shadow.asset,"shadow-crate","A rejected apply must not replace the document used by progress capture");
  await render(()=>control("shadow-asset").selectOption("lantern"));
  assert.equal(await page.locator('[data-value="control-error"]').isHidden(),true);
  assert.equal((await snapshot()).shadowComparison.asset,"lantern");

  const subjects=[];
  for(const asset of ["lantern","crate"]){
    await render(()=>control("shadow-offscreen").click());
    await render(()=>control("shadow-asset").selectOption(asset));
    const s=await snapshot(),models=await model(),subject=assets.subjects[asset];
    assert.equal(s.billboards,0,`${asset} must actually be outside the camera view`);
    assert.equal(models.tree_shadow.contentId,assets.models[`shadow-${asset}`]);
    assert.equal(models.tree_shadow.bounds[1],0,"Proxy feet must be on the attachment ground plane");
    assert.equal(models.tree_shadow.bounds[4],subject.volumeHeight);
    assert.equal(models.tree_shadow.transform[13],0);assert.equal(models.tree_shadow.hasPhysicsBody,false);
    assert.equal(await page.locator('.feature-role-labels [data-entity="tree"]').textContent(),subject.label);
    const pixels=await pair(),indices=points.flatMap((p,i)=>p.x>=30&&floor(pixels.off[i])&&contrast(pixels.off[i],pixels.on[i])>25?[i]:[]);
    assert(indices.length>=3,`${asset}: offscreen volume must cast a measurable shadow (${indices.length})`);
    const doc=await control("download").evaluate(async a=>(await fetch(a.href)).json());
    const visual=doc.sceneComposition.fragments.lab.instances.find(i=>i.id==="tree").props.components.visual;
    assert.equal(visual.originY,subject.originY);assert.deepEqual(visual.frame,subject.frame);
    await page.screenshot({path:`${artifactDir}/${initial.backend}-${asset}-offscreen.png`,fullPage:true});
    // Distance LOD is opt-in for the extra assets too; zero new physics entities.
    await render(()=>control("shadow-lod").selectOption("distance"));
    await range("camera-distance",200);
    assert.equal((await model()).tree_shadow.contentId,assets.models[`shadow-${asset}-low`]);
    assert.equal((await snapshot()).entities,initial.entities);
    subjects.push({asset,originY:visual.originY,volumeHeight:subject.volumeHeight,receivers:indices.length,
      receiverRgb:indices.map(i=>({index:i,off:pixels.off[i],on:pixels.on[i]}))});
  }
  await render(()=>control("reset").click());
  assert.equal((await page.evaluate(pixelHash)).hash,initialHash,"Reset must clear asset, flips, LOD and eye distance");
  return {flips,animatedFlip:true,playbackExport:true,fixedDistance:true,lodViews,reapplyContinuity,assetSwapPhase:true,explicitClip:true,rejectedPreparation:preparationFault,subjects,reset:true};
}
