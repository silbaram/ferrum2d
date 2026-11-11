import { test } from 'node:test';
import { equal, deepEqual, ok, throws } from 'node:assert/strict';
import { compileSpatialEnvironment, decodeSpatialEnvironment, resolveSpatialEnvironmentSpec, validSpatialEnvironmentValues } from '../src/spatialEnvironment.js';
import { createSpatialApi, type DataSceneSpatialSpec } from '../src/dataSceneSpatial.js';
import type { Engine } from '../pkg/ferrum_core.js';

test('Spatial light channels compile a distinct v7 layout and decode source rather than selected order', () => {
  const spec = { composition: 'separated' as const, lighting: { directional: { direction: { x: 0, y: 0, elevation: 1 }, lightMask: 0, shadowMask: 3 },
    maxActiveLights: 1 as const, shadows: { lightIndex: 1 }, lights: [
      { position: { x: 0, y: 0, elevation: 64 }, radius: 100, lightMask: 1, shadowMask: 0 },
      { position: { x: 20, y: 0, elevation: 64 }, radius: 100, lightMask: 2, shadowMask: 4 },
    ] } };
  const values = compileSpatialEnvironment(spec); equal(values.length, 576); ok(validSpatialEnvironmentValues(values));
  equal(values[544], 3 << 8); equal(values[545], 2 | 4 << 8);
  deepEqual([...values.subarray(549, 551)], [1, 2 | 4 << 8]);
  const decoded = decodeSpatialEnvironment(values)!;
  equal(decoded.composition, 'separated'); equal(decoded.lighting!.directional!.lightMask, 0);
  equal(decoded.lighting!.lights[0].lightMask, 1); equal(decoded.lighting!.lights[1].shadowMask, 4);
  deepEqual(compileSpatialEnvironment(decoded), values);
  equal(compileSpatialEnvironment({ composition: 'separated' }).length, 544);
  equal(compileSpatialEnvironment({ lighting: { lights: [] } }).length, 80);
});

test('Spatial channels validate OFF declarations and packed reserved/unused fields', () => {
  const input = { lighting: { enabled: false, lights: [{ position: { x: 0, y: 0, elevation: 64 }, radius: 100, lightMask: 0, shadowMask: 0 }] } };
  const spec = resolveSpatialEnvironmentSpec(input); equal(spec.lighting!.lights[0].lightMask, 0);
  const values = compileSpatialEnvironment(spec); equal(values.length, 576); ok(validSpatialEnvironmentValues(values));
  equal(decodeSpatialEnvironment(values)!.lighting!.enabled, false);
  equal(decodeSpatialEnvironment(values)!.lighting!.lights[0].lightMask, 0);
  deepEqual(compileSpatialEnvironment(decodeSpatialEnvironment(values)!), values);
  for (const lightMask of [-1, 256, .5, NaN, null, '1'])
    throws(() => resolveSpatialEnvironmentSpec({ lighting: { ...input.lighting, lights: [{ ...input.lighting.lights[0], lightMask }] } }), /lightMask/);
  for (const [slot, value] of [[544, 65536], [544, .5], [545, 1], [550, 1], [565, 1], [529, 1]]) {
    const invalid = values.slice(); invalid[slot] = value; equal(validSpatialEnvironmentValues(invalid), false);
  }
});

test('old native rejects receiver or light requests before texture/model lookup or native setting', () => {
  let calls = 0;
  const native = { configure_spatial_environment: () => { calls++; return true; }, configure_spatial_scene_models: () => { calls++; return true; } } as unknown as Engine;
  const api = createSpatialApi(native, () => {}, () => ({ width: 100, height: 100 }), () => { calls++; throw Error('must not look up assets'); });
  const spec: DataSceneSpatialSpec = { camera: { projection: 'orthographic', position: { x: 0, y: -200, elevation: 100 }, target: { x: 0, y: 0, elevation: 16 }, height: 200 }, terrain: [], billboards: { hero: { normalTexture: 'not-loaded', lightMask: 0 } } };
  equal(api.configureDataSceneSpatial(spec, {}), false); equal(api.preflightDataSceneSpatialModels(spec), false);
  equal(api.setDataSceneSpatialEnvironment({ lighting: { enabled: false, lights: [{ position: { x: 0, y: 0, elevation: 1 }, radius: 10, lightMask: 0 }] } }), false);
  equal(calls, 0);
});
