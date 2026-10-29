import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { showPlacementViewOptions, showPlacementInspector, showPlacementBottom, clickPlacementControl } from "./placement-panel-navigation.mjs";

/** Exercise the public UI and native renderer; no DOM visibility overrides or private resource imports. */
export async function smokeThreejsViewerUpgrades(parent, timeoutMs = 30000) {
  const browser = parent.context().browser(), page = await browser.newPage({viewport:{width:1440,height:1000}}), errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  const artifact="artifacts/threejs-viewer-upgrades"; await mkdir(artifact,{recursive:true});
  const url=new URL(parent.url());url.search="?scene=village";
  const wait=fn=>page.waitForFunction(fn,undefined,{timeout:timeoutMs});
  const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const authored=()=>page.evaluate(()=>JSON.stringify(window.ferrumPlacementSpatialExportDocument()));
  const history=()=>page.evaluate(()=>window.ferrumPlacementViewerHistory);
  const select=async id=>{await page.locator("[data-placement-spatial-target]").selectOption("model:"+id);await paint();};
  const pose=id=>page.evaluate(id=>window.ferrumPlacementViewerState.instances.find(i=>i.instanceId===id).transform,id);
  let failures=0;
  // Fail exactly one model fetch; retry must continue the original bootstrap, not merely clear an error.
  const manifest=JSON.parse(await readFile("apps/placement-viewer/public/assets/rpg-village/manifest.json","utf8"));
  const modelPath=manifest.models.village_tower.file;
  await page.route("**/"+modelPath,route=>{
    if(failures++===0)return route.fulfill({status:503,body:"fixture unavailable"});
    return route.continue();
  });
  const checks={};
  try {
    await page.goto(url.href);
    await page.locator("[data-placement-asset-loading=error]").waitFor({timeout:timeoutMs});
    assert.match(await page.locator("[data-placement-asset-loading=error]").textContent(),/clock_tower|503/);
    await page.locator("[data-placement-asset-retry]").click();
    await wait(()=>window.ferrumPlacementViewerRuntimeFrame?.spatial?.modelDraws===42);
    assert(failures>=2);checks.modelRetryResumesBootstrap=true;
    console.log("Viewer upgrades: model retry passed");
    await page.locator("[data-placement-language]").selectOption("en");
    const initial=await authored();
    await showPlacementViewOptions(page);await page.locator("[data-placement-camera-guide]").check();await page.keyboard.press("Escape");
    await wait(()=>document.querySelector(".placement-camera-guide circle.target"));
    const guide=await page.locator(".placement-camera-guide").evaluate(svg=>({paths:svg.querySelectorAll("path").length,bad:[...svg.querySelectorAll("path")].some(p=>/NaN|Infinity/.test(p.getAttribute("d"))),stroke:svg.querySelector("path")?getComputedStyle(svg.querySelector("path")).stroke:undefined,marker:!!svg.querySelector("circle.target"),outside:!!svg.querySelector("[data-placement-camera-guide-outside]")}));
    assert(!guide.bad&&guide.marker&&(guide.outside||guide.paths>0&&guide.stroke!=="none"));
    for(let i=0;i<2;i++)await clickPlacementControl(page,"[data-placement-spatial-camera=out]");
    await wait(()=>document.querySelectorAll(".placement-camera-guide path:not(.direction)").length>=4);
    assert.notEqual(await page.locator(".placement-camera-guide path").first().evaluate(p=>getComputedStyle(p).stroke),"none");
    await clickPlacementControl(page,"[data-placement-spatial-camera=reset]");
    assert.equal(await authored(),initial);checks.cameraGuidePreservesAuthoring=true;
    console.log("Viewer upgrades: camera guide passed");
    await showPlacementInspector(page);
    await select("oak_0");
    const empty=await page.evaluate(()=>{
      const points=window.ferrumPlacementSpatialSelection.bounds;
      return{x:Math.min(...points.map(p=>p.x))+1,y:Math.min(...points.map(p=>p.y))+1};
    });
    await page.mouse.click(empty.x,empty.y);await paint();
    assert.notEqual(await page.evaluate(()=>window.ferrumPlacementSpatialTarget?.id),"oak_0","Empty model bounds still intercept selection");
    checks.meshBoundsEmptySpace=true;
    await select("west_cottage");await page.locator("[data-placement-spatial-move-axis]").selectOption("x");
    const origin=await pose("west_cottage"),beforeHistory=await history();
    const at=await page.evaluate(()=>{const i=window.ferrumPlacementViewerState.instances.find(i=>i.instanceId==="west_cottage");return window.ferrumPlacementSpatialProject({x:i.transform.x,y:i.transform.y,elevation:40});});
    await page.mouse.move(at.x,at.y);await page.mouse.down();await page.mouse.move(at.x+32,at.y-12,{steps:4});await page.mouse.up();await paint();
    const moved=await pose("west_cottage");assert.notEqual(moved.x,origin.x);assert.equal(moved.y,origin.y);assert.equal((await history()).undoCount,beforeHistory.undoCount+1);
    await page.locator("[data-placement-action=undo]").click();await paint();assert.deepEqual(await pose("west_cottage"),origin);
    const rotate=page.locator("[data-placement-spatial-rotate]");await rotate.focus();await rotate.press("Shift+ArrowRight");await paint();
    assert.match(await rotate.textContent(),/15/);
    await page.locator("[data-placement-action=undo]").click();await paint();
    const box=await rotate.boundingBox(),beforeCancel=await authored();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+27,box.y+box.height/2,{steps:3});await page.keyboard.press("Escape");await page.mouse.up();await paint();
    assert.equal(await authored(),beforeCancel);checks.axisMoveUndoAndRotationCancel=true;
    const beforeWheel=await page.evaluate(()=>window.ferrumPlacementSpatialCamera.height),handle=await page.locator("[data-placement-spatial-height]").boundingBox();
    await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.wheel(0,-100);
    await page.waitForFunction(height=>window.ferrumPlacementSpatialCamera.height<height,beforeWheel);
    await page.mouse.wheel(0,100);await page.waitForFunction(height=>Math.abs(window.ferrumPlacementSpatialCamera.height-height)<1e-6,beforeWheel);
    assert.equal(await authored(),beforeCancel);checks.gizmoWheelNavigation=true;
    console.log("Viewer upgrades: mesh selection and transforms passed");
    // Physics overlay and native read-only summary include the actual circular well.
    await select("village_well");
    await showPlacementViewOptions(page);await page.locator("[data-placement-proxy-overlay]").check();
    await page.locator("[data-placement-physics-overlay=contacts]").check();await page.locator("[data-placement-physics-overlay=floors]").check();await page.keyboard.press("Escape");
    await showPlacementBottom(page,"runtime");
    await wait(()=>window.ferrumPlacementSelectedRuntime?.instanceId==="village_well"&&window.ferrumPlacementSelectedRuntime.colliders?.length);
    assert.match(await page.locator("[data-placement-physics-summary]").textContent(),/circle/);
    await page.locator("[data-placement-performance] > summary").click();
    await wait(()=>window.ferrumPlacementPerformance?.resources?.bufferCount>0);
    const resources=await page.evaluate(()=>window.ferrumPlacementPerformance);
    assert(resources.cpuModelBytes>0&&resources.resources.estimatedBytes>0);assert.equal(resources.stats.spatial.modelUploadBytes,0);
    const bytes=resources.resources.estimatedBytes;
    await page.locator('[data-placement-mode="2d"]').click();
    await wait(()=>window.ferrumPlacementWorkspaceMode==="2d"&&!window.ferrumPlacementPerformance.stats.spatial);
    assert.match(await page.locator("[data-placement-performance]").textContent(),/Not Applicable/);
    await page.locator("[data-placement-mode=spatial]").click();
    await wait(()=>window.ferrumPlacementWorkspaceMode==="spatial"&&window.ferrumPlacementPerformance.stats.spatial?.modelCount===42);
    // Repeated editor/game transitions must reach the same warmed allocation plateau.
    const allocation=[];
    for(let i=0;i<3;i++) {
      await page.getByRole("button",{name:"Play",exact:true}).click();await wait(()=>window.ferrumPlacementWorkspaceMode==="game");
      assert(await page.locator(".placement-camera-guide").isHidden());
      await page.getByRole("button",{name:"Stop",exact:true}).click();await wait(()=>window.ferrumPlacementWorkspaceMode==="spatial");
      await page.waitForTimeout(550);allocation.push(await page.evaluate(()=>window.ferrumRuntime.renderer.resourceStats().estimatedBytes));
    }
    assert.equal(allocation[2],allocation[1],"Warmed scene transitions grow GPU allocations");
    console.log("Viewer upgrades: native diagnostics and resource plateau passed");
    assert.equal(await authored(),beforeCancel);checks.physicsAndResourcePlateau={bytes,allocation};
    await page.locator("[data-placement-language]").selectOption("ko");
    assert.match(await page.locator("[data-placement-performance]").textContent(),/렌더링 및 자원/);
    assert.match(await page.locator("[data-placement-physics-summary]").textContent(),/물리/);
    await page.screenshot({path:artifact+"/diagnostics-ko.png",fullPage:true});
    const disposed = await page.evaluate(()=>{
      const runtime=window.ferrumRuntime,renderer=runtime.renderer;
      runtime.stop();runtime.destroy();renderer.destroy();return renderer.resourceStats();
    });
    for(const key of ["textureCount","bufferCount","programCount","renderTargetCount","bufferBytes","estimatedBytes"]) assert.equal(disposed[key],0,`Disposal retained ${key}`);
    checks.rendererDisposal=true;
    assert.deepEqual(errors,[]);checks.noBrowserErrors=true;
    await writeFile(artifact+"/checks.json",JSON.stringify({ok:true,checks,guide},null,2)+"\n");
    return checks;
  } catch(error) {await page.screenshot({path:artifact+"/failure.png",fullPage:true});throw error;}
  finally {await page.close();}
}
