import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { showPlacementViewOptions } from "./placement-panel-navigation.mjs";

/** The checkbox must change visible terrain pixels and match playable native heights. */
export async function smokeVillageHeightGrid(parent, dpr = 1) {
  const artifact = "artifacts/village-height-grid";
  await mkdir(artifact, { recursive: true });
  const page = await parent.context().browser().newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: dpr });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const wait = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 30000 });
  const paint = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const snapshot = () => page.evaluate(() => JSON.stringify({ document: window.ferrumPlacementSpatialExportDocument(), patch: window.ferrumPlacementViewerExportPatch(), history: window.ferrumPlacementViewerHistory, camera: window.ferrumPlacementSpatialCamera }));
  const pose = () => page.evaluate(() => {
    const handle = window.ferrumPlacementViewerState.instances.find(item => item.instanceId === "village_hero").entity;
    const { x, y, heightSpan } = window.ferrumEngine.getPhysicsEntity(handle);
    return { x, y, heightSpan };
  });
  async function terrainGrid(enabled) {
    await showPlacementViewOptions(page);
    await page.locator("[data-placement-terrain-grid]").setChecked(enabled);
    assert.equal(await page.locator(".placement-terrain-grid-legend").isVisible(), enabled);
    await page.keyboard.press("Escape"); await paint();
  }
  try {
    await page.goto(parent.url(), { waitUntil: "networkidle" });
    await wait(() => window.ferrumPlacementViewerRuntimeFrame?.spatial?.modelDraws === 42);
    await page.locator("[data-placement-language]").selectOption("ko");
    const original = await snapshot();
    await terrainGrid(false);
    const off = await page.evaluate(() => {
      const canvas = document.querySelector("canvas.demo-canvas"), gl = canvas.getContext("webgl2");
      window.__heightGridOff = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, window.__heightGridOff);
      return window.ferrumPlacementGrid;
    });
    await page.screenshot({ path: `${artifact}/off-dpr${dpr}.png`, fullPage: true });
    await terrainGrid(true);
    const on = await page.evaluate(() => {
      const canvas = document.querySelector("canvas.demo-canvas"), rect = canvas.getBoundingClientRect(), gl = canvas.getContext("webgl2"), pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const points = [];
      for (const x of [-180, -16]) for (const y of [-218, -154]) for (const elevation of [0, 24])
        points.push(window.ferrumPlacementSpatialProject({ x, y, elevation }));
      const left = Math.min(...points.map(p => (p.x - rect.left) * canvas.width / rect.width)) - 3;
      const right = Math.max(...points.map(p => (p.x - rect.left) * canvas.width / rect.width)) + 3;
      const top = Math.min(...points.map(p => (p.y - rect.top) * canvas.height / rect.height)) - 3;
      const bottom = Math.max(...points.map(p => (p.y - rect.top) * canvas.height / rect.height)) + 3;
      let changedPixels = 0, gardenPixels = 0, gardenCyanPixels = 0;
      const cyan = (data, i) => data[i + 1] > data[i] + 30 && data[i + 2] > data[i] + 30 && data[i + 1] > 100 && data[i + 2] > 100;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        if (Math.max(Math.abs(pixels[i] - window.__heightGridOff[i]), Math.abs(pixels[i + 1] - window.__heightGridOff[i + 1]), Math.abs(pixels[i + 2] - window.__heightGridOff[i + 2])) < 3) continue;
        changedPixels++;
        const screenY = canvas.height - 1 - y;
        if (x >= left && x <= right && screenY >= top && screenY <= bottom) {
          gardenPixels++;
          if (cyan(pixels, i) && !cyan(window.__heightGridOff, i)) gardenCyanPixels++;
        }
      }
      return { grid: window.ferrumPlacementGrid, changedPixels, gardenPixels, gardenCyanPixels, stats: window.ferrumRuntime.renderer.stats(), frame: window.ferrumPlacementViewerRuntimeFrame };
    });
    assert(on.gardenPixels > 150, `Terrain grid must be visible on the raised garden: ${JSON.stringify(on)}`);
    assert(on.gardenCyanPixels > 300, `Terrain grid must be visibly cyan: ${JSON.stringify(on)}`);
    assert(on.grid.lineCount > off.lineCount && on.grid.lineCount <= 512);
    assert.equal(on.grid.spacing, off.spacing);
    assert.equal(on.grid.drawCalls, 1); assert(on.grid.depthTest);
    assert.equal(on.frame.entityCount, 46);
    assert(on.stats.drawCalls > 0 && on.stats.drawCalls <= 160 && on.stats.spatial.modelTriangleCount <= 60000);
    assert.equal(await snapshot(), original, "Grid display must preserve authoring state and camera");
    await page.screenshot({ path: `${artifact}/on-dpr${dpr}.png`, fullPage: true });
    await terrainGrid(false);
    assert.equal((await page.evaluate(() => window.ferrumPlacementGrid)).lineCount, off.lineCount);
    assert.equal(await snapshot(), original);

    // Move the authored start through the public test hook; simulation remains native.
    await page.evaluate(() => window.ferrumPlacementViewerUpdateTransform("village_hero", { x: 8, y: -192 }));
    const authored = await snapshot();
    await page.locator("[data-placement-playback=play]").click();
    await wait(() => window.ferrumPlacementWorkspaceMode === "game");
    await page.locator("canvas.demo-canvas").focus();
    await page.keyboard.down("a");
    await wait(() => {
      const handle = window.ferrumPlacementViewerState.instances.find(item => item.instanceId === "village_hero").entity;
      const p = window.ferrumEngine.getPhysicsEntity(handle);
      return p.x < -45 && p.x > -75;
    });
    const ramp = await pose();
    assert(Math.abs(ramp.heightSpan.elevation - (-16 - ramp.x) * 24 / 64) < .01);
    await wait(() => {
      const handle = window.ferrumPlacementViewerState.instances.find(item => item.instanceId === "village_hero").entity;
      return window.ferrumEngine.getPhysicsEntity(handle).x < -100;
    });
    await page.keyboard.up("a");
    const terrace = await pose();
    assert(Math.abs(terrace.heightSpan.elevation - 24) < .01);
    await page.keyboard.down("d");
    await wait(() => {
      const handle = window.ferrumPlacementViewerState.instances.find(item => item.instanceId === "village_hero").entity;
      return window.ferrumEngine.getPhysicsEntity(handle).x > 8;
    });
    await page.keyboard.up("d");
    const ground = await pose();
    assert(Math.abs(ground.heightSpan.elevation) < .01);
    await page.locator("[data-placement-playback=stop]").click();
    await wait(() => window.ferrumPlacementWorkspaceMode === "spatial");
    assert.equal(await snapshot(), authored, "Play/Stop must preserve the authored garden and camera");
    assert.deepEqual(errors, []);
    const result = { ok: true, dpr, off, on, nativeMovement: { ramp, terrace, ground } };
    await writeFile(`${artifact}/dpr${dpr}.json`, JSON.stringify(result, null, 2) + "\n");
    return result;
  } catch (error) {
    await page.screenshot({ path: `${artifact}/failure-dpr${dpr}.png`, fullPage: true });
    throw error;
  } finally { await page.close(); }
}
