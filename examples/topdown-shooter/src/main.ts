import {
  BrowserPlatformHost,
  DebugOverlay,
  InputManager,
  WebGL2Renderer,
  createEngine,
  type FerrumEngine,
  type LoadedAssets,
  type ShooterGameSpec,
} from "@ferrum2d/ferrum-web";

function gameStateText(code: number): string {
  if (code === 0) return "Title";
  if (code === 1) return "Playing";
  return "GameOver";
}

function errorDetail(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return String(error);
}

function assetApplyError(kind: "texture" | "sound" | "json", name: string, detail: string): Error {
  return new Error(`Asset apply error: kind=${kind} name='${name}' detail='${detail}'.`);
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

function applyTopdownShooterAssets(engine: FerrumEngine, assets: LoadedAssets): void {
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
}

function reportBootstrapError(error: unknown): void {
  console.error("Ferrum2D bootstrap failed", error);
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) return;

  const title = document.createElement("h1");
  const message = document.createElement("p");
  title.textContent = "Ferrum2D Top-down Shooter MVP";
  message.textContent = `Failed to start: ${errorDetail(error)}`;
  app.replaceChildren(title, message);
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

    const canvas = document.createElement("canvas");
    canvas.style.width = "800px";
    canvas.style.height = "480px";
    canvas.style.display = "block";
    app.replaceChildren(title, hudEl, canvas);

    const renderer = new WebGL2Renderer(canvas, { clearColor: [0.05, 0.08, 0.12, 1] });
    cleanups.push(() => renderer.destroy());
    const platformHost = new BrowserPlatformHost(renderer);
    cleanups.push(() => platformHost.destroy());
    const input = new InputManager(canvas);
    cleanups.push(() => input.destroy());
    const debugEnabled = new URLSearchParams(window.location.search).get("debug") !== "false";
    const debugOverlay = new DebugOverlay(app, { enabled: debugEnabled });
    cleanups.push(() => debugOverlay.destroy());
    let assetProgressText = "assets: 0/0";
    let audioEventRateWindowStartMs = performance.now();
    let audioEventRateCount = 0;
    let audioEventsPerSecond = 0;

    const engine = await createEngine((frame) => {
      const renderStartMs = performance.now();
      renderer.render();
      renderer.renderCommands(frame.renderCommandBuffer);
      const renderStats = renderer.stats();
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

      debugOverlay.update({
        fps: frame.frameTimeMs > 0 ? 1000 / frame.frameTimeMs : 0,
        frameTimeMs: frame.frameTimeMs,
        entityCount: frame.entityCount,
        spriteCount: frame.spriteCount,
        drawCalls: renderStats.drawCalls,
        batchCount: renderStats.batchCount,
        renderCommandCount: renderStats.renderCommandCount,
        textureBindCount: renderStats.textureBindCount,
        textureSwitchCount: renderStats.textureSwitchCount,
        audioEventsPerSecond,
        rustUpdateTimeMs: frame.rustUpdateTimeMs,
        renderTimeMs,
        mouseX: frame.mouseX,
        mouseY: frame.mouseY,
        cameraX: frame.cameraX,
        cameraY: frame.cameraY,
        gameState: gameStateText(frame.gameState),
        score: frame.score,
      });
    }, () => input.snapshot(), platformHost, () => {
      renderer.resize();
      return renderer.viewportSize();
    });
    cleanups.push(() => engine.destroy());

    const assets = await engine.loadAssets({
      textures: {
        player: "/assets/player.png",
        enemy: "/assets/enemy.png",
        bullet: "/assets/bullet.png",
      },
      sounds: {
        shoot: "/assets/shoot.wav",
        hit: "/assets/hit.wav",
        gameOver: "/assets/game-over.wav",
      },
      json: {
        game: "/game.json",
      },
    }, ({ loaded, total, name }) => {
      assetProgressText = `assets: ${loaded}/${total}${name ? ` ${name}` : ""}`;
    });
    applyTopdownShooterAssets(engine, assets);
    assetProgressText = `assets: ${assets.progress.loaded}/${assets.progress.total}`;

    const onBeforeUnload = (): void => cleanupResources(cleanups);
    window.addEventListener("beforeunload", onBeforeUnload);
    cleanups.push(() => window.removeEventListener("beforeunload", onBeforeUnload));
    engine.start();
    (window as Window & { ferrumEngine?: typeof engine }).ferrumEngine = engine;
  } catch (error) {
    cleanupResources(cleanups);
    throw error;
  }
}

void bootstrap().catch(reportBootstrapError);
