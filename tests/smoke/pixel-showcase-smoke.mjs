import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright-core';
import { installSpatialGpuTarget } from './spatial-webgpu-capture.mjs';
import { validatePixelArtProfile } from '../../packages/create-game/templates/_shared/scripts/ferrum-pixel-assets.mjs';

const project = resolve('examples/pixel-art');
const dist = resolve(process.argv[2] ?? 'examples/pixel-art/dist');
const prefix = '/project-subpath/pixel-art/';
const parent = resolve('artifacts/pixel-showcase');
await mkdir(parent, { recursive: true });
const run = await mkdtemp(resolve(parent, 'run-'));
const profile = await validatePixelArtProfile({ root: project, required: true });
assert.equal(profile.ok, true, JSON.stringify(profile.reports));
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => void (async () => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
  if (!url.pathname.startsWith(prefix)) { res.writeHead(404).end(); return; }
  const file = resolve(dist, decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html');
  if (!file.startsWith(dist + sep)) { res.writeHead(403).end(); return; }
  res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
  res.end(await readFile(file));
})().catch(() => res.writeHead(404).end()));
const results = [];
let browser;
try {
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  browser = await chromium.launch({ headless: true, executablePath: process.env.FERRUM_BROWSER_EXECUTABLE,
    args: ['--no-sandbox', '--enable-unsafe-webgpu', '--use-vulkan=swiftshader'] });
  for (const backend of ['webgl2', 'webgpu']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const errors = [], wasm = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (new URL(response.url()).pathname.endsWith('.wasm')) wasm.push({ ok: response.ok(), type: response.headers()['content-type'] });
      if (!response.ok()) errors.push('HTTP ' + response.status() + ' ' + response.url());
    });
    if (backend === 'webgpu') {
      const installPixelGpuCapture = () => {
        const context = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
          if (kind === 'webgpu') this.dataset.spatialGpuTarget = 'true';
          return Reflect.apply(context, this, [kind, ...args]);
        };
        const requestAdapter = navigator.gpu.requestAdapter.bind(navigator.gpu);
        navigator.gpu.requestAdapter = async (...args) => {
          const adapter = await requestAdapter(...args);
          if (!adapter) return adapter;
          const requestDevice = adapter.requestDevice.bind(adapter);
          adapter.requestDevice = async (...args) => {
            const device = await requestDevice(...args);
            window.pixelSmokeGpuDevice = device;
            device.addEventListener('uncapturederror', event => { window.pixelSmokeGpuError = event.error.message; });
            return device;
          };
          return adapter;
        };
      };
      // One script fixes wrapper order: Playwright does not order separate init scripts.
      await page.addInitScript({ content: `(${installSpatialGpuTarget.toString()})();(${installPixelGpuCapture.toString()})();` });
    }
    const snapshot = () => page.evaluate(() => window.ferrumPixelShowcase.snapshot());
    const pixels = () => page.evaluate(async () => {
      const canvas = document.querySelector('canvas'), device = window.pixelSmokeGpuDevice;
      if (!device) {
        const gl = canvas.getContext('webgl2'), data = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
        if (gl.getError()) throw Error('Showcase GL readback failed');
        return Array.from(data);
      }
      const texture = canvas.getContext('webgpu').getCurrentTexture(), stride = Math.ceil(canvas.width * 4 / 256) * 256;
      const buffer = device.createBuffer({ size: stride * canvas.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      try {
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: stride }, { width: canvas.width, height: canvas.height });
        device.queue.submit([encoder.finish()]); await buffer.mapAsync(GPUMapMode.READ);
        const mapped = new Uint8Array(buffer.getMappedRange()), data = new Uint8Array(canvas.width * canvas.height * 4);
        for (let row = 0; row < canvas.height; row++) data.set(mapped.subarray(row * stride, row * stride + canvas.width * 4), row * canvas.width * 4);
        buffer.unmap(); return Array.from(data);
      } finally { buffer.destroy(); }
    });
    const changed = (a, b) => { assert.equal(a.length, b.length); let count = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 8) count++; return count; };
    const settle = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}${prefix}?renderer=${backend}`);
      await page.waitForFunction(() => window.ferrumPixelShowcase?.snapshot().commands >= 240, null, { timeout: 30_000 });
      const initial = await snapshot();
      assert.equal(initial.backend, backend); assert.equal(initial.state, 1); assert.equal(initial.entities, 250);
      assert.equal(initial.seeds, 0);
      // The normal attachment also draws foreground coverage for unmapped texture
      // groups; the four scene textures therefore need more than the hero's draw.
      assert(initial.normalDrawCalls >= 1 && initial.normalDrawCalls <= 4); assert(initial.drawCalls <= 20);
      assert(initial.presentation.integerScale && initial.presentation.sourceWidth === 320 && initial.presentation.sourceHeight === 192);
      assert.equal(initial.presentation.scale, 3, 'desktop frame must not consume the pixels needed for 3x integer scale');
      // A real button keyboard activation issues a destination; movement and collection
      // must be observed in the native state instead of invoking test-only setters.
      await page.locator('[data-seed="0"]').focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(() => {
        const s = window.ferrumPixelShowcase.snapshot();
        return s.animation.clip === 1 && s.animation.frame > 0 && s.actor.x < 145;
      }, null, { timeout: 20_000 });
      const walking = await snapshot();
      await page.waitForFunction(() => window.ferrumPixelShowcase.snapshot().seeds === 1, null, { timeout: 30_000 });
      for (const index of [1, 2]) {
        await page.locator(`[data-seed="${index}"]`).click();
        await page.waitForFunction(n => window.ferrumPixelShowcase.snapshot().seeds === n, index + 1, { timeout: 30_000 });
      }
      const collected = await snapshot(); assert.equal(collected.entities, 247); assert(collected.drawCalls <= 20);
      assert.match(await page.locator('.pixel-progress').textContent(), /빛이 돌아왔어요/);
      await page.locator('#pixel-reset').click();
      await page.waitForFunction(() => window.ferrumPixelShowcase.snapshot().seeds === 0);
      const canvas = page.locator('canvas'), box = await canvas.boundingBox(), p = (await snapshot()).presentation;
      // A point in the authored world, mapped through the actual letterbox and scale.
      await page.mouse.click(box.x + (p.x + 100 * p.scale) * box.width / p.canvasWidth,
        box.y + (p.y + 136 * p.scale) * box.height / p.canvasHeight);
      await page.waitForFunction(() => window.ferrumPixelShowcase.snapshot().actor.x < 145, null, { timeout: 20_000 });
      await page.locator('#pixel-pause').click(); await settle();
      const paused = await snapshot(); assert.notEqual(paused.state, 1);
      const night = await pixels();
      await page.selectOption('#pixel-light', 'day'); await settle(); const day = await pixels();
      assert(changed(night, day) > 1000, 'normal-lit night must differ visibly from daytime');
      await page.selectOption('#pixel-palette', 'rose'); await settle(); const rose = await pixels();
      assert(changed(day, rose) > 50, 'palette change must affect actual sprite pixels');
      const effectChanges = {};
      for (const [effect, count] of [['dusk', 2], ['pixel', 1], ['crt', 2], ['glitch', 1]]) {
        await page.selectOption('#pixel-effect', effect);
        await page.waitForFunction(n => window.ferrumPixelShowcase.snapshot().postProcessPassCount === n, count);
        await settle(); const current = await pixels(); effectChanges[effect] = changed(rose, current);
        assert(effectChanges[effect] > 100, `${effect} must change actual output`);
        assert((await snapshot()).drawCalls <= 20);
      }
      await page.selectOption('#pixel-effect', 'clean'); await page.selectOption('#pixel-light', 'night'); await settle();
      if (backend === 'webgl2') {
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: resolve(run, 'pixel-showcase-desktop.png'), fullPage: true });
      }
      await page.setViewportSize({ width: 390, height: 844 }); await settle();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'narrow horizontal overflow');
      const small = await snapshot(); assert.equal(small.actor.x, paused.actor.x); assert.equal(small.presentation.sourceWidth, 320);
      if (backend === 'webgl2') await page.screenshot({ path: resolve(run, 'pixel-showcase-mobile.png'), fullPage: true });
      assert(wasm.length > 0 && wasm.every(entry => entry.ok && entry.type.startsWith('application/wasm')));
      assert.equal(await page.evaluate(() => window.pixelSmokeGpuError ?? null), null); assert.deepEqual(errors, []);
      const released = await page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        const resources = window.ferrumPixelShowcase.destroy();
        window.disposeSpatialGpuTarget?.(canvas); return resources;
      });
      assert.equal(released.textureCount, 0); assert.equal(released.bufferCount, 0); assert.equal(released.programCount, 0);
      results.push({ backend, initial, walking, collected, paused, effectChanges, small, released, errors, wasm });
    } catch (error) {
      await page.screenshot({ path: resolve(run, 'failure-' + backend + '.png'), fullPage: true });
      await writeFile(resolve(run, 'failure-' + backend + '.json'), JSON.stringify({ errors, body: await page.locator('body').innerText() }, null, 2));
      throw error;
    } finally { await page.close(); }
  }
  const report = { ok: true, run, browser: browser.version(), subpath: prefix, profile, results,
    target: 'Production example: WebGL2 canvas and software WebGPU offscreen; no physical GPU claims' };
  await writeFile(resolve(run, 'verification.json'), JSON.stringify(report, null, 2));
  await writeFile(resolve(parent, 'verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await writeFile(resolve(run, 'verification.json'), JSON.stringify({ ok: false, run, results, error: String(error.stack ?? error) }, null, 2));
  throw error;
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
