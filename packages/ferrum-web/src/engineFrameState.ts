import { EMPTY_COLLISION_EVENTS } from "./collisionEventDecoder.js";
import { EMPTY_PHYSICS_DEBUG_LINES } from "./physicsDebugLineDecoder.js";
import type { AudioDrainResult } from "./engineFrameAudio.js";
import type {
  CreateEngineOptions,
  FrameState,
  PhysicsFrameStats,
} from "./engineTypes.js";
import type { InputSnapshot } from "./inputManager.js";
import type { ResolvedPhysicsSpec } from "./physicsSpec.js";
import {
  EMPTY_GAMEPLAY_EVENTS,
  GAMEPLAY_ACTION_FAILURE_MAX_REASON_CODE,
} from "./gameplayEventDecoder.js";
import { decodeRenderCommands } from "./renderCommandDecoder.js";
import type {
  CollisionEventBufferView,
  FrameTelemetryBufferView,
  GameplayEventBufferView,
  PhysicsDebugLineBufferView,
  RenderCommandBufferView,
  RenderCommandView,
  WasmBridge,
} from "./wasmBridge.js";

export interface FrameStateBuildInput {
  bridge: WasmBridge;
  deltaSeconds: number;
  rustUpdateTimeMs: number;
  input?: InputSnapshot;
  audioEvents: AudioDrainResult;
  frameTelemetryBuffer: FrameTelemetryBufferView;
  renderCommandBuffer: RenderCommandBufferView;
  collisionEventBuffer: CollisionEventBufferView;
  gameplayEventBuffer: GameplayEventBufferView;
  physicsDebugLineBuffer: PhysicsDebugLineBufferView;
  physicsSpec: ResolvedPhysicsSpec;
  options: CreateEngineOptions;
}

const EMPTY_RENDER_COMMANDS: RenderCommandView[] = [];
const TELEMETRY_TIME_SECONDS = 0;
const TELEMETRY_SCORE = 1;
const TELEMETRY_ENTITY_COUNT = 2;
const TELEMETRY_GAME_STATE = 3;
const TELEMETRY_SPRITE_COUNT = 4;
const TELEMETRY_CAMERA_X = 5;
const TELEMETRY_CAMERA_Y = 6;
const TELEMETRY_FIXED_TIMESTEP_ENABLED = 7;
const TELEMETRY_FIXED_STEPS = 8;
const TELEMETRY_FIXED_ALPHA = 9;
const TELEMETRY_FIXED_CONSUMED_SECONDS = 10;
const TELEMETRY_FIXED_DROPPED_SECONDS = 11;
const TELEMETRY_KINEMATIC_MOVES = 12;
const TELEMETRY_KINEMATIC_HITS = 13;
const TELEMETRY_KINEMATIC_ENTITY_HITS = 14;
const TELEMETRY_KINEMATIC_TILE_HITS = 15;
const TELEMETRY_SOLID_CANDIDATE_CHECKS = 16;
const TELEMETRY_TILE_CANDIDATE_CHECKS = 17;
const TELEMETRY_HD2D_FILTERED_ENTITY_CANDIDATES = 18;
const TELEMETRY_HD2D_FILTERED_TILE_CANDIDATES = 19;
const TELEMETRY_COLLISION_PAIRS = 20;
const TELEMETRY_COLLISION_SOLID_PAIRS = 21;
const TELEMETRY_COLLISION_TRIGGER_PAIRS = 22;
const TELEMETRY_COLLISION_ENTER_EVENTS = 23;
const TELEMETRY_COLLISION_STAY_EVENTS = 24;
const TELEMETRY_COLLISION_EXIT_EVENTS = 25;
const TELEMETRY_COLLISION_HIT_EVENTS = 26;
const TELEMETRY_COLLISION_TRIGGER_ENTER_EVENTS = 27;
const TELEMETRY_COLLISION_TRIGGER_STAY_EVENTS = 28;
const TELEMETRY_COLLISION_TRIGGER_EXIT_EVENTS = 29;
const TELEMETRY_CCD_CHECKS = 30;
const TELEMETRY_CCD_HITS = 31;
const TELEMETRY_SLEEPING_BODIES = 32;
const TELEMETRY_BROKEN_JOINTS = 33;
const TELEMETRY_PLAYER_FLOOR_ID = 34;
const TELEMETRY_PLAYER_ELEVATION = 35;
const TELEMETRY_PLAYER_HEIGHT = 36;
const TELEMETRY_ACTION_TRIGGER_ATTEMPTS = 37;
const TELEMETRY_ACTION_TRIGGER_FAILURES = 38;
const TELEMETRY_ACTION_TRIGGER_FAILURE_EVENTS_PUSHED = 39;
const TELEMETRY_ACTION_TRIGGER_COMMIT_SKIPS = 40;
const TELEMETRY_ACTION_LAST_PREPARED_TRIGGER_FAILURE_REASON_CODE = 41;
const TELEMETRY_ACTION_FAILURE_REASON_COUNTS = 42;
const TELEMETRY_SPAWN_FLUSH_COMMANDS_DRAINED =
  TELEMETRY_ACTION_FAILURE_REASON_COUNTS + GAMEPLAY_ACTION_FAILURE_MAX_REASON_CODE + 1;
