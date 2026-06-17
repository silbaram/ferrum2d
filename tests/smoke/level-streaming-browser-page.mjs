import {
  BrowserPlatformHost,
  createRuntimeLevelStreaming,
  RuntimeProfiler,
  WebGL2Renderer,
} from "/packages/ferrum-web/dist/index.js";

const SPRITE_RENDER_COMMAND_FLOATS = 15;
const COMMAND_COUNT = 256;
const TILE_SIZE = 8;
const TEXTURE_LOCAL_A = "/assets/streaming-local-a.png";
const TEXTURE_LOCAL_B = "/assets/streaming-local-b.png";
const TEXTURE_SHARED = "/assets/streaming-shared.png";
const FRAME_BUDGET = Object.freeze({
  maxFrameTimeMs: 120,
  maxRustUpdateTimeMs: 1,
  maxRenderTimeMs: 120,
  maxDrawCalls: 2,
  maxRenderCommandCount: COMMAND_COUNT,
  maxTextureSwitchCount: 1,
  maxPhysicsFixedSteps: 0,
  maxPhysicsSolidCandidateChecks: 0,
  maxPhysicsTileCandidateChecks: 0,
  maxCollisionPairCount: 0,
  maxAssetLoadElapsedMs: 1_000,
});

runLevelStreamingBrowserSmoke()
  .then((report) => {
    globalThis.ferrumLevelStreamingBrowserSmoke = report;
  })
  .catch((error) => {
    globalThis.ferrumLevelStreamingBrowserSmokeError = {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    };
    console.error(error);
  });

