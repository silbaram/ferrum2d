#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { chromium } from "playwright-core";
import {
  runtimeBudgetForSmokeMode,
  runtimeBudgetProfileIdForSmokeMode,
} from "./runtime-budget-profiles.mjs";

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
const CONTENT_RUNTIME_MODE = "content-runtime";
const TOPDOWN_EFFECTS_MODE = "topdown-effects";
const TOPDOWN_MASS_OBJECTS_MODE = "topdown-mass-objects";
const TOPDOWN_MASS_OBJECTS_PLAYING_STATE = 1;
const TOPDOWN_MASS_OBJECTS_COLLISION_PAIR_BUDGET = 2_000;
const TOPDOWN_TILEMAP_BUDGET_MODE = "topdown-tilemap-budget";
const TOPDOWN_TILEMAP_BUDGET_COLUMNS = 64;
const TOPDOWN_TILEMAP_BUDGET_ROWS = 32;
const TOPDOWN_TILEMAP_BUDGET_TILE_COUNT = TOPDOWN_TILEMAP_BUDGET_COLUMNS * TOPDOWN_TILEMAP_BUDGET_ROWS;
const TOPDOWN_TILEMAP_BUDGET_MAX_DRAW_CALLS = 8;
const TOPDOWN_TILEMAP_BUDGET_MAX_TEXTURE_SWITCHES = 8;
const TOPDOWN_SAVE_LOAD_MODE = "topdown-save-load";
const TOPDOWN_AUTHORED_BEHAVIOR_VARIANT_MODE = "topdown-authored-behavior-variant";
const TOPDOWN_AUTHORED_BEHAVIOR_VARIANT_PATH = "examples/topdown-shooter/public/authored-behavior.variant.json";
const TOPDOWN_HD2D_MODE = "topdown-hd2d";
const DESTRUCTIBLE_TERRAIN_MODE = "destructible-terrain";
const BREAKOUT_EFFECTS_MODE = "breakout-effects";
const PLATFORMER_EFFECTS_MODE = "platformer-effects";
const PHYSICS_SANDBOX_MODE = "physics-sandbox";
const PHYSICS_DEMO_SUITE_MODE = "physics-demo-suite";
const PLACEMENT_VIEWER_MODE = "placement-viewer";
const PLACEMENT_VIEWER_SAVE_MODE = "placement-viewer-save";
const PLACEMENT_VIEWER_MASS_AUTHORING_MODE = "placement-viewer-mass-authoring";
const PLACEMENT_VIEWER_BASE_INSTANCE_COUNT = 6;
const PLACEMENT_VIEWER_MASS_AUTHORING_COUNT = 1024;
const PLACEMENT_VIEWER_MASS_AUTHORING_MIN_INSTANCE_COUNT =
  PLACEMENT_VIEWER_BASE_INSTANCE_COUNT + PLACEMENT_VIEWER_MASS_AUTHORING_COUNT;
