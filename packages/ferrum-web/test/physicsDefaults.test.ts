import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import type { Engine } from "../pkg/ferrum_core.js";
import type { CreateEngineOptions } from "../src/engineTypes.js";
import { configureInitialPhysics, configureDefaultGamePhysics, usesDefaultNativePhysics, resolveDefaultGamePhysics, resolveDefaultPhysicsPolicySpec, resolveInitialPhysicsSpec, synchronizeDefaultPhysicsMetadata, validateDefaultPhysicsOverride } from "../src/physicsDefaults.js";
import { resolvePhysicsSpec } from "../src/physicsSpec.js";

function core(initialNative = false) {
  const worlds: { metadata: number[]; values: number[] }[] = [];
  const clocks: unknown[][] = [];
  const sceneWorlds: { metadata: number[]; values: number[] }[] = [];
  let active = initialNative, enabled = true, step = 1 / 60;
  return {
    worlds, clocks, sceneWorlds,
    physics_spec_backend_active: () => active,
    unified_physics_clock_version: () => 1,
    unified_physics_clock_step_seconds: () => step,
    unified_physics_clock_max_frame_seconds: () => 0.25,
    unified_physics_clock_max_steps_per_update: () => 8,
    fixed_timestep_enabled: () => enabled,
    configure_unified_physics_clock(...args: [boolean, number, number, number]) { clocks.push(args); enabled = args[0]; return true; },
    default_physics_policy_version: () => 1,
    default_physics_policy_scene: () => active ? 1 : 0,
    default_physics_policy_fixed_timestep: () => enabled,
    configure_legacy_physics_defaults() { active = false; enabled = false; return true; },
    physics_spec_backend_version: () => 1,
    query_physics_body_states_bulk: () => true,
    set_auto_rigid_body_step_enabled(_enabled: boolean) {},
    configure_physics_spec_world(metadata: Uint32Array, values: Float32Array) { active = true; step = values[3]; enabled = true; sceneWorlds.push({metadata:[...metadata],values:[...values]}); },
    configure_default_physics_world(metadata: Uint32Array, values: Float32Array) { active = true; step = values[3]; worlds.push({ metadata: [...metadata], values: [...values] }); },
    configure_fixed_timestep(...args: unknown[]) { clocks.push(args); },
    configure_physics_render_interpolation(_enabled: boolean) {},
    set_physics_debug_line_flags(_flags: number) {},
    set_physics_debug_lines_enabled(_enabled: boolean) {},
  };
}

test("omitted creation selects native automatic policy while retaining its variable clock", () => {
  const options = {}, native = core(), spec = resolveInitialPhysicsSpec(options);
  equal(usesDefaultNativePhysics(options),true); equal(spec.mode,"arcade"); equal(spec.solver.fixedTimestep,false);
  configureInitialPhysics(native as unknown as Engine,spec,options);
  deepEqual(native.worlds,[{metadata:[0,1,1,0,8192,16384,4096,128,16384],values:[0,0,0,Math.fround(1/60),1,1]}]);
  deepEqual(native.clocks,[[false,Math.fround(1/60),Math.fround(.25),8]]);
});

test("explicit legacy cold selection supports fresh native and already-legacy cores without a fallback", () => {
  const options:CreateEngineOptions={physicsBackend:"legacy"};
  for(const initial of [false,true]) {
    const native=core(initial),spec=resolveInitialPhysicsSpec(options);
    configureInitialPhysics(native as unknown as Engine,spec,options);
    equal(native.physics_spec_backend_active(),false); equal(usesDefaultNativePhysics(options),false);
    deepEqual(native.worlds,[]);deepEqual(native.clocks,[]);
  }
  const oldLegacy = { ...core(), physics_spec_backend_active: undefined, default_physics_policy_scene: undefined };
  configureInitialPhysics(oldLegacy as unknown as Engine,resolveInitialPhysicsSpec(options),options);
  deepEqual(oldLegacy.worlds,[]);deepEqual(oldLegacy.clocks,[]);
  const native=core(true);
  native.configure_legacy_physics_defaults=()=>false;
  throws(()=>configureInitialPhysics(native as unknown as Engine,resolveInitialPhysicsSpec(options),options),/untouched new Engine/);
  equal(native.physics_spec_backend_active(),true);deepEqual(native.worlds,[]);deepEqual(native.clocks,[]);
});

test("unified creation sends one native default world and preserves the explicit clock limits", () => {
  const native = core();
  const options: CreateEngineOptions = { physicsBackend: "unified", fixedTimestep: { stepSeconds: 0.01, maxFrameSeconds: 0.05, maxStepsPerUpdate: 3 } };
  const spec = resolveInitialPhysicsSpec(options);
  equal(spec.mode, "arcade"); equal(spec.solver.fixedTimestep, true); equal(spec.solver.stepSeconds, 0.01);
  configureInitialPhysics(native as unknown as Engine, spec, options);
  deepEqual(native.worlds, [{ metadata: [0, 1, 1, 0, 8192, 16384, 4096, 128, 16384], values: [0, 0, 0, Math.fround(0.01), 1, 1] }]);
  deepEqual(native.clocks, [[true, Math.fround(0.01), Math.fround(0.05), 3]]);
});

