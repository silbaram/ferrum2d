import type { Engine } from "../pkg/ferrum_core";
import { applyShooterGameSpec } from "./gameSpec";
import type { ResolvedShooterGameSpec, ShooterGameSpec } from "./gameSpec";
import {
  applyBehaviorStateMachineStateCommands as applyBehaviorStateMachineStateCommandsToRuntime,
  createBehaviorStateMachineCurrentStateCommandPlan as createBehaviorStateMachineCurrentStateCommandPlanFromRuntime,
  installBehaviorStateMachineRuntime as installBehaviorStateMachineRuntimeOnEngine,
  preflightBehaviorStateMachineStateCommands as preflightBehaviorStateMachineStateCommandsToRuntime,
} from "./behaviorStateMachine.js";
import { applyGameplayBehaviorCommands as applyGameplayBehaviorCommandsToRuntime } from "./gameplayAuthoring.js";
import {
  BUILT_IN_SHOOTER_STATE_FORMAT,
  BUILT_IN_SHOOTER_STATE_VERSION,
  validateBuiltInShooterStateSnapshot,
} from "./builtInShooterStateSnapshot.js";
import type { BuiltInShooterStateSnapshot } from "./builtInShooterStateSnapshot.js";
import { resolvePhysicsSpec } from "./physicsSpec.js";
import type { ResolvedPhysicsSpec } from "./physicsSpec.js";
import { finiteNumber, particlePresetId, resolveParticlePresetConfigForWasm, uint32Number } from "./particlePreset";
import type { ParticlePresetConfig } from "./particlePreset";
import { createPhysicsBodyApi } from "./physicsBodyApi.js";
import { createPhysicsJointApi } from "./physicsJointApi.js";
import { createPhysicsQueryApi } from "./physicsQueryApi.js";
import type {
  AssetHost,
  CreateEngineOptions,
  EngineLifecycleSnapshot,
  FerrumAssetApi,
  FerrumEngine,
  FerrumGameplayAuthoringApi,
  FerrumInputActionApi,
  FerrumLifecycleApi,
  FerrumParticleApi,
  FerrumPhysicsRuntimeApi,
  FerrumSceneApi,
  FixedTimestepOptions,
  FrameHandler,
  InputActionActivation,
  InputActionRuntimeBinding,
  InputActionRuntimeControl,
  InputProvider,
  PhysicsDebugOptions,
  PhysicsRigidBodyStepOptions,
  PhysicsRigidBodyStepStats,
  ShooterSoundIds,
  ShooterTextureIds,
  ViewportProvider,
} from "./engineTypes.js";
import type {
  BehaviorRecipeCommand,
  BehaviorRecipeDocumentSpec,
  ResolvedBehaviorRecipeDocument,
} from "./behaviorRecipes.js";
import type {
  ApplyBehaviorStateMachineStateCommandsOptions,
  BehaviorStateMachineDocumentSpec,
  BehaviorStateMachineRuntimeInstallOptions,
  BehaviorStateMachineRuntimeInstallPlan,
  BehaviorStateMachineStateCommandPreflightResult,
  BehaviorStateMachineStateCommandOptions,
  BehaviorStateMachineStateCommandPlan,
  ResolvedBehaviorStateMachineDocument,
} from "./behaviorStateMachine.js";
import type {
  ApplyGameplayBehaviorCommandsOptions,
  GameplayEntityHandle,
  GameplayEntityHandleMap,
} from "./gameplayAuthoring.js";
import {
  applyFixedTimestepOptions,
  applyPhysicsRuntimeOptions,
  configureAutoRigidBodyStepOptions,
  physicsDebugFlags,
  stepRigidBodiesWithStats,
} from "./physicsRuntimeControls.js";
import { createTilemapSceneApi } from "./engineTilemapApi.js";
import { GameLoop } from "./gameLoop";
import { runFrame } from "./engineFramePipeline.js";
import type { FramePipelineContext, RenderFrameHandler } from "./engineFramePipeline.js";
import type { ShooterStateBufferView } from "./wasmBridge";
import { WasmBridge } from "./wasmBridge";

