#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { deflateSync } from "node:zlib";
import { chromium } from "playwright-core";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_TIMEOUT_MS = 15_000;
const ROOT = resolve(".");
const COMMAND_COUNT = 256;

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "application/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".wasm", "application/wasm"],
]);

const CRC_TABLE = createCrcTable();
const PNG_ASSETS = new Map([
  ["/assets/streaming-local-a.png", createPng(4, 4, [56, 130, 246, 255])],
  ["/assets/streaming-local-b.png", createPng(4, 4, [215, 70, 190, 255])],
  ["/assets/streaming-shared.png", createPng(4, 4, [35, 190, 110, 255])],
]);

const SMOKE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Ferrum2D level streaming browser smoke</title>
    <style>
      html,
      body {
        margin: 0;
        width: 100%;
        height: 100%;
        background: #05070a;
      }

      #game {
        display: block;
        width: 320px;
        height: 180px;
      }
    </style>
  </head>
  <body>
    <canvas id="game"></canvas>
    <script type="module" src="/tests/smoke/level-streaming-browser-page.mjs"></script>
  </body>
</html>`;

async function main() {
  const smokeServer = await serveSmoke();
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage({
      viewport: { width: 640, height: 360 },
      deviceScaleFactor: 1,
    });
    const browserErrors = [];
    page.on("pageerror", (error) => {
      browserErrors.push(formatError(error));
    });
    page.on("console", (message) => {
      if (message.type() === "error") {
        browserErrors.push(message.text());
      }
    });

    await page.goto(`http://${DEFAULT_HOST}:${smokeServer.port}/`, {
      waitUntil: "load",
      timeout: DEFAULT_TIMEOUT_MS,
    });
    await page.waitForFunction(
      () => Boolean(globalThis.ferrumLevelStreamingBrowserSmoke
        || globalThis.ferrumLevelStreamingBrowserSmokeError),
      undefined,
      { timeout: DEFAULT_TIMEOUT_MS },
    );

    const result = await page.evaluate(() => ({
      report: globalThis.ferrumLevelStreamingBrowserSmoke ?? null,
      error: globalThis.ferrumLevelStreamingBrowserSmokeError ?? null,
    }));

    if (result.error !== null) {
      throw new Error(`level streaming browser page failed: ${result.error.message ?? result.error}`);
    }
    if (browserErrors.length > 0) {
      throw new Error(`browser emitted errors:\n${browserErrors.join("\n")}`);
    }

    validateReport(result.report);
    console.log("level streaming browser smoke ok");
    console.log(JSON.stringify({
      format: "ferrum2d.level-streaming-browser-smoke.report",
      report: result.report,
    }, null, 2));
  } finally {
    await browser?.close();
    await smokeServer.close();
  }
}

async function serveSmoke() {
  const server = createServer((request, response) => {
    void handleRequest(request, response).catch((error) => {
      if (!response.headersSent) {
        response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      }
      response.end(formatError(error));
    });
  });

  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, DEFAULT_HOST, () => {
      server.off("error", rejectPromise);
      resolvePromise();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("level streaming browser smoke server did not bind to a TCP port.");
  }

  return {
    port: address.port,
    close: () => new Promise((resolvePromise, rejectPromise) => {
      server.close((error) => {
        if (error) {
          rejectPromise(error);
          return;
        }
        resolvePromise();
      });
    }),
  };
}

async function handleRequest(request, response) {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? DEFAULT_HOST}`);
  const pathname = requestUrl.pathname;

  if (pathname === "/" || pathname === "/index.html") {
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
    });
    response.end(SMOKE_HTML);
    return;
  }

  if (pathname === "/favicon.ico") {
    response.writeHead(204);
    response.end();
    return;
  }

  const png = PNG_ASSETS.get(pathname);
  if (png !== undefined) {
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Length": png.byteLength,
      "Content-Type": "image/png",
    });
    response.end(png);
    return;
  }

  const filePath = resolveStaticPath(pathname);
  if (filePath === undefined) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  const fileStat = await stat(filePath).catch(() => undefined);
  if (fileStat === undefined || !fileStat.isFile()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Length": fileStat.size,
    "Content-Type": MIME_TYPES.get(extname(filePath)) ?? "application/octet-stream",
  });
  createReadStream(filePath).pipe(response);
}

function resolveStaticPath(pathname) {
  const relativePath = decodeURIComponent(pathname).replace(/^\/+/, "");
  const filePath = resolve(ROOT, relativePath);
  if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${sep}`)) {
    return undefined;
  }
  return filePath;
}

