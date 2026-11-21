import {
  BrowserPlatformHost, InputManager, WebGL2Renderer,
  type FerrumEngine, type RenderCommandAccessor, type RuntimeCheckpoint,
} from "@ferrum2d/ferrum-web/core";

export interface ShooterPlatformScope {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: WebGL2Renderer;
  readonly host: BrowserPlatformHost;
  readonly input: InputManager;
  engine?: FerrumEngine;
  renderAccessor?: RenderCommandAccessor;
  restartCheckpoint?: RuntimeCheckpoint;
  textureIds?: { player: number; enemy: number; bullet: number };
  gameSpec?: Parameters<FerrumEngine["setGameSpec"]>[0];
  readonly disposed: boolean;
  paused: boolean;
  activate(): void;
  unlockAudio(): void;
  dispose(): void;
}

/** One actual canvas/platform lifetime. A staging scope never borrows source GPU objects. */
export function createShooterPlatformScope(canvas: HTMLCanvasElement, preserveDrawingBuffer: boolean, staging = false): ShooterPlatformScope {
  const renderer = new WebGL2Renderer(canvas, { clearColor: [0.05, 0.08, 0.12, 1], preserveDrawingBuffer });
  let host: BrowserPlatformHost | undefined, input: InputManager | undefined, observer: ResizeObserver | undefined;
  let disposed = false, active = false;
  let scope: ShooterPlatformScope | undefined;
  const resize = () => { if (!disposed) renderer.resize(); };
  const unlock = () => { if (!disposed) void host?.unlockAudio(); };
  const focus = () => { if (!disposed) canvas.focus({ preventScroll: true }); };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener("keydown", unlock);
    canvas.removeEventListener("pointerdown", unlock);
    canvas.removeEventListener("pointerdown", focus);
    observer?.disconnect();
    try { scope?.restartCheckpoint?.dispose(); }
    finally { try { input?.destroy(); } finally { try { host?.destroy(); } finally { renderer.destroy(); } } }
  };
  try {
    host = new BrowserPlatformHost(renderer);
    input = new InputManager(canvas, { enabled: !staging });
    observer = new ResizeObserver(resize);
    observer.observe(canvas);
    scope = {
      canvas, renderer, host, input, paused: false,
      get disposed() { return disposed; },
      activate() {
        if (disposed) throw new Error("Shooter platform scope has been disposed.");
        if (!active) {
          active = true;
          input!.setEnabled(true);
          window.addEventListener("keydown", unlock, { once: true });
          canvas.addEventListener("pointerdown", unlock, { once: true });
          canvas.addEventListener("pointerdown", focus);
        }
      },
      unlockAudio: unlock,
      dispose,
    };
    resize();
    if (!staging) scope.activate();
    return scope;
  } catch (error) { dispose(); throw error; }
}