const PLACEMENT_VIEWER_MASS_AUTHORING_MAX_DRAW_CALLS = 16;
const PLACEMENT_VIEWER_MASS_AUTHORING_MAX_SELECTION_MS = 500;
const PLACEMENT_VIEWER_MASS_AUTHORING_MAX_PATCH_MS = 500;
const PLACEMENT_SAVE_ENDPOINT = "/__ferrum-placement-save";
const MAX_PLACEMENT_SAVE_BYTES = 512 * 1024;
const PHYSICS_DEMO_SUITE = [
  "rigid-materials",
  "collider-gallery",
  "contacts-sensors",
  "joints-lab",
  "ccd-tunnel-test",
  "platformer-physics",
  "scene-queries",
];
const STARTER_RUNTIME_WEAPON_PROFILE_VISUALS = Object.freeze({
  standard: { label: "Tiny green pellet", textureId: 21, width: 6, height: 6, cooldownSeconds: 0.055 },
  piercing: { label: "Long cyan spear", textureId: 22, width: 20, height: 5, cooldownSeconds: 0.22 },
  bounce: { label: "Large amber orb", textureId: 23, width: 18, height: 18, cooldownSeconds: 0.42 },
});
const RUNTIME_BUDGET_FIELDS = Object.freeze([
  ["maxFrameTimeMs", "frame time", "maxFrameTimeMs", "ms"],
  ["maxRustUpdateTimeMs", "rust update", "maxRustUpdateTimeMs", "ms"],
  ["maxRenderTimeMs", "render", "maxRenderTimeMs", "ms"],
  ["maxDrawCalls", "draw calls", "maxDrawCalls", "count"],
  ["maxRenderCommandCount", "render commands", "maxRenderCommandCount", "count"],
  ["maxTextureSwitchCount", "texture switches", "maxTextureSwitchCount", "count"],
  ["maxPhysicsFixedSteps", "fixed steps", "maxPhysicsFixedSteps", "count"],
  ["maxPhysicsSolidCandidateChecks", "solid checks", "maxPhysicsSolidCandidateChecks", "count"],
  ["maxPhysicsTileCandidateChecks", "tile checks", "maxPhysicsTileCandidateChecks", "count"],
  ["maxPhysicsCcdChecks", "ccd checks", "maxPhysicsCcdChecks", "count"],
  ["maxPhysicsDebugLineCount", "physics debug lines", "maxPhysicsDebugLineCount", "count"],
  ["maxCollisionPairCount", "collision pairs", "maxCollisionPairCount", "count"],
  ["maxAssetLoadElapsedMs", "asset load", "maxAssetLoadElapsedMs", "ms"],
  ["maxJsHeapUsedBytes", "JS heap used", "maxJsHeapUsedBytes", "bytes"],
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
const TOPDOWN_TILEMAP_BUDGET_SMOKE_SPEC = createTopdownTilemapBudgetSmokeSpec();
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

function createTopdownTilemapBudgetSmokeSpec() {
  return {
    world: { width: TOPDOWN_TILEMAP_BUDGET_COLUMNS * 8, height: TOPDOWN_TILEMAP_BUDGET_ROWS * 8 },
    player: { speed: 1 },
    enemies: {
      speed: 1,
      spawnInterval: 999,
      behavior: "static",
      spawnPattern: "edge",
      health: 1,
      scoreReward: 1,
      waves: [],
    },
    weapons: { bulletSpeed: 420, cooldown: 10, lifetime: 1, damage: 1 },
    prefabs: {
      player: { width: 16, height: 16 },
      enemy: { width: 8, height: 8 },
      bullet: { width: 6, height: 6 },
    },
    atlas: {
      frames: {
        "budget.floor": {
          texture: 0,
          uv: { u0: 0, v0: 0, u1: 1, v1: 1 },
          size: { width: 8, height: 8 },
        },
        "budget.accent": {
          texture: 0,
          uv: { u0: 0, v0: 0, u1: 1, v1: 1 },
          size: { width: 8, height: 8 },
        },
      },
    },
    tilemap: {
      tileWidth: 8,
      tileHeight: 8,
      tiles: {
        "1": { frame: "budget.floor", color: [0.16, 0.22, 0.2, 0.42] },
        "2": { frame: "budget.accent", color: [0.28, 0.32, 0.42, 0.52] },
      },
      layers: [{
        name: "budget-floor",
        columns: TOPDOWN_TILEMAP_BUDGET_COLUMNS,
        rows: TOPDOWN_TILEMAP_BUDGET_ROWS,
        data: Array.from({ length: TOPDOWN_TILEMAP_BUDGET_TILE_COUNT }, (_, index) => (
          index % 11 === 0 ? 2 : 1
        )),
      }],
    },
    camera: { preset: "follow" },
  };
}
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
  server = await serveStatic(distDir, {
    placementSave: options.mode === PLACEMENT_VIEWER_SAVE_MODE,
  });
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
  const budgetProfileId = options.budget
    ? runtimeBudgetProfileIdForSmokeMode(options.mode, options.budgetProfile)
    : undefined;
  const budgetReport = options.budget
    ? await smokeRuntimeBudget(
        page,
        timeoutMs,
        runtimeBudgetForSmokeMode(options.mode, budgetProfileId),
      )
    : {};

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
  const budgetArtifactReport = options.budget
    ? await writeRuntimeBudgetArtifact({
        url,
        distDir,
        mode: options.mode,
        budgetProfile: budgetProfileId,
        runtimeBudget: report.runtimeBudget,
      })
    : {};
  if (report.runtimeBudget?.report?.passed === false) {
    const artifactMessage = budgetArtifactReport.runtimeBudgetArtifact
      ? `\nartifact: ${budgetArtifactReport.runtimeBudgetArtifact}`
      : "";
    throw new Error(
      `runtime budget smoke failed:${artifactMessage}\n${JSON.stringify(report.runtimeBudget.report.violations, null, 2)}`,
    );
  }
  if (browserErrors.length > 0) {
    throw new Error(`browser console/page errors:\n${browserErrors.join("\n")}`);
  }
  console.log(`${distDir}: browser render smoke ok`);
  console.log(JSON.stringify({ url, ...report, ...budgetArtifactReport }, null, 2));
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
    if (arg === "--topdown-mass-objects") {
      mode = TOPDOWN_MASS_OBJECTS_MODE;
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
    CONTENT_RUNTIME_MODE,
    TOPDOWN_EFFECTS_MODE,
    TOPDOWN_MASS_OBJECTS_MODE,
    TOPDOWN_TILEMAP_BUDGET_MODE,
    TOPDOWN_SAVE_LOAD_MODE,
    TOPDOWN_AUTHORED_BEHAVIOR_VARIANT_MODE,
    TOPDOWN_HD2D_MODE,
    DESTRUCTIBLE_TERRAIN_MODE,
    BREAKOUT_EFFECTS_MODE,
    PLATFORMER_EFFECTS_MODE,
    PHYSICS_SANDBOX_MODE,
    PHYSICS_DEMO_SUITE_MODE,
    PLACEMENT_VIEWER_MODE,
    PLACEMENT_VIEWER_SAVE_MODE,
    PLACEMENT_VIEWER_MASS_AUTHORING_MODE,
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
  if (mode === CONTENT_RUNTIME_MODE) {
    params.set("contentRuntimeSmoke", "true");
  }
  if (mode === TOPDOWN_EFFECTS_MODE) {
    params.set("effectSmoke", "true");
  }
  if (mode === TOPDOWN_MASS_OBJECTS_MODE) {
    params.set("massObjectsSmoke", "true");
  }
  if (mode === TOPDOWN_TILEMAP_BUDGET_MODE) {
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
    params.set("demo", "rigid-materials");
    params.set("physicsDebugLines", "true");
  }
  if (mode === PLACEMENT_VIEWER_MASS_AUTHORING_MODE) {
    params.set("massAuthoring", "true");
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
  } = await import("../../packages/ferrum-web/dist/screenshotCapture.js");
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

async function serveStatic(root, options = {}) {
  const serverInstance = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? "/", `http://${DEFAULT_HOST}`).pathname;
      if (options.placementSave === true && pathname === PLACEMENT_SAVE_ENDPOINT) {
        await handlePlacementSave(root, request, response);
        return;
      }
      if (pathname === "/favicon.ico") {
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

async function handlePlacementSave(root, request, response) {
  if (request.method !== "POST") {
    throw new HttpError(405, "Method not allowed");
  }
  const body = await readRequestBody(request, MAX_PLACEMENT_SAVE_BYTES);
  let document;
  try {
    document = JSON.parse(body);
  } catch {
    throw new HttpError(400, "invalid placement scene document json");
  }
  if (
    document?.format !== "ferrum2d.consumer.scene-authoring"
    || document.version !== 1
    || typeof document.sceneComposition !== "object"
    || document.sceneComposition === null
  ) {
    throw new HttpError(400, "invalid placement scene document");
  }
  await writeFile(
    join(root, "placement.scene-authoring.json"),
    `${JSON.stringify(document, null, 2)}\n`,
    "utf8",
  );
  response.writeHead(200, {
    "Cache-Control": "no-cache",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify({ saved: true, document }));
}

async function readRequestBody(request, maxBytes) {
  return await new Promise((resolveBody, rejectBody) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
        rejectBody(new HttpError(413, "placement save payload too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolveBody(body));
    request.on("error", rejectBody);
  });
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
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-precise-memory-info"],
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

async function readTopdownAuthoredBehaviorExpectedReplayHash() {
  const variant = JSON.parse(await readFile(resolve(TOPDOWN_AUTHORED_BEHAVIOR_VARIANT_PATH), "utf8"));
  const replayHash = variant?.expected?.replayHash;
  if (typeof replayHash !== "string" || replayHash.length === 0) {
    throw new Error(`${TOPDOWN_AUTHORED_BEHAVIOR_VARIANT_PATH} is missing expected.replayHash.`);
  }
  return replayHash;
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
    case CONTENT_RUNTIME_MODE:
      return await smokeContentRuntime(page, timeoutMs);
    case TOPDOWN_EFFECTS_MODE:
      return await smokeTopdownEffects(page, timeoutMs);
    case TOPDOWN_MASS_OBJECTS_MODE:
      return await smokeTopdownMassObjects(page, timeoutMs);
    case TOPDOWN_TILEMAP_BUDGET_MODE:
      return await smokeTopdownTilemapBudget(page, timeoutMs);
    case TOPDOWN_SAVE_LOAD_MODE:
      return await smokeTopdownSaveLoad(page, timeoutMs);
    case TOPDOWN_AUTHORED_BEHAVIOR_VARIANT_MODE:
      return await smokeTopdownAuthoredBehaviorVariant(
        page,
        timeoutMs,
        await readTopdownAuthoredBehaviorExpectedReplayHash(),
      );
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
      return await smokePhysicsSandbox(page, timeoutMs, "rigid-materials");
    case PHYSICS_DEMO_SUITE_MODE:
      return await smokePhysicsDemoSuite(page, timeoutMs);
    case PLACEMENT_VIEWER_MODE:
      return await smokePlacementViewer(page, timeoutMs);
    case PLACEMENT_VIEWER_SAVE_MODE:
      return await smokePlacementViewerSave(page, timeoutMs);
    case PLACEMENT_VIEWER_MASS_AUTHORING_MODE:
      return await smokePlacementViewerMassAuthoring(page, timeoutMs);
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
  const hasStarterRuntimeHooks = await page.evaluate(() => Boolean(
    globalThis.ferrumStarterRuntimeCaptureReport
    && globalThis.ferrumStarterRuntimeApplyWeaponProfile,
  ));
  if (hasStarterRuntimeHooks) {
    return await smokeStarterRuntime(page, timeoutMs);
  }
  return {};
}

async function smokePlacementViewer(page, timeoutMs) {
  await waitForPageFunction(
    page,
    "placement viewer did not expose runtime, viewer state, and rendered scene metrics",
    () => {
      const state = globalThis.ferrumPlacementViewerState;
      const frame = globalThis.ferrumPlacementViewerRuntimeFrame;
      return Boolean(
        globalThis.__ferrumPlacementViewer
        && state
        && state.instances?.length === 6
        && state.selectedInstanceId === "turret_left"
        && frame?.entityCount === 6
        && frame?.renderCommandCount >= 6
        && frame?.drawCalls >= 1
      );
    },
    timeoutMs,
  );

  const saveGate = await page.evaluate(async () => ({
    enabled: globalThis.ferrumPlacementViewerSaveEnabled,
    result: await globalThis.ferrumPlacementViewerSaveDraft?.(),
  }));
  if (saveGate.enabled !== false || saveGate.result !== undefined) {
    throw new Error(`placement viewer save gate should be disabled by default: ${JSON.stringify(saveGate)}`);
  }

  const cratePoint = await page.evaluate(() => {
    const viewer = globalThis.__ferrumPlacementViewer;
    const canvas = document.querySelector("canvas");
    if (!viewer || !(canvas instanceof HTMLCanvasElement)) {
      throw new Error("placement viewer smoke requires the viewer hook and canvas.");
    }
    const state = viewer.state();
    const crate = state.instances.find((instance) => instance.instanceId === "crate_left");
    if (!crate) {
      throw new Error(`placement viewer smoke could not find crate_left: ${JSON.stringify(state.instances)}`);
    }
    const screenX = (crate.transform.x - state.viewport.worldMinX) * state.viewport.zoom;
    const screenY = (crate.transform.y - state.viewport.worldMinY) * state.viewport.zoom;
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + screenX,
      y: rect.top + screenY,
      screenX,
      screenY,
      worldX: crate.transform.x,
      worldY: crate.transform.y,
    };
  });

  await page.mouse.move(cratePoint.x, cratePoint.y);
  await waitForPageFunction(
    page,
    "placement viewer pointer move did not update hovered instance",
    () => {
      const state = globalThis.ferrumPlacementViewerState;
      return Boolean(
        state?.hoveredInstanceId === "crate_left"
        && Math.abs((state.pointerWorld?.x ?? Number.NaN) - 692) < 0.1
        && Math.abs((state.pointerWorld?.y ?? Number.NaN) - 478) < 0.1
      );
    },
    timeoutMs,
  );

  await page.mouse.click(cratePoint.x, cratePoint.y);
  await waitForPageFunction(
    page,
    "placement viewer click did not update selected instance",
    () => {
      const state = globalThis.ferrumPlacementViewerState;
      const selectedButton = document.querySelector("button[data-instance-id='crate_left']");
      return Boolean(
        state?.selectedInstanceId === "crate_left"
        && state?.selected?.role === "worldObject"
        && selectedButton?.getAttribute("data-selected") === "true"
      );
    },
    timeoutMs,
  );

  await page.click("input[data-placement-snap-toggle='true']", { timeout: timeoutMs });
  await page.fill("input[data-placement-transform-field='x']", "755", { timeout: timeoutMs });
  await page.fill("input[data-placement-transform-field='y']", "501", { timeout: timeoutMs });
  await waitForPageFunction(
    page,
    "placement viewer numeric inputs did not apply snapped draft coordinates",
    () => {
      const state = globalThis.ferrumPlacementViewerState;
      return Boolean(
        globalThis.ferrumPlacementViewerInteraction?.enabled === true
        && globalThis.ferrumPlacementViewerInteraction?.gridSize === 16
        && state?.selected?.transform.x === 752
        && state.selected.transform.y === 496
      );
    },
    timeoutMs,
  );

  await page.focus("canvas");
  await page.keyboard.press("ArrowRight");
  await waitForPageFunction(
    page,
    "placement viewer arrow-key nudge did not update selected draft coordinates",
    () => {
      const state = globalThis.ferrumPlacementViewerState;
      return Boolean(
        state?.selected?.transform.x === 768
        && state.selected.transform.y === 496
      );
    },
    timeoutMs,
  );

  const dragPoints = await page.evaluate(() => {
    const viewer = globalThis.__ferrumPlacementViewer;
    const canvas = document.querySelector("canvas");
    if (!viewer || !(canvas instanceof HTMLCanvasElement)) {
      throw new Error("placement viewer drag smoke requires viewer and canvas.");
    }
    const state = viewer.state();
    const crate = state.instances.find((instance) => instance.instanceId === "crate_left");
    if (!crate) {
      throw new Error(`placement viewer drag smoke could not find crate_left: ${JSON.stringify(state.instances)}`);
    }
    const rect = canvas.getBoundingClientRect();
    const screenForWorld = (point) => ({
      x: rect.left + ((point.x - state.viewport.worldMinX) * state.viewport.zoom),
      y: rect.top + ((point.y - state.viewport.worldMinY) * state.viewport.zoom),
    });
    return {
      from: screenForWorld(crate.transform),
      to: screenForWorld({ x: 789, y: 513 }),
    };
  });

  await page.mouse.move(dragPoints.from.x, dragPoints.from.y);
  await page.mouse.down();
  await page.mouse.move(dragPoints.to.x, dragPoints.to.y, { steps: 4 });
  await page.mouse.up();

  const movedCratePoint = await page.evaluate(() => {
    const viewer = globalThis.__ferrumPlacementViewer;
    const canvas = document.querySelector("canvas");
    if (!viewer || !(canvas instanceof HTMLCanvasElement)) {
      throw new Error("placement viewer draft smoke requires viewer and canvas.");
    }
    const state = viewer.state();
    const crate = state.instances.find((instance) => instance.instanceId === "crate_left");
    if (!crate) {
      throw new Error(`placement viewer draft smoke could not find crate_left: ${JSON.stringify(state.instances)}`);
    }
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + ((crate.transform.x - state.viewport.worldMinX) * state.viewport.zoom),
      y: rect.top + ((crate.transform.y - state.viewport.worldMinY) * state.viewport.zoom),
      worldX: crate.transform.x,
      worldY: crate.transform.y,
      patch: globalThis.ferrumPlacementViewerExportPatch?.(),
    };
  });

  await waitForPageFunction(
    page,
    "placement viewer drag did not publish an exportable snapped patch",
    () => {
      const state = globalThis.ferrumPlacementViewerState;
      const patch = globalThis.ferrumPlacementViewerExportPatch?.();
      const operation = patch?.operations?.[0];
      return Boolean(
        globalThis.ferrumPlacementViewerInteraction?.enabled === true
        && globalThis.ferrumPlacementViewerInteraction?.dragging === false
        && state?.selected?.transform.x === 784
        && state.selected.transform.y === 512
        && state.draftPatch?.operations?.length === 1
        && patch?.format === "ferrum2d.scene-placement.patch"
        && operation?.kind === "updateTransform"
        && operation.instanceId === "crate_left"
        && operation.transform?.x === 784
        && operation.transform?.y === 512
      );
    },
    timeoutMs,
  );

  await page.mouse.move(cratePoint.x, cratePoint.y);
  await waitForPageFunction(
    page,
    "placement viewer old bounds still picked moved draft instance",
    () => globalThis.ferrumPlacementViewerState?.hoveredInstanceId !== "crate_left",
    timeoutMs,
  );
  await page.mouse.move(movedCratePoint.x, movedCratePoint.y);
  await waitForPageFunction(
    page,
    "placement viewer moved draft bounds did not pick the instance",
    () => globalThis.ferrumPlacementViewerState?.hoveredInstanceId === "crate_left",
    timeoutMs,
  );

  await page.evaluate(() => globalThis.ferrumPlacementViewerSelect?.("crate_right"));
  await waitForPageFunction(
    page,
    "placement viewer moved draft marker disappeared after selecting another instance",
    () => {
      const state = globalThis.ferrumPlacementViewerState;
      const draftMarkers = Array.from(document.querySelectorAll(".placement-draft-marker"));
      return Boolean(
        state?.selectedInstanceId === "crate_right"
        && draftMarkers.some((marker) => marker.textContent?.includes("crate_left draft"))
      );
    },
    timeoutMs,
  );
  await page.evaluate(() => globalThis.ferrumPlacementViewerSelect?.("crate_left"));
  await page.mouse.move(movedCratePoint.x, movedCratePoint.y);
  await waitForPageFunction(
    page,
    "placement viewer moved draft instance was not selectable after marker persistence check",
    () => globalThis.ferrumPlacementViewerState?.hoveredInstanceId === "crate_left",
    timeoutMs,
  );

  const report = await page.evaluate(() => {
    const state = globalThis.ferrumPlacementViewerState;
    const frame = globalThis.ferrumPlacementViewerRuntimeFrame;
    const selectedButton = document.querySelector("button[data-instance-id='crate_left']");
    const details = inspectorDetails();
    const pixels = placementCanvasPixels();
    const patch = globalThis.ferrumPlacementViewerExportPatch?.();
    if (state?.selectedInstanceId !== "crate_left") {
      throw new Error(`placement viewer selected instance mismatch: ${JSON.stringify(state)}`);
    }
    if (state.hoveredInstanceId !== "crate_left") {
      throw new Error(`placement viewer hovered instance mismatch: ${JSON.stringify(state)}`);
    }
    if (state.selected?.role !== "worldObject") {
      throw new Error(`placement viewer selected role mismatch: ${JSON.stringify(state.selected)}`);
    }
    if (state.instances.length !== 6) {
      throw new Error(`placement viewer instance count mismatch: ${state.instances.length}`);
    }
    if (frame?.entityCount !== 6 || frame.renderCommandCount < 6 || frame.drawCalls < 1) {
      throw new Error(`placement viewer runtime frame mismatch: ${JSON.stringify(frame)}`);
    }
    if (pixels.differentFromFirstPixelCount <= 0 || pixels.nonTransparentPixelCount <= 0) {
      throw new Error(`placement viewer canvas readback was blank: ${JSON.stringify(pixels)}`);
    }
    if (details.selected !== "crate_left" || details.hovered !== "crate_left") {
      throw new Error(`placement viewer inspector mismatch: ${JSON.stringify(details)}`);
    }
    if (details.transform !== "784, 512") {
      throw new Error(`placement viewer transform controls mismatch: ${JSON.stringify(details)}`);
    }
    if (details.draft !== "1" || patch?.operations?.length !== 1) {
      throw new Error(`placement viewer draft patch mismatch: ${JSON.stringify({ details, patch })}`);
    }
    if (selectedButton?.getAttribute("data-selected") !== "true") {
      throw new Error("placement viewer selected list button was not active.");
    }
    return {
      state: {
        fragment: state.fragment,
        instanceCount: state.instances.length,
        selectedInstanceId: state.selectedInstanceId,
        hoveredInstanceId: state.hoveredInstanceId,
        selectedRole: state.selected.role,
        pointerWorld: state.pointerWorld,
        draftPatch: state.draftPatch,
      },
      frame,
      details,
      interaction: globalThis.ferrumPlacementViewerInteraction,
      pixels,
      patch,
      selectedButtonText: selectedButton.textContent,
    };

    function inspectorDetails() {
      const rows = {};
      for (const term of document.querySelectorAll(".placement-details dt")) {
        rows[term.textContent ?? ""] = term.nextElementSibling?.textContent ?? "";
      }
      return rows;
    }

    function placementCanvasPixels() {
      const canvas = document.querySelector("canvas");
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error("placement viewer smoke could not locate a canvas.");
      }
      const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true });
      if (!gl) {
        throw new Error("placement viewer smoke requires a WebGL2 context.");
      }
      const width = gl.drawingBufferWidth;
      const height = gl.drawingBufferHeight;
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const firstRed = pixels[0];
      const firstGreen = pixels[1];
      const firstBlue = pixels[2];
      const firstAlpha = pixels[3];
      let nonTransparentPixelCount = 0;
      let differentFromFirstPixelCount = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        const red = pixels[index];
        const green = pixels[index + 1];
        const blue = pixels[index + 2];
        const alpha = pixels[index + 3];
        if (alpha > 0) {
          nonTransparentPixelCount += 1;
        }
        if (red !== firstRed || green !== firstGreen || blue !== firstBlue || alpha !== firstAlpha) {
          differentFromFirstPixelCount += 1;
        }
      }
      return {
        width,
        height,
        nonTransparentPixelCount,
        differentFromFirstPixelCount,
      };
    }
  });

  await page.evaluate(() => globalThis.ferrumPlacementViewerClearDraft?.());
  await page.evaluate(() => globalThis.ferrumPlacementViewerSelect?.("crate_left"));
  await page.selectOption("select[data-placement-behavior-recipe='true']", "agent.actor", { timeout: timeoutMs });
  await page.click("button[data-placement-action='attach-behavior-binding']", { timeout: timeoutMs });
  await waitForPageFunction(
    page,
    "placement viewer behavior binding inspector did not publish an attach patch",
    () => {
      const state = globalThis.ferrumPlacementViewerState;
      const patch = globalThis.ferrumPlacementViewerExportPatch?.();
      const operation = patch?.operations?.[0];
      const details = inspectorDetails();
      return Boolean(
        state?.selectedInstanceId === "crate_left"
        && state.selected?.role === "actor"
        && state.selected?.behaviorProfiles?.[0] === "agent.actor"
        && details.behavior === "agent.actor"
        && operation?.kind === "updateBehaviorBinding"
        && operation.target?.kind === "instance"
        && operation.target.instanceId === "crate_left"
        && operation.behaviorRecipes === "agent.actor"
      );

      function inspectorDetails() {
        const rows = {};
        for (const term of document.querySelectorAll(".placement-details dt")) {
          rows[term.textContent ?? ""] = term.nextElementSibling?.textContent ?? "";
        }
        return rows;
      }
    },
    timeoutMs,
  );
  await page.click("button[data-placement-action='detach-behavior-binding']", { timeout: timeoutMs });
  await waitForPageFunction(
    page,
    "placement viewer behavior binding inspector did not clear an attach draft",
    () => {
      const state = globalThis.ferrumPlacementViewerState;
      const details = inspectorDetails();
      return Boolean(
        state?.selectedInstanceId === "crate_left"
        && state.selected?.role === "worldObject"
        && state.selected?.behaviorProfiles?.length === 0
        && details.behavior === "-"
        && globalThis.ferrumPlacementViewerExportPatch?.() === undefined
      );

      function inspectorDetails() {
        const rows = {};
        for (const term of document.querySelectorAll(".placement-details dt")) {
          rows[term.textContent ?? ""] = term.nextElementSibling?.textContent ?? "";
        }
        return rows;
      }
    },
    timeoutMs,
  );
  await page.evaluate(() => globalThis.ferrumPlacementViewerClearDraft?.());
  await page.evaluate(() => globalThis.ferrumPlacementViewerSelect?.("turret_left"));
  await page.fill("input[data-placement-rename-id='true']", "turret_renamed", { timeout: timeoutMs });
  await page.click("button[data-placement-action='rename-selected']", { timeout: timeoutMs });
  await waitForPageFunction(
    page,
    "placement viewer rename UI did not publish a rename patch",
    () => {
      const state = globalThis.ferrumPlacementViewerState;
      const patch = globalThis.ferrumPlacementViewerExportPatch?.();
      const operation = patch?.operations?.[0];
      const selectedButton = document.querySelector("button[data-instance-id='turret_renamed']");
      return Boolean(
        state?.selectedInstanceId === "turret_renamed"
        && state?.instances?.length === 6
        && selectedButton?.getAttribute("data-selected") === "true"
        && operation?.kind === "renameInstance"
        && operation.instanceId === "turret_left"
        && operation.nextInstanceId === "turret_renamed"
        && globalThis.ferrumPlacementViewerMigrationPreview?.renamedInstanceIds?.[0]?.nextInstanceId === "turret_renamed"
        && document.querySelector("[data-placement-migration-report='true']")?.getAttribute("data-reference-count") === "0"
        && document.querySelector("button[data-placement-action='save-draft']")
          ?.getAttribute("data-blocked-by-references") === "false"
      );
    },
    timeoutMs,
  );
  const placementAddActions = await page.evaluate(() =>
    Array.from(document.querySelectorAll("button[data-placement-action^='add-']"))
      .map((button) => button.getAttribute("data-placement-action"))
      .filter(Boolean),
  );
  for (const action of ["add-rect", "add-circle", "add-point", "add-sprite", "add-prefab"]) {
    if (!placementAddActions.includes(action)) {
      throw new Error(`placement viewer add palette is missing ${action}.`);
    }
  }
  const placementCanvasCenter = () => page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error("placement viewer add smoke could not locate a canvas.");
    }
    canvas.scrollIntoView({ block: "center", inline: "center" });
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + rect.width * 0.5,
      y: rect.top + rect.height * 0.5,
    };
  });
  await page.selectOption("select[data-placement-add-sprite='true']", "turret", { timeout: timeoutMs });
  await page.selectOption("select[data-placement-add-sprite-frame='true']", "barrel", { timeout: timeoutMs });
  await page.click("button[data-placement-action='add-sprite']", { timeout: timeoutMs });
  await waitForPageFunction(
    page,
    "placement viewer add sprite button did not enter pending add mode",
    () => globalThis.ferrumPlacementViewerInteraction?.pendingAdd === "add-sprite",
    timeoutMs,
  );
  const spriteAddPoint = await placementCanvasCenter();
  await page.mouse.move(spriteAddPoint.x, spriteAddPoint.y, { steps: 8 });
  await page.mouse.click(spriteAddPoint.x, spriteAddPoint.y);
  await waitForPageFunction(
    page,
    "placement viewer add sprite frame UI did not publish a framed sprite patch",
    () => {
      const state = globalThis.ferrumPlacementViewerState;
      const patch = globalThis.ferrumPlacementViewerExportPatch?.();
      const handoff = globalThis.ferrumPlacementViewerAgentHandoff;
      const operation = patch?.operations?.find((candidate) =>
        candidate.kind === "addInstance"
        && candidate.instance.props?.components?.visual?.kind === "sprite"
        && candidate.instance.props.components.visual.asset === "turret"
      );
      const handoffOperation = handoff?.draftPatch?.operations?.find((candidate) =>
        candidate.kind === "addInstance"
        && candidate.instance?.id === operation?.instance?.id
      );
      const addedId = operation?.instance?.id;
      const added = state?.instances?.find((instance) => instance.instanceId === addedId);
      const visual = operation?.instance?.props?.components?.visual;
      return Boolean(
        addedId
        && state?.selectedInstanceId === addedId
        && added?.visual?.kind === "sprite"
        && added.visual.texture.name === "turret"
        && added.visual.frame.u0 === 0.5
        && visual?.kind === "sprite"
        && visual.asset === "turret"
        && visual.frame?.u0 === 0.5
        && document.querySelector(".placement-collider-overlay[data-visible='true'][data-collider-type='aabb']")
        && handoff?.format === "ferrum2d.placement-viewer.agent-handoff"
        && handoff.workflow === "human-placement-agent-behavior"
        && handoff.placementOwner === "sceneComposition.fragments[].instances[]"
        && handoff.behaviorOwner === "sceneComposition.prefabs[].props.behaviorRecipes + behaviorRecipes.entities"
        && handoff.selectedInstanceId === addedId
        && handoff.selected?.instanceId === addedId
        && handoff.draftPatch?.operations?.length === patch.operations.length
        && handoffOperation?.instance?.props?.components?.visual?.asset === "turret"
        && Array.isArray(handoff.assetDiagnostics)
      );
    },
    timeoutMs,
  );
  await page.click("button[data-placement-action='remove-selected']", { timeout: timeoutMs });
  await waitForPageFunction(
    page,
    "placement viewer remove UI did not cancel the draft sprite add",
    () => {
      const state = globalThis.ferrumPlacementViewerState;
      const patch = globalThis.ferrumPlacementViewerExportPatch?.();
      return Boolean(
        state?.instances?.length === 6
        && !state.instances.some((instance) => instance.visual?.kind === "sprite" && instance.visual.texture.name === "turret" && instance.sourceId !== "turret_left")
        && patch?.operations?.length === 1
        && patch.operations[0]?.kind === "renameInstance"
      );
    },
    timeoutMs,
  );
  await page.click("button[data-placement-action='add-rect']", { timeout: timeoutMs });
  await waitForPageFunction(
    page,
    "placement viewer add rect button did not enter pending add mode",
    () => globalThis.ferrumPlacementViewerInteraction?.pendingAdd === "add-rect",
    timeoutMs,
  );
  const addPoint = await placementCanvasCenter();
  await page.mouse.move(addPoint.x, addPoint.y, { steps: 8 });
  await waitForPageFunction(
    page,
    "placement viewer add rect hover preview did not render",
    () => Boolean(
      globalThis.ferrumPlacementViewerInteraction?.pendingAdd === "add-rect"
      && document.querySelector("[data-placement-pending-add='add-rect']")
      && globalThis.ferrumPlacementViewerState?.pointerWorld,
    ),
    timeoutMs,
  );
  await page.mouse.click(addPoint.x, addPoint.y);
  await waitForPageFunction(
    page,
    "placement viewer add primitive UI did not publish an add patch",
    () => {
      const state = globalThis.ferrumPlacementViewerState;
      const patch = globalThis.ferrumPlacementViewerExportPatch?.();
      return Boolean(
        state?.selectedInstanceId === "rect_1"
        && state?.instances?.length === 7
        && state.selected?.visual?.kind === "primitive"
        && state.selected.visual.shape === "rect"
        && state.selected?.collider?.type === "aabb"
        && patch?.operations?.some((operation) =>
          operation.kind === "addInstance"
          && operation.instance.id === "rect_1"
          && operation.instance.prefab === "object"
          && operation.instance.props?.components?.visual?.kind === "primitive"
          && operation.instance.props.components.visual.shape === "rect"
          && operation.instance.props.components.collider?.type === "aabb"
        )
      );
    },
    timeoutMs,
  );
  const resizeDrag = await page.evaluate(() => {
    const state = globalThis.ferrumPlacementViewerState;
    const selected = state?.selected;
    const handle = document.querySelector(".placement-resize-handle");
    const canvas = document.querySelector("canvas");
    if (
      !state
      || !selected
      || !(handle instanceof HTMLElement)
      || !(canvas instanceof HTMLCanvasElement)
    ) {
      throw new Error("placement viewer resize smoke requires selected instance, handle, and canvas.");
    }
    const handleRect = handle.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const screenForWorld = (point) => ({
      x: canvasRect.left + ((point.x - state.viewport.worldMinX) * state.viewport.zoom),
      y: canvasRect.top + ((point.y - state.viewport.worldMinY) * state.viewport.zoom),
    });
    return {
      from: {
        x: handleRect.left + handleRect.width * 0.5,
        y: handleRect.top + handleRect.height * 0.5,
      },
      to: screenForWorld({
        x: selected.transform.x + 40,
        y: selected.transform.y + 24,
      }),
    };
  });
  await page.mouse.move(resizeDrag.from.x, resizeDrag.from.y);
  await page.mouse.down();
  await page.mouse.move(resizeDrag.to.x, resizeDrag.to.y, { steps: 6 });
  await page.mouse.up();
  await waitForPageFunction(
    page,
    "placement viewer resize handle did not update the primitive visual and collider patch",
    () => {
      const state = globalThis.ferrumPlacementViewerState;
      const patch = globalThis.ferrumPlacementViewerExportPatch?.();
      const operation = patch?.operations?.find((candidate) =>
        candidate.kind === "addInstance" && candidate.instance.id === "rect_1"
      );
      const components = operation?.instance?.props?.components;
      return Boolean(
        state?.selectedInstanceId === "rect_1"
        && document.querySelector(".placement-selection[data-resizable='true'][data-resize-kind='rect']")
        && state.selected?.visual?.kind === "primitive"
        && state.selected.visual.shape === "rect"
        && state.selected.visual.bounds.width === 80
        && state.selected.visual.bounds.height === 48
        && state.selected.collider?.type === "aabb"
        && state.selected.collider.halfWidth === 40
        && state.selected.collider.halfHeight === 24
        && components?.visual?.kind === "primitive"
        && components.visual.width === 80
        && components.visual.height === 48
        && components.collider?.type === "aabb"
        && components.collider.halfWidth === 40
        && components.collider.halfHeight === 24
      );
    },
    timeoutMs,
  );
  const colliderOffsetDrag = await page.evaluate(() => {
    const state = globalThis.ferrumPlacementViewerState;
    const selected = state?.selected;
    const handle = document.querySelector(
      ".placement-collider-overlay[data-visible='true'][data-offset-draggable='true'] .placement-collider-offset-handle",
    );
    const canvas = document.querySelector("canvas");
    if (
      !state
      || !selected
      || !(handle instanceof HTMLElement)
      || !(canvas instanceof HTMLCanvasElement)
    ) {
      throw new Error("placement viewer collider offset smoke requires selected instance, handle, and canvas.");
    }
    const handleRect = handle.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    if (handleRect.width <= 0 || handleRect.height <= 0) {
      throw new Error("placement viewer collider offset handle is not visible.");
    }
    if (selected.collider?.type !== "aabb") {
      throw new Error(`placement viewer collider offset smoke expected aabb collider: ${JSON.stringify(selected.collider)}`);
    }
    const screenForWorld = (point) => ({
      x: canvasRect.left + ((point.x - state.viewport.worldMinX) * state.viewport.zoom),
      y: canvasRect.top + ((point.y - state.viewport.worldMinY) * state.viewport.zoom),
    });
    const screenToWorld = (point) => ({
      x: state.viewport.worldMinX + ((point.x - canvasRect.left) / state.viewport.zoom),
      y: state.viewport.worldMinY + ((point.y - canvasRect.top) / state.viewport.zoom),
    });
    const from = {
      x: handleRect.left + handleRect.width * 0.5,
      y: handleRect.top + handleRect.height * 0.5,
    };
    const fromWorld = screenToWorld(from);
    const scale = Math.abs(selected.transform.scale) < 0.0001 ? 0.0001 : selected.transform.scale;
    return {
      from,
      to: screenForWorld({
        x: fromWorld.x + ((9 - selected.collider.offsetX) * scale),
        y: fromWorld.y + ((-7 - selected.collider.offsetY) * scale),
      }),
    };
  });
  await page.mouse.move(colliderOffsetDrag.from.x, colliderOffsetDrag.from.y);
  await page.mouse.down();
  await page.mouse.move(colliderOffsetDrag.to.x, colliderOffsetDrag.to.y, { steps: 6 });
  await page.mouse.up();
  await waitForPageFunction(
    page,
    "placement viewer collider offset handle did not update the collider patch",
    () => {
      const state = globalThis.ferrumPlacementViewerState;
      const patch = globalThis.ferrumPlacementViewerExportPatch?.();
      const operation = patch?.operations?.find((candidate) =>
        candidate.kind === "addInstance" && candidate.instance.id === "rect_1"
      );
      const components = operation?.instance?.props?.components;
      return Boolean(
        state?.selectedInstanceId === "rect_1"
        && document.querySelector(".placement-collider-overlay[data-visible='true'][data-offset-draggable='true']")
        && state.selected?.visual?.kind === "primitive"
        && state.selected.visual.shape === "rect"
        && state.selected.visual.bounds.width === 80
        && state.selected.visual.bounds.height === 48
        && state.selected.collider?.type === "aabb"
        && state.selected.collider.halfWidth === 40
        && state.selected.collider.halfHeight === 24
        && state.selected.collider.offsetX === 9
        && state.selected.collider.offsetY === -7
        && components?.visual?.kind === "primitive"
        && components.visual.width === 80
        && components.visual.height === 48
        && components.collider?.type === "aabb"
        && components.collider.halfWidth === 40
        && components.collider.halfHeight === 24
        && components.collider.offsetX === 9
        && components.collider.offsetY === -7
      );
    },
    timeoutMs,
  );
  await page.fill("input[data-placement-component-field='visualWidth']", "64", { timeout: timeoutMs });
  await page.fill("input[data-placement-component-field='visualHeight']", "24", { timeout: timeoutMs });
  await page.fill("input[data-placement-component-field='visualColor']", "#ffcc33", { timeout: timeoutMs });
  await page.selectOption("select[data-placement-component-field='colliderType']", "circle", { timeout: timeoutMs });
  await page.fill("input[data-placement-component-field='colliderRadius']", "32", { timeout: timeoutMs });
  await page.fill("input[data-placement-component-field='colliderOffsetX']", "7", { timeout: timeoutMs });
  await page.fill("input[data-placement-component-field='colliderOffsetY']", "-5", { timeout: timeoutMs });
  await page.selectOption("select[data-placement-component-field='layer']", "enemy", { timeout: timeoutMs });
  await page.click("button[data-placement-action='apply-components']", { timeout: timeoutMs });
  await waitForPageFunction(
    page,
    "placement viewer component inspector did not update the added primitive patch",
    () => {
      const state = globalThis.ferrumPlacementViewerState;
      const patch = globalThis.ferrumPlacementViewerExportPatch?.();
      const operation = patch?.operations?.find((candidate) =>
        candidate.kind === "addInstance" && candidate.instance.id === "rect_1"
      );
      const components = operation?.instance?.props?.components;
      return Boolean(
        state?.selectedInstanceId === "rect_1"
        && state.selected?.visual?.kind === "primitive"
        && state.selected.visual.shape === "rect"
        && state.selected.visual.bounds.width === 64
        && state.selected.visual.bounds.height === 24
        && state.selected.collider?.type === "circle"
        && state.selected.collider.radius === 32
        && state.selected.collider.offsetX === 7
        && state.selected.collider.offsetY === -5
        && state.selected.componentLayer?.name === "enemy"
        && patch?.operations?.length === 2
        && components?.visual?.kind === "primitive"
        && components.visual.width === 64
        && components.visual.height === 24
        && components.visual.color === "#ffcc33"
        && components.collider?.type === "circle"
        && components.collider.radius === 32
        && components.collider.offsetX === 7
        && components.collider.offsetY === -5
        && components.layer === "enemy"
      );
    },
    timeoutMs,
  );
  await page.selectOption("select[data-placement-component-field='colliderType']", "capsule", { timeout: timeoutMs });
  await page.fill("input[data-placement-component-field='colliderStartX']", "-10", { timeout: timeoutMs });
  await page.fill("input[data-placement-component-field='colliderStartY']", "0", { timeout: timeoutMs });
  await page.fill("input[data-placement-component-field='colliderEndX']", "10", { timeout: timeoutMs });
  await page.fill("input[data-placement-component-field='colliderEndY']", "0", { timeout: timeoutMs });
  await page.fill("input[data-placement-component-field='colliderRadius']", "6", { timeout: timeoutMs });
  await page.fill("input[data-placement-component-field='colliderOffsetX']", "2", { timeout: timeoutMs });
  await page.fill("input[data-placement-component-field='colliderOffsetY']", "-1", { timeout: timeoutMs });
  await page.click("button[data-placement-action='apply-components']", { timeout: timeoutMs });
  await waitForPageFunction(
    page,
    "placement viewer component inspector did not publish a capsule collider patch",
    () => {
      const state = globalThis.ferrumPlacementViewerState;
      const patch = globalThis.ferrumPlacementViewerExportPatch?.();
      const operation = patch?.operations?.find((candidate) =>
        candidate.kind === "addInstance" && candidate.instance.id === "rect_1"
      );
      const collider = operation?.instance?.props?.components?.collider;
      return Boolean(
        state?.selectedInstanceId === "rect_1"
        && state.selected?.collider?.type === "capsule"
        && state.selected.collider.startX === -10
        && state.selected.collider.startY === 0
        && state.selected.collider.endX === 10
        && state.selected.collider.endY === 0
        && state.selected.collider.radius === 6
        && state.selected.collider.offsetX === 2
        && state.selected.collider.offsetY === -1
        && collider?.type === "capsule"
        && collider.startX === -10
        && collider.startY === 0
        && collider.endX === 10
        && collider.endY === 0
        && collider.radius === 6
        && collider.offsetX === 2
        && collider.offsetY === -1
      );
    },
    timeoutMs,
  );
  await page.selectOption("select[data-placement-component-field='colliderType']", "orientedBox", { timeout: timeoutMs });
  await page.fill("input[data-placement-component-field='colliderWidth']", "36", { timeout: timeoutMs });
  await page.fill("input[data-placement-component-field='colliderHeight']", "18", { timeout: timeoutMs });
  await page.fill("input[data-placement-component-field='colliderRotation']", "0.25", { timeout: timeoutMs });
  await page.fill("input[data-placement-component-field='colliderOffsetX']", "3", { timeout: timeoutMs });
  await page.fill("input[data-placement-component-field='colliderOffsetY']", "-2", { timeout: timeoutMs });
  await page.click("button[data-placement-action='apply-components']", { timeout: timeoutMs });
  await waitForPageFunction(
    page,
    "placement viewer component inspector did not publish an oriented box collider patch",
    () => {
      const state = globalThis.ferrumPlacementViewerState;
      const patch = globalThis.ferrumPlacementViewerExportPatch?.();
      const operation = patch?.operations?.find((candidate) =>
        candidate.kind === "addInstance" && candidate.instance.id === "rect_1"
      );
      const collider = operation?.instance?.props?.components?.collider;
      return Boolean(
        state?.selectedInstanceId === "rect_1"
        && state.selected?.collider?.type === "orientedBox"
        && state.selected.collider.halfWidth === 18
        && state.selected.collider.halfHeight === 9
        && state.selected.collider.rotationRadians === 0.25
        && state.selected.collider.offsetX === 3
        && state.selected.collider.offsetY === -2
        && collider?.type === "orientedBox"
        && collider.halfWidth === 18
        && collider.halfHeight === 9
        && collider.rotationRadians === 0.25
        && collider.offsetX === 3
        && collider.offsetY === -2
      );
    },
    timeoutMs,
  );
  const polygonVertices = JSON.stringify([
    { x: -18, y: -8 },
    { x: 20, y: -4 },
    { x: 12, y: 14 },
    { x: -16, y: 10 },
  ]);
  await page.selectOption("select[data-placement-component-field='colliderType']", "convexPolygon", { timeout: timeoutMs });
  await page.fill("textarea[data-placement-component-field='colliderVertices']", polygonVertices, { timeout: timeoutMs });
  await page.fill("input[data-placement-component-field='colliderRotation']", "0.5", { timeout: timeoutMs });
  await page.fill("input[data-placement-component-field='colliderOffsetX']", "-4", { timeout: timeoutMs });
  await page.fill("input[data-placement-component-field='colliderOffsetY']", "6", { timeout: timeoutMs });
  await page.click("button[data-placement-action='apply-components']", { timeout: timeoutMs });
  await waitForPageFunction(
    page,
    "placement viewer component inspector did not publish a convex polygon collider patch",
    () => {
      const state = globalThis.ferrumPlacementViewerState;
      const patch = globalThis.ferrumPlacementViewerExportPatch?.();
      const operation = patch?.operations?.find((candidate) =>
        candidate.kind === "addInstance" && candidate.instance.id === "rect_1"
      );
      const collider = operation?.instance?.props?.components?.collider;
      return Boolean(
        state?.selectedInstanceId === "rect_1"
        && state.selected?.collider?.type === "convexPolygon"
        && state.selected.collider.vertices.length === 4
        && state.selected.collider.vertices[1]?.x === 20
        && state.selected.collider.vertices[2]?.y === 14
        && state.selected.collider.rotationRadians === 0.5
        && state.selected.collider.offsetX === -4
        && state.selected.collider.offsetY === 6
        && collider?.type === "convexPolygon"
        && collider.vertices?.length === 4
        && collider.vertices[1]?.x === 20
        && collider.vertices[2]?.y === 14
        && collider.rotationRadians === 0.5
        && collider.offsetX === -4
        && collider.offsetY === 6
      );
    },
    timeoutMs,
  );
  await page.fill("input[data-placement-definition-id='true']", "rect_template", { timeout: timeoutMs });
  await page.click("button[data-placement-action='create-object-definition']", { timeout: timeoutMs });
  await waitForPageFunction(
    page,
    "placement viewer object definition create action did not publish an addObjectDefinition patch",
    () => {
      const state = globalThis.ferrumPlacementViewerState;
      const patch = globalThis.ferrumPlacementViewerExportPatch?.();
      const operation = patch?.operations?.find((candidate) =>
        candidate.kind === "addObjectDefinition" && candidate.id === "rect_template"
      );
      const components = operation?.definition?.props?.components;
      return Boolean(
        state?.objectDefinitions?.some((definition) =>
          definition.id === "rect_template"
          && definition.visual?.kind === "primitive"
          && definition.collider?.type === "convexPolygon"
          && definition.componentLayer?.name === "enemy"
        )
        && document.querySelector("select[data-placement-add-prefab='true'] option[value='rect_template']")
        && components?.visual?.kind === "primitive"
        && components.visual.width === 64
        && components.visual.height === 24
        && components.collider?.type === "convexPolygon"
        && components.collider.vertices?.length === 4
        && components.collider.offsetX === -4
        && components.collider.offsetY === 6
        && components.layer === "enemy"
      );
    },
    timeoutMs,
  );
  await page.click("button[data-placement-action='remove-selected']", { timeout: timeoutMs });
  await waitForPageFunction(
    page,
    "placement viewer remove UI did not cancel the draft add",
    () => {
      const state = globalThis.ferrumPlacementViewerState;
      const patch = globalThis.ferrumPlacementViewerExportPatch?.();
      return Boolean(
        state?.instances?.length === 6
        && !state.instances.some((instance) => instance.instanceId === "rect_1")
        && patch?.operations?.length === 2
        && patch.operations[0]?.kind === "renameInstance"
        && patch.operations[1]?.kind === "addObjectDefinition"
        && patch.operations[1]?.id === "rect_template"
      );
    },
    timeoutMs,
  );
  const editReport = await page.evaluate(() => {
    const details = inspectorDetails();
    const patch = globalThis.ferrumPlacementViewerExportPatch?.();
    return {
      selectedInstanceId: globalThis.ferrumPlacementViewerState?.selectedInstanceId,
      instanceCount: globalThis.ferrumPlacementViewerState?.instances?.length,
      draftPatch: patch,
      migrationPreview: globalThis.ferrumPlacementViewerMigrationPreview,
      agentHandoff: globalThis.ferrumPlacementViewerAgentHandoff,
      details,
    };

    function inspectorDetails() {
      const rows = {};
      for (const term of document.querySelectorAll(".placement-details dt")) {
        rows[term.textContent ?? ""] = term.nextElementSibling?.textContent ?? "";
      }
      return rows;
    }
  });

  return { placementViewerSmoke: { target: cratePoint, movedTarget: movedCratePoint, ...report, editReport } };
}

