import type { Engine } from "../pkg/ferrum_core.js";
import type { CreateEngineOptions } from "./engineTypes.js";
import { physicsSpecDiagnosticError } from "./diagnostics.js";
import type { ResolvedPhysicsSpec } from "./physicsSpec.js";
import { encodeUnifiedPhysicsWorld } from "./unifiedPhysics.js";
import { selectNativePhysicsSpecClock, requireNativePhysicsClock, resolveNativePhysicsClockOptions } from "./physicsNativeClock.js";

/** Backend selection is independent of the fixed or variable clock. */
export function usesNativePhysicsSpec(spec: ResolvedPhysicsSpec): boolean {
  return spec.mode === "rigid" || spec.mode === "arcade";
}

/** Cold authoring admission; all simulation and component import stay in Rust. */
export function validateNativePhysicsSpec(spec: ResolvedPhysicsSpec, path = "physics"): void {
  if (!usesNativePhysicsSpec(spec)) return;
  if (typeof spec.solver.fixedTimestep !== "boolean") {
    throw physicsSpecDiagnosticError(`${path}.solver.fixedTimestep`, "native physics clock selection must be a boolean");
  }
  // Match the native f32/u32 admission before authoring clears or stages anything.
  for (const field of ["velocityIterations", "positionIterations"] as const) {
    const value = spec.solver[field];
    if (!Number.isInteger(value) || value < 1 || value > 32) {
      throw physicsSpecDiagnosticError(`${path}.solver.${field}`, "native solver iterations must be an integer in 1..32");
    }
  }
  nativeFloatRange(spec.solver.stepSeconds, 0.0001, 0.1, `${path}.solver.stepSeconds`);
  nativeFloatRange(spec.gravityX, -1e6, 1e6, `${path}.gravityX`);
  nativeFloatRange(spec.gravityY, -1e6, 1e6, `${path}.gravityY`);
}

function nativeFloatRange(value: number, min: number, max: number, path: string): void {
  const native = typeof value === "number" ? Math.fround(value) : NaN;
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isFinite(native)
    || native < Math.fround(min) || native > Math.fround(max)) {
    throw physicsSpecDiagnosticError(path, `native value must be a finite f32 in ${min}..${max}`);
  }
}

export function nativePhysicsSpecPayload(
  native: Engine, spec: ResolvedPhysicsSpec, options: CreateEngineOptions,
) {
  validateNativePhysicsSpec(spec);
  if (!usesNativePhysicsSpec(spec)) throw physicsSpecDiagnosticError("physics.mode", "native Physics Spec setup requires rigid or arcade mode");
  const clock = options.fixedTimestep;
  const fixedOnlyCore = usesPriorFixedNativeClock(native, spec);
  const activeNative = typeof native.physics_spec_backend_active === "function" && native.physics_spec_backend_active();
  if (clock !== undefined) {
    if (typeof clock !== "boolean" && (typeof clock !== "object" || clock === null)) {
      throw physicsSpecDiagnosticError("physics.clock", "engine clock override must be a boolean or clock options");
    }
    const enabled = typeof clock === "boolean" ? clock : clock.enabled ?? true;
    if (typeof enabled !== "boolean") {
      throw physicsSpecDiagnosticError("physics.clock.enabled", "engine clock override must select a boolean mode");
    }
    const step = typeof clock === "boolean" ? 1 / 60 : clock.stepSeconds ?? 1 / 60;
    // A retained creation option still constrains the nominal step. Its clock
    // mode only owns initial setup; successful runtime controls change Rust's
    // current clock without mutating the caller's creation options.
    if (((!activeNative || fixedOnlyCore) && enabled !== spec.solver.fixedTimestep)
      || Math.fround(step) !== Math.fround(spec.solver.stepSeconds)) {
      throw physicsSpecDiagnosticError("physics.solver.stepSeconds", "clock mode and nominal step must match the engine timestep override");
    }
  }
  if (typeof native.physics_spec_backend_version !== "function"
    || native.physics_spec_backend_version() !== 1
    || typeof native.physics_spec_backend_active !== "function"
    || typeof native.set_auto_rigid_body_step_enabled !== "function"
    || typeof native.query_physics_body_states_bulk !== "function"
    || typeof native.configure_physics_spec_world !== "function") {
    throw physicsSpecDiagnosticError("physics.mode", "this Wasm core does not support native Physics Spec backend version 1");
  }
  if (!fixedOnlyCore) requireNativePhysicsClock(native);
  physicsSpecClock(spec, options);
  if (clock !== undefined && activeNative && !fixedOnlyCore && native.fixed_timestep_enabled() !== spec.solver.fixedTimestep) {
    throw physicsSpecDiagnosticError("physics.solver.fixedTimestep", "clock mode must match the active native clock");
  }
  return encodeUnifiedPhysicsWorld({
    space: "planar-xy", lengthUnit: 1, gravity: [spec.gravityX, spec.gravityY, 0],
    stepSeconds: spec.solver.stepSeconds, velocityIterations: spec.solver.velocityIterations,
    positionIterations: spec.solver.positionIterations, continuous: spec.continuous,
    restitutionVelocityThreshold: 1,
  });
}

export function configureNativePhysicsSpec(native: Engine, spec: ResolvedPhysicsSpec, options: CreateEngineOptions): void {
  const fixedOnlyCore = usesPriorFixedNativeClock(native, spec);
  const payload = nativePhysicsSpecPayload(native, spec, options);
  native.configure_physics_spec_world(payload.metadata, payload.values);
  // Rust same-world admission preserves clock history and imports new bodies.
  // Only change an actually different clock mode, using live native limits.
  if (!fixedOnlyCore) selectNativePhysicsSpecClock(native, spec.solver.fixedTimestep);
}

/** Backend v1 already installs a fixed nominal clock. Preserve that existing
 * operation when a prior core has none of the new clock API. Partial or wrong
 * new capabilities still fail closed, as do variable specs and live controls.
 */
function usesPriorFixedNativeClock(native: Engine, spec: ResolvedPhysicsSpec): boolean {
  return spec.solver.fixedTimestep
    && native.unified_physics_clock_version === undefined
    && native.unified_physics_clock_step_seconds === undefined
    && native.unified_physics_clock_max_frame_seconds === undefined
    && native.unified_physics_clock_max_steps_per_update === undefined
    && native.configure_unified_physics_clock === undefined
    && native.default_physics_policy_fixed_timestep === undefined;
}

function physicsSpecClock(spec: ResolvedPhysicsSpec, options: CreateEngineOptions) {
  const limits = typeof options.fixedTimestep === "object" ? options.fixedTimestep : undefined;
  return resolveNativePhysicsClockOptions({ ...limits, enabled: spec.solver.fixedTimestep, stepSeconds: spec.solver.stepSeconds }, spec.solver.stepSeconds);
}

/** A live native world must not silently revert to the legacy solver or clock. */
export function validatePhysicsSpecModeTransition(native: Engine, spec: ResolvedPhysicsSpec): void {
  if (!usesNativePhysicsSpec(spec) && typeof native.physics_spec_backend_active === "function"
    && native.physics_spec_backend_active()) {
    throw physicsSpecDiagnosticError("physics.mode", "leave the native physics scene before selecting none");
  }
}
