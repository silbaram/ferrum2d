import init, {
  Engine,
  audio_event_bytes,
  audio_event_floats,
  collision_event_bytes,
  collision_event_u32s,
  physics_debug_line_bytes,
  physics_debug_line_floats,
  physics_body_contact_hit_bytes,
  physics_body_manifold_hit_bytes,
  physics_query_hit_bytes,
  physics_query_hit_u32s,
  physics_raycast_hit_bytes,
  physics_rigid_contact_impulse_hit_bytes,
  physics_tile_contact_hit_bytes,
  physics_tile_manifold_hit_bytes,
  physics_tile_shape_cast_hit_bytes,
  sprite_render_command_bytes,
  sprite_render_command_floats,
  version,
  wasm_memory,
} from "../pkg/ferrum_core.js";
import { decodeCollisionEvents, U32S_PER_COLLISION_EVENT } from "./collisionEventDecoder";
import type { CollisionEventBufferView, CollisionEventView } from "./collisionEventDecoder";
import {
  decodeAudioEvents,
  FLOATS_PER_AUDIO_EVENT,
} from "./audioEventDecoder";
import type { AudioEventBufferView, AudioEventView } from "./audioEventDecoder";
import {
  decodePhysicsDebugLines,
  FLOATS_PER_PHYSICS_DEBUG_LINE,
} from "./physicsDebugLineDecoder";
import type {
  PhysicsDebugLineBufferView,
  PhysicsDebugLineView,
} from "./physicsDebugLineDecoder";
import {
  BYTES_PER_PHYSICS_BODY_CONTACT_HIT,
  BYTES_PER_PHYSICS_BODY_MANIFOLD_HIT,
  BYTES_PER_PHYSICS_RAYCAST_HIT,
  BYTES_PER_PHYSICS_RIGID_CONTACT_IMPULSE_HIT,
  BYTES_PER_PHYSICS_TILE_CONTACT_HIT,
  BYTES_PER_PHYSICS_TILE_MANIFOLD_HIT,
  BYTES_PER_PHYSICS_TILE_SHAPE_CAST_HIT,
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
  U32S_PER_PHYSICS_QUERY_HIT,
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

export interface PhysicsBodyStateBufferView {
  floats: Float32Array;
  u32s: Uint32Array;
  bodyCount: number;
  floatsPerBody: number;
  u32sPerBody: number;
}

export interface TilemapNavigationPathBufferView {
  buffer: Float32Array;
  pointCount: number;
  floatsPerPoint: number;
}

export interface ShooterStateBufferView {
  headerFloats: Float32Array;
  headerU32s: Uint32Array;
  entityFloats: Float32Array;
  entityU32s: Uint32Array;
  entityCount: number;
  floatsPerEntity: number;
  u32sPerEntity: number;
}

const FLOATS_PER_COMMAND = 14;
const FLOATS_PER_PHYSICS_BODY_STATE = 31;
const U32S_PER_PHYSICS_BODY_STATE = 5;
const BYTES_PER_F32 = Float32Array.BYTES_PER_ELEMENT;
const BYTES_PER_U32 = Uint32Array.BYTES_PER_ELEMENT;
const BYTES_PER_COMMAND = FLOATS_PER_COMMAND * BYTES_PER_F32;
const BYTES_PER_AUDIO_EVENT = FLOATS_PER_AUDIO_EVENT * BYTES_PER_F32;
const BYTES_PER_COLLISION_EVENT = U32S_PER_COLLISION_EVENT * BYTES_PER_U32;
const BYTES_PER_PHYSICS_DEBUG_LINE = FLOATS_PER_PHYSICS_DEBUG_LINE * BYTES_PER_F32;
const BYTES_PER_PHYSICS_QUERY_HIT = U32S_PER_PHYSICS_QUERY_HIT * BYTES_PER_U32;

export class WasmBridge {
  private readonly floatsPerCommand: number;
  private readonly floatsPerAudioEvent: number;
  private readonly u32sPerCollisionEvent: number;
  private readonly floatsPerPhysicsDebugLine: number;
  private readonly u32sPerPhysicsQueryHit: number;
  private readonly bytesPerPhysicsRaycastHit: number;
  private readonly bytesPerPhysicsTileShapeCastHit: number;
  private readonly bytesPerPhysicsTileContactHit: number;
  private readonly bytesPerPhysicsTileManifoldHit: number;
  private readonly bytesPerPhysicsBodyContactHit: number;
  private readonly bytesPerPhysicsBodyManifoldHit: number;
  private readonly bytesPerPhysicsRigidContactImpulseHit: number;
  private readonly floatsPerPhysicsBodyState: number;
  private readonly u32sPerPhysicsBodyState: number;

  private constructor(
    private readonly engineInstance: Engine,
    private readonly memory: WebAssembly.Memory,
  ) {
    const rustFloatsPerCommand = sprite_render_command_floats();
    const rustBytesPerCommand = sprite_render_command_bytes();
    if (rustFloatsPerCommand !== FLOATS_PER_COMMAND) {
      throw new Error(
        `[Ferrum2D ABI mismatch] Rust sprite_render_command_floats=${rustFloatsPerCommand}, TS FLOATS_PER_COMMAND=${FLOATS_PER_COMMAND}. ` +
          "SpriteRenderCommand ABI 변경 시 Rust/TypeScript를 함께 수정하세요.",
      );
    }
    if (rustBytesPerCommand !== BYTES_PER_COMMAND) {
      throw new Error(
        `[Ferrum2D ABI mismatch] Rust sprite_render_command_bytes=${rustBytesPerCommand}, TS BYTES_PER_COMMAND=${BYTES_PER_COMMAND}. ` +
          "SpriteRenderCommand ABI 변경 시 Rust/TypeScript를 함께 수정하세요.",
      );
    }
    const rustFloatsPerAudioEvent = audio_event_floats();
    const rustBytesPerAudioEvent = audio_event_bytes();
    if (rustFloatsPerAudioEvent !== FLOATS_PER_AUDIO_EVENT) {
      throw new Error(
        `[Ferrum2D ABI mismatch] Rust audio_event_floats=${rustFloatsPerAudioEvent}, TS FLOATS_PER_AUDIO_EVENT=${FLOATS_PER_AUDIO_EVENT}. ` +
          "AudioEvent ABI 변경 시 Rust/TypeScript를 함께 수정하세요.",
      );
    }
    if (rustBytesPerAudioEvent !== BYTES_PER_AUDIO_EVENT) {
      throw new Error(
        `[Ferrum2D ABI mismatch] Rust audio_event_bytes=${rustBytesPerAudioEvent}, TS BYTES_PER_AUDIO_EVENT=${BYTES_PER_AUDIO_EVENT}. ` +
          "AudioEvent ABI 변경 시 Rust/TypeScript를 함께 수정하세요.",
      );
    }
    const rustU32sPerCollisionEvent = collision_event_u32s();
    const rustBytesPerCollisionEvent = collision_event_bytes();
    if (rustU32sPerCollisionEvent !== U32S_PER_COLLISION_EVENT) {
      throw new Error(
        `[Ferrum2D ABI mismatch] Rust collision_event_u32s=${rustU32sPerCollisionEvent}, TS U32S_PER_COLLISION_EVENT=${U32S_PER_COLLISION_EVENT}. ` +
          "CollisionEvent ABI 변경 시 Rust/TypeScript를 함께 수정하세요.",
      );
    }
    if (rustBytesPerCollisionEvent !== BYTES_PER_COLLISION_EVENT) {
      throw new Error(
        `[Ferrum2D ABI mismatch] Rust collision_event_bytes=${rustBytesPerCollisionEvent}, TS BYTES_PER_COLLISION_EVENT=${BYTES_PER_COLLISION_EVENT}. ` +
          "CollisionEvent ABI 변경 시 Rust/TypeScript를 함께 수정하세요.",
      );
    }
    const rustFloatsPerPhysicsDebugLine = physics_debug_line_floats();
    const rustBytesPerPhysicsDebugLine = physics_debug_line_bytes();
    if (rustFloatsPerPhysicsDebugLine !== FLOATS_PER_PHYSICS_DEBUG_LINE) {
      throw new Error(
        `[Ferrum2D ABI mismatch] Rust physics_debug_line_floats=${rustFloatsPerPhysicsDebugLine}, TS FLOATS_PER_PHYSICS_DEBUG_LINE=${FLOATS_PER_PHYSICS_DEBUG_LINE}. ` +
          "PhysicsDebugLine ABI 변경 시 Rust/TypeScript를 함께 수정하세요.",
      );
    }
    if (rustBytesPerPhysicsDebugLine !== BYTES_PER_PHYSICS_DEBUG_LINE) {
      throw new Error(
        `[Ferrum2D ABI mismatch] Rust physics_debug_line_bytes=${rustBytesPerPhysicsDebugLine}, TS BYTES_PER_PHYSICS_DEBUG_LINE=${BYTES_PER_PHYSICS_DEBUG_LINE}. ` +
          "PhysicsDebugLine ABI 변경 시 Rust/TypeScript를 함께 수정하세요.",
      );
    }
    const rustU32sPerPhysicsQueryHit = physics_query_hit_u32s();
    const rustBytesPerPhysicsQueryHit = physics_query_hit_bytes();
    if (rustU32sPerPhysicsQueryHit !== U32S_PER_PHYSICS_QUERY_HIT) {
      throw new Error(
        `[Ferrum2D ABI mismatch] Rust physics_query_hit_u32s=${rustU32sPerPhysicsQueryHit}, TS U32S_PER_PHYSICS_QUERY_HIT=${U32S_PER_PHYSICS_QUERY_HIT}. ` +
          "Physics query hit ABI 변경 시 Rust/TypeScript를 함께 수정하세요.",
      );
    }
    if (rustBytesPerPhysicsQueryHit !== BYTES_PER_PHYSICS_QUERY_HIT) {
      throw new Error(
        `[Ferrum2D ABI mismatch] Rust physics_query_hit_bytes=${rustBytesPerPhysicsQueryHit}, TS BYTES_PER_PHYSICS_QUERY_HIT=${BYTES_PER_PHYSICS_QUERY_HIT}. ` +
          "Physics query hit ABI 변경 시 Rust/TypeScript를 함께 수정하세요.",
      );
    }
    const rustBytesPerPhysicsRaycastHit = physics_raycast_hit_bytes();
    if (rustBytesPerPhysicsRaycastHit !== BYTES_PER_PHYSICS_RAYCAST_HIT) {
      throw new Error(
        `[Ferrum2D ABI mismatch] Rust physics_raycast_hit_bytes=${rustBytesPerPhysicsRaycastHit}, TS BYTES_PER_PHYSICS_RAYCAST_HIT=${BYTES_PER_PHYSICS_RAYCAST_HIT}. ` +
          "Physics raycast hit ABI 변경 시 Rust/TypeScript를 함께 수정하세요.",
      );
    }
    const rustBytesPerPhysicsTileShapeCastHit = physics_tile_shape_cast_hit_bytes();
    if (rustBytesPerPhysicsTileShapeCastHit !== BYTES_PER_PHYSICS_TILE_SHAPE_CAST_HIT) {
      throw new Error(
        `[Ferrum2D ABI mismatch] Rust physics_tile_shape_cast_hit_bytes=${rustBytesPerPhysicsTileShapeCastHit}, TS BYTES_PER_PHYSICS_TILE_SHAPE_CAST_HIT=${BYTES_PER_PHYSICS_TILE_SHAPE_CAST_HIT}. ` +
          "Physics tile shape-cast hit ABI 변경 시 Rust/TypeScript를 함께 수정하세요.",
      );
    }
    const rustBytesPerPhysicsTileContactHit = physics_tile_contact_hit_bytes();
    if (rustBytesPerPhysicsTileContactHit !== BYTES_PER_PHYSICS_TILE_CONTACT_HIT) {
      throw new Error(
        `[Ferrum2D ABI mismatch] Rust physics_tile_contact_hit_bytes=${rustBytesPerPhysicsTileContactHit}, TS BYTES_PER_PHYSICS_TILE_CONTACT_HIT=${BYTES_PER_PHYSICS_TILE_CONTACT_HIT}. ` +
          "Physics tile contact hit ABI 변경 시 Rust/TypeScript를 함께 수정하세요.",
      );
    }
    const rustBytesPerPhysicsTileManifoldHit = physics_tile_manifold_hit_bytes();
    if (rustBytesPerPhysicsTileManifoldHit !== BYTES_PER_PHYSICS_TILE_MANIFOLD_HIT) {
      throw new Error(
        `[Ferrum2D ABI mismatch] Rust physics_tile_manifold_hit_bytes=${rustBytesPerPhysicsTileManifoldHit}, TS BYTES_PER_PHYSICS_TILE_MANIFOLD_HIT=${BYTES_PER_PHYSICS_TILE_MANIFOLD_HIT}. ` +
          "Physics tile manifold hit ABI 변경 시 Rust/TypeScript를 함께 수정하세요.",
      );
    }
    const rustBytesPerPhysicsBodyContactHit = physics_body_contact_hit_bytes();
    if (rustBytesPerPhysicsBodyContactHit !== BYTES_PER_PHYSICS_BODY_CONTACT_HIT) {
      throw new Error(
        `[Ferrum2D ABI mismatch] Rust physics_body_contact_hit_bytes=${rustBytesPerPhysicsBodyContactHit}, TS BYTES_PER_PHYSICS_BODY_CONTACT_HIT=${BYTES_PER_PHYSICS_BODY_CONTACT_HIT}. ` +
          "Physics body contact hit ABI 변경 시 Rust/TypeScript를 함께 수정하세요.",
      );
    }
    const rustBytesPerPhysicsBodyManifoldHit = physics_body_manifold_hit_bytes();
    if (rustBytesPerPhysicsBodyManifoldHit !== BYTES_PER_PHYSICS_BODY_MANIFOLD_HIT) {
      throw new Error(
        `[Ferrum2D ABI mismatch] Rust physics_body_manifold_hit_bytes=${rustBytesPerPhysicsBodyManifoldHit}, TS BYTES_PER_PHYSICS_BODY_MANIFOLD_HIT=${BYTES_PER_PHYSICS_BODY_MANIFOLD_HIT}. ` +
          "Physics body manifold hit ABI 변경 시 Rust/TypeScript를 함께 수정하세요.",
      );
    }
    const rustBytesPerPhysicsRigidContactImpulseHit = physics_rigid_contact_impulse_hit_bytes();
    if (
      rustBytesPerPhysicsRigidContactImpulseHit !==
      BYTES_PER_PHYSICS_RIGID_CONTACT_IMPULSE_HIT
    ) {
      throw new Error(
        `[Ferrum2D ABI mismatch] Rust physics_rigid_contact_impulse_hit_bytes=${rustBytesPerPhysicsRigidContactImpulseHit}, TS BYTES_PER_PHYSICS_RIGID_CONTACT_IMPULSE_HIT=${BYTES_PER_PHYSICS_RIGID_CONTACT_IMPULSE_HIT}. ` +
          "Physics rigid contact impulse hit ABI 변경 시 Rust/TypeScript를 함께 수정하세요.",
      );
    }
    const rustFloatsPerPhysicsBodyState = this.engineInstance.physics_body_snapshot_floats_per_body();
    if (rustFloatsPerPhysicsBodyState !== FLOATS_PER_PHYSICS_BODY_STATE) {
      throw new Error(
        `[Ferrum2D ABI mismatch] Rust physics_body_snapshot_floats_per_body=${rustFloatsPerPhysicsBodyState}, TS FLOATS_PER_PHYSICS_BODY_STATE=${FLOATS_PER_PHYSICS_BODY_STATE}. ` +
          "Physics body snapshot ABI 변경 시 Rust/TypeScript를 함께 수정하세요.",
      );
    }
    const rustU32sPerPhysicsBodyState = this.engineInstance.physics_body_snapshot_u32s_per_body();
    if (rustU32sPerPhysicsBodyState !== U32S_PER_PHYSICS_BODY_STATE) {
      throw new Error(
        `[Ferrum2D ABI mismatch] Rust physics_body_snapshot_u32s_per_body=${rustU32sPerPhysicsBodyState}, TS U32S_PER_PHYSICS_BODY_STATE=${U32S_PER_PHYSICS_BODY_STATE}. ` +
          "Physics body snapshot ABI 변경 시 Rust/TypeScript를 함께 수정하세요.",
      );
    }
    this.floatsPerCommand = rustFloatsPerCommand;
    this.floatsPerAudioEvent = rustFloatsPerAudioEvent;
    this.u32sPerCollisionEvent = rustU32sPerCollisionEvent;
    this.floatsPerPhysicsDebugLine = rustFloatsPerPhysicsDebugLine;
    this.u32sPerPhysicsQueryHit = rustU32sPerPhysicsQueryHit;
    this.bytesPerPhysicsRaycastHit = rustBytesPerPhysicsRaycastHit;
    this.bytesPerPhysicsTileShapeCastHit = rustBytesPerPhysicsTileShapeCastHit;
    this.bytesPerPhysicsTileContactHit = rustBytesPerPhysicsTileContactHit;
    this.bytesPerPhysicsTileManifoldHit = rustBytesPerPhysicsTileManifoldHit;
    this.bytesPerPhysicsBodyContactHit = rustBytesPerPhysicsBodyContactHit;
    this.bytesPerPhysicsBodyManifoldHit = rustBytesPerPhysicsBodyManifoldHit;
    this.bytesPerPhysicsRigidContactImpulseHit = rustBytesPerPhysicsRigidContactImpulseHit;
    this.floatsPerPhysicsBodyState = rustFloatsPerPhysicsBodyState;
    this.u32sPerPhysicsBodyState = rustU32sPerPhysicsBodyState;
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
    const ptr = this.engineInstance.render_command_ptr();
    const commandCount = this.engineInstance.render_command_len();
    return {
      buffer: new Float32Array(this.memory.buffer, ptr, commandCount * this.floatsPerCommand),
      commandCount,
      floatsPerCommand: this.floatsPerCommand,
    };
  }

  readRenderCommands(): RenderCommandView[] {
    return decodeRenderCommands(this.readRenderCommandBuffer());
  }

  readAudioEventBuffer(): AudioEventBufferView {
    const ptr = this.engineInstance.audio_event_ptr();
    const eventCount = this.engineInstance.audio_event_len();
    return {
      buffer: new Float32Array(this.memory.buffer, ptr, eventCount * this.floatsPerAudioEvent),
      eventCount,
      floatsPerEvent: this.floatsPerAudioEvent,
    };
  }

  readAudioEvents(): readonly AudioEventView[] {
    return this.decodeAudioEvents(this.readAudioEventBuffer());
  }

  readCollisionEventBuffer(): CollisionEventBufferView {
    const ptr = this.engineInstance.collision_event_ptr();
    const eventCount = this.engineInstance.collision_event_len();
    return {
      buffer: new Uint32Array(this.memory.buffer, ptr, eventCount * this.u32sPerCollisionEvent),
      eventCount,
      u32sPerEvent: this.u32sPerCollisionEvent,
    };
  }

  readCollisionEvents(): readonly CollisionEventView[] {
    return this.decodeCollisionEvents(this.readCollisionEventBuffer());
  }

  readPhysicsDebugLineBuffer(): PhysicsDebugLineBufferView {
    const ptr = this.engineInstance.physics_debug_line_ptr();
    const lineCount = this.engineInstance.physics_debug_line_len();
    return {
      buffer: new Float32Array(
        this.memory.buffer,
        ptr,
        lineCount * this.floatsPerPhysicsDebugLine,
      ),
      lineCount,
      floatsPerLine: this.floatsPerPhysicsDebugLine,
    };
  }

  readPhysicsDebugLines(): readonly PhysicsDebugLineView[] {
    return this.decodePhysicsDebugLines(this.readPhysicsDebugLineBuffer());
  }

  readTilemapNavigationPathBuffer(): TilemapNavigationPathBufferView {
    const ptr = this.engineInstance.tilemap_navigation_path_point_ptr();
    const pointCount = this.engineInstance.tilemap_navigation_path_point_len();
    return {
      buffer: new Float32Array(
        this.memory.buffer,
        ptr,
        pointCount * 2,
      ),
      pointCount,
      floatsPerPoint: 2,
    };
  }

  readTilemapNavigationDebugLineBuffer(): PhysicsDebugLineBufferView {
    const ptr = this.engineInstance.tilemap_navigation_debug_line_ptr();
    const lineCount = this.engineInstance.tilemap_navigation_debug_line_len();
    return {
      buffer: new Float32Array(
        this.memory.buffer,
        ptr,
        lineCount * this.floatsPerPhysicsDebugLine,
      ),
      lineCount,
      floatsPerLine: this.floatsPerPhysicsDebugLine,
    };
  }

  readShooterStateBuffer(): ShooterStateBufferView {
    const floatsPerEntity = this.engineInstance.shooter_snapshot_entity_floats();
    const u32sPerEntity = this.engineInstance.shooter_snapshot_entity_u32s();
    const entityFloatLen = this.engineInstance.shooter_snapshot_entity_float_len();
    const entityU32Len = this.engineInstance.shooter_snapshot_entity_u32_len();
    const entityCount = Math.floor(entityU32Len / u32sPerEntity);
    return {
      headerFloats: new Float32Array(
        this.memory.buffer,
        this.engineInstance.shooter_snapshot_header_float_ptr(),
        this.engineInstance.shooter_snapshot_header_float_len(),
      ),
      headerU32s: new Uint32Array(
        this.memory.buffer,
        this.engineInstance.shooter_snapshot_header_u32_ptr(),
        this.engineInstance.shooter_snapshot_header_u32_len(),
      ),
      entityFloats: new Float32Array(
        this.memory.buffer,
        this.engineInstance.shooter_snapshot_entity_float_ptr(),
        entityFloatLen,
      ),
      entityU32s: new Uint32Array(
        this.memory.buffer,
        this.engineInstance.shooter_snapshot_entity_u32_ptr(),
        entityU32Len,
      ),
      entityCount,
      floatsPerEntity,
      u32sPerEntity,
    };
  }

  readPhysicsQueryHitBuffer(): PhysicsQueryHitBufferView {
    const ptr = this.engineInstance.physics_query_hit_ptr();
    const hitCount = this.engineInstance.physics_query_hit_len();
    return {
      buffer: new Uint32Array(this.memory.buffer, ptr, hitCount * this.u32sPerPhysicsQueryHit),
      hitCount,
      u32sPerHit: this.u32sPerPhysicsQueryHit,
    };
  }

  readPhysicsQueryHits(): readonly PhysicsBodyQueryHit[] {
    return this.decodePhysicsQueryHits(this.readPhysicsQueryHitBuffer());
  }

  readPhysicsRaycastHitBuffer(): PhysicsRaycastHitBufferView {
    const ptr = this.engineInstance.physics_raycast_hit_ptr();
    const hitCount = this.engineInstance.physics_raycast_hit_len();
    return {
      buffer: new DataView(this.memory.buffer, ptr, hitCount * this.bytesPerPhysicsRaycastHit),
      hitCount,
      bytesPerHit: this.bytesPerPhysicsRaycastHit,
    };
  }

  readPhysicsRaycastHits(): readonly PhysicsRaycastBodyHit[] {
    return this.decodePhysicsRaycastHits(this.readPhysicsRaycastHitBuffer());
  }

  readPhysicsShapeCastHits(): readonly PhysicsShapeCastBodyHit[] {
    return this.decodePhysicsShapeCastHits(this.readPhysicsRaycastHitBuffer());
  }

  readPhysicsTileShapeCastHitBuffer(): PhysicsTileShapeCastHitBufferView {
    const ptr = this.engineInstance.physics_tile_shape_cast_hit_ptr();
    const hitCount = this.engineInstance.physics_tile_shape_cast_hit_len();
    return {
      buffer: new DataView(
        this.memory.buffer,
        ptr,
        hitCount * this.bytesPerPhysicsTileShapeCastHit,
      ),
      hitCount,
      bytesPerHit: this.bytesPerPhysicsTileShapeCastHit,
    };
  }

  readPhysicsTileShapeCastHits(): readonly PhysicsTileShapeCastHit[] {
    return this.decodePhysicsTileShapeCastHits(this.readPhysicsTileShapeCastHitBuffer());
  }

  readPhysicsTileRaycastHits(): readonly PhysicsTileRaycastHit[] {
    return this.decodePhysicsTileRaycastHits(this.readPhysicsTileShapeCastHitBuffer());
  }

  readPhysicsTileContactHitBuffer(): PhysicsTileContactHitBufferView {
    const ptr = this.engineInstance.physics_tile_contact_hit_ptr();
    const hitCount = this.engineInstance.physics_tile_contact_hit_len();
    return {
      buffer: new DataView(
        this.memory.buffer,
        ptr,
        hitCount * this.bytesPerPhysicsTileContactHit,
      ),
      hitCount,
      bytesPerHit: this.bytesPerPhysicsTileContactHit,
    };
  }

  readPhysicsTileContactHits(): readonly PhysicsTileContactHit[] {
    return this.decodePhysicsTileContactHits(this.readPhysicsTileContactHitBuffer());
  }

  readPhysicsTileManifoldHitBuffer(): PhysicsTileManifoldHitBufferView {
    const ptr = this.engineInstance.physics_tile_manifold_hit_ptr();
    const hitCount = this.engineInstance.physics_tile_manifold_hit_len();
    return {
      buffer: new DataView(
        this.memory.buffer,
        ptr,
        hitCount * this.bytesPerPhysicsTileManifoldHit,
      ),
      hitCount,
      bytesPerHit: this.bytesPerPhysicsTileManifoldHit,
    };
  }

  readPhysicsTileManifoldHits(): readonly PhysicsTileManifoldHit[] {
    return this.decodePhysicsTileManifoldHits(this.readPhysicsTileManifoldHitBuffer());
  }

  readPhysicsBodyContactHitBuffer(): PhysicsBodyContactHitBufferView {
    const ptr = this.engineInstance.physics_body_contact_hit_ptr();
    const hitCount = this.engineInstance.physics_body_contact_hit_len();
    return {
      buffer: new DataView(
        this.memory.buffer,
        ptr,
        hitCount * this.bytesPerPhysicsBodyContactHit,
      ),
      hitCount,
      bytesPerHit: this.bytesPerPhysicsBodyContactHit,
    };
  }

  readPhysicsBodyContactHits(): readonly PhysicsBodyContactHit[] {
    return this.decodePhysicsBodyContactHits(this.readPhysicsBodyContactHitBuffer());
  }

  readPhysicsBodyManifoldHitBuffer(): PhysicsBodyManifoldHitBufferView {
    const ptr = this.engineInstance.physics_body_manifold_hit_ptr();
    const hitCount = this.engineInstance.physics_body_manifold_hit_len();
    return {
      buffer: new DataView(
        this.memory.buffer,
        ptr,
        hitCount * this.bytesPerPhysicsBodyManifoldHit,
      ),
      hitCount,
      bytesPerHit: this.bytesPerPhysicsBodyManifoldHit,
    };
  }

  readPhysicsBodyManifoldHits(): readonly PhysicsBodyManifoldHit[] {
    return this.decodePhysicsBodyManifoldHits(this.readPhysicsBodyManifoldHitBuffer());
  }

  readPhysicsRigidContactImpulseHitBuffer(): PhysicsRigidContactImpulseHitBufferView {
    const ptr = this.engineInstance.physics_rigid_contact_impulse_hit_ptr();
    const hitCount = this.engineInstance.physics_rigid_contact_impulse_hit_len();
    return {
      buffer: new DataView(
        this.memory.buffer,
        ptr,
        hitCount * this.bytesPerPhysicsRigidContactImpulseHit,
      ),
      hitCount,
      bytesPerHit: this.bytesPerPhysicsRigidContactImpulseHit,
    };
  }

  readPhysicsRigidContactImpulseHits(): readonly PhysicsRigidContactImpulseHit[] {
    return this.decodePhysicsRigidContactImpulseHits(
      this.readPhysicsRigidContactImpulseHitBuffer(),
    );
  }

  readPhysicsBodyStateBuffer(): PhysicsBodyStateBufferView {
    const floatPtr = this.engineInstance.physics_body_snapshot_float_ptr();
    const floatLen = this.engineInstance.physics_body_snapshot_float_len();
    const u32Ptr = this.engineInstance.physics_body_snapshot_u32_ptr();
    const u32Len = this.engineInstance.physics_body_snapshot_u32_len();
    const bodyCount = floatLen / this.floatsPerPhysicsBodyState;
    if (!Number.isInteger(bodyCount) || u32Len !== bodyCount * this.u32sPerPhysicsBodyState) {
      throw new Error(
        `[Ferrum2D ABI mismatch] physics body state buffer lengths are inconsistent: ` +
          `floatLen=${floatLen}, u32Len=${u32Len}.`,
      );
    }
    return {
      floats: new Float32Array(this.memory.buffer, floatPtr, floatLen),
      u32s: new Uint32Array(this.memory.buffer, u32Ptr, u32Len),
      bodyCount,
      floatsPerBody: this.floatsPerPhysicsBodyState,
      u32sPerBody: this.u32sPerPhysicsBodyState,
    };
  }

  decodeCollisionEvents(view: CollisionEventBufferView): readonly CollisionEventView[] {
    return decodeCollisionEvents(view);
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
export type { PhysicsDebugLineBufferView, PhysicsDebugLineView };
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
