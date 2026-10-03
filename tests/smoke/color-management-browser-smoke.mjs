#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { chromium } from "playwright-core";

const root = resolve(".");
const html = `<!doctype html><html><head><meta charset="utf-8">
<style>canvas { width: 128px; height: 128px; }</style>
<script type="importmap">{"imports":{"@ferrum2d/ferrum-web/core":"/packages/ferrum-web/dist/core.js","@ferrum2d/ferrum-web/authoring":"/packages/ferrum-web/dist/authoring.js"}}</script>
</head><body><canvas id="game"></canvas>
<script type="module" src="/tests/smoke/color-management-browser-page.mjs"></script></body></html>`;
const server = createServer((request, response) => {
  void (async () => {
    const path = new URL(request.url, "http://localhost").pathname;
    if (path === "/") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(html);
      return;
    }
    const file = resolve(root, `.${decodeURIComponent(path)}`);
    if (!file.startsWith(`${root}${sep}`) || !/\.(?:m?js|wasm)$/.test(file)) {
      response.writeHead(403).end();
      return;
    }
    const data = await readFile(file);
    response.setHeader("Content-Type", file.endsWith(".wasm") ? "application/wasm" : "application/javascript");
    response.end(data);
  })().catch(() => response.writeHead(404).end());
});
let browser;
try {
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  const options = { headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] };
  if (process.env.FERRUM_BROWSER_EXECUTABLE) {
    browser = await chromium.launch({ ...options, executablePath: process.env.FERRUM_BROWSER_EXECUTABLE });
  } else {
    try {
      browser = await chromium.launch({ ...options, channel: process.env.FERRUM_BROWSER_CHANNEL ?? "chrome" });
    } catch (error) {
      if (process.env.FERRUM_BROWSER_CHANNEL) throw error;
      browser = await chromium.launch(options);
    }
  }
  for (const deviceScaleFactor of [1, 2]) {
    const page = await browser.newPage({ deviceScaleFactor });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => globalThis.colorManagementSmoke !== undefined, undefined, { timeout: 15_000 });
    const report = await page.evaluate(() => globalThis.colorManagementSmoke);
    if (report.error || errors.length) throw new Error(JSON.stringify({ report, errors }));
    if (report.status !== "passed" || report.cases < 49 || report.runtimeColors?.length !== 15 || report.dataSceneState !== "playing"
      || report.floatsPerCommand !== 15 || report.reports.length !== 2
      || report.reports.some((entry) => entry.commandCount !== 1024 || !Number.isFinite(entry.cpuSubmitP95Ms))) {
      throw new Error(`Invalid color management smoke report: ${JSON.stringify(report)}`);
    }
    console.log(JSON.stringify({ deviceScaleFactor, ...report }));
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