async function runLevelStreamingBrowserSmoke() {
  const canvas = document.querySelector("#game");
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error("Level streaming browser smoke requires #game canvas.");
  }

  const renderer = new WebGL2Renderer(canvas, {
    clearColor: [0.03, 0.04, 0.06, 1],
    preserveDrawingBuffer: true,
  });
  const evictedTextureIds = [];
  const evictTexture = renderer.evictTexture.bind(renderer);
  renderer.evictTexture = (textureId) => {
    const evicted = evictTexture(textureId);
    if (evicted) {
      evictedTextureIds.push(textureId);
    }
    return evicted;
  };

  const platform = new BrowserPlatformHost(renderer);
  const profiler = new RuntimeProfiler({
    budget: FRAME_BUDGET,
    maxFrameSamples: 4,
    maxAssetSamples: 16,
  });
  const pendingLoads = [];
  const loadedTextureNames = new Set();
  const loadProgress = [];
  const targetLoads = [];
  const targetUnloads = [];
  const releasePayloads = [];
  const colliderRebuilds = [];
  let viewport = { x: 0, y: 0, width: 32, height: 32 };

  const levelStreaming = createRuntimeLevelStreaming({
    manifest: {
      id: "browser-streaming-map",
      tileWidth: 16,
      tileHeight: 16,
      chunkColumns: 4,
      chunkRows: 4,
      chunks: [
        {
          id: "0,0",
          chunkX: 0,
          chunkY: 0,
          tilemap: { url: "/chunks/0-0.json" },
          assets: {
            textures: {
              terrainLocal: TEXTURE_LOCAL_A,
              terrainShared: TEXTURE_SHARED,
            },
          },
        },
        {
          id: "1,0",
          chunkX: 1,
          chunkY: 0,
          tilemap: { url: "/chunks/1-0.json" },
          assets: {
            textures: {
              terrainLocalNext: TEXTURE_LOCAL_B,
              terrainShared: TEXTURE_SHARED,
            },
          },
        },
      ],
    },
    assetLifetime: { preloadMarginChunks: 0, retainMarginChunks: 0 },
    viewport: () => viewport,
    preload: false,
    target: {
      applyChunk: (chunk, context) => {
        targetLoads.push(chunk.id);
        if (!context.result.loadChunkIds.includes(chunk.id)) {
          throw new Error(`applyChunk received a chunk outside loadChunkIds: ${chunk.id}`);
        }
        queueTextureLoad(platform, profiler, pendingLoads, loadedTextureNames, chunk.assets.textures, loadProgress);
      },
      unloadChunk: (chunk, context) => {
        targetUnloads.push(chunk.id);
        if (!context.result.unloadChunkIds.includes(chunk.id)) {
          throw new Error(`unloadChunk received a chunk outside unloadChunkIds: ${chunk.id}`);
        }
      },
      releaseAssets: (assets, context) => {
        if (context.result.releasedAssets !== assets) {
          throw new Error("releaseAssets did not receive the update result release payload.");
        }
        releasePayloads.push(assets.entries.map((entry) => `${entry.kind}:${entry.name}:${entry.url}`));
        platform.releaseAssets(assets);
      },
      rebuildColliders: (context) => {
        colliderRebuilds.push({
          loaded: [...context.result.snapshot.loadedChunkIds],
          load: [...context.result.loadChunkIds],
          unload: [...context.result.unloadChunkIds],
        });
      },
    },
  }, () => renderer.viewportSize(), (progress) => {
    profiler.recordAssetProgress(progress);
    loadProgress.push(progressSummary(progress));
  });

  const firstUpdate = levelStreaming.update(runtimeFrame());
  await drainPendingLoads(pendingLoads);
  const terrainLocalTextureId = platform.textureId("terrainLocal");
  const terrainSharedTextureId = platform.textureId("terrainShared");
  const firstFrame = renderStreamingFrame(
    renderer,
    profiler,
    terrainLocalTextureId,
    terrainSharedTextureId,
    "first",
  );

  viewport = { x: 80, y: 0, width: 32, height: 32 };
  const secondUpdate = levelStreaming.update(runtimeFrame());
  await drainPendingLoads(pendingLoads);
  const terrainLocalNextTextureId = platform.textureId("terrainLocalNext");
  const secondFrame = renderStreamingFrame(
    renderer,
    profiler,
    terrainLocalNextTextureId,
    terrainSharedTextureId,
    "second",
  );
  const profilerSnapshot = profiler.snapshot();
  const pixelSummary = canvasPixelSummary(canvas);

  assertSmokeResult({
    firstUpdate,
    secondUpdate,
    firstFrame,
    secondFrame,
    profilerSnapshot,
    pixelSummary,
    targetLoads,
    targetUnloads,
    releasePayloads,
    evictedTextureIds,
    terrainLocalTextureId,
    terrainLocalNextTextureId,
    terrainSharedTextureId,
    runtimeSnapshot: levelStreaming.snapshot(),
    colliderRebuilds,
  });

  return {
    manifestId: "browser-streaming-map",
    firstActive: firstUpdate?.plan.activeChunkIds ?? [],
    secondActive: secondUpdate?.plan.activeChunkIds ?? [],
    targetLoads,
    targetUnloads,
    releasePayloads,
    evictedTextureIds,
    textureIds: {
      terrainLocal: terrainLocalTextureId,
      terrainLocalNext: terrainLocalNextTextureId,
      terrainShared: terrainSharedTextureId,
    },
    firstFrame,
    secondFrame,
    profilerSnapshot,
    pixelSummary,
    runtimeSnapshot: levelStreaming.snapshot(),
    colliderRebuilds,
    loadProgress,
    budget: FRAME_BUDGET,
  };
}

function queueTextureLoad(platform, profiler, pendingLoads, loadedTextureNames, textures, loadProgress) {
  const pendingTextures = {};
  for (const [name, url] of Object.entries(textures ?? {})) {
    if (!loadedTextureNames.has(name)) {
      pendingTextures[name] = url;
    }
  }
  if (Object.keys(pendingTextures).length === 0) {
    return;
  }

  pendingLoads.push(
    platform.loadAssets({ textures: pendingTextures }, (progress) => {
      profiler.recordAssetProgress(progress);
      loadProgress.push(progressSummary(progress));
    }).then(() => {
      for (const name of Object.keys(pendingTextures)) {
        loadedTextureNames.add(name);
      }
    }),
  );
}