async function launchBrowser() {
  const launchOptions = {
    headless: true,
    args: [
      "--disable-dev-shm-usage",
      "--enable-precise-memory-info",
      "--no-sandbox",
    ],
  };
  const executablePath = process.env.FERRUM_BROWSER_EXECUTABLE;
  if (executablePath) {
    return await chromium.launch({ ...launchOptions, executablePath });
  }

  const channel = process.env.FERRUM_BROWSER_CHANNEL ?? "chrome";
  try {
    return await chromium.launch({ ...launchOptions, channel });
  } catch (error) {
    if (process.env.FERRUM_BROWSER_CHANNEL) {
      throw error;
    }
    return await chromium.launch(launchOptions);
  }
}

function validateReport(report) {
  const errors = [];
  const firstFrameStats = report?.firstFrame?.stats;
  const secondFrameStats = report?.secondFrame?.stats;
  const textureIds = report?.textureIds;

  if (firstFrameStats?.renderCommandCount !== COMMAND_COUNT) {
    errors.push(`first frame command count mismatch: ${firstFrameStats?.renderCommandCount}`);
  }
  if (secondFrameStats?.renderCommandCount !== COMMAND_COUNT) {
    errors.push(`second frame command count mismatch: ${secondFrameStats?.renderCommandCount}`);
  }
  if (secondFrameStats?.drawCalls !== 2) {
    errors.push(`second frame draw call mismatch: ${secondFrameStats?.drawCalls}`);
  }
  if (secondFrameStats?.textureSwitchCount !== 1) {
    errors.push(`second frame texture switch mismatch: ${secondFrameStats?.textureSwitchCount}`);
  }
  if (report?.profilerSnapshot?.budgetReport?.passed !== true) {
    errors.push(`runtime budget failed: ${JSON.stringify(report?.profilerSnapshot?.budgetReport?.violations ?? [])}`);
  }
  if (report?.targetLoads?.join(",") !== "0,0,1,0") {
    errors.push(`target loads mismatch: ${report?.targetLoads?.join(",")}`);
  }
  if (report?.targetUnloads?.join(",") !== "0,0") {
    errors.push(`target unloads mismatch: ${report?.targetUnloads?.join(",")}`);
  }
  if (!report?.evictedTextureIds?.includes(textureIds?.terrainLocal)) {
    errors.push("old local texture was not evicted");
  }
  if (report?.evictedTextureIds?.includes(textureIds?.terrainShared)) {
    errors.push("shared texture was evicted");
  }
  if ((report?.pixelSummary?.greenPixelCount ?? 0) < 256) {
    errors.push(`green pixel count too low: ${report?.pixelSummary?.greenPixelCount}`);
  }
  if ((report?.pixelSummary?.magentaPixelCount ?? 0) < 256) {
    errors.push(`magenta pixel count too low: ${report?.pixelSummary?.magentaPixelCount}`);
  }

  if (errors.length > 0) {
    throw new Error(`level streaming browser smoke failed:\n${errors.join("\n")}`);
  }
}

function createPng(width, height, rgba) {
  const rowByteLength = width * 4 + 1;
  const raw = Buffer.alloc(rowByteLength * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * rowByteLength;
    raw[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixelOffset = rowOffset + 1 + x * 4;
      raw[pixelOffset] = rgba[0];
      raw[pixelOffset + 1] = rgba[1];
      raw[pixelOffset + 2] = rgba[2];
      raw[pixelOffset + 3] = rgba[3];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND"),
  ]);
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function createCrcTable() {
  const table = new Uint32Array(256);
  for (let i = 0; i < table.length; i += 1) {
    let crc = i;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[i] = crc >>> 0;
  }
  return table;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function formatError(error) {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

await main();
