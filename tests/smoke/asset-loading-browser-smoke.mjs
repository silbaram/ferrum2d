#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { chromium } from 'playwright-core';

const root = resolve('.');
const html = `<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><style>canvas{width:128px;height:128px}</style>
<script type="importmap">{"imports":{"@ferrum2d/ferrum-web/core":"/packages/ferrum-web/dist/core.js","@ferrum2d/ferrum-web/authoring":"/packages/ferrum-web/dist/authoring.js"}}</script>
<canvas></canvas><script type="module" src="/tests/smoke/asset-loading-browser-page.mjs"></script>`;
const assets = new Map(await Promise.all(['player.png', 'enemy.png', 'hit.wav'].map(async name =>
  [name, await readFile(`examples/topdown-shooter/public/assets/${name}`)])));
const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end(html); return; }
    if (url.pathname.startsWith('/asset/')) {
      const name = url.pathname.slice('/asset/'.length);
      const send = () => {
        if (response.destroyed) return;
        response.setHeader('Cache-Control', 'no-store');
        if (name === 'fail.json') { response.writeHead(500).end('expected failure'); return; }
        if (name === 'config.json') { response.setHeader('Content-Type', 'application/json'); response.end('{"ok":true}'); return; }
        if (!assets.has(name)) { response.writeHead(404).end(); return; }
        response.setHeader('Content-Type', name.endsWith('.png') ? 'image/png' : 'audio/wav');
        response.end(assets.get(name));
      };
      const timer = setTimeout(send, Math.min(500, Math.max(0, Number(url.searchParams.get('delay')) || 0)));
      response.once('close', () => clearTimeout(timer));
      return;
    }
    const file = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(root + sep) || !/\.(m?js|wasm)$/.test(file)) { response.writeHead(403).end(); return; }
    const data = await readFile(file);
    response.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'application/javascript'); response.end(data);
  })().catch(() => response.writeHead(404).end());
});
let browser;
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const options = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] };
  browser = process.env.FERRUM_BROWSER_EXECUTABLE
    ? await chromium.launch({ ...options, executablePath: process.env.FERRUM_BROWSER_EXECUTABLE })
    : await chromium.launch(options);
  const results = [];
  for (const deviceScaleFactor of [1, 2]) {
    const page = await browser.newPage({ deviceScaleFactor });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error' && !message.text().includes('500 (Internal Server Error)')) errors.push(message.text());
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => globalThis.assetLoadingSmoke !== undefined, undefined, { timeout: 45000 });
    const result = await page.evaluate(() => globalThis.assetLoadingSmoke);
    if (result.status !== 'passed' || result.error || errors.length || result.networkPeak !== 2 || result.renderCommands !== 2
      || !result.cancelled || !result.retried || !result.failedBatchCancelled || !result.preloadCancelled || !result.engineDestroyCancelled
      || result.finalTextureCount !== 0 || !(result.coloredPixels > 100)) throw new Error(JSON.stringify({ result, errors }));
    results.push({ deviceScaleFactor, ...result }); await page.close();
  }
  const report = { status: 'passed', browser: browser.version(), results };
  await mkdir('artifacts/asset-loading', { recursive: true });
  await writeFile('artifacts/asset-loading/report.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