async function drainPendingLoads(pendingLoads) {
  while (pendingLoads.length > 0) {
    const loads = pendingLoads.splice(0);
    await Promise.all(loads);
  }
}

function renderStreamingFrame(renderer, profiler, localTextureId, sharedTextureId, label) {
  const commands = commandBuffer(localTextureId, sharedTextureId);
  const startedAt = performance.now();
  renderer.render();
  const stats = renderer.renderCommands(commands);
  const renderTimeMs = performance.now() - startedAt;
  const metrics = {
    fps: 60,
    frameTimeMs: renderTimeMs,
    rustUpdateTimeMs: 0,
    renderTimeMs,
    entityCount: COMMAND_COUNT,
    spriteCount: stats.spriteCount,
    drawCalls: stats.drawCalls,
    batchCount: stats.batchCount,
    renderCommandCount: stats.renderCommandCount,
    textureBindCount: stats.textureBindCount,
    textureSwitchCount: stats.textureSwitchCount,
    physicsFixedSteps: 0,
    physicsSolidCandidateChecks: 0,
    physicsTileCandidateChecks: 0,
    collisionPairCount: 0,
  };
  const budgetReport = profiler.recordFrame(metrics);
  return {
    label,
    localTextureId,
    sharedTextureId,
    renderTimeMs,
    stats,
    metrics,
    budgetReport,
  };
}

function commandBuffer(localTextureId, sharedTextureId) {
  const buffer = new Float32Array(COMMAND_COUNT * SPRITE_RENDER_COMMAND_FLOATS);
  const columns = 16;
  for (let index = 0; index < COMMAND_COUNT; index += 1) {
    const offset = index * SPRITE_RENDER_COMMAND_FLOATS;
    const textureId = index < COMMAND_COUNT / 2 ? localTextureId : sharedTextureId;
    buffer[offset] = 16 + (index % columns) * TILE_SIZE;
    buffer[offset + 1] = 16 + Math.floor(index / columns) * TILE_SIZE;
    buffer[offset + 2] = TILE_SIZE;
    buffer[offset + 3] = TILE_SIZE;
    buffer[offset + 4] = 0;
    buffer[offset + 5] = 0;
    buffer[offset + 6] = 1;
    buffer[offset + 7] = 1;
    buffer[offset + 8] = 1;
    buffer[offset + 9] = 1;
    buffer[offset + 10] = 1;
    buffer[offset + 11] = 1;
    buffer[offset + 12] = textureId;
    buffer[offset + 13] = 0;
    buffer[offset + 14] = 0;
  }
  return {
    buffer,
    commandCount: COMMAND_COUNT,
    floatsPerCommand: SPRITE_RENDER_COMMAND_FLOATS,
  };
}

function canvasPixelSummary(canvas) {
  const gl = canvas.getContext("webgl2");
  if (!gl) {
    throw new Error("WebGL2 context is not available for pixel summary.");
  }
  const pixels = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let greenPixelCount = 0;
  let magentaPixelCount = 0;
  let nonBackgroundPixelCount = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const r = pixels[index];
    const g = pixels[index + 1];
    const b = pixels[index + 2];
    if (g > 120 && r < 120 && b < 140) {
      greenPixelCount += 1;
    }
    if (r > 120 && b > 120 && g < 140) {
      magentaPixelCount += 1;
    }
    if (r > 40 || g > 55 || b > 70) {
      nonBackgroundPixelCount += 1;
    }
  }
  return {
    width: canvas.width,
    height: canvas.height,
    greenPixelCount,
    magentaPixelCount,
    nonBackgroundPixelCount,
  };
}

