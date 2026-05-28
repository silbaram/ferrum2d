import {
  BrowserPlatformHost,
  DebugOverlay,
  IndexedDbAssetCache,
  InputManager,
  LoadingOverlay,
  RuntimeProfiler,
  WebGL2Renderer,
  createEngine,
  createAssetPreloadCachePolicy,
  diagnosticReport,
  preloadAssetManifest,
  type AssetLoadProgress,
  type AssetManifest,
  type DiagnosticContext,
  type DiagnosticReport,
  type FerrumEngine,
  type LoadedAssets,
  type ParticlePresetConfig,
  type ShooterGameSpec,
} from "@ferrum2d/ferrum-web";

const TOPDOWN_HIT_PARTICLE_PRESET_ID = 0;
const FLOATS_PER_RENDER_COMMAND = 14;
const COMMAND_COLOR_R_OFFSET = 8;
const COMMAND_COLOR_G_OFFSET = 9;
const COMMAND_COLOR_B_OFFSET = 10;
const COMMAND_COLOR_A_OFFSET = 11;
const COMMAND_TEXTURE_ID_OFFSET = 12;
const TOPDOWN_ASSET_CACHE_SALT = "topdown-shooter-v1";
const TOPDOWN_ASSET_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface TopdownTextureIds {
  player: number;
  enemy: number;
  bullet: number;
}

interface TopdownSmokeFrame {
  renderCommandCount: number;
  particleCount: number;
  enemyFlashCommandCount: number;
  maxEnemyFlashCommandCount: number;
  maxParticleCount: number;
  enemyTextureId: number;
  bulletTextureId: number;
  gameState: number;
  score: number;
}

type TopdownSmokeWindow = Window & {
  ferrumEngine?: FerrumEngine;
  ferrumRuntime?: { engine: FerrumEngine; renderer: WebGL2Renderer; profiler?: RuntimeProfiler };
  ferrumTopdownSmokeFrame?: TopdownSmokeFrame;
  ferrumTopdownSmokeStart?: () => void;
  ferrumTopdownSmokeFireAt?: (mouseX: number, mouseY: number) => void;
};

function gameStateText(code: number): string {
  if (code === 0) return "Title";
  if (code === 1) return "Playing";
  return "GameOver";
}

function assetApplyError(kind: "texture" | "sound" | "json", name: string, detail: string): Error {
  return new Error(`Asset apply error: kind=${kind} name='${name}' detail='${detail}'.`);
}

function diagnosticRows(report: DiagnosticReport): Array<[string, string]> {
  const rows: Array<[string, string]> = [["code", report.code], ["message", report.message]];
  const context = report.context;
  if (!context) {
    return rows;
  }

  appendDiagnosticContext(rows, context);
  return rows;
}

function appendDiagnosticContext(rows: Array<[string, string]>, context: DiagnosticContext): void {
  rows.push(["kind", context.kind]);
  if (context.name !== undefined) rows.push(["name", context.name]);
  if (context.id !== undefined) rows.push(["id", String(context.id)]);
  if (context.url !== undefined) rows.push(["url", context.url]);
  if (context.path !== undefined) rows.push(["path", context.path]);
  rows.push(["detail", context.detail]);
}

function applyBootstrapErrorStyles(container: HTMLElement, list: HTMLElement): void {
  container.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  container.style.maxWidth = "760px";
  container.style.margin = "48px auto";
  container.style.padding = "0 24px";
  container.style.color = "#17202a";
  list.style.display = "grid";
  list.style.gridTemplateColumns = "max-content minmax(0, 1fr)";
  list.style.gap = "8px 16px";
}

function publicAssetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

function topdownAssetManifest(): AssetManifest {
  return {
    textures: {
      player: publicAssetUrl("assets/player.png"),
      enemy: publicAssetUrl("assets/enemy.png"),
      bullet: publicAssetUrl("assets/bullet.png"),
    },
    sounds: {
      shoot: publicAssetUrl("assets/shoot.wav"),
      hit: publicAssetUrl("assets/hit.wav"),
      gameOver: publicAssetUrl("assets/game-over.wav"),
    },
    json: {
      game: publicAssetUrl("game.json"),
    },
  };
}

function assetProgressLabel(prefix: string, progress: AssetLoadProgress): string {
  const name = progress.name ? ` ${progress.name}` : "";
  const cached = progress.cached === true ? " cached" : "";
  return `${prefix}: ${progress.loaded}/${progress.total}${name}${cached}`;
}

