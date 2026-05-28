import type {
  PhysicsEntityHandle,
  PhysicsJointHandle,
} from "./engineTypes.js";

export function frozenEntityHandle(handle: PhysicsEntityHandle): PhysicsEntityHandle {
  return Object.freeze({ ...handle });
}

export function frozenJointHandle(handle: PhysicsJointHandle): PhysicsJointHandle {
  return Object.freeze({ ...handle });
}

export function frozenEntityHandleRecord(
  handles: Record<string, PhysicsEntityHandle>,
): Record<string, PhysicsEntityHandle> {
  const result: Record<string, PhysicsEntityHandle> = {};
  for (const [id, handle] of Object.entries(handles)) {
    result[id] = frozenEntityHandle(handle);
  }
  return Object.freeze(result);
}

export function frozenJointHandleRecord(
  handles: Record<string, PhysicsJointHandle>,
): Record<string, PhysicsJointHandle> {
  const result: Record<string, PhysicsJointHandle> = {};
  for (const [id, handle] of Object.entries(handles)) {
    result[id] = frozenJointHandle(handle);
  }
  return Object.freeze(result);
}
