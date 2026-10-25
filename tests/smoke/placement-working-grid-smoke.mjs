import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { showPlacementInspector, showPlacementViewOptions } from "./placement-panel-navigation.mjs";

/** Real viewport pixels and authoring patches; called by the village CI gate at DPR 1/2. */
export async function smokeWorkingGrid(parent, dpr = 1) {
  const page = await parent.context().browser().newPage({
    viewport: { width: 1440, height: 1000 }, deviceScaleFactor: dpr,
  });
  const errors = [], artifact = "artifacts/working-grid";
  await mkdir(artifact, { recursive: true });
  page.on("pageerror", error => errors.push(error.message));
  const wait = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 30000 });
  const paint = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const snapshot = () => page.evaluate(() => ({
    document: window.ferrumPlacementSpatialExportDocument(),
    history: window.ferrumPlacementViewerHistory,
    count: window.ferrumPlacementViewerState.instances.length,
  }));
  const project = point => page.evaluate(point => window.ferrumPlacementSpatialProject(point), point);
  const ghost = () => page.locator("[data-placement-spatial-add-preview]");
  const preview = () => ghost().evaluate(el => ({
    kind: el.dataset.basis, x: +el.dataset.x, y: +el.dataset.y,
    elevation: +el.dataset.elevation, floor: el.dataset.floor === "" ? undefined : +el.dataset.floor,
    surface: el.dataset.surface, hidden: el.hidden,
  }));
  const arm = async () => {
    await showPlacementInspector(page, "placement");
    await page.locator("[data-placement-spatial-place]").click();
  };
  try {
    await page.goto(parent.url(), { waitUntil: "networkidle" });
    await wait(() => window.ferrumPlacementViewerRuntimeFrame?.spatial?.modelDraws === 41);
    await page.locator("[data-placement-language]").selectOption("en");
    await showPlacementInspector(page, "placement");
    const baseline = await snapshot();
    const outside = await page.evaluate(() => {
      const c = document.querySelector("canvas.demo-canvas"), r = c.getBoundingClientRect();
      const terrain = window.ferrumPlacementViewerState.spatial.terrain;
      const step = window.ferrumPlacementGrid.spacing;
      for (let x=-640; x<0; x+=step) for(let y=-480;y<0;y+=step) {
        if (terrain.some(s => x>=s.x && x<=s.x+s.width && y>=s.y && y<=s.y+s.depth)) continue;
        const p = window.ferrumPlacementSpatialProject({x,y,elevation:0});
        if(p?.visible && p.x>r.left+60 && p.x<r.right-60 && p.y>r.top+80 && p.y<r.bottom-100)
          return {x,y,elevation:0};
      }
    });
    assert(outside, "No visible point outside the village terrain");
    const pixel = () => page.evaluate(point => {
      const p=window.ferrumPlacementSpatialProject({...point,elevation:.025});
      const c=document.querySelector("canvas.demo-canvas"), r=c.getBoundingClientRect(), gl=c.getContext("webgl2");
      const x=Math.round((p.x-r.left)*c.width/r.width), y=c.height-1-Math.round((p.y-r.top)*c.height/r.height);
      const pixels=new Uint8Array(5*5*4); gl.readPixels(x-2,y-2,5,5,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      return Array.from(pixels);
    }, outside);
    console.log(`Working grid DPR ${dpr}: outside-map pixel check`);
    const onPixels=await pixel();
    await showPlacementViewOptions(page);
    await page.locator("[data-placement-grid-toggle]").uncheck();
    await wait(() => window.ferrumPlacementGrid.lineCount===0);
    assert.notDeepEqual(await pixel(),onPixels,"Working grid is missing outside the map");
    await showPlacementViewOptions(page);
    await page.locator("[data-placement-grid-toggle]").check();
    await wait(() => window.ferrumPlacementGrid.lineCount>0);
    await page.locator('[data-placement-working-plane="elevation"]').fill("24");
    await page.locator('[data-placement-working-plane="elevation"]').press("Tab");
    await page.locator('[data-placement-working-plane="floorId"]').fill("2");
    await page.locator('[data-placement-working-plane="floorId"]').press("Tab");
    await page.getByRole("checkbox", { name: "Spatial grid snap", exact: true }).check();
    await wait(() => window.ferrumPlacementGrid.planeElevation===24);
    assert.deepEqual(await snapshot(), baseline,"Display settings changed JSON/history");
    // Display LOD is independent from the base snap interval, including negative coordinates.
    const point={...outside,x:outside.x+3,y:outside.y+5,elevation:24};
    let at=await project(point);
    await arm();
    await paint();
    at=await project(point);
    await page.mouse.move(at.x,at.y);
    await paint();
    assert(await ghost().isHidden(),"Default terrain mode allowed placement over empty space");
    await page.mouse.click(at.x,at.y);
    assert.deepEqual(await snapshot(),baseline,"Rejected terrain placement changed the document");
    await page.keyboard.press("Escape");
    await showPlacementInspector(page,"placement");
    await page.locator("[data-placement-spatial-basis]").selectOption("plane");
    await page.locator("[data-placement-spatial-new-id]").fill("working_grid_sprite");
    await arm();
    await paint();
    at=await project(point);
    await page.mouse.move(at.x,at.y);
    await wait(() => !document.querySelector("[data-placement-spatial-add-preview]").hidden);
    const spriteGhost=await preview();
    assert.equal(spriteGhost.kind,"plane");
    assert.equal(spriteGhost.surface,"");
    assert.equal(spriteGhost.floor,2); assert.equal(spriteGhost.elevation,24);
    assert.equal(spriteGhost.x,Math.round(point.x/16)*16);
    assert.equal(spriteGhost.y,Math.round(point.y/16)*16);
    assert.deepEqual(await snapshot(),baseline,"Ghost created an authoring edit");
    await page.locator("[data-placement-language]").selectOption("ko");
    await paint();
    at=await project(point);
    await page.mouse.move(at.x,at.y);
    await wait(() => document.querySelector("[data-placement-spatial-add-preview]").textContent.includes("실제 지지면 없음"));
    await page.screenshot({path:`${artifact}/plane-preview-dpr${dpr}.png`,fullPage:true});
    await page.mouse.click(at.x,at.y);
    await wait(() => window.ferrumPlacementViewerState.instances.some(i=>i.instanceId==="working_grid_sprite"));
    console.log(`Working grid DPR ${dpr}: sprite commit`);
    const sprite=await page.evaluate(() => {
      const s=window.ferrumPlacementViewerState;
      return {instance:s.selected,native:window.ferrumEngine.getPhysicsEntity(s.selected.entity),patch:window.ferrumPlacementViewerExportPatch()};
    });
    assert.equal(sprite.instance.transform.x,spriteGhost.x);
    assert.equal(sprite.instance.transform.y,spriteGhost.y);
    assert.equal(sprite.instance.body.heightSpan.elevation,24);
    assert.equal(sprite.instance.body.heightSpan.floorId,2);
    assert.equal(sprite.native.heightSpan.elevation,24);
    assert.equal(sprite.native.heightSpan.floorId,2);
    assert.equal((await snapshot()).history.undoCount,baseline.history.undoCount+1);
    assert.deepEqual((await snapshot()).document.spatial.terrain,baseline.document.spatial.terrain,"Plane placement created terrain");
    await page.locator("[data-placement-language]").selectOption("en");
    await page.getByRole("button",{name:"Undo",exact:true}).click();
    await wait(() => !window.ferrumPlacementViewerState.instances.some(i=>i.instanceId==="working_grid_sprite"));
    assert.deepEqual((await snapshot()).document,baseline.document);
    await page.getByRole("button",{name:"Redo",exact:true}).click();
    await wait(() => window.ferrumPlacementViewerState.instances.some(i=>i.instanceId==="working_grid_sprite"));
    await page.getByRole("button",{name:"Undo",exact:true}).click();
    // The same support path must also work for model drag/drop without synthetic terrain IDs.
    await showPlacementInspector(page,"placement");
    await page.locator("[data-placement-spatial-add-kind]").selectOption("model");
    const cart=await page.locator("[data-placement-spatial-add-asset] option").evaluateAll(options => options.find(o=>o.textContent.includes("village_cart")).value);
    await page.locator("[data-placement-spatial-add-asset]").selectOption(cart);
    await page.locator("[data-placement-spatial-new-id]").fill("working_grid_model");
    await paint();
    at=await project(point);
    const transfer=await page.evaluateHandle(()=>new DataTransfer());
    await page.locator("[data-placement-spatial-asset-preview]").dispatchEvent("dragstart",{dataTransfer:transfer});
    await page.locator("canvas.demo-canvas").dispatchEvent("dragover",{dataTransfer:transfer,clientX:at.x,clientY:at.y});
    const modelGhost=await preview();
    assert.equal(modelGhost.hidden,false); assert.equal(modelGhost.kind,"plane");
    await page.locator("canvas.demo-canvas").dispatchEvent("drop",{dataTransfer:transfer,clientX:at.x,clientY:at.y});
    await transfer.dispose();
    await wait(() => window.ferrumPlacementViewerState.instances.some(i=>i.instanceId==="working_grid_model"));
    console.log(`Working grid DPR ${dpr}: model drop`);
    const model=await snapshot(), selected=Object.values(model.document.sceneComposition.fragments).flatMap(f=>f.instances).find(i=>i.id==="working_grid_model");
    assert.equal(selected.x,modelGhost.x); assert.equal(selected.y,modelGhost.y);
    assert.equal(selected.props.components.body,undefined);
    // Blender cart wheels extend to local elevation -1 (center 9, radius 10).
    // The model origin must be 25 so its physical foot remains on the plane at 24.
    assert.equal(model.document.spatial.models.working_grid_model.elevation,25);
    assert.equal(modelGhost.floor,undefined);
    assert.equal(selected.props.components.collider,"none");
    assert.deepEqual(model.document.spatial.terrain,baseline.document.spatial.terrain);
    await wait(() => window.ferrumPlacementViewerRuntimeFrame.spatial.modelDraws===42);
    const modelStats=await page.evaluate(()=>window.ferrumRuntime.renderer.stats());
    assert(modelStats.drawCalls<=160 && modelStats.spatial.modelTriangleCount<=60000);
    await page.getByRole("button",{name:"Undo",exact:true}).click();
    assert.deepEqual((await snapshot()).document,baseline.document);
    await page.getByRole("button",{name:"Play",exact:true}).click();
    await wait(() => window.ferrumPlacementGrid.lineCount===0 && window.ferrumPlacementWorkspaceMode==="game");
    await page.getByRole("button",{name:"Stop",exact:true}).click();
    await wait(() => window.ferrumPlacementGrid.lineCount>0 && window.ferrumPlacementGrid.planeElevation===24);
    assert.deepEqual((await snapshot()).document,baseline.document);
    // Empty terrain and a perspective camera with its horizon near the viewport center.
    const empty=structuredClone(baseline.document);
    empty.spatial.terrain=[];
    empty.spatial.models={}; empty.spatial.billboards={};
    delete empty.spatial.actor; delete empty.gameplay;
    for (const fragment of Object.values(empty.sceneComposition.fragments)) fragment.instances=[];
    empty.spatial.camera={projection:"perspective",position:{x:0,y:-300,elevation:8},target:{x:0,y:0,elevation:0},near:.1,far:2000,fovDegrees:55};
    await page.locator("[data-placement-document-file]").setInputFiles({name:"empty-working-plane.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(empty))});
    await wait(() => window.ferrumPlacementSpatialExportDocument().spatial.terrain.length===0 &&
      window.ferrumPlacementViewerState.instances.length===0 &&
      window.ferrumPlacementViewerRuntimeFrame.entityCount===0 && window.ferrumPlacementGrid.lineCount>0);
    const emptyBefore=await snapshot();
    for(const action of ["left","in","out","right"]) await page.locator(`[data-placement-spatial-camera="${action}"]`).click();
    const grid=await page.evaluate(()=>window.ferrumPlacementGrid);
    assert(grid.lineCount>0 && grid.lineCount<=512 && grid.depthTest && grid.drawCalls===1);
    assert.deepEqual(await snapshot(),emptyBefore,"Camera changes modified the empty scene");
    await page.screenshot({path:`${artifact}/empty-perspective-dpr${dpr}.png`,fullPage:true});
    assert.deepEqual(errors,[]);
    console.log(`Working grid DPR ${dpr}: passed`);
    await writeFile(`${artifact}/dpr${dpr}.json`,JSON.stringify({ok:true,dpr,outside,spriteGhost,modelGhost,grid,spritePatch:sprite.patch,checks:["outside-map framebuffer pixels","terrain mode rejects empty space","explicit plane height/floor","negative snap","preview and commit agree","native sprite height/floor","model drop creates no terrain/collider","Undo/Redo","display and camera preserve JSON/history","Game Preview hides grid","empty terrain perspective horizon"]},null,2)+"\n");
  } catch(error) {
    await page.screenshot({path:`${artifact}/failure-dpr${dpr}.png`,fullPage:true});
    console.error(await page.evaluate(()=>({message:document.querySelector(".placement-spatial-message")?.textContent,documentError:document.querySelector(".placement-workspace-message")?.textContent,grid:window.ferrumPlacementGrid,ghost:document.querySelector("[data-placement-spatial-add-preview]")?.outerHTML})));
    throw error;
  } finally { await page.close(); }
}
