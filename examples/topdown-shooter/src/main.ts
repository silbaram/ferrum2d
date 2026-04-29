import { InputManager, WebGL2Renderer, createEngine } from "@ferrum2d/ferrum-web";

async function bootstrap(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) return;
  const title = document.createElement("h1");
  const timeEl = document.createElement("p");
  const debugEl = document.createElement("p");
  const mouseEl = document.createElement("p");
  title.textContent = "Ferrum2D Input + Render Commands";
  const canvas = document.createElement("canvas");
  canvas.style.width = "800px"; canvas.style.height = "480px"; canvas.style.display = "block";
  app.replaceChildren(title, timeEl, debugEl, mouseEl, canvas);

  const renderer = new WebGL2Renderer(canvas, { clearColor: [0.05, 0.08, 0.12, 1] });
  const input = new InputManager(canvas);
  const texture = await renderer.loadTexture("/player.png");

  const engine = await createEngine(({ timeSeconds, renderCommands }) => {
    const snapshot = input.snapshot();
    renderer.resize(); renderer.render();
    const stats = renderer.renderCommands(texture, renderCommands);
    timeEl.textContent = `time: ${timeSeconds.toFixed(3)} sprites: ${renderCommands.length}`;
    debugEl.textContent = `drawCalls: ${stats.drawCalls} batchCount: ${stats.batchCount} spriteCount: ${stats.spriteCount}`;
    mouseEl.textContent = `mouse: (${snapshot.mouseX.toFixed(1)}, ${snapshot.mouseY.toFixed(1)}) left=${snapshot.mouseLeft}`;
  }, () => input.snapshot());

  engine.start();
  (window as Window & { ferrumEngine?: typeof engine }).ferrumEngine = engine;
  window.addEventListener("beforeunload", () => { input.destroy(); engine.destroy(); });
}

void bootstrap();
