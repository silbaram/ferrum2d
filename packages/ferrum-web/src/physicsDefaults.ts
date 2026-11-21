import type { Engine } from "../pkg/ferrum_core.js";
import type { CreateEngineOptions } from "./engineTypes.js";
import { physicsSpecDiagnosticError } from "./diagnostics.js";
import { resolvePhysicsSpec, type ResolvedPhysicsSpec } from "./physicsSpec.js";
import { configureNativePhysicsSpec, validateNativePhysicsSpec } from "./physicsSpecNativeRuntime.js";
import { applyPhysicsRuntimeOptions } from "./physicsRuntimeControls.js";
import { encodeUnifiedPhysicsWorld } from "./unifiedPhysics.js";
import { requireNativePhysicsClock, resolveNativePhysicsClockOptions } from "./physicsNativeClock.js";

interface PhysicsMetadata {
  physicsSpec: ResolvedPhysicsSpec;
  physicsSpecScene?: number;
}

interface LegacyPhysicsSelection { configure_legacy_physics_defaults(): boolean }
/** Default backend selection is explicit; clock selection remains independent. */
export function usesDefaultNativePhysics(options: CreateEngineOptions): boolean {
  return options.physicsBackend !== "legacy";
}

interface DefaultPhysicsClock {
  default_physics_policy_fixed_timestep(): boolean;
}

function requireDefaultPhysicsClock(native: Engine): asserts native is Engine & DefaultPhysicsClock {
  const policy: Engine & Partial<DefaultPhysicsClock> = native;
  if (typeof policy.default_physics_policy_fixed_timestep !== "function") {
    throw physicsSpecDiagnosticError("engine.physics.clock", "this Wasm core cannot report the stored default physics clock");
  }
}

/** Reads the retained next-scene policy, independently of a scene-local world. */
export function resolveDefaultPhysicsPolicySpec(native: Engine, defaults: ResolvedPhysicsSpec): ResolvedPhysicsSpec {
  requireDefaultPhysicsClock(native);
  const spec = structuredClone(defaults);
  spec.solver.fixedTimestep = native.default_physics_policy_fixed_timestep();
  return spec;
}

/** Creation policy is cold setup; Rust owns its lifetime and simulation. */
export function resolveInitialPhysicsSpec(options: CreateEngineOptions): ResolvedPhysicsSpec {
  if (options.physicsBackend !== undefined && options.physicsBackend !== "legacy" && options.physicsBackend !== "unified") {
    throw physicsSpecDiagnosticError("engine.physicsBackend", "must be legacy or unified");
  }
  const spec = resolvePhysicsSpec(undefined, { modeOverride: options.physicsMode });
  const clock = options.fixedTimestep;
  if (clock !== undefined) {
    if (typeof clock !== "boolean" && (typeof clock !== "object" || clock === null)) {
      throw physicsSpecDiagnosticError("engine.physics.clock", "must be a boolean or clock options");
    }
    spec.solver.fixedTimestep = typeof clock === "boolean" ? clock : clock.enabled ?? true;
    spec.solver.stepSeconds = typeof clock === "boolean" ? 1 / 60 : clock.stepSeconds ?? 1 / 60;
  } else if (options.physicsBackend !== "unified" && options.physicsMode === undefined) {
    // Raw creation keeps its variable clock; do not label it as fixed arcade.
    spec.solver.fixedTimestep = false;
  }
  if (usesDefaultNativePhysics(options)) {
    if (spec.mode === "none") {
      throw physicsSpecDiagnosticError("engine.physicsBackend", "unified defaults require arcade or rigid physics");
    }
    validateNativePhysicsSpec(spec, "engine.physics");
    resolveNativePhysicsClockOptions({ ...(typeof clock === "object" ? clock : undefined),
      enabled: spec.solver.fixedTimestep, stepSeconds: spec.solver.stepSeconds }, spec.solver.stepSeconds, "engine.physics.clock");
  }
  return spec;
}

