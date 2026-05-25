#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { chromium } from "playwright-core";

const DEFAULT_DIST_DIR = "examples/minimal-game/dist";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MODE = "render";
const TOPDOWN_EFFECTS_MODE = "topdown-effects";
const BREAKOUT_EFFECTS_MODE = "breakout-effects";
const PLATFORMER_EFFECTS_MODE = "platformer-effects";
const PHYSICS_SANDBOX_MODE = "physics-sandbox";
const PHYSICS_DEMO_SUITE_MODE = "physics-demo-suite";
const PHYSICS_DEMO_SUITE = [
  "sandbox",
  "joint-playground",
  "projectile-ccd",
  "platformer-physics",
  "compound-collider",
  "weld-joint",
];
const TOPDOWN_EFFECT_SMOKE_SPEC = {
  world: { width: 800, height: 480 },
  player: { speed: 180 },
  enemies: {
    speed: 1,
    spawnInterval: 0.05,
    behavior: "static",
    spawnPattern: "edge",
    health: 4,
    scoreReward: 1,
    waves: [{ duration: 4, spawnInterval: 0.05, enemyCount: 1, spawnPattern: "edge" }],
  },
  weapons: { bulletSpeed: 900, cooldown: 0.5, lifetime: 2, damage: 1 },
  prefabs: {
    player: { width: 32, height: 32 },
    enemy: { width: 120, height: 120 },
    bullet: { width: 48, height: 48 },
  },
  camera: { preset: "follow" },
};
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

const options = parseArgs(process.argv.slice(2));
const distDir = resolve(options.distDir);
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

  const url = browserSmokeUrl(address.port, options.mode);
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
  await waitForRuntime(page, timeoutMs);
  const modeReport = await smokeByMode(page, options.mode, timeoutMs);

  if (browserErrors.length > 0) {
    throw new Error(`browser console/page errors:\n${browserErrors.join("\n")}`);
  }

  const report = { ...(await page.evaluate(canvasReport)), ...modeReport, mode: options.mode };
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

function parseArgs(args) {
  let mode = DEFAULT_MODE;
  let distDir = DEFAULT_DIST_DIR;
  for (const arg of args) {
    if (arg.startsWith("--mode=")) {
      mode = arg.slice("--mode=".length);
      continue;
    }
    if (arg === "--topdown-effects") {
      mode = TOPDOWN_EFFECTS_MODE;
      continue;
    }
    if (arg === "--breakout-effects") {
      mode = BREAKOUT_EFFECTS_MODE;
      continue;
    }
    if (arg === "--platformer-effects") {
      mode = PLATFORMER_EFFECTS_MODE;
      continue;
    }
    distDir = arg;
  }
  if (![
    DEFAULT_MODE,
    TOPDOWN_EFFECTS_MODE,
    BREAKOUT_EFFECTS_MODE,
    PLATFORMER_EFFECTS_MODE,
    PHYSICS_SANDBOX_MODE,
    PHYSICS_DEMO_SUITE_MODE,
  ].includes(mode)) {
    throw new Error(`unsupported browser smoke mode: ${mode}`);
  }
  return { mode, distDir };
}