const TELEMETRY_SPAWN_FLUSH_PROJECTILE_SPAWNS =
  TELEMETRY_SPAWN_FLUSH_COMMANDS_DRAINED + 1;
const TELEMETRY_SPAWN_FLUSH_PROJECTILE_ARCS_APPLIED =
  TELEMETRY_SPAWN_FLUSH_PROJECTILE_SPAWNS + 1;
const TELEMETRY_SPAWN_FLUSH_PROJECTILE_SHOOT_AUDIO_EVENTS_PUSHED =
  TELEMETRY_SPAWN_FLUSH_PROJECTILE_ARCS_APPLIED + 1;
const TELEMETRY_SPAWN_FLUSH_PREFAB_SPAWNS =
  TELEMETRY_SPAWN_FLUSH_PROJECTILE_SHOOT_AUDIO_EVENTS_PUSHED + 1;
const TELEMETRY_SPAWN_FLUSH_PREFAB_SPAWNED_PAYLOADS =
  TELEMETRY_SPAWN_FLUSH_PREFAB_SPAWNS + 1;
const TELEMETRY_SPAWN_FLUSH_PREFAB_SPAWNED_EVENTS_PUSHED =
  TELEMETRY_SPAWN_FLUSH_PREFAB_SPAWNED_PAYLOADS + 1;

export function buildFrameState(input: FrameStateBuildInput): FrameState {
  const {
    bridge,
    deltaSeconds,
    rustUpdateTimeMs,
    audioEvents,
    frameTelemetryBuffer,
    renderCommandBuffer,
    collisionEventBuffer,
    gameplayEventBuffer,
    physicsDebugLineBuffer,
    physicsSpec,
    options,
  } = input;
  const includeCollisionLifecycleEvents = options.includeCollisionEvents === true;
  const physics = buildPhysicsFrameStats(
    frameTelemetryBuffer,
    physicsSpec,
    includeCollisionLifecycleEvents,
  );
  const telemetry = frameTelemetryBuffer.buffer;
  return {
    timeSeconds: telemetry[TELEMETRY_TIME_SECONDS],
    frameTimeMs: deltaSeconds * 1000,
    rustUpdateTimeMs,
    score: telemetry[TELEMETRY_SCORE],
    entityCount: telemetry[TELEMETRY_ENTITY_COUNT],
    gameState: telemetry[TELEMETRY_GAME_STATE],
    spriteCount: telemetry[TELEMETRY_SPRITE_COUNT],
    mouseX: input.input?.mouseX ?? 0,
    mouseY: input.input?.mouseY ?? 0,
    cameraX: telemetry[TELEMETRY_CAMERA_X],
    cameraY: telemetry[TELEMETRY_CAMERA_Y],
    playerFloorId: finiteTelemetry(telemetry[TELEMETRY_PLAYER_FLOOR_ID]),
    playerElevation: finiteTelemetry(telemetry[TELEMETRY_PLAYER_ELEVATION]),
    playerHeight: finiteTelemetry(telemetry[TELEMETRY_PLAYER_HEIGHT]),
    actionDiagnostics: buildActionFrameDiagnostics(frameTelemetryBuffer),
    spawnDiagnostics: buildSpawnFrameDiagnostics(frameTelemetryBuffer),
    audioEventCount: audioEvents.audioEventCount,
    audioEvents: audioEvents.audioEvents,
    physics,
    collisionEventBuffer,
    collisionEvents: includeCollisionLifecycleEvents
      ? bridge.decodeCollisionEvents(collisionEventBuffer)
      : EMPTY_COLLISION_EVENTS,
    gameplayEventBuffer,
    gameplayEvents: options.includeGameplayEvents === false
      ? EMPTY_GAMEPLAY_EVENTS
      : bridge.decodeGameplayEvents(gameplayEventBuffer),
    physicsDebugLineBuffer,
    physicsDebugLines: options.includePhysicsDebugLines
      ? bridge.decodePhysicsDebugLines(physicsDebugLineBuffer)
      : EMPTY_PHYSICS_DEBUG_LINES,
    renderCommandBuffer,
    renderCommands: options.includeDeprecatedRenderCommands
      ? decodeRenderCommands(renderCommandBuffer)
      : EMPTY_RENDER_COMMANDS,
  };
}

