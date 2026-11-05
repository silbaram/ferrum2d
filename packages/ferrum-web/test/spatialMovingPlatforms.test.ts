import { equal, throws, deepEqual } from "node:assert/strict";
import { test } from "node:test";
import { resolveDataSceneSpatialSpec } from "../src/dataSceneSpatial.js";
import { compileMovingPlatforms, decodeMovingPlatforms } from "../src/spatialMovingPlatforms.js";
import { spatialProgressValues, resolveSpatialProgress } from "../src/dataSceneSpatialProgress.js";
const scene = {
  camera: { projection: "orthographic", position: { x: 20, y: -100, elevation: 100 }, target: { x: 20, y: 20, elevation: 0 }, height: 100, near: 0.1, far: 1000 },
  terrain: [{ id: "lift", x: 0, y: 0, width: 40, depth: 40, elevation: 0 }],
  billboards: {}, movingPlatforms: [{ surfaceId: "lift", offsetElevation: 32, durationSeconds: 2 }],
};
test("platform phase sidecar retains the 8-value entity pose stride and validates identity", () => {
  const spec = resolveDataSceneSpatialSpec(scene);
  const native = compileMovingPlatforms(spec, { lift: 0.75 });
  deepEqual(Array.from(native), [2,1,0,0,32,2,0.75,0]);
  deepEqual({ ...decodeMovingPlatforms(native, spec) }, { lift: 0.75 });
  const values = spatialProgressValues({ camera: spec.camera, movingPlatforms: { lift: 0.75 } }, [{ id: "body", spatialPose: { x: 5, y: 6, heightSpan: null } }], spec, { width: 800, height: 480 });
  equal(values.length, 13+8+8);
  deepEqual(Array.from(values.slice(13,21)), [1,5,6,0,0,0,0,0]);
  deepEqual(Array.from(values.slice(21)), Array.from(native));
  throws(() => compileMovingPlatforms(spec, {}), /IDs/);
  throws(() => compileMovingPlatforms(spec, { lift: 4 }), /period/);
  throws(() => resolveSpatialProgress({ camera: null, movingPlatforms: { lift: NaN } }), /number/);
  throws(() => resolveSpatialProgress({ camera: null, movingPlatforms: { lift: 0 } }), /Disabled/);
  throws(() => resolveSpatialProgress({ camera: null, movingPlatforms: {} }), /Disabled/);
  deepEqual(resolveSpatialProgress({ camera: null }), { camera: null });
  deepEqual(Array.from(spatialProgressValues({ camera: null }, [], spec, { width: 100, height: 100 })), new Array(13).fill(0));
  throws(() => spatialProgressValues({ camera: null, movingPlatforms: { lift: 0 } }, [], spec, { width: 100, height: 100 }), /disabled/);
});
test("moving supports reject ramp/duplicate/missing surfaces and missing native capture", () => {
  throws(() => resolveDataSceneSpatialSpec({ ...scene, movingPlatforms: [{ ...scene.movingPlatforms[0], surfaceId: "missing" }] }), /unique/);
  throws(() => resolveDataSceneSpatialSpec({ ...scene, movingPlatforms: [scene.movingPlatforms[0], scene.movingPlatforms[0]] }), /unique/);
  throws(() => resolveDataSceneSpatialSpec({ ...scene, terrain: [{ ...scene.terrain[0], kind: "ramp", endElevation: 20 }] }), /flat/);
  throws(() => decodeMovingPlatforms(undefined, resolveDataSceneSpatialSpec(scene)), /missing/);
});
