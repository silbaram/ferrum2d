import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import type { Engine } from "../pkg/ferrum_core.js";
import { createSpatialApi } from "../src/dataSceneSpatial.js";
import { compileSpatialEnvironment, decodeSpatialEnvironment, resolveSpatialEnvironmentSpec, validSpatialEnvironmentValues } from "../src/spatialEnvironment.js";
import { readSpatialLightSelection, supportsSpatialLightSelection, validateSpatialLightSelectionBuffer, type SpatialLightSelectionBufferView } from "../src/spatialLightSelection.js";
import { decodeSpatialLightSelectionProgress, resolveSpatialLightSelectionProgress, spatialLightSelectionProgressValues } from "../src/spatialLightSelectionProgress.js";
import { applySceneSpatialPatch, sceneSpatialPatchVersion } from "../src/sceneSpatialPatch.js";
import type { SpatialLightSelectionSpec } from "../src/core.js";
import type { SpatialLightSelectionBufferView as AuthoringSelectionView } from "../src/authoring.js";

const lights = [
  { position: { x: -20, y: 0, elevation: 64 }, radius: 100, lightMask: 1, shadowMask: 0 },
  { position: { x: 20, y: 0, elevation: 64 }, radius: 100, lightMask: 2, shadowMask: 4 },
];
test("public selection types and patch v9 preserve policy declarations and reject earlier patch versions", () => {
  const selection: SpatialLightSelectionSpec = { enabled: false, fadeSeconds: .2 };
  const scene = { camera: { projection: "orthographic" as const, position: { x: 0, y: -200, elevation: 100 }, target: { x: 0, y: 0, elevation: 16 }, height: 200 }, terrain: [], billboards: {} };
  const operation = { kind: "setEnvironment" as const, changes: { environment: { lighting: { lights, selection } } } };
  equal(sceneSpatialPatchVersion([operation]), 9);
  const patched = applySceneSpatialPatch(scene, { format: "ferrum2d.scene-spatial.patch", version: 9, operations: [operation] });
  equal(patched.environment!.lighting!.selection!.enabled, false);
  for (const version of [6, 7, 8] as const) throws(() => applySceneSpatialPatch(scene, { format: "ferrum2d.scene-spatial.patch", version, operations: [operation] }), /version 9/);
  const words = new Uint32Array(0);
  const exportedView: AuthoringSelectionView = { version: 1, stride: 6, words, values: new Float32Array(words.buffer) };
  equal(exportedView.stride, 6);
});
test("selection appends explicit v8 settings, preserves OFF source and keeps all legacy layouts", () => {
  for (const enabled of [true, false]) for (const policyEnabled of [true, false]) {
    const values = compileSpatialEnvironment({ composition: "separated", lighting: { enabled, maxActiveLights: 1, lights,
      directional: { direction: { x: 0, y: 0, elevation: 1 }, shadows: { center: { x: 1, y: 2, elevation: 3 } } },
      shadows: { lightIndex: 1 }, selection: { enabled: policyEnabled, hysteresis: .2, fadeSeconds: .3, resetDistance: 12 } } });
    equal(values.length, 580); ok(validSpatialEnvironmentValues(values));
    equal(values[576], policyEnabled ? 1 : 0); equal(values[137], 2);
    equal(decodeSpatialEnvironment(values)!.lighting!.enabled === false, !enabled);
    equal(decodeSpatialEnvironment(values)!.lighting!.selection!.enabled, policyEnabled);
    deepEqual(compileSpatialEnvironment(decodeSpatialEnvironment(values)), values);
    deepEqual([...values.subarray(565, 576)], new Array(11).fill(0));
    for (const [slot, value] of [[576, 2], [577, -1], [578, 6], [579, 1e6+1], [565, 1], [579, NaN]]) {
      const bad = values.slice(); bad[slot] = value; equal(validSpatialEnvironmentValues(bad), false);
    }
  }
  equal(compileSpatialEnvironment({ lighting: { lights: [] } }).length, 80);
  equal(compileSpatialEnvironment({ lighting: { lights } }).length, 576);
  equal(compileSpatialEnvironment({ composition: "separated" }).length, 544);
  const config = resolveSpatialEnvironmentSpec({ lighting: { lights: [], selection: {} } }).lighting!.selection!;
  deepEqual(config, { enabled: true, hysteresis: .15, fadeSeconds: .15, resetDistance: 0 });
  for (const selection of [null, false, { enabled: null }, { hysteresis: 1.1 }, { fadeSeconds: -Number.MIN_VALUE }, { fadeSeconds: NaN }, { resetDistance: Infinity }, { future: 1 }])
    throws(() => resolveSpatialEnvironmentSpec({ lighting: { enabled: false, lights: [], selection } }), /selection/);
});

