import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import type { Engine } from "../pkg/ferrum_core.js";
import { resolvePhysicsSpec } from "../src/physicsSpec.js";
import { configureNativePhysicsSpec, nativePhysicsSpecPayload, usesNativePhysicsSpec, validateNativePhysicsSpec, validatePhysicsSpecModeTransition } from "../src/physicsSpecNativeRuntime.js";
import { applyFixedTimestepOptions } from "../src/physicsRuntimeControls.js";

function native() {
  const calls: { metadata: number[]; values: number[] }[] = [];
  let enabled = true, step = 1 / 60;
  const clocks: unknown[][] = [];
  return {
    calls, clocks,
    unified_physics_clock_version: () => 1,
    unified_physics_clock_step_seconds: () => step,
    unified_physics_clock_max_frame_seconds: () => 0.25,
    unified_physics_clock_max_steps_per_update: () => 8,
    fixed_timestep_enabled: () => enabled,
    configure_unified_physics_clock(...args: [boolean, number, number, number]) { clocks.push(args); enabled = args[0]; return true; },
    configure_physics_render_interpolation(_enabled: boolean) {},
    physics_spec_backend_version: () => 1,
    physics_spec_backend_active: () => false,
    set_auto_rigid_body_step_enabled(_enabled: boolean) {},
    query_physics_body_states_bulk(_handles: Uint32Array) { return true; },
    configure_physics_spec_world(metadata: Uint32Array, values: Float32Array) {
      step = values[3]; calls.push({ metadata: [...metadata], values: [...values] });
    },
  };
}
const spec = () => resolvePhysicsSpec({ mode: "rigid", gravity: [2, 30], solver: { stepSeconds: 0.01 } });

test("rigid Physics Spec selects planar single3D setup with admitted solver and gravity", () => {
  const core=native();
  configureNativePhysicsSpec(core as unknown as Engine,spec(),{});
  equal(core.calls.length,1);
  deepEqual(core.calls[0].metadata,[0,8,8,1,8192,16384,4096,128,16384]);
  deepEqual(core.calls[0].values,[2,30,0,Math.fround(0.01),1,1]);
});
test("rigid Physics Spec selects the native variable clock after whole-world admission", () => {
  const core=native(); const input=spec(); input.solver.fixedTimestep=false;
  configureNativePhysicsSpec(core as unknown as Engine,input,{});
  equal(core.calls.length,1); deepEqual(core.clocks, [[false, Math.fround(0.01), 0.25, 8]]);
});

test("prior native backend v1 keeps fixed setup while variable clocks still reject before mutation", () => {
  for (const mode of ["rigid", "arcade"] as const) {
    const core = native();
    for (const method of ["unified_physics_clock_version", "unified_physics_clock_step_seconds",
      "unified_physics_clock_max_frame_seconds", "unified_physics_clock_max_steps_per_update",
      "configure_unified_physics_clock"]) Reflect.deleteProperty(core, method);
    const engine = core as unknown as Engine;
    const fixed = resolvePhysicsSpec({ mode, solver: { stepSeconds: 0.01 } });
    configureNativePhysicsSpec(engine, fixed, {});
    equal(core.calls.length, 1); deepEqual(core.clocks, []);
    core.physics_spec_backend_active = () => true;
    const variable = { ...fixed, solver: { ...fixed.solver, fixedTimestep: false } };
    throws(() => configureNativePhysicsSpec(engine, variable, {}), /native physics clock version 1/);
    throws(() => applyFixedTimestepOptions(engine, false), /native physics clock version 1/);
    equal(core.calls.length, 1); deepEqual(core.clocks, []);
  }
});
test("rigid Physics Spec rejects old and wrong-version Wasm capabilities", () => {
  throws(()=>configureNativePhysicsSpec({} as Engine,spec(),{}),/backend version 1/);
  const core=native();core.physics_spec_backend_version=()=>2;
  throws(()=>configureNativePhysicsSpec(core as unknown as Engine,spec(),{}),/backend version 1/);
  equal(core.calls.length,0);
  for (const missing of ["set_auto_rigid_body_step_enabled", "query_physics_body_states_bulk"] as const) {
    const partial = { ...native(), [missing]: undefined };
    throws(() => configureNativePhysicsSpec(partial as unknown as Engine, spec(), {}), /backend version 1/);
    equal(partial.calls.length, 0);
  }
});
test("rigid Physics Spec rejects conflicting fixed clock override before native mutation", () => {
  const core=native();
  for(const fixedTimestep of [false,true,{enabled:true,stepSeconds:0.02}]) {
    throws(()=>configureNativePhysicsSpec(core as unknown as Engine,spec(),{fixedTimestep}),/timestep override/);
  }
  equal(core.calls.length,0);
  configureNativePhysicsSpec(core as unknown as Engine,spec(),{fixedTimestep:{stepSeconds:0.01,maxFrameSeconds:0.1,maxStepsPerUpdate:4}});
  equal(core.calls.length,1);
});
test("native Physics Spec rejection propagates without a legacy fallback", () => {
  const core=native();core.configure_physics_spec_world=()=>{throw new Error("native authoring rejection");};
  throws(()=>configureNativePhysicsSpec(core as unknown as Engine,spec(),{}),/native authoring rejection/);
});
test("variable arcade preflight is native while none remains outside native setup", () => {
  for(const mode of ["arcade","none"] as const) validateNativePhysicsSpec(resolvePhysicsSpec({mode,solver:{fixedTimestep:false}}));
});

