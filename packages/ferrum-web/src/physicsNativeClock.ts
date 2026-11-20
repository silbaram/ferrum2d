import type { Engine } from "../pkg/ferrum_core.js";
import type { FixedTimestepOptions } from "./engineTypes.js";
import { physicsSpecDiagnosticError } from "./diagnostics.js";

export interface NativePhysicsClockOptions {
  enabled: boolean;
  stepSeconds: number;
  maxFrameSeconds: number;
  maxStepsPerUpdate: number;
  interpolate: boolean;
}

interface NativePhysicsClock {
  unified_physics_clock_version(): number;
  unified_physics_clock_step_seconds(): number;
  unified_physics_clock_max_frame_seconds(): number;
  unified_physics_clock_max_steps_per_update(): number;
  configure_unified_physics_clock(enabled: boolean, step: number, maxFrame: number, maxSteps: number): boolean;
}

/** Cold capability check. No clock, interpolation, world or input mutation. */
export function requireNativePhysicsClock(native: Engine, path = "physics.clock"): asserts native is Engine & NativePhysicsClock {
  // The optional intersection permits cold rejection of an older generated core;
  // its generated declarations and bytes are never edited by the platform layer.
  const candidate: Engine & Partial<NativePhysicsClock> = native;
  if (typeof candidate.unified_physics_clock_version !== "function" || candidate.unified_physics_clock_version() !== 1
    || typeof candidate.configure_unified_physics_clock !== "function"
    || typeof candidate.unified_physics_clock_step_seconds !== "function"
    || typeof candidate.unified_physics_clock_max_frame_seconds !== "function"
    || typeof candidate.unified_physics_clock_max_steps_per_update !== "function"
    || typeof native.fixed_timestep_enabled !== "function") {
    throw physicsSpecDiagnosticError(path, "this Wasm core does not support native physics clock version 1");
  }
}

/** Mirrors the checked Rust setter's numeric admission before any cold setup. */
export function resolveNativePhysicsClockOptions(
  input: boolean | FixedTimestepOptions,
  nominalStep: number,
  path = "physics.clock",
): NativePhysicsClockOptions {
  if (typeof input !== "boolean" && (typeof input !== "object" || input === null)) {
    throw physicsSpecDiagnosticError(path, "must be a boolean or clock options");
  }
  const options = typeof input === "boolean" ? undefined : input;
  const enabled = typeof input === "boolean" ? input : input.enabled ?? true;
  if (typeof enabled !== "boolean") throw physicsSpecDiagnosticError(`${path}.enabled`, "must be a boolean");
  const nominal = nativeFloat(nominalStep, `${path}.stepSeconds`, 0.0001, 0.1);
  const stepSeconds = nativeFloat(options?.stepSeconds ?? nominal, `${path}.stepSeconds`, 0.0001, 0.1);
  if (stepSeconds !== nominal) {
    throw physicsSpecDiagnosticError(`${path}.stepSeconds`, "must match the native world's nominal timestep");
  }
  const maxFrameSeconds = nativeFloat(options?.maxFrameSeconds ?? 0.25, `${path}.maxFrameSeconds`, 0.0001, 102.4);
  const maxStepsPerUpdate = options?.maxStepsPerUpdate ?? 8;
  if (!Number.isInteger(maxStepsPerUpdate) || maxStepsPerUpdate < 1 || maxStepsPerUpdate > 1024) {
    throw physicsSpecDiagnosticError(`${path}.maxStepsPerUpdate`, "must be an integer in 1..1024");
  }
  const interpolate = options?.interpolate ?? false;
  if (typeof interpolate !== "boolean") throw physicsSpecDiagnosticError(`${path}.interpolate`, "must be a boolean");
  return { enabled, stepSeconds, maxFrameSeconds, maxStepsPerUpdate, interpolate };
}

function setNativePhysicsClock(native: Engine, clock: NativePhysicsClockOptions): { enabled: boolean; stepSeconds: number } {
  requireNativePhysicsClock(native);
  if (!native.configure_unified_physics_clock(clock.enabled, clock.stepSeconds, clock.maxFrameSeconds, clock.maxStepsPerUpdate)) {
    throw physicsSpecDiagnosticError("physics.clock", "native clock configuration rejected; prior clock and interpolation were preserved");
  }
  return { enabled: native.fixed_timestep_enabled(), stepSeconds: native.unified_physics_clock_step_seconds() };
}

/** Explicit public clock controls may also select render interpolation. */
export function applyNativePhysicsClock(native: Engine, clock: NativePhysicsClockOptions): { enabled: boolean; stepSeconds: number } {
  const accepted = setNativePhysicsClock(native, clock);
  // Presentation state must not change when the checked native setter rejects.
  native.configure_physics_render_interpolation(clock.interpolate);
  return accepted;
}

/** Authored groups do not own frame limits, residual time, input latches or presentation. */
export function selectNativePhysicsSpecClock(native: Engine, enabled: boolean): void {
  requireNativePhysicsClock(native);
  if (native.fixed_timestep_enabled() === enabled) return;
  const nominal = native.unified_physics_clock_step_seconds();
  const clock = resolveNativePhysicsClockOptions({ enabled,
    stepSeconds: nominal,
    maxFrameSeconds: native.unified_physics_clock_max_frame_seconds(),
    maxStepsPerUpdate: native.unified_physics_clock_max_steps_per_update(),
  }, nominal);
  // A real mode transition resets the native clock deliberately. Its existing
  // limits and render interpolation option remain owned by runtime controls.
  setNativePhysicsClock(native, clock);
}

function nativeFloat(value: number, path: string, minimum: number, maximum = Infinity): number {
  const native = typeof value === "number" ? Math.fround(value) : NaN;
  if (!Number.isFinite(native) || native < Math.fround(minimum) || native > Math.fround(maximum)) {
    throw physicsSpecDiagnosticError(path, `must be a finite f32 in ${minimum}..${maximum}`);
  }
  return native;
}
