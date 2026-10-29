import { smokeLightingUpgrade } from "./placement-lighting-upgrade-smoke.mjs";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { showPlacementMenu } from "./placement-panel-navigation.mjs";
import { placementRegressionFixture, placementSpatialRegressionFixture } from "./placement-test-build.mjs";

/** Real renderer/Wasm output, authored history and reachable View controls. */
export async function smokePlacementLighting(parent, timeoutMs = 30000, mode = "2d") {
  const page = await parent.context().browser().newPage({ viewport: { width: 1125, height: 800 } });
  const output = "artifacts/viewer-lighting";
  await mkdir(output, {recursive:true});
  const errors=[]; page.on("pageerror", e=>errors.push(e.message));
  const wait=(fn,arg)=>page.waitForFunction(fn,arg,{timeout:timeoutMs});
  const paint=()=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(done)))));
  const source=()=>page.evaluate(()=>window.ferrumPlacementSpatialExportDocument());
  const history=()=>page.evaluate(()=>window.ferrumPlacementViewerHistory);
  const lightOf=d=>mode==="spatial"?d.spatial?.environment?.lighting:d.lighting;
  const enabled=page.locator('[data-placement-lighting-toggle="enabled"]');
  const open=()=>showPlacementMenu(page,"lighting");
  const field=name=>page.locator(`[data-placement-lighting-field="${name}"]`);
  const edit=async(name,value)=>{await open();await field(name).fill(String(value));await field(name).press("Enter");await paint();};
  const pixels=()=>page.evaluate(()=>{
    const canvas=document.querySelector("canvas.demo-canvas"), gl=canvas.getContext("webgl2"), bytes=new Uint8Array(canvas.width*canvas.height*4);
    gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
    let hash=2166136261, colored=0;
    for(let i=0;i<bytes.length;i+=16){hash=Math.imul(hash^bytes[i],16777619);hash=Math.imul(hash^bytes[i+1],16777619);if(bytes[i]+bytes[i+1]+bytes[i+2]>100)colored++;}
    return {hash:hash>>>0,colored,width:canvas.width,height:canvas.height};
  });
  try {
    const url=new URL(parent.url());url.search=mode==="spatial"?"?scene=hd2d":"";
    await page.goto(url.href,{waitUntil:"networkidle"});
    await wait(mode=>window.ferrumPlacementWorkspaceMode===mode && !!window.ferrumPlacementViewerRuntimeFrame,mode);
    await page.locator('[data-placement-language]').selectOption("en");
    await page.evaluate(()=>{
      const renderer=window.ferrumRuntime.renderer, draw=renderer.renderCommands;
      renderer.renderCommands=function(...args){
        const commands=args[1]??args[0], environment=commands.spatial?.environment?.values;
        const result=draw.apply(this,args);
        window.__lightingProbe={flags:environment?.[0]??0,pointLights:environment?.[1]??0,sun:environment?.[83]??0,shadowLight:environment?.[2]??-1,sunShadowResolution:environment?.[92]??0,hemisphere:environment?.[112]??0,pointNormalBias:environment?.[123]??0,sunNormalBias:environment?.[124]??0,stats:structuredClone(result)};
        return result;
      };
    });
    const baseline=await source();
    await open();
    if(!await enabled.isChecked())await enabled.check();
    if(await page.locator('[data-placement-lighting-action="add-sun"]').isVisible())
      await page.locator('[data-placement-lighting-action="add-sun"]').click();
    await edit("sun-intensity",mode==="spatial"?0.9:0.2);
    await page.locator('[data-placement-lighting-action="add-point"]').click();
    await edit("point-intensity",1.25); await edit("point-radius",180);
    if(mode==="spatial"){
      await page.locator('[data-placement-lighting-toggle="point-shadows"]').check();
      await page.locator('[data-placement-lighting-toggle="sun-shadows"]').check();
      await page.locator('[data-placement-lighting-toggle="hemisphere"]').check();
      await edit("hemisphere-intensity",.4);
      await field("hemisphere-sky").evaluate(input=>{input.value="#99bbff";input.dispatchEvent(new Event("change"));});
      const savedHemisphere=(await source()).spatial.environment.lighting.hemisphere;
      await page.locator('[data-placement-lighting-toggle="hemisphere"]').uncheck();await paint();
      assert.deepEqual((await source()).spatial.environment.lighting.hemisphere,{...savedHemisphere,enabled:false});
      assert.equal((await page.evaluate(()=>window.__lightingProbe)).hemisphere,0);
      await page.locator('[data-placement-lighting-toggle="hemisphere"]').check();await paint();
      assert.deepEqual((await source()).spatial.environment.lighting.hemisphere,savedHemisphere);
      await edit("sun-normal-bias",.35);await edit("point-normal-bias",.6);
      const strength=Math.max(...(await source()).spatial.environment.lighting.ambient);
      await field("ambient-color").evaluate(input=>{input.value="#ff8080";input.dispatchEvent(new Event("change"));});
      await paint();
      assert(Math.abs(Math.max(...(await source()).spatial.environment.lighting.ambient)-strength)<1e-8,"Ambient hue edits must preserve strength");
      await edit("ambient",0);
      await field("ambient-color").evaluate(input=>{input.value="#80ff80";input.dispatchEvent(new Event("change"));});
      await paint();
      assert.equal(Math.max(...(await source()).spatial.environment.lighting.ambient),0,"Changing hue must preserve zero ambient strength too");
      await edit("ambient",strength);
    }
    await paint();
    const on=await source(), onPixels=await pixels(), onProbe=await page.evaluate(()=>window.__lightingProbe);
    assert(onPixels.colored>100,"Lit scene must contain rendered content");
    assert(onProbe.stats.drawCalls>0 && onProbe.stats.drawCalls<=(mode==="spatial"?128:32));
    assert((await page.evaluate(()=>window.ferrumPlacementViewerRuntimeFrame.entityCount))>0);
    if(mode==="spatial"){
      assert(onProbe.flags&1);assert.equal(onProbe.pointLights,1);assert.equal(onProbe.sun,1);
      assert.equal(onProbe.shadowLight,0);assert.equal(onProbe.sunShadowResolution,512);
      assert.equal(onProbe.hemisphere,1);assert(Math.abs(onProbe.pointNormalBias-.6)<1e-6);assert(Math.abs(onProbe.sunNormalBias-.35)<1e-6);
      assert.equal(on.spatial.environment.lighting.hemisphere.intensity,.4);
      assert.equal(on.spatial.environment.lighting.lights[0].intensity,1.25);
      assert.deepEqual(on.spatial.camera,baseline.spatial.camera);
    }else{
      assert.equal(onProbe.stats.pointLightCount,1);assert(onProbe.stats.lightingDrawCalls>0);
      assert.equal(on.lighting.pointLights[0].intensity,1.25);
    }
    await enabled.uncheck();await paint();
    const off=await source(), offPixels=await pixels(), offProbe=await page.evaluate(()=>window.__lightingProbe);
    assert.equal(lightOf(off).enabled,false);
    assert.deepEqual({...lightOf(off),enabled:true},{...lightOf(on),enabled:true},"OFF must retain authored light and shadow values");
    if(mode==="spatial")assert.equal(offProbe.flags&1,0);
    else assert.equal(offProbe.stats.pointLightCount,0);
    assert.notEqual(onPixels.hash,offPixels.hash,"Lighting ON/OFF must change actual framebuffer pixels");
    await enabled.check();await paint();assert.deepEqual(await source(),on);
    assert.equal((await pixels()).hash,onPixels.hash,"ON must restore the same rendered lighting");
    const good=await source(), goodHistory=await history();
    await edit("point-radius",-1);
    assert(await page.locator('.placement-lighting-error').isVisible());
    assert.deepEqual(await source(),good);assert.deepEqual(await history(),goodHistory);
    await field("point-radius").press("Escape");
    assert.equal(Number(await field("point-radius").inputValue()),180);
    await page.evaluate(mode=>{
      const engine=window.ferrumEngine, method=mode==="spatial"?"configureDataSceneSpatial":"setDataSceneSun", original=engine[method];
      engine[method]=function(...args){engine[method]=original;return false;};
    },mode);
    await edit("sun-intensity",mode==="spatial"?1:0.3);
    assert(await page.locator('.placement-lighting-error').isVisible());
    assert.deepEqual(await source(),good);assert.deepEqual(await history(),goodHistory);
    await field("sun-intensity").press("Escape");
    await page.locator('[data-placement-action="undo"]').click();await paint();
    assert.equal(lightOf(await source()).enabled,false);
    await page.locator('[data-placement-action="redo"]').click();await paint();
    assert.deepEqual(await source(),good);
    await page.locator('[data-placement-playback="play"]').click();await paint();
    await open(); assert(await enabled.isDisabled());
    await page.locator('[data-placement-playback="stop"]').click();await paint();
    assert.deepEqual(await source(),good);
    const originalKey=await page.evaluate(()=>window.ferrumPlacementWorkspaceActiveDocument);
    await page.locator('[data-placement-document-file]').setInputFiles({name:`lighting-other-${mode}.json`,mimeType:"application/json",buffer:Buffer.from(JSON.stringify(baseline))});
    await wait(()=>window.ferrumPlacementWorkspaceDocuments.length===2 && !document.querySelector('.demo-shell').inert);
    assert.deepEqual(lightOf(await source()),lightOf(baseline),"New tab must use its own light settings");
    await page.locator(`[data-placement-document-key=${JSON.stringify(originalKey)}]`).click();await paint();
    assert.deepEqual(await source(),good,"Returning to the tab must restore its light draft");
    const advanced=mode==="spatial"?await smokeLightingUpgrade(page):undefined;
    for(const locale of ["ko","en"]){
      await page.locator('[data-placement-language]').selectOption(locale);await open();
      if(mode==="spatial")await page.locator('[data-placement-lighting-toggle="hemisphere"]').scrollIntoViewIfNeeded();
      assert.equal(await page.locator('[data-placement-menu="lighting"] > summary').getAttribute("aria-label"),locale==="ko"?"조명":"Lighting");
      await page.screenshot({path:`${output}/${mode}-${locale}.png`,fullPage:true});
    }
    await page.setViewportSize({width:390,height:500}); await open();
    const panel=await page.locator('.placement-lighting-panel').boundingBox();
    assert(panel.x>=0 && panel.y>=0 && panel.x+panel.width<=391 && panel.y+panel.height<=501);
    await page.screenshot({path:`${output}/${mode}-compact.png`,fullPage:true});
    assert.deepEqual(errors,[]);
    const result={ok:true,mode,advanced,onPixels,offPixels,onProbe,offProbe,panel,checks:["native renderer lighting state","spatial point/sun shadow configuration","ambient hue preserves strength","framebuffer ON/OFF and restoration","draw and entity bounds","authored settings retained","camera unchanged","invalid input rollback","native rejection rollback","undo redo","Play/Stop","tab isolation","both locales","compact bounds"]};
    if(mode==="2d")result.saving=await smokePlacementLightingSave(parent,timeoutMs);
    await writeFile(`${output}/${mode}.json`,JSON.stringify(result,null,2)+"\n");
    return result;
  }catch(error){await page.screenshot({path:`${output}/${mode}-failure.png`,fullPage:true});throw error;}
  finally{await page.close();}
}

