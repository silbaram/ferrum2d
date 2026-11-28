import { assertVillageRenderBudget } from "./placement-village-render-budget.mjs";
import assert from "node:assert/strict";
import { preparePlacementTestBuild } from "./placement-test-build.mjs";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, extname, sep } from "node:path";
import { chromium } from "playwright-core";
import { smokeVillageViewport } from "./placement-village-viewport-smoke.mjs";
import { smokeWorkingGrid } from "./placement-working-grid-smoke.mjs";
import { smokeSpatialCameraAngles } from "./placement-spatial-camera-smoke.mjs";
import { smokeGridViewport } from "./placement-grid-viewport-smoke.mjs";
import { smokeVillageHeightGrid } from "./placement-village-height-grid-smoke.mjs";
import { readVillageActorPose, smokeVillagePhysics } from "./placement-village-physics-smoke.mjs";
import { smokeThreejsViewerUpgrades } from "./placement-threejs-upgrades-smoke.mjs";
import { smokePlacementGameCameraLive } from "./placement-game-camera-live-smoke.mjs";
import { smokePlacementModelPicking } from "./placement-model-picking-smoke.mjs";
import { smokePlacementLighting, smokePlacementLightingSave } from "./placement-lighting-smoke.mjs";
const artifact = resolve("artifacts/rpg-village");
await mkdir(artifact, { recursive: true });
const arg = process.argv.indexOf("--url");
const base = arg < 0 ? await preparePlacementTestBuild(resolve("apps/studio/dist")) : resolve("apps/studio/dist");
let server;
if (arg < 0) {
  server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, "http://localhost").pathname;
      assert(path.startsWith("/studio/"));
      const relative = path.slice("/studio".length);
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
const origin = arg < 0 ? `http://127.0.0.1:${server.address().port}/studio` : process.argv[arg + 1];
const browser = await chromium.launch({ headless: true, executablePath: process.env.FERRUM_BROWSER_EXECUTABLE, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => { if (m.type() === "error")
  errors.push(m.text()); });
const wait = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 30000 });
const pose = () => page.evaluate(readVillageActorPose);
const draft = () => page.evaluate(() => JSON.stringify({ document: window.ferrumPlacementSpatialExportDocument(), history: window.ferrumPlacementViewerHistory }));
const play = async () => { await page.getByRole("button", { name: "Play", exact: true }).click(); await wait(() => window.ferrumPlacementWorkspaceMode === "game"); await page.locator("canvas.demo-canvas").focus(); };
const stop = async () => { await page.getByRole("button", { name: "Stop", exact: true }).click(); await wait(() => window.ferrumPlacementWorkspaceMode === "spatial"); };
try {
  const manifest = JSON.parse(await readFile("apps/studio/examples/assets/rpg-village/manifest.json", "utf8"));
  for (const [id, a] of Object.entries({ ...manifest.models, ...manifest.textures })) {
    const b = await readFile(`apps/studio/examples/assets/rpg-village/${a.file}`);
    assert.equal(createHash("sha256").update(b).digest("hex"), a.sha256, id);
  }
  assert.equal(Object.keys(manifest.models).length, 14);
  const smallFixture=process.argv.includes("--model-picking-only") || process.argv.includes("--lighting-only");
  await page.goto(origin + "/?scene=" + (smallFixture ? "hd2d" : "village"));
  if (smallFixture) await wait(() => window.ferrumPlacementViewerState?.instances.length === 3);
  else await wait(() => window.ferrumPlacementViewerRuntimeFrame?.spatial?.modelDraws === 42);
  await page.locator("[data-placement-language]").selectOption("en");
  if (process.argv.includes("--lighting-only")) {
    await page.evaluate(()=>window.ferrumRuntime.stop());
    console.log("Spatial lighting UI",await smokePlacementLighting(page,30000,"spatial"));
    console.log("Lighting save/reopen",await smokePlacementLightingSave(page));
  } else if (process.argv.includes("--model-picking-only")) {
    await page.evaluate(()=>window.ferrumRuntime.stop());
    console.log("Model LOD and displayed-camera picking",await smokePlacementModelPicking(page));
  } else if (process.argv.includes("--game-camera-live-only")) {
    await page.evaluate(()=>window.ferrumRuntime.stop());
    await smokePlacementGameCameraLive(page);
    console.log("Live game camera smoke passed");
  } else if (process.argv.includes("--threejs-only")) {
    await page.evaluate(()=>window.ferrumRuntime.stop());
    console.log("Three.js viewer upgrades",await smokeThreejsViewerUpgrades(page));
  } else if (process.argv.includes("--physics-only")) {
    const physics = await smokeVillagePhysics(page);
    assert.deepEqual(errors, []);
    await writeFile(`${artifact}/physics-checks.json`, JSON.stringify({ ok: true, physics }, null, 2) + "\n");
    console.log("Village HD-2D physics smoke passed", JSON.stringify(physics));
  } else if (process.argv.includes("--height-grid-only")) {
    await smokeVillageHeightGrid(page);
    await smokeVillageHeightGrid(page, 2);
    assert.deepEqual(errors, []);
    console.log("Village terrain height grid smoke passed at DPR 1/2");
  } else if (process.argv.includes("--grid-viewport-only")) {
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
  const initial = await draft();
  const frame = await page.evaluate(() => window.ferrumPlacementViewerRuntimeFrame);
  assert.equal(frame.entityCount, 46);
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
    const position = window.ferrumEngine.queryAudioPoseBuffer(new Uint32Array([h.entityId, h.entityGeneration]));
    return position.floats[4] > 0 && animation.clip === 7 && animation.frame > 0;
  });
  const moving = await pose();
  assert(moving.animation.frame >= 0 && moving.animation.frame < 4);
  await wait(() => {
    const h = window.ferrumPlacementViewerState.instances.find(i => i.instanceId === "village_hero").entity;
    return window.ferrumEngine.queryAudioPoseBuffer(new Uint32Array([h.entityId, h.entityGeneration])).floats[4] > 63;
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
    const c = document.querySelector("canvas.demo-canvas"), gl = c.getContext("webgl2");
    const target = window.ferrumPlacementSpatialExportDocument().spatial.environment.pixelArt;
    // The game centers its integer-scaled pixel target inside the editor canvas.
    const fit = Math.min(c.clientWidth / target.width, c.clientHeight / target.height);
    const scale = fit >= 1 ? Math.floor(fit) : fit;
    const width = Math.round(target.width * scale * c.width / c.clientWidth);
    const height = Math.round(target.height * scale * c.height / c.clientHeight);
    const p = new Uint8Array(width * height * 4);
    gl.readPixels(Math.round((c.width - width) / 2), Math.round((c.height - height) / 2),
      width, height, gl.RGBA, gl.UNSIGNED_BYTE, p);
    let colored = 0;
    const palette = new Set();
    for (let i = 0; i < p.length; i += 64) {
      if (Math.max(p[i], p[i + 1], p[i + 2]) - Math.min(p[i], p[i + 1], p[i + 2]) > 22 && p[i] + p[i + 1] + p[i + 2] > 150) {
        colored++;
        palette.add(`${p[i] >> 4},${p[i + 1] >> 4},${p[i + 2] >> 4}`);
      }
    }
    return { width, height, colored, palette: palette.size, samples: Math.ceil(p.length / 64) };
  });
  assert(pixels.colored > pixels.samples * .15 && pixels.palette > 30,
    `Village framebuffer is blank or missing materials: ${JSON.stringify(pixels)}`);
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
  await wait(() => {
    const h = window.ferrumPlacementViewerState.selected.entity;
    const { floats } = window.ferrumEngine.queryAudioPoseBuffer(new Uint32Array([h.entityId, h.entityGeneration]));
    return floats[4] > 178 && floats[4] < 208 && Math.abs(floats[6] - 2) <= 1.1;
  });
  const onBridge = await pose();
  assert(onBridge.elevation > 2 && onBridge.elevation < 3.2);
  await wait(() => {
    const h = window.ferrumPlacementViewerState.selected.entity;
    const { floats } = window.ferrumEngine.queryAudioPoseBuffer(new Uint32Array([h.entityId, h.entityGeneration]));
    return floats[4] > 230 && Math.abs(floats[6]) <= 1.1;
  });
  await page.keyboard.up("d");
  const crossed = await pose();
  assert(Math.abs(crossed.elevation) <= 1.1);
  await stop();
  assert.equal(await draft(), bridgeDraft);
  await page.evaluate(() => window.ferrumPlacementViewerUndo());
  await page.evaluate(() => window.ferrumPlacementViewerUpdateTransform("village_hero", { x: 150, y: -80 }));
  await play();
  await page.keyboard.down("d");
  await wait(() => {
    const h = window.ferrumPlacementViewerState.selected.entity;
    const { floats } = window.ferrumEngine.queryAudioPoseBuffer(new Uint32Array([h.entityId, h.entityGeneration]));
    return floats[4] >= 165;
  });
  await page.waitForTimeout(350);
  await page.keyboard.up("d");
  const bank = await pose();
  assert(bank.x >= 160 && bank.x <= 170.1, "Actor crossed river away from bridge");
  assert(Math.abs(bank.elevation) <= 1.1, "Actor fell outside the bridge");
  await stop();
  await page.evaluate(() => window.ferrumPlacementViewerUndo());
  assert.equal(await page.evaluate(() => JSON.stringify(window.ferrumPlacementSpatialExportDocument())), JSON.stringify(JSON.parse(initial).document));
  const stats = await page.evaluate(() => window.ferrumRuntime.renderer.stats());
  assertVillageRenderBudget(stats);
  assert(stats.spatial.modelTriangleCount > 5000);
  assert.equal(stats.spatial.modelUploadBytes, 0, "Warmed models re-uploaded");
  assert.equal(stats.spatial.modelCount, 42);
  await smokeVillagePhysics(page);
  // Each remaining scenario renders its own page. Release the idle page's frame loop.
  await page.evaluate(() => window.ferrumRuntime.stop());
  await smokeVillageHeightGrid(page);
  await smokeWorkingGrid(page);
  await smokeSpatialCameraAngles(page);
  await smokeGridViewport(page);
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
    buffer: await readFile("apps/studio/examples/placement.village.scene-authoring.json"),
  });
  await cold.waitForFunction(() =>
    window.ferrumPlacementViewerRuntimeFrame?.spatial?.modelDraws === 42 &&
    window.ferrumPlacementViewerState?.selectedInstanceId === "village_hero",
    undefined, { timeout: 30000 },
  );
  assert(await cold.evaluate(() => window.ferrumEngine.textureId("village_hero") > 0));
  await cold.close();
  const retina = await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:2});
  retina.on("pageerror", error => errors.push(error.message));
  await retina.goto(origin + "/?scene=village");
  await retina.waitForFunction(()=>window.ferrumPlacementViewerRuntimeFrame?.spatial?.modelDraws===42);
  await retina.locator("[data-placement-language]").selectOption("en");
  await smokeVillageViewport(retina, 2);
  await retina.evaluate(() => window.ferrumRuntime.stop());
  await smokeVillageHeightGrid(retina, 2);
  await smokeWorkingGrid(retina, 2);
  await smokeSpatialCameraAngles(retina, 2);
  await smokeGridViewport(retina, 2);
  await retina.close();
  assert.deepEqual(errors, []);
  await writeFile(`${artifact}/checks.json`, JSON.stringify({ ok: true, source: arg < 0 ? "production" : "live", frame, moving, blocked, paused, onBridge, crossed, bank, pixels, stats, checks: ["14 hashed Blender models + 3 sprites", "46 native entities / 42 models / 4 billboards", "2D pan does not swallow WASD", "directional native walking clips", "cottage collision", "pause / stop / authoring preservation", "bridge support and river block", "nonblank textured pixel framebuffer", "bounded draws/triangles and zero warm model uploads", "EN/KO hint"] }, null, 2) + "\n");
  console.log("Village smoke passed", { drawCalls: stats.drawCalls, triangles: stats.spatial.modelTriangleCount, pixels });
  }
}
catch (error) {
  // A slow software-rendered capture must not replace the original failure.
  await page.screenshot({ path: `${artifact}/failure.png`, fullPage: true })
    .catch(screenshotError => console.error(`Failure screenshot was not captured: ${screenshotError.message}`));
  throw error;
}
finally {
  await page.keyboard.up("d").catch(() => { });
  await browser.close();
  if (server)
    await new Promise(done => server.close(done));
}
