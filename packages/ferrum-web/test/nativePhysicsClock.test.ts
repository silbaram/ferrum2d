import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import type { Engine } from "../pkg/ferrum_core.js";
import type { FerrumEngine, FixedTimestepOptions } from "../src/engineTypes.js";
import { applyFixedTimestepOptions } from "../src/physicsRuntimeControls.js";
import { configureNativePhysicsSpec } from "../src/physicsSpecNativeRuntime.js";
import { configureInitialPhysics, resolveInitialPhysicsSpec } from "../src/physicsDefaults.js";
import { resolvePhysicsSpec } from "../src/physicsSpec.js";
import { configureLegacyJsonPhysicsRuntime, registerLegacyJsonPhysicsRuntime } from "../src/physicsLegacyJsonRuntime.js";

function core(initial: { enabled?: boolean; maxFrame?: number; maxSteps?: number; residual?: number; pendingInput?: boolean } = {}) {
  const calls: { operation: string; args: unknown[] }[] = [];
  let enabled = initial.enabled ?? true, interpolation = true, nominal = Math.fround(0.01);
  let maxFrame = initial.maxFrame ?? 0.25, maxSteps = initial.maxSteps ?? 8;
  let residual = initial.residual ?? 0, pendingInput = initial.pendingInput ?? false;
  let accepted = true;
  return {
    calls,
    snapshot: () => ({ enabled, interpolation, nominal }),
    history: () => ({ residual, pendingInput, maxFrame, maxSteps }),
    rejectClock() { accepted = false; },
    physics_spec_backend_active: () => true,
    unified_physics_clock_version: () => 1,
    unified_physics_clock_step_seconds: () => nominal,
    unified_physics_clock_max_frame_seconds: () => maxFrame,
    unified_physics_clock_max_steps_per_update: () => maxSteps,
    fixed_timestep_enabled: () => enabled,
    configure_unified_physics_clock(...args: [boolean, number, number, number]) {
      calls.push({ operation: "checked", args });
      if (accepted) {
        enabled = args[0]; maxFrame = args[2]; maxSteps = args[3];
        residual = 0; pendingInput = false;
      }
      return accepted;
    },
    configure_fixed_timestep(...args: unknown[]) { calls.push({ operation: "legacy", args }); },
    configure_physics_render_interpolation(value: boolean) { calls.push({ operation: "interpolation", args: [value] }); interpolation = value; },
    physics_spec_backend_version: () => 1,
    set_auto_rigid_body_step_enabled(_enabled: boolean) {},
    query_physics_body_states_bulk(_handles: Uint32Array) { return true; },
    default_physics_policy_version: () => 1,
    default_physics_policy_scene: () => 1,
    default_physics_policy_fixed_timestep: () => enabled,
    configure_physics_spec_world(...args: [Uint32Array, Float32Array]) { calls.push({ operation: "world", args }); nominal = args[1][3]; },
    configure_default_physics_world(...args: [Uint32Array, Float32Array]) { calls.push({ operation: "default", args }); nominal = args[1][3]; },
    set_physics_debug_line_flags(_flags: number) {},
    set_physics_debug_lines_enabled(_enabled: boolean) {},
  };
}

test("native boolean and omitted-step clock changes keep the actual nominal interval", () => {
  const native = core(), engine = native as unknown as Engine;
  const first = applyFixedTimestepOptions(engine, false);
  deepEqual(first, { enabled: false, stepSeconds: Math.fround(0.01) });
  const second = applyFixedTimestepOptions(engine, { enabled: true, interpolate: true });
  deepEqual(second, { enabled: true, stepSeconds: Math.fround(0.01) });
  deepEqual(native.calls, [
    { operation: "checked", args: [false, Math.fround(0.01), 0.25, 8] },
    { operation: "interpolation", args: [false] },
    { operation: "checked", args: [true, Math.fround(0.01), 0.25, 8] },
    { operation: "interpolation", args: [true] },
  ]);
});

test("native checked rejection leaves clock/interpolation unchanged and never calls the legacy setter", () => {
  const native = core(), before = native.snapshot(); native.rejectClock();
  throws(() => applyFixedTimestepOptions(native as unknown as Engine, { enabled: false, interpolate: false }), /native clock configuration rejected/);
  deepEqual(native.snapshot(), before);
  deepEqual(native.calls.map(call => call.operation), ["checked"]);
});

