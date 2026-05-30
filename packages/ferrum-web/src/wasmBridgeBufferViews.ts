import type { Engine } from "../pkg/ferrum_core";
import type { AudioEventBufferView } from "./audioEventDecoder";
import type { CollisionEventBufferView } from "./collisionEventDecoder";
import type { PhysicsDebugLineBufferView } from "./physicsDebugLineDecoder";
import type {
  PhysicsBodyContactHitBufferView,
  PhysicsBodyManifoldHitBufferView,
  PhysicsQueryHitBufferView,
  PhysicsRaycastHitBufferView,
  PhysicsRigidContactImpulseHitBufferView,
  PhysicsTileContactHitBufferView,
  PhysicsTileManifoldHitBufferView,
  PhysicsTileShapeCastHitBufferView,
} from "./physicsQueryDecoder";
import type { RenderCommandBufferView } from "./renderCommandDecoder";
import type { WasmBridgeAbiLayout } from "./wasmBridgeAbi.js";

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

export interface FrameTelemetryBufferView {
  buffer: Float64Array;
  f64sPerFrame: number;
}

export interface FrameTelemetryBufferViewCache {
  memoryBuffer?: ArrayBuffer;
  view?: FrameTelemetryBufferView;
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

export interface WasmBridgeBufferContext {
  readonly engine: Engine;
  readonly memory: WebAssembly.Memory;
  readonly layout: WasmBridgeAbiLayout;
}

export function renderCommandBufferView(
  context: WasmBridgeBufferContext,
): RenderCommandBufferView {
  const ptr = context.engine.render_command_ptr();
  const commandCount = context.engine.render_command_len();
  return {
    buffer: new Float32Array(
      context.memory.buffer,
      ptr,
      commandCount * context.layout.floatsPerCommand,
    ),
    commandCount,
    floatsPerCommand: context.layout.floatsPerCommand,
  };
}

export function frameTelemetryBufferView(
  context: WasmBridgeBufferContext,
  cache?: FrameTelemetryBufferViewCache,
): FrameTelemetryBufferView {
  const memoryBuffer = context.memory.buffer;
  if (cache?.view !== undefined && cache.memoryBuffer === memoryBuffer) {
    return cache.view;
  }

  const ptr = context.engine.frame_telemetry_ptr();
  const view = {
    buffer: new Float64Array(memoryBuffer, ptr, context.layout.f64sPerFrameTelemetry),
    f64sPerFrame: context.layout.f64sPerFrameTelemetry,
  };
  if (cache !== undefined) {
    cache.memoryBuffer = memoryBuffer;
    cache.view = view;
  }
  return view;
}

export function audioEventBufferView(context: WasmBridgeBufferContext): AudioEventBufferView {
  const ptr = context.engine.audio_event_ptr();
  const eventCount = context.engine.audio_event_len();
  return {
    buffer: new Float32Array(
      context.memory.buffer,
      ptr,
      eventCount * context.layout.floatsPerAudioEvent,
    ),
    eventCount,
    floatsPerEvent: context.layout.floatsPerAudioEvent,
  };
}

export function collisionEventBufferView(
  context: WasmBridgeBufferContext,
): CollisionEventBufferView {
  const ptr = context.engine.collision_event_ptr();
  const eventCount = context.engine.collision_event_len();
  return {
    buffer: new Uint32Array(
      context.memory.buffer,
      ptr,
      eventCount * context.layout.u32sPerCollisionEvent,
    ),
    eventCount,
    u32sPerEvent: context.layout.u32sPerCollisionEvent,
  };
}

export function physicsDebugLineBufferView(
  context: WasmBridgeBufferContext,
): PhysicsDebugLineBufferView {
  const ptr = context.engine.physics_debug_line_ptr();
  const lineCount = context.engine.physics_debug_line_len();
  return {
    buffer: new Float32Array(
      context.memory.buffer,
      ptr,
      lineCount * context.layout.floatsPerPhysicsDebugLine,
    ),
    lineCount,
    floatsPerLine: context.layout.floatsPerPhysicsDebugLine,
  };
}

export function tilemapNavigationPathBufferView(
  context: WasmBridgeBufferContext,
): TilemapNavigationPathBufferView {
  const ptr = context.engine.tilemap_navigation_path_point_ptr();
  const pointCount = context.engine.tilemap_navigation_path_point_len();
  const floatsPerPoint = 5;
  return {
    buffer: new Float32Array(context.memory.buffer, ptr, pointCount * floatsPerPoint),
    pointCount,
    floatsPerPoint,
  };
}

export function tilemapNavigationDebugLineBufferView(
  context: WasmBridgeBufferContext,
): PhysicsDebugLineBufferView {
  const ptr = context.engine.tilemap_navigation_debug_line_ptr();
  const lineCount = context.engine.tilemap_navigation_debug_line_len();
  return {
    buffer: new Float32Array(
      context.memory.buffer,
      ptr,
      lineCount * context.layout.floatsPerPhysicsDebugLine,
    ),
    lineCount,
    floatsPerLine: context.layout.floatsPerPhysicsDebugLine,
  };
}

export function shooterStateBufferView(context: WasmBridgeBufferContext): ShooterStateBufferView {
  const floatsPerEntity = context.engine.shooter_snapshot_entity_floats();
  const u32sPerEntity = context.engine.shooter_snapshot_entity_u32s();
  const entityFloatLen = context.engine.shooter_snapshot_entity_float_len();
  const entityU32Len = context.engine.shooter_snapshot_entity_u32_len();
  const entityCount = Math.floor(entityU32Len / u32sPerEntity);
  return {
    headerFloats: new Float32Array(
      context.memory.buffer,
      context.engine.shooter_snapshot_header_float_ptr(),
      context.engine.shooter_snapshot_header_float_len(),
    ),
    headerU32s: new Uint32Array(
      context.memory.buffer,
      context.engine.shooter_snapshot_header_u32_ptr(),
      context.engine.shooter_snapshot_header_u32_len(),
    ),
    entityFloats: new Float32Array(
      context.memory.buffer,
      context.engine.shooter_snapshot_entity_float_ptr(),
      entityFloatLen,
    ),
    entityU32s: new Uint32Array(
      context.memory.buffer,
      context.engine.shooter_snapshot_entity_u32_ptr(),
      entityU32Len,
    ),
    entityCount,
    floatsPerEntity,
    u32sPerEntity,
  };
}

export function physicsQueryHitBufferView(
  context: WasmBridgeBufferContext,
): PhysicsQueryHitBufferView {
  const ptr = context.engine.physics_query_hit_ptr();
  const hitCount = context.engine.physics_query_hit_len();
  return {
    buffer: new Uint32Array(
      context.memory.buffer,
      ptr,
      hitCount * context.layout.u32sPerPhysicsQueryHit,
    ),
    hitCount,
    u32sPerHit: context.layout.u32sPerPhysicsQueryHit,
  };
}

export function physicsRaycastHitBufferView(
  context: WasmBridgeBufferContext,
): PhysicsRaycastHitBufferView {
  const ptr = context.engine.physics_raycast_hit_ptr();
  const hitCount = context.engine.physics_raycast_hit_len();
  return {
    buffer: new DataView(
      context.memory.buffer,
      ptr,
      hitCount * context.layout.bytesPerPhysicsRaycastHit,
    ),
    hitCount,
    bytesPerHit: context.layout.bytesPerPhysicsRaycastHit,
  };
}

export function physicsTileShapeCastHitBufferView(
  context: WasmBridgeBufferContext,
): PhysicsTileShapeCastHitBufferView {
  const ptr = context.engine.physics_tile_shape_cast_hit_ptr();
  const hitCount = context.engine.physics_tile_shape_cast_hit_len();
  return {
    buffer: new DataView(
      context.memory.buffer,
      ptr,
      hitCount * context.layout.bytesPerPhysicsTileShapeCastHit,
    ),
    hitCount,
    bytesPerHit: context.layout.bytesPerPhysicsTileShapeCastHit,
  };
}

export function physicsTileContactHitBufferView(
  context: WasmBridgeBufferContext,
): PhysicsTileContactHitBufferView {
  const ptr = context.engine.physics_tile_contact_hit_ptr();
  const hitCount = context.engine.physics_tile_contact_hit_len();
  return {
    buffer: new DataView(
      context.memory.buffer,
      ptr,
      hitCount * context.layout.bytesPerPhysicsTileContactHit,
    ),
    hitCount,
    bytesPerHit: context.layout.bytesPerPhysicsTileContactHit,
  };
}

export function physicsTileManifoldHitBufferView(
  context: WasmBridgeBufferContext,
): PhysicsTileManifoldHitBufferView {
  const ptr = context.engine.physics_tile_manifold_hit_ptr();
  const hitCount = context.engine.physics_tile_manifold_hit_len();
  return {
    buffer: new DataView(
      context.memory.buffer,
      ptr,
      hitCount * context.layout.bytesPerPhysicsTileManifoldHit,
    ),
    hitCount,
    bytesPerHit: context.layout.bytesPerPhysicsTileManifoldHit,
  };
}

export function physicsBodyContactHitBufferView(
  context: WasmBridgeBufferContext,
): PhysicsBodyContactHitBufferView {
  const ptr = context.engine.physics_body_contact_hit_ptr();
  const hitCount = context.engine.physics_body_contact_hit_len();
  return {
    buffer: new DataView(
      context.memory.buffer,
      ptr,
      hitCount * context.layout.bytesPerPhysicsBodyContactHit,
    ),
    hitCount,
    bytesPerHit: context.layout.bytesPerPhysicsBodyContactHit,
  };
}

export function physicsBodyManifoldHitBufferView(
  context: WasmBridgeBufferContext,
): PhysicsBodyManifoldHitBufferView {
  const ptr = context.engine.physics_body_manifold_hit_ptr();
  const hitCount = context.engine.physics_body_manifold_hit_len();
  return {
    buffer: new DataView(
      context.memory.buffer,
      ptr,
      hitCount * context.layout.bytesPerPhysicsBodyManifoldHit,
    ),
    hitCount,
    bytesPerHit: context.layout.bytesPerPhysicsBodyManifoldHit,
  };
}

export function physicsRigidContactImpulseHitBufferView(
  context: WasmBridgeBufferContext,
): PhysicsRigidContactImpulseHitBufferView {
  const ptr = context.engine.physics_rigid_contact_impulse_hit_ptr();
  const hitCount = context.engine.physics_rigid_contact_impulse_hit_len();
  return {
    buffer: new DataView(
      context.memory.buffer,
      ptr,
      hitCount * context.layout.bytesPerPhysicsRigidContactImpulseHit,
    ),
    hitCount,
    bytesPerHit: context.layout.bytesPerPhysicsRigidContactImpulseHit,
  };
}

export function physicsBodyStateBufferView(
  context: WasmBridgeBufferContext,
): PhysicsBodyStateBufferView {
  const floatPtr = context.engine.physics_body_snapshot_float_ptr();
  const floatLen = context.engine.physics_body_snapshot_float_len();
  const u32Ptr = context.engine.physics_body_snapshot_u32_ptr();
  const u32Len = context.engine.physics_body_snapshot_u32_len();
  const bodyCount = floatLen / context.layout.floatsPerPhysicsBodyState;
  if (!Number.isInteger(bodyCount) || u32Len !== bodyCount * context.layout.u32sPerPhysicsBodyState) {
    throw new Error(
      `[Ferrum2D ABI mismatch] physics body state buffer lengths are inconsistent: ` +
        `floatLen=${floatLen}, u32Len=${u32Len}.`,
    );
  }
  return {
    floats: new Float32Array(context.memory.buffer, floatPtr, floatLen),
    u32s: new Uint32Array(context.memory.buffer, u32Ptr, u32Len),
    bodyCount,
    floatsPerBody: context.layout.floatsPerPhysicsBodyState,
    u32sPerBody: context.layout.u32sPerPhysicsBodyState,
  };
}
