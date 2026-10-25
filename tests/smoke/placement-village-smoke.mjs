import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, extname, sep } from "node:path";
import { chromium } from "playwright-core";
import { smokeVillageViewport } from "./placement-village-viewport-smoke.mjs";
import { smokeWorkingGrid } from "./placement-working-grid-smoke.mjs";
import { smokeSpatialCameraAngles } from "./placement-spatial-camera-smoke.mjs";
import { smokeGridViewport } from "./placement-grid-viewport-smoke.mjs";
const artifact = resolve("artifacts/rpg-village");
await mkdir(artifact, { recursive: true });
const base = resolve("apps/placement-viewer/dist"), arg = process.argv.indexOf("--url");
let server;
if (arg < 0) {
  server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, "http://localhost").pathname;
      assert(path.startsWith("/placement-viewer/"));
      const relative = path.slice("/placement-viewer".length);
      const file = resolve(base, "." + (relative === "/" ? "/index.html" : decodeURIComponent(relative)));
      assert(file.startsWith(base + sep));
      res.setHeader("content-type", { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".png": "image/png" }[extname(file)] ?? "application/octet-stream");
      res.end(await readFile(file));
    }
    catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
}
const origin = arg < 0 ? `http://127.0.0.1:${server.address().port}/placement-viewer` : process.argv[arg + 1];
const browser = await chromium.launch({ headless: true, executablePath: process.env.FERRUM_BROWSER_EXECUTABLE, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => { if (m.type() === "error")
  errors.push(m.text()); });
const wait = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 30000 });
const pose = () => page.evaluate(() => {
  const h = window.ferrumPlacementViewerState.instances.find(i => i.instanceId === "village_hero").entity;
  const { x, y, heightSpan } = window.ferrumEngine.getPhysicsEntity(h);
  return { x, y, heightSpan, animation: window.ferrumEngine.dataSceneSpriteAnimationState(h) };
});
const draft = () => page.evaluate(() => JSON.stringify({ document: window.ferrumPlacementSpatialExportDocument(), history: window.ferrumPlacementViewerHistory }));
const play = async () => { await page.getByRole("button", { name: "Play", exact: true }).click(); await wait(() => window.ferrumPlacementWorkspaceMode === "game"); await page.locator("canvas.demo-canvas").focus(); };
const stop = async () => { await page.getByRole("button", { name: "Stop", exact: true }).click(); await wait(() => window.ferrumPlacementWorkspaceMode === "spatial"); };
try {
  const manifest = JSON.parse(await readFile("apps/placement-viewer/public/assets/rpg-village/manifest.json", "utf8"));
  for (const [id, a] of Object.entries({ ...manifest.models, ...manifest.textures })) {
    const b = await readFile(`apps/placement-viewer/public/assets/rpg-village/${a.file}`);
    assert.equal(createHash("sha256").update(b).digest("hex"), a.sha256, id);
  }
  assert.equal(Object.keys(manifest.models).length, 13);
  await page.goto(origin + "/?scene=village");
  await wait(() => window.ferrumPlacementViewerRuntimeFrame?.spatial?.modelDraws === 41);
  await page.locator("[data-placement-language]").selectOption("en");
  if (process.argv.includes("--grid-viewport-only")) {
    await smokeGridViewport(page);
    await smokeGridViewport(page, 2);
    assert.deepEqual(errors, []);
    console.log("Grid viewport smoke passed at DPR 1/2");
  } else if (process.argv.includes("--camera-only")) {
    await smokeSpatialCameraAngles(page);
    await smokeSpatialCameraAngles(page, 2);
    assert.deepEqual(errors, []);
    console.log("Camera pitch smoke passed at DPR 1/2");
  } else {
  await smokeVillageViewport(page);
  await smokeWorkingGrid(page);
  await smokeSpatialCameraAngles(page);
  await smokeGridViewport(page);
  const initial = await draft();
  const frame = await page.evaluate(() => window.ferrumPlacementViewerRuntimeFrame);
  assert.equal(frame.entityCount, 45);
  assert.equal(frame.spatial.billboardVertices, 24);
  assert(await page.evaluate(() => window.ferrumPlacementGrid.visible && window.ferrumPlacementGrid.lineCount > 0));
  await page.locator("canvas.demo-canvas").screenshot({ path: `${artifact}/village-editor.png` });
  // A remembered 2D pan tool must never swallow game input.
  await page.getByRole("button", { name: "2D", exact: true }).click();
  await page.locator("[data-placement-view-action=pan]").click();
  await page.getByRole("button", { name: "HD-2D", exact: true }).click();
  await play();
  await page.keyboard.down("d");
  await wait(() => {
    const h = window.ferrumPlacementViewerState.instances.find(i => i.instanceId === "village_hero").entity;
    const animation = window.ferrumEngine.dataSceneSpriteAnimationState(h);
    return window.ferrumEngine.getPhysicsEntity(h).x > 0 && animation.clip === 7 && animation.frame > 0;
  });
  const moving = await pose();
  assert(moving.animation.frame >= 0 && moving.animation.frame < 4);
  await wait(() => {
    const h = window.ferrumPlacementViewerState.instances.find(i => i.instanceId === "village_hero").entity;
    return window.ferrumEngine.getPhysicsEntity(h).x > 63;
  });
  await page.waitForTimeout(350);
  await page.keyboard.up("d");
  const blocked = await pose();
  assert(blocked.x <= 65.1, `Walked through east cottage: ${blocked.x}`);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const paused = await pose();
  await page.keyboard.down("a");
  await page.waitForTimeout(200);
  await page.keyboard.up("a");
  assert.deepEqual(await pose(), paused, "Paused simulation advanced");
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  assert.equal(await draft(), initial, "Play changed authoring JSON/history");
  await page.locator("[data-placement-language]").selectOption("ko");
  assert.match(await page.locator("[data-placement-tool-status]").textContent(), /WASD로 이동/);
  await page.screenshot({ path: `${artifact}/village-game-ko.png`, fullPage: true });
  await page.locator("canvas.demo-canvas").screenshot({ path: `${artifact}/village-game.png` });
  const pixels = await page.evaluate(() => {
    const c = document.querySelector("canvas.demo-canvas"), gl = c.getContext("webgl2"), p = new Uint8Array(c.width * c.height * 4);
    gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, p);
    let colored = 0;
    const palette = new Set();
    for (let i = 0; i < p.length; i += 64) {
      if (Math.max(p[i], p[i + 1], p[i + 2]) - Math.min(p[i], p[i + 1], p[i + 2]) > 22 && p[i] + p[i + 1] + p[i + 2] > 150) {
        colored++;
        palette.add(`${p[i] >> 4},${p[i + 1] >> 4},${p[i + 2] >> 4}`);
      }
    }
    return { colored, palette: palette.size, samples: p.length / 64 };
  });
  assert(pixels.colored > pixels.samples * .15 && pixels.palette > 30, "Village framebuffer is blank or missing materials");
  await page.locator("[data-placement-language]").selectOption("en");
  await stop();
  assert.equal(await draft(), initial);
  assert.equal((await pose()).x, -30);
  assert.equal((await pose()).y, -102);
  // Move the authored start for two focused public/native movement checks; Undo restores it.
  await page.evaluate(() => window.ferrumPlacementViewerUpdateTransform("village_hero", { x: 150, y: -12 }));
  const bridgeDraft = await draft();
  await play();
  await page.keyboard.down("d");
  await wait(() => { const h = window.ferrumPlacementViewerState.selected.entity, p = window.ferrumEngine.getPhysicsEntity(h); return p.x > 180 && p.x < 208 && p.heightSpan.elevation === 2; });
  const onBridge = await pose();
  await wait(() => window.ferrumEngine.getPhysicsEntity(window.ferrumPlacementViewerState.selected.entity).x > 230);
  await page.keyboard.up("d");
  const crossed = await pose();
  assert.equal(crossed.heightSpan.elevation, 0);
  await stop();
  assert.equal(await draft(), bridgeDraft);
  await page.evaluate(() => window.ferrumPlacementViewerUndo());
  await page.evaluate(() => window.ferrumPlacementViewerUpdateTransform("village_hero", { x: 150, y: -80 }));
  await play();
  await page.keyboard.down("d");
  await page.waitForTimeout(700);
  await page.keyboard.up("d");
  const bank = await pose();
  assert(bank.x >= 160 && bank.x <= 170.1, "Actor crossed river away from bridge");
  await stop();
  await page.evaluate(() => window.ferrumPlacementViewerUndo());
  assert.equal(await page.evaluate(() => JSON.stringify(window.ferrumPlacementSpatialExportDocument())), JSON.stringify(JSON.parse(initial).document));
  const stats = await page.evaluate(() => window.ferrumRuntime.renderer.stats());
  assert(stats.drawCalls > 0 && stats.drawCalls <= 160);
  assert(stats.spatial.modelTriangleCount > 5000 && stats.spatial.modelTriangleCount <= 60000);
  assert.equal(stats.spatial.modelUploadBytes, 0, "Warmed models re-uploaded");
  assert.equal(stats.spatial.modelCount, 41);
  // A fresh 2D workspace must load the same bundled assets when opening exported JSON.
  const cold = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const villageRequests = [];
  cold.on("request", request => {
    if (request.url().includes("assets/rpg-village/")) villageRequests.push(request.url());
  });
  cold.on("pageerror", error => errors.push(error.message));
  await cold.goto(origin + "/");
  await cold.waitForFunction(() => window.ferrumPlacementViewerRuntimeFrame?.entityCount === 6);
  assert.equal(villageRequests.length, 0, "Ordinary 2D workspaces loaded village assets eagerly");
  await cold.locator("input[data-placement-document-file]").setInputFiles({
    name: "village.json", mimeType: "application/json",
    buffer: await readFile("apps/placement-viewer/public/placement.village.scene-authoring.json"),
  });
  await cold.waitForFunction(() =>
    window.ferrumPlacementViewerRuntimeFrame?.spatial?.modelDraws === 41 &&
    window.ferrumPlacementViewerState?.selectedInstanceId === "village_hero",
    undefined, { timeout: 30000 },
  );
  assert(await cold.evaluate(() => window.ferrumEngine.textureId("village_hero") > 0));
  await cold.close();
  const retina = await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:2});
  retina.on("pageerror", error => errors.push(error.message));
  await retina.goto(origin + "/?scene=village");
  await retina.waitForFunction(()=>window.ferrumPlacementViewerRuntimeFrame?.spatial?.modelDraws===41);
  await retina.locator("[data-placement-language]").selectOption("en");
  await smokeVillageViewport(retina, 2);
  await smokeWorkingGrid(retina, 2);
  await smokeSpatialCameraAngles(retina, 2);
  await smokeGridViewport(retina, 2);
  await retina.close();
  assert.deepEqual(errors, []);
  await writeFile(`${artifact}/checks.json`, JSON.stringify({ ok: true, source: arg < 0 ? "production" : "live", frame, moving, blocked, paused, onBridge, crossed, bank, pixels, stats, checks: ["13 hashed Blender models + 3 sprites", "45 native entities / 41 models / 4 billboards", "2D pan does not swallow WASD", "directional native walking clips", "cottage collision", "pause / stop / authoring preservation", "bridge support and river block", "nonblank textured pixel framebuffer", "bounded draws/triangles and zero warm model uploads", "EN/KO hint"] }, null, 2) + "\n");
  console.log("Village smoke passed", { drawCalls: stats.drawCalls, triangles: stats.spatial.modelTriangleCount, pixels });
  }
}
catch (error) {
  await page.screenshot({ path: `${artifact}/failure.png`, fullPage: true });
  throw error;
}
finally {
  await page.keyboard.up("d").catch(() => { });
  await browser.close();
  if (server)
    await new Promise(done => server.close(done));
}
