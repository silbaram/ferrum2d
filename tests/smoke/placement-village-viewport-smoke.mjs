import { clickPlacementControl } from "./placement-panel-navigation.mjs";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

/** Check the actual frame target and pixels, not only CSS bounds or a draw-call counter. */
export async function smokeVillageViewport(page, dpr = 1) {
  const artifact = "artifacts/village-viewport-fix";
  await mkdir(artifact, { recursive: true });
  const sizeBefore = page.viewportSize();
  const docks = ["inspector", "runtime"];
  const visibleBefore = await Promise.all(docks.map(dock =>
    page.locator(`[data-placement-dock-toggle=${dock}]`).getAttribute("aria-pressed")));
  const authored = () => page.evaluate(() => JSON.stringify({
    document: window.ferrumPlacementSpatialExportDocument(),
    history: window.ferrumPlacementViewerHistory,
  }));
  const before = await authored();
  await page.evaluate(() => {
    const renderer = window.ferrumRuntime.renderer;
    const original = renderer.renderCommands;
    const gl = document.querySelector("canvas.demo-canvas").getContext("webgl2");
    const draw = gl.drawArrays;
    renderer.renderCommands = function (...args) {
      const spatial = (args[1] ?? args[0]).spatial;
      window.__villageViewportProbe = spatial ? {
        presentation: Array.from(spatial.presentation ?? [0,0,1,1,0,0]),
        pixelArt: !!(spatial.environment?.values[0] & 16),
      } : undefined;
      return original.apply(this, args);
    };
    gl.drawArrays = function (mode, first, count) {
      if (mode === gl.LINES && window.__villageViewportProbe)
        window.__villageViewportProbe.lines = {
          viewport: Array.from(gl.getParameter(gl.VIEWPORT)),
          blend: gl.isEnabled(gl.BLEND), depth: gl.isEnabled(gl.DEPTH_TEST), count,
        };
      return draw.call(this, mode, first, count);
    };
    window.__restoreVillageViewportProbe = () => {
      renderer.renderCommands = original;
      gl.drawArrays = draw;
    };
  });
  const wait = fn => page.waitForFunction(fn, undefined, { timeout: 30000 });
  const results = [];
  try {
    for (const layout of [
      { width: 1329, height: 920, panels: false },
      { width: 1440, height: 1000, panels: true },
      { width: 1280, height: 900, panels: false },
    ]) {
      await page.setViewportSize({ width: layout.width, height: layout.height });
      for (const dock of docks) {
        const toggle = page.locator(`[data-placement-dock-toggle=${dock}]`);
        if ((await toggle.getAttribute("aria-pressed") === "true") !== layout.panels)
          await clickPlacementControl(page, toggle);
      }
      await wait(() => {
        const c = document.querySelector("canvas.demo-canvas"), p = window.__villageViewportProbe;
        return p?.lines?.viewport[2] === c.width && p.lines.viewport[3] === c.height &&
          c.width === Math.floor(c.clientWidth * devicePixelRatio) &&
          c.height === Math.floor(c.clientHeight * devicePixelRatio);
      });
      const actual = await page.evaluate(() => {
        const c = document.querySelector("canvas.demo-canvas"), g = c.getContext("webgl2");
        const pixels = new Uint8Array(c.width * c.height * 4);
        g.readPixels(0,0,c.width,c.height,g.RGBA,g.UNSIGNED_BYTE,pixels);
        let left=c.width, right=0, top=c.height, bottom=0, colored=0;
        for (let y=0;y<c.height;y++) for (let x=0;x<c.width;x++) {
          const i=(y*c.width+x)*4,r=pixels[i],green=pixels[i+1],b=pixels[i+2];
          if (Math.max(r,green,b)-Math.min(r,green,b)>25 && r+green+b>160) {
            left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);colored++;
          }
        }
        return { ...window.__villageViewportProbe, canvas:[c.width,c.height],
          bounds:{left,right,top,bottom,colored}, stats:window.ferrumRuntime.renderer.stats() };
      });
      assert.equal(actual.pixelArt, false, "Editor still renders through the game pixel target");
      assert.deepEqual(actual.presentation, [0,0,1,1,0,0], "Editor has an invisible inner crop");
      assert(actual.lines.blend && actual.lines.depth, "Grid lost alpha or depth testing");
      assert(actual.bounds.colored > 5000, "Village framebuffer is blank");
      assert(actual.bounds.left > 4 && actual.bounds.top > 4 &&
        actual.bounds.right < actual.canvas[0]-4 && actual.bounds.bottom < actual.canvas[1]-4,
        `Default village camera clips geometry: ${JSON.stringify(actual.bounds)}`);
      assert(actual.stats.drawCalls <= 160 && actual.stats.spatial.modelUploadBytes === 0);
      results.push({layout,...actual});
    }
    // Move a building into the old letterbox margin. It must still render there.
    const point = {x:-225,y:-105,elevation:70};
    const projected = await page.evaluate(point => window.ferrumPlacementSpatialProject(point), point);
    const rect = await page.locator("canvas.demo-canvas").boundingBox();
    const dx = rect.x+64-projected.x, dy = rect.y+rect.height/2-projected.y;
    await page.locator("[data-placement-spatial-navigation=pan]").click();
    await page.mouse.move(rect.x+rect.width/2, rect.y+rect.height/2);
    await page.mouse.down();
    await page.mouse.move(rect.x+rect.width/2+dx, rect.y+rect.height/2+dy, {steps:6});
    await page.mouse.up();
    await page.waitForTimeout(100);
    const edge = await page.evaluate(point => {
      const at=window.ferrumPlacementSpatialProject(point),c=document.querySelector("canvas.demo-canvas"),r=c.getBoundingClientRect(),g=c.getContext("webgl2");
      const x=Math.round((at.x-r.left)*c.width/r.width),y=Math.round((r.bottom-at.y)*c.height/r.height);
      const pixels=new Uint8Array(5*5*4);g.readPixels(x-2,y-2,5,5,g.RGBA,g.UNSIGNED_BYTE,pixels);
      return {x:at.x-r.left,visible:at.visible,colored:Array.from({length:25},(_,i)=>pixels[i*4]+pixels[i*4+1]+pixels[i*4+2]).filter(v=>v>160).length};
    }, point);
    assert(edge.visible && Math.abs(edge.x-64)<3 && edge.colored>5, "Building is cropped inside the canvas margin");
    await page.screenshot({path:`${artifact}/edge-pan-dpr${dpr}.png`,fullPage:true});
    await clickPlacementControl(page, "[data-placement-spatial-camera=reset]");
    await page.locator("[data-placement-spatial-navigation=select]").click();
    await page.getByRole("button",{name:"Play",exact:true}).click();
    await wait(() => window.__villageViewportProbe?.pixelArt === true);
    assert.deepEqual(await page.evaluate(()=>window.__villageViewportProbe.presentation.slice(4)),[384,256]);
    await page.getByRole("button",{name:"Stop",exact:true}).click();
    await wait(() => window.__villageViewportProbe?.pixelArt === false);
    assert.equal(await authored(),before,"Viewport changes mutated the authored scene or history");
    await page.screenshot({path:`${artifact}/editor-dpr${dpr}.png`,fullPage:true});
    await writeFile(`${artifact}/viewport-dpr${dpr}.json`,JSON.stringify({ok:true,dpr,results,edge,gamePixelArtPreserved:true,authoringPreserved:true},null,2)+"\n");
  } finally {
    await page.evaluate(()=>window.__restoreVillageViewportProbe());
    await page.setViewportSize(sizeBefore);
    for (let i=0;i<docks.length;i++) {
      const toggle=page.locator(`[data-placement-dock-toggle=${docks[i]}]`);
      if (await toggle.getAttribute("aria-pressed") !== visibleBefore[i]) await clickPlacementControl(page, toggle);
    }
  }
}
