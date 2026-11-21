import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { copyUnifiedPhysicsDiagnostics, queryUnifiedPhysicsDiagnostics } from "../src/unifiedPhysicsObservations.js";
import { requireNativeDebugGeometry } from "../src/physicsDebugCompatibility.js";
import { configureNativePhysicsSpec } from "../src/physicsSpecNativeRuntime.js";
import { applyPhysicsDebugLineOptions } from "../src/physicsRuntimeControls.js";
import { resolvePhysicsSpec } from "../src/physicsSpec.js";
import type { Engine } from "../pkg/ferrum_core.js";

function setup() {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const state = [12, 37, 1, 0];
  const native = {
    unified_physics_observations_version: () => 1,
    unified_physics_observation_stride_words: (kind: number) => [27, 7, 32, 28, 71][kind],
    unified_physics_observation_count: (kind: number) => kind === 4 ? 1 : 0,
    unified_physics_observation_ptr: (_kind: number) => 1024,
    unified_physics_contacts_truncated: () => false,
    unified_physics_contacts_total_manifolds: () => 0,
    unified_physics_contacts_total_points: () => 0,
    query_unified_physics_contacts: () => {},
    query_unified_physics_observations: () => {},
    query_unified_physics_diagnostics: () => {
      new Uint32Array(memory.buffer, 1024, 71).set([1, 1]);
      new Uint32Array(memory.buffer, 4096, 4).set(state);
      return true;
    },
    unified_physics_debug_version: () => 1,
    unified_physics_debug_state_ptr: () => 4096,
  };
  return { memory, native, state };
}

test("native debug statistics decode routes and own numbers across memory growth", () => {
  const { memory, native, state } = setup();
  const xy = queryUnifiedPhysicsDiagnostics(native, memory)!.debug!;
  deepEqual(xy, { lineCount: 12, workUnits: 37, truncated: false, rejected: false, unsupportedShapes: 0, projection: "xy" });
  state[2] = 9; equal(queryUnifiedPhysicsDiagnostics(native, memory)!.debug!.projection, "xyz");
  state[2] = 17; equal(queryUnifiedPhysicsDiagnostics(native, memory)!.debug!.projection, "xz");
  state.splice(0, 4, 0, 0, 15, 0);
  const rejected = queryUnifiedPhysicsDiagnostics(native, memory)!.debug!;
  equal(rejected.truncated, true); equal(rejected.rejected, true);
  memory.grow(1); new Uint32Array(memory.buffer, 4096, 4).fill(0);
  equal(xy.lineCount, 12); equal(xy.workUnits, 37);
  state.fill(0); equal(queryUnifiedPhysicsDiagnostics(native, memory)!.debug, undefined);
});

test("native debug statistics reject partial capability invalid pointers flags and bounds", () => {
  const { memory, native, state } = setup();
  native.unified_physics_debug_version = () => 2;
  throws(() => queryUnifiedPhysicsDiagnostics(native, memory), /version/);
  native.unified_physics_debug_version = () => 1;
  native.unified_physics_debug_state_ptr = () => 4097;
  throws(() => queryUnifiedPhysicsDiagnostics(native, memory), /buffer/);
  native.unified_physics_debug_state_ptr = () => memory.buffer.byteLength - 8;
  throws(() => queryUnifiedPhysicsDiagnostics(native, memory), /buffer/);
  native.unified_physics_debug_state_ptr = () => 4096;
  for (const invalid of [[1, 1, 25, 0], [16_385, 30, 1, 0], [1, 65_537, 1, 0], [1, 2, 1, 3], [1, 2, 5, 0], [1, 2, 0, 0]]) {
    state.splice(0, 4, ...invalid);
    throws(() => queryUnifiedPhysicsDiagnostics(native, memory), /debug statistics/);
  }
  const { unified_physics_debug_state_ptr: _ptr, ...partial } = native;
  state.fill(0); throws(() => queryUnifiedPhysicsDiagnostics(partial, memory), /version/);
});

test("profiler diagnostics preserve validate and freeze optional native debug evidence", () => {
  const { memory, native } = setup();
  const source = queryUnifiedPhysicsDiagnostics(native, memory)!;
  const owned = copyUnifiedPhysicsDiagnostics(source);
  deepEqual(owned.debug, source.debug); equal(Object.isFrozen(owned.debug), true);
  Object.assign(source.debug!, { lineCount: 99 }); equal(owned.debug!.lineCount, 12);
  throws(() => copyUnifiedPhysicsDiagnostics({ ...source, debug: { ...source.debug!, workUnits: 65_537 } }), /native debug work/);
  throws(() => copyUnifiedPhysicsDiagnostics({ ...source, debug: { ...source.debug!, rejected: true, truncated: false } }), /debug statistics/);
});

test("older native cores refuse requested debug while legacy and debug-off execution remain allowed", () => {
  requireNativeDebugGeometry({}, true);
  requireNativeDebugGeometry({ physics_spec_backend_active: () => true }, false);
  throws(() => requireNativeDebugGeometry({ physics_spec_backend_active: () => true }, true), /debug geometry version 1/);
  requireNativeDebugGeometry({ physics_spec_backend_active: () => true,
    unified_physics_debug_version: () => 1, unified_physics_debug_state_ptr: () => 4096 }, true);
  throws(() => requireNativeDebugGeometry({ physics_spec_backend_active: () => true,
    unified_physics_debug_version: () => 2, unified_physics_debug_state_ptr: () => 4096 }, true), /debug geometry version 1/);
});

test("passive debug reapplication does not throw after an older core accepts native configuration", () => {
  let backend = false, enabled = false, flags = 0;
  const old = {
    physics_spec_backend_version: () => 1,
    physics_spec_backend_active: () => backend,
    set_auto_rigid_body_step_enabled(_enabled: boolean) {},
    query_physics_body_states_bulk(_handles: Uint32Array) { return true; },
    configure_physics_spec_world() { backend = true; },
    set_physics_debug_line_flags(value: number) { flags = value; },
    set_physics_debug_lines_enabled(value: boolean) { enabled = value; },
  };
  const spec = resolvePhysicsSpec({ mode: "rigid" });
  applyPhysicsDebugLineOptions(old as unknown as Engine, { includePhysicsDebugLines: true });
  configureNativePhysicsSpec(old as unknown as Engine, spec, {});
  applyPhysicsDebugLineOptions(old as unknown as Engine, { includePhysicsDebugLines: true }, spec);
  equal(backend, true); equal(enabled, true); equal(flags, 3);
  // A direct debug request or output consumption is the capability boundary,
  // rather than a late exception from the successful world setup itself.
  throws(() => requireNativeDebugGeometry(old, true), /debug geometry version 1/);
});