async function smokePlacementViewerSave(page, timeoutMs) {
  await waitForPageFunction(
    page,
    "placement viewer save smoke did not expose an opt-in save-enabled viewer",
    () => {
      const state = globalThis.ferrumPlacementViewerState;
      return Boolean(
        globalThis.__ferrumPlacementViewer
        && globalThis.ferrumPlacementViewerSaveEnabled === true
        && state?.instances?.length === 6
        && state.draftPatch === undefined
      );
    },
    timeoutMs,
  );

  const suffix = Date.now().toString(36);
  const instanceId = `rect_save_smoke_${suffix}`;
  const spriteInstanceId = `sprite_save_smoke_${suffix}`;
  const prefabInstanceId = `prefab_save_smoke_${suffix}`;
  const definitionId = `definition_save_smoke_${suffix}`;
  const definitionInstanceId = `definition_instance_save_smoke_${suffix}`;
  const saveResult = await page.evaluate(async ({ id, spriteId, prefabId, objectDefinitionId, objectDefinitionInstanceId }) => {
    const addState = globalThis.ferrumPlacementViewerAddInstance?.("main", {
      id,
      prefab: "object",
      x: 736,
      y: 496,
      props: {
        components: {
          visual: {
            kind: "primitive",
            shape: "rect",
            width: 72,
            height: 28,
            color: "#46d9c8",
          },
          collider: {
            type: "circle",
            radius: 18,
            offsetX: 5,
            offsetY: -3,
            isTrigger: true,
          },
          layer: "pickup",
        },
      },
    });
    const addSpriteState = globalThis.ferrumPlacementViewerAddInstance?.("main", {
      id: spriteId,
      prefab: "object",
      x: 784,
      y: 512,
      props: {
        components: {
          visual: {
            kind: "sprite",
            asset: "turret",
            width: 34,
            height: 42,
            frame: { u0: 0.5, v0: 0, u1: 1, v1: 1 },
            originX: 0.5,
            originY: 0.5,
          },
          collider: {
            type: "aabb",
            halfWidth: 17,
            halfHeight: 21,
          },
          layer: "enemy",
        },
      },
    });
    const addPrefabState = globalThis.ferrumPlacementViewerAddInstance?.("main", {
      id: prefabId,
      prefab: "crate",
      x: 832,
      y: 544,
    });
    const addDefinitionState = globalThis.ferrumPlacementViewerAddObjectDefinition?.(objectDefinitionId, {
      props: {
        components: {
          visual: {
            kind: "primitive",
            shape: "circle",
            radius: 22,
            color: "#a78bfa",
          },
          collider: {
            type: "circle",
            radius: 22,
          },
          layer: "pickup",
        },
      },
    });
    const addDefinitionInstanceState = globalThis.ferrumPlacementViewerAddInstance?.("main", {
      id: objectDefinitionInstanceId,
      prefab: objectDefinitionId,
      x: 880,
      y: 560,
    });
    const beforeSavePatch = globalThis.ferrumPlacementViewerExportPatch?.();
    const saved = await globalThis.ferrumPlacementViewerSaveDraft?.();
    return {
      addSelectedInstanceId: addState?.selectedInstanceId,
      addSpriteSelectedInstanceId: addSpriteState?.selectedInstanceId,
      addPrefabSelectedInstanceId: addPrefabState?.selectedInstanceId,
      addDefinitionVisible:
        addDefinitionState?.objectDefinitions?.some((definition) => definition.id === objectDefinitionId),
      addDefinitionInstanceSelectedInstanceId: addDefinitionInstanceState?.selectedInstanceId,
      beforeSavePatch,
      saved,
    };
  }, {
    id: instanceId,
    spriteId: spriteInstanceId,
    prefabId: prefabInstanceId,
    objectDefinitionId: definitionId,
    objectDefinitionInstanceId: definitionInstanceId,
  });
  const addOperation = saveResult.beforeSavePatch?.operations?.find((operation) =>
    operation.kind === "addInstance" && operation.instance?.id === instanceId
  );
  const addSpriteOperation = saveResult.beforeSavePatch?.operations?.find((operation) =>
    operation.kind === "addInstance" && operation.instance?.id === spriteInstanceId
  );
  const addPrefabOperation = saveResult.beforeSavePatch?.operations?.find((operation) =>
    operation.kind === "addInstance" && operation.instance?.id === prefabInstanceId
  );
  const addDefinitionOperation = saveResult.beforeSavePatch?.operations?.find((operation) =>
    operation.kind === "addObjectDefinition" && operation.id === definitionId
  );
  const addDefinitionInstanceOperation = saveResult.beforeSavePatch?.operations?.find((operation) =>
    operation.kind === "addInstance" && operation.instance?.id === definitionInstanceId
  );
  if (
    saveResult.addSelectedInstanceId !== instanceId
    || saveResult.addSpriteSelectedInstanceId !== spriteInstanceId
    || saveResult.addPrefabSelectedInstanceId !== prefabInstanceId
    || saveResult.addDefinitionVisible !== true
    || saveResult.addDefinitionInstanceSelectedInstanceId !== definitionInstanceId
    || saveResult.saved?.saved !== true
    || addOperation?.instance?.props?.components?.visual?.kind !== "primitive"
    || addSpriteOperation?.instance?.props?.components?.visual?.frame?.u0 !== 0.5
    || addPrefabOperation?.instance?.prefab !== "crate"
    || addDefinitionOperation?.definition?.props?.components?.visual?.kind !== "primitive"
    || addDefinitionInstanceOperation?.instance?.prefab !== definitionId
  ) {
    throw new Error(`placement viewer save smoke did not save expected add patches:\n${JSON.stringify(saveResult, null, 2)}`);
  }

  await page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => undefined);
  await waitForPageFunction(
    page,
    "placement viewer save smoke did not reload the persisted primitive instance",
    ({ id, spriteId, prefabId, objectDefinitionId, objectDefinitionInstanceId }) => {
      const state = globalThis.ferrumPlacementViewerState;
      const instance = state?.instances?.find((candidate) => candidate.instanceId === id);
      const sprite = state?.instances?.find((candidate) => candidate.instanceId === spriteId);
      const prefab = state?.instances?.find((candidate) => candidate.instanceId === prefabId);
      const objectDefinition = state?.objectDefinitions?.find((candidate) => candidate.id === objectDefinitionId);
      const objectDefinitionInstance = state?.instances?.find((candidate) =>
        candidate.instanceId === objectDefinitionInstanceId
      );
      return Boolean(
        globalThis.ferrumPlacementViewerSaveEnabled === true
        && state?.instances?.length === 10
        && state.draftPatch === undefined
        && instance?.visual?.kind === "primitive"
        && instance.visual.shape === "rect"
        && instance.visual.bounds.width === 72
        && instance.visual.bounds.height === 28
        && instance.collider?.type === "circle"
        && instance.collider.radius === 18
        && instance.collider.offsetX === 5
        && instance.collider.offsetY === -3
        && instance.collider.isTrigger === true
        && instance.componentLayer?.name === "pickup"
        && sprite?.visual?.kind === "sprite"
        && sprite.visual.texture.name === "turret"
        && sprite.visual.frame.u0 === 0.5
        && sprite.collider?.type === "aabb"
        && sprite.componentLayer?.name === "enemy"
        && prefab?.prefab === "crate"
        && prefab.visual?.kind === "sprite"
        && objectDefinition?.visual?.kind === "primitive"
        && objectDefinition.collider?.type === "circle"
        && objectDefinition.componentLayer?.name === "pickup"
        && objectDefinitionInstance?.prefab === objectDefinitionId
        && objectDefinitionInstance.visual?.kind === "primitive"
        && objectDefinitionInstance.collider?.type === "circle"
      );
    },
    timeoutMs,
    {
      id: instanceId,
      spriteId: spriteInstanceId,
      prefabId: prefabInstanceId,
      objectDefinitionId: definitionId,
      objectDefinitionInstanceId: definitionInstanceId,
    },
  );

  return await page.evaluate(({ id, spriteId, prefabId, objectDefinitionId, objectDefinitionInstanceId }) => {
    const state = globalThis.ferrumPlacementViewerState;
    const instance = state?.instances?.find((candidate) => candidate.instanceId === id);
    const sprite = state?.instances?.find((candidate) => candidate.instanceId === spriteId);
    const prefab = state?.instances?.find((candidate) => candidate.instanceId === prefabId);
    const objectDefinition = state?.objectDefinitions?.find((candidate) => candidate.id === objectDefinitionId);
    const objectDefinitionInstance = state?.instances?.find((candidate) =>
      candidate.instanceId === objectDefinitionInstanceId
    );
    return {
      placementViewerSaveSmoke: {
        instanceId: id,
        spriteInstanceId: spriteId,
        prefabInstanceId: prefabId,
        definitionId: objectDefinitionId,
        definitionInstanceId: objectDefinitionInstanceId,
        instanceCount: state?.instances?.length ?? 0,
        draftPatch: state?.draftPatch,
        savedDocumentInstanceCount:
          globalThis.ferrumPlacementViewerSavedDocument?.sceneComposition?.fragments?.main?.instances?.length,
        visual: instance?.visual,
        collider: instance?.collider,
        componentLayer: instance?.componentLayer,
        spriteVisual: sprite?.visual,
        prefab: prefab?.prefab,
        objectDefinition,
        objectDefinitionInstancePrefab: objectDefinitionInstance?.prefab,
      },
    };
  }, {
    id: instanceId,
    spriteId: spriteInstanceId,
    prefabId: prefabInstanceId,
    objectDefinitionId: definitionId,
    objectDefinitionInstanceId: definitionInstanceId,
  });
}

