import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import type { Engine } from "../pkg/ferrum_core";
import {
  applyFixedTimestepOptions,
  applyPhysicsRuntimeOptions,
  configureAutoRigidBodyStepOptions,
  physicsDebugFlags,
  stepRigidBodiesWithStats,
} from "../src/physicsRuntimeControls.js";
import type { ResolvedPhysicsSpec } from "../src/physicsSpec.js";

interface FakeRuntimeEngine extends Engine {
  readonly fixedCalls: unknown[][];
  readonly debugFlagCalls: number[];
  readonly debugEnabledCalls: boolean[];
  readonly autoStepCalls: unknown[][];
  readonly stepCalls: number[];
  readonly stepConfigCalls: unknown[][];
}

test("applyFixedTimestepOptions preserves boolean and object defaults", () => {
  const engine = fakeRuntimeEngine();

  applyFixedTimestepOptions(engine, true);
  applyFixedTimestepOptions(engine, {
    stepSeconds: 0.02,
    maxStepsPerUpdate: 4,
  });

  deepEqual(engine.fixedCalls, [
    [true, 1 / 60, 0.25, 8],
    [true, 0.02, 0.25, 4],
  ]);
});

test("applyPhysicsRuntimeOptions applies spec fixed step and debug flags without public API changes", () => {
  const engine = fakeRuntimeEngine();

  applyPhysicsRuntimeOptions(engine, resolvedPhysicsSpec(), {
    includePhysicsDebugLines: true,
  }, true);

  deepEqual(engine.fixedCalls, [[true, 0.02, 0.25, 8]]);
  deepEqual(engine.debugFlagCalls, [3]);
  deepEqual(engine.debugEnabledCalls, [true]);
});

test("default metadata without explicit physics configuration does not enable a clock", () => {
  const engine = fakeRuntimeEngine();
  applyPhysicsRuntimeOptions(engine, resolvedPhysicsSpec(), {}, false);
  deepEqual(engine.fixedCalls, []);
  deepEqual(engine.autoStepCalls, []);
});

test("configureAutoRigidBodyStepOptions and stepRigidBodiesWithStats keep default solver values", () => {
  const engine = fakeRuntimeEngine();

  configureAutoRigidBodyStepOptions(engine, false);
  const stats = stepRigidBodiesWithStats(engine, 0.016, {
    gravityY: 100,
    contactSplitImpulse: true,
    continuous: false,
  });

  deepEqual(engine.autoStepCalls, [[false, 0, 980, 6, 3, 0.8, 0.01, 1, 0.2, 120, false, true]]);
  deepEqual(engine.stepConfigCalls, [[0.016, 0, 100, 6, 3, 0.8, 0.01, 1, 0.2, 120, true, false]]);
  equal(stats.substeps, 1);
  equal(stats.positionContactRebuilds, 24);
  equal(stats.brokenJoints, 29);
});

test("physicsDebugFlags preserves option priority and category bits", () => {
  equal(physicsDebugFlags(true), 3);
  equal(physicsDebugFlags(false, { sleeping: true }), 20);
  equal(physicsDebugFlags({ ccd: true, joints: true }), 40);
  equal(physicsDebugFlags(undefined, undefined, true), 3);
});

test("manual stepping prefers checked entries and propagates rejection before reading success stats", () => {
  for (const configured of [false, true]) {
    const engine = fakeRuntimeEngine() as FakeRuntimeEngine & {
      step_rigid_bodies_checked?: Engine["step_rigid_bodies"];
      step_rigid_bodies_with_config_checked?: Engine["step_rigid_bodies_with_config"];
    };
    let calls = 0, statsReads = 0;
    const failure = new Error("actual motion rejected");
    const checked = function (this: Engine, ...args: unknown[]) {
      equal(this, engine);
      calls++;
      equal(args[0], 0.01);
      equal(args.length, configured ? 12 : 1);
      if (calls > 1) throw failure;
    };
    if (configured) engine.step_rigid_bodies_with_config_checked = checked;
    else engine.step_rigid_bodies_checked = checked;
    engine.rigid_body_step_substeps = () => { statsReads++; return 1; };
    const options = configured ? { gravityY: 0 } : undefined;
    equal(stepRigidBodiesWithStats(engine, 0.01, options).substeps, 1);
    equal(statsReads, 1);
    throws(() => stepRigidBodiesWithStats(engine, 0.01, options), error => error === failure);
    equal(calls, 2);
    equal(statsReads, 1);
    deepEqual(engine.stepCalls, []);
    deepEqual(engine.stepConfigCalls, []);
  }
});

