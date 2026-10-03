#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, readdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { chromium } from "playwright-core";
import { runReleaseCommand } from "./github-release-command.mjs";
import { installPresentationGpuCapture } from "./presentation-webgpu-capture.mjs";

const root = resolve(".");
const webgpuOnly = process.argv.includes("--webgpu-only");
await mkdir(resolve(root, "artifacts"), { recursive: true });
const output = await mkdtemp(resolve(root, "artifacts/data-scene-presentation-"));
await runReleaseCommand("pnpm", ["pack", "--pack-destination", output], { cwd: resolve(root, "packages/ferrum-web") });
const tgz = (await readdir(output)).find((name) => name.endsWith(".tgz")); assert(tgz);
await runReleaseCommand("tar", ["-xzf", resolve(output, tgz), "-C", output]);
const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%}canvas{display:block;width:100%;height:100%}</style>
<script type="importmap">{"imports":{"@ferrum2d/ferrum-web/core":"/package/dist/core.js","@ferrum2d/ferrum-web/authoring":"/package/dist/authoring.js","@ferrum2d/ferrum-web/labs":"/package/dist/labs.js"}}</script></head>
<body><canvas id="game"></canvas><script type="module">import { startPresentationScene } from '/recipe.mjs';
window.presentation = await startPresentationScene(document.querySelector('canvas'), {colorManagement: new URLSearchParams(location.search).get('color') ?? 'legacy', backend: new URLSearchParams(location.search).get('backend') ?? 'webgl2'});</script></body></html>`;
const server = createServer((request, response) => { void (async () => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/favicon.ico") { response.writeHead(204).end(); return; }
  if (url.pathname === "/") { response.setHeader("Content-Type", "text/html"); response.end(html); return; }
  const file = url.pathname === "/recipe.mjs" ? resolve(root, "examples/data-scene-native/presentation.mjs") : resolve(output, `.${decodeURIComponent(url.pathname)}`);
  if (url.pathname !== "/recipe.mjs" && (!file.startsWith(resolve(output, "package") + sep) || !/\.(?:js|wasm)$/.test(file))) { response.writeHead(403).end(); return; }
  response.setHeader("Content-Type", file.endsWith(".wasm") ? "application/wasm" : "application/javascript"); response.end(await readFile(file));
})().catch(() => response.writeHead(404).end()); });
let browser;
const report = { format: "ferrum2d.data-scene.presentation-smoke", version: 1, mode: webgpuOnly ? "webgpu-only" : "full", status: "running", tarball: tgz, cases: [] };
try {
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  const address = `http://127.0.0.1:${server.address().port}/`;
  const launch = { headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-webgpu", "--use-angle=swiftshader"] };
  if (process.env.FERRUM_BROWSER_EXECUTABLE) browser = await chromium.launch({ ...launch, executablePath: process.env.FERRUM_BROWSER_EXECUTABLE });
  else { try { browser = await chromium.launch({ ...launch, channel: process.env.FERRUM_BROWSER_CHANNEL ?? "chrome" }); }
    catch (error) { if (process.env.FERRUM_BROWSER_CHANNEL) throw error; browser = await chromium.launch(launch); } }
  for (const viewport of (webgpuOnly ? [] : [{ width: 1280, height: 720 }, { width: 390, height: 844 }])) for (const deviceScaleFactor of [1, 2]) for (const color of ["legacy", "linear-srgb"]) {
    report.activeCase = { viewport, deviceScaleFactor, color };
    const page = await browser.newPage({ viewport, deviceScaleFactor }); const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.textureUploads = 0;
      for (const name of ["texImage2D", "texSubImage2D"]) {
        const original = WebGL2RenderingContext.prototype[name];
        WebGL2RenderingContext.prototype[name] = function (...args) { window.textureUploads += 1; return Reflect.apply(original, this, args); };
      }
    });
    await page.goto(`${address}?color=${color}`);
    try { await page.waitForFunction(() => window.presentation?.frame, undefined, { timeout: 30000 }); }
    catch (error) { throw new Error(`Presentation startup failed: ${errors.join("; ") || error}`); }
    const result = await page.evaluate(async (color) => {
      const s = window.presentation, canvas = document.querySelector("canvas"), gl = canvas.getContext("webgl2");
      const check = (condition, message) => { if (!condition) throw new Error(message); };
      const wait = async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); };
      const pixelScreen = (point) => { const data = new Uint8Array(4); gl.readPixels(Math.floor(point.x * canvas.width / canvas.clientWidth), Math.floor((canvas.clientHeight - point.y) * canvas.height / canvas.clientHeight), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data); check(!gl.isContextLost(), "WebGL context lost"); return [...data]; };
      const pixel = (world) => pixelScreen(s.view.worldToScreen(world));
      const actorPixel = (entity, dx) => { const body = s.engine.getPhysicsEntity(entity), p = s.view.worldToScreen(body); return pixelScreen({ x: p.x + dx * s.frame.camera.zoom, y: p.y - 24 * s.frame.camera.zoom }); };
      const a = s.handles.actor, b = s.handles.other, body = s.engine.getPhysicsEntity(a);
      const bodyKey = (value) => JSON.stringify([value.entityId, value.entityGeneration, value.x, value.y, value.bodyType]);
      const beforeBody = bodyKey(body), uploads = window.textureUploads, loads = s.uploads, entities = s.frame.entityCount;
      check(s.engine.updateDataSceneSpriteAnimations([{ entity: a, clip: 0, paused: true }, { entity: b, clip: 1, frame: 0, flipX: true, paused: true }]), "initial independent clips rejected");
      await wait();
      const red = actorPixel(a, 8), green = actorPixel(b, -12), white = actorPixel(b, 12);
      check(red[0] > 245 && red[1] < 5 && green[1] > 245 && green[0] < 5 && white.every((v) => v > 245), "shared atlas clips/flip pixels incorrect");
      for (let i = 0; i < 24; i += 1) check(s.engine.updateDataSceneSpriteAnimations([{ entity: a, clip: i % 2, flipX: i % 2 === 1 }]), "clip transition failed");
      check(s.engine.updateDataSceneSpriteAnimations([{ entity: a, clip: 1, frame: 1, flipX: true, paused: true }]), "frame seek failed"); await wait();
      const blue = actorPixel(a, -12); check(blue[2] > 245 && blue[0] < 5, "manual frame UV/flip pixel incorrect");
      check(window.textureUploads === uploads && s.uploads === loads && s.frame.entityCount === entities && bodyKey(s.engine.getPhysicsEntity(a)) === beforeBody, "clip transitions changed texture/entity/physics");
      const transitionUploads = window.textureUploads - uploads;
      const state = JSON.stringify(s.engine.dataSceneSpriteAnimationState(a));
      check(!s.engine.updateDataSceneSpriteAnimations([{ entity: a, clip: 0 }, { entity: b, clip: 999 }]), "unknown clip accepted");
      check(!s.engine.updateDataSceneSpriteAnimations([{ entity: a, frame: 31 }]), "invalid clip frame accepted");
      check(JSON.stringify(s.engine.dataSceneSpriteAnimationState(a)) === state, "rejected batch changed playback");
      check(s.engine.updateDataSceneSpriteAnimations([{ entity: a, clip: 2, paused: false }]), "one-shot clip rejected");
      s.engine.pauseDataScene(); const paused = s.engine.dataSceneSpriteAnimationState(a).elapsedSeconds;
      await new Promise((done) => setTimeout(done, 80)); check(s.engine.dataSceneSpriteAnimationState(a).elapsedSeconds === paused, "scene pause advanced playback");
      s.engine.resumeDataScene();
      for (let i = 0; i < 100 && !s.engine.dataSceneSpriteAnimationState(a).finished; i += 1) await wait();
      check(s.engine.dataSceneSpriteAnimationState(a).finished, "one-shot clip did not finish");
      s.engine.pauseDataScene();
      s.engine.setParticlePreset(1, { texture: 99, burstCount: 1, lifetime: 10, speed: 0, startSize: 5, endSize: 5 });
      check(s.engine.spawnParticleBurst(1, 350, 260) === 1, "particle spawn failed");
      const projection = [];
      for (const scale of [1, 0.72]) for (const zoom of [0.75, 1.5]) {
        s.view.setGroundYScale(scale); s.view.setZoom(zoom); s.view.setCamera({ x: 400, y: 330 }); await wait();
        check(bodyKey(s.engine.getPhysicsEntity(a)) === beforeBody, "projection changed physical data");
        const world = { x: 390, y: 355 }, back = s.view.screenToWorld(s.view.worldToScreen(world));
        check(Math.abs(back.x - world.x) < 0.001 && Math.abs(back.y - world.y) < 0.001, "projection round trip failed");
        check(s.frame.commands.filter((c) => c.textureId === 3).length === 1, "offscreen sprite not culled");
        const particle = s.frame.commands.find((c) => c.textureId === 99 && c.width === 5);
        const expected = s.view.worldToScreen({ x: 350, y: 260 });
        check(particle && Math.abs((particle.x + 2.5) * zoom - expected.x) < 0.01 && Math.abs((particle.y + 2.5) * zoom - expected.y) < 0.01, "particle projection mismatch");
        const label = s.frame.commands.find((c) => c.textureId === 99 && c.width === 8), labelPoint = s.view.worldToScreen({ x: body.x, y: body.y - 80 });
        check(label && Math.abs(label.y * zoom - labelPoint.y) < 0.01, "world label projection mismatch");
        const ground = pixel({ x: 500, y: 430 }), shadow = pixel({ x: 400 + 25 / Math.hypot(1, 0.5), y: 330 + 12.5 / Math.hypot(1, 0.5) });
        check(Math.abs(ground[0] - 128) <= 2, "ground color space mismatch");
        check(Math.abs(shadow[0] - (color === "legacy" ? 64 : 92)) <= 4, `ground shadow alpha mismatch ${shadow}`);
        check(ground[3] === 255 && Math.abs(shadow[3] - (color === "legacy" ? 191 : 255)) <= 1, "ground shadow changed the renderer alpha contract");
        s.engine.updateDataSceneSpriteAnimations([{ entity: a, clip: 0, paused: true, flipX: false }]);
        s.move(a, 400, 310); await wait();
        const treeFoot = s.view.worldToScreen({ x: 400, y: 330 });
        const overlap = { x: treeFoot.x + 8 * zoom, y: treeFoot.y - 24 * zoom };
        const behind = pixelScreen(overlap);
        s.move(a, 400, 350); await wait(); const front = pixelScreen(overlap);
        check(behind[0] < 5 && behind[2] > 90 && front[0] > 245 && front[2] < 5, "projected actor/tree depth order incorrect");
        s.move(a, body.x, body.y); await wait();
        projection.push({ scale, zoom, groundPixel: ground, shadowPixel: shadow, behindPixel: behind, frontPixel: front });
      }
      s.view.setZoom(1); s.view.setGroundYScale(0.72); s.view.setSun({ ...s.sun, directionX: -1 }); await wait();
      const oldShadow = pixel({ x: 422, y: 341 }); check(oldShadow[0] > 120, "sun direction left stale geometry");
      s.view.setSun(s.sun); await wait(); await wait();
      check(s.engine.dataSceneGroundShadowStats().cacheHits === 3, "static caster cache not reused");
      s.debug(true); await wait(); check(s.frame.lineCount > 0, "debug geometry missing");
      const debugPoint = s.view.worldToScreen({ x: body.x, y: body.y + 8 });
      const debugPixels = [-1, 0, 1].map((offset) => pixelScreen({ x: debugPoint.x, y: debugPoint.y + offset * canvas.clientHeight / canvas.height }));
      check(debugPixels.some((p) => p[1] > 150 && p[1] > p[0] + 30), `collider debug did not match ground projection: ${JSON.stringify({ debugPoint, debugPixels })}`);
      s.debug(false);
      s.lighting(true); await wait();
      const lit = pixel({ x: 480, y: 300 }), dark = pixel({ x: 570, y: 300 });
      check(lit[0] > dark[0] + 10, "projected light/ambient/sun integration failed"); s.lighting(false);
      return { independentPixels: { red, green, white, blue }, textureUploadsDuringTransitions: transitionUploads,
        projection, lightPixel: lit, darkPixel: dark, debugPixels, shadowCache: s.engine.dataSceneGroundShadowStats() };
    }, color);
    const projectionEdges = await page.evaluate(checkPresentationProjectionEdges);
    await page.evaluate(async () => { const s = window.presentation; s.engine.resumeDataScene(); s.view.setZoom(1.5); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
    const target = await page.evaluate(() => window.presentation.view.worldToScreen({ x: 360, y: 385 })); await page.mouse.click(target.x, target.y);
    await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
    const clicked = await page.evaluate(() => window.presentation.engine.getPhysicsEntity(window.presentation.handles.actor));
    const pointerMove = await page.evaluate(() => window.presentation.lastPointerMove);
    assert(Math.abs(clicked.y - 385) < 0.1, `Pointer move mismatch: ${JSON.stringify({ target, pointerMove, clicked })}`);
    await page.setViewportSize({ width: viewport.width - 20, height: viewport.height - 30 }); await page.waitForTimeout(80);
    const target2 = await page.evaluate(() => window.presentation.view.worldToScreen({ x: 370, y: 395 })); await page.mouse.click(target2.x, target2.y);
    await page.waitForFunction(() => Math.abs(window.presentation.engine.getPhysicsEntity(window.presentation.handles.actor).y - 395) < 0.1);
    await page.screenshot({ path: resolve(output, `${viewport.width}-dpr${deviceScaleFactor}-${color}.png`) });
    const lifecycle = await page.evaluate(async () => {
      const s = window.presentation, old = s.handles.actor;
      const wait = async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); };
      s.view.setCamera({ follow: old }); s.move(old, 420, 380); await wait();
      const followed = s.frame.camera.cameraX === 420 && s.frame.camera.cameraY === 380;
      s.view.setCamera({ x: 0, y: 0, bounds: { minX: 400, minY: 400, maxX: 600, maxY: 600 } }); await wait();
      const bounded = s.frame.camera.cameraX === 500 && s.frame.camera.cameraY === 500;
      s.apply(); await wait(); s.view.setCamera({ follow: s.handles.actor }); await wait();
      const rebound = s.frame.camera.cameraX === 330 && s.frame.camera.cameraY === 350;
      const staleRejected = !s.engine.updateDataSceneSpriteAnimations([{ entity: old, clip: 0 }]) && s.engine.getPhysicsEntity(old) === undefined;
      const costs = [];
      for (const count of [100, 500, 1000]) {
        s.mass(count); for (let i = 0; i < 4; i += 1) await new Promise(requestAnimationFrame);
        const renderSamples = [], rustSamples = [];
        for (let i = 0; i < 12; i += 1) { await new Promise(requestAnimationFrame); renderSamples.push(s.frame.renderMs); rustSamples.push(s.frame.rustUpdateMs); }
        const p95 = (values) => values.sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
        costs.push({ count, commandCount: s.frame.commands.length, renderP95Ms: p95(renderSamples), rustUpdateP95Ms: p95(rustSamples),
          stats: s.frame.stats, shadow: s.engine.dataSceneGroundShadowStats(), resources: s.renderer.resourceStats() });
      }
      s.view.setSun({ ...s.sun, maxCasters: 100 }); await wait();
      const budget = s.engine.dataSceneGroundShadowStats();
      s.apply(); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
      const owner = s.handles.tree; s.engine.despawnPhysicsEntity(owner); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
      const afterDespawn = s.engine.dataSceneGroundShadowStats();
      s.engine.useBreakoutGame(); await wait();
      const projectionReset = s.frame.camera.groundYScale === 1 && s.engine.cameraGroundYScale() === 1;
      s.destroy();
      let destroyedRejected = false; try { s.engine.updateDataSceneSpriteAnimations([{ entity: old, clip: 0 }]); } catch { destroyedRejected = true; }
      return { followed, bounded, rebound, projectionReset, staleRejected, destroyedRejected, afterDespawn, budget, costs, destroyedResources: s.renderer.resourceStats() };
    });
    assert(lifecycle.followed && lifecycle.bounded && lifecycle.rebound && lifecycle.projectionReset && lifecycle.staleRejected && lifecycle.destroyedRejected); assert.equal(lifecycle.afterDespawn.casters, 2);
    assert.equal(lifecycle.budget.casters, 100); assert.equal(lifecycle.budget.skippedByBudget, 900);
    assert(Object.values(lifecycle.destroyedResources).every((value) => value === 0), "GPU resources remain after destroy");
    const resourceCounts = lifecycle.costs.map(({ resources }) => [resources.textureCount, resources.programCount, resources.bufferCount, resources.renderTargetCount]);
    assert.deepEqual(resourceCounts[0], resourceCounts[1]); assert.deepEqual(resourceCounts[0], resourceCounts[2]);
    for (const cost of lifecycle.costs) {
      assert.equal(cost.shadow.casters, cost.count); assert.equal(cost.shadow.cacheHits, cost.count);
      assert.equal(cost.commandCount, cost.count * 2 + 1); assert(cost.stats.drawCalls <= 5);
      assert(Number.isFinite(cost.renderP95Ms) && Number.isFinite(cost.rustUpdateP95Ms));
    }
    assert.deepEqual(errors, []);
    report.cases.push({ viewport, deviceScaleFactor, color, ...result, projectionEdges, lifecycle, browserErrors: errors }); await page.close();
  }
  // Exercise actual WGSL/queue submissions with GPU readback, without a WebGL2 fallback.
  report.webgpu = [];
  for (const deviceScaleFactor of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: 640, height: 480 }, deviceScaleFactor });
    const errors = [];
    report.webgpuPending = { deviceScaleFactor, errors };
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error" || message.type() === "warning") errors.push(message.text()); });
    await page.addInitScript(installPresentationGpuCapture);
    await page.goto(`${address}?backend=webgpu`);
    try { await page.waitForFunction(() => window.presentation?.frame, undefined, { timeout: 30000 }); }
    catch (error) { throw new Error(`WebGPU startup failed: ${errors.join("; ") || error}`); }
    const gpu = await page.evaluate(async () => {
      const s = window.presentation, device = s.renderer.gpuDevice();
      device.pushErrorScope("validation");
      s.engine.pauseDataScene();
      s.engine.updateDataSceneSpriteAnimations([{ entity: s.handles.actor, clip: 0, paused: true }, { entity: s.handles.other, clip: 1, frame: 0, flipX: true, paused: true }]);
      s.debug(true); s.lighting(true);
      for (let i = 0; i < 4; i += 1) await new Promise(requestAnimationFrame);
      const error = await device.popErrorScope();
      if (error) throw new Error(error.message);
      const stats = { ...s.frame.stats }, info = s.renderer.gpuAdapter().info;
      const lightingPixels = (await window.capturePresentationGpu({ lit: s.view.worldToScreen({ x: 480, y: 300 }), dark: s.view.worldToScreen({ x: 570, y: 300 }) })).pixels;
      s.debug(false); s.lighting(false);
      await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
      const ground = s.view.worldToScreen({ x: 500, y: 430 });
      const shadow = s.view.worldToScreen({ x: 400 + 25 / Math.hypot(1, 0.5), y: 330 + 12.5 / Math.hypot(1, 0.5) });
      const actor = s.view.worldToScreen({ x: 338, y: 350 }); actor.y -= 24;
      const green = s.view.worldToScreen({ x: 438, y: 350 }); green.y -= 24;
      const white = s.view.worldToScreen({ x: 462, y: 350 }); white.y -= 24;
      return { stats, lightingPixels, points: { ground, shadow, actor, green, white }, adapter: { vendor: info.vendor, architecture: info.architecture, description: info.description } };
    });
    const capture = await page.evaluate((points) => window.capturePresentationGpu(points), gpu.points);
    const pixels = capture.pixels;
    await writeFile(resolve(output, `webgpu-dpr${deviceScaleFactor}.png`), Buffer.from(capture.png.split(",")[1], "base64"));
    assert(Math.abs(pixels.ground[0] - 128) <= 2 && Math.abs(pixels.shadow[0] - 64) <= 4 && pixels.actor[0] > 245 && pixels.actor[2] < 5, `WebGPU projected pixels mismatch: ${JSON.stringify(pixels)}`);
    assert(pixels.green[1] > 245 && pixels.green[0] < 5 && pixels.white.every((v) => v > 245), "WebGPU independent clip/flip pixels mismatch");
    assert(gpu.lightingPixels.lit[0] > gpu.lightingPixels.dark[0] + 10, "WebGPU sun/point lighting pixels mismatch");
    assert(gpu.stats.lightingDrawCalls > 0 && gpu.stats.physicsDebugLineCount > 0);
    const projectionEdges = await page.evaluate(checkPresentationProjectionEdges);
    const gpuErrors = await page.evaluate(() => { window.presentation.destroy(); window.disposePresentationGpuCapture(); return window.gpuErrors; });
    assert.deepEqual(errors, []); assert.deepEqual(gpuErrors, []);
    report.webgpu.push({ backend: "native-webgpu-offscreen", deviceScaleFactor, ...gpu, pixels, projectionEdges, errors, gpuErrors }); await page.close();
  }
  delete report.webgpuPending;
  assert.equal(report.cases.length, webgpuOnly ? 0 : 8); assert.equal(report.webgpu.length, 2);
  delete report.activeCase;
  report.status = "passed";
} catch (error) { report.status = "failed"; report.error = error.stack ?? String(error); process.exitCode = 1; }
finally { await browser?.close(); await new Promise((done) => server.close(done)); await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2) + "\n"); }
console.log(JSON.stringify({ ...report, artifactDir: output }, null, 2));