async function smokePlacementViewerMassAuthoring(page, timeoutMs) {
  await waitForPageFunction(
    page,
    "placement viewer mass authoring smoke did not load 1000+ authoring instances",
    ({ minInstanceCount, maxDrawCalls }) => {
      const state = globalThis.ferrumPlacementViewerState;
      const frame = globalThis.ferrumPlacementViewerRuntimeFrame;
      return Boolean(
        state?.instances?.length >= minInstanceCount
        && frame?.entityCount >= minInstanceCount
        && frame.renderCommandCount >= minInstanceCount
        && frame.drawCalls >= 1
        && frame.drawCalls <= maxDrawCalls
      );
    },
    timeoutMs,
    {
      minInstanceCount: PLACEMENT_VIEWER_MASS_AUTHORING_MIN_INSTANCE_COUNT,
      maxDrawCalls: PLACEMENT_VIEWER_MASS_AUTHORING_MAX_DRAW_CALLS,
    },
  );
  const targetInstanceId = "mass_crate_0512";
  const actionReport = await page.evaluate(({ targetId }) => {
    const beforeSelect = performance.now();
    const selectedState = globalThis.ferrumPlacementViewerSelect?.(targetId);
    const selectMs = performance.now() - beforeSelect;
    const selected = selectedState?.instances?.find((instance) => instance.instanceId === targetId);
    if (selected === undefined) {
      throw new Error(`placement viewer mass authoring could not select ${targetId}.`);
    }
    const beforePatch = performance.now();
    const patchedState = globalThis.ferrumPlacementViewerUpdateTransform?.(targetId, {
      x: selected.transform.x + 16,
      y: selected.transform.y + 16,
    });
    const patchMs = performance.now() - beforePatch;
    const patch = globalThis.ferrumPlacementViewerExportPatch?.();
    return {
      selectedInstanceId: patchedState?.selectedInstanceId,
      instanceCount: patchedState?.instances?.length ?? 0,
      draftOperationCount: patch?.operations?.length ?? 0,
      draftMarkerCount: document.querySelectorAll(".placement-draft-marker").length,
      selectedButtonActive:
        document.querySelector(`button[data-instance-id='${targetId}']`)?.getAttribute("data-selected") === "true",
      handoffSelectedInstanceId: globalThis.ferrumPlacementViewerAgentHandoff?.selectedInstanceId,
      handoffDraftOperationCount:
        globalThis.ferrumPlacementViewerAgentHandoff?.draftPatch?.operations?.length ?? 0,
      selectMs,
      patchMs,
      frame: globalThis.ferrumPlacementViewerRuntimeFrame,
    };
  }, { targetId: targetInstanceId });
  if (
    actionReport.selectedInstanceId !== targetInstanceId
    || actionReport.instanceCount < PLACEMENT_VIEWER_MASS_AUTHORING_MIN_INSTANCE_COUNT
    || actionReport.draftOperationCount !== 1
    || actionReport.draftMarkerCount !== 1
    || actionReport.selectedButtonActive !== true
    || actionReport.handoffSelectedInstanceId !== targetInstanceId
    || actionReport.handoffDraftOperationCount !== 1
    || actionReport.selectMs > PLACEMENT_VIEWER_MASS_AUTHORING_MAX_SELECTION_MS
    || actionReport.patchMs > PLACEMENT_VIEWER_MASS_AUTHORING_MAX_PATCH_MS
  ) {
    throw new Error(`placement viewer mass authoring action mismatch:\n${JSON.stringify(actionReport, null, 2)}`);
  }

  return {
    placementViewerMassAuthoringSmoke: {
      targetInstanceId,
      minInstanceCount: PLACEMENT_VIEWER_MASS_AUTHORING_MIN_INSTANCE_COUNT,
      maxDrawCalls: PLACEMENT_VIEWER_MASS_AUTHORING_MAX_DRAW_CALLS,
      maxSelectionMs: PLACEMENT_VIEWER_MASS_AUTHORING_MAX_SELECTION_MS,
      maxPatchMs: PLACEMENT_VIEWER_MASS_AUTHORING_MAX_PATCH_MS,
      actionReport,
    },
  };
}

