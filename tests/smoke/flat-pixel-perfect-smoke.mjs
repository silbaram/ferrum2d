import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { chromium } from 'playwright-core';
import { installSpatialGpuTarget } from './spatial-webgpu-capture.mjs';
const root = resolve('.'), parent = resolve('artifacts/flat-pixel-perfect/browser');
await mkdir(parent, { recursive: true });
const run = await mkdtemp(resolve(parent, 'run-'));
const html = '<!doctype html><style>body{margin:0}</style><script type="importmap">{"imports":{"@ferrum2d/ferrum-web/core":"/packages/ferrum-web/dist/core.js"}}</script><script type="module">import{probeFlatPixels,probeFlatPixelRuntime}from"/tests/smoke/flat-pixel-perfect-fixture.mjs";import{probeFlatPixelEdges}from"/tests/smoke/flat-pixel-perfect-edges-fixture.mjs";window.probeFlatPixelEdges=probeFlatPixelEdges;window.probeFlatPixels=probeFlatPixels;window.probeFlatPixelRuntime=probeFlatPixelRuntime;</script>';
const server = createServer((req, res) => void (async () => { const url = new URL(req.url, 'http://localhost'); if (url.pathname === '/favicon.ico') {
    res.writeHead(204).end();
    return;
} if (url.pathname === '/') {
    res.setHeader('Content-Type', 'text/html');
    res.end(html);
    return;
} const path = resolve(root, '.' + decodeURIComponent(url.pathname)); if (!path.startsWith(root + sep) || !/\.(?:m?js|wasm)$/.test(path)) {
    res.writeHead(403).end();
    return;
} res.setHeader('Content-Type', path.endsWith('.wasm') ? 'application/wasm' : 'application/javascript'); res.end(await readFile(path)); })().catch(() => res.writeHead(404).end()));
let browser;
const results = [];
try {
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    browser = await chromium.launch({ headless: true, executablePath: process.env.FERRUM_BROWSER_EXECUTABLE, args: ['--no-sandbox', '--enable-unsafe-webgpu', '--use-vulkan=swiftshader'] });
    for (const dpr of [1, 1.5, 2]) {
        const page = await browser.newPage({ viewport: { width: 800, height: 650 }, deviceScaleFactor: dpr });
        await page.addInitScript(installSpatialGpuTarget);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('http://127.0.0.1:' + server.address().port);
        await page.waitForFunction(() => window.probeFlatPixels);
        try {
            const pair = [];
            for (const preferred of ['webgl2', 'webgpu'])
                pair.push({ dpr, ...await page.evaluate(async (preferred) => ({ ...await window.probeFlatPixels(preferred), runtime: await window.probeFlatPixelRuntime(preferred), edges: await window.probeFlatPixelEdges(preferred) }), preferred) });
            const a = Buffer.from(pair[0].reference, 'base64'), b = Buffer.from(pair[1].reference, 'base64');
            assert.equal(a.length, b.length);
            let delta = 0;
            for (let i = 0; i < a.length; i++)
                delta = Math.max(delta, Math.abs(a[i] - b[i]));
            await writeFile(resolve(run, 'parity-' + dpr + '.json'), JSON.stringify({ a: [...a], b: [...b], delta }));
            assert(delta <= 2, 'WebGL2/WebGPU virtual pixel parity: ' + delta);
            for (const result of pair) {
                delete result.reference;
                results.push({ ...result, parityMaxChannelDelta: delta });
            }
            if (dpr === 1) {
                const result = await page.evaluate(() => window.probeFlatPixels('webgpu', 'linear-srgb'));
                delete result.reference;
                results.push({ dpr, ...result });
            }
            assert.deepEqual(errors, []);
        }
        catch (error) {
            await page.screenshot({ path: resolve(run, `failure-${dpr}.png`) });
            throw Error(String(error) + ' ' + errors.join('\n'));
        }
        finally {
            await page.close();
        }
    }
    const ok=results.every(result=>result.edges?.ok!==false);
    const report = { ok, run, browser: browser.version(), target: 'Real WebGL2 and software WebGPU offscreen color targets; native canvas compositor is not claimed', results };
    await writeFile(resolve(run, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
    await writeFile(resolve(parent, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
    assert(ok,"pixel-perfect boundary regressions failed; see verification.json");
    console.log(JSON.stringify(report, null, 2));
}
catch (error) {
    await writeFile(resolve(parent, 'verification.json'), JSON.stringify({ ok: false, run, results, error: String(error.stack ?? error) }, null, 2));
    throw error;
}
finally {
    await browser?.close();
    await new Promise(done => server.close(done));
}
