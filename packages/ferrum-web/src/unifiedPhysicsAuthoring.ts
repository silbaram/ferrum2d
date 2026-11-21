import type { Engine } from "../pkg/ferrum_core.js";
import type { PhysicsEntityHandle } from "./engineTypes/physicsBodies.js";
import { physicsEntityHandle } from "./physicsHandles.js";
import { finiteNumber, uint32Number } from "./particlePreset.js";

export type UnifiedPhysicsVector3 = readonly [number, number, number];
export interface UnifiedPhysicsPose {
  position?: UnifiedPhysicsVector3;
  /** Unit quaternion, XYZW. */
  rotation?: readonly [number, number, number, number];
}
export type UnifiedPhysicsConvexShape =
  | { type: "box"; halfExtents: UnifiedPhysicsVector3 }
  | { type: "sphere"; radius: number }
  | { type: "capsule"; halfHeight: number; radius: number }
  | { type: "convexHull"; points: readonly UnifiedPhysicsVector3[] };
export type UnifiedPhysicsShape = UnifiedPhysicsConvexShape
  | { type: "triangleMesh"; vertices: readonly number[] | Float32Array; triangles: readonly number[] | Uint32Array }
  | { type: "heightfield"; rows: number; columns: number; heights: readonly number[] | Float32Array; size: readonly [number, number] }
  | { type: "compound"; parts: readonly { pose?: UnifiedPhysicsPose; shape: UnifiedPhysicsConvexShape }[] };
export interface UnifiedPhysicsContactCorrection {
  velocityRate: number; maxVelocity: number; positionRate: number; positionSlop: number; velocitySlop: number;
  splitImpulse?: boolean;
}
export interface UnifiedPhysicsCollider {
  shape: UnifiedPhysicsShape;
  pose?: UnifiedPhysicsPose;
  /** Volume density in both spatial and planar modes. Defaults to 1. */
  density?: number;
  friction?: number;
  restitution?: number;
  surfaceVelocity?: UnifiedPhysicsVector3;
  contactCorrection?: UnifiedPhysicsContactCorrection;
  sensor?: boolean;
  category?: number;
  mask?: number;
}
export interface UnifiedPhysicsBodyOptions {
  kind?: "fixed" | "dynamic" | "kinematic-position" | "kinematic-velocity";
  pose?: UnifiedPhysicsPose;
  linearVelocity?: UnifiedPhysicsVector3;
  angularVelocity?: UnifiedPhysicsVector3;
  gravityScale?: number;
  linearDamping?: number;
  angularDamping?: number;
  ccd?: boolean;
  canSleep?: boolean;
  collider: UnifiedPhysicsCollider;
  /** Visual anchor offset in physics XYZ, independent of collider geometry. */
  renderOffset?: UnifiedPhysicsVector3;
}
export interface FerrumUnifiedPhysicsAuthoringApi {
  /** Setup-only, atomic creation of one native body/collider and its entity. No sprite is created. */
  spawnUnifiedPhysicsBody(options: UnifiedPhysicsBodyOptions): PhysicsEntityHandle;
  /** Immediately removes body, joints, controller and entity. Rejects stale handles. */
  removeUnifiedPhysicsBody(handle: PhysicsEntityHandle): void;
}

export function physicsF32(value: number): number {
  return finiteNumber(Math.fround(finiteNumber(value, "unified physics value")), "unified physics f32 value");
}
export function physicsBoolean(value: boolean | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error("Unified physics flags must be boolean.");
  return value;
}
export function physicsFloats(values: readonly number[] | Float32Array, count: number): number[] {
  if ((!Array.isArray(values) && !(values instanceof Float32Array)) || values.length !== count) throw new Error("Invalid unified physics numeric array length.");
  return Array.from(values, physicsF32);
}
export function physicsPose(p?: UnifiedPhysicsPose): number[] {
  return [...physicsFloats(p?.position ?? [0,0,0], 3), ...physicsFloats(p?.rotation ?? [0,0,0,1], 4)];
}
function boundedCount(n: number, min: number, max: number): number {
  uint32Number(n, "unified physics shape count", max);
  if (n < min) throw new Error("Invalid unified physics shape count.");
  return n;
}
export function encodeUnifiedPhysicsShape(shape: UnifiedPhysicsShape): {metadata: Uint32Array; values: Float32Array} {
  const metadata: number[] = [], values: number[] = [];
  const append = (v: readonly number[] | Float32Array, n: number) => { for (const f of physicsFloats(v, n)) values.push(f); };
  const encode = (s: UnifiedPhysicsShape, convexOnly = false): void => {
    if (convexOnly && !["box", "sphere", "capsule", "convexHull"].includes(s.type)) throw new Error("Compound parts must be convex.");
    switch (s.type) {
      case "box": metadata.push(0); append(s.halfExtents, 3); break;
      case "sphere": metadata.push(1); append([s.radius], 1); break;
      case "capsule": metadata.push(2); append([s.halfHeight, s.radius], 2); break;
      case "convexHull": {
        if (!Array.isArray(s.points)) throw new Error("Hull points must be an array.");
        metadata.push(3, boundedCount(s.points.length, 4, 256));
        for (const p of s.points) append(p, 3);
        break;
      }
      case "triangleMesh": {
        const n = boundedCount(s.vertices.length / 3, 3, 65536), t = boundedCount(s.triangles.length / 3, 1, 131072);
        if (!Array.isArray(s.triangles) && !(s.triangles instanceof Uint32Array)) throw new Error("Triangle indices require an integer array.");
        metadata.push(4, n, t); append(s.vertices, n * 3);
        for (const i of s.triangles) metadata.push(uint32Number(i, "triangle vertex index", n - 1));
        break;
      }
      case "heightfield": {
        const rows = boundedCount(s.rows, 2, 32768), columns = boundedCount(s.columns, 2, 32768);
        boundedCount(rows * columns, 4, 65536);
        metadata.push(5, rows, columns); append(s.size, 2); append(s.heights, rows * columns); break;
      }
      case "compound": {
        if (!Array.isArray(s.parts)) throw new Error("Compound parts must be an array.");
        metadata.push(6, boundedCount(s.parts.length, 1, 64));
        for (const part of s.parts) { append(physicsPose(part.pose), 7); encode(part.shape, true); }
        break;
      }
      default: throw new Error("Unsupported unified physics shape.");
    }
  };
  encode(shape);
  return {metadata: new Uint32Array(metadata), values: new Float32Array(values)};
}