/** Save uses a simulated public file bridge; rendering and authored edits use the real runtime. */
export async function smokePlacementLightingSave(parent,timeoutMs=30000){
  const results=[];
  for(const mode of ["2d","spatial"]){
    const page=await parent.context().browser().newPage({viewport:{width:1125,height:800}});
    const fixture=JSON.parse(await readFile(mode==="spatial"?placementSpatialRegressionFixture:placementRegressionFixture,"utf8"));
    if(mode==="spatial")fixture.spatial.environment={...(fixture.spatial.environment??{}),lighting:{
      ambient:[0.3,0.3,0.3],
      lights:[{position:{x:0,y:0,elevation:80},radius:180}],shadows:{lightIndex:0,normalBias:.6},
      directional:{direction:{x:-1,y:-1,elevation:2},shadows:{normalBias:.35}},
      hemisphere:{direction:{x:1,y:2,elevation:3},skyColor:[.2,.4,1],groundColor:[.4,.2,.1],intensity:.4},
    }};
    else fixture.lighting={ambient:[0.05,0.08,0.12,0.5],pointLights:[]};
    if(mode==="spatial"){
      fixture.spatial.environment.bloom={strength:.7,radius:10,threshold:.8};fixture.spatial.environment.ambientOcclusion={strength:.6,radius:16,bias:.3};
      fixture.spatial.environment.lighting.lights[0].spot={direction:{x:0,y:0,elevation:-1},angle:55,penumbra:.4};
      fixture.spatial.environment.lighting.maxActiveLights=2;
      const id=Object.values(fixture.sceneComposition.fragments)[0].instances[0].id;fixture.spatial.lightBindings={[id]:[0]};
    }
    await page.addInitScript(document=>{
      let saved=JSON.parse(sessionStorage.getItem("lighting-save-fixture")??"null")??document;
      window.__lightingSaveRequests=[];
      window.__TAURI__={core:{async invoke(command,args){
        if(command==="load_placement_scene_document")return{path:"/tmp/lighting-save-fixture.json",document:structuredClone(saved)};
        if(command!=="save_placement_scene_document")throw Error("Unexpected lighting fixture command: "+command);
        if(JSON.stringify(args.expectedDocument)!==JSON.stringify(saved))throw Error("Lighting fixture conflict");
        window.__lightingSaveRequests.push(structuredClone(args));
        saved=structuredClone(args.document);sessionStorage.setItem("lighting-save-fixture",JSON.stringify(saved));
        return{path:"/tmp/lighting-save-fixture.json",document:structuredClone(saved)};
      }}};
    },fixture);
    try{
      const ready=()=>page.waitForFunction(mode=>window.ferrumPlacementWorkspaceMode===mode && window.ferrumPlacementViewerSaveEnabled===true,mode,{timeout:timeoutMs});
      const url=new URL(parent.url());url.search=mode==="spatial"?"?scene=hd2d":"";
      await page.goto(url.href,{waitUntil:"networkidle"});await ready();
      await page.locator('[data-placement-language]').selectOption("en");await showPlacementMenu(page,"lighting");
      const field=page.locator(`[data-placement-lighting-field="${mode==="spatial"?"hemisphere-intensity":"ambient"}"]`);
      await field.fill(mode==="spatial"?"0.7":"0.8");
      assert.equal(await field.evaluate(e=>e===document.activeElement),true);
      const result=await page.evaluate(()=>window.ferrumPlacementViewerSaveDraft());assert.equal(result.saved,true);
      let saved=await page.evaluate(()=>window.__lightingSaveRequests.at(-1).document);
      if(mode==="spatial"){
        assert.equal(saved.spatial.environment.lighting.hemisphere.intensity,0.7);
        assert.deepEqual(saved.spatial.environment.lighting.hemisphere.skyColor,[.2,.4,1]);
        assert.equal(saved.spatial.environment.lighting.shadows.normalBias,.6);
        assert.equal(saved.spatial.environment.lighting.directional.shadows.normalBias,.35);
      }
      else assert(Math.abs(saved.lighting.ambient[3]-0.2)<1e-8);
      assert.equal(await page.evaluate(()=>window.ferrumPlacementViewerExportPatch()),undefined);
      await showPlacementMenu(page,"lighting");
      for(const invalid of ["-1",""]){
        await field.fill(invalid);await page.evaluate(()=>window.ferrumPlacementViewerSaveDraft());
        assert.equal(await page.evaluate(()=>window.__lightingSaveRequests.length),1);
        assert.equal(await field.inputValue(),invalid);
        assert(await field.evaluate(e=>e===document.activeElement && !e.disabled));
        assert.equal(await page.evaluate(()=>window.ferrumPlacementViewerExportPatch()),undefined);
      }
      await field.press("Escape");
      if(mode==="spatial"){
        await page.locator('[data-placement-lighting-toggle="hemisphere"]').uncheck();
        assert.equal((await page.evaluate(()=>window.ferrumPlacementViewerSaveDraft())).saved,true);
        const disabled=await page.evaluate(()=>window.__lightingSaveRequests.at(-1).document);
        assert.deepEqual(disabled.spatial.environment.lighting.hemisphere,{...saved.spatial.environment.lighting.hemisphere,enabled:false});
        saved=disabled;
      }
      await page.reload({waitUntil:"networkidle"});await ready();
      const reopened=await page.evaluate(()=>window.ferrumPlacementSpatialExportDocument());
      assert.deepEqual(reopened,saved);
      results.push({mode,focusedSave:true,invalidInputBlocksSave:true,reopen:true,...(mode==="spatial"?{v4LightingPreserved:true,bindingsAndEffectsPreserved:true,disabledHemisphereRetained:true}:{}),desktopHost:"simulated public bridge"});
    }catch(error){await page.screenshot({path:`artifacts/viewer-lighting/${mode}-save-failure.png`,fullPage:true});throw error;}
    finally{await page.close();}
  }
  await writeFile("artifacts/viewer-lighting/saving.json",JSON.stringify({ok:true,results},null,2)+"\n");
  return results;
}