export function configureInitialPhysics(
  native: Engine, spec: ResolvedPhysicsSpec, options: CreateEngineOptions,
): void {
  if (usesDefaultNativePhysics(options)) {
    if (typeof native.default_physics_policy_version !== "function" || native.default_physics_policy_version() !== 1
      || typeof native.configure_default_physics_world !== "function"
      || typeof native.default_physics_policy_scene !== "function") {
      throw physicsSpecDiagnosticError("engine.physicsBackend", "this Wasm core does not support default physics policy version 1");
    }
    requireNativePhysicsClock(native, "engine.physics.clock");
    requireDefaultPhysicsClock(native);
    const payload = encodeUnifiedPhysicsWorld({
      space: "planar-xy", lengthUnit: 1, gravity: [spec.gravityX, spec.gravityY, 0],
      stepSeconds: spec.solver.stepSeconds, velocityIterations: spec.solver.velocityIterations,
      positionIterations: spec.solver.positionIterations, continuous: spec.continuous, restitutionVelocityThreshold: 1,
    });
    native.configure_default_physics_world(payload.metadata, payload.values);
  } else {
    // Compatibility is requested, never an error fallback. New cores start with
    // native defaults; an older already-legacy core needs no destructive reset.
    const selection: Engine & Partial<LegacyPhysicsSelection> = native;
    const activeNative = typeof native.physics_spec_backend_active === "function" && native.physics_spec_backend_active();
    const activePolicy = typeof native.default_physics_policy_scene === "function" && native.default_physics_policy_scene() !== 0;
    if (activeNative || activePolicy) {
      if (typeof selection.configure_legacy_physics_defaults !== "function" || !selection.configure_legacy_physics_defaults()) {
        throw physicsSpecDiagnosticError("engine.physicsBackend", "legacy selection requires an untouched new Engine and the cold legacy selection capability");
      }
    }
  }
  applyPhysicsRuntimeOptions(native, spec, options, options.physicsMode !== undefined || usesDefaultNativePhysics(options));
}

/** Validate an authored override before setGameSpec changes scene or entities. */
export function validateDefaultPhysicsOverride(
  spec: ResolvedPhysicsSpec, defaults: ResolvedPhysicsSpec,
): void {
  if (spec.mode === "none") {
    throw physicsSpecDiagnosticError("game.physics", "unified defaults require arcade or rigid physics; select legacy at engine creation for none");
  }
  validateNativePhysicsSpec(spec, "game.physics");
  if (spec.solver.fixedTimestep !== defaults.solver.fixedTimestep
    || spec.continuous !== defaults.continuous
    || Math.fround(spec.gravityX) !== Math.fround(defaults.gravityX)
    || Math.fround(spec.gravityY) !== Math.fround(defaults.gravityY)
    || Math.fround(spec.solver.stepSeconds) !== Math.fround(defaults.solver.stepSeconds)
    || spec.solver.velocityIterations !== defaults.solver.velocityIterations
    || spec.solver.positionIterations !== defaults.solver.positionIterations) {
    throw physicsSpecDiagnosticError("game.physics", "must match the target native world; configure scene-specific native settings separately");
  }
}

export function resolveDefaultGamePhysics(
  input: unknown, defaults: ResolvedPhysicsSpec, options: CreateEngineOptions,
): ResolvedPhysicsSpec {
  const spec = input === undefined ? structuredClone(defaults) : resolvePhysicsSpec(input, { modeOverride: options.physicsMode });
  if (options.physicsBackend === "unified") {
    // The existing explicit policy remains a strict current-world contract.
    validateDefaultPhysicsOverride(spec, defaults);
  } else {
    if (spec.mode === "none") throw physicsSpecDiagnosticError("game.physics", "native defaults require arcade or rigid physics; select legacy explicitly for none");
    if (options.fixedTimestep !== undefined) {
      // Creation clock options take priority over authored values. Live controls
      // may have changed that clock since creation; use its current metadata.
      spec.solver.fixedTimestep = defaults.solver.fixedTimestep;
      spec.solver.stepSeconds = defaults.solver.stepSeconds;
    }
    validateNativePhysicsSpec(spec, "game.physics");
    resolveNativePhysicsClockOptions({ enabled: spec.solver.fixedTimestep, stepSeconds: spec.solver.stepSeconds }, spec.solver.stepSeconds, "game.physics.clock");
  }
  return spec;
}

/** After the Game Spec has reset its entities, install the validated authored
 * settings on the same native solver. Rust preserves automatic/manual ownership
 * and the saved next-scene world policy. No JS simulation or legacy fallback. */
export function configureDefaultGamePhysics(native: Engine, spec: ResolvedPhysicsSpec): void {
  configureNativePhysicsSpec(native, spec, {});
}

/** One numeric scene read before frame extraction also covers implicit authoring switches. */
export function synchronizeDefaultPhysicsMetadata(
  native: Pick<Engine, "default_physics_policy_scene"> & Partial<Pick<Engine, "fixed_timestep_enabled">>
    & { unified_physics_clock_step_seconds?: () => number }, host: PhysicsMetadata, defaults: ResolvedPhysicsSpec,
): void {
  const scene = native.default_physics_policy_scene();
  if (host.physicsSpecScene !== scene) {
    host.physicsSpec = structuredClone(defaults);
    if (typeof native.fixed_timestep_enabled === "function") host.physicsSpec.solver.fixedTimestep = native.fixed_timestep_enabled();
    if (typeof native.unified_physics_clock_step_seconds === "function") host.physicsSpec.solver.stepSeconds = native.unified_physics_clock_step_seconds();
    host.physicsSpecScene = scene;
  }
}