// Executed in the browser on both backends; no Node-side values are captured.
async function checkPresentationProjectionEdges() {
  const s = window.presentation, canvas = document.querySelector("canvas");
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const wait = async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); };
  const pixel = async (world) => {
    const point = s.view.worldToScreen(world, s.frame.camera);
    if (window.capturePresentationGpu) return (await window.capturePresentationGpu({ sample: point })).pixels.sample;
    const gl = canvas.getContext("webgl2"), data = new Uint8Array(4);
    gl.readPixels(Math.floor(point.x * canvas.width / canvas.clientWidth), Math.floor((canvas.clientHeight - point.y) * canvas.height / canvas.clientHeight), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
    check(!gl.isContextLost(), "projection edge case lost WebGL context");
    return [...data];
  };
  const previousFrame = s.frame;
  s.view.setGroundYScale(0.01); await wait();
  check(s.frame !== previousFrame && s.frame.camera.groundYScale === Math.fround(0.01), "Wasm f32 minimum ground scale must render a new frame");
  const minimumScale = s.frame.camera.groundYScale;
  const object = (id, x, y, layer, visual) => ({ id, prefab: "object", x, y, layer,
    props: { components: { visual: { kind: "sprite", texture: 1, width: 32, height: 64, depthSort: "hd2d", ...visual }, collider: "none", layer: "wall" } } });
  s.apply([
    object("ground", 400, 300, -10, { width: 1800, height: 1600, projection: "ground", tint: "#808080", depthSort: "layer" }),
    object("centered", 300, 300, 0, { texture: 2, frame: { u0: 0, v0: 0, u1: 0.25, v1: 1 } }),
    object("anchored", 300, 340, 0, { texture: 3, width: 48, originY: 1 }),
    object("textOccluder", 350, 312, 0, { texture: 3, originY: 1 }),
  ]);
  s.engine.setWorldText(2, { fontId: 1, text: "A", x: 346, y: 302, renderLayer: 1000 });
  s.view.setCamera({ x: 350, y: 330 }); s.view.setSun(false);
  const depthPixels = [];
  for (const scale of [1, 0.72]) {
    s.view.setGroundYScale(scale); await wait();
    const color = await pixel({ x: 308, y: 320 });
    check(scale === 1 ? color[0] < 5 && color[2] > 90 : color[0] > 245 && color[2] < 5,
      `upright default pivot sorted against the wrong projected foot: ${scale}, ${color}`);
    const textColor = await pixel({ x: 350, y: 307 });
    check(scale === 1 ? textColor[0] < 5 && textColor[2] > 90 : textColor.every((value) => value > 245),
      `world text sorted against the wrong projected block bottom: ${scale}, ${textColor}`);
    depthPixels.push({ scale, color, textColor });
  }
  const light = { x: 400, y: 300, radius: 60, radiusY: 180, intensity: 0.4, color: [1, 1, 1] };
  const lighting = { ambient: [0, 0, 0, 0], pointLights: [light], tileOccluders: [{ x: 390, y: 400, width: 20, height: 10 }] };
  s.lighting({ ...lighting, shadows: false }); await wait();
  const clear = await pixel({ x: 400, y: 435 });
  s.lighting({ ...lighting, shadows: { color: [0, 0, 0, 0.8], projectionLength: 20 } }); await wait();
  const shadow = await pixel({ x: 400, y: 435 });
  check(s.frame.stats.shadowCasterCount === 1 && clear[0] > shadow[0] + 20,
    `elliptical light lost its vertical occluder shadow: ${JSON.stringify({ clear, shadow, stats: s.frame.stats })}`);
  s.lighting({ ...lighting, pointLights: [{ ...light, radiusY: 50 }], shadows: true }); await wait();
  check(s.frame.stats.shadowCasterCount === 0, "shrinking radiusY must invalidate the occluder cache");
  check(s.engine.removeWorldText(2), "review fixture must retire its unanchored world text");
  s.lighting(false); s.apply(); await wait();
  return { minimumScale, depthPixels, ellipticalLightPixels: { clear, shadow } };
}
