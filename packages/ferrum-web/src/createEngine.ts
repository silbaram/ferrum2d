import type { Engine } from "../pkg/ferrum_core";
import type { AssetLoadProgressCallback, AssetManifest, LoadedAssets } from "./assetLoader";
import { applyShooterGameSpec } from "./gameSpec";
import type { ResolvedShooterGameSpec, ShooterGameSpec } from "./gameSpec";
import { GameLoop } from "./gameLoop";
import type { InputSnapshot } from "./inputManager";
import { EMPTY_AUDIO_EVENTS } from "./wasmBridge";
import { EMPTY_COLLISION_EVENTS } from "./collisionEventDecoder";
import type {
  AudioEventBufferView,
  AudioEventView,
  CollisionEventBufferView,
  CollisionEventView,
  RenderCommandBufferView,
  RenderCommandView,
} from "./wasmBridge";
import { WasmBridge } from "./wasmBridge";

export interface AssetHost {
  loadAssets(manifest: AssetManifest, onProgress?: AssetLoadProgressCallback): Promise<LoadedAssets>;
  textureId(name: string): number;
  soundId?(name: string): number;
  playAudioEventBuffer?(events: AudioEventBufferView): void;
  playAudioEvents?(events: readonly AudioEventView[]): void;
  configureAudio?(config: AudioBusConfig): void;
}

export interface AudioBusConfig {
  masterVolume: number;
  sfxVolume: number;
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
  audioEventCount: number;
  audioEvents: readonly AudioEventView[];
  physics: PhysicsFrameStats;
  collisionEventBuffer: CollisionEventBufferView;
  collisionEvents: readonly CollisionEventView[];
  /** @deprecated 호환성 유지용. hot path에서는 renderCommandBuffer를 사용하세요. */
  renderCommands: RenderCommandView[];
  renderCommandBuffer: RenderCommandBufferView;
}

export type FrameHandler = (state: FrameState) => void;

export interface FixedTimestepOptions {
  enabled?: boolean;
  stepSeconds?: number;
  maxFrameSeconds?: number;
  maxStepsPerUpdate?: number;
}

export interface PhysicsFrameStats {
  fixedTimestepEnabled: boolean;
  fixedSteps: number;
  fixedAlpha: number;
  fixedConsumedSeconds: number;
  fixedDroppedSeconds: number;
  kinematicMoves: number;
  kinematicHits: number;
  kinematicEntityHits: number;
  kinematicTileHits: number;
  solidCandidateChecks: number;
  tileCandidateChecks: number;
  collisionEnterEvents: number;
  collisionStayEvents: number;
  collisionExitEvents: number;
  collisionHitEvents: number;
  collisionEventCount: number;
}

export interface EngineLifecycleSnapshot {
  timeSeconds: number;
  score: number;
  entityCount: number;
  gameState: number;
  spriteCount: number;
}

export interface EngineLifecycleHooks {
  onStart?(snapshot: EngineLifecycleSnapshot): void;
  onPause?(snapshot: EngineLifecycleSnapshot): void;
  onResume?(snapshot: EngineLifecycleSnapshot): void;
  onStop?(snapshot: EngineLifecycleSnapshot): void;
  onDestroy?(snapshot: EngineLifecycleSnapshot): void;
}

export interface CreateEngineOptions {
  /** @deprecated 호환 API 사용자만 켜세요. 매 프레임 command object 배열을 생성합니다. */
  includeDeprecatedRenderCommands?: boolean;
  /** @deprecated Worker clock는 현재 MVP 범위 밖이며 이 옵션은 무시됩니다. */
  useWorkerClock?: boolean;
  /** FrameState에 decoded audio event object 배열을 포함할지 여부입니다. 기본값은 true입니다. */
  includeAudioEvents?: boolean;
  /** FrameState에 decoded collision event object 배열을 포함할지 여부입니다. 기본값은 false입니다. */
  includeCollisionEvents?: boolean;
  /** Optional fixed timestep simulation mode. 기본값은 disabled variable-delta update입니다. */
  fixedTimestep?: boolean | FixedTimestepOptions;
  /** Platform lifecycle callbacks. These receive snapshots only and must not own simulation state. */
  lifecycle?: EngineLifecycleHooks;
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
  configureFixedTimestep(options: boolean | FixedTimestepOptions): void;
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

interface AudioDrainResult {
  audioEventCount: number;
  audioEvents: readonly AudioEventView[];
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
  applyFixedTimestepOptions(rustEngine, options.fixedTimestep);
  const framePipeline: FramePipelineContext = {
    bridge,
    rustEngine,
    onFrame,
    inputProvider,
    assetHost,
    viewportProvider,
    options,
  };

