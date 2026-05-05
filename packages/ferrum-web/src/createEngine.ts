import type { Engine } from "../pkg/ferrum_core";
import type { AssetLoadProgressCallback, AssetManifest, LoadedAssets } from "./assetLoader";
import { applyShooterGameSpec } from "./gameSpec";
import type { ResolvedShooterGameSpec, ShooterGameSpec } from "./gameSpec";
import { GameLoop } from "./gameLoop";
import type { InputSnapshot } from "./inputManager";
import type { AudioEventView, RenderCommandBufferView, RenderCommandView } from "./wasmBridge";
import { WasmBridge } from "./wasmBridge";

export interface AssetHost {
  loadAssets(manifest: AssetManifest, onProgress?: AssetLoadProgressCallback): Promise<LoadedAssets>;
  textureId(name: string): number;
  soundId?(name: string): number;
  playAudioEvents?(events: readonly AudioEventView[]): void;
}

export interface ShooterTextureIds {
  player: number;
  enemy: number;
  bullet: number;
}

export interface ShooterSoundIds {
  shoot: number;
  hit: number;
  gameOver: number;
}

export interface FrameState {
  timeSeconds: number;
  frameTimeMs: number;
  rustUpdateTimeMs: number;
  score: number;
  entityCount: number;
  gameState: number;
  spriteCount: number;
  mouseX: number;
  mouseY: number;
  cameraX: number;
  cameraY: number;
  audioEvents: AudioEventView[];
  /** @deprecated 호환성 유지용. hot path에서는 renderCommandBuffer를 사용하세요. */
  renderCommands: RenderCommandView[];
  renderCommandBuffer: RenderCommandBufferView;
}

export interface CreateEngineOptions {
  /** @deprecated 호환 API 사용자만 켜세요. 매 프레임 command object 배열을 생성합니다. */
  includeDeprecatedRenderCommands?: boolean;
}
export interface FerrumEngine {
  start(): void; pause(): void; resume(): void; stop(): void; destroy(): void; time(): number; version(): string;
  score(): number; entityCount(): number; gameState(): number; spriteCount(): number; resetGame(): void;
  loadAssets(manifest: AssetManifest, onProgress?: AssetLoadProgressCallback): Promise<LoadedAssets>;
  textureId(name: string): number;
  soundId(name: string): number;
  setTextureIds(textureIds: ShooterTextureIds): void;
  setSoundIds(soundIds: ShooterSoundIds): void;
  setViewportSize(width: number, height: number): void;
  setGameSpec(spec: ShooterGameSpec): ResolvedShooterGameSpec;
  cameraX(): number;
  cameraY(): number;
}

export interface ViewportSnapshot {
  width: number;
  height: number;
}

const EMPTY_RENDER_COMMANDS: RenderCommandView[] = [];

export async function createEngine(
  onFrame?: (state: FrameState) => void,
  inputProvider?: () => InputSnapshot,
  assetHost?: AssetHost,
  viewportProvider?: () => ViewportSnapshot,
  options: CreateEngineOptions = {},
): Promise<FerrumEngine> {
  const bridge = await WasmBridge.init();
  const rustEngine: Engine = bridge.engine();

  const loop = new GameLoop((deltaSeconds) => {
    const input = inputProvider?.();
    if (input) {
      rustEngine.set_input(input.w, input.a, input.s, input.d, input.space, input.enter, input.mouseLeft, input.mouseX, input.mouseY);
    }
    const viewport = viewportProvider?.();
    if (viewport) {
      rustEngine.set_viewport_size(viewport.width, viewport.height);
    }
    const updateStartMs = performance.now();
    rustEngine.update(deltaSeconds);
    const rustUpdateTimeMs = performance.now() - updateStartMs;
    const audioEvents = bridge.readAudioEvents();
    try {
      if (audioEvents.length > 0) {
        assetHost?.playAudioEvents?.(audioEvents);
      }
    } finally {
      rustEngine.clear_events();
    }
    const renderCommandBuffer = bridge.readRenderCommandBuffer();
    onFrame?.({
      timeSeconds: rustEngine.time(),
      frameTimeMs: deltaSeconds * 1000,
      rustUpdateTimeMs,
      score: rustEngine.score(),
      entityCount: rustEngine.entity_count(),
      gameState: rustEngine.game_state(),
      spriteCount: rustEngine.sprite_count(),
      mouseX: input?.mouseX ?? 0,
      mouseY: input?.mouseY ?? 0,
      cameraX: rustEngine.camera_x(),
      cameraY: rustEngine.camera_y(),
      audioEvents,
      renderCommandBuffer,
      renderCommands: options.includeDeprecatedRenderCommands ? bridge.readRenderCommands() : EMPTY_RENDER_COMMANDS,
    });
  });

  const requireAssetHost = (): AssetHost => {
    if (!assetHost) {
      throw new Error("loadAssets() requires an AssetHost. Pass WebGL2Renderer as the third createEngine() argument.");
    }
    return assetHost;
  };

  const setTextureIds = (textureIds: ShooterTextureIds): void => {
    rustEngine.set_texture_ids(textureIds.player, textureIds.enemy, textureIds.bullet);
  };

  const setSoundIds = (soundIds: ShooterSoundIds): void => {
    rustEngine.set_sound_ids(soundIds.shoot, soundIds.hit, soundIds.gameOver);
  };

  const setGameSpec = (spec: ShooterGameSpec): ResolvedShooterGameSpec => {
    return applyShooterGameSpec(rustEngine, spec);
  };

  return {
    start: () => loop.start(), pause: () => loop.pause(), resume: () => loop.resume(), stop: () => loop.stop(),
    destroy: () => { loop.stop(); rustEngine.free(); },
    time: () => rustEngine.time(), version: () => bridge.version(),
    score: () => rustEngine.score(), entityCount: () => rustEngine.entity_count(),
    gameState: () => rustEngine.game_state(), spriteCount: () => rustEngine.sprite_count(),
    resetGame: () => rustEngine.reset_game(),
    loadAssets: async (manifest, onProgress) => await requireAssetHost().loadAssets(manifest, onProgress),
    textureId: (name) => requireAssetHost().textureId(name),
    soundId: (name) => {
      const host = requireAssetHost();
      if (!host.soundId) {
        throw new Error("soundId() requires an AssetHost with sound support. Pass WebGL2Renderer as the third createEngine() argument.");
      }
      return host.soundId(name);
    },
    setTextureIds,
    setSoundIds,
    setGameSpec,
    setViewportSize: (width, height) => rustEngine.set_viewport_size(width, height),
    cameraX: () => rustEngine.camera_x(),
    cameraY: () => rustEngine.camera_y(),
  };
}
