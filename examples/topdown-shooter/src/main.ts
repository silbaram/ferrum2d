import { InputManager, WebGL2Renderer, createEngine } from "@ferrum2d/ferrum-web";

function gameStateText(code: number): string {
  if (code === 0) return "Title";
  if (code === 1) return "Playing";
  return "GameOver";
}

async function bootstrap(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) return;

  const title = document.createElement("h1");
  const stateEl = document.createElement("p");
  const scoreEl = document.createElement("p");
  const hudEl = document.createElement("p");
  const statsEl = document.createElement("p");
  title.textContent = "Ferrum2D Top-down Shooter MVP";

  const canvas = document.createElement("canvas");
  canvas.style.width = "800px";
  canvas.style.height = "480px";
  canvas.style.display = "block";
  app.replaceChildren(title, stateEl, scoreEl, hudEl, statsEl, canvas);

  const renderer = new WebGL2Renderer(canvas, { clearColor: [0.05, 0.08, 0.12, 1] });
  const input = new InputManager(canvas);
  const texture = await renderer.loadTexture("/player.png");

  const engine = await createEngine(({ score, gameState, entityCount, spriteCount, renderCommandBuffer }) => {
    renderer.resize();
    renderer.render();
    renderer.renderCommands(texture, renderCommandBuffer);

    stateEl.textContent = `state: ${gameStateText(gameState)}`;
    scoreEl.textContent = `score: ${score}`;
    hudEl.textContent = "controls: W/A/S/D move, Mouse Left or Space fire/start, Space restart on game over";
    statsEl.textContent = `entities: ${entityCount} sprites: ${spriteCount}`;

    if (gameState === 0) {
      hudEl.textContent = "Press Space or Mouse Left to start";
    } else if (gameState === 2) {
      hudEl.textContent = `Game Over - final score ${score}. Press Space to restart.`;
    }
  }, () => input.snapshot());

  engine.start();
  (window as Window & { ferrumEngine?: typeof engine }).ferrumEngine = engine;
  window.addEventListener("beforeunload", () => {
    input.destroy();
    engine.destroy();
  });
}

void bootstrap();
