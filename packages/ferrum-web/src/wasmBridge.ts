import init, { Engine, version, wasm_memory } from "../pkg/ferrum_core.js";
import { decodeCollisionEvents } from "./collisionEventDecoder";
import type { CollisionEventBufferView, CollisionEventView } from "./collisionEventDecoder";
import { decodeGameplayEvents } from "./gameplayEventDecoder";
import type { GameplayEventBufferView, GameplayEventView } from "./gameplayEventDecoder";
import { decodeAudioEvents } from "./audioEventDecoder";
import type { AudioEventBufferView, AudioEventView } from "./audioEventDecoder";
import { decodePhysicsDebugLines } from "./physicsDebugLineDecoder";
import type {
  PhysicsDebugLineBufferView,
  PhysicsDebugLineView,
} from "./physicsDebugLineDecoder";
import {
  decodePhysicsBodyContactHits,
  decodePhysicsBodyManifoldHits,
  decodePhysicsQueryHits,
  decodePhysicsRaycastHits,
  decodePhysicsRigidContactImpulseHits,
  decodePhysicsShapeCastHits,
  decodePhysicsTileContactHits,
  decodePhysicsTileManifoldHits,
  decodePhysicsTileRaycastHits,
  decodePhysicsTileShapeCastHits,
} from "./physicsQueryDecoder";
import type {
  PhysicsBodyContactHit,
  PhysicsBodyContactHitBufferView,
  PhysicsBodyManifoldHit,
  PhysicsBodyManifoldHitBufferView,
  PhysicsBodyQueryHit,
  PhysicsQueryHitBufferView,
  PhysicsRaycastBodyHit,
  PhysicsRaycastHitBufferView,
  PhysicsRigidContactImpulseHit,
  PhysicsRigidContactImpulseHitBufferView,
  PhysicsShapeCastBodyHit,
  PhysicsShapeCastHitBufferView,
  PhysicsTileContactHit,
  PhysicsTileContactHitBufferView,
  PhysicsTileManifoldHit,
  PhysicsTileManifoldHitBufferView,
  PhysicsTileRaycastHit,
  PhysicsTileRaycastHitBufferView,
  PhysicsTileShapeCastHit,
  PhysicsTileShapeCastHitBufferView,
} from "./physicsQueryDecoder";
import { decodeRenderCommands } from "./renderCommandDecoder";
import type { RenderCommandBufferView, RenderCommandView } from "./renderCommandDecoder";
import { verifyWasmBridgeAbi } from "./wasmBridgeAbi.js";
import {
  audioEventBufferView,
  collisionEventBufferView,
  frameTelemetryBufferView,
  gameplayEventBufferView,
  physicsBodyContactHitBufferView,
  physicsBodyManifoldHitBufferView,
  physicsBodyStateBufferView,
  physicsDebugLineBufferView,
  physicsQueryHitBufferView,
  physicsRaycastHitBufferView,
  physicsRigidContactImpulseHitBufferView,
  physicsTileContactHitBufferView,
  physicsTileManifoldHitBufferView,
  physicsTileShapeCastHitBufferView,
  renderCommandBufferView,
  shooterStateBufferView,
  tilemapNavigationDebugLineBufferView,
  tilemapNavigationPathBufferView,
} from "./wasmBridgeBufferViews.js";
import type {
  FrameTelemetryBufferView,
  FrameTelemetryBufferViewCache,
  PhysicsBodyStateBufferView,
  ShooterStateBufferView,
  TilemapNavigationPathBufferView,
  WasmBridgeBufferContext,
} from "./wasmBridgeBufferViews.js";

export class WasmBridge {
  private readonly bufferContext: WasmBridgeBufferContext;
  private readonly frameTelemetryBufferCache: FrameTelemetryBufferViewCache = {};

  private constructor(
    private readonly engineInstance: Engine,
    private readonly memory: WebAssembly.Memory,
  ) {
    const layout = verifyWasmBridgeAbi(this.engineInstance);
    this.bufferContext = {
      engine: this.engineInstance,
      memory: this.memory,
      layout,
    };
  }

  static async init(): Promise<WasmBridge> {
    await init();
    const memory = wasm_memory();
    return new WasmBridge(new Engine(), memory);
  }

  engine(): Engine {
    return this.engineInstance;
  }

  version(): string {
    return version();
  }

  readRenderCommandBuffer(): RenderCommandBufferView {
    return renderCommandBufferView(this.bufferContext);
  }

