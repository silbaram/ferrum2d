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

test("pixel presentation uses a versioned optional numeric extension and round trips", () => {
  const v = compileSpatialEnvironment({ pixelArt: { width: 160, height: 90, snapCamera: true } });
  equal(v.length, 112); equal(v[0], 16); ok(validSpatialEnvironmentValues(v));
  deepEqual(compileSpatialEnvironment(decodeSpatialEnvironment(v)), v);
  for (const bad of [{ width: 0, height: 90 }, { width: 160.5, height: 90 }, { width: 2048, height: 2048 }, { width: 160, height: 90, snapCamera: 1 }])
    throws(() => resolveSpatialEnvironmentSpec({ pixelArt: bad }), /pixelArt/);
});

test("directional shadows, PCF and actor focus round trip without changing legacy settings", () => {
  const settings: SpatialEnvironmentSpec = {
    lighting: { lights: [], directional: { direction: { x: 1, y: -1, elevation: 2 }, shadows: {} }, shadowFilter: "pcf3" },
    depthOfField: { focusDistance: 100, quality: "high", focusTarget: "actor", focusOffset: 16 },
  };
  const v = compileSpatialEnvironment(settings);
  equal(v.length, 112); ok(validSpatialEnvironmentValues(v)); equal(v[92], 512);
  equal(v[95], 1); equal(v[96], 1); equal(v[97], 1); equal(v[98], 16); equal(v[99], 0);
  deepEqual(compileSpatialEnvironment(decodeSpatialEnvironment(v)), v);
  for (const invalid of [
    { lighting: { lights: [], directional: { direction: { x: 0, y: 0, elevation: 0 } } } },
    { lighting: { lights: [], shadowFilter: "pcss" } },
    { depthOfField: { focusDistance: 100, quality: "ultra" } },
    { depthOfField: { focusDistance: 100, focusTarget: "missing" } },
    { depthOfField: { focusDistance: 100, focusOffset: 16 } },
  ]) throws(() => resolveSpatialEnvironmentSpec(invalid), /spatial.environment/);
});

test("directional f32 vectors stay byte-identical across repeated environment save round trips", () => {
  for (let i = 0; i < 2000; i++) {
    const original = compileSpatialEnvironment({
      lighting: { lights: [], directional: {
        direction: { x: Math.sin(i * 0.17) * 100, y: Math.cos(i * 0.3) * 300, elevation: Math.sin(i * 0.9) * 400 },
        shadows: { extent: 256, resolution: 512 },
      } },
    });
    let current = original;
    for (let save = 0; save < 3; save++) {
      current = compileSpatialEnvironment(decodeSpatialEnvironment(current));
      deepEqual(current, original, `direction ${i}, save ${save}`);
    }
  }
});
