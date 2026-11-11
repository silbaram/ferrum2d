import assert from "node:assert/strict";

/** Actual receiver pixels, not a finite matrix alone, prove low sun / pole behavior. */
export async function checkSunCoverage({page,control,snapshot,pixelHash,render,range,sample,artifactDir}){
  const initialHash=(await page.evaluate(pixelHash)).hash;
  const points=Array.from({length:45*41},(_,i)=>({x:4+i%45*4,y:-32+Math.floor(i/45)*4}));
  const color=(pixels)=>{
    const counts=new Map();for(const rgb of pixels)if(rgb){const key=rgb.join(",");counts.set(key,(counts.get(key)??0)+1);}
    const [key,count]=[...counts].sort((a,b)=>b[1]-a[1])[0];assert(count>20,"Need a measured flat ground reference");return key.split(",").map(Number);
  };
  const close=(a,b,t=2)=>a&&b&&a.every((c,i)=>Math.abs(c-b[i])<=t);
  const contrast=(a,b)=>a&&b?Math.min(...a.map((c,i)=>c-b[i])):0;
  const pair=async()=>{await render(()=>control("shadow-mode").selectOption("off"));const off=await sample(points);await render(()=>control("shadow-mode").selectOption("proxy"));return {off,on:await sample(points)};};
  const comparisons=[],sweeps=[],offscreen=[];
  const add=(scope,pixels,indices)=>comparisons.push({scope,receiverRgb:indices.map(index=>({index,off:pixels.off[index],on:pixels.on[index]}))});
  for(const asset of ["tree","lantern","crate"]){
    await render(()=>control("reset").click());await render(()=>control("shadow-center").selectOption("world"));
    await render(()=>control("shadow-asset").selectOption(asset));await range("shadow-extent",128);
    await range("shadow-elevation",0);
    const horizon=await pair(),ambient=color(horizon.off);
    const ground=points.flatMap((p,i)=>p.x>=120&&close(horizon.off[i],ambient)?[i]:[]);
    assert(ground.length>20);assert(ground.every(i=>close(horizon.off[i],horizon.on[i],1)),"A tangent sun has no direct contribution to shadow on horizontal ground");
    let previous;
    for(const elevation of [5,81.8,82,89.9,90]){
      const s=await range("shadow-elevation",elevation);
      assert.equal(s.sunMatrix.length,16);assert(s.sunMatrix.every(Number.isFinite));
      const pixels=await pair(),lit=color(pixels.off),energy=Math.min(...lit.map((c,i)=>c-ambient[i]));
      assert(energy>4,"Low sun must still provide measurable direct light");
      const threshold=Math.max(3,energy*.65);
      const indices=points.flatMap((p,i)=>Math.abs(p.x-p.y-42)<25&&close(pixels.off[i],lit)&&contrast(pixels.off[i],pixels.on[i])>threshold?[i]:[]);
      assert(indices.length>=3,`${asset}/${elevation}: no measurable volume shadow (${indices.length})`);
      if(elevation===82){
        const common=previous.indices.filter(i=>close(pixels.off[i],lit));
        assert(common.length>=3&&common.filter(i=>contrast(pixels.off[i],pixels.on[i])>threshold).length>=common.length*.9,"Shadow changed abruptly at the former reference-up threshold");
      }
      const doc=await control("download").evaluate(async a=>(await fetch(a.href)).json()),v=doc.spatial.environment.lighting.directional.direction;
      assert(Math.abs(Math.atan2(v.elevation,Math.hypot(v.x,v.y))*180/Math.PI-elevation)<1e-6);
      add(`${asset}/${elevation}`,pixels,indices);sweeps.push({asset,elevation,receivers:indices.length,energy,threshold});previous={indices,pixels};
      if(elevation===90){
        for(const azimuth of [0,90,180]){
          await range("shadow-azimuth",azimuth);const rotated=await pair();
          assert(indices.every(i=>close(rotated.on[i],pixels.on[i],2)),"At zenith, azimuth must not rotate the world shadow footprint");
        }
      }
    }
    await render(()=>control("shadow-offscreen").click());await render(()=>control("shadow-asset").selectOption(asset));
    const s=await range("shadow-elevation",5);assert.equal(s.billboards,0);assert.equal(s.visibleModels,0);assert.equal(s.models,2);
    const low=await pair(),lit=color(low.off),threshold=Math.max(3,Math.min(...lit.map((c,i)=>c-ambient[i]))*.65);
    const indices=points.flatMap((p,i)=>Math.abs(p.x-p.y-42)<25&&close(low.off[i],lit)&&contrast(low.off[i],low.on[i])>threshold?[i]:[]);
    assert(indices.length>=3,`${asset}: hidden caster lost its low-sun shadow`);
    const matrix=(await snapshot()).sunMatrix;
    const panned=await range("camera-pan",240);assert.deepEqual(panned.sunMatrix,matrix);assert.equal(panned.shadowCacheHit,true);
    const moved=await pair(),common=indices.filter(i=>close(moved.off[i],lit));
    assert(common.length>=3&&common.filter(i=>contrast(moved.off[i],moved.on[i])>threshold).length>=common.length*.95);
    add(`${asset}/offscreen5`,low,indices);offscreen.push({asset,receivers:indices.length,retained:common.length});
  }

  await render(()=>control("reset").click());await render(()=>control("shadow-center").selectOption("world"));await range("shadow-extent",96);
  const clean=await page.evaluate(pixelHash),before=await snapshot();
  const shown=await render(()=>control("shadow-coverage").check());
  assert(shown.coverageVertices.length>=16*11);assert(shown.coverageVertices.every(Number.isFinite));
  assert.equal(shown.debugDrawCalls,1);assert.equal(shown.resources.renderTargetCount,before.resources.renderTargetCount);
  const coldMemoryGrowth=shown.wasmMemoryBytes-before.wasmMemoryBytes;
  assert.deepEqual([shown.terrainOffset,shown.terrainRevision,shown.casterRevision,shown.sunMatrix],[before.terrainOffset,before.terrainRevision,before.casterRevision,before.sunMatrix]);
  if(!shown.shadowCacheHit)assert(coldMemoryGrowth>0,"Only a proved cold Wasm memory growth may invalidate an unchanged shadow map");
  assert.notEqual((await page.evaluate(pixelHash)).hash,clean.hash,"Coverage geometry must be visible in actual GPU pixels");
  assert.equal(await page.locator(".feature-lesson-feedback").isHidden(),true,"The coverage explanation already appears in the comparison card");
  await page.screenshot({path:`${artifactDir}/${shown.backend}-sun-coverage.png`,fullPage:true});
  const moved=await range("camera-pan",64);assert.deepEqual(moved.coverageVertices,shown.coverageVertices);assert.deepEqual(moved.sunMatrix,shown.sunMatrix);
  await render(()=>control("shadow-center").selectOption("camera"));assert.notDeepEqual((await snapshot()).coverageVertices,shown.coverageVertices);
  const doc=await control("download").evaluate(async a=>(await fetch(a.href)).json());assert(!JSON.stringify(doc).includes("sunShadowCoverage"),"Runtime diagnostic options must not leak into authored scene JSON");
  await render(()=>control("shadow-center").selectOption("world"));await range("camera-pan",0);
  await render(()=>control("shadow-coverage").uncheck());assert.equal((await snapshot()).coverageVertices.length,0);assert.equal((await snapshot()).debugDrawCalls,0);
  assert.equal((await page.evaluate(pixelHash)).hash,clean.hash);
  const warmBytes=(await snapshot()).wasmMemoryBytes;
  const warmed=await render(()=>control("shadow-coverage").check());assert.equal(warmed.shadowCacheHit,true);assert.equal(warmed.shadowPasses,0);assert.equal(warmed.wasmMemoryBytes,warmBytes);
  const hidden=await render(()=>control("shadow-coverage").uncheck());assert.equal(hidden.shadowCacheHit,true);assert.equal(hidden.shadowPasses,0);
  await render(()=>control("shadow-sun-preset").selectOption("90"));assert.equal((await snapshot()).shadowComparison.elevation,90);assert((await snapshot()).coverageVertices.length>0);
  await render(()=>control("reset").click());assert.equal((await page.evaluate(pixelHash)).hash,initialHash);
  return {sweeps,offscreen,comparisons,horizon:true,zenithAzimuth:true,coverageOverlay:true,cache:true,coldMemoryGrowth,save:true,reset:true};
}
