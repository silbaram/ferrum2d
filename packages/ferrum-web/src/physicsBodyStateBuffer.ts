import type { PhysicsColliderType, PhysicsEntitySnapshot, PhysicsRigidBodyType } from "./createEngine.js";

export const PHYSICS_BODY_STATE_BUFFER_FORMAT = "ferrum2d.physics-body-state-buffer";
export const PHYSICS_BODY_STATE_BUFFER_VERSION = 1;
export const PHYSICS_BODY_STATE_FLOATS_PER_BODY = 31;
export const PHYSICS_BODY_STATE_U32S_PER_BODY = 5;

export interface PhysicsBodyStateBufferSnapshot {
  format: typeof PHYSICS_BODY_STATE_BUFFER_FORMAT;
  version: typeof PHYSICS_BODY_STATE_BUFFER_VERSION;
  bodyCount: number;
  handles: Uint32Array;
  floats: Float32Array;
  u32s: Uint32Array;
  floatsPerBody: number;
  u32sPerBody: number;
  states: readonly PhysicsEntitySnapshot[];
}

const PHYSICS_BODY_TYPE_CODES: Record<PhysicsRigidBodyType, number> = Object.freeze({
  static: 0,
  kinematic: 1,
  dynamic: 2,
});
const PHYSICS_COLLIDER_TYPES: readonly PhysicsColliderType[] = Object.freeze([
  "none",
  "aabb",
  "circle",
  "capsule",
  "orientedBox",
  "convexPolygon",
  "edge",
  "chain",
]);
const PHYSICS_BODY_STATE_U32_ENTITY_ID = 0;
const PHYSICS_BODY_STATE_U32_ENTITY_GENERATION = 1;
const PHYSICS_BODY_STATE_U32_BODY_TYPE = 2;
const PHYSICS_BODY_STATE_U32_COLLIDER_TYPE = 3;
const PHYSICS_BODY_STATE_U32_FLAGS = 4;
const PHYSICS_BODY_STATE_FLAG_BODY_ENABLED = 1 << 0;
const PHYSICS_BODY_STATE_FLAG_SLEEPING = 1 << 1;
const PHYSICS_BODY_STATE_FLAG_COLLIDER_ENABLED = 1 << 2;
const PHYSICS_BODY_STATE_FLAG_COLLIDER_TRIGGER = 1 << 3;
const PHYSICS_BODY_STATE_FLAG_COLLIDER_MATERIAL_OVERRIDE = 1 << 4;

export function createPhysicsBodyStateBufferSnapshot(
  states: readonly PhysicsEntitySnapshot[],
): PhysicsBodyStateBufferSnapshot {
  const bodyCount = states.length;
  const handles = new Uint32Array(bodyCount * 2);
  const floats = new Float32Array(bodyCount * PHYSICS_BODY_STATE_FLOATS_PER_BODY);
  const u32s = new Uint32Array(bodyCount * PHYSICS_BODY_STATE_U32S_PER_BODY);
  states.forEach((state, index) => {
    const handleOffset = index * 2;
    const floatOffset = index * PHYSICS_BODY_STATE_FLOATS_PER_BODY;
    const u32Offset = index * PHYSICS_BODY_STATE_U32S_PER_BODY;
    handles[handleOffset] = uint32Number(state.entityId, "physics body state entityId");
    handles[handleOffset + 1] = uint32Number(
      state.entityGeneration,
      "physics body state entityGeneration",
    );
    u32s[u32Offset + PHYSICS_BODY_STATE_U32_ENTITY_ID] = handles[handleOffset];
    u32s[u32Offset + PHYSICS_BODY_STATE_U32_ENTITY_GENERATION] = handles[handleOffset + 1];
    u32s[u32Offset + PHYSICS_BODY_STATE_U32_BODY_TYPE] = PHYSICS_BODY_TYPE_CODES[state.bodyType];
    u32s[u32Offset + PHYSICS_BODY_STATE_U32_COLLIDER_TYPE] = physicsColliderTypeCode(state.colliderType);
    u32s[u32Offset + PHYSICS_BODY_STATE_U32_FLAGS] = physicsBodyStateFlags(state);
    floats.set([
      state.x,
      state.y,
      state.velocityX,
      state.velocityY,
      state.rotationRadians,
      state.angularVelocityRadiansPerSecond,
      state.mass,
      state.inertia,
      state.gravityScale,
      state.linearDamping,
      state.angularDamping,
      state.restitution,
      state.friction,
      state.surfaceVelocityX,
      state.surfaceVelocityY,
      state.density,
      state.contactBaumgarteBiasScale,
      state.maxContactBaumgarteBiasVelocityScale,
      state.contactPositionCorrectionScale,
      state.contactPositionCorrectionSlopScale,
      state.colliderOffsetX,
      state.colliderOffsetY,
      state.colliderMaterial.restitution,
      state.colliderMaterial.friction,
      state.colliderMaterial.surfaceVelocityX,
      state.colliderMaterial.surfaceVelocityY,
      state.colliderMaterial.density,
      state.colliderMaterial.contactBaumgarteBiasScale,
      state.colliderMaterial.maxContactBaumgarteBiasVelocityScale,
      state.colliderMaterial.contactPositionCorrectionScale,
      state.colliderMaterial.contactPositionCorrectionSlopScale,
    ], floatOffset);
  });
  return {
    format: PHYSICS_BODY_STATE_BUFFER_FORMAT,
    version: PHYSICS_BODY_STATE_BUFFER_VERSION,
    bodyCount,
    handles,
    floats,
    u32s,
    floatsPerBody: PHYSICS_BODY_STATE_FLOATS_PER_BODY,
    u32sPerBody: PHYSICS_BODY_STATE_U32S_PER_BODY,
    states: states.map((state) => ({
      ...state,
      colliderMaterial: { ...state.colliderMaterial },
    })),
  };
}

