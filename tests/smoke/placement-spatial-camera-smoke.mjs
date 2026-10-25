import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { showPlacementInspector, showPlacementViewOptions } from "./placement-panel-navigation.mjs";

const pitch = c => Math.atan2(c.position.elevation-c.target.elevation,
  Math.hypot(c.position.x-c.target.x,c.position.y-c.target.y))*180/Math.PI;
const distance = c => Math.hypot(c.position.x-c.target.x,c.position.y-c.target.y,c.position.elevation-c.target.elevation);
const near = (a,b,tolerance=1e-6) => assert(Math.abs(a-b)<=tolerance,`${a} != ${b}`);

/** Real controls/native projections, in the village browser/CI gate at DPR 1/2. */
export async function smokeSpatialCameraAngles(parent, dpr=1) {
  const page=await parent.context().browser().newPage({viewport:{width:1440,height:1000},deviceScaleFactor:dpr});
  const artifact="artifacts/spatial-camera-angles", errors=[], results=[];
  await mkdir(artifact,{recursive:true});
  page.on("pageerror",error=>errors.push(error.message));
  const wait=(fn,arg)=>page.waitForFunction(fn,arg,{timeout:30000});
  const paint=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const camera=()=>page.evaluate(()=>window.ferrumPlacementSpatialCamera);
  const source=()=>page.evaluate(()=>window.ferrumPlacementSpatialExportDocument());
  const snapshot=()=>page.evaluate(()=>JSON.stringify({
    document:window.ferrumPlacementSpatialExportDocument(), patch:window.ferrumPlacementViewerExportPatch(),
    history:window.ferrumPlacementViewerHistory,
  }));
  const landmarks=()=>page.evaluate(()=>[{x:0,y:0,elevation:0},{x:80,y:120,elevation:0},{x:0,y:0,elevation:100}]
    .map(p=>window.ferrumPlacementSpatialProject(p)));
  const slider=page.locator("[data-placement-camera-pitch]");
  async function angle(value) {
    await showPlacementViewOptions(page);
    const rect=await slider.boundingBox();
    await page.mouse.click(rect.x+8+(rect.width-16)*(value-1)/88,rect.y+rect.height/2);
    await paint();
    const c=await camera(), input=await slider.inputValue();
    near(pitch(c),Number(input)); near(pitch(c),value,1);
    return c;
  }
  try {
    await page.goto(parent.url(),{waitUntil:"networkidle"});
    await wait(()=>window.ferrumPlacementViewerRuntimeFrame?.spatial?.modelDraws===41);
    await page.locator("[data-placement-language]").selectOption("en");
    const base=await source();
    const originalTab=await page.locator("[data-placement-document-key][aria-selected=true]").textContent();
    let orthoResume, perspectiveResume;
    for(const projection of ["orthographic","perspective"]) {
      if(projection==="perspective") {
        const document=structuredClone(base);
        document.spatial.camera.projection="perspective";
        document.spatial.camera.fovDegrees=55;
        delete document.spatial.camera.height;
        await page.locator("[data-placement-document-file]").setInputFiles({
          name:"camera-perspective.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(document)),
        });
        await wait(()=>window.ferrumPlacementSpatialCamera?.projection==="perspective" &&
          window.ferrumPlacementWorkspaceMode==="spatial" && !document.querySelector(".demo-shell").inert);
      }
      await paint();
      const original=await camera(), baseline=await snapshot(), before=await landmarks();
      const plane=await page.evaluate(()=>window.ferrumPlacementGrid.planeElevation);
      await page.locator("[data-placement-spatial-camera=up]").click();
      await paint();
      const above=await camera(), after=await landmarks();
      near(pitch(above),pitch(original)+10);
      near(distance(above),distance(original)); assert.deepEqual(above.target,original.target);
      assert(after.some((p,i)=>p && before[i] && Math.hypot(p.x-before[i].x,p.y-before[i].y)>2),"Native projection did not change with the UI camera");
      for(const key of ["height","fovDegrees","near","far"]) assert.equal(above[key],original[key]);
      await page.locator("[data-placement-spatial-camera=down]").click();
      near(pitch(await camera()),pitch(original));
      await showPlacementViewOptions(page);
      await slider.focus(); await slider.press("Home"); await paint();
      near(pitch(await camera()),1);
      assert(await page.locator("[data-placement-spatial-camera=down]").isDisabled());
      const low=await landmarks();
      const lowStats=await page.evaluate(()=>window.ferrumRuntime.renderer.stats());
      assert(lowStats.drawCalls>0 && lowStats.drawCalls<=160 && lowStats.spatial.modelTriangleCount>0 && lowStats.spatial.modelTriangleCount<=60000);
      await page.screenshot({path:`${artifact}/${projection}-low-dpr${dpr}.png`,fullPage:true});
      await slider.press("End"); await paint();
      near(pitch(await camera()),89);
      assert(await page.locator("[data-placement-spatial-camera=up]").isDisabled());
      await page.screenshot({path:`${artifact}/${projection}-high-dpr${dpr}.png`,fullPage:true});
      await slider.press("ArrowLeft");
      near(pitch(await camera()),88);
      assert(!(await page.locator("[data-placement-spatial-camera=up]").isDisabled()));
      const middle=await angle(45);
      near(distance(middle),distance(original)); assert.deepEqual(middle.target,original.target);
      await page.locator("[data-placement-spatial-camera=left]").click();
      near(pitch(await camera()),pitch(middle));
      await page.locator("[data-placement-spatial-camera=right]").click();
      near(pitch(await camera()),pitch(middle));
      const panBefore=await camera(), rect=await page.locator("canvas.demo-canvas").boundingBox();
      await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);
      await page.mouse.down({button:"middle"});
      await page.mouse.move(rect.x+rect.width/2+24,rect.y+rect.height/2+12,{steps:3});
      await page.mouse.up({button:"middle"});
      await paint();
      near(pitch(await camera()),pitch(panBefore));
      near(distance(await camera()),distance(panBefore));
      assert(await slider.isEnabled(),"Pan left the viewing-angle slider disabled");
      assert(await page.locator("[data-placement-spatial-camera=up]").isEnabled(),"Pan left the pitch buttons disabled");
      // A native terrain hit and sprite picking/ghost must use the changed pitch.
      // Keep the enclosing landscape's coarse model bounds out of object picking.
      if (!await page.evaluate(()=>window.ferrumPlacementViewerState.lockedInstanceIds.includes("village_landscape")))
        await page.locator('[data-placement-lock-instance="village_landscape"]:visible').click();
      await page.locator('button[data-instance-id="sunflower_inn"]:visible').click();
      await paint();
      const hero=await page.evaluate(()=>window.ferrumPlacementSpatialProject({x:-30,y:-102,elevation:10}));
      assert(hero?.visible);
      await page.mouse.click(hero.x,hero.y);
      await wait(()=>window.ferrumPlacementSpatialTarget?.id==="village_hero");
      await showPlacementInspector(page,"placement");
      await page.locator("[data-placement-spatial-add-asset]").selectOption("crate");
      await page.locator("[data-placement-spatial-place]").click();
      const ground=await page.evaluate(()=>window.ferrumPlacementSpatialProject({x:-30,y:-102,elevation:0}));
      await page.mouse.move(ground.x,ground.y);
      await wait(()=>!document.querySelector("[data-placement-spatial-add-preview]").hidden);
      assert.equal(await page.locator("[data-placement-spatial-add-preview]").getAttribute("data-surface"),"west_bank");
      await page.keyboard.press("Escape");
      const savedCamera=await camera();
      await page.getByRole("button",{name:"Play",exact:true}).click();
      await wait(()=>window.ferrumPlacementWorkspaceMode==="game" && window.ferrumPlacementGrid.lineCount===0);
      assert(await slider.isHidden());
      await page.getByRole("button",{name:"Stop",exact:true}).click();
      await wait(()=>window.ferrumPlacementWorkspaceMode==="spatial" && window.ferrumPlacementGrid.lineCount>0);
      assert.deepEqual(await camera(),savedCamera,"Stop lost the edited viewing angle");
      assert.equal(await snapshot(),baseline,"Viewing angle/picking/ghost/preview mutated JSON or history");
      await page.locator("[data-placement-spatial-camera=reset]").click();
      assert.deepEqual(await camera(),original,"Reset did not restore the authored camera");
      const stats=await page.evaluate(()=>window.ferrumRuntime.renderer.stats());
      const grid=await page.evaluate(()=>window.ferrumPlacementGrid);
      assert.equal(grid.planeElevation,plane); assert(grid.lineCount>0 && grid.lineCount<=512 && grid.drawCalls===1 && grid.depthTest);
      assert(stats.drawCalls>0 && stats.drawCalls<=160 && stats.spatial.modelTriangleCount>0 && stats.spatial.modelTriangleCount<=60000);
      assert.equal(await page.evaluate(()=>window.ferrumPlacementViewerRuntimeFrame.entityCount),45);
      results.push({projection,original,above,middle,low,lowStats,grid,stats});
      if(projection==="orthographic") orthoResume=await angle(60);
      else perspectiveResume=await camera();
      console.log(`Camera pitch ${projection} DPR ${dpr}: passed`);
    }
    await page.getByRole("tab",{name:originalTab,exact:true}).click();
    await wait(()=>window.ferrumPlacementSpatialCamera?.projection==="orthographic");
    assert.deepEqual(await camera(),orthoResume,"Document switch lost the orthographic viewing angle");
    await page.getByRole("tab",{name:"camera-perspective.json",exact:true}).click();
    await wait(()=>window.ferrumPlacementSpatialCamera?.projection==="perspective");
    assert.deepEqual(await camera(),perspectiveResume,"Document switch reused another tab's viewing angle");
    await page.locator("[data-placement-language]").selectOption("ko");
    assert.equal(await page.locator("[data-placement-spatial-camera=up]").getAttribute("aria-label"),"위에서 보기");
    await showPlacementViewOptions(page);
    assert.equal(await slider.getAttribute("aria-label"),"내려다보는 각도");
    const current=await camera();
    assert.equal(await page.locator("[data-placement-camera-pitch-value]").textContent(),`${Number(pitch(current).toFixed(1))}°`);
    await page.screenshot({path:`${artifact}/controls-ko-dpr${dpr}.png`,fullPage:true});
    assert.deepEqual(errors,[]);
    await writeFile(`${artifact}/dpr${dpr}.json`,JSON.stringify({ok:true,dpr,results,checks:["up/down native projection","target/distance/lens preservation","range keyboard/mouse and limits","pan preserves pitch and restores control availability","native picking/terrain ghost","no JSON/patch/history mutation","Play/Stop, Reset and per-document camera restoration","grid depth/budget","45 entities and bounded draws/triangles","Korean controls"]},null,2)+"\n");
  } catch(error) {
    await page.screenshot({path:`${artifact}/failure-dpr${dpr}.png`,fullPage:true});
    console.error(await page.evaluate(()=>({camera:window.ferrumPlacementSpatialCamera,message:document.querySelector(".placement-spatial-message")?.textContent,error:document.querySelector(".placement-workspace-message")?.textContent})));
    throw error;
  } finally {await page.close();}
}