function assertSmokeResult(report) {
  const errors = [];
  if (report.firstUpdate?.plan.activeChunkIds.join(",") !== "0,0") {
    errors.push("first update must activate chunk 0,0");
  }
  if (report.secondUpdate?.plan.activeChunkIds.join(",") !== "1,0") {
    errors.push("second update must activate chunk 1,0");
  }
  if (report.secondUpdate?.unloadChunkIds.join(",") !== "0,0") {
    errors.push("second update must unload chunk 0,0");
  }
  if (report.runtimeSnapshot.loadedChunkIds.join(",") !== "1,0") {
    errors.push("runtime snapshot must retain only chunk 1,0");
  }
  if (report.targetLoads.join(",") !== "0,0,1,0") {
    errors.push(`target loads mismatch: ${report.targetLoads.join(",")}`);
  }
  if (report.targetUnloads.join(",") !== "0,0") {
    errors.push(`target unloads mismatch: ${report.targetUnloads.join(",")}`);
  }
  if (!report.releasePayloads[0]?.includes(`texture:terrainLocal:${TEXTURE_LOCAL_A}`)) {
    errors.push("release payload must include terrainLocal texture");
  }
  if (report.releasePayloads[0]?.some((entry) => entry.includes("terrainShared"))) {
    errors.push("release payload must not include shared texture while retained");
  }
  if (!report.evictedTextureIds.includes(report.terrainLocalTextureId)) {
    errors.push("BrowserPlatformHost release must evict terrainLocal texture id");
  }
  if (report.evictedTextureIds.includes(report.terrainSharedTextureId)) {
    errors.push("BrowserPlatformHost release must not evict retained shared texture id");
  }
  assertFrameBudget("first", report.firstFrame, errors);
  assertFrameBudget("second", report.secondFrame, errors);
  if (report.profilerSnapshot.budgetReport?.passed !== true) {
    errors.push(`runtime profiler budget failed: ${
      JSON.stringify(report.profilerSnapshot.budgetReport?.violations ?? [])
    }`);
  }
  if (report.pixelSummary.greenPixelCount < 256) {
    errors.push("rendered canvas must contain green shared texture pixels");
  }
  if (report.pixelSummary.magentaPixelCount < 256) {
    errors.push("rendered canvas must contain magenta next chunk texture pixels");
  }
  if (report.pixelSummary.nonBackgroundPixelCount < 1_000) {
    errors.push("rendered canvas must contain non-background tile pixels");
  }
  if (!report.colliderRebuilds.some((entry) => entry.unload.join(",") === "0,0")) {
    errors.push("collider rebuilds must observe chunk unload");
  }
  if (!report.colliderRebuilds.some((entry) => entry.load.join(",") === "1,0")) {
    errors.push("collider rebuilds must observe next chunk load");
  }
  if (errors.length > 0) {
    throw new Error(`Level streaming browser smoke failed:\n${errors.join("\n")}`);
  }
}

function assertFrameBudget(label, frame, errors) {
  if (frame.stats.renderCommandCount !== COMMAND_COUNT) {
    errors.push(`${label} frame renderCommandCount mismatch: ${frame.stats.renderCommandCount}`);
  }
  if (frame.stats.spriteCount !== COMMAND_COUNT) {
    errors.push(`${label} frame spriteCount mismatch: ${frame.stats.spriteCount}`);
  }
  if (frame.stats.drawCalls !== FRAME_BUDGET.maxDrawCalls) {
    errors.push(`${label} frame drawCalls mismatch: ${frame.stats.drawCalls}`);
  }
  if (frame.stats.textureSwitchCount !== FRAME_BUDGET.maxTextureSwitchCount) {
    errors.push(`${label} frame textureSwitchCount mismatch: ${frame.stats.textureSwitchCount}`);
  }
  if (frame.budgetReport.passed !== true) {
    errors.push(`${label} frame budget failed: ${JSON.stringify(frame.budgetReport.violations)}`);
  }
}

function runtimeFrame() {
  return {
    frame: {
      cameraX: 0,
      cameraY: 0,
      frameTimeMs: 16,
    },
    rendererStats: {},
    debugMetrics: {},
    fps: 60,
    renderTimeMs: 1,
  };
}

function progressSummary(progress) {
  return {
    loaded: progress.loaded,
    total: progress.total,
    kind: progress.kind,
    name: progress.name,
    cached: progress.cached,
  };
}