export function validatePhysicsBodyStateBufferSnapshot(
  snapshot: PhysicsBodyStateBufferSnapshot,
): void {
  if (snapshot.format !== PHYSICS_BODY_STATE_BUFFER_FORMAT) {
    throw new Error(`physics body state buffer format must be '${PHYSICS_BODY_STATE_BUFFER_FORMAT}'.`);
  }
  if (snapshot.version !== PHYSICS_BODY_STATE_BUFFER_VERSION) {
    throw new Error(`physics body state buffer version must be ${PHYSICS_BODY_STATE_BUFFER_VERSION}.`);
  }
  const bodyCount = uint32Number(snapshot.bodyCount, "physics body state buffer bodyCount");
  if (snapshot.floatsPerBody !== PHYSICS_BODY_STATE_FLOATS_PER_BODY) {
    throw new Error("physics body state buffer floatsPerBody ABI mismatch.");
  }
  if (snapshot.u32sPerBody !== PHYSICS_BODY_STATE_U32S_PER_BODY) {
    throw new Error("physics body state buffer u32sPerBody ABI mismatch.");
  }
  if (snapshot.handles.length !== bodyCount * 2) {
    throw new Error("physics body state buffer handles length must equal bodyCount * 2.");
  }
  if (snapshot.floats.length !== bodyCount * snapshot.floatsPerBody) {
    throw new Error("physics body state buffer floats length must match bodyCount.");
  }
  if (snapshot.u32s.length !== bodyCount * snapshot.u32sPerBody) {
    throw new Error("physics body state buffer u32s length must match bodyCount.");
  }
}

function physicsColliderTypeCode(colliderType: PhysicsColliderType): number {
  const code = PHYSICS_COLLIDER_TYPES.indexOf(colliderType);
  if (code < 0) {
    throw new Error("physics collider type is not supported.");
  }
  return code;
}

function physicsBodyStateFlags(state: PhysicsEntitySnapshot): number {
  return (state.bodyEnabled ? PHYSICS_BODY_STATE_FLAG_BODY_ENABLED : 0)
    | (state.isSleeping ? PHYSICS_BODY_STATE_FLAG_SLEEPING : 0)
    | (state.colliderEnabled ? PHYSICS_BODY_STATE_FLAG_COLLIDER_ENABLED : 0)
    | (state.colliderIsTrigger ? PHYSICS_BODY_STATE_FLAG_COLLIDER_TRIGGER : 0)
    | (state.colliderMaterialOverride ? PHYSICS_BODY_STATE_FLAG_COLLIDER_MATERIAL_OVERRIDE : 0);
}

function uint32Number(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${name} must be a uint32 integer.`);
  }
  return value;
}