test("explicit legacy variable and fixed creation report the selected clock without native setup", () => {
  for (const enabled of [false, true]) {
    const native = core(), options: CreateEngineOptions = { physicsBackend: "legacy", fixedTimestep: { enabled, stepSeconds: 0.02 } };
    const spec = resolveInitialPhysicsSpec(options);
    equal(spec.solver.fixedTimestep, enabled); equal(spec.solver.stepSeconds, 0.02);
    configureInitialPhysics(native as unknown as Engine, spec, options);
    deepEqual(native.worlds, []); deepEqual(native.clocks, [[enabled, 0.02, 0.25, 8]]);
  }
});

test("unified rejects none, invalid clocks/backend and out-of-range native steps before setup", () => {
  for (const options of [
    { physicsBackend: "unified", physicsMode: "none" },
    { physicsBackend: "unified", fixedTimestep: { enabled: "yes" } },
    { physicsBackend: "unified", fixedTimestep: { stepSeconds: NaN } },
    { physicsBackend: "unified", fixedTimestep: { stepSeconds: 0.2 } },
    { physicsBackend: "unified", fixedTimestep: { maxFrameSeconds: Infinity } },
    { physicsBackend: "unified", fixedTimestep: { maxFrameSeconds: 0 } },
    { physicsBackend: "unified", fixedTimestep: { maxStepsPerUpdate: 0 } },
    { physicsBackend: "unified", fixedTimestep: { maxStepsPerUpdate: 1025 } },
    { physicsBackend: "typo" },
  ]) throws(() => resolveInitialPhysicsSpec(options as CreateEngineOptions), /engine\.(physicsBackend|physics)/);
});

test("unified creation fails closed on old or partial Wasm before configuring world or clock", () => {
  const options: CreateEngineOptions = { physicsBackend: "unified" }, spec = resolveInitialPhysicsSpec(options);
  for (const missing of ["default_physics_policy_version", "configure_default_physics_world", "default_physics_policy_scene"] as const) {
    const native = { ...core(), [missing]: undefined };
    throws(() => configureInitialPhysics(native as unknown as Engine, spec, options), /default physics policy version 1/);
    deepEqual(native.worlds, []); deepEqual(native.clocks, []);
  }
  const native = core(); native.default_physics_policy_version = () => 2;
  throws(() => configureInitialPhysics(native as unknown as Engine, spec, options), /default physics policy version 1/);
  deepEqual(native.worlds, []); deepEqual(native.clocks, []);
});

test("game overrides must preserve unified default timing and solver settings before scene mutation", () => {
  const defaults = resolveInitialPhysicsSpec({ physicsBackend: "unified", fixedTimestep: { stepSeconds: 0.01 } });
  validateDefaultPhysicsOverride(structuredClone(defaults), defaults);
  for (const input of [
    { mode: "none" }, { solver: { fixedTimestep: false } }, { mode: "rigid" },
    { solver: { stepSeconds: 0.02 } }, { gravity: [1, 0], solver: { stepSeconds: 0.01 } },
    { continuous: true, solver: { stepSeconds: 0.01 } },
    { solver: { stepSeconds: 0.01, velocityIterations: 2 } },
  ]) throws(() => validateDefaultPhysicsOverride(resolvePhysicsSpec(input), defaults), /game\.physics/);
});

test("returned Game Spec physics cannot mutate the private creation baseline", () => {
  const options: CreateEngineOptions = { physicsBackend: "unified", fixedTimestep: { stepSeconds: 0.01 } };
  const defaults = resolveInitialPhysicsSpec(options);
  const returned = resolveDefaultGamePhysics(undefined, defaults, options);
  returned.solver.stepSeconds = 0.02; returned.gravityX = 20;
  const next = resolveDefaultGamePhysics(undefined, defaults, options);
  equal(next.solver.stepSeconds, 0.01); equal(next.gravityX, 0);
  throws(() => validateDefaultPhysicsOverride(returned, defaults), /must match/);
});

test("same-Shooter omitted physics preserves a scene-local native setup and rejects mismatched authored timing", () => {
  const local = resolvePhysicsSpec({ mode: "rigid", gravity: [2, 30], solver: { stepSeconds: 0.02 } });
  const options: CreateEngineOptions = { physicsBackend: "unified", fixedTimestep: { stepSeconds: 0.01 } };
  const inherited = resolveDefaultGamePhysics(undefined, local, options);
  equal(inherited.solver.stepSeconds, 0.02); equal(inherited.gravityY, 30);
  throws(() => resolveDefaultGamePhysics({ mode: "rigid", gravity: [2, 30], solver: { stepSeconds: 0.01 } }, local, options), /target native world/);
});

