import type { Engine } from "../pkg/ferrum_core";
import {
  ShooterSnapshotEntityFloatField,
  ShooterSnapshotEntityU32Field,
  ShooterSnapshotHeaderFloatField,
  ShooterSnapshotHeaderU32Field,
  SpriteRenderCommandField,
  audio_event_bytes,
  audio_event_floats,
  collision_event_bytes,
  collision_event_u32s,
  effect_event_bytes,
  frame_telemetry_bytes,
  frame_telemetry_f64s,
  gameplay_event_bytes,
  gameplay_event_u32s,
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
  shooter_snapshot_entity_float_offset,
  shooter_snapshot_entity_u32_offset,
  shooter_snapshot_header_float_offset,
  shooter_snapshot_header_u32_offset,
  sprite_render_command_bytes,
  sprite_render_command_float_offset,
  sprite_render_command_floats,
} from "../pkg/ferrum_core.js";
import {
  BUILT_IN_SHOOTER_STATE_FLOATS_PER_ENTITY,
  BUILT_IN_SHOOTER_STATE_HEADER_FLOATS,
  BUILT_IN_SHOOTER_STATE_HEADER_U32S,
  BUILT_IN_SHOOTER_STATE_U32S_PER_ENTITY,
} from "./builtInShooterStateSnapshot.js";
import { FLOATS_PER_AUDIO_EVENT } from "./audioEventDecoder";
import { U32S_PER_COLLISION_EVENT } from "./collisionEventDecoder";
import { BYTES_PER_EFFECT_EVENT } from "./effectEventDecoder";
import { U32S_PER_GAMEPLAY_EVENT } from "./gameplayEventDecoder";
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

const FLOATS_PER_COMMAND = 15;
export const F64S_PER_FRAME_TELEMETRY = 62;
const FLOATS_PER_PHYSICS_BODY_STATE = 31;
const U32S_PER_PHYSICS_BODY_STATE = 5;
const BYTES_PER_F32 = Float32Array.BYTES_PER_ELEMENT;
const BYTES_PER_F64 = Float64Array.BYTES_PER_ELEMENT;
const BYTES_PER_U32 = Uint32Array.BYTES_PER_ELEMENT;
const BYTES_PER_COMMAND = FLOATS_PER_COMMAND * BYTES_PER_F32;
const BYTES_PER_FRAME_TELEMETRY = F64S_PER_FRAME_TELEMETRY * BYTES_PER_F64;
const BYTES_PER_AUDIO_EVENT = FLOATS_PER_AUDIO_EVENT * BYTES_PER_F32;
const BYTES_PER_COLLISION_EVENT = U32S_PER_COLLISION_EVENT * BYTES_PER_U32;
const BYTES_PER_GAMEPLAY_EVENT = U32S_PER_GAMEPLAY_EVENT * BYTES_PER_U32;
const BYTES_PER_PHYSICS_DEBUG_LINE = FLOATS_PER_PHYSICS_DEBUG_LINE * BYTES_PER_F32;
const BYTES_PER_PHYSICS_QUERY_HIT = U32S_PER_PHYSICS_QUERY_HIT * BYTES_PER_U32;

export interface RenderCommandFieldOffsets {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
  readonly textureId: number;
  readonly effectFlags: number;
  readonly rotationRadians: number;
}

