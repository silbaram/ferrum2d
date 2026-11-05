import type { Engine } from "../pkg/ferrum_core";
import type { FerrumPhysicsBodyApi, PhysicsEntityHandle } from "./engineTypes.js";
import { physicsEntityHandleBuffer } from "./physicsHandles.js";
import type { WasmBridge } from "./wasmBridge.js";

export function createPhysicsSolverStateApi(rust: Engine, bridge: WasmBridge, requireAlive: () => void): Pick<FerrumPhysicsBodyApi,
  "capturePhysicsSolverState" | "restorePhysicsSolverState" | "withPhysicsWorldTransaction"> {
  return {
    capturePhysicsSolverState(handles: readonly PhysicsEntityHandle[]) {
      requireAlive();
      const packed = physicsEntityHandleBuffer(handles);
      const values = rust.capture_physics_solver_state_bulk(packed);
      if (values.length !== handles.length * 8) throw new Error("Invalid physics solver state body handles");
      const selected = new Set(handles.map(h => `${h.entityId}:${h.entityGeneration}`));
      if (selected.size !== handles.length) throw new Error("Duplicate physics solver state body handle");
      rust.query_rigid_contact_impulses();
      const contactHandles: number[] = [];
      const contacts: number[] = [];
      for (const hit of bridge.readPhysicsRigidContactImpulseHits()) {
        const a = selected.has(`${hit.aEntityId}:${hit.aEntityGeneration}`);
        const b = selected.has(`${hit.bEntityId}:${hit.bEntityGeneration}`);
        if (a !== b) throw new Error("Physics snapshot cannot omit a body in a cached contact");
        if (!a) continue;
        contactHandles.push(hit.aEntityId, hit.aEntityGeneration, hit.bEntityId, hit.bEntityGeneration);
        contacts.push(hit.pointX, hit.pointY, hit.normalX, hit.normalY, hit.normalImpulse, hit.tangentImpulse);
      }
      return { handles: packed, values, contactHandles: new Uint32Array(contactHandles), contacts: new Float32Array(contacts) };
    },
    restorePhysicsSolverState(buffer) {
      requireAlive();
      return rust.restore_physics_solver_state_bulk(buffer.handles, buffer.values, buffer.contactHandles, buffer.contacts);
    },
    withPhysicsWorldTransaction<T>(operation: () => T): T {
      requireAlive();
      if (!rust.begin_physics_restore_transaction()) throw new Error("Nested physics world transaction is not supported");
      try {
        const value = operation();
        if (value !== null && typeof value === "object" && "then" in value) throw new Error("Physics world transactions must be synchronous");
        rust.end_physics_restore_transaction(true);
        return value;
      } catch (error) {
        rust.end_physics_restore_transaction(false);
        throw error;
      }
    },
  };
}
