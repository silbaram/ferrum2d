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
const html = (startRecipe) => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%}canvas{display:block;width:100%;height:100%}</style>
<script type="importmap">{"imports":{"@ferrum2d/ferrum-web/core":"/package/dist/core.js","@ferrum2d/ferrum-web/authoring":"/package/dist/authoring.js"}}</script></head>
<body><canvas id="game"></canvas>${startRecipe ? `<script type="module">import { startNativeScene } from '/recipe.mjs';
window.nativeScene = await startNativeScene(document.querySelector('canvas'));</script>` : ""}</body></html>`;
const texture = await readFile(resolve(root, "examples/shared/solid-white.png"));
const server = createServer((request, response) => { void (async () => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/") {
    response.setHeader("Content-Type", "text/html");
    response.end(html(!url.searchParams.has("runtime-startup") && !url.searchParams.has("runtime-fit")));
    return;
  }
  if (url.pathname === "/startup-texture.png") {
    if (url.searchParams.has("slow")) await new Promise((done) => {
      const timer = setTimeout(done, 5000);
      response.once("close", () => { clearTimeout(timer); done(); });
    });
    if (!response.destroyed) response.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" }).end(texture);
    return;
  }
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

async function checkRuntimeStartup(browser, address) {
  const page = await browser.newPage({ viewport: { width: 320, height: 240 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Deterministically exercise the WebGL2 fallback on all smoke machines.
  await page.addInitScript(() => Object.defineProperty(navigator, "gpu", { value: undefined }));
  try {
    await page.goto(`${address}?runtime-startup`);
    const rendered = await page.evaluate(async () => {
      const { createFerrumRuntime, WebGL2Renderer } = await import("@ferrum2d/ferrum-web/core");
      const canvas = document.querySelector("canvas");
      const dataScene = {
        format: "ferrum2d.consumer.scene-authoring", version: 1,
        sceneComposition: {
          initialFragment: "main", prefabs: { sprite: {} },
          fragments: { main: { instances: [{
            id: "hero", prefab: "sprite", x: 160, y: 120,
            props: { components: {
              visual: { kind: "sprite", texture: "hero", width: 32, height: 32, tint: "#00ff00" },
              collider: "none", layer: "player",
            } },
          }] } },
        },
        behaviorRecipes: { entities: {} },
      };
      let fallback;
      const progress = [];
      let firstFrame;
      const options = { canvas, dataScene, ui: false, rendererPreference: "webgpu" };
      const runtime = await createFerrumRuntime({
        ...options, assets: { textures: { hero: "/startup-texture.png" } },
        webgl2: { preserveDrawingBuffer: true, clearColor: [0, 0, 0, 1] },
        onRendererFallback: (info) => { fallback = { preferred: info.preferred, fallback: info.fallback }; },
        onAssetProgress: ({ loaded }) => progress.push(loaded),
        onFrame: ({ frame, rendererStats }) => {
          firstFrame ??= { entities: frame.entityCount, commands: rendererStats.renderCommandCount, draws: rendererStats.drawCalls };
        },
      });
      try {
        if (!runtime.engine.setDataSceneCamera({ x: 160, y: 120 })) throw new Error("Startup scene has no active camera");
        runtime.start();
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        const gl = canvas.getContext("webgl2");
        const pixel = new Uint8Array(4);
        gl.readPixels(canvas.width / 2, canvas.height / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        window.abortStartup = async (signal) => {
          const abortCanvas = document.createElement("canvas");
          document.body.append(abortCanvas);
          let frames = 0, errorName, abortError = false;
          try {
            const unexpected = await createFerrumRuntime({
              ...options, canvas: abortCanvas, assets: { textures: { hero: "/startup-texture.png?slow" } },
              signal, releaseCanvasContext: true, autostart: true, onFrame: () => { frames++; },
            });
            unexpected.destroy();
          } catch (error) {
            errorName = error.name;
            abortError = error instanceof DOMException && error.name === "AbortError";
          }
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
          const contextLost = abortCanvas.getContext("webgl2")?.isContextLost();
          abortCanvas.remove();
          return { errorName, abortError, frames, contextLost };
        };
        return {
          backend: runtime.rendererBackend, webgl2: runtime.renderer instanceof WebGL2Renderer,
          fallback, firstFrame, pixel: [...pixel], progress,
          textureId: runtime.assets?.textures.textureId("hero"),
        };
      } finally {
        runtime.destroy();
      }
    });
    assert.equal(rendered.backend, "webgl2");
    assert.equal(rendered.webgl2, true);
    assert.deepEqual(rendered.fallback, { preferred: "webgpu", fallback: "webgl2" });
    assert.deepEqual(rendered.firstFrame, { entities: 1, commands: 1, draws: 1 });
    assert(rendered.pixel[1] > 240 && rendered.pixel[0] < 10 && rendered.pixel[2] < 10, "startup texture should draw green");
    assert.deepEqual(rendered.progress, [0, 1]);
    assert(rendered.textureId > 0);

    const isSlowTexture = (request) => request.url().endsWith("/startup-texture.png?slow");
    const requested = page.waitForRequest(isSlowTexture);
    const failed = page.waitForEvent("requestfailed", { predicate: isSlowTexture });
    const cancelled = page.evaluate(() => {
      window.startupAbortController = new AbortController();
      return window.abortStartup(window.startupAbortController.signal);
    });
    const [, abort, request] = await Promise.all([
      requested.then(() => page.evaluate(() => window.startupAbortController.abort())),
      cancelled, failed,
    ]);
    assert.match(request.failure()?.errorText ?? "", /ERR_ABORTED/);
    assert.deepEqual(abort, { errorName: "AbortError", abortError: true, frames: 0, contextLost: true });
    assert.deepEqual(errors, []);
    return { rendered, abort, failedRequest: request.failure()?.errorText };
  } finally {
    await page.close();
  }
}

async function checkRuntimeCanvasRelease(browser, address) {
  const page = await browser.newPage({ viewport: { width: 200, height: 160 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    const contexts = window.webglContexts = new Set();
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      const context = getContext.call(this, type, ...args);
      if (type === "webgl2" && context) contexts.add(context);
      return context;
    };
  });
  try {
    await page.goto(`${address}?runtime-startup`);
    const result = await page.evaluate(async () => {
      const { createFerrumRuntime } = await import("@ferrum2d/ferrum-web/core");
      const newCanvas = () => document.body.appendChild(document.createElement("canvas"));
      const liveContexts = () => [...window.webglContexts].filter(context => !context.isContextLost()).length;
      let peakAfterDestroy = 0;
      const cycles = 20;
      for (let i = 0; i < cycles; i++) {
        const canvas = newCanvas();
        const runtime = await createFerrumRuntime({ canvas, releaseCanvasContext: true });
        if (canvas.getContext("webgl2").isContextLost()) throw new Error("Runtime started with a lost context");
        runtime.destroy();
        peakAfterDestroy = Math.max(peakAfterDestroy, liveContexts());
        canvas.remove();
      }
      const cycleContexts = window.webglContexts.size;
      const canvas = newCanvas();
      let shaderError;
      try {
        const unexpected = await createFerrumRuntime({
          canvas, shaderPreparation: { timeoutMs: 0 }, releaseCanvasContext: true,
        });
        unexpected.destroy();
      } catch (error) {
        shaderError = error.message;
      }
      const liveAfterFailure = liveContexts();
      canvas.remove();

      const reusableCanvas = newCanvas();
      const normal = await createFerrumRuntime({ canvas: reusableCanvas });
      normal.destroy();
      const liveAfterDefaultDestroy = liveContexts();
      const reopened = await createFerrumRuntime({ canvas: reusableCanvas, releaseCanvasContext: false });
      reopened.destroy();
      const liveAfterFalseDestroy = liveContexts();
      const defaultContextReused = window.webglContexts.size === cycleContexts + 2;
      reopened.renderer.releaseContext();
      reusableCanvas.remove();
      return { cycles, cycleContexts, peakAfterDestroy, shaderError, liveAfterFailure,
        liveAfterDefaultDestroy, liveAfterFalseDestroy, defaultContextReused, finalLiveContexts: liveContexts() };
    });
    assert.deepEqual(result, {
      cycles: 20, cycleContexts: 20, peakAfterDestroy: 0,
      shaderError: "shaderPreparation.timeoutMs must be in (0, 120000].", liveAfterFailure: 0,
      liveAfterDefaultDestroy: 1, liveAfterFalseDestroy: 1, defaultContextReused: true, finalLiveContexts: 0,
    });
    assert.deepEqual(errors, []);
    return result;
  } finally {
    await page.close();
  }
}

async function checkRuntimeFit(browser, address) {
  const sizes = [{ width: 1000, height: 500 }, { width: 390, height: 844 }];
  const page = await browser.newPage({ viewport: sizes[0], deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(`${address}?runtime-fit`);
    await page.evaluate(async () => {
      const { createFerrumRuntime } = await import("@ferrum2d/ferrum-web/core");
      const canvas = document.querySelector("canvas");
      const fit = { x: -80, y: 20, width: 640, height: 384 };
      const corners = [
        { x: -68, y: 32, tint: "#ff0000" }, { x: 548, y: 32, tint: "#00ff00" },
        { x: -68, y: 392, tint: "#0000ff" }, { x: 548, y: 392, tint: "#ffff00" },
      ];
      const dataScene = {
        format: "ferrum2d.consumer.scene-authoring", version: 1,
        display: { fit },
        sceneComposition: {
          initialFragment: "main", prefabs: { marker: {} },
          fragments: { main: { instances: corners.map(({ x, y, tint }, index) => ({
            id: `corner-${index}`, prefab: "marker", x, y,
            props: { components: {
              visual: { kind: "sprite", texture: "white", width: 16, height: 16, tint },
              collider: "none", layer: "player",
            } },
          })) } },
        },
        behaviorRecipes: { entities: {} },
      };
      let metrics;
      const runtime = await createFerrumRuntime({
        canvas, dataScene, ui: false, autostart: true,
        assets: { textures: { white: "/startup-texture.png" } },
        webgl2: { preserveDrawingBuffer: true, clearColor: [0, 0, 0, 1] },
        onFrame: ({ frame, rendererStats }) => {
          metrics = { entities: frame.entityCount, commands: rendererStats.renderCommandCount, draws: rendererStats.drawCalls };
        },
      });
      const view = runtime.dataScene.view;
      const gl = canvas.getContext("webgl2");
      const pixel = ({ x, y }) => {
        const rgba = new Uint8Array(4);
        gl.readPixels(Math.floor(x * canvas.width / canvas.clientWidth), canvas.height - 1 - Math.floor(y * canvas.height / canvas.clientHeight),
          1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
        if (gl.isContextLost()) throw new Error("Fit WebGL context lost");
        return [...rgba];
      };
      window.fitSmoke = {
        ready: () => metrics !== undefined,
        sample() {
          const center = { x: fit.x + fit.width / 2, y: fit.y + fit.height / 2 };
          const screenCenter = view.worldToScreen(center);
          const rect = canvas.getBoundingClientRect();
          const snapshot = view.snapshot();
          return {
            metrics, screenCenter, zoom: snapshot.zoom, dpr: snapshot.dpr,
            topLeft: view.worldToScreen({ x: fit.x, y: fit.y }),
            bottomRight: view.worldToScreen({ x: fit.x + fit.width, y: fit.y + fit.height }),
            pointer: view.pointerToWorld({ x: rect.left + screenCenter.x, y: rect.top + screenCenter.y }),
            pixels: corners.map((point) => pixel(view.worldToScreen(point))),
          };
        },
        reapply: () => { runtime.dataScene.reapply(); return runtime.dataScene.view === view; },
        destroy: () => runtime.destroy(),
      };
    });
    await page.waitForFunction(() => window.fitSmoke.ready());
    const results = [];
    const close = (actual, expected) => assert(Math.abs(actual - expected) < 1e-7, `${actual} vs ${expected}`);
    for (const size of sizes) {
      await page.setViewportSize(size);
      await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
      const result = await page.evaluate(() => window.fitSmoke.sample());
      const zoom = Math.min(size.width / 640, size.height / 384);
      close(result.zoom, zoom);
      assert.equal(result.dpr, 2);
      close(result.screenCenter.x, size.width / 2);
      close(result.screenCenter.y, size.height / 2);
      close(result.topLeft.x, (size.width - 640 * zoom) / 2);
      close(result.topLeft.y, (size.height - 384 * zoom) / 2);
      close(result.bottomRight.x, (size.width + 640 * zoom) / 2);
      close(result.bottomRight.y, (size.height + 384 * zoom) / 2);
      close(result.pointer.x, 240);
      close(result.pointer.y, 212);
      assert.deepEqual(result.pixels, [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 0, 255]]);
      assert.deepEqual(result.metrics, { entities: 4, commands: 4, draws: 1 });
      results.push({ ...size, ...result });
    }
    assert.equal(await page.evaluate(() => window.fitSmoke.reapply()), true, "reapply should preserve the fit view");
    assert.deepEqual(errors, []);
    return results;
  } finally {
    await page.evaluate(() => window.fitSmoke?.destroy()).catch(() => {});
    await page.close();
  }
}

try {
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  const address = `http://127.0.0.1:${server.address().port}/`;
  const options = { headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] };
  if (process.env.FERRUM_BROWSER_EXECUTABLE) browser = await chromium.launch({ ...options, executablePath: process.env.FERRUM_BROWSER_EXECUTABLE });
  else { try { browser = await chromium.launch({ ...options, channel: process.env.FERRUM_BROWSER_CHANNEL ?? "chrome" }); }
    catch (error) { if (process.env.FERRUM_BROWSER_CHANNEL) throw error; browser = await chromium.launch(options); } }
  report.runtimeStartup = await checkRuntimeStartup(browser, address);
  report.runtimeCanvasRelease = await checkRuntimeCanvasRelease(browser, address);
  report.runtimeFit = await checkRuntimeFit(browser, address);
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
      const actor = s.engine.getPhysicsEntity(s.actor);
      check(actor?.bodyType === "kinematic" && actor.colliderType === "aabb" && actor.colliderIsTrigger === false,
        "HD-2D movement requires a solid AABB kinematic actor");
      const moved = s.move(0, 50);
      check(moved.y === actor.y + 50, "the actor should move 50 world units");
      await wait(); p = pixel({ x: 800, y: 610 });
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