export function buildActionFrameDiagnostics(frameTelemetryBuffer: FrameTelemetryBufferView) {
  const telemetry = frameTelemetryBuffer.buffer;
  const lastReasonCode = telemetry[TELEMETRY_ACTION_LAST_PREPARED_TRIGGER_FAILURE_REASON_CODE];
  return {
    triggerAttempts: telemetry[TELEMETRY_ACTION_TRIGGER_ATTEMPTS] ?? 0,
    triggerFailures: telemetry[TELEMETRY_ACTION_TRIGGER_FAILURES] ?? 0,
    triggerFailureEventsPushed: telemetry[TELEMETRY_ACTION_TRIGGER_FAILURE_EVENTS_PUSHED] ?? 0,
    triggerCommitSkips: telemetry[TELEMETRY_ACTION_TRIGGER_COMMIT_SKIPS] ?? 0,
    lastPreparedTriggerFailureReasonCode: lastReasonCode > 0 ? lastReasonCode : undefined,
    failureReasonCounts: Array.from(
      { length: GAMEPLAY_ACTION_FAILURE_MAX_REASON_CODE + 1 },
      (_, reasonCode) => telemetry[TELEMETRY_ACTION_FAILURE_REASON_COUNTS + reasonCode] ?? 0,
    ),
  };
}

export function buildSpawnFrameDiagnostics(frameTelemetryBuffer: FrameTelemetryBufferView) {
  const telemetry = frameTelemetryBuffer.buffer;
  return {
    commandsDrained: telemetry[TELEMETRY_SPAWN_FLUSH_COMMANDS_DRAINED] ?? 0,
    projectileSpawns: telemetry[TELEMETRY_SPAWN_FLUSH_PROJECTILE_SPAWNS] ?? 0,
    projectileArcsApplied: telemetry[TELEMETRY_SPAWN_FLUSH_PROJECTILE_ARCS_APPLIED] ?? 0,
    projectileShootAudioEventsPushed:
      telemetry[TELEMETRY_SPAWN_FLUSH_PROJECTILE_SHOOT_AUDIO_EVENTS_PUSHED] ?? 0,
    prefabSpawns: telemetry[TELEMETRY_SPAWN_FLUSH_PREFAB_SPAWNS] ?? 0,
    prefabSpawnedPayloads: telemetry[TELEMETRY_SPAWN_FLUSH_PREFAB_SPAWNED_PAYLOADS] ?? 0,
    prefabSpawnedEventsPushed:
      telemetry[TELEMETRY_SPAWN_FLUSH_PREFAB_SPAWNED_EVENTS_PUSHED] ?? 0,
  };
}

function finiteTelemetry(value: number): number | undefined {
  return Number.isFinite(value) ? value : undefined;
}