test("native boolean auto-step toggles retain configured settings instead of supplying legacy defaults", () => {
  const engine = fakeRuntimeEngine();
  const toggles: boolean[] = [];
  engine.physics_spec_backend_active = () => true;
  engine.set_auto_rigid_body_step_enabled = enabled => { toggles.push(enabled); };
  configureAutoRigidBodyStepOptions(engine, false);
  configureAutoRigidBodyStepOptions(engine, true);
  deepEqual(toggles, [false, true]);
  deepEqual(engine.autoStepCalls, []);
});

test("auto-step configuration reports accepted gravity and CCD unless the native world rejects it", () => {
  const engine = fakeRuntimeEngine();
  deepEqual(configureAutoRigidBodyStepOptions(engine, { gravityY: 300, continuous: false }), { gravityX: 0, gravityY: 300, continuous: false });
  deepEqual(configureAutoRigidBodyStepOptions(engine, true), { gravityX: 0, gravityY: 980, continuous: true });
  (engine as { configure_auto_rigid_body_step: (...args: unknown[]) => boolean }).configure_auto_rigid_body_step = () => false;
  equal(configureAutoRigidBodyStepOptions(engine, { gravityY: 300 }), undefined);
  engine.physics_spec_backend_active = () => true;
  engine.set_auto_rigid_body_step_enabled = () => {};
  equal(configureAutoRigidBodyStepOptions(engine, true), undefined);
});

function resolvedPhysicsSpec(): ResolvedPhysicsSpec {
  return {
    mode: "rigidBody",
    gravityX: 0,
    gravityY: 980,
    continuous: true,
    solver: {
      fixedTimestep: true,
      stepSeconds: 0.02,
    },
    debug: {
      contacts: true,
    },
  } as unknown as ResolvedPhysicsSpec;
}

function fakeRuntimeEngine(): FakeRuntimeEngine {
  const fixedCalls: unknown[][] = [];
  const debugFlagCalls: number[] = [];
  const debugEnabledCalls: boolean[] = [];
  const autoStepCalls: unknown[][] = [];
  const stepCalls: number[] = [];
  const stepConfigCalls: unknown[][] = [];
  const engine = {
    fixedCalls,
    debugFlagCalls,
    debugEnabledCalls,
    autoStepCalls,
    stepCalls,
    stepConfigCalls,
    configure_physics_render_interpolation(_enabled: boolean): void {},
    configure_fixed_timestep(...args: unknown[]): void {
      fixedCalls.push(args);
    },
    set_physics_debug_line_flags(flags: number): void {
      debugFlagCalls.push(flags);
    },
    set_physics_debug_lines_enabled(enabled: boolean): void {
      debugEnabledCalls.push(enabled);
    },
    configure_auto_rigid_body_step(...args: unknown[]): void {
      autoStepCalls.push(args);
    },
    step_rigid_bodies(deltaSeconds: number): void {
      stepCalls.push(deltaSeconds);
    },
    step_rigid_bodies_with_config(...args: unknown[]): void {
      stepConfigCalls.push(args);
    },
    rigid_body_step_substeps: () => 1,
    rigid_body_step_dynamic_bodies: () => 2,
    rigid_body_step_angular_bodies: () => 3,
    rigid_body_step_island_count: () => 4,
    rigid_body_step_island_bodies: () => 5,
    rigid_body_step_active_islands: () => 6,
    rigid_body_step_sleeping_islands: () => 7,
    rigid_body_step_largest_island_bodies: () => 8,
    rigid_body_step_contact_checks: () => 9,
    rigid_body_step_velocity_impulses: () => 10,
    rigid_body_step_contact_block_solves: () => 11,
    rigid_body_step_baumgarte_velocity_biases: () => 12,
    rigid_body_step_split_velocity_impulses: () => 13,
    rigid_body_step_restitution_velocity_threshold_skips: () => 14,
    rigid_body_step_warm_start_impulses: () => 15,
    rigid_body_step_contact_cache_entries: () => 16,
    rigid_body_step_sleeping_bodies: () => 17,
    rigid_body_step_bodies_put_to_sleep: () => 18,
    rigid_body_step_bodies_woken: () => 19,
    rigid_body_step_islands_woken: () => 20,
    rigid_body_step_islands_put_to_sleep: () => 21,
    rigid_body_step_ccd_checks: () => 22,
    rigid_body_step_ccd_hits: () => 23,
    rigid_body_step_position_contact_rebuilds: () => 24,
    rigid_body_step_position_corrections: () => 25,
    rigid_body_step_split_position_corrections: () => 26,
    rigid_body_step_constraint_velocity_corrections: () => 27,
    rigid_body_step_constraint_position_corrections: () => 28,
    rigid_body_step_broken_joints: () => 29,
  };
  return engine as unknown as FakeRuntimeEngine;
}
