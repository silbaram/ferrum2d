import { deepEqual, equal, throws, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  resolveSpatialEnvironmentSpec,
  type SpatialEnvironmentSpec,
} from "../src/core.js";
import {
  compileSpatialEnvironment,
  decodeSpatialEnvironment,
  validSpatialEnvironmentValues,
} from "../src/spatialEnvironment.js";
import { createSpatialApi } from "../src/dataSceneSpatial.js";
import type { Engine } from "../pkg/ferrum_core.js";
const spec: SpatialEnvironmentSpec = {
  lighting: {
    ambient: [0.1, 0.1, 0.1],
    lights: [{ position: { x: 3, y: 4, elevation: 64 }, radius: 200 }],
    shadows: { lightIndex: 0 },
  },
  depthOfField: { focusDistance: 200 },
  colorGrading: { toneMapping: "aces" },
  fog: { start: 100, end: 300, color: [0.2, 0.3, 0.4] },
};
test("spatial environment compiles deterministic finite numeric v1 settings with bounded defaults", () => {
  const normalized = resolveSpatialEnvironmentSpec(spec),
    v = compileSpatialEnvironment(spec);
  equal(v.length, 80);
  ok(validSpatialEnvironmentValues(v));
  equal(v[0], 15);
  equal(v[2], 0);
  equal(v[3], 256);
  deepEqual([...v.slice(12, 16)], [3, 64, -4, 200]);
  equal(v[63], 8);
  deepEqual(compileSpatialEnvironment(decodeSpatialEnvironment(v)), v);
  equal(normalized.lighting!.shadows!.bias, 0.05);
  equal(normalized.depthOfField!.focusRange, 10);
  equal(normalized.colorGrading!.exposure, 0);
  deepEqual([...compileSpatialEnvironment(null)], []);
  deepEqual(decodeSpatialEnvironment(new Float32Array()), null);
  equal(compileSpatialEnvironment({})[0], 0);
});
test("spatial environment rejects malformed fields and renderer numeric buffers before native mutation", () => {
  for (const bad of [
    { wat: true },
    { lighting: null },
    {
      lighting: {
        lights: [{ position: { x: 0, y: 0, elevation: 1 }, radius: 0 }],
      },
    },
    { lighting: { lights: Array(5).fill(spec.lighting!.lights[0]) } },
    { lighting: { lights: [], shadows: { lightIndex: 0 } } },
    {
      lighting: {
        ...spec.lighting,
        shadows: { lightIndex: 0, resolution: 300 },
      },
    },
    { depthOfField: { focusDistance: 0 } },
    { depthOfField: { focusDistance: 200, maxBlurRadius: 13 } },
    { fog: { color: [0, 0, 0], start: 100, end: 100 } },
    { colorGrading: { exposure: 11 } },
    { colorGrading: { toneMapping: "film" } },
    { colorGrading: { tint: [1, NaN, 1] } },
  ])
    throws(() => resolveSpatialEnvironmentSpec(bad), /spatial.environment/);
  const original = compileSpatialEnvironment(spec);
  for (const [index, value] of [
    [0, 16],
    [1, 5],
    [2, 3],
    [3, 300],
    [12, Infinity],
    [15, 0],
    [63, 13],
    [67, 5],
    [79, 1],
  ]) {
    const invalid = original.slice();
    invalid[index] = value;
    equal(validSpatialEnvironmentValues(invalid), false, `field ${index}`);
  }
});
test("spatial environment facade is cold numeric, validates before call, and guards old Wasm", () => {
  const calls: Float32Array[] = [];
  const api = createSpatialApi(
    {
      configure_spatial_environment: (v: Float32Array) => {
        calls.push(v);
        return true;
      },
    } as Engine,
    () => {},
    () => ({ width: 400, height: 300 }),
  );
  ok(api.setDataSceneSpatialEnvironment(spec));
  deepEqual(calls[0], compileSpatialEnvironment(spec));
  throws(
    () =>
      api.setDataSceneSpatialEnvironment({
        depthOfField: { focusDistance: -1 },
      }),
    /focusDistance/,
  );
  equal(calls.length, 1);
  ok(api.setDataSceneSpatialEnvironment(null));
  equal(calls[1].length, 0);
  const old = createSpatialApi(
    {} as Engine,
    () => {},
    () => ({ width: 1, height: 1 }),
  );
  equal(old.setDataSceneSpatialEnvironment(spec), false);
});
