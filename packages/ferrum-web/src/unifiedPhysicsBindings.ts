import type { Engine } from "../pkg/ferrum_core.js";
import type { PhysicsEntityHandle } from "./engineTypes/physicsBodies.js";
import { physicsEntityHandle } from "./physicsHandles.js";
import { encodeUnifiedPhysicsBody, type UnifiedPhysicsBodyOptions } from "./unifiedPhysicsAuthoring.js";

export interface FerrumUnifiedPhysicsBindingApi {
  /** Attach native physics to an existing visual/gameplay entity. Pose is explicit physics
   * XYZ; sprite/animation/behavior identity is retained. Existing physics ownership rejects. */
  bindUnifiedPhysicsBody(entity: PhysicsEntityHandle, options: UnifiedPhysicsBodyOptions): void;
  /** Remove native physics while keeping the entity and visual at their last projection.
   * Stops linear/angular velocity. Imported component bodies/generated projectiles reject. */
  unbindUnifiedPhysicsBody(entity: PhysicsEntityHandle): void;
}
type Native = Pick<Engine,
  "unified_physics_binding_version" | "bind_unified_physics_body" | "unbind_unified_physics_body">;

export function createUnifiedPhysicsBindingApi(native: Native, requireAlive: () => void): FerrumUnifiedPhysicsBindingApi {
  const check = () => {
    requireAlive();
    if (typeof native.unified_physics_binding_version !== "function" || native.unified_physics_binding_version() !== 1
      || typeof native.bind_unified_physics_body !== "function" || typeof native.unbind_unified_physics_body !== "function") {
      throw new Error("This Wasm core does not support unified physics binding version 1.");
    }
  };
  return {
    bindUnifiedPhysicsBody(entity, options) {
      check();
      const h = physicsEntityHandle(entity), p = encodeUnifiedPhysicsBody(options);
      native.bind_unified_physics_body(new Uint32Array([h.entityId, h.entityGeneration]),
        p.metadata, p.values, p.shape.metadata, p.shape.values);
    },
    unbindUnifiedPhysicsBody(entity) {
      check();
      const h = physicsEntityHandle(entity);
      native.unbind_unified_physics_body(h.entityId, h.entityGeneration);
    },
  };
}