test("native Physics Spec mode transition allows native targets and rejects legacy downgrade", () => {
  const core=native();core.physics_spec_backend_active=()=>true;
  for(const target of [resolvePhysicsSpec({mode:"none"})]) {
    throws(()=>validatePhysicsSpecModeTransition(core as unknown as Engine,target),/leave the native physics scene/);
  }
  for(const mode of ["arcade","rigid"] as const) validatePhysicsSpecModeTransition(core as unknown as Engine,resolvePhysicsSpec({mode}));
  core.physics_spec_backend_active=()=>false;
  validatePhysicsSpecModeTransition(core as unknown as Engine,resolvePhysicsSpec({mode:"arcade"}));
  equal(core.calls.length,0);
});

test("fixed arcade and an omitted Physics Spec mode select native without changing authored defaults", () => {
  for (const input of [{ mode: "arcade" as const }, {}]) {
    const core = native(), resolved = resolvePhysicsSpec(input);
    const before = structuredClone(resolved);
    equal(usesNativePhysicsSpec(resolved), true);
    configureNativePhysicsSpec(core as unknown as Engine, resolved, {});
    deepEqual(core.calls, [{ metadata: [0,1,1,0,8192,16384,4096,128,16384], values: [0,0,0,Math.fround(1/60),1,1] }]);
    deepEqual(resolved, before);
    equal(resolved.mode, "arcade"); equal(resolved.solver.sleep, false);
  }
});

test("none cannot be passed to the native setup helper", () => {
  const core = native();
  for (const input of [{ mode: "none" as const }]) {
    const resolved = resolvePhysicsSpec(input);
    equal(usesNativePhysicsSpec(resolved), false);
    validateNativePhysicsSpec(resolved);
    throws(() => nativePhysicsSpecPayload(core as unknown as Engine, resolved, {}), /requires rigid or arcade mode/);
  }
  equal(core.calls.length, 0);
});

test("fixed arcade rejects old Wasm and conflicting clock options before setup", () => {
  const resolved = resolvePhysicsSpec({ mode: "arcade", solver: { stepSeconds: 0.01 } });
  throws(() => configureNativePhysicsSpec({} as Engine, resolved, {}), /backend version 1/);
  const core = native();
  for (const fixedTimestep of [false, true, { enabled: true, stepSeconds: 0.02 }]) {
    throws(() => configureNativePhysicsSpec(core as unknown as Engine, resolved, { fixedTimestep }), /timestep override/);
  }
  equal(core.calls.length, 0);
  configureNativePhysicsSpec(core as unknown as Engine, resolved, { fixedTimestep: { stepSeconds: 0.01, maxFrameSeconds: 0.1 } });
  equal(core.calls.length, 1);
});

test("fixed arcade native rejection propagates without falling back or changing the mode", () => {
  const core = native(), resolved = resolvePhysicsSpec({ mode: "arcade" });
  core.configure_physics_spec_world = () => { throw new Error("arcade native rejection"); };
  throws(() => configureNativePhysicsSpec(core as unknown as Engine, resolved, {}), /arcade native rejection/);
  equal(resolved.mode, "arcade"); equal(core.calls.length, 0);
});

