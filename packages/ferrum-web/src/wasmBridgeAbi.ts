import type { Engine } from "../pkg/ferrum_core";
import {
  audio_event_bytes,
  audio_event_floats,
  collision_event_bytes,
  collision_event_u32s,
  physics_body_contact_hit_bytes,
  physics_body_manifold_hit_bytes,
  physics_debug_line_bytes,
  physics_debug_line_floats,
  physics_query_hit_bytes,
  physics_query_hit_u32s,
  physics_raycast_hit_bytes,
  physics_rigid_contact_impulse_hit_bytes,
  physics_tile_contact_hit_bytes,
  physics_tile_manifold_hit_bytes,
  physics_tile_shape_cast_hit_bytes,
  sprite_render_command_bytes,
  sprite_render_command_floats,
} from "../pkg/ferrum_core.js";
import { FLOATS_PER_AUDIO_EVENT } from "./audioEventDecoder";
import { U32S_PER_COLLISION_EVENT } from "./collisionEventDecoder";
import { FLOATS_PER_PHYSICS_DEBUG_LINE } from "./physicsDebugLineDecoder";
import {
  BYTES_PER_PHYSICS_BODY_CONTACT_HIT,
  BYTES_PER_PHYSICS_BODY_MANIFOLD_HIT,
  BYTES_PER_PHYSICS_RAYCAST_HIT,
  BYTES_PER_PHYSICS_RIGID_CONTACT_IMPULSE_HIT,
  BYTES_PER_PHYSICS_TILE_CONTACT_HIT,
  BYTES_PER_PHYSICS_TILE_MANIFOLD_HIT,
  BYTES_PER_PHYSICS_TILE_SHAPE_CAST_HIT,
  U32S_PER_PHYSICS_QUERY_HIT,
} from "./physicsQueryDecoder";

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

export interface WasmBridgeAbiLayout {
  floatsPerCommand: number;
  floatsPerAudioEvent: number;
  u32sPerCollisionEvent: number;
  floatsPerPhysicsDebugLine: number;
  u32sPerPhysicsQueryHit: number;
  bytesPerPhysicsRaycastHit: number;
  bytesPerPhysicsTileShapeCastHit: number;
  bytesPerPhysicsTileContactHit: number;
  bytesPerPhysicsTileManifoldHit: number;
  bytesPerPhysicsBodyContactHit: number;
  bytesPerPhysicsBodyManifoldHit: number;
  bytesPerPhysicsRigidContactImpulseHit: number;
  floatsPerPhysicsBodyState: number;
  u32sPerPhysicsBodyState: number;
}

export function verifyWasmBridgeAbi(engine: Engine): WasmBridgeAbiLayout {
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
  if (rustBytesPerPhysicsRigidContactImpulseHit !== BYTES_PER_PHYSICS_RIGID_CONTACT_IMPULSE_HIT) {
    throw new Error(
      `[Ferrum2D ABI mismatch] Rust physics_rigid_contact_impulse_hit_bytes=${rustBytesPerPhysicsRigidContactImpulseHit}, TS BYTES_PER_PHYSICS_RIGID_CONTACT_IMPULSE_HIT=${BYTES_PER_PHYSICS_RIGID_CONTACT_IMPULSE_HIT}. ` +
        "Physics rigid contact impulse hit ABI 변경 시 Rust/TypeScript를 함께 수정하세요.",
    );
  }

  const rustFloatsPerPhysicsBodyState = engine.physics_body_snapshot_floats_per_body();
  if (rustFloatsPerPhysicsBodyState !== FLOATS_PER_PHYSICS_BODY_STATE) {
    throw new Error(
      `[Ferrum2D ABI mismatch] Rust physics_body_snapshot_floats_per_body=${rustFloatsPerPhysicsBodyState}, TS FLOATS_PER_PHYSICS_BODY_STATE=${FLOATS_PER_PHYSICS_BODY_STATE}. ` +
        "Physics body snapshot ABI 변경 시 Rust/TypeScript를 함께 수정하세요.",
    );
  }

  const rustU32sPerPhysicsBodyState = engine.physics_body_snapshot_u32s_per_body();
  if (rustU32sPerPhysicsBodyState !== U32S_PER_PHYSICS_BODY_STATE) {
    throw new Error(
      `[Ferrum2D ABI mismatch] Rust physics_body_snapshot_u32s_per_body=${rustU32sPerPhysicsBodyState}, TS U32S_PER_PHYSICS_BODY_STATE=${U32S_PER_PHYSICS_BODY_STATE}. ` +
        "Physics body snapshot ABI 변경 시 Rust/TypeScript를 함께 수정하세요.",
    );
  }

  return {
    floatsPerCommand: rustFloatsPerCommand,
    floatsPerAudioEvent: rustFloatsPerAudioEvent,
    u32sPerCollisionEvent: rustU32sPerCollisionEvent,
    floatsPerPhysicsDebugLine: rustFloatsPerPhysicsDebugLine,
    u32sPerPhysicsQueryHit: rustU32sPerPhysicsQueryHit,
    bytesPerPhysicsRaycastHit: rustBytesPerPhysicsRaycastHit,
    bytesPerPhysicsTileShapeCastHit: rustBytesPerPhysicsTileShapeCastHit,
    bytesPerPhysicsTileContactHit: rustBytesPerPhysicsTileContactHit,
    bytesPerPhysicsTileManifoldHit: rustBytesPerPhysicsTileManifoldHit,
    bytesPerPhysicsBodyContactHit: rustBytesPerPhysicsBodyContactHit,
    bytesPerPhysicsBodyManifoldHit: rustBytesPerPhysicsBodyManifoldHit,
    bytesPerPhysicsRigidContactImpulseHit: rustBytesPerPhysicsRigidContactImpulseHit,
    floatsPerPhysicsBodyState: rustFloatsPerPhysicsBodyState,
    u32sPerPhysicsBodyState: rustU32sPerPhysicsBodyState,
  };
}
