import type { Engine } from "../pkg/ferrum_core.js";
import type { PhysicsEntityHandle } from "./engineTypes/physicsBodies.js";
import type { UnifiedPhysicsColliderHandle } from "./unifiedPhysicsQueries.js";
import { physicsEntityHandle } from "./physicsHandles.js";
import { uint32Number } from "./particlePreset.js";
import { encodeUnifiedPhysicsCollider, physicsBoolean, physicsF32, physicsFloats,
  type UnifiedPhysicsBodyOptions, type UnifiedPhysicsCollider, type UnifiedPhysicsVector3 } from "./unifiedPhysicsAuthoring.js";

/** Full replacement of integration settings; pose and linear velocity are retained. */
export interface UnifiedPhysicsBodySettings {
  kind: NonNullable<UnifiedPhysicsBodyOptions["kind"]>;
  enabled: boolean;
  gravityScale: number;
  linearDamping: number;
  angularDamping: number;
  canSleep: boolean;
  ccd: boolean;
  /** Locks all rotations and clears angular velocity; planar axis locks always remain. */
  lockRotation: boolean;
}
export interface UnifiedPhysicsMassProperties {
  /** Added to collider-derived mass. Use zero density on every fixture for an exact total. */
  mass: number;
  principalInertia: UnifiedPhysicsVector3;
  center: UnifiedPhysicsVector3;
  inertiaRotation: readonly [number, number, number, number];
}
/** Infrequent authoring edits, each validated atomically by Rust. Imported legacy bodies
 * retain component ownership: edit their Physics Spec/components instead. Per-tick motion
 * uses the bulk command API. Collider handles must belong to the supplied entity. */
export interface FerrumUnifiedPhysicsControlApi {
  setUnifiedPhysicsBodyOptions(handle: PhysicsEntityHandle, options: UnifiedPhysicsBodySettings): void;
  setUnifiedPhysicsMassProperties(handle: PhysicsEntityHandle, properties: UnifiedPhysicsMassProperties): void;
  /** Owned identities, at most 64. Reading also works for imported bodies. */
  queryUnifiedPhysicsColliders(handle: PhysicsEntityHandle): UnifiedPhysicsColliderHandle[];
  addUnifiedPhysicsCollider(handle: PhysicsEntityHandle, collider: UnifiedPhysicsCollider): UnifiedPhysicsColliderHandle;
  updateUnifiedPhysicsCollider(handle: PhysicsEntityHandle, collider: UnifiedPhysicsColliderHandle, options: UnifiedPhysicsCollider): void;
  removeUnifiedPhysicsCollider(handle: PhysicsEntityHandle, collider: UnifiedPhysicsColliderHandle): void;
}
const METHODS = ["unified_physics_control_version", "set_unified_physics_body_options", "set_unified_physics_mass_properties",
  "query_unified_physics_colliders", "add_unified_physics_collider", "update_unified_physics_collider", "remove_unified_physics_collider"] as const;
type Native = Pick<Engine, typeof METHODS[number]>;
function colliderHandle(h: UnifiedPhysicsColliderHandle): UnifiedPhysicsColliderHandle {
  return {slot: uint32Number(h.slot, "collider slot"), generation: uint32Number(h.generation, "collider generation")};
}
function readHandles(values: Uint32Array): UnifiedPhysicsColliderHandle[] {
  if (!(values instanceof Uint32Array) || values.length % 2 || values.length > 128) throw new Error("Invalid unified physics collider identities.");
  const result: UnifiedPhysicsColliderHandle[] = [];
  for (let i=0;i<values.length;i+=2) result.push({slot:values[i],generation:values[i+1]});
  return result;
}
export function createUnifiedPhysicsControlApi(native: Native, requireAlive: () => void): FerrumUnifiedPhysicsControlApi {
  const check = () => {
    requireAlive();
    if (METHODS.some(k => typeof native[k] !== "function") || native.unified_physics_control_version() !== 1)
      throw new Error("This Wasm core does not support unified physics controls version 1.");
  };
  const requiredFlag = (value: boolean): boolean => {
    if (typeof value !== "boolean") throw new Error("Unified physics body settings require all boolean flags.");
    return physicsBoolean(value, false);
  };
  return {
    setUnifiedPhysicsBodyOptions(handle, options) {
      check();const h=physicsEntityHandle(handle);
      const kind=["fixed","dynamic","kinematic-position","kinematic-velocity"].indexOf(options.kind);
      if(kind<0)throw new Error("Invalid unified physics body kind.");
      const flags=Number(requiredFlag(options.enabled)) | (Number(requiredFlag(options.canSleep))<<1)
        | (Number(requiredFlag(options.ccd))<<2) | (Number(requiredFlag(options.lockRotation))<<3);
      native.set_unified_physics_body_options(h.entityId,h.entityGeneration,new Uint32Array([kind,flags]),
        new Float32Array([options.gravityScale,options.linearDamping,options.angularDamping].map(physicsF32)));
    },
    setUnifiedPhysicsMassProperties(handle, properties) {
      check();const h=physicsEntityHandle(handle);
      const values=new Float32Array([physicsF32(properties.mass),...physicsFloats(properties.principalInertia,3),
        ...physicsFloats(properties.center,3),...physicsFloats(properties.inertiaRotation,4)]);
      native.set_unified_physics_mass_properties(h.entityId,h.entityGeneration,values);
    },
    queryUnifiedPhysicsColliders(handle) {
      check();const h=physicsEntityHandle(handle);
      return readHandles(native.query_unified_physics_colliders(h.entityId,h.entityGeneration));
    },
    addUnifiedPhysicsCollider(handle, collider) {
      check();const h=physicsEntityHandle(handle), c=encodeUnifiedPhysicsCollider(collider);
      const result=readHandles(native.add_unified_physics_collider(h.entityId,h.entityGeneration,c.metadata,c.values,c.shape.metadata,c.shape.values));
      if(result.length!==1)throw new Error("Invalid unified physics created collider identity.");
      return result[0];
    },
    updateUnifiedPhysicsCollider(handle, collider, options) {
      check();const h=physicsEntityHandle(handle), id=colliderHandle(collider), c=encodeUnifiedPhysicsCollider(options);
      // All inputs are owned copies before any wasm-bindgen input allocation, even if
      // geometry originated in a borrowed query buffer about to be detached by growth.
      native.update_unified_physics_collider(new Uint32Array([h.entityId,h.entityGeneration,id.slot,id.generation]),
        c.metadata,c.values,c.shape.metadata,c.shape.values);
    },
    removeUnifiedPhysicsCollider(handle, collider) {
      check();const h=physicsEntityHandle(handle), c=colliderHandle(collider);
      native.remove_unified_physics_collider(h.entityId,h.entityGeneration,c.slot,c.generation);
    },
  };
}