async function preloadTopdownAssets(
  manifest: AssetManifest,
  overlay: LoadingOverlay,
  onProgressText: (text: string) => void,
): Promise<void> {
  const cache = new IndexedDbAssetCache({
    databaseName: "ferrum2d-topdown-shooter-assets",
    storeName: "json",
    binaryStoreName: "binary",
  });
  const cachePolicy = createAssetPreloadCachePolicy(manifest, {
    versionSalt: TOPDOWN_ASSET_CACHE_SALT,
    ttlMs: TOPDOWN_ASSET_CACHE_TTL_MS,
  });

  await preloadAssetManifest(manifest, {
    cache,
    cachePolicy,
    onProgress: (progress) => {
      onProgressText(assetProgressLabel("preload", progress));
      overlay.update(progress);
    },
  });
}

function requireTextureId(assets: LoadedAssets, name: "player" | "enemy" | "bullet"): number {
  const textureId = assets.textures.tryTextureId(name);
  if (textureId === undefined) {
    throw assetApplyError("texture", name, "Required texture is missing from loaded assets. Check textures manifest key.");
  }
  return textureId;
}

function requireSoundId(assets: LoadedAssets, name: "shoot" | "hit" | "gameOver" | "game_over"): number {
  const soundId = assets.sounds.trySoundId(name);
  if (soundId === undefined) {
    throw assetApplyError("sound", name, "Required sound is missing from loaded assets. Check sounds manifest key.");
  }
  return soundId;
}

function applyTopdownShooterAssets(engine: FerrumEngine, assets: LoadedAssets): TopdownTextureIds {
  const player = requireTextureId(assets, "player");
  const enemy = requireTextureId(assets, "enemy");
  const bullet = requireTextureId(assets, "bullet");
  engine.setTextureIds({ player, enemy, bullet });

  const shoot = requireSoundId(assets, "shoot");
  const hit = requireSoundId(assets, "hit");
  const gameOver = assets.sounds.trySoundId("gameOver") ?? assets.sounds.trySoundId("game_over");
  if (gameOver === undefined) {
    throw assetApplyError("sound", "gameOver", "Required sound is missing from loaded assets. Check sounds manifest key.");
  }
  engine.setSoundIds({ shoot, hit, gameOver });

  if (assets.json.game === undefined) {
    throw assetApplyError("json", "game", "Required Game Spec JSON is missing from loaded assets. Check json manifest key.");
  }
  engine.setGameSpec(assets.json.game as ShooterGameSpec);
  applyTopdownHitParticles(engine, bullet);
  return { player, enemy, bullet };
}

function applyTopdownHitParticles(engine: FerrumEngine, bulletTextureId: number): void {
  const hitParticles: ParticlePresetConfig = {
    texture: bulletTextureId,
    burstCount: 10,
    lifetime: [0.16, 0.34],
    speed: [45, 155],
    startSize: [5, 9],
    endSize: 1.5,
    startColor: [1, 0.82, 0.28, 1],
    endColor: [1, 0.18, 0.05, 0],
    damping: 1.8,
  };

  engine.setParticlePreset(TOPDOWN_HIT_PARTICLE_PRESET_ID, hitParticles);
  engine.setShooterHitParticlePreset(TOPDOWN_HIT_PARTICLE_PRESET_ID);
}

function recordTopdownSmokeFrame(
  engine: FerrumEngine,
  renderCommandBuffer: { buffer: Float32Array; commandCount: number; floatsPerCommand: number },
  textureIds: TopdownTextureIds,
  gameState: number,
  score: number,
): void {
  let enemyFlashCommandCount = 0;
  const floatsPerCommand = renderCommandBuffer.floatsPerCommand || FLOATS_PER_RENDER_COMMAND;
  for (let commandIndex = 0; commandIndex < renderCommandBuffer.commandCount; commandIndex += 1) {
    const offset = commandIndex * floatsPerCommand;
    const textureId = Math.trunc(renderCommandBuffer.buffer[offset + COMMAND_TEXTURE_ID_OFFSET]);
    if (textureId !== textureIds.enemy) {
      continue;
    }

    const red = renderCommandBuffer.buffer[offset + COMMAND_COLOR_R_OFFSET];
    const green = renderCommandBuffer.buffer[offset + COMMAND_COLOR_G_OFFSET];
    const blue = renderCommandBuffer.buffer[offset + COMMAND_COLOR_B_OFFSET];
    const alpha = renderCommandBuffer.buffer[offset + COMMAND_COLOR_A_OFFSET];
    if (red >= 0.95 && green > 0.6 && blue > 0.32 && alpha >= 0.95) {
      enemyFlashCommandCount += 1;
    }
  }

  const smokeWindow = window as TopdownSmokeWindow;
  const previous = smokeWindow.ferrumTopdownSmokeFrame;
  const particleCount = engine.particleCount();
  smokeWindow.ferrumTopdownSmokeFrame = {
    renderCommandCount: renderCommandBuffer.commandCount,
    particleCount,
    enemyFlashCommandCount,
    maxEnemyFlashCommandCount: Math.max(previous?.maxEnemyFlashCommandCount ?? 0, enemyFlashCommandCount),
    maxParticleCount: Math.max(previous?.maxParticleCount ?? 0, particleCount),
    enemyTextureId: textureIds.enemy,
    bulletTextureId: textureIds.bullet,
    gameState,
    score,
  };
}