export interface BuiltInShooterStateFieldOffsets {
  readonly headerFloats: {
    readonly fireCooldownSeconds: number;
    readonly enemySpawnTimer: number;
    readonly waveElapsedSeconds: number;
    readonly cameraElapsedSeconds: number;
    readonly cameraX: number;
    readonly cameraY: number;
    readonly previousMouseX: number;
    readonly previousMouseY: number;
  };
  readonly headerU32s: {
    readonly version: number;
    readonly gameState: number;
    readonly score: number;
    readonly spawnIndex: number;
    readonly activeWaveIndex: number;
    readonly waveSpawnedCount: number;
  };
  readonly entityFloats: {
    readonly x: number;
    readonly y: number;
    readonly velocityX: number;
    readonly velocityY: number;
    readonly health: number;
    readonly damage: number;
    readonly lifetimeSeconds: number;
    readonly primaryActionCooldownDuration: number;
    readonly primaryActionCooldownRemaining: number;
    readonly primaryActionProjectileSpeed: number;
    readonly primaryActionProjectileDamage: number;
    readonly primaryActionProjectileLifetime: number;
    readonly dashCooldownDuration: number;
    readonly dashCooldownRemaining: number;
    readonly dashDistance: number;
    readonly meleeCooldownDuration: number;
    readonly meleeCooldownRemaining: number;
    readonly meleeRange: number;
    readonly meleeDamage: number;
  };
  readonly entityU32s: {
    readonly kind: number;
    readonly scoreRewardOrProjectilePolicy: number;
    readonly primaryActionId: number;
    readonly dashActionId: number;
    readonly meleeActionId: number;
  };
}

export interface BuiltInShooterStateLayout {
  readonly headerFloats: number;
  readonly headerU32s: number;
  readonly floatsPerEntity: number;
  readonly u32sPerEntity: number;
  readonly fieldOffsets: BuiltInShooterStateFieldOffsets;
}

export interface WasmBridgeAbiLayout {
  readonly floatsPerCommand: number;
  readonly renderCommandFieldOffsets: RenderCommandFieldOffsets;
  readonly builtInShooterState: BuiltInShooterStateLayout;
  readonly f64sPerFrameTelemetry: number;
  readonly floatsPerAudioEvent: number;
  readonly u32sPerCollisionEvent: number;
  readonly u32sPerGameplayEvent: number;
  readonly bytesPerEffectEvent: number;
  readonly floatsPerPhysicsDebugLine: number;
  readonly u32sPerPhysicsQueryHit: number;
  readonly bytesPerPhysicsRaycastHit: number;
  readonly bytesPerPhysicsTileShapeCastHit: number;
  readonly bytesPerPhysicsTileContactHit: number;
  readonly bytesPerPhysicsTileManifoldHit: number;
  readonly bytesPerPhysicsBodyContactHit: number;
  readonly bytesPerPhysicsBodyManifoldHit: number;
  readonly bytesPerPhysicsRigidContactImpulseHit: number;
  readonly floatsPerPhysicsBodyState: number;
  readonly u32sPerPhysicsBodyState: number;
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
  const renderCommandFieldOffsets = readRenderCommandFieldOffsets();
  verifyFieldOffsets(
    "SpriteRenderCommand",
    renderCommandFieldOffsets,
    rustFloatsPerCommand,
  );

  const rustShooterHeaderFloats = engine.shooter_snapshot_header_floats();
  const rustShooterHeaderU32s = engine.shooter_snapshot_header_u32s();
  const rustShooterFloatsPerEntity = engine.shooter_snapshot_entity_floats();
  const rustShooterU32sPerEntity = engine.shooter_snapshot_entity_u32s();
  if (
    rustShooterHeaderFloats !== BUILT_IN_SHOOTER_STATE_HEADER_FLOATS ||
    rustShooterHeaderU32s !== BUILT_IN_SHOOTER_STATE_HEADER_U32S ||
    rustShooterFloatsPerEntity !== BUILT_IN_SHOOTER_STATE_FLOATS_PER_ENTITY ||
    rustShooterU32sPerEntity !== BUILT_IN_SHOOTER_STATE_U32S_PER_ENTITY
  ) {
    throw new Error(
      "[Ferrum2D ABI mismatch] Rust built-in shooter snapshot strides do not match the TypeScript snapshot contract.",
    );
  }
  const shooterStateFieldOffsets = readBuiltInShooterStateFieldOffsets();
  verifyFieldOffsets(
    "built-in shooter header floats",
    shooterStateFieldOffsets.headerFloats,
    rustShooterHeaderFloats,
  );
  verifyFieldOffsets(
    "built-in shooter header u32s",
    shooterStateFieldOffsets.headerU32s,
    rustShooterHeaderU32s,
  );
  verifyFieldOffsets(
    "built-in shooter entity floats",
    shooterStateFieldOffsets.entityFloats,
    rustShooterFloatsPerEntity,
  );
  verifyFieldOffsets(
    "built-in shooter entity u32s",
    shooterStateFieldOffsets.entityU32s,
    rustShooterU32sPerEntity,
  );