  readFrameTelemetryBuffer(): FrameTelemetryBufferView {
    return frameTelemetryBufferView(this.bufferContext, this.frameTelemetryBufferCache);
  }

  readRenderCommands(): RenderCommandView[] {
    return decodeRenderCommands(this.readRenderCommandBuffer());
  }

  readAudioEventBuffer(): AudioEventBufferView {
    return audioEventBufferView(this.bufferContext);
  }

  readAudioEvents(): readonly AudioEventView[] {
    return this.decodeAudioEvents(this.readAudioEventBuffer());
  }

  readCollisionEventBuffer(): CollisionEventBufferView {
    return collisionEventBufferView(this.bufferContext);
  }

  readCollisionEvents(): readonly CollisionEventView[] {
    return this.decodeCollisionEvents(this.readCollisionEventBuffer());
  }

  readGameplayEventBuffer(): GameplayEventBufferView {
    return gameplayEventBufferView(this.bufferContext);
  }

  readGameplayEvents(): readonly GameplayEventView[] {
    return this.decodeGameplayEvents(this.readGameplayEventBuffer());
  }

  readPhysicsDebugLineBuffer(): PhysicsDebugLineBufferView {
    return physicsDebugLineBufferView(this.bufferContext);
  }

  readPhysicsDebugLines(): readonly PhysicsDebugLineView[] {
    return this.decodePhysicsDebugLines(this.readPhysicsDebugLineBuffer());
  }

  readTilemapNavigationPathBuffer(): TilemapNavigationPathBufferView {
    return tilemapNavigationPathBufferView(this.bufferContext);
  }

  readTilemapNavigationDebugLineBuffer(): PhysicsDebugLineBufferView {
    return tilemapNavigationDebugLineBufferView(this.bufferContext);
  }

  readShooterStateBuffer(): ShooterStateBufferView {
    return shooterStateBufferView(this.bufferContext);
  }

  readPhysicsQueryHitBuffer(): PhysicsQueryHitBufferView {
    return physicsQueryHitBufferView(this.bufferContext);
  }

  readPhysicsQueryHits(): readonly PhysicsBodyQueryHit[] {
    return this.decodePhysicsQueryHits(this.readPhysicsQueryHitBuffer());
  }

  readPhysicsRaycastHitBuffer(): PhysicsRaycastHitBufferView {
    return physicsRaycastHitBufferView(this.bufferContext);
  }

  readPhysicsRaycastHits(): readonly PhysicsRaycastBodyHit[] {
    return this.decodePhysicsRaycastHits(this.readPhysicsRaycastHitBuffer());
  }

  readPhysicsShapeCastHits(): readonly PhysicsShapeCastBodyHit[] {
    return this.decodePhysicsShapeCastHits(this.readPhysicsRaycastHitBuffer());
  }

  readPhysicsTileShapeCastHitBuffer(): PhysicsTileShapeCastHitBufferView {
    return physicsTileShapeCastHitBufferView(this.bufferContext);
  }

  readPhysicsTileShapeCastHits(): readonly PhysicsTileShapeCastHit[] {
    return this.decodePhysicsTileShapeCastHits(this.readPhysicsTileShapeCastHitBuffer());
  }

  readPhysicsTileRaycastHits(): readonly PhysicsTileRaycastHit[] {
    return this.decodePhysicsTileRaycastHits(this.readPhysicsTileShapeCastHitBuffer());
  }

  readPhysicsTileContactHitBuffer(): PhysicsTileContactHitBufferView {
    return physicsTileContactHitBufferView(this.bufferContext);
  }

  readPhysicsTileContactHits(): readonly PhysicsTileContactHit[] {
    return this.decodePhysicsTileContactHits(this.readPhysicsTileContactHitBuffer());
  }

  readPhysicsTileManifoldHitBuffer(): PhysicsTileManifoldHitBufferView {
    return physicsTileManifoldHitBufferView(this.bufferContext);
  }

  readPhysicsTileManifoldHits(): readonly PhysicsTileManifoldHit[] {
    return this.decodePhysicsTileManifoldHits(this.readPhysicsTileManifoldHitBuffer());
  }

  readPhysicsBodyContactHitBuffer(): PhysicsBodyContactHitBufferView {
    return physicsBodyContactHitBufferView(this.bufferContext);
  }