test("native Physics Spec rejects Rust solver, clock and gravity admission failures before setup", () => {
  for (const mode of ["arcade", "rigid"] as const) {
    const core = native();
    const invalid = [
      { solver: { velocityIterations: 0 } }, { solver: { velocityIterations: 33 } },
      { solver: { positionIterations: 0 } }, { solver: { positionIterations: 64 } },
      { solver: { stepSeconds: 0.00001 } }, { solver: { stepSeconds: 0.2 } },
      { gravity: [1_000_001, 0] as const }, { gravity: [0, -1_000_001] as const },
    ];
    for (const input of invalid) {
      const resolved = resolvePhysicsSpec({ ...input, mode });
      throws(() => configureNativePhysicsSpec(core as unknown as Engine, resolved, {}), /native solver iterations|finite f32/);
    }
    const resolved = resolvePhysicsSpec({ mode });
    resolved.solver.velocityIterations = 1.5;
    throws(() => configureNativePhysicsSpec(core as unknown as Engine, resolved, {}), /native solver iterations/);
    resolved.solver.velocityIterations = 1;
    for (const gravity of [NaN, Infinity, -Infinity, "1", null, Symbol("invalid gravity")]) {
      resolved.gravityY = gravity as never;
      throws(() => configureNativePhysicsSpec(core as unknown as Engine, resolved, {}), /finite f32/);
    }
    equal(core.calls.length, 0);
  }
});

test("native Physics Spec admits the Rust f32 and iteration boundary values", () => {
  for (const mode of ["arcade", "rigid"] as const) {
    const core = native();
    for (const iterations of [1, 32]) for (const stepSeconds of [0.0001, 0.1]) {
      const resolved = resolvePhysicsSpec({ mode, gravity: [1e6, -1e6], solver: {
        velocityIterations: iterations, positionIterations: iterations, stepSeconds,
      } });
      configureNativePhysicsSpec(core as unknown as Engine, resolved, {});
      const payload = core.calls[core.calls.length - 1];
      equal(payload.metadata[1], iterations); equal(payload.metadata[2], iterations);
      deepEqual(payload.values.slice(0, 4), [1e6, -1e6, 0, Math.fround(stepSeconds)]);
    }
    // Native receives the rounded f32, so values rounding onto a boundary remain legal.
    configureNativePhysicsSpec(core as unknown as Engine, resolvePhysicsSpec({ mode, gravity: [1e6 + 0.01, 0], solver: { stepSeconds: 0.1000000001 } }), {});
    equal(core.calls.length, 5);
  }
});

test("native range preflight leaves only none outside native numeric limits", () => {
  for (const mode of ["none"] as const) {
    const resolved = resolvePhysicsSpec({ mode, gravity: [1e9, -1e9], solver: {
      fixedTimestep: false, velocityIterations: 0, positionIterations: 64, stepSeconds: 0.2,
    } });
    equal(usesNativePhysicsSpec(resolved), false);
    validateNativePhysicsSpec(resolved);
  }
});

test("native clock selection rejects non-boolean flags in both native modes", () => {
  const arcade = resolvePhysicsSpec({ mode: "arcade" }), rigid = resolvePhysicsSpec({ mode: "rigid" });
  for (const value of [undefined, 1, "true"] as const) {
    arcade.solver.fixedTimestep = value as never;
    equal(usesNativePhysicsSpec(arcade), true);
    throws(() => validateNativePhysicsSpec(arcade), /must be a boolean/);
    rigid.solver.fixedTimestep = value as never;
    throws(() => validateNativePhysicsSpec(rigid), /must be a boolean/);
  }
});

test("successful variable-to-fixed runtime clock control supersedes a stale creation mode for the same nominal Spec", () => {
  const core = native(), engine = core as unknown as Engine;
  const options = { fixedTimestep: { enabled: false, stepSeconds: 0.01 } };
  const variable = spec(); variable.solver.fixedTimestep = false;
  configureNativePhysicsSpec(engine, variable, options);
  core.physics_spec_backend_active = () => true;
  equal(applyFixedTimestepOptions(engine, true)?.enabled, true);
  const clockCalls = core.clocks.length;
  configureNativePhysicsSpec(engine, spec(), options);
  equal(core.calls.length, 2); equal(core.clocks.length, clockCalls);
  equal(core.fixed_timestep_enabled(), true);
});