function buildPhysicsFrameStats(
  frameTelemetryBuffer: FrameTelemetryBufferView,
  physicsSpec: ResolvedPhysicsSpec,
  includeCollisionLifecycleEvents: boolean,
): PhysicsFrameStats {
  const telemetry = frameTelemetryBuffer.buffer;
  const collisionEnterEvents = includeCollisionLifecycleEvents
    ? telemetry[TELEMETRY_COLLISION_ENTER_EVENTS]
    : 0;
  const collisionStayEvents = includeCollisionLifecycleEvents
    ? telemetry[TELEMETRY_COLLISION_STAY_EVENTS]
    : 0;
  const collisionExitEvents = includeCollisionLifecycleEvents
    ? telemetry[TELEMETRY_COLLISION_EXIT_EVENTS]
    : 0;
  const collisionHitEvents = includeCollisionLifecycleEvents
    ? telemetry[TELEMETRY_COLLISION_HIT_EVENTS]
    : 0;
  const collisionTriggerEnterEvents = includeCollisionLifecycleEvents
    ? telemetry[TELEMETRY_COLLISION_TRIGGER_ENTER_EVENTS]
    : 0;
  const collisionTriggerStayEvents = includeCollisionLifecycleEvents
    ? telemetry[TELEMETRY_COLLISION_TRIGGER_STAY_EVENTS]
    : 0;
  const collisionTriggerExitEvents = includeCollisionLifecycleEvents
    ? telemetry[TELEMETRY_COLLISION_TRIGGER_EXIT_EVENTS]
    : 0;
  return {
    mode: physicsSpec.mode,
    gravityX: physicsSpec.gravityX,
    gravityY: physicsSpec.gravityY,
    continuous: physicsSpec.continuous,
    fixedTimestepEnabled: telemetry[TELEMETRY_FIXED_TIMESTEP_ENABLED] !== 0,
    fixedStepSeconds: physicsSpec.solver.stepSeconds,
    fixedSteps: telemetry[TELEMETRY_FIXED_STEPS],
    fixedAlpha: telemetry[TELEMETRY_FIXED_ALPHA],
    fixedConsumedSeconds: telemetry[TELEMETRY_FIXED_CONSUMED_SECONDS],
    fixedDroppedSeconds: telemetry[TELEMETRY_FIXED_DROPPED_SECONDS],
    kinematicMoves: telemetry[TELEMETRY_KINEMATIC_MOVES],
    kinematicHits: telemetry[TELEMETRY_KINEMATIC_HITS],
    kinematicEntityHits: telemetry[TELEMETRY_KINEMATIC_ENTITY_HITS],
    kinematicTileHits: telemetry[TELEMETRY_KINEMATIC_TILE_HITS],
    solidCandidateChecks: telemetry[TELEMETRY_SOLID_CANDIDATE_CHECKS],
    tileCandidateChecks: telemetry[TELEMETRY_TILE_CANDIDATE_CHECKS],
    hd2dFilteredEntityCandidates: telemetry[TELEMETRY_HD2D_FILTERED_ENTITY_CANDIDATES],
    hd2dFilteredTileCandidates: telemetry[TELEMETRY_HD2D_FILTERED_TILE_CANDIDATES],
    collisionLifecycleEventsEnabled: includeCollisionLifecycleEvents,
    collisionPairs: includeCollisionLifecycleEvents ? telemetry[TELEMETRY_COLLISION_PAIRS] : 0,
    collisionSolidPairs: includeCollisionLifecycleEvents
      ? telemetry[TELEMETRY_COLLISION_SOLID_PAIRS]
      : 0,
    collisionTriggerPairs: includeCollisionLifecycleEvents
      ? telemetry[TELEMETRY_COLLISION_TRIGGER_PAIRS]
      : 0,
    collisionEnterEvents,
    collisionStayEvents,
    collisionExitEvents,
    collisionHitEvents,
    collisionTriggerEnterEvents,
    collisionTriggerStayEvents,
    collisionTriggerExitEvents,
    collisionEventCount:
      collisionEnterEvents +
      collisionStayEvents +
      collisionExitEvents +
      collisionHitEvents +
      collisionTriggerEnterEvents +
      collisionTriggerStayEvents +
      collisionTriggerExitEvents,
    ccdChecks: telemetry[TELEMETRY_CCD_CHECKS],
    ccdHits: telemetry[TELEMETRY_CCD_HITS],
    sleepingBodies: telemetry[TELEMETRY_SLEEPING_BODIES],
    brokenJoints: telemetry[TELEMETRY_BROKEN_JOINTS],
  };
}