function browserSmokeUrl(port, mode) {
  const params = new URLSearchParams({ preserveDrawingBuffer: "true" });
  if (mode !== DEFAULT_MODE) {
    params.set("debug", "false");
  }
  if (mode === TOPDOWN_EFFECTS_MODE) {
    params.set("effectSmoke", "true");
  }
  if (mode === PHYSICS_SANDBOX_MODE || mode === PHYSICS_DEMO_SUITE_MODE) {
    params.set("demo", "sandbox");
    params.set("physicsDebugLines", "true");
  }
  return `http://${DEFAULT_HOST}:${port}/?${params.toString()}`;
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

async function waitForRuntime(page, timeoutMs) {
  await waitForPageFunction(
    page,
    "runtime global was not exposed",
    () => Boolean(globalThis.ferrumRuntime?.engine ?? globalThis.ferrumEngine),
    timeoutMs,
  );
}

async function waitForPageFunction(page, description, predicate, timeoutMs, arg = null) {
  try {
    await page.waitForFunction(predicate, arg, { timeout: timeoutMs });
  } catch (error) {
    throw new Error(`${description}: ${describeError(error)}`);
  }
}


async function smokeByMode(page, mode, timeoutMs) {
  switch (mode) {
    case TOPDOWN_EFFECTS_MODE:
      return await smokeTopdownEffects(page, timeoutMs);
    case BREAKOUT_EFFECTS_MODE:
      return await smokeSceneParticleEffect(page, timeoutMs, {
        description: "Breakout brick hit particle burst",
        seed: 23,
        minimumRenderCommandDelta: 1,
      });
    case PLATFORMER_EFFECTS_MODE:
      return await smokeSceneParticleEffect(page, timeoutMs, {
        description: "Platformer landing dust particle burst",
        seed: 31,
        minimumRenderCommandDelta: 1,
      });
    case PHYSICS_SANDBOX_MODE:
      return await smokePhysicsSandbox(page, timeoutMs, "sandbox");
    case PHYSICS_DEMO_SUITE_MODE:
      return await smokePhysicsDemoSuite(page, timeoutMs);
    default:
      return await smokeDefaultRender(page, timeoutMs);
  }
}

async function smokeDefaultRender(page, timeoutMs) {
  await waitForPageFunction(page, "green placeholder pixels were not rendered", hasRenderedGreenPixels, timeoutMs);
  return {};
}

async function smokeTopdownEffects(page, timeoutMs) {
  await page.evaluate((spec) => {
    const engine = globalThis.ferrumEngine;
    if (!engine) {
      throw new Error("Top-down effect smoke requires window.ferrumEngine.");
    }
    globalThis.ferrumTopdownSmokeFrame = undefined;
    engine.setGameSpec(spec);
    engine.clearParticles();
    engine.setParticleSeed(13);
    engine.resetGame();
  }, TOPDOWN_EFFECT_SMOKE_SPEC);

  await page.evaluate(() => {
    if (globalThis.ferrumTopdownSmokeStart) {
      globalThis.ferrumTopdownSmokeStart();
      return;
    }
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Enter", key: "Enter", bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "Enter", key: "Enter", bubbles: true }));
  });
  await waitForPageFunction(
    page,
    "Top-down Shooter did not enter Playing state",
    () => globalThis.ferrumEngine?.gameState?.() === 1,
    timeoutMs,
  );
  await waitForPageFunction(
    page,
    "Top-down Shooter did not spawn the smoke enemy",
    () => (globalThis.ferrumEngine?.entityCount?.() ?? 0) >= 2,
    timeoutMs,
  );

  await page.evaluate(() => {
    if (globalThis.ferrumTopdownSmokeFireAt) {
      globalThis.ferrumTopdownSmokeFireAt(1, 1);
      return;
    }
    const canvas = document.querySelector("canvas");
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error("Top-down effect smoke could not locate a canvas.");
    }
    const eventInit = { clientX: canvas.getBoundingClientRect().left + 1, clientY: canvas.getBoundingClientRect().top + 1, button: 0, bubbles: true };
    canvas.dispatchEvent(new MouseEvent("mousemove", eventInit));
    canvas.dispatchEvent(new MouseEvent("mousedown", eventInit));
    window.dispatchEvent(new MouseEvent("mouseup", eventInit));
  });

  await waitForPageFunction(
    page,
    "Top-down Shooter effect smoke did not observe both particle burst and enemy tint flash",
    topdownEffectsObserved,
    timeoutMs,
  );
  return await page.evaluate(() => ({
    effectSmoke: globalThis.ferrumTopdownSmokeFrame,
    entityCountAfterEffect: globalThis.ferrumEngine?.entityCount?.() ?? 0,
    particleCountAfterEffect: globalThis.ferrumEngine?.particleCount?.() ?? 0,
  }));
}


