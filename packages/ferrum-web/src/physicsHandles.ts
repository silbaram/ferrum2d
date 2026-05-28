import type { Engine } from "../pkg/ferrum_core";
import { uint32Number } from "./particlePreset";
import type { PhysicsEntityHandle } from "./engineTypes.js";

export function physicsEntityHandle(handle: PhysicsEntityHandle): PhysicsEntityHandle {
  return {
    entityId: uint32Number(handle.entityId, "physics entity id"),
    entityGeneration: uint32Number(handle.entityGeneration, "physics entity generation"),
  };
}

export function physicsEntityHandleBuffer(handles: readonly PhysicsEntityHandle[]): Uint32Array {
  const buffer = new Uint32Array(handles.length * 2);
  handles.forEach((handle, index) => {
    const resolved = physicsEntityHandle(handle);
    const offset = index * 2;
    buffer[offset] = resolved.entityId;
    buffer[offset + 1] = resolved.entityGeneration;
  });
  return buffer;
}

export function readPhysicsEntityHandle(rustEngine: Engine): PhysicsEntityHandle {
  return {
    entityId: rustEngine.physics_entity_id(),
    entityGeneration: rustEngine.physics_entity_generation(),
  };
}
