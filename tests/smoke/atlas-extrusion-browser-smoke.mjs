import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';
import { createAtlasFixtures } from './atlas-extrusion-fixtures.mjs';
import { installSpatialGpuTarget } from './spatial-webgpu-capture.mjs';
import { encodePngRgba } from '../../scripts/tools/pack-textures.mjs';

const { values } = parseArgs({ options: { 'artifact-dir': { type: 'string', default: 'artifacts/atlas-extrusion' } } });
const root = resolve('.'), parent = resolve(values['artifact-dir']);
await mkdir(parent, { recursive: true });
const run = await mkdtemp(resolve(parent, 'run-'));
const startedAt = new Date().toISOString(), results = [];
async function writeReport(report) {
  const data = JSON.stringify({ run, startedAt, ...report }, null, 2) + '\n';
  await writeFile(resolve(run, 'verification.json'), data);
  await writeFile(resolve(parent, 'verification.json'), data);
}
// Invalidate earlier success before setup. A failed rerun must never leave a
// stale green report for consumers or the uploaded CI artifact.
await writeReport({ ok: false, status: 'running', results });
const generated = await createAtlasFixtures(run).catch(async error => {
  await writeReport({ ok: false, status: 'failed', error: String(error), results }); throw error;
});
const fixture = { sources: generated.sources.map(({ pixels, ...s }) => ({ ...s, referenceImage: 'reference-' + s.name + '.png' })), atlases: generated.atlases.filter(a => a.name !== 'default') };
await writeFile(resolve(run, 'blank.png'), encodePngRgba(fixture.atlases[0].width, fixture.atlases[0].height, new Uint8Array(fixture.atlases[0].width * fixture.atlases[0].height * 4)));
await writeFile(resolve(run, 'fixture.json'), JSON.stringify(fixture, null, 2));
const html = '<!doctype html><meta charset="utf-8"><script type="importmap">{"imports":{"@ferrum2d/ferrum-web/core":"/packages/ferrum-web/dist/core.js"}}</script><script type="module">import{probeAtlasExtrusion}from"/tests/smoke/atlas-extrusion-browser-fixture.mjs";window.probeAtlasExtrusion=probeAtlasExtrusion;</script>';
const server = createServer((req, res) => void (async () => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
  if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
  const asset = url.pathname.startsWith('/assets/');
  const base = asset ? run : root, file = resolve(base, '.' + decodeURIComponent(asset ? url.pathname.slice('/assets'.length) : url.pathname));
  assert(file.startsWith(base + sep) && (asset ? file.endsWith('.png') : /\.(m?js|wasm)$/.test(file)));
  res.setHeader('Content-Type', file.endsWith('.png') ? 'image/png' : file.endsWith('.wasm') ? 'application/wasm' : 'application/javascript');
  res.end(await readFile(file));
})().catch(() => res.writeHead(404).end()));
let browser;
try {
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  browser = await chromium.launch({ headless: true, executablePath: process.env.FERRUM_BROWSER_EXECUTABLE, args: ['--no-sandbox', '--enable-unsafe-webgpu', '--use-vulkan=swiftshader'] });
  for (const dpr of [1, 1.5, 2]) {
    const page = await browser.newPage({ deviceScaleFactor: dpr }), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    try {
      await page.addInitScript(installSpatialGpuTarget);
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(() => typeof window.probeAtlasExtrusion === 'function');
      for (const textureColorSpace of ['none', 'srgb']) {
        const pair = [];
        for (const preferred of ['webgl2', 'webgpu']) {
          if (dpr === 1 && textureColorSpace === 'none') {
            const emptyFixture = { ...fixture, sources: fixture.sources.map((s, i) => i === 0 ? { ...s, referenceImage: 'blank.png' } : s) };
            await assert.rejects(page.evaluate(({ preferred, fixture }) => window.probeAtlasExtrusion(preferred, fixture), { preferred, fixture: emptyFixture }), /empty reference/);
          }
          const result = await page.evaluate(({ preferred, fixture, textureColorSpace }) => window.probeAtlasExtrusion(preferred, fixture, textureColorSpace), { preferred, fixture, textureColorSpace });
          result.emptyReferenceCheck = dpr === 1 && textureColorSpace === 'none' ? 'passed' : 'not-run';
          assert(result.ok && result.normalCases.length === 36 && result.edgeProbes.length === 15);
          pair.push(result);
        }
        // Byte-exact backend parity uses data decoding. sRGB legacy uploads
        // retain their existing alpha semantics, and each must match its own
        // independent frame reference across the full transform/edge matrix.
        let parityMaxChannelDelta = null;
        if (textureColorSpace === 'none') {
          const a = Buffer.from(pair[0].reference, 'base64'), b = Buffer.from(pair[1].reference, 'base64');
          assert.equal(a.length, b.length); parityMaxChannelDelta = 0;
          for (let i = 0; i < a.length; i++) parityMaxChannelDelta = Math.max(parityMaxChannelDelta, Math.abs(a[i] - b[i]));
          if (parityMaxChannelDelta > 2) await writeFile(resolve(run, 'parity-failure-' + dpr + '.json'), JSON.stringify({ a: [...a], b: [...b], parityMaxChannelDelta }));
          assert(parityMaxChannelDelta <= 2, 'GL/GPU protected frame parity: ' + parityMaxChannelDelta);
        }
        for (const result of pair) { delete result.reference; results.push({ dpr, ...result, parityMaxChannelDelta }); }
      }
      assert.deepEqual(errors, []);
    } catch (error) {
      const diagnostic = await page.evaluate(() => window.atlasExtrusionFailure ?? null).catch(() => null);
      await writeFile(resolve(run, 'failure-' + dpr + '.json'), JSON.stringify(diagnostic, null, 2));
      await page.screenshot({ path: resolve(run, 'failure-' + dpr + '.png') }).catch(() => undefined); throw error;
    } finally { await page.close(); }
  }
  const browserVersion = browser.version();
  await browser.close(); browser = undefined;
  await writeReport({ ok: true, status: 'passed', finishedAt: new Date().toISOString(), browser: browserVersion, target: 'Chromium WebGL2 and software WebGPU offscreen; native compositor/mobile fp16 not measured', results });
  console.log(JSON.stringify({ ok: true, run, combinations: results.length, normalCases: results.reduce((n, r) => n + r.normalCases.length, 0), edgeProbes: results.reduce((n, r) => n + r.edgeProbes.length, 0) }));
} catch (error) {
  await writeReport({ ok: false, status: 'failed', finishedAt: new Date().toISOString(), error: String(error), results });
  throw error;
} finally {
  try { await browser?.close(); } finally { await new Promise(done => server.close(done)); }
}
