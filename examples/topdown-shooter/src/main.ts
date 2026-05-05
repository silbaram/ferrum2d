import {
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

function applyTopdownShooterAssets(engine: FerrumEngine, assets: LoadedAssets): void {
  const player = assets.textures.tryTextureId("player");
  const enemy = assets.textures.tryTextureId("enemy");
  const bullet = assets.textures.tryTextureId("bullet");
  if (player !== undefined && enemy !== undefined && bullet !== undefined) {
    engine.setTextureIds({ player, enemy, bullet });
  }

  const shoot = assets.sounds.trySoundId("shoot");
  const hit = assets.sounds.trySoundId("hit");
  const gameOver = assets.sounds.trySoundId("gameOver") ?? assets.sounds.trySoundId("game_over");
  if (shoot !== undefined && hit !== undefined && gameOver !== undefined) {
    engine.setSoundIds({ shoot, hit, gameOver });
  }

  if (assets.json.game !== undefined) {
    engine.setGameSpec(assets.json.game as ShooterGameSpec);
  }
}

async function bootstrap(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) return;

  const title = document.createElement("h1");
  const hudEl = document.createElement("p");
  title.textContent = "Ferrum2D Top-down Shooter MVP";

  const canvas = document.createElement("canvas");
  canvas.style.width = "800px";
  canvas.style.height = "480px";
  canvas.style.display = "block";
  app.replaceChildren(title, hudEl, canvas);

  const renderer = new WebGL2Renderer(canvas, { clearColor: [0.05, 0.08, 0.12, 1] });
  const input = new InputManager(canvas);
  const debugEnabled = new URLSearchParams(window.location.search).get("debug") !== "false";
  const debugOverlay = new DebugOverlay(app, { enabled: debugEnabled });
  let assetProgressText = "assets: 0/0";

  const engine = await createEngine((frame) => {
    const renderStartMs = performance.now();
    renderer.render();
    renderer.renderCommands(frame.renderCommandBuffer);
    const renderStats = renderer.stats();
    const renderTimeMs = performance.now() - renderStartMs;

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
      rustUpdateTimeMs: frame.rustUpdateTimeMs,
      renderTimeMs,
      mouseX: frame.mouseX,
      mouseY: frame.mouseY,
      cameraX: frame.cameraX,
      cameraY: frame.cameraY,
      gameState: gameStateText(frame.gameState),
      score: frame.score,
    });
  }, () => input.snapshot(), renderer, () => {
    renderer.resize();
    return renderer.viewportSize();
  });

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

  engine.start();
  (window as Window & { ferrumEngine?: typeof engine }).ferrumEngine = engine;
  window.addEventListener("beforeunload", () => {
    input.destroy();
    debugOverlay.destroy();
    engine.destroy();
  });
}

void bootstrap();
