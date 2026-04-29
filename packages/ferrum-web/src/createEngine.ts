import type { Engine } from "../pkg/ferrum_core";
import { GameLoop } from "./gameLoop";
import type { InputSnapshot } from "./inputManager";
import type { RenderCommandView } from "./wasmBridge";
import { WasmBridge } from "./wasmBridge";

export interface FrameState { timeSeconds: number; renderCommands: RenderCommandView[]; }
export interface FerrumEngine { start():void; pause():void; resume():void; stop():void; destroy():void; time():number; version():string; }

export async function createEngine(
  onFrame?: (state: FrameState) => void,
  inputProvider?: () => InputSnapshot,
): Promise<FerrumEngine> {
  const bridge = await WasmBridge.init();
  const rustEngine: Engine = bridge.engine();

  const loop = new GameLoop((deltaSeconds) => {
    const input = inputProvider?.();
    if (input) {
      rustEngine.set_input(input.w, input.a, input.s, input.d, input.space, input.mouseLeft, input.mouseX, input.mouseY);
    }
    rustEngine.update(deltaSeconds);
    onFrame?.({ timeSeconds: rustEngine.time(), renderCommands: bridge.readRenderCommands() });
  });

  return {
    start: () => loop.start(),
    pause: () => loop.pause(),
    resume: () => loop.resume(),
    stop: () => loop.stop(),
    destroy: () => { loop.stop(); rustEngine.free(); },
    time: () => rustEngine.time(),
    version: () => bridge.version(),
  };
}