test("implicit scene switches refresh diagnostic metadata while same-scene overrides remain owned", () => {
  const defaults = resolveInitialPhysicsSpec({ physicsBackend: "unified", fixedTimestep: { stepSeconds: 0.01 } });
  const host = { physicsSpec: resolvePhysicsSpec({ mode: "rigid", gravity: [2, 30] }), physicsSpecScene: 4 };
  let scene = 4;
  const native = { default_physics_policy_scene: () => scene };
  synchronizeDefaultPhysicsMetadata(native, host, defaults);
  equal(host.physicsSpec.gravityY, 30);
  scene = 1; synchronizeDefaultPhysicsMetadata(native, host, defaults);
  equal(host.physicsSpecScene, 1); equal(host.physicsSpec.mode, "arcade"); equal(host.physicsSpec.gravityY, 0);
  equal(host.physicsSpec.solver.stepSeconds, 0.01);
  host.physicsSpec.solver.stepSeconds = 0.02;
  scene = 3; synchronizeDefaultPhysicsMetadata(native, host, defaults);
  equal(host.physicsSpec.solver.stepSeconds, 0.01); equal(defaults.solver.stepSeconds, 0.01);
});

test("explicit unified variable creation uses one native world and its checked variable clock", () => {
  for (const fixedTimestep of [false, { enabled: false, stepSeconds: 0.01 }] satisfies NonNullable<CreateEngineOptions["fixedTimestep"]>[]) {
    const options: CreateEngineOptions = { physicsBackend: "unified", fixedTimestep }, native = core();
    const spec = resolveInitialPhysicsSpec(options);
    equal(spec.solver.fixedTimestep, false);
    configureInitialPhysics(native as unknown as Engine, spec, options);
    equal(native.worlds.length, 1);
    deepEqual(native.clocks, [[false, Math.fround(spec.solver.stepSeconds), 0.25, 8]]);
  }
});

test("future scene validation reads the stored clock independently of a scene-local native override", () => {
  const initial = resolveInitialPhysicsSpec({ physicsBackend: "unified", fixedTimestep: { stepSeconds: 0.01 } });
  let stored = false;
  const native = { ...core(), fixed_timestep_enabled: () => true, default_physics_policy_fixed_timestep: () => stored };
  const next = resolveDefaultPhysicsPolicySpec(native as unknown as Engine, initial);
  equal(next.solver.fixedTimestep, false); equal(next.solver.stepSeconds, 0.01);
  validateDefaultPhysicsOverride(next, next);
  equal(initial.solver.fixedTimestep, true);
  stored = true;
  equal(resolveDefaultPhysicsPolicySpec(native as unknown as Engine, initial).solver.fixedTimestep, true);
  const missing = { ...native, default_physics_policy_fixed_timestep: undefined };
  throws(() => configureInitialPhysics(missing as unknown as Engine, initial, { physicsBackend: "unified" }), /stored default physics clock/);
  deepEqual(native.worlds, []); deepEqual(native.clocks, []);
});

test("scene-switch diagnostic metadata reflects the restored native clock and f32 nominal step", () => {
  const initial = resolveInitialPhysicsSpec({ physicsBackend: "unified", fixedTimestep: { stepSeconds: 0.01 } });
  const host = { physicsSpec: structuredClone(initial), physicsSpecScene: 4 };
  const native = { default_physics_policy_scene: () => 1, fixed_timestep_enabled: () => false,
    unified_physics_clock_step_seconds: () => Math.fround(0.01) };
  synchronizeDefaultPhysicsMetadata(native, host, initial);
  equal(host.physicsSpecScene, 1); equal(host.physicsSpec.solver.fixedTimestep, false);
  equal(host.physicsSpec.solver.stepSeconds, Math.fround(0.01));
  equal(initial.solver.fixedTimestep, true);
});


test("implicit native Game Spec overrides configure actual solver settings and preserve explicit clock priority", () => {
  const baseline=resolveInitialPhysicsSpec({});
  const spec=resolveDefaultGamePhysics({mode:"rigid",gravity:[3,40],solver:{fixedTimestep:false,stepSeconds:.02,velocityIterations:4,positionIterations:3}},baseline,{});
  equal(spec.gravityX,3);equal(spec.gravityY,40);equal(spec.solver.stepSeconds,.02);equal(spec.solver.fixedTimestep,false);
  const native=core(true);configureDefaultGamePhysics(native as unknown as Engine,spec);
  deepEqual(native.sceneWorlds,[{metadata:[0,4,3,1,8192,16384,4096,128,16384],values:[3,40,0,Math.fround(.02),1,1]}]);
  deepEqual(native.clocks,[[false,Math.fround(.02),Math.fround(.25),8]]);
  equal(baseline.gravityY,0);equal(baseline.solver.fixedTimestep,false);
  const options:CreateEngineOptions={fixedTimestep:{enabled:false,stepSeconds:.01}},current=resolveInitialPhysicsSpec(options);
  const overridden=resolveDefaultGamePhysics({mode:"rigid",solver:{fixedTimestep:true,stepSeconds:.02}},current,options);
  equal(overridden.solver.fixedTimestep,false);equal(overridden.solver.stepSeconds,.01);
  for(const bad of [{mode:"none"},{solver:{velocityIterations:0}},{solver:{stepSeconds:Infinity}}])throws(()=>resolveDefaultGamePhysics(bad,baseline,{}));
});