test("missing or nonexact native clock capabilities reject before any clock or presentation mutation", () => {
  const variants: Array<(native: ReturnType<typeof core>) => void> = [
    ...[undefined, 0, 2, NaN].map(version => (native: ReturnType<typeof core>) => {
      Object.assign(native, { unified_physics_clock_version: version === undefined ? undefined : () => version });
    }),
    ...["configure_unified_physics_clock", "unified_physics_clock_step_seconds", "unified_physics_clock_max_frame_seconds", "unified_physics_clock_max_steps_per_update", "fixed_timestep_enabled"].map(name => (native: ReturnType<typeof core>) => {
      Object.assign(native, { [name]: undefined });
    }),
  ];
  for (const mutate of variants) {
    const native = core(), before = native.snapshot(); mutate(native);
    throws(() => applyFixedTimestepOptions(native as unknown as Engine, false), /native physics clock version 1/);
    deepEqual(native.snapshot(), before); deepEqual(native.calls, []);
  }
});

test("invalid native clock inputs reject before the checked setter or interpolation", () => {
  const invalid: unknown[] = [
    null, "false", { enabled: "false" }, { interpolate: 1 },
    ...[0, 0.00001, 0.02, 0.2, Infinity, NaN].map(stepSeconds => ({ enabled: false, stepSeconds })),
    ...[0, -1, 0.00001, 103, Infinity, Number.MAX_VALUE, NaN].map(maxFrameSeconds => ({ maxFrameSeconds })),
    ...[0, -1, 1.5, 1025, 0xffffffff, NaN].map(maxStepsPerUpdate => ({ maxStepsPerUpdate })),
  ];
  for (const input of invalid) {
    const native = core(), before = native.snapshot();
    throws(() => applyFixedTimestepOptions(native as unknown as Engine, input as FixedTimestepOptions), /Invalid physics spec/);
    deepEqual(native.calls, []); deepEqual(native.snapshot(), before);
  }
});

test("native clock admits finite f32 budget boundaries without changing the world nominal step", () => {
  const native = core();
  applyFixedTimestepOptions(native as unknown as Engine, { enabled: false, maxFrameSeconds: 102.4, maxStepsPerUpdate: 1024 });
  deepEqual(native.calls[0], { operation: "checked", args: [false, Math.fround(0.01), Math.fround(102.4), 1024] });
  applyFixedTimestepOptions(native as unknown as Engine, { enabled: false, maxFrameSeconds: 0.0001, maxStepsPerUpdate: 1 });
  deepEqual(native.calls[2], { operation: "checked", args: [false, Math.fround(0.01), Math.fround(0.0001), 1] });
});

test("native variable Physics Specs fail closed on old clock capability before world setup", () => {
  for (const mode of ["rigid", "arcade"] as const) for (const version of [undefined, 0, 2, NaN]) {
    const native = core();
    Object.assign(native, { unified_physics_clock_version: version === undefined ? undefined : () => version });
    const spec = resolvePhysicsSpec({ mode, solver: { fixedTimestep: false } });
    throws(() => configureNativePhysicsSpec(native as unknown as Engine, spec, {}), /native physics clock version 1/);
    deepEqual(native.calls, []);
  }
});

test("explicit unified variable creation checks clock capability before its default world is installed", () => {
  for (const version of [undefined, 0, 2, NaN]) {
    const native = core();
    Object.assign(native, { unified_physics_clock_version: version === undefined ? undefined : () => version });
    const options = { physicsBackend: "unified" as const, fixedTimestep: false };
    throws(() => configureInitialPhysics(native as unknown as Engine, resolveInitialPhysicsSpec(options), options), /native physics clock version 1/);
    deepEqual(native.calls, []);
  }
});

