import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { chromium } from 'playwright-core';
import { installSpatialGpuTarget } from './spatial-webgpu-capture.mjs';

const root = resolve('.'), parent = resolve('artifacts/runtime-animation');
const requireWebGpu = process.argv.includes('--require-webgpu');
assert(process.argv.slice(2).every(arg => arg === '--require-webgpu'), 'Unknown sprite animation smoke option');
const command = 'node tests/smoke/sprite-animation-runtime-smoke.mjs' + (requireWebGpu ? ' --require-webgpu' : '');
await mkdir(parent, { recursive: true });
const run = await mkdtemp(resolve(parent, 'run-'));
const startedAt = new Date().toISOString();
const results = [], images = [], pageErrors = [];
const html = `<!doctype html><meta charset="utf-8"><title>Native sprite animation smoke</title>
<style>body{margin:0;background:#181818}canvas{margin:16px}</style>
<script type="importmap">{"imports":{"@ferrum2d/ferrum-web/core":"/packages/ferrum-web/dist/core.js","@ferrum2d/ferrum-web/authoring":"/packages/ferrum-web/dist/authoring.js"}}</script>
<script type="module">import{probeSpriteAnimationRuntime}from"/tests/smoke/sprite-animation-runtime-fixture.mjs";window.probeSpriteAnimationRuntime=probeSpriteAnimationRuntime;</script>`;
const server = createServer((req, res) => void (async () => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
  if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
  const path = resolve(root, '.' + decodeURIComponent(url.pathname));
  if (!path.startsWith(root + sep) || !/\.(?:m?js|wasm)$/.test(path)) { res.writeHead(403).end(); return; }
  res.setHeader('Content-Type', path.endsWith('.wasm') ? 'application/wasm' : 'application/javascript');
  res.end(await readFile(path));
})().catch(() => { if (!res.headersSent) res.writeHead(404); res.end(); }));
let browser, listening = false;
const writeReport = async report => {
  const text = JSON.stringify({ run, command, requireWebGpu, startedAt, ...report }, null, 2) + '\n';
  await writeFile(resolve(run, 'verification.json'), text);
  await writeFile(resolve(parent, 'verification.json'), text);
};

try {
  // Invalidate earlier success before any setup that can fail or be interrupted.
  await writeReport({ ok: false, status: 'running', results, images, pageErrors });
  // This runner consumes the caller's sequential build. It never rebuilds shared artifacts.
  await readFile(resolve(root, 'packages/ferrum-web/dist/core.js'));
  await readFile(resolve(root, 'packages/ferrum-web/pkg/ferrum_core_bg.wasm'));
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  listening = true;
  browser = await chromium.launch({
    headless: true, executablePath: process.env.FERRUM_BROWSER_EXECUTABLE,
    args: ['--no-sandbox', '--enable-unsafe-webgpu', '--use-vulkan=swiftshader'],
  });
  for (const preferred of ['webgl2', 'webgpu']) {
    const page = await browser.newPage({ viewport: { width: 768, height: 512 }, deviceScaleFactor: 1 });
    await page.addInitScript(installSpatialGpuTarget);
    page.on('pageerror', error => pageErrors.push({ preferred, error: error.message }));
    const fileLabel = name => { assert(/^[a-z0-9-]+$/.test(name), 'Unsafe artifact name'); return resolve(run, name + '.png'); };
    await page.exposeFunction('saveAnimationRuntimeImage', async (name, dataUrl) => {
      assert(typeof dataUrl === 'string' && dataUrl.startsWith('data:image/png;base64,') && dataUrl.length < 5_000_000, 'Invalid target readback image');
      const path = fileLabel(name);
      await writeFile(path, Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64'));
      images.push({ preferred, kind: 'actual-color-target-readback', path });
    });
    await page.exposeFunction('saveAnimationRuntimeCanvas', async name => {
      assert.equal(preferred, 'webgl2', 'Offscreen WebGPU cannot claim native visible canvas presentation');
      const path = fileLabel(name);
      await page.screenshot({ path });
      images.push({ preferred, kind: 'visible-canvas-screenshot', path });
    });
    try {
      await page.goto('http://127.0.0.1:' + server.address().port);
      await page.waitForFunction(() => typeof window.probeSpriteAnimationRuntime === 'function', undefined, { timeout: 30_000 });
      const result = await page.evaluate(preferred => window.probeSpriteAnimationRuntime(preferred), preferred);
      results.push(result);
      assert(result.status === 'passed' || (preferred === 'webgpu' && !requireWebGpu && result.status === 'unavailable'), 'Required renderer smoke did not pass: ' + JSON.stringify(result));
      if (result.status === 'passed') {
        assert.equal(result.backend, preferred);
        assert.equal(result.checks.length, 9);
        assert.equal(result.longClips.originalAtlasCells, 384);
        assert.equal(result.longClips.clips.length, 8);
        assert(result.renders > 100 && result.maxDrawCalls >= 1 && result.maxDrawCalls <= 4, 'Missing native workload or draw budget');
        assert(result.frameEvents > 300 && result.completionEvents >= 4, 'Missing animation event workload');
        assert(result.pixelSamples.length >= 20, 'Missing actual atlas UV/pixel evidence');
        assert.deepEqual(result.gpuErrors, []);
      }
    } catch (error) {
      const stage = await page.evaluate(() => window.spriteAnimationRuntimeStage).catch(() => 'page-unavailable');
      results.push({ preferred, status: 'failed', stage, error: String(error.stack ?? error) });
      await page.screenshot({ path: resolve(run, `${preferred}-failure.png`) }).catch(() => {});
      throw error;
    } finally {
      await page.close();
    }
  }
  assert.equal(results.find(result => result.preferred === 'webgl2')?.status, 'passed');
  assert.deepEqual(pageErrors, []);
  const browserVersion = browser.version();
  await browser.close();
  browser = undefined;
  const report = { ok: true, status: 'passed', finishedAt: new Date().toISOString(), browser: browserVersion, results, images, pageErrors };
  await writeReport(report);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const report = { ok: false, status: 'failed', finishedAt: new Date().toISOString(), results, images, pageErrors, error: String(error.stack ?? error) };
  await writeReport(report);
  throw error;
} finally {
  try { await browser?.close(); }
  finally { if (listening) await new Promise(done => server.close(done)); }
}
