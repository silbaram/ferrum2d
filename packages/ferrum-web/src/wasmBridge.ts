import type { AudioPoseBufferView } from "./audioPoseBuffer.js";
import init, { Engine, version, wasm_memory } from "../pkg/ferrum_core.js";
import { spatialModelRegistry } from "./spatialModel.js";
import {
  createBuiltInShooterStateAccessor,
  createRenderCommandAccessor,
} from "./bufferAccessors.js";
import type {
  BuiltInShooterStateAccessor,
  RenderCommandAccessor,
} from "./bufferAccessors.js";
import { decodeCollisionEvents } from "./collisionEventDecoder";
import type { CollisionEventBufferView, CollisionEventView } from "./collisionEventDecoder";
import { decodeEffectEvents } from "./effectEventDecoder";
import type { EffectEventBufferView, EffectEventView } from "./effectEventDecoder";
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
  effectEventBufferView,
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
    if (this.engineInstance.data_scene_ground_shadow_projection_len() !== 3) {
      throw new Error("Ground shadow projection ABI must contain three f32 values.");
    }
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

  queryAudioPoseBuffer(handles: Uint32Array): AudioPoseBufferView {
    const e = this.engineInstance;
    if (typeof e.query_audio_poses !== "function" || typeof e.audio_pose_stride_words !== "function"
      || typeof e.audio_pose_buffer_count !== "function" || typeof e.audio_pose_buffer_ptr !== "function") throw new Error("This Wasm core does not support spatial audio poses.");
    if (!e.query_audio_poses(handles) || e.audio_pose_stride_words() !== 8) throw new Error("Invalid spatial audio pose ABI/input.");
    const count = e.audio_pose_buffer_count(), pointer = e.audio_pose_buffer_ptr();
    if (count !== handles.length / 2 || pointer % 4 !== 0) throw new Error("Invalid spatial audio pose buffer.");
    // Query may grow Wasm memory; always acquire both views after the native call.
    return { count, stride: 8, floats: new Float32Array(this.memory.buffer, pointer, count * 8),
      words: new Uint32Array(this.memory.buffer, pointer, count * 8) };
  }

  memoryByteLength(): number {
    // Always read the current buffer: memory.grow replaces/detaches previous views.
    return this.memory.buffer.byteLength;
  }

  createRenderCommandAccessor(): RenderCommandAccessor {
    return createRenderCommandAccessor(
      this.bufferContext.layout.renderCommandFieldOffsets,
      this.bufferContext.layout.floatsPerCommand,
    );
  }

  createBuiltInShooterStateAccessor(): BuiltInShooterStateAccessor {
    return createBuiltInShooterStateAccessor(this.bufferContext.layout.builtInShooterState);
  }

  readRenderCommandBuffer(): RenderCommandBufferView {
    const view = renderCommandBufferView(this.bufferContext);
    view.groundYScale = this.engineInstance.render_command_ground_y_scale();
    view.groundShadowProjection = new Float32Array(
      this.memory.buffer, this.engineInstance.data_scene_ground_shadow_projection_ptr(), 3,
    );
    if (typeof this.engineInstance.spatial_frame_active === "function" && this.engineInstance.spatial_frame_active()) {
      const e = this.engineInstance;
      const version = e.spatial_abi_version();
      if ((version !== 1 && version !== 2) || e.spatial_vertex_stride() !== 11) {
        throw new Error("Unsupported spatial buffer ABI");
      }
      const terrainVertexCount = e.spatial_terrain_len();
      const billboardVertexCount = e.spatial_billboard_len();
      const rangeCount = version === 2 ? e.spatial_terrain_draw_range_len() : 0;
      if (version === 2 && (e.spatial_terrain_draw_range_stride() !== 2 || rangeCount > 256)) {
        throw new Error("Unsupported spatial terrain range ABI");
      }
      const spatial = {
        models: typeof e.spatial_model_len === "function" && e.spatial_model_len() > 0 ? (() => {
          if(e.spatial_model_abi_version()!==1 || e.spatial_model_stride()!==20 || e.spatial_model_len()>1024) throw new Error("Unsupported model ABI");
          const pointer=e.spatial_model_ptr(),length=e.spatial_model_len()*20;
          return {version:1 as const,stride:20 as const,words:new Uint32Array(this.memory.buffer,pointer,length),values:new Float32Array(this.memory.buffer,pointer,length),
            assets:new Map([...spatialModelRegistry(e).values()].map(r=>[r.id,r.handle]))};
        })() : undefined,
        vertexStride: 11 as const,
        camera: new Float32Array(this.memory.buffer, e.spatial_camera_ptr(), 28),
        terrain: new Float32Array(this.memory.buffer, e.spatial_terrain_ptr(), terrainVertexCount * 11),
        terrainVertexCount,
        terrainRevision: e.spatial_terrain_revision(),
        billboards: new Float32Array(this.memory.buffer, e.spatial_billboard_ptr(), billboardVertexCount * 11),
        billboardVertexCount,
      };
      const debugFlags = typeof e.spatial_debug_flags === "function" ? e.spatial_debug_flags() : 0;
      const debugVertexCount = debugFlags ? e.spatial_debug_len() : 0;
      if (debugFlags && (e.spatial_debug_abi_version() !== 1 || e.spatial_debug_vertex_stride() !== 11
          || debugVertexCount % 2 !== 0 || debugVertexCount > 32768)) {
        throw new Error("Unsupported spatial debug ABI");
      }
      const debug = debugFlags ? {
        version: 1 as const,
        vertexStride: 11 as const,
        vertices: new Float32Array(this.memory.buffer, e.spatial_debug_ptr(), debugVertexCount * 11),
        vertexCount: debugVertexCount,
        depthTest: e.spatial_debug_depth_test(),
        truncated: e.spatial_debug_truncated(),
      } : undefined;
      const materialVersion = typeof e.spatial_material_abi_version === "function" ? e.spatial_material_abi_version() : undefined;
      if (materialVersion !== undefined && (materialVersion !== 1 || e.spatial_terrain_material_len() > 256 || e.spatial_billboard_material_len() > 10000)) throw new Error("Unsupported spatial material ABI");
      const materials = materialVersion ? { version: 1 as const,
        terrain: new Uint32Array(this.memory.buffer, e.spatial_terrain_material_ptr(), e.spatial_terrain_material_len() * 2),
        billboards: new Uint32Array(this.memory.buffer, e.spatial_billboard_material_ptr(), e.spatial_billboard_material_len() * 2),
      } : undefined;
      if (typeof e.spatial_presentation_ptr === "function" && (typeof e.spatial_presentation_version !== "function" || e.spatial_presentation_version() !== 1)) throw new Error("Unsupported spatial presentation ABI");
      const presentation = typeof e.spatial_presentation_ptr === "function" ? new Float32Array(this.memory.buffer, e.spatial_presentation_ptr(), 6) : undefined;
      const environmentLength = typeof e.spatial_environment_len === "function" ? e.spatial_environment_len() : 0;
      const casterCount = environmentLength ? e.spatial_shadow_caster_len() : 0;
      const matrixCount = environmentLength ? e.spatial_shadow_matrix_len() : 0;
      if (environmentLength && (!((e.spatial_environment_abi_version() === 1 && environmentLength === 80) || (e.spatial_environment_abi_version() === 2 && environmentLength === 112) || (e.spatial_environment_abi_version() === 3 && environmentLength === 128) || (e.spatial_environment_abi_version() === 4 && environmentLength === 512))
          || casterCount % 6 !== 0 || casterCount > 1024 * 6 || ![0, 16, 96, 112].includes(matrixCount))) {
        throw new Error("Unsupported spatial environment ABI");
      }
      const shadowRangeCount = environmentLength && typeof e.spatial_shadow_range_len === "function" ? e.spatial_shadow_range_len() : undefined;
      if (shadowRangeCount !== undefined && (e.spatial_shadow_submission_version() !== 1 || shadowRangeCount > 8960)) throw new Error("Unsupported shadow submission ABI");
      const environment = environmentLength ? {
        version: e.spatial_environment_abi_version() as 1 | 2 | 3 | 4,
        values: new Float32Array(this.memory.buffer, e.spatial_environment_ptr(), environmentLength),
        shadowMatrices: new Float32Array(this.memory.buffer, e.spatial_shadow_matrix_ptr(), matrixCount),
        shadowCasters: new Float32Array(this.memory.buffer, e.spatial_shadow_caster_ptr(), casterCount * 11),
        shadowCasterVertexCount: casterCount,
        shadowSubmission: shadowRangeCount === undefined ? undefined : {
          version: 1 as const, revision: e.spatial_shadow_revision(),
          ranges: new Uint32Array(this.memory.buffer, e.spatial_shadow_range_ptr(), shadowRangeCount * 4),
        },
      } : undefined;
      view.spatial = version === 2
        ? {
          ...spatial,
          presentation,
          materials,
          debug,
          environment,
          version: 2,
          terrainDrawRanges: new Uint32Array(this.memory.buffer, e.spatial_terrain_draw_range_ptr(), rangeCount * 2),
        }
        : { ...spatial, presentation, materials, debug, environment, version: 1 };
    }
    return view;
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

  readEffectEventBuffer(): EffectEventBufferView {
    return effectEventBufferView(this.bufferContext);
  }

  readEffectEvents(): readonly EffectEventView[] {
    return this.decodeEffectEvents(this.readEffectEventBuffer());
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

  decodeEffectEvents(view: EffectEventBufferView): readonly EffectEventView[] {
    return decodeEffectEvents(view);
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
  BYTES_PER_EFFECT_EVENT,
  decodeEffectEvents,
  EMPTY_EFFECT_EVENTS,
} from "./effectEventDecoder";
export type { EffectEventBufferView, EffectEventView } from "./effectEventDecoder";
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
  GAMEPLAY_EVENT_KIND_PRESENTATION_EFFECT,
  GAMEPLAY_PRESENTATION_EFFECT_TYPE_CAMERA_SHAKE,
  GAMEPLAY_PRESENTATION_EFFECT_TYPE_CUSTOM,
  GAMEPLAY_PRESENTATION_EFFECT_TYPE_PARTICLE,
  GAMEPLAY_PRESENTATION_EFFECT_TYPE_SOUND,
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
  GameplayPresentationEffectKind,
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