export {
  PHYSICS_BODY_STATE_BUFFER_FORMAT,
  PHYSICS_BODY_STATE_BUFFER_VERSION,
  PHYSICS_BODY_STATE_FLOATS_PER_BODY,
  PHYSICS_BODY_STATE_U32S_PER_BODY,
  createPhysicsBodyStateBufferSnapshot,
} from "./physicsBodyStateBuffer.js";
export type { PhysicsBodyStateBufferSnapshot } from "./physicsBodyStateBuffer.js";

export type {
  ActionFrameDiagnostics,
  AssetHost,
  AudioBusConfig,
  CreateEngineOptions,
  EngineLifecycleHooks,
  EngineLifecycleSnapshot,
  FerrumAssetApi,
  FerrumEngine,
  FerrumGameplayAuthoringApi,
  FerrumInputActionApi,
  FerrumLifecycleApi,
  FerrumParticleApi,
  FerrumPhysicsApi,
  FerrumPhysicsBodyApi,
  FerrumPhysicsJointApi,
  FerrumPhysicsQueryApi,
  FerrumPhysicsRuntimeApi,
  FerrumSceneApi,
  FixedTimestepOptions,
  FrameHandler,
  FrameState,
  SpawnFrameDiagnostics,
  InputActionActivation,
  InputActionRuntimeBinding,
  InputActionRuntimeControl,
  InputProvider,
  PhysicsAabbBodyQuery,
  PhysicsAabbBodyShapeCastQuery,
  PhysicsAabbTileObstacleContactQuery,
  PhysicsAabbTileObstacleManifoldQuery,
  PhysicsAabbTileObstacleShapeCastQuery,
  PhysicsBodyHeightSpan,
  PhysicsBodyColliderOptions,
  PhysicsBodyColliderSnapshot,
  PhysicsBodyContactQuery,
  PhysicsBodyHeightSpanQuery,
  PhysicsBodyManifoldQuery,
  PhysicsCapsuleBodyQuery,
  PhysicsCapsuleBodyShapeCastQuery,
  PhysicsCircleBodyQuery,
  PhysicsCircleBodyShapeCastQuery,
  PhysicsColliderType,
  PhysicsCollisionLayer,
  PhysicsConvexPolygonBodyQuery,
  PhysicsConvexPolygonBodyShapeCastQuery,
  PhysicsConvexPolygonVertexBuffer,
  PhysicsDebugOptions,
  PhysicsEntityHandle,
  PhysicsEntitySnapshot,
  PhysicsFrameStats,
  PhysicsHd2dKinematicMoveOptions,
  PhysicsHd2dKinematicMoveResult,
  PhysicsJointBaseOptions,
  PhysicsJointHandle,
  PhysicsJointSnapshot,
  PhysicsJointSpawnOptions,
  PhysicsJointType,
  PhysicsMaterialSnapshot,
  PhysicsNearestBodyHit,
  PhysicsNearestBodyQuery,
  PhysicsNearestTileObstacleHit,
  PhysicsNearestTileObstacleQuery,
  PhysicsOrientedBoxBodyQuery,
  PhysicsOrientedBoxBodyShapeCastQuery,
  PhysicsPointBodyQuery,
  PhysicsRaycastBodyQuery,
  PhysicsRaycastTileObstacleQuery,
  PhysicsRigidBodyCollider,
  PhysicsRigidBodyMassProperties,
  PhysicsRigidBodyMaterial,
  PhysicsRigidBodySpawnOptions,
  PhysicsRigidBodyStepOptions,
  PhysicsRigidBodyStepStats,
  PhysicsRigidBodyTuning,
  PhysicsRigidBodyType,
  PhysicsSegmentCastBodyQuery,
  PhysicsSegmentCastTileObstacleQuery,
  PhysicsShapeCastMotionQuery,
  PhysicsTileShapeCastMotionQuery,
  PhysicsTileHeightSpan,
  PhysicsTileHeightSpanQuery,
  ShooterTileBridgePortalMetadata,
  ShooterTileHd2dMetadata,
  ShooterSoundIds,
  ShooterTextureIds,
  TilemapNavigationPath,
  TilemapNavigationPathPoint,
  TilemapNavigationPathQuery,
  TilemapNavigationWaypoint,
  TilemapNavigationWaypointQuery,
  TilemapRectEditOptions,
  ViewportProvider,
  ViewportSnapshot,
} from "./engineTypes.js";