async function smokeSceneParticleEffect(page, timeoutMs, options) {
  await page.evaluate((seed) => {
    const engine = globalThis.ferrumEngine ?? globalThis.ferrumRuntime?.engine;
    if (!engine) {
      throw new Error("Scene effect smoke requires a Ferrum engine runtime.");
    }
    engine.clearParticles();
    engine.setParticleSeed(seed);
    engine.resetGame();
  }, options.seed);

  await waitForPageFunction(
    page,
    `${options.description} was not observed`,
    (minimumRenderCommandDelta) => {
      const runtime = globalThis.ferrumRuntime;
      const engine = globalThis.ferrumEngine ?? runtime?.engine;
      if (!engine || !runtime?.renderer) {
        return false;
      }
      const particleCount = engine.particleCount?.() ?? 0;
      const renderCommandCount = runtime.renderer.stats?.().renderCommandCount ?? engine.spriteCount?.() ?? 0;
      const entityCount = engine.entityCount?.() ?? 0;
      return engine.gameState?.() === 1
        && particleCount > 0
        && renderCommandCount >= entityCount + minimumRenderCommandDelta;
    },
    timeoutMs,
    options.minimumRenderCommandDelta,
  );

  return await page.evaluate(() => {
    const runtime = globalThis.ferrumRuntime;
    const engine = globalThis.ferrumEngine ?? runtime?.engine;
    return {
      effectSmoke: {
        particleCount: engine?.particleCount?.() ?? 0,
        renderCommandCount: runtime?.renderer?.stats?.().renderCommandCount ?? engine?.spriteCount?.() ?? 0,
        entityCount: engine?.entityCount?.() ?? 0,
        gameState: engine?.gameState?.() ?? -1,
      },
    };
  });
}

async function smokePhysicsSandbox(page, timeoutMs, demoId) {
  await page.evaluate(async (id) => {
    if (globalThis.ferrumPhysicsSandboxLoadDemo) {
      await globalThis.ferrumPhysicsSandboxLoadDemo(id);
    }
  }, demoId);

  await waitForPageFunction(
    page,
    `Physics sandbox did not render debug lines for ${demoId}`,
    (expectedDemoId) => {
      const frame = globalThis.ferrumPhysicsSandboxSmokeFrame;
      return Boolean(
        frame
        && frame.demoId === expectedDemoId
        && frame.bodyCount >= 2
        && frame.physicsDebugLineCount > 0
        && frame.frameCount > 1,
      );
    },
    timeoutMs,
    demoId,
  );

  return await page.evaluate(() => ({
    physicsSandbox: globalThis.ferrumPhysicsSandboxSmokeFrame,
  }));
}

async function smokePhysicsDemoSuite(page, timeoutMs) {
  const reports = [];
  for (const demoId of PHYSICS_DEMO_SUITE) {
    const report = await smokePhysicsSandbox(page, timeoutMs, demoId);
    reports.push(report.physicsSandbox);
  }
  return { physicsDemoSuite: reports };
}

function topdownEffectsObserved() {
  const frame = globalThis.ferrumTopdownSmokeFrame;
  return Boolean(
    frame
    && frame.maxEnemyFlashCommandCount > 0
    && frame.maxParticleCount > 0
    && frame.renderCommandCount > 0
    && globalThis.ferrumEngine?.gameState?.() === 1,
  );
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
        warmPixelCount: 0,
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
    let warmPixelCount = 0;
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
      if (red > 160 && green > 80 && blue < 120 && alpha > 160) {
        warmPixelCount += 1;
      }
    }

    const runtime = globalThis.ferrumRuntime;
    return {
      width,
      height,
      greenPixelCount,
      warmPixelCount,
      nonTransparentPixelCount,
      renderCommandCount: runtime?.renderer?.stats?.().renderCommandCount ?? runtime?.engine?.spriteCount?.() ?? globalThis.ferrumEngine?.spriteCount?.() ?? 0,
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
  let warmPixelCount = 0;
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
    if (red > 160 && green > 80 && blue < 120 && alpha > 160) {
      warmPixelCount += 1;
    }
  }

  const runtime = globalThis.ferrumRuntime;
  return {
    width,
    height,
    greenPixelCount,
    warmPixelCount,
    nonTransparentPixelCount,
    renderCommandCount: runtime?.renderer?.stats?.().renderCommandCount ?? runtime?.engine?.spriteCount?.() ?? globalThis.ferrumEngine?.spriteCount?.() ?? 0,
    entityCount: runtime?.engine?.entityCount?.() ?? 0,
    gameState: runtime?.engine?.gameState?.() ?? -1,
  };

  function emptyReport(width = 0, height = 0) {
    return {
      width,
      height,
      greenPixelCount: 0,
      warmPixelCount: 0,
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