function reportBootstrapError(error: unknown): void {
  console.error("Ferrum2D bootstrap failed", error);
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) return;

  const report = diagnosticReport(error);
  const container = document.createElement("section");
  const title = document.createElement("h1");
  const summary = document.createElement("p");
  const list = document.createElement("dl");
  title.textContent = "Ferrum2D Top-down Shooter MVP";
  summary.textContent = "Startup failed. Diagnostic details are shown below.";

  for (const [label, value] of diagnosticRows(report)) {
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;
    description.textContent = value;
    description.style.margin = "0";
    description.style.wordBreak = "break-word";
    list.append(term, description);
  }

  applyBootstrapErrorStyles(container, list);
  container.append(title, summary, list);
  app.replaceChildren(container);
}

function cleanupResources(cleanups: Array<() => void>): void {
  for (const cleanup of cleanups.splice(0).reverse()) {
    try {
      cleanup();
    } catch (error) {
      console.warn("Ferrum2D cleanup failed", error);
    }
  }
}

async function bootstrap(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) return;
  const cleanups: Array<() => void> = [];

  try {
    const title = document.createElement("h1");
    const hudEl = document.createElement("p");
    title.textContent = "Ferrum2D Top-down Shooter MVP";
    const searchParams = new URLSearchParams(window.location.search);
    const preserveDrawingBuffer = searchParams.get("preserveDrawingBuffer") === "true";
    const effectSmokeEnabled = searchParams.get("effectSmoke") === "true";
    const profilerSmokeEnabled = searchParams.get("profilerSmoke") === "true";

    const canvas = document.createElement("canvas");
    canvas.style.width = "800px";
    canvas.style.height = "480px";
    canvas.style.display = "block";
    app.replaceChildren(title, hudEl, canvas);

    const renderer = new WebGL2Renderer(canvas, { clearColor: [0.05, 0.08, 0.12, 1], preserveDrawingBuffer });
    cleanups.push(() => renderer.destroy());
    const platformHost = new BrowserPlatformHost(renderer);
    cleanups.push(() => platformHost.destroy());
    const unlockAudio = (): void => {
      void platformHost.unlockAudio();
    };
    window.addEventListener("keydown", unlockAudio, { once: true });
    canvas.addEventListener("pointerdown", unlockAudio, { once: true });
    cleanups.push(() => window.removeEventListener("keydown", unlockAudio));
    cleanups.push(() => canvas.removeEventListener("pointerdown", unlockAudio));
    const input = new InputManager(canvas);
    cleanups.push(() => input.destroy());
    const debugEnabled = searchParams.get("debug") !== "false";
    const physicsDebugLines = searchParams.get("physicsDebugLines") === "true";
    const debugOverlay = new DebugOverlay(app, { enabled: debugEnabled });
    cleanups.push(() => debugOverlay.destroy());
    const runtimeProfiler = profilerSmokeEnabled ? new RuntimeProfiler() : undefined;
    const loadingOverlay = new LoadingOverlay(app, {
      title: "Loading assets",
      completeTitle: "Ready",
      autoHideOnComplete: true,
    });
    cleanups.push(() => loadingOverlay.destroy());
    let assetProgressText = "assets: 0/0";
    let audioEventRateWindowStartMs = performance.now();
    let audioEventRateCount = 0;
    let audioEventsPerSecond = 0;
    let runtimeEngine: FerrumEngine | undefined;
    let smokeTextureIds: TopdownTextureIds | undefined;
    let smokeStartQueued = false;
    let smokeFireQueued: { mouseX: number; mouseY: number } | undefined;
    const inputSnapshot = () => {
      const snapshot = input.snapshot();
      if (smokeStartQueued) {
        smokeStartQueued = false;
        return { ...snapshot, enter: true };
      }
      if (smokeFireQueued) {
        const fire = smokeFireQueued;
        smokeFireQueued = undefined;
        return { ...snapshot, mouseLeft: true, mouseX: fire.mouseX, mouseY: fire.mouseY };
      }
      return snapshot;
    };

    const engine = await createEngine((frame) => {
      const renderStartMs = performance.now();
      renderer.render();
      renderer.renderCommands(frame.renderCommandBuffer);
      if (physicsDebugLines) {
        renderer.renderPhysicsDebugLines(frame.physicsDebugLineBuffer, {
          x: frame.cameraX,
          y: frame.cameraY,
        });
      }
      const renderStats = renderer.renderPostProcess();
      const renderTimeMs = performance.now() - renderStartMs;
      audioEventRateCount += frame.audioEvents.length;
      const audioEventRateElapsedMs = performance.now() - audioEventRateWindowStartMs;
      if (audioEventRateElapsedMs >= 1000) {
        audioEventsPerSecond = audioEventRateCount / (audioEventRateElapsedMs / 1000);
        audioEventRateWindowStartMs = performance.now();
        audioEventRateCount = 0;
      }

      hudEl.textContent = `${assetProgressText} controls: Enter or Space start, W/A/S/D move, Mouse Left or Space fire, Space restart`;

      if (frame.gameState === 0) {
        hudEl.textContent = "Press Enter or Space to start";
      } else if (frame.gameState === 2) {
        hudEl.textContent = `Game Over - final score ${frame.score}. Press Space to restart.`;
      }

      if (effectSmokeEnabled && runtimeEngine && smokeTextureIds) {
        recordTopdownSmokeFrame(runtimeEngine, frame.renderCommandBuffer, smokeTextureIds, frame.gameState, frame.score);
      }

      const debugMetrics = {
        fps: frame.frameTimeMs > 0 ? 1000 / frame.frameTimeMs : 0,
        frameTimeMs: frame.frameTimeMs,
        entityCount: frame.entityCount,
        spriteCount: frame.spriteCount,
        drawCalls: renderStats.drawCalls,
        batchCount: renderStats.batchCount,
        renderCommandCount: renderStats.renderCommandCount,
        textureBindCount: renderStats.textureBindCount,
        textureSwitchCount: renderStats.textureSwitchCount,
        physicsDebugLineCount: renderStats.physicsDebugLineCount,
        audioEventsPerSecond,
        rustUpdateTimeMs: frame.rustUpdateTimeMs,
        renderTimeMs,
        mouseX: frame.mouseX,
        mouseY: frame.mouseY,
        cameraX: frame.cameraX,
        cameraY: frame.cameraY,
        gameState: gameStateText(frame.gameState),
        score: frame.score,
      };
      runtimeProfiler?.recordFrame(debugMetrics);
      debugOverlay.update(debugMetrics);
    }, inputSnapshot, platformHost, () => {
      renderer.resize();
      return renderer.viewportSize();
    }, { enablePhysicsDebugLines: physicsDebugLines });
    runtimeEngine = engine;
    cleanups.push(() => engine.destroy());

    const manifest = topdownAssetManifest();
    let assets: LoadedAssets;
    try {
      await preloadTopdownAssets(manifest, loadingOverlay, (text) => {
        assetProgressText = text;
      });
      assets = await engine.loadAssets(manifest, (progress) => {
        assetProgressText = assetProgressLabel("assets", progress);
        loadingOverlay.update(progress);
      });
      loadingOverlay.complete();
    } catch (error) {
      loadingOverlay.fail(error);
      throw error;
    }
    smokeTextureIds = applyTopdownShooterAssets(engine, assets);
    assetProgressText = `assets: ${assets.progress.loaded}/${assets.progress.total}`;

    const onBeforeUnload = (): void => cleanupResources(cleanups);
    window.addEventListener("beforeunload", onBeforeUnload);
    cleanups.push(() => window.removeEventListener("beforeunload", onBeforeUnload));
    engine.start();
    const smokeWindow = window as TopdownSmokeWindow;
    smokeWindow.ferrumEngine = engine;
    smokeWindow.ferrumRuntime = { engine, renderer, ...(runtimeProfiler === undefined ? {} : { profiler: runtimeProfiler }) };
    if (effectSmokeEnabled) {
      smokeWindow.ferrumTopdownSmokeStart = () => {
        smokeStartQueued = true;
      };
      smokeWindow.ferrumTopdownSmokeFireAt = (mouseX: number, mouseY: number) => {
        smokeFireQueued = { mouseX, mouseY };
      };
    }
  } catch (error) {
    cleanupResources(cleanups);
    throw error;
  }
}

void bootstrap().catch(reportBootstrapError);
