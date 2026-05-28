import type { Engine } from "../pkg/ferrum_core";
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
import { decodeRenderCommands } from "./renderCommandDecoder.js";
import type {
  CollisionEventBufferView,
  PhysicsDebugLineBufferView,
  RenderCommandBufferView,
  RenderCommandView,
  WasmBridge,
} from "./wasmBridge.js";

export interface FrameStateBuildInput {
  bridge: WasmBridge;
  rustEngine: Engine;
  deltaSeconds: number;
  rustUpdateTimeMs: number;
  input?: InputSnapshot;
  audioEvents: AudioDrainResult;
  renderCommandBuffer: RenderCommandBufferView;
  collisionEventBuffer: CollisionEventBufferView;
  physicsDebugLineBuffer: PhysicsDebugLineBufferView;
  physicsSpec: ResolvedPhysicsSpec;
  options: CreateEngineOptions;
}

const EMPTY_RENDER_COMMANDS: RenderCommandView[] = [];

export function buildFrameState(input: FrameStateBuildInput): FrameState {
  const {
    bridge,
    rustEngine,
    deltaSeconds,
    rustUpdateTimeMs,
    audioEvents,
    renderCommandBuffer,
    collisionEventBuffer,
    physicsDebugLineBuffer,
    physicsSpec,
    options,
  } = input;
  const physics = buildPhysicsFrameStats(rustEngine, physicsSpec);
  return {
    timeSeconds: rustEngine.time(),
    frameTimeMs: deltaSeconds * 1000,
    rustUpdateTimeMs,
    score: rustEngine.score(),
    entityCount: rustEngine.entity_count(),
    gameState: rustEngine.game_state(),
    spriteCount: rustEngine.sprite_count(),
    mouseX: input.input?.mouseX ?? 0,
    mouseY: input.input?.mouseY ?? 0,
    cameraX: rustEngine.camera_x(),
    cameraY: rustEngine.camera_y(),
    audioEventCount: audioEvents.audioEventCount,
    audioEvents: audioEvents.audioEvents,
    physics,
    collisionEventBuffer,
    collisionEvents: options.includeCollisionEvents
      ? bridge.decodeCollisionEvents(collisionEventBuffer)
      : EMPTY_COLLISION_EVENTS,
    physicsDebugLineBuffer,
    physicsDebugLines: options.includePhysicsDebugLines
      ? bridge.decodePhysicsDebugLines(physicsDebugLineBuffer)
      : EMPTY_PHYSICS_DEBUG_LINES,
    renderCommandBuffer,
    renderCommands: options.includeDeprecatedRenderCommands ? decodeRenderCommands(renderCommandBuffer) : EMPTY_RENDER_COMMANDS,
  };
}

function buildPhysicsFrameStats(
  rustEngine: Engine,
  physicsSpec: ResolvedPhysicsSpec,
): PhysicsFrameStats {
  const collisionEnterEvents = rustEngine.collision_enter_count();
  const collisionStayEvents = rustEngine.collision_stay_count();
  const collisionExitEvents = rustEngine.collision_exit_count();
  const collisionHitEvents = rustEngine.collision_hit_count();
  const collisionTriggerEnterEvents = rustEngine.collision_trigger_enter_count();
  const collisionTriggerStayEvents = rustEngine.collision_trigger_stay_count();
  const collisionTriggerExitEvents = rustEngine.collision_trigger_exit_count();
  return {
    mode: physicsSpec.mode,
    gravityX: physicsSpec.gravityX,
    gravityY: physicsSpec.gravityY,
    continuous: physicsSpec.continuous,
    fixedTimestepEnabled: rustEngine.fixed_timestep_enabled(),
    fixedStepSeconds: physicsSpec.solver.stepSeconds,
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
    collisionPairs: rustEngine.physics_collision_pairs(),
    collisionSolidPairs: rustEngine.physics_collision_solid_pairs(),
    collisionTriggerPairs: rustEngine.physics_collision_trigger_pairs(),
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
    ccdChecks: rustEngine.rigid_body_step_ccd_checks(),
    ccdHits: rustEngine.rigid_body_step_ccd_hits(),
    sleepingBodies: rustEngine.rigid_body_step_sleeping_bodies(),
    brokenJoints: rustEngine.rigid_body_step_broken_joints(),
  };
}
