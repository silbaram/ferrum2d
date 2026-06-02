#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { chromium } from "playwright-core";
import { runtimeBudgetForSmokeMode } from "./runtime-budget-profiles.mjs";

const DEFAULT_DIST_DIR = "examples/starter-runtime/dist";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MODE = "render";
const DEFAULT_SCREENSHOT_ARTIFACT_DIR = "artifacts/browser-smoke-screenshots";
const LIGHTING_MODE = "lighting";
const LIGHTING_WEBGPU_MODE = "lighting-webgpu";
const MATERIAL_MODE = "material";
const MATERIAL_WEBGPU_MODE = "material-webgpu";
const CAMERA_POSTPROCESS_MODE = "camera-postprocess";
const PARTICLE_VFX_MODE = "particle-vfx";
const PRELOAD_MODE = "preload";
const VIRTUAL_CONTROLS_MODE = "virtual-controls";
const TOPDOWN_EFFECTS_MODE = "topdown-effects";
const TOPDOWN_SAVE_LOAD_MODE = "topdown-save-load";
const TOPDOWN_AUTHORED_BEHAVIOR_VARIANT_MODE = "topdown-authored-behavior-variant";
const TOPDOWN_HD2D_MODE = "topdown-hd2d";
const DESTRUCTIBLE_TERRAIN_MODE = "destructible-terrain";
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
const RUNTIME_BUDGET_FIELDS = Object.freeze([
  ["maxFrameTimeMs", "frame time", "maxFrameTimeMs", "ms"],
  ["maxRustUpdateTimeMs", "rust update", "maxRustUpdateTimeMs", "ms"],
  ["maxRenderTimeMs", "render", "maxRenderTimeMs", "ms"],
  ["maxDrawCalls", "draw calls", "maxDrawCalls", "count"],
  ["maxRenderCommandCount", "render commands", "maxRenderCommandCount", "count"],
  ["maxTextureSwitchCount", "texture switches", "maxTextureSwitchCount", "count"],
  ["maxPhysicsFixedSteps", "fixed steps", "maxPhysicsFixedSteps", "count"],
  ["maxPhysicsTileCandidateChecks", "tile checks", "maxPhysicsTileCandidateChecks", "count"],
  ["maxCollisionPairCount", "collision pairs", "maxCollisionPairCount", "count"],
  ["maxAssetLoadElapsedMs", "asset load", "maxAssetLoadElapsedMs", "ms"],
]);
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
const TOPDOWN_HD2D_SMOKE_SPEC = {
  world: { width: 256, height: 128 },
  player: { speed: 120 },
  enemies: {
    speed: 1,
    spawnInterval: 10,
    behavior: "static",
    spawnPattern: "edge",
    health: 2,
    scoreReward: 1,
    waves: [],
  },
  weapons: {
    bulletSpeed: 420,
    cooldown: 0.2,
    lifetime: 1.5,
    damage: 1,
    projectileArc: {
      enabled: true,
      launchHeight: 12,
      zVelocity: 80,
      gravity: 160,
      hitHeight: 4,
    },
  },
  prefabs: {
    player: { width: 24, height: 32 },
    enemy: { width: 24, height: 32 },
    bullet: { width: 8, height: 8 },
  },
  atlas: {
    frames: {
      "hd2d.tile": {
        texture: "bullet",
        uv: { u0: 0, v0: 0, u1: 1, v1: 1 },
        size: { width: 32, height: 32 },
      },
    },
  },
  tilemap: {
    tileWidth: 32,
    tileHeight: 32,
    tiles: {
      "1": {
        frame: "hd2d.tile",
        floor: "ground",
        elevation: 0,
        height: 8,
        kind: "bridge",
        blocksMovement: false,
        blocksProjectile: false,
        blocksVision: true,
        occluderHeight: 16,
        bridgePortal: {
          lowerFloor: "ground",
          upperFloor: "bridge",
          lowerElevation: 0,
          upperElevation: 12,
          navigationCost: 2,
        },
      },
    },
    layers: [
      {
        name: "hd2d-bridge",
        columns: 3,
        rows: 1,
        tileWidth: 32,
        tileHeight: 32,
        collision: true,
        data: [0, 1, 0],
      },
    ],
  },
  physics: {
    hd2d: {
      enabled: true,
      defaultHeight: 8,
      maxStepHeight: 4,
      maxDropHeight: 4,
    },
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

  const url = browserSmokeUrl(address.port, options);
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
  const budgetReport = options.budget
    ? await smokeRuntimeBudget(
        page,
        timeoutMs,
        runtimeBudgetForSmokeMode(options.mode, options.budgetProfile),
      )
    : {};

  if (browserErrors.length > 0) {
    throw new Error(`browser console/page errors:\n${browserErrors.join("\n")}`);
  }

  const screenshotReport = options.screenshot
    ? await captureScreenshotArtifact(page, { mode: options.mode, ...options.screenshot })
    : {};
  const report = {
    ...(await page.evaluate(canvasReport)),
    ...modeReport,
    ...budgetReport,
    ...screenshotReport,
    mode: options.mode,
  };
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
  let budget = false;
  let budgetProfile;
  let screenshot;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("--mode=")) {
      mode = arg.slice("--mode=".length);
      continue;
    }
    if (arg === "--budget") {
      budget = true;
      continue;
    }
    if (arg.startsWith("--budget-profile=")) {
      budgetProfile = arg.slice("--budget-profile=".length);
      continue;
    }
    if (arg === "--screenshot") {
      screenshot ??= { artifactDir: DEFAULT_SCREENSHOT_ARTIFACT_DIR, threshold: {} };
      continue;
    }
    if (arg.startsWith("--screenshot-artifact-dir=")) {
      screenshot ??= { threshold: {} };
      screenshot.artifactDir = arg.slice("--screenshot-artifact-dir=".length);
      continue;
    }
    if (arg === "--screenshot-artifact-dir") {
      screenshot ??= { threshold: {} };
      screenshot.artifactDir = requiredArg(args, ++index, arg);
      continue;
    }
    if (arg.startsWith("--screenshot-name=")) {
      screenshot ??= { threshold: {} };
      screenshot.name = arg.slice("--screenshot-name=".length);
      continue;
    }
    if (arg === "--screenshot-name") {
      screenshot ??= { threshold: {} };
      screenshot.name = requiredArg(args, ++index, arg);
      continue;
    }
    if (arg.startsWith("--screenshot-baseline=")) {
      screenshot ??= { threshold: {} };
      screenshot.baseline = arg.slice("--screenshot-baseline=".length);
      continue;
    }
    if (arg === "--screenshot-baseline") {
      screenshot ??= { threshold: {} };
      screenshot.baseline = requiredArg(args, ++index, arg);
      continue;
    }
    if (arg.startsWith("--screenshot-max-average-delta=")) {
      screenshot ??= { threshold: {} };
      screenshot.threshold.maxAverageColorDelta = numberArg(arg.slice("--screenshot-max-average-delta=".length), arg);
      continue;
    }
    if (arg.startsWith("--screenshot-max-opaque-ratio-delta=")) {
      screenshot ??= { threshold: {} };
      screenshot.threshold.maxOpaqueRatioDelta = numberArg(arg.slice("--screenshot-max-opaque-ratio-delta=".length), arg);
      continue;
    }
    if (arg.startsWith("--screenshot-max-non-transparent-ratio-delta=")) {
      screenshot ??= { threshold: {} };
      screenshot.threshold.maxNonTransparentRatioDelta = numberArg(arg.slice("--screenshot-max-non-transparent-ratio-delta=".length), arg);
      continue;
    }
    if (arg.startsWith("--screenshot-min-non-transparent-ratio=")) {
      screenshot ??= { threshold: {} };
      screenshot.minNonTransparentPixelRatio = numberArg(arg.slice("--screenshot-min-non-transparent-ratio=".length), arg);
      continue;
    }
    if (arg === "--topdown-effects") {
      mode = TOPDOWN_EFFECTS_MODE;
      continue;
    }
    if (arg === "--topdown-hd2d") {
      mode = TOPDOWN_HD2D_MODE;
      continue;
    }
    if (arg === "--breakout-effects") {
      mode = BREAKOUT_EFFECTS_MODE;
      continue;
    }
    if (arg === "--destructible-terrain") {
      mode = DESTRUCTIBLE_TERRAIN_MODE;
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
    LIGHTING_MODE,
    LIGHTING_WEBGPU_MODE,
    MATERIAL_MODE,
    MATERIAL_WEBGPU_MODE,
    CAMERA_POSTPROCESS_MODE,
    PARTICLE_VFX_MODE,
    PRELOAD_MODE,
    VIRTUAL_CONTROLS_MODE,
    TOPDOWN_EFFECTS_MODE,
    TOPDOWN_SAVE_LOAD_MODE,
    TOPDOWN_AUTHORED_BEHAVIOR_VARIANT_MODE,
    TOPDOWN_HD2D_MODE,
    DESTRUCTIBLE_TERRAIN_MODE,
    BREAKOUT_EFFECTS_MODE,
    PLATFORMER_EFFECTS_MODE,
    PHYSICS_SANDBOX_MODE,
    PHYSICS_DEMO_SUITE_MODE,
  ].includes(mode)) {
    throw new Error(`unsupported browser smoke mode: ${mode}`);
  }
  if (screenshot && !screenshot.artifactDir) {
    screenshot.artifactDir = DEFAULT_SCREENSHOT_ARTIFACT_DIR;
  }
  return { mode, distDir, budget, budgetProfile, screenshot };
}

