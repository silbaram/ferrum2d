#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, readdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { chromium } from "playwright-core";
import { runReleaseCommand } from "./github-release-command.mjs";

// Serve the actual packed package. No engine source/internal consumer imports.
const root = resolve(".");
await mkdir(resolve(root, "artifacts"), { recursive: true });
const output = await mkdtemp(resolve(root, "artifacts/data-scene-consumer-"));
await runReleaseCommand("pnpm", ["pack", "--pack-destination", output], { cwd: resolve(root, "packages/ferrum-web") });
const tgz = (await readdir(output)).find((name) => name.endsWith(".tgz"));
assert(tgz);
await runReleaseCommand("tar", ["-xzf", resolve(output, tgz), "-C", output]);
const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%}canvas{display:block;width:100%;height:100%}</style>
<script type="importmap">{"imports":{"@ferrum2d/ferrum-web/core":"/package/dist/core.js","@ferrum2d/ferrum-web/authoring":"/package/dist/authoring.js"}}</script></head>
<body><canvas id="game"></canvas><script type="module">import { startNativeScene } from '/recipe.mjs';
window.nativeScene = await startNativeScene(document.querySelector('canvas'));</script></body></html>`;
const server = createServer((request, response) => { void (async () => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/") { response.setHeader("Content-Type", "text/html"); response.end(html); return; }
  let file;
  if (url.pathname === "/recipe.mjs") file = resolve(root, "examples/data-scene-native/main.mjs");
  else {
    file = resolve(output, `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(resolve(output, "package") + sep) || !/\.(?:js|wasm)$/.test(file)) { response.writeHead(403).end(); return; }
  }
  response.setHeader("Content-Type", file.endsWith(".wasm") ? "application/wasm" : "application/javascript");
  response.end(await readFile(file));
})().catch(() => response.writeHead(404).end()); });
let browser;
const report = { format: "ferrum2d.data-scene.consumer-smoke", version: 1, status: "running", tarball: tgz, cases: [] };
try {
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  const address = `http://127.0.0.1:${server.address().port}/`;
  const options = { headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] };
  if (process.env.FERRUM_BROWSER_EXECUTABLE) browser = await chromium.launch({ ...options, executablePath: process.env.FERRUM_BROWSER_EXECUTABLE });
  else { try { browser = await chromium.launch({ ...options, channel: process.env.FERRUM_BROWSER_CHANNEL ?? "chrome" }); }
    catch (error) { if (process.env.FERRUM_BROWSER_CHANNEL) throw error; browser = await chromium.launch(options); } }
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) for (const deviceScaleFactor of [1, 2]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor }); const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(address);
    await page.waitForFunction(() => window.nativeScene?.frame, undefined, { timeout: 20000 });
    const result = await page.evaluate(async () => {
      const s = window.nativeScene, canvas = document.querySelector("canvas"), gl = canvas.getContext("webgl2");
      const wait = async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); };
      const check = (condition, message) => { if (!condition) throw new Error(message); };
      const order = () => s.frame.commands.map((c) => c.textureId);
      const pixel = (world) => {
        const p = s.view.worldToScreen(world, s.frame.camera); const data = new Uint8Array(4);
        gl.readPixels(Math.floor(p.x * canvas.width / canvas.clientWidth), Math.floor((canvas.clientHeight - p.y) * canvas.height / canvas.clientHeight), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
        check(!gl.isContextLost(), "WebGL context lost"); return [...data];
      };
      const before = JSON.stringify(order()); check(!order().includes(5), "offscreen sprite should be culled");
      s.unrelatedHeight(true); await wait(); check(JSON.stringify(order()) === before, "height span changed sprite order");
      s.unrelatedHeight(false); await wait(); check(JSON.stringify(order()) === before, "height clear changed sprite order");
      let p = pixel({ x: 800, y: 580 }); check(p[2] > 240 && p[0] < 10, "tree should occlude actor behind it");
      s.move(0, 50); await wait(); p = pixel({ x: 800, y: 610 });
      check(p[0] > 240 && p[2] < 10, "red tinted actor should cover tree in front");
      check(s.engine.queryCircleBodies({ x: 800, y: 650, radius: 1, queryMaskBits: 1 }).some((h) => h.entityId === s.actor.entityId), "collider did not move with sprite");
      const label = s.frame.commands.find((c) => c.textureId === 99); const expected = s.view.worldToScreen({ x: 840, y: 570 }, s.frame.camera);
      check(Math.abs(label.x - expected.x / s.frame.camera.zoom) < 0.01 && Math.abs(label.y - expected.y / s.frame.camera.zoom) < 0.01, "world label camera mismatch");
      const tintPixel = p;
      for (const zoom of [0.75, 2]) {
        s.view.setZoom(zoom); s.view.setCamera({ x: 840, y: 630 }); await wait();
        const view = s.frame.camera, world = { x: 810, y: 640 }, round = s.view.screenToWorld(s.view.worldToScreen(world, view), view);
        check(Math.abs(round.x - world.x) < 0.001 && Math.abs(round.y - world.y) < 0.001, "coordinate round trip");
        check(Math.abs(view.worldWidth - canvas.clientWidth / zoom) < 0.001, "logical viewport zoom mismatch");
        check(!order().includes(5), "zoom culling mismatch");
        s.lighting(true); await wait();
        check(pixel({ x: 845, y: 650 })[1] > pixel({ x: 915, y: 650 })[1] + 10, "zoomed light alignment mismatch");
        s.lighting(false); await wait();
      }
      s.view.setZoom(1); s.view.setCamera({ x: 800, y: 650 }); s.lighting(true); await wait();
      const lit = pixel({ x: 845, y: 650 }), dark = pixel({ x: 955, y: 650 });
      check(lit[1] > dark[1] + 10, "point light projection does not align with the world");
      const light = s.view.lighting({ pointLights: [{ x: 800, y: 650, radius: 100 }], tileOccluders: [{ x: 900, y: 500, width: 20, height: 80 }] }, s.frame.camera);
      check(light.tileOccluders[0].x === 900 - s.frame.camera.worldMinX, "occluder projection mismatch");
      s.lighting(false); s.debug(true); await wait(); check(s.frame.lineCount > 0, "missing collider debug buffer"); s.debug(false);
      return { tintPixel, lightPixel: lit, darkPixel: dark, drawCalls: s.frame.stats.drawCalls, entityCount: s.frame.entityCount, commandCount: s.frame.commands.length };
    });
    // Real pointer events after pan/zoom, then a real canvas resize.
    await page.evaluate(() => { window.nativeScene.view.setZoom(1.5); window.nativeScene.view.setCamera({ x: 800, y: 650 }); });
    await page.waitForTimeout(50);
    const click = await page.evaluate(() => window.nativeScene.view.worldToScreen({ x: 850, y: 650 }));
    await page.mouse.click(click.x, click.y);
    await page.waitForFunction(() => Math.abs(window.nativeScene.engine.getPhysicsEntity(window.nativeScene.actor).x - 850) < 0.1);
    const shell = await page.evaluate(() => window.nativeScene.engine.queryCircleBodies({ x: 850, y: 650, radius: 1, queryMaskBits: 16 }).length);
    assert.equal(shell, 1);
    await page.setViewportSize({ width: viewport.width - 20, height: viewport.height - 30 });
    await page.waitForTimeout(80);
    const resizedClick = await page.evaluate(() => window.nativeScene.view.worldToScreen({ x: 875, y: 670 }));
    await page.mouse.click(resizedClick.x, resizedClick.y);
    await page.waitForFunction(() => {
      const body = window.nativeScene.engine.getPhysicsEntity(window.nativeScene.actor);
      return Math.abs(body.x - 875) < 0.1 && Math.abs(body.y - 670) < 0.1;
    });
    const lifecycle = await page.evaluate(async () => {
      const s = window.nativeScene, old = s.actor; s.apply();
      await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
      return { oldInvalid: s.engine.getPhysicsEntity(old) === undefined, oldMoveRejected: !s.engine.setPhysicsBodyPosition(old, 999, 999), width: s.frame.camera.cssWidth,
        roundTrip: s.view.screenToWorld(s.view.worldToScreen({ x: 800, y: 600 })) };
    });
    assert(lifecycle.oldInvalid && lifecycle.oldMoveRejected); assert.equal(lifecycle.width, viewport.width - 20);
    assert.deepEqual(lifecycle.roundTrip, { x: 800, y: 600 }); assert.deepEqual(errors, []);
    report.cases.push({ viewport, deviceScaleFactor, ...result, lifecycle, browserErrors: errors });
    await page.evaluate(() => window.nativeScene.destroy()); await page.close();
  }
  report.status = "passed";
} catch (error) { report.status = "failed"; report.error = String(error); process.exitCode = 1; }
finally { await browser?.close(); await new Promise((done) => server.close(done)); await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2) + "\n"); }
console.log(JSON.stringify({ ...report, artifactDir: output }, null, 2));