  readPhysicsBodyContactHits(): readonly PhysicsBodyContactHit[] {
    return this.decodePhysicsBodyContactHits(this.readPhysicsBodyContactHitBuffer());
  }

  readPhysicsBodyManifoldHitBuffer(): PhysicsBodyManifoldHitBufferView {
    return physicsBodyManifoldHitBufferView(this.bufferContext);
  }

  readPhysicsBodyManifoldHits(): readonly PhysicsBodyManifoldHit[] {
    return this.decodePhysicsBodyManifoldHits(this.readPhysicsBodyManifoldHitBuffer());
  }

  readPhysicsRigidContactImpulseHitBuffer(): PhysicsRigidContactImpulseHitBufferView {
    return physicsRigidContactImpulseHitBufferView(this.bufferContext);
  }

  readPhysicsRigidContactImpulseHits(): readonly PhysicsRigidContactImpulseHit[] {
    return this.decodePhysicsRigidContactImpulseHits(
      this.readPhysicsRigidContactImpulseHitBuffer(),
    );
  }

  readPhysicsBodyStateBuffer(): PhysicsBodyStateBufferView {
    return physicsBodyStateBufferView(this.bufferContext);
  }

  decodeCollisionEvents(view: CollisionEventBufferView): readonly CollisionEventView[] {
    return decodeCollisionEvents(view);
  }

  decodeGameplayEvents(view: GameplayEventBufferView): readonly GameplayEventView[] {
    return decodeGameplayEvents(view);
  }

  decodePhysicsDebugLines(view: PhysicsDebugLineBufferView): readonly PhysicsDebugLineView[] {
    return decodePhysicsDebugLines(view);
  }

  decodePhysicsQueryHits(view: PhysicsQueryHitBufferView): readonly PhysicsBodyQueryHit[] {
    return decodePhysicsQueryHits(view);
  }

  decodePhysicsRaycastHits(view: PhysicsRaycastHitBufferView): readonly PhysicsRaycastBodyHit[] {
    return decodePhysicsRaycastHits(view);
  }

  decodePhysicsShapeCastHits(
    view: PhysicsShapeCastHitBufferView,
  ): readonly PhysicsShapeCastBodyHit[] {
    return decodePhysicsShapeCastHits(view);
  }

  decodePhysicsTileShapeCastHits(
    view: PhysicsTileShapeCastHitBufferView,
  ): readonly PhysicsTileShapeCastHit[] {
    return decodePhysicsTileShapeCastHits(view);
  }

  decodePhysicsTileRaycastHits(
    view: PhysicsTileRaycastHitBufferView,
  ): readonly PhysicsTileRaycastHit[] {
    return decodePhysicsTileRaycastHits(view);
  }

  decodePhysicsTileContactHits(
    view: PhysicsTileContactHitBufferView,
  ): readonly PhysicsTileContactHit[] {
    return decodePhysicsTileContactHits(view);
  }

  decodePhysicsTileManifoldHits(
    view: PhysicsTileManifoldHitBufferView,
  ): readonly PhysicsTileManifoldHit[] {
    return decodePhysicsTileManifoldHits(view);
  }

  decodePhysicsBodyContactHits(
    view: PhysicsBodyContactHitBufferView,
  ): readonly PhysicsBodyContactHit[] {
    return decodePhysicsBodyContactHits(view);
  }

  decodePhysicsBodyManifoldHits(
    view: PhysicsBodyManifoldHitBufferView,
  ): readonly PhysicsBodyManifoldHit[] {
    return decodePhysicsBodyManifoldHits(view);
  }

  decodePhysicsRigidContactImpulseHits(
    view: PhysicsRigidContactImpulseHitBufferView,
  ): readonly PhysicsRigidContactImpulseHit[] {
    return decodePhysicsRigidContactImpulseHits(view);
  }

  decodeAudioEvents(view: AudioEventBufferView): readonly AudioEventView[] {
    return decodeAudioEvents(view);
  }
}

