import type { Engine } from "../pkg/ferrum_core";
import { GameLoop } from "./gameLoop";
import type { InputSnapshot } from "./inputManager";
import type { RenderCommandBufferView, RenderCommandView } from "./wasmBridge";
import { WasmBridge } from "./wasmBridge";

export interface FrameState {
  timeSeconds: number;
  score: number;
  entityCount: number;
  gameState: number;
  spriteCount: number;
  /** @deprecated 호환성 유지용. hot path에서는 renderCommandBuffer를 사용하세요. */
  renderCommands: RenderCommandView[];
  renderCommandBuffer: RenderCommandBufferView;
}
export interface FerrumEngine {
  start(): void; pause(): void; resume(): void; stop(): void; destroy(): void; time(): number; version(): string;
  score(): number; entityCount(): number; gameState(): number; spriteCount(): number; resetGame(): void;
}

export async function createEngine(onFrame?: (state: FrameState) => void, inputProvider?: () => InputSnapshot): Promise<FerrumEngine> {
  const bridge = await WasmBridge.init();
  const rustEngine: Engine = bridge.engine();

  const loop = new GameLoop((deltaSeconds) => {
    const input = inputProvider?.();
    if (input) {
      rustEngine.set_input(input.w, input.a, input.s, input.d, input.space, input.mouseLeft, input.mouseX, input.mouseY);
    }
    rustEngine.update(deltaSeconds);
    const renderCommandBuffer = bridge.readRenderCommandBuffer();
    onFrame?.({
      timeSeconds: rustEngine.time(),
      score: rustEngine.score(),
      entityCount: rustEngine.entity_count(),
      gameState: rustEngine.game_state_code(),
      spriteCount: rustEngine.sprite_count(),
      renderCommandBuffer,
      renderCommands: bridge.readRenderCommands(),
    });
  });

  return {
    start: () => loop.start(), pause: () => loop.pause(), resume: () => loop.resume(), stop: () => loop.stop(),
    destroy: () => { loop.stop(); rustEngine.free(); },
    time: () => rustEngine.time(), version: () => bridge.version(),
    score: () => rustEngine.score(), entityCount: () => rustEngine.entity_count(),
    gameState: () => rustEngine.game_state_code(), spriteCount: () => rustEngine.sprite_count(),
    resetGame: () => rustEngine.reset_game(),
  };
}