async function smokeStarterRuntime(page, timeoutMs) {
  await waitForPageFunction(
    page,
    "starter runtime profile panel was not rendered",
    () => Boolean(document.querySelector("[data-starter-runtime-profile-panel='true']")),
    timeoutMs,
  );
  const initial = await page.evaluate(() => {
    const captureReport = globalThis.ferrumStarterRuntimeCaptureReport;
    const applyWeaponProfile = globalThis.ferrumStarterRuntimeApplyWeaponProfile;
    if (typeof captureReport !== "function" || typeof applyWeaponProfile !== "function") {
      throw new Error("Starter Runtime profile/report hooks are missing.");
    }
    const initial = captureReport();
    if (initial.format !== "ferrum2d.starter-runtime.report") {
      throw new Error(`Starter Runtime report format mismatch: ${initial.format}`);
    }
    if (initial.weaponProfile !== "standard") {
      throw new Error(`Starter Runtime initial weapon profile mismatch: ${initial.weaponProfile}`);
    }
    if (initial.projectileVisual !== "Tiny green pellet" || initial.projectileTextureId !== 21) {
      throw new Error(`Starter Runtime initial projectile visual mismatch: ${JSON.stringify(initial)}`);
    }
    const standardButton = document.querySelector("[data-starter-profile-button='standard']");
    if (standardButton?.getAttribute("aria-pressed") !== "true") {
      throw new Error("Starter Runtime standard profile button is not active.");
    }
    return {
      label: initial.label,
      weaponProfile: initial.weaponProfile,
      profileSwitchCount: initial.profileSwitchCount,
      captureCount: initial.captureCount,
      lastPanelAction: initial.lastPanelAction,
      projectileVisual: initial.projectileVisual,
      projectileTextureId: initial.projectileTextureId,
      projectileWidth: initial.projectileWidth,
      projectileHeight: initial.projectileHeight,
      fireCooldownSeconds: initial.fireCooldownSeconds,
      replayHash: initial.replayHash,
      comparisonPassed: initial.comparison.passed,
    };
  });

  const populated = await waitForStarterRuntimePopulation(page, timeoutMs);
  await page.click("[data-starter-profile-button='piercing']", { timeout: timeoutMs });
  const piercing = await waitForStarterRuntimeProfile(page, "piercing", "Piercing", timeoutMs, populated);
  await page.click("[data-starter-profile-button='bounce']", { timeout: timeoutMs });
  const switched = await waitForStarterRuntimeProfile(page, "bounce", "Bounce", timeoutMs);
  const projectile = await waitForStarterRuntimeProjectileVisual(page, timeoutMs);
  await page.click("[data-starter-capture-button='true']", { timeout: timeoutMs });
  const captured = await waitForStarterRuntimeCapture(page, switched.captureCount, timeoutMs);

  return {
    starterRuntime: {
      initial,
      populated,
      piercing,
      switched,
      projectile,
      captured,
    },
  };
}

