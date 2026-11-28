#!/usr/bin/env node
// Browser check of the two Studio distributions: the product build (installed desktop Studio)
// starts a new 2D scene without examples, and the web demo build keeps the bundled examples.
// Usage: node tests/smoke/studio-build-variants-smoke.mjs [product-dist] [demo-dist]
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { chromium } from "playwright-core";
import { smokePlacementDemoDefault, smokePlacementProductionDefault } from "./placement-production-default-smoke.mjs";
import { prepareStudioDemoBuild } from "./placement-test-build.mjs";

const TYPES = { ".html": "text/html", ".js": "application/javascript", ".wasm": "application/wasm", ".json": "application/json",
  ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".glb": "model/gltf-binary", ".wav": "audio/wav" };
const timeoutMs = 60_000;
const product = path.resolve(process.argv[2] ?? "apps/studio/dist");
const demo = process.argv[3] ? path.resolve(process.argv[3]) : await prepareStudioDemoBuild();

async function serve(root) {
  const server = createServer((request, response) => {
    void (async () => {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
      const file = path.resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
      if (!file.startsWith(root + path.sep) || !(await stat(file)).isFile()) throw new Error("not found");
      response.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
      createReadStream(file).pipe(response);
    })().catch(() => { if (!response.headersSent) response.writeHead(404).end(); });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function launch() {
  const options = { headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] };
  if (process.env.FERRUM_BROWSER_EXECUTABLE) return chromium.launch({ ...options, executablePath: process.env.FERRUM_BROWSER_EXECUTABLE });
  try { return await chromium.launch({ ...options, channel: process.env.FERRUM_BROWSER_CHANNEL ?? "chrome" }); }
  catch { return chromium.launch({ ...options, channel: "chromium" }); }
}

const browser = await launch();
const report = {};
try {
  for (const [name, root, check] of [["product", product, smokePlacementProductionDefault], ["demo", demo, smokePlacementDemoDefault]]) {
    const { server, origin } = await serve(root);
    try { report[name] = await check(browser, origin, timeoutMs); }
    finally { await new Promise(resolve => server.close(resolve)); }
  }
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
