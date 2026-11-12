import "./nativeRuntimeTestHelper.js";
import { equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import { WasmBridge } from "../src/wasmBridge.js";
import { createSpatialApi } from "../src/dataSceneSpatial.js";
import { compileSpatialEnvironment, type SpatialEnvironmentSpec } from "../src/spatialEnvironment.js";
import { validateSpatialExtensions } from "../src/spatialRenderPacket.js";

const sun = { direction: { x: 0, y: 0, elevation: 1 }, shadows: {} };
const light = { position: { x: 0, y: 0, elevation: 20 }, radius: 100 };
// Independent historical wire fixtures: keep old versions testable when adding a new layout.
const layouts: readonly [number, number, SpatialEnvironmentSpec][] = [
  [1, 80, {}], [2, 112, { pixelArt: { width: 160, height: 90 } }],
  [3, 128, { lighting: { lights: [], hemisphere: {} } }], [4, 512, { bloom: {} }],
  [5, 528, { lighting: { lights: [], directional: { ...sun, shadows: { center: { x: 0, y: 0, elevation: 0 } } } } }],
  [6, 544, { composition: "separated" }],
  [7, 576, { lighting: { lights: [{ ...light, lightMask: 0 }] } }],
  [8, 580, { lighting: { lights: [], selection: {} } }],
  [9, 584, { composition: "separated", bloom: { mode: "wide" } }],
  [10, 592, { lighting: { lights: [light], pointShadows: [{ lightIndex: 0 }] } }],
  [11, 600, { lighting: { lights: [], directional: { ...sun, shadows: { pcss: {} } } } }],
  [12, 608, { lighting: { lights: [light], shadows: { lightIndex: 0, pcss: {} } } }],
  [13, 616, { fog: { color: [0, 0, 0], start: 0, end: 200, height: {} } }],
  [14, 632, { composition: "separated", lighting: { lights: [], directional: sun }, lightShafts: {} }],
  [15, 700, { lighting: { lights: [], probes: [] } }],
];

async function runtime() {
  const bridge = await WasmBridge.init(), native = bridge.engine();
  native.use_data_scene(); native.set_viewport_size(400, 300);
  const api = createSpatialApi(native, () => {}, () => ({ width: 400, height: 300 }));
  ok(api.configureDataSceneSpatial({ camera: { projection: "orthographic", position: { x: 0, y: -100, elevation: 100 },
    target: { x: 0, y: 0, elevation: 0 }, height: 200 }, terrain: [], billboards: {} }, {}));
  return { bridge, native, api };
}

test("native environment versions, bridge views and renderer validation agree for every historical layout", async () => {
  const { bridge, native, api } = await runtime();
  try {
    for (const [version, length, spec] of layouts) {
      equal(compileSpatialEnvironment(spec).length, length);
      ok(api.setDataSceneSpatialEnvironment(spec)); native.update(0);
      equal(native.spatial_environment_abi_version(), version);
      const frame = bridge.readRenderCommandBuffer().spatial!;
      equal(frame.environment!.version, version); equal(frame.environment!.values.length, length);
      validateSpatialExtensions(frame);
      for (const invalid of [0, 16, version === 15 ? 14 : version + 1])
        throws(() => validateSpatialExtensions({ ...frame, environment: { ...frame.environment!, version: invalid } } as typeof frame), /environment/);
    }
  } finally { native.free(); }
});

test("the frame bridge reads the environment ABI version exactly once and rechecks the next frame", async () => {
  const { bridge, native, api } = await runtime();
  try {
    ok(api.setDataSceneSpatialEnvironment(layouts[layouts.length - 1][2])); native.update(0);
    const version = native.spatial_environment_abi_version.bind(native); let calls = 0;
    native.spatial_environment_abi_version = () => { calls++; return version(); };
    equal(bridge.readRenderCommandBuffer().spatial!.environment!.version, 15); equal(calls, 1);
    ok(api.setDataSceneSpatialEnvironment({})); native.update(0);
    equal(bridge.readRenderCommandBuffer().spatial!.environment!.version, 1); equal(calls, 2);
    native.spatial_environment_abi_version = () => 16;
    throws(() => bridge.readRenderCommandBuffer(), /environment ABI/);
  } finally { native.free(); }
});