export { decodeRenderCommands };
export {
  AUDIO_CHANNEL_BGM,
  AUDIO_CHANNEL_SFX,
  AUDIO_CHANNEL_UI,
  decodeAudioEvents,
  EMPTY_AUDIO_EVENTS,
  FLOATS_PER_AUDIO_EVENT,
} from "./audioEventDecoder";
export type { AudioEventBufferView, AudioEventView } from "./audioEventDecoder";
export { decodeCollisionEvents };
export {
  decodeGameplayEvents,
  EMPTY_GAMEPLAY_EVENTS,
  GAMEPLAY_ACTION_FAILURE_BLOCKED_PLACEMENT,
  GAMEPLAY_ACTION_FAILURE_COOLING_DOWN,
  GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_BINDING,
  GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_TARGET,
  GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM,
  GAMEPLAY_ACTION_FAILURE_PATTERN_MISMATCH,
  GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL,
  GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_AIM_SOURCE,
  GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_ANCHOR,
  GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_COLLISION_TARGET,
  GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PHASE,
  GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PREFAB,
  GAMEPLAY_EVENT_KIND_ACTION_FAILED,
  GAMEPLAY_EVENT_KIND_BEHAVIOR_STATE_CHANGED,
  GAMEPLAY_EVENT_KIND_COLLISION_DAMAGE,
  GAMEPLAY_EVENT_KIND_COLLISION_DESPAWN,
  GAMEPLAY_EVENT_KIND_FACTION_DAMAGE_DENIED,
  GAMEPLAY_EVENT_KIND_INTERACTION,
  GAMEPLAY_EVENT_KIND_PICKUP_COLLECTED,
  GAMEPLAY_EVENT_KIND_PREFAB_SPAWNED,
  GAMEPLAY_EVENT_KIND_TILE_IMPACT,
  GAMEPLAY_EVENT_KIND_TIMER,
  GAMEPLAY_EVENT_FLAG_CONSUMED_THIS_FRAME,
  GAMEPLAY_EVENT_FLAG_ONCE,
  GAMEPLAY_EVENT_FLAG_TARGET_REMOVED,
  GAMEPLAY_EVENT_FLAG_TILE_IMPACT_BOUNCED,
  GAMEPLAY_EVENT_FLAG_TILE_IMPACT_IDENTITY_TRUNCATED,
  GAMEPLAY_EVENT_TILE_IMPACT_LAYER_MASK,
  GAMEPLAY_EVENT_TILE_IMPACT_LAYER_SHIFT,
  GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_MASK,
  GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_NEGATIVE_X,
  GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_NEGATIVE_Y,
  GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_NONE,
  GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_POSITIVE_X,
  GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_POSITIVE_Y,
  GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_SHIFT,
  GAMEPLAY_EVENT_TILE_IMPACT_TILE_MASK,
  U32S_PER_GAMEPLAY_EVENT,
} from "./gameplayEventDecoder";
export { decodePhysicsDebugLines };
export { decodePhysicsBodyContactHits };
export { decodePhysicsBodyManifoldHits };
export { decodePhysicsRigidContactImpulseHits };
export { decodePhysicsQueryHits };
export { decodePhysicsRaycastHits };
export { decodePhysicsShapeCastHits };
export { decodePhysicsTileShapeCastHits };
export { decodePhysicsTileRaycastHits };
export { decodePhysicsTileContactHits };
export { decodePhysicsTileManifoldHits };
export type {
  CollisionEventBufferView,
  CollisionEventKind,
  CollisionEventView,
} from "./collisionEventDecoder";
export type {
  GameplayEventBufferView,
  GameplayEventKind,
  GameplayEventView,
} from "./gameplayEventDecoder";
export type { PhysicsDebugLineBufferView, PhysicsDebugLineView };
export type {
  FrameTelemetryBufferView,
  FrameTelemetryBufferViewCache,
  PhysicsBodyStateBufferView,
  ShooterStateBufferView,
  TilemapNavigationPathBufferView,
};
export type {
  PhysicsBodyContactHit,
  PhysicsBodyContactHitBufferView,
  PhysicsBodyManifoldHit,
  PhysicsBodyManifoldHitBufferView,
  PhysicsBodyQueryHit,
  PhysicsQueryHitBufferView,
  PhysicsRaycastBodyHit,
  PhysicsRaycastHitBufferView,
  PhysicsRigidContactImpulseHit,
  PhysicsRigidContactImpulseHitBufferView,
  PhysicsShapeCastBodyHit,
  PhysicsShapeCastHitBufferView,
  PhysicsTileContactHit,
  PhysicsTileContactHitBufferView,
  PhysicsTileManifoldHit,
  PhysicsTileManifoldHitBufferView,
  PhysicsTileRaycastHit,
  PhysicsTileRaycastHitBufferView,
  PhysicsTileShapeCastHit,
  PhysicsTileShapeCastHitBufferView,
};
export type { RenderCommandBufferView, RenderCommandView };