type Native = Pick<Engine, "unified_physics_authoring_version" | "spawn_unified_physics_body" | "remove_unified_physics_body">;
function check(native: Native): void {
  if (typeof native.unified_physics_authoring_version !== "function" || native.unified_physics_authoring_version() !== 1
    || typeof native.spawn_unified_physics_body !== "function" || typeof native.remove_unified_physics_body !== "function") {
    throw new Error("This Wasm core does not support unified physics authoring version 1.");
  }
}
export function createUnifiedPhysicsAuthoringApi(native: Native, requireAlive: () => void): FerrumUnifiedPhysicsAuthoringApi {
  return {
    spawnUnifiedPhysicsBody(options) {
      requireAlive(); check(native);
      const {metadata, values, shape} = encodeUnifiedPhysicsBody(options);
      const result = native.spawn_unified_physics_body(metadata, values, shape.metadata, shape.values);
      if (result.length !== 2) throw new Error("Invalid unified physics entity result.");
      return {entityId: result[0], entityGeneration: result[1]};
    },
    removeUnifiedPhysicsBody(handle) {
      requireAlive(); check(native);
      const h = physicsEntityHandle(handle);
      native.remove_unified_physics_body(h.entityId, h.entityGeneration);
    },
  };
}

/** Internal numeric codec shared by creation-independent collider edits. */
export function encodeUnifiedPhysicsCollider(c: UnifiedPhysicsCollider) {
  const correction = c.contactCorrection;
  const flags = Number(physicsBoolean(c.sensor, false))
    | (correction ? 2 | (Number(physicsBoolean(correction.splitImpulse, false)) << 2) : 0);
  const metadata = new Uint32Array([flags, uint32Number(c.category ?? 1, "physics category"), uint32Number(c.mask ?? 0xffffffff, "physics mask")]);
  const values = new Float32Array([
    ...physicsPose(c.pose), c.density ?? 1, c.friction ?? 0.5, c.restitution ?? 0,
    ...physicsFloats(c.surfaceVelocity ?? [0,0,0], 3),
    ...(correction ? [correction.velocityRate, correction.maxVelocity, correction.positionRate, correction.positionSlop, correction.velocitySlop] : [0,0,0,0,0]),
  ].map(physicsF32));
  return {metadata, values, shape: encodeUnifiedPhysicsShape(c.shape)};
}

/** Shared setup codec for new entities and existing visual bindings. */
export function encodeUnifiedPhysicsBody(options: UnifiedPhysicsBodyOptions) {
  const kind = ["fixed", "dynamic", "kinematic-position", "kinematic-velocity"].indexOf(options.kind ?? "dynamic");
  if (kind < 0) throw new Error("Invalid unified physics body kind.");
  const c = options.collider, correction = c.contactCorrection;
  const flags = Number(physicsBoolean(options.ccd, false)) | (Number(physicsBoolean(options.canSleep, true)) << 1)
    | (Number(physicsBoolean(c.sensor, false)) << 2) | (correction ? 8 | (Number(physicsBoolean(correction.splitImpulse, false)) << 4) : 0);
  const metadata = new Uint32Array([kind, flags, uint32Number(c.category ?? 1, "physics category"), uint32Number(c.mask ?? 0xffffffff, "physics mask")]);
  const values = new Float32Array([
    ...physicsPose(options.pose), ...physicsFloats(options.linearVelocity ?? [0,0,0], 3), ...physicsFloats(options.angularVelocity ?? [0,0,0], 3),
    options.gravityScale ?? 1, options.linearDamping ?? 0, options.angularDamping ?? 0,
    ...physicsPose(c.pose), c.density ?? 1, c.friction ?? 0.5, c.restitution ?? 0,
    ...physicsFloats(c.surfaceVelocity ?? [0,0,0], 3), ...physicsFloats(options.renderOffset ?? [0,0,0], 3),
    ...(correction ? [correction.velocityRate, correction.maxVelocity, correction.positionRate, correction.positionSlop, correction.velocitySlop] : [0,0,0,0,0]),
  ].map(physicsF32));
  const shape = encodeUnifiedPhysicsShape(c.shape);
  return {metadata, values, shape};
}