  const loop = new GameLoop(
    (deltaSeconds) => runFrame(framePipeline, deltaSeconds),
    0.05,
  );

  const requireAssetHost = (): AssetHost => {
    if (!assetHost) {
      throw new Error("loadAssets() requires an AssetHost. Pass BrowserPlatformHost as the third createEngine() argument.");
    }
    return assetHost;
  };

  let destroyed = false;
  let running = false;
  let paused = false;

  const requireAlive = (): void => {
    if (destroyed) {
      throw new Error("FerrumEngine has been destroyed.");
    }
  };

  const lifecycleSnapshot = (): EngineLifecycleSnapshot => ({
    timeSeconds: rustEngine.time(),
    score: rustEngine.score(),
    entityCount: rustEngine.entity_count(),
    gameState: rustEngine.game_state(),
    spriteCount: rustEngine.sprite_count(),
  });

  const destroy = (): void => {
    if (destroyed) {
      return;
    }
    const snapshot = lifecycleSnapshot();
    destroyed = true;
    running = false;
    paused = false;
    loop.stop();
    try {
      options.lifecycle?.onDestroy?.(snapshot);
    } finally {
      rustEngine.free();
    }
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
    const resolved = applyShooterGameSpec(rustEngine, spec, {
      textureId: (name) => requireAssetHost().textureId(name),
    });
    assetHost?.configureAudio?.({
      masterVolume: resolved.audioMasterVolume,
      sfxVolume: resolved.audioSfxVolume,
    });
    return resolved;
  };

  const configureFixedTimestep = (fixedTimestep: boolean | FixedTimestepOptions): void => {
    requireAlive();
    applyFixedTimestepOptions(rustEngine, fixedTimestep);
  };