  const rustF64sPerFrameTelemetry = frame_telemetry_f64s();
  const rustBytesPerFrameTelemetry = frame_telemetry_bytes();
  if (rustF64sPerFrameTelemetry !== F64S_PER_FRAME_TELEMETRY) {
    throw new Error(
      `[Ferrum2D ABI mismatch] Rust frame_telemetry_f64s=${rustF64sPerFrameTelemetry}, TS F64S_PER_FRAME_TELEMETRY=${F64S_PER_FRAME_TELEMETRY}. ` +
        "FrameTelemetry ABI 변경 시 Rust/TypeScript를 함께 수정하세요.",
    );
  }
  if (rustBytesPerFrameTelemetry !== BYTES_PER_FRAME_TELEMETRY) {
    throw new Error(
      `[Ferrum2D ABI mismatch] Rust frame_telemetry_bytes=${rustBytesPerFrameTelemetry}, TS BYTES_PER_FRAME_TELEMETRY=${BYTES_PER_FRAME_TELEMETRY}. ` +
        "FrameTelemetry ABI 변경 시 Rust/TypeScript를 함께 수정하세요.",
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

  const rustU32sPerGameplayEvent = gameplay_event_u32s();
  const rustBytesPerGameplayEvent = gameplay_event_bytes();
  if (rustU32sPerGameplayEvent !== U32S_PER_GAMEPLAY_EVENT) {
    throw new Error(
      `[Ferrum2D ABI mismatch] Rust gameplay_event_u32s=${rustU32sPerGameplayEvent}, TS U32S_PER_GAMEPLAY_EVENT=${U32S_PER_GAMEPLAY_EVENT}. ` +
        "GameplayEvent ABI 변경 시 Rust/TypeScript를 함께 수정하세요.",
    );
  }
  if (rustBytesPerGameplayEvent !== BYTES_PER_GAMEPLAY_EVENT) {
    throw new Error(
      `[Ferrum2D ABI mismatch] Rust gameplay_event_bytes=${rustBytesPerGameplayEvent}, TS BYTES_PER_GAMEPLAY_EVENT=${BYTES_PER_GAMEPLAY_EVENT}. ` +
        "GameplayEvent ABI 변경 시 Rust/TypeScript를 함께 수정하세요.",
    );
  }

  const rustBytesPerEffectEvent = effect_event_bytes();
  if (rustBytesPerEffectEvent !== BYTES_PER_EFFECT_EVENT) {
    throw new Error(
      `[Ferrum2D ABI mismatch] Rust effect_event_bytes=${rustBytesPerEffectEvent}, TS BYTES_PER_EFFECT_EVENT=${BYTES_PER_EFFECT_EVENT}. ` +
        "EffectEvent ABI 변경 시 Rust/TypeScript를 함께 수정하세요.",
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
    renderCommandFieldOffsets,
    builtInShooterState: {
      headerFloats: rustShooterHeaderFloats,
      headerU32s: rustShooterHeaderU32s,
      floatsPerEntity: rustShooterFloatsPerEntity,
      u32sPerEntity: rustShooterU32sPerEntity,
      fieldOffsets: shooterStateFieldOffsets,
    },
    f64sPerFrameTelemetry: rustF64sPerFrameTelemetry,
    floatsPerAudioEvent: rustFloatsPerAudioEvent,
    u32sPerCollisionEvent: rustU32sPerCollisionEvent,
    u32sPerGameplayEvent: rustU32sPerGameplayEvent,
    bytesPerEffectEvent: rustBytesPerEffectEvent,
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

function readRenderCommandFieldOffsets(): RenderCommandFieldOffsets {
  return Object.freeze({
    x: sprite_render_command_float_offset(SpriteRenderCommandField.X),
    y: sprite_render_command_float_offset(SpriteRenderCommandField.Y),
    width: sprite_render_command_float_offset(SpriteRenderCommandField.Width),
    height: sprite_render_command_float_offset(SpriteRenderCommandField.Height),
    u0: sprite_render_command_float_offset(SpriteRenderCommandField.U0),
    v0: sprite_render_command_float_offset(SpriteRenderCommandField.V0),
    u1: sprite_render_command_float_offset(SpriteRenderCommandField.U1),
    v1: sprite_render_command_float_offset(SpriteRenderCommandField.V1),
    r: sprite_render_command_float_offset(SpriteRenderCommandField.R),
    g: sprite_render_command_float_offset(SpriteRenderCommandField.G),
    b: sprite_render_command_float_offset(SpriteRenderCommandField.B),
    a: sprite_render_command_float_offset(SpriteRenderCommandField.A),
    textureId: sprite_render_command_float_offset(SpriteRenderCommandField.TextureId),
    effectFlags: sprite_render_command_float_offset(SpriteRenderCommandField.EffectFlags),
    rotationRadians: sprite_render_command_float_offset(
      SpriteRenderCommandField.RotationRadians,
    ),
  });
}

function readBuiltInShooterStateFieldOffsets(): BuiltInShooterStateFieldOffsets {
  return Object.freeze({
    headerFloats: Object.freeze({
      fireCooldownSeconds: shooter_snapshot_header_float_offset(
        ShooterSnapshotHeaderFloatField.FireCooldownSeconds,
      ),
      enemySpawnTimer: shooter_snapshot_header_float_offset(
        ShooterSnapshotHeaderFloatField.EnemySpawnTimer,
      ),
      waveElapsedSeconds: shooter_snapshot_header_float_offset(
        ShooterSnapshotHeaderFloatField.WaveElapsedSeconds,
      ),
      cameraElapsedSeconds: shooter_snapshot_header_float_offset(
        ShooterSnapshotHeaderFloatField.CameraElapsedSeconds,
      ),
      cameraX: shooter_snapshot_header_float_offset(ShooterSnapshotHeaderFloatField.CameraX),
      cameraY: shooter_snapshot_header_float_offset(ShooterSnapshotHeaderFloatField.CameraY),
      previousMouseX: shooter_snapshot_header_float_offset(
        ShooterSnapshotHeaderFloatField.PreviousMouseX,
      ),
      previousMouseY: shooter_snapshot_header_float_offset(
        ShooterSnapshotHeaderFloatField.PreviousMouseY,
      ),
    }),
    headerU32s: Object.freeze({
      version: shooter_snapshot_header_u32_offset(ShooterSnapshotHeaderU32Field.Version),
      gameState: shooter_snapshot_header_u32_offset(ShooterSnapshotHeaderU32Field.GameState),
      score: shooter_snapshot_header_u32_offset(ShooterSnapshotHeaderU32Field.Score),
      spawnIndex: shooter_snapshot_header_u32_offset(
        ShooterSnapshotHeaderU32Field.SpawnIndex,
      ),
      activeWaveIndex: shooter_snapshot_header_u32_offset(
        ShooterSnapshotHeaderU32Field.ActiveWaveIndex,
      ),
      waveSpawnedCount: shooter_snapshot_header_u32_offset(
        ShooterSnapshotHeaderU32Field.WaveSpawnedCount,
      ),
    }),
    entityFloats: Object.freeze({
      x: shooter_snapshot_entity_float_offset(ShooterSnapshotEntityFloatField.X),
      y: shooter_snapshot_entity_float_offset(ShooterSnapshotEntityFloatField.Y),
      velocityX: shooter_snapshot_entity_float_offset(
        ShooterSnapshotEntityFloatField.VelocityX,
      ),
      velocityY: shooter_snapshot_entity_float_offset(
        ShooterSnapshotEntityFloatField.VelocityY,
      ),
      health: shooter_snapshot_entity_float_offset(ShooterSnapshotEntityFloatField.Health),
      damage: shooter_snapshot_entity_float_offset(ShooterSnapshotEntityFloatField.Damage),
      lifetimeSeconds: shooter_snapshot_entity_float_offset(
        ShooterSnapshotEntityFloatField.LifetimeSeconds,
      ),
      primaryActionCooldownDuration: shooter_snapshot_entity_float_offset(
        ShooterSnapshotEntityFloatField.PrimaryActionCooldownDuration,
      ),
      primaryActionCooldownRemaining: shooter_snapshot_entity_float_offset(
        ShooterSnapshotEntityFloatField.PrimaryActionCooldownRemaining,
      ),
      primaryActionProjectileSpeed: shooter_snapshot_entity_float_offset(
        ShooterSnapshotEntityFloatField.PrimaryActionProjectileSpeed,
      ),
      primaryActionProjectileDamage: shooter_snapshot_entity_float_offset(
        ShooterSnapshotEntityFloatField.PrimaryActionProjectileDamage,
      ),
      primaryActionProjectileLifetime: shooter_snapshot_entity_float_offset(
        ShooterSnapshotEntityFloatField.PrimaryActionProjectileLifetime,
      ),
      dashCooldownDuration: shooter_snapshot_entity_float_offset(
        ShooterSnapshotEntityFloatField.DashCooldownDuration,
      ),
      dashCooldownRemaining: shooter_snapshot_entity_float_offset(
        ShooterSnapshotEntityFloatField.DashCooldownRemaining,
      ),
      dashDistance: shooter_snapshot_entity_float_offset(
        ShooterSnapshotEntityFloatField.DashDistance,
      ),
      meleeCooldownDuration: shooter_snapshot_entity_float_offset(
        ShooterSnapshotEntityFloatField.MeleeCooldownDuration,
      ),
      meleeCooldownRemaining: shooter_snapshot_entity_float_offset(
        ShooterSnapshotEntityFloatField.MeleeCooldownRemaining,
      ),
      meleeRange: shooter_snapshot_entity_float_offset(
        ShooterSnapshotEntityFloatField.MeleeRange,
      ),
      meleeDamage: shooter_snapshot_entity_float_offset(
        ShooterSnapshotEntityFloatField.MeleeDamage,
      ),
    }),
    entityU32s: Object.freeze({
      kind: shooter_snapshot_entity_u32_offset(ShooterSnapshotEntityU32Field.Kind),
      scoreRewardOrProjectilePolicy: shooter_snapshot_entity_u32_offset(
        ShooterSnapshotEntityU32Field.ScoreRewardOrProjectilePolicy,
      ),
      primaryActionId: shooter_snapshot_entity_u32_offset(
        ShooterSnapshotEntityU32Field.PrimaryActionId,
      ),
      dashActionId: shooter_snapshot_entity_u32_offset(
        ShooterSnapshotEntityU32Field.DashActionId,
      ),
      meleeActionId: shooter_snapshot_entity_u32_offset(
        ShooterSnapshotEntityU32Field.MeleeActionId,
      ),
    }),
  });
}

function verifyFieldOffsets<Offsets extends object>(
  layoutName: string,
  offsets: Offsets,
  stride: number,
): void {
  const seenOffsets = new Set<number>();
  for (const [fieldName, offset] of Object.entries(offsets)) {
    if (!Number.isInteger(offset) || offset < 0 || offset >= stride) {
      throw new Error(
        `[Ferrum2D ABI mismatch] ${layoutName}.${fieldName} offset ${offset} is outside stride ${stride}.`,
      );
    }
    if (seenOffsets.has(offset)) {
      throw new Error(
        `[Ferrum2D ABI mismatch] ${layoutName}.${fieldName} reuses field offset ${offset}.`,
      );
    }
    seenOffsets.add(offset);
  }
}
