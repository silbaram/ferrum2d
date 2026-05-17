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

export type FrameHandler = (state: FrameState) => void;

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

export type InputProvider = () => InputSnapshot;
export type ViewportProvider = () => ViewportSnapshot;

const EMPTY_RENDER_COMMANDS: RenderCommandView[] = [];

interface FramePipelineContext {
  bridge: WasmBridge;
  rustEngine: Engine;
  onFrame?: FrameHandler;
  inputProvider?: InputProvider;
  assetHost?: AssetHost;
  viewportProvider?: ViewportProvider;
  options: CreateEngineOptions;
}

export async function createEngine(
  onFrame?: FrameHandler,
  inputProvider?: InputProvider,
  assetHost?: AssetHost,
  viewportProvider?: ViewportProvider,
  options: CreateEngineOptions = {},
): Promise<FerrumEngine> {
  const bridge = await WasmBridge.init();
  const rustEngine: Engine = bridge.engine();
  const framePipeline: FramePipelineContext = {
    bridge,
    rustEngine,
    onFrame,
    inputProvider,
    assetHost,
    viewportProvider,
    options,
  };

  const loop = new GameLoop((deltaSeconds) => runFrame(framePipeline, deltaSeconds));

  const requireAssetHost = (): AssetHost => {
    if (!assetHost) {
      throw new Error("loadAssets() requires an AssetHost. Pass BrowserPlatformHost as the third createEngine() argument.");
    }
    return assetHost;
  };

  let destroyed = false;

  const requireAlive = (): void => {
    if (destroyed) {
      throw new Error("FerrumEngine has been destroyed.");
    }
  };

  const destroy = (): void => {
    if (destroyed) {
      return;
    }
    destroyed = true;
    loop.stop();
    rustEngine.free();
  };

  const setTextureIds = (textureIds: ShooterTextureIds): void => {
    requireAlive();
    rustEngine.set_texture_ids(textureIds.player, textureIds.enemy, textureIds.bullet);
  };

  const setSoundIds = (soundIds: ShooterSoundIds): void => {
    requireAlive();
    rustEngine.set_sound_ids(soundIds.shoot, soundIds.hit, soundIds.gameOver);
  };

  const setGameSpec = (spec: ShooterGameSpec): ResolvedShooterGameSpec => {
    requireAlive();
    return applyShooterGameSpec(rustEngine, spec, {
      textureId: (name) => requireAssetHost().textureId(name),
    });
  };

  return {
    start: () => { requireAlive(); loop.start(); },
    pause: () => { requireAlive(); loop.pause(); },
    resume: () => { requireAlive(); loop.resume(); },
    stop: () => { if (!destroyed) loop.stop(); },
    destroy,
    time: () => { requireAlive(); return rustEngine.time(); },
    version: () => { requireAlive(); return bridge.version(); },
    score: () => { requireAlive(); return rustEngine.score(); },
    entityCount: () => { requireAlive(); return rustEngine.entity_count(); },
    gameState: () => { requireAlive(); return rustEngine.game_state(); },
    spriteCount: () => { requireAlive(); return rustEngine.sprite_count(); },
    resetGame: () => { requireAlive(); rustEngine.reset_game(); },
    loadAssets: async (manifest, onProgress) => {
      requireAlive();
      return await requireAssetHost().loadAssets(manifest, onProgress);
    },
    textureId: (name) => {
      requireAlive();
      return requireAssetHost().textureId(name);
    },
    soundId: (name) => {
      requireAlive();
      const host = requireAssetHost();
      if (!host.soundId) {
        throw new Error("soundId() requires an AssetHost with sound support. Pass BrowserPlatformHost as the third createEngine() argument.");
      }
      return host.soundId(name);
    },
    setTextureIds,
    setSoundIds,
    setGameSpec,
    setViewportSize: (width, height) => {
      requireAlive();
      rustEngine.set_viewport_size(width, height);
    },
    cameraX: () => { requireAlive(); return rustEngine.camera_x(); },
    cameraY: () => { requireAlive(); return rustEngine.camera_y(); },
  };
}

function runFrame(context: FramePipelineContext, deltaSeconds: number): void {
  const input = pushInput(context.rustEngine, context.inputProvider);
  pushViewport(context.rustEngine, context.viewportProvider);
  const rustUpdateTimeMs = updateRust(context.rustEngine, deltaSeconds);
  const audioEvents = drainAudioEvents(context.bridge, context.rustEngine, context.assetHost);
  const renderCommandBuffer = context.bridge.readRenderCommandBuffer();
  context.onFrame?.(buildFrameState(
    context.bridge,
    context.rustEngine,
    deltaSeconds,
    rustUpdateTimeMs,
    input,
    audioEvents,
    renderCommandBuffer,
    context.options,
  ));
}

function pushInput(rustEngine: Engine, inputProvider?: InputProvider): InputSnapshot | undefined {
  const input = inputProvider?.();
  if (!input) {
    return undefined;
  }
  rustEngine.set_input(
    input.w,
    input.a,
    input.s,
    input.d,
    input.space,
    input.enter,
    input.mouseLeft,
    input.mouseX,
    input.mouseY,
  );
  return input;
}

function pushViewport(rustEngine: Engine, viewportProvider?: ViewportProvider): void {
  const viewport = viewportProvider?.();
  if (viewport) {
    rustEngine.set_viewport_size(viewport.width, viewport.height);
  }
}

function updateRust(rustEngine: Engine, deltaSeconds: number): number {
  const updateStartMs = performance.now();
  rustEngine.update(deltaSeconds);
  return performance.now() - updateStartMs;
}

function drainAudioEvents(bridge: WasmBridge, rustEngine: Engine, assetHost?: AssetHost): AudioEventView[] {
  const audioEvents = bridge.readAudioEvents();
  try {
    if (audioEvents.length > 0) {
      assetHost?.playAudioEvents?.(audioEvents);
    }
  } finally {
    rustEngine.clear_events();
  }
  return audioEvents;
}

function buildFrameState(
  bridge: WasmBridge,
  rustEngine: Engine,
  deltaSeconds: number,
  rustUpdateTimeMs: number,
  input: InputSnapshot | undefined,
  audioEvents: AudioEventView[],
  renderCommandBuffer: RenderCommandBufferView,
  options: CreateEngineOptions,
): FrameState {
  return {
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
  };
}
