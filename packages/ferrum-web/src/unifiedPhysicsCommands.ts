import type { Engine } from "../pkg/ferrum_core.js";
import type { WasmBridge } from "./wasmBridge.js";

export interface FerrumUnifiedPhysicsCommandApi {
  /** Teleport immediately: seven floats per handle, position XYZ then unit rotation XYZW.
   * Last duplicate wins. Character teleports must preserve the capsule's up axis.
   */
  setUnifiedPhysicsPoses(handles: Uint32Array, poses: Float32Array): void;
  /** Next fixed-tick pose of position-kinematic bodies; seven floats per handle.
   * Controller-owned bodies reject targets. Squeeze constraints may stop a target early.
   */
  setUnifiedPhysicsKinematicTargets(handles: Uint32Array, poses: Float32Array): void;
  /** Persistent world-space force XYZ + torque XYZ, six floats per dynamic body.
   * Duplicate rows add; forces persist until explicitly cleared. Locked axes constrain acceleration.
   */
  addUnifiedPhysicsForces(handles: Uint32Array, forces: Float32Array): void;
  /** Remove persistent force/torque without changing velocity. */
  clearUnifiedPhysicsForces(handles: Uint32Array): void;
  /** Instant world-space linear XYZ + angular XYZ impulse, six floats per dynamic body.
   * Duplicate rows add. Locked axes discard impulse components through inverse mass/inertia.
   */
  applyUnifiedPhysicsImpulses(handles: Uint32Array, impulses: Float32Array): void;
  /** Sleep (also zero velocities) or wake dynamic bodies. */
  setUnifiedPhysicsSleeping(handles: Uint32Array, sleeping: boolean): void;
}

type Native = Pick<Engine, "unified_physics_command_version" | "command_unified_physics_bodies">;
const EMPTY_VALUES = new Float32Array();

export function createUnifiedPhysicsCommandApi(
  native: Native,
  bridge: Pick<WasmBridge, "copyUnifiedPhysicsInputAliases">,
  requireAlive: () => void,
): FerrumUnifiedPhysicsCommandApi {
  function command(code: number, stride: number, handles: Uint32Array, values: Float32Array = EMPTY_VALUES): void {
    requireAlive();
    if (typeof native.unified_physics_command_version !== "function"
      || native.unified_physics_command_version() !== 1
      || typeof native.command_unified_physics_bodies !== "function") {
      throw new Error("This Wasm core does not support unified physics command version 1.");
    }
    if (!(handles instanceof Uint32Array) || handles.length % 2 !== 0 || handles.length > 131072) {
      throw new Error("Body commands require at most 65536 id/generation pairs.");
    }
    if (!(values instanceof Float32Array) || values.length !== handles.length / 2 * stride) {
      throw new Error(`Body command requires ${stride} f32 values per handle.`);
    }
    // Both inputs must be retained before the generated wrapper allocates in Wasm memory.
    const data = bridge.copyUnifiedPhysicsInputAliases(handles, values);
    native.command_unified_physics_bodies(code, data.handles, data.values);
  }
  return {
    setUnifiedPhysicsPoses(handles, poses) { command(0, 7, handles, poses); },
    setUnifiedPhysicsKinematicTargets(handles, poses) { command(1, 7, handles, poses); },
    addUnifiedPhysicsForces(handles, forces) { command(2, 6, handles, forces); },
    clearUnifiedPhysicsForces(handles) { command(3, 0, handles); },
    applyUnifiedPhysicsImpulses(handles, impulses) { command(4, 6, handles, impulses); },
    setUnifiedPhysicsSleeping(handles, sleeping) {
      requireAlive();
      if (typeof sleeping !== "boolean") throw new Error("Sleeping must be boolean.");
      command(sleeping ? 5 : 6, 0, handles);
    },
  };
}
