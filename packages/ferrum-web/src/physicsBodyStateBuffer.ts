import type { PhysicsColliderType, PhysicsEntitySnapshot, PhysicsRigidBodyType } from "./engineTypes.js";

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
const PHYSICS_BODY_TYPES: readonly PhysicsRigidBodyType[] = Object.freeze([
  "static",
  "kinematic",
  "dynamic",
]);
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

export interface PhysicsBodyStateBufferDecodeInput {
  bodyCount: number;
  handles: Uint32Array;
  floats: Float32Array;
  u32s: Uint32Array;
  floatsPerBody: number;
  u32sPerBody: number;
}

export function decodePhysicsBodyStateBuffer(
  snapshot: PhysicsBodyStateBufferDecodeInput,
): readonly PhysicsEntitySnapshot[] {
  const states: PhysicsEntitySnapshot[] = [];
  for (let index = 0; index < snapshot.bodyCount; index += 1) {
    const floatOffset = index * snapshot.floatsPerBody;
    const u32Offset = index * snapshot.u32sPerBody;
    const flags = snapshot.u32s[u32Offset + PHYSICS_BODY_STATE_U32_FLAGS];
    states.push({
      entityId: snapshot.u32s[u32Offset + PHYSICS_BODY_STATE_U32_ENTITY_ID],
      entityGeneration: snapshot.u32s[u32Offset + PHYSICS_BODY_STATE_U32_ENTITY_GENERATION],
      x: snapshot.floats[floatOffset],
      y: snapshot.floats[floatOffset + 1],
      velocityX: snapshot.floats[floatOffset + 2],
      velocityY: snapshot.floats[floatOffset + 3],
      rotationRadians: snapshot.floats[floatOffset + 4],
      angularVelocityRadiansPerSecond: snapshot.floats[floatOffset + 5],
      bodyType: PHYSICS_BODY_TYPES[snapshot.u32s[u32Offset + PHYSICS_BODY_STATE_U32_BODY_TYPE]] ?? "dynamic",
      bodyEnabled: (flags & PHYSICS_BODY_STATE_FLAG_BODY_ENABLED) !== 0,
      isSleeping: (flags & PHYSICS_BODY_STATE_FLAG_SLEEPING) !== 0,
      colliderType:
        PHYSICS_COLLIDER_TYPES[snapshot.u32s[u32Offset + PHYSICS_BODY_STATE_U32_COLLIDER_TYPE]] ?? "none",
      colliderEnabled: (flags & PHYSICS_BODY_STATE_FLAG_COLLIDER_ENABLED) !== 0,
      colliderIsTrigger: (flags & PHYSICS_BODY_STATE_FLAG_COLLIDER_TRIGGER) !== 0,
      colliderOffsetX: snapshot.floats[floatOffset + 20],
      colliderOffsetY: snapshot.floats[floatOffset + 21],
      colliderMaterialOverride: (flags & PHYSICS_BODY_STATE_FLAG_COLLIDER_MATERIAL_OVERRIDE) !== 0,
      colliderMaterial: {
        restitution: snapshot.floats[floatOffset + 22],
        friction: snapshot.floats[floatOffset + 23],
        surfaceVelocityX: snapshot.floats[floatOffset + 24],
        surfaceVelocityY: snapshot.floats[floatOffset + 25],
        density: snapshot.floats[floatOffset + 26],
        contactBaumgarteBiasScale: snapshot.floats[floatOffset + 27],
        maxContactBaumgarteBiasVelocityScale: snapshot.floats[floatOffset + 28],
        contactPositionCorrectionScale: snapshot.floats[floatOffset + 29],
        contactPositionCorrectionSlopScale: snapshot.floats[floatOffset + 30],
      },
      mass: snapshot.floats[floatOffset + 6],
      inverseMass: inverseOrZero(snapshot.floats[floatOffset + 6]),
      inertia: snapshot.floats[floatOffset + 7],
      inverseInertia: inverseOrZero(snapshot.floats[floatOffset + 7]),
      gravityScale: snapshot.floats[floatOffset + 8],
      linearDamping: snapshot.floats[floatOffset + 9],
      angularDamping: snapshot.floats[floatOffset + 10],
      restitution: snapshot.floats[floatOffset + 11],
      friction: snapshot.floats[floatOffset + 12],
      surfaceVelocityX: snapshot.floats[floatOffset + 13],
      surfaceVelocityY: snapshot.floats[floatOffset + 14],
      density: snapshot.floats[floatOffset + 15],
      contactBaumgarteBiasScale: snapshot.floats[floatOffset + 16],
      maxContactBaumgarteBiasVelocityScale: snapshot.floats[floatOffset + 17],
      contactPositionCorrectionScale: snapshot.floats[floatOffset + 18],
      contactPositionCorrectionSlopScale: snapshot.floats[floatOffset + 19],
    });
  }
  return states;
}

function inverseOrZero(value: number): number {
  return Number.isFinite(value) && value > 0 ? 1 / value : 0;
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