test("partial/old native rejects v8, including disabled policy, before resource lookup or source mutation", () => {
  let calls = 0;
  const native = { configure_spatial_environment: () => { calls++; return true; } } as unknown as Engine;
  const api = createSpatialApi(native, () => {}, () => ({ width: 400, height: 300 }), () => { calls++; throw Error("unexpected resource lookup"); });
  for (const enabled of [true, false]) {
    const environment = { lighting: { lights, selection: { enabled } } };
    equal(api.setDataSceneSpatialEnvironment(environment), false);
    const scene = { camera: { projection: "orthographic" as const, position: { x: 0, y: -200, elevation: 100 }, target: { x: 0, y: 0, elevation: 16 }, height: 200 },
      terrain: [], billboards: { hero: { normalTexture: "unloaded" } }, environment };
    equal(api.configureDataSceneSpatial(scene, {}), false);
    equal(api.preflightDataSceneSpatialModels(scene), false);
  }
  equal(api.resetDataSceneSpatialLightSelection(), false); equal(calls, 0);
  equal(supportsSpatialLightSelection({ spatial_light_selection_abi_version: () => 1 }), false);
});

test("diagnostic borrowed rows reject partial ABI, bounds, duplicate slots and invalid weights", () => {
  const environment = compileSpatialEnvironment({ lighting: { lights, maxActiveLights: 1, selection: {} } });
  const memory = new WebAssembly.Memory({ initial: 1 });
  const words = new Uint32Array(memory.buffer, 64, 12), values = new Float32Array(memory.buffer, 64, 12);
  words.set([0, 0, 1, 0, 0, 0, 1, 0xffffffff, 5, 0, 0, 0]);
  values[4] = 1; values[5] = 1; values[10] = .9;
  const view: SpatialLightSelectionBufferView = { version: 1, stride: 6, words, values };
  validateSpatialLightSelectionBuffer(environment, view);
  throws(() => validateSpatialLightSelectionBuffer(environment), /Missing/);
  words[7] = 0; throws(() => validateSpatialLightSelectionBuffer(environment, view), /row/); words[7] = 0xffffffff;
  values[11] = .1; throws(() => validateSpatialLightSelectionBuffer(environment, view), /row/); values[11] = 0;
  throws(() => validateSpatialLightSelectionBuffer(environment, { ...view, values: values.slice() }), /ABI/);
  throws(() => readSpatialLightSelection({}, memory, environment), /Unsupported/);
  const native = {
    spatial_light_selection_abi_version: () => 1, spatial_light_selection_progress_abi_version: () => 1,
    spatial_light_selection_diagnostic_size_bytes: () => 24, spatial_light_selection_diagnostics_ptr: () => 64,
    spatial_light_selection_diagnostics_len: () => 2, capture_spatial_light_selection_state: () => new Float64Array(),
    preflight_spatial_light_selection_state: () => true, restore_spatial_light_selection_state: () => true,
    restore_data_scene_progress_with_spatial_light_selection: () => true, reset_spatial_light_selection: () => true,
  };
  ok(readSpatialLightSelection(native, memory, environment));
  throws(() => readSpatialLightSelection({ ...native, spatial_light_selection_diagnostics_ptr: () => 65 }, memory, environment), /pointer/);
  throws(() => readSpatialLightSelection({ ...native, spatial_light_selection_diagnostics_len: () => 17 }, memory, environment), /count/);
  memory.grow(1);
  const current = readSpatialLightSelection(native, memory, environment)!;
  equal(current.words.buffer, memory.buffer); equal(words.length, 0);
});

test("history JSON is an owned serialization of native phases and validates duplicates and raw weight bounds", () => {
  const values = new Float64Array([1, 123, 1, 42, 1, 2, -3, 0, 1, .5, 3, -1, -1, 0, 0, -1, -1, 0, 0, -1, -1, 0, 0]);
  const progress = decodeSpatialLightSelectionProgress(values);
  deepEqual(progress.anchor, { x: 1, y: 3, elevation: 2 });
  deepEqual(spatialLightSelectionProgressValues(progress), values);
  const owned = resolveSpatialLightSelectionProgress(progress); ok(owned !== progress); ok(owned.slots !== progress.slots);
  for (const [slot, value] of [[2, 2], [7, 16], [9, -Number.MIN_VALUE], [10, 4], [11, 1]]) {
    const bad = values.slice(); bad[slot] = value; throws(() => decodeSpatialLightSelectionProgress(bad), /selection|Selection|Invalid|phase/);
  }
  throws(() => resolveSpatialLightSelectionProgress({ ...progress, initialized: false }), /Uninitialized/);
  throws(() => resolveSpatialLightSelectionProgress({ ...progress, future: true }), /object/);
});
