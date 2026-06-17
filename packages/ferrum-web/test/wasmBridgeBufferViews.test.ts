import { equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { FLOATS_PER_AUDIO_EVENT } from "../src/audioEventDecoder.js";
import { U32S_PER_COLLISION_EVENT } from "../src/collisionEventDecoder.js";
import { BYTES_PER_EFFECT_EVENT } from "../src/effectEventDecoder.js";
import { U32S_PER_GAMEPLAY_EVENT } from "../src/gameplayEventDecoder.js";
import { PHYSICS_BODY_STATE_FLOATS_PER_BODY, PHYSICS_BODY_STATE_U32S_PER_BODY } from "../src/physicsBodyStateBuffer.js";
import { FLOATS_PER_PHYSICS_DEBUG_LINE } from "../src/physicsDebugLineDecoder.js";
import {
  BYTES_PER_PHYSICS_BODY_CONTACT_HIT,
  BYTES_PER_PHYSICS_BODY_MANIFOLD_HIT,
  BYTES_PER_PHYSICS_RAYCAST_HIT,
  BYTES_PER_PHYSICS_RIGID_CONTACT_IMPULSE_HIT,
  BYTES_PER_PHYSICS_TILE_CONTACT_HIT,
  BYTES_PER_PHYSICS_TILE_MANIFOLD_HIT,
  BYTES_PER_PHYSICS_TILE_SHAPE_CAST_HIT,
  U32S_PER_PHYSICS_QUERY_HIT,
} from "../src/physicsQueryDecoder.js";
import type { WasmBridgeAbiLayout } from "../src/wasmBridgeAbi.js";
import {
  audioEventBufferView,
  collisionEventBufferView,
  effectEventBufferView,
  frameTelemetryBufferView,
  gameplayEventBufferView,
  physicsBodyContactHitBufferView,
  physicsBodyManifoldHitBufferView,
  physicsBodyStateBufferView,
  physicsQueryHitBufferView,
  physicsRaycastHitBufferView,
  physicsRigidContactImpulseHitBufferView,
  physicsTileContactHitBufferView,
  physicsTileManifoldHitBufferView,
  physicsTileShapeCastHitBufferView,
  renderCommandBufferView,
  shooterStateBufferView,
  tilemapNavigationPathBufferView,
} from "../src/wasmBridgeBufferViews.js";
import type {
  FrameTelemetryBufferViewCache,
  WasmBridgeBufferContext,
} from "../src/wasmBridgeBufferViews.js";

const layout: WasmBridgeAbiLayout = {
  floatsPerCommand: 15,
  f64sPerFrameTelemetry: 62,
  floatsPerAudioEvent: FLOATS_PER_AUDIO_EVENT,
  u32sPerCollisionEvent: U32S_PER_COLLISION_EVENT,
  u32sPerGameplayEvent: U32S_PER_GAMEPLAY_EVENT,
  bytesPerEffectEvent: BYTES_PER_EFFECT_EVENT,
  floatsPerPhysicsDebugLine: FLOATS_PER_PHYSICS_DEBUG_LINE,
  u32sPerPhysicsQueryHit: U32S_PER_PHYSICS_QUERY_HIT,
  bytesPerPhysicsRaycastHit: BYTES_PER_PHYSICS_RAYCAST_HIT,
  bytesPerPhysicsTileShapeCastHit: BYTES_PER_PHYSICS_TILE_SHAPE_CAST_HIT,
  bytesPerPhysicsTileContactHit: BYTES_PER_PHYSICS_TILE_CONTACT_HIT,
  bytesPerPhysicsTileManifoldHit: BYTES_PER_PHYSICS_TILE_MANIFOLD_HIT,
  bytesPerPhysicsBodyContactHit: BYTES_PER_PHYSICS_BODY_CONTACT_HIT,
  bytesPerPhysicsBodyManifoldHit: BYTES_PER_PHYSICS_BODY_MANIFOLD_HIT,
  bytesPerPhysicsRigidContactImpulseHit: BYTES_PER_PHYSICS_RIGID_CONTACT_IMPULSE_HIT,
  floatsPerPhysicsBodyState: PHYSICS_BODY_STATE_FLOATS_PER_BODY,
  u32sPerPhysicsBodyState: PHYSICS_BODY_STATE_U32S_PER_BODY,
};

function context(overrides: Record<string, () => number> = {}): WasmBridgeBufferContext {
  const engine = {
    render_command_ptr: () => 16,
    render_command_len: () => 2,
    frame_telemetry_ptr: () => 64,
    audio_event_ptr: () => 128,
    audio_event_len: () => 3,
    collision_event_ptr: () => 256,
    collision_event_len: () => 4,
    gameplay_event_ptr: () => 384,
    gameplay_event_len: () => 2,
    effect_event_ptr: () => 448,
    effect_event_len: () => 3,
    tilemap_navigation_path_point_ptr: () => 512,
    tilemap_navigation_path_point_len: () => 5,
    physics_query_hit_ptr: () => 768,
    physics_query_hit_len: () => 6,
    physics_raycast_hit_ptr: () => 1024,
    physics_raycast_hit_len: () => 7,
    physics_tile_shape_cast_hit_ptr: () => 1280,
    physics_tile_shape_cast_hit_len: () => 2,
    physics_tile_contact_hit_ptr: () => 1408,
    physics_tile_contact_hit_len: () => 3,
    physics_tile_manifold_hit_ptr: () => 1536,
    physics_tile_manifold_hit_len: () => 4,
    physics_body_contact_hit_ptr: () => 1792,
    physics_body_contact_hit_len: () => 5,
    physics_body_manifold_hit_ptr: () => 2048,
    physics_body_manifold_hit_len: () => 6,
    physics_rigid_contact_impulse_hit_ptr: () => 2432,
    physics_rigid_contact_impulse_hit_len: () => 7,
    physics_body_snapshot_float_ptr: () => 1536,
    physics_body_snapshot_float_len: () => layout.floatsPerPhysicsBodyState * 2,
    physics_body_snapshot_u32_ptr: () => 2816,
    physics_body_snapshot_u32_len: () => layout.u32sPerPhysicsBodyState * 2,
    shooter_snapshot_entity_floats: () => 15,
    shooter_snapshot_entity_u32s: () => 4,
    shooter_snapshot_entity_float_len: () => 30,
    shooter_snapshot_entity_u32_len: () => 8,
    shooter_snapshot_header_float_ptr: () => 2304,
    shooter_snapshot_header_float_len: () => 6,
    shooter_snapshot_header_u32_ptr: () => 2400,
    shooter_snapshot_header_u32_len: () => 3,
    shooter_snapshot_entity_float_ptr: () => 2496,
    shooter_snapshot_entity_u32_ptr: () => 2592,
    ...overrides,
  };
  return {
    engine: engine as WasmBridgeBufferContext["engine"],
    memory: new WebAssembly.Memory({ initial: 1 }),
    layout,
  };
}

test("wasmBridge buffer views preserve element and byte length contracts", () => {
  const ctx = context();

  const render = renderCommandBufferView(ctx);
  equal(render.buffer.constructor, Float32Array);
  equal(render.buffer.byteOffset, 16);
  equal(render.buffer.length, 2 * layout.floatsPerCommand);
  equal(render.commandCount, 2);
  equal(render.floatsPerCommand, layout.floatsPerCommand);
  ok(render.buffer !== renderCommandBufferView(ctx).buffer);

  const frameTelemetry = frameTelemetryBufferView(ctx);
  equal(frameTelemetry.buffer.constructor, Float64Array);
  equal(frameTelemetry.buffer.byteOffset, 64);
  equal(frameTelemetry.buffer.length, layout.f64sPerFrameTelemetry);
  equal(frameTelemetry.f64sPerFrame, layout.f64sPerFrameTelemetry);

  const audio = audioEventBufferView(ctx);
  equal(audio.buffer.constructor, Float32Array);
  equal(audio.buffer.byteOffset, 128);
  equal(audio.buffer.length, 3 * layout.floatsPerAudioEvent);
  equal(audio.eventCount, 3);

  const collision = collisionEventBufferView(ctx);
  equal(collision.buffer.constructor, Uint32Array);
  equal(collision.buffer.byteOffset, 256);
  equal(collision.buffer.length, 4 * layout.u32sPerCollisionEvent);
  equal(collision.eventCount, 4);

  const gameplay = gameplayEventBufferView(ctx);
  equal(gameplay.buffer.constructor, Uint32Array);
  equal(gameplay.buffer.byteOffset, 384);
  equal(gameplay.buffer.length, 2 * layout.u32sPerGameplayEvent);
  equal(gameplay.eventCount, 2);

  const effect = effectEventBufferView(ctx);
  equal(effect.buffer.constructor, DataView);
  equal(effect.buffer.byteOffset, 448);
  equal(effect.buffer.byteLength, 3 * layout.bytesPerEffectEvent);
  equal(effect.eventCount, 3);

  const query = physicsQueryHitBufferView(ctx);
  equal(query.buffer.constructor, Uint32Array);
  equal(query.buffer.byteOffset, 768);
  equal(query.buffer.length, 6 * layout.u32sPerPhysicsQueryHit);
  equal(query.hitCount, 6);

  const raycast = physicsRaycastHitBufferView(ctx);
  equal(raycast.buffer.constructor, DataView);
  equal(raycast.buffer.byteOffset, 1024);
  equal(raycast.buffer.byteLength, 7 * layout.bytesPerPhysicsRaycastHit);
  equal(raycast.hitCount, 7);

  const tileShapeCast = physicsTileShapeCastHitBufferView(ctx);
  equal(tileShapeCast.buffer.constructor, DataView);
  equal(tileShapeCast.buffer.byteOffset, 1280);
  equal(tileShapeCast.buffer.byteLength, 2 * layout.bytesPerPhysicsTileShapeCastHit);
  equal(tileShapeCast.hitCount, 2);

  const tileContact = physicsTileContactHitBufferView(ctx);
  equal(tileContact.buffer.constructor, DataView);
  equal(tileContact.buffer.byteOffset, 1408);
  equal(tileContact.buffer.byteLength, 3 * layout.bytesPerPhysicsTileContactHit);
  equal(tileContact.hitCount, 3);

  const tileManifold = physicsTileManifoldHitBufferView(ctx);
  equal(tileManifold.buffer.constructor, DataView);
  equal(tileManifold.buffer.byteOffset, 1536);
  equal(tileManifold.buffer.byteLength, 4 * layout.bytesPerPhysicsTileManifoldHit);
  equal(tileManifold.hitCount, 4);

  const bodyContact = physicsBodyContactHitBufferView(ctx);
  equal(bodyContact.buffer.constructor, DataView);
  equal(bodyContact.buffer.byteOffset, 1792);
  equal(bodyContact.buffer.byteLength, 5 * layout.bytesPerPhysicsBodyContactHit);
  equal(bodyContact.hitCount, 5);

  const bodyManifold = physicsBodyManifoldHitBufferView(ctx);
  equal(bodyManifold.buffer.constructor, DataView);
  equal(bodyManifold.buffer.byteOffset, 2048);
  equal(bodyManifold.buffer.byteLength, 6 * layout.bytesPerPhysicsBodyManifoldHit);
  equal(bodyManifold.hitCount, 6);

  const rigidImpulse = physicsRigidContactImpulseHitBufferView(ctx);
  equal(rigidImpulse.buffer.constructor, DataView);
  equal(rigidImpulse.buffer.byteOffset, 2432);
  equal(rigidImpulse.buffer.byteLength, 7 * layout.bytesPerPhysicsRigidContactImpulseHit);
  equal(rigidImpulse.hitCount, 7);

  const path = tilemapNavigationPathBufferView(ctx);
  equal(path.buffer.constructor, Float32Array);
  equal(path.buffer.byteOffset, 512);
  equal(path.buffer.length, 25);
  equal(path.floatsPerPoint, 5);
});

test("frameTelemetryBufferView reuses cache until wasm memory grows", () => {
  const ctx = context();
  const cache: FrameTelemetryBufferViewCache = {};
  const first = frameTelemetryBufferView(ctx, cache);
  const second = frameTelemetryBufferView(ctx, cache);
  const previousMemoryBuffer = ctx.memory.buffer;

  equal(second, first);
  equal(second.buffer, first.buffer);

  ctx.memory.grow(1);
  const third = frameTelemetryBufferView(ctx, cache);

  ok(ctx.memory.buffer !== previousMemoryBuffer);
  ok(third !== first);
  ok(third.buffer !== first.buffer);
  equal(third.buffer.buffer, ctx.memory.buffer);
  equal(third.buffer.byteOffset, 64);
  equal(third.buffer.length, layout.f64sPerFrameTelemetry);
});

test("wasmBridge snapshot views preserve body and shooter stride contracts", () => {
  const ctx = context();

  const body = physicsBodyStateBufferView(ctx);
  equal(body.floats.byteOffset, 1536);
  equal(body.floats.length, layout.floatsPerPhysicsBodyState * 2);
  equal(body.u32s.byteOffset, 2816);
  equal(body.u32s.length, layout.u32sPerPhysicsBodyState * 2);
  equal(body.bodyCount, 2);
  equal(body.floatsPerBody, layout.floatsPerPhysicsBodyState);
  equal(body.u32sPerBody, layout.u32sPerPhysicsBodyState);

  const shooter = shooterStateBufferView(ctx);
  equal(shooter.headerFloats.byteOffset, 2304);
  equal(shooter.headerU32s.byteOffset, 2400);
  equal(shooter.entityFloats.byteOffset, 2496);
  equal(shooter.entityU32s.byteOffset, 2592);
  equal(shooter.entityCount, 2);
  equal(shooter.floatsPerEntity, 15);
  equal(shooter.u32sPerEntity, 4);
});

test("wasmBridge body state view rejects inconsistent snapshot lengths", () => {
  const ctx = context({
    physics_body_snapshot_u32_len: () => layout.u32sPerPhysicsBodyState * 2 - 1,
  });

  let error: unknown;
  try {
    physicsBodyStateBufferView(ctx);
  } catch (caught) {
    error = caught;
  }
  if (!(error instanceof Error)) {
    throw new Error("expected inconsistent snapshot lengths to throw");
  }
  ok(/physics body state buffer lengths are inconsistent/.test(error.message));
});