async function waitForStarterRuntimePopulation(page, timeoutMs) {
  await waitForPageFunction(
    page,
    "starter runtime enemy population was not preserved for profile switching smoke",
    () => (globalThis.ferrumRuntime?.engine?.entityCount?.() ?? 0) >= 2,
    timeoutMs,
  );
  return await page.evaluate(() => ({
    entityCount: globalThis.ferrumRuntime?.engine?.entityCount?.() ?? 0,
    timeSeconds: globalThis.ferrumRuntime?.engine?.time?.() ?? 0,
  }));
}

async function waitForStarterRuntimeProfile(page, profile, label, timeoutMs, beforeOverride) {
  const visual = STARTER_RUNTIME_WEAPON_PROFILE_VISUALS[profile];
  const before = beforeOverride ?? await page.evaluate(() => ({
    entityCount: globalThis.ferrumRuntime?.engine?.entityCount?.() ?? 0,
    timeSeconds: globalThis.ferrumRuntime?.engine?.time?.() ?? 0,
  }));
  await waitForPageFunction(
    page,
    `starter runtime ${label} button click was not reflected`,
    ({ profile, label, visual, before }) => {
      const panel = document.querySelector("[data-starter-runtime-profile-panel='true']");
      const button = document.querySelector(`[data-starter-profile-button='${profile}']`);
      const runtime = globalThis.ferrumRuntime;
      const report = globalThis.ferrumStarterRuntimeReport;
      return Boolean(
        globalThis.ferrumStarterRuntimeWeaponProfile === profile
        && (runtime?.engine?.gameState?.() ?? 0) === 1
        && (runtime?.engine?.time?.() ?? 0) >= before.timeSeconds
        && (runtime?.engine?.entityCount?.() ?? 0) >= before.entityCount
        && report?.weaponProfile === profile
        && report?.weaponProfileSummary?.length > 0
        && report?.projectileVisual === visual.label
        && report?.projectileTextureId === visual.textureId
        && report?.projectileWidth === visual.width
        && report?.projectileHeight === visual.height
        && Math.abs((report?.fireCooldownSeconds ?? 0) - visual.cooldownSeconds) < 0.000001
        && panel?.textContent?.includes(label)
        && panel?.textContent?.includes(`${label} applied`)
        && panel?.textContent?.includes(visual.label)
        && panel?.textContent?.includes(`${visual.width}x${visual.height}`)
        && button?.getAttribute("aria-pressed") === "true"
        && button?.classList.contains("is-active"),
      );
    },
    timeoutMs,
    { profile, label, visual, before },
  );
  return await page.evaluate((profile) => {
    const report = globalThis.ferrumStarterRuntimeReport;
    if (!report) {
      throw new Error("Starter Runtime report is missing after profile click.");
    }
    const button = document.querySelector(`[data-starter-profile-button='${profile}']`);
    return {
      label: report.label,
      weaponProfile: report.weaponProfile,
      profileSwitchCount: report.profileSwitchCount,
      captureCount: report.captureCount,
      lastPanelAction: report.lastPanelAction,
      projectileVisual: report.projectileVisual,
      projectileTextureId: report.projectileTextureId,
      projectileWidth: report.projectileWidth,
      projectileHeight: report.projectileHeight,
      fireCooldownSeconds: report.fireCooldownSeconds,
      replayHash: report.replayHash,
      comparisonPassed: report.comparison.passed,
      entityCount: globalThis.ferrumRuntime?.engine?.entityCount?.() ?? 0,
      timeSeconds: globalThis.ferrumRuntime?.engine?.time?.() ?? 0,
      activeButton: button?.textContent ?? "",
    };
  }, profile);
}

