#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve, relative, dirname, sep } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const root = resolve(".");
const packageRootArgument = process.argv.find((arg) => arg.startsWith("--package-root="));
const packageRoot = packageRootArgument ? resolve(packageRootArgument.slice("--package-root=".length)) : resolve(root, "packages/ferrum-web");
let html = `<!doctype html><html><head><meta charset="utf-8">
<style>canvas { width: 128px; height: 128px; }</style>
<script type="importmap">{"imports":{"@ferrum2d/ferrum-web/core":"/packages/ferrum-web/dist/core.js","@ferrum2d/ferrum-web/authoring":"/packages/ferrum-web/dist/authoring.js"}}</script>
</head><body><canvas id="game"></canvas>
<script type="module" src="/tests/smoke/ktx2-browser-page.mjs"></script></body></html>`;
let bundleDirectory;
let bundleOutput;
if (process.argv.includes("--bundled")) {
  const cache = resolve(root, "node_modules/.cache");
  await mkdir(cache, { recursive: true });
  bundleDirectory = await mkdtemp(resolve(cache, "ktx2-smoke-"));
  bundleOutput = resolve(bundleDirectory, "dist");
  const script = relative(bundleDirectory, resolve(root, "tests/smoke/ktx2-browser-page.mjs"));
  await writeFile(resolve(bundleDirectory, "index.html"), html.replace(/<script type="importmap">.*?<\/script>/s, "").replace('/tests/smoke/ktx2-browser-page.mjs', script));
  const require = createRequire(resolve(root, "examples/minimal-game/package.json"));
  const { build } = await import(pathToFileURL(resolve(dirname(require.resolve("vite/package.json")), "dist/node/index.js")).href);
  await build({ configFile: false, root: bundleDirectory, logLevel: "error", resolve: { alias: {
    "@ferrum2d/ferrum-web/core": resolve(packageRoot, "dist/core.js"),
    "@ferrum2d/ferrum-web/authoring": resolve(packageRoot, "dist/authoring.js"),
  } }, build: { outDir: bundleOutput, emptyOutDir: true } });
  html = await readFile(resolve(bundleOutput, "index.html"), "utf8");
}
const server = createServer((request, response) => {
  void (async () => {
    const path = new URL(request.url, "http://localhost").pathname;
    if (path === "/") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(html);
      return;
    }
    const servingRoot = bundleOutput && path.startsWith("/assets/") ? bundleOutput : root;
    const file = resolve(servingRoot, `.${decodeURIComponent(path)}`);
    if (!file.startsWith(`${root}${sep}`) || !/\.(?:m?js|wasm|png|ktx2)$/.test(file)) {
      response.writeHead(403).end();
      return;
    }
    const data = await readFile(file);
    response.setHeader("Content-Type", file.endsWith(".wasm") ? "application/wasm" : file.endsWith(".png") ? "image/png" : file.endsWith(".ktx2") ? "image/ktx2" : "application/javascript");
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
    await page.waitForFunction(() => globalThis.ktx2Smoke !== undefined, undefined, { timeout: 45_000 });
    const report = await page.evaluate(() => globalThis.ktx2Smoke);
    if (report.error || errors.length) throw new Error(JSON.stringify({ report, errors }));
    if (report.status !== "passed" || report.commandCount !== 1024 || report.reports?.length !== 4
      || report.dataSceneState !== "playing" || report.floatsPerCommand !== 15 || report.liveWorkers !== 0) {
      throw new Error(`Invalid KTX2 smoke report: ${JSON.stringify(report)}`);
    }
    console.log(JSON.stringify({ bundled: Boolean(bundleOutput), deviceScaleFactor, ...report }));
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
  if (bundleDirectory) await rm(bundleDirectory, { recursive: true, force: true });
}