test("both native Physics Spec modes select variable time after admitting their complete world", () => {
  for (const mode of ["rigid", "arcade"] as const) {
    const native = core(), spec = resolvePhysicsSpec({ mode, solver: { fixedTimestep: false, stepSeconds: 0.01 } });
    configureNativePhysicsSpec(native as unknown as Engine, spec, {});
    deepEqual(native.calls.map(call => call.operation), ["world", "checked"]);
    deepEqual(native.snapshot(), { enabled: false, interpolation: true, nominal: Math.fround(0.01) });
    equal(spec.solver.fixedTimestep, false);
  }
});

test("identical fixed authored setup preserves native residual time and runtime limits without reapplying creation options", () => {
  const native = core({ maxFrame: Math.fround(0.08), maxSteps: 3, residual: Math.fround(0.005) });
  const spec = resolvePhysicsSpec({ mode: "rigid", solver: { stepSeconds: 0.01 } });
  const before = native.history(), presentation = native.snapshot();
  for (let group = 0; group < 2; group++) {
    configureNativePhysicsSpec(native as unknown as Engine, spec, { fixedTimestep: {
      enabled: true, stepSeconds: 0.01, maxFrameSeconds: 0.2, maxStepsPerUpdate: 10, interpolate: false,
    } });
  }
  deepEqual(native.history(), before); deepEqual(native.snapshot(), presentation);
  deepEqual(native.calls.map(call => call.operation), ["world", "world"]);
});

test("identical variable authored setup preserves pending input and presentation along with native limits", () => {
  const native = core({ enabled: false, maxFrame: Math.fround(0.08), maxSteps: 3, pendingInput: true });
  const spec = resolvePhysicsSpec({ mode: "arcade", solver: { fixedTimestep: false, stepSeconds: 0.01 } });
  const before = native.history(), presentation = native.snapshot();
  configureNativePhysicsSpec(native as unknown as Engine, spec, {});
  deepEqual(native.history(), before); deepEqual(native.snapshot(), presentation);
  deepEqual(native.calls.map(call => call.operation), ["world"]);
});

test("an actual authored clock-mode change preserves current native frame limits and render interpolation", () => {
  const native = core({ maxFrame: Math.fround(0.08), maxSteps: 3, residual: Math.fround(0.005), pendingInput: true });
  const spec = resolvePhysicsSpec({ mode: "arcade", solver: { fixedTimestep: false, stepSeconds: 0.01 } });
  configureNativePhysicsSpec(native as unknown as Engine, spec, {});
  deepEqual(native.calls.map(call => call.operation), ["world", "checked"]);
  deepEqual(native.calls[1].args, [false, Math.fround(0.01), Math.fround(0.08), 3]);
  deepEqual(native.history(), { residual: 0, pendingInput: false, maxFrame: Math.fround(0.08), maxSteps: 3 });
  deepEqual(native.snapshot(), { enabled: false, interpolation: true, nominal: Math.fround(0.01) });
});

test("native clock preflight validates budgets before mutating a Physics Spec world", () => {
  for (const limits of [{ maxFrameSeconds: Infinity }, { maxFrameSeconds: 103 }, { maxStepsPerUpdate: 1025 }]) {
    const native = core(), spec = resolvePhysicsSpec({ mode: "arcade", solver: { fixedTimestep: false } });
    throws(() => configureNativePhysicsSpec(native as unknown as Engine, spec, { fixedTimestep: { enabled: false, ...limits } }), /physics.clock/);
    deepEqual(native.calls, []);
  }
});

test("legacy JSON post-restore setup calls its private metadata callback without selecting native physics", () => {
  const spec = resolvePhysicsSpec({ mode: "arcade", solver: { fixedTimestep: false } });
  let accepted = 0;
  const engine = { physicsBackend: () => "legacy", configurePhysicsRuntime() { throw new Error("must not select native"); } } as unknown as FerrumEngine;
  registerLegacyJsonPhysicsRuntime(engine, value => { equal(value, spec); accepted++; });
  configureLegacyJsonPhysicsRuntime(engine, spec);
  equal(accepted, 1);
  for (const backend of [undefined, "unified-3d"] as const) {
    Object.assign(engine, { physicsBackend: backend === undefined ? undefined : () => backend });
    throws(() => configureLegacyJsonPhysicsRuntime(engine, spec), /legacy JSON setup requires a legacy backend/);
    equal(accepted, 1);
  }
});