async function waitForStarterRuntimeProjectileVisual(page, timeoutMs) {
  await page.keyboard.down("Space");
  await page.waitForTimeout(650);
  await page.keyboard.up("Space");
  await waitForPageFunction(
    page,
    "starter runtime projectile visual texture was not rendered",
    ({ expectedTextureId }) => {
      const runtime = globalThis.ferrumRuntime;
      const stats = runtime?.renderer?.stats?.();
      return Boolean(
        globalThis.ferrumStarterRuntimeReport?.projectileTextureId === expectedTextureId
        && (runtime?.engine?.entityCount?.() ?? 0) >= 2
        && (stats?.renderCommandCount ?? 0) >= 2
        && (stats?.textureSwitchCount ?? 0) >= 1,
      );
    },
    timeoutMs,
    { expectedTextureId: STARTER_RUNTIME_WEAPON_PROFILE_VISUALS.bounce.textureId },
  );
  return await page.evaluate(() => {
    const stats = globalThis.ferrumRuntime?.renderer?.stats?.();
    return {
      entityCount: globalThis.ferrumRuntime?.engine?.entityCount?.() ?? 0,
      renderCommandCount: stats?.renderCommandCount ?? 0,
      textureSwitchCount: stats?.textureSwitchCount ?? 0,
      projectileTextureId: globalThis.ferrumStarterRuntimeReport?.projectileTextureId,
      projectileVisual: globalThis.ferrumStarterRuntimeReport?.projectileVisual,
      projectileWidth: globalThis.ferrumStarterRuntimeReport?.projectileWidth,
      projectileHeight: globalThis.ferrumStarterRuntimeReport?.projectileHeight,
    };
  });
}