test("successful fixed-to-variable runtime clock control supersedes a stale creation mode for the same nominal Spec", () => {
  const core = native(), engine = core as unknown as Engine;
  const options = { fixedTimestep: { enabled: true, stepSeconds: 0.01 } };
  configureNativePhysicsSpec(engine, spec(), options);
  core.physics_spec_backend_active = () => true;
  equal(applyFixedTimestepOptions(engine, false)?.enabled, false);
  const clockCalls = core.clocks.length;
  const variable = spec(); variable.solver.fixedTimestep = false;
  configureNativePhysicsSpec(engine, variable, options);
  equal(core.calls.length, 2); equal(core.clocks.length, clockCalls);
  equal(core.fixed_timestep_enabled(), false);
});

test("an explicit creation clock constraint still rejects an authored mode unlike the current native mode", () => {
  for (const enabled of [false, true]) {
    const core = native(), engine = core as unknown as Engine;
    const options = { fixedTimestep: { enabled, stepSeconds: 0.01 } };
    const initial = spec(); initial.solver.fixedTimestep = enabled;
    configureNativePhysicsSpec(engine, initial, options);
    core.physics_spec_backend_active = () => true;
    const conflicting = spec(); conflicting.solver.fixedTimestep = !enabled;
    const beforeWorlds = core.calls.length, beforeClocks = core.clocks.length;
    throws(() => configureNativePhysicsSpec(engine, conflicting, options), /must match the active native clock/);
    equal(core.calls.length, beforeWorlds); equal(core.clocks.length, beforeClocks);
    equal(core.fixed_timestep_enabled(), enabled);
  }
});

test("a runtime mode change does not relax an explicit nominal override or read the live mode before a nominal rejection", () => {
  const core = native(), engine = core as unknown as Engine;
  const options = { fixedTimestep: { enabled: false, stepSeconds: 0.01 } };
  const initial = spec(); initial.solver.fixedTimestep = false;
  configureNativePhysicsSpec(engine, initial, options);
  core.physics_spec_backend_active = () => true;
  applyFixedTimestepOptions(engine, true);
  const current = core.fixed_timestep_enabled;
  let modeReads = 0;
  core.fixed_timestep_enabled = () => { modeReads++; return current(); };
  const changed = spec(); changed.solver.stepSeconds = 0.02;
  const beforeWorlds = core.calls.length, beforeClocks = core.clocks.length;
  throws(() => configureNativePhysicsSpec(engine, changed, options), /timestep override/);
  equal(modeReads, 0); equal(core.calls.length, beforeWorlds); equal(core.clocks.length, beforeClocks);
});

test("active-clock preflight validates backend and clock capabilities before reading current mode or mutating a world", () => {
  for (const version of [undefined, 0, 2, NaN]) {
    const core = native(), engine = core as unknown as Engine;
    core.physics_spec_backend_active = () => true;
    Object.assign(core, { unified_physics_clock_version: version === undefined ? undefined : () => version });
    let modeReads = 0;
    core.fixed_timestep_enabled = () => { modeReads++; return true; };
    throws(() => configureNativePhysicsSpec(engine, spec(), { fixedTimestep: { enabled: false, stepSeconds: 0.01 } }), /native physics clock version 1/);
    equal(modeReads, 0); deepEqual(core.calls, []); deepEqual(core.clocks, []);
  }
  const core = native(); core.physics_spec_backend_active = () => true;
  core.physics_spec_backend_version = () => 2; core.unified_physics_clock_version = () => 0;
  throws(() => configureNativePhysicsSpec(core as unknown as Engine, spec(), { fixedTimestep: { enabled: false, stepSeconds: 0.01 } }), /backend version 1/);
  deepEqual(core.calls, []); deepEqual(core.clocks, []);
});

test("an active native mode does not hide a malformed creation override", () => {
  const core = native(); core.physics_spec_backend_active = () => true;
  throws(() => configureNativePhysicsSpec(core as unknown as Engine, spec(), {
    fixedTimestep: { enabled: "yes" as never, stepSeconds: 0.01 },
  }), /engine clock override must select a boolean mode/);
  deepEqual(core.calls, []); deepEqual(core.clocks, []);
});