  return {
    start: () => {
      requireAlive();
      if (running) {
        return;
      }
      loop.start();
      running = true;
      paused = false;
      options.lifecycle?.onStart?.(lifecycleSnapshot());
    },
    pause: () => {
      requireAlive();
      if (!running || paused) {
        return;
      }
      loop.pause();
      paused = true;
      options.lifecycle?.onPause?.(lifecycleSnapshot());
    },
    resume: () => {
      requireAlive();
      if (!running || !paused) {
        return;
      }
      loop.resume();
      paused = false;
      options.lifecycle?.onResume?.(lifecycleSnapshot());
    },
    stop: () => {
      if (destroyed || !running) {
        return;
      }
      const snapshot = lifecycleSnapshot();
      loop.stop();
      running = false;
      paused = false;
      options.lifecycle?.onStop?.(snapshot);
    },
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
    configureFixedTimestep,
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
  const audioEvents = drainAudioEvents(context.bridge, context.rustEngine, context.assetHost, context.options.includeAudioEvents ?? true);
  const renderCommandBuffer = context.bridge.readRenderCommandBuffer();
  const collisionEventBuffer = context.bridge.readCollisionEventBuffer();
  context.onFrame?.(buildFrameState(
    context.bridge,
    context.rustEngine,
    deltaSeconds,
    rustUpdateTimeMs,
    input,
    audioEvents,
    renderCommandBuffer,
    collisionEventBuffer,
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

function drainAudioEvents(
  bridge: WasmBridge,
  rustEngine: Engine,
  assetHost: AssetHost | undefined,
  includeAudioEvents: boolean,
): AudioDrainResult {
  const audioEventBuffer = bridge.readAudioEventBuffer();
  let decodedAudioEvents: readonly AudioEventView[] | undefined;
  const decodeAudioEvents = (): readonly AudioEventView[] => {
    decodedAudioEvents ??= bridge.decodeAudioEvents(audioEventBuffer);
    return decodedAudioEvents;
  };

  try {
    if (audioEventBuffer.eventCount > 0) {
      if (assetHost?.playAudioEventBuffer) {
        assetHost.playAudioEventBuffer(audioEventBuffer);
      } else {
        assetHost?.playAudioEvents?.(decodeAudioEvents());
      }
    }
  } finally {
    rustEngine.clear_audio_events();
  }
  return {
    audioEventCount: audioEventBuffer.eventCount,
    audioEvents: includeAudioEvents ? decodeAudioEvents() : EMPTY_AUDIO_EVENTS,
  };
}

function buildFrameState(
  bridge: WasmBridge,
  rustEngine: Engine,
  deltaSeconds: number,
  rustUpdateTimeMs: number,
  input: InputSnapshot | undefined,
  audioEvents: AudioDrainResult,
  renderCommandBuffer: RenderCommandBufferView,
  collisionEventBuffer: CollisionEventBufferView,
  options: CreateEngineOptions,
): FrameState {
  const physics = buildPhysicsFrameStats(rustEngine);
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
    audioEventCount: audioEvents.audioEventCount,
    audioEvents: audioEvents.audioEvents,
    physics,
    collisionEventBuffer,
    collisionEvents: options.includeCollisionEvents
      ? bridge.decodeCollisionEvents(collisionEventBuffer)
      : EMPTY_COLLISION_EVENTS,
    renderCommandBuffer,
    renderCommands: options.includeDeprecatedRenderCommands ? bridge.readRenderCommands() : EMPTY_RENDER_COMMANDS,
  };
}

function buildPhysicsFrameStats(rustEngine: Engine): PhysicsFrameStats {
  const collisionEnterEvents = rustEngine.collision_enter_count();
  const collisionStayEvents = rustEngine.collision_stay_count();
  const collisionExitEvents = rustEngine.collision_exit_count();
  const collisionHitEvents = rustEngine.collision_hit_count();
  return {
    fixedTimestepEnabled: rustEngine.fixed_timestep_enabled(),
    fixedSteps: rustEngine.physics_fixed_steps(),
    fixedAlpha: rustEngine.fixed_timestep_alpha(),
    fixedConsumedSeconds: rustEngine.fixed_timestep_consumed_seconds(),
    fixedDroppedSeconds: rustEngine.fixed_timestep_dropped_seconds(),
    kinematicMoves: rustEngine.physics_kinematic_moves(),
    kinematicHits: rustEngine.physics_kinematic_hits(),
    kinematicEntityHits: rustEngine.physics_kinematic_entity_hits(),
    kinematicTileHits: rustEngine.physics_kinematic_tile_hits(),
    solidCandidateChecks: rustEngine.physics_solid_candidate_checks(),
    tileCandidateChecks: rustEngine.physics_tile_candidate_checks(),
    collisionEnterEvents,
    collisionStayEvents,
    collisionExitEvents,
    collisionHitEvents,
    collisionEventCount:
      collisionEnterEvents + collisionStayEvents + collisionExitEvents + collisionHitEvents,
  };
}

function applyFixedTimestepOptions(
  rustEngine: Engine,
  fixedTimestep: boolean | FixedTimestepOptions | undefined,
): void {
  if (fixedTimestep === undefined) {
    return;
  }
  if (typeof fixedTimestep === "boolean") {
    rustEngine.configure_fixed_timestep(fixedTimestep, 1 / 60, 0.25, 8);
    return;
  }
  rustEngine.configure_fixed_timestep(
    fixedTimestep.enabled ?? true,
    fixedTimestep.stepSeconds ?? 1 / 60,
    fixedTimestep.maxFrameSeconds ?? 0.25,
    fixedTimestep.maxStepsPerUpdate ?? 8,
  );
}