async function waitForStarterRuntimeCapture(page, previousCaptureCount, timeoutMs) {
  await waitForPageFunction(
    page,
    "starter runtime capture button click was not reflected",
    ({ previousCaptureCount }) => {
      const panel = document.querySelector("[data-starter-runtime-profile-panel='true']");
      const report = globalThis.ferrumStarterRuntimeReport;
      const nextCaptureCount = previousCaptureCount + 1;
      const expectedStatus = `Report captured #${nextCaptureCount}`;
      return Boolean(
        report?.captureCount === nextCaptureCount
        && report?.lastPanelAction === expectedStatus
        && panel?.textContent?.includes(expectedStatus)
        && panel?.textContent?.includes(`Reports${nextCaptureCount}`),
      );
    },
    timeoutMs,
    { previousCaptureCount },
  );
  return await page.evaluate(() => {
    const report = globalThis.ferrumStarterRuntimeReport;
    if (!report) {
      throw new Error("Starter Runtime report is missing after capture click.");
    }
    return {
      label: report.label,
      weaponProfile: report.weaponProfile,
      profileSwitchCount: report.profileSwitchCount,
      captureCount: report.captureCount,
      lastPanelAction: report.lastPanelAction,
      projectileVisual: report.projectileVisual,
      projectileTextureId: report.projectileTextureId,
      projectileWidth: report.projectileWidth,
      projectileHeight: report.projectileHeight,
      fireCooldownSeconds: report.fireCooldownSeconds,
      replayHash: report.replayHash,
      comparisonPassed: report.comparison.passed,
    };
  });
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
    const snapshot = profiler.snapshot();
    const memory = globalThis.performance?.memory;
    if (memory && Number.isFinite(memory.usedJSHeapSize)) {
      snapshot.jsHeapUsedBytes = memory.usedJSHeapSize;
      snapshot.maxJsHeapUsedBytes = memory.usedJSHeapSize;
      if (Number.isFinite(memory.totalJSHeapSize)) {
        snapshot.jsHeapTotalBytes = memory.totalJSHeapSize;
      }
      if (Number.isFinite(memory.jsHeapSizeLimit)) {
        snapshot.jsHeapLimitBytes = memory.jsHeapSizeLimit;
      }
    } else {
      snapshot.jsHeapMetricUnavailable = true;
    }
    return snapshot;
  });
  const report = evaluateRuntimeBudgetSnapshot(snapshot, budget);
  return {
    runtimeBudget: {
      budget,
      report,
      snapshot,
    },
  };
}

async function writeRuntimeBudgetArtifact({ url, distDir, mode, budgetProfile, runtimeBudget }) {
  const artifactDir = process.env.FERRUM_BROWSER_SMOKE_BUDGET_ARTIFACT_DIR;
  if (!artifactDir || runtimeBudget === undefined) {
    return {};
  }
  await mkdir(artifactDir, { recursive: true });
  const artifactName = `${safeArtifactSegment(mode)}-${safeArtifactSegment(budgetProfile ?? "default")}.json`;
  const artifactPath = join(artifactDir, artifactName);
  const payload = {
    format: "ferrum2d.browser-smoke.runtime-budget-report",
    version: 1,
    recordedAt: new Date().toISOString(),
    mode,
    budgetProfile: budgetProfile ?? null,
    distDir,
    url,
    runtimeBudget,
  };
  await writeFile(artifactPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return { runtimeBudgetArtifact: artifactPath };
}

function safeArtifactSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/gu, "-");
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

async function smokeContentRuntime(page, timeoutMs) {
  const expectedBody = "Ferrum2D localized cutscene online for Minimal Game.";
  const expectedHud = "Content runtime HUD connected through createFerrumRuntime.";
  const expectedSubtitle = "Accessibility subtitles connected through createFerrumRuntime.";
  await waitForPageFunction(
    page,
    "content runtime smoke did not expose localized cutscene dialog, HUD, and subtitles",
    ({ expectedBody, expectedHud, expectedSubtitle }) => {
      const frame = globalThis.ferrumContentRuntimeSmokeFrame;
      const animation = globalThis.ferrumContentRuntimeAnimationFrame;
      const dialog = document.querySelector("[data-ferrum-ui-dialog='minimal-content-cutscene']");
      const hud = document.querySelector("[data-ferrum-ui-panel='minimal-content-hud']");
      const subtitles = document.querySelector("[data-ferrum-ui-panel='minimal-content-subtitles']");
      return Boolean(
        frame
        && frame.sequenceId === "minimal-content-runtime"
        && frame.locale === "en"
        && frame.dialogId === "minimal-content-cutscene"
        && frame.title === "Runtime Cutscene"
        && frame.body === expectedBody
        && frame.dialogueEventObserved === true
        && frame.renderCommandCount > 0
        && frame.gameState === 1
        && animation?.state === "runtime"
        && animation?.eventObserved === true
        && animation?.renderCommandCount > 0
        && animation?.gameState === 1
        && dialog?.textContent?.includes(expectedBody)
        && hud?.textContent?.includes("Runtime HUD")
        && hud?.textContent?.includes(expectedHud)
        && hud?.textContent?.includes("State")
        && subtitles?.textContent?.includes("Runtime Subtitles")
        && subtitles?.textContent?.includes(expectedSubtitle)
      );
    },
    timeoutMs,
    { expectedBody, expectedHud, expectedSubtitle },
  );
  return await page.evaluate(() => ({
    contentRuntimeSmoke: {
      frame: globalThis.ferrumContentRuntimeSmokeFrame,
      animation: globalThis.ferrumContentRuntimeAnimationFrame,
      dialogText: document.querySelector("[data-ferrum-ui-dialog='minimal-content-cutscene']")?.textContent ?? "",
      hudText: document.querySelector("[data-ferrum-ui-panel='minimal-content-hud']")?.textContent ?? "",
      subtitleText: document.querySelector("[data-ferrum-ui-panel='minimal-content-subtitles']")?.textContent ?? "",
    },
  }));
}

function evaluateRuntimeBudgetSnapshot(snapshot, budget) {
  const violations = [];
  for (const [id, label, snapshotField, unit] of RUNTIME_BUDGET_FIELDS) {
    const limit = budget[id];
    const actual = snapshot[snapshotField];
    if (limit === undefined) {
      continue;
    }
    if (actual === undefined) {
      violations.push({ id, label, actual: null, limit, unit, reason: "missingMetric" });
      continue;
    }
    if (!Number.isFinite(actual)) {
      violations.push({ id, label, actual: null, limit, unit, reason: "nonFiniteMetric" });
      continue;
    }
    if (actual > limit) {
      violations.push({ id, label, actual, limit, unit });
    }
  }
  return {
    passed: violations.length === 0,
    violations,
  };
}

async function smokeTopdownAuthoredBehaviorVariant(page, timeoutMs, expectedReplayHash) {
  await waitForPageFunction(
    page,
    "Top-down authored behavior variant smoke did not expose variant summary",
    () => globalThis.ferrumTopdownAuthoredBehaviorVariant?.replayScenario === "example-topdown-authored-behavior",
    timeoutMs,
  );
  await page.evaluate(({ expectedReplayHash }) => {
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
    if (summary.expectedReplayHash !== expectedReplayHash) {
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
  }, { expectedReplayHash });
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
      stateCommandApply.resultCounts?.["interaction-source"] !== 12 ||
      stateCommandApply.resultCounts?.["test-projectile"] !== 13 ||
      stateCommandApply.resultCounts?.["timer-source"] !== 12
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
      stateCommandApply.resultCounts?.["interaction-source"] !== 12 ||
      stateCommandApply.resultCounts?.["test-projectile"] !== 13 ||
      stateCommandApply.resultCounts?.["timer-source"] !== 12
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

async function smokeTopdownMassObjects(page, timeoutMs) {
  await waitForPageFunction(
    page,
    "Top-down Shooter mass object smoke did not restore and render 1000+ objects",
    ({ playingState, collisionPairBudget }) => {
      const frame = globalThis.ferrumTopdownMassObjectsSmokeFrame;
      if (!frame) {
        return false;
      }
      return frame.restored === true
        && frame.gameState === playingState
        && frame.enemyCount >= 1024
        && frame.entityCount >= 1025
        && frame.snapshotEntityCount >= 1025
        && frame.renderCommandCount >= 1024
        && frame.maxRenderCommandCount >= 1024
        && frame.spriteCount >= 1024
        && frame.drawCalls >= 1
        && frame.drawCalls <= 8
        && frame.textureSwitchCount <= 8
        && frame.collisionPairCount >= 0
        && frame.collisionPairCount <= collisionPairBudget
        && frame.maxCollisionPairCount >= 0
        && frame.maxCollisionPairCount <= collisionPairBudget;
    },
    timeoutMs,
    {
      playingState: TOPDOWN_MASS_OBJECTS_PLAYING_STATE,
      collisionPairBudget: TOPDOWN_MASS_OBJECTS_COLLISION_PAIR_BUDGET,
    },
  );
  return await page.evaluate(() => ({
    topdownMassObjectsSmoke: globalThis.ferrumTopdownMassObjectsSmokeFrame,
    rendererStats: globalThis.ferrumRuntime?.renderer?.stats?.(),
    entityCountAfterMassObjects: globalThis.ferrumEngine?.entityCount?.() ?? 0,
    spriteCountAfterMassObjects: globalThis.ferrumEngine?.spriteCount?.() ?? 0,
  }));
}

async function smokeTopdownTilemapBudget(page, timeoutMs) {
  await page.evaluate((spec) => {
    const engine = globalThis.ferrumEngine;
    if (!engine) {
      throw new Error("Top-down tilemap budget smoke requires window.ferrumEngine.");
    }
    engine.setGameSpec(spec);
    engine.clearParticles();
    engine.resetGame();
  }, TOPDOWN_TILEMAP_BUDGET_SMOKE_SPEC);

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
    "Top-down tilemap budget smoke did not render the dense tilemap within renderer budgets",
    ({ expectedTileCount, maxDrawCalls, maxTextureSwitches }) => {
      const engine = globalThis.ferrumEngine;
      const stats = globalThis.ferrumRuntime?.renderer?.stats?.();
      return Boolean(
        engine?.gameState?.() === 1
        && stats
        && stats.renderCommandCount >= expectedTileCount
        && stats.spriteCount >= expectedTileCount
        && stats.drawCalls >= 1
        && stats.drawCalls <= maxDrawCalls
        && stats.textureSwitchCount <= maxTextureSwitches
      );
    },
    timeoutMs,
    {
      expectedTileCount: TOPDOWN_TILEMAP_BUDGET_TILE_COUNT,
      maxDrawCalls: TOPDOWN_TILEMAP_BUDGET_MAX_DRAW_CALLS,
      maxTextureSwitches: TOPDOWN_TILEMAP_BUDGET_MAX_TEXTURE_SWITCHES,
    },
  );

  return await page.evaluate((expectedTileCount) => {
    const stats = globalThis.ferrumRuntime?.renderer?.stats?.();
    const engine = globalThis.ferrumEngine;
    return {
      topdownTilemapBudgetSmoke: {
        expectedTileCount,
        gameState: engine?.gameState?.() ?? -1,
        entityCount: engine?.entityCount?.() ?? 0,
        engineSpriteCount: engine?.spriteCount?.() ?? 0,
        renderCommandCount: stats?.renderCommandCount ?? 0,
        spriteCount: stats?.spriteCount ?? 0,
        drawCalls: stats?.drawCalls ?? 0,
        batchCount: stats?.batchCount ?? 0,
        textureBindCount: stats?.textureBindCount ?? 0,
        textureSwitchCount: stats?.textureSwitchCount ?? 0,
        rendererStats: stats,
      },
    };
  }, TOPDOWN_TILEMAP_BUDGET_TILE_COUNT);
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
  } = await import("../../packages/ferrum-web/dist/gameplayReplay.js");
  const {
    hashGameStateSnapshot,
  } = await import("../../packages/ferrum-web/dist/gameStateSnapshot.js");
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
        && frame.visibleBodyCount >= 2
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
