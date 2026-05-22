import {
  BrowserPlatformHost,
  DebugOverlay,
  InputManager,
  WebGL2Renderer,
  createEngine,
  diagnosticReport,
  type DiagnosticContext,
  type DiagnosticReport,
  type FerrumEngine,
  type LoadedAssets,
  type ShooterGameSpec,
} from "@ferrum2d/ferrum-web";

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

    const canvas = document.createElement("canvas");
    canvas.style.width = "800px";
    canvas.style.height = "480px";
    canvas.style.display = "block";
    app.replaceChildren(title, hudEl, canvas);

    const renderer = new WebGL2Renderer(canvas, { clearColor: [0.05, 0.08, 0.12, 1] });
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
    const searchParams = new URLSearchParams(window.location.search);
    const debugEnabled = searchParams.get("debug") !== "false";
    const physicsDebugLines = searchParams.get("physicsDebugLines") === "true";
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
      if (physicsDebugLines) {
        renderer.renderPhysicsDebugLines(frame.physicsDebugLineBuffer, {
          x: frame.cameraX,
          y: frame.cameraY,
        });
      }
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
      });
    }, () => input.snapshot(), platformHost, () => {
      renderer.resize();
      return renderer.viewportSize();
    }, { enablePhysicsDebugLines: physicsDebugLines });
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