function browserSmokeUrl(port, options) {
  const { mode } = options;
  const params = new URLSearchParams({ preserveDrawingBuffer: "true" });
  if (mode !== DEFAULT_MODE) {
    params.set("debug", "false");
  }
  if (options.budget) {
    params.set("profilerSmoke", "true");
  }
  if (mode === LIGHTING_MODE || mode === LIGHTING_WEBGPU_MODE) {
    params.set("lightingSmoke", "true");
  }
  if (mode === LIGHTING_WEBGPU_MODE) {
    params.set("renderer", "webgpu");
  }
  if (mode === MATERIAL_MODE || mode === MATERIAL_WEBGPU_MODE) {
    params.set("materialSmoke", "true");
  }
  if (mode === MATERIAL_WEBGPU_MODE) {
    params.set("renderer", "webgpu");
  }
  if (mode === CAMERA_POSTPROCESS_MODE) {
    params.set("cameraPostProcessSmoke", "true");
  }
  if (mode === PARTICLE_VFX_MODE) {
    params.set("particleVfxSmoke", "true");
  }
  if (mode === PRELOAD_MODE) {
    params.set("preloadSmoke", "true");
  }
  if (mode === VIRTUAL_CONTROLS_MODE) {
    params.set("virtualControlsSmoke", "true");
  }
  if (mode === TOPDOWN_EFFECTS_MODE) {
    params.set("effectSmoke", "true");
  }
  if (mode === TOPDOWN_SAVE_LOAD_MODE) {
    params.set("effectSmoke", "true");
  }
  if (mode === TOPDOWN_HD2D_MODE) {
    params.set("effectSmoke", "true");
  }
  if (mode === TOPDOWN_AUTHORED_BEHAVIOR_VARIANT_MODE) {
    params.set("authoredBehaviorVariantApply", "true");
  }
  if (mode === DESTRUCTIBLE_TERRAIN_MODE) {
    params.set("destructibleTerrainDemo", "true");
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

function requiredArg(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function numberArg(value, flag) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} requires a finite number`);
  }
  return parsed;
}

async function captureScreenshotArtifact(page, options) {
  const {
    assertScreenshotCaptureSummary,
    compareScreenshotSummaries,
    resolveScreenshotCaptureSpec,
  } = await import("../packages/ferrum-web/dist/screenshotCapture.js");
  const captureSpec = resolveScreenshotCaptureSpec({
    name: options.name ?? `browser-${options.mode ?? "render"}`,
    minNonTransparentPixelRatio: options.minNonTransparentPixelRatio,
    comparison: options.threshold,
  });
  const artifactDir = resolve(options.artifactDir);
  await mkdir(artifactDir, { recursive: true });
  const imagePath = join(artifactDir, `${captureSpec.name}.png`);
  const summaryPath = join(artifactDir, `${captureSpec.name}.summary.json`);

  await page.screenshot({ path: imagePath, fullPage: false });
  const summary = assertScreenshotCaptureSummary(await page.evaluate(canvasScreenshotSummary), captureSpec);
  let comparison;
  if (options.baseline) {
    const baseline = JSON.parse(await readFile(resolve(options.baseline), "utf8"));
    comparison = compareScreenshotSummaries(summary, baseline.summary ?? baseline, captureSpec.comparison);
    if (!comparison.passed) {
      throw new Error(`screenshot comparison failed:\n${JSON.stringify(comparison, null, 2)}`);
    }
  }

  await writeFile(summaryPath, `${JSON.stringify({ summary, comparison }, null, 2)}\n`);
  return {
    screenshotCapture: {
      imagePath,
      summaryPath,
      summary,
      comparison,
    },
  };
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
    case LIGHTING_MODE:
      return await smokeLighting(page, timeoutMs);
    case LIGHTING_WEBGPU_MODE:
      return await smokeLightingWebGpu(page, timeoutMs);
    case MATERIAL_MODE:
      return await smokeMaterial(page, timeoutMs);
    case MATERIAL_WEBGPU_MODE:
      return await smokeMaterialWebGpu(page, timeoutMs);
    case CAMERA_POSTPROCESS_MODE:
      return await smokeCameraPostProcess(page, timeoutMs);
    case PARTICLE_VFX_MODE:
      return await smokeParticleVfx(page, timeoutMs);
    case PRELOAD_MODE:
      return await smokePreload(page, timeoutMs);
    case VIRTUAL_CONTROLS_MODE:
      return await smokeVirtualControls(page, timeoutMs);
    case TOPDOWN_EFFECTS_MODE:
      return await smokeTopdownEffects(page, timeoutMs);
    case TOPDOWN_SAVE_LOAD_MODE:
      return await smokeTopdownSaveLoad(page, timeoutMs);
    case TOPDOWN_AUTHORED_BEHAVIOR_VARIANT_MODE:
      return await smokeTopdownAuthoredBehaviorVariant(page, timeoutMs);
    case TOPDOWN_HD2D_MODE:
      return await smokeTopdownHd2d(page, timeoutMs);
    case DESTRUCTIBLE_TERRAIN_MODE:
      return await smokeDestructibleTerrain(page, timeoutMs);
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

async function smokeCameraPostProcess(page, timeoutMs) {
  await waitForPageFunction(
    page,
    "camera/post-process smoke did not report fullscreen fade pass stats",
    () => {
      const stats = globalThis.ferrumCameraPostProcessSmokeFrame
        ?? globalThis.ferrumRuntime?.renderer?.stats?.();
      return Boolean(
        stats
        && stats.postProcessDrawCalls >= 1
        && stats.postProcessPassCount >= 1
        && stats.drawCalls >= stats.postProcessDrawCalls,
      );
    },
    timeoutMs,
  );
  return await page.evaluate(() => ({
    cameraPostProcessSmoke: {
      frame: globalThis.ferrumCameraPostProcessSmokeFrame,
      rendererStats: globalThis.ferrumRuntime?.renderer?.stats?.(),
    },
  }));
}

async function smokeDefaultRender(page, timeoutMs) {
  await waitForPageFunction(page, "green placeholder pixels were not rendered", hasRenderedGreenPixels, timeoutMs);
  return {};
}

async function smokeRuntimeBudget(page, timeoutMs, budget) {
  await waitForPageFunction(
    page,
    "runtime profiler did not collect frame samples for budget smoke",
    () => (globalThis.ferrumRuntime?.profiler?.snapshot?.().frameSampleCount ?? 0) >= 2,
    timeoutMs,
  );
  const snapshot = await page.evaluate(() => {
    const profiler = globalThis.ferrumRuntime?.profiler;
    if (!profiler) {
      throw new Error("Runtime budget smoke requires window.ferrumRuntime.profiler.");
    }
    profiler.recordAssetProgress?.({
      loaded: 1,
      total: 1,
      elapsedMs: 0,
      kind: "json",
      name: "budget-smoke",
      url: "memory://budget-smoke",
    });
    return profiler.snapshot();
  });
  const report = evaluateRuntimeBudgetSnapshot(snapshot, budget);
  if (!report.passed) {
    throw new Error(`runtime budget smoke failed:\n${JSON.stringify(report.violations, null, 2)}`);
  }
  return {
    runtimeBudget: {
      budget,
      report,
      snapshot,
    },
  };
}

async function smokeLighting(page, timeoutMs) {
  await waitForPageFunction(
    page,
    "lighting pass did not report lights or warm pixels",
    lightingObserved,
    timeoutMs,
  );
  return await page.evaluate(() => ({
    lightingSmoke: {
      rendererStats: globalThis.ferrumRuntime?.renderer?.stats?.(),
    },
  }));
}

async function smokeLightingWebGpu(page, timeoutMs) {
  const initial = await webGpuLightingStatus(page);
  if (!initial.webgpuAvailable || initial.renderer !== "webgpu") {
    return {
      webgpuLightingSmoke: {
        skipped: true,
        reason: initial.webgpuAvailable
          ? "WebGPU renderer was not selected; runtime likely fell back to WebGL2"
          : "WebGPU is not available in this browser",
        renderer: initial.renderer,
        webgpuAvailable: initial.webgpuAvailable,
        rendererStats: initial.rendererStats,
      },
    };
  }

  await waitForPageFunction(
    page,
    "WebGPU lighting pass did not report lighting stats",
    () => {
      const runtime = globalThis.ferrumRuntime;
      const stats = runtime?.renderer?.stats?.();
      return Boolean(
        runtime?.renderer
        && typeof runtime.renderer.gpuDevice === "function"
        && stats
        && stats.lightingDrawCalls >= 2
        && stats.pointLightCount >= 1
        && stats.tileOccluderCount >= 1
        && stats.shadowDrawCalls >= 1
        && stats.shadowCasterCount >= 1
        && stats.renderCommandCount > 0
      );
    },
    timeoutMs,
  );
  const status = await webGpuLightingStatus(page);
  return {
    webgpuLightingSmoke: {
      skipped: false,
      renderer: status.renderer,
      webgpuAvailable: status.webgpuAvailable,
      rendererStats: status.rendererStats,
    },
  };
}

async function smokeMaterial(page, timeoutMs) {
  await waitForPageFunction(
    page,
    "material preset did not add outline sprite passes",
    materialObserved,
    timeoutMs,
  );
  return await page.evaluate(() => ({
    materialSmoke: {
      rendererStats: globalThis.ferrumRuntime?.renderer?.stats?.(),
    },
  }));
}

async function smokeMaterialWebGpu(page, timeoutMs) {
  const initial = await webGpuMaterialStatus(page);
  if (!initial.webgpuAvailable || initial.renderer !== "webgpu") {
    return {
      webgpuMaterialSmoke: {
        skipped: true,
        reason: initial.webgpuAvailable
          ? "WebGPU renderer was not selected; runtime likely fell back to WebGL2"
          : "WebGPU is not available in this browser",
        renderer: initial.renderer,
        webgpuAvailable: initial.webgpuAvailable,
        rendererStats: initial.rendererStats,
      },
    };
  }

  await waitForPageFunction(
    page,
    "WebGPU material preset did not add outline sprite passes",
    () => {
      const renderer = globalThis.ferrumRuntime?.renderer;
      const stats = renderer?.stats?.();
      return Boolean(
        renderer
        && typeof renderer.gpuDevice === "function"
        && stats
        && stats.renderCommandCount > 0
        && stats.drawCalls >= 5,
      );
    },
    timeoutMs,
  );
  const status = await webGpuMaterialStatus(page);
  return {
    webgpuMaterialSmoke: {
      skipped: false,
      renderer: status.renderer,
      webgpuAvailable: status.webgpuAvailable,
      rendererStats: status.rendererStats,
    },
  };
}

async function webGpuMaterialStatus(page) {
  return await page.evaluate(() => {
    const renderer = globalThis.ferrumRuntime?.renderer;
    return {
      webgpuAvailable: Boolean(globalThis.navigator?.gpu),
      renderer: typeof renderer?.gpuDevice === "function" ? "webgpu" : "webgl2",
      rendererStats: renderer?.stats?.(),
    };
  });
}

async function smokeParticleVfx(page, timeoutMs) {
  await waitForPageFunction(
    page,
    "particle VFX trail emitter did not spawn visible particles",
    () => {
      const frame = globalThis.ferrumParticleVfxSmokeFrame;
      return Boolean(
        frame
        && frame.emitter?.mode === "trail"
        && frame.emitter?.emittedBurstCount >= 2
        && frame.emitter?.spawnedParticleCount >= 4
        && frame.particleCount > 0
        && frame.renderCommandCount > 1,
      );
    },
    timeoutMs,
  );
  return await page.evaluate(() => ({
    particleVfxSmoke: globalThis.ferrumParticleVfxSmokeFrame,
  }));
}

async function webGpuLightingStatus(page) {
  return await page.evaluate(() => {
    const renderer = globalThis.ferrumRuntime?.renderer;
    return {
      webgpuAvailable: Boolean(globalThis.navigator?.gpu),
      renderer: typeof renderer?.gpuDevice === "function" ? "webgpu" : "webgl2",
      rendererStats: renderer?.stats?.(),
    };
  });
}

async function smokePreload(page, timeoutMs) {
  await waitForPageFunction(
    page,
    "asset preload smoke did not expose a completed loading overlay report",
    () => {
      const report = globalThis.ferrumAssetPreloadSmoke;
      return Boolean(
        report
        && report.overlay?.status === "complete"
        && report.overlay?.progress?.ratio === 1
        && report.first?.fetched === report.first?.total
        && (!report.cacheSupported || report.second?.cached === report.second?.total),
      );
    },
    timeoutMs,
  );
  return await page.evaluate(() => ({
    assetPreloadSmoke: globalThis.ferrumAssetPreloadSmoke,
  }));
}

async function smokeVirtualControls(page, timeoutMs) {
  await page.evaluate(() => {
    const controls = globalThis.ferrumVirtualControls;
    if (!controls) {
      throw new Error("Virtual controls smoke requires window.ferrumVirtualControls.");
    }
    controls.setJoystickVector(1, -1);
    controls.setButtonPressed("primary", true);
  });
  await waitForPageFunction(
    page,
    "virtual controls did not map joystick/button state into runtime input",
    () => {
      const input = globalThis.ferrumVirtualControlsSmokeFrame?.input;
      return Boolean(input?.w && input?.d && input?.space && input?.mouseLeft);
    },
    timeoutMs,
  );

  const pressed = await page.evaluate(() => ({
    input: globalThis.ferrumVirtualControlsSmokeFrame?.input,
    state: globalThis.ferrumVirtualControls?.state?.(),
  }));

  await page.evaluate(() => {
    const controls = globalThis.ferrumVirtualControls;
    if (!controls) {
      throw new Error("Virtual controls smoke requires window.ferrumVirtualControls.");
    }
    controls.releaseAll();
  });
  await waitForPageFunction(
    page,
    "virtual controls did not release runtime input",
    () => {
      const input = globalThis.ferrumVirtualControlsSmokeFrame?.input;
      return Boolean(input && !input.w && !input.d && !input.space && !input.mouseLeft);
    },
    timeoutMs,
  );

  return {
    virtualControlsSmoke: {
      pressed,
      released: await page.evaluate(() => ({
        input: globalThis.ferrumVirtualControlsSmokeFrame?.input,
        state: globalThis.ferrumVirtualControls?.state?.(),
      })),
    },
  };
}

function evaluateRuntimeBudgetSnapshot(snapshot, budget) {
  const violations = [];
  for (const [id, label, snapshotField, unit] of RUNTIME_BUDGET_FIELDS) {
    const limit = budget[id];
    const actual = snapshot[snapshotField];
    if (limit !== undefined && actual !== undefined && actual > limit) {
      violations.push({ id, label, actual, limit, unit });
    }
  }
  return {
    passed: violations.length === 0,
    violations,
  };
}

async function smokeTopdownAuthoredBehaviorVariant(page, timeoutMs) {
  await waitForPageFunction(
    page,
    "Top-down authored behavior variant smoke did not expose variant summary",
    () => globalThis.ferrumTopdownAuthoredBehaviorVariant?.replayScenario === "topdown-authored-behavior",
    timeoutMs,
  );
  await page.evaluate(() => {
    const summary = globalThis.ferrumTopdownAuthoredBehaviorVariant;
    if (!summary) {
      throw new Error("Top-down authored behavior variant summary is missing.");
    }
    if (summary.commandCount !== 15) {
      throw new Error(`Top-down authored behavior variant command count mismatch: ${summary.commandCount}`);
    }
    if (summary.instanceCount !== 8) {
      throw new Error(`Top-down authored behavior variant instance count mismatch: ${summary.instanceCount}`);
    }
    if (summary.expectedReplayHash !== "ab94f41f") {
      throw new Error(`Top-down authored behavior variant replay hash mismatch: ${summary.expectedReplayHash}`);
    }
    if (
      !Number.isInteger(summary.expectedStateIds?.["interaction-source"]) ||
      !Number.isInteger(summary.expectedStateIds?.["test-projectile"]) ||
      !Number.isInteger(summary.expectedStateIds?.["timer-source"])
    ) {
      throw new Error(`Top-down authored behavior variant state id mismatch: ${JSON.stringify(summary.expectedStateIds)}`);
    }
    if (summary.runtimeApply?.instanceCount !== 8) {
      throw new Error(`Top-down authored behavior variant runtime instance count mismatch: ${summary.runtimeApply?.instanceCount}`);
    }
    if (summary.runtimeApply?.commandCount !== 15) {
      throw new Error(`Top-down authored behavior variant runtime command count mismatch: ${summary.runtimeApply?.commandCount}`);
    }
    if (summary.runtimeApply?.machineCount !== 3) {
      throw new Error(`Top-down authored behavior variant runtime FSM count mismatch: ${summary.runtimeApply?.machineCount}`);
    }
    if (summary.runtimeApply?.applyId !== 1) {
      throw new Error(`Top-down authored behavior variant runtime apply id mismatch: ${summary.runtimeApply?.applyId}`);
    }
    if (
      !Number.isInteger(summary.runtimeApply?.initialStateIds?.["interaction-source"]) ||
      !Number.isInteger(summary.runtimeApply?.initialStateIds?.["test-projectile"]) ||
      !Number.isInteger(summary.runtimeApply?.initialStateIds?.["timer-source"]) ||
      summary.runtimeApply?.currentStateIds?.["interaction-source"] !== summary.runtimeApply?.initialStateIds?.["interaction-source"] ||
      summary.runtimeApply?.currentStateIds?.["test-projectile"] !== summary.runtimeApply?.initialStateIds?.["test-projectile"] ||
      summary.runtimeApply?.currentStateIds?.["timer-source"] !== summary.runtimeApply?.initialStateIds?.["timer-source"]
    ) {
      throw new Error(`Top-down authored behavior variant runtime FSM state mismatch: ${JSON.stringify(summary.runtimeApply)}`);
    }
    if (
      summary.runtimeApply?.placementAnchorReplayBody !== "pickup" ||
      summary.runtimeApply?.placementTarget !== "worldCenter" ||
      summary.runtimeApply?.placementOffsetX !== 400 ||
      summary.runtimeApply?.placementOffsetY !== 240 ||
      summary.runtimeApply?.placementScale !== 0.4
    ) {
      throw new Error(`Top-down authored behavior variant runtime placement mismatch: ${JSON.stringify(summary.runtimeApply)}`);
    }
    const playerHandle = summary.runtimeApply?.builtInPlayerHandle;
    const playerAction = summary.runtimeApply?.builtInPlayerAction;
    const playerDashAction = summary.runtimeApply?.builtInPlayerDashAction;
    if (
      playerHandle === undefined ||
      summary.runtimeApply?.handles?.["builtin-player"]?.entityId !== playerHandle.entityId ||
      summary.runtimeApply?.handles?.["builtin-player"]?.entityGeneration !== playerHandle.entityGeneration ||
      playerAction?.actionId !== 1 ||
      Math.abs(playerAction.cooldownSeconds - 0.08) > 0.0001 ||
      Math.abs(playerAction.remainingCooldownSeconds) > 0.0001 ||
      Math.abs(playerAction.speed - 720) > 0.0001 ||
      Math.abs(playerAction.damage - 2) > 0.0001 ||
      Math.abs(playerAction.lifetimeSeconds - 1.6) > 0.0001
    ) {
      throw new Error(`Top-down authored behavior variant built-in player action mismatch: ${JSON.stringify(summary.runtimeApply)}`);
    }
    if (
      playerDashAction?.actionId !== 2 ||
      Math.abs(playerDashAction.cooldownSeconds - 0.75) > 0.0001 ||
      Math.abs(playerDashAction.remainingCooldownSeconds) > 0.0001 ||
      Math.abs(playerDashAction.distance - 96) > 0.0001
    ) {
      throw new Error(`Top-down authored behavior variant built-in player dash action mismatch: ${JSON.stringify(summary.runtimeApply)}`);
    }
    if (typeof globalThis.ferrumTopdownAuthoredBehaviorStart !== "function") {
      throw new Error("Top-down authored behavior start helper is missing.");
    }
    if (typeof globalThis.ferrumTopdownAuthoredBehaviorResetAndReapply !== "function") {
      throw new Error("Top-down authored behavior reset/re-apply helper is missing.");
    }
    if (typeof globalThis.ferrumTopdownAuthoredBehaviorApplyCurrentStateCommands !== "function") {
      throw new Error("Top-down authored behavior state command apply helper is missing.");
    }
    globalThis.ferrumTopdownAuthoredBehaviorStart();
  });
  await page.waitForTimeout(500);
  const firstRun = await page.evaluate(() => {
    const summary = globalThis.ferrumTopdownAuthoredBehaviorVariant;
    const frame = globalThis.ferrumTopdownAuthoredBehaviorFrame;
    if (!summary || !frame) {
      throw new Error("Top-down authored behavior playable summary is missing.");
    }
    if (frame.applyId !== summary.runtimeApply.applyId) {
      throw new Error(`Top-down authored behavior playable apply id mismatch: ${JSON.stringify(frame)}`);
    }
    if (frame.maxScore !== 15) {
      throw new Error(`Top-down authored behavior playable score mismatch: ${JSON.stringify(frame)}`);
    }
    if (
      !frame.observedEventKinds.includes("collisionDamage") ||
      !frame.observedEventKinds.includes("interaction") ||
      !frame.observedEventKinds.includes("behaviorStateChanged") ||
      !frame.observedEventKinds.includes("timer")
    ) {
      throw new Error(`Top-down authored behavior playable event mismatch: ${JSON.stringify(frame.observedEventKinds)}`);
    }
    if (frame.interactionEventCount !== 1 || frame.collisionDamageEventCount !== 2 || frame.behaviorStateChangedEventCount !== 3) {
      throw new Error(`Top-down authored behavior playable event count mismatch: ${JSON.stringify(frame)}`);
    }
    const interaction = frame.interactionEvents[0];
    const collisionDamage = frame.collisionDamageEvents[0];
    const handles = summary.runtimeApply.handles;
    const interactionStateChanged = frame.behaviorStateChangedEvents.find((event) => event.sourceId === handles["interaction-source"].entityId);
    const projectileStateChanged = frame.behaviorStateChangedEvents.find((event) => event.sourceId === handles["test-projectile"].entityId);
    const timerStateChanged = frame.behaviorStateChangedEvents.find((event) => event.sourceId === handles["timer-source"].entityId);
    if (
      interaction.tokenId !== 7 ||
      interaction.once !== true ||
      interaction.consumedThisFrame !== true ||
      interaction.sourceId !== handles["interaction-source"].entityId ||
      interaction.sourceGeneration !== handles["interaction-source"].entityGeneration
    ) {
      throw new Error(`Top-down authored behavior interaction payload mismatch: ${JSON.stringify(interaction)}`);
    }
    if (
      collisionDamage.sourceId !== handles["test-projectile"].entityId ||
      collisionDamage.sourceGeneration !== handles["test-projectile"].entityGeneration ||
      collisionDamage.actorId !== handles["rewarded-enemy"].entityId ||
      collisionDamage.actorGeneration !== handles["rewarded-enemy"].entityGeneration ||
      collisionDamage.targetRemoved !== true ||
      collisionDamage.payloadBits !== 0x3f800000
    ) {
      throw new Error(`Top-down authored behavior collision payload mismatch: ${JSON.stringify(collisionDamage)}`);
    }
    if (
      frame.currentStateIds?.["interaction-source"] !== summary.expectedStateIds?.["interaction-source"] ||
      frame.currentStateIds?.["test-projectile"] !== summary.expectedStateIds?.["test-projectile"] ||
      frame.currentStateIds?.["timer-source"] !== summary.expectedStateIds?.["timer-source"]
    ) {
      throw new Error(`Top-down authored behavior playable FSM mismatch: ${JSON.stringify(frame.currentStateIds)}`);
    }
    if (
      interactionStateChanged?.payloadBits !== summary.runtimeApply.initialStateIds["interaction-source"] ||
      interactionStateChanged?.tokenId !== summary.expectedStateIds["interaction-source"] ||
      projectileStateChanged?.payloadBits !== summary.runtimeApply.initialStateIds["test-projectile"] ||
      projectileStateChanged?.tokenId !== summary.expectedStateIds["test-projectile"] ||
      timerStateChanged?.payloadBits !== summary.runtimeApply.initialStateIds["timer-source"] ||
      timerStateChanged?.tokenId !== summary.expectedStateIds["timer-source"]
    ) {
      throw new Error(`Top-down authored behavior state change telemetry mismatch: ${JSON.stringify(frame.behaviorStateChangedEvents)}`);
    }
    return { summary, frame };
  });
  const firstStateCommandApply = await page.evaluate(() => {
    const stateCommandApply = globalThis.ferrumTopdownAuthoredBehaviorApplyCurrentStateCommands();
    const expectedStateIds = globalThis.ferrumTopdownAuthoredBehaviorVariant?.expectedStateIds;
    if (
      stateCommandApply?.applyId !== 1 ||
      stateCommandApply.mode !== "replaceSupported" ||
      stateCommandApply.machineCount !== 3 ||
      stateCommandApply.states?.["interaction-source"] !== "triggered" ||
      stateCommandApply.states?.["test-projectile"] !== "spent" ||
      stateCommandApply.states?.["timer-source"] !== "awake" ||
      stateCommandApply.stateIds?.["interaction-source"] !== expectedStateIds?.["interaction-source"] ||
      stateCommandApply.stateIds?.["test-projectile"] !== expectedStateIds?.["test-projectile"] ||
      stateCommandApply.stateIds?.["timer-source"] !== expectedStateIds?.["timer-source"] ||
      stateCommandApply.commandCounts?.["interaction-source"] !== 0 ||
      stateCommandApply.commandCounts?.["test-projectile"] !== 1 ||
      stateCommandApply.commandCounts?.["timer-source"] !== 0 ||
      JSON.stringify(stateCommandApply.commandTypes?.["interaction-source"]) !== "[]" ||
      JSON.stringify(stateCommandApply.commandTypes?.["test-projectile"]) !== JSON.stringify(["configureLifetime"]) ||
      JSON.stringify(stateCommandApply.commandTypes?.["timer-source"]) !== "[]" ||
      stateCommandApply.resultCounts?.["interaction-source"] !== 11 ||
      stateCommandApply.resultCounts?.["test-projectile"] !== 12 ||
      stateCommandApply.resultCounts?.["timer-source"] !== 11
    ) {
      throw new Error(`Top-down authored behavior state command apply mismatch: ${JSON.stringify(stateCommandApply)}`);
    }
    return stateCommandApply;
  });

  await page.evaluate(() => {
    const runtimeApply = globalThis.ferrumTopdownAuthoredBehaviorResetAndReapply();
    if (runtimeApply?.applyId !== 2) {
      throw new Error(`Top-down authored behavior reset/re-apply id mismatch: ${JSON.stringify(runtimeApply)}`);
    }
    if (
      runtimeApply?.instanceCount !== 8 ||
      runtimeApply.commandCount !== 15 ||
      runtimeApply.builtInPlayerAction?.actionId !== 1 ||
      runtimeApply.builtInPlayerAction?.speed !== 720 ||
      runtimeApply.builtInPlayerDashAction?.actionId !== 2 ||
      runtimeApply.builtInPlayerDashAction?.distance !== 96
    ) {
      throw new Error(`Top-down authored behavior reset/re-apply runtime action mismatch: ${JSON.stringify(runtimeApply)}`);
    }
    if (globalThis.ferrumTopdownAuthoredBehaviorFrame !== undefined) {
      throw new Error(`Top-down authored behavior frame state was not cleared: ${JSON.stringify(globalThis.ferrumTopdownAuthoredBehaviorFrame)}`);
    }
    if (globalThis.ferrumTopdownAuthoredBehaviorStateCommandApply !== undefined) {
      throw new Error(`Top-down authored behavior state command apply state was not cleared: ${JSON.stringify(globalThis.ferrumTopdownAuthoredBehaviorStateCommandApply)}`);
    }
    globalThis.ferrumTopdownAuthoredBehaviorStart();
  });
  await waitForPageFunction(
    page,
    "Top-down authored behavior reset/re-apply did not produce playable events",
    () => {
      const summary = globalThis.ferrumTopdownAuthoredBehaviorVariant;
      const frame = globalThis.ferrumTopdownAuthoredBehaviorFrame;
      return Boolean(
        summary?.runtimeApply?.applyId === 2
        && frame?.applyId === 2
        && frame?.maxScore === 15
        && frame?.interactionEventCount === 1
        && frame?.collisionDamageEventCount === 2
        && frame?.behaviorStateChangedEventCount === 3
      );
    },
    timeoutMs,
  );
  const secondRun = await page.evaluate(() => {
    const summary = globalThis.ferrumTopdownAuthoredBehaviorVariant;
    const frame = globalThis.ferrumTopdownAuthoredBehaviorFrame;
    if (!summary || !frame) {
      throw new Error("Top-down authored behavior reset/re-apply summary is missing.");
    }
    if (summary.runtimeApply?.applyId !== 2 || frame.applyId !== 2) {
      throw new Error(`Top-down authored behavior reset/re-apply summary mismatch: ${JSON.stringify(summary.runtimeApply)}`);
    }
    if (
      frame.maxScore !== 15 ||
      frame.interactionEventCount !== 1 ||
      frame.collisionDamageEventCount !== 2 ||
      frame.behaviorStateChangedEventCount !== 3
    ) {
      throw new Error(`Top-down authored behavior reset/re-apply frame mismatch: ${JSON.stringify(frame)}`);
    }
    const interaction = frame.interactionEvents[0];
    const collisionDamage = frame.collisionDamageEvents[0];
    const handles = summary.runtimeApply.handles;
    const interactionStateChanged = frame.behaviorStateChangedEvents.find((event) => event.sourceId === handles["interaction-source"].entityId);
    const projectileStateChanged = frame.behaviorStateChangedEvents.find((event) => event.sourceId === handles["test-projectile"].entityId);
    const timerStateChanged = frame.behaviorStateChangedEvents.find((event) => event.sourceId === handles["timer-source"].entityId);
    if (
      interaction.tokenId !== 7 ||
      interaction.once !== true ||
      interaction.consumedThisFrame !== true ||
      interaction.sourceId !== handles["interaction-source"].entityId ||
      interaction.sourceGeneration !== handles["interaction-source"].entityGeneration
    ) {
      throw new Error(`Top-down authored behavior reset/re-apply interaction payload mismatch: ${JSON.stringify(interaction)}`);
    }
    if (
      collisionDamage.sourceId !== handles["test-projectile"].entityId ||
      collisionDamage.sourceGeneration !== handles["test-projectile"].entityGeneration ||
      collisionDamage.actorId !== handles["rewarded-enemy"].entityId ||
      collisionDamage.actorGeneration !== handles["rewarded-enemy"].entityGeneration ||
      collisionDamage.targetRemoved !== true ||
      collisionDamage.payloadBits !== 0x3f800000
    ) {
      throw new Error(`Top-down authored behavior reset/re-apply collision payload mismatch: ${JSON.stringify(collisionDamage)}`);
    }
    if (
      frame.currentStateIds?.["interaction-source"] !== summary.expectedStateIds?.["interaction-source"] ||
      frame.currentStateIds?.["test-projectile"] !== summary.expectedStateIds?.["test-projectile"] ||
      frame.currentStateIds?.["timer-source"] !== summary.expectedStateIds?.["timer-source"]
    ) {
      throw new Error(`Top-down authored behavior reset/re-apply FSM mismatch: ${JSON.stringify(frame.currentStateIds)}`);
    }
    if (
      interactionStateChanged?.payloadBits !== summary.runtimeApply.initialStateIds["interaction-source"] ||
      interactionStateChanged?.tokenId !== summary.expectedStateIds["interaction-source"] ||
      projectileStateChanged?.payloadBits !== summary.runtimeApply.initialStateIds["test-projectile"] ||
      projectileStateChanged?.tokenId !== summary.expectedStateIds["test-projectile"] ||
      timerStateChanged?.payloadBits !== summary.runtimeApply.initialStateIds["timer-source"] ||
      timerStateChanged?.tokenId !== summary.expectedStateIds["timer-source"]
    ) {
      throw new Error(`Top-down authored behavior reset/re-apply state change telemetry mismatch: ${JSON.stringify(frame.behaviorStateChangedEvents)}`);
    }
    return { summary, frame };
  });
  const secondStateCommandApply = await page.evaluate(() => {
    const stateCommandApply = globalThis.ferrumTopdownAuthoredBehaviorApplyCurrentStateCommands();
    if (
      stateCommandApply?.applyId !== 2 ||
      stateCommandApply.mode !== "replaceSupported" ||
      stateCommandApply.machineCount !== 3 ||
      stateCommandApply.states?.["interaction-source"] !== "triggered" ||
      stateCommandApply.states?.["test-projectile"] !== "spent" ||
      stateCommandApply.states?.["timer-source"] !== "awake" ||
      stateCommandApply.commandCounts?.["interaction-source"] !== 0 ||
      stateCommandApply.commandCounts?.["test-projectile"] !== 1 ||
      stateCommandApply.commandCounts?.["timer-source"] !== 0 ||
      JSON.stringify(stateCommandApply.commandTypes?.["interaction-source"]) !== "[]" ||
      JSON.stringify(stateCommandApply.commandTypes?.["test-projectile"]) !== JSON.stringify(["configureLifetime"]) ||
      JSON.stringify(stateCommandApply.commandTypes?.["timer-source"]) !== "[]" ||
      stateCommandApply.resultCounts?.["interaction-source"] !== 11 ||
      stateCommandApply.resultCounts?.["test-projectile"] !== 12 ||
      stateCommandApply.resultCounts?.["timer-source"] !== 11
    ) {
      throw new Error(`Top-down authored behavior reset/re-apply state command mismatch: ${JSON.stringify(stateCommandApply)}`);
    }
    return stateCommandApply;
  });
  await page.waitForTimeout(250);
  const secondRunFollowup = await page.evaluate(() => {
    const frame = globalThis.ferrumTopdownAuthoredBehaviorFrame;
    if (
      frame?.applyId !== 2 ||
      frame.interactionEventCount !== 1 ||
      frame.collisionDamageEventCount !== 2 ||
      frame.behaviorStateChangedEventCount !== 3
    ) {
      throw new Error(`Top-down authored behavior reset/re-apply one-shot event repeated: ${JSON.stringify(frame)}`);
    }
    return frame;
  });

  return {
    topdownAuthoredBehaviorVariantSmoke: secondRun.summary,
    topdownAuthoredBehaviorFrameSmoke: firstRun.frame,
    topdownAuthoredBehaviorStateCommandApplySmoke: firstStateCommandApply,
    topdownAuthoredBehaviorResetReapplySmoke: secondRun.frame,
    topdownAuthoredBehaviorResetReapplyStateCommandApplySmoke: secondStateCommandApply,
    topdownAuthoredBehaviorResetReapplyFollowupSmoke: secondRunFollowup,
  };
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

async function smokeTopdownSaveLoad(page, timeoutMs) {
  await page.evaluate((spec) => {
    const engine = globalThis.ferrumEngine;
    if (!engine) {
      throw new Error("Top-down save/load smoke requires window.ferrumEngine.");
    }
    engine.setGameSpec(spec);
    engine.clearParticles();
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
    "Top-down Shooter save/load smoke did not enter Playing state",
    () => globalThis.ferrumEngine?.gameState?.() === 1,
    timeoutMs,
  );
  await waitForPageFunction(
    page,
    "Top-down Shooter save/load smoke did not spawn an enemy",
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
      throw new Error("Top-down save/load smoke could not locate a canvas.");
    }
    const rect = canvas.getBoundingClientRect();
    const eventInit = {
      clientX: rect.left + 1,
      clientY: rect.top + 1,
      button: 0,
      bubbles: true,
    };
    canvas.dispatchEvent(new MouseEvent("mousemove", eventInit));
    canvas.dispatchEvent(new MouseEvent("mousedown", eventInit));
    window.dispatchEvent(new MouseEvent("mouseup", eventInit));
  });
  await waitForPageFunction(
    page,
    "Top-down Shooter save/load smoke did not spawn a bullet",
    () => (globalThis.ferrumEngine?.entityCount?.() ?? 0) >= 3,
    timeoutMs,
  );

  const report = await page.evaluate(() => {
    const engine = globalThis.ferrumEngine;
    if (!engine) {
      throw new Error("Top-down save/load smoke requires window.ferrumEngine.");
    }
    const savedGameState = captureGameplaySnapshot(0);
    const saved = savedGameState.builtInShooter;
    if (!saved) {
      throw new Error("Top-down save/load smoke could not capture a shooter snapshot.");
    }
    const savedHash = stableShooterStateSnapshot(saved);
    const beforeReset = {
      gameState: engine.gameState(),
      entityCount: engine.entityCount(),
      score: engine.score(),
    };
    engine.resetGame();
    const afterReset = {
      gameState: engine.gameState(),
      entityCount: engine.entityCount(),
      score: engine.score(),
    };
    const restored = engine.restoreShooterStateSnapshot?.(saved) === true;
    const restoredGameState = captureGameplaySnapshot(0);
    const restoredSnapshot = restoredGameState.builtInShooter;
    if (!restoredSnapshot) {
      throw new Error("Top-down save/load smoke could not recapture restored shooter state.");
    }
    const restoredHash = stableShooterStateSnapshot(restoredSnapshot);
    return {
      restored,
      savedHash,
      restoredHash,
      beforeReset,
      afterReset,
      afterRestore: {
        gameState: engine.gameState(),
        entityCount: engine.entityCount(),
        score: engine.score(),
      },
      savedGameState,
      restoredGameState,
      savedEntityCount: saved.entityCount,
      restoredEntityCount: restoredSnapshot.entityCount,
    };

    function captureGameplaySnapshot(frame) {
      return {
        format: "ferrum2d.game-state.snapshot",
        version: 1,
        frame,
        source: "ferrum-runtime",
        scene: {
          score: engine.score(),
          gameState: engine.gameState(),
          entityCount: engine.entityCount(),
          spriteCount: engine.spriteCount(),
          cameraX: engine.cameraX(),
          cameraY: engine.cameraY(),
        },
        builtInShooter: engine.captureShooterStateSnapshot?.(),
      };
    }

    function stableShooterStateSnapshot(snapshot) {
      return JSON.stringify({
        format: snapshot.format,
        version: snapshot.version,
        headerFloats: snapshot.headerFloats,
        headerU32s: snapshot.headerU32s,
        entityFloats: snapshot.entityFloats,
        entityU32s: snapshot.entityU32s,
        entityCount: snapshot.entityCount,
        floatsPerEntity: snapshot.floatsPerEntity,
        u32sPerEntity: snapshot.u32sPerEntity,
      });
    }
  });

  if (!report.restored) {
    throw new Error("Top-down save/load smoke restore returned false.");
  }
  if (report.savedHash !== report.restoredHash) {
    throw new Error(`Top-down save/load smoke hash mismatch:\n${JSON.stringify(report, null, 2)}`);
  }
  if (report.afterRestore.gameState !== report.beforeReset.gameState) {
    throw new Error(`Top-down save/load smoke did not restore gameState:\n${JSON.stringify(report, null, 2)}`);
  }
  if (report.afterRestore.entityCount !== report.beforeReset.entityCount) {
    throw new Error(`Top-down save/load smoke did not restore entityCount:\n${JSON.stringify(report, null, 2)}`);
  }
  const gameplayReplay = await compareTopdownSaveLoadGameplayReplay(report);
  if (!gameplayReplay.comparison.passed) {
    throw new Error(`Top-down save/load gameplay replay mismatch:\n${JSON.stringify(gameplayReplay, null, 2)}`);
  }
  const {
    savedGameState: _savedGameState,
    restoredGameState: _restoredGameState,
    ...smokeReport
  } = report;
  return { saveLoadSmoke: { ...smokeReport, gameplayReplay } };
}

async function compareTopdownSaveLoadGameplayReplay(report) {
  const {
    compareGameplayReplayRuns,
    createGameplayReplayRun,
  } = await import("../packages/ferrum-web/dist/gameplayReplay.js");
  const {
    hashGameStateSnapshot,
  } = await import("../packages/ferrum-web/dist/gameStateSnapshot.js");
  const expectedRun = createGameplayReplayRun([withGameStateSnapshotHash(report.savedGameState, hashGameStateSnapshot)]);
  const actualRun = createGameplayReplayRun([withGameStateSnapshotHash(report.restoredGameState, hashGameStateSnapshot)]);
  return {
    expectedHash: expectedRun.replayHash,
    actualHash: actualRun.replayHash,
    comparison: compareGameplayReplayRuns(expectedRun, actualRun),
  };
}

function withGameStateSnapshotHash(snapshot, hashGameStateSnapshot) {
  return {
    ...snapshot,
    snapshotHash: hashGameStateSnapshot(snapshot),
  };
}

async function smokeTopdownHd2d(page, timeoutMs) {
  const initial = await page.evaluate((spec) => {
    const engine = globalThis.ferrumEngine;
    if (!engine) {
      throw new Error("Top-down HD-2D smoke requires window.ferrumEngine.");
    }
    const resolved = engine.setGameSpec(spec);
    engine.resetGame();

    const bridgeFloorId = 1;
    const groundFloorId = 2;
    const path = engine.queryTilemapNavigationPath({
      fromX: 16,
      fromY: 16,
      toX: 80,
      toY: 16,
      heightSpan: { floorId: groundFloorId, elevation: 0, height: 8 },
      toHeightSpan: { floorId: bridgeFloorId, elevation: 12, height: 8 },
    });
    const underpassPath = engine.queryTilemapNavigationPath({
      fromX: 16,
      fromY: 16,
      toX: 80,
      toY: 16,
      heightSpan: { floorId: groundFloorId, elevation: 0, height: 8 },
    });
    return {
      projectileArc: resolved.projectileArc,
      path: path === undefined ? undefined : {
        pointCount: path.pointCount,
        points: path.points,
        distance: path.distance,
        floatsPerPoint: path.pointBuffer.length / Math.max(1, path.pointCount),
        debugLineCount: path.debugLineBuffer.lineCount,
      },
      underpassPath: underpassPath === undefined ? undefined : {
        pointCount: underpassPath.pointCount,
        points: underpassPath.points,
      },
    };
  }, TOPDOWN_HD2D_SMOKE_SPEC);

  if (!initial.projectileArc?.enabled) {
    throw new Error(`Top-down HD-2D smoke did not enable projectileArc:\n${JSON.stringify(initial, null, 2)}`);
  }
  if (!initial.path || initial.path.pointCount < 3) {
    throw new Error(`Top-down HD-2D smoke did not produce a bridge portal path:\n${JSON.stringify(initial, null, 2)}`);
  }
  if (initial.path.floatsPerPoint !== 5) {
    throw new Error(`Top-down HD-2D smoke path did not use 5-float HD-2D points:\n${JSON.stringify(initial, null, 2)}`);
  }
  if (!initial.underpassPath || initial.underpassPath.points.some((point) => point.heightSpan?.floorId !== 2)) {
    throw new Error(`Top-down HD-2D smoke did not preserve lower-floor bridge underpass path:\n${JSON.stringify(initial, null, 2)}`);
  }
  const floors = initial.path.points.map((point) => point.heightSpan?.floorId);
  if (!floors.includes(2) || !floors.includes(1)) {
    throw new Error(`Top-down HD-2D smoke path did not include ground and bridge floors:\n${JSON.stringify(initial, null, 2)}`);
  }

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
    "Top-down HD-2D smoke did not enter Playing state",
    () => globalThis.ferrumEngine?.gameState?.() === 1,
    timeoutMs,
  );
  await waitForPageFunction(
    page,
    "Top-down HD-2D smoke did not render tile/entity commands",
    () => (globalThis.ferrumRuntime?.renderer?.stats?.().renderCommandCount ?? 0) > 0,
    timeoutMs,
  );

  return await page.evaluate((initialReport) => ({
    topdownHd2dSmoke: {
      ...initialReport,
      gameState: globalThis.ferrumEngine?.gameState?.() ?? -1,
      renderCommandCount: globalThis.ferrumRuntime?.renderer?.stats?.().renderCommandCount ?? 0,
      entityCount: globalThis.ferrumEngine?.entityCount?.() ?? 0,
    },
  }), initial);
}

async function smokeDestructibleTerrain(page, timeoutMs) {
  await waitForPageFunction(
    page,
    "Destructible terrain smoke did not observe the initial Top-down Shooter render",
    () => (globalThis.ferrumRuntime?.renderer?.stats?.().renderCommandCount ?? 0) > 0,
    timeoutMs,
  );

  const initial = await page.evaluate(() => {
    const engine = globalThis.ferrumEngine;
    const renderer = globalThis.ferrumRuntime?.renderer;
    if (!engine || !renderer) {
      throw new Error("Destructible terrain smoke requires window.ferrumEngine and window.ferrumRuntime.renderer.");
    }
    const target = { layerIndex: 1, column: 2, row: 1, x: 400, y: 240 };
    const beforeHit = engine.queryNearestTileObstacle({ x: target.x, y: target.y, maxDistance: 0 });
    const beforeRenderCommandCount = renderer.stats().renderCommandCount;
    const changed = engine.setShooterTilemapTilesRect(target.layerIndex, target.column, target.row, 1, 1, 0);
    const afterHit = engine.queryNearestTileObstacle({ x: target.x, y: target.y, maxDistance: 0 });
    return {
      target,
      changed,
      beforeHit,
      afterHit,
      beforeRenderCommandCount,
    };
  });

  if (!initial.beforeHit) {
    throw new Error("Destructible terrain smoke target did not start on a collision tile.");
  }
  if (!initial.changed) {
    throw new Error("Destructible terrain smoke target tile was not changed.");
  }
  if (initial.afterHit) {
    throw new Error("Destructible terrain smoke target still reports a collision hit after removal.");
  }

  await waitForPageFunction(
    page,
    "Destructible terrain smoke did not observe a rendered tile count drop",
    (beforeRenderCommandCount) => {
      const renderer = globalThis.ferrumRuntime?.renderer;
      return Boolean(renderer && renderer.stats().renderCommandCount < beforeRenderCommandCount);
    },
    timeoutMs,
    initial.beforeRenderCommandCount,
  );

  return await page.evaluate((initialReport) => ({
    destructibleTerrain: {
      ...initialReport,
      afterRenderCommandCount: globalThis.ferrumRuntime?.renderer?.stats?.().renderCommandCount ?? 0,
    },
  }), initial);
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

function lightingObserved() {
  const stats = globalThis.ferrumRuntime?.renderer?.stats?.();
  const report = readReport();
  return Boolean(
    stats
    && stats.lightingDrawCalls >= 2
    && stats.pointLightCount >= 1
    && stats.tileOccluderCount >= 1
    && stats.shadowDrawCalls >= 1
    && stats.shadowCasterCount >= 1
    && report.warmPixelCount > 25
    && report.renderCommandCount > 0,
  );

  function readReport() {
    function emptyReport(width = 0, height = 0) {
      return {
        width,
        height,
        warmPixelCount: 0,
        renderCommandCount: 0,
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

    let warmPixelCount = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const alpha = pixels[index + 3];
      if (red > 160 && green > 80 && blue < 120 && alpha > 160) {
        warmPixelCount += 1;
      }
    }

    const runtime = globalThis.ferrumRuntime;
    return {
      width,
      height,
      warmPixelCount,
      renderCommandCount: runtime?.renderer?.stats?.().renderCommandCount ?? runtime?.engine?.spriteCount?.() ?? globalThis.ferrumEngine?.spriteCount?.() ?? 0,
    };
  }
}

function materialObserved() {
  const stats = globalThis.ferrumRuntime?.renderer?.stats?.();
  const report = readReport();
  return Boolean(
    stats
    && stats.renderCommandCount > 0
    && stats.drawCalls >= 5
    && report.greenPixelCount > 25,
  );

  function readReport() {
    const canvas = document.querySelector("canvas");
    if (!(canvas instanceof HTMLCanvasElement)) {
      return { greenPixelCount: 0 };
    }

    const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true });
    if (!gl) {
      return { greenPixelCount: 0 };
    }

    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    let greenPixelCount = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const alpha = pixels[index + 3];
      if (green > 110 && red < 120 && blue < 170 && alpha > 200) {
        greenPixelCount += 1;
      }
    }
    return { greenPixelCount };
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

function canvasScreenshotSummary() {
  const canvas = document.querySelector("canvas");
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error("screenshot capture requires a canvas element.");
  }

  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true });
  if (!gl) {
    throw new Error("screenshot capture requires a WebGL2 canvas.");
  }

  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  let hash = 0x811c9dc5;
  let redTotal = 0;
  let greenTotal = 0;
  let blueTotal = 0;
  let alphaTotal = 0;
  let opaqueCount = 0;
  let nonTransparentCount = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const alpha = pixels[index + 3];
    redTotal += red;
    greenTotal += green;
    blueTotal += blue;
    alphaTotal += alpha;
    if (alpha >= 255) {
      opaqueCount += 1;
    }
    if (alpha > 0) {
      nonTransparentCount += 1;
    }
    hash = fnvByte(hash, red);
    hash = fnvByte(hash, green);
    hash = fnvByte(hash, blue);
    hash = fnvByte(hash, alpha);
  }
  hash = fnvByte(hash, width & 0xff);
  hash = fnvByte(hash, height & 0xff);

  const pixelCount = width * height;
  return {
    format: "ferrum-screenshot-capture-summary",
    version: 1,
    width,
    height,
    pixelCount,
    opaquePixelRatio: opaqueCount / pixelCount,
    nonTransparentPixelRatio: nonTransparentCount / pixelCount,
    averageColor: {
      r: redTotal / (pixelCount * 255),
      g: greenTotal / (pixelCount * 255),
      b: blueTotal / (pixelCount * 255),
      a: alphaTotal / (pixelCount * 255),
    },
    contentHash: hash.toString(16).padStart(8, "0"),
  };

  function fnvByte(current, byte) {
    return Math.imul((current ^ byte) >>> 0, 0x01000193) >>> 0;
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
