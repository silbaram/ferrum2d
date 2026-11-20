import type { Engine } from "../pkg/ferrum_core.js";

type Native = Partial<Pick<Engine, "physics_spec_backend_active" | "unified_physics_debug_version" | "unified_physics_debug_state_ptr">>;

/** Debug-off native execution still works with older cores. Never present
 * legacy World outlines as actual native geometry when consuming debug data. */
export function requireNativeDebugGeometry(native: Native, requested: boolean): void {
  if (!requested || native.physics_spec_backend_active?.() !== true) return;
  if (typeof native.unified_physics_debug_version !== "function" || native.unified_physics_debug_version() !== 1
    || typeof native.unified_physics_debug_state_ptr !== "function") {
    throw new Error("This Wasm core does not support native physics debug geometry version 1.");
  }
}