export async function createEngine(
  onFrame?: FrameHandler,
  inputProvider?: InputProvider,
  assetHost?: AssetHost,
  viewportProvider?: ViewportProvider,
  options: CreateEngineOptions = {},
): Promise<FerrumEngine> {
  return createEngineWithFramePipeline(
    { onFrame, needsFrameState: onFrame !== undefined },
    inputProvider,
    assetHost,
    viewportProvider,
    options,
  );
}

export interface EngineFramePipelineHandlers {
  onFrame?: FrameHandler;
  onRenderFrame?: RenderFrameHandler;
  needsFrameState?: boolean;
  needsPhysicsDebugLineBuffer?: boolean;
}

export async function createEngineWithFramePipeline(
  frameHandlers: EngineFramePipelineHandlers,
  inputProvider?: InputProvider,
  assetHost?: AssetHost,
  viewportProvider?: ViewportProvider,
  options: CreateEngineOptions = {},
): Promise<FerrumEngine> {
  const bridge = await WasmBridge.init();
  const rustEngine: Engine = bridge.engine();
  rustEngine.set_collision_lifecycle_events_enabled(options.includeCollisionEvents === true);
  const initialPhysicsSpec = resolvePhysicsSpec(undefined, {
    modeOverride: options.physicsMode,
  });
  applyPhysicsRuntimeOptions(rustEngine, initialPhysicsSpec, options, options.physicsMode !== undefined);
  const framePipeline: FramePipelineContext = {
    bridge,
    rustEngine,
    physicsSpec: initialPhysicsSpec,
    onFrame: frameHandlers.onFrame,
    onRenderFrame: frameHandlers.onRenderFrame,
    needsFrameState: frameHandlers.needsFrameState,
    needsPhysicsDebugLineBuffer: frameHandlers.needsPhysicsDebugLineBuffer,
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
      physicsModeOverride: options.physicsMode,
    });
    framePipeline.physicsSpec = resolved.physics;
    applyPhysicsRuntimeOptions(
      rustEngine,
      resolved.physics,
      options,
      spec.physics !== undefined || options.physicsMode !== undefined,
    );
    assetHost?.configureAudio?.({
      masterVolume: resolved.audioMasterVolume,
      sfxVolume: resolved.audioSfxVolume,
    });
    assetHost?.setPostProcess?.(resolved.postProcessing);
    return resolved;
  };

  const configurePhysicsRuntime = (spec: ResolvedPhysicsSpec): ResolvedPhysicsSpec => {
    requireAlive();
    framePipeline.physicsSpec = spec;
    applyPhysicsRuntimeOptions(rustEngine, spec, options, true);
    return spec;
  };

  const captureShooterStateSnapshot = (): BuiltInShooterStateSnapshot | undefined => {
    requireAlive();
    if (!rustEngine.capture_shooter_snapshot()) {
      return undefined;
    }
    return copyBuiltInShooterStateSnapshot(bridge.readShooterStateBuffer());
  };

  const restoreShooterStateSnapshot = (snapshot: BuiltInShooterStateSnapshot): boolean => {
    requireAlive();
    validateBuiltInShooterStateSnapshot(snapshot);
    return rustEngine.restore_shooter_snapshot(
      new Float32Array(snapshot.headerFloats),
      new Uint32Array(snapshot.headerU32s),
      new Float32Array(snapshot.entityFloats),
      new Uint32Array(snapshot.entityU32s),
    );
  };

  const builtInShooterPlayerHandle = (): GameplayEntityHandle | undefined => {
    requireAlive();
    const entityId = rustEngine.built_in_shooter_player_entity_id();
    if (entityId === 0xffffffff) {
      return undefined;
    }
    return {
      entityId,
      entityGeneration: rustEngine.built_in_shooter_player_entity_generation(),
    };
  };

  const setParticlePreset = (presetId: number, preset: ParticlePresetConfig): void => {
    requireAlive();
    const id = particlePresetId(presetId);
    const resolved = resolveParticlePresetConfigForWasm(preset, (name) => requireAssetHost().textureId(name));
    rustEngine.set_particle_preset(
      id,
      resolved.textureId,
      resolved.uv.u0,
      resolved.uv.v0,
      resolved.uv.u1,
      resolved.uv.v1,
      resolved.burstCount,
      resolved.lifetime[0],
      resolved.lifetime[1],
      resolved.speed[0],
      resolved.speed[1],
      resolved.startSize[0],
      resolved.startSize[1],
      resolved.endSize[0],
      resolved.endSize[1],
      resolved.startColor[0],
      resolved.startColor[1],
      resolved.startColor[2],
      resolved.startColor[3],
      resolved.endColor[0],
      resolved.endColor[1],
      resolved.endColor[2],
      resolved.endColor[3],
      resolved.accelerationX,
      resolved.accelerationY,
      resolved.damping,
    );
  };

  const spawnParticleBurst = (presetId: number, x: number, y: number): number => {
    requireAlive();
    return rustEngine.spawn_particle_burst(
      particlePresetId(presetId),
      finiteNumber(x, "particle burst x"),
      finiteNumber(y, "particle burst y"),
    );
  };

  const useBreakoutGame = (): void => {
    requireAlive();
    rustEngine.use_breakout_scene();
  };

  const usePlatformerGame = (): void => {
    requireAlive();
    rustEngine.use_platformer_scene();
  };

  const configureFixedTimestep = (fixedTimestep: boolean | FixedTimestepOptions): void => {
    requireAlive();
    applyFixedTimestepOptions(rustEngine, fixedTimestep);
  };

  const configureAutoRigidBodyStep = (autoStep: boolean | PhysicsRigidBodyStepOptions): void => {
    requireAlive();
    configureAutoRigidBodyStepOptions(rustEngine, autoStep);
  };

  const setPhysicsDebugLinesEnabled = (enabled: boolean | PhysicsDebugOptions): void => {
    requireAlive();
    const flags = physicsDebugFlags(enabled);
    rustEngine.set_physics_debug_line_flags(flags);
    rustEngine.set_physics_debug_lines_enabled(flags !== 0);
  };

  const setPhysicsDebugOptions = (options: PhysicsDebugOptions): void => {
    requireAlive();
    const flags = physicsDebugFlags(options);
    rustEngine.set_physics_debug_line_flags(flags);
    rustEngine.set_physics_debug_lines_enabled(flags !== 0);
  };

  const stepRigidBodies = (
    deltaSeconds: number,
    options?: PhysicsRigidBodyStepOptions,
  ): PhysicsRigidBodyStepStats => {
    requireAlive();
    return stepRigidBodiesWithStats(rustEngine, deltaSeconds, options);
  };

  const tilemapSceneApi = createTilemapSceneApi({ rustEngine, bridge, requireAlive });

  const lifecycleApi: FerrumLifecycleApi = {
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
  };

  const sceneApi: FerrumSceneApi = {
    score: () => { requireAlive(); return rustEngine.score(); },
    entityCount: () => { requireAlive(); return rustEngine.entity_count(); },
    gameState: () => { requireAlive(); return rustEngine.game_state(); },
    spriteCount: () => { requireAlive(); return rustEngine.sprite_count(); },
    resetGame: () => { requireAlive(); rustEngine.reset_game(); },
    builtInShooterPlayerHandle,
    captureShooterStateSnapshot,
    restoreShooterStateSnapshot,
    useBreakoutGame,
    usePlatformerGame,
    setViewportSize: (width, height) => {
      requireAlive();
      rustEngine.set_viewport_size(width, height);
      framePipeline.viewportDirty = true;
    },
    setGameSpec,
    ...tilemapSceneApi,
    cameraX: () => { requireAlive(); return rustEngine.camera_x(); },
    cameraY: () => { requireAlive(); return rustEngine.camera_y(); },
  };

  const assetApi: FerrumAssetApi = {
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
  };

  const particleApi: FerrumParticleApi = {
    setParticlePreset,
    clearParticlePresets: () => { requireAlive(); rustEngine.clear_particle_presets(); },
    setShooterHitParticlePreset: (presetId) => {
      requireAlive();
      rustEngine.set_shooter_hit_particle_preset(particlePresetId(presetId));
    },
    clearShooterHitParticlePreset: () => { requireAlive(); rustEngine.clear_shooter_hit_particle_preset(); },
    setParticleSeed: (seed) => { requireAlive(); rustEngine.set_particle_seed(uint32Number(seed, "particle seed")); },
    spawnParticleBurst,
    clearParticles: () => { requireAlive(); rustEngine.clear_particles(); },
    particleCount: () => { requireAlive(); return rustEngine.particle_count(); },
    particleCapacity: () => { requireAlive(); return rustEngine.particle_capacity(); },
  };

  const physicsRuntimeApi: FerrumPhysicsRuntimeApi = {
    configurePhysicsRuntime,
    configureFixedTimestep,
    configureAutoRigidBodyStep,
    setPhysicsDebugLinesEnabled,
    setPhysicsDebugOptions,
    stepRigidBodies,
  };

  const physicsBodyApi = createPhysicsBodyApi({ rustEngine, bridge, requireAlive });

  const physicsJointApi = createPhysicsJointApi({ rustEngine, requireAlive });
  const physicsQueryApi = createPhysicsQueryApi({ rustEngine, bridge, requireAlive });
  const inputActionApi: FerrumInputActionApi = {
    setInputActionBinding: (actionId, bindingIndex, binding) => {
      requireAlive();
      return rustEngine.set_input_action_binding(
        positiveUint32Number(actionId, "inputAction.actionId"),
        uint32Number(bindingIndex, "inputAction.bindingIndex"),
        inputActionControlCode(binding.control),
        inputActionActivationCode(binding.activation),
      );
    },
    clearInputActionBindings: (actionId) => {
      requireAlive();
      return rustEngine.clear_input_action_bindings(positiveUint32Number(actionId, "inputAction.actionId"));
    },
    resetInputActionBindings: () => {
      requireAlive();
      rustEngine.reset_input_action_bindings();
    },
  };
  const gameplayAuthoringApi: FerrumGameplayAuthoringApi = {
    gameplayEntityExists: (entity: GameplayEntityHandle) => {
      requireAlive();
      const handle = gameplayAuthoringEntityHandle(entity, "gameplayEntityExists.entity");
      return rustEngine.gameplay_entity_exists(handle.entityId, handle.entityGeneration);
    },
    applyGameplayBehaviorCommands: (
      commands: readonly BehaviorRecipeCommand[],
      entityHandles: GameplayEntityHandleMap,
      options?: ApplyGameplayBehaviorCommandsOptions,
    ) => {
      requireAlive();
      return applyGameplayBehaviorCommandsToRuntime(rustEngine, commands, entityHandles, options);
    },
    installBehaviorStateMachineRuntime: (
      document: BehaviorStateMachineDocumentSpec | ResolvedBehaviorStateMachineDocument,
      machineId: string,
      entity: GameplayEntityHandle,
      options?: BehaviorStateMachineRuntimeInstallOptions,
    ) => {
      requireAlive();
      return installBehaviorStateMachineRuntimeOnEngine(
        rustEngine,
        document,
        machineId,
        gameplayAuthoringEntityHandle(entity, "behaviorStateMachines.entity"),
        options,
      );
    },
    gameplayBehaviorState: (entity: GameplayEntityHandle) => {
      requireAlive();
      const handle = gameplayAuthoringEntityHandle(entity, "gameplayBehaviorState.entity");
      return rustEngine.gameplay_behavior_state(handle.entityId, handle.entityGeneration);
    },
    createBehaviorStateMachineCurrentStateCommandPlan: (
      document: BehaviorStateMachineDocumentSpec | ResolvedBehaviorStateMachineDocument,
      recipes: BehaviorRecipeDocumentSpec | ResolvedBehaviorRecipeDocument,
      installPlan: BehaviorStateMachineRuntimeInstallPlan,
      entity: GameplayEntityHandle,
      options?: BehaviorStateMachineStateCommandOptions,
    ) => {
      requireAlive();
      return createBehaviorStateMachineCurrentStateCommandPlanFromRuntime(
        rustEngine,
        document,
        recipes,
        installPlan,
        gameplayAuthoringEntityHandle(entity, "behaviorStateMachines.entity"),
        options,
      );
    },
    applyBehaviorStateMachineStateCommands: (
      plan: BehaviorStateMachineStateCommandPlan,
      entity: GameplayEntityHandle,
      options?: ApplyBehaviorStateMachineStateCommandsOptions,
    ) => {
      requireAlive();
      return applyBehaviorStateMachineStateCommandsToRuntime(
        rustEngine,
        plan,
        gameplayAuthoringEntityHandle(entity, "behaviorStateMachines.entity"),
        options,
      );
    },
    preflightBehaviorStateMachineStateCommands: (
      plan: BehaviorStateMachineStateCommandPlan,
      entity: GameplayEntityHandle,
      options?: ApplyBehaviorStateMachineStateCommandsOptions,
    ): BehaviorStateMachineStateCommandPreflightResult => {
      requireAlive();
      return preflightBehaviorStateMachineStateCommandsToRuntime(
        rustEngine,
        plan,
        gameplayAuthoringEntityHandle(entity, "behaviorStateMachines.entity"),
        options,
      );
    },
  };

  return {
    ...lifecycleApi,
    ...sceneApi,
    ...assetApi,
    ...particleApi,
    ...physicsRuntimeApi,
    ...physicsBodyApi,
    ...physicsJointApi,
    ...physicsQueryApi,
    ...gameplayAuthoringApi,
    ...inputActionApi,
  };
}

