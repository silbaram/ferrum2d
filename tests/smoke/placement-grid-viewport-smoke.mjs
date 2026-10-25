import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { showPlacementInspector, showPlacementViewOptions } from "./placement-panel-navigation.mjs";

/** Native projection plus actual top/bottom framebuffer pixels catch a shrinking grid band. */
export async function smokeGridViewport(parent, dpr = 1) {
  const page = await parent.context().browser().newPage({viewport:{width:1440,height:1000},deviceScaleFactor:dpr});
  const artifact="artifacts/grid-viewport", errors=[], results=[];
  await mkdir(artifact,{recursive:true});
  page.on("pageerror",e=>errors.push(e.message));
  page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
  const wait=(fn,arg)=>page.waitForFunction(fn,arg,{timeout:30000});
  const paint=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const snapshot=()=>page.evaluate(()=>JSON.stringify({document:window.ferrumPlacementSpatialExportDocument(),
    patch:window.ferrumPlacementViewerExportPatch(),history:window.ferrumPlacementViewerHistory}));
  const camera=()=>page.evaluate(()=>window.ferrumPlacementSpatialCamera);
  async function angle(value) {
    await showPlacementViewOptions(page);
    const input=page.locator("[data-placement-camera-pitch]");
    await input.focus();await input.press("Home");
    for(let i=1;i<value;i++)await input.press("ArrowRight");
    await page.keyboard.press("Escape");await paint();
  }
  async function check(label,pixels=false,entities=45) {
    await paint();
    const actual=await page.evaluate(()=>{
      const c=window.ferrumPlacementSpatialCamera, r=document.querySelector("canvas.demo-canvas").getBoundingClientRect(),
        e=window.ferrumPlacementGrid.planeElevation, dx=c.position.x-c.target.x,dy=c.position.y-c.target.y,
        dz=c.position.elevation-c.target.elevation,d=Math.hypot(dx,dy,dz),h=Math.hypot(dx,dy),
        right=[-dy/h,dx/h,0],up=[-dx*dz/h/d,-dy*dz/h/d,h/d],
        samples=[];
      // Independent orthographic rays from the navigation camera, checked against
      // the camera actually presented by Rust. A fixed far plane fails visibility.
      for(const u of [-.9,.9])for(const v of [-.9,.9]) {
        const x=u*c.height*r.width/r.height/2,y=v*c.height/2,
          t=(c.position.elevation+up[2]*y-e)/(dz/d),
          world={x:c.position.x+right[0]*x+up[0]*y-dx/d*t,
            y:c.position.y+right[1]*x+up[1]*y-dy/d*t,elevation:e},
          projected=window.ferrumPlacementSpatialProject(world);
        samples.push({world,projected,expected:{x:r.left+(u+1)*r.width/2,y:r.top+(1-v)*r.height/2}});
      }
      return {camera:c,renderCamera:window.ferrumPlacementSpatialRenderCamera,samples,
        canvas:[r.width,r.height],grid:window.ferrumPlacementGrid,stats:window.ferrumRuntime.renderer.stats(),
        entities:window.ferrumPlacementViewerRuntimeFrame.entityCount};
    });
    for(const {projected,expected} of actual.samples) {
      assert(projected?.visible,`${label}: working plane clipped near viewport edge`);
      assert(Math.hypot(projected.x-expected.x,projected.y-expected.y)<1,`${label}: fitting moved the screen projection`);
    }
    assert.equal(actual.entities,entities);
    assert(actual.grid.lineCount>0 && actual.grid.lineCount<=512 && actual.grid.drawCalls===1 && actual.grid.depthTest);
    assert(actual.stats.drawCalls>0 && actual.stats.drawCalls<=160 && actual.stats.spatial.modelTriangleCount<=60000);
    if(pixels) {
      await page.evaluate(()=>{
        const c=document.querySelector("canvas.demo-canvas"),g=c.getContext("webgl2"),b=new Uint8Array(c.width*c.height*4);
        g.readPixels(0,0,c.width,c.height,g.RGBA,g.UNSIGNED_BYTE,b);window.__gridOnPixels=b;
      });
      await showPlacementViewOptions(page);await page.locator("[data-placement-grid-toggle]").uncheck();await paint();
      actual.bandChanges=await page.evaluate(()=>{
        const c=document.querySelector("canvas.demo-canvas"),g=c.getContext("webgl2"),off=new Uint8Array(c.width*c.height*4),
          on=window.__gridOnPixels,changes={top:0,bottom:0};
        g.readPixels(0,0,c.width,c.height,g.RGBA,g.UNSIGNED_BYTE,off);
        for(const [name,min,max] of [["top",.75,.9],["bottom",.1,.25]])
          for(let y=Math.floor(c.height*min);y<c.height*max;y++)for(let x=0;x<c.width;x++) {
            const i=(y*c.width+x)*4;
            if(Math.abs(on[i]-off[i])+Math.abs(on[i+1]-off[i+1])+Math.abs(on[i+2]-off[i+2])>3)changes[name]++;
          }
        delete window.__gridOnPixels;return changes;
      });
      assert(actual.bandChanges.top>50*dpr && actual.bandChanges.bottom>50*dpr,`${label}: missing grid pixels at top/bottom: ${JSON.stringify(actual.bandChanges)}`);
      await page.locator("[data-placement-grid-toggle]").check();await page.keyboard.press("Escape");await paint();
    }
    results.push({label,...actual});console.log(`Grid viewport ${label} DPR ${dpr}: passed`);
  }
  async function gameCamera() {
    await page.getByRole("button",{name:"Play",exact:true}).click();
    await wait(()=>window.ferrumPlacementWorkspaceMode==="game" && window.ferrumPlacementGrid.lineCount===0);await paint();
    const matrix=await page.evaluate(()=>window.__gridViewportCamera);
    await page.getByRole("button",{name:"Stop",exact:true}).click();
    await wait(()=>window.ferrumPlacementWorkspaceMode==="spatial" && window.ferrumPlacementGrid.lineCount>0);await paint();
    return matrix;
  }
  try {
    await page.goto(parent.url(),{waitUntil:"networkidle"});
    await wait(()=>window.ferrumPlacementViewerRuntimeFrame?.spatial?.modelDraws===41);
    await page.locator("[data-placement-language]").selectOption("en");
    for(const dock of ["scene","inspector","runtime"]) {
      const toggle=page.locator(`[data-placement-dock-toggle=${dock}]`);
      if(await toggle.getAttribute("aria-pressed")==="true")await toggle.click();
    }
    await page.evaluate(()=>{
      const r=window.ferrumRuntime.renderer,original=r.renderCommands;
      r.renderCommands=function(...args) {
        const spatial=(args[1]??args[0]).spatial;
        window.__gridViewportCamera=spatial?Array.from(spatial.camera):undefined;
        return original.apply(this,args);
      };
    });
    await paint();
    const baseline=await snapshot(),base=await page.evaluate(()=>window.ferrumPlacementSpatialExportDocument()),gameBefore=await gameCamera();
    await angle(1);await check("low-angle",true);
    await angle(7);
    for(let i=0;i<4;i++)await page.locator("[data-placement-spatial-camera=out]").click();
    await check("zoom-out",true);
    await page.screenshot({path:`${artifact}/zoom-out-dpr${dpr}.png`,fullPage:true});
    const r=await page.locator("canvas.demo-canvas").boundingBox();
    await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down({button:"middle"});
    await page.mouse.move(r.x+r.width/2+24,r.y+r.height/2+12,{steps:3});await page.mouse.up({button:"middle"});
    await page.locator("[data-placement-spatial-camera=left]").click();await check("pan-orbit");
    await page.setViewportSize({width:1064,height:940});await check("resize",true);
    await showPlacementViewOptions(page);
    await page.locator('[data-placement-working-plane="elevation"]').fill("24");
    await page.locator('[data-placement-working-plane="elevation"]').press("Tab");
    await page.keyboard.press("Escape");await check("raised-plane");
    await page.setViewportSize({width:1440,height:1000});
    const saved=await camera();
    assert.deepEqual(await gameCamera(),gameBefore,"Editor fitting changed the authored game camera");
    assert.deepEqual(await camera(),saved,"Stop lost the navigation camera");
    assert.equal(await snapshot(),baseline,"Camera fitting changed JSON/patch/history");
    await page.locator("[data-placement-spatial-camera=reset]").click();
    assert.deepEqual(await camera(),base.spatial.camera);
    // Truly empty documents have no terrain, props or actor to hide a missing grid.
    const empty=structuredClone(base);empty.spatial.terrain=[];empty.spatial.models={};empty.spatial.billboards={};
    delete empty.spatial.actor;delete empty.gameplay;
    for(const f of Object.values(empty.sceneComposition.fragments))f.instances=[];
    empty.spatial.camera={projection:"orthographic",position:{x:0,y:-300,elevation:6},
      target:{x:0,y:0,elevation:0},height:1800,near:.1,far:2200};
    await page.locator("[data-placement-document-file]").setInputFiles({name:"empty-grid-viewport.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(empty))});
    await wait(()=>window.ferrumPlacementViewerRuntimeFrame.entityCount===0 && window.ferrumPlacementSpatialCamera?.height===1800);
    const emptyBefore=await snapshot();await check("empty-plane",true,0);
    for(let i=0;i<4;i++)await page.locator("[data-placement-spatial-camera=out]").click();
    await check("empty-zoom-out",true,0);
    assert.equal(await snapshot(),emptyBefore);
    await page.screenshot({path:`${artifact}/empty-dpr${dpr}.png`,fullPage:true});
    await showPlacementViewOptions(page);
    await page.getByRole("checkbox",{name:"Spatial grid snap",exact:true}).uncheck();
    await showPlacementInspector(page,"placement");
    await page.locator("[data-placement-spatial-add-asset]").selectOption("crate");
    await page.locator("[data-placement-spatial-basis]").selectOption("plane");
    await page.locator("[data-placement-spatial-place]").click();await paint();
    const edge=await page.locator("canvas.demo-canvas").boundingBox(),point={x:edge.x+edge.width*.5,y:edge.y+edge.height*.85};
    await page.mouse.move(point.x,point.y);
    await wait(()=>!document.querySelector("[data-placement-spatial-add-preview]").hidden);
    const ghost=await page.locator("[data-placement-spatial-add-preview]").evaluate(el=>({
      basis:el.dataset.basis,elevation:+el.dataset.elevation,floor:+el.dataset.floor,
      projected:window.ferrumPlacementSpatialProject({x:+el.dataset.x,y:+el.dataset.y,elevation:+el.dataset.elevation}),
    }));
    assert.equal(ghost.basis,"plane");assert.equal(ghost.elevation,0);assert.equal(ghost.floor,0);
    assert(ghost.projected.visible && Math.hypot(ghost.projected.x-point.x,ghost.projected.y-point.y)<1,
      "Fitted camera broke the inverse placement ray at the viewport edge");
    await page.keyboard.press("Escape");assert.equal(await snapshot(),emptyBefore);
    assert.deepEqual(errors,[]);
    await writeFile(`${artifact}/dpr${dpr}.json`,JSON.stringify({ok:true,dpr,results,ghost,
      checks:["native edge projection","top/bottom grid framebuffer pixels","zoom/pitch/pan/orbit/resize/raised plane",
        "empty scene and viewport-edge placement ghost","45/0 native entities and bounded draws/triangles","game camera unchanged","Stop/Reset and JSON/history preservation"]},null,2)+"\n");
  } catch(error) {
    await page.screenshot({path:`${artifact}/failure-dpr${dpr}.png`,fullPage:true});throw error;
  } finally {await page.close();}
}
