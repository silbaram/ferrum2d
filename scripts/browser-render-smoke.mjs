#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { chromium } from "playwright-core";

const DEFAULT_DIST_DIR = "examples/minimal-game/dist";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_TIMEOUT_MS = 15_000;
const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".wasm", "application/wasm"],
  [".wav", "audio/wav"],
]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const distDir = resolve(process.argv[2] ?? DEFAULT_DIST_DIR);
const timeoutMs = positiveInteger(process.env.FERRUM_BROWSER_SMOKE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);

let server;
let browser;

try {
  await assertDirectory(distDir);
  server = await serveStatic(distDir);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("browser smoke server did not expose a TCP port");
  }

  const url = `http://${DEFAULT_HOST}:${address.port}/?preserveDrawingBuffer=true`;
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
  const browserErrors = [];
  page.on("pageerror", (error) => {
    browserErrors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(message.text());
    }
  });

  await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
  await page.waitForFunction(() => Boolean(globalThis.ferrumRuntime), null, { timeout: timeoutMs });
  await page.waitForFunction(hasRenderedGreenPixels, null, { timeout: timeoutMs });

  if (browserErrors.length > 0) {
    throw new Error(`browser console/page errors:\n${browserErrors.join("\n")}`);
  }

  const report = await page.evaluate(canvasReport);
  console.log(`${distDir}: browser render smoke ok`);
  console.log(JSON.stringify({ url, ...report }, null, 2));
} catch (error) {
  console.error(`${distDir}: browser render smoke failed`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
  await closeServer(server).catch(() => undefined);
}

async function assertDirectory(path) {
  const info = await stat(path);
  if (!info.isDirectory()) {
    throw new Error(`browser smoke target is not a directory: ${path}`);
  }
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function serveStatic(root) {
  const serverInstance = createServer(async (request, response) => {
    try {
      if (new URL(request.url ?? "/", `http://${DEFAULT_HOST}`).pathname === "/favicon.ico") {
        response.writeHead(204, { "Cache-Control": "no-cache" });
        response.end();
        return;
      }
      const filePath = await resolveRequestPath(root, request.url ?? "/");
      response.writeHead(200, {
        "Cache-Control": "no-cache",
        "Content-Type": MIME_TYPES.get(extname(filePath)) ?? "application/octet-stream",
      });
      createReadStream(filePath).pipe(response);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise((resolveListen, rejectListen) => {
    serverInstance.once("error", rejectListen);
    serverInstance.listen(0, DEFAULT_HOST, () => {
      serverInstance.off("error", rejectListen);
      resolveListen();
    });
  });

  return serverInstance;
}

async function resolveRequestPath(root, rawUrl) {
  const requestUrl = new URL(rawUrl, `http://${DEFAULT_HOST}`);
  const pathname = decodeURIComponent(requestUrl.pathname);
  const requestedPath = resolve(root, `.${pathname}`);
  if (requestedPath !== root && !requestedPath.startsWith(`${root}${sep}`)) {
    throw new HttpError(403, "Forbidden");
  }

  let info;
  try {
    info = await stat(requestedPath);
  } catch {
    throw new HttpError(404, "Not found");
  }

  if (info.isDirectory()) {
    return resolveRequestPath(root, join(pathname, "index.html"));
  }
  return requestedPath;
}

async function launchBrowser() {
  const launchOptions = {
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  };
  if (process.env.FERRUM_BROWSER_EXECUTABLE) {
    return await chromium.launch({
      ...launchOptions,
      executablePath: process.env.FERRUM_BROWSER_EXECUTABLE,
    });
  }

  const channel = process.env.FERRUM_BROWSER_CHANNEL ?? "chrome";
  try {
    return await chromium.launch({ ...launchOptions, channel });
  } catch (channelError) {
    try {
      return await chromium.launch(launchOptions);
    } catch (bundledError) {
      throw new Error(
        `Unable to launch a browser for render smoke. Set FERRUM_BROWSER_CHANNEL or FERRUM_BROWSER_EXECUTABLE. ` +
          `channel error: ${describeError(channelError)} bundled error: ${describeError(bundledError)}`,
      );
    }
  }
}

function hasRenderedGreenPixels() {
  const report = readReport();
  return report.width > 0 && report.height > 0 && report.greenPixelCount > 25 && report.renderCommandCount > 0;

  function readReport() {
    function emptyReport(width = 0, height = 0) {
      return {
        width,
        height,
        greenPixelCount: 0,
        nonTransparentPixelCount: 0,
        renderCommandCount: 0,
        entityCount: 0,
        gameState: -1,
      };
    }

    const canvas = document.querySelector("canvas");
    if (!(canvas instanceof HTMLCanvasElement)) {
      return emptyReport();
    }

    const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true });
    if (!gl) {
      return emptyReport(canvas.width, canvas.height);
    }

    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    let greenPixelCount = 0;
    let nonTransparentPixelCount = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const alpha = pixels[index + 3];
      if (alpha > 0) {
        nonTransparentPixelCount += 1;
      }
      if (green > 110 && red < 120 && blue < 170 && alpha > 200) {
        greenPixelCount += 1;
      }
    }

    const runtime = globalThis.ferrumRuntime;
    return {
      width,
      height,
      greenPixelCount,
      nonTransparentPixelCount,
      renderCommandCount: runtime?.renderer?.stats?.().renderCommandCount ?? 0,
      entityCount: runtime?.engine?.entityCount?.() ?? 0,
      gameState: runtime?.engine?.gameState?.() ?? -1,
    };
  }
}

function canvasReport() {
  const canvas = document.querySelector("canvas");
  if (!(canvas instanceof HTMLCanvasElement)) {
    return emptyReport();
  }

  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true });
  if (!gl) {
    return emptyReport(canvas.width, canvas.height);
  }

  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  let greenPixelCount = 0;
  let nonTransparentPixelCount = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const alpha = pixels[index + 3];
    if (alpha > 0) {
      nonTransparentPixelCount += 1;
    }
    if (green > 110 && red < 120 && blue < 170 && alpha > 200) {
      greenPixelCount += 1;
    }
  }

  const runtime = globalThis.ferrumRuntime;
  return {
    width,
    height,
    greenPixelCount,
    nonTransparentPixelCount,
    renderCommandCount: runtime?.renderer?.stats?.().renderCommandCount ?? 0,
    entityCount: runtime?.engine?.entityCount?.() ?? 0,
    gameState: runtime?.engine?.gameState?.() ?? -1,
  };

  function emptyReport(width = 0, height = 0) {
    return {
      width,
      height,
      greenPixelCount: 0,
      nonTransparentPixelCount: 0,
      renderCommandCount: 0,
      entityCount: 0,
      gameState: -1,
    };
  }
}

function closeServer(serverInstance) {
  if (!serverInstance) {
    return Promise.resolve();
  }
  return new Promise((resolveClose, rejectClose) => {
    serverInstance.close((error) => {
      if (error) {
        rejectClose(error);
      } else {
        resolveClose();
      }
    });
  });
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}