function gameplayAuthoringEntityHandle(entity: GameplayEntityHandle, label: string): GameplayEntityHandle {
  return {
    entityId: uint32Number(entity.entityId, `${label}.entityId`),
    entityGeneration: uint32Number(entity.entityGeneration, `${label}.entityGeneration`),
  };
}

function positiveUint32Number(value: number, label: string): number {
  const integer = uint32Number(value, label);
  if (integer === 0) {
    throw new Error(`${label} must be greater than 0.`);
  }
  return integer;
}

function inputActionControlCode(control: InputActionRuntimeControl): number {
  switch (control) {
    case "space":
      return 1;
    case "enter":
      return 2;
    case "mouseLeft":
      return 3;
    default:
      throw new Error("inputAction.control must be 'space', 'enter', or 'mouseLeft'.");
  }
}

function inputActionActivationCode(activation: InputActionActivation): number {
  switch (activation) {
    case "down":
      return 1;
    case "pressed":
      return 2;
    default:
      throw new Error("inputAction.activation must be 'down' or 'pressed'.");
  }
}

function copyBuiltInShooterStateSnapshot(view: ShooterStateBufferView): BuiltInShooterStateSnapshot {
  return {
    format: BUILT_IN_SHOOTER_STATE_FORMAT,
    version: BUILT_IN_SHOOTER_STATE_VERSION,
    headerFloats: Array.from(view.headerFloats),
    headerU32s: Array.from(view.headerU32s),
    entityFloats: Array.from(view.entityFloats),
    entityU32s: Array.from(view.entityU32s),
    entityCount: view.entityCount,
    floatsPerEntity: view.floatsPerEntity,
    u32sPerEntity: view.u32sPerEntity,
  };
}
